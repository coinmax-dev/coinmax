import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VAULT_PLANS } from "@/lib/data";
import { formatDailyRate } from "@/lib/formulas";
import { Sparkles, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface VaultPlansProps {
  selectedPlan?: string;
  onSelectPlan?: (planKey: string) => void;
}

export function VaultPlans({ selectedPlan, onSelectPlan }: VaultPlansProps) {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleSelect = (key: string) => {
    onSelectPlan?.(key);
    setDialogOpen(false);
  };

  return (
    <div>
      <Card className="border-border bg-card" data-testid="card-vault-plans-cta">
        <CardContent className="p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-sm font-bold">{t("vault.vaultPlans")}</div>
                <div className="text-[12px] text-muted-foreground">{t("vault.earnYield")}</div>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => setDialogOpen(true)}
              data-testid="button-open-plans-dialog"
            >
              {t("vault.viewPlans")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">{t("vault.chooseVaultPlan")}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("vault.selectPlanDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {Object.entries(VAULT_PLANS).map(([key, plan]) => {
              const isSelected = selectedPlan === key;
              const isDisabled = key === "180_DAYS";
              return (
                <Card
                  key={key}
                  className={`border-border bg-background transition-all duration-200 ${
                    isDisabled
                      ? "opacity-40 cursor-not-allowed"
                      : `cursor-pointer hover-elevate ${
                          isSelected
                            ? "ring-2 ring-primary border-primary/50 shadow-[0_0_12px_rgba(0,188,165,0.15)]"
                            : ""
                        }`
                  }`}
                  onClick={() => !isDisabled && handleSelect(key)}
                  data-testid={`vault-plan-${key}`}
                >
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                      <span className={`text-sm font-bold ${isSelected && !isDisabled ? "text-primary" : ""}`}>
                        {plan.label}
                      </span>
                      <div className="flex items-center gap-2">
                        {isDisabled && (
                          <span className="px-2 py-0.5 rounded bg-white/10 text-[11px] text-foreground/40">
                            {t("vault.notYetOpen", "暂未开放")}
                          </span>
                        )}
                        <span className="text-xl font-bold text-neon-value">{plan.apr} APR</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                        <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                        <span>{t("vault.dailyRate")}: {formatDailyRate(plan.dailyRate)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                        <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                        <span>{t("vault.lockPeriod")}: {plan.days} days</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
