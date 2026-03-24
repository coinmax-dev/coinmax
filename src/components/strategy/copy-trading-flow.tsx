/**
 * Copy Trading Flow — Reusable Component
 *
 * Complete copy trading setup wizard:
 * Step 1: Bind exchange API
 * Step 2: Select AI models & strategies
 * Step 3: Risk control settings
 * Step 4: AI parameter suggestions & revenue sharing
 *
 * Used in:
 * - /copy-trading (standalone page)
 * - Strategy page (after VIP subscription)
 * - Admin panel (user management)
 */

import { useState, useEffect } from "react";
import { ModelStrategySelector } from "@/components/strategy/model-strategy-selector";
import { AIParamAdvisor } from "@/components/strategy/ai-param-advisor";
import { RiskControlPanel } from "@/components/strategy/risk-control";
import { ApiKeyBind } from "@/components/strategy/api-key-bind";
import { AICoinPicker } from "@/components/strategy/ai-coin-picker";
import { VipGate } from "@/components/strategy/vip-gate";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type CopyStep = "bind" | "config" | "risk" | "confirm";

interface CopyTradingFlowProps {
  /** wallet address — required for saving configs */
  userId?: string;
  /** Show step navigation at top */
  showSteps?: boolean;
  /** Compact layout for embedded use */
  compact?: boolean;
  /** Read-only mode (admin viewing user config) */
  readOnly?: boolean;
  /** Initial step */
  initialStep?: CopyStep;
  /** Pre-selected model from strategy card click */
  preSelectedModel?: string;
  /** Callback when step changes */
  onStepChange?: (step: CopyStep) => void;
}

