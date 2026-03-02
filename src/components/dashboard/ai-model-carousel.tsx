import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus, Sparkles, Brain, Zap, Target, Activity } from "lucide-react";
import { formatUSD } from "@/lib/constants";
import { useTranslation } from "react-i18next";

interface ForecastItem {
  model: string;
  direction: string;
  confidence: number;
  currentPrice: number;
  targetPrice: number;
  reasoning: string;
}

interface AiModelCarouselProps {
  forecasts: ForecastItem[] | undefined;
  isLoading: boolean;
  activeModel: string | null;
  onSelectModel: (model: string) => void;
}

const MODEL_META: Record<string, { accent: string; icon: string; glow: string }> = {
  "GPT-4o":     { accent: "#10a37f", icon: "G",  glow: "16,163,127" },
  "Claude":     { accent: "#cc843f", icon: "C",  glow: "204,132,63" },
  "Gemini":     { accent: "#4285f4", icon: "Ge", glow: "66,133,244" },
  "DeepSeek":   { accent: "#6366f1", icon: "D",  glow: "99,102,241" },
  "Grok":       { accent: "#ef4444", icon: "Gr", glow: "239,68,68" },
  "Llama 3.1":  { accent: "#0088ff", icon: "L",  glow: "0,136,255" },
  "Llama 3.3":  { accent: "#00a0ff", icon: "L",  glow: "0,160,255" },
  "Llama 8B":   { accent: "#0078dd", icon: "L",  glow: "0,120,221" },
  "Mistral":    { accent: "#ff7400", icon: "M",  glow: "255,116,0" },
  "Gemma":      { accent: "#4285f4", icon: "Gm", glow: "66,133,244" },
  "Qwen":       { accent: "#734bd1", icon: "Q",  glow: "115,75,209" },
};

function getModelMeta(model: string) {
  return MODEL_META[model] || { accent: "#888", icon: model[0], glow: "136,136,136" };
}

function AnimatedGauge({ value, accent, glow, size = 64, confLabel = "CONF" }: { value: number; accent: string; glow: string; size?: number; confLabel?: string }) {
  const [animValue, setAnimValue] = useState(0);
  const [showValue, setShowValue] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setAnimValue(value), 300);
    const t2 = setTimeout(() => setShowValue(true), 600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [value]);

  const sw = 3.5;
  const r = (size - sw) / 2 - 3;
  const c = 2 * Math.PI * r;
  const offset = c - (animValue / 100) * c;
  const gradId = `ag-${accent.replace('#', '')}-${size}`;

  return (
    <div className="relative shrink-0 ai-gauge-container" style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full ai-gauge-glow" style={{
        boxShadow: `0 0 20px rgba(${glow},0.15), 0 0 40px rgba(${glow},0.05)`,
      }} />
      <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90" style={{ width: size, height: size }}>
        <circle cx={size/2} cy={size/2} r={r}
          fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={sw} />
        <circle cx={size/2} cy={size/2} r={r+0.5}
          fill="none" stroke={`rgba(${glow},0.06)`} strokeWidth={sw+4} />
        <circle cx={size/2} cy={size/2} r={r}
          fill="none" stroke={`url(#${gradId})`}
          strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset}
          className="ai-gauge-arc"
          style={{ filter: `drop-shadow(0 0 8px rgba(${glow},0.6))` }}
        />
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={accent} stopOpacity="1" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.3" />
          </linearGradient>
        </defs>
      </svg>
      <div className={`absolute inset-0 flex flex-col items-center justify-center transition-all duration-500 ${showValue ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`}>
        <span className="text-[18px] font-black tabular-nums leading-none" style={{ color: accent, textShadow: `0 0 12px rgba(${glow},0.4)` }}>{value}</span>
        <span className="text-[7px] font-semibold text-muted-foreground/60 mt-0.5 tracking-wider">{confLabel}</span>
      </div>
    </div>
  );
}

