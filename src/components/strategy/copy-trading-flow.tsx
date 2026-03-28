/**
 * Copy Trading Flow — Simplified 2-Step Wizard
 *
 * Step 1: Bind exchange API
 * Step 2: AI suggestions (risk params + coin selection) → Start following
 *
 * Models are pre-configured (5 models from strategy list).
 * All trades are full-auto, strong signal only.
 * Daily target: 2% profit → stop. Martingale on loss.
 * Revenue: 80% user / 20% platform.
 */

import { useState, useEffect } from "react";
import { ApiKeyBind } from "@/components/strategy/api-key-bind";
import { AICoinPicker } from "@/components/strategy/ai-coin-picker";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

type CopyStep = "bind" | "ai";

interface CopyTradingFlowProps {
  userId?: string;
  showSteps?: boolean;
  compact?: boolean;
  readOnly?: boolean;
  initialStep?: CopyStep;
  onStepChange?: (step: CopyStep) => void;
}

// Fixed params — not user configurable
const FIXED_CONFIG = {
  executionMode: "full-auto",
  signalStrength: "STRONG",
  maxPositionSizeUsd: 500,
  maxLeverage: 10,
  maxConcurrentPositions: 5,
  maxDrawdownPct: 20,
  maxDailyLossPct: 20, // max loss = 20% of total position value
  cooldownMinutes: 30,
  dailyTargetPct: 2,   // stop trading at 2% daily profit
  martingaleEnabled: true,
  revenueShareUser: 80,
  revenueSharePlatform: 20,
};

