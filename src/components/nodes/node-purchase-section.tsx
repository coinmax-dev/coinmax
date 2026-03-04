import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Shield, Server, Loader2, AlertTriangle, Lock, Coins, CheckCircle2, XCircle, ChevronRight, Landmark, GitBranch, ArrowLeft } from "lucide-react";
import { NODE_PLANS, NODE_MILESTONES } from "@/lib/data";
import { usePayment, getPaymentStatusLabel } from "@/hooks/use-payment";
import { purchaseNode, getNodeMilestoneRequirements } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { NODE_CONTRACT_ADDRESS } from "@/lib/contracts";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";

type Step = "select_rank" | "check_requirements" | "confirm_payment";

interface NodePurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeType: "MAX" | "MINI";
  walletAddr: string;
}

const MAX_PURCHASABLE_MILESTONES = NODE_MILESTONES.MAX.filter(m => m.rank !== "V1");

export function NodePurchaseDialog({ open, onOpenChange, nodeType, walletAddr }: NodePurchaseDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const payment = usePayment();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<Step>("select_rank");
  const [selectedRank, setSelectedRank] = useState<string | null>(null);

  const { data: requirements } = useQuery<{ vaultDeposited: number; directNodeReferrals: number }>({
    queryKey: ["node-milestone-requirements", walletAddr],
    queryFn: () => getNodeMilestoneRequirements(walletAddr),
    enabled: !!walletAddr && open,
  });

  const vaultDeposited = requirements?.vaultDeposited ?? 0;
  const directNodeReferrals = requirements?.directNodeReferrals ?? 0;

  const selectedMilestone = selectedRank
    ? MAX_PURCHASABLE_MILESTONES.find(m => m.rank === selectedRank)
    : null;

  const holdingOk = selectedMilestone ? vaultDeposited >= selectedMilestone.requiredHolding : false;
  const referralsOk = selectedMilestone
    ? selectedMilestone.requiredReferrals === 0 || directNodeReferrals >= selectedMilestone.requiredReferrals
    : false;
  const allRequirementsMet = holdingOk && referralsOk;

  const plan = NODE_PLANS[nodeType];

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      let txHash: string | undefined;
      if (NODE_CONTRACT_ADDRESS) {
        txHash = await payment.payNodePurchase(nodeType, "FULL");
      }
      const result = await purchaseNode(walletAddr, nodeType, txHash, "FULL");
      payment.markSuccess();
      return result;
    },
    onSuccess: () => {
      toast({
        title: t("profile.nodePurchased"),
        description: t("profile.nodePurchaseSuccess"),
      });
      queryClient.invalidateQueries({ queryKey: ["node-overview", walletAddr] });
      queryClient.invalidateQueries({ queryKey: ["profile", walletAddr] });
      queryClient.invalidateQueries({ queryKey: ["node-milestone-requirements", walletAddr] });
      payment.reset();
      handleClose();
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

  const handleClose = () => {
    setStep("select_rank");
    setSelectedRank(null);
    onOpenChange(false);
  };

  const handleRankSelect = (rank: string) => {
    setSelectedRank(rank);
    setStep("check_requirements");
  };

  const handleRequirementNext = () => {
    if (allRequirementsMet) {
      setStep("confirm_payment");
    }
  };

  const handleMiniConfirm = () => {
    setStep("confirm_payment");
  };

  const handlePurchase = () => {
    purchaseMutation.mutate();
  };

  const isMAX = nodeType === "MAX";
  const title = isMAX ? t("profile.applyLargeNode") : t("profile.applySmallNode");

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-sm p-0 overflow-hidden"
        style={{ background: "#111", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 20 }}
      >
        <div className="px-5 pt-5 pb-2">
          <DialogHeader className="mb-0">
            <div className="flex items-center gap-3">
              {step !== "select_rank" && isMAX && (
                <button
                  onClick={() => {
                    if (step === "check_requirements") { setStep("select_rank"); setSelectedRank(null); }
                    else if (step === "confirm_payment") setStep("check_requirements");
                  }}
                  className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors shrink-0"
                >
                  <ArrowLeft className="h-4 w-4 text-white/60" />
                </button>
              )}
              <div className="flex-1">
                <DialogTitle className="text-[15px] flex items-center gap-2">
                  {isMAX ? <Server className="h-4.5 w-4.5 text-primary" /> : <Shield className="h-4.5 w-4.5 text-white/60" />}
                  {title}
                </DialogTitle>
                <DialogDescription className="text-[11px] text-white/35 mt-0.5">
                  {isMAX && step === "select_rank" && t("profile.selectRankLevel")}
                  {isMAX && step === "check_requirements" && `${selectedRank} ${t("profile.requirementCheckTitle")}`}
                  {step === "confirm_payment" && t("profile.confirmPaymentDesc")}
                  {!isMAX && step === "select_rank" && t("profile.miniNodeDesc")}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {isMAX && step === "select_rank" && (
            <div className="flex items-center gap-1 mt-2">
              {["select_rank", "check_requirements", "confirm_payment"].map((s, i) => (
                <div key={s} className="flex items-center gap-1 flex-1">
                  <div
                    className="h-1 rounded-full flex-1"
                    style={{
                      background: i === 0 ? "#4ade80" : "rgba(255,255,255,0.08)",
                    }}
                  />
                </div>
              ))}
            </div>
          )}
          {isMAX && step === "check_requirements" && (
            <div className="flex items-center gap-1 mt-2">
              {["select_rank", "check_requirements", "confirm_payment"].map((s, i) => (
                <div key={s} className="flex-1 h-1 rounded-full" style={{ background: i <= 1 ? "#4ade80" : "rgba(255,255,255,0.08)" }} />
              ))}
            </div>
          )}
          {step === "confirm_payment" && (
            <div className="flex items-center gap-1 mt-2">
              {["select_rank", "check_requirements", "confirm_payment"].map((s, i) => (
                <div key={s} className="flex-1 h-1 rounded-full" style={{ background: "#4ade80" }} />
              ))}
            </div>
          )}
        </div>

        <div className="px-5 pb-5">
          {isMAX && step === "select_rank" && (
            <div className="space-y-2 mt-1">
              {MAX_PURCHASABLE_MILESTONES.map((ms) => {
                const hOk = vaultDeposited >= ms.requiredHolding;
                const rOk = ms.requiredReferrals === 0 || directNodeReferrals >= ms.requiredReferrals;
                const ok = hOk && rOk;

                return (
                  <button
                    key={ms.rank}
                    className="w-full rounded-xl p-3 flex items-center gap-3 text-left transition-all active:scale-[0.98]"
                    style={{
                      background: "#1a1a1a",
                      border: ok ? "1px solid rgba(74,222,128,0.15)" : "1px solid rgba(255,255,255,0.06)",
                    }}
                    onClick={() => handleRankSelect(ms.rank)}
                  >
                    <div
                      className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 text-[13px] font-black"
                      style={{
                        background: ok
                          ? "linear-gradient(135deg, rgba(74,222,128,0.2), rgba(74,222,128,0.06))"
                          : "rgba(255,255,255,0.04)",
                        border: ok ? "1px solid rgba(74,222,128,0.3)" : "1px solid rgba(255,255,255,0.08)",
                        color: ok ? "#4ade80" : "rgba(255,255,255,0.3)",
                      }}
                    >
                      {ms.rank}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold text-white/85">{ms.desc}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {ms.requiredHolding > 0 && (
                          <span className={`text-[10px] flex items-center gap-0.5 ${hOk ? "text-green-400" : "text-red-400"}`}>
                            {hOk ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                            {ms.requiredHolding}U
                          </span>
                        )}
                        {ms.requiredReferrals > 0 && (
                          <span className={`text-[10px] flex items-center gap-0.5 ${rOk ? "text-green-400" : "text-red-400"}`}>
                            {rOk ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                            {ms.requiredReferrals} {t("profile.referralsShort")}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-white/20 shrink-0" />
                  </button>
                );
              })}
            </div>
          )}

          {isMAX && step === "check_requirements" && selectedMilestone && (
            <div className="space-y-3 mt-1">
              <div
                className="rounded-xl p-3 text-center"
                style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="text-[22px] font-black text-white">{selectedRank}</div>
                <div className="text-[11px] text-white/40 mt-0.5">{selectedMilestone.desc}</div>
                <div className="text-[10px] text-white/25 mt-0.5">{selectedMilestone.days} {t("profile.daysDeadline")}</div>
              </div>

              {selectedMilestone.requiredHolding > 0 && (
                <div
                  className="rounded-xl p-3 space-y-2"
                  style={{
                    background: "#161616",
                    border: holdingOk ? "1px solid rgba(74,222,128,0.25)" : "1px solid rgba(239,68,68,0.25)",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-white/40" />
                    <span className="text-[12px] font-semibold text-white/70">{t("profile.holdingRequired")}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-white/40">{t("profile.currentHolding")}</span>
                    <span className={`text-[13px] font-bold ${holdingOk ? "text-green-400" : "text-red-400"}`}>
                      {vaultDeposited.toFixed(0)} / {selectedMilestone.requiredHolding} USDC
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, (vaultDeposited / selectedMilestone.requiredHolding) * 100)}%`,
                        background: holdingOk ? "#22c55e" : "#ef4444",
                      }}
                    />
                  </div>
                  {holdingOk ? (
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-green-400" />
                      <span className="text-[10px] text-green-400 font-medium">{t("profile.requirementMet")}</span>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full text-[11px] rounded-lg h-8 mt-1"
                      onClick={() => { handleClose(); navigate("/vault"); }}
                    >
                      <Landmark className="mr-1.5 h-3 w-3" />
                      {t("profile.goToVault")}
                    </Button>
                  )}
                </div>
              )}

              {selectedMilestone.requiredReferrals > 0 && (
                <div
                  className="rounded-xl p-3 space-y-2"
                  style={{
                    background: "#161616",
                    border: referralsOk ? "1px solid rgba(74,222,128,0.25)" : "1px solid rgba(239,68,68,0.25)",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-white/40" />
                    <span className="text-[12px] font-semibold text-white/70">{t("profile.directNodeRequired")}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-white/40">{t("profile.currentDirectNodes")}</span>
                    <span className={`text-[13px] font-bold ${referralsOk ? "text-green-400" : "text-red-400"}`}>
                      {directNodeReferrals} / {selectedMilestone.requiredReferrals}
                    </span>
                  </div>
                  {referralsOk ? (
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-green-400" />
                      <span className="text-[10px] text-green-400 font-medium">{t("profile.requirementMet")}</span>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full text-[11px] rounded-lg h-8 mt-1"
                      onClick={() => { handleClose(); navigate("/profile/referral"); }}
                    >
                      <GitBranch className="mr-1.5 h-3 w-3" />
                      {t("profile.inviteFriends")}
                    </Button>
                  )}
                </div>
              )}

              {allRequirementsMet && (
                <Button
                  className="w-full rounded-xl h-10 text-[13px] font-bold"
                  onClick={handleRequirementNext}
                >
                  {t("common.next")}
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              )}
            </div>
          )}

          {!isMAX && step === "select_rank" && (
            <div className="space-y-3 mt-1">
              <div className="grid grid-cols-2 gap-2 text-[11px] text-white/50">
                <div className="flex items-center gap-1.5">
                  <Coins className="h-3 w-3 text-primary shrink-0" />
                  <span>{t("profile.contribution")}: ${plan.price}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Lock className="h-3 w-3 text-primary shrink-0" />
                  <span>{t("profile.frozenFunds")}: ${plan.frozenAmount.toLocaleString()}</span>
                </div>
              </div>
              <div className="rounded-lg p-2.5" style={{ background: "#1a1a1a" }}>
                <div className="text-[10px] text-white/40 font-medium mb-1.5">{t("profile.milestoneSchedule")}:</div>
                {NODE_MILESTONES.MINI.map((m, i) => (
                  <div key={i} className="text-[10px] text-white/50 py-0.5">
                    {t("profile.dayN", { n: m.days })} → {m.rank} ({m.desc})
                  </div>
                ))}
              </div>
              <Button
                className="w-full rounded-xl h-10 text-[13px] font-bold"
                onClick={handleMiniConfirm}
              >
                {t("common.next")}
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          )}

          {step === "confirm_payment" && (
            <div className="space-y-3 mt-1">
              <div className="rounded-xl p-4 space-y-2.5" style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="text-center">
                  <div className="text-[11px] text-white/40 mb-1">{title}</div>
                  {isMAX && selectedRank && (
                    <div className="text-[18px] font-black text-primary mb-1">{selectedRank}</div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-white/50">{t("profile.contribution")}</span>
                    <span className="font-bold text-white">${plan.price} USDC</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-white/50">{t("profile.frozenFunds")}</span>
                    <span className="font-bold text-white">${plan.frozenAmount.toLocaleString()} USDC</span>
                  </div>
                  <div className="h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-white/50">{t("profile.totalPayment")}</span>
                    <span className="font-bold text-primary text-[14px]">${(plan.price + plan.frozenAmount).toLocaleString()} USDC</span>
                  </div>
                </div>
              </div>

              <Button
                className="w-full rounded-xl h-11 text-[13px] font-bold"
                onClick={handlePurchase}
                disabled={purchaseMutation.isPending}
              >
                {purchaseMutation.isPending ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    {getPaymentStatusLabel(payment.status) || t("common.processing")}
                  </>
                ) : (
                  t("profile.confirmPurchase")
                )}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