function MiniGauge({ value, accent, glow }: { value: number; accent: string; glow: string }) {
  const [animValue, setAnimValue] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnimValue(value), 200);
    return () => clearTimeout(t);
  }, [value]);
  const size = 30; const sw = 2.5; const r = (size-sw)/2-1;
  const c = 2*Math.PI*r; const offset = c-(animValue/100)*c;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90" style={{ width: size, height: size }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={sw} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={accent}
          strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset}
          className="ai-gauge-arc"
          style={{ filter: `drop-shadow(0 0 4px rgba(${glow},0.5))` }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold tabular-nums" style={{ color: accent }}>{value}</span>
    </div>
  );
}

function FeaturedCard({
  forecast,
  isActive,
  onSelect,
}: {
  forecast: ForecastItem;
  isActive: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const [reasonExpanded, setReasonExpanded] = useState(false);
  const meta = getModelMeta(forecast.model);
  const isBullish = forecast.direction === "BULLISH";
  const isBearish = forecast.direction === "BEARISH";
  const priceDiff = forecast.currentPrice ? ((forecast.targetPrice - forecast.currentPrice) / forecast.currentPrice * 100) : 0;
  const dirColor = isBullish ? "#00e7a0" : isBearish ? "#ff4976" : "#facc15";
  const dirGlow = isBullish ? "0,231,160" : isBearish ? "255,73,118" : "250,204,21";
  const dirLabel = isBullish ? t("dashboard.bullish") : isBearish ? t("dashboard.bearish") : t("dashboard.mixed");

  return (
    <div
      onClick={onSelect}
      className="ai-featured-card w-full text-left relative overflow-hidden rounded-xl cursor-pointer active:scale-[0.985] transition-transform duration-200"
      style={{
        background: `linear-gradient(160deg, rgba(${meta.glow},0.08) 0%, rgba(255,255,255,0.03) 40%, rgba(0,0,0,0.2) 100%)`,
        backdropFilter: 'blur(12px)',
        border: `1px solid rgba(255,255,255,${isActive ? '0.2' : '0.12'})`,
        boxShadow: isActive
          ? `0 0 24px rgba(${meta.glow},0.12), inset 0 1px 0 rgba(255,255,255,0.08)`
          : `inset 0 1px 0 rgba(255,255,255,0.06)`,
      }}
    >
      <div className="ai-shimmer-sweep" style={{ '--shimmer-color': `rgba(${meta.glow},0.05)` } as React.CSSProperties} />

      <div className="absolute -top-10 -right-10 w-32 h-32 pointer-events-none ai-corner-orb"
        style={{ background: `radial-gradient(circle, rgba(${meta.glow},0.12) 0%, transparent 65%)` }}
      />

      <div className="relative p-3.5">
        <div className="flex items-start gap-3.5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2.5">
              <div className="relative">
                <div
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-[11px] font-black ai-model-icon"
                  style={{
                    background: `linear-gradient(135deg, ${meta.accent}, rgba(${meta.glow},0.5))`,
                    color: "#fff",
                    boxShadow: `0 3px 12px rgba(${meta.glow},0.35)`,
                  }}
                >
                  {meta.icon}
                </div>
                <div className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 border-2 ai-best-dot"
                  style={{ borderColor: 'rgba(15,25,20,0.9)' }}
                />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[14px] font-bold text-foreground/95 tracking-tight">{forecast.model}</span>
                  <span className="ai-best-badge inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[7px] font-extrabold uppercase tracking-widest"
                    style={{
                      background: 'linear-gradient(135deg, rgba(251,191,36,0.15), rgba(251,191,36,0.05))',
                      color: '#fbbf24',
                      border: '1px solid rgba(251,191,36,0.2)',
                    }}
                  >
                    <Zap className="h-1.5 w-1.5" />
                    {t("dashboard.best")}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 mb-2.5">
              <div className="ai-direction-badge flex items-center gap-1 px-2 py-0.5 rounded-md"
                style={{
                  background: `rgba(${dirGlow},0.12)`,
                  border: `1px solid rgba(${dirGlow},0.25)`,
                }}
              >
                {isBullish ? (
                  <TrendingUp className="h-3 w-3" style={{ color: dirColor }} />
                ) : isBearish ? (
                  <TrendingDown className="h-3 w-3" style={{ color: dirColor }} />
                ) : (
                  <Minus className="h-3 w-3" style={{ color: dirColor }} />
                )}
                <span className="text-[11px] font-extrabold" style={{ color: dirColor }}>
                  {dirLabel}
                </span>
              </div>
              <span className={`text-[13px] font-mono font-bold ${priceDiff >= 0 ? "text-[#00e7a0]" : "text-[#ff4976]"}`}
                style={{ textShadow: `0 0 6px rgba(${priceDiff >= 0 ? '0,231,160' : '255,73,118'},0.25)` }}
              >
                {priceDiff >= 0 ? "+" : ""}{priceDiff.toFixed(2)}%
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <Target className="h-3 w-3 text-muted-foreground/60" />
              <span className="text-[9px] text-muted-foreground/60 font-medium">{t("dashboard.target")}</span>
              <span className="font-mono font-bold text-foreground text-[15px] tracking-tight">
                {formatUSD(forecast.targetPrice)}
              </span>
            </div>
          </div>

          <AnimatedGauge value={forecast.confidence} accent={meta.accent} glow={meta.glow} size={64} confLabel={t("dashboard.confLabel")} />
        </div>

        {forecast.reasoning && (
          <div className="mt-2.5 pt-2.5 relative" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <div
              className="cursor-pointer"
              onClick={(e) => { e.stopPropagation(); setReasonExpanded(prev => !prev); }}
            >
              <p className={`text-[11px] text-foreground/60 leading-relaxed ${reasonExpanded ? '' : 'line-clamp-2'}`}>
                <Sparkles className="inline h-2.5 w-2.5 mr-1 text-amber-400/70 ai-sparkle-icon" />
                {forecast.reasoning}
              </p>
              <span className="text-[9px] text-primary/50 mt-1 inline-block font-semibold tracking-wide uppercase">
                {reasonExpanded ? t("dashboard.showLess") : t("dashboard.readMore")}
              </span>
            </div>
          </div>
        )}
      </div>

      {isActive && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] ai-active-bar"
          style={{
            background: `linear-gradient(90deg, transparent, rgba(${meta.glow},0.7), transparent)`,
            boxShadow: `0 0 12px rgba(${meta.glow},0.4)`,
          }}
        />
      )}
    </div>
  );
}

