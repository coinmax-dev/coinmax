import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { fetchExchangeDepth } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { ExchangeLogo } from "@/components/exchange-logo";

interface ExchangeRow {
  name: string;
  buy: number;
  sell: number;
}

interface ExchangeAggData {
  exchanges: ExchangeRow[];
  aggregatedBuy: number;
  aggregatedSell: number;
  fearGreedIndex: number;
  fearGreedLabel: string;
  longShortRatio: number;
  timestamp: number;
}

interface ExchangeDepthProps {
  symbol: string;
}

function JitterPercent({ value, color }: { value: number; color: string }) {
  const [display, setDisplay] = useState(value);
  const tickRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { setDisplay(value); }, [value]);

  useEffect(() => {
    const tick = () => {
      setDisplay((prev) => {
        const target = value + (Math.random() - 0.5) * 1.0;
        const clamped = Math.max(0, Math.min(100, target));
        return prev + (clamped - prev) * 0.4;
      });
      tickRef.current = setTimeout(tick, 150 + Math.random() * 200);
    };
    tickRef.current = setTimeout(tick, 150);
    return () => clearTimeout(tickRef.current);
  }, [value]);

  return (
    <span className="font-mono font-semibold tabular-nums text-[10px]" style={{ color }}>
      {display.toFixed(1)}%
    </span>
  );
}

function GemIndicator({ position }: { position: number }) {
  return (
    <div
      className="depth-gem-wrap absolute z-10 top-1/2"
      style={{ left: `${position}%`, transform: 'translate(-50%, -50%)' }}
    >
      <svg width="10" height="14" viewBox="0 0 10 14" className="depth-gem-icon">
        <path d="M5 0 L10 5 L5 14 L0 5 Z" fill="rgba(255,255,255,0.9)" />
        <path d="M5 0 L10 5 L5 14 L0 5 Z" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5" />
        <path d="M0 5 L5 3 L10 5" fill="rgba(255,255,255,0.15)" />
      </svg>
    </div>
  );
}

function DepthBarRow({ ex, mounted, index }: { ex: ExchangeRow; mounted: boolean; index: number }) {
  const { t } = useTranslation();
  const [buyWidth, setBuyWidth] = useState(ex.buy);
  const tickRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { setBuyWidth(ex.buy); }, [ex.buy]);

  useEffect(() => {
    const oscillate = () => {
      setBuyWidth((prev) => {
        const target = ex.buy + (Math.random() - 0.5) * 2.0;
        const clamped = Math.max(1, Math.min(99, target));
        return prev + (clamped - prev) * 0.4;
      });
      tickRef.current = setTimeout(oscillate, 150 + Math.random() * 200);
    };
    tickRef.current = setTimeout(oscillate, 150);
    return () => clearTimeout(tickRef.current);
  }, [ex.buy]);

  const sellWidth = 100 - buyWidth;

  return (
    <div
      className="depth-row flex items-center gap-1.5"
      data-testid={`exchange-${ex.name.toLowerCase().replace(/\./g, "")}`}
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateX(0)" : "translateX(-8px)",
        transition: `opacity 0.4s ease ${index * 40}ms, transform 0.4s ease ${index * 40}ms`,
      }}
    >
      <div className="w-[72px] shrink-0 flex items-center gap-1.5 min-w-0">
        <ExchangeLogo name={ex.name} size={14} />
        <span className="text-[11px] font-medium text-foreground/80 truncate">{ex.name}</span>
      </div>
      <span className="w-[18px] shrink-0 text-[11px] text-emerald-400/70 font-medium">{t("dashboard.buyLabel")}</span>
      <span className="w-[36px] shrink-0 text-right"><JitterPercent value={ex.buy} color="#34d399" /></span>

      <div className="flex-1 relative h-[18px] min-w-0">
        <div className="absolute inset-0 flex h-full rounded-sm overflow-hidden">
          <div
            className="transition-[width] duration-200 ease-out"
            style={{
              width: mounted ? `${buyWidth}%` : "0%",
              background: 'linear-gradient(90deg, rgba(16,185,129,0.5), rgba(16,185,129,0.8))',
            }}
          />
          <div
            className="transition-[width] duration-200 ease-out"
            style={{
              width: mounted ? `${sellWidth}%` : "0%",
              background: 'linear-gradient(90deg, rgba(239,68,68,0.8), rgba(239,68,68,0.5))',
            }}
          />
        </div>
        {mounted && <GemIndicator position={buyWidth} />}
      </div>

      <span className="w-[36px] shrink-0"><JitterPercent value={ex.sell} color="#f87171" /></span>
      <span className="w-[18px] shrink-0 text-[11px] text-red-400/70 font-medium text-right">{t("dashboard.sellLabel")}</span>
    </div>
  );
}

export function ExchangeDepth({ symbol }: ExchangeDepthProps) {
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(false);

  const { data, isLoading } = useQuery<ExchangeAggData>({
    queryKey: ["exchange-depth", symbol],
    queryFn: async () => {
      const depth = await fetchExchangeDepth(symbol);
      return {
        exchanges: depth.exchanges.map(e => ({ name: e.name, buy: e.buyPercent, sell: e.sellPercent })),
        aggregatedBuy: depth.buyPercent,
        aggregatedSell: depth.sellPercent,
        fearGreedIndex: depth.fearGreedIndex,
        fearGreedLabel: depth.fearGreedLabel,
        longShortRatio: depth.buyPercent / (depth.sellPercent || 1),
        timestamp: Date.now(),
      };
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    setMounted(false);
    const timer = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(timer);
  }, [symbol, data]);

  const exchanges = data?.exchanges || [];

  return (
    <div data-testid="section-exchange-depth">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold">{t("dashboard.orderBookDepth", { symbol })}</h3>
        {data && (
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/30 no-default-hover-elevate no-default-active-elevate">
              {t("dashboard.lsRatio")}: {data.longShortRatio.toFixed(2)}
            </Badge>
            <Badge variant="outline" className="text-[10px] text-primary/70 border-primary/30 no-default-hover-elevate no-default-active-elevate">
              {t("common.live")}
            </Badge>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-full rounded-sm" />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {exchanges.map((ex, index) => (
            <DepthBarRow key={ex.name} ex={ex} mounted={mounted} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}
