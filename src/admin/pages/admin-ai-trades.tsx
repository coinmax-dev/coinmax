import { useQuery } from "@tanstack/react-query";
import { useAdminAuth } from "@/admin/admin-auth";
import { supabase } from "@/lib/supabase";
import { Activity, TrendingUp, TrendingDown, RefreshCw, Settings2, Play, Key } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect, useMemo } from "react";
import { AICoinPicker } from "@/components/strategy/ai-coin-picker";
import { ApiKeyBind } from "@/components/strategy/api-key-bind";

const ASSETS = ["全部", "BTC", "ETH", "SOL", "BNB", "DOGE", "XRP", "ADA", "AVAX", "LINK", "DOT"];
const TABS = ["持仓中", "历史记录", "信号流", "AI选币", "模拟设置", "交易所绑定"] as const;
type Tab = typeof TABS[number];

const STRATEGY_LABELS: Record<string, string> = {
  trend_following: "趋势跟踪",
  mean_reversion: "均值回归",
  breakout: "突破",
  scalping: "短线",
  momentum: "动量",
  swing: "波段",
  directional: "方向",
  grid: "网格",
  dca: "定投",
  pattern: "K线形态",
  avellaneda: "做市",
  twap: "TWAP",
  market_making: "做市商",
  arbitrage: "套利",
  position_executor: "仓位执行",
  stochastic: "随机指标",
  ichimoku: "一目均衡",
  vwap_reversion: "VWAP回归",
  rsi_divergence: "RSI背离",
  donchian: "唐奇安",
  bb_squeeze: "布林挤压",
  funding_rate: "资金费率",
};

const PAGE_SIZE = 20;

interface PaperTrade {
  id: string;
  signal_id: string | null;
  asset: string;
  side: string;
  entry_price: number;
  exit_price: number | null;
  size: number;
  leverage: number;
  ai_reasoning: string | null;
  ai_models_consensus: any[] | null;
  primary_model: string | null;
  stop_loss: number;
  take_profit: number;
  pnl: number | null;
  pnl_pct: number | null;
  close_reason: string | null;
  strategy_type: string | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
}

interface TradeSignal {
  id: string;
  asset: string;
  action: string;
  direction: string;
  confidence: number;
  strength: string;
  leverage: number;
  strategy_type: string;
  source_models: string[];
  status: string;
  created_at: string;
}

function formatPrice(price: number | null | undefined): string {
  if (!price || price <= 0) return "—";
  if (price >= 1000) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(4)}`;
}

function formatPnl(pnl: number | null | undefined): string {
  if (pnl === null || pnl === undefined) return "—";
  const prefix = pnl >= 0 ? "+" : "";
  return `${prefix}${pnl.toFixed(4)}`;
}

function formatPnlPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return "";
  const prefix = pct >= 0 ? "+" : "";
  return `${prefix}${pct.toFixed(2)}%`;
}

function pnlColor(v: number | null | undefined): string {
  if (v === null || v === undefined) return "text-foreground/30";
  return v >= 0 ? "text-green-400" : "text-red-400";
}

function SideBadge({ side }: { side: string }) {
  if (side === "LONG") return <span className="inline-flex items-center gap-0.5 text-xs font-bold text-green-400 bg-green-500/10 px-2 py-0.5 rounded"><TrendingUp className="h-3 w-3" />做多</span>;
  return <span className="inline-flex items-center gap-0.5 text-xs font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded"><TrendingDown className="h-3 w-3" />做空</span>;
}

function StrengthBadge({ strength }: { strength: string }) {
  const cls = strength === "STRONG" ? "text-green-400 bg-green-500/10" : strength === "MEDIUM" ? "text-yellow-400 bg-yellow-500/10" : "text-orange-400 bg-orange-500/10";
  const label = strength === "STRONG" ? "强" : strength === "MEDIUM" ? "中" : "弱";
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cls}`}>{label}</span>;
}

function StrategyBadge({ type }: { type: string | null }) {
  if (!type) return null;
  return <span className="text-[11px] font-semibold text-foreground/40 bg-white/[0.05] px-2 py-0.5 rounded">{STRATEGY_LABELS[type] || type}</span>;
}

function timeSince(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}分钟`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时`;
  const days = Math.floor(hours / 24);
  return `${days}天`;
}

