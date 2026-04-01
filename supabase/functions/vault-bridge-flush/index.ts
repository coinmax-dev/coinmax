import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Vault Bridge + Flush — Full automated cycle (pg_cron every 10 min)
 *
 * 1. Check Server Wallet USDT balance on BSC
 * 2. Transfer USDT: Server Wallet → BatchBridge (thirdweb write)
 * 3. Call swapAndBridge() on BatchBridge (Server Wallet = keeper)
 * 4. Wait ~120s for Stargate
 * 5. Call flushAll() on ARB FundRouter (Server Wallet = operator)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SERVER_WALLET   = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";
const BATCH_BRIDGE    = Deno.env.get("BATCH_BRIDGE_ADDRESS") || "0x96dBfe3aAa877A4f9fB41d592f1D990368a4B2C1";
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
    // ── 1. Check Server Wallet USDT on BSC ──
    const swBalance = await erc20Balance("https://bsc-dataseed1.binance.org", BSC_USDT, SERVER_WALLET, 18);
    const bbBalance = await erc20Balance("https://bsc-dataseed1.binance.org", BSC_USDT, BATCH_BRIDGE, 18);

    if (swBalance < MIN_BRIDGE && bbBalance < MIN_BRIDGE) {
      return json({ status: "skipped", swBalance, bbBalance, reason: "below minimum" });
    }

    let transferTx: string | null = null;

    // ── 2. Transfer SW → BatchBridge (if SW has funds) ──
    if (swBalance >= MIN_BRIDGE) {
      const amountWei = BigInt(Math.floor(swBalance * 1e18)).toString();
      transferTx = await tw(56, [{
        contractAddress: BSC_USDT,
        method: "function transfer(address to, uint256 amount) returns (bool)",
        params: [BATCH_BRIDGE, amountWei],
      }]);

      if (!transferTx) {
        await log(supabase, "TRANSFER_FAILED", swBalance);
        return json({ status: "TRANSFER_FAILED", swBalance }, 500);
      }

      // Wait for transfer confirmation
      await sleep(15_000);
    }

    // ── 3. Call swapAndBridge() on BatchBridge ──
    const bridgeTx = await tw(56, [{
      contractAddress: BATCH_BRIDGE,
      method: "function swapAndBridge()",
      params: [],
    }]);

    if (!bridgeTx) {
      await log(supabase, "BRIDGE_FAILED", swBalance + bbBalance, transferTx);
      return json({ status: "BRIDGE_FAILED", swBalance, bbBalance, transferTx }, 500);
    }

    // ── 4. Wait for Stargate (~120s) ──
    await sleep(120_000);

    // ── 5. Check ARB FundRouter + flushAll ──
    const arbBal = await erc20Balance("https://arb1.arbitrum.io/rpc", ARB_USDC, ARB_FUND_ROUTER, 6);
    let flushTx: string | null = null;
    let status = "BRIDGED";

    if (arbBal > 1) {
      flushTx = await tw(42161, [{
        contractAddress: ARB_FUND_ROUTER,
        method: "function flushAll()",
        params: [],
      }]);
      status = flushTx ? "FLUSHED" : "FLUSH_FAILED";
    } else {
      status = "BRIDGE_PENDING";
    }

    await log(supabase, status, swBalance + bbBalance, bridgeTx, flushTx, { arbBal });

    return json({ status, bridged: swBalance + bbBalance, transferTx, bridgeTx, flushTx, arbBal });

  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});

// ── thirdweb write via Server Wallet ──
async function tw(chainId: number, calls: { contractAddress: string; method: string; params: unknown[] }[]): Promise<string | null> {
  const res = await fetch("https://api.thirdweb.com/v1/contracts/write", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-secret-key": THIRDWEB_SECRET,
      "x-vault-access-token": VAULT_TOKEN,
    },
    body: JSON.stringify({ chainId, from: SERVER_WALLET, calls }),
  });
  const data = await res.json();
  return data?.result?.transactionIds?.[0] || null;
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
    metadata: { serverWallet: SERVER_WALLET, batchBridge: BATCH_BRIDGE, ...meta },
  });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
