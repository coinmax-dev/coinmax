import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * V4 Redeem — 金库赎回 (纯 DB, 不触发链上)
 *
 * 赎回 = 关闭 position + 创建 release_schedule
 * 链上铸造由 mint-release 一键释放处理
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SPLIT_RATIOS: Record<string, { burnPct: number; releaseDays: number }> = {
  A: { burnPct: 0, releaseDays: 60 },
  B: { burnPct: 5, releaseDays: 30 },
  C: { burnPct: 10, releaseDays: 15 },
  D: { burnPct: 15, releaseDays: 7 },
  E: { burnPct: 20, releaseDays: 0 },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { walletAddress, positionId, splitRatio } = await req.json();
    if (!walletAddress || !positionId || !splitRatio) {
      return json({ error: "Missing walletAddress, positionId, or splitRatio" }, 400);
    }

    const ratio = SPLIT_RATIOS[splitRatio];
    if (!ratio) return json({ error: "Invalid splitRatio (A/B/C/D/E)" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Validate user & position
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .ilike("wallet_address", walletAddress)
      .single();
    if (!profile) return json({ error: "Profile not found" }, 404);

    const { data: position } = await supabase
      .from("vault_positions")
      .select("*")
      .eq("id", positionId)
      .eq("user_id", profile.id)
      .single();
    if (!position) return json({ error: "Position not found" }, 404);

    if (position.status !== "ACTIVE" && position.status !== "MATURED") {
      return json({ error: `Position status ${position.status} cannot be redeemed` }, 400);
    }
    if (position.is_bonus || position.plan_type === "BONUS_5D") {
      return json({ error: "Cannot redeem bonus positions" }, 400);
    }

    const isMatured = position.status === "MATURED";

    // 2. Calculate accumulated yield
    const { data: rewards } = await supabase
      .from("vault_rewards")
      .select("ar_amount")
      .eq("user_id", profile.id)
      .eq("position_id", positionId);

    const accumulatedMA = (rewards || []).reduce((s: number, r: any) => s + Number(r.ar_amount || 0), 0);

    // 3. Calculate burn/release
    const burnAmount = accumulatedMA * ratio.burnPct / 100;
    const releaseAmount = accumulatedMA - burnAmount;
    const dailyRelease = ratio.releaseDays > 0 ? releaseAmount / ratio.releaseDays : releaseAmount;
    const isInstant = ratio.releaseDays === 0;

    console.log(`Redeem: ${walletAddress} pos:${positionId} | MA:${accumulatedMA.toFixed(2)} burn:${burnAmount.toFixed(2)} release:${releaseAmount.toFixed(2)} | ${isMatured ? "matured" : "early"}`);

    // 4. Create release schedule (DB only)
    if (releaseAmount > 0) {
      const now = new Date();
      const endDate = isInstant ? now : new Date(now.getTime() + ratio.releaseDays * 86400000);

      await supabase.from("release_schedules").insert({
        user_id: profile.id,
        wallet_address: walletAddress,
        total_amount: releaseAmount,
        daily_amount: dailyRelease,
        released_amount: isInstant ? releaseAmount : 0,
        remaining_amount: isInstant ? 0 : releaseAmount,
        claimed_amount: 0,
        days_total: isInstant ? 0 : ratio.releaseDays,
        days_released: 0,
        split_ratio: splitRatio,
        burn_amount: burnAmount,
        start_date: now.toISOString(),
        end_date: endDate.toISOString(),
        status: isInstant ? "COMPLETED" : "ACTIVE",
      });
    }

    // 5. Close position
    await supabase.from("vault_positions").update({
      status: "REDEEMED",
    }).eq("id", positionId);

    // 6. Record transaction
    await supabase.from("transactions").insert({
      user_id: profile.id,
      type: "VAULT_REDEEM",
      amount: accumulatedMA,
      token: "MA",
      status: "CONFIRMED",
      details: {
        positionId,
        isEarly: !isMatured,
        splitRatio,
        burnPct: ratio.burnPct,
        burnAmount,
        releaseAmount,
        releaseDays: ratio.releaseDays,
        dailyRelease,
      },
    });

    return json({
      status: "redeemed",
      positionId,
      isEarly: !isMatured,
      total: accumulatedMA,
      burned: burnAmount,
      released: releaseAmount,
      releaseDays: ratio.releaseDays,
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
