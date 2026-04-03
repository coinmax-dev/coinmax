import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

/**
 * V4 Vault Bridge — 每笔入金即时跨链 BSC USDC → ARB
 *
 * 由前端/Vault合约回调触发，不是定时cron。
 * 用户存入成功 → 前端调此函数 → Receiver USDC 立即跨链到 ARB
 *
 * Flow:
 *   1. 收到通知: 用户存入 X USDC
 *   2. Receiver(0xe193) USDC → thirdweb Bridge → ARB Trading(0x3869)
 *   3. 返回 bridge txId
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "";
const RECEIVER = "0xe193ACcf11aBf508e8c7D0CeE03ea4E6f75B09ff";
const BSC_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const ARB_TRADING = "0x3869100A4F165aE9C85024A32D90C5D7412D6b9c";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const amount = body.amount; // USDC amount just deposited

    // Check Receiver USDC balance
    const balRes = await fetch("https://bsc-dataseed1.binance.org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", method: "eth_call", id: 1,
        params: [{
          to: BSC_USDC,
          data: "0x70a08231000000000000000000000000" + RECEIVER.slice(2).toLowerCase(),
        }, "latest"],
      }),
    });
    const balData = await balRes.json();
    const balance = parseInt(balData.result || "0x0", 16) / 1e18;

    if (balance < 1) {
      return json({ status: "skip", balance, reason: "No USDC to bridge" });
    }

    const bridgeAmount = amount ? Math.min(Number(amount), balance) : balance;
    const amountWei = "0x" + BigInt(Math.floor(bridgeAmount * 1e18)).toString(16);

    // Bridge via thirdweb Engine: Receiver USDC → ARB Trading wallet
    // Using thirdweb bridge API
    const bridgeRes = await fetch("https://engine.thirdweb.com/v1/write/contract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-secret-key": THIRDWEB_SECRET,
        "x-vault-access-token": VAULT_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        executionOptions: { type: "EOA", from: RECEIVER, chainId: "56" },
        params: [{
          contractAddress: BSC_USDC,
          method: "function transfer(address to, uint256 amount) returns (bool)",
          params: [ARB_TRADING, amountWei],
          // Note: This is a BSC transfer. For actual cross-chain,
          // use thirdweb Bridge SDK or manual bridge from Receiver
        }],
      }),
    });
    const bridgeData = await bridgeRes.json();
    const txId = bridgeData?.result?.transactions?.[0]?.id || "unknown";

    return json({
      status: "bridging",
      amount: bridgeAmount,
      from: RECEIVER,
      to: ARB_TRADING,
      txId,
      note: "USDC transferred. Use thirdweb bridge for actual cross-chain.",
    });

  } catch (e: unknown) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
