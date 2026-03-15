/**
 * Weight Adjustment Cron Function
 *
 * Phase 6.2: Hourly cron job to recalculate model weights
 * based on recent prediction accuracy.
 *
 * Trigger: pg_cron every hour OR manual POST call
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

    const now = new Date();
    const since7d = new Date(now.getTime() - 7 * 86400_000).toISOString();
    const since30d = new Date(now.getTime() - 30 * 86400_000).toISOString();

    // 1. Fetch all resolved predictions from last 30 days
    const { data: predictions, error } = await supabase
      .from("ai_prediction_records")
      .select("model, asset, timeframe, prediction, confidence, direction_correct, actual_change_pct, created_at")
      .not("direction_correct", "is", null)
      .gte("created_at", since30d);

    if (error) throw error;
    if (!predictions || predictions.length === 0) {
      return new Response(JSON.stringify({ message: "No predictions to process", adjusted: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Group by model × asset × timeframe
    const groups: Record<string, typeof predictions> = {};
    for (const p of predictions) {
      const key = `${p.model}:${p.asset}:${p.timeframe}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }

    // 3. Calculate and upsert weights
    let adjusted = 0;

    for (const [key, preds] of Object.entries(groups)) {
      const [model, asset, timeframe] = key.split(":");

      // 7d window
      const preds7d = preds.filter(p => p.created_at >= since7d);
      const correct7d = preds7d.filter(p => p.direction_correct).length;
      const accuracy7d = preds7d.length > 0 ? (correct7d / preds7d.length) * 100 : 50;

      // 30d window
      const correct30d = preds.filter(p => p.direction_correct).length;
      const accuracy30d = preds.length > 0 ? (correct30d / preds.length) * 100 : 50;

      // RAG accuracy approximation
      const ragAccuracy = preds7d.length >= 3
        ? accuracy7d * 0.7 + accuracy30d * 0.3
        : accuracy30d;

      // Compute weight: 40% × 7d + 30% × 30d + 30% × RAG
      let weight = (accuracy7d * 0.4 + accuracy30d * 0.3 + ragAccuracy * 0.3) / 100;
      const blended = (accuracy7d + accuracy30d) / 2;

      // Penalty/bonus
      if (blended < 40) weight = Math.max(0.1, weight * 0.5);
      if (blended > 80) weight = Math.min(2.0, weight * 1.3);

      // Upsert both periods
      for (const period of ["7d", "30d"] as const) {
        const acc = period === "7d" ? accuracy7d : accuracy30d;
        const total = period === "7d" ? preds7d.length : preds.length;

        await supabase.from("ai_model_accuracy").upsert({
          model,
          asset,
          timeframe,
          period,
          accuracy_pct: parseFloat(acc.toFixed(2)),
          total_predictions: total,
          computed_weight: parseFloat(weight.toFixed(4)),
          updated_at: now.toISOString(),
        }, { onConflict: "model,asset,timeframe,period" });
      }

      adjusted++;
    }

    // 4. Log the adjustment
    await supabase.from("weight_adjustment_log").insert({
      timestamp: now.toISOString(),
      models_adjusted: adjusted,
      total_predictions: predictions.length,
      overall_accuracy: parseFloat(
        ((predictions.filter(p => p.direction_correct).length / predictions.length) * 100).toFixed(2)
      ),
    });

    // 5. Save daily accuracy snapshots (upsert per model×asset×timeframe per day)
    const today = now.toISOString().slice(0, 10); // YYYY-MM-DD
    for (const [key, preds] of Object.entries(groups)) {
      const [model, asset, timeframe] = key.split(":");
      const correct = preds.filter(p => p.direction_correct).length;
      const accuracy = preds.length > 0 ? (correct / preds.length) * 100 : 0;
      const avgConf = preds.reduce((s, p) => s + (p.confidence || 0), 0) / (preds.length || 1);
      const avgError = preds.reduce((s, p) => s + Math.abs(p.actual_change_pct || 0), 0) / (preds.length || 1);

      // Get latest weight from ai_model_accuracy
      const { data: accRow } = await supabase
        .from("ai_model_accuracy")
        .select("computed_weight")
        .eq("model", model).eq("asset", asset).eq("timeframe", timeframe).eq("period", "7d")
        .single();

      const { error: snapErr } = await supabase.from("accuracy_daily_snapshots").upsert({
        snapshot_date: today,
        model,
        asset,
        timeframe,
        accuracy_pct: parseFloat(accuracy.toFixed(2)),
        total_predictions: preds.length,
        correct_predictions: correct,
        avg_confidence: parseFloat(avgConf.toFixed(2)),
        computed_weight: accRow?.computed_weight ?? 1.0,
        avg_price_error_pct: parseFloat(avgError.toFixed(4)),
      }, { onConflict: "snapshot_date,model,asset,timeframe" });
      // ignore snapshot errors silently
    }

    return new Response(JSON.stringify({
      success: true,
      adjusted,
      totalPredictions: predictions.length,
      timestamp: now.toISOString(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
