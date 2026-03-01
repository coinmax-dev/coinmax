import { useRef, useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus, Sparkles, ChevronLeft, ChevronRight, Crown, Brain } from "lucide-react";
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

const MODEL_META: Record<string, { color: string; accent: string; icon: string }> = {
  "GPT-4o":     { color: "rgba(16,163,127,0.12)",  accent: "#10a37f", icon: "G" },
  "Claude":     { color: "rgba(204,132,63,0.12)",   accent: "#cc843f", icon: "C" },
  "Gemini":     { color: "rgba(66,133,244,0.12)",   accent: "#4285f4", icon: "Ge" },
  "DeepSeek":   { color: "rgba(99,102,241,0.12)",   accent: "#6366f1", icon: "D" },
  "Grok":       { color: "rgba(239,68,68,0.12)",    accent: "#ef4444", icon: "Gr" },
  "Llama 3.1":  { color: "rgba(0,136,255,0.12)",    accent: "#0088ff", icon: "L" },
  "Llama 3.3":  { color: "rgba(0,160,255,0.12)",    accent: "#00a0ff", icon: "L" },
  "Llama 8B":   { color: "rgba(0,136,255,0.12)",    accent: "#0078dd", icon: "L" },
  "Mistral":    { color: "rgba(255,116,0,0.12)",    accent: "#ff7400", icon: "M" },
  "Gemma":      { color: "rgba(66,133,244,0.12)",   accent: "#4285f4", icon: "Gm" },
  "Qwen":       { color: "rgba(115,75,209,0.12)",   accent: "#734bd1", icon: "Q" },
};

function getModelMeta(model: string) {
  return MODEL_META[model] || { color: "rgba(100,100,100,0.12)", accent: "#888", icon: model[0] };
}

