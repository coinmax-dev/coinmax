import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * V4 FlashSwap — Engine burns MA + swaps USDC→USDT to user
 *
 * Flow:
 *   1. User transfers MA to Engine wallet (frontend)
 *   2. Engine burns the MA
 *   3. Engine swaps USDC → USDT via PancakeSwap (0x92b7...3121 pool)
 *   4. USDT goes directly to user wallet
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "";
const ENGINE_WALLET = "0xDd6660E403d0242c1BeE52a4de50484AAF004446";
const SERVER_WALLET = "0xe193ACcf11aBf508e8c7D0CeE03ea4E6f75B09ff";
const MA_TOKEN = "0xc6d2dbC85DC3091C41692822A128c19F9eAc7988";
const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const PANCAKE_ROUTER = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";
const BSC_RPC = "https://bsc-dataseed1.binance.org";
const ORACLE = "0x35580292fA5c8b7110034EA1a1521952E6F42bbb";

// Engine wallet: burn MA
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
    const { walletAddress, maAmount, txHash } = await req.json();
    if (!walletAddress || !maAmount) {
      return json({ error: "Missing walletAddress or maAmount" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const amount = Number(maAmount);
    if (amount <= 0) return json({ error: "Invalid amount" }, 400);

    // Get MA price from Oracle
    const maPrice = await getOraclePrice();
    if (maPrice <= 0) return json({ error: "Oracle price unavailable" }, 500);

    // Calculate USDT output: MA amount × MA price = USD value
    const usdtAmount = amount * maPrice;
    const usdcWei = "0x" + BigInt(Math.floor(usdtAmount * 1e18)).toString(16);
    const maWei = "0x" + BigInt(Math.floor(amount * 1e18)).toString(16);

    console.log(`FlashSwap: ${walletAddress} | ${amount} MA × $${maPrice} = $${usdtAmount.toFixed(2)} USDT`);

    // Step 1: Engine wallet burns MA (received from user transfer)
    const burnResult = await engineWrite(ENGINE_WALLET, {
      contractAddress: MA_TOKEN,
      method: "function burn(uint256 amount)",
      params: [maWei],
    });
    const burnTxId = burnResult?.result?.transactions?.[0]?.id || "?";
    console.log("Burn TX:", burnTxId, burnResult?.error?.message || "ok");

    await new Promise(r => setTimeout(r, 3000));

    // Step 2: Server wallet approves USDC to PancakeSwap Router
    const approveResult = await engineWrite(SERVER_WALLET, {
      contractAddress: USDC,
      method: "function approve(address spender, uint256 amount) returns (bool)",
      params: [PANCAKE_ROUTER, usdcWei],
    });
    const approveTxId = approveResult?.result?.transactions?.[0]?.id || "?";
    console.log("Approve TX:", approveTxId);

    await new Promise(r => setTimeout(r, 3000));

    // Step 3: Server wallet swaps USDC → USDT via PancakeSwap, USDT to user wallet
    const minOut = "0x" + BigInt(Math.floor(usdtAmount * 0.995 * 1e18)).toString(16);
    const swapResult = await engineWrite(SERVER_WALLET, {
      contractAddress: PANCAKE_ROUTER,
      method: "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)",
      params: [{
        tokenIn: USDC,
        tokenOut: USDT,
        fee: 100,
        recipient: walletAddress,
        amountIn: usdcWei,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: "0",
      }],
    });
    const swapTxId = swapResult?.result?.transactions?.[0]?.id || "?";
    console.log("Swap TX:", swapTxId, swapResult?.error?.message || "ok");

    // Record transaction
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .ilike("wallet_address", walletAddress)
      .single();

    if (profile) {
      await supabase.from("transactions").insert({
        user_id: profile.id,
        type: "FLASH_SWAP",
        amount: usdtAmount,
        token: "USDT",
        status: "CONFIRMED",
        tx_hash: txHash || null,
        details: {
          maAmount: amount,
          maPrice,
          usdtAmount,
          burnTxId,
          swapTxId,
        },
      });
    }

    return json({
      status: "ok",
      maAmount: amount,
      maPrice,
      usdtAmount,
      burnTxId,
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
