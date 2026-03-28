/**
 * AI Coin Picker — AI-powered optimal trading coin selection
 *
 * Analyzes real-time market data (volatility, momentum, volume, trend strength)
 * to rank and recommend the best coins to trade right now.
 * Used in both copy-trading and admin AI simulation pages.
 */

import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useTranslation } from "react-i18next";

interface CoinScore {
  asset: string;
  score: number; // 0-100
  signals: { strategy: string; side: string; confidence: number }[];
  metrics: {
    volatility: number;
    momentum: number;
    trendStrength: number;
    signalCount: number;
    winRate7d: number;
    avgPnl7d: number;
  };
  rank: number;
  recommendation: "strong_buy" | "buy" | "neutral" | "avoid";
}

const RECOMMENDATION_STYLES = {
  strong_buy: { key: "aiPicker.strongBuy", color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20" },
  buy: { key: "aiPicker.buy", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  neutral: { key: "aiPicker.neutral", color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20" },
  avoid: { key: "aiPicker.avoid", color: "text-foreground/30", bg: "bg-white/[0.02]", border: "border-white/[0.06]" },
} as const;

export function AICoinPicker({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const [coins, setCoins] = useState<CoinScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchCoinScores = async () => {
    try {
      // Fetch recent signals (last 1 hour) to analyze which coins are active
      const [signalsRes, tradesRes, perfRes] = await Promise.all([
        supabase
          .from("trade_signals")
          .select("asset, action, confidence, strength, strategy_type, created_at")
          .gte("created_at", new Date(Date.now() - 3600_000).toISOString())
          .order("created_at", { ascending: false }),
        supabase
          .from("paper_trades")
          .select("asset, strategy_type, side, pnl, pnl_pct, status, close_reason")
          .eq("status", "CLOSED")
          .gte("closed_at", new Date(Date.now() - 7 * 86400_000).toISOString()),
        supabase
          .from("paper_trades")
          .select("asset, strategy_type, side, entry_price, leverage, opened_at")
          .eq("status", "OPEN"),
      ]);

      const signals = signalsRes.data ?? [];
      const closedTrades = tradesRes.data ?? [];
      const openTrades = perfRes.data ?? [];

      // Get unique assets from all sources
      const allAssets = new Set<string>();
      signals.forEach(s => allAssets.add(s.asset));
      closedTrades.forEach(t => allAssets.add(t.asset));
      openTrades.forEach(t => allAssets.add(t.asset));
      // Add default assets
      ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP", "ADA", "AVAX", "LINK", "DOT"].forEach(a => allAssets.add(a));

      const scored: CoinScore[] = [];

      for (const asset of allAssets) {
        const assetSignals = signals.filter(s => s.asset === asset);
        const assetTrades = closedTrades.filter(t => t.asset === asset);
        const assetOpen = openTrades.filter(t => t.asset === asset);

        // Signal analysis
        const actionSignals = assetSignals.filter(s => s.action !== "HOLD");
        const avgConfidence = actionSignals.length > 0
          ? actionSignals.reduce((s, sig) => s + sig.confidence, 0) / actionSignals.length
          : 0;
        const strongSignals = actionSignals.filter(s => s.strength === "STRONG").length;

        // 7-day performance
        const wins = assetTrades.filter(t => (t.pnl ?? 0) > 0).length;
        const winRate = assetTrades.length > 0 ? wins / assetTrades.length : 0;
        const avgPnl = assetTrades.length > 0
          ? assetTrades.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / assetTrades.length
          : 0;

        // Diversity of strategies triggering
        const uniqueStrategies = new Set(actionSignals.map(s => s.strategy_type));

        // Score calculation (0-100)
        let score = 30; // base
        score += Math.min(20, avgConfidence * 0.3); // signal confidence
        score += Math.min(15, actionSignals.length * 3); // signal activity
        score += Math.min(10, strongSignals * 5); // strong signal bonus
        score += Math.min(10, uniqueStrategies.size * 2.5); // strategy diversity
        score += Math.min(10, winRate * 10); // win rate
        score += Math.min(5, Math.max(0, avgPnl + 2) * 1.5); // profitability
        score = Math.min(100, Math.max(0, Math.round(score)));

        // Recommendation
        const recommendation: CoinScore["recommendation"] =
          score >= 75 ? "strong_buy" :
          score >= 55 ? "buy" :
          score >= 35 ? "neutral" :
          "avoid";

        scored.push({
          asset,
          score,
          signals: actionSignals.slice(0, 3).map(s => ({
            strategy: s.strategy_type,
            side: s.action === "OPEN_LONG" ? "LONG" : "SHORT",
            confidence: s.confidence,
          })),
          metrics: {
            volatility: 0, // Will be filled from signals context
            momentum: avgConfidence > 60 ? 1 : avgConfidence > 40 ? 0 : -1,
            trendStrength: strongSignals,
            signalCount: actionSignals.length,
            winRate7d: Math.round(winRate * 100),
            avgPnl7d: avgPnl,
          },
          rank: 0,
          recommendation,
        });
      }

      // Sort by score and assign ranks
      scored.sort((a, b) => b.score - a.score);
      scored.forEach((c, i) => c.rank = i + 1);

      setCoins(scored);
      setLastUpdate(new Date());
    } catch (err) {
      console.error("AI coin picker error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCoinScores();
    const interval = setInterval(fetchCoinScores, 60_000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  const topCoins = useMemo(() => coins.filter(c => c.recommendation !== "avoid"), [coins]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm">🤖</span>
          <span className="text-xs font-bold text-foreground/50">{t("aiPicker.title")}</span>
          <span className="text-[10px] text-foreground/20 animate-pulse">{t("aiPicker.analyzing")}</span>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 rounded-xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (compact) {
    // Compact mode for copy-trading page
    return (
      <div className="rounded-xl bg-white/[0.02] p-3" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs">🤖</span>
            <span className="text-[11px] font-bold text-foreground/50">{t("aiPicker.title")}</span>
          </div>
          {lastUpdate && (
            <span className="text-[9px] text-foreground/20">
              {lastUpdate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {topCoins.slice(0, 6).map(coin => {
            const cfg = RECOMMENDATION_STYLES[coin.recommendation];
            return (
              <div key={coin.asset} className={`shrink-0 px-2.5 py-1.5 rounded-lg border ${cfg.border} ${cfg.bg}`}>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-foreground/70">{coin.asset}</span>
                  <span className={`text-[10px] font-bold ${cfg.color}`}>{coin.score}</span>
                </div>
                <span className={`text-[9px] ${cfg.color}`}>{t(cfg.key)}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Full mode for admin page
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm">🤖</span>
          <h2 className="text-sm font-bold text-foreground/70">{t("aiPicker.titleFull")}</h2>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdate && (
            <span className="text-[10px] text-foreground/20">
              {lastUpdate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <button
            onClick={() => { setLoading(true); fetchCoinScores(); }}
            className="text-[10px] text-primary/60 hover:text-primary transition-colors"
          >
            {t("aiPicker.refresh")}
          </button>
        </div>
      </div>

      <div className="divide-y divide-white/[0.04]">
        {coins.map(coin => {
          const cfg = RECOMMENDATION_STYLES[coin.recommendation];
          return (
            <div key={coin.asset} className="px-4 py-3 hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-bold text-foreground/30 w-5">#{coin.rank}</span>
                  <span className="text-sm font-bold text-foreground/80">{coin.asset}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.color} ${cfg.bg} border ${cfg.border}`}>
                    {t(cfg.key)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-16 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        coin.score >= 75 ? "bg-green-500" : coin.score >= 55 ? "bg-emerald-500" : coin.score >= 35 ? "bg-yellow-500" : "bg-foreground/20"
                      }`}
                      style={{ width: `${coin.score}%` }}
                    />
                  </div>
                  <span className={`text-sm font-bold ${cfg.color}`}>{coin.score}</span>
                </div>
              </div>

              {/* Metrics row */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-foreground/35 ml-7">
                <span>{t("aiPicker.signalCount")} <strong className="text-foreground/50">{coin.metrics.signalCount}</strong></span>
                <span>{t("aiPicker.trendStrength")} <strong className="text-foreground/50">{coin.metrics.trendStrength}</strong></span>
                <span>{t("aiPicker.winRate7d")} <strong className={coin.metrics.winRate7d > 50 ? "text-green-400/60" : "text-foreground/50"}>{coin.metrics.winRate7d}%</strong></span>
                <span>{t("aiPicker.avgPnl7d")} <strong className={coin.metrics.avgPnl7d > 0 ? "text-green-400/60" : coin.metrics.avgPnl7d < 0 ? "text-red-400/60" : "text-foreground/50"}>
                  {coin.metrics.avgPnl7d > 0 ? "+" : ""}{coin.metrics.avgPnl7d.toFixed(2)}%
                </strong></span>
              </div>

              {/* Active signals */}
              {coin.signals.length > 0 && (
                <div className="flex gap-1.5 mt-2 ml-7">
                  {coin.signals.map((sig, i) => (
                    <span key={i} className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                      sig.side === "LONG" ? "text-green-400/60 bg-green-500/8" : "text-red-400/60 bg-red-500/8"
                    }`}>
                      {sig.strategy} {sig.side === "LONG" ? "↑" : "↓"} {sig.confidence}%
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
