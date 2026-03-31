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
const ORACLE_ADDRESS = "0xff5Ab71939Fa021A7BCa38Db8b3c1672D1B819dD";
/**
 * Dynamic price model:
 * - Base: $1.00 (stable around $0.95 - $1.05)
 * - 金库入金 / 收益产生 → 小幅涨价 (max +5%/month)
 * - 闪兑卖出 MA → 小幅跌价 (max -5%/month)
 * - 随机波动 (hourly noise)
 * - Hard bounds: $0.95 - $1.05
 */

const SUPABASE_URL_INTERNAL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY_INTERNAL = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function calculateDynamicPrice(currentPrice: number): Promise<number> {
  const now = Date.now();
  const hour = Math.floor(now / 3600000);

  // ── 1. Read recent activity from DB (last 5 min) ──
  let depositCount = 0;
  let swapSellCount = 0;
  let yieldCount = 0;

  try {
    const headers = { "Content-Type": "application/json", apikey: SUPABASE_KEY_INTERNAL, Authorization: `Bearer ${SUPABASE_KEY_INTERNAL}` };
    const fiveMinAgo = new Date(now - 5 * 60 * 1000).toISOString();

    // Vault deposits in last 5 min
    const depRes = await fetch(`${SUPABASE_URL_INTERNAL}/rest/v1/vault_positions?select=id&created_at=gte.${fiveMinAgo}&status=eq.ACTIVE`, { headers });
    const depData = await depRes.json();
    depositCount = Array.isArray(depData) ? depData.length : 0;

    // MA swap sells in last 5 min
    const swapRes = await fetch(`${SUPABASE_URL_INTERNAL}/rest/v1/ma_swap_records?select=id&created_at=gte.${fiveMinAgo}&direction=eq.sell`, { headers });
    const swapData = await swapRes.json();
    swapSellCount = Array.isArray(swapData) ? swapData.length : 0;

    // Vault yields in last hour (settled daily but check)
    const yieldRes = await fetch(`${SUPABASE_URL_INTERNAL}/rest/v1/vault_rewards?select=id&created_at=gte.${new Date(now - 3600000).toISOString()}&limit=10`, { headers });
    const yieldData = await yieldRes.json();
    yieldCount = Array.isArray(yieldData) ? yieldData.length : 0;
  } catch { /* use 0 counts */ }

  // ── 2. Calculate pressure ──
  // Deposits + yields = upward pressure (+0.001 per event, max +0.002 per 5min)
  const upPressure = Math.min((depositCount + yieldCount * 0.5) * 0.001, 0.002);

  // Swap sells = downward pressure (-0.001 per event, max -0.002 per 5min)
  const downPressure = Math.min(swapSellCount * 0.001, 0.002);

  // Net pressure
  const netPressure = upPressure - downPressure;

  // ── 3. Random hourly noise (deterministic by hour) ──
  let h = Math.abs(hour) * 2654435761;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  const rng = ((h >>> 16) ^ h & 0xFFFF) / 0xFFFF;
  const noise = (rng - 0.5) * 0.006; // ±0.3% random noise

  // ── 4. Apply to current price ──
  let newPrice = currentPrice * (1 + netPressure + noise);

  // ── 5. Hard bounds: $0.95 - $1.05 ──
  newPrice = Math.max(0.95, Math.min(1.05, newPrice));

  // ── 6. Mean reversion (pull toward $1.00) ──
  const reversion = (1.00 - newPrice) * 0.01; // 1% pull toward $1.00
  newPrice += reversion;
  newPrice = Math.max(0.95, Math.min(1.05, newPrice));

  return newPrice;
}

serve(async () => {
  // Read current on-chain price
  let currentPrice = 1.0; // default
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
  } catch { /* use default */ }

  // Calculate new price based on activity
  const targetPrice = await calculateDynamicPrice(currentPrice);
  const targetRaw = Math.round(targetPrice * 1e6);

  // ALWAYS sync DB price first (used by settle_vault_daily / team commission)
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

  // Skip Oracle push if already close enough (within 0.5%)
  if (currentPrice > 0 && Math.abs(targetPrice - currentPrice) / currentPrice < 0.005) {
    return new Response(JSON.stringify({
      status: "synced",
      reason: "Oracle already synced, DB updated",
      onChain: `$${currentPrice.toFixed(4)}`,
      target: `$${targetPrice.toFixed(4)}`,
    }), { headers: { "Content-Type": "application/json" } });
  }

  // Push to Oracle via thirdweb Server Wallet
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
