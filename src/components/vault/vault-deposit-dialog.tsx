/**
 * Vault Deposit Dialog — Plan selection cards + USDT deposit via Gateway contract
 *
 * Flow:
 *   1. User selects staking plan (5d/45d/90d/180d visual cards)
 *   2. Enters USDT amount
 *   3. Preview: MA to mint, daily interest, total yield
 *   4. Approve USDT → Gateway.depositVault() on-chain
 *   5. Gateway swaps USDT→USDC, mints cUSD, deposits to Vault
 */

import { useState } from "react";
import { Lock, Sparkles, TrendingUp, Loader2, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useActiveAccount, useSendTransaction } from "thirdweb/react";
import { prepareContractCall, readContract, waitForReceipt } from "thirdweb";
import { approve } from "thirdweb/extensions/erc20";
import { useThirdwebClient } from "@/hooks/use-thirdweb";
import { getUsdtContract, getGatewayContract, GATEWAY_ADDRESS, BSC_CHAIN } from "@/lib/contracts";
import { useMaPrice } from "@/hooks/use-ma-price";
import { VAULT_PLANS } from "@/lib/data";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface VaultDepositDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PLAN_KEYS = Object.keys(VAULT_PLANS) as (keyof typeof VAULT_PLANS)[];

export function VaultDepositDialog({ open, onOpenChange }: VaultDepositDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const account = useActiveAccount();
  const { client } = useThirdwebClient();
  const { mutateAsync: sendTx } = useSendTransaction();
  const { price: maPrice, usdcToMA } = useMaPrice();

  const [selectedPlan, setSelectedPlan] = useState<keyof typeof VAULT_PLANS>("5_DAYS");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"select" | "approving" | "depositing" | "success">("select");

  const plan = VAULT_PLANS[selectedPlan];
  const usdtAmount = parseFloat(amount) || 0;
  const maToMint = usdtAmount / maPrice;
  const dailyInterestUsd = usdtAmount * plan.dailyRate;
  const dailyInterestMA = dailyInterestUsd / maPrice;
  const totalYieldMA = dailyInterestMA * plan.days;

  const handleDeposit = async () => {
    if (!account || !client || usdtAmount < (plan as any).minAmount) {
      toast({ title: "输入错误", description: `最低存入 $${plan.minAmount} USDT`, variant: "destructive" });
      return;
    }

    try {
      const usdt = getUsdtContract(client);
      const gateway = getGatewayContract(client);
      const amountWei = BigInt(Math.floor(usdtAmount * 1e18)); // BSC USDT = 18 decimals
      const minUsdcOut = BigInt(Math.floor(usdtAmount * 0.999 * 1e18)); // 0.1% slippage

      // Step 1: Approve USDT
      setStep("approving");
      const approveTx = approve({
        contract: usdt,
        spender: GATEWAY_ADDRESS,
        amount: usdtAmount,
      });
      const approveResult = await sendTx(approveTx);
      await waitForReceipt({ client: client!, chain: BSC_CHAIN, transactionHash: approveResult.transactionHash });

      // Step 2: Call Gateway.depositVault
      setStep("depositing");
      const depositTx = prepareContractCall({
        contract: gateway,
        method: "function depositVault(uint256 usdtAmount, uint256 planIndex, uint256 minUsdcOut, bytes bridgeOptions) payable",
        params: [amountWei, BigInt(plan.planIndex), minUsdcOut, "0x" as `0x${string}`],
      });
      const depositResult = await sendTx(depositTx);
      await waitForReceipt({ client: client!, chain: BSC_CHAIN, transactionHash: depositResult.transactionHash });

      setStep("success");
      toast({ title: "存入成功", description: `${usdtAmount} USDT → ${maToMint.toFixed(2)} MA 已锁仓 ${plan.days} 天` });

    } catch (e: any) {
      toast({ title: "存入失败", description: e.message || "交易被拒绝", variant: "destructive" });
      setStep("select");
    }
  };

  const resetAndClose = () => {
    setStep("select");
    setAmount("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            {t("vault.depositToVault")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            存入 USDT，铸造 MA 锁仓，每日产生利息
          </DialogDescription>
        </DialogHeader>

        {step === "success" ? (
          <div className="text-center py-6">
            <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-3">
              <Check className="h-7 w-7 text-green-400" />
            </div>
            <h3 className="text-lg font-bold text-green-400 mb-1">存入成功!</h3>
            <p className="text-xs text-foreground/40">
              {usdtAmount} USDT → {maToMint.toFixed(2)} MA 已锁仓 {plan.days} 天
            </p>
            <Button className="mt-4" onClick={resetAndClose}>完成</Button>
          </div>
        ) : (
          <>
            {/* Plan Selection Cards */}
            <div className="grid grid-cols-2 gap-2">
              {PLAN_KEYS.map((key) => {
                const p = VAULT_PLANS[key];
                const isSelected = selectedPlan === key;
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedPlan(key)}
                    className={cn(
                      "relative rounded-xl p-3 text-left transition-all",
                      isSelected
                        ? "bg-primary/10 border-2 border-primary/40 shadow-[0_0_15px_rgba(0,188,165,0.1)]"
                        : "bg-white/[0.02] border border-white/5 hover:border-white/15"
                    )}
                  >
                    {isSelected && (
                      <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                        <Check className="h-2.5 w-2.5 text-black" />
                      </div>
                    )}
                    <div className="text-[18px] font-bold text-foreground/80 mb-0.5">{p.days}天</div>
                    <div className="flex items-center gap-1 mb-1">
                      <TrendingUp className="h-3 w-3 text-green-400" />
                      <span className="text-[12px] font-semibold text-green-400">{(p.dailyRate * 100).toFixed(1)}%/日</span>
                    </div>
                    <div className="text-[10px] text-foreground/25">APR {p.apr}</div>
                  </button>
                );
              })}
            </div>

            {/* Amount Input */}
            <div>
              <label className="text-xs text-foreground/40 mb-1.5 block">存入金额 (USDT)</label>
              <Input
                type="number"
                placeholder={`最低 $${plan.minAmount}`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="text-lg font-mono"
                min={plan.minAmount}
              />
            </div>

            {/* Preview */}
            {usdtAmount > 0 && (
              <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3 space-y-2">
                <div className="flex justify-between text-[12px]">
                  <span className="text-foreground/40">MA 实时价格</span>
                  <span className="text-primary font-mono font-bold">${maPrice.toFixed(4)}</span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-foreground/40">按当前价铸造</span>
                  <span className="text-foreground/70 font-mono">{maToMint.toFixed(2)} MA</span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-foreground/40">每日利息 (USDT)</span>
                  <span className="text-foreground/70 font-mono">${dailyInterestUsd.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-foreground/40">按当前价折合</span>
                  <span className="text-green-400 font-mono">≈ {dailyInterestMA.toFixed(2)} MA/天</span>
                </div>
                <div className="flex justify-between text-[12px] pt-1 border-t border-white/5">
                  <span className="text-foreground/40">锁仓 {plan.days} 天预估总收益</span>
                  <span className="text-primary font-bold font-mono">
                    <Sparkles className="h-3 w-3 inline mr-0.5" />
                    ${(dailyInterestUsd * plan.days).toFixed(2)}
                  </span>
                </div>
                <p className="text-[9px] text-foreground/20 leading-relaxed">
                  实际每日产出 MA 数量 = 当日利息(USDT) ÷ MA实时价格，随价格波动
                </p>
              </div>
            )}

            <DialogFooter>
              {step !== "select" && (
                <div className="w-full flex items-center gap-2 text-xs text-foreground/40 mb-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>{step === "approving" ? "授权 USDT..." : "存入金库..."}</span>
                </div>
              )}
              <Button
                className="w-full bg-primary text-black font-bold"
                onClick={handleDeposit}
                disabled={step !== "select" || !account || usdtAmount < plan.minAmount}
              >
                {!account
                  ? "请先连接钱包"
                  : step !== "select"
                  ? "处理中..."
                  : `存入 ${usdtAmount > 0 ? "$" + usdtAmount.toFixed(0) : ""} USDT`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
