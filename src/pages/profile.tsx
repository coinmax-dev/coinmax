import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveAccount } from "thirdweb/react";
import { useMaPrice } from "@/hooks/use-ma-price";
import { Copy, Crown, WalletCards, Wallet, ArrowUpFromLine, ChevronRight, Bell, Settings, History, GitBranch, Loader2, Server, TrendingUp, Share2, Link2, ArrowLeftRight, User, Coins } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { copyText } from "@/lib/copy";
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getProfile, getNodeOverview, getVaultPositions, activateVipTrial } from "@/lib/api";
import type { NodeOverview } from "@shared/types";
import { queryClient } from "@/lib/queryClient";
import { usePayment, getPaymentStatusLabel } from "@/hooks/use-payment";
import { VIP_PLANS } from "@/lib/data";
import type { Profile } from "@shared/types";

import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";

const MENU_ITEMS = [
  { labelKey: "profile.maToken", icon: Coins, path: "/profile/ma", descKey: "profile.maTokenDesc" },
  { labelKey: "profile.swap", icon: ArrowLeftRight, path: "/profile/swap", descKey: "profile.swapDesc" },
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
  const [selectedVipPlan, setSelectedVipPlan] = useState<"monthly" | "halfyear" | null>(null);

  const vipMutation = useMutation({
    mutationFn: async (planKey: "monthly" | "halfyear") => {
      // x402 flow: payment + VIP activation handled by edge function in one call
      const result = await payment.payVIPSubscribe(planKey);
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

  const trialMutation = useMutation({
    mutationFn: async () => {
      return activateVipTrial(walletAddr);
    },
    onSuccess: () => {
      toast({ title: "VIP 试用已激活", description: "7天免费 VIP 跟单体验已开启" });
      queryClient.invalidateQueries({ queryKey: ["profile", walletAddr] });
    },
    onError: (err: Error) => {
      toast({ title: "激活失败", description: err.message, variant: "destructive" });
    },
  });

  const deposited = Number(profile?.totalDeposited || 0);
  const withdrawn = Number(profile?.totalWithdrawn || 0);
  const referralEarnings = Number(profile?.referralEarnings || 0);
  const nodeEarnings = Number(nodeOverview?.rewards?.totalEarnings || 0);
  const totalEarnings = nodeEarnings + vaultYield + referralEarnings;
  const net = deposited - withdrawn + referralEarnings;

  const refCode = profile?.refCode;
  // Self-referral link: both sponsor and placement = self
  const referralLink = useMemo(() => {
    if (!refCode || typeof window === "undefined") return "";
    return `${window.location.origin}/r/${refCode}/${refCode}`;
  }, [refCode]);

  const copyToClipboard = async (text: string) => {
    await copyText(text);
    toast({ title: t("common.copied"), description: t("common.copiedDesc") });
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
    <div className="pb-24 lg:pb-8 lg:pt-4" data-testid="page-profile" style={{ background: "#060606" }}>

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
          className="rounded-2xl relative overflow-hidden"
          style={{ background: "#141414", border: "1px solid rgba(255,255,255,0.35)", boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}
        >
          <div className="absolute top-0 right-0 w-40 h-40 opacity-[0.05]" style={{ background: "radial-gradient(circle, #4ade80, transparent 70%)" }} />

          <div className="p-4 relative">
            <div className="flex items-center justify-between gap-3">
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
            <>
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "0 16px" }} />
              <div className="p-4 relative">
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
                    <div key={i} className="rounded-xl p-2.5" style={{ background: "#1c1c1c" }}>
                      <div className="text-[10px] text-white/40 mb-0.5">{item.label}</div>
                      <div className="text-[13px] font-bold text-white/90">{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {!isConnected && (
            <>
              <div style={{ borderTop: "1px dashed rgba(255,255,255,0.1)", margin: "0 16px" }} />
              <div className="p-6 text-center">
                <WalletCards className="h-7 w-7 text-white/20 mx-auto mb-2" />
                <p className="text-[12px] text-white/35" data-testid="text-connect-prompt">
                  {t("common.connectWalletPrompt")}
                </p>
              </div>
            </>
          )}
        </div>

        {isConnected && referralLink && (
          <div
            className="rounded-2xl p-4"
            style={{ background: "#141414", border: "1px solid rgba(255,255,255,0.35)", boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}
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
                style={{ background: "#1c1c1c", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                {referralLink}
              </div>
              <button
                onClick={() => copyToClipboard(referralLink)}
                className="shrink-0 px-3 py-2.5 rounded-xl text-white/80 transition-all hover:bg-white/10 active:scale-95"
                style={{ background: "#1c1c1c", border: "1px solid rgba(255,255,255,0.1)" }}
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

            <button
              className="w-full mt-3 flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all hover:bg-white/[0.04] active:bg-white/[0.06]"
              style={{ background: "#1c1c1c", border: "1px solid rgba(255,255,255,0.1)" }}
              onClick={() => navigate("/profile/referral")}
              data-testid="menu-referral"
            >
              <div
                className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "linear-gradient(135deg, rgba(74,222,128,0.2), rgba(74,222,128,0.05))", border: "1px solid rgba(74,222,128,0.15)" }}
              >
                <GitBranch className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-white/90">{t("profile.referralTeam")}</div>
                <div className="text-[10px] text-white/35">{t("profile.referralTeamDesc")}</div>
              </div>
              <ChevronRight className="h-4 w-4 text-white/25 shrink-0" />
            </button>
          </div>
        )}

        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: "#141414", border: "1px solid rgba(255,255,255,0.35)", boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}
        >
          <div className="p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Crown className="h-4 w-4 text-yellow-400" />
              <span className="text-[14px] font-bold text-white">
                {isConnected && profile?.isVip ? t("profile.vipActive") : t("profile.upgradeToVip")}
              </span>
            </div>
            {isConnected && !profile?.isVip && !showVipPlans && (
              <div className="flex items-center gap-2">
                {!profile?.vipTrialUsed && (
                  <button
                    className="px-3 py-1.5 rounded-full text-[11px] font-bold text-yellow-400 transition-all hover:bg-yellow-500/10 active:scale-95 disabled:opacity-50"
                    style={{ border: "1px solid rgba(234,179,8,0.3)" }}
                    onClick={() => trialMutation.mutate()}
                    disabled={trialMutation.isPending}
                  >
                    {trialMutation.isPending ? "激活中..." : "免费试用7天"}
                  </button>
                )}
                <button
                  className="px-4 py-1.5 rounded-full text-[12px] font-bold text-black transition-all hover:brightness-110 active:scale-95"
                  style={{ background: "linear-gradient(135deg, #facc15, #eab308)", boxShadow: "0 2px 8px rgba(234,179,8,0.2)" }}
                  onClick={() => setShowVipPlans(true)}
                  data-testid="button-subscribe-vip"
                >
                  {t("profile.subscribeVip")}
                </button>
              </div>
            )}
            {isConnected && profile?.isVip && profile?.vipExpiresAt && (() => {
              const expires = new Date(profile.vipExpiresAt);
              const now = new Date();
              const daysLeft = Math.max(0, Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
              const isActive = daysLeft > 0;
              return (
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono ${isActive ? (daysLeft <= 3 ? "text-red-400" : "text-yellow-400/60") : "text-red-400"}`}>
                    {isActive ? `剩余 ${daysLeft} 天` : "已过期"}
                  </span>
                  {(daysLeft <= 3 || !isActive) && (
                    <button
                      className="px-2.5 py-1 rounded-full text-[9px] font-bold text-black"
                      style={{ background: "linear-gradient(135deg, #facc15, #eab308)" }}
                      onClick={() => setShowVipPlans(true)}
                    >
                      {isActive ? "续费" : "升级VIP"}
                    </button>
                  )}
                </div>
              );
            })()}
            {!isConnected && (
              <span className="text-[11px] px-3 py-1 rounded-full text-white/40" style={{ background: "rgba(255,255,255,0.05)" }}>
                {t("common.connectToUnlock")}
              </span>
            )}
          </div>

          {isConnected && !profile?.isVip && showVipPlans && (
            <div className="px-4 pb-4 space-y-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="pt-3" />
              <div
                className={`rounded-xl p-3.5 flex items-center justify-between gap-3 cursor-pointer transition-all ${selectedVipPlan === "monthly" ? "ring-1 ring-yellow-400" : ""}`}
                style={{ border: "1px solid rgba(234,179,8,0.5)", background: "rgba(234,179,8,0.06)" }}
                onClick={() => setSelectedVipPlan("monthly")}
              >
                <div>
                  <div className="text-[13px] font-bold text-white">VIP {t("profile.vipPlan_monthly")}</div>
                  <div className="text-[11px] text-white/40 mt-0.5">1 month</div>
                </div>
                <div className="text-[16px] font-black text-yellow-400">$49</div>
              </div>
              <div
                className={`rounded-xl p-3.5 flex items-center justify-between gap-3 cursor-pointer transition-all ${selectedVipPlan === "halfyear" ? "ring-1 ring-yellow-400" : ""}`}
                style={{ border: "1px solid rgba(234,179,8,0.5)", background: "rgba(234,179,8,0.06)" }}
                onClick={() => setSelectedVipPlan("halfyear")}
              >
                <div>
                  <div className="text-[13px] font-bold text-white">VIP {t("profile.vipPlan_halfyear", "Half Year")}</div>
                  <div className="text-[11px] text-white/40 mt-0.5">6 months</div>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <div className="text-[16px] font-black text-yellow-400">$149</div>
                  <div className="text-[10px] text-emerald-400 font-bold">SAVE 49%</div>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-[12px] rounded-xl h-9"
                  onClick={() => { setShowVipPlans(false); setSelectedVipPlan(null); }}
                >
                  {t("common.cancel")}
                </Button>
                <button
                  className="flex-1 h-9 rounded-xl text-[12px] font-bold text-black transition-all hover:brightness-110 active:scale-95 flex items-center justify-center disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #facc15, #eab308)" }}
                  disabled={!selectedVipPlan}
                  onClick={() => selectedVipPlan && vipMutation.mutate(selectedVipPlan)}
                >
                  {t("profile.payNow")}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Node management + menu items — hidden on desktop (sidebar handles navigation) */}
        <div className="lg:hidden">
          <button
            className="w-full rounded-2xl text-left transition-all active:scale-[0.98] relative overflow-hidden group"
            style={{
              background: "linear-gradient(135deg, #0a2614 0%, #143d20 50%, #0d2a15 100%)",
              border: "1px solid rgba(74,222,128,0.35)",
              boxShadow: "0 4px 24px rgba(74,222,128,0.12), inset 0 1px 0 rgba(255,255,255,0.05)",
            }}
            onClick={() => navigate("/profile/nodes")}
            data-testid="menu-nodes"
          >
            <div className="absolute inset-0 opacity-40" style={{ background: "radial-gradient(ellipse at 80% 20%, rgba(74,222,128,0.2) 0%, transparent 60%)" }} />
            <div className="absolute -right-4 -bottom-4 w-24 h-24 opacity-20" style={{ background: "radial-gradient(circle, #22c55e, transparent 70%)" }} />
            <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl" style={{ background: "linear-gradient(180deg, #4ade80, #22c55e)" }} />

            <div className="relative p-4 flex items-center gap-3.5">
              <div
                className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  background: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
                  boxShadow: "0 4px 16px rgba(34,197,94,0.35)",
                }}
              >
                <Server className="h-5.5 w-5.5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-bold text-white tracking-wide">{t("profile.nodeManagement")}</div>
                <div className="text-[11px] text-white/50 mt-0.5">{t("profile.nodeManagementDesc")}</div>
              </div>
              <div
                className="h-8 w-8 rounded-full flex items-center justify-center shrink-0"
                style={{ background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.25)" }}
              >
                <ChevronRight className="h-4 w-4 text-primary" />
              </div>
            </div>
          </button>

          <div className="pt-1">
            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: "#141414", border: "1px solid rgba(255,255,255,0.35)", boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}
            >
              {MENU_ITEMS.map((item, idx) => (
                <button
                  key={item.path}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-all hover:bg-white/[0.04] active:bg-white/[0.06]"
                  style={{ borderBottom: idx < MENU_ITEMS.length - 1 ? "1px solid rgba(255,255,255,0.08)" : "none" }}
                  onClick={() => navigate(item.path)}
                  data-testid={`menu-${item.path.split("/").pop()}`}
                >
                  <div
                    className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "#1c1c1c", border: "1px solid rgba(255,255,255,0.08)" }}
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
    </div>
  );
}
