/**
 * Copy Trading Settings Page
 *
 * Full copy trading configuration:
 * 1. AI Model & Strategy selection
 * 2. AI-recommended parameters + revenue sharing
 * 3. Live signals & positions
 * 4. Risk control settings
 * 5. Exchange API binding
 */

import { useState } from "react";
import { LiveTradingPanel } from "@/components/strategy/live-trading-panel";
import { RiskControlPanel } from "@/components/strategy/risk-control";
import { ApiKeyBind } from "@/components/strategy/api-key-bind";
import { AICoinPicker } from "@/components/strategy/ai-coin-picker";
import { ModelStrategySelector } from "@/components/strategy/model-strategy-selector";
import { AIParamAdvisor } from "@/components/strategy/ai-param-advisor";
import { cn } from "@/lib/utils";

type Tab = "config" | "signals" | "risk" | "keys";

export default function CopyTradingPage() {
  const [activeTab, setActiveTab] = useState<Tab>("config");
  const [selectedModels, setSelectedModels] = useState<string[]>(["gpt-4o", "claude-haiku", "gemini-flash"]);
  const [selectedStrategies, setSelectedStrategies] = useState<string[]>([
    "trend_following", "momentum", "breakout", "mean_reversion", "bb_squeeze",
  ]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "config", label: "跟单配置" },
    { id: "signals", label: "信号 & 持仓" },
    { id: "risk", label: "风控设置" },
    { id: "keys", label: "交易所" },
  ];

  const handleApplyParams = (params: {
    positionSizeUsd: number;
    leverage: number;
    stopLossPct: number;
    takeProfitPct: number;
    maxDrawdownPct: number;
    maxConcurrent: number;
  }) => {
    // Switch to risk tab so user can see the applied params
    setActiveTab("risk");
    // The RiskControlPanel will receive these via URL params or a shared state
    // For now we store in sessionStorage so RiskControlPanel can pick them up
    sessionStorage.setItem("ai_suggested_params", JSON.stringify({
      maxPositionSizeUsd: params.positionSizeUsd,
      maxLeverage: params.leverage,
      maxDrawdownPct: params.maxDrawdownPct,
      maxConcurrentPositions: params.maxConcurrent,
    }));
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-sm font-bold text-foreground/80">CoinMax 跟单交易</h1>
              <p className="text-[10px] text-foreground/40 mt-0.5">
                {selectedModels.length} 个模型 · {selectedStrategies.length} 个策略
              </p>
            </div>
            <div className={cn(
              "px-2.5 py-1 rounded-lg text-[10px] font-bold",
              selectedModels.length > 0 && selectedStrategies.length > 0
                ? "bg-green-500/10 text-green-400"
                : "bg-yellow-500/10 text-yellow-400"
            )}>
              {selectedModels.length > 0 && selectedStrategies.length > 0 ? "已配置" : "待配置"}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-3">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex-1 text-center py-2 rounded-lg text-xs font-semibold transition-colors",
                  activeTab === tab.id
                    ? "bg-primary/10 text-primary"
                    : "text-foreground/30 hover:text-foreground/50"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-lg mx-auto px-4 py-4">
        {activeTab === "config" && (
          <div className="space-y-4">
            {/* Step 1: Model & Strategy selection */}
            <div className="rounded-xl bg-white/[0.02] p-4" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-bold text-primary/60 bg-primary/10 w-5 h-5 rounded-full flex items-center justify-center">1</span>
                <h2 className="text-xs font-bold text-foreground/60">选择 AI 模型 & 策略</h2>
              </div>
              <ModelStrategySelector
                selectedModels={selectedModels}
                selectedStrategies={selectedStrategies}
                onModelsChange={setSelectedModels}
                onStrategiesChange={setSelectedStrategies}
              />
            </div>

            {/* Step 2: AI coin recommendation */}
            <div className="rounded-xl bg-white/[0.02] p-4" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-bold text-primary/60 bg-primary/10 w-5 h-5 rounded-full flex items-center justify-center">2</span>
                <h2 className="text-xs font-bold text-foreground/60">AI 优选币种</h2>
              </div>
              <AICoinPicker compact />
            </div>

            {/* Step 3: AI parameter suggestion + revenue */}
            <div className="rounded-xl bg-white/[0.02] p-4" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-bold text-primary/60 bg-primary/10 w-5 h-5 rounded-full flex items-center justify-center">3</span>
                <h2 className="text-xs font-bold text-foreground/60">AI 推荐参数 & 收益分成</h2>
              </div>
              <AIParamAdvisor
                selectedModels={selectedModels}
                selectedStrategies={selectedStrategies}
                onApplyParams={handleApplyParams}
              />
            </div>
          </div>
        )}

        {activeTab === "signals" && (
          <>
            <AICoinPicker compact />
            <div className="mt-3">
              <LiveTradingPanel />
            </div>
          </>
        )}

        {activeTab === "risk" && <RiskControlPanel userId="guest" />}
        {activeTab === "keys" && <ApiKeyBind userId="guest" />}
      </div>
    </div>
  );
}