export default function AdminAITrades() {
  const { adminUser } = useAdminAuth();
  const [tab, setTab] = useState<Tab>("持仓中");
  const [assetFilter, setAssetFilter] = useState("全部");
  const [modelFilter, setModelFilter] = useState("全部");
  const [historyPage, setHistoryPage] = useState(0);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null);
  const [simRunning, setSimRunning] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);

  // Simulation config from DB
  const [simConfig, setSimConfig] = useState({
    positionSize: 1000,
    maxPositions: 15,
    maxLeverage: 5,
    maxDrawdownPct: 10,
    cooldownMin: 5,
    strategies: ["trend_following", "mean_reversion", "breakout", "scalping", "momentum", "swing"] as string[],
    assets: ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"] as string[],
  });

  // Load config from DB
  const { refetch: refetchConfig } = useQuery({
    queryKey: ["admin", "simulation-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("simulation_config")
        .select("*")
        .eq("id", 1)
        .single();
      if (error) throw error;
      if (data) {
        setSimConfig({
          positionSize: data.position_size_usd ?? 1000,
          maxPositions: data.max_positions ?? 15,
          maxLeverage: data.max_leverage ?? 5,
          maxDrawdownPct: data.max_drawdown_pct ?? 10,
          cooldownMin: data.cooldown_min ?? 5,
          strategies: data.enabled_strategies ?? [],
          assets: data.enabled_assets ?? [],
        });
      }
      return data;
    },
    enabled: !!adminUser,
  });

  const handleSaveConfig = async () => {
    setConfigSaving(true);
    try {
      const { error } = await supabase.from("simulation_config").update({
        position_size_usd: simConfig.positionSize,
        max_positions: simConfig.maxPositions,
        max_leverage: simConfig.maxLeverage,
        max_drawdown_pct: simConfig.maxDrawdownPct,
        cooldown_min: simConfig.cooldownMin,
        enabled_strategies: simConfig.strategies,
        enabled_assets: simConfig.assets,
        updated_at: new Date().toISOString(),
      }).eq("id", 1);
      if (error) throw error;
      alert("配置已保存");
    } catch (err: any) {
      alert(`保存失败: ${err.message}`);
    } finally {
      setConfigSaving(false);
    }
  };

  const handleRunSimulation = async () => {
    setSimRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("simulate-trading");
      if (error) throw error;
      refetchOpen();
      refetchConfig();
      alert(`模拟完成: ${data.signals_generated}个信号, ${data.paper_trades_opened}个开仓, ${data.paper_trades_closed}个平仓`);
    } catch (err: any) {
      alert(`模拟失败: ${err.message}`);
    } finally {
      setSimRunning(false);
    }
  };

  // Fetch live prices (Binance + CoinGecko fallback)
  const CG_IDS: Record<string, string> = { BTC:"bitcoin",ETH:"ethereum",SOL:"solana",BNB:"binancecoin",DOGE:"dogecoin",XRP:"ripple",ADA:"cardano",AVAX:"avalanche-2",LINK:"chainlink",DOT:"polkadot" };
  useEffect(() => {
    async function fetchPricesData() {
      const assets = ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP", "ADA", "AVAX", "LINK", "DOT"];
      const results: Record<string, number> = {};
      // Try Binance batch
      try {
        const symbols = assets.map(a => `"${a}USDT"`).join(",");
        const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbols=[${symbols}]`);
        if (res.ok) { const data = await res.json(); for (const d of data) { const a = d.symbol.replace("USDT",""); const p = parseFloat(d.price); if (p > 0) results[a] = p; } }
      } catch {}
      // Fallback CoinGecko
      if (Object.keys(results).length < 5) {
        try {
          const ids = assets.map(a => CG_IDS[a]).filter(Boolean).join(",");
          const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);
          if (res.ok) { const data = await res.json(); for (const a of assets) { const cg = CG_IDS[a]; if (cg && data[cg]?.usd && !results[a]) results[a] = data[cg].usd; } }
        } catch {}
      }
      setPrices(results);
    }
    fetchPricesData();
    const interval = setInterval(fetchPricesData, 15000);
    return () => clearInterval(interval);
  }, []);

  // Open positions
  const { data: openTrades, isLoading: openLoading, refetch: refetchOpen } = useQuery({
    queryKey: ["admin", "paper-trades-open"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paper_trades")
        .select("*")
        .eq("status", "OPEN")
        .order("opened_at", { ascending: false });
      if (error) throw error;
      return data as PaperTrade[];
    },
    enabled: !!adminUser,
    refetchInterval: 30000,
  });

  // Closed trades (paginated)
  const { data: closedTrades, isLoading: closedLoading } = useQuery({
    queryKey: ["admin", "paper-trades-closed", historyPage, assetFilter],
    queryFn: async () => {
      let q = supabase
        .from("paper_trades")
        .select("*", { count: "exact" })
        .eq("status", "CLOSED")
        .order("closed_at", { ascending: false })
        .range(historyPage * PAGE_SIZE, (historyPage + 1) * PAGE_SIZE - 1);
      if (assetFilter !== "全部") q = q.eq("asset", assetFilter);
      const { data, error, count } = await q;
      if (error) throw error;
      return { data: data as PaperTrade[], count: count ?? 0 };
    },
    enabled: !!adminUser,
  });

  // Global stats (all closed trades, not paginated)
  const { data: globalStats } = useQuery({
    queryKey: ["admin", "paper-trades-stats"],
    queryFn: async () => {
      const [
        { count: totalClosed },
        { count: wins },
        { data: pnlData },
        { data: todayData },
      ] = await Promise.all([
        supabase.from("paper_trades").select("*", { count: "exact", head: true }).eq("status", "CLOSED"),
        supabase.from("paper_trades").select("*", { count: "exact", head: true }).eq("status", "CLOSED").gt("pnl", 0),
        supabase.from("paper_trades").select("pnl").eq("status", "CLOSED"),
        supabase.from("paper_trades").select("pnl").eq("status", "CLOSED").gte("closed_at", new Date().toISOString().slice(0, 10)),
      ]);
      const totalPnl = pnlData?.reduce((s: number, t: any) => s + (t.pnl ?? 0), 0) ?? 0;
      const todayPnl = todayData?.reduce((s: number, t: any) => s + (t.pnl ?? 0), 0) ?? 0;

      // Calculate daily average PnL
      const { data: dateRange } = await supabase
        .from("paper_trades")
        .select("closed_at")
        .eq("status", "CLOSED")
        .order("closed_at", { ascending: true })
        .limit(1);
      let tradingDays = 1;
      if (dateRange && dateRange.length > 0 && dateRange[0].closed_at) {
        const firstDay = new Date(dateRange[0].closed_at).getTime();
        tradingDays = Math.max(1, Math.ceil((Date.now() - firstDay) / 86400000));
      }
      const dailyAvgPnl = totalPnl / tradingDays;

      return {
        totalClosed: totalClosed ?? 0,
        wins: wins ?? 0,
        winRate: (totalClosed ?? 0) > 0 ? ((wins ?? 0) / (totalClosed ?? 1)) * 100 : 0,
        totalPnl,
        todayPnl,
        dailyAvgPnl,
        tradingDays,
      };
    },
    enabled: !!adminUser,
    refetchInterval: 30000,
  });

  // Recent signals
  const { data: signals, isLoading: sigLoading } = useQuery({
    queryKey: ["admin", "trade-signals", assetFilter],
    queryFn: async () => {
      let q = supabase
        .from("trade_signals")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (assetFilter !== "全部") q = q.eq("asset", assetFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data as TradeSignal[];
    },
    enabled: !!adminUser,
  });

  // Compute summary stats including unrealized PnL
  const summary = useMemo(() => {
    let unrealizedPnl = 0;
    if (openTrades) {
      for (const t of openTrades) {
        const cp = prices[t.asset];
        if (cp && cp > 0) {
          const mul = t.side === "LONG" ? 1 : -1;
          unrealizedPnl += (cp - t.entry_price) * mul * t.size * t.leverage;
        }
      }
    }
    return {
      openCount: openTrades?.length ?? 0,
      signalCount: signals?.length ?? 0,
      todayPnl: globalStats?.todayPnl ?? 0,
      totalPnl: globalStats?.totalPnl ?? 0,
      unrealizedPnl,
      winRate: globalStats?.winRate ?? 0,
      totalClosed: globalStats?.totalClosed ?? 0,
      wins: globalStats?.wins ?? 0,
      dailyAvgPnl: globalStats?.dailyAvgPnl ?? 0,
      tradingDays: globalStats?.tradingDays ?? 0,
    };
  }, [openTrades, signals, globalStats, prices]);

  // Parse ai_models_consensus (may be string or array)
  const parseConsensus = (t: PaperTrade): any[] => {
    if (!t.ai_models_consensus) return [];
    if (Array.isArray(t.ai_models_consensus)) return t.ai_models_consensus;
    try { return JSON.parse(t.ai_models_consensus as any); } catch { return []; }
  };

  // Filter open trades by asset + primary model
  const filteredOpen = useMemo(() => {
    if (!openTrades) return [];
    let filtered = openTrades;
    if (assetFilter !== "全部") filtered = filtered.filter(t => t.asset === assetFilter);
    if (modelFilter !== "全部") {
      filtered = filtered.filter(t => t.primary_model === modelFilter);
    }
    return filtered;
  }, [openTrades, assetFilter, modelFilter]);

  const totalHistoryPages = Math.ceil((closedTrades?.count ?? 0) / PAGE_SIZE);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Activity className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold text-foreground">AI 模拟开单</h1>
        </div>
        <button onClick={() => refetchOpen()} className="h-8 w-8 rounded-lg flex items-center justify-center text-foreground/40 hover:text-foreground/70 hover:bg-white/[0.05] transition-colors">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Summary Cards — mobile 2 cols, desktop 3 cols */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-[10px] text-foreground/35 mb-0.5">持仓 / 金额</p>
          <p className="text-lg font-bold">{summary.openCount}<span className="text-xs text-foreground/40 ml-1">${((openTrades?.reduce((s, t) => s + t.size * t.entry_price, 0) ?? 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></p>
        </div>
        <div className={`rounded-xl border p-3 ${summary.unrealizedPnl >= 0 ? "border-green-500/15 bg-green-500/[0.03]" : "border-red-500/15 bg-red-500/[0.03]"}`}>
          <p className="text-[10px] text-foreground/35 mb-0.5">未实现盈亏</p>
          <p className={`text-lg font-bold ${pnlColor(summary.unrealizedPnl)}`}>{formatPnl(summary.unrealizedPnl)}</p>
          <p className="text-[9px] text-foreground/20">收益率 {((summary.unrealizedPnl / Math.max(1, (openTrades?.reduce((s, t) => s + t.size * t.entry_price, 0) ?? 1))) * 100).toFixed(2)}%</p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-[10px] text-foreground/35 mb-0.5">今日已实现</p>
          <p className={`text-lg font-bold ${pnlColor(summary.todayPnl)}`}>{formatPnl(summary.todayPnl)}</p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-[10px] text-foreground/35 mb-0.5">累计盈亏</p>
          <p className={`text-lg font-bold ${pnlColor(summary.totalPnl)}`}>{formatPnl(summary.totalPnl)}</p>
          <p className="text-[9px] text-foreground/20">{summary.totalClosed}笔 · 胜率{summary.winRate.toFixed(0)}%</p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-[10px] text-foreground/35 mb-0.5">日均收益率</p>
          <p className={`text-lg font-bold ${pnlColor(summary.dailyAvgPnl)}`}>
            {summary.tradingDays > 0 ? `${(summary.dailyAvgPnl / 1000 * 100).toFixed(2)}%` : "—"}
          </p>
          <p className="text-[9px] text-foreground/20">{summary.tradingDays}天</p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-[10px] text-foreground/35 mb-0.5">信号 / 模型数</p>
          <p className="text-lg font-bold">{summary.signalCount}<span className="text-xs text-foreground/40 ml-1">/ 5模型</span></p>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-1.5">
        {/* Asset filter — scrollable */}
        <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
          {ASSETS.map((a) => (
            <button key={a} onClick={() => { setAssetFilter(a); setHistoryPage(0); }}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg shrink-0 transition-all ${assetFilter === a ? "bg-primary/15 text-primary" : "text-foreground/30 hover:text-foreground/50"}`}
            >{a}</button>
          ))}
        </div>
        {/* Model filter — scrollable */}
        <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
          {[
            { label: "全部模型", value: "全部" },
            { label: "GPT-4o", value: "GPT-4o" },
            { label: "Claude", value: "Claude" },
            { label: "Gemini", value: "Gemini" },
            { label: "DeepSeek", value: "DeepSeek" },
            { label: "Llama", value: "Llama" },
            { label: "Agent", value: "openclaw-agent" },
          ].map((m) => (
            <button key={m.value} onClick={() => setModelFilter(m.value)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg shrink-0 transition-all ${
                modelFilter === m.value ? "bg-purple-500/15 text-purple-400" : "text-foreground/30 hover:text-foreground/50"
              }`}
            >{m.label}</button>
          ))}
        </div>
        {/* Tabs — scrollable */}
        <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg shrink-0 transition-all ${tab === t ? "bg-primary/15 text-primary border border-primary/20" : "text-foreground/30 hover:text-foreground/50"}`}
            >{t}</button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {tab === "持仓中" && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <h2 className="text-sm font-bold text-foreground/70">当前持仓 ({filteredOpen.length})</h2>
          </div>
          {openLoading ? (
            <div className="p-4 space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
          ) : filteredOpen.length === 0 ? (
            <div className="p-8 text-center text-foreground/25 text-sm">暂无持仓</div>
          ) : (
            <>
              {/* Mobile: cards */}
              <div className="lg:hidden divide-y divide-white/[0.04]">
                {filteredOpen.map((t) => {
                  const currentPrice = prices[t.asset] ?? 0;
                  const unrealizedPnl = currentPrice > 0
                    ? (t.side === "LONG" ? (currentPrice - t.entry_price) : (t.entry_price - currentPrice)) * t.size * t.leverage
                    : null;
                  const unrealizedPct = currentPrice > 0 && t.entry_price > 0
                    ? ((t.side === "LONG" ? (currentPrice - t.entry_price) : (t.entry_price - currentPrice)) / t.entry_price) * 100 * t.leverage
                    : null;
                  return (
                    <div key={t.id} className="px-4 py-3 space-y-2 cursor-pointer" onClick={() => setExpandedTrade(expandedTrade === t.id ? null : t.id)}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-foreground/80">{t.asset}</span>
                          <SideBadge side={t.side} />
                          <span className="text-[10px] text-foreground/25">{t.leverage}x</span>
                          <StrategyBadge type={t.strategy_type} />
                          {t.primary_model && <span className="text-[9px] text-purple-400/60 bg-purple-500/10 px-1 rounded">🤖{t.primary_model}</span>}
                        </div>
                        <span className="text-[10px] text-foreground/20">{timeSince(t.opened_at)}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div>
                          <p className="text-foreground/25">入场价</p>
                          <p className="text-foreground/50 font-mono">{formatPrice(t.entry_price)}</p>
                        </div>
                        <div>
                          <p className="text-foreground/25">现价</p>
                          <p className="text-foreground/50 font-mono">{currentPrice > 0 ? formatPrice(currentPrice) : "加载中..."}</p>
                        </div>
                        <div>
                          <p className="text-foreground/25">未实现盈亏</p>
                          <p className={`font-mono font-bold ${pnlColor(unrealizedPnl)}`}>
                            {unrealizedPnl !== null ? formatPnl(unrealizedPnl) : "—"}
                            {unrealizedPct !== null && <span className="text-[9px] ml-0.5">({formatPnlPct(unrealizedPct)})</span>}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-foreground/20">
                        <span>金额: ${(t.size * t.entry_price).toFixed(0)}</span>
                        <span>SL: {formatPrice(t.stop_loss)}</span>
                        <span>TP: {formatPrice(t.take_profit)}</span>
                      </div>
                      {/* AI Reasoning — click to expand */}
                      {(() => {
                        const models = parseConsensus(t);
                        return (
                          <>
                            {expandedTrade === t.id && (t.ai_reasoning || models.length > 0) && (
                              <div className="mt-1.5 px-2 py-2 rounded-lg bg-primary/[0.04] border border-primary/10 space-y-2" onClick={e => e.stopPropagation()}>
                                <p className="text-[10px] text-foreground/35 font-semibold">🤖 AI 开仓理由</p>
                                {t.ai_reasoning && <p className="text-[11px] text-foreground/60 leading-relaxed">{t.ai_reasoning}</p>}
                                {models.length > 0 && (
                                  <>
                                    <p className="text-[10px] text-foreground/35 font-semibold mt-2">模型共识 ({models.filter((m: any) => m.direction === "BULLISH").length} 看涨 / {models.filter((m: any) => m.direction === "BEARISH").length} 看跌 / {models.filter((m: any) => m.direction === "NEUTRAL").length} 中性)</p>
                                    <div className="space-y-1.5">
                                      {models.map((m: any, i: number) => (
                                        <div key={i} className={`px-2 py-1.5 rounded-lg border ${m.direction === "BULLISH" ? "border-green-500/15 bg-green-500/[0.04]" : m.direction === "BEARISH" ? "border-red-500/15 bg-red-500/[0.04]" : "border-white/[0.06] bg-white/[0.02]"}`}>
                                          <div className="flex items-center justify-between">
                                            <span className="text-[11px] font-bold text-foreground/60">{m.model}</span>
                                            <span className={`text-[10px] font-bold ${m.direction === "BULLISH" ? "text-green-400" : m.direction === "BEARISH" ? "text-red-400" : "text-foreground/40"}`}>
                                              {m.direction === "BULLISH" ? "↑ 看涨" : m.direction === "BEARISH" ? "↓ 看跌" : "— 中性"} {m.confidence}%
                                            </span>
                                          </div>
                                          {m.reasoning && <p className="text-[10px] text-foreground/40 mt-1 leading-relaxed">{m.reasoning}</p>}
                                        </div>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                            {expandedTrade !== t.id && (t.ai_reasoning || models.length > 0) && (
                              <div className="flex items-center gap-2 mt-0.5">
                                <p className="text-[9px] text-purple-400/40">点击查看 AI 分析详情</p>
                                <div className="flex gap-0.5">
                                  {models.slice(0, 5).map((m: any, i: number) => (
                                    <span key={i} className={`w-1.5 h-1.5 rounded-full ${m.direction === "BULLISH" ? "bg-green-500/60" : m.direction === "BEARISH" ? "bg-red-500/60" : "bg-foreground/20"}`} title={`${m.model}: ${m.direction}`} />
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>

              {/* Desktop: table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-foreground/30 border-b border-white/[0.04]">
                      <th className="text-left px-4 py-2 font-medium">资产</th>
                      <th className="text-left px-4 py-2 font-medium">方向</th>
                      <th className="text-left px-4 py-2 font-medium">策略</th>
                      <th className="text-right px-4 py-2 font-medium">金额</th>
                      <th className="text-right px-4 py-2 font-medium">入场价</th>
                      <th className="text-right px-4 py-2 font-medium">现价</th>
                      <th className="text-right px-4 py-2 font-medium">未实现盈亏</th>
                      <th className="text-center px-4 py-2 font-medium">杠杆</th>
                      <th className="text-right px-4 py-2 font-medium">止损</th>
                      <th className="text-right px-4 py-2 font-medium">止盈</th>
                      <th className="text-right px-4 py-2 font-medium">持仓时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.03]">
                    {filteredOpen.map((t) => {
                      const currentPrice = prices[t.asset] ?? 0;
                      const unrealizedPnl = currentPrice > 0
                        ? (t.side === "LONG" ? (currentPrice - t.entry_price) : (t.entry_price - currentPrice)) * t.size * t.leverage
                        : null;
                      const unrealizedPct = currentPrice > 0 && t.entry_price > 0
                        ? ((t.side === "LONG" ? (currentPrice - t.entry_price) : (t.entry_price - currentPrice)) / t.entry_price) * 100 * t.leverage
                        : null;
                      return (
                        <tr key={t.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-2.5 font-bold text-foreground/70">{t.asset}</td>
                          <td className="px-4 py-2.5"><SideBadge side={t.side} /></td>
                          <td className="px-4 py-2.5"><StrategyBadge type={t.strategy_type} /></td>
                          <td className="px-4 py-2.5 text-right font-mono text-foreground/60 font-bold">${(t.size * t.entry_price).toFixed(0)}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-foreground/50">{formatPrice(t.entry_price)}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-foreground/50">{currentPrice > 0 ? formatPrice(currentPrice) : "—"}</td>
                          <td className={`px-4 py-2.5 text-right font-mono font-bold ${pnlColor(unrealizedPnl)}`}>
                            {unrealizedPnl !== null ? `${formatPnl(unrealizedPnl)} (${formatPnlPct(unrealizedPct)})` : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-center text-foreground/40">{t.leverage}x</td>
                          <td className="px-4 py-2.5 text-right font-mono text-foreground/30">{formatPrice(t.stop_loss)}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-foreground/30">{formatPrice(t.take_profit)}</td>
                          <td className="px-4 py-2.5 text-right text-foreground/30">{timeSince(t.opened_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "历史记录" && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
            <h2 className="text-sm font-bold text-foreground/70">交易历史 ({closedTrades?.count ?? 0})</h2>
            {totalHistoryPages > 1 && (
              <div className="flex items-center gap-2 text-xs">
                <button onClick={() => setHistoryPage(p => Math.max(0, p - 1))} disabled={historyPage === 0}
                  className="px-2 py-1 rounded text-foreground/40 hover:text-foreground/70 disabled:opacity-30 disabled:cursor-not-allowed">上一页</button>
                <span className="text-foreground/30">{historyPage + 1}/{totalHistoryPages}</span>
                <button onClick={() => setHistoryPage(p => Math.min(totalHistoryPages - 1, p + 1))} disabled={historyPage >= totalHistoryPages - 1}
                  className="px-2 py-1 rounded text-foreground/40 hover:text-foreground/70 disabled:opacity-30 disabled:cursor-not-allowed">下一页</button>
              </div>
            )}
          </div>
          {closedLoading ? (
            <div className="p-4 space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
          ) : !closedTrades?.data || closedTrades.data.length === 0 ? (
            <div className="p-8 text-center text-foreground/25 text-sm">暂无历史记录</div>
          ) : (
            <>
              {/* Mobile: cards */}
              <div className="lg:hidden divide-y divide-white/[0.04]">
                {closedTrades.data.map((t) => (
                  <div key={t.id} className="px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-foreground/80">{t.asset}</span>
                        <SideBadge side={t.side} />
                        <StrategyBadge type={t.strategy_type} />
                      </div>
                      <span className={`text-sm font-bold ${pnlColor(t.pnl)}`}>{formatPnl(t.pnl)}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        <p className="text-foreground/25">入场</p>
                        <p className="text-foreground/50 font-mono">{formatPrice(t.entry_price)}</p>
                      </div>
                      <div>
                        <p className="text-foreground/25">出场</p>
                        <p className="text-foreground/50 font-mono">{formatPrice(t.exit_price)}</p>
                      </div>
                      <div>
                        <p className="text-foreground/25">盈亏%</p>
                        <p className={`font-mono ${pnlColor(t.pnl_pct)}`}>{formatPnlPct(t.pnl_pct)}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-foreground/20">
                      <span>{t.close_reason ?? "—"}</span>
                      <span>{t.closed_at ? new Date(t.closed_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-foreground/30 border-b border-white/[0.04]">
                      <th className="text-left px-4 py-2 font-medium">资产</th>
                      <th className="text-left px-4 py-2 font-medium">方向</th>
                      <th className="text-left px-4 py-2 font-medium">策略</th>
                      <th className="text-right px-4 py-2 font-medium">入场价</th>
                      <th className="text-right px-4 py-2 font-medium">出场价</th>
                      <th className="text-right px-4 py-2 font-medium">盈亏</th>
                      <th className="text-right px-4 py-2 font-medium">盈亏%</th>
                      <th className="text-left px-4 py-2 font-medium">平仓原因</th>
                      <th className="text-right px-4 py-2 font-medium">时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.03]">
                    {closedTrades.data.map((t) => (
                      <tr key={t.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-2.5 font-bold text-foreground/70">{t.asset}</td>
                        <td className="px-4 py-2.5"><SideBadge side={t.side} /></td>
                        <td className="px-4 py-2.5"><StrategyBadge type={t.strategy_type} /></td>
                        <td className="px-4 py-2.5 text-right font-mono text-foreground/50">{formatPrice(t.entry_price)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-foreground/50">{formatPrice(t.exit_price)}</td>
                        <td className={`px-4 py-2.5 text-right font-mono font-bold ${pnlColor(t.pnl)}`}>{formatPnl(t.pnl)}</td>
                        <td className={`px-4 py-2.5 text-right font-mono ${pnlColor(t.pnl_pct)}`}>{formatPnlPct(t.pnl_pct)}</td>
                        <td className="px-4 py-2.5 text-foreground/35">{t.close_reason ?? "—"}</td>
                        <td className="px-4 py-2.5 text-right text-foreground/30 whitespace-nowrap">
                          {t.closed_at ? new Date(t.closed_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "信号流" && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <h2 className="text-sm font-bold text-foreground/70">最近信号 (最新50条)</h2>
          </div>
          {sigLoading ? (
            <div className="p-4 space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-8 rounded-lg" />)}</div>
          ) : !signals || signals.length === 0 ? (
            <div className="p-8 text-center text-foreground/25 text-sm">暂无信号</div>
          ) : (
            <>
              {/* Mobile: cards */}
              <div className="lg:hidden divide-y divide-white/[0.04]">
                {signals.map((s) => (
                  <div key={s.id} className="px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-foreground/80">{s.asset}</span>
                        <SideBadge side={s.direction === "LONG" ? "LONG" : s.direction === "SHORT" ? "SHORT" : s.direction} />
                        <StrengthBadge strength={s.strength} />
                      </div>
                      <span className="text-[10px] text-foreground/20">{timeSince(s.created_at)}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-foreground/35">
                      <span>信心 <strong className="text-foreground/50">{s.confidence}%</strong></span>
                      <span>杠杆 <strong className="text-foreground/50">{s.leverage}x</strong></span>
                      <span>策略 <strong className="text-foreground/50">{s.strategy_type}</strong></span>
                      <span>状态 <strong className={s.status === "executed" ? "text-green-400/60" : "text-foreground/50"}>{s.status}</strong></span>
                    </div>
                    {s.source_models?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {s.source_models.map((m, i) => (
                          <span key={i} className="text-[9px] text-foreground/25 bg-white/[0.04] rounded px-1.5 py-0.5">{m}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop: table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-foreground/30 border-b border-white/[0.04]">
                      <th className="text-left px-4 py-2 font-medium">资产</th>
                      <th className="text-left px-4 py-2 font-medium">方向</th>
                      <th className="text-center px-4 py-2 font-medium">强度</th>
                      <th className="text-right px-4 py-2 font-medium">信心</th>
                      <th className="text-center px-4 py-2 font-medium">杠杆</th>
                      <th className="text-left px-4 py-2 font-medium">策略</th>
                      <th className="text-left px-4 py-2 font-medium">来源模型</th>
                      <th className="text-center px-4 py-2 font-medium">状态</th>
                      <th className="text-right px-4 py-2 font-medium">时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.03]">
                    {signals.map((s) => (
                      <tr key={s.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-2.5 font-bold text-foreground/70">{s.asset}</td>
                        <td className="px-4 py-2.5"><SideBadge side={s.direction === "LONG" ? "LONG" : s.direction === "SHORT" ? "SHORT" : s.direction} /></td>
                        <td className="px-4 py-2.5 text-center"><StrengthBadge strength={s.strength} /></td>
                        <td className="px-4 py-2.5 text-right text-foreground/50">{s.confidence}%</td>
                        <td className="px-4 py-2.5 text-center text-foreground/40">{s.leverage}x</td>
                        <td className="px-4 py-2.5 text-foreground/40">{s.strategy_type}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {s.source_models?.map((m, i) => (
                              <span key={i} className="text-[10px] text-foreground/30 bg-white/[0.04] rounded px-1 py-0.5">{m}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${s.status === "executed" ? "text-green-400/60 bg-green-500/8" : "text-foreground/35 bg-white/[0.04]"}`}>{s.status}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-foreground/30 whitespace-nowrap">
                          {new Date(s.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "AI选币" && (
        <AICoinPicker />
      )}

      {tab === "交易所绑定" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 lg:p-5">
            <div className="flex items-center gap-2 mb-3">
              <Key className="h-4 w-4 text-primary/60" />
              <h2 className="text-sm font-bold text-foreground/60">交易所 API 绑定</h2>
            </div>
            <p className="text-[11px] text-foreground/30 mb-4">
              绑定交易所 API Key 后，AI 模拟下单可连接真实交易所执行。支持 6 大交易所：Binance、Bybit、OKX、Bitget、HyperLiquid、dYdX v4。
              密钥使用 AES-256-GCM 加密存储，仅开启交易权限，禁用提币。
            </p>
            <ApiKeyBind userId="admin" />
          </div>

          {/* Exchange API Documentation */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 lg:p-5">
            <h3 className="text-xs font-bold text-foreground/40 mb-3">交易所 API 文档</h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {[
                { name: "Binance", url: "https://www.binance.com/en/support/faq/how-to-create-api-keys-on-binance-360002502072", icon: "₿", desc: "合约交易 HMAC-SHA256 签名, /fapi/v2/account" },
                { name: "Bybit", url: "https://www.bybit.com/en/help-center/article/How-to-create-your-API-key", icon: "▲", desc: "统一账户 V5 API, /v5/account/wallet-balance" },
                { name: "OKX", url: "https://www.okx.com/help/how-do-i-create-an-api-key", icon: "◎", desc: "需要 Passphrase, /api/v5/account/balance" },
                { name: "Bitget", url: "https://www.bitget.com/academy/how-to-create-an-api-key", icon: "◆", desc: "需要 Passphrase, /api/v2/mix/account/account" },
                { name: "HyperLiquid", url: "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api", icon: "H", desc: "DEX EIP-712 签名, POST /info & /exchange" },
                { name: "dYdX v4", url: "https://docs.dydx.exchange/api_integration-guides/how_to_trade_on_dydx_v4", icon: "D", desc: "Cosmos SDK 助记词, 去中心化订单簿" },
              ].map(ex => (
                <a
                  key={ex.name}
                  href={ex.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 px-3 py-3 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-primary/20 hover:bg-primary/[0.02] transition-all group"
                >
                  <span className="text-lg mt-0.5">{ex.icon}</span>
                  <div>
                    <p className="text-xs font-bold text-foreground/60 group-hover:text-primary transition-colors">{ex.name}</p>
                    <p className="text-[10px] text-foreground/25 mt-0.5">{ex.desc}</p>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "模拟设置" && (
        <div className="space-y-4">
          {/* Config Panel */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 lg:p-5">
            <div className="flex items-center gap-2 mb-4">
              <Settings2 className="h-4 w-4 text-primary/60" />
              <h2 className="text-sm font-bold text-foreground/60">模拟交易参数</h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Position Size */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-foreground/40 font-semibold">仓位金额 (USDT)</label>
                <input
                  type="number" min={100} max={10000} step={100}
                  value={simConfig.positionSize}
                  onChange={e => setSimConfig(c => ({ ...c, positionSize: Number(e.target.value) }))}
                  className="w-full h-9 rounded-lg px-3 text-sm text-foreground bg-white/[0.04] border border-white/[0.08] outline-none focus:border-primary/30"
                />
                <p className="text-[10px] text-foreground/20">每个策略信号触发后的开仓金额</p>
              </div>

              {/* Max Positions */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-foreground/40 font-semibold">最大持仓数</label>
                <input
                  type="number" min={1} max={30} step={1}
                  value={simConfig.maxPositions}
                  onChange={e => setSimConfig(c => ({ ...c, maxPositions: Number(e.target.value) }))}
                  className="w-full h-9 rounded-lg px-3 text-sm text-foreground bg-white/[0.04] border border-white/[0.08] outline-none focus:border-primary/30"
                />
                <p className="text-[10px] text-foreground/20">所有资产+策略的最大同时持仓数</p>
              </div>

              {/* Max Leverage */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-foreground/40 font-semibold">最大杠杆</label>
                <input
                  type="number" min={1} max={20} step={1}
                  value={simConfig.maxLeverage}
                  onChange={e => setSimConfig(c => ({ ...c, maxLeverage: Number(e.target.value) }))}
                  className="w-full h-9 rounded-lg px-3 text-sm text-foreground bg-white/[0.04] border border-white/[0.08] outline-none focus:border-primary/30"
                />
                <p className="text-[10px] text-foreground/20">策略允许使用的最大杠杆倍数</p>
              </div>

              {/* Max Drawdown */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-foreground/40 font-semibold">最大回撤 (%)</label>
                <input
                  type="number" min={1} max={50} step={1}
                  value={simConfig.maxDrawdownPct}
                  onChange={e => setSimConfig(c => ({ ...c, maxDrawdownPct: Number(e.target.value) }))}
                  className="w-full h-9 rounded-lg px-3 text-sm text-foreground bg-white/[0.04] border border-white/[0.08] outline-none focus:border-primary/30"
                />
                <p className="text-[10px] text-foreground/20">达到最大回撤后暂停开新仓</p>
              </div>

              {/* Cooldown */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-foreground/40 font-semibold">冷却时间 (分钟)</label>
                <input
                  type="number" min={1} max={60} step={1}
                  value={simConfig.cooldownMin}
                  onChange={e => setSimConfig(c => ({ ...c, cooldownMin: Number(e.target.value) }))}
                  className="w-full h-9 rounded-lg px-3 text-sm text-foreground bg-white/[0.04] border border-white/[0.08] outline-none focus:border-primary/30"
                />
                <p className="text-[10px] text-foreground/20">同一资产+策略止损后的冷却期</p>
              </div>
            </div>
          </div>

          {/* AI Model Selection */}
          <div className="rounded-2xl border border-purple-500/15 bg-purple-500/[0.03] p-4 lg:p-5">
            <h3 className="text-xs font-bold text-foreground/40 mb-1">AI 分析模型</h3>
            <p className="text-[10px] text-foreground/20 mb-3">开单需要至少 2 个模型同意方向才执行</p>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {[
                { id: "GPT-4o", desc: "OpenAI · 综合分析最强", cost: "~$0.15/M" },
                { id: "Claude", desc: "Anthropic · 推理能力最强", cost: "~$0.25/M" },
                { id: "Gemini", desc: "Google · 多模态分析", cost: "免费额度" },
                { id: "DeepSeek", desc: "深度求索 · 中文最强", cost: "~$0.07/M" },
                { id: "Llama", desc: "CF Workers · 开源免费", cost: "免费" },
                { id: "OpenClaw", desc: "本地 Agent · Mac Mini", cost: "本地" },
              ].map(m => (
                <div key={m.id} className="px-3 py-2.5 rounded-xl border border-purple-500/15 bg-white/[0.02]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground/60">{m.id}</span>
                    <span className="text-[9px] text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">在线</span>
                  </div>
                  <p className="text-[9px] text-foreground/25 mt-0.5">{m.desc}</p>
                  <p className="text-[9px] text-foreground/15">{m.cost}</p>
                </div>
              ))}
            </div>
          </div>

          {/* AI Suggested Parameters */}
          <div className="rounded-2xl border border-primary/15 bg-primary/[0.03] p-4 lg:p-5">
            <h3 className="text-xs font-bold text-foreground/40 mb-1">🤖 AI 建议参数</h3>
            <p className="text-[10px] text-foreground/20 mb-3">基于当前市场环境和历史表现的建议设置</p>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 text-[11px]">
              <div className="bg-white/[0.03] rounded-lg p-2">
                <p className="text-foreground/25">仓位金额</p>
                <p className="text-primary font-bold">$500 - $1,000</p>
                <p className="text-[9px] text-foreground/15">极端恐慌时建议小仓</p>
              </div>
              <div className="bg-white/[0.03] rounded-lg p-2">
                <p className="text-foreground/25">杠杆</p>
                <p className="text-primary font-bold">1x - 3x</p>
                <p className="text-[9px] text-foreground/15">高波动期降低杠杆</p>
              </div>
              <div className="bg-white/[0.03] rounded-lg p-2">
                <p className="text-foreground/25">最大持仓</p>
                <p className="text-primary font-bold">15 - 20 个</p>
                <p className="text-[9px] text-foreground/15">分散风险，不过度集中</p>
              </div>
              <div className="bg-white/[0.03] rounded-lg p-2">
                <p className="text-foreground/25">止损</p>
                <p className="text-primary font-bold">1.5% - 3%</p>
                <p className="text-[9px] text-foreground/15">根据 ATR 动态调整</p>
              </div>
              <div className="bg-white/[0.03] rounded-lg p-2">
                <p className="text-foreground/25">止盈</p>
                <p className="text-primary font-bold">3% - 6%</p>
                <p className="text-[9px] text-foreground/15">{"R:R >= 2:1"}</p>
              </div>
              <div className="bg-white/[0.03] rounded-lg p-2">
                <p className="text-foreground/25">最大回撤</p>
                <p className="text-primary font-bold">5% - 10%</p>
                <p className="text-[9px] text-foreground/15">触发后暂停开新仓</p>
              </div>
            </div>
          </div>

          {/* Strategy Selection */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 lg:p-5">
            <h3 className="text-xs font-bold text-foreground/40 mb-3">启用策略</h3>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {Object.entries(STRATEGY_LABELS).filter(([k]) => k !== "directional" && k !== "funding_rate").map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setSimConfig(c => ({
                    ...c,
                    strategies: c.strategies.includes(key)
                      ? c.strategies.filter(s => s !== key)
                      : [...c.strategies, key],
                  }))}
                  className={`px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
                    simConfig.strategies.includes(key)
                      ? "bg-primary/10 text-primary border-primary/20"
                      : "bg-white/[0.02] text-foreground/30 border-white/[0.06] hover:text-foreground/50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Asset Selection */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 lg:p-5">
            <h3 className="text-xs font-bold text-foreground/40 mb-3">交易资产</h3>
            <div className="flex flex-wrap gap-2">
              {["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP", "ADA", "AVAX", "LINK", "DOT"].map((a) => (
                <button
                  key={a}
                  onClick={() => setSimConfig(c => ({
                    ...c,
                    assets: c.assets.includes(a)
                      ? c.assets.filter(x => x !== a)
                      : [...c.assets, a],
                  }))}
                  className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                    simConfig.assets.includes(a)
                      ? "bg-primary/10 text-primary border-primary/20"
                      : "bg-white/[0.02] text-foreground/30 border-white/[0.06] hover:text-foreground/50"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {/* Save + Run Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleSaveConfig}
              disabled={configSaving}
              className="flex-1 h-12 rounded-xl text-sm font-bold text-foreground border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] transition-all active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <Settings2 className="h-4 w-4" />
              {configSaving ? "保存中..." : "保存配置"}
            </button>
            <button
              onClick={handleRunSimulation}
              disabled={simRunning || simConfig.strategies.length === 0 || simConfig.assets.length === 0}
              className="flex-1 h-12 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-2"
              style={{
                background: "linear-gradient(135deg, #0abab5, #34d399)",
                boxShadow: "0 4px 15px rgba(10,186,181,0.3)",
              }}
            >
              <Play className="h-4 w-4" />
              {simRunning ? "模拟运行中..." : "手动触发模拟"}
            </button>
          </div>

          {/* Config Summary */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <h3 className="text-xs font-bold text-foreground/40 mb-2">当前配置摘要</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-[11px]">
              <div className="bg-white/[0.03] rounded-lg p-2">
                <p className="text-foreground/25">仓位</p>
                <p className="text-foreground/60 font-bold">${simConfig.positionSize}</p>
              </div>
              <div className="bg-white/[0.03] rounded-lg p-2">
                <p className="text-foreground/25">最大持仓</p>
                <p className="text-foreground/60 font-bold">{simConfig.maxPositions}个</p>
              </div>
              <div className="bg-white/[0.03] rounded-lg p-2">
                <p className="text-foreground/25">策略数</p>
                <p className="text-foreground/60 font-bold">{simConfig.strategies.length}个</p>
              </div>
              <div className="bg-white/[0.03] rounded-lg p-2">
                <p className="text-foreground/25">最大敞口</p>
                <p className="text-foreground/60 font-bold">${(simConfig.positionSize * simConfig.maxPositions).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
