/**
 * Distribute Revenue Edge Function
 *
 * Handles ALL revenue distribution via database — no on-chain contract needed.
 *
 * Two modes:
 *   1. record-yield:  Platform records yield from HyperLiquid (manual trigger)
 *   2. distribute:    Compute per-user shares and create claimable records (cron or manual)
 *   3. claim:         User claims their revenue (called from frontend)
 *   4. stats:         Get distribution stats
 *
 * Flow:
 *   Platform bridges yield back from HL
 *   → POST /distribute-revenue { action: "record-yield", amount, period }
 *   → POST /distribute-revenue { action: "distribute", yieldId }
 *   → User calls { action: "claim", userId }
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
    const { action } = body;

    switch (action) {
      // ── 1. Record yield from HyperLiquid ──────────────────────
      case "record-yield": {
        const { amount, periodStart, periodEnd, trades, winRate } = body;
        if (!amount || amount <= 0) {
          return jsonResponse({ error: "amount required and must be > 0" }, 400);
        }

        const protocolFee = amount * 0.10; // 10% leader fee (HyperLiquid vault leader)
        const netYield = amount - protocolFee;

        const { data, error } = await supabase.from("treasury_yields").insert({
          gross_yield: amount,
          protocol_fee: protocolFee,
          net_yield: netYield,
          period_start: periodStart || new Date().toISOString(),
          period_end: periodEnd || new Date().toISOString(),
          trades_executed: trades || 0,
          win_rate: winRate || 0,
          distributed: false,
        }).select().single();

        if (error) return jsonResponse({ error: error.message }, 500);

        await supabase.from("treasury_events").insert({
          event_type: "YIELD_RECORDED",
          details: { yield_id: data.id, gross: amount, fee: protocolFee, net: netYield },
        });

        return jsonResponse({
          success: true,
          yieldId: data.id,
          gross: amount,
          protocolFee,
          netYield,
        });
      }

      // ── 2. Distribute to users ────────────────────────────────
      case "distribute": {
        const { yieldId } = body;

        // Get yield record
        let yieldQuery = supabase.from("treasury_yields").select("*");
        if (yieldId) {
          yieldQuery = yieldQuery.eq("id", yieldId);
        } else {
          yieldQuery = yieldQuery.eq("distributed", false).order("created_at", { ascending: false }).limit(1);
        }
        const { data: yieldEntry, error: yieldErr } = await yieldQuery.single();

        if (yieldErr || !yieldEntry) {
          return jsonResponse({ message: "No yield to distribute" });
        }

        if (yieldEntry.distributed) {
          return jsonResponse({ message: "Already distributed", yieldId: yieldEntry.id });
        }

        const netYield = yieldEntry.net_yield;
        if (netYield <= 0) {
          await supabase.from("treasury_yields")
            .update({ distributed: true, user_count: 0 })
            .eq("id", yieldEntry.id);
          return jsonResponse({ message: "No positive yield", netYield });
        }

        // Get active node holders
        const { data: nodeHolders } = await supabase
          .from("node_memberships")
          .select("user_id, node_type, frozen_amount, daily_rate, start_date")
          .in("status", ["ACTIVE", "PENDING_MILESTONES"]);

        // Get active vault depositors
        const { data: vaultDepositors } = await supabase
          .from("vault_deposits")
          .select("user_id, deposit_amount, interest_rate, deposit_date")
          .eq("status", "ACTIVE");

        // Compute weights
        const now = Date.now();
        const users: Array<{
          userId: string;
          type: string;
          principal: number;
          rate: number;
          days: number;
          weight: number;
        }> = [];

        for (const n of (nodeHolders || [])) {
          const days = Math.max(1, Math.floor((now - new Date(n.start_date).getTime()) / 86400000));
          const weight = (n.frozen_amount || 0) * (n.daily_rate || 0) * days;
          if (weight > 0) {
            users.push({
              userId: n.user_id, type: "NODE",
              principal: n.frozen_amount || 0, rate: n.daily_rate || 0, days, weight,
            });
          }
        }

        for (const v of (vaultDepositors || [])) {
          const days = Math.max(1, Math.floor((now - new Date(v.deposit_date).getTime()) / 86400000));
          const weight = (v.deposit_amount || 0) * (v.interest_rate || 0) * days;
          if (weight > 0) {
            users.push({
              userId: v.user_id, type: "VAULT",
              principal: v.deposit_amount || 0, rate: v.interest_rate || 0, days, weight,
            });
          }
        }

        const totalWeight = users.reduce((s, u) => s + u.weight, 0);
        if (totalWeight === 0) {
          await supabase.from("treasury_yields")
            .update({ distributed: true, user_count: 0 })
            .eq("id", yieldEntry.id);
          return jsonResponse({ message: "No eligible users" });
        }

        // Create claims
        const claims = users.map(u => ({
          user_id: u.userId,
          yield_id: yieldEntry.id,
          contribution_type: u.type,
          principal: u.principal,
          weight: u.weight,
          share_pct: u.weight / totalWeight,
          amount: Math.floor((u.weight / totalWeight) * netYield * 100) / 100, // round to 2 decimals
          status: "CLAIMABLE",
        }));

        const { error: insertErr } = await supabase.from("revenue_claims").insert(claims);
        if (insertErr) return jsonResponse({ error: insertErr.message }, 500);

        // Mark distributed
        await supabase.from("treasury_yields")
          .update({ distributed: true, user_count: users.length })
          .eq("id", yieldEntry.id);

        await supabase.from("treasury_events").insert({
          event_type: "REVENUE_DISTRIBUTED",
          details: {
            yield_id: yieldEntry.id, net_yield: netYield,
            user_count: users.length, total_weight: totalWeight,
          },
        });

        return jsonResponse({
          success: true,
          yieldId: yieldEntry.id,
          netYield,
          userCount: users.length,
        });
      }

      // ── 3. User claims revenue ────────────────────────────────
      case "claim": {
        const { userId } = body;
        if (!userId) return jsonResponse({ error: "userId required" }, 400);

        const { data: claimable } = await supabase
          .from("revenue_claims")
          .select("id, amount")
          .eq("user_id", userId)
          .eq("status", "CLAIMABLE");

        if (!claimable || claimable.length === 0) {
          return jsonResponse({ message: "Nothing to claim", amount: 0 });
        }

        const totalAmount = claimable.reduce((s, c) => s + c.amount, 0);
        const claimIds = claimable.map(c => c.id);

        // Mark as claimed
        await supabase.from("revenue_claims")
          .update({ status: "CLAIMED", claimed_at: new Date().toISOString() })
          .in("id", claimIds);

        // Add to user's available balance
        await supabase.rpc("add_available_balance", {
          p_user_id: userId,
          p_amount: totalAmount,
        });

        // Record transaction
        await supabase.from("transactions").insert({
          user_id: userId,
          type: "REVENUE_CLAIM",
          token: "USDT",
          amount: totalAmount,
          status: "CONFIRMED",
          details: { claim_count: claimIds.length, source: "hl_strategy_yield" },
        });

        await supabase.from("treasury_events").insert({
          event_type: "USER_CLAIMED",
          details: { user_id: userId, amount: totalAmount, claims: claimIds.length },
        });

        return jsonResponse({
          success: true,
          amount: totalAmount,
          claims: claimIds.length,
        });
      }

      // ── 4. Stats ──────────────────────────────────────────────
      case "stats": {
        const { userId } = body;

        // Global stats
        const { data: yields } = await supabase
          .from("treasury_yields")
          .select("gross_yield, net_yield, protocol_fee, user_count, created_at")
          .order("created_at", { ascending: false })
          .limit(10);

        const totalGross = (yields || []).reduce((s, y) => s + y.gross_yield, 0);
        const totalNet = (yields || []).reduce((s, y) => s + y.net_yield, 0);

        let userStats = null;
        if (userId) {
          const { data: userClaims } = await supabase
            .from("revenue_claims")
            .select("amount, status, created_at")
            .eq("user_id", userId);

          const claimable = (userClaims || [])
            .filter(c => c.status === "CLAIMABLE")
            .reduce((s, c) => s + c.amount, 0);
          const claimed = (userClaims || [])
            .filter(c => c.status === "CLAIMED")
            .reduce((s, c) => s + c.amount, 0);

          userStats = { claimable, claimed, totalEarned: claimable + claimed };
        }

        return jsonResponse({
          totalGrossYield: totalGross,
          totalNetYield: totalNet,
          recentYields: yields,
          userStats,
        });
      }

      default:
        return jsonResponse({ error: "Invalid action. Use: record-yield, distribute, claim, stats" }, 400);
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
