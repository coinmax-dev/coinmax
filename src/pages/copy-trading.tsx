/**
 * Copy Trading Settings Page
 *
 * Full copy trading configuration:
 * 1. AI Model & Strategy selection (persisted to DB)
 * 2. AI-recommended parameters + revenue sharing
 * 3. Live signals & positions
 * 4. Risk control settings
 * 5. Exchange API binding
 */

import { useState, useEffect, useCallback } from "react";
import { useActiveAccount } from "thirdweb/react";
import { LiveTradingPanel } from "@/components/strategy/live-trading-panel";
import { RiskControlPanel } from "@/components/strategy/risk-control";
import { ApiKeyBind } from "@/components/strategy/api-key-bind";
import { AICoinPicker } from "@/components/strategy/ai-coin-picker";
import { ModelStrategySelector } from "@/components/strategy/model-strategy-selector";
import { AIParamAdvisor } from "@/components/strategy/ai-param-advisor";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type Tab = "config" | "signals" | "risk" | "keys";

interface RiskOverrides {
  maxPositionSizeUsd?: number;
  maxLeverage?: number;
  maxDrawdownPct?: number;
  maxConcurrentPositions?: number;
}

export default function CopyTradingPage() {
  const account = useActiveAccount();
  const userId = account?.address || "";

  const [activeTab, setActiveTab] = useState<Tab>("config");
  const [selectedModels, setSelectedModels] = useState<string[]>(["gpt-4o", "claude-haiku", "gemini-flash"]);
  const [selectedStrategies, setSelectedStrategies] = useState<string[]>([
    "trend_following", "momentum", "breakout", "mean_reversion", "bb_squeeze",
  ]);
  const [riskOverrides, setRiskOverrides] = useState<RiskOverrides | undefined>();
  const [configLoaded, setConfigLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load persisted model/strategy selections from DB
  useEffect(() => {
    if (!userId) return;
    supabase
      .from("user_risk_config")
      .select("selected_models, selected_strategies")
      .eq("user_id", userId)
      .single()
      .then(({ data }) => {
        if (data) {
          if (data.selected_models?.length) setSelectedModels(data.selected_models);
          if (data.selected_strategies?.length) setSelectedStrategies(data.selected_strategies);
        }
        setConfigLoaded(true);
      });
  }, [userId]);

  // Auto-save model/strategy selections when changed (debounced)
  useEffect(() => {
    if (!userId || !configLoaded) return;
    const timer = setTimeout(async () => {
      setSaving(true);
      await supabase.from("user_risk_config").upsert({
        user_id: userId,
        selected_models: selectedModels,
        selected_strategies: selectedStrategies,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      setSaving(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, [selectedModels, selectedStrategies, userId, configLoaded]);

  const handleApplyParams = useCallback((params: {
    positionSizeUsd: number;
    leverage: number;
    stopLossPct: number;
    takeProfitPct: number;
    maxDrawdownPct: number;
    maxConcurrent: number;
  }) => {
    setRiskOverrides({
      maxPositionSizeUsd: params.positionSizeUsd,
      maxLeverage: params.leverage,
      maxDrawdownPct: params.maxDrawdownPct,
      maxConcurrentPositions: params.maxConcurrent,
    });
    setActiveTab("risk");
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: "config", label: "跟单配置" },
    { id: "signals", label: "信号 & 持仓" },
    { id: "risk", label: "风控设置" },
    { id: "keys", label: "交易所" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-sm font-bold text-foreground/80">CoinMax 跟单交易</h1>
              <p className="text-[10px] text-foreground/40 mt-0.5">
                {userId
                  ? `${selectedModels.length} 个模型 · ${selectedStrategies.length} 个策略`
                  : "请先连接钱包"
                }
              </p>
            </div>
            <div className="flex items-center gap-2">
              {saving && <span className="text-[9px] text-foreground/20 animate-pulse">保存中</span>}
              <div className={cn(
                "px-2.5 py-1 rounded-lg text-[10px] font-bold",
                !userId
                  ? "bg-red-500/10 text-red-400"
                  : selectedModels.length > 0 && selectedStrategies.length > 0
                    ? "bg-green-500/10 text-green-400"
                    : "bg-yellow-500/10 text-yellow-400"
              )}>
                {!userId ? "未连接" : selectedModels.length > 0 && selectedStrategies.length > 0 ? "已配置" : "待配置"}
              </div>
            </div>
          </div>

          {/* Wallet address */}
          {userId && (
            <p className="text-[9px] text-foreground/15 font-mono mt-1 truncate">{userId}</p>
          )}

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

      {/* Not connected warning */}
      {!userId && (
        <div className="max-w-lg mx-auto px-4 pt-4">
          <div className="rounded-xl bg-yellow-500/8 border border-yellow-500/15 px-4 py-3">
            <p className="text-xs text-yellow-400/80">请先在首页连接钱包，才能保存跟单设置和绑定交易所。</p>
          </div>
        </div>
      )}

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

        {activeTab === "risk" && (
          <RiskControlPanel userId={userId || undefined} initialOverrides={riskOverrides} />
        )}
        {activeTab === "keys" && (
          <ApiKeyBind userId={userId || undefined} />
        )}
      </div>
    </div>
  );
}
