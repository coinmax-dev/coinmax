import { useQuery } from "@tanstack/react-query";
import { useProviderAuth } from "../provider-app";
import { DollarSign, TrendingUp, Users, Percent } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://jqgimdgtpwnunrlwexib.supabase.co";

export default function ProviderRevenue() {
  const { apiKey } = useProviderAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["provider", "revenue"],
    queryFn: async () => {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/provider-dashboard?detailed=true`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) throw new Error("Failed");
      return resp.json();
    },
    enabled: !!apiKey,
  });

  const stats = data?.stats;
  const signals = data?.recent_signals || [];

  // Calculate revenue estimates
  const totalPnl = Number(stats?.total_pnl || 0);
  const profitShare = totalPnl > 0 ? totalPnl * 0.2 : 0; // 20% of profit

  // Monthly breakdown (from recent signals)
  const monthlyData: Record<string, { signals: number; pnl: number }> = {};
  for (const s of signals) {
    const month = new Date(s.created_at).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit" });
    if (!monthlyData[month]) monthlyData[month] = { signals: 0, pnl: 0 };
    monthlyData[month].signals++;
    monthlyData[month].pnl += Number(s.result_pnl || 0);
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center gap-2.5">
        <DollarSign className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">收益分成</h1>
      </div>

      {/* Revenue Summary */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingUp className="h-3.5 w-3.5 text-primary/60" />
              <p className="text-[11px] text-foreground/35">总策略收益</p>
            </div>
            <p className={`text-xl font-bold ${totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
              ${Math.abs(totalPnl).toFixed(2)}
            </p>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Percent className="h-3.5 w-3.5 text-green-400/60" />
              <p className="text-[11px] text-foreground/35">您的分成 (20%)</p>
            </div>
            <p className="text-xl font-bold text-green-400">${profitShare.toFixed(2)}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Users className="h-3.5 w-3.5 text-primary/60" />
              <p className="text-[11px] text-foreground/35">订阅用户</p>
            </div>
            <p className="text-xl font-bold">—</p>
            <p className="text-[10px] text-foreground/20">即将上线</p>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <DollarSign className="h-3.5 w-3.5 text-yellow-400/60" />
              <p className="text-[11px] text-foreground/35">订阅收入</p>
            </div>
            <p className="text-xl font-bold">—</p>
            <p className="text-[10px] text-foreground/20">即将上线</p>
          </div>
        </div>
      )}

      {/* Revenue Model */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-foreground/70 mb-4">分成模型</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: "rgba(10,186,181,0.04)", border: "1px solid rgba(10,186,181,0.1)" }}>
            <div>
              <p className="text-sm font-semibold text-foreground/70">策略盈利分成</p>
              <p className="text-[11px] text-foreground/35">基于跟单用户的实际盈利</p>
            </div>
            <span className="text-lg font-bold text-primary">20%</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <div>
              <p className="text-sm font-semibold text-foreground/70">用户订阅费分成</p>
              <p className="text-[11px] text-foreground/35">VIP 用户月订阅费</p>
            </div>
            <span className="text-lg font-bold text-foreground/60">50%</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <div>
              <p className="text-sm font-semibold text-foreground/70">推荐新用户奖励</p>
              <p className="text-[11px] text-foreground/35">通过策略带来的新注册用户</p>
            </div>
            <span className="text-lg font-bold text-foreground/60">+5%</span>
          </div>
        </div>
        <p className="text-[10px] text-foreground/20 mt-3">* 具体分成比例以合约为准</p>
      </div>

      {/* Monthly Breakdown */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-foreground/70 mb-4">月度明细</h2>
        {Object.keys(monthlyData).length === 0 ? (
          <p className="text-xs text-foreground/25">暂无交易数据</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(monthlyData).sort().reverse().map(([month, data]) => {
              const share = data.pnl > 0 ? data.pnl * 0.2 : 0;
              return (
                <div key={month} className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.02]">
                  <div>
                    <p className="text-sm font-semibold text-foreground/70">{month}</p>
                    <p className="text-[11px] text-foreground/30">{data.signals} 笔信号</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${data.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {data.pnl >= 0 ? "+" : ""}${data.pnl.toFixed(2)}
                    </p>
                    <p className="text-[11px] text-foreground/30">分成: ${share.toFixed(2)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Payout Info */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-foreground/70 mb-3">提现规则</h2>
        <div className="text-xs text-foreground/40 space-y-2">
          <p>1. 每月 1 日结算上月收益</p>
          <p>2. 最低提现金额: $50</p>
          <p>3. 支持 USDT (BEP-20) 打款</p>
          <p>4. 提现申请后 3 个工作日内到账</p>
        </div>
      </div>
    </div>
  );
}
