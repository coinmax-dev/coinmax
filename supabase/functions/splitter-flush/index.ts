/**
 * Splitter Flush — Distribute accumulated USDC to configured wallets
 *
 * Calls Splitter.flush() via thirdweb Server Wallet.
 * Can be triggered manually from admin or via cron.
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "EwFZ-cz8maTnDHEukynx4UgOx_0oqeqg1qR1gx2cHIM0L-Nks5ogM0U7JhZGQMyg3489Tc42J_QSZ9rLGojFSQ";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "vt_act_B6LKUWDDFVRRESRTNN2OYYYKTOCLDEAYSVFMSYI6A4L47R4ENX26GDBYUVCAGT2WVMNWCQNQWXOR6AFXILSR2DFIJAH3AM5QG4ERZIPV";
const EOA_WALLET = "0xDd6660E403d0242c1BeE52a4de50484AAF004446";
const SPLITTER_ADDRESS = "0xcfF14557337368E4A9E09586B0833C5Bbf323845";
const USDC_ADDRESS = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const BSC_RPC = "https://bsc-dataseed1.binance.org";

async function getBalance(): Promise<number> {
  const data = "0x70a08231000000000000000000000000" + SPLITTER_ADDRESS.slice(2).toLowerCase();
  const res = await fetch(BSC_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", id: 1, params: [{ to: USDC_ADDRESS, data }, "latest"] }),
  });
  const r = await res.json();
  return parseInt(r.result || "0x0", 16) / 1e18;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const balance = await getBalance();

    if (balance < 1) {
      return new Response(JSON.stringify({
        status: "skipped",
        reason: `Balance too low: $${balance.toFixed(4)} USDC`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Call flush() via EOA Wallet
    const res = await fetch("https://engine.thirdweb.com/v1/write/contract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-secret-key": THIRDWEB_SECRET,
        "x-vault-access-token": VAULT_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        executionOptions: { type: "EOA", from: EOA_WALLET, chainId: "56" },
        params: [{
          contractAddress: SPLITTER_ADDRESS,
          method: "function flush()",
          params: [],
        }],
      }),
    });

    const data = await res.json();
    const txId = data?.result?.transactionIds?.[0] || null;

    return new Response(JSON.stringify({
      status: txId ? "flushed" : "failed",
      balance: `$${balance.toFixed(4)} USDC`,
      txId,
      error: data?.error || null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
