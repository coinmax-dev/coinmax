import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Lock, ArrowDownToLine, ArrowUpFromLine, Sparkles, AlertCircle, Loader2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { VaultChart } from "@/components/vault/vault-chart";
import { VaultStats } from "@/components/vault/vault-stats";
import { VaultDepositDialog } from "@/components/vault/vault-deposit-dialog";
import { useActiveAccount } from "thirdweb/react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getVaultPositions, getTransactions, getVaultRewards, vaultDeposit, vaultWithdraw } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePayment, getPaymentStatusLabel } from "@/hooks/use-payment";
import { VAULT_PLANS } from "@/lib/data";
import { VAULT_CONTRACT_ADDRESS } from "@/lib/contracts";
import { formatUSD, shortenAddress } from "@/lib/constants";
import { useMaPrice } from "@/hooks/use-ma-price";
import type { VaultPosition, Transaction, VaultReward } from "@shared/types";
import { useTranslation } from "react-i18next";

function TransactionTable({ walletAddress, type }: { walletAddress: string; type: string }) {
  const { t } = useTranslation();
  const { usdcToMA } = useMaPrice();
  const { data: txs, isLoading } = useQuery<Transaction[]>({
    queryKey: ["transactions", walletAddress, type],
    queryFn: () => getTransactions(walletAddress, type),
    enabled: !!walletAddress,
  });

  if (isLoading) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full mb-2" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!txs || txs.length === 0) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="p-4 text-center py-8">
          <AlertCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
          <div className="text-sm text-muted-foreground" data-testid={`text-no-${type.toLowerCase()}-records`}>{t("common.noRecords")}</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-3 sm:p-4">
        <div className="space-y-2">
          {txs.map((tx, idx) => (
            <div
              key={tx.id}
              className="rounded-lg bg-muted/20 px-3 py-2.5 text-xs space-y-1.5"
              style={{ animation: `fadeSlideIn 0.3s ease-out ${idx * 0.05}s both` }}
              data-testid={`row-tx-${tx.id}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{tx.token || "USDT"}</span>
                  <span className="text-neon-value font-mono">
                    {type === "YIELD" ? `${usdcToMA(Number(tx.amount)).toFixed(2)} MA` : `$${Number(tx.amount).toFixed(2)}`}
                  </span>
                </div>
                <Badge
                  className={`text-[10px] no-default-hover-elevate no-default-active-elevate ${
                    tx.status === "CONFIRMED" || tx.status === "COMPLETED"
                      ? "bg-primary/15 text-primary"
                      : "bg-yellow-500/15 text-yellow-400"
                  }`}
                >
                  {tx.status}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 text-yellow-400/70">
                    <span className="w-2 h-2 rounded-full bg-yellow-500/30 inline-block" />
                    BSC
                  </span>
                  {tx.txHash && !tx.txHash.startsWith("backfill") && !tx.txHash.startsWith("trial") ? (
                    <a
                      href={`https://bscscan.com/tx/${tx.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary/60 hover:text-primary font-mono"
                    >
                      {tx.txHash.slice(0, 6)}...{tx.txHash.slice(-4)}
                    </a>
                  ) : (
                    <span className="font-mono">-</span>
                  )}
                </div>
                <span>{tx.createdAt ? new Date(tx.createdAt).toLocaleDateString("zh-CN") : "-"}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Vault() {
  const { t } = useTranslation();
  const account = useActiveAccount();
  const walletAddress = account?.address || "";
  const { toast } = useToast();
  const { formatMA, usdcToMA, price: maPrice } = useMaPrice();

  const [depositOpen, setDepositOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string>("5_DAYS");
  const [depositAmount, setDepositAmount] = useState("");
  const [selectedPositionId, setSelectedPositionId] = useState<string>("");
  const [yieldDetailPosId, setYieldDetailPosId] = useState<string | null>(null);

  const { data: positions, isLoading: positionsLoading } = useQuery<VaultPosition[]>({
    queryKey: ["vault-positions", walletAddress],
    queryFn: () => getVaultPositions(walletAddress),
    enabled: !!walletAddress,
  });

  const { data: vaultRewards = [], isLoading: rewardsLoading } = useQuery<VaultReward[]>({
    queryKey: ["vault-rewards", walletAddress],
    queryFn: () => getVaultRewards(walletAddress),
    enabled: !!walletAddress,
  });

  const activePositions = useMemo(() => {
    return (positions || []).filter(p => p.status === "ACTIVE");
  }, [positions]);

  const { totalPrincipal, totalYield } = useMemo(() => {
    const now = new Date();
    let principal = 0;
    let yieldSum = 0;
    for (const p of activePositions) {
      const amt = Number(p.principal || 0);
      principal += amt;
      const start = new Date(p.startDate!);
      const days = Math.max(0, Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
      yieldSum += amt * Number(p.dailyRate || 0) * days;
    }
    return { totalPrincipal: principal, totalYield: yieldSum };
  }, [activePositions]);

  const payment = usePayment();

  const depositMutation = useMutation({
    mutationFn: async (data: { walletAddress: string; planType: string; amount: number }) => {
      // Step 1: On-chain USDT payment (if vault contract is deployed)
      let txHash: string | undefined;
      if (VAULT_CONTRACT_ADDRESS) {
        txHash = await payment.payVaultDeposit(data.amount, data.planType);
      }
      // Step 2: Record to database (callback with txHash)
      const result = await vaultDeposit(data.walletAddress, data.planType, data.amount, txHash);
      // Step 3: Mark as fully complete
      payment.markSuccess();
      return result;
    },
    onSuccess: () => {
      toast({ title: t("vault.depositSuccess"), description: t("vault.depositSuccessDesc") });
      queryClient.invalidateQueries({ queryKey: ["vault-positions", walletAddress] });
      queryClient.invalidateQueries({ queryKey: ["vault-overview"] });
      queryClient.invalidateQueries({ queryKey: ["transactions", walletAddress] });
      queryClient.invalidateQueries({ queryKey: ["profile", walletAddress] });
      setDepositOpen(false);
      setDepositAmount("");
      payment.reset();
    },
    onError: (err: Error) => {
      // If on-chain succeeded but DB failed, show txHash so user can recover
      const failedTxHash = payment.txHash;
      const desc = failedTxHash
        ? `${err.message}\n\nOn-chain tx: ${failedTxHash}\nPlease contact support with this txHash.`
        : err.message;
      toast({ title: t("vault.depositFailed"), description: desc, variant: "destructive" });
      payment.reset();
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: async (data: { walletAddress: string; positionId: string }) => {
      return vaultWithdraw(data.walletAddress, data.positionId);
    },
    onSuccess: (data: any) => {
      toast({
        title: t("vault.withdrawalSuccess"),
        description: t("vault.withdrawnTotal", { total: Number(data.totalWithdraw).toFixed(2), yield: Number(data.yieldAmount).toFixed(2) }),
      });
      queryClient.invalidateQueries({ queryKey: ["vault-positions", walletAddress] });
      queryClient.invalidateQueries({ queryKey: ["vault-overview"] });
      queryClient.invalidateQueries({ queryKey: ["transactions", walletAddress] });
      queryClient.invalidateQueries({ queryKey: ["profile", walletAddress] });
      setRedeemOpen(false);
      setSelectedPositionId("");
    },
    onError: (err: Error) => {
      toast({ title: t("vault.withdrawalFailed"), description: err.message, variant: "destructive" });
    },
  });

  const handleDeposit = () => {
    const amount = parseFloat(depositAmount);
    const minAmount = VAULT_PLANS[selectedPlan as keyof typeof VAULT_PLANS]?.minAmount || 50;
    if (!walletAddress || !selectedPlan || isNaN(amount) || amount < minAmount) {
      toast({ title: t("vault.invalidInput"), description: `Minimum deposit is $${minAmount} USDT`, variant: "destructive" });
      return;
    }
    depositMutation.mutate({ walletAddress, planType: selectedPlan, amount });
  };

  const handleWithdraw = (positionId: string) => {
    if (!walletAddress || !positionId) return;
    withdrawMutation.mutate({ walletAddress, positionId });
  };

  return (
    <div className="space-y-6 pb-40 lg:pb-8 lg:px-6 lg:pt-4">
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <VaultChart />

      <div className="px-4 lg:px-0">
        <h3 className="text-base font-bold mb-3">{t("vault.vaultDetails")}</h3>
        <VaultStats />
      </div>

      <div className="px-4 lg:px-0">
        <Card className="border-border bg-card shadow-[0_0_15px_rgba(0,188,165,0.05)]">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
              <div>
                <div className="text-[12px] text-muted-foreground">{t("vault.yourPosition")}</div>
                <div className="text-2xl font-bold" data-testid="text-my-position">
                  {walletAddress ? formatUSD(totalPrincipal) : "$0.00"}
                </div>
              </div>
              <div>
                <div className="text-[12px] text-muted-foreground">{t("vault.accumulatedYield")}</div>
                <div className="text-2xl font-bold text-neon-value" data-testid="text-my-yield">
                  {walletAddress ? formatMA(totalYield) : "0.00 MA"}
                </div>
              </div>
            </div>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => window.location.href = "/profile"}
              data-testid="button-claim"
            >
              <Sparkles className="mr-2 h-4 w-4" /> {t("vault.claimYield")}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="px-4 lg:px-0">
        <Tabs defaultValue="deposit">
          <TabsList className="w-full bg-card border border-border">
            <TabsTrigger value="deposit" className="flex-1 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" data-testid="tab-deposit">
              {t("vault.depositRecords", "存入记录")}
            </TabsTrigger>
            <TabsTrigger value="withdraw" className="flex-1 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" data-testid="tab-withdraw">
              {t("vault.redeemRecords", "赎回记录")}
            </TabsTrigger>
            <TabsTrigger value="yield" className="flex-1 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" data-testid="tab-yield">
              {t("vault.yieldTab")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="deposit" className="mt-3 space-y-3">
            {walletAddress ? (
              <>
                {/* Active positions summary */}
                {activePositions.length > 0 && (
                  <Card className="border-border bg-card">
                    <CardContent className="p-4">
                      <h4 className="text-sm font-semibold mb-2">{t("vault.currentLocked", "当前锁仓")}</h4>
                      <div className="space-y-2">
                        {activePositions.map((pos) => {
                          const planConfig = VAULT_PLANS[pos.planType as keyof typeof VAULT_PLANS];
                          const isBonus = pos.isBonus || pos.planType === "BONUS_5D";
                          const yieldLocked = pos.bonusYieldLocked;
                          const dailyRatePct = isBonus ? "0.5" : planConfig ? (planConfig.dailyRate * 100).toFixed(1) : "0.0";
                          const cycleDays = isBonus ? 5 : (planConfig?.days || 0);
                          return (
                            <div key={pos.id} className={cn("flex items-center justify-between rounded-md px-3 py-2.5 text-xs", isBonus ? "bg-amber-500/5 border border-amber-500/10" : "bg-muted/30")}>
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-sm">${Number(pos.principal).toFixed(0)}</span>
                                  <span className="text-muted-foreground">{isBonus ? t("vault.bonusLabel", "体验金") : (planConfig?.label || pos.planType)}</span>
                                  {isBonus && <Badge className="text-[8px] bg-amber-500/10 text-amber-400 border-amber-500/20">{t("vault.bonusBadge", "赠送")}</Badge>}
                                </div>
                                {isBonus && yieldLocked && (
                                  <p className="text-[9px] text-amber-400/60 mt-0.5">{t("vault.bonusYieldLocked", "收益锁仓中 · 存入≥100U(45/90/180天)激活")}</p>
                                )}
                              </div>
                              <div className="text-right">
                                <span className="text-primary font-semibold">{dailyRatePct}%</span>
                                <span className="text-muted-foreground ml-1">/ {t("vault.day", "天")}</span>
                                <span className="text-muted-foreground ml-2">{cycleDays}{t("vault.dayCycle", "天周期")}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}
                <TransactionTable walletAddress={walletAddress} type="VAULT_DEPOSIT" />
              </>
            ) : (
              <Card className="border-border bg-card">
                <CardContent className="p-4 text-center py-6 text-sm text-muted-foreground">{t("common.connectWalletToView")}</CardContent>
              </Card>
            )}
          </TabsContent>
          <TabsContent value="withdraw" className="mt-3">
            {walletAddress ? (
              <TransactionTable walletAddress={walletAddress} type="WITHDRAW" />
            ) : (
              <Card className="border-border bg-card">
                <CardContent className="p-4 text-center py-6 text-sm text-muted-foreground">{t("common.connectWalletToView")}</CardContent>
              </Card>
            )}
          </TabsContent>
          <TabsContent value="yield" className="mt-3 space-y-3">
            {walletAddress ? (
              <>
                <div className="space-y-3">
                  {activePositions.length === 0 ? (
                    <Card className="border-border bg-card">
                      <CardContent className="p-6 text-center text-sm text-muted-foreground">
                        {t("vault.noPositionsYet")}
                      </CardContent>
                    </Card>
                  ) : (
                    <>
                      {/* Summary header — exclude locked bonus yields */}
                      <div className="rounded-xl p-3" style={{ background: "rgba(10,186,181,0.06)", border: "1px solid rgba(10,186,181,0.12)" }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] text-foreground/40">{t("vault.totalDailyYield", "每日总收益")}</span>
                          <span className="text-[9px] text-foreground/20">{activePositions.length} {t("vault.positions", "笔持仓")}</span>
                        </div>
                        <span className="text-lg font-black text-primary font-mono">
                          {formatMA(activePositions.filter(p => !p.bonusYieldLocked).reduce((sum, p) => sum + Number(p.principal) * Number(p.dailyRate || 0), 0))}
                        </span>
                        {activePositions.some(p => p.bonusYieldLocked) && (
                          <p className="text-[9px] text-amber-400/50 mt-1">
                            + {formatMA(activePositions.filter(p => p.bonusYieldLocked).reduce((sum, p) => sum + Number(p.principal) * Number(p.dailyRate || 0), 0))} {t("vault.yieldLocked", "收益(锁仓)")}
                          </p>
                        )}
                      </div>

                      {/* Per-position cards */}
                      {activePositions.map((pos, idx) => {
                        const principal = Number(pos.principal);
                        const dailyRate = Number(pos.dailyRate || 0);
                        const start = new Date(pos.startDate!);
                        const end = pos.endDate ? new Date(pos.endDate) : null;
                        const now = new Date();
                        const daysElapsed = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86400_000));
                        const totalDays = end ? Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400_000)) : 0;
                        const progress = totalDays > 0 ? Math.min(100, (daysElapsed / totalDays) * 100) : 0;
                        const dailyYield = principal * dailyRate;
                        const accumulatedYield = dailyYield * daysElapsed;
                        const planConfig = VAULT_PLANS[pos.planType as keyof typeof VAULT_PLANS];
                        const isBonus = pos.isBonus || pos.planType === "BONUS_5D";
                        const yieldLocked = pos.bonusYieldLocked;
                        const posRewards = vaultRewards.filter(r => r.positionId === pos.id);

                        return (
                          <div
                            key={pos.id}
                            className={cn("rounded-xl p-3 space-y-2", isBonus ? "border border-amber-500/15" : "border border-white/[0.06]")}
                            style={{ background: isBonus ? "rgba(234,179,8,0.03)" : "rgba(255,255,255,0.02)", animation: `fadeSlideIn 0.3s ease-out ${idx * 0.06}s both` }}
                          >
                            {/* Header */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-[13px] font-bold text-foreground/70">
                                  ${principal.toFixed(0)}
                                </span>
                                <span className="text-[10px] text-foreground/30">
                                  {isBonus ? t("vault.bonusLabel", "体验金") : (planConfig?.label || pos.planType)}
                                </span>
                                {isBonus && <Badge className="text-[8px] bg-amber-500/10 text-amber-400 border-amber-500/20">{t("vault.bonusBadge", "赠送")}</Badge>}
                              </div>
                              <Badge className="text-[9px] bg-primary/10 text-primary border-primary/15">
                                {(dailyRate * 100).toFixed(1)}%/{t("vault.perDay", "日")}
                              </Badge>
                            </div>

                            {/* Progress bar */}
                            <div>
                              <div className="flex items-center justify-between text-[9px] text-foreground/25 mb-1">
                                <span>{t("vault.progress", "进度")} {daysElapsed}/{totalDays}{t("vault.perDay", "日")}</span>
                                <span>{progress.toFixed(0)}%</span>
                              </div>
                              <div className="w-full h-1 rounded-full bg-foreground/5 overflow-hidden">
                                <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: isBonus ? "#eab308" : "#0abab5" }} />
                              </div>
                            </div>

                            {/* Yield info: USDT份额 ÷ MA价格 = MA收益 */}
                            <div className="grid grid-cols-2 gap-2">
                              <div className="rounded-lg bg-white/[0.03] px-2.5 py-2">
                                <p className="text-[9px] text-foreground/25">{t("vault.dailyEarnings", "每日收益")}</p>
                                <p className="text-[12px] font-bold text-primary font-mono">{formatMA(dailyYield)}</p>
                                <p className="text-[8px] text-foreground/15 font-mono">${dailyYield.toFixed(2)} ÷ ${maPrice.toFixed(2)}</p>
                              </div>
                              <div className="rounded-lg bg-white/[0.03] px-2.5 py-2">
                                <p className="text-[9px] text-foreground/25">
                                  {yieldLocked ? t("vault.yieldLocked", "收益(锁仓)") : t("vault.totalEarned", "累计收益")}
                                </p>
                                <p className={cn("text-[12px] font-bold font-mono", yieldLocked ? "text-amber-400/60" : "text-primary")}>{formatMA(accumulatedYield)}</p>
                                <p className="text-[8px] text-foreground/15 font-mono">≈ ${accumulatedYield.toFixed(2)}</p>
                              </div>
                            </div>

                            {/* Bonus yield locked notice */}
                            {isBonus && yieldLocked && (
                              <div className="rounded-lg bg-amber-500/5 border border-amber-500/10 px-2.5 py-1.5">
                                <p className="text-[9px] text-amber-400/70 leading-relaxed">
                                  {t("vault.bonusYieldLocked", "收益锁仓中 · 存入≥100U(45/90/180天)激活")}
                                </p>
                              </div>
                            )}

                            {/* Yield history button */}
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full text-[10px] h-7"
                              onClick={() => setYieldDetailPosId(pos.id)}
                            >
                              {t("vault.yieldHistory")} ({posRewards.length})
                              <ChevronRight className="h-3 w-3 ml-auto" />
                            </Button>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              </>
            ) : (
              <Card className="border-border bg-card">
                <CardContent className="p-4 text-center py-6 text-sm text-muted-foreground">{t("common.connectWalletToView")}</CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <div className="fixed bottom-16 lg:bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur-md px-3 sm:px-4 py-2.5 sm:py-3">
        <div className="mx-auto max-w-lg lg:max-w-2xl flex gap-2 sm:gap-3">
          <Button
            className="flex-1 min-w-0 bg-cyan-600 text-white border-cyan-700 text-xs sm:text-sm px-2 sm:px-4 h-9 sm:h-10"
            onClick={() => setDepositOpen(true)}
            data-testid="button-deposit-vault"
          >
            <ArrowDownToLine className="mr-1.5 sm:mr-2 h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
            <span className="truncate">{t("vault.depositToVault")}</span>
          </Button>
          <Button
            variant="secondary"
            className="flex-1 min-w-0 text-xs sm:text-sm px-2 sm:px-4 h-9 sm:h-10"
            onClick={() => setRedeemOpen(true)}
            data-testid="button-redeem-vault"
          >
            <ArrowUpFromLine className="mr-1.5 sm:mr-2 h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
            <span className="truncate">{t("vault.redeemFromVault")}</span>
          </Button>
        </div>
      </div>

      <VaultDepositDialog open={depositOpen} onOpenChange={setDepositOpen} />

      <Dialog open={redeemOpen} onOpenChange={setRedeemOpen}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">{t("vault.redeemFromVault")}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("vault.selectPosition")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {!walletAddress ? (
              <div className="text-center py-4 text-sm text-muted-foreground">
                {t("vault.connectToViewPositions")}
              </div>
            ) : activePositions.length === 0 ? (
              <div className="text-center py-4 text-sm text-muted-foreground" data-testid="text-no-active-positions">
                {t("vault.noActivePositions")}
              </div>
            ) : (
              <>
                <label className="text-xs text-muted-foreground mb-1.5 block">{t("vault.selectPosition")}</label>
                <Select value={selectedPositionId} onValueChange={setSelectedPositionId}>
                  <SelectTrigger data-testid="select-position">
                    <SelectValue placeholder={t("vault.choosePosition")} />
                  </SelectTrigger>
                  <SelectContent>
                    {activePositions.filter(p => p.planType !== "BONUS_5D" && !p.isBonus).map((pos) => {
                      const planConfig = VAULT_PLANS[pos.planType as keyof typeof VAULT_PLANS];
                      return (
                        <SelectItem key={pos.id} value={pos.id} data-testid={`select-position-${pos.id}`}>
                          ${Number(pos.principal).toFixed(2)} - {planConfig?.label || pos.planType}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {selectedPositionId && (() => {
                  const pos = activePositions.find(p => p.id === selectedPositionId);
                  if (!pos) return null;
                  const now = new Date();
                  const start = new Date(pos.startDate!);
                  const days = Math.max(0, Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
                  const principal = Number(pos.principal);
                  // MA minted at deposit = principal / MA price at deposit time
                  // For now use current price as approximation
                  const totalMA = usdcToMA(principal);
                  const yieldMA = principal * Number(pos.dailyRate) * days / maPrice;
                  const isEarly = pos.endDate && now < new Date(pos.endDate);
                  const penaltyMA = isEarly ? totalMA * 0.20 : 0;
                  const netMA = totalMA - penaltyMA;
                  return (
                    <div className="bg-muted/30 rounded-md p-3 text-xs space-y-1.5">
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{t("vault.depositPrincipal", "存入本金")}</span>
                        <span>${principal.toFixed(2)} USDT</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{t("vault.mintedMA", "铸造 MA")}</span>
                        <span>{totalMA.toFixed(2)} MA</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{t("vault.accumulatedInterest", "累计收益 ({{days}}天)", { days })}</span>
                        <span className="text-neon-value">+{yieldMA.toFixed(2)} MA</span>
                      </div>
                      {isEarly && (
                        <>
                          <div className="flex justify-between gap-2 text-red-400">
                            <span>{t("vault.earlyRedeemPenalty", "提前赎回罚金 (20%)")}</span>
                            <span>-{penaltyMA.toFixed(2)} MA</span>
                          </div>
                          <div className="text-[10px] text-yellow-400/80 bg-yellow-500/8 rounded px-2 py-1">
                            {t("vault.earlyRedeemWarning", "未到期赎回将扣除铸造 MA 的 20%，仅返还 80%")}
                          </div>
                        </>
                      )}
                      <div className="flex justify-between gap-2 pt-1.5 border-t border-border/30">
                        <span className="font-medium">{t("vault.redeemReceive", "赎回获得")}</span>
                        <span className="font-bold text-primary">{(netMA + yieldMA).toFixed(2)} MA</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {t("vault.approxValue", "≈ ${{value}} (按当前价 ${{price}})", { value: ((netMA + yieldMA) * maPrice).toFixed(2), price: maPrice.toFixed(4) })}
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-500 border-emerald-500/50 text-white"
              onClick={() => handleWithdraw(selectedPositionId)}
              disabled={withdrawMutation.isPending || !selectedPositionId || !walletAddress}
              data-testid="button-confirm-redeem"
            >
              {withdrawMutation.isPending ? t("common.processing") : t("vault.confirmRedemption")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Yield detail dialog per position */}
      <Dialog open={yieldDetailPosId !== null} onOpenChange={(open) => { if (!open) setYieldDetailPosId(null); }}>
        <DialogContent className="bg-card border-border max-w-sm max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">{t("vault.yieldHistory")}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {(() => {
                const pos = (positions || []).find(p => p.id === yieldDetailPosId);
                const cfg = pos ? VAULT_PLANS[pos.planType as keyof typeof VAULT_PLANS] : null;
                return pos ? `${cfg?.label || pos.planType} · ${formatUSD(Number(pos.principal))}` : "";
              })()}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 -mx-1 px-1 space-y-2">
            {rewardsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : (() => {
              const posRewards = vaultRewards.filter(r => r.positionId === yieldDetailPosId);
              if (posRewards.length === 0) {
                return (
                  <div className="text-center py-8">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                    <div className="text-sm text-muted-foreground">{t("common.noRecords")}</div>
                  </div>
                );
              }
              return posRewards.map((r, idx) => {
                const arAmt = r.maAmount ? Number(r.maAmount) : usdcToMA(Number(r.amount));
                const usedPrice = r.maPrice ? Number(r.maPrice) : null;
                return (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-md bg-muted/30 border border-border/30"
                    style={{ animation: `fadeSlideIn 0.3s ease-out ${idx * 0.04}s both` }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium">{t("vault.dailyYield")}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {usedPrice != null && <span>@${usedPrice} · </span>}
                        {r.createdAt ? new Date(r.createdAt).toLocaleString() : "--"}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-neon-value">+{arAmt.toFixed(2)} MA</div>
                      <div className="text-[10px] text-muted-foreground">{formatUSD(Number(r.amount))}</div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
