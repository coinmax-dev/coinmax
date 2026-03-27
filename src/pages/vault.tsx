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
      <CardContent className="p-4">
        <div className="overflow-x-auto">
        <div className="grid grid-cols-6 text-[12px] text-muted-foreground mb-2 font-medium gap-1 min-w-[400px]">
          <span>{t("common.token")}</span><span>{t("common.amount")}</span><span>Chain</span><span>{t("common.txid")}</span><span>{t("common.status")}</span><span>{t("common.date")}</span>
        </div>
        <div className="space-y-1">
          {txs.map((tx, idx) => (
            <div
              key={tx.id}
              className="grid grid-cols-6 text-xs py-2 border-b border-border/30 last:border-0 gap-1 min-w-[400px]"
              style={{ animation: `fadeSlideIn 0.3s ease-out ${idx * 0.05}s both` }}
              data-testid={`row-tx-${tx.id}`}
            >
              <span className="font-medium">{tx.token}</span>
              <span className="text-neon-value">{type === "YIELD" ? `${usdcToMA(Number(tx.amount)).toFixed(2)} MA` : `$${Number(tx.amount).toFixed(2)}`}</span>
              <span className="text-blue-400 text-[11px]">Base</span>
              <span className="text-muted-foreground truncate">
                {tx.txHash ? (
                  <a
                    href={`https://sepolia.basescan.org/tx/${tx.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary/80 hover:text-primary"
                  >
                    {shortenAddress(tx.txHash)}
                  </a>
                ) : "-"}
              </span>
              <Badge
                className={`text-[11px] w-fit no-default-hover-elevate no-default-active-elevate ${
                  tx.status === "CONFIRMED"
                    ? "bg-primary/15 text-primary"
                    : "bg-yellow-500/15 text-yellow-400"
                }`}
              >
                {tx.status}
              </Badge>
              <span className="text-muted-foreground">
                {tx.createdAt ? new Date(tx.createdAt).toLocaleDateString() : "-"}
              </span>
            </div>
          ))}
        </div>
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
  const { formatMA, usdcToMA } = useMaPrice();

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
              disabled={totalYield <= 0}
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
              存入记录
            </TabsTrigger>
            <TabsTrigger value="withdraw" className="flex-1 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" data-testid="tab-withdraw">
              赎回记录
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
                      <h4 className="text-sm font-semibold mb-2">当前锁仓</h4>
                      <div className="space-y-2">
                        {activePositions.map((pos) => {
                          const planConfig = VAULT_PLANS[pos.planType as keyof typeof VAULT_PLANS];
                          const start = new Date(pos.startDate!);
                          const end = pos.endDate ? new Date(pos.endDate) : null;
                          const now = new Date();
                          const daysLeft = end ? Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400_000)) : 0;
                          const isExpired = end ? now >= end : false;
                          return (
                            <div key={pos.id} className="flex items-center justify-between bg-muted/30 rounded-md px-3 py-2.5 text-xs">
                              <div>
                                <span className="font-semibold text-sm">${Number(pos.principal).toFixed(0)}</span>
                                <span className="text-muted-foreground ml-2">{planConfig?.label || pos.planType}</span>
                              </div>
                              <span className={isExpired ? "text-green-400" : "text-yellow-400"}>
                                {isExpired ? "已到期" : `${daysLeft}天后到期`}
                              </span>
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
                {/* Per-position yield details */}
                <Card className="border-border bg-card">
                  <CardContent className="p-4">
                    <h4 className="text-sm font-semibold mb-3">{t("vault.yieldDetails")}</h4>
                    {activePositions.length === 0 ? (
                      <div className="text-center py-4 text-sm text-muted-foreground">
                        {t("vault.noPositionsYet")}
                      </div>
                    ) : (
                      <>
                        {/* Total daily yield summary */}
                        <div className="flex items-center justify-between bg-primary/10 rounded-md px-3 py-2 mb-3">
                          <span className="text-xs font-medium">{t("vault.totalDailyYield")}</span>
                          <span className="text-sm font-bold text-neon-value">
                            {formatMA(activePositions.reduce((sum, p) => sum + Number(p.principal) * Number(p.dailyRate || 0), 0))}
                          </span>
                        </div>
                        {/* Per-position cards */}
                        <div className="space-y-2">
                          {activePositions.map((pos, idx) => {
                            const principal = Number(pos.principal);
                            const dailyRate = Number(pos.dailyRate || 0);
                            const start = new Date(pos.startDate!);
                            const now = new Date();
                            const daysElapsed = Math.max(0, Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
                            const dailyYield = principal * dailyRate;
                            const accumulatedYield = dailyYield * daysElapsed;
                            const planConfig = VAULT_PLANS[pos.planType as keyof typeof VAULT_PLANS];
                            const posRewards = vaultRewards.filter(r => r.positionId === pos.id);

                            return (
                              <div
                                key={pos.id}
                                className="bg-muted/30 rounded-md p-3 text-xs space-y-1.5"
                                style={{ animation: `fadeSlideIn 0.3s ease-out ${idx * 0.08}s both` }}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-medium text-sm">{planConfig?.label || pos.planType}</span>
                                  <Badge className="text-[10px] bg-primary/15 text-primary no-default-hover-elevate no-default-active-elevate">
                                    {(dailyRate * 100).toFixed(1)}%/day
                                  </Badge>
                                </div>
                                <div className="flex justify-between gap-2">
                                  <span className="text-muted-foreground">{t("vault.principal")}</span>
                                  <span>{formatUSD(principal)}</span>
                                </div>
                                <div className="flex justify-between gap-2">
                                  <span className="text-muted-foreground">{t("vault.daysElapsed")}</span>
                                  <span>{daysElapsed}d</span>
                                </div>
                                <div className="flex justify-between gap-2">
                                  <span className="text-muted-foreground">{t("vault.dailyEarnings")}</span>
                                  <span className="text-neon-value">{formatMA(dailyYield)}</span>
                                </div>
                                <div className="flex justify-between gap-2 pt-1 border-t border-border/30">
                                  <span className="text-muted-foreground">{t("vault.accumulatedYield")}</span>
                                  <span className="text-neon-value font-medium">{formatMA(accumulatedYield)}</span>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="w-full mt-1.5 text-[11px] h-7"
                                  onClick={() => setYieldDetailPosId(pos.id)}
                                >
                                  {t("vault.yieldHistory")} ({posRewards.length})
                                  <ChevronRight className="h-3 w-3 ml-auto" />
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
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
                    {activePositions.map((pos) => {
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
                  const yieldAmt = principal * Number(pos.dailyRate) * days;
                  const isEarly = pos.endDate && now < new Date(pos.endDate);
                  const penalty = isEarly ? principal * 0.20 : 0;
                  const netPrincipal = principal - penalty;
                  return (
                    <div className="bg-muted/30 rounded-md p-3 text-xs space-y-1">
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{t("vault.principal")}</span>
                        <span>${principal.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{t("vault.yieldDays", { days })}</span>
                        <span className="text-neon-value">{formatMA(yieldAmt)}</span>
                      </div>
                      {isEarly && (
                        <>
                          <div className="flex justify-between gap-2 text-red-400">
                            <span>{t("vault.earlyPenalty")}</span>
                            <span>-${penalty.toFixed(2)} (20%)</span>
                          </div>
                          <div className="text-yellow-400 text-[12px]">
                            {t("vault.earlyWithdrawal")}
                          </div>
                        </>
                      )}
                      <div className="flex justify-between gap-2 pt-1 border-t border-border/30">
                        <span className="text-muted-foreground">{t("vault.total")}</span>
                        <span className="font-medium">${netPrincipal.toFixed(2)} + {formatMA(yieldAmt)}</span>
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
