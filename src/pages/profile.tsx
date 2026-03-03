import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveAccount } from "thirdweb/react";
import { useMaPrice } from "@/hooks/use-ma-price";
import { Copy, Crown, WalletCards, Wallet, ArrowUpFromLine, ChevronRight, Bell, Settings, History, GitBranch, Loader2, Server, TrendingUp, Share2, Link2 } from "lucide-react";
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

  const refCode = profile?.refCode;
  const referralLink = useMemo(() => {
    if (!refCode || typeof window === "undefined") return "";
    return `${window.location.origin}?ref=${refCode}`;
  }, [refCode]);

  const copyToClipboard = (text: string) => {
    try {
      navigator.clipboard.writeText(text);
      toast({ title: t("common.copied"), description: t("common.copiedDesc") });
    } catch {
      toast({ title: t("common.copied"), description: text });
    }
  };

  const shareReferralLink = () => {
    if (!referralLink) return;
    if (typeof navigator !== "undefined" && navigator.share) {
      navigator.share({
        title: "CoinMax",
        text: t("profile.inviteFriendsDesc"),
        url: referralLink,
      }).catch(() => {});
    } else {
      copyToClipboard(referralLink);
    }
  };

  const cardBorder = "1px solid rgba(74, 222, 128, 0.15)";
  const cardBg = "rgba(10, 15, 10, 0.6)";

  return (
    <div className="space-y-4 pb-24" data-testid="page-profile">
      <div className="px-4 pt-3" style={{ animation: "fadeSlideIn 0.4s ease-out" }}>
        <div
          className="rounded-2xl p-4"
          style={{ border: cardBorder, background: cardBg }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-white/40 mb-1.5">{t("profile.connectedWallet")}</div>
              {!isConnected ? (
                <div className="font-mono text-[14px] text-white/30" data-testid="text-wallet-address">{t("common.notConnected")}</div>
              ) : profileLoading ? (
                <Skeleton className="h-5 w-48" />
              ) : (
                <div
                  className="font-mono text-[14px] font-medium text-white/80 break-all leading-relaxed"
                  data-testid="text-wallet-address"
                >
                  {walletAddr}
                </div>
              )}
            </div>
            {isConnected && (
              <button
                onClick={() => copyToClipboard(walletAddr)}
                className="shrink-0 mt-1 p-2 rounded-lg transition-colors hover:bg-white/5"
                data-testid="button-copy-address"
              >
                <Copy className="h-5 w-5 text-white/50" />
              </button>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {isConnected && profile ? (
              <>
                <span
                  className="text-[12px] px-3 py-1 rounded-md font-medium text-white/70"
                  style={{ border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)" }}
                  data-testid="badge-rank"
                >
                  {t("common.rank")}: {profile.rank}
                </span>
                <span
                  className="text-[12px] px-3 py-1 rounded-md font-medium text-white/70"
                  style={{ border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)" }}
                  data-testid="badge-node-type"
                >
                  {t("common.node")}: {profile.nodeType}
                </span>
                {profile.isVip && (
                  <span
                    className="text-[12px] px-3 py-1 rounded-md font-medium text-primary"
                    style={{ border: "1px solid rgba(74, 222, 128, 0.3)", background: "rgba(74, 222, 128, 0.08)" }}
                    data-testid="badge-vip"
                  >
                    VIP
                  </span>
                )}
              </>
            ) : (
              <>
                <span
                  className="text-[12px] px-3 py-1 rounded-md font-medium text-white/40"
                  style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}
                >
                  {t("common.rank")}: --
                </span>
                <span
                  className="text-[12px] px-3 py-1 rounded-md font-medium text-white/40"
                  style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}
                >
                  {t("common.node")}: --
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {isConnected && referralLink && (
        <div className="px-4" style={{ animation: "fadeSlideIn 0.4s ease-out 0.05s both" }}>
          <div
            className="rounded-2xl p-4"
            style={{ border: cardBorder, background: cardBg }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Link2 className="h-4 w-4 text-primary" />
              <span className="text-[13px] font-semibold text-white/80">{t("profile.inviteFriends")}</span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="flex-1 min-w-0 rounded-lg px-3 py-2.5 font-mono text-[12px] text-white/50 truncate"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                {referralLink}
              </div>
              <button
                onClick={() => copyToClipboard(referralLink)}
                className="shrink-0 px-3 py-2.5 rounded-lg text-[12px] font-medium text-white/70 transition-colors hover:bg-white/5"
                style={{ border: "1px solid rgba(255,255,255,0.12)" }}
              >
                <Copy className="h-4 w-4" />
              </button>
              <button
                onClick={shareReferralLink}
                className="shrink-0 px-3 py-2.5 rounded-lg text-[12px] font-medium text-primary transition-colors hover:bg-primary/5"
                style={{ border: "1px solid rgba(74, 222, 128, 0.3)", background: "rgba(74, 222, 128, 0.06)" }}
              >
                <Share2 className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 text-[11px] text-white/30">{t("profile.inviteFriendsDesc")}</div>
          </div>
        </div>
      )}

      <div className="gradient-green-dark px-4 py-4 rounded-2xl mx-4" style={{ animation: "fadeSlideIn 0.4s ease-out 0.08s both" }}>
        <h2 className="text-[15px] font-bold mb-3" data-testid="text-profile-title">{t("profile.assetsOverview")}</h2>
        <div
          className="rounded-xl p-4"
          style={{ border: cardBorder, background: "rgba(5,10,5,0.4)" }}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[12px] text-white/40 mb-1">{t("profile.totalAssets")}</div>
              {!isConnected ? (
                <div className="text-2xl font-bold text-white/30" data-testid="text-net-assets">--</div>
              ) : profileLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className="text-2xl font-bold text-neon-value" data-testid="text-net-assets">{formatMA(net)}</div>
              )}
            </div>
            <div className="h-10 w-10 rounded-full flex items-center justify-center" style={{ background: "rgba(74, 222, 128, 0.12)" }}>
              <Wallet className="h-5 w-5 text-primary" />
            </div>
          </div>
        </div>
      </div>

      {isConnected && (
        <div className="px-4" style={{ animation: "fadeSlideIn 0.4s ease-out 0.1s both" }}>
          <div
            className="rounded-2xl p-4"
            style={{ border: cardBorder, background: cardBg }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-10 w-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(74, 222, 128, 0.12)" }}>
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-[12px] text-white/40 mb-0.5">{t("profile.totalEarningsLabel")}</div>
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
              <div className="rounded-lg p-2" style={{ border: "1px solid rgba(255,255,255,0.06)", background: "rgba(5,10,5,0.4)" }}>
                <div className="text-[11px] text-white/35">{t("profile.nodeEarningsLabel")}</div>
                <div className="text-xs font-bold text-neon-value">{formatCompactMA(nodeEarnings)}</div>
              </div>
              <div className="rounded-lg p-2" style={{ border: "1px solid rgba(255,255,255,0.06)", background: "rgba(5,10,5,0.4)" }}>
                <div className="text-[11px] text-white/35">{t("profile.vaultEarningsLabel")}</div>
                <div className="text-xs font-bold text-neon-value">{formatCompactMA(vaultYield)}</div>
              </div>
              <div className="rounded-lg p-2" style={{ border: "1px solid rgba(255,255,255,0.06)", background: "rgba(5,10,5,0.4)" }}>
                <div className="text-[11px] text-white/35">{t("profile.brokerEarningsLabel")}</div>
                <div className="text-xs font-bold text-neon-value">{formatCompactMA(referralEarnings)}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {!isConnected && (
        <div className="px-4" style={{ animation: "fadeSlideIn 0.4s ease-out 0.1s both" }}>
          <div className="rounded-2xl p-6 text-center" style={{ border: "1px dashed rgba(255,255,255,0.1)", background: cardBg }}>
            <WalletCards className="h-8 w-8 text-white/20 mx-auto mb-2" />
            <p className="text-[13px] text-white/30" data-testid="text-connect-prompt">
              {t("common.connectWalletPrompt")}
            </p>
          </div>
        </div>
      )}

      <div className="px-4" style={{ animation: "fadeSlideIn 0.4s ease-out 0.15s both" }}>
        <div
          className="rounded-2xl p-4"
          style={{ border: cardBorder, background: cardBg }}
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <Crown className="h-4 w-4 text-primary shrink-0" />
              <span className="text-[13px] font-semibold text-white/80">
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
              <span
                className="text-[12px] px-3 py-1 rounded-md text-white/40"
                style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}
              >
                {t("common.connectToUnlock")}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="px-4" style={{ animation: "fadeSlideIn 0.4s ease-out 0.2s both" }}>
        <h3 className="text-[13px] font-bold mb-3 text-white/60">{t("profile.menu")}</h3>
        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: cardBorder, background: cardBg }}
        >
          {MENU_ITEMS.map((item, idx) => (
            <button
              key={item.path}
              className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.02] ${
                idx < MENU_ITEMS.length - 1 ? "border-b" : ""
              }`}
              style={{ borderColor: "rgba(255,255,255,0.05)" }}
              onClick={() => navigate(item.path)}
              data-testid={`menu-${item.path.split("/").pop()}`}
            >
              <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(74, 222, 128, 0.08)" }}>
                <item.icon className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-white/80">{t(item.labelKey)}</div>
                <div className="text-[11px] text-white/30">{t(item.descKey)}</div>
              </div>
              <ChevronRight className="h-4 w-4 text-white/20 shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
