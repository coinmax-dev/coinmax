import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveAccount } from "thirdweb/react";
import { useMaPrice } from "@/hooks/use-ma-price";
import { Copy, Crown, WalletCards, Wallet, ArrowUpFromLine, ChevronRight, Bell, Settings, History, GitBranch, Loader2, Server, TrendingUp, Share2, Link2, ArrowLeftRight, User, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getProfile, getNodeOverview, getVaultPositions, subscribeVip } from "@/lib/api";
import type { NodeOverview } from "@shared/types";
import { queryClient } from "@/lib/queryClient";
import { usePayment, getPaymentStatusLabel } from "@/hooks/use-payment";
import { VIP_RECEIVER_ADDRESS } from "@/lib/contracts";
import { VIP_PLANS } from "@/lib/data";
import type { Profile } from "@shared/types";

import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";

const MENU_ITEMS = [
  { labelKey: "profile.nodeManagement", icon: Server, path: "/profile/nodes", descKey: "profile.nodeManagementDesc" },
  { labelKey: "profile.swap", icon: ArrowLeftRight, path: "/profile/swap", descKey: "profile.swapDesc" },
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
  const [showVipPlans, setShowVipPlans] = useState(false);
  const [selectedVipPlan, setSelectedVipPlan] = useState<"monthly" | "semiannual" | null>(null);

  const vipMutation = useMutation({
    mutationFn: async (planKey: "monthly" | "semiannual") => {
      let txHash: string | undefined;
      if (VIP_RECEIVER_ADDRESS) {
        txHash = await payment.payVIPSubscribe(planKey);
      }
      const result = await subscribeVip(walletAddr, txHash, planKey);
      payment.markSuccess();
      return result;
    },
    onSuccess: () => {
      toast({ title: t("strategy.vipActivated"), description: t("strategy.vipActivatedDesc") });
      queryClient.invalidateQueries({ queryKey: ["profile", walletAddr] });
      payment.reset();
      setShowVipPlans(false);
      setSelectedVipPlan(null);
    },
    onError: (err: Error) => {
      const failedTxHash = payment.txHash;
      const desc = failedTxHash
        ? `${err.message}\n\nOn-chain tx: ${failedTxHash}\nPlease contact support.`
        : err.message;
      toast({ title: "Error", description: desc, variant: "destructive" });
      payment.reset();
      setSelectedVipPlan(null);
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

  const shortAddr = walletAddr ? `${walletAddr.slice(0, 6)}...${walletAddr.slice(-4)}` : "";

  return (
    <div className="pb-24" data-testid="page-profile" style={{ background: "#060606" }}>

      <div className="relative overflow-hidden" style={{ background: "linear-gradient(180deg, #0d1f12 0%, #060606 100%)" }}>
        <div className="absolute inset-0 opacity-30" style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(74,222,128,0.15) 0%, transparent 70%)" }} />
        <div className="relative px-4 pt-6 pb-5">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="h-12 w-12 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)", boxShadow: "0 0 20px rgba(74,222,128,0.25)" }}
            >
              <User className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              {!isConnected ? (
                <div className="text-[15px] font-bold text-white/40" data-testid="text-wallet-address">{t("common.notConnected")}</div>
              ) : profileLoading ? (
                <Skeleton className="h-5 w-32" />
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-bold text-white" data-testid="text-wallet-address">{shortAddr}</span>
                    <button
                      onClick={() => copyToClipboard(walletAddr)}
                      className="p-1 rounded-md transition-colors hover:bg-white/10"
                      data-testid="button-copy-address"
                    >
                      <Copy className="h-3.5 w-3.5 text-white/50" />
                    </button>
                  </div>
                  <div className="font-mono text-[10px] text-white/35 mt-0.5 truncate">{walletAddr}</div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {isConnected && profile ? (
              <>
                <span
                  className="text-[11px] px-2.5 py-1 rounded-full font-semibold text-white/90"
                  style={{ background: "rgba(255,255,255,0.08)", backdropFilter: "blur(8px)" }}
                  data-testid="badge-rank"
                >
                  {t("common.rank")}: {profile.rank}
                </span>
                <span
                  className="text-[11px] px-2.5 py-1 rounded-full font-semibold text-white/90"
                  style={{ background: "rgba(255,255,255,0.08)", backdropFilter: "blur(8px)" }}
                  data-testid="badge-node-type"
                >
                  {t("common.node")}: {profile.nodeType}
                </span>
                {profile.isVip && (
                  <span
                    className="text-[11px] px-2.5 py-1 rounded-full font-bold text-yellow-300"
                    style={{ background: "rgba(234,179,8,0.15)", border: "1px solid rgba(234,179,8,0.3)" }}
                    data-testid="badge-vip"
                  >
                    VIP
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="text-[11px] px-2.5 py-1 rounded-full font-medium text-white/40" style={{ background: "rgba(255,255,255,0.05)" }}>
                  {t("common.rank")}: --
                </span>
                <span className="text-[11px] px-2.5 py-1 rounded-full font-medium text-white/40" style={{ background: "rgba(255,255,255,0.05)" }}>
                  {t("common.node")}: --
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 -mt-1 space-y-3">

        <div
          className="rounded-2xl p-4 relative overflow-hidden"
          style={{ background: "#0f0f0f", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          <div className="absolute top-0 right-0 w-32 h-32 opacity-[0.03]" style={{ background: "radial-gradient(circle, #4ade80, transparent 70%)" }} />
          <div className="flex items-center justify-between gap-3 relative">
            <div>
              <div className="text-[11px] text-white/45 font-medium uppercase tracking-wider mb-1">{t("profile.totalAssets")}</div>
              {!isConnected ? (
                <div className="text-[28px] font-black text-white/20 leading-tight" data-testid="text-net-assets">--</div>
              ) : profileLoading ? (
                <Skeleton className="h-9 w-28" />
              ) : (
                <div className="text-[28px] font-black text-white leading-tight" data-testid="text-net-assets">{formatMA(net)}</div>
              )}
            </div>
            <div
              className="h-11 w-11 rounded-2xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, rgba(74,222,128,0.2), rgba(74,222,128,0.05))", border: "1px solid rgba(74,222,128,0.15)" }}
            >
              <Wallet className="h-5 w-5 text-primary" />
            </div>
          </div>
        </div>

        {isConnected && (
          <div
            className="rounded-2xl p-4"
            style={{ background: "#0f0f0f", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "linear-gradient(135deg, rgba(74,222,128,0.2), rgba(74,222,128,0.05))", border: "1px solid rgba(74,222,128,0.15)" }}
                >
                  <TrendingUp className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="text-[11px] text-white/45 font-medium">{t("profile.totalEarningsLabel")}</div>
                  {profileLoading ? (
                    <Skeleton className="h-5 w-20" />
                  ) : (
                    <div className="text-[18px] font-bold text-white" data-testid="text-total-earnings">
                      {formatMA(totalEarnings)}
                    </div>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                className="rounded-xl text-[12px] h-8"
                onClick={() => {
                  toast({ title: t("profile.withdrawEarnings"), description: t("profile.withdrawEarningsDesc") });
                }}
                disabled={totalEarnings <= 0}
                data-testid="button-withdraw-earnings"
              >
                <ArrowUpFromLine className="mr-1 h-3 w-3" /> {t("common.withdraw")}
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: t("profile.nodeEarningsLabel"), value: formatCompactMA(nodeEarnings) },
                { label: t("profile.vaultEarningsLabel"), value: formatCompactMA(vaultYield) },
                { label: t("profile.brokerEarningsLabel"), value: formatCompactMA(referralEarnings) },
              ].map((item, i) => (
                <div key={i} className="rounded-xl p-2.5" style={{ background: "#161616" }}>
                  <div className="text-[10px] text-white/40 mb-0.5">{item.label}</div>
                  <div className="text-[13px] font-bold text-white/90">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!isConnected && (
          <div
            className="rounded-2xl p-8 text-center"
            style={{ background: "#0f0f0f", border: "1px dashed rgba(255,255,255,0.12)" }}
          >
            <WalletCards className="h-8 w-8 text-white/20 mx-auto mb-3" />
            <p className="text-[13px] text-white/35" data-testid="text-connect-prompt">
              {t("common.connectWalletPrompt")}
            </p>
          </div>
        )}

        {isConnected && referralLink && (
          <div
            className="rounded-2xl p-4"
            style={{ background: "#0f0f0f", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <div
                className="h-7 w-7 rounded-lg flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, rgba(74,222,128,0.2), rgba(74,222,128,0.05))", border: "1px solid rgba(74,222,128,0.15)" }}
              >
                <Link2 className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="text-[14px] font-bold text-white">{t("profile.inviteFriends")}</span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="flex-1 min-w-0 rounded-xl px-3 py-2.5 font-mono text-[11px] text-white/55 truncate"
                style={{ background: "#161616", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                {referralLink}
              </div>
              <button
                onClick={() => copyToClipboard(referralLink)}
                className="shrink-0 px-3 py-2.5 rounded-xl text-white/80 transition-all hover:bg-white/10 active:scale-95"
                style={{ background: "#161616", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <Copy className="h-4 w-4" />
              </button>
              <button
                onClick={shareReferralLink}
                className="shrink-0 px-3.5 py-2.5 rounded-xl text-black font-medium transition-all hover:brightness-110 active:scale-95"
                style={{ background: "linear-gradient(135deg, #4ade80, #22c55e)", boxShadow: "0 2px 8px rgba(74,222,128,0.25)" }}
              >
                <Share2 className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 text-[10px] text-white/35">{t("profile.inviteFriendsDesc")}</div>
          </div>
        )}

        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: "#0f0f0f", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          <div className="p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Crown className="h-4 w-4 text-yellow-400" />
              <span className="text-[14px] font-bold text-white">
                {isConnected && profile?.isVip ? t("profile.vipActive") : t("profile.upgradeToVip")}
              </span>
            </div>
            {isConnected && !profile?.isVip && !showVipPlans && (
              <button
                className="px-4 py-1.5 rounded-full text-[12px] font-bold text-black transition-all hover:brightness-110 active:scale-95"
                style={{ background: "linear-gradient(135deg, #facc15, #eab308)", boxShadow: "0 2px 8px rgba(234,179,8,0.2)" }}
                onClick={() => setShowVipPlans(true)}
                data-testid="button-subscribe-vip"
              >
                {t("profile.subscribeVip")}
              </button>
            )}
            {!isConnected && (
              <span className="text-[11px] px-3 py-1 rounded-full text-white/40" style={{ background: "rgba(255,255,255,0.05)" }}>
                {t("common.connectToUnlock")}
              </span>
            )}
          </div>

          {isConnected && !profile?.isVip && showVipPlans && (
            <div className="px-4 pb-4 space-y-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="pt-3" />
              {(Object.keys(VIP_PLANS) as Array<keyof typeof VIP_PLANS>).map((planKey) => {
                const plan = VIP_PLANS[planKey];
                const isSelected = selectedVipPlan === planKey;
                return (
                  <div
                    key={planKey}
                    className="rounded-xl p-3.5 flex items-center justify-between gap-3 transition-all cursor-pointer"
                    style={{
                      border: isSelected ? "1px solid rgba(234,179,8,0.5)" : "1px solid rgba(255,255,255,0.08)",
                      background: isSelected ? "rgba(234,179,8,0.06)" : "#161616",
                    }}
                    onClick={() => !vipMutation.isPending && setSelectedVipPlan(planKey)}
                  >
                    <div>
                      <div className="text-[13px] font-bold text-white">
                        {t(`profile.vipPlan_${planKey}`)}
                      </div>
                      <div className="text-[11px] text-white/40 mt-0.5">
                        {plan.period}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[16px] font-black text-yellow-400">${plan.price}</div>
                      {planKey === "semiannual" && (
                        <div className="text-[10px] text-emerald-400/80 mt-0.5 font-medium">
                          {t("profile.vipSave")} ${(VIP_PLANS.monthly.price * 6) - VIP_PLANS.semiannual.price}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-[12px] rounded-xl h-9"
                  onClick={() => { setShowVipPlans(false); setSelectedVipPlan(null); }}
                  disabled={vipMutation.isPending}
                >
                  {t("common.cancel")}
                </Button>
                <button
                  className="flex-1 h-9 rounded-xl text-[12px] font-bold text-black transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, #facc15, #eab308)" }}
                  onClick={() => selectedVipPlan && vipMutation.mutate(selectedVipPlan)}
                  disabled={!selectedVipPlan || vipMutation.isPending}
                >
                  {vipMutation.isPending ? (
                    <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> {getPaymentStatusLabel(payment.status) || t("common.processing")}</>
                  ) : (
                    t("profile.payNow")
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="pt-1">
          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: "#0f0f0f", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            {MENU_ITEMS.map((item, idx) => (
              <button
                key={item.path}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-all hover:bg-white/[0.03] active:bg-white/[0.05]"
                style={{ borderBottom: idx < MENU_ITEMS.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none" }}
                onClick={() => navigate(item.path)}
                data-testid={`menu-${item.path.split("/").pop()}`}
              >
                <div
                  className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "#161616", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <item.icon className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-white/90">{t(item.labelKey)}</div>
                  <div className="text-[10px] text-white/35 mt-0.5">{t(item.descKey)}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-white/20 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
