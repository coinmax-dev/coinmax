/**
 * AI Parameter Advisor
 *
 * Based on selected models + strategies, AI recommends optimal trading parameters.
 * Shows revenue sharing info (80% member / 20% platform).
 */

import { useState, useEffect } from "react";
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

const RISK_PRESETS: Record<string, { label: string; color: string; bg: string; params: Omit<SuggestedParams, "reasoning" | "riskLevel"> }> = {
  conservative: {
    label: "保守",
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
    params: { positionSizeUsd: 500, leverage: 2, stopLossPct: 2, takeProfitPct: 4, maxDrawdownPct: 5, maxConcurrent: 2 },
  },
  moderate: {
    label: "稳健",
    color: "text-green-400",
    bg: "bg-green-500/10 border-green-500/20",
    params: { positionSizeUsd: 1000, leverage: 5, stopLossPct: 3, takeProfitPct: 6, maxDrawdownPct: 10, maxConcurrent: 3 },
  },
  aggressive: {
    label: "激进",
    color: "text-orange-400",
    bg: "bg-orange-500/10 border-orange-500/20",
    params: { positionSizeUsd: 2000, leverage: 10, stopLossPct: 5, takeProfitPct: 10, maxDrawdownPct: 20, maxConcurrent: 5 },
  },
};

const ENGINE_WALLET = "0x0831e8875685C796D05F2302D3c5C2Dd77fAc3B6";

interface Props {
  selectedModels: string[];
  selectedStrategies: string[];
  onApplyParams: (params: SuggestedParams) => void;
}

export function AIParamAdvisor({ selectedModels, selectedStrategies, onApplyParams }: Props) {
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
          ? `基于 ${modelTrades.length} 笔历史交易分析：7日平均盈亏 ${avgPnl.toFixed(2)}%，最大回撤 ${maxLoss.toFixed(1)}%，平均杠杆 ${avgLeverage.toFixed(1)}x。已根据${preset.label}风格调整参数。`
          : `当前选择的模型/策略组合暂无足够历史数据，使用${preset.label}预设参数。建议先以模拟模式运行积累数据。`,
      };

      setSuggestion(adjustedParams);
    } catch (err) {
      console.error("AI param suggestion error:", err);
      const preset = RISK_PRESETS[selectedRisk];
      setSuggestion({
        ...preset.params,
        riskLevel: selectedRisk as SuggestedParams["riskLevel"],
        reasoning: `使用${preset.label}预设参数。`,
      });
    } finally {
      setLoading(false);
    }
  }

  if (selectedModels.length === 0 || selectedStrategies.length === 0) {
    return (
      <div className="rounded-xl bg-white/[0.02] p-4" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
        <p className="text-xs text-foreground/25 text-center py-6">
          请先选择 AI 模型和交易策略，系统将为您推荐最优参数
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Risk level selector */}
      <div className="rounded-xl bg-white/[0.02] p-4" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
        <h3 className="text-xs font-bold text-foreground/50 mb-3">风险偏好</h3>
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
                {preset.label}
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
            <span className="text-[11px] font-bold text-foreground/50 animate-pulse">AI 正在分析最优参数...</span>
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
            <h3 className="text-xs font-bold text-foreground/50 mb-3">AI 推荐参数</h3>
            <div className="grid grid-cols-2 gap-2">
              <ParamCard label="单笔仓位" value={`$${suggestion.positionSizeUsd.toLocaleString()}`} />
              <ParamCard label="杠杆倍数" value={`${suggestion.leverage}x`} />
              <ParamCard label="止损比例" value={`${suggestion.stopLossPct}%`} color="text-red-400" />
              <ParamCard label="止盈比例" value={`${suggestion.takeProfitPct}%`} color="text-green-400" />
              <ParamCard label="最大回撤" value={`${suggestion.maxDrawdownPct}%`} />
              <ParamCard label="最大持仓" value={`${suggestion.maxConcurrent} 笔`} />
            </div>

            <button
              onClick={() => onApplyParams(suggestion)}
              className="w-full mt-3 py-2.5 rounded-xl bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition-colors"
            >
              应用推荐参数到风控设置
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
          <h3 className="text-xs font-bold text-foreground/50">收益分成</h3>
          <span className="text-[10px] text-foreground/20">{showRevenue ? "收起" : "详情"}</span>
        </button>

        <div className="mt-3 flex gap-2">
          <div className="flex-1 text-center px-3 py-2.5 rounded-lg bg-green-500/8 border border-green-500/15">
            <p className="text-lg font-black text-green-400">80%</p>
            <p className="text-[10px] text-foreground/30 mt-0.5">用户收益</p>
          </div>
          <div className="flex-1 text-center px-3 py-2.5 rounded-lg bg-blue-500/8 border border-blue-500/15">
            <p className="text-lg font-black text-blue-400">20%</p>
            <p className="text-[10px] text-foreground/30 mt-0.5">平台分成</p>
          </div>
        </div>

        {showRevenue && (
          <div className="mt-3 space-y-2">
            <div className="px-3 py-2 rounded-lg bg-white/[0.02]" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
              <p className="text-[10px] text-foreground/30 leading-relaxed">
                平台仅在用户产生盈利时收取 20% 绩效费，亏损不收费。收益结算周期为每日 UTC 00:00，
                绩效费自动从盈利中扣除并转入引擎钱包。
              </p>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.02]" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
              <span className="text-[10px] text-foreground/20">引擎钱包:</span>
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
