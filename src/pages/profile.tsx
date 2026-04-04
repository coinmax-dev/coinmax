import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveAccount } from "thirdweb/react";
import { useMaPrice } from "@/hooks/use-ma-price";
import { Copy, Crown, WalletCards, Wallet, ArrowUpFromLine, ChevronRight, Bell, Settings, History, GitBranch, Loader2, Server, TrendingUp, Share2, Link2, ArrowLeftRight, User, Coins, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { copyText } from "@/lib/copy";
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getProfile, getNodeOverview, getVaultPositions, activateVipTrial, mintRelease } from "@/lib/api";
import type { NodeOverview } from "@shared/types";
import { queryClient } from "@/lib/queryClient";
import { usePayment, getPaymentStatusLabel } from "@/hooks/use-payment";
import { VIP_PLANS } from "@/lib/data";
import { MAReleaseDialog } from "@/components/vault/ma-release-dialog";
import { supabase } from "@/lib/supabase";
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
  const { price: maPrice, formatMA, formatCompactMA } = useMaPrice();
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

  // Personal vault holding (excludes bonus positions)
  const personalHolding = useMemo(() => {
    if (!vaultPositions) return 0;
    return (vaultPositions as any[])
      .filter((p: any) => (p.status === "ACTIVE" || p.status === "MATURED") && p.planType !== "BONUS_5D" && !p.isBonus)
      .reduce((s: number, p: any) => s + Number(p.principal || 0), 0);
  }, [vaultPositions]);

  // Vault yield from settled vault_rewards (actual, not estimated)
  const { data: vaultYieldData = { unlocked: 0, locked: 0 } } = useQuery({
    queryKey: ["vault-yield-settled", walletAddr],
    queryFn: async () => {
      if (!walletAddr) return { unlocked: 0, locked: 0 };
      const { data: prof } = await supabase.from("profiles").select("id").ilike("wallet_address", walletAddr).single();
      if (!prof) return { unlocked: 0, locked: 0 };
      const { data: rewards } = await supabase
        .from("vault_rewards")
        .select("ar_amount, position_id, vault_positions!inner(plan_type, bonus_yield_locked)")
        .eq("user_id", prof.id)
        .eq("reward_type", "DAILY_YIELD");
      let unlocked = 0, locked = 0;
      for (const r of (rewards || [])) {
        const vp = (r as any).vault_positions;
        const isLocked = vp?.plan_type === "BONUS_5D" && vp?.bonus_yield_locked;
        if (isLocked) { locked += Number(r.ar_amount || 0); }
        else { unlocked += Number(r.ar_amount || 0); }
      }
      return { unlocked, locked };
    },
    enabled: !!walletAddr,
  });
  const vaultYieldMA = vaultYieldData.unlocked; // already in MA
  const lockedBonusYield = vaultYieldData.locked; // locked MA

  const payment = usePayment();
  const [showVipPlans, setShowVipPlans] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawPlan, setWithdrawPlan] = useState("A");
  const [withdrawBusy, setWithdrawBusy] = useState(false);

  const mintReleaseMutation = useMutation({
    mutationFn: () => mintRelease(walletAddr),
    onSuccess: (data: any) => {
      toast({
        title: t("profile.releaseSuccess", "释放成功"),
        description: `${Number(data.totalMinted || 0).toFixed(2)} MA ${t("profile.mintedToWallet", "已铸造到钱包")}`,
      });
      queryClient.invalidateQueries({ queryKey: ["release-balances", walletAddr] });
      queryClient.invalidateQueries({ queryKey: ["ma-balance"] });
      queryClient.invalidateQueries({ queryKey: ["transactions", walletAddr] });
      queryClient.invalidateQueries({ queryKey: ["v4-all-earnings", walletAddr] });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["release-balances", walletAddr] });
        queryClient.invalidateQueries({ queryKey: ["ma-balance"] });
      }, 2000);
    },
    onError: (err: Error) => {
      toast({ title: t("profile.releaseFailed", "释放失败"), description: err.message, variant: "destructive" });
    },
  });
  const handleWithdraw = async () => {
    const amt = parseFloat(withdrawAmount);
    if (!walletAddr || !amt || amt <= 0 || amt > availableEarnings || withdrawBusy) return;
    setWithdrawBusy(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/claim-v4`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${anonKey}` },
        body: JSON.stringify({ walletAddress: walletAddr, amount: amt, splitRatio: withdrawPlan }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast({
        title: t("profile.withdrawSuccess", "提现成功"),
        description: `${data.released?.toFixed(2) || amt} MA → ${withdrawPlan === "E" ? t("profile.instantRelease", "即时释放") : data.releaseDays + t("profile.dayLinearRelease", "天线性释放")}`,
      });
      queryClient.invalidateQueries({ queryKey: ["v4-all-earnings", walletAddr] });
      queryClient.invalidateQueries({ queryKey: ["release-balances", walletAddr] });
      queryClient.invalidateQueries({ queryKey: ["transactions", walletAddr] });
      // 延迟再刷新一次确保数据更新
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["v4-all-earnings", walletAddr] });
        queryClient.invalidateQueries({ queryKey: ["release-balances", walletAddr] });
      }, 2000);
      setWithdrawOpen(false);
      setWithdrawAmount("");
    } catch (e: any) {
      toast({ title: t("profile.withdrawFailed", "提现失败"), description: e.message, variant: "destructive" });
    } finally {
      setWithdrawBusy(false);
    }
  };

  const [selectedVipPlan, setSelectedVipPlan] = useState<"monthly" | "halfyear" | null>(null);

  const vipMutation = useMutation({
    mutationFn: async (planKey: "monthly" | "halfyear") => {
      // Use BSC USDT payment flow (proven working)
      const result = await payment.payVIPSubscribe(planKey);
      payment.markSuccess();
      return result;
    },
    onSuccess: () => {
      toast({ title: t("strategy.vipActivated"), description: t("strategy.vipActivatedDesc") });
      queryClient.invalidateQueries({ queryKey: ["profile", walletAddr] });
      setShowVipPlans(false);
      setSelectedVipPlan(null);
    },
    onError: (err: Error) => {
      const desc = payment.txHash
        ? `${err.message}\n\nTx: ${payment.txHash}`
        : err.message;
      toast({ title: t("profile.vipActivateFailed", "VIP 激活失败"), description: desc, variant: "destructive" });
      payment.reset();
      setSelectedVipPlan(null);
    },
  });

  const trialMutation = useMutation({
    mutationFn: async () => {
      return activateVipTrial(walletAddr);
    },
    onSuccess: () => {
      toast({ title: t("profile.vipTrialActivated", "VIP 试用已激活"), description: t("profile.vipTrialDesc", "7天免费 VIP 跟单体验已开启") });
      queryClient.invalidateQueries({ queryKey: ["profile", walletAddr] });
    },
    onError: (err: Error) => {
      toast({ title: t("profile.activateFailed", "激活失败"), description: err.message, variant: "destructive" });
    },
  });

  const deposited = personalHolding; // excludes bonus
  const withdrawn = Number(profile?.totalWithdrawn || 0);
  const net = deposited - withdrawn;

  // V4: Read all earnings from DB tables
  const { data: allEarnings = { vault: 0, node: 0, broker: 0, claimed: 0 } } = useQuery({
    queryKey: ["v4-all-earnings", walletAddr],
    queryFn: async () => {
      if (!walletAddr) return { vault: 0, node: 0, broker: 0, claimed: 0 };
      const { data: prof } = await supabase.from("profiles").select("id").ilike("wallet_address", walletAddr).single();
      if (!prof) return { vault: 0, node: 0, broker: 0, claimed: 0 };

      const [vr, nr, br, cl] = await Promise.all([
        supabase.from("vault_rewards").select("ar_amount").eq("user_id", prof.id),
        supabase.from("node_rewards").select("ar_amount,amount").eq("user_id", prof.id),
        supabase.from("broker_rewards").select("ar_amount,amount").eq("user_id", prof.id),
        supabase.from("transactions").select("amount").eq("user_id", prof.id).in("type", ["MA_CLAIM", "YIELD_CLAIM"]),
      ]);

      return {
        vault: (vr.data || []).reduce((s: number, r: any) => s + Number(r.ar_amount || 0), 0),
        node: (nr.data || []).reduce((s: number, r: any) => s + Number(r.ar_amount || r.amount || 0), 0),
        broker: (br.data || []).reduce((s: number, r: any) => s + Number(r.ar_amount || r.amount || 0), 0),
        claimed: (cl.data || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0),
      };
    },
    enabled: !!walletAddr,
    refetchInterval: 30000,
  });

  const nodeEarnings = allEarnings.node;
  const referralEarnings = allEarnings.broker;
  const totalEarnings = allEarnings.vault + allEarnings.node + allEarnings.broker;
  const claimedYield = allEarnings.claimed;
  const availableEarnings = Math.max(0, totalEarnings - claimedYield);

  // Release balances from DB
  const { data: releaseBalances = { withdrawnAmount: 0, claimable: 0, totalWithdrawn: 0, totalReleased: 0 } } = useQuery({
    queryKey: ["release-balances", walletAddr],
    queryFn: async () => {
      if (!walletAddr) return { withdrawnAmount: 0, claimable: 0, totalWithdrawn: 0, totalReleased: 0 };
      const { data: prof } = await supabase.from("profiles").select("id").ilike("wallet_address", walletAddr).single();
      if (!prof) return { withdrawnAmount: 0, claimable: 0, totalWithdrawn: 0, totalReleased: 0 };
      const { data: schedules } = await supabase
        .from("release_schedules")
        .select("total_amount, burn_amount, remaining_amount, released_amount, claimed_amount")
        .eq("user_id", prof.id);
      let remaining = 0, claimable = 0, totalWithdrawn = 0, totalReleased = 0;
      for (const s of (schedules || [])) {
        remaining += Number(s.remaining_amount || 0);
        claimable += Math.max(0, Number(s.released_amount || 0) - Number(s.claimed_amount || 0));
        totalWithdrawn += Number(s.total_amount || 0) + Number(s.burn_amount || 0); // 总提现 = release + burn
        totalReleased += Number(s.claimed_amount || 0); // 总释放 = 已到钱包的
      }
      return { withdrawnAmount: remaining, claimable, totalWithdrawn, totalReleased };
    },
    enabled: !!walletAddr,
    refetchInterval: 15000,
  });

  // 提现金额 (发起提现总额中还在线性释放的部分, 每日减少)
  const withdrawnInProgress = releaseBalances.withdrawnAmount;
  // 待释放余额 (线性释放出来的 - 已转钱包, 每日递增, 可一键释放)
  const claimableMA = releaseBalances.claimable;
  // 总提现 / 总释放
  const totalWithdrawnMA = releaseBalances.totalWithdrawn;
  const totalReleasedMA = releaseBalances.totalReleased;

  // 锁仓MA = 金库本金 ÷ MA价格 (赎回后转入可提收益)
  const lockedMA = maPrice > 0 ? personalHolding / maPrice : 0;
  // 总资产 = 锁仓MA + 未提现余额 + 提现金额 + 待释放余额
  const totalAssetMA = lockedMA + availableEarnings + withdrawnInProgress + claimableMA;

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
                  {t("common.rank")}: {profile.rank || "V0"}
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
                  <div className="text-[28px] font-black text-white leading-tight" data-testid="text-net-assets">{formatMA(totalAssetMA)}</div>
                )}
              </div>
              <div
                className="h-11 w-11 rounded-2xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, rgba(74,222,128,0.2), rgba(74,222,128,0.05))", border: "1px solid rgba(74,222,128,0.15)" }}
              >
                <Wallet className="h-5 w-5 text-primary" />
              </div>
            </div>
            {isConnected && !profileLoading && (
              <div className="mt-2 flex items-center justify-between">
                <div className="text-[10px] text-white/40">{t("profile.totalEarnings", "总收益金额")}</div>
                <div className="text-[15px] font-bold text-primary">{formatMA(totalEarnings)}</div>
              </div>
            )}
          </div>

          {isConnected && (
            <>
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "0 16px" }} />
              <div className="p-4 relative space-y-2.5">
                {/* 收益来源 */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: t("profile.nodeEarningsLabel"), value: formatCompactMA(nodeEarnings) },
                    { label: t("profile.vaultEarningsLabel"), value: formatCompactMA(vaultYieldMA) },
                    { label: t("profile.brokerEarningsLabel"), value: formatCompactMA(referralEarnings) },
                  ].map((item, i) => (
                    <div key={i} className="rounded-xl p-2.5" style={{ background: "#1c1c1c" }}>
                      <div className="text-[10px] text-white/40 mb-0.5">{item.label}</div>
                      <div className="text-[13px] font-bold text-white/90">{item.value}</div>
                    </div>
                  ))}
                </div>

                {/* ① 可提现 + 提现按钮 */}
                <div className="rounded-xl p-3 flex items-center justify-between" style={{ background: "rgba(74,222,128,0.04)", border: "1px solid rgba(74,222,128,0.12)" }}>
                  <div>
                    <div className="text-[10px] text-white/40">{t("profile.availableEarnings", "可提现金额")}</div>
                    <div className="text-[18px] font-bold text-white">{formatMA(availableEarnings)}</div>
                  </div>
                  <Button
                    size="sm"
                    className="rounded-xl text-[12px] h-8"
                    onClick={() => { setWithdrawOpen(true); setWithdrawAmount(""); }}
                    disabled={availableEarnings <= 0}
                  >
                    <ArrowUpFromLine className="mr-1 h-3 w-3" /> {t("profile.withdraw", "提现")}
                  </Button>
                </div>

                {/* ② 已提现待释放金额 + 已释放总金额 */}
                <div className="rounded-xl p-3 flex items-center justify-between" style={{ background: "rgba(251,191,36,0.03)", border: "1px solid rgba(251,191,36,0.08)" }}>
                  <div>
                    <div className="text-[10px] text-amber-400/60">{t("profile.pendingRelease", "已提现待释放金额")}</div>
                    <div className="text-[16px] font-bold text-amber-400/80">{formatMA(withdrawnInProgress)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-white/30">{t("profile.totalReleased", "已释放总金额")}</div>
                    <div className="text-[14px] font-bold text-white/50 font-mono">{formatMA(totalReleasedMA)}</div>
                  </div>
                </div>

                {/* ③ 释放余额 + 释放按钮 */}
                <div className="rounded-xl p-3 flex items-center justify-between" style={{ background: "rgba(74,222,128,0.04)", border: "1px solid rgba(74,222,128,0.1)" }}>
                  <div>
                    <div className="text-[10px] text-white/40">{t("profile.releaseBalance", "释放余额")}</div>
                    <div className="text-[16px] font-bold text-primary">{formatMA(claimableMA)}</div>
                  </div>
                  <Button
                    size="sm"
                    className="h-7 text-[10px] rounded-lg bg-primary/20 text-primary hover:bg-primary/30"
                    onClick={() => mintReleaseMutation.mutate()}
                    disabled={mintReleaseMutation.isPending || claimableMA <= 0}
                  >
                    <Download className="mr-1 h-3 w-3" />
                    {mintReleaseMutation.isPending ? t("common.processing") : t("profile.release", "释放")}
                  </Button>
                </div>

                {lockedBonusYield > 0 && (
                  <div className="rounded-xl p-2.5 flex items-center justify-between" style={{ background: "rgba(251,191,36,0.05)", border: "1px solid rgba(251,191,36,0.1)" }}>
                    <div className="text-[10px] text-amber-400/60">{t("profile.lockedYield", "锁仓收益 (体验金)")}</div>
                    <div className="text-[12px] font-bold text-amber-400/80">{formatCompactMA(lockedBonusYield)}</div>
                  </div>
                )}
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
                    {trialMutation.isPending ? t("common.activating", "激活中...") : t("profile.freeTrial", "免费试用7天")}
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
                    {isActive ? `${t("profile.daysLeft", "剩余")} ${daysLeft} ${t("profile.days", "天")}` : t("profile.expired", "已过期")}
                  </span>
                  <button
                    className="px-2.5 py-1 rounded-full text-[9px] font-bold text-black"
                    style={{ background: "linear-gradient(135deg, #facc15, #eab308)" }}
                    onClick={() => setShowVipPlans(true)}
                  >
                    {isActive ? t("profile.renewVip", "续费") : t("profile.upgradeVip", "升级VIP")}
                  </button>
                </div>
              );
            })()}
            {!isConnected && (
              <span className="text-[11px] px-3 py-1 rounded-full text-white/40" style={{ background: "rgba(255,255,255,0.05)" }}>
                {t("common.connectToUnlock")}
              </span>
            )}
          </div>

          {isConnected && showVipPlans && (
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
                  <div className="text-[16px] font-black text-yellow-400">$250</div>
                  <div className="text-[10px] text-emerald-400 font-bold">{t("profile.discount15", "85折")}</div>
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
      {/* 提现弹窗 — 选择 A/B/C/D/E */}
      {withdrawOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={() => setWithdrawOpen(false)}>
          <div className="bg-card border border-border rounded-2xl max-w-sm w-full p-4 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">{t("profile.withdrawTitle", "提现")}</h3>
              <button onClick={() => setWithdrawOpen(false)} className="text-white/30 hover:text-white/60 text-lg">×</button>
            </div>

            {/* Amount input */}
            <div>
              <div className="text-[10px] text-white/40 mb-1">{t("profile.withdrawAmountLabel", "提现金额 (MA)")}</div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={withdrawAmount}
                  onChange={e => setWithdrawAmount(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-white/5 rounded-xl px-3 py-2.5 text-[16px] font-mono text-white outline-none border border-white/10 focus:border-primary/30"
                />
                <button onClick={() => setWithdrawAmount(availableEarnings.toFixed(2))} className="text-[10px] text-primary px-2 py-1 bg-primary/10 rounded-lg">MAX</button>
              </div>
              <div className="text-[9px] text-white/25 mt-1">{t("profile.available", "可用")}: {availableEarnings.toFixed(2)} MA</div>
            </div>

            {/* Plan selection A/B/C/D/E */}
            <div>
              <div className="text-[10px] text-white/40 mb-1.5">{t("profile.selectPlan", "选择分成比例")}</div>
              <div className="grid grid-cols-5 gap-1.5">
                {[
                  { key: "A", burn: "0%", days: "60天" },
                  { key: "B", burn: "5%", days: "30天" },
                  { key: "C", burn: "10%", days: "15天" },
                  { key: "D", burn: "15%", days: "7天" },
                  { key: "E", burn: "20%", days: "即时" },
                ].map(p => (
                  <button
                    key={p.key}
                    onClick={() => setWithdrawPlan(p.key)}
                    className={`rounded-lg p-2 text-center transition-all ${withdrawPlan === p.key ? "bg-primary/15 border border-primary/30" : "bg-white/5 border border-white/5"}`}
                  >
                    <div className="text-[12px] font-bold">{p.key}</div>
                    <div className="text-[8px] text-red-400">{t("profile.burn", "销毁")}{p.burn}</div>
                    <div className="text-[8px] text-white/30">{p.days}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Preview */}
            {(() => {
              const amt = parseFloat(withdrawAmount) || 0;
              const burnPcts: Record<string, number> = { A: 0, B: 5, C: 10, D: 15, E: 20 };
              const burnPct = burnPcts[withdrawPlan] || 0;
              const burned = amt * burnPct / 100;
              const released = amt - burned;
              const dayMap: Record<string, number> = { A: 60, B: 30, C: 15, D: 7, E: 0 };
              const days = dayMap[withdrawPlan] || 60;
              const daily = days > 0 ? released / days : released;
              return amt > 0 ? (
                <div className="bg-white/5 rounded-xl p-3 text-[11px] space-y-1">
                  <div className="flex justify-between"><span className="text-white/40">{t("profile.totalWithdraw", "提现总额")}</span><span>{amt.toFixed(2)} MA</span></div>
                  {burned > 0 && <div className="flex justify-between text-red-400"><span>{t("profile.burnAmount", "销毁")}</span><span>-{burned.toFixed(2)} MA</span></div>}
                  <div className="flex justify-between"><span className="text-white/40">{t("profile.releaseAmount", "实际释放")}</span><span className="text-primary">{released.toFixed(2)} MA</span></div>
                  {days > 0 ? (
                    <div className="flex justify-between"><span className="text-white/40">{t("profile.dailyRelease", "每日释放")}</span><span>{daily.toFixed(4)} MA × {days}{t("profile.days", "天")}</span></div>
                  ) : (
                    <div className="flex justify-between"><span className="text-white/40">{t("profile.releaseType", "释放方式")}</span><span className="text-primary">{t("profile.instant", "即时到账待释放")}</span></div>
                  )}
                </div>
              ) : null;
            })()}

            <Button
              className="w-full h-10 text-[13px] bg-gradient-to-r from-emerald-600 to-teal-500 text-white"
              onClick={handleWithdraw}
              disabled={withdrawBusy || !parseFloat(withdrawAmount) || parseFloat(withdrawAmount) > availableEarnings}
            >
              {withdrawBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {withdrawBusy ? t("common.processing") : t("profile.confirmWithdraw", "确认提现")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
