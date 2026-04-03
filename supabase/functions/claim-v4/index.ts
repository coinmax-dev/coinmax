import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * V4 Claim — 提现 (纯 DB, 不触发链上)
 *
 * 1. 用户选择提现金额 + 分成比例 (A/B/C/D/E)
 * 2. 计算销毁比例 + 释放天数
 * 3. DB 创建 release_schedule
 *    - 即时(E): released_amount = total (待释放余额立刻可领)
 *    - 线性(A-D): released_amount = 0, 每日 settle 递增
 * 4. 用户在"一键释放"时才触发 Engine 铸造到钱包
 *
 * Split Ratios:
 *   A: 0% burn, 60天释放
 *   B: 5% burn, 30天释放
 *   C: 10% burn, 15天释放
 *   D: 15% burn, 7天释放
 *   E: 20% burn, 即时释放
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
    const { walletAddress, amount, splitRatio } = await req.json();
    if (!walletAddress || !amount || !splitRatio) {
      return json({ error: "Missing walletAddress, amount, or splitRatio" }, 400);
    }

    const ratio = SPLIT_RATIOS[splitRatio];
    if (!ratio) return json({ error: "Invalid splitRatio (A/B/C/D/E)" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Validate user
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .ilike("wallet_address", walletAddress)
      .single();
    if (!profile) return json({ error: "Profile not found" }, 404);

    const claimAmount = Number(amount);
    if (claimAmount <= 0) return json({ error: "Invalid amount" }, 400);

    // 2. Calculate
    const burnAmount = claimAmount * ratio.burnPct / 100;
    const releaseAmount = claimAmount - burnAmount;
    const dailyRelease = ratio.releaseDays > 0 ? releaseAmount / ratio.releaseDays : releaseAmount;

    console.log(`Claim: ${walletAddress} | total:${claimAmount} burn:${burnAmount} release:${releaseAmount} over ${ratio.releaseDays}d`);

    // 3. Create release schedule (DB only — no on-chain)
    const now = new Date();
    const isInstant = ratio.releaseDays === 0;
    const endDate = isInstant ? now : new Date(now.getTime() + ratio.releaseDays * 86400000);

    await supabase.from("release_schedules").insert({
      user_id: profile.id,
      wallet_address: walletAddress,
      total_amount: releaseAmount,
      daily_amount: dailyRelease,
      // Instant: fully released immediately; Linear: starts at 0
      released_amount: isInstant ? releaseAmount : 0,
      remaining_amount: isInstant ? 0 : releaseAmount,
      claimed_amount: 0,
      days_total: isInstant ? 0 : ratio.releaseDays,
      days_released: isInstant ? 0 : 0,
      split_ratio: splitRatio,
      burn_amount: burnAmount,
      start_date: now.toISOString(),
      end_date: endDate.toISOString(),
      status: isInstant ? "COMPLETED" : "ACTIVE",
    });

    // 4. Record in transactions history
    await supabase.from("transactions").insert({
      user_id: profile.id,
      type: "MA_CLAIM",
      amount: claimAmount,
      token: "MA",
      status: "CONFIRMED",
      details: {
        splitRatio,
        burnPct: ratio.burnPct,
        burnAmount,
        releaseAmount,
        releaseDays: ratio.releaseDays,
        dailyRelease,
        schedule: isInstant ? "instant" : "linear_release",
      },
    });

    return json({
      status: "claimed",
      total: claimAmount,
      burned: burnAmount,
      released: releaseAmount,
      releaseDays: ratio.releaseDays,
      dailyRelease,
      note: isInstant
        ? `${releaseAmount.toFixed(2)} MA 即时待释放，点击一键释放领取`
        : `${releaseAmount.toFixed(2)} MA 将在 ${ratio.releaseDays} 天内释放 (${dailyRelease.toFixed(4)} MA/天)`,
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