function CompactModelPill({
  forecast,
  isActive,
  onSelect,
}: {
  forecast: ForecastItem;
  isActive: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const meta = getModelMeta(forecast.model);
  const isBullish = forecast.direction === "BULLISH";
  const isBearish = forecast.direction === "BEARISH";
  const priceDiff = forecast.currentPrice ? ((forecast.targetPrice - forecast.currentPrice) / forecast.currentPrice * 100) : 0;
  const dirColor = isBullish ? "#00e7a0" : isBearish ? "#ff4976" : "#facc15";
  const dirLabel = isBullish ? t("dashboard.bullish") : isBearish ? t("dashboard.bearish") : t("dashboard.mixed");

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      className="ai-marquee-pill shrink-0 relative overflow-hidden rounded-lg transition-all duration-300 active:scale-[0.96]"
      style={{
        width: 140,
        background: isActive
          ? `linear-gradient(150deg, rgba(${meta.glow},0.12) 0%, rgba(255,255,255,0.04) 100%)`
          : 'rgba(255,255,255,0.03)',
        backdropFilter: 'blur(8px)',
        border: isActive ? `1px solid rgba(${meta.glow},0.3)` : '1px solid rgba(255,255,255,0.1)',
        boxShadow: isActive ? `0 0 12px rgba(${meta.glow},0.1)` : 'none',
      }}
    >
      <div className="p-2">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <div
              className="h-5 w-5 rounded flex items-center justify-center text-[8px] font-black shrink-0"
              style={{
                background: isActive
                  ? `linear-gradient(135deg, ${meta.accent}, rgba(${meta.glow},0.5))`
                  : `rgba(${meta.glow},0.12)`,
                color: isActive ? "#fff" : meta.accent,
              }}
            >
              {meta.icon}
            </div>
            <span className={`text-[10px] font-bold truncate ${isActive ? 'text-foreground' : 'text-foreground/65'}`}>
              {forecast.model}
            </span>
          </div>
          <MiniGauge value={forecast.confidence} accent={meta.accent} glow={meta.glow} />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {isBullish ? (
              <TrendingUp className="h-2.5 w-2.5" style={{ color: dirColor }} />
            ) : isBearish ? (
              <TrendingDown className="h-2.5 w-2.5" style={{ color: dirColor }} />
            ) : (
              <Minus className="h-2.5 w-2.5" style={{ color: dirColor }} />
            )}
            <span className="text-[8px] font-bold" style={{ color: dirColor }}>
              {dirLabel}
            </span>
          </div>
          <span className={`text-[9px] font-mono font-bold ${priceDiff >= 0 ? "text-[#00e7a0]" : "text-[#ff4976]"}`}>
            {priceDiff >= 0 ? "+" : ""}{priceDiff.toFixed(2)}%
          </span>
        </div>
      </div>

      {isActive && (
        <div className="absolute bottom-0 left-0 right-0 h-[1px]"
          style={{ background: `linear-gradient(90deg, transparent, rgba(${meta.glow},0.5), transparent)` }}
        />
      )}
    </button>
  );
}

