import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * V4 FlashSwap — Server USDC → PancakeSwap → USDT 给用户
 *
 * 用户不需要链上操作。MA 从钱包余额或释放余额扣除（DB）。
 * Server 钱包用 USDC 通过 PancakeSwap (0x92b7...3121) 换成 USDT 给用户。
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "";
const SERVER_WALLET = "0xe193ACcf11aBf508e8c7D0CeE03ea4E6f75B09ff";
const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const PANCAKE_ROUTER = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";
const BSC_RPC = "https://bsc-dataseed1.binance.org";
const ORACLE = "0x35580292fA5c8b7110034EA1a1521952E6F42bbb";

async function engineWrite(from: string, call: { contractAddress: string; method: string; params: unknown[] }) {
  const res = await fetch("https://engine.thirdweb.com/v1/write/contract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-secret-key": THIRDWEB_SECRET,
      "x-vault-access-token": VAULT_ACCESS_TOKEN,
    },
    body: JSON.stringify({
      executionOptions: { type: "EOA", from, chainId: "56" },
      params: [call],
    }),
  });
  return res.json();
}

async function getOraclePrice(): Promise<number> {
  const res = await fetch(BSC_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", method: "eth_call", id: 1,
      params: [{ to: ORACLE, data: "0x98d5fdca" }, "latest"],
    }),
  });
  const d = await res.json();
  return parseInt(d.result || "0x0", 16) / 1e6;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { walletAddress, maAmount } = await req.json();
    if (!walletAddress || !maAmount) return json({ error: "Missing walletAddress or maAmount" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const amount = Number(maAmount);
    if (amount <= 0) return json({ error: "Invalid amount" }, 400);

    // 1. Validate user
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .ilike("wallet_address", walletAddress)
      .single();
    if (!profile) return json({ error: "Profile not found" }, 404);

    // 2. Get MA price
    const maPrice = await getOraclePrice();
    if (maPrice <= 0) return json({ error: "Oracle price unavailable" }, 500);

    const usdtAmount = amount * maPrice;
    console.log(`FlashSwap: ${walletAddress} | ${amount} MA × $${maPrice} = $${usdtAmount.toFixed(2)} USDT`);

    // 3. Deduct MA from user's balance (DB — 从释放余额或可提收益扣除)
    // First try release_schedules (释放余额)
    const { data: schedules } = await supabase
      .from("release_schedules")
      .select("id, released_amount, claimed_amount")
      .eq("user_id", profile.id);

    let remaining = amount;
    const deductions: Array<{ id: string; deduct: number }> = [];
    for (const s of (schedules || [])) {
      if (remaining <= 0) break;
      const claimable = Number(s.released_amount || 0) - Number(s.claimed_amount || 0);
      if (claimable > 0.0001) {
        const deduct = Math.min(claimable, remaining);
        deductions.push({ id: s.id, deduct });
        remaining -= deduct;
      }
    }

    if (remaining > 0.01) {
      return json({ error: `释放余额不足: 需要 ${amount} MA, 可用 ${(amount - remaining).toFixed(2)} MA` }, 400);
    }

    // Apply deductions
    for (const d of deductions) {
      const { data: current } = await supabase
        .from("release_schedules")
        .select("claimed_amount")
        .eq("id", d.id)
        .single();
      await supabase.from("release_schedules").update({
        claimed_amount: Number(current?.claimed_amount || 0) + d.deduct,
      }).eq("id", d.id);
    }

    // 4. Server swap USDC → USDT via PancakeSwap to user wallet
    const amountInStr = BigInt(Math.floor(usdtAmount * 1e18)).toString();
    const minOutStr = BigInt(Math.floor(usdtAmount * 0.995 * 1e18)).toString();

    const swapResult = await engineWrite(SERVER_WALLET, {
      contractAddress: PANCAKE_ROUTER,
      method: "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
      params: [[USDC, USDT, "100", walletAddress, amountInStr, minOutStr, "0"]],
    });
    const swapTxId = swapResult?.result?.transactions?.[0]?.id || "?";
    console.log("Swap TX:", swapTxId, swapResult?.error?.details?.message || "ok");

    // 5. Record transaction
    await supabase.from("transactions").insert({
      user_id: profile.id,
      type: "FLASH_SWAP",
      amount: usdtAmount,
      token: "USDT",
      status: "CONFIRMED",
      details: {
        maAmount: amount,
        maPrice,
        usdtAmount,
        swapTxId,
      },
    });

    return json({
      status: "ok",
      maAmount: amount,
      maPrice,
      usdtAmount,
      swapTxId,
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("FlashSwap error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
