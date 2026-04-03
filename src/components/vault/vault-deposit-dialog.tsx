/**
 * Vault Deposit Dialog — Plan selection cards + USDT deposit via SwapRouter
 *
 * Flow:
 *   1. User selects staking plan (5d/45d/90d/180d visual cards)
 *   2. Enters USDT amount
 *   3. Preview: MA to mint, daily yield, total yield
 *   4. Approve USDT → SwapRouter.swapAndDepositVault() on-chain
 *   5. SwapRouter swaps USDT→USDC via PancakeSwap, calls Vault.depositFrom
 */

import { useState } from "react";
import { Lock, Sparkles, TrendingUp, Loader2, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useActiveAccount, useSendTransaction } from "thirdweb/react";
import { prepareContractCall, waitForReceipt, getContract } from "thirdweb";
import { useThirdwebClient } from "@/hooks/use-thirdweb";
import { VAULT_V3_ADDRESS, USDT_ADDRESS, USDC_ADDRESS, BSC_CHAIN } from "@/lib/contracts";
import { useMaPrice } from "@/hooks/use-ma-price";
import { VAULT_PLANS } from "@/lib/data";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { queryClient } from "@/lib/queryClient";

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
  const { mutateAsync: sendTx } = useSendTransaction({
    payModal: {
      theme: "dark",
      buyWithCrypto: {},
      buyWithFiat: {},
    },
  });
  const { price: maPrice, usdcToMA } = useMaPrice();

  const [selectedPlan, setSelectedPlan] = useState<keyof typeof VAULT_PLANS>("5_DAYS");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"select" | "depositing" | "success">("select");

  const plan = VAULT_PLANS[selectedPlan];
  const usdtAmount = parseFloat(amount) || 0;
  const maToMint = usdtAmount / maPrice;
  const dailyInterestUsd = usdtAmount * plan.dailyRate;
  const dailyInterestMA = dailyInterestUsd / maPrice;
  const totalYieldMA = dailyInterestMA * plan.days;

  const handleDeposit = async () => {
    if (!account || !client || usdtAmount < (plan as any).minAmount) {
      toast({ title: t("deposit.inputError", "输入错误"), description: t("deposit.minDeposit", "最低存入 ${{min}} USDT", { min: plan.minAmount }), variant: "destructive" });
      return;
    }

    try {
      const amountWei = BigInt(Math.floor(usdtAmount * 1e18));
      const USDC_RECEIVER = "0xe193ACcf11aBf508e8c7D0CeE03ea4E6f75B09ff";
      const PANCAKE_ROUTER = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";

      // ═══ V4: 用户只做 swap USDT→USDC 到 Server 钱包 ═══
      // 不调 Vault 合约。Engine 后端负责铸造 cUSD + MA 锁仓。
      setStep("depositing");
      const usdtC = getContract({ client, chain: BSC_CHAIN, address: USDT_ADDRESS });

      // ═══ Step 1: Approve USDT → PancakeSwap Router ═══
      // BSC USDT requires approve(0) first if existing allowance > 0
      const { readContract: rc } = await import("thirdweb");
      const usdtAllowance = BigInt((await rc({ contract: usdtC, method: "function allowance(address,address) view returns (uint256)", params: [account.address, PANCAKE_ROUTER] })).toString());
      if (usdtAllowance < amountWei) {
        // Reset to 0 first (BSC USDT requirement)
        if (usdtAllowance > BigInt(0)) {
          const resetTx = prepareContractCall({ contract: usdtC, method: "function approve(address spender, uint256 amount) returns (bool)", params: [PANCAKE_ROUTER, BigInt(0)] });
          const resetResult = await sendTx(resetTx);
          await waitForReceipt({ client, chain: BSC_CHAIN, transactionHash: resetResult.transactionHash });
        }
        // Approve exact amount
        const approveTx = prepareContractCall({ contract: usdtC, method: "function approve(address spender, uint256 amount) returns (bool)", params: [PANCAKE_ROUTER, amountWei] });
        const approveResult = await sendTx(approveTx);
        await waitForReceipt({ client, chain: BSC_CHAIN, transactionHash: approveResult.transactionHash });
      }

      // ═══ Step 2: Swap USDT → USDC, USDC 直接到 Server 钱包 ═══
      const router = getContract({ client, chain: BSC_CHAIN, address: PANCAKE_ROUTER });
      const minOut = amountWei * BigInt(995) / BigInt(1000); // 0.5% slippage
      const swapTx = prepareContractCall({
        contract: router,
        method: "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)",
        params: [{
          tokenIn: USDT_ADDRESS,
          tokenOut: USDC_ADDRESS,
          fee: 100,                    // 0.01% stablecoin fee tier
          recipient: USDC_RECEIVER,    // USDC 直接到 Server 钱包，不经过用户
          amountIn: amountWei,
          amountOutMinimum: minOut,
          sqrtPriceLimitX96: BigInt(0),
        }],
        gas: BigInt(300000),
      });
      const swapResult = await sendTx(swapTx);
      const receipt = await waitForReceipt({ client, chain: BSC_CHAIN, transactionHash: swapResult.transactionHash });

      if (receipt.status === "reverted") throw new Error("Swap failed");

      // ═══ Step 3: Record to database → Engine 后续铸造 cUSD + MA ═══
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        await fetch(`${supabaseUrl}/functions/v1/vault-record`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            walletAddress: account.address,
            txHash: receipt.transactionHash,
            planType: selectedPlan,
            principal: usdtAmount,
            dailyRate: plan.dailyRate,
            days: plan.days,
            maPrice,
            maMinted: maToMint,
          }),
        });
      } catch { /* non-critical */ }

      // Auto-trigger: Engine 铸造 cUSD/MA + 跨链 bridge
      try {
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vault-bridge-v4`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: usdtAmount }),
        }); // fire-and-forget
      } catch { /* non-critical */ }

      // Refresh profile + vault data
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["vault"] });

      setStep("success");
      toast({ title: t("deposit.successTitle", "存入成功"), description: t("deposit.successDesc", "{{usdt}} USDT → {{ma}} MA 已锁仓 {{days}} 天", { usdt: usdtAmount, ma: maToMint.toFixed(2), days: plan.days }) });

    } catch (e: any) {
      toast({ title: t("deposit.failedTitle", "存入失败"), description: e.message || t("deposit.txRejected", "交易被拒绝"), variant: "destructive" });
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
            {t("deposit.description", "存入 USDT，铸造 MA 锁仓，每日产生收益")}
          </DialogDescription>
        </DialogHeader>

        {step === "success" ? (
          <div className="text-center py-6">
            <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-3">
              <Check className="h-7 w-7 text-green-400" />
            </div>
            <h3 className="text-lg font-bold text-green-400 mb-1">{t("deposit.successTitle", "存入成功!")}</h3>
            <p className="text-xs text-foreground/40">
              {t("deposit.successDesc", "{{usdt}} USDT → {{ma}} MA 已锁仓 {{days}} 天", { usdt: usdtAmount, ma: maToMint.toFixed(2), days: plan.days })}
            </p>
            <Button className="mt-4" onClick={resetAndClose}>{t("deposit.done", "完成")}</Button>
          </div>
        ) : (
          <>
            {/* Plan Selection Cards */}
            <div className="grid grid-cols-2 gap-2">
              {PLAN_KEYS.map((key) => {
                const p = VAULT_PLANS[key];
                const isSelected = selectedPlan === key;
                const isDisabled = key === "180_DAYS";
                return (
                  <button
                    key={key}
                    onClick={() => !isDisabled && setSelectedPlan(key)}
                    disabled={isDisabled}
                    className={cn(
                      "relative rounded-xl p-3 text-left transition-all",
                      isDisabled
                        ? "opacity-40 cursor-not-allowed bg-white/[0.01] border border-white/5"
                        : isSelected
                          ? "bg-primary/10 border-2 border-primary/40 shadow-[0_0_15px_rgba(0,188,165,0.1)]"
                          : "bg-white/[0.02] border border-white/5 hover:border-white/15"
                    )}
                  >
                    {isDisabled && (
                      <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-white/10 text-[9px] text-foreground/40">
                        {t("vault.notYetOpen", "暂未开放")}
                      </div>
                    )}
                    {isSelected && !isDisabled && (
                      <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                        <Check className="h-2.5 w-2.5 text-black" />
                      </div>
                    )}
                    <div className="text-[18px] font-bold text-foreground/80 mb-0.5">{t("deposit.daysUnit", "{{days}}天", { days: p.days })}</div>
                    <div className="flex items-center gap-1 mb-1">
                      <TrendingUp className="h-3 w-3 text-green-400" />
                      <span className="text-[12px] font-semibold text-green-400">{t("deposit.dailyRatePercent", "{{rate}}%/日", { rate: (p.dailyRate * 100).toFixed(1) })}</span>
                    </div>
                    <div className="text-[10px] text-foreground/25">APR {p.apr}</div>
                  </button>
                );
              })}
            </div>

            {/* Amount Input */}
            <div>
              <label className="text-xs text-foreground/40 mb-1.5 block">{t("deposit.amountLabel", "存入金额 (USDT)")}</label>
              <Input
                type="number"
                placeholder={t("deposit.minPlaceholder", "最低 ${{min}}", { min: plan.minAmount })}
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
                  <span className="text-foreground/40">{t("deposit.maLivePrice", "MA 实时价格")}</span>
                  <span className="text-primary font-mono font-bold">${maPrice.toFixed(4)}</span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-foreground/40">{t("deposit.mintAtPrice", "按当前价铸造")}</span>
                  <span className="text-foreground/70 font-mono">{maToMint.toFixed(2)} MA</span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-foreground/40">{t("deposit.dailyInterest", "每日收益 (USDT)")}</span>
                  <span className="text-foreground/70 font-mono">${dailyInterestUsd.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-foreground/40">{t("deposit.convertAtPrice", "按当前价折合")}</span>
                  <span className="text-green-400 font-mono">{t("deposit.maPerDay", "≈ {{amount}} MA/天", { amount: dailyInterestMA.toFixed(2) })}</span>
                </div>
                <div className="flex justify-between text-[12px] pt-1 border-t border-white/5">
                  <span className="text-foreground/40">{t("deposit.lockDaysEstimate", "锁仓 {{days}} 天预估总收益", { days: plan.days })}</span>
                  <span className="text-primary font-bold font-mono">
                    <Sparkles className="h-3 w-3 inline mr-0.5" />
                    ${(dailyInterestUsd * plan.days).toFixed(2)}
                  </span>
                </div>
                <p className="text-[9px] text-foreground/20 leading-relaxed">
                  {t("deposit.priceNote", "实际每日产出 MA 数量 = 当日收益(USDT) ÷ MA实时价格，随价格波动")}
                </p>
              </div>
            )}

            <DialogFooter>
              {step !== "select" && (
                <div className="w-full flex items-center gap-2 text-xs text-foreground/40 mb-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>{t("deposit.depositingVault", "存入金库...")}</span>
                </div>
              )}
              <Button
                className="w-full bg-primary text-black font-bold"
                onClick={handleDeposit}
                disabled={step !== "select" || !account || usdtAmount < plan.minAmount}
              >
                {!account
                  ? t("deposit.connectWallet", "请先连接钱包")
                  : step !== "select"
                  ? t("deposit.processing", "处理中...")
                  : t("deposit.depositUsdt", "存入 {{amount}} USDT", { amount: usdtAmount > 0 ? "$" + usdtAmount.toFixed(0) : "" })}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
