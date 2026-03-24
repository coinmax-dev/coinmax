/**
 * Copy Trading Dashboard — Shows open positions, closed history, PnL stats, model performance
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { BarChart3, TrendingUp, TrendingDown, Clock, DollarSign, Target, AlertTriangle } from "lucide-react";

export function CopyTradingDashboard({ wallet }: { wallet: string }) {
  const { data: openPositions } = useQuery({
    queryKey: ["copy-open", wallet],
    queryFn: async () => {
      const { data } = await supabase
        .from("copy_trade_orders")
        .select("*")
        .eq("user_wallet", wallet)
        .in("status", ["filled", "partial"])
        .order("opened_at", { ascending: false });
      return data || [];
    },
    refetchInterval: 15000,
  });

  const { data: closedTrades } = useQuery({
    queryKey: ["copy-closed", wallet],
    queryFn: async () => {
      const { data } = await supabase
        .from("copy_trade_orders")
        .select("*")
        .eq("user_wallet", wallet)
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(50);
      return data || [];
    },
    refetchInterval: 30000,
  });

  const { data: config } = useQuery({
    queryKey: ["copy-config", wallet],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_trade_configs")
        .select("*")
        .eq("wallet_address", wallet)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      return data;
    },
  });

  const totalPnl = closedTrades?.reduce((s, t) => s + (t.pnl_usd || 0), 0) || 0;
  const totalFees = closedTrades?.reduce((s, t) => s + (t.fee_usd || 0), 0) || 0;
  const wins = closedTrades?.filter(t => (t.pnl_usd || 0) > 0).length || 0;
  const totalTrades = closedTrades?.length || 0;
  const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Status Bar */}
      <div className="flex items-center gap-2">
        <div className={cn(
          "px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5",
          config?.is_active
            ? "bg-green-500/10 text-green-400 border border-green-500/20"
            : "bg-red-500/10 text-red-400 border border-red-500/20"
        )}>
          <div className={cn("w-1.5 h-1.5 rounded-full", config?.is_active ? "bg-green-400 animate-pulse" : "bg-red-400")} />
          {config?.is_active ? "跟单运行中" : "已暂停"}
        </div>
        <span className="text-[10px] text-foreground/25">
          {config?.execution_mode === "paper" ? "模拟模式" :
           config?.execution_mode === "signal" ? "信号模式" :
           config?.execution_mode === "semi-auto" ? "半自动" : "全自动"}
          {" · "}{config?.exchange || "未配置"}
        </span>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-2">
        <StatCard icon={<DollarSign className="h-3 w-3" />} label="总盈亏" value={`$${totalPnl.toFixed(2)}`} color={totalPnl >= 0 ? "green" : "red"} />
        <StatCard icon={<Target className="h-3 w-3" />} label="胜率" value={`${winRate.toFixed(0)}%`} color={winRate >= 50 ? "green" : "yellow"} />
        <StatCard icon={<BarChart3 className="h-3 w-3" />} label="总交易" value={`${totalTrades}`} color="blue" />
        <StatCard icon={<AlertTriangle className="h-3 w-3" />} label="手续费" value={`$${totalFees.toFixed(2)}`} color="purple" />
      </div>

      {/* Open Positions */}
      <div className="rounded-xl bg-white/[0.02] p-4" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
        <h3 className="text-xs font-bold text-foreground/50 mb-3 flex items-center gap-2">
          <Clock className="h-3.5 w-3.5" />
          持仓中 ({openPositions?.length || 0})
        </h3>
        {!openPositions?.length ? (
          <p className="text-[11px] text-foreground/20 text-center py-4">暂无持仓</p>
        ) : (
          <div className="space-y-2">
            {openPositions.map(pos => <PositionRow key={pos.id} pos={pos} />)}
          </div>
        )}
      </div>

      {/* Closed History */}
      <div className="rounded-xl bg-white/[0.02] p-4" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
        <h3 className="text-xs font-bold text-foreground/50 mb-3 flex items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5" />
          历史记录 ({closedTrades?.length || 0})
        </h3>
        {!closedTrades?.length ? (
          <p className="text-[11px] text-foreground/20 text-center py-4">暂无记录</p>
        ) : (
          <div className="space-y-1.5">
            {closedTrades.slice(0, 20).map(trade => <TradeRow key={trade.id} trade={trade} />)}
          </div>
        )}
      </div>

      {/* Model Performance */}
      {closedTrades && closedTrades.length > 0 && (
        <div className="rounded-xl bg-white/[0.02] p-4" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
          <h3 className="text-xs font-bold text-foreground/50 mb-3">模型表现</h3>
          <ModelPerformance trades={closedTrades} />
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    green: "text-green-400 bg-green-500/8 border-green-500/15",
    red: "text-red-400 bg-red-500/8 border-red-500/15",
    blue: "text-blue-400 bg-blue-500/8 border-blue-500/15",
    yellow: "text-yellow-400 bg-yellow-500/8 border-yellow-500/15",
    purple: "text-purple-400 bg-purple-500/8 border-purple-500/15",
  };
  return (
    <div className={cn("rounded-lg p-2.5 border", colors[color] || colors.blue)}>
      <div className="flex items-center gap-1 mb-1 opacity-60">{icon}<span className="text-[9px]">{label}</span></div>
      <div className="text-[13px] font-bold font-mono">{value}</div>
    </div>
  );
}

