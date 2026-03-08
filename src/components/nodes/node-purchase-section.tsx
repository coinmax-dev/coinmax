import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { Loader2, Zap, ShieldCheck, KeyRound } from "lucide-react";
import { NODE_PLANS } from "@/lib/data";
import { usePayment, getPaymentStatusLabel } from "@/hooks/use-payment";
import { purchaseNode, validateAuthCode } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { NODE_CONTRACT_ADDRESS } from "@/lib/contracts";
import { useTranslation } from "react-i18next";

interface NodePurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeType: "MAX" | "MINI";
  walletAddr: string;
}

export function NodePurchaseDialog({ open, onOpenChange, nodeType, walletAddr }: NodePurchaseDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const payment = usePayment();

  const [authCode, setAuthCode] = useState("");
  const [authCodeError, setAuthCodeError] = useState("");
  const [authCodeValid, setAuthCodeValid] = useState(false);
  const [validatingCode, setValidatingCode] = useState(false);

  const plan = NODE_PLANS[nodeType];
  const isMAX = nodeType === "MAX";
  const dailyRate = isMAX ? "0.9%" : "0.5%";

  const handleAuthCodeBlur = async () => {
    if (!isMAX || !authCode.trim()) {
      setAuthCodeError("");
      setAuthCodeValid(false);
      return;
    }
    setValidatingCode(true);
    setAuthCodeError("");
    try {
      const valid = await validateAuthCode(authCode.trim());
      setAuthCodeValid(valid);
      if (!valid) setAuthCodeError(t("profile.authCodeInvalid"));
    } catch {
      setAuthCodeError(t("profile.authCodeInvalid"));
      setAuthCodeValid(false);
    } finally {
      setValidatingCode(false);
    }
  };

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (isMAX && !authCodeValid) throw new Error(t("profile.authCodeRequired"));
      let txHash: string | undefined;
      if (NODE_CONTRACT_ADDRESS) {
        txHash = await payment.payNodePurchase(nodeType, "FULL");
      }
      const result = await purchaseNode(walletAddr, nodeType, txHash, "FULL", isMAX ? authCode.trim() : undefined);
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
    setAuthCode("");
    setAuthCodeError("");
    setAuthCodeValid(false);
    onOpenChange(false);
  };

  const handlePurchase = () => {
    purchaseMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-[380px] p-0 overflow-hidden gap-0"
        style={{
          background: "#1a1a1a",
          border: "1px solid rgba(255,255,255,0.45)",
          borderRadius: 24,
          boxShadow: "0 25px 60px rgba(0,0,0,0.7), 0 0 40px rgba(74,222,128,0.1)",
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
          className="relative overflow-hidden px-5 pt-6 pb-4"
          style={{
            background: "linear-gradient(160deg, #142a1c 0%, #1a2f20 40%, #1a1a1a 100%)",
          }}
        >
          <div
            className="absolute top-0 right-0 w-36 h-36 opacity-25"
            style={{
              background: "radial-gradient(circle, rgba(74,222,128,0.5) 0%, transparent 70%)",
              filter: "blur(25px)",
            }}
          />
          <div
            className="absolute bottom-0 left-0 w-24 h-24 opacity-15"
            style={{
              background: "radial-gradient(circle, rgba(34,197,94,0.4) 0%, transparent 70%)",
              filter: "blur(20px)",
            }}
          />

          <div className="relative flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{
                    background: "linear-gradient(135deg, #22c55e, #16a34a)",
                    boxShadow: "0 4px 12px rgba(34,197,94,0.4)",
                  }}
                >
                  {isMAX ? <Zap className="h-4.5 w-4.5 text-white" /> : <ShieldCheck className="h-4.5 w-4.5 text-white" />}
                </div>
                <div>
                  <h2 className="text-[17px] font-bold text-white tracking-tight">
                    {isMAX ? t("profile.applyLargeNode") : t("profile.applySmallNode")}
                  </h2>
                  <p className="text-[11px] text-white/40 mt-0.5">{t("profile.confirmPaymentDesc")}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 pb-5 pt-4 flex-1 node-dialog-scroll" style={{ minHeight: 0, overflowY: "auto" }}>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="rounded-xl p-3 text-center" style={{ background: "#222", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="text-[11px] text-white/40 mb-1 font-medium">{t("profile.contribution")}</div>
              <div className="text-[15px] font-bold text-white">${plan.price}</div>
            </div>
            <div className="rounded-xl p-3 text-center" style={{ background: "#222", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="text-[11px] text-white/40 mb-1 font-medium">{t("profile.nodeTotal")}</div>
              <div className="text-[15px] font-bold text-white">${plan.frozenAmount.toLocaleString()}</div>
            </div>
            <div className="rounded-xl p-3 text-center" style={{ background: "#222", border: "1px solid rgba(74,222,128,0.12)" }}>
              <div className="text-[11px] text-white/40 mb-1 font-medium">{t("profile.dailyRelease")}</div>
              <div className="text-[15px] font-bold text-green-400">{dailyRate}</div>
            </div>
          </div>

          {/* Benefits */}
          <div
            className="rounded-xl p-3.5 mb-4 space-y-2"
            style={{ background: "rgba(74,222,128,0.04)", border: "1px solid rgba(74,222,128,0.12)" }}
          >
            <div className="text-[12px] font-bold text-white/60 mb-2">{t("profile.nodeBenefitsTitle", { type: isMAX ? t("profile.applyLargeNode") : t("profile.applySmallNode") })}</div>
            {(isMAX ? [
              t("profile.maxBenefit1"),
              t("profile.maxBenefit2"),
              t("profile.maxBenefit3"),
            ] : [
              t("profile.miniBenefit1"),
              t("profile.miniBenefit2"),
              t("profile.miniBenefit3"),
            ]).map((text, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 mt-px" style={{ background: "rgba(74,222,128,0.15)" }}>
                  <span className="text-[10px] font-bold text-green-400">{i + 1}</span>
                </div>
                <span className="text-[12px] text-white/70 leading-[18px]">{text}</span>
              </div>
            ))}
          </div>

          <div
            className="rounded-xl p-3.5 mb-4 flex items-center justify-between"
            style={{ background: "linear-gradient(135deg, rgba(34,197,94,0.08), rgba(34,197,94,0.03))", border: "1px solid rgba(74,222,128,0.15)" }}
          >
            <span className="text-[13px] font-bold text-white/70">{t("profile.totalPayment")}</span>
            <span className="text-[19px] font-black text-green-400">${plan.price} <span className="text-[11px] font-semibold text-white/40">USDT</span></span>
          </div>

          {isMAX && (
            <div className="mb-4">
              <div className="flex items-center gap-1.5 mb-2">
                <KeyRound className="h-3.5 w-3.5 text-amber-400/70" />
                <span className="text-[12px] font-bold text-white/60">{t("profile.authCodeLabel")}</span>
              </div>
              <input
                type="text"
                value={authCode}
                onChange={(e) => { setAuthCode(e.target.value); setAuthCodeError(""); setAuthCodeValid(false); }}
                onBlur={handleAuthCodeBlur}
                placeholder={t("profile.authCodePlaceholder")}
                className="w-full rounded-xl h-12 px-4 text-[15px] font-mono text-white placeholder:text-white/30 outline-none transition-all tracking-wider text-center"
                style={{
                  background: "linear-gradient(180deg, #2a2a2a 0%, #1e1e1e 100%)",
                  border: authCodeError ? "2px solid rgba(239,68,68,0.6)" : authCodeValid ? "2px solid rgba(74,222,128,0.6)" : "2px solid rgba(251,191,36,0.35)",
                  boxShadow: authCodeError ? "0 0 12px rgba(239,68,68,0.15), inset 0 2px 4px rgba(0,0,0,0.3)"
                    : authCodeValid ? "0 0 12px rgba(74,222,128,0.15), inset 0 2px 4px rgba(0,0,0,0.3)"
                    : "0 0 12px rgba(251,191,36,0.08), inset 0 2px 4px rgba(0,0,0,0.3)",
                }}
              />
              {validatingCode && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Loader2 className="h-3 w-3 animate-spin text-white/40" />
                  <span className="text-[11px] text-white/40">{t("common.loading")}</span>
                </div>
              )}
              {authCodeError && (
                <p className="text-[11px] text-red-400 mt-1.5">{authCodeError}</p>
              )}
              {authCodeValid && (
                <p className="text-[11px] text-green-400 mt-1.5">✓</p>
              )}
              {!authCode && !authCodeError && (
                <p className="text-[11px] text-amber-400/50 mt-1.5">{t("profile.authCodeRequired")}</p>
              )}
            </div>
          )}

          <button
            className="w-full rounded-2xl h-12 flex items-center justify-center gap-2 text-[14px] font-bold text-white transition-all active:translate-y-[1px] active:shadow-none disabled:opacity-50 disabled:active:translate-y-0"
            style={{
              background: purchaseMutation.isPending || (isMAX && !authCodeValid)
                ? "linear-gradient(180deg, #4b5563 0%, #374151 100%)"
                : "linear-gradient(180deg, #22c55e 0%, #16a34a 50%, #15803d 100%)",
              boxShadow: purchaseMutation.isPending || (isMAX && !authCodeValid)
                ? "0 2px 0 #1f2937, 0 4px 8px rgba(0,0,0,0.3)"
                : "0 4px 0 #166534, 0 6px 20px rgba(34,197,94,0.35), inset 0 1px 0 rgba(255,255,255,0.2)",
              borderTop: purchaseMutation.isPending || (isMAX && !authCodeValid) ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(255,255,255,0.15)",
            }}
            onClick={handlePurchase}
            disabled={purchaseMutation.isPending || (isMAX && !authCodeValid)}
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
      </DialogContent>
    </Dialog>
  );
}
