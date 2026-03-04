import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { Loader2, CheckCircle2, XCircle, ChevronRight, Landmark, GitBranch, ArrowLeft, Sparkles, Zap, ShieldCheck, Clock } from "lucide-react";
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

const STEP_LABELS_MAX = ["profile.stepSelectRank", "profile.stepCheckReqs", "profile.stepConfirmPay"] as const;

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
    if (purchaseMutation.isPending) return;
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

  const stepIndex = step === "select_rank" ? 0 : step === "check_requirements" ? 1 : 2;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-[380px] p-0 overflow-hidden gap-0"
        style={{
          background: "#141414",
          border: "1px solid rgba(255,255,255,0.45)",
          borderRadius: 24,
          boxShadow: "0 25px 60px rgba(0,0,0,0.7), 0 0 40px rgba(74,222,128,0.08)",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column" as const,
        }}
      >
        <VisuallyHidden.Root>
          <DialogTitle>{isMAX ? t("profile.applyLargeNode") : t("profile.applySmallNode")}</DialogTitle>
          <DialogDescription>{t("profile.confirmPaymentDesc")}</DialogDescription>
        </VisuallyHidden.Root>
        <div
          className="relative overflow-hidden px-5 pt-6 pb-5"
          style={{
            background: isMAX
              ? "linear-gradient(160deg, #0f2818 0%, #152f1d 40%, #141414 100%)"
              : "linear-gradient(160deg, #1a1a1a 0%, #1e1e1e 40%, #141414 100%)",
          }}
        >
          {isMAX && (
            <div
              className="absolute top-0 right-0 w-32 h-32 opacity-20"
              style={{
                background: "radial-gradient(circle, rgba(74,222,128,0.4) 0%, transparent 70%)",
                filter: "blur(20px)",
              }}
            />
          )}

          <div className="relative flex items-center gap-3 mb-4">
            {((step !== "select_rank" && isMAX) || (step === "confirm_payment" && !isMAX)) && (
              <button
                onClick={() => {
                  if (step === "check_requirements") { setStep("select_rank"); setSelectedRank(null); }
                  else if (step === "confirm_payment") setStep(isMAX ? "check_requirements" : "select_rank");
                }}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-all shrink-0"
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)" }}
              >
                <ArrowLeft className="h-4 w-4 text-white/80" />
              </button>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {isMAX ? (
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #166534, #15803d)", boxShadow: "0 2px 8px rgba(22,101,52,0.4)" }}>
                    <Zap className="h-3.5 w-3.5 text-green-200" />
                  </div>
                ) : (
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #374151, #4b5563)" }}>
                    <ShieldCheck className="h-3.5 w-3.5 text-gray-200" />
                  </div>
                )}
                <h2 className="text-[16px] font-bold text-white tracking-tight">
                  {isMAX ? t("profile.applyLargeNode") : t("profile.applySmallNode")}
                </h2>
              </div>
              <p className="text-[11px] text-white/30 mt-1 ml-9">
                {isMAX && step === "select_rank" && t("profile.selectRankLevel")}
                {isMAX && step === "check_requirements" && `${selectedRank} — ${t("profile.requirementCheckTitle")}`}
                {step === "confirm_payment" && t("profile.confirmPaymentDesc")}
                {!isMAX && step === "select_rank" && t("profile.miniNodeDesc")}
              </p>
            </div>
          </div>

          {isMAX && (
            <div className="flex items-center gap-2 relative mt-1">
              {STEP_LABELS_MAX.map((label, i) => (
                <div key={label} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className="w-full flex items-center gap-1">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold transition-all duration-300"
                      style={{
                        background: i <= stepIndex
                          ? "linear-gradient(135deg, #22c55e, #16a34a)"
                          : "rgba(255,255,255,0.06)",
                        color: i <= stepIndex ? "white" : "rgba(255,255,255,0.2)",
                        boxShadow: i === stepIndex ? "0 0 10px rgba(34,197,94,0.4)" : "none",
                      }}
                    >
                      {i < stepIndex ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        i + 1
                      )}
                    </div>
                    {i < 2 && (
                      <div className="flex-1 h-[2px] rounded-full transition-all duration-300" style={{ background: i < stepIndex ? "#22c55e" : "rgba(255,255,255,0.06)" }} />
                    )}
                  </div>
                  <span className="text-[9px] text-white/30 font-medium whitespace-nowrap">{t(label)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 pb-5 pt-3 flex-1 node-dialog-scroll" style={{ minHeight: 0, overflowY: "auto" }}>
          {isMAX && step === "select_rank" && (
            <div className="space-y-2.5">
              {MAX_PURCHASABLE_MILESTONES.map((ms) => (
                <button
                  key={ms.rank}
                  className="w-full rounded-2xl p-3.5 flex items-center gap-3 text-left transition-all active:scale-[0.97] group"
                  style={{
                    background: "#1a1a1a",
                    border: "1px solid rgba(255,255,255,0.4)",
                  }}
                  onClick={() => handleRankSelect(ms.rank)}
                >
                  <div
                    className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 text-[14px] font-black"
                    style={{
                      background: "linear-gradient(135deg, #222, #2a2a2a)",
                      color: "rgba(255,255,255,0.7)",
                      border: "1px solid rgba(255,255,255,0.15)",
                    }}
                  >
                    {ms.rank}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-white group-hover:text-white/90 transition-colors">{ms.desc}</div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Clock className="h-2.5 w-2.5 text-white/35" />
                      <span className="text-[10px] text-white/45 font-medium">{ms.days}d</span>
                    </div>
                  </div>
                  <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)" }}>
                    <ChevronRight className="h-3.5 w-3.5 text-white/40 group-hover:text-white/70 transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          )}

          {isMAX && step === "check_requirements" && selectedMilestone && (
            <div className="space-y-3">
              <div
                className="rounded-2xl p-4 text-center relative overflow-hidden"
                style={{
                  background: "linear-gradient(135deg, #0f1f15, #141414)",
                  border: "1px solid rgba(74,222,128,0.12)",
                }}
              >
                <div className="absolute inset-0 opacity-10" style={{ background: "radial-gradient(circle at 50% 30%, rgba(74,222,128,0.3), transparent 60%)" }} />
                <div className="relative">
                  <div
                    className="w-14 h-14 rounded-2xl mx-auto mb-2 flex items-center justify-center text-[18px] font-black"
                    style={{
                      background: "linear-gradient(135deg, #166534, #15803d)",
                      boxShadow: "0 6px 20px rgba(22,101,52,0.35)",
                      color: "#bbf7d0",
                    }}
                  >
                    {selectedRank}
                  </div>
                  <div className="text-[12px] text-white/60 font-medium">{selectedMilestone.desc}</div>
                  <div className="flex items-center justify-center gap-1 mt-1">
                    <Clock className="h-3 w-3 text-white/25" />
                    <span className="text-[10px] text-white/30">{selectedMilestone.days} {t("profile.daysDeadline")}</span>
                  </div>
                </div>
              </div>

              {selectedMilestone.requiredHolding > 0 && (
                <div
                  className="rounded-2xl p-4 space-y-3"
                  style={{
                    background: "#141414",
                    border: holdingOk ? "1px solid rgba(74,222,128,0.2)" : "1px solid rgba(239,68,68,0.15)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: holdingOk ? "rgba(74,222,128,0.1)" : "rgba(239,68,68,0.1)" }}>
                        <Landmark className="h-3.5 w-3.5" style={{ color: holdingOk ? "#4ade80" : "#f87171" }} />
                      </div>
                      <span className="text-[12px] font-semibold text-white/80">{t("profile.holdingRequired")}</span>
                    </div>
                    {holdingOk ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold text-green-400" style={{ background: "rgba(74,222,128,0.1)" }}>{t("profile.requirementMet")}</span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold text-red-400" style={{ background: "rgba(239,68,68,0.1)" }}>{t("profile.requirementNotMet")}</span>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] text-white/35">{t("profile.currentHolding")}</span>
                      <span className={`text-[13px] font-bold ${holdingOk ? "text-green-400" : "text-white/80"}`}>
                        {vaultDeposited.toFixed(0)} / {selectedMilestone.requiredHolding} USDC
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(100, (vaultDeposited / selectedMilestone.requiredHolding) * 100)}%`,
                          background: holdingOk
                            ? "linear-gradient(90deg, #22c55e, #4ade80)"
                            : "linear-gradient(90deg, #ef4444, #f87171)",
                          boxShadow: holdingOk ? "0 0 8px rgba(34,197,94,0.3)" : "0 0 8px rgba(239,68,68,0.2)",
                        }}
                      />
                    </div>
                  </div>
                  {!holdingOk && (
                    <button
                      className="w-full rounded-xl h-9 flex items-center justify-center gap-1.5 text-[11px] font-semibold transition-all active:scale-[0.97]"
                      style={{
                        background: "linear-gradient(135deg, rgba(74,222,128,0.08), rgba(74,222,128,0.03))",
                        border: "1px solid rgba(74,222,128,0.15)",
                        color: "#4ade80",
                      }}
                      onClick={() => { handleClose(); navigate("/vault"); }}
                    >
                      <Landmark className="h-3 w-3" />
                      {t("profile.goToVault")}
                    </button>
                  )}
                </div>
              )}

              {selectedMilestone.requiredReferrals > 0 && (
                <div
                  className="rounded-2xl p-4 space-y-3"
                  style={{
                    background: "#141414",
                    border: referralsOk ? "1px solid rgba(74,222,128,0.2)" : "1px solid rgba(239,68,68,0.15)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: referralsOk ? "rgba(74,222,128,0.1)" : "rgba(239,68,68,0.1)" }}>
                        <GitBranch className="h-3.5 w-3.5" style={{ color: referralsOk ? "#4ade80" : "#f87171" }} />
                      </div>
                      <span className="text-[12px] font-semibold text-white/80">{t("profile.directNodeRequired")}</span>
                    </div>
                    {referralsOk ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold text-green-400" style={{ background: "rgba(74,222,128,0.1)" }}>{t("profile.requirementMet")}</span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold text-red-400" style={{ background: "rgba(239,68,68,0.1)" }}>{t("profile.requirementNotMet")}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-white/35">{t("profile.currentDirectNodes")}</span>
                    <span className={`text-[13px] font-bold ${referralsOk ? "text-green-400" : "text-white/80"}`}>
                      {directNodeReferrals} / {selectedMilestone.requiredReferrals}
                    </span>
                  </div>
                  {!referralsOk && (
                    <button
                      className="w-full rounded-xl h-9 flex items-center justify-center gap-1.5 text-[11px] font-semibold transition-all active:scale-[0.97]"
                      style={{
                        background: "linear-gradient(135deg, rgba(74,222,128,0.08), rgba(74,222,128,0.03))",
                        border: "1px solid rgba(74,222,128,0.15)",
                        color: "#4ade80",
                      }}
                      onClick={() => { handleClose(); navigate("/profile/referral"); }}
                    >
                      <GitBranch className="h-3 w-3" />
                      {t("profile.inviteFriends")}
                    </button>
                  )}
                </div>
              )}

              {allRequirementsMet && (
                <button
                  className="w-full rounded-2xl h-12 flex items-center justify-center gap-2 text-[14px] font-bold text-white transition-all active:scale-[0.97]"
                  style={{
                    background: "linear-gradient(135deg, #16a34a, #15803d)",
                    boxShadow: "0 4px 16px rgba(22,163,74,0.3)",
                  }}
                  onClick={handleRequirementNext}
                >
                  <Sparkles className="h-4 w-4" />
                  {t("common.next")}
                </button>
              )}
            </div>
          )}

          {!isMAX && step === "select_rank" && (
            <div className="space-y-3">
              <div
                className="rounded-2xl p-4 relative overflow-hidden"
                style={{ background: "#141414", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="rounded-xl p-3 text-center" style={{ background: "#1a1a1a" }}>
                    <div className="text-[10px] text-white/30 mb-0.5">{t("profile.contribution")}</div>
                    <div className="text-[15px] font-bold text-white">${plan.price}</div>
                  </div>
                  <div className="rounded-xl p-3 text-center" style={{ background: "#1a1a1a" }}>
                    <div className="text-[10px] text-white/30 mb-0.5">{t("profile.frozenFunds")}</div>
                    <div className="text-[15px] font-bold text-white">${plan.frozenAmount.toLocaleString()}</div>
                  </div>
                </div>
                <div className="rounded-xl p-3 space-y-1" style={{ background: "#1a1a1a" }}>
                  <div className="text-[10px] text-white/35 font-semibold uppercase tracking-wider mb-1">{t("profile.milestoneSchedule")}</div>
                  {NODE_MILESTONES.MINI.map((m, i) => (
                    <div key={i} className="flex items-center gap-2 py-0.5">
                      <div className="w-1 h-1 rounded-full bg-green-400/50" />
                      <span className="text-[10px] text-white/50">
                        {t("profile.dayN", { n: m.days })} → {m.rank}
                      </span>
                      <span className="text-[9px] text-white/25">({m.desc})</span>
                    </div>
                  ))}
                </div>
              </div>
              <button
                className="w-full rounded-2xl h-12 flex items-center justify-center gap-2 text-[14px] font-bold text-white transition-all active:scale-[0.97]"
                style={{
                  background: "linear-gradient(135deg, #374151, #4b5563)",
                  boxShadow: "0 4px 16px rgba(55,65,81,0.3)",
                }}
                onClick={handleMiniConfirm}
              >
                {t("common.next")}
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {step === "confirm_payment" && (
            <div className="space-y-3">
              <div
                className="rounded-2xl p-5 relative overflow-hidden"
                style={{
                  background: "linear-gradient(135deg, #0f1f15, #141414)",
                  border: "1px solid rgba(74,222,128,0.1)",
                }}
              >
                <div className="absolute inset-0 opacity-5" style={{ background: "radial-gradient(circle at 50% 0%, rgba(74,222,128,0.5), transparent 60%)" }} />
                <div className="relative">
                  <div className="text-center mb-4">
                    {isMAX && selectedRank && (
                      <div
                        className="w-16 h-16 rounded-2xl mx-auto mb-2 flex items-center justify-center text-[20px] font-black"
                        style={{
                          background: "linear-gradient(135deg, #166534, #15803d)",
                          boxShadow: "0 6px 24px rgba(22,101,52,0.35)",
                          color: "#bbf7d0",
                        }}
                      >
                        {selectedRank}
                      </div>
                    )}
                    <div className="text-[12px] text-white/40">
                      {isMAX ? t("profile.applyLargeNode") : t("profile.applySmallNode")}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between py-1.5">
                      <span className="text-[12px] text-white/40">{t("profile.contribution")}</span>
                      <span className="text-[13px] font-semibold text-white/80">${plan.price} USDC</span>
                    </div>
                    <div className="flex items-center justify-between py-1.5">
                      <span className="text-[12px] text-white/40">{t("profile.frozenFunds")}</span>
                      <span className="text-[13px] font-semibold text-white/60">${plan.frozenAmount.toLocaleString()} USDC</span>
                    </div>
                    <div className="h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
                    <div className="flex items-center justify-between py-1">
                      <span className="text-[13px] font-bold text-white/60">{t("profile.totalPayment")}</span>
                      <span className="text-[17px] font-black text-primary">${plan.price}</span>
                    </div>
                  </div>
                </div>
              </div>

              <button
                className="w-full rounded-2xl h-12 flex items-center justify-center gap-2 text-[14px] font-bold text-white transition-all active:scale-[0.97] disabled:opacity-50"
                style={{
                  background: purchaseMutation.isPending
                    ? "linear-gradient(135deg, #374151, #4b5563)"
                    : "linear-gradient(135deg, #16a34a, #15803d)",
                  boxShadow: purchaseMutation.isPending ? "none" : "0 4px 20px rgba(22,163,74,0.35)",
                }}
                onClick={handlePurchase}
                disabled={purchaseMutation.isPending}
              >
                {purchaseMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {getPaymentStatusLabel(payment.status) || t("common.processing")}
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4" />
                    {t("profile.confirmPurchase")}
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
