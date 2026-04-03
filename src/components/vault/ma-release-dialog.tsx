/**
 * MA Release Dialog — Withdraw accumulated MA with release plan selection
 *
 * Release Plans (from CoinMaxRelease.sol):
 *   Plan 4: 80% instant,  20% burned
 *   Plan 3: 85% / 7-day,  15% burned
 *   Plan 2: 90% / 15-day, 10% burned
 *   Plan 1: 95% / 30-day,  5% burned
 *   Plan 0: 100% / 60-day, 0% burned
 *
 * Flow: user selects amount + plan → createRelease() on-chain → linear vesting → claimRelease()
 */

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Flame, Clock, Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import { useActiveAccount, useSendTransaction } from "thirdweb/react";
import { prepareContractCall, readContract, waitForReceipt, getContract } from "thirdweb";
import { useQuery } from "@tanstack/react-query";
import { useThirdwebClient } from "@/hooks/use-thirdweb";
import { RELEASE_ADDRESS, BSC_CHAIN } from "@/lib/contracts";
import { useMaPrice } from "@/hooks/use-ma-price";
import { queryClient } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import { getNodeOverview } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { VAULT_PLANS } from "@/lib/data";
import { useTranslation } from "react-i18next";

interface MAReleaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PLAN_DATA = [
  { index: 4, release: 80, burn: 20, days: 0, color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20" },
  { index: 3, release: 85, burn: 15, days: 7, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  { index: 2, release: 90, burn: 10, days: 15, color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20" },
  { index: 1, release: 95, burn: 5, days: 30, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
  { index: 0, release: 100, burn: 0, days: 60, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
];

export function MAReleaseDialog({ open, onOpenChange }: MAReleaseDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const account = useActiveAccount();
  const { client } = useThirdwebClient();
  const { mutateAsync: sendTx } = useSendTransaction();
  const [amount, setAmount] = useState("");
  const [selectedPlan, setSelectedPlan] = useState(4); // default: instant
  const [step, setStep] = useState<"select" | "creating" | "success">("select");
  const [successInfo, setSuccessInfo] = useState({ releaseMA: 0, burnMA: 0, days: 0 });

  const PLANS = PLAN_DATA.map(p => ({
    ...p,
    label: p.days === 0
      ? t("release.instant", "即时释放")
      : t("release.daysRelease", "{{days}}天释放", { days: p.days }),
    desc: p.days === 0
      ? t("release.instantDesc", "80% 立即到账，20% 销毁")
      : t("release.linearDesc", "{{release}}% 线性释放 {{days}}天，{{burn}}% 销毁", { release: p.release, days: p.days, burn: p.burn }),
  }));

  // Read accumulated balance from Release contract
  const { data: accumulatedRaw, refetch: refetchAccumulated } = useQuery({
    queryKey: ["ma-accumulated", account?.address],
    queryFn: async () => {
      if (!account?.address || !client || !RELEASE_ADDRESS) return BigInt(0);
      const contract = getContract({ client, chain: BSC_CHAIN, address: RELEASE_ADDRESS });
      return readContract({
        contract,
        method: "function accumulated(address) view returns (uint256)",
        params: [account.address],
      });
    },
    enabled: !!account?.address && !!client && !!RELEASE_ADDRESS,
    refetchInterval: 15000,
  });

  // Read active release positions
  const { data: releaseCount } = useQuery({
    queryKey: ["ma-release-count", account?.address],
    queryFn: async () => {
      if (!account?.address || !client || !RELEASE_ADDRESS) return 0;
      const contract = getContract({ client, chain: BSC_CHAIN, address: RELEASE_ADDRESS });
      const count = await readContract({
        contract,
        method: "function getUserReleaseCount(address) view returns (uint256)",
        params: [account.address],
      });
      return Number(count);
    },
    enabled: !!account?.address && !!client && !!RELEASE_ADDRESS,
    refetchInterval: 15000,
  });

  // Read total claimable
  const { data: totalClaimableRaw, refetch: refetchClaimable } = useQuery({
    queryKey: ["ma-total-claimable", account?.address],
    queryFn: async () => {
      if (!account?.address || !client || !RELEASE_ADDRESS) return BigInt(0);
      const contract = getContract({ client, chain: BSC_CHAIN, address: RELEASE_ADDRESS });
      return readContract({
        contract,
        method: "function getTotalClaimable(address) view returns (uint256)",
        params: [account.address],
      });
    },
    enabled: !!account?.address && !!client && !!RELEASE_ADDRESS,
    refetchInterval: 15000,
  });

  const onChainAccumulated = Number(accumulatedRaw || BigInt(0)) / 1e18;
  const totalClaimable = Number(totalClaimableRaw || BigInt(0)) / 1e18;

  // Read settled yield from vault_rewards + broker commissions (already in MA)
  const { data: dbTotalMA = 0 } = useQuery({
    queryKey: ["release-db-total-ma", account?.address],
    queryFn: async () => {
      if (!account?.address) return 0;
      const { data: profile } = await supabase.from("profiles").select("id, referral_earnings").eq("wallet_address", account.address).single();
      if (!profile) return 0;

      // 1. Vault yield from vault_rewards (settled, in MA)
      const { data: rewards } = await supabase
        .from("vault_rewards")
        .select("ar_amount, vault_positions!inner(plan_type, bonus_yield_locked)")
        .eq("user_id", profile.id)
        .eq("reward_type", "DAILY_YIELD");
      let vaultMA = 0;
      for (const r of (rewards || [])) {
        const vp = (r as any).vault_positions;
        if (vp?.plan_type === "BONUS_5D" && vp?.bonus_yield_locked) continue;
        vaultMA += Number(r.ar_amount || 0);
      }

      // 2. Broker commissions (already in MA from settle_team_commission)
      const brokerMA = Number(profile.referral_earnings || 0);

      // 3. Node earnings (available_balance from node_memberships, already in MA)
      let nodeMA = 0;
      try {
        const nodeOverview = await getNodeOverview(account.address);
        nodeMA = Number(nodeOverview?.availableBalance || 0);
      } catch { /* no node = 0 */ }

      // 4. Subtract already claimed
      const { data: claimedTxs } = await supabase
        .from("transactions")
        .select("amount")
        .eq("user_id", profile.id)
        .eq("type", "YIELD_CLAIM");
      const alreadyClaimed = (claimedTxs || []).reduce((s: number, t: any) => s + Number(t.amount || 0), 0);

      return Math.max(0, vaultMA + brokerMA + nodeMA - alreadyClaimed);
    },
    enabled: !!account?.address,
  });

  // Use whichever is higher: on-chain accumulated or DB total
  const accumulated = Math.max(onChainAccumulated, dbTotalMA);
  const inputAmount = parseFloat(amount) || 0;
  const plan = PLANS.find(p => p.index === selectedPlan)!;
  const releaseMA = inputAmount * plan.release / 100;
  const burnMA = inputAmount * plan.burn / 100;

  const handleCreateRelease = async () => {
    if (!account || inputAmount <= 0) return;
    setStep("creating");
    try {
      // Refresh balance before submitting to prevent double-claim
      await queryClient.invalidateQueries({ queryKey: ["release-db-total-ma"] });
      await queryClient.invalidateQueries({ queryKey: ["claimed-yield"] });

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

      // Step 1: Call V4 claim edge function → mint MA + burn + create linear release schedule
      const splitRatioMap: Record<number, string> = { 0: "A", 1: "B", 2: "C", 3: "D" };
      const resp = await fetch(`${supabaseUrl}/functions/v1/claim-v4`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: account.address,
          splitRatio: splitRatioMap[selectedPlan] || "C",
          amount: inputAmount,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Claim failed");

      // V4: Engine handles everything (mint + burn + DB schedule)
      // No on-chain call from user needed
      const plan = RELEASE_PLANS.find(p => p.index === selectedPlan) || RELEASE_PLANS[2];
      setSuccessInfo({
        releaseMA: Number(data.released || data.releaseMA || 0),
        burnMA: Number(data.burned || data.burnMA || 0),
        days: Number(data.releaseDays || plan.days || 0),
      });
      setStep("success");

      // Refresh all balances immediately
      refetchAccumulated();
      refetchClaimable();
      queryClient.invalidateQueries({ queryKey: ["ma-balance"] });
      queryClient.invalidateQueries({ queryKey: ["ma-total-claimable"] });
      queryClient.invalidateQueries({ queryKey: ["vault-db-yield-usd"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["release-db-total-ma"] });
      queryClient.invalidateQueries({ queryKey: ["release-balance"] });
      queryClient.invalidateQueries({ queryKey: ["vault-yield-settled"] });
      queryClient.invalidateQueries({ queryKey: ["claimed-yield"] });
      queryClient.invalidateQueries({ queryKey: ["node-overview"] });
      queryClient.invalidateQueries({ queryKey: ["ma-swap-history"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["earnings-releases"] });
      setAmount("");
    } catch (e: any) {
      console.error("createRelease failed:", e);
      toast({ title: "提取失败", description: e.message || "未知错误", variant: "destructive" });
      setStep("select");
    }
  };

  const handleClaimAll = async () => {
    if (!account || !client || !RELEASE_ADDRESS || totalClaimable <= 0) return;
    try {
      const contract = getContract({ client, chain: BSC_CHAIN, address: RELEASE_ADDRESS });
      const tx = prepareContractCall({
        contract,
        method: "function claimAll()",
        params: [],
      });
      const result = await sendTx(tx);
      await waitForReceipt({ client, chain: BSC_CHAIN, transactionHash: result.transactionHash });
      refetchClaimable();
      queryClient.invalidateQueries({ queryKey: ["ma-balance"] });
    } catch (e: any) {
      console.error("claimAll failed:", e);
    }
  };

  const resetAndClose = () => {
    setStep("select");
    setAmount("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent className="bg-card border-border max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {t("release.title", "MA 盈利分红释放")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("release.description", "选择提取数量和释放方案，不同方案有不同的释放速度和销毁比例")}
          </DialogDescription>
        </DialogHeader>

        {step === "success" ? (
          <div className="text-center py-8">
            <CheckCircle2 className="h-12 w-12 text-green-400 mx-auto mb-3" />
            <p className="text-sm font-bold text-foreground/80">{t("release.planCreated", "释放计划已创建")}</p>
            <p className="text-xs text-foreground/40 mt-1">
              {successInfo.days === 0 ? t("release.instantSuccess", "{{amount}} MA 已到账", { amount: successInfo.releaseMA.toFixed(2) }) : t("release.linearSuccess", "{{amount}} MA 将在 {{days}} 天内线性释放", { amount: successInfo.releaseMA.toFixed(2), days: successInfo.days })}
            </p>
            {successInfo.burnMA > 0 && <p className="text-xs text-red-400/60 mt-1">{t("release.burned", "{{amount}} MA 已销毁", { amount: successInfo.burnMA.toFixed(2) })}</p>}
            <Button className="mt-4" onClick={resetAndClose}>{t("release.done", "完成")}</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Accumulated balance */}
            <div className="rounded-xl bg-primary/5 border border-primary/15 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-foreground/40">{t("release.withdrawableMA", "可提取 MA")}</span>
                <span className="text-lg font-bold font-mono text-primary">{accumulated.toFixed(2)} MA</span>
              </div>
            </div>

            {/* Claimable from existing releases */}
            {totalClaimable > 0 && (
              <div className="rounded-xl bg-green-500/5 border border-green-500/15 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs text-foreground/40">{t("release.claimableMA", "可领取释放中 MA")}</span>
                    <p className="text-[10px] text-foreground/20">{t("release.plansInProgress", "{{count}} 个释放计划进行中", { count: releaseCount || 0 })}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold font-mono text-green-400">{totalClaimable.toFixed(2)} MA</span>
                    <Button size="sm" className="h-7 text-[10px] bg-green-600 text-white" onClick={handleClaimAll}>
                      {t("release.claim", "领取")}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Amount input */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-foreground/40">{t("release.withdrawAmount", "提取数量")}</label>
                <button onClick={() => setAmount(accumulated.toFixed(2))} className="text-[10px] text-primary">
                  {t("release.all", "全部")} {accumulated.toFixed(0)}
                </button>
              </div>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={t("release.enterMAAmount", "输入 MA 数量")}
                className="font-mono"
                max={accumulated}
              />
            </div>

            {/* Plan selection */}
            <div>
              <label className="text-xs text-foreground/40 mb-2 block">{t("release.selectPlan", "选择释放方案")}</label>
              <div className="space-y-2">
                {PLANS.map(p => (
                  <button
                    key={p.index}
                    onClick={() => setSelectedPlan(p.index)}
                    className={cn(
                      "w-full text-left px-3 py-2.5 rounded-xl border transition-all",
                      selectedPlan === p.index ? `${p.bg} ${p.border}` : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={cn("text-xs font-bold", selectedPlan === p.index ? p.color : "text-foreground/50")}>
                          {p.label}
                        </span>
                        <Badge className={cn("text-[9px]", selectedPlan === p.index ? `${p.bg} ${p.color} ${p.border}` : "bg-foreground/5 text-foreground/30")}>
                          {t("release.releasePercent", "{{percent}}% 释放", { percent: p.release })}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {p.burn > 0 && (
                          <span className="text-[9px] text-red-400/60 flex items-center gap-0.5">
                            <Flame className="h-2.5 w-2.5" />{p.burn}%
                          </span>
                        )}
                        {p.days > 0 && (
                          <span className="text-[9px] text-foreground/25 flex items-center gap-0.5">
                            <Clock className="h-2.5 w-2.5" />{t("release.daysUnit", "{{days}}天", { days: p.days })}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-[10px] text-foreground/20 mt-0.5">{p.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Preview */}
            {inputAmount > 0 && (
              <div className="rounded-xl bg-muted/20 p-3 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-foreground/40">{t("release.withdrawAmount", "提取数量")}</span>
                  <span className="font-mono">{inputAmount.toFixed(2)} MA</span>
                </div>
                <div className="flex justify-between text-green-400">
                  <span>{t("release.releaseReceived", "获得释放")}</span>
                  <span className="font-mono font-bold">{releaseMA.toFixed(2)} MA</span>
                </div>
                {burnMA > 0 && (
                  <div className="flex justify-between text-red-400">
                    <span className="flex items-center gap-1"><Flame className="h-3 w-3" />{t("release.burn", "销毁")}</span>
                    <span className="font-mono">-{burnMA.toFixed(2)} MA</span>
                  </div>
                )}
                <div className="flex justify-between pt-1 border-t border-border/20">
                  <span className="text-foreground/40">{t("release.releaseMethod", "释放方式")}</span>
                  <span className={plan.color}>{plan.days === 0 ? t("release.instantArrival", "立即到账") : t("release.linearReleaseDays", "{{days}}天 线性释放", { days: plan.days })}</span>
                </div>
              </div>
            )}

            {/* Submit */}
            <Button
              className="w-full"
              disabled={step === "creating" || inputAmount <= 0 || inputAmount > accumulated || !account}
              onClick={handleCreateRelease}
            >
              {step === "creating" ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t("release.creating", "创建释放计划中...")}</>
              ) : (
                t("release.confirmWithdraw", "确认提取")
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
