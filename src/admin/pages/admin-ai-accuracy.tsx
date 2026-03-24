import { useQuery } from "@tanstack/react-query";
import { useAdminAuth } from "@/admin/admin-auth";
import { supabase } from "@/lib/supabase";
import { Brain, Target, TrendingUp, TrendingDown, Minus, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";

const ASSETS = ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP", "ADA", "AVAX", "LINK", "DOT"];
const TIMEFRAMES = ["5m", "15m", "30m", "1H", "4H", "1D"];
const PERIODS = ["7d", "30d", "all"];
const PERIOD_LABELS: Record<string, string> = { "7d": "7天", "30d": "30天", all: "全部" };

interface AccuracyRow {
  model: string;
  accuracy_pct: number;
  total_predictions: number;
  correct_predictions: number;
  avg_confidence: number;
  avg_price_error_pct: number;
  computed_weight: number;
}

interface PredictionRow {
  id: string;
  asset: string;
  timeframe: string;
  model: string;
  prediction: string;
  confidence: number;
  target_price: number;
  current_price: number;
  actual_price: number | null;
  actual_change_pct: number | null;
  direction_correct: boolean | null;
  price_error_pct: number | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

function DirectionBadge({ direction }: { direction: string }) {
  if (direction === "BULLISH") return <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-400"><TrendingUp className="h-3 w-3" />看涨</span>;
  if (direction === "BEARISH") return <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-400"><TrendingDown className="h-3 w-3" />看跌</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground/40"><Minus className="h-3 w-3" />中性</span>;
}

function AccuracyBar({ pct }: { pct: number }) {
  const color = pct >= 60 ? "bg-green-500" : pct >= 45 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs font-bold text-foreground/70 w-10 text-right">{pct.toFixed(1)}%</span>
    </div>
  );
}

function formatPrice(price: number | null | undefined): string {
  if (!price || price <= 0) return "—";
  if (price >= 1000) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(4)}`;
}

export default function AdminAIAccuracy() {
  const { adminUser } = useAdminAuth();
  const [selectedAsset, setSelectedAsset] = useState("BTC");
  const [selectedTimeframe, setSelectedTimeframe] = useState("1H");
  const [selectedPeriod, setSelectedPeriod] = useState("30d");

  const { data: accuracy, isLoading: accLoading, refetch: refetchAcc } = useQuery({
    queryKey: ["admin", "ai-accuracy", selectedAsset, selectedTimeframe, selectedPeriod],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_model_accuracy")
        .select("*")
        .eq("asset", selectedAsset)
        .eq("timeframe", selectedTimeframe)
        .eq("period", selectedPeriod)
        .order("accuracy_pct", { ascending: false });
      if (error) throw error;
      return data as AccuracyRow[];
    },
    enabled: !!adminUser,
  });

  const { data: recent, isLoading: recLoading } = useQuery({
    queryKey: ["admin", "ai-predictions", selectedAsset, selectedTimeframe],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_prediction_records")
        .select("*")
        .eq("asset", selectedAsset)
        .eq("timeframe", selectedTimeframe)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as PredictionRow[];
    },
    enabled: !!adminUser,
  });

  const { data: summary } = useQuery({
    queryKey: ["admin", "ai-summary"],
    queryFn: async () => {
      const { count: total } = await supabase.from("ai_prediction_records").select("*", { count: "exact", head: true });
      const { count: resolved } = await supabase.from("ai_prediction_records").select("*", { count: "exact", head: true }).eq("status", "resolved");
      const { count: pending } = await supabase.from("ai_prediction_records").select("*", { count: "exact", head: true }).eq("status", "pending");
      const { count: correct } = await supabase.from("ai_prediction_records").select("*", { count: "exact", head: true }).eq("direction_correct", true);
      return { total: total ?? 0, resolved: resolved ?? 0, pending: pending ?? 0, correct: correct ?? 0 };
    },
    enabled: !!adminUser,
  });

  // Per-timeframe accuracy for selected asset
  const { data: tfAccuracy } = useQuery({
    queryKey: ["admin", "ai-tf-accuracy", selectedAsset, selectedPeriod],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_model_accuracy")
        .select("timeframe, accuracy_pct, total_predictions, correct_predictions")
        .eq("asset", selectedAsset)
        .eq("period", selectedPeriod);
      if (error) throw error;
      // Aggregate by timeframe
      const byTf: Record<string, { total: number; correct: number; accSum: number; models: number }> = {};
      for (const row of (data || [])) {
        if (!byTf[row.timeframe]) byTf[row.timeframe] = { total: 0, correct: 0, accSum: 0, models: 0 };
        byTf[row.timeframe].total += row.total_predictions;
        byTf[row.timeframe].correct += row.correct_predictions;
        byTf[row.timeframe].accSum += row.accuracy_pct;
        byTf[row.timeframe].models += 1;
      }
      const order = ["5m", "15m", "30m", "1H", "4H", "1D"];
      return order
        .filter(tf => byTf[tf])
        .map(tf => ({
          timeframe: tf,
          accuracy: byTf[tf].total > 0 ? (byTf[tf].correct / byTf[tf].total) * 100 : 0,
          avgModelAcc: byTf[tf].models > 0 ? byTf[tf].accSum / byTf[tf].models : 0,
          total: byTf[tf].total,
          correct: byTf[tf].correct,
        }));
    },
    enabled: !!adminUser,
  });

  // Real AI analysis from ai_market_analysis
  const { data: liveAnalysis } = useQuery({
    queryKey: ["admin", "ai-live-analysis"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_market_analysis")
        .select("asset, model, direction, confidence, reasoning, market_sentiment, created_at")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
    enabled: !!adminUser,
    refetchInterval: 60000,
  });

  // AI Memory learning stats
  const { data: memoryStats } = useQuery({
    queryKey: ["admin", "ai-memory-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_memory")
        .select("outcome, learning_score, asset")
        .neq("outcome", "pending");
      if (error) return null;
      const total = data?.length ?? 0;
      const correct = data?.filter(d => d.outcome === "correct").length ?? 0;
      const avgScore = total > 0 ? data!.reduce((s, d) => s + (Number(d.learning_score) || 0), 0) / total : 0;
      return { total, correct, accuracy: total > 0 ? (correct / total * 100) : 0, avgScore };
    },
    enabled: !!adminUser,
  });

  const overallAccuracy = summary && summary.resolved > 0
    ? ((summary.correct / summary.resolved) * 100).toFixed(1)
    : "—";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Brain className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold text-foreground">AI 模型准确率</h1>
        </div>
        <button onClick={() => refetchAcc()} className="h-8 w-8 rounded-lg flex items-center justify-center text-foreground/40 hover:text-foreground/70 hover:bg-white/[0.05] transition-colors">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-[11px] text-foreground/35 mb-1">总预测数</p>
          <p className="text-xl font-bold">{summary?.total ?? "—"}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-[11px] text-foreground/35 mb-1">已验证</p>
          <p className="text-xl font-bold text-primary">{summary?.resolved ?? "—"}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-[11px] text-foreground/35 mb-1">待验证</p>
          <p className="text-xl font-bold text-yellow-400">{summary?.pending ?? "—"}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-[11px] text-foreground/35 mb-1">总体准确率</p>
          <p className="text-xl font-bold text-green-400">{overallAccuracy}%</p>
        </div>
      </div>

      {/* AI Memory Learning Stats */}
      {memoryStats && memoryStats.total > 0 && (
        <div className="rounded-2xl border border-purple-500/15 bg-purple-500/[0.03] p-4">
          <h2 className="text-sm font-bold text-foreground/60 mb-3">🧠 AI 向量记忆学习</h2>
          <div className="grid grid-cols-4 gap-3">
            <div className="text-center">
              <p className="text-xs text-foreground/30">已验证预测</p>
              <p className="text-lg font-bold">{memoryStats.total}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-foreground/30">正确</p>
              <p className="text-lg font-bold text-green-400">{memoryStats.correct}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-foreground/30">准确率</p>
              <p className={`text-lg font-bold ${memoryStats.accuracy >= 55 ? "text-green-400" : memoryStats.accuracy >= 45 ? "text-yellow-400" : "text-red-400"}`}>{memoryStats.accuracy.toFixed(1)}%</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-foreground/30">学习分数</p>
              <p className={`text-lg font-bold ${memoryStats.avgScore >= 0 ? "text-green-400" : "text-red-400"}`}>{memoryStats.avgScore > 0 ? "+" : ""}{memoryStats.avgScore.toFixed(3)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Real-time AI Analysis */}
      {liveAnalysis && liveAnalysis.length > 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <h2 className="text-sm font-bold text-foreground/70">🤖 AI 实时分析（5 模型 + OpenClaw Agent）</h2>
          </div>
          <div className="divide-y divide-white/[0.04] max-h-[300px] overflow-y-auto">
            {liveAnalysis.filter(a => a.asset !== "SCREENING").map((a, i) => (
              <div key={i} className="px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-foreground/70 w-10">{a.asset}</span>
                  <span className="text-[10px] text-foreground/40 w-20 truncate">{a.model}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    a.direction === "BULLISH" ? "text-green-400 bg-green-500/10" :
                    a.direction === "BEARISH" ? "text-red-400 bg-red-500/10" :
                    "text-foreground/40 bg-white/[0.04]"
                  }`}>{a.direction === "BULLISH" ? "看涨" : a.direction === "BEARISH" ? "看跌" : "中性"} {a.confidence}%</span>
                </div>
                <span className="text-[10px] text-foreground/20 max-w-[200px] truncate">{a.reasoning}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-timeframe accuracy */}
      {tfAccuracy && tfAccuracy.length > 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h2 className="text-sm font-bold text-foreground/60 mb-3">{selectedAsset} · {PERIOD_LABELS[selectedPeriod]} — 各时间段准确率</h2>
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
            {tfAccuracy.map(tf => {
              const color = tf.accuracy >= 60 ? "text-green-400" : tf.accuracy >= 50 ? "text-primary" : tf.accuracy >= 40 ? "text-yellow-400" : "text-red-400";
              const bgColor = tf.accuracy >= 60 ? "bg-green-500" : tf.accuracy >= 50 ? "bg-primary" : tf.accuracy >= 40 ? "bg-yellow-500" : "bg-red-500";
              const isSelected = tf.timeframe === selectedTimeframe;
              return (
                <button
                  key={tf.timeframe}
                  onClick={() => setSelectedTimeframe(tf.timeframe)}
                  className={`rounded-xl p-3 text-center transition-all ${isSelected ? "ring-1 ring-primary/30 bg-primary/[0.06]" : "bg-white/[0.02] hover:bg-white/[0.04]"}`}
                  style={{ border: isSelected ? "1px solid rgba(10,186,181,0.2)" : "1px solid rgba(255,255,255,0.04)" }}
                >
                  <div className="text-xs font-bold text-foreground/50 mb-1.5">{tf.timeframe}</div>
                  <div className={`text-lg font-black ${color}`}>{tf.accuracy.toFixed(1)}%</div>
                  <div className="w-full h-1.5 rounded-full bg-white/[0.06] mt-2 overflow-hidden">
                    <div className={`h-full rounded-full ${bgColor} transition-all`} style={{ width: `${Math.min(tf.accuracy, 100)}%`, opacity: 0.6 }} />
                  </div>
                  <div className="text-[10px] text-foreground/25 mt-1.5">{tf.correct}/{tf.total}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex rounded-xl border border-white/[0.06] overflow-hidden overflow-x-auto">
          {ASSETS.map((a) => (
            <button key={a} onClick={() => setSelectedAsset(a)}
              className={`px-3 py-1.5 text-xs font-semibold transition-all shrink-0 ${selectedAsset === a ? "bg-primary/15 text-primary" : "text-foreground/35 hover:text-foreground/60"}`}
            >{a}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-xl border border-white/[0.06] overflow-hidden">
            {TIMEFRAMES.map((tf) => (
              <button key={tf} onClick={() => setSelectedTimeframe(tf)}
                className={`px-2.5 py-1.5 text-xs font-semibold transition-all ${selectedTimeframe === tf ? "bg-primary/15 text-primary" : "text-foreground/35 hover:text-foreground/60"}`}
              >{tf}</button>
            ))}
          </div>
          <div className="flex rounded-xl border border-white/[0.06] overflow-hidden">
            {PERIODS.map((p) => (
              <button key={p} onClick={() => setSelectedPeriod(p)}
                className={`px-2.5 py-1.5 text-xs font-semibold transition-all ${selectedPeriod === p ? "bg-primary/15 text-primary" : "text-foreground/35 hover:text-foreground/60"}`}
              >{PERIOD_LABELS[p]}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Model Accuracy */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <h2 className="text-sm font-bold text-foreground/70">
            {selectedAsset} · {selectedTimeframe} · {PERIOD_LABELS[selectedPeriod]} — 各模型准确率
          </h2>
        </div>
        {accLoading ? (
          <div className="p-4 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
        ) : !accuracy || accuracy.length === 0 ? (
          <div className="p-8 text-center text-foreground/25 text-sm">暂无数据 — 预测验证后将自动填充</div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {accuracy.map((row) => (
              <div key={row.model} className="px-4 py-3 space-y-2">
                {/* Row 1: model name + accuracy bar */}
                <div className="flex items-center gap-3">
                  <div className="w-16 lg:w-24 shrink-0">
                    <p className="text-xs lg:text-sm font-bold text-foreground/80 truncate">{row.model}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <AccuracyBar pct={row.accuracy_pct} />
                  </div>
                </div>
                {/* Row 2: stats */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] lg:text-xs text-foreground/35 pl-0 lg:pl-24">
                  <span>预测 <strong className="text-foreground/50">{row.correct_predictions}/{row.total_predictions}</strong></span>
                  <span>信心 <strong className="text-foreground/50">{Number(row.avg_confidence).toFixed(0)}%</strong></span>
                  <span>误差 <strong className="text-foreground/50">{Number(row.avg_price_error_pct).toFixed(2)}%</strong></span>
                  <span>权重 <strong className="text-primary/80">{Number(row.computed_weight || 0).toFixed(2)}</strong></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Predictions - Mobile cards + Desktop table */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <h2 className="text-sm font-bold text-foreground/70">最近预测记录</h2>
        </div>
        {recLoading ? (
          <div className="p-4 space-y-2">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8 rounded-lg" />)}</div>
        ) : !recent || recent.length === 0 ? (
          <div className="p-8 text-center text-foreground/25 text-sm">暂无预测记录</div>
        ) : (
          <>
            {/* Mobile: card layout */}
            <div className="lg:hidden divide-y divide-white/[0.04]">
              {recent.map((row) => (
                <div key={row.id} className="px-4 py-3 space-y-2">
                  {/* Header: model + direction + result */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-foreground/60">{row.model}</span>
                      <DirectionBadge direction={row.prediction} />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-foreground/30">{row.confidence}%</span>
                      {row.status === "pending" ? (
                        <span className="text-yellow-400/60 text-[10px] font-semibold bg-yellow-500/8 px-1.5 py-0.5 rounded">待验证</span>
                      ) : row.direction_correct ? (
                        <span className="text-green-400 text-[10px] font-bold bg-green-500/10 px-1.5 py-0.5 rounded">正确</span>
                      ) : (
                        <span className="text-red-400 text-[10px] font-bold bg-red-500/10 px-1.5 py-0.5 rounded">错误</span>
                      )}
                    </div>
                  </div>
                  {/* Prices */}
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div>
                      <p className="text-foreground/25">当前价</p>
                      <p className="text-foreground/50 font-mono">{formatPrice(row.current_price)}</p>
                    </div>
                    <div>
                      <p className="text-foreground/25">目标价</p>
                      <p className="text-foreground/50 font-mono">{formatPrice(row.target_price)}</p>
                    </div>
                    <div>
                      <p className="text-foreground/25">实际价</p>
                      <p className="text-foreground/50 font-mono">{row.actual_price ? formatPrice(row.actual_price) : "—"}</p>
                    </div>
                  </div>
                  {/* Footer: change + time */}
                  <div className="flex items-center justify-between text-[10px]">
                    <span className={row.actual_change_pct !== null ? (row.actual_change_pct >= 0 ? "text-green-400" : "text-red-400") : "text-foreground/20"}>
                      {row.actual_change_pct !== null ? `变化 ${row.actual_change_pct > 0 ? "+" : ""}${row.actual_change_pct.toFixed(3)}%` : ""}
                    </span>
                    <span className="text-foreground/20">
                      {new Date(row.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: table layout */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-foreground/30 border-b border-white/[0.04]">
                    <th className="text-left px-4 py-2 font-medium">时间</th>
                    <th className="text-left px-4 py-2 font-medium">模型</th>
                    <th className="text-left px-4 py-2 font-medium">预测</th>
                    <th className="text-right px-4 py-2 font-medium">信心</th>
                    <th className="text-right px-4 py-2 font-medium">当前价</th>
                    <th className="text-right px-4 py-2 font-medium">目标价</th>
                    <th className="text-right px-4 py-2 font-medium">实际价</th>
                    <th className="text-right px-4 py-2 font-medium">变化%</th>
                    <th className="text-center px-4 py-2 font-medium">正确</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                  {recent.map((row) => (
                    <tr key={row.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-2.5 text-foreground/40 whitespace-nowrap">
                        {new Date(row.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-foreground/60">{row.model}</td>
                      <td className="px-4 py-2.5"><DirectionBadge direction={row.prediction} /></td>
                      <td className="px-4 py-2.5 text-right text-foreground/50">{row.confidence}%</td>
                      <td className="px-4 py-2.5 text-right font-mono text-foreground/40">{formatPrice(row.current_price)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-foreground/50">{formatPrice(row.target_price)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-foreground/50">
                        {row.actual_price ? formatPrice(row.actual_price) : <span className="text-foreground/20">—</span>}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono ${row.actual_change_pct !== null ? (row.actual_change_pct >= 0 ? "text-green-400" : "text-red-400") : "text-foreground/20"}`}>
                        {row.actual_change_pct !== null ? `${row.actual_change_pct > 0 ? "+" : ""}${row.actual_change_pct.toFixed(3)}%` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {row.status === "pending" ? (
                          <span className="text-yellow-400/60 text-[10px] font-semibold">待验证</span>
                        ) : row.direction_correct ? (
                          <span className="text-green-400 text-[10px] font-bold">✓</span>
                        ) : (
                          <span className="text-red-400 text-[10px] font-bold">✗</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
