import { useQuery } from "@tanstack/react-query";
import { useAdminAuth } from "@/admin/admin-auth";
import { supabase } from "@/lib/supabase";
import { Brain, Target, TrendingUp, TrendingDown, Minus, RefreshCw, ChevronDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";

const ASSETS = ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"];
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

export default function AdminAIAccuracy() {
  const { adminUser } = useAdminAuth();
  const [selectedAsset, setSelectedAsset] = useState("BTC");
  const [selectedTimeframe, setSelectedTimeframe] = useState("1H");
  const [selectedPeriod, setSelectedPeriod] = useState("30d");

  // Fetch accuracy aggregates
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

  // Fetch recent predictions
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

  // Summary stats
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

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {/* Asset filter */}
        <div className="flex rounded-xl border border-white/[0.06] overflow-hidden">
          {ASSETS.map((a) => (
            <button
              key={a}
              onClick={() => setSelectedAsset(a)}
              className={`px-3 py-1.5 text-xs font-semibold transition-all ${selectedAsset === a ? "bg-primary/15 text-primary" : "text-foreground/35 hover:text-foreground/60"}`}
            >
              {a}
            </button>
          ))}
        </div>
        {/* Timeframe filter */}
        <div className="flex rounded-xl border border-white/[0.06] overflow-hidden">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => setSelectedTimeframe(tf)}
              className={`px-3 py-1.5 text-xs font-semibold transition-all ${selectedTimeframe === tf ? "bg-primary/15 text-primary" : "text-foreground/35 hover:text-foreground/60"}`}
            >
              {tf}
            </button>
          ))}
        </div>
        {/* Period filter */}
        <div className="flex rounded-xl border border-white/[0.06] overflow-hidden">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setSelectedPeriod(p)}
              className={`px-3 py-1.5 text-xs font-semibold transition-all ${selectedPeriod === p ? "bg-primary/15 text-primary" : "text-foreground/35 hover:text-foreground/60"}`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Model Accuracy Table */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <h2 className="text-sm font-bold text-foreground/70">
            {selectedAsset} · {selectedTimeframe} · {PERIOD_LABELS[selectedPeriod]} — 各模型准确率
          </h2>
        </div>
        {accLoading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
          </div>
        ) : !accuracy || accuracy.length === 0 ? (
          <div className="p-8 text-center text-foreground/25 text-sm">暂无数据 — 预测验证后将自动填充</div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {accuracy.map((row) => (
              <div key={row.model} className="px-4 py-3 flex items-center gap-4">
                <div className="w-20 shrink-0">
                  <p className="text-sm font-bold text-foreground/80">{row.model}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <AccuracyBar pct={row.accuracy_pct} />
                </div>
                <div className="flex gap-4 text-xs text-foreground/40 shrink-0">
                  <span>{row.correct_predictions}/{row.total_predictions}</span>
                  <span>信心 {row.avg_confidence.toFixed(0)}%</span>
                  <span>误差 {row.avg_price_error_pct.toFixed(2)}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Predictions */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <h2 className="text-sm font-bold text-foreground/70">最近预测记录</h2>
        </div>
        {recLoading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8 rounded-lg" />)}
          </div>
        ) : !recent || recent.length === 0 ? (
          <div className="p-8 text-center text-foreground/25 text-sm">暂无预测记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-foreground/30 border-b border-white/[0.04]">
                  <th className="text-left px-4 py-2 font-medium">时间</th>
                  <th className="text-left px-4 py-2 font-medium">模型</th>
                  <th className="text-left px-4 py-2 font-medium">预测</th>
                  <th className="text-right px-4 py-2 font-medium">信心</th>
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
                    <td className="px-4 py-2.5 text-right font-mono text-foreground/50">${Number(row.target_price).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-foreground/50">
                      {row.actual_price ? `$${Number(row.actual_price).toLocaleString()}` : <span className="text-foreground/20">—</span>}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono ${row.actual_change_pct !== null ? (row.actual_change_pct >= 0 ? "text-green-400" : "text-red-400") : "text-foreground/20"}`}>
                      {row.actual_change_pct !== null ? `${row.actual_change_pct > 0 ? "+" : ""}${row.actual_change_pct.toFixed(2)}%` : "—"}
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
        )}
      </div>
    </div>
  );
}
