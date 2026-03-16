import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * AI Training Module — Cron Edge Function
 *
 * Runs every hour to:
 * 1. Analyze model performance per asset/timeframe (bias detection)
 * 2. Calculate per-model ROI from paper trades
 * 3. Detect model degradation (accuracy drop alerts)
 * 4. Generate training reports saved to ai_training_reports table
 * 5. Update model weights based on trade PnL (not just direction accuracy)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const now = new Date();
  const since7d = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const since24h = new Date(now.getTime() - 86400_000).toISOString();

  const report: any = {
    timestamp: now.toISOString(),
    model_performance: [],
    asset_performance: [],
    timeframe_performance: [],
    bias_alerts: [],
    degradation_alerts: [],
    trade_attribution: [],
    recommendations: [],
  };

  try {
    // ── 1. Per-model performance analysis ───────────────────
    const { data: preds7d } = await supabase
      .from("ai_prediction_records")
      .select("model, asset, timeframe, prediction, confidence, direction_correct, actual_change_pct, price_error_pct, created_at")
      .eq("status", "resolved")
      .gte("created_at", since7d);

    if (!preds7d || preds7d.length === 0) {
      return new Response(JSON.stringify({ message: "No resolved predictions in last 7d", report }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group by model
    const byModel: Record<string, typeof preds7d> = {};
    const byAsset: Record<string, typeof preds7d> = {};
    const byTimeframe: Record<string, typeof preds7d> = {};
    const byModelAsset: Record<string, typeof preds7d> = {};
    const byModelTf: Record<string, typeof preds7d> = {};

    for (const p of preds7d) {
      const mk = p.model;
      const ak = p.asset;
      const tk = p.timeframe;
      if (!byModel[mk]) byModel[mk] = [];
      byModel[mk].push(p);
      if (!byAsset[ak]) byAsset[ak] = [];
      byAsset[ak].push(p);
      if (!byTimeframe[tk]) byTimeframe[tk] = [];
      byTimeframe[tk].push(p);
      const mak = `${mk}:${ak}`;
      if (!byModelAsset[mak]) byModelAsset[mak] = [];
      byModelAsset[mak].push(p);
      const mtk = `${mk}:${tk}`;
      if (!byModelTf[mtk]) byModelTf[mtk] = [];
      byModelTf[mtk].push(p);
    }

    // Calculate stats helper
    function calcStats(preds: typeof preds7d) {
      const total = preds.length;
      const correct = preds.filter(p => p.direction_correct).length;
      const accuracy = total > 0 ? (correct / total) * 100 : 0;
      const avgConf = preds.reduce((s, p) => s + (p.confidence || 0), 0) / (total || 1);
      const avgError = preds.reduce((s, p) => s + Math.abs(p.price_error_pct || 0), 0) / (total || 1);
      const bullish = preds.filter(p => p.prediction === "BULLISH").length;
      const bearish = preds.filter(p => p.prediction === "BEARISH").length;
      const neutral = preds.filter(p => p.prediction === "NEUTRAL").length;
      const bullishAcc = bullish > 0 ? (preds.filter(p => p.prediction === "BULLISH" && p.direction_correct).length / bullish) * 100 : 0;
      const bearishAcc = bearish > 0 ? (preds.filter(p => p.prediction === "BEARISH" && p.direction_correct).length / bearish) * 100 : 0;
      return { total, correct, accuracy: parseFloat(accuracy.toFixed(2)), avgConf: parseFloat(avgConf.toFixed(1)), avgError: parseFloat(avgError.toFixed(3)), bullish, bearish, neutral, bullishAcc: parseFloat(bullishAcc.toFixed(1)), bearishAcc: parseFloat(bearishAcc.toFixed(1)) };
    }

    // Model performance
    for (const [model, preds] of Object.entries(byModel)) {
      const stats = calcStats(preds);
      report.model_performance.push({ model, ...stats });

      // Bias detection
      if (stats.bullish > stats.total * 0.7) report.bias_alerts.push({ model, type: "bullish_bias", message: `${model} 偏向看涨 (${stats.bullish}/${stats.total} = ${(stats.bullish/stats.total*100).toFixed(0)}%)` });
      if (stats.bearish > stats.total * 0.7) report.bias_alerts.push({ model, type: "bearish_bias", message: `${model} 偏向看跌 (${stats.bearish}/${stats.total} = ${(stats.bearish/stats.total*100).toFixed(0)}%)` });
      if (stats.neutral > stats.total * 0.5) report.bias_alerts.push({ model, type: "neutral_bias", message: `${model} 过于保守中性 (${stats.neutral}/${stats.total} = ${(stats.neutral/stats.total*100).toFixed(0)}%)` });
    }

    // Asset performance
    for (const [asset, preds] of Object.entries(byAsset)) {
      report.asset_performance.push({ asset, ...calcStats(preds) });
    }

    // Timeframe performance
    for (const [tf, preds] of Object.entries(byTimeframe)) {
      report.timeframe_performance.push({ timeframe: tf, ...calcStats(preds) });
    }

    // ── 2. Model degradation detection ──────────────────────
    const { data: preds24h } = await supabase
      .from("ai_prediction_records")
      .select("model, direction_correct")
      .eq("status", "resolved")
      .gte("created_at", since24h);

    if (preds24h && preds24h.length > 0) {
      const recent: Record<string, { total: number; correct: number }> = {};
      for (const p of preds24h) {
        if (!recent[p.model]) recent[p.model] = { total: 0, correct: 0 };
        recent[p.model].total++;
        if (p.direction_correct) recent[p.model].correct++;
      }

      for (const [model, r] of Object.entries(recent)) {
        const recentAcc = (r.correct / r.total) * 100;
        const weeklyAcc = byModel[model] ? (byModel[model].filter(p => p.direction_correct).length / byModel[model].length) * 100 : 50;
        const drop = weeklyAcc - recentAcc;
        if (drop > 15 && r.total >= 5) {
          report.degradation_alerts.push({
            model, weekly_accuracy: parseFloat(weeklyAcc.toFixed(1)),
            recent_accuracy: parseFloat(recentAcc.toFixed(1)),
            drop: parseFloat(drop.toFixed(1)),
            message: `${model} 准确率下降 ${drop.toFixed(1)}%（7天 ${weeklyAcc.toFixed(1)}% → 24小时 ${recentAcc.toFixed(1)}%）`,
          });
        }
      }
    }

    // ── 3. Trade attribution (paper trades) ─────────────────
    const { data: closedTrades } = await supabase
      .from("paper_trades")
      .select("asset, side, pnl, pnl_pct, close_reason, signal_id")
      .eq("status", "CLOSED")
      .gte("closed_at", since7d);

    if (closedTrades && closedTrades.length > 0) {
      // Get contributing models from trade_signals
      const signalIds = closedTrades.map(t => t.signal_id).filter(Boolean);
      const { data: signals } = signalIds.length > 0
        ? await supabase.from("trade_signals").select("id, source_models").in("id", signalIds)
        : { data: [] };

      const sigMap: Record<string, string[]> = {};
      if (signals) for (const s of signals) sigMap[s.id] = s.source_models || [];

      const modelPnl: Record<string, { wins: number; losses: number; totalPnl: number; count: number }> = {};
      for (const t of closedTrades) {
        const models = sigMap[t.signal_id] || [];
        for (const m of models) {
          if (!modelPnl[m]) modelPnl[m] = { wins: 0, losses: 0, totalPnl: 0, count: 0 };
          modelPnl[m].count++;
          modelPnl[m].totalPnl += t.pnl || 0;
          if ((t.pnl || 0) > 0) modelPnl[m].wins++;
          else modelPnl[m].losses++;
        }
      }

      for (const [model, stats] of Object.entries(modelPnl)) {
        report.trade_attribution.push({
          model, trades: stats.count, wins: stats.wins, losses: stats.losses,
          winRate: stats.count > 0 ? parseFloat(((stats.wins / stats.count) * 100).toFixed(1)) : 0,
          totalPnl: parseFloat(stats.totalPnl.toFixed(4)),
          avgPnl: stats.count > 0 ? parseFloat((stats.totalPnl / stats.count).toFixed(4)) : 0,
        });
      }
    }

    // ── 4. Generate recommendations ─────────────────────────
    const sorted = [...report.model_performance].sort((a: any, b: any) => b.accuracy - a.accuracy);
    if (sorted.length >= 2) {
      const best = sorted[0];
      const worst = sorted[sorted.length - 1];
      report.recommendations.push(`最佳模型: ${best.model} (${best.accuracy}% 准确率, ${best.total}次预测)`);
      report.recommendations.push(`最差模型: ${worst.model} (${worst.accuracy}% 准确率) — 建议降低权重`);

      if (worst.accuracy < 35) {
        report.recommendations.push(`⚠️ ${worst.model} 准确率低于35%，建议临时禁用或大幅降低权重`);
      }
    }

    // Best timeframe
    const tfSorted = [...report.timeframe_performance].sort((a: any, b: any) => b.accuracy - a.accuracy);
    if (tfSorted.length > 0) {
      report.recommendations.push(`最准时间周期: ${tfSorted[0].timeframe} (${tfSorted[0].accuracy}%)`);
    }

    // Best asset
    const assetSorted = [...report.asset_performance].sort((a: any, b: any) => b.accuracy - a.accuracy);
    if (assetSorted.length > 0) {
      report.recommendations.push(`最准资产: ${assetSorted[0].asset} (${assetSorted[0].accuracy}%)`);
    }

    // ── 5. Save training report ─────────────────────────────
    const { error: saveErr } = await supabase.from("ai_training_reports").insert({
      report_date: now.toISOString().slice(0, 10),
      report_type: "hourly",
      total_predictions: preds7d.length,
      overall_accuracy: parseFloat(((preds7d.filter(p => p.direction_correct).length / preds7d.length) * 100).toFixed(2)),
      model_performance: report.model_performance,
      asset_performance: report.asset_performance,
      timeframe_performance: report.timeframe_performance,
      bias_alerts: report.bias_alerts,
      degradation_alerts: report.degradation_alerts,
      trade_attribution: report.trade_attribution,
      recommendations: report.recommendations,
      created_at: now.toISOString(),
    });
    if (saveErr) report.errors = [saveErr.message];

  } catch (err) {
    report.errors = [err.message];
  }

  return new Response(JSON.stringify(report), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
