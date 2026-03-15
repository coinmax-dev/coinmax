import { useQuery } from "@tanstack/react-query";
import { useAdminAuth } from "@/admin/admin-auth";
import { supabase } from "@/lib/supabase";
import { TrendingUp, RefreshCw, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, BarChart, Bar, AreaChart, Area,
} from "recharts";

const ASSETS = ["BTC", "ETH", "SOL", "BNB"];
const MODEL_COLORS: Record<string, string> = {
  "DeepSeek": "#22c55e",
  "GPT-4o": "#6366f1",
  "Llama 3.1": "#f59e0b",
  "Gemini": "#ec4899",
  "Grok": "#06b6d4",
};

interface Snapshot {
  snapshot_date: string;
  model: string;
  asset: string;
  timeframe: string;
  accuracy_pct: number;
  total_predictions: number;
  correct_predictions: number;
  avg_confidence: number;
  computed_weight: number;
  avg_price_error_pct: number;
}

interface AdjustmentLog {
  id: number;
  timestamp: string;
  models_adjusted: number;
  total_predictions: number;
  overall_accuracy: number;
}

export default function AdminAIProgress() {
  const { adminUser } = useAdminAuth();
  const [selectedAsset, setSelectedAsset] = useState("BTC");
  const [days, setDays] = useState(30);

  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }, [days]);

  // Fetch daily snapshots
  const { data: snapshots, isLoading, refetch } = useQuery({
    queryKey: ["admin", "ai-progress", selectedAsset, days],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accuracy_daily_snapshots")
        .select("*")
        .eq("asset", selectedAsset)
        .gte("snapshot_date", since)
        .order("snapshot_date", { ascending: true });
      if (error) throw error;
      return data as Snapshot[];
    },
    enabled: !!adminUser,
  });

  // Fetch weight adjustment logs
  const { data: adjustLogs } = useQuery({
    queryKey: ["admin", "ai-adjust-logs", days],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("weight_adjustment_log")
        .select("*")
        .gte("timestamp", new Date(Date.now() - days * 86400_000).toISOString())
        .order("timestamp", { ascending: true });
      if (error) throw error;
      return data as AdjustmentLog[];
    },
    enabled: !!adminUser,
  });

  // Transform snapshots for charts
  const chartData = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return [];

    const byDate: Record<string, Record<string, Snapshot>> = {};
    for (const s of snapshots) {
      if (!byDate[s.snapshot_date]) byDate[s.snapshot_date] = {};
      byDate[s.snapshot_date][s.model] = s;
    }

    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, models]) => {
        const row: any = { date: date.slice(5) }; // MM-DD
        for (const [model, data] of Object.entries(models)) {
          row[`${model}_acc`] = data.accuracy_pct;
          row[`${model}_weight`] = data.computed_weight;
          row[`${model}_total`] = data.total_predictions;
          row[`${model}_conf`] = data.avg_confidence;
        }
        return row;
      });
  }, [snapshots]);

  // Overall accuracy trend from adjustment logs
  const overallTrendData = useMemo(() => {
    if (!adjustLogs) return [];
    return adjustLogs.map(l => ({
      date: new Date(l.timestamp).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }),
      accuracy: l.overall_accuracy,
      predictions: l.total_predictions,
      models: l.models_adjusted,
    }));
  }, [adjustLogs]);

  // Calculate improvement stats
  const improvementStats = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return null;

    const models = [...new Set(snapshots.map(s => s.model))];
    const stats: Record<string, { first: number; last: number; change: number; total: number }> = {};

    for (const model of models) {
      const modelData = snapshots
        .filter(s => s.model === model)
        .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

      if (modelData.length >= 2) {
        const first = modelData[0].accuracy_pct;
        const last = modelData[modelData.length - 1].accuracy_pct;
        const total = modelData.reduce((s, d) => s + d.total_predictions, 0);
        stats[model] = { first, last, change: last - first, total };
      } else if (modelData.length === 1) {
        stats[model] = { first: modelData[0].accuracy_pct, last: modelData[0].accuracy_pct, change: 0, total: modelData[0].total_predictions };
      }
    }

    return stats;
  }, [snapshots]);

  const allModels = useMemo(() => {
    if (!snapshots) return [];
    return [...new Set(snapshots.map(s => s.model))];
  }, [snapshots]);

  const tooltipStyle = {
    contentStyle: { background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px", fontSize: "12px" },
    labelStyle: { color: "rgba(255,255,255,0.5)", marginBottom: "4px" },
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold text-foreground">AI 训练进步</h1>
        </div>
        <button onClick={() => refetch()} className="h-8 w-8 rounded-lg flex items-center justify-center text-foreground/40 hover:text-foreground/70 hover:bg-white/[0.05] transition-colors">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="flex rounded-xl border border-white/[0.06] overflow-hidden">
          {ASSETS.map((a) => (
            <button key={a} onClick={() => setSelectedAsset(a)}
              className={`px-3 py-1.5 text-xs font-semibold transition-all ${selectedAsset === a ? "bg-primary/15 text-primary" : "text-foreground/35 hover:text-foreground/60"}`}
            >{a}</button>
          ))}
        </div>
        <div className="flex rounded-xl border border-white/[0.06] overflow-hidden">
          {[7, 14, 30, 60].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-xs font-semibold transition-all ${days === d ? "bg-primary/15 text-primary" : "text-foreground/35 hover:text-foreground/60"}`}
            >{d}天</button>
          ))}
        </div>
      </div>

      {/* Model Improvement Cards */}
      {improvementStats && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Object.entries(improvementStats).map(([model, stat]) => (
            <div key={model} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3 lg:p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-2 h-2 rounded-full" style={{ background: MODEL_COLORS[model] || "#888" }} />
                <p className="text-[11px] text-foreground/40 font-semibold truncate">{model}</p>
              </div>
              <p className="text-lg lg:text-xl font-bold text-foreground/80">{stat.last.toFixed(1)}%</p>
              <div className="flex items-center gap-1 mt-1">
                {stat.change > 0 ? (
                  <ArrowUpRight className="h-3 w-3 text-green-400" />
                ) : stat.change < 0 ? (
                  <ArrowDownRight className="h-3 w-3 text-red-400" />
                ) : (
                  <Minus className="h-3 w-3 text-foreground/25" />
                )}
                <span className={`text-[11px] font-bold ${stat.change > 0 ? "text-green-400" : stat.change < 0 ? "text-red-400" : "text-foreground/25"}`}>
                  {stat.change > 0 ? "+" : ""}{stat.change.toFixed(1)}%
                </span>
                <span className="text-[10px] text-foreground/20 ml-1">{stat.total}次预测</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-[300px] rounded-2xl" />
          <Skeleton className="h-[250px] rounded-2xl" />
        </div>
      ) : !chartData || chartData.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-12 text-center">
          <p className="text-foreground/25 text-sm">暂无历史数据 — 每小时权重调整后自动记录</p>
          <p className="text-foreground/15 text-xs mt-1">数据将在 adjust-weights 定时任务运行后出现</p>
        </div>
      ) : (
        <>
          {/* Accuracy Trend Chart */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 lg:p-5">
            <h2 className="text-sm font-bold text-foreground/60 mb-4">准确率趋势 — {selectedAsset}</h2>
            <div className="h-[280px] lg:h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }} tickFormatter={v => `${v}%`} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v.toFixed(1)}%`, ""]} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: "11px" }} />
                  {allModels.map(model => (
                    <Line
                      key={model}
                      type="monotone"
                      dataKey={`${model}_acc`}
                      name={model}
                      stroke={MODEL_COLORS[model] || "#888"}
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      activeDot={{ r: 4 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Weight Evolution Chart */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 lg:p-5">
            <h2 className="text-sm font-bold text-foreground/60 mb-4">模型权重变化 — {selectedAsset}</h2>
            <div className="h-[250px] lg:h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => [v.toFixed(3), ""]} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: "11px" }} />
                  {allModels.map(model => (
                    <Area
                      key={model}
                      type="monotone"
                      dataKey={`${model}_weight`}
                      name={`${model} 权重`}
                      stroke={MODEL_COLORS[model] || "#888"}
                      fill={MODEL_COLORS[model] || "#888"}
                      fillOpacity={0.1}
                      strokeWidth={1.5}
                      connectNulls
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Prediction Volume Chart */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 lg:p-5">
            <h2 className="text-sm font-bold text-foreground/60 mb-4">每日预测量 — {selectedAsset}</h2>
            <div className="h-[220px] lg:h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }} />
                  <Tooltip {...tooltipStyle} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: "11px" }} />
                  {allModels.map(model => (
                    <Bar
                      key={model}
                      dataKey={`${model}_total`}
                      name={model}
                      fill={MODEL_COLORS[model] || "#888"}
                      opacity={0.7}
                      radius={[2, 2, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {/* Overall Accuracy Trend from Adjustment Logs */}
      {overallTrendData && overallTrendData.length > 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 lg:p-5">
          <h2 className="text-sm font-bold text-foreground/60 mb-4">全局准确率趋势（每次权重调整）</h2>
          <div className="h-[220px] lg:h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={overallTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }} tickFormatter={v => `${v}%`} />
                <Tooltip {...tooltipStyle} formatter={(v: number, name: string) => [name === "accuracy" ? `${v.toFixed(1)}%` : v, name === "accuracy" ? "准确率" : "预测数"]} />
                <Area type="monotone" dataKey="accuracy" name="准确率" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Daily Details Table (Mobile-friendly) */}
      {snapshots && snapshots.length > 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <h2 className="text-sm font-bold text-foreground/60">每日明细</h2>
          </div>
          <div className="divide-y divide-white/[0.04] max-h-[400px] overflow-y-auto">
            {[...snapshots].reverse().map((s, i) => (
              <div key={i} className="px-4 py-2.5 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: MODEL_COLORS[s.model] || "#888" }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground/60 truncate">{s.model}</span>
                    <span className="text-[10px] text-foreground/20">{s.snapshot_date}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[11px] shrink-0">
                  <span className={`font-bold ${s.accuracy_pct >= 50 ? "text-green-400" : "text-red-400"}`}>{s.accuracy_pct.toFixed(1)}%</span>
                  <span className="text-foreground/25">{s.correct_predictions}/{s.total_predictions}</span>
                  <span className="text-foreground/20">w={Number(s.computed_weight).toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
