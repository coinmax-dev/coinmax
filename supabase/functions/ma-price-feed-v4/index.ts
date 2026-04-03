import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

/**
 * V4 MA Price Feed — Push price to Oracle via Engine
 * Cron: every 5 minutes
 *
 * Oracle: 0x35580292fA5c8b7110034EA1a1521952E6F42bbb
 * Engine: 0xDd6660E403d0242c1BeE52a4de50484AAF004446
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "";
const ENGINE_WALLET = "0xDd6660E403d0242c1BeE52a4de50484AAF004446";
const ORACLE = "0x35580292fA5c8b7110034EA1a1521952E6F42bbb";
const BSC_RPC = "https://bsc-dataseed1.binance.org";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Read current on-chain price
    const res = await fetch(BSC_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", method: "eth_call", id: 1,
        params: [{ to: ORACLE, data: "0x98d5fdca" /* getPrice() */ }, "latest"],
      }),
    });
    const d = await res.json();
    const currentPrice = parseInt(d.result || "0x0", 16) / 1e6;

    // V4 Oracle is formula-based (backing + appreciation + floor)
    // Price feed only needed if using manualPrice override
    // For now, just report the current formula-derived price

    return json({
      status: "ok",
      currentPrice,
      oracle: ORACLE,
      mode: "formula", // V4 uses on-chain formula, no manual feed needed
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
