import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, BarChart3, Target } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGrowingStats } from "@/hooks/use-growing-stats";

// Deterministic value per hour, changes once per hour
function seededRandom(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

function getHourlyValue(min: number, max: number, salt: number) {
  const hourSeed = Math.floor(Date.now() / (1000 * 60 * 60)); // changes every hour
  return min + seededRandom(hourSeed + salt) * (max - min);
}

function useHourlyValue(min: number, max: number, salt: number) {
  const [value, setValue] = useState(() => getHourlyValue(min, max, salt));
  useEffect(() => {
    // Check every minute if the hour changed
    const interval = setInterval(() => {
      setValue(getHourlyValue(min, max, salt));
    }, 60_000);
    return () => clearInterval(interval);
  }, [min, max, salt]);
  return value;
}

export function StrategyHeader() {
  const { t } = useTranslation();
  const { tvlFormatted } = useGrowingStats();
  const floatingWinRate = useHourlyValue(80, 85, 100);
  const floatingMonthlyReturn = useHourlyValue(25, 35, 200);

  return (
    <div className="gradient-green-dark p-4 pt-2 rounded-b-2xl" style={{ animation: "fadeSlideIn 0.4s ease-out" }}>
      <h2 className="text-lg font-bold mb-3" data-testid="text-strategy-title">{t("strategy.aiStrategies")}</h2>
      <Card className="border-border bg-card/50 glow-green-sm">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[12px] text-muted-foreground mb-1">{t("strategy.totalAum")}</div>
              <div className="text-2xl font-bold" data-testid="text-total-aum">{tvlFormatted}</div>
            </div>
            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Card className="border-border bg-card/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-1 text-[12px] text-muted-foreground mb-1">
              <Target className="h-3 w-3" /> {t("strategy.avgWinRate")}
            </div>
            <div className="text-xl font-bold text-neon-value" data-testid="text-win-rate">{floatingWinRate.toFixed(1)}%</div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-1 text-[12px] text-muted-foreground mb-1">
              <BarChart3 className="h-3 w-3" /> {t("strategy.avgMonthlyReturn")}
            </div>
            <div className="text-xl font-bold text-neon-value" data-testid="text-avg-return">{floatingMonthlyReturn.toFixed(1)}%</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
