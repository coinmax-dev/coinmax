import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveAccount } from "thirdweb/react";
import { shortenAddress } from "@/lib/constants";
import { useMaPrice } from "@/hooks/use-ma-price";
import { Copy, Crown, WalletCards, Wallet, ArrowUpFromLine, ChevronRight, Bell, Settings, History, GitBranch, Loader2, Server, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getProfile, getNodeOverview, getVaultPositions, subscribeVip } from "@/lib/api";
import type { NodeOverview } from "@shared/types";
import { queryClient } from "@/lib/queryClient";
import { usePayment, getPaymentStatusLabel } from "@/hooks/use-payment";
import { VIP_CONTRACT_ADDRESS } from "@/lib/contracts";
import { VIP_PLANS } from "@/lib/data";
import type { Profile } from "@shared/types";

import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";

const MENU_ITEMS = [
  { labelKey: "profile.nodeManagement", icon: Server, path: "/profile/nodes", descKey: "profile.nodeManagementDesc" },
  { labelKey: "profile.referralTeam", icon: GitBranch, path: "/profile/referral", descKey: "profile.referralTeamDesc" },
  { labelKey: "profile.transactionHistory", icon: History, path: "/profile/transactions", descKey: "profile.transactionHistoryDesc" },
  { labelKey: "profile.notifications", icon: Bell, path: "/profile/notifications", descKey: "profile.notificationsDesc" },
  { labelKey: "profile.settings", icon: Settings, path: "/profile/settings", descKey: "profile.settingsDesc" },
];

