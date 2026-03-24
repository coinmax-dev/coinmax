/**
 * AI Model & Strategy Selector for Copy Trading
 *
 * Lets users pick which AI models and strategies to follow.
 * Fetches real accuracy data from ai_model_accuracy table.
 */

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  icon: string;
  accuracy7d: number;
  totalTrades: number;
  winRate: number;
  weight: number;
}

const MODEL_META: Record<string, { name: string; provider: string; icon: string }> = {
  "gpt-4o": { name: "GPT-4o", provider: "OpenAI", icon: "🟢" },
  "claude-haiku": { name: "Claude Haiku 4.5", provider: "Anthropic", icon: "🟠" },
  "gemini-flash": { name: "Gemini 2.5 Flash", provider: "Google", icon: "🔵" },
  "deepseek-v3": { name: "DeepSeek V3", provider: "DeepSeek", icon: "🟣" },
  "llama-3.1-8b": { name: "Llama 3.1 8B", provider: "Cloudflare", icon: "🦙" },
};

const STRATEGY_GROUPS: { group: string; strategies: { id: string; name: string; desc: string }[] }[] = [
  {
    group: "趋势跟踪",
    strategies: [
      { id: "trend_following", name: "趋势跟踪", desc: "顺势而为，追随主要趋势" },
      { id: "momentum", name: "动量交易", desc: "捕捉价格加速运动" },
      { id: "breakout", name: "突破交易", desc: "关键价位突破入场" },
      { id: "swing", name: "波段交易", desc: "中期波段反转捕捉" },
      { id: "ichimoku", name: "一目均衡表", desc: "多维度趋势确认" },
      { id: "donchian", name: "唐奇安通道", desc: "通道突破系统" },
    ],
  },
  {
    group: "均值回归",
    strategies: [
      { id: "mean_reversion", name: "均值回归", desc: "偏离均值后回归交易" },
      { id: "bb_squeeze", name: "布林带挤压", desc: "波动率收缩后爆发" },
      { id: "rsi_divergence", name: "RSI背离", desc: "RSI与价格背离信号" },
      { id: "vwap_reversion", name: "VWAP回归", desc: "成交量加权均价回归" },
      { id: "stochastic", name: "随机指标", desc: "超买超卖区间交易" },
    ],
  },
  {
    group: "量化策略",
    strategies: [
      { id: "grid", name: "网格交易", desc: "固定区间自动网格" },
      { id: "dca", name: "定投策略", desc: "分批建仓降低成本" },
      { id: "scalping", name: "剥头皮", desc: "高频小利润交易" },
      { id: "market_making", name: "做市策略", desc: "双边挂单赚取价差" },
      { id: "twap", name: "TWAP", desc: "时间加权平均价执行" },
      { id: "avellaneda", name: "Avellaneda", desc: "最优做市模型" },
    ],
  },
  {
    group: "其他",
    strategies: [
      { id: "pattern", name: "形态识别", desc: "经典图表形态交易" },
      { id: "arbitrage", name: "套利策略", desc: "跨市场价差套利" },
      { id: "position_executor", name: "仓位执行", desc: "智能仓位管理" },
    ],
  },
];

interface Props {
  selectedModels: string[];
  selectedStrategies: string[];
  onModelsChange: (models: string[]) => void;
  onStrategiesChange: (strategies: string[]) => void;
}

