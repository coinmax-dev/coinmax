import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminAuth } from "@/admin/admin-auth";
import { supabase } from "@/lib/supabase";
import { Radio, RefreshCw, Check, X, Ban, Clock, Eye, ChevronDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";

type ProviderStatus = "pending" | "approved" | "suspended" | "rejected";

interface Provider {
  id: string;
  name: string;
  slug: string;
  contact_email: string;
  description: string;
  website: string;
  api_key_prefix: string;
  allowed_assets: string[];
  max_leverage: number;
  status: ProviderStatus;
  approved_by: string | null;
  approved_at: string | null;
  total_signals: number;
  win_count: number;
  loss_count: number;
  total_pnl: number;
  avg_confidence: number;
  last_signal_at: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<ProviderStatus, { label: string; color: string; icon: any }> = {
  pending: { label: "待审核", color: "bg-yellow-500/12 text-yellow-400 border-yellow-500/20", icon: Clock },
  approved: { label: "已通过", color: "bg-green-500/12 text-green-400 border-green-500/20", icon: Check },
  suspended: { label: "已暂停", color: "bg-red-500/12 text-red-400 border-red-500/20", icon: Ban },
  rejected: { label: "已拒绝", color: "bg-foreground/8 text-foreground/40 border-foreground/10", icon: X },
};

const TABS: { value: ProviderStatus | "all"; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "suspended", label: "已暂停" },
];

export default function AdminProviders() {
  const { adminUser } = useAdminAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ProviderStatus | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: providers, isLoading, refetch } = useQuery({
    queryKey: ["admin", "providers", tab],
    queryFn: async () => {
      let query = supabase
        .from("strategy_providers")
        .select("*")
        .order("created_at", { ascending: false });
      if (tab !== "all") query = query.eq("status", tab);
      const { data, error } = await query;
      if (error) throw error;
      return data as Provider[];
    },
    enabled: !!adminUser,
  });

  const { data: stats } = useQuery({
    queryKey: ["admin", "provider-stats"],
    queryFn: async () => {
      const { data, error } = await supabase.from("strategy_providers").select("status");
      if (error) throw error;
      const rows = data ?? [];
      return {
        total: rows.length,
        pending: rows.filter(r => r.status === "pending").length,
        approved: rows.filter(r => r.status === "approved").length,
        suspended: rows.filter(r => r.status === "suspended").length,
      };
    },
    enabled: !!adminUser,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ProviderStatus }) => {
      const updates: any = { status, updated_at: new Date().toISOString() };
      if (status === "approved") {
        updates.approved_by = adminUser;
        updates.approved_at = new Date().toISOString();
      }
      const { error } = await supabase.from("strategy_providers").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "providers"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "provider-stats"] });
    },
  });

  const pendingCount = stats?.pending ?? 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Radio className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold text-foreground">策略提供方</h1>
          {pendingCount > 0 && (
            <span className="text-[10px] font-bold bg-yellow-500/15 text-yellow-400 border border-yellow-500/20 px-2 py-0.5 rounded-full">
              {pendingCount} 待审核
            </span>
          )}
        </div>
        <button onClick={() => refetch()} className="h-8 w-8 rounded-lg flex items-center justify-center text-foreground/40 hover:text-foreground/70 hover:bg-white/[0.05] transition-colors">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-[11px] text-foreground/35 mb-1">总提供方</p>
          <p className="text-xl font-bold">{stats?.total ?? "—"}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-[11px] text-foreground/35 mb-1">已通过</p>
          <p className="text-xl font-bold text-green-400">{stats?.approved ?? "—"}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-[11px] text-foreground/35 mb-1">待审核</p>
          <p className="text-xl font-bold text-yellow-400">{stats?.pending ?? "—"}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-[11px] text-foreground/35 mb-1">已暂停</p>
          <p className="text-xl font-bold text-red-400">{stats?.suspended ?? "—"}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex rounded-xl border border-white/[0.06] overflow-hidden w-fit">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-4 py-1.5 text-xs font-semibold transition-all ${tab === t.value ? "bg-primary/15 text-primary" : "text-foreground/35 hover:text-foreground/60"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Provider List */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
          </div>
        ) : !providers || providers.length === 0 ? (
          <div className="p-8 text-center text-foreground/25 text-sm">暂无策略提供方</div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {providers.map((p) => {
              const sc = STATUS_CONFIG[p.status];
              const StatusIcon = sc.icon;
              const winRate = p.total_signals > 0 ? ((p.win_count / p.total_signals) * 100).toFixed(1) : "—";
              const isExpanded = expanded === p.id;

              return (
                <div key={p.id}>
                  <div
                    className="px-4 py-3 flex items-center gap-4 cursor-pointer hover:bg-white/[0.02] transition-colors"
                    onClick={() => setExpanded(isExpanded ? null : p.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-bold text-foreground/80 truncate">{p.name}</p>
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${sc.color}`}>
                          <StatusIcon className="h-3 w-3" />
                          {sc.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-foreground/35">
                        <span>{p.contact_email}</span>
                        <span>Key: {p.api_key_prefix}...</span>
                        <span>{new Date(p.created_at).toLocaleDateString("zh-CN")}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 text-xs text-foreground/50 shrink-0">
                      <div className="text-center">
                        <p className="font-bold text-foreground/70">{p.total_signals}</p>
                        <p className="text-[10px] text-foreground/30">信号</p>
                      </div>
                      <div className="text-center">
                        <p className="font-bold text-foreground/70">{winRate}%</p>
                        <p className="text-[10px] text-foreground/30">胜率</p>
                      </div>
                      <div className="text-center">
                        <p className={`font-bold ${Number(p.total_pnl) >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {Number(p.total_pnl) >= 0 ? "+" : ""}{Number(p.total_pnl).toFixed(2)}
                        </p>
                        <p className="text-[10px] text-foreground/30">PnL</p>
                      </div>
                    </div>

                    <ChevronDown className={`h-4 w-4 text-foreground/25 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 border-t border-white/[0.03]">
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                        <div>
                          <p className="text-[10px] text-foreground/30 mb-0.5">描述</p>
                          <p className="text-xs text-foreground/60">{p.description || "—"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-foreground/30 mb-0.5">网站</p>
                          <p className="text-xs text-foreground/60">{p.website || "—"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-foreground/30 mb-0.5">允许资产</p>
                          <p className="text-xs text-foreground/60">{p.allowed_assets?.join(", ") || "—"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-foreground/30 mb-0.5">最大杠杆</p>
                          <p className="text-xs text-foreground/60">{p.max_leverage}x</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                        <div>
                          <p className="text-[10px] text-foreground/30 mb-0.5">平均信心</p>
                          <p className="text-xs text-foreground/60">{Number(p.avg_confidence).toFixed(1)}%</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-foreground/30 mb-0.5">最近信号</p>
                          <p className="text-xs text-foreground/60">
                            {p.last_signal_at ? new Date(p.last_signal_at).toLocaleString("zh-CN") : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-foreground/30 mb-0.5">审核人</p>
                          <p className="text-xs text-foreground/60">{p.approved_by || "—"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-foreground/30 mb-0.5">审核时间</p>
                          <p className="text-xs text-foreground/60">
                            {p.approved_at ? new Date(p.approved_at).toLocaleString("zh-CN") : "—"}
                          </p>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-2">
                        {p.status === "pending" && (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: p.id, status: "approved" }); }}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors"
                            >
                              通过
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: p.id, status: "rejected" }); }}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                            >
                              拒绝
                            </button>
                          </>
                        )}
                        {p.status === "approved" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: p.id, status: "suspended" }); }}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20 transition-colors"
                          >
                            暂停
                          </button>
                        )}
                        {p.status === "suspended" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: p.id, status: "approved" }); }}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors"
                          >
                            恢复
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
