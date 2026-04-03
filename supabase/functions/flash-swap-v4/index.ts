import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * V4 FlashSwap — Server transfer USDC to user
 *
 * 1. User transfers MA → Engine (frontend)
 * 2. This function: Server transfers equivalent USDC → user wallet
 * 3. User swaps USDC→USDT via PancakeSwap (frontend)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "";
const SERVER_WALLET = "0xe193ACcf11aBf508e8c7D0CeE03ea4E6f75B09ff";
const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
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
    const { walletAddress, maAmount, txHash } = await req.json();
    if (!walletAddress || !maAmount) return json({ error: "Missing walletAddress or maAmount" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const amount = Number(maAmount);
    if (amount <= 0) return json({ error: "Invalid amount" }, 400);

    const maPrice = await getOraclePrice();
    if (maPrice <= 0) return json({ error: "Oracle price unavailable" }, 500);

    const usdcAmount = amount * maPrice;
    const usdcWei = BigInt(Math.floor(usdcAmount * 1e18)).toString();

    console.log(`FlashSwap: ${walletAddress} | ${amount} MA × $${maPrice} = $${usdcAmount.toFixed(2)} USDC → user`);

    // Server transfers USDC to user wallet
    const transferResult = await engineWrite(SERVER_WALLET, {
      contractAddress: USDC,
      method: "function transfer(address to, uint256 amount) returns (bool)",
      params: [walletAddress, usdcWei],
    });
    const transferTxId = transferResult?.result?.transactions?.[0]?.id || "?";
    console.log("USDC Transfer TX:", transferTxId, transferResult?.error?.details?.message || "ok");

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
        amount: usdcAmount,
        token: "USDT",
        status: "CONFIRMED",
        tx_hash: txHash || null,
        details: { maAmount: amount, maPrice, usdcAmount, transferTxId },
      });
    }

    return json({ status: "ok", maAmount: amount, maPrice, usdcAmount, transferTxId });

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
