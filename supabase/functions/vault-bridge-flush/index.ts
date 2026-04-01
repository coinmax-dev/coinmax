import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Vault Bridge + Flush — Complete fund flow automation
 *
 * Triggered: after each vault deposit (frontend) or by cron
 *
 * Flow:
 *   1. BSC: Check BatchBridgeV2 USDT balance
 *   2. BSC: Server Wallet calls swapAndBridge() (keeper role)
 *      → PancakeSwap USDT→USDC → Stargate → ARB FundRouter
 *   3. ARB: Wait for Stargate delivery (~90s)
 *   4. ARB: Server Wallet calls flushAll() on FundRouter (OPERATOR_ROLE)
 *      → Distributes USDC to 5 wallets (30/8/12/20/30)
 *   5. Record bridge_cycle in DB
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Config — UPDATE BATCH_BRIDGE after deploy-bridge-v3.js ──
const BATCH_BRIDGE     = Deno.env.get("BATCH_BRIDGE_ADDRESS") || "0x96dBfe3aAa877A4f9fB41d592f1D990368a4B2C1";
const ARB_FUND_ROUTER  = "0x71237E535d5E00CDf18A609eA003525baEae3489";
const SERVER_WALLET    = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";
const BSC_USDT         = "0x55d398326f99059fF775485246999027B3197955";
const ARB_USDC         = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const MIN_BRIDGE       = 50; // $50 minimum

const THIRDWEB_SECRET  = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_TOKEN      = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // ── Step 1: Check BSC BatchBridge USDT balance ──
    const balance = await bscBalance(BSC_USDT, BATCH_BRIDGE);
    if (balance < MIN_BRIDGE) {
      return json({ status: "skipped", balance, reason: `$${balance} < min $${MIN_BRIDGE}` });
    }

    // ── Step 2: BSC — Server Wallet calls swapAndBridge() ──
    const bridgeTx = await thirdwebWrite(56, SERVER_WALLET, [{
      contractAddress: BATCH_BRIDGE,
      method: "function swapAndBridge()",
      params: [],
    }]);

    if (!bridgeTx) {
      return json({ status: "error", step: "swapAndBridge", balance }, 500);
    }

    // Wait for BSC tx to confirm + Stargate transit (~90s)
    await sleep(90_000);

    // ── Step 3: Check ARB FundRouter balance ──
    const arbBal = await arbBalance(ARB_USDC, ARB_FUND_ROUTER);

    let flushTx = null;
    let flushStatus = "PENDING";

    if (arbBal > 1) {
      // ── Step 4: ARB — Server Wallet calls flushAll() ──
      flushTx = await thirdwebWrite(42161, SERVER_WALLET, [{
        contractAddress: ARB_FUND_ROUTER,
        method: "function flushAll()",
        params: [],
      }]);
      flushStatus = flushTx ? "FLUSHED" : "FLUSH_FAILED";
    } else {
      // Stargate may still be in transit, retry later
      flushStatus = "BRIDGE_PENDING";
    }

    // ── Step 5: Record in DB ──
    await supabase.from("bridge_cycles").insert({
      cycle_type: "AUTO_BRIDGE_FLUSH",
      status: flushStatus,
      amount_usd: balance,
      initiated_by: "auto",
      bsc_tx: bridgeTx,
      arb_tx: flushTx,
      metadata: {
        bscBalance: balance,
        arbBalance: arbBal,
        bridge: BATCH_BRIDGE,
        router: ARB_FUND_ROUTER,
      },
    });

    return json({
      status: flushStatus,
      bscBridged: balance,
      arbReceived: arbBal,
      bridgeTx,
      flushTx,
    });

  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});

// ── Helpers ──

async function bscBalance(token: string, holder: string): Promise<number> {
  const r = await rpcCall("https://bsc-dataseed1.binance.org", token,
    "0x70a08231000000000000000000000000" + holder.slice(2).toLowerCase());
  return parseInt(r || "0x0", 16) / 1e18;
}

async function arbBalance(token: string, holder: string): Promise<number> {
  const r = await rpcCall("https://arb1.arbitrum.io/rpc", token,
    "0x70a08231000000000000000000000000" + holder.slice(2).toLowerCase());
  return parseInt(r || "0x0", 16) / 1e6; // ARB USDC has 6 decimals
}

async function rpcCall(rpc: string, to: string, data: string): Promise<string> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", params: [{ to, data }, "latest"], id: 1 }),
  });
  const json = await res.json();
  return json.result;
}

async function thirdwebWrite(
  chainId: number,
  from: string,
  calls: { contractAddress: string; method: string; params: unknown[] }[],
): Promise<string | null> {
  const res = await fetch("https://api.thirdweb.com/v1/contracts/write", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-secret-key": THIRDWEB_SECRET,
      "x-vault-access-token": VAULT_TOKEN,
    },
    body: JSON.stringify({ chainId, from, calls }),
  });
  const data = await res.json();
  return data?.result?.transactionIds?.[0] || null;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
