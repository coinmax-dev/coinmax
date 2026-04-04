/**
 * Vault Record — Records vault deposit to DB after on-chain tx success
 *
 * Called by frontend after Gateway.depositVault() confirms on-chain.
 * Creates vault_positions + transactions records.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const { walletAddress, txHash, planType, principal, dailyRate, days, maPrice, maMinted } = body;

    if (!walletAddress || !txHash || !planType || !principal) {
      return json({ error: "Missing: walletAddress, txHash, planType, principal" }, 400);
    }

    // Check duplicate tx
    const { data: dup } = await supabase
      .from("transactions")
      .select("id")
      .eq("tx_hash", txHash)
      .limit(1);
    if (dup && dup.length > 0) {
      return json({ error: "Transaction already recorded" }, 400);
    }

    // Get or create profile
    let { data: profile } = await supabase
      .from("profiles")
      .select("id, total_deposited")
      .ilike("wallet_address", walletAddress)
      .single();

    if (!profile) {
      const { data: newP } = await supabase
        .from("profiles")
        .insert({ wallet_address: walletAddress })
        .select("id, total_deposited")
        .single();
      profile = newP;
    }

    if (!profile) {
      return json({ error: "Failed to get/create profile" }, 500);
    }

    const now = new Date();
    const endDate = new Date(now.getTime() + (days || 30) * 86400_000);

    // 1. Insert vault_positions
    const { error: vpErr } = await supabase.from("vault_positions").insert({
      user_id: profile.id,
      plan_type: planType,
      principal: principal,
      daily_rate: dailyRate || 0.005,
      start_date: now.toISOString().split("T")[0],
      end_date: endDate.toISOString().split("T")[0],
      status: "ACTIVE",
    });

    if (vpErr) {
      return json({ error: `vault_positions: ${vpErr.message}` }, 500);
    }

    // 2. Insert transaction record
    const { error: txErr } = await supabase.from("transactions").insert({
      user_id: profile.id,
      type: "VAULT_DEPOSIT",
      token: "USDT",
      amount: principal,
      tx_hash: txHash,
      status: "COMPLETED",
      details: {
        plan: planType,
        days,
        daily_rate: dailyRate,
        ma_price: maPrice,
        ma_minted: maMinted,
      },
    });

    if (txErr) {
      console.error("Transaction insert error:", txErr);
      // Non-critical — vault position already created
    }

    // 3. Update total_deposited
    const newTotal = Number(profile.total_deposited || 0) + Number(principal);
    await supabase
      .from("profiles")
      .update({ total_deposited: newTotal })
      .eq("id", profile.id);

    // 4. Check node activation based on new vault deposit
    const { data: activationResult } = await supabase.rpc("check_node_activation", {
      addr: walletAddress,
    });

    // 5. Check rank promotion
    const { data: rankResult } = await supabase.rpc("check_rank_promotion", {
      addr: walletAddress,
    });

    // 6. Check bonus yield unlock (if user has bonus and deposits ≥100U on qualifying plan)
    await supabase.rpc("check_bonus_yield_unlock", { p_user_id: profile.id });

    // 7. Auto-flush Splitter to distribute funds to configured wallets
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/splitter-flush`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
      });
    } catch { /* non-critical */ }

    return json({
      success: true,
      vaultPosition: { planType, principal, days, endDate: endDate.toISOString() },
      activation: activationResult,
      rank: rankResult,
      message: `${principal} USDT 存入记录已保存`,
    });

  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
