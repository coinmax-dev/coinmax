import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveAccount } from "thirdweb/react";
import { shortenAddress } from "@/lib/constants";
import { useMaPrice } from "@/hooks/use-ma-price";
import { ArrowLeft, TrendingUp, Users, UserPlus, ArrowUpFromLine, WalletCards, Layers } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getCommissionRecords, getProfile } from "@/lib/api";
import type { Profile, CommissionSummary } from "@shared/types";
import { useTranslation } from "react-i18next";

export default function ProfileCommissionPage() {
  const { t } = useTranslation();
  const account = useActiveAccount();
  const { toast } = useToast();
  const { formatCompactMA, usdcToMA } = useMaPrice();
  const [, navigate] = useLocation();
  const walletAddr = account?.address || "";
  const isConnected = !!walletAddr;

  const { data: profile } = useQuery<Profile>({
    queryKey: ["profile", walletAddr],
    queryFn: () => getProfile(walletAddr),
    enabled: isConnected,
  });

  const { data: commission, isLoading } = useQuery<CommissionSummary>({
    queryKey: ["commission", walletAddr],
    queryFn: () => getCommissionRecords(walletAddr),
    enabled: isConnected,
  });

  const totalCommission = Number(commission?.totalCommission || 0);
  const directTotal = Number(commission?.directReferralTotal || 0);
  const diffTotal = Number(commission?.differentialTotal || 0);
  const referralEarnings = Number(profile?.referralEarnings || 0);
  const availableToWithdraw = referralEarnings + totalCommission;

  return (
    <div className="space-y-4 pb-24 lg:pb-8 lg:pt-4" data-testid="page-profile-commission">
      <div className="gradient-green-dark p-4 pt-2 rounded-b-2xl lg:rounded-none lg:bg-transparent lg:p-0 lg:pt-2 lg:px-6" style={{ animation: "fadeSlideIn 0.4s ease-out" }}>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Button size="icon" variant="ghost" onClick={() => navigate("/profile")} data-testid="button-back-profile" className="lg:hidden">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-bold">{t("profile.brokerEarnings")}</h1>
        </div>

        {!isConnected ? (
          <Card className="border-border bg-card/50 border-dashed">
            <CardContent className="p-4 text-center">
              <WalletCards className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">{t("profile.connectToViewCommission")}</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="border-border bg-card/50 glow-green-sm mb-3">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[12px] text-muted-foreground mb-1">{t("profile.totalBrokerEarnings")}</div>
                    {isLoading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <div className="text-2xl font-bold text-neon-value" data-testid="text-total-commission">
                        {formatCompactMA(availableToWithdraw)}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      toast({ title: t("profile.withdrawCommission"), description: t("profile.withdrawCommissionDesc") });
                    }}
                    disabled={availableToWithdraw <= 0}
                    data-testid="button-withdraw-commission"
                  >
                    <ArrowUpFromLine className="mr-1 h-3 w-3" /> {t("common.withdraw")}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-3">
              <Card className="border-border bg-card/50">
                <CardContent className="p-3 text-center">
                  <UserPlus className="h-4 w-4 text-primary mx-auto mb-1" />
                  {isLoading ? (
                    <Skeleton className="h-5 w-16 mx-auto" />
                  ) : (
                    <div className="text-sm font-bold text-neon-value" data-testid="text-direct-total">
                      {formatCompactMA(directTotal)}
                    </div>
                  )}
                  <div className="text-[12px] text-muted-foreground">{t("profile.directReferralBonus")}</div>
                </CardContent>
              </Card>
              <Card className="border-border bg-card/50">
                <CardContent className="p-3 text-center">
                  <Layers className="h-4 w-4 text-primary mx-auto mb-1" />
                  {isLoading ? (
                    <Skeleton className="h-5 w-16 mx-auto" />
                  ) : (
                    <div className="text-sm font-bold text-neon-value" data-testid="text-diff-total">
                      {formatCompactMA(diffTotal)}
                    </div>
                  )}
                  <div className="text-[12px] text-muted-foreground">{t("profile.differentialCommission")}</div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>

      <div className="px-4" style={{ animation: "fadeSlideIn 0.5s ease-out 0.1s both" }}>
        <h3 className="text-sm font-bold mb-3">{t("profile.commissionRecords")}</h3>
        {!isConnected ? (
          <Card className="border-border bg-card">
            <CardContent className="p-6 text-center">
              <TrendingUp className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">{t("profile.connectToViewCommission")}</p>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-md" />
            ))}
          </div>
        ) : !commission?.records.length ? (
          <Card className="border-border bg-card">
            <CardContent className="p-6 text-center">
              <TrendingUp className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground" data-testid="text-no-commission">
                {t("profile.noCommissionRecords")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2" data-testid="commission-list">
            {commission.records.map((record) => {
              const isDirectRef = record.details?.type === "direct_referral";
              const amount = Number(record.amount || 0);
              const depth = record.details?.depth || 0;
              const rate = record.details?.rate;
              const createdAt = record.createdAt
                ? new Date(record.createdAt).toLocaleDateString(undefined, {
                    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                  })
                : "--";

              return (
                <Card key={record.id} className="border-border bg-card">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="h-8 w-8 rounded-md flex items-center justify-center shrink-0 bg-foreground/[0.06]">
                          {isDirectRef ? (
                            <UserPlus className="h-4 w-4 text-foreground/40" />
                          ) : (
                            <Layers className="h-4 w-4 text-foreground/40" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge
                              variant="secondary"
                              className="text-[10px] no-default-hover-elevate no-default-active-elevate shrink-0"
                            >
                              {isDirectRef ? t("profile.directRef") : t("profile.differential")}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground">
                              L{depth}
                            </span>
                            {rate !== undefined && !isDirectRef && (
                              <span className="text-[10px] text-muted-foreground">
                                {(rate * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                            {t("profile.from")}: {record.sourceWallet ? shortenAddress(record.sourceWallet) : "--"}
                            {record.sourceRank && (
                              <span className="ml-1 text-[10px]">({record.sourceRank})</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold text-neon-value">
                          +{usdcToMA(amount).toFixed(2)} MA
                        </div>
                        <div className="text-[10px] text-muted-foreground">{createdAt}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