function PositionRow({ pos }: { pos: any }) {
  const isLong = pos.side === "LONG";
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.02]" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
      <div className="flex items-center gap-2.5">
        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", isLong ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400")}>
          {pos.side}
        </span>
        <div>
          <span className="text-[12px] font-semibold text-foreground/70">{pos.symbol?.replace("-USDT", "")}</span>
          <span className="text-[10px] text-foreground/25 ml-1.5">{pos.leverage}x</span>
        </div>
      </div>
      <div className="text-right">
        <div className="text-[11px] font-mono text-foreground/50">${pos.size_usd?.toFixed(0)}</div>
        <div className="text-[9px] text-foreground/25">{pos.primary_model} · {pos.strategy_type}</div>
      </div>
    </div>
  );
}

function TradeRow({ trade }: { trade: any }) {
  const pnl = trade.pnl_usd || 0;
  const isWin = pnl > 0;
  return (
    <div className="flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-white/[0.02] transition-colors">
      <div className="flex items-center gap-2">
        {isWin ? <TrendingUp className="h-3 w-3 text-green-400" /> : <TrendingDown className="h-3 w-3 text-red-400" />}
        <span className="text-[11px] font-medium text-foreground/60">{trade.symbol?.replace("-USDT", "")}</span>
        <span className={cn("text-[9px] px-1 rounded", trade.side === "LONG" ? "text-green-400/60" : "text-red-400/60")}>{trade.side}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[9px] text-foreground/20">{trade.primary_model}</span>
        <span className={cn("text-[11px] font-mono font-semibold", isWin ? "text-green-400" : "text-red-400")}>
          {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function ModelPerformance({ trades }: { trades: any[] }) {
  const models: Record<string, { wins: number; losses: number; pnl: number }> = {};
  for (const t of trades) {
    const m = t.primary_model || "unknown";
    if (!models[m]) models[m] = { wins: 0, losses: 0, pnl: 0 };
    models[m].pnl += t.pnl_usd || 0;
    if ((t.pnl_usd || 0) > 0) models[m].wins++;
    else models[m].losses++;
  }

  return (
    <div className="space-y-2">
      {Object.entries(models).sort((a, b) => b[1].pnl - a[1].pnl).map(([model, stats]) => {
        const total = stats.wins + stats.losses;
        const wr = total > 0 ? (stats.wins / total * 100) : 0;
        return (
          <div key={model} className="flex items-center justify-between px-2 py-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-foreground/60">{model}</span>
              <span className="text-[9px] text-foreground/20">{total}单</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-foreground/30">WR {wr.toFixed(0)}%</span>
              <span className={cn("text-[11px] font-mono font-bold", stats.pnl >= 0 ? "text-green-400" : "text-red-400")}>
                {stats.pnl >= 0 ? "+" : ""}{stats.pnl.toFixed(2)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
