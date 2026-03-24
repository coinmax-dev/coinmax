import { useQuery } from "@tanstack/react-query";
import { useAdminAuth } from "@/admin/admin-auth";
import { supabase } from "@/lib/supabase";
import { TrendingUp, RefreshCw, ArrowUpRight, ArrowDownRight, Minus, ChevronLeft, ChevronRight, Calendar, Brain, BarChart3, Target } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, BarChart, Bar, AreaChart, Area,
} from "recharts";

const ASSETS = ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP", "ADA", "AVAX", "LINK", "DOT"];
const MODEL_COLORS: Record<string, string> = {
  "GPT-4o": "#6366f1",
  "Claude": "#f59e0b",
  "Gemini": "#ec4899",
  "DeepSeek": "#22c55e",
  "Llama": "#06b6d4",
  "openclaw-agent": "#8b5cf6",
  // Legacy
  "Llama 3.1": "#f59e0b",
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

// Calendar helpers
function getDaysInMonth(year: number, month: number): number { return new Date(year, month + 1, 0).getDate(); }
function getFirstDayOfWeek(year: number, month: number): number { return new Date(year, month, 1).getDay(); }
function accColor(pct: number): string {
  if (pct >= 60) return "bg-green-500/20 text-green-400 border-green-500/30";
  if (pct >= 50) return "bg-primary/15 text-primary border-primary/25";
  if (pct >= 40) return "bg-yellow-500/15 text-yellow-400 border-yellow-500/25";
  return "bg-red-500/15 text-red-400 border-red-500/25";
}
function accBg(pct: number): string {
  if (pct >= 60) return "bg-green-500"; if (pct >= 50) return "bg-primary"; if (pct >= 40) return "bg-yellow-500"; return "bg-red-500";
}

interface CalendarDayData {
  avgAccuracy: number;
  models: { model: string; accuracy: number; predictions: number; weight: number }[];
  totalPredictions: number;
}

function AccuracyCalendar({ asset, adminUser }: { asset: string; adminUser: string | null }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(getDaysInMonth(year, month)).padStart(2, "0")}`;

  const { data: calSnapshots } = useQuery({
    queryKey: ["admin", "ai-calendar", asset, year, month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accuracy_daily_snapshots").select("*")
        .eq("asset", asset).gte("snapshot_date", monthStart).lte("snapshot_date", monthEnd)
        .order("snapshot_date", { ascending: true });
      if (error) throw error;
      return data as Snapshot[];
    },
    enabled: !!adminUser,
  });

  const dayMap = useMemo(() => {
    if (!calSnapshots) return {};
    const map: Record<string, CalendarDayData> = {};
    for (const s of calSnapshots) {
      if (!map[s.snapshot_date]) map[s.snapshot_date] = { avgAccuracy: 0, models: [], totalPredictions: 0 };
      map[s.snapshot_date].models.push({ model: s.model, accuracy: s.accuracy_pct, predictions: s.total_predictions, weight: s.computed_weight });
      map[s.snapshot_date].totalPredictions += s.total_predictions;
    }
    for (const d of Object.values(map)) {
      const total = d.models.reduce((s, m) => s + m.predictions, 0);
      d.avgAccuracy = total > 0 ? d.models.reduce((s, m) => s + m.accuracy * m.predictions, 0) / total : d.models.reduce((s, m) => s + m.accuracy, 0) / d.models.length;
    }
    return map;
  }, [calSnapshots]);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);
  const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); setSelectedDay(null); };
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); setSelectedDay(null); };
  const selectedData = selectedDay ? dayMap[selectedDay] : null;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 lg:p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary/60" />
          <h2 className="text-sm font-bold text-foreground/60">每日准确率日历 — {asset}</h2>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={prevMonth} className="h-7 w-7 rounded-lg flex items-center justify-center text-foreground/40 hover:text-foreground/70 hover:bg-white/[0.05] transition-colors"><ChevronLeft className="h-4 w-4" /></button>
          <span className="text-xs font-bold text-foreground/50 w-20 text-center">{year}年{month + 1}月</span>
          <button onClick={nextMonth} className="h-7 w-7 rounded-lg flex items-center justify-center text-foreground/40 hover:text-foreground/70 hover:bg-white/[0.05] transition-colors"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map(w => <div key={w} className="text-center text-[10px] text-foreground/25 font-medium py-1">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: firstDay }).map((_, i) => <div key={`e-${i}`} className="aspect-square" />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const data = dayMap[dateStr];
          const isSelected = selectedDay === dateStr;
          const now2 = new Date();
          const isToday = dateStr === `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, "0")}-${String(now2.getDate()).padStart(2, "0")}`;
          return (
            <button key={day} onClick={() => setSelectedDay(isSelected ? null : dateStr)}
              className={`aspect-square rounded-lg border transition-all flex flex-col items-center justify-center gap-0.5 ${isSelected ? "border-primary/40 bg-primary/10 ring-1 ring-primary/20" : data ? `${accColor(data.avgAccuracy)} hover:brightness-110 cursor-pointer` : "border-white/[0.04] bg-white/[0.01] text-foreground/15"} ${isToday ? "ring-1 ring-foreground/15" : ""}`}>
              <span className={`text-[10px] lg:text-xs font-bold ${data ? "" : "text-foreground/15"}`}>{day}</span>
              {data && <span className="text-[8px] lg:text-[10px] font-bold opacity-80">{data.avgAccuracy.toFixed(0)}%</span>}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-center gap-3 mt-3 text-[10px] text-foreground/30">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-500/30" />{"<40%"}</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-yellow-500/30" />40-49%</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-primary/30" />50-59%</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-green-500/30" />{"≥60%"}</span>
      </div>
      {selectedData && (
        <div className="mt-4 pt-4 border-t border-white/[0.06] space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-foreground/50">{selectedDay} — 平均 <span className={selectedData.avgAccuracy >= 50 ? "text-green-400" : "text-red-400"}>{selectedData.avgAccuracy.toFixed(1)}%</span></h3>
            <span className="text-[10px] text-foreground/20">{selectedData.totalPredictions} 次</span>
          </div>
          <div className="space-y-2">
            {selectedData.models.sort((a, b) => b.accuracy - a.accuracy).map(m => (
              <div key={m.model} className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 w-20 shrink-0">
                  <div className="w-2 h-2 rounded-full" style={{ background: MODEL_COLORS[m.model] || "#888" }} />
                  <span className="text-[11px] font-bold text-foreground/50 truncate">{m.model}</span>
                </div>
                <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className={`h-full rounded-full ${accBg(m.accuracy)} transition-all`} style={{ width: `${Math.min(m.accuracy, 100)}%`, opacity: 0.6 }} />
                </div>
                <span className={`text-[11px] font-bold w-10 text-right ${m.accuracy >= 50 ? "text-green-400" : "text-red-400"}`}>{m.accuracy.toFixed(1)}%</span>
                <span className="text-[10px] text-foreground/20 w-8 text-right">{m.predictions}次</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminAIProgress() {
  const { adminUser } = useAdminAuth();
  const [selectedAsset, setSelectedAsset] = useState("BTC");
  const [days, setDays] = useState(30);

  const since = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10);
  }, [days]);

  // Overall prediction stats (always available, from ai_prediction_records)
  const { data: predStats } = useQuery({
    queryKey: ["admin", "ai-progress-stats", selectedAsset],
    queryFn: async () => {
      const [
        { count: total },
        { count: resolved },
        { count: correct },
        { data: modelData },
      ] = await Promise.all([
        supabase.from("ai_prediction_records").select("*", { count: "exact", head: true }).eq("asset", selectedAsset),
        supabase.from("ai_prediction_records").select("*", { count: "exact", head: true }).eq("asset", selectedAsset).eq("status", "resolved"),
        supabase.from("ai_prediction_records").select("*", { count: "exact", head: true }).eq("asset", selectedAsset).eq("direction_correct", true),
        supabase.from("ai_model_accuracy").select("model, accuracy_pct, total_predictions, correct_predictions, computed_weight, avg_confidence").eq("asset", selectedAsset).eq("period", "7d"),
      ]);
      return {
        total: total ?? 0, resolved: resolved ?? 0, correct: correct ?? 0,
        accuracy: (resolved ?? 0) > 0 ? ((correct ?? 0) / (resolved ?? 1)) * 100 : 0,
        models: (modelData || []) as { model: string; accuracy_pct: number; total_predictions: number; correct_predictions: number; computed_weight: number; avg_confidence: number }[],
      };
    },
    enabled: !!adminUser,
  });

  // Per-timeframe stats from model_accuracy
  const { data: tfStats } = useQuery({
    queryKey: ["admin", "ai-progress-tf", selectedAsset],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_model_accuracy")
        .select("timeframe, accuracy_pct, total_predictions, correct_predictions")
        .eq("asset", selectedAsset).eq("period", "7d");
      if (error) throw error;
      const byTf: Record<string, { total: number; correct: number }> = {};
      for (const r of (data || [])) {
        if (!byTf[r.timeframe]) byTf[r.timeframe] = { total: 0, correct: 0 };
        byTf[r.timeframe].total += r.total_predictions;
        byTf[r.timeframe].correct += r.correct_predictions;
      }
      return ["5m", "15m", "30m", "1H", "4H", "1D"].filter(tf => byTf[tf]).map(tf => ({
        timeframe: tf,
        accuracy: byTf[tf].total > 0 ? (byTf[tf].correct / byTf[tf].total) * 100 : 0,
        total: byTf[tf].total, correct: byTf[tf].correct,
      }));
    },
    enabled: !!adminUser,
  });

  // Daily snapshots for charts
  const { data: snapshots, isLoading, refetch } = useQuery({
    queryKey: ["admin", "ai-progress", selectedAsset, days],
    queryFn: async () => {
      const { data, error } = await supabase.from("accuracy_daily_snapshots").select("*")
        .eq("asset", selectedAsset).gte("snapshot_date", since).order("snapshot_date", { ascending: true });
      if (error) throw error;
      return data as Snapshot[];
    },
    enabled: !!adminUser,
  });

  const { data: trainingReport } = useQuery({
    queryKey: ["admin", "ai-training-report"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ai_training_reports").select("*").order("created_at", { ascending: false }).limit(1).single();
      if (error) return null;
      return data;
    },
    enabled: !!adminUser,
  });

  const { data: adjustLogs } = useQuery({
    queryKey: ["admin", "ai-adjust-logs", days],
    queryFn: async () => {
      const { data, error } = await supabase.from("weight_adjustment_log").select("*")
        .gte("timestamp", new Date(Date.now() - days * 86400_000).toISOString()).order("timestamp", { ascending: true });
      if (error) throw error;
      return data as AdjustmentLog[];
    },
    enabled: !!adminUser,
  });

  const chartData = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return [];
    const byDate: Record<string, Record<string, Snapshot>> = {};
    for (const s of snapshots) { if (!byDate[s.snapshot_date]) byDate[s.snapshot_date] = {}; byDate[s.snapshot_date][s.model] = s; }
    return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, models]) => {
      const row: any = { date: date.slice(5) };
      for (const [model, data] of Object.entries(models)) {
        row[`${model}_acc`] = data.accuracy_pct; row[`${model}_weight`] = data.computed_weight; row[`${model}_total`] = data.total_predictions;
      }
      return row;
    });
  }, [snapshots]);

  const overallTrendData = useMemo(() => {
    if (!adjustLogs) return [];
    return adjustLogs.map(l => ({ date: new Date(l.timestamp).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }), accuracy: l.overall_accuracy, predictions: l.total_predictions }));
  }, [adjustLogs]);

  const improvementStats = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return null;
    const models = [...new Set(snapshots.map(s => s.model))];
    const stats: Record<string, { first: number; last: number; change: number; total: number }> = {};
    for (const model of models) {
      const md = snapshots.filter(s => s.model === model).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
      if (md.length >= 2) stats[model] = { first: md[0].accuracy_pct, last: md[md.length - 1].accuracy_pct, change: md[md.length - 1].accuracy_pct - md[0].accuracy_pct, total: md.reduce((s, d) => s + d.total_predictions, 0) };
      else if (md.length === 1) stats[model] = { first: md[0].accuracy_pct, last: md[0].accuracy_pct, change: 0, total: md[0].total_predictions };
    }
    return stats;
  }, [snapshots]);

  const allModels = useMemo(() => snapshots ? [...new Set(snapshots.map(s => s.model))] : [], [snapshots]);

  const tooltipStyle = {
    contentStyle: { background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px", fontSize: "12px" },
    labelStyle: { color: "rgba(255,255,255,0.5)", marginBottom: "4px" },
  };

  return (
    <div className="space-y-5">
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

      {/* Overall Stats — always shows from prediction records */}
      {predStats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex items-center gap-1.5 mb-1"><Brain className="h-3.5 w-3.5 text-foreground/25" /><p className="text-xs text-foreground/35">总预测</p></div>
            <p className="text-xl font-bold">{predStats.total.toLocaleString()}</p>
            <p className="text-[11px] text-foreground/25 mt-0.5">已验证 {predStats.resolved.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl border border-primary/15 bg-primary/[0.03] p-4">
            <div className="flex items-center gap-1.5 mb-1"><Target className="h-3.5 w-3.5 text-primary/40" /><p className="text-xs text-foreground/35">综合准确率</p></div>
            <p className={`text-xl font-bold ${predStats.accuracy >= 50 ? "text-green-400" : "text-red-400"}`}>{predStats.accuracy.toFixed(1)}%</p>
            <p className="text-[11px] text-foreground/25 mt-0.5">{predStats.correct}/{predStats.resolved} 正确</p>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 col-span-2">
            <div className="flex items-center gap-1.5 mb-2"><BarChart3 className="h-3.5 w-3.5 text-foreground/25" /><p className="text-xs text-foreground/35">各模型 7天准确率</p></div>
            <div className="space-y-1.5">
              {predStats.models.sort((a, b) => b.accuracy_pct - a.accuracy_pct).map(m => (
                <div key={m.model} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: MODEL_COLORS[m.model] || "#888" }} />
                  <span className="text-[11px] font-semibold text-foreground/50 w-16 truncate">{m.model}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div className={`h-full rounded-full ${accBg(m.accuracy_pct)}`} style={{ width: `${Math.min(m.accuracy_pct, 100)}%`, opacity: 0.5 }} />
                  </div>
                  <span className={`text-[11px] font-bold w-10 text-right ${m.accuracy_pct >= 50 ? "text-green-400" : "text-red-400"}`}>{m.accuracy_pct.toFixed(1)}%</span>
                  <span className="text-[10px] text-foreground/20 w-14 text-right">W:{m.computed_weight.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Per-timeframe accuracy */}
      {tfStats && tfStats.length > 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h2 className="text-sm font-bold text-foreground/60 mb-3">{selectedAsset} — 各时间段准确率 (7天)</h2>
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
            {tfStats.map(tf => {
              const color = tf.accuracy >= 60 ? "text-green-400" : tf.accuracy >= 50 ? "text-primary" : tf.accuracy >= 40 ? "text-yellow-400" : "text-red-400";
              return (
                <div key={tf.timeframe} className="rounded-xl bg-white/[0.03] p-3 text-center border border-white/[0.04]">
                  <div className="text-xs font-bold text-foreground/50 mb-1">{tf.timeframe}</div>
                  <div className={`text-lg font-black ${color}`}>{tf.accuracy.toFixed(1)}%</div>
                  <div className="w-full h-1.5 rounded-full bg-white/[0.06] mt-1.5 overflow-hidden">
                    <div className={`h-full rounded-full ${accBg(tf.accuracy)}`} style={{ width: `${Math.min(tf.accuracy, 100)}%`, opacity: 0.5 }} />
                  </div>
                  <div className="text-[10px] text-foreground/25 mt-1">{tf.correct}/{tf.total}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Training Report — prominent since it has rich data */}
      {trainingReport && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 lg:p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-foreground/60">AI 训练报告</h2>
            <span className="text-[10px] text-foreground/20">{new Date(trainingReport.created_at).toLocaleString("zh-CN")}</span>
          </div>

          {trainingReport.recommendations?.length > 0 && (
            <div className="space-y-1.5 mb-4">
              {trainingReport.recommendations.map((r: string, i: number) => (
                <div key={i} className="text-xs text-foreground/50 bg-white/[0.02] rounded-lg px-3 py-2 border border-white/[0.04]">{r}</div>
              ))}
            </div>
          )}

          {trainingReport.model_performance?.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-bold text-foreground/40 mb-2">模型表现（7天）</h3>
              <div className="space-y-2">
                {trainingReport.model_performance.map((m: any) => (
                  <div key={m.model} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.02]">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: MODEL_COLORS[m.model] || "#888" }} />
                    <span className="text-xs font-bold text-foreground/60 w-16 truncate">{m.model}</span>
                    <span className={`text-xs font-bold w-12 ${m.accuracy >= 50 ? "text-green-400" : "text-red-400"}`}>{m.accuracy}%</span>
                    <span className="text-[10px] text-foreground/25">{m.correct}/{m.total}</span>
                    <span className="text-[10px] text-foreground/20">涨:{m.bullishAcc}%</span>
                    <span className="text-[10px] text-foreground/20">跌:{m.bearishAcc}%</span>
                    <span className="text-[10px] text-foreground/15 ml-auto">信心:{m.avgConf}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {trainingReport.timeframe_performance?.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-bold text-foreground/40 mb-2">时间周期表现</h3>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
                {trainingReport.timeframe_performance.map((t: any) => (
                  <div key={t.timeframe} className="rounded-lg bg-white/[0.02] p-2.5 text-center border border-white/[0.04]">
                    <div className="text-xs font-bold text-foreground/50">{t.timeframe}</div>
                    <div className={`text-sm font-bold ${t.accuracy >= 50 ? "text-green-400" : "text-red-400"}`}>{t.accuracy}%</div>
                    <div className="text-[10px] text-foreground/20">{t.total}次</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {trainingReport.trade_attribution?.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-bold text-foreground/40 mb-2">交易归因（模拟盘）</h3>
              <div className="space-y-1.5">
                {trainingReport.trade_attribution.map((t: any) => (
                  <div key={t.model} className="flex items-center gap-2 text-[11px] px-3 py-1.5 rounded-lg bg-white/[0.02]">
                    <div className="w-2 h-2 rounded-full" style={{ background: MODEL_COLORS[t.model] || "#888" }} />
                    <span className="font-bold text-foreground/50 w-16 truncate">{t.model}</span>
                    <span className="text-foreground/30">{t.trades}笔</span>
                    <span className="text-green-400/60">W:{t.wins}</span>
                    <span className="text-red-400/60">L:{t.losses}</span>
                    <span className={`ml-auto font-bold ${t.totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>{t.totalPnl >= 0 ? "+" : ""}{t.totalPnl.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(trainingReport.bias_alerts?.length > 0 || trainingReport.degradation_alerts?.length > 0) && (
            <div>
              <h3 className="text-xs font-bold text-foreground/40 mb-2">告警</h3>
              <div className="space-y-1.5">
                {trainingReport.bias_alerts?.map((a: any, i: number) => (
                  <div key={`b${i}`} className="text-[11px] text-amber-400/70 bg-amber-500/5 rounded-lg px-3 py-1.5 border border-amber-500/10">偏差: {a.message}</div>
                ))}
                {trainingReport.degradation_alerts?.map((a: any, i: number) => (
                  <div key={`d${i}`} className="text-[11px] text-red-400/70 bg-red-500/5 rounded-lg px-3 py-1.5 border border-red-500/10">退化: {a.message}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Model Improvement Cards */}
      {improvementStats && Object.keys(improvementStats).length > 0 && (
        <>
          <h2 className="text-sm font-bold text-foreground/50 mt-2">模型进步趋势</h2>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {Object.entries(improvementStats).map(([model, stat]) => (
              <div key={model} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3 lg:p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: MODEL_COLORS[model] || "#888" }} />
                  <p className="text-[11px] text-foreground/40 font-semibold truncate">{model}</p>
                </div>
                <p className="text-lg lg:text-xl font-bold text-foreground/80">{stat.last.toFixed(1)}%</p>
                <div className="flex items-center gap-1 mt-1">
                  {stat.change > 0 ? <ArrowUpRight className="h-3 w-3 text-green-400" /> : stat.change < 0 ? <ArrowDownRight className="h-3 w-3 text-red-400" /> : <Minus className="h-3 w-3 text-foreground/25" />}
                  <span className={`text-[11px] font-bold ${stat.change > 0 ? "text-green-400" : stat.change < 0 ? "text-red-400" : "text-foreground/25"}`}>{stat.change > 0 ? "+" : ""}{stat.change.toFixed(1)}%</span>
                  <span className="text-[10px] text-foreground/20 ml-1">{stat.total}次</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Calendar */}
      <AccuracyCalendar asset={selectedAsset} adminUser={adminUser} />

      {/* Trend Charts — only when >1 day of data */}
      {chartData && chartData.length > 1 && (
        <>
          <h2 className="text-sm font-bold text-foreground/50 mt-2">历史趋势图表</h2>
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
                  {allModels.map(model => (<Line key={model} type="monotone" dataKey={`${model}_acc`} name={model} stroke={MODEL_COLORS[model] || "#888"} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} connectNulls />))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
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
                  {allModels.map(model => (<Area key={model} type="monotone" dataKey={`${model}_weight`} name={`${model} 权重`} stroke={MODEL_COLORS[model] || "#888"} fill={MODEL_COLORS[model] || "#888"} fillOpacity={0.1} strokeWidth={1.5} connectNulls />))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {isLoading && <div className="space-y-4"><Skeleton className="h-[200px] rounded-2xl" /></div>}
    </div>
  );
}
