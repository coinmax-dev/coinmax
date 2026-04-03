import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * V4 Daily Settlement — Cron 12:00 SGT (04:00 UTC)
 *
 * 1. DB: settle vault yields + node yields + team commissions
 * 2. Chain: VaultV4.settleYield() → mint cUSD interest + mint MA → Release
 * 3. Chain: Oracle price update (optional)
 *
 * Contracts:
 *   VaultV4:  0x08a24206b7AcAA7cf68E8a5bE16fE6cE7a4D1744
 *   Engine:   0xDd6660E403d0242c1BeE52a4de50484AAF004446
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "";
const ENGINE_WALLET = "0xDd6660E403d0242c1BeE52a4de50484AAF004446";
const VAULT_V4 = "0x08a24206b7AcAA7cf68E8a5bE16fE6cE7a4D1744";

async function engineWrite(calls: Array<{ contractAddress: string; method: string; params: unknown[] }>) {
  const res = await fetch("https://engine.thirdweb.com/v1/write/contract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-secret-key": THIRDWEB_SECRET,
      "x-vault-access-token": VAULT_ACCESS_TOKEN,
    },
    body: JSON.stringify({
      executionOptions: { type: "EOA", from: ENGINE_WALLET, chainId: "56" },
      params: calls,
    }),
  });
  return res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Step 1: DB settlement (vault + node + commission)
    const { data: dbResult, error: dbErr } = await supabase.rpc("run_daily_settlement");
    if (dbErr) throw new Error("DB settlement failed: " + dbErr.message);
    console.log("DB settlement:", JSON.stringify(dbResult));

    // Step 2: Collect yield data for on-chain settlement
    // Get today's vault_rewards grouped by user
    const todayStart = new Date();
    todayStart.setUTCHours(todayStart.getUTCHours() - 1); // look back 1hr
    const { data: rewards } = await supabase
      .from("vault_rewards")
      .select("user_id, amount, ar_amount, ar_price")
      .gte("created_at", todayStart.toISOString())
      .order("user_id");

    if (!rewards || rewards.length === 0) {
      return json({ status: "settled_db_only", dbResult, onchain: "no rewards to mint" });
    }

    // Aggregate by user
    const userMap: Record<string, { cusdYield: number; maAmount: number; wallet: string }> = {};
    for (const r of rewards) {
      if (!userMap[r.user_id]) userMap[r.user_id] = { cusdYield: 0, maAmount: 0, wallet: "" };
      userMap[r.user_id].cusdYield += Number(r.amount || 0);
      userMap[r.user_id].maAmount += Number(r.ar_amount || 0);
    }

    // Get wallet addresses
    const userIds = Object.keys(userMap);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, wallet_address")
      .in("id", userIds);

    const users: string[] = [];
    const cusdYields: string[] = [];
    const maAmounts: string[] = [];

    for (const p of profiles || []) {
      const u = userMap[p.id];
      if (!u || u.cusdYield <= 0) continue;
      users.push(p.wallet_address);
      cusdYields.push("0x" + BigInt(Math.floor(u.cusdYield * 1e18)).toString(16));
      maAmounts.push("0x" + BigInt(Math.floor(u.maAmount * 1e18)).toString(16));
    }

    if (users.length === 0) {
      return json({ status: "settled_db_only", dbResult });
    }

    // Step 3: On-chain: VaultV4.settleYield(users, cusdYields, maAmounts)
    console.log(`Settling on-chain: ${users.length} users`);
    const txResult = await engineWrite([{
      contractAddress: VAULT_V4,
      method: "function settleYield(address[] users, uint256[] cusdYields, uint256[] maAmounts)",
      params: [users, cusdYields, maAmounts],
    }]);

    const txId = txResult?.result?.transactions?.[0]?.id || "unknown";
    console.log("On-chain TX:", txId);

    return json({
      status: "settled",
      db: dbResult,
      onchain: { users: users.length, txId },
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Settlement error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