export function ModelStrategySelector({ selectedModels, selectedStrategies, onModelsChange, onStrategiesChange }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<"models" | "strategies">("models");

  useEffect(() => {
    async function fetchModelAccuracy() {
      const { data } = await supabase
        .from("ai_model_accuracy")
        .select("model, accuracy_pct, total_trades, wins, computed_weight")
        .eq("period", "7d")
        .eq("asset", "ALL");

      const modelList: ModelInfo[] = Object.entries(MODEL_META).map(([id, meta]) => {
        const row = data?.find(d => d.model === id);
        return {
          id,
          ...meta,
          accuracy7d: row?.accuracy_pct ?? 0,
          totalTrades: row?.total_trades ?? 0,
          winRate: row ? (row.wins / Math.max(row.total_trades, 1)) * 100 : 0,
          weight: row?.computed_weight ?? 0.2,
        };
      });

      setModels(modelList);
      setLoading(false);
    }

    fetchModelAccuracy();
  }, []);

  const toggleModel = (id: string) => {
    onModelsChange(
      selectedModels.includes(id)
        ? selectedModels.filter(m => m !== id)
        : [...selectedModels, id]
    );
  };

  const toggleStrategy = (id: string) => {
    onStrategiesChange(
      selectedStrategies.includes(id)
        ? selectedStrategies.filter(s => s !== id)
        : [...selectedStrategies, id]
    );
  };

  const selectAllStrategies = () => {
    const all = STRATEGY_GROUPS.flatMap(g => g.strategies.map(s => s.id));
    onStrategiesChange(selectedStrategies.length === all.length ? [] : all);
  };

  return (
    <div className="space-y-4">
      {/* Section toggle */}
      <div className="flex gap-1 p-1 rounded-xl bg-white/[0.02]" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
        <button
          onClick={() => setSection("models")}
          className={cn(
            "flex-1 text-center py-2 rounded-lg text-xs font-semibold transition-colors",
            section === "models" ? "bg-primary/10 text-primary" : "text-foreground/30"
          )}
        >
          AI 模型 ({selectedModels.length}/5)
        </button>
        <button
          onClick={() => setSection("strategies")}
          className={cn(
            "flex-1 text-center py-2 rounded-lg text-xs font-semibold transition-colors",
            section === "strategies" ? "bg-primary/10 text-primary" : "text-foreground/30"
          )}
        >
          策略 ({selectedStrategies.length}/20)
        </button>
      </div>

      {section === "models" && (
        <div className="space-y-2">
          <p className="text-[10px] text-foreground/25 px-1">选择要跟随的 AI 模型，系统将综合所选模型的共识进行交易</p>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-white/[0.03] animate-pulse" />)}
            </div>
          ) : (
            models.map(model => {
              const selected = selectedModels.includes(model.id);
              return (
                <button
                  key={model.id}
                  onClick={() => toggleModel(model.id)}
                  className={cn(
                    "w-full text-left px-4 py-3 rounded-xl transition-colors",
                    selected
                      ? "bg-primary/8 border border-primary/20"
                      : "bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.04]"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="text-base">{model.icon}</span>
                      <div>
                        <p className={cn("text-xs font-bold", selected ? "text-primary" : "text-foreground/60")}>{model.name}</p>
                        <p className="text-[10px] text-foreground/25">{model.provider}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className={cn("text-xs font-bold", model.accuracy7d > 60 ? "text-green-400" : model.accuracy7d > 40 ? "text-yellow-400" : "text-foreground/40")}>
                          {model.accuracy7d.toFixed(1)}%
                        </p>
                        <p className="text-[9px] text-foreground/20">7日准确率</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] font-semibold text-foreground/40">{model.totalTrades}</p>
                        <p className="text-[9px] text-foreground/20">交易数</p>
                      </div>
                      <div className={cn(
                        "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors",
                        selected ? "border-primary bg-primary" : "border-foreground/15"
                      )}>
                        {selected && <span className="text-[10px] text-white font-bold">✓</span>}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}

          {selectedModels.length === 0 && !loading && (
            <p className="text-[10px] text-yellow-400/60 text-center py-2">请至少选择 1 个 AI 模型</p>
          )}
        </div>
      )}

      {section === "strategies" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <p className="text-[10px] text-foreground/25">选择要跟随的交易策略</p>
            <button
              onClick={selectAllStrategies}
              className="text-[10px] text-primary/60 hover:text-primary transition-colors"
            >
              {selectedStrategies.length === 20 ? "取消全选" : "全选"}
            </button>
          </div>

          {STRATEGY_GROUPS.map(group => (
            <div key={group.group} className="rounded-xl bg-white/[0.02] p-3" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
              <h4 className="text-[11px] font-bold text-foreground/40 mb-2">{group.group}</h4>
              <div className="flex flex-wrap gap-1.5">
                {group.strategies.map(s => {
                  const selected = selectedStrategies.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggleStrategy(s.id)}
                      title={s.desc}
                      className={cn(
                        "px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors",
                        selected
                          ? "bg-primary/10 text-primary border border-primary/20"
                          : "bg-white/[0.03] text-foreground/30 border border-white/[0.04] hover:text-foreground/50"
                      )}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
