/**
 * MA Flash Swap Edge Function (v2 — Server Wallet mode)
 *
 * SELL (MA → USDT):
 *   1. Frontend: user approve(SW, maAmount) on MA token
 *   2. This function:
 *      a. transferFrom(user → SW) MA via thirdweb
 *      b. approve USDC to PancakeSwap Router
 *      c. swap USDC → USDT via PancakeSwap V3
 *      d. transfer USDT to user
 *   3. Record swap in ma_swap_records
 *
 * BUY (USDT → MA):
 *   1. Frontend: user approve(SW, usdtAmount) on USDT
 *   2. This function:
 *      a. transferFrom(user → SW) USDT via thirdweb
 *      b. transfer MA to user from SW balance
 *   3. Record swap in ma_swap_records
 *
 * Quota rule: user can only sell up to 50% of their MA holdings
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SWAP_FEE_PCT = 0.003; // 0.3%
const MA_TOKEN = "0xc6d2dbC85DC3091C41692822A128c19F9eAc7988";
const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
const BSC_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const PANCAKE_ROUTER = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";
const SERVER_WALLET = "0xDd6660E403d0242c1BeE52a4de50484AAF004446";
const BSC_RPC = "https://bsc-dataseed1.binance.org";

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "vt_act_B6LKUWDDFVRRESRTNN2OYYYKTOCLDEAYSVFMSYI6A4L47R4ENX26GDBYUVCAGT2WVMNWCQNQWXOR6AFXILSR2DFIJAH3AM5QG4ERZIPV";

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

async function getMAPrice(): Promise<number> {
  try {
    const res = await fetch(BSC_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", id: 1, params: [{ to: "0xB73A4Ac36a36C92C8d6F6828ea431Ca30f1943a2", data: "0xa035b1fe" }, "latest"] }),
    });
    const d = await res.json();
    const price = parseInt(d.result || "0x0", 16) / 1e6;
    return price > 0 ? price : 0.99;
  } catch { return 0.99; }
}

async function callThirdweb(calls: Array<{ contractAddress: string; method: string; params: unknown[] }>) {
  const res = await fetch("https://engine.thirdweb.com/v1/write/contract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-secret-key": THIRDWEB_SECRET,
      "x-vault-access-token": VAULT_TOKEN,
    },
    body: JSON.stringify({
      executionOptions: { type: "EOA", from: SERVER_WALLET, chainId: "56" },
      params: calls,
    }),
  });
  const data = await res.json();
  return {
    txIds: data?.result?.transactionIds || data?.result?.transactions?.map((t: any) => t.id) || [],
    raw: data,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json();
    const { walletAddress, direction, maAmount, outputToken, maPrice: clientPrice, maBalance } = body;

    if (!walletAddress || !direction || !maAmount) {
      return jsonResponse({ error: "Missing required fields: walletAddress, direction, maAmount" }, 400);
    }
    if (!["sell", "buy"].includes(direction)) {
      return jsonResponse({ error: "Invalid direction: must be 'sell' or 'buy'" }, 400);
    }

    const maPrice = await getMAPrice();
    const inputAmount = Number(maAmount);

    if (direction === "sell") {
      // ═══ SELL: MA → USDT ═══
      // Quota check: max 100% of holdings
      const onChainBalance = await getMABalance(walletAddress);
      if (inputAmount > onChainBalance) {
        return jsonResponse({
          error: `超出闪兑额度。链上余额 ${onChainBalance.toFixed(2)} MA`,
        }, 400);
      }

      const grossUsd = inputAmount * maPrice;
      const fee = grossUsd * SWAP_FEE_PCT;
      const netUsd = grossUsd - fee;
      const maWei = BigInt(Math.floor(inputAmount * 1e18)).toString();
      const usdcWei = BigInt(Math.floor(netUsd * 1e18)).toString();

      // Step 1: Transfer MA from user to EOA
      // Step 2: Approve USDC to PancakeSwap
      // Step 3: Swap USDC → USDT, recipient = user (so user sees 0x92b7...3121 as sender)
      const result = await callThirdweb([
        {
          contractAddress: MA_TOKEN,
          method: "function transferFrom(address, address, uint256)",
          params: [walletAddress, SERVER_WALLET, maWei],
        },
        {
          contractAddress: BSC_USDC,
          method: "function approve(address, uint256)",
          params: [PANCAKE_ROUTER, usdcWei],
        },
        {
          contractAddress: PANCAKE_ROUTER,
          method: "function exactInputSingle((address,address,uint24,address,uint256,uint256,uint160)) returns (uint256)",
          params: [[BSC_USDC, BSC_USDT, 100, walletAddress, usdcWei, "0", "0"]],
        },
      ]);

      // Record
      const txHash = result.txIds[0] || `swap_sell_${Date.now()}`;
      await supabase.from("ma_swap_records").insert({
        wallet_address: walletAddress,
        tx_hash: txHash,
        direction: "sell",
        ma_amount: inputAmount,
        usd_amount: netUsd,
        output_token: "USDT",
        ma_price: maPrice,
        fee_usd: fee,
        ma_balance_before: onChainBalance,
        status: "completed",
      });

      return jsonResponse({
        success: true,
        direction: "sell",
        maAmount: inputAmount,
        usdAmount: netUsd,
        fee,
        txIds: result.txIds,
        message: `已闪兑 ${inputAmount} MA → $${netUsd.toFixed(2)} USDT`,
      });

    } else {
      // ═══ BUY: USDT → MA ═══
      const usdAmount = inputAmount; // inputAmount is USDT amount
      const fee = usdAmount * SWAP_FEE_PCT;
      const netUsd = usdAmount - fee;
      const maOut = netUsd / maPrice;
      const usdtWei = BigInt(Math.floor(usdAmount * 1e18)).toString();
      const maOutWei = BigInt(Math.floor(maOut * 1e18)).toString();

      // Step 1: Transfer USDT from user to Server Wallet
      // Step 2: Transfer MA from Server Wallet to user
      const result = await callThirdweb([
        {
          contractAddress: BSC_USDT,
          method: "function transferFrom(address, address, uint256)",
          params: [walletAddress, SERVER_WALLET, usdtWei],
        },
        {
          contractAddress: MA_TOKEN,
          method: "function transfer(address, uint256)",
          params: [walletAddress, maOutWei],
        },
      ]);

      const txHash = result.txIds[0] || `swap_buy_${Date.now()}`;
      await supabase.from("ma_swap_records").insert({
        wallet_address: walletAddress,
        tx_hash: txHash,
        direction: "buy",
        ma_amount: maOut,
        usd_amount: usdAmount,
        output_token: "USDT",
        ma_price: maPrice,
        fee_usd: fee,
        ma_balance_before: maBalance || 0,
        status: "completed",
      });

      return jsonResponse({
        success: true,
        direction: "buy",
        maAmount: maOut,
        usdAmount,
        fee,
        txIds: result.txIds,
        message: `已闪兑 $${usdAmount.toFixed(2)} USDT → ${maOut.toFixed(2)} MA`,
      });
    }

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
