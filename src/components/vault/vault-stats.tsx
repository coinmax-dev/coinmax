import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Users, Lock, Layers } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { VAULT_PLANS } from "@/lib/data";
import { useTranslation } from "react-i18next";
import { useHLVault } from "@/hooks/use-hl-vault";

export function VaultStats() {
  const { t } = useTranslation();
  const { tvlFormatted, followers, positions } = useHLVault();

  const maxApr = Object.values(VAULT_PLANS).reduce((max, p) => {
    const apr = parseFloat(p.apr);
    return apr > max ? apr : max;
  }, 0);

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card className="border-border bg-card">
        <CardContent className="p-4">
          <div className="text-[12px] text-muted-foreground mb-1 flex items-center gap-1">
            <Layers className="h-3 w-3" /> {t("vault.tvl")}
          </div>
          <div className="text-lg font-bold" data-testid="text-tvl">{tvlFormatted}</div>
        </CardContent>
      </Card>
      <Card className="border-border bg-card">
        <CardContent className="p-4">
          <div className="text-[12px] text-muted-foreground mb-1 flex items-center gap-1">
            <Clock className="h-3 w-3" /> {t("vault.maxApr")}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-neon-value" data-testid="text-max-apr">{maxApr}%</span>
            <Badge className="text-[12px] bg-primary/15 text-primary no-default-hover-elevate no-default-active-elevate">APR</Badge>
          </div>
        </CardContent>
      </Card>
      <Card className="border-border bg-card">
        <CardContent className="p-4">
          <div className="text-[12px] text-muted-foreground mb-1 flex items-center gap-1">
            <Users className="h-3 w-3" /> {t("vault.holders")}
          </div>
          <div className="text-lg font-bold" data-testid="text-holders">{followers}+</div>
        </CardContent>
      </Card>
      <Card className="border-border bg-card">
        <CardContent className="p-4">
          <div className="text-[12px] text-muted-foreground mb-1 flex items-center gap-1">
            <Lock className="h-3 w-3" /> {t("vault.activePositions")}
          </div>
          <div className="text-lg font-bold" data-testid="text-positions">{positions}+</div>
        </CardContent>
      </Card>
    </div>
  );
}
