import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

/**
 * V4 Fund Distribution — ARB USDC 60/20/12/8% split
 *
 * After bridge to ARB, distribute from trading wallet:
 *   60% → 0x3869 (Trading + FlashSwap reserve) — stays here
 *   20% → 0x85c3 (Investor)
 *   12% → 0x1C4D (Marketing)
 *    8% → 0xDf90 (Operations)
 *
 * 0x3869 also serves as HL deposit source:
 *   Admin can deposit to HL Vault: 0xdfc24b077bc1425ad1dea75bcb6f8158e10df303
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "";

const TRADING = "0x3869100A4F165aE9C85024A32D90C5D7412D6b9c";
const INVESTOR = "0x85c3d07Ee3be12d6502353b4cA52B30cD85Ac5ff";
const MARKETING = "0x1C4D983620B3c8c2f7607c0943f2A5989e655599";
const OPERATIONS = "0xDf90770C89732a7eba5B727fCd6a12f827102EE6";
const ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const ARB_RPC = "https://arb1.arbitrum.io/rpc";

// Distribution: 60% stays in TRADING, 20/12/8 go out
const SPLITS = [
  { name: "Investor", addr: INVESTOR, pct: 20 },
  { name: "Marketing", addr: MARKETING, pct: 12 },
  { name: "Operations", addr: OPERATIONS, pct: 8 },
  // 60% stays in TRADING wallet (no transfer needed)
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Check TRADING wallet USDC balance on ARB
    const balRes = await fetch(ARB_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", method: "eth_call", id: 1,
        params: [{
          to: ARB_USDC,
          data: "0x70a08231000000000000000000000000" + TRADING.slice(2).toLowerCase(),
        }, "latest"],
      }),
    });
    const balData = await balRes.json();
    const balance = parseInt(balData.result || "0x0", 16) / 1e6; // ARB USDC is 6 decimals

    if (balance < 100) {
      return json({ status: "skip", balance, reason: "Below $100 minimum" });
    }

    // Calculate splits (from total balance, 40% goes out)
    const total = balance;
    const distributions = SPLITS.map(s => ({
      ...s,
      amount: Math.floor(total * s.pct / 100 * 1e6) / 1e6,
    }));

    // TODO: Execute transfers via thirdweb Engine on ARB
    // For now, report what needs to be distributed
    return json({
      status: "pending_distribution",
      tradingBalance: total,
      keepInTrading: Math.floor(total * 60) / 100,
      distribute: distributions,
      note: "Execute via thirdweb Engine ARB or manually",
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
