import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";

interface DepthBarProps {
  buyPercent: string;
  sellPercent: string;
  isLoading: boolean;
  fearGreedIndex?: number;
  fearGreedLabel?: string;
}

function AnimatedPercent({ value, color, suffix = "%" }: { value: number; color: string; suffix?: string }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const tickRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const prev = prevRef.current;
    const diff = value - prev;
    prevRef.current = value;

    if (Math.abs(diff) > 0.01) {
      let frame = 0;
      const totalFrames = 20;
      const step = () => {
        frame++;
        const t = frame / totalFrames;
        const ease = t * t * (3 - 2 * t);
        setDisplay(prev + diff * ease);
        if (frame < totalFrames) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }, [value]);

  useEffect(() => {
    const tick = () => {
      setDisplay((prev) => {
        const target = value + (Math.random() - 0.5) * 6;
        const clamped = Math.max(5, Math.min(95, target));
        return prev + (clamped - prev) * 0.4;
      });
      tickRef.current = setTimeout(tick, 150 + Math.random() * 200);
    };
    tickRef.current = setTimeout(tick, 150 + Math.random() * 200);
    return () => clearTimeout(tickRef.current);
  }, [value]);

  return (
    <span className="font-mono font-bold tabular-nums transition-colors duration-300" style={{ color }}>
      {display.toFixed(1)}{suffix}
    </span>
  );
}

function AnimatedCounter({ value, color }: { value: number; color: string }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    let frame = 0;
    const totalFrames = 30;
    const start = display;
    const diff = value - start;
    const step = () => {
      frame++;
      const t = frame / totalFrames;
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      setDisplay(Math.round(start + diff * ease));
      if (frame < totalFrames) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [value]);

  return (
    <span
      className="text-lg font-bold tabular-nums"
      style={{ color, textShadow: `0 0 12px ${color}40` }}
      data-testid="text-fear-greed-index"
    >
      {display}
    </span>
  );
}

function GemIndicator({ position }: { position: number }) {
  return (
    <div
      className="depth-gem-wrap absolute z-10 top-1/2"
      style={{ left: `${position}%`, transform: 'translate(-50%, -50%)' }}
    >
      <svg width="12" height="16" viewBox="0 0 10 14" className="depth-gem-icon">
        <path d="M5 0 L10 5 L5 14 L0 5 Z" fill="rgba(255,255,255,0.9)" />
        <path d="M5 0 L10 5 L5 14 L0 5 Z" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5" />
        <path d="M0 5 L5 3 L10 5" fill="rgba(255,255,255,0.15)" />
      </svg>
    </div>
  );
}

export function DepthBar({ buyPercent, sellPercent, isLoading, fearGreedIndex, fearGreedLabel }: DepthBarProps) {
  const { t } = useTranslation();
  const buyNum = parseFloat(buyPercent) || 50;
  const sellNum = parseFloat(sellPercent) || 50;

  const [buyWidth, setBuyWidth] = useState(buyNum);
  const tickRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { setBuyWidth(buyNum); }, [buyNum]);

  useEffect(() => {
    const oscillate = () => {
      setBuyWidth((prev) => {
        const target = buyNum + (Math.random() - 0.5) * 8;
        const clamped = Math.max(15, Math.min(85, target));
        return prev + (clamped - prev) * 0.4;
      });
      tickRef.current = setTimeout(oscillate, 150 + Math.random() * 200);
    };
    tickRef.current = setTimeout(oscillate, 150 + Math.random() * 200);
    return () => clearTimeout(tickRef.current);
  }, [buyNum]);

  if (isLoading) {
    return <Skeleton className="h-20 w-full rounded-md" data-testid="skeleton-depth-bar" />;
  }

  const indexColor =
    fearGreedIndex !== undefined
      ? fearGreedIndex >= 60 ? "#00e7a0" : fearGreedIndex <= 40 ? "#ef4444" : "#facc15"
      : "#888";

  const labelColor =
    fearGreedIndex !== undefined
      ? fearGreedIndex >= 60
        ? "bg-primary/15 text-primary"
        : fearGreedIndex <= 40
          ? "bg-red-500/15 text-red-400"
          : "bg-yellow-500/15 text-yellow-400"
      : "bg-muted text-muted-foreground";

  const sellWidth = 100 - buyWidth;

  return (
    <Card className="glass-card border-0 overflow-hidden rounded-2xl" data-testid="card-depth-bar">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{t("dashboard.depthRatio")}</span>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          </div>
          {fearGreedIndex !== undefined && (
            <div className="flex items-center gap-2">
              <AnimatedCounter value={fearGreedIndex} color={indexColor} />
              {fearGreedLabel && (
                <Badge
                  className={`text-[12px] ${labelColor} no-default-hover-elevate no-default-active-elevate`}
                  data-testid="badge-fear-greed-label"
                >
                  {fearGreedLabel}
                </Badge>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">{t("dashboard.longs")}:</span>
                <AnimatedPercent value={buyNum} color="#00e7a0" />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">{t("dashboard.shorts")}:</span>
                <AnimatedPercent value={sellNum} color="#ef4444" />
              </div>
            </div>

            <div className="relative h-3 rounded-full bg-white/[0.03] overflow-visible" data-testid="bar-depth-ratio">
              <div className="absolute inset-0 flex h-full rounded-full overflow-hidden">
                <div
                  className="bg-gradient-to-r from-emerald-600 to-emerald-400 relative transition-[width] duration-200 ease-out"
                  style={{ width: `${buyWidth}%` }}
                >
                  <div className="absolute inset-0 opacity-50"
                    style={{
                      background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 50%, transparent 100%)",
                      animation: "shimmer 1.5s ease-in-out infinite",
                    }}
                  />
                </div>
                <div
                  className="bg-gradient-to-r from-red-400 to-red-600 relative transition-[width] duration-200 ease-out"
                  style={{ width: `${sellWidth}%` }}
                >
                  <div className="absolute inset-0 opacity-50"
                    style={{
                      background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 50%, transparent 100%)",
                      animation: "shimmer 1.5s ease-in-out infinite 0.3s",
                    }}
                  />
                </div>
              </div>
              <GemIndicator position={buyWidth} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
