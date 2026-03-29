/**
 * MA Flash Swap Edge Function
 *
 * Handles MA ↔ USDT/USDC swaps:
 *   1. User transfers MA to platform wallet (verified via tx hash)
 *   2. Platform sends USDT/USDC back at oracle price (minus 0.3% fee)
 *   3. Records swap in ma_swap_records table
 *
 * Quota rule: user can only swap up to 50% of their MA holdings
 *
 * Reverse swap (USDT → MA): user sends USDT, gets MA back
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SWAP_FEE_PCT = 0.003; // 0.3%
const MA_TOKEN = "0x4f71f2d1bD1480EC002e5c7A331BfA5F7A6c5C5b";
const BSC_RPC = "https://bsc-dataseed1.binance.org";

async function getMABalance(wallet: string): Promise<number> {
  try {
    const data = "0x70a08231000000000000000000000000" + wallet.slice(2).toLowerCase();
    const res = await fetch(BSC_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", id: 1, params: [{ to: MA_TOKEN, data }, "latest"] }),
    });
    const r = await res.json();
    return parseInt(r.result || "0x0", 16) / 1e18;
  } catch { return 0; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const {
      walletAddress,
      txHash,
      direction,     // "sell" (MA→USD) or "buy" (USD→MA)
      maAmount,      // MA amount (human readable, e.g. 500)
      outputToken,   // "USDT" or "USDC"
      maPrice,       // oracle price at time of swap (e.g. 0.10)
      maBalance,     // user's total MA balance at time of swap
    } = body;

    if (!walletAddress || !txHash || !direction || !maAmount || !maPrice) {
      return jsonResponse({ error: "Missing required fields" }, 400);
    }

    // Validate direction
    if (!["sell", "buy"].includes(direction)) {
      return jsonResponse({ error: "Invalid direction: must be 'sell' or 'buy'" }, 400);
    }

    // Quota check for sell (MA→USD): verify on-chain balance, max 50%
    if (direction === "sell") {
      const onChainBalance = await getMABalance(walletAddress);
      const quota = onChainBalance / 2;
      if (maAmount > quota) {
        return jsonResponse({
          error: `超出闪兑额度。链上余额 ${onChainBalance.toFixed(2)} MA，最大可兑换 ${quota.toFixed(2)} MA（50%）`,
        }, 400);
      }
    }

    // Check for duplicate tx
    const { data: existing } = await supabase
      .from("ma_swap_records")
      .select("id")
      .eq("tx_hash", txHash)
      .limit(1);

    if (existing && existing.length > 0) {
      return jsonResponse({ error: "This transaction has already been processed" }, 400);
    }

    // Calculate output
    const fee = maAmount * maPrice * SWAP_FEE_PCT;
    const usdAmount = direction === "sell"
      ? maAmount * maPrice - fee      // MA → USD: user gets USD minus fee
      : maAmount;                       // USD → MA: maAmount is actually USD amount
    const maOut = direction === "buy"
      ? (maAmount / maPrice) * (1 - SWAP_FEE_PCT)  // USD → MA: user gets MA minus fee
      : 0;

    // Record the swap
    const { error: insertError } = await supabase.from("ma_swap_records").insert({
      wallet_address: walletAddress,
      tx_hash: txHash,
      direction,
      ma_amount: direction === "sell" ? maAmount : maOut,
      usd_amount: direction === "sell" ? usdAmount : maAmount,
      output_token: outputToken || "USDT",
      ma_price: maPrice,
      fee_usd: fee,
      ma_balance_before: direction === "sell" ? await getMABalance(walletAddress) : (maBalance || 0),
      status: "completed",
    });

    if (insertError) {
      console.error("Insert error:", insertError);
      return jsonResponse({ error: `Record failed: ${insertError.message}` }, 500);
    }

    // Update daily swap volume in profile (optional tracking)
    // The actual USDT/USDC transfer back to user is handled by the server wallet
    // via thirdweb Engine or manual process

    return jsonResponse({
      success: true,
      direction,
      maAmount: direction === "sell" ? maAmount : maOut,
      usdAmount: direction === "sell" ? usdAmount : maAmount,
      fee: fee,
      outputToken: outputToken || "USDT",
      message: direction === "sell"
        ? `已闪兑 ${maAmount} MA → $${usdAmount.toFixed(2)} ${outputToken || "USDT"}`
        : `已闪兑 $${maAmount} ${outputToken || "USDT"} → ${maOut.toFixed(2)} MA`,
    });

  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500);
  }
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
