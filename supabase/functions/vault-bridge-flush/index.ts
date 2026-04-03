import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Vault Bridge + Flush — Full automated cycle (pg_cron every 10 min)
 *
 * Current flow: Vault deposits go directly to BatchBridge (fundDistributor = BB)
 *
 * 1. Check BatchBridge USDT balance on BSC
 * 2. If Server Wallet has leftover USDT, transfer to BB first
 * 3. Server Wallet calls swapAndBridge() on BB (keeper role)
 * 4. Wait ~120s for Stargate
 * 5. Server Wallet calls flushAll() on ARB FundRouter (OPERATOR_ROLE)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SERVER_WALLET   = "0xe193ACcf11aBf508e8c7D0CeE03ea4E6f75B09ff";
const BATCH_BRIDGE    = Deno.env.get("BATCH_BRIDGE_ADDRESS") || "0xAa80a499B8738E3Fd7779057F7E3a7D73c045c4D";
const ARB_FUND_ROUTER = "0x71237E535d5E00CDf18A609eA003525baEae3489";
const BSC_USDT        = "0x55d398326f99059fF775485246999027B3197955";
const ARB_USDC        = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const MIN_BRIDGE      = 50;

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_TOKEN     = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    // ── 1. Check balances ──
    const bbBalance = await erc20Balance("https://bsc-dataseed1.binance.org", BSC_USDT, BATCH_BRIDGE, 18);
    const swBalance = await erc20Balance("https://bsc-dataseed1.binance.org", BSC_USDT, SERVER_WALLET, 18);

    const totalAvailable = bbBalance + swBalance;
    if (totalAvailable < MIN_BRIDGE) {
      return json({ status: "skipped", bbBalance, swBalance, reason: `$${totalAvailable.toFixed(0)} < min $${MIN_BRIDGE}` });
    }

    let transferTx: string | null = null;

    // ── 2. If SW has leftover USDT, move to BB first ──
    if (swBalance >= 10) {
      const amountWei = BigInt(Math.floor(swBalance * 1e18)).toString();
      const r = await tw(56, [{
        contractAddress: BSC_USDT,
        method: "function transfer(address to, uint256 amount) returns (bool)",
        params: [BATCH_BRIDGE, amountWei],
      }]);
      transferTx = r.txId;
      if (transferTx) await sleep(15_000);
    }

    // ── 3. swapAndBridge (Server Wallet = keeper) ──
    if (bbBalance < MIN_BRIDGE && !transferTx) {
      return json({ status: "skipped", bbBalance, swBalance, reason: "BB below min, no SW transfer" });
    }

    const bridgeResult = await tw(56, [{
      contractAddress: BATCH_BRIDGE,
      method: "function swapAndBridge()",
      params: [],
    }]);

    if (!bridgeResult.txId) {
      await log(supabase, "BRIDGE_FAILED", totalAvailable, null, null, { error: bridgeResult.raw });
      return json({ status: "BRIDGE_FAILED", bbBalance, swBalance, error: bridgeResult.raw }, 500);
    }

    // ── 4. Wait for Stargate (~120s) ──
    await sleep(120_000);

    // ── 5. ARB flushAll ──
    const arbBal = await erc20Balance("https://arb1.arbitrum.io/rpc", ARB_USDC, ARB_FUND_ROUTER, 6);
    let flushTx: string | null = null;
    let status = "BRIDGED";

    if (arbBal > 1) {
      const flushResult = await tw(42161, [{
        contractAddress: ARB_FUND_ROUTER,
        method: "function flushAll()",
        params: [],
      }]);
      flushTx = flushResult.txId;
      status = flushTx ? "FLUSHED" : "FLUSH_FAILED";
    } else {
      status = "BRIDGE_PENDING";
    }

    await log(supabase, status, totalAvailable, bridgeResult.txId, flushTx, { arbBal, transferTx });
    return json({ status, bridged: totalAvailable, bridgeTx: bridgeResult.txId, flushTx, arbBal });

  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});

async function tw(chainId: number, calls: { contractAddress: string; method: string; params: unknown[] }[]): Promise<{ txId: string | null; raw: unknown }> {
  const res = await fetch("https://engine.thirdweb.com/v1/write/contract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-secret-key": THIRDWEB_SECRET,
      "x-vault-access-token": VAULT_TOKEN,
    },
    body: JSON.stringify({
      executionOptions: { type: "auto", from: SERVER_WALLET, chainId: String(chainId) },
      params: calls.map(c => ({ contractAddress: c.contractAddress, method: c.method, params: c.params })),
    }),
  });
  const data = await res.json();
  const txId = data?.result?.transactions?.[0]?.id
    || data?.result?.transactionIds?.[0]
    || null;
  return { txId, raw: data };
}

async function erc20Balance(rpc: string, token: string, holder: string, decimals: number): Promise<number> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", method: "eth_call", id: 1,
      params: [{ to: token, data: "0x70a08231000000000000000000000000" + holder.slice(2).toLowerCase() }, "latest"],
    }),
  });
  const d = await res.json();
  return parseInt(d.result || "0x0", 16) / (10 ** decimals);
}

async function log(sb: any, status: string, amount: number, bscTx?: string | null, arbTx?: string | null, meta?: Record<string, unknown>) {
  await sb.from("bridge_cycles").insert({
    cycle_type: "AUTO_CRON",
    status,
    amount_usd: amount,
    initiated_by: "pg_cron",
    bsc_tx: bscTx || null,
    arb_tx: arbTx || null,
    metadata: { batchBridge: BATCH_BRIDGE, ...meta },
  });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