/* Animated confidence bar */
function ConfidenceRing({ value, accent }: { value: number; accent: string }) {
  const [animValue, setAnimValue] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setAnimValue(value), 100);
    return () => clearTimeout(timer);
  }, [value]);

  return (
    <div className="relative h-8 w-8 shrink-0">
      <svg viewBox="0 0 36 36" className="h-8 w-8 -rotate-90">
        <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
        <circle
          cx="18" cy="18" r="14" fill="none"
          stroke={accent} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${animValue * 0.88} 88`}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold" style={{ color: accent }}>
        {value}
      </span>
    </div>
  );
}

export function AiModelCarousel({ forecasts, isLoading, activeModel, onSelectModel }: AiModelCarouselProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollPos, setScrollPos] = useState(0);

  const scroll = (dir: "left" | "right") => {
    if (!scrollRef.current) return;
    const amount = 200;
    const newPos = dir === "left" ? scrollPos - amount : scrollPos + amount;
    scrollRef.current.scrollTo({ left: newPos, behavior: "smooth" });
    setScrollPos(newPos);
  };

  const handleScroll = () => {
    if (scrollRef.current) setScrollPos(scrollRef.current.scrollLeft);
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex gap-2.5 overflow-hidden">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="h-[130px] min-w-[180px] rounded-xl shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  if (!forecasts || forecasts.length === 0) return null;

  const canScrollLeft = scrollPos > 5;
  const canScrollRight = scrollRef.current
    ? scrollPos < scrollRef.current.scrollWidth - scrollRef.current.clientWidth - 5
    : true;

  // Consensus summary
  const bullCount = forecasts.filter(f => f.direction === "BULLISH").length;
  const bearCount = forecasts.filter(f => f.direction === "BEARISH").length;
  const consensus = bullCount > bearCount ? "BULLISH" : bearCount > bullCount ? "BEARISH" : "MIXED";
  const consensusColor = consensus === "BULLISH" ? "#00e7a0" : consensus === "BEARISH" ? "#ff4976" : "#facc15";

  return (
    <div className="space-y-2.5">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-violet-400" />
          <span className="text-xs font-semibold text-foreground/80 tracking-wide uppercase">AI Analysis</span>
          <Badge
            variant="outline"
            className="text-[9px] font-bold border-0 px-1.5 py-0 ml-1"
            style={{ backgroundColor: `${consensusColor}15`, color: consensusColor }}
          >
            {consensus} {bullCount}/{forecasts.length}
          </Badge>
        </div>
        <span className="text-[10px] text-muted-foreground">{forecasts.length} models</span>
      </div>

      {/* Cards container */}
      <div className="relative">
        {canScrollLeft && (
          <button
            onClick={() => scroll("left")}
            className="absolute -left-1 top-1/2 -translate-y-1/2 z-10 h-6 w-6 rounded-full bg-background/90 backdrop-blur border border-border/40 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        )}
        {canScrollRight && forecasts.length > 2 && (
          <button
            onClick={() => scroll("right")}
            className="absolute -right-1 top-1/2 -translate-y-1/2 z-10 h-6 w-6 rounded-full bg-background/90 backdrop-blur border border-border/40 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex gap-2.5 overflow-x-auto scrollbar-hide px-0.5 pb-1 snap-x snap-mandatory"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {forecasts.map((f, idx) => {
            const meta = getModelMeta(f.model);
            const isBest = idx === 0;
            const isActive = activeModel === f.model;
            const isBullish = f.direction === "BULLISH";
            const isBearish = f.direction === "BEARISH";
            const priceDiff = f.currentPrice ? ((f.targetPrice - f.currentPrice) / f.currentPrice * 100) : 0;

            return (
              <button
                key={f.model}
                className={`
                  relative min-w-[170px] max-w-[190px] rounded-xl ${isBest ? "pt-7 px-2.5 pb-2.5" : "p-2.5"} text-left shrink-0 snap-start
                  transition-all duration-300 border
                  ${isActive
                    ? "border-[var(--accent)] shadow-[0_0_12px_var(--glow)] scale-[1.02]"
                    : "border-white/[0.06] hover:border-white/[0.12]"
                  }
                `}
                style={{
                  background: `linear-gradient(145deg, ${meta.color} 0%, rgba(8,12,10,0.95) 80%)`,
                  "--accent": meta.accent,
                  "--glow": `${meta.accent}30`,
                } as React.CSSProperties}
                onClick={() => onSelectModel(f.model)}
              >
                {/* Best badge */}
                {isBest && (
                  <div className="absolute top-1.5 right-2.5 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[8px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    <Crown className="h-2 w-2" />
                    TOP
                  </div>
                )}

                {/* Model header + confidence ring */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div
                      className="h-5 w-5 rounded-md flex items-center justify-center text-[9px] font-black shrink-0"
                      style={{ backgroundColor: meta.accent, color: "#fff" }}
                    >
                      {meta.icon}
                    </div>
                    <span className="text-[11px] font-bold text-foreground/90 truncate">{f.model}</span>
                  </div>
                  <ConfidenceRing value={f.confidence} accent={meta.accent} />
                </div>

                {/* Direction + price change */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1">
                    {isBullish ? (
                      <TrendingUp className="h-3.5 w-3.5 text-[#00e7a0]" />
                    ) : isBearish ? (
                      <TrendingDown className="h-3.5 w-3.5 text-[#ff4976]" />
                    ) : (
                      <Minus className="h-3.5 w-3.5 text-yellow-400" />
                    )}
                    <span className={`text-xs font-bold ${isBullish ? "text-[#00e7a0]" : isBearish ? "text-[#ff4976]" : "text-yellow-400"}`}>
                      {f.direction}
                    </span>
                  </div>
                  <span className={`text-xs font-mono font-bold ${priceDiff >= 0 ? "text-[#00e7a0]" : "text-[#ff4976]"}`}>
                    {priceDiff >= 0 ? "+" : ""}{priceDiff.toFixed(2)}%
                  </span>
                </div>

                {/* Target price */}
                <div className="flex items-center justify-between mb-1.5 text-[10px]">
                  <span className="text-muted-foreground">{t("dashboard.target")}</span>
                  <span className="font-mono font-semibold text-foreground/80">
                    {formatUSD(f.targetPrice)}
                  </span>
                </div>

                {/* Reasoning */}
                <p className="text-[9px] text-muted-foreground/80 leading-relaxed line-clamp-2">
                  <Sparkles className="inline h-2 w-2 mr-0.5 text-amber-400/70" />
                  {f.reasoning}
                </p>

                {/* Active indicator line */}
                {isActive && (
                  <div
                    className="absolute bottom-0 left-2.5 right-2.5 h-0.5 rounded-full"
                    style={{ backgroundColor: meta.accent, boxShadow: `0 0 8px ${meta.accent}60` }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Dot indicators */}
        {forecasts.length > 2 && (
          <div className="flex justify-center gap-1 mt-2">
            {forecasts.map((f) => (
              <button
                key={f.model}
                className={`h-1 rounded-full transition-all duration-300 ${
                  activeModel === f.model ? "w-3.5" : "w-1"
                }`}
                style={{
                  backgroundColor: activeModel === f.model
                    ? getModelMeta(f.model).accent
                    : "rgba(255,255,255,0.12)",
                }}
                onClick={() => onSelectModel(f.model)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