export function CopyTradingFlow({
  userId,
  showSteps = true,
  compact = false,
  readOnly = false,
  initialStep = "bind",
  preSelectedModel,
  onStepChange,
}: CopyTradingFlowProps) {
  const [step, setStep] = useState<CopyStep>(initialStep);
  const [selectedModels, setSelectedModels] = useState<string[]>(
    preSelectedModel ? [preSelectedModel] : ["GPT-4o", "Claude", "Gemini", "DeepSeek", "Llama"]
  );
  const [selectedStrategies, setSelectedStrategies] = useState<string[]>([
    "trend_following", "momentum", "breakout", "mean_reversion", "bb_squeeze",
  ]);
  const [riskOverrides, setRiskOverrides] = useState<any>(undefined);
  const [executionMode, setExecutionMode] = useState<"paper" | "signal" | "semi-auto" | "full-auto">("paper");
  const [isActive, setIsActive] = useState(false);
  const [activating, setActivating] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load saved config from new copy trading table
  useEffect(() => {
    if (!userId) return;
    supabase
      .from("user_trade_configs")
      .select("models_follow, strategies_follow, coins_follow, execution_mode, exchange, is_active, node_type, position_size_usd, max_leverage, max_positions, stop_loss_pct, take_profit_pct")
      .eq("wallet_address", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single()
      .then(({ data, error }) => {
        if (data && !error) {
          if (data.models_follow?.length) setSelectedModels(data.models_follow);
          if (data.strategies_follow?.length) setSelectedStrategies(data.strategies_follow);
          if (data.execution_mode) setExecutionMode(data.execution_mode as any);
          setIsActive(!!data.is_active);
        }
        setConfigLoaded(true);
      });
  }, [userId]);

  // Auto-save model/strategy selections to new table (debounced)
  useEffect(() => {
    if (!userId || !configLoaded || readOnly) return;
    const timer = setTimeout(async () => {
      setSaving(true);
      // Upsert into user_trade_configs (use wallet_address as key)
      const { error } = await supabase.from("user_trade_configs").upsert({
        wallet_address: userId,
        exchange: "binance", // default, user changes in step 1
        models_follow: selectedModels,
        strategies_follow: selectedStrategies,
        updated_at: new Date().toISOString(),
      }, { onConflict: "wallet_address,exchange" }).select().single();
      // If conflict on unique, try update
      if (error) {
        await supabase.from("user_trade_configs")
          .update({ models_follow: selectedModels, strategies_follow: selectedStrategies })
          .eq("wallet_address", userId)
          .order("created_at", { ascending: false })
          .limit(1);
      }
      setSaving(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, [selectedModels, selectedStrategies, userId, configLoaded, readOnly]);

  // Save full config to user_trade_configs and activate
  const handleActivate = async () => {
    if (!userId) return;
    setActivating(true);
    try {
      const config = {
        wallet_address: userId,
        exchange: "binance", // default, user sets in step 1
        models_follow: selectedModels,
        strategies_follow: selectedStrategies,
        execution_mode: executionMode,
        position_size_usd: riskOverrides?.maxPositionSizeUsd || 100,
        max_leverage: riskOverrides?.maxLeverage || 3,
        max_positions: riskOverrides?.maxConcurrentPositions || 5,
        max_daily_loss_pct: riskOverrides?.maxDrawdownPct || 10,
        stop_loss_pct: 3,
        take_profit_pct: 6,
        is_active: true,
      };

      // Check if config exists
      const { data: existing } = await supabase
        .from("user_trade_configs")
        .select("id")
        .eq("wallet_address", userId)
        .limit(1)
        .single();

      if (existing) {
        await supabase.from("user_trade_configs")
          .update({ ...config, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      } else {
        await supabase.from("user_trade_configs").insert(config);
      }

      setIsActive(true);
    } catch (e) {
      console.error("Activate failed:", e);
    } finally {
      setActivating(false);
    }
  };

  const handleDeactivate = async () => {
    if (!userId) return;
    await supabase.from("user_trade_configs")
      .update({ is_active: false })
      .eq("wallet_address", userId);
    setIsActive(false);
  };

  const goTo = (s: CopyStep) => {
    setStep(s);
    onStepChange?.(s);
  };

  const steps: { id: CopyStep; label: string; num: number }[] = [
    { id: "bind", label: "绑定交易所", num: 1 },
    { id: "config", label: "选择策略", num: 2 },
    { id: "risk", label: "风控设置", num: 3 },
    { id: "confirm", label: "AI建议", num: 4 },
  ];

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      {showSteps && (
        <div className="flex items-center gap-1">
          {steps.map((s, i) => (
            <div key={s.id} className="flex items-center flex-1">
              <button
                onClick={() => goTo(s.id)}
                className={cn(
                  "flex items-center gap-1.5 w-full px-2 py-2 rounded-lg text-[11px] font-semibold transition-colors",
                  step === s.id ? "bg-primary/10 text-primary" : "text-foreground/25 hover:text-foreground/40"
                )}
              >
                <span className={cn(
                  "w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-bold shrink-0",
                  step === s.id ? "bg-primary text-white" : "bg-foreground/8 text-foreground/30"
                )}>{s.num}</span>
                <span className={compact ? "hidden sm:inline" : ""}>{s.label}</span>
              </button>
              {i < steps.length - 1 && <div className="w-2 h-px bg-foreground/10 shrink-0" />}
            </div>
          ))}
          {saving && <span className="text-[9px] text-foreground/20 animate-pulse shrink-0 ml-2">保存中</span>}
        </div>
      )}

      {/* Step 1: VIP check → Bind exchange */}
      {step === "bind" && (
        <div className="space-y-4">
          <VipGate walletAddress={userId || ""}>
            <ApiKeyBind userId={userId} />
            <NavButtons onNext={() => goTo("config")} nextLabel="下一步：选择策略" />
          </VipGate>
        </div>
      )}

      {/* Step 2: Select models & strategies */}
      {step === "config" && (
        <div className="space-y-4">
          <ModelStrategySelector
            selectedModels={selectedModels}
            selectedStrategies={selectedStrategies}
            onModelsChange={readOnly ? () => {} : setSelectedModels}
            onStrategiesChange={readOnly ? () => {} : setSelectedStrategies}
          />
          <AICoinPicker compact />
          <NavButtons
            onPrev={() => goTo("bind")}
            onNext={() => goTo("risk")}
            nextLabel="下一步：风控设置"
          />
        </div>
      )}

      {/* Step 3: Risk control */}
      {step === "risk" && (
        <div className="space-y-4">
          <RiskControlPanel userId={userId} initialOverrides={riskOverrides} />
          <NavButtons
            onPrev={() => goTo("config")}
            onNext={() => goTo("confirm")}
            nextLabel="下一步：AI建议"
          />
        </div>
      )}

      {/* Step 4: AI suggestion & confirm + activate */}
      {step === "confirm" && (
        <div className="space-y-4">
          <AIParamAdvisor
            selectedModels={selectedModels}
            selectedStrategies={selectedStrategies}
            onApplyParams={(params) => {
              setRiskOverrides({
                maxPositionSizeUsd: params.positionSizeUsd,
                maxLeverage: params.leverage,
                maxDrawdownPct: params.maxDrawdownPct,
                maxConcurrentPositions: params.maxConcurrent,
              });
              goTo("risk");
            }}
          />

          {/* Execution Mode Selector */}
          <div className="rounded-xl bg-white/[0.02] p-4" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
            <h3 className="text-xs font-bold text-foreground/50 mb-3">执行模式</h3>
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: "paper", label: "模拟跟单", desc: "不下真单，记录模拟盈亏" },
                { id: "signal", label: "信号通知", desc: "Telegram/App 推送信号" },
                { id: "semi-auto", label: "半自动", desc: "确认后执行下单" },
                { id: "full-auto", label: "全自动", desc: "AI 直接下单" },
              ] as const).map(mode => (
                <button
                  key={mode.id}
                  onClick={() => !readOnly && setExecutionMode(mode.id)}
                  className={cn(
                    "p-3 rounded-lg text-left transition-all",
                    executionMode === mode.id
                      ? "bg-primary/10 border border-primary/30"
                      : "bg-white/[0.02] border border-white/5 hover:border-white/10"
                  )}
                >
                  <div className="text-[11px] font-bold text-foreground/70">{mode.label}</div>
                  <div className="text-[9px] text-foreground/30 mt-0.5">{mode.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Activate Button */}
          {userId && !readOnly && (
            <button
              onClick={handleActivate}
              disabled={activating}
              className={cn(
                "w-full py-3.5 rounded-xl text-sm font-bold transition-all",
                activating
                  ? "bg-primary/20 text-primary/60"
                  : "bg-primary text-black hover:bg-primary/90 active:scale-[0.98]"
              )}
            >
              {activating ? "保存中..." : isActive ? "更新跟单配置" : "开启跟单"}
            </button>
          )}

          {isActive && (
            <div className="text-center">
              <button
                onClick={handleDeactivate}
                className="text-[11px] text-red-400/50 hover:text-red-400 transition-colors"
              >
                停止跟单
              </button>
            </div>
          )}

          <NavButtons onPrev={() => goTo("risk")} />
        </div>
      )}
    </div>
  );
}

function NavButtons({ onPrev, onNext, nextLabel }: {
  onPrev?: () => void;
  onNext?: () => void;
  nextLabel?: string;
}) {
  return (
    <div className="flex gap-2">
      {onPrev && (
        <button
          onClick={onPrev}
          className="flex-1 py-2.5 rounded-xl bg-foreground/5 text-foreground/40 text-xs font-bold hover:bg-foreground/10 transition-colors"
        >
          上一步
        </button>
      )}
      {onNext && (
        <button
          onClick={onNext}
          className="flex-1 py-2.5 rounded-xl bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition-colors"
        >
          {nextLabel || "下一步"}
        </button>
      )}
    </div>
  );
}
