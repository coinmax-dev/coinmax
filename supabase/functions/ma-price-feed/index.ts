import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * MA Price Feed — Pushes price to Oracle via thirdweb Server Wallet (relayer)
 *
 * Uses emergencySetPrice to sync directly with K-line price curve.
 * Runs every 5 minutes via cron.
 */

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "EwFZ-cz8maTnDHEukynx4UgOx_0oqeqg1qR1gx2cHIM0L-Nks5ogM0U7JhZGQMyg3489Tc42J_QSZ9rLGojFSQ";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "vt_act_B6LKUWDDFVRRESRTNN2OYYYKTOCLDEAYSVFMSYI6A4L47R4ENX26GDBYUVCAGT2WVMNWCQNQWXOR6AFXILSR2DFIJAH3AM5QG4ERZIPV";
const RELAYER_WALLET = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";
const ORACLE_ADDRESS = "0x3EC635802091b9F95b2891f3fd2504499f710145";
const LAUNCH = new Date("2026-03-24T00:00:00Z").getTime();

// ── Price curve (identical to K-line chart in profile-ma.tsx) ──

const DAILY_MOMENTUM = [
  { base: 0.6, vol: 0.015 },
  { base: 0.8, vol: 0.020 },
  { base: 1.0, vol: 0.025 },
  { base: 0.3, vol: 0.020 },
  { base: 0.9, vol: 0.025 },
  { base: 1.2, vol: 0.030 },
  { base: 0.7, vol: 0.020 },
];

const HOUR_PATTERN = [0.3,0.2,0.1,0,-0.1,-0.2,0.4,0.6,0.8,0.7,0.5,0.3,0.5,0.7,0.9,1,0.8,0.6,0.4,0.2,0,-0.1,0.1,0.2];

function rng(seed: number): number {
  let h = Math.abs(seed | 0) * 2654435761;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  return ((h >>> 16) ^ h & 0xFFFF) / 0xFFFF;
}

function smoothStep(x: number): number {
  x = Math.max(0, Math.min(1, x));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function calculateCurrentPrice(hoursSinceLaunch: number): number {
  const h = Math.floor(hoursSinceLaunch);

  // Phase 0: $0.30 → $0.90 in 168 hours (7 days)
  if (h <= 168) {
    const dayIndex = Math.min(Math.floor(h / 24), 6);
    const daily = DAILY_MOMENTUM[dayIndex];
    const progress = h / 168;
    const trendPrice = 0.30 + 0.60 * smoothStep(progress);
    const hourlyBias = HOUR_PATTERN[h % 24] * 0.005 * daily.base;
    const noise = (rng(h * 7 + 1) - 0.5) * 2 * daily.vol;
    const isDip = rng(h * 31 + 3) < 0.15;
    const isSpike = !isDip && rng(h * 47 + 5) < 0.12;
    let p = trendPrice * (1 + noise + hourlyBias + (isDip ? -daily.vol * 1.5 : 0) + (isSpike ? daily.vol * 2 : 0));
    return Math.max(0.28, p);
  }

  // Phase 1: $0.90 → $1.00 (30 days)
  if (h <= 168 + 30 * 24) {
    const progress = (h - 168) / (30 * 24);
    const base = 0.90 + 0.10 * smoothStep(progress);
    const noise = (rng(h * 19 + 7) - 0.5) * 2 * 0.008;
    return Math.max(0.85, base * (1 + noise));
  }

  // Phase 2: 5%/month growth
  const monthsIn = (h - 168 - 30 * 24) / (30 * 24);
  const base = 1.0 * Math.pow(1.05, monthsIn);
  const noise = (rng(h * 23 + 11) - 0.5) * 2 * 0.010;
  return base * (1 + noise);
}

serve(async () => {
  const now = Date.now();
  const hoursSinceLaunch = (now - LAUNCH) / (1000 * 3600);
  const targetPrice = calculateCurrentPrice(hoursSinceLaunch);
  const targetRaw = Math.round(targetPrice * 1e6);

  // Read current on-chain price
  let currentPrice = 0;
  try {
    const rpcRes = await fetch("https://bsc-dataseed1.binance.org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", method: "eth_call", id: 1,
        params: [{ to: ORACLE_ADDRESS, data: "0xa035b1fe" }, "latest"],
      }),
    });
    const rpcData = await rpcRes.json();
    if (rpcData.result && rpcData.result !== "0x") {
      currentPrice = parseInt(rpcData.result, 16) / 1e6;
    }
  } catch { /* use 0 */ }

  // Skip if already close enough (within 0.5%)
  if (currentPrice > 0 && Math.abs(targetPrice - currentPrice) / currentPrice < 0.005) {
    return new Response(JSON.stringify({
      status: "skipped",
      reason: "price already synced",
      onChain: `$${currentPrice.toFixed(4)}`,
      target: `$${targetPrice.toFixed(4)}`,
    }), { headers: { "Content-Type": "application/json" } });
  }

  // Push via thirdweb Server Wallet using emergencySetPrice (bypasses 10% limit)
  const res = await fetch("https://api.thirdweb.com/v1/contracts/write", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-secret-key": THIRDWEB_SECRET,
      "x-vault-access-token": VAULT_ACCESS_TOKEN,
    },
    body: JSON.stringify({
      chainId: 56,
      from: RELAYER_WALLET,
      calls: [{
        contractAddress: ORACLE_ADDRESS,
        method: "function updatePrice(uint256 _newPrice)",
        params: [targetRaw.toString()],
      }],
    }),
  });

  const data = await res.json();
  const txId = data?.result?.transactionIds?.[0] || null;
  const error = data?.error || null;

  // Also update DB fallback price
  try {
    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    await fetch(`${sbUrl}/rest/v1/system_config?key=eq.MA_TOKEN_PRICE`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ value: targetPrice.toFixed(6) }),
    });
  } catch { /* non-critical */ }

  return new Response(JSON.stringify({
    status: txId ? "pushed" : "failed",
    hour: hoursSinceLaunch.toFixed(1),
    onChainBefore: `$${currentPrice.toFixed(4)}`,
    target: `$${targetPrice.toFixed(4)}`,
    raw: targetRaw,
    txId,
    error,
  }), { headers: { "Content-Type": "application/json" } });
});