function MarqueeRow({ children, paused }: { children: React.ReactNode; paused: boolean }) {
  return (
    <div className="ai-marquee-track overflow-hidden relative">
      <div className="absolute left-0 top-0 bottom-0 w-6 z-10 pointer-events-none"
        style={{ background: 'linear-gradient(90deg, rgba(15,25,20,0.9), transparent)' }}
      />
      <div className="absolute right-0 top-0 bottom-0 w-6 z-10 pointer-events-none"
        style={{ background: 'linear-gradient(270deg, rgba(15,25,20,0.9), transparent)' }}
      />
      <div className={`ai-marquee-inner flex gap-2 ${paused ? 'ai-marquee-paused' : ''}`}>
        {children}
        {children}
      </div>
    </div>
  );
}

export function AiModelCarousel({ forecasts, isLoading, activeModel, onSelectModel }: AiModelCarouselProps) {
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const [marqueeHovered, setMarqueeHovered] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(t);
  }, []);

  const sorted = useMemo(() => {
    if (!forecasts) return [];
    return [...forecasts].sort((a, b) => b.confidence - a.confidence);
  }, [forecasts]);

  if (isLoading) {
    return (
      <div className="ai-wrapper-glass rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-xl" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        </div>
        <Skeleton className="h-[140px] w-full rounded-xl" />
        <div className="flex gap-2 overflow-hidden">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="h-[60px] w-[140px] rounded-lg shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  if (!sorted || sorted.length === 0) return null;

  const bullCount = sorted.filter(f => f.direction === "BULLISH").length;
  const bearCount = sorted.filter(f => f.direction === "BEARISH").length;
  const consensusRaw = bullCount > bearCount ? "BULLISH" : bearCount > bullCount ? "BEARISH" : "MIXED";
  const consensusColor = consensusRaw === "BULLISH" ? "#00e7a0" : consensusRaw === "BEARISH" ? "#ff4976" : "#facc15";
  const consensusGlow = consensusRaw === "BULLISH" ? "0,231,160" : consensusRaw === "BEARISH" ? "255,73,118" : "250,204,21";
  const consensusLabel = consensusRaw === "BULLISH" ? t("dashboard.bullish") : consensusRaw === "BEARISH" ? t("dashboard.bearish") : t("dashboard.mixed");

  const bestForecast = sorted[0];
  const otherForecasts = sorted.slice(1);

  return (
    <div
      className={`ai-wrapper-glass relative overflow-hidden rounded-2xl ${mounted ? 'ai-mounted' : ''}`}
      style={{
        background: `linear-gradient(170deg, rgba(${consensusGlow},0.06) 0%, rgba(255,255,255,0.02) 30%, rgba(0,0,0,0.2) 100%)`,
        backdropFilter: 'blur(20px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
        border: '1px solid rgba(255,255,255,0.18)',
        boxShadow: `0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)`,
      }}
    >
      <div className="ai-header-scanline" style={{ '--scan-color': `rgba(${consensusGlow},0.3)` } as React.CSSProperties} />

      <div className="absolute top-0 left-0 right-0 h-[1px]"
        style={{ background: `linear-gradient(90deg, transparent 10%, rgba(${consensusGlow},0.2) 50%, transparent 90%)` }}
      />

      <div className="p-4 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="relative h-8 w-8 rounded-xl flex items-center justify-center overflow-hidden ai-brain-icon"
              style={{
                background: 'linear-gradient(135deg, rgba(139,92,246,0.25), rgba(139,92,246,0.08))',
                border: '1px solid rgba(139,92,246,0.3)',
              }}
            >
              <Brain className="h-4 w-4 text-violet-400" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[14px] font-bold text-foreground tracking-tight">{t("dashboard.aiAnalysis")}</span>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-40" style={{ backgroundColor: consensusColor }} />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ backgroundColor: consensusColor, boxShadow: `0 0 4px ${consensusColor}` }} />
                </span>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <Activity className="h-2.5 w-2.5 text-muted-foreground/50" />
                <span className="text-[10px] text-muted-foreground/55 font-medium">{t("dashboard.modelsCount", { count: sorted.length })}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
            style={{
              background: `rgba(${consensusGlow},0.1)`,
              border: `1px solid rgba(${consensusGlow},0.3)`,
            }}
          >
            {consensusRaw === "BULLISH" ? <TrendingUp className="h-3 w-3" style={{ color: consensusColor }} /> : consensusRaw === "BEARISH" ? <TrendingDown className="h-3 w-3" style={{ color: consensusColor }} /> : <Minus className="h-3 w-3" style={{ color: consensusColor }} />}
            <span className="text-[10px] font-extrabold" style={{ color: consensusColor }}>
              {consensusLabel}
            </span>
            <span className="text-[9px] font-bold text-muted-foreground/50 ml-0.5">{bullCount}/{sorted.length}</span>
          </div>
        </div>
      </div>

      <div className="px-4 pb-3">
        <FeaturedCard
          forecast={bestForecast}
          isActive={activeModel === bestForecast.model || !activeModel}
          onSelect={() => onSelectModel(bestForecast.model)}
        />
      </div>

      {otherForecasts.length > 0 && (
        <div
          className="pb-3 pt-1"
          onMouseEnter={() => setMarqueeHovered(true)}
          onMouseLeave={() => setMarqueeHovered(false)}
          onTouchStart={() => setMarqueeHovered(true)}
          onTouchEnd={() => setMarqueeHovered(false)}
        >
          <MarqueeRow paused={marqueeHovered}>
            {otherForecasts.map((f) => (
              <CompactModelPill
                key={f.model}
                forecast={f}
                isActive={activeModel === f.model}
                onSelect={() => onSelectModel(f.model)}
              />
            ))}
          </MarqueeRow>
        </div>
      )}
    </div>
  );
}
