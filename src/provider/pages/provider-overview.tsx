import { useQuery } from "@tanstack/react-query";
import { useProviderAuth } from "../provider-app";
import { BarChart3, TrendingUp, TrendingDown, Target, Activity, Minus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://jqgimdgtpwnunrlwexib.supabase.co";

export default function ProviderOverview() {
  const { apiKey, provider } = useProviderAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["provider", "dashboard"],
    queryFn: async () => {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/provider-dashboard?detailed=true`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) throw new Error("Failed to fetch");
      return resp.json();
    },
    enabled: !!apiKey,
    refetchInterval: 30000,
  });

  const stats = data?.stats;
  const signals = data?.recent_signals || [];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">概览</h1>
        {provider?.status === "pending" && (
          <span className="text-[10px] font-bold bg-yellow-500/15 text-yellow-400 border border-yellow-500/20 px-2 py-0.5 rounded-full">
            审核中
          </span>
        )}
      </div>

      {/* Stats Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Activity className="h-3.5 w-3.5 text-primary/60" />
              <p className="text-[11px] text-foreground/35">总信号</p>
            </div>
            <p className="text-2xl font-bold">{stats?.total_signals ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Target className="h-3.5 w-3.5 text-primary/60" />
              <p className="text-[11px] text-foreground/35">胜率</p>
            </div>
            <p className="text-2xl font-bold text-primary">{stats?.win_rate ?? "0.0"}%</p>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingUp className="h-3.5 w-3.5 text-green-400/60" />
              <p className="text-[11px] text-foreground/35">总 PnL</p>
            </div>
            <p className={`text-2xl font-bold ${Number(stats?.total_pnl) >= 0 ? "text-green-400" : "text-red-400"}`}>
              {Number(stats?.total_pnl) >= 0 ? "+" : ""}{Number(stats?.total_pnl || 0).toFixed(2)}
            </p>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Minus className="h-3.5 w-3.5 text-foreground/30" />
              <p className="text-[11px] text-foreground/35">平均信心</p>
            </div>
            <p className="text-2xl font-bold">{Number(stats?.avg_confidence || 0).toFixed(1)}%</p>
          </div>
        </div>
      )}

      {/* Win/Loss breakdown */}
      {stats && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-xs text-foreground/40 mb-3">盈亏分布</p>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-green-400 font-semibold">盈利 {stats.win_count}</span>
                <span className="text-red-400 font-semibold">亏损 {stats.loss_count}</span>
              </div>
              <div className="h-3 rounded-full bg-white/[0.06] overflow-hidden flex">
                {stats.total_signals > 0 && (
                  <>
                    <div className="h-full bg-green-500/70 rounded-l-full" style={{ width: `${(stats.win_count / stats.total_signals) * 100}%` }} />
                    <div className="h-full bg-red-500/70 rounded-r-full" style={{ width: `${(stats.loss_count / stats.total_signals) * 100}%` }} />
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Signals */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <h2 className="text-sm font-bold text-foreground/70">最近信号</h2>
        </div>
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 rounded-lg" />)}
          </div>
        ) : signals.length === 0 ? (
          <div className="p-8 text-center text-foreground/25 text-sm">暂无信号记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-foreground/30 border-b border-white/[0.04]">
                  <th className="text-left px-4 py-2 font-medium">时间</th>
                  <th className="text-left px-4 py-2 font-medium">资产</th>
                  <th className="text-left px-4 py-2 font-medium">操作</th>
                  <th className="text-right px-4 py-2 font-medium">信心</th>
                  <th className="text-right px-4 py-2 font-medium">杠杆</th>
                  <th className="text-left px-4 py-2 font-medium">状态</th>
                  <th className="text-right px-4 py-2 font-medium">PnL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.03]">
                {signals.map((s: any) => (
                  <tr key={s.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 text-foreground/40 whitespace-nowrap">
                      {new Date(s.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-4 py-2.5 font-bold text-foreground/70">{s.asset}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        s.action === "OPEN_LONG" ? "bg-green-500/12 text-green-400" :
                        s.action === "OPEN_SHORT" ? "bg-red-500/12 text-red-400" :
                        "bg-foreground/8 text-foreground/40"
                      }`}>
                        {s.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-foreground/50">{s.confidence}%</td>
                    <td className="px-4 py-2.5 text-right text-foreground/50">{s.leverage}x</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] font-semibold ${
                        s.status === "active" ? "text-primary" :
                        s.status === "executed" ? "text-green-400" :
                        "text-foreground/30"
                      }`}>
                        {s.status}
                      </span>
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono ${
                      s.result_pnl > 0 ? "text-green-400" : s.result_pnl < 0 ? "text-red-400" : "text-foreground/25"
                    }`}>
                      {s.result_pnl != null ? (s.result_pnl > 0 ? "+" : "") + Number(s.result_pnl).toFixed(4) : "—"}
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
