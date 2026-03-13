import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Zap, ShieldCheck } from "lucide-react";
import { NODE_PLANS } from "@/lib/data";
import { usePayment, getPaymentStatusLabel } from "@/hooks/use-payment";
import { purchaseNode } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { NODE_CONTRACT_ADDRESS, SWAP_ROUTER_ADDRESS } from "@/lib/contracts";
import { useTranslation } from "react-i18next";

interface NodePurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeType: "MAX" | "MINI";
  walletAddr: string;
  authCode?: string;
}

export function NodePurchaseDialog({ open, onOpenChange, nodeType, walletAddr, authCode }: NodePurchaseDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const payment = usePayment();

  const plan = NODE_PLANS[nodeType];
  const isMAX = nodeType === "MAX";
  const dailyRate = isMAX ? "0.9%" : "0.9%";

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      let txHash: string | undefined;
      if (SWAP_ROUTER_ADDRESS) {
        // V2: USDT → PancakeSwap V3 → USDC → NodesV2
        txHash = await payment.payNodePurchaseV2(nodeType);
      } else if (NODE_CONTRACT_ADDRESS) {
        // V1 fallback: direct USDT → Node contract
        txHash = await payment.payNodePurchase(nodeType, "FULL");
      }
      const result = await purchaseNode(walletAddr, nodeType, txHash, "FULL", isMAX ? authCode : undefined);
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
      queryClient.invalidateQueries({ queryKey: ["node-memberships", walletAddr] });
      queryClient.invalidateQueries({ queryKey: ["node-earnings", walletAddr] });
      payment.reset();
      onOpenChange(false);
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
        <DialogTitle className="sr-only">{isMAX ? t("profile.applyLargeNode") : t("profile.applySmallNode")}</DialogTitle>
        <DialogDescription className="sr-only">{t("profile.confirmPaymentDesc")}</DialogDescription>

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
                  {isMAX ? <Zap className="h-4 w-4 text-white" /> : <ShieldCheck className="h-4 w-4 text-white" />}
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

          <button
            className="w-full rounded-2xl h-12 flex items-center justify-center gap-2 text-[14px] font-bold text-white transition-all active:translate-y-[1px] active:shadow-none disabled:opacity-50 disabled:active:translate-y-0"
            style={{
              background: purchaseMutation.isPending
                ? "linear-gradient(180deg, #4b5563 0%, #374151 100%)"
                : "linear-gradient(180deg, #22c55e 0%, #16a34a 50%, #15803d 100%)",
              boxShadow: purchaseMutation.isPending
                ? "0 2px 0 #1f2937, 0 4px 8px rgba(0,0,0,0.3)"
                : "0 4px 0 #166534, 0 6px 20px rgba(34,197,94,0.35), inset 0 1px 0 rgba(255,255,255,0.2)",
              borderTop: purchaseMutation.isPending ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(255,255,255,0.15)",
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
      </DialogContent>
    </Dialog>
  );
}
