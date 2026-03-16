import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Users, Lock } from "lucide-react";
import { VAULT_CHART_PERIODS, type VaultChartPeriod } from "@/lib/data";
import { generateVaultChartData } from "@/lib/formulas";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useHLVault } from "@/hooks/use-hl-vault";

export function VaultChart() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<VaultChartPeriod>("ALL");
  const chartData = useMemo(() => generateVaultChartData(period), [period]);
  const { tvlFormatted, followers, positions: posCount } = useHLVault();

  return (
    <div className="gradient-green-dark p-5 pt-2 rounded-b-2xl">
      <h2 className="text-lg font-bold mb-1" data-testid="text-vault-title">{t("vault.title")}</h2>
      <div className="text-xs text-muted-foreground mb-2">{t("vault.tvl")}</div>
      <div className="flex items-baseline gap-3 flex-wrap mb-1">
        <span className="text-3xl font-bold tracking-tight" data-testid="text-vault-total">
          {tvlFormatted}
        </span>
        <Badge className="bg-primary/15 text-neon-value text-xs no-default-hover-elevate no-default-active-elevate">
          <TrendingUp className="mr-1 h-3 w-3" />TVL
        </Badge>
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-1">
        <span className="flex items-center gap-1"><Users className="h-3 w-3" />{t("vault.holders")}: {followers}+</span>
        <span className="flex items-center gap-1"><Lock className="h-3 w-3" />{t("vault.activePositions")}: {posCount}+</span>
      </div>
      <div className="h-36 mt-3" data-testid="chart-vault">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="vaultGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(174, 72%, 46%)" stopOpacity={0.25} />
                <stop offset="95%" stopColor="hsl(174, 72%, 46%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="value" stroke="hsl(174, 72%, 46%)" strokeWidth={2} fill="url(#vaultGrad)" dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex gap-2 mt-2">
        {VAULT_CHART_PERIODS.map((p) => (
          <Button
            key={p}
            variant={period === p ? "default" : "ghost"}
            size="sm"
            className={`text-xs ${period === p ? "" : "text-muted-foreground"}`}
            onClick={() => setPeriod(p)}
            data-testid={`button-chart-period-${p}`}
          >
            {p}
          </Button>
        ))}
      </div>
    </div>
  );
}
