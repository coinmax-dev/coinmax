import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Flame } from "lucide-react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { generateStrategyChartData, getReturnColor } from "@/lib/formulas";
import { formatCompact } from "@/lib/constants";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import type { LocalStrategy } from "@/lib/data";

function seededFloat(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

function useFloatingValue(min: number, max: number, salt: number, intervalMs: number) {
  const getValue = () => {
    const tick = Math.floor(Date.now() / intervalMs);
    return min + seededFloat(tick + salt) * (max - min);
  };
  const [value, setValue] = useState(getValue);
  useEffect(() => {
    const id = setInterval(() => setValue(getValue()), 60_000);
    return () => clearInterval(id);
  }, [min, max, salt, intervalMs]);
  return value;
}

interface StrategyCardProps {
  strategy: LocalStrategy;
  index: number;
  onSubscribe?: (strategy: LocalStrategy) => void;
}

export function StrategyCard({ strategy, index, onSubscribe }: StrategyCardProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const isHL = strategy.type === "hyperliquid";
  const isOC = strategy.type === "openclaw";

  const winRate = useFloatingValue(
    strategy.winRateRange[0], strategy.winRateRange[1],
    index * 137, strategy.updateIntervalMs,
  );
  const monthlyReturn = useFloatingValue(
    strategy.monthlyReturnRange[0], strategy.monthlyReturnRange[1],
    index * 251, strategy.updateIntervalMs,
  );
  const aum = useFloatingValue(
    strategy.totalAumRange[0], strategy.totalAumRange[1],
    index * 389, strategy.updateIntervalMs,
  );

  const isPositive = monthlyReturn >= 0;
  const color = getReturnColor(isPositive);
  const chartData = useMemo(() => generateStrategyChartData(index), [index]);

  const handleClick = () => {
    if (onSubscribe) {
      onSubscribe(strategy);
    } else if (isHL) {
      toast({ title: t("strategy.levelNotReached"), description: t("strategy.levelNotReachedDesc") });
    } else {
      toast({ title: t("common.comingSoon") });
    }
  };

  return (
    <Card
      className="border-border bg-card hover-elevate relative overflow-hidden h-full"
      data-testid={`strategy-card-${strategy.id}`}
      style={{ animation: `fadeSlideIn 0.4s ease-out ${index * 0.08}s both` }}
    >
      {/* Strategy background */}
      {isOC && (
        <div
          className="absolute inset-0 z-0 pointer-events-none opacity-[0.25]"
          style={{
            backgroundImage: "url(/OPENCLAW.png)",
            backgroundSize: "55%",
            backgroundPosition: "center center",
            backgroundRepeat: "no-repeat",
          }}
        />
      )}
      {isHL && (
        <div
          className="absolute inset-0 z-0 pointer-events-none opacity-[0.2]"
          style={{
            backgroundImage: "url(/hyperliquid-bg.png)",
            backgroundSize: "50%",
            backgroundPosition: "center center",
            backgroundRepeat: "no-repeat",
          }}
        />
      )}
      <CardContent className="p-3 relative z-[1] h-full flex flex-col">
        <div className="flex items-start justify-between gap-1 mb-1">
          <h4 className="text-xs font-semibold leading-tight line-clamp-2 flex-1">{strategy.name}</h4>
          <div className="flex gap-1 shrink-0">
            {strategy.isHot && (
              <Badge className="bg-red-500/15 text-red-400 text-[11px] no-default-hover-elevate no-default-active-elevate">
                <Flame className="h-2.5 w-2.5 mr-0.5" />{t("strategy.hot")}
              </Badge>
            )}
          </div>
        </div>
        {strategy.description && (
          <p className="text-[12px] text-muted-foreground line-clamp-2 mb-1">{strategy.description}</p>
        )}
        <div className="text-[12px] text-muted-foreground mb-1">
          {strategy.leverage} | AUM: {formatCompact(aum)}
        </div>
        <div className={`text-xl font-bold mb-1 ${isPositive ? "text-neon-value" : "text-red-400"}`}>
          +{monthlyReturn.toFixed(2)}%
        </div>
        <div className="text-[12px] text-muted-foreground mb-2">Win: {winRate.toFixed(1)}%</div>
        <div className="h-10 w-full mt-auto">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id={`sg-${index}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#sg-${index})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="w-full mt-2 text-xs"
          data-testid={`button-subscribe-${strategy.id}`}
          onClick={handleClick}
        >
          {isHL ? t("strategy.deposit") : t("common.subscribe")}
        </Button>
      </CardContent>
    </Card>
  );
}