export function CopyTradingFlow({
  userId,
  showSteps = true,
  compact = false,
  readOnly = false,
  initialStep = "bind",
  onStepChange,
}: CopyTradingFlowProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<CopyStep>(initialStep);
  const [isActive, setIsActive] = useState(false);
  const [activating, setActivating] = useState(false);
  const [riskLevel, setRiskLevel] = useState<"conservative" | "moderate" | "aggressive">("moderate");
  const [configLoaded, setConfigLoaded] = useState(false);

  // Risk presets based on selection
  const RISK_PRESETS = {
    conservative: { positionSize: 100, leverage: 3, drawdown: 10, concurrent: 2, label: t("copy.conservative", "保守") },
    moderate: { positionSize: 300, leverage: 5, drawdown: 15, concurrent: 3, label: t("copy.moderate", "稳健") },
    aggressive: { positionSize: 500, leverage: 10, drawdown: 20, concurrent: 5, label: t("copy.aggressive", "激进") },
  };

  const preset = RISK_PRESETS[riskLevel];

  // Load existing config
  useEffect(() => {
    if (!userId) return;
    supabase
      .from("user_trade_configs")
      .select("is_active, execution_mode")
      .eq("wallet_address", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) setIsActive(!!data.is_active);
        setConfigLoaded(true);
      });
  }, [userId]);

  const goTo = (s: CopyStep) => {
    setStep(s);
    onStepChange?.(s);
  };

  // Activate copy trading
  const handleActivate = async () => {
    if (!userId) return;
    setActivating(true);
    try {
      const config = {
        wallet_address: userId,
        exchange: "binance",
        models_follow: ["GPT-4o", "Claude", "Gemini", "DeepSeek", "Llama"],
        execution_mode: "full-auto",
        position_size_usd: preset.positionSize,
        max_leverage: preset.leverage,
        max_positions: preset.concurrent,
        max_daily_loss_pct: FIXED_CONFIG.maxDailyLossPct,
        stop_loss_pct: 3,
        take_profit_pct: 6,
        is_active: true,
      };

      const { data: existing } = await supabase
        .from("user_trade_configs")
        .select("id")
        .eq("wallet_address", userId)
        .limit(1)
        .single();

      if (existing) {
        await supabase.from("user_trade_configs").update({ ...config, updated_at: new Date().toISOString() }).eq("id", existing.id);
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
    await supabase.from("user_trade_configs").update({ is_active: false }).eq("wallet_address", userId);
    setIsActive(false);
  };

  const steps = [
    { id: "bind" as CopyStep, label: t("copy.bindExchange", "绑定交易所"), num: 1 },
    { id: "ai" as CopyStep, label: t("copy.aiSuggestion", "AI 建议 & 跟单"), num: 2 },
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
        </div>
      )}

      {/* Step 1: Bind exchange */}
      {step === "bind" && (
        <div className="space-y-4">
          <ApiKeyBind userId={userId} />
          <button
            onClick={() => goTo("ai")}
            className="w-full py-2.5 rounded-xl bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition-colors"
          >
            {t("copy.nextAi", "下一步：AI 建议")}
          </button>
        </div>
      )}

      {/* Step 2: AI suggestions + risk + activate */}
      {step === "ai" && (
        <div className="space-y-4">
          {/* AI Coin Picker */}
          <AICoinPicker compact />

          {/* Risk preference */}
          <div className="rounded-xl bg-white/[0.02] p-4" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
            <h3 className="text-xs font-bold text-foreground/50 mb-3">{t("copy.riskPreference", "风险偏好")}</h3>
            <div className="grid grid-cols-3 gap-2">
              {(Object.entries(RISK_PRESETS) as [string, typeof preset][]).map(([key, p]) => (
                <button
                  key={key}
                  onClick={() => !readOnly && setRiskLevel(key as any)}
                  className={cn(
                    "text-center px-3 py-2.5 rounded-lg text-xs font-bold transition-colors border",
                    riskLevel === key
                      ? "bg-primary/10 border-primary/20 text-primary"
                      : "bg-white/[0.02] border-white/[0.04] text-foreground/30"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* AI Recommended params */}
          <div className="rounded-xl bg-white/[0.02] p-4" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
            <h3 className="text-xs font-bold text-foreground/50 mb-3">{t("copy.aiParams", "AI 推荐参数")}</h3>
            <div className="grid grid-cols-2 gap-2">
              <ParamCard label={t("copy.positionSize", "单笔仓位")} value={`$${preset.positionSize}`} />
              <ParamCard label={t("copy.maxLeverage", "最大杠杆")} value={`${preset.leverage}x`} />
              <ParamCard label={t("copy.maxPositions", "最大持仓")} value={`${preset.concurrent}`} />
              <ParamCard label={t("copy.maxDrawdown", "最大回撤")} value={`${preset.drawdown}%`} />
            </div>
          </div>

          {/* Fixed rules */}
          <div className="rounded-xl bg-white/[0.02] p-4" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
            <h3 className="text-xs font-bold text-foreground/50 mb-3">{t("copy.tradingRules", "交易规则")}</h3>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between"><span className="text-foreground/30">{t("copy.dailyTarget", "每日止盈")}</span><span className="text-green-400 font-bold">2%</span></div>
              <div className="flex justify-between"><span className="text-foreground/30">{t("copy.martingale", "亏损补单")}</span><span className="text-foreground/50">{t("copy.martingaleEnabled", "马丁策略")}</span></div>
              <div className="flex justify-between"><span className="text-foreground/30">{t("copy.signalType", "信号类型")}</span><span className="text-foreground/50">{t("copy.strongOnly", "仅强信号")}</span></div>
              <div className="flex justify-between"><span className="text-foreground/30">{t("copy.cooldown", "冷却时间")}</span><span className="text-foreground/50">≤30min</span></div>
              <div className="flex justify-between"><span className="text-foreground/30">{t("copy.maxLoss", "最大亏损")}</span><span className="text-red-400">≤{t("copy.maxLossDesc", "持仓本金20%")}</span></div>
              <div className="flex justify-between"><span className="text-foreground/30">{t("copy.execution", "执行模式")}</span><span className="text-primary font-bold">{t("copy.fullAuto", "全自动")}</span></div>
            </div>
          </div>

          {/* Revenue sharing */}
          <div className="rounded-xl bg-white/[0.02] p-4" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
            <h3 className="text-xs font-bold text-foreground/50 mb-3">{t("copy.revenueShare", "收益分成")}</h3>
            <div className="flex gap-2">
              <div className="flex-1 text-center px-3 py-2.5 rounded-lg bg-green-500/8 border border-green-500/15">
                <p className="text-lg font-black text-green-400">80%</p>
                <p className="text-[10px] text-foreground/30">{t("copy.userShare", "用户收益")}</p>
              </div>
              <div className="flex-1 text-center px-3 py-2.5 rounded-lg bg-blue-500/8 border border-blue-500/15">
                <p className="text-lg font-black text-blue-400">20%</p>
                <p className="text-[10px] text-foreground/30">{t("copy.platformShare", "平台分成")}</p>
              </div>
            </div>
          </div>

          {/* Activate */}
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
              {activating ? t("copy.saving", "保存中...") : isActive ? t("copy.updateConfig", "更新跟单配置") : t("copy.startFollow", "开启跟单")}
            </button>
          )}

          {isActive && (
            <div className="text-center">
              <button onClick={handleDeactivate} className="text-[11px] text-red-400/50 hover:text-red-400 transition-colors">
                {t("copy.stopFollow", "停止跟单")}
              </button>
            </div>
          )}

          {/* Back */}
          <button
            onClick={() => goTo("bind")}
            className="w-full py-2 rounded-xl bg-foreground/5 text-foreground/40 text-xs font-bold hover:bg-foreground/10 transition-colors"
          >
            {t("copy.prevStep", "上一步")}
          </button>
        </div>
      )}
    </div>
  );
}

function ParamCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2.5 rounded-lg bg-white/[0.02]" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
      <p className="text-[10px] text-foreground/25">{label}</p>
      <p className="text-sm font-bold mt-0.5 text-foreground/60">{value}</p>
    </div>
  );
}