export default function ProfilePage() {
  const { t } = useTranslation();
  const account = useActiveAccount();
  const { toast } = useToast();
  const { formatMA, formatCompactMA } = useMaPrice();
  const [, navigate] = useLocation();
  const walletAddr = account?.address || "";
  const isConnected = !!walletAddr;

  const { data: profile, isLoading: profileLoading } = useQuery<Profile>({
    queryKey: ["profile", walletAddr],
    queryFn: () => getProfile(walletAddr),
    enabled: isConnected,
  });

  const { data: nodeOverview } = useQuery<NodeOverview>({
    queryKey: ["node-overview", walletAddr],
    queryFn: () => getNodeOverview(walletAddr),
    enabled: isConnected,
  });

  const { data: vaultPositions } = useQuery({
    queryKey: ["vault-positions", walletAddr],
    queryFn: () => getVaultPositions(walletAddr),
    enabled: isConnected,
  });

  const vaultYield = useMemo(() => {
    if (!vaultPositions) return 0;
    const now = new Date();
    let yieldSum = 0;
    for (const p of vaultPositions) {
      if (p.status !== "ACTIVE") continue;
      const amt = Number(p.principal || 0);
      const start = new Date(p.startDate!);
      const days = Math.max(0, Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
      yieldSum += amt * Number(p.dailyRate || 0) * days;
    }
    return yieldSum;
  }, [vaultPositions]);

  const payment = usePayment();

  const vipMutation = useMutation({
    mutationFn: async () => {
      let txHash: string | undefined;
      if (VIP_CONTRACT_ADDRESS) {
        txHash = await payment.payVIPSubscribe("monthly");
      }
      const result = await subscribeVip(walletAddr, txHash, "monthly");
      payment.markSuccess();
      return result;
    },
    onSuccess: () => {
      toast({ title: t("strategy.vipActivated"), description: t("strategy.vipActivatedDesc") });
      queryClient.invalidateQueries({ queryKey: ["profile", walletAddr] });
      payment.reset();
    },
    onError: (err: Error) => {
      const failedTxHash = payment.txHash;
      const desc = failedTxHash
        ? `${err.message}\n\nOn-chain tx: ${failedTxHash}\nPlease contact support.`
        : err.message;
      toast({ title: "Error", description: desc, variant: "destructive" });
      payment.reset();
    },
  });

  const deposited = Number(profile?.totalDeposited || 0);
  const withdrawn = Number(profile?.totalWithdrawn || 0);
  const referralEarnings = Number(profile?.referralEarnings || 0);
  const nodeEarnings = Number(nodeOverview?.rewards?.totalEarnings || 0);
  const totalEarnings = nodeEarnings + vaultYield + referralEarnings;
  const net = deposited - withdrawn + referralEarnings;

  return (
    <div className="space-y-4 pb-24" data-testid="page-profile">
      <div className="gradient-green-dark p-4 pt-2 rounded-b-2xl" style={{ animation: "fadeSlideIn 0.4s ease-out" }}>
        <h2 className="text-lg font-bold mb-3" data-testid="text-profile-title">{t("profile.assetsOverview")}</h2>
        <Card className="border-border bg-card/50 glow-green-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[12px] text-muted-foreground mb-1">{t("profile.totalAssets")}</div>
                {!isConnected ? (
                  <div className="text-2xl font-bold text-muted-foreground" data-testid="text-net-assets">--</div>
                ) : profileLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-bold text-neon-value" data-testid="text-net-assets">{formatMA(net)}</div>
                )}
              </div>
              <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center glow-green-sm">
                <Wallet className="h-5 w-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {isConnected && (
        <div className="px-4" style={{ animation: "fadeSlideIn 0.4s ease-out 0.08s both" }}>
          <Card className="border-border bg-card glow-green-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <TrendingUp className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="text-[12px] text-muted-foreground mb-0.5">{t("profile.totalEarningsLabel")}</div>
                    {profileLoading ? (
                      <Skeleton className="h-6 w-20" />
                    ) : (
                      <div className="text-lg font-bold text-neon-value" data-testid="text-total-earnings">
                        {formatMA(totalEarnings)}
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    toast({ title: t("profile.withdrawEarnings"), description: t("profile.withdrawEarningsDesc") });
                  }}
                  disabled={totalEarnings <= 0}
                  data-testid="button-withdraw-earnings"
                >
                  <ArrowUpFromLine className="mr-1 h-3 w-3" /> {t("common.withdraw")}
                </Button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-card/80 border border-border/50 p-2">
                  <div className="text-[11px] text-muted-foreground">{t("profile.nodeEarningsLabel")}</div>
                  <div className="text-xs font-bold text-neon-value">{formatCompactMA(nodeEarnings)}</div>
                </div>
                <div className="rounded-md bg-card/80 border border-border/50 p-2">
                  <div className="text-[11px] text-muted-foreground">{t("profile.vaultEarningsLabel")}</div>
                  <div className="text-xs font-bold text-neon-value">{formatCompactMA(vaultYield)}</div>
                </div>
                <div className="rounded-md bg-card/80 border border-border/50 p-2">
                  <div className="text-[11px] text-muted-foreground">{t("profile.brokerEarningsLabel")}</div>
                  <div className="text-xs font-bold text-neon-value">{formatCompactMA(referralEarnings)}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {!isConnected && (
        <div className="px-4" style={{ animation: "fadeSlideIn 0.4s ease-out 0.1s both" }}>
          <Card className="border-border bg-card border-dashed">
            <CardContent className="p-4 text-center">
              <WalletCards className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground" data-testid="text-connect-prompt">
                {t("common.connectWalletPrompt")}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="px-4" style={{ animation: "fadeSlideIn 0.4s ease-out 0.1s both" }}>
        <Card className="border-border bg-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted-foreground mb-1">{t("profile.connectedWallet")}</div>
                {!isConnected ? (
                  <div className="font-mono text-sm text-muted-foreground" data-testid="text-wallet-address">{t("common.notConnected")}</div>
                ) : profileLoading ? (
                  <Skeleton className="h-5 w-32" />
                ) : (
                  <div className="font-mono text-sm font-medium" data-testid="text-wallet-address">
                    {shortenAddress(walletAddr)}
                  </div>
                )}
              </div>
              {isConnected && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(walletAddr);
                    toast({ title: t("common.copied"), description: t("common.copiedDesc") });
                  }}
                  data-testid="button-copy-address"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              )}
            </div>
            {isConnected && profile && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="text-[12px] no-default-hover-elevate no-default-active-elevate" data-testid="badge-rank">
                  {t("common.rank")}: {profile.rank}
                </Badge>
                <Badge variant="secondary" className="text-[12px] no-default-hover-elevate no-default-active-elevate" data-testid="badge-node-type">
                  {t("common.node")}: {profile.nodeType}
                </Badge>
                {profile.isVip && (
                  <Badge className="bg-primary/20 text-primary text-[12px] no-default-hover-elevate no-default-active-elevate" data-testid="badge-vip">
                    VIP
                  </Badge>
                )}
              </div>
            )}
            {!isConnected && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="text-[12px] no-default-hover-elevate no-default-active-elevate">
                  {t("common.rank")}: --
                </Badge>
                <Badge variant="secondary" className="text-[12px] no-default-hover-elevate no-default-active-elevate">
                  {t("common.node")}: --
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="px-4" style={{ animation: "fadeSlideIn 0.4s ease-out 0.15s both" }}>
        <Card className="border-border bg-card glow-green-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <Crown className="h-4 w-4 text-primary shrink-0" />
                <span className="text-xs font-semibold">
                  {isConnected && profile?.isVip ? t("profile.vipActive") : t("profile.upgradeToVip")}
                </span>
              </div>
              {isConnected && !profile?.isVip && (
                <Button
                  size="sm"
                  onClick={() => vipMutation.mutate()}
                  disabled={vipMutation.isPending}
                  data-testid="button-subscribe-vip"
                >
                  {vipMutation.isPending ? (
                    <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> {getPaymentStatusLabel(payment.status) || t("common.processing")}</>
                  ) : (
                    <>{t("profile.subscribeVip")} (${VIP_PLANS.monthly.price})</>
                  )}
                </Button>
              )}
              {!isConnected && (
                <Badge variant="secondary" className="text-[12px] no-default-hover-elevate no-default-active-elevate">
                  {t("common.connectToUnlock")}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="px-4" style={{ animation: "fadeSlideIn 0.4s ease-out 0.2s both" }}>
        <h3 className="text-sm font-bold mb-3">{t("profile.menu")}</h3>
        <Card className="border-border bg-card">
          <CardContent className="p-0">
            {MENU_ITEMS.map((item, idx) => (
              <button
                key={item.path}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-left hover-elevate ${
                  idx < MENU_ITEMS.length - 1 ? "border-b border-border/50" : ""
                }`}
                onClick={() => navigate(item.path)}
                data-testid={`menu-${item.path.split("/").pop()}`}
              >
                <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                  <item.icon className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{t(item.labelKey)}</div>
                  <div className="text-[12px] text-muted-foreground">{t(item.descKey)}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
