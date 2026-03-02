import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Diamond } from "lucide-react";
import { fetchExchangeDepth } from "@/lib/api";
import { useTranslation } from "react-i18next";

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

  useEffect(() => {
    setDisplay(value);
  }, [value]);

  useEffect(() => {
    const tick = () => {
      setDisplay(() => {
        const jitter = (Math.random() - 0.5) * 0.5;
        return Math.max(0, Math.min(100, value + jitter));
      });
      tickRef.current = setTimeout(tick, 300 + Math.random() * 300);
    };
    tickRef.current = setTimeout(tick, 400);
    return () => clearTimeout(tickRef.current);
  }, [value]);

  return (
    <span className="font-mono font-semibold tabular-nums" style={{ color }}>
      {display.toFixed(1)}%
    </span>
  );
}

const EXCHANGE_ICONS: Record<string, string> = {
  "Binance": "₿",
  "OKX": "◎",
  "Bybit": "BY",
  "Bitfinex": "bf",
  "Kraken": "Kr",
  "KuCoin": "KC",
  "Gate.io": "Gt",
  "MEXC": "MX",
  "Huobi": "Hb",
  "Coinbase": "CB",
  "Bitstamp": "Bs",
  "Gemini": "Gm",
  "Crypto.com": "Cr",
  "WhiteBIT": "WB",
  "dYdX": "dX",
  "Lighter": "Lt",
  "BingX": "BX",
  "Bitunix": "Bu",
  "Deribit": "Db",
  "Aster": "As",
  "Bitmex": "Bm",
};

function getExchangeIcon(name: string) {
  return EXCHANGE_ICONS[name] || name.substring(0, 2).toUpperCase();
}

function DepthDiamond({ buyPercent }: { buyPercent: number }) {
  const swayAmount = (buyPercent - 50) * 0.3;

  return (
    <div
      className="depth-diamond-wrap absolute z-10"
      style={{
        left: `${buyPercent}%`,
        top: '50%',
        transform: `translate(-50%, -50%)`,
      }}
    >
      <Diamond
        className="depth-diamond-icon h-3.5 w-3.5"
        style={{
          '--sway-amount': `${swayAmount}deg`,
        } as React.CSSProperties}
      />
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
            <Skeleton key={i} className="h-7 w-full rounded-md" />
          ))}
        </div>
      ) : (
        <div className="space-y-1.5">
          {exchanges.map((ex, index) => (
            <div
              key={ex.name}
              className="depth-row flex items-center gap-2"
              data-testid={`exchange-${ex.name.toLowerCase().replace(/\./g, "")}`}
              style={{
                opacity: mounted ? 1 : 0,
                transform: mounted ? "translateX(0)" : "translateX(-8px)",
                transition: `opacity 0.4s ease ${index * 40}ms, transform 0.4s ease ${index * 40}ms`,
              }}
            >
              <div className="flex items-center gap-1.5 w-[72px] shrink-0">
                <div className="depth-exchange-icon h-5 w-5 rounded flex items-center justify-center text-[7px] font-black shrink-0"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    color: 'rgba(255,255,255,0.6)',
                  }}
                >
                  {getExchangeIcon(ex.name)}
                </div>
                <span className="text-[11px] font-medium text-foreground/80 truncate">{ex.name}</span>
              </div>

              <span className="w-[28px] shrink-0 text-[10px] text-right text-emerald-400/80 font-medium">
                {t("dashboard.buyLabel")}
              </span>

              <span className="w-[40px] shrink-0 text-[10px] text-right">
                <JitterPercent value={ex.buy} color="#34d399" />
              </span>

              <div className="flex-1 relative h-5 overflow-visible">
                <div className="absolute inset-0 flex h-full rounded overflow-hidden">
                  <div
                    className="depth-bar-buy transition-all duration-700 ease-out"
                    style={{
                      width: mounted ? `${ex.buy}%` : "0%",
                      background: 'linear-gradient(90deg, rgba(16,185,129,0.6), rgba(16,185,129,0.85))',
                    }}
                  />
                  <div
                    className="depth-bar-sell transition-all duration-700 ease-out"
                    style={{
                      width: mounted ? `${ex.sell}%` : "0%",
                      background: 'linear-gradient(90deg, rgba(239,68,68,0.85), rgba(239,68,68,0.6))',
                    }}
                  />
                </div>
                <DepthDiamond buyPercent={ex.buy} />
              </div>

              <span className="w-[40px] shrink-0 text-[10px]">
                <JitterPercent value={ex.sell} color="#f87171" />
              </span>

              <span className="w-[28px] shrink-0 text-[10px] text-red-400/80 font-medium">
                {t("dashboard.sellLabel")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
