/**
 * AI Parameter Advisor
 *
 * Based on selected models + strategies, AI recommends optimal trading parameters.
 * Shows revenue sharing info (80% member / 20% platform).
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

interface SuggestedParams {
  positionSizeUsd: number;
  leverage: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxDrawdownPct: number;
  maxConcurrent: number;
  riskLevel: "conservative" | "moderate" | "aggressive";
  reasoning: string;
}

const RISK_PRESETS: Record<string, { labelKey: string; color: string; bg: string; params: Omit<SuggestedParams, "reasoning" | "riskLevel"> }> = {
  conservative: {
    labelKey: "strategy.conservative",
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
    params: { positionSizeUsd: 500, leverage: 2, stopLossPct: 2, takeProfitPct: 4, maxDrawdownPct: 5, maxConcurrent: 2 },
  },
  moderate: {
    labelKey: "strategy.moderate",
    color: "text-green-400",
    bg: "bg-green-500/10 border-green-500/20",
    params: { positionSizeUsd: 1000, leverage: 5, stopLossPct: 3, takeProfitPct: 6, maxDrawdownPct: 10, maxConcurrent: 3 },
  },
  aggressive: {
    labelKey: "strategy.aggressive",
    color: "text-orange-400",
    bg: "bg-orange-500/10 border-orange-500/20",
    params: { positionSizeUsd: 2000, leverage: 10, stopLossPct: 5, takeProfitPct: 10, maxDrawdownPct: 20, maxConcurrent: 5 },
  },
};

const ENGINE_WALLET = "0xDd6660E403d0242c1BeE52a4de50484AAF004446";

interface Props {
  selectedModels: string[];
  selectedStrategies: string[];
  onApplyParams: (params: SuggestedParams) => void;
}

export function AIParamAdvisor({ selectedModels, selectedStrategies, onApplyParams }: Props) {
  const { t } = useTranslation();
  const [suggestion, setSuggestion] = useState<SuggestedParams | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedRisk, setSelectedRisk] = useState<string>("moderate");
  const [showRevenue, setShowRevenue] = useState(false);

  // Generate AI suggestion based on selected models and strategies + historical data
  useEffect(() => {
    if (selectedModels.length === 0 || selectedStrategies.length === 0) {
      setSuggestion(null);
      return;
    }

    generateSuggestion();
  }, [selectedModels, selectedStrategies, selectedRisk]);

  async function generateSuggestion() {
    setLoading(true);

    try {
      // Fetch recent performance data for the selected strategies
      const { data: trades } = await supabase
        .from("paper_trades")
        .select("strategy_type, pnl_pct, leverage, size, primary_model")
        .eq("status", "CLOSED")
        .in("strategy_type", selectedStrategies)
        .gte("closed_at", new Date(Date.now() - 7 * 86400_000).toISOString())
        .limit(200);

      const recentTrades = trades ?? [];

      // Filter trades by selected models
      const modelTrades = recentTrades.filter(t =>
        !t.primary_model || selectedModels.includes(t.primary_model)
      );

      // Calculate stats
      const avgPnl = modelTrades.length > 0
        ? modelTrades.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / modelTrades.length
        : 0;
      const maxLoss = modelTrades.length > 0
        ? Math.abs(Math.min(...modelTrades.map(t => t.pnl_pct ?? 0)))
        : 5;
      const avgLeverage = modelTrades.length > 0
        ? modelTrades.reduce((s, t) => s + (t.leverage ?? 1), 0) / modelTrades.length
        : 3;

      const preset = RISK_PRESETS[selectedRisk];

      // Adjust preset based on actual data
      const adjustedParams: SuggestedParams = {
        ...preset.params,
        leverage: Math.min(preset.params.leverage, Math.max(1, Math.round(avgLeverage * 1.2))),
        stopLossPct: Math.max(preset.params.stopLossPct, Math.round(maxLoss * 0.8)),
        riskLevel: selectedRisk as SuggestedParams["riskLevel"],
        reasoning: modelTrades.length > 0
          ? t("strategy.aiReasoningWithData", { trades: modelTrades.length, avgPnl: avgPnl.toFixed(2), maxLoss: maxLoss.toFixed(1), avgLeverage: avgLeverage.toFixed(1), style: t(preset.labelKey) })
          : t("strategy.aiReasoningNoData", { style: t(preset.labelKey) }),
      };

      setSuggestion(adjustedParams);
    } catch (err) {
      console.error("AI param suggestion error:", err);
      const preset = RISK_PRESETS[selectedRisk];
      setSuggestion({
        ...preset.params,
        riskLevel: selectedRisk as SuggestedParams["riskLevel"],
        reasoning: t("strategy.aiReasoningFallback", { style: t(preset.labelKey) }),
      });
    } finally {
      setLoading(false);
    }
  }

  if (selectedModels.length === 0 || selectedStrategies.length === 0) {
    return (
      <div className="rounded-xl bg-white/[0.02] p-4" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
        <p className="text-xs text-foreground/25 text-center py-6">
          {t("strategy.selectModelFirst")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Risk level selector */}
      <div className="rounded-xl bg-white/[0.02] p-4" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
        <h3 className="text-xs font-bold text-foreground/50 mb-3">{t("strategy.riskPreference")}</h3>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(RISK_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              onClick={() => setSelectedRisk(key)}
              className={cn(
                "text-center px-3 py-2.5 rounded-lg text-xs font-bold transition-colors border",
                selectedRisk === key ? preset.bg : "bg-white/[0.02] border-white/[0.04] text-foreground/30"
              )}
            >
              <span className={selectedRisk === key ? preset.color : ""}>
                {t(preset.labelKey)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* AI suggested parameters */}
      {loading ? (
        <div className="rounded-xl bg-white/[0.02] p-4" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs">🤖</span>
            <span className="text-[11px] font-bold text-foreground/50 animate-pulse">{t("strategy.aiAnalyzing")}</span>
          </div>
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-8 rounded-lg bg-white/[0.03] animate-pulse" />)}
          </div>
        </div>
      ) : suggestion && (
        <>
          {/* AI Reasoning */}
          <div className="rounded-xl bg-primary/5 p-3" style={{ border: "1px solid rgba(var(--primary-rgb, 59 130 246), 0.1)" }}>
            <div className="flex items-start gap-2">
              <span className="text-xs mt-0.5">🤖</span>
              <p className="text-[11px] text-foreground/40 leading-relaxed">{suggestion.reasoning}</p>
            </div>
          </div>

          {/* Parameter cards */}
          <div className="rounded-xl bg-white/[0.02] p-4" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
            <h3 className="text-xs font-bold text-foreground/50 mb-3">{t("strategy.aiRecommendedParams")}</h3>
            <div className="grid grid-cols-2 gap-2">
              <ParamCard label={t("strategy.singlePosition")} value={`$${suggestion.positionSizeUsd.toLocaleString()}`} />
              <ParamCard label={t("strategy.leverageMultiple")} value={`${suggestion.leverage}x`} />
              <ParamCard label={t("strategy.stopLoss")} value={`${suggestion.stopLossPct}%`} color="text-red-400" />
              <ParamCard label={t("strategy.takeProfit")} value={`${suggestion.takeProfitPct}%`} color="text-green-400" />
              <ParamCard label={t("strategy.maxDrawdown")} value={`${suggestion.maxDrawdownPct}%`} />
              <ParamCard label={t("strategy.maxPosition")} value={`${suggestion.maxConcurrent}`} />
            </div>

            <button
              onClick={() => onApplyParams(suggestion)}
              className="w-full mt-3 py-2.5 rounded-xl bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition-colors"
            >
              {t("strategy.applyRecommended")}
            </button>
          </div>
        </>
      )}

      {/* Revenue sharing */}
      <div className="rounded-xl bg-white/[0.02] p-4" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
        <button
          onClick={() => setShowRevenue(!showRevenue)}
          className="w-full flex items-center justify-between"
        >
          <h3 className="text-xs font-bold text-foreground/50">{t("strategy.revenueSharing")}</h3>
          <span className="text-[10px] text-foreground/20">{showRevenue ? t("strategy.collapse") : t("strategy.details")}</span>
        </button>

        <div className="mt-3 flex gap-2">
          <div className="flex-1 text-center px-3 py-2.5 rounded-lg bg-green-500/8 border border-green-500/15">
            <p className="text-lg font-black text-green-400">80%</p>
            <p className="text-[10px] text-foreground/30 mt-0.5">{t("strategy.userRevenue")}</p>
          </div>
          <div className="flex-1 text-center px-3 py-2.5 rounded-lg bg-blue-500/8 border border-blue-500/15">
            <p className="text-lg font-black text-blue-400">20%</p>
            <p className="text-[10px] text-foreground/30 mt-0.5">{t("strategy.platformShare")}</p>
          </div>
        </div>

        {showRevenue && (
          <div className="mt-3 space-y-2">
            <div className="px-3 py-2 rounded-lg bg-white/[0.02]" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
              <p className="text-[10px] text-foreground/30 leading-relaxed">
                {t("strategy.revenueDescription")}
              </p>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.02]" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
              <span className="text-[10px] text-foreground/20">{t("strategy.engineWallet")}:</span>
              <span className="text-[10px] text-foreground/30 font-mono truncate">{ENGINE_WALLET}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ParamCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="px-3 py-2.5 rounded-lg bg-white/[0.02]" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
      <p className="text-[10px] text-foreground/25">{label}</p>
      <p className={cn("text-sm font-bold mt-0.5", color || "text-foreground/60")}>{value}</p>
    </div>
  );
}
