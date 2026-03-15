import { useQuery } from "@tanstack/react-query";
import { useProviderAuth } from "../provider-app";
import { List, ChevronLeft, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://jqgimdgtpwnunrlwexib.supabase.co";
const ASSETS = ["all", "BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"];
const STATUSES = ["all", "active", "executed", "expired", "cancelled"];

export default function ProviderSignals() {
  const { apiKey } = useProviderAuth();
  const [page, setPage] = useState(1);
  const [asset, setAsset] = useState("all");
  const [status, setStatus] = useState("all");

  const { data, isLoading } = useQuery({
    queryKey: ["provider", "signals", page, asset, status],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (asset !== "all") params.set("asset", asset);
      if (status !== "all") params.set("status", status);

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/provider-signals?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) throw new Error("Failed");
      return resp.json();
    },
    enabled: !!apiKey,
  });

  const signals = data?.signals || [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <List className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">信号记录</h1>
        <span className="text-xs text-foreground/30">共 {total} 条</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="flex rounded-xl border border-white/[0.06] overflow-hidden">
          {ASSETS.map((a) => (
            <button
              key={a}
              onClick={() => { setAsset(a); setPage(1); }}
              className={`px-3 py-1.5 text-xs font-semibold transition-all ${asset === a ? "bg-primary/15 text-primary" : "text-foreground/35 hover:text-foreground/60"}`}
            >
              {a === "all" ? "全部" : a}
            </button>
          ))}
        </div>
        <div className="flex rounded-xl border border-white/[0.06] overflow-hidden">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => { setStatus(s); setPage(1); }}
              className={`px-3 py-1.5 text-xs font-semibold transition-all ${status === s ? "bg-primary/15 text-primary" : "text-foreground/35 hover:text-foreground/60"}`}
            >
              {s === "all" ? "全部" : s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 rounded-lg" />)}
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
                  <th className="text-left px-4 py-2 font-medium">方向</th>
                  <th className="text-right px-4 py-2 font-medium">信心</th>
                  <th className="text-left px-4 py-2 font-medium">强度</th>
                  <th className="text-right px-4 py-2 font-medium">杠杆</th>
                  <th className="text-right px-4 py-2 font-medium">止损</th>
                  <th className="text-right px-4 py-2 font-medium">止盈</th>
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
                        s.action === "CLOSE" ? "bg-yellow-500/12 text-yellow-400" :
                        "bg-foreground/8 text-foreground/40"
                      }`}>
                        {s.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-foreground/50">{s.direction || "—"}</td>
                    <td className="px-4 py-2.5 text-right text-foreground/50">{s.confidence}%</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] font-semibold ${
                        s.strength === "STRONG" ? "text-green-400" :
                        s.strength === "MEDIUM" ? "text-yellow-400" :
                        "text-foreground/30"
                      }`}>
                        {s.strength || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-foreground/50">{s.leverage}x</td>
                    <td className="px-4 py-2.5 text-right text-foreground/40">{(Number(s.stop_loss_pct) * 100).toFixed(1)}%</td>
                    <td className="px-4 py-2.5 text-right text-foreground/40">{(Number(s.take_profit_pct) * 100).toFixed(1)}%</td>
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.04]">
            <span className="text-xs text-foreground/30">第 {page} / {totalPages} 页</span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-foreground/40 hover:text-foreground/70 disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-foreground/40 hover:text-foreground/70 disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
