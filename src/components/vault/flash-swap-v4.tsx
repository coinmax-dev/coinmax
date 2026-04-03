import { useState } from "react";
import { TransactionButton, useActiveAccount } from "thirdweb/react";
import { approve } from "thirdweb/extensions/erc20";
import { prepareContractCall, getContract, readContract } from "thirdweb";
import { useThirdwebClient } from "@/hooks/use-thirdweb";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { BSC_CHAIN, MA_TOKEN_ADDRESS, FLASH_SWAP_ADDRESS } from "@/lib/contracts";
import { useTranslation } from "react-i18next";

/**
 * V4 Flash Swap — MA → USDT via Server PancakeSwap
 *
 * Step 1: User approve MA → FlashSwap
 * Step 2: User calls FlashSwapV4.requestSwap(maAmount)
 *         → MA burned, SwapRequested event
 * Step 3: Server listens → USDC swap → USDT → user (auto)
 */
export function FlashSwapV4() {
  const { t } = useTranslation();
  const account = useActiveAccount();
  const { client } = useThirdwebClient();
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"input" | "approve" | "swap">("input");

  const amountNum = parseFloat(amount) || 0;
  const amountWei = BigInt(Math.floor(amountNum * 1e18));

  const flashContract = client && FLASH_SWAP_ADDRESS
    ? getContract({ client, chain: BSC_CHAIN, address: FLASH_SWAP_ADDRESS })
    : null;
  const maContract = client && MA_TOKEN_ADDRESS
    ? getContract({ client, chain: BSC_CHAIN, address: MA_TOKEN_ADDRESS })
    : null;

  // Quote
  const { data: quote } = useQuery({
    queryKey: ["flash-swap-quote", amountNum],
    queryFn: async () => {
      if (!flashContract || amountNum <= 0) return null;
      const result = await readContract({
        contract: flashContract,
        method: "function quoteSwap(uint256 maAmount) view returns (uint256 usdtOut, uint256 fee, uint256 maPrice)",
        params: [amountWei],
      });
      return {
        usdtOut: Number(result[0]) / 1e18,
        fee: Number(result[1]) / 1e18,
        maPrice: Number(result[2]) / 1e6,
      };
    },
    enabled: amountNum > 0 && !!flashContract,
    refetchInterval: 30000,
  });

  // MA balance
  const { data: maBalance } = useQuery({
    queryKey: ["ma-balance", account?.address],
    queryFn: async () => {
      if (!maContract || !account) return 0;
      const bal = await readContract({
        contract: maContract,
        method: "function balanceOf(address) view returns (uint256)",
        params: [account.address],
      });
      return Number(bal) / 1e18;
    },
    enabled: !!account && !!maContract,
  });

  if (!account || !client || !FLASH_SWAP_ADDRESS || !MA_TOKEN_ADDRESS) return null;

  const isValid = amountNum > 0 && amountNum <= (maBalance || 0);

  return (
    <div className="space-y-4 p-4">
      <h3 className="text-lg font-bold">{t("flashSwap.title", "闪兑 MA → USDT")}</h3>
      <p className="text-xs text-white/40">{t("flashSwap.desc", "Oracle 定价，MA 销毁后通过 PancakeSwap 获得 USDT")}</p>

      <div className="flex justify-between text-sm">
        <span className="text-white/50">MA {t("common.balance", "余额")}</span>
        <span className="font-bold">{(maBalance || 0).toFixed(2)} MA</span>
      </div>

      <div className="relative">
        <input
          type="number"
          placeholder={t("flashSwap.inputPlaceholder", "输入 MA 数量")}
          value={amount}
          onChange={(e) => { setAmount(e.target.value); setStep("input"); }}
          className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white pr-16"
        />
        <button
          onClick={() => setAmount(String(maBalance || 0))}
          className="absolute right-2 top-2 text-xs text-green-400 px-2 py-1 rounded bg-green-400/10"
        >
          {t("common.max", "全部")}
        </button>
      </div>

      {quote && amountNum > 0 && (
        <div className="p-3 rounded-xl bg-white/5 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-white/50">MA {t("flashSwap.price", "单价")}</span>
            <span>${quote.maPrice.toFixed(4)}</span>
          </div>
          {quote.fee > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-white/50">{t("flashSwap.fee", "手续费")}</span>
              <span>${quote.fee.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-bold">
            <span>{t("flashSwap.receive", "获得 USDT")}</span>
            <span className="text-green-400">${quote.usdtOut.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Step 1: Approve MA */}
      {step === "input" && isValid && (
        <TransactionButton
          transaction={() =>
            approve({
              contract: maContract!,
              spender: FLASH_SWAP_ADDRESS,
              amountWei,
            })
          }
          onTransactionConfirmed={() => {
            setStep("swap");
            toast({ title: t("common.approved", "授权成功") });
          }}
          onError={(err) => toast({ title: t("common.error", "授权失败"), description: err.message, variant: "destructive" })}
          style={{ width: "100%" }}
        >
          {t("flashSwap.approve", "授权")} {amountNum.toFixed(2)} MA
        </TransactionButton>
      )}

      {/* Step 2: Request Swap (burn MA, Server fulfills with USDT) */}
      {step === "swap" && (
        <TransactionButton
          transaction={() =>
            prepareContractCall({
              contract: flashContract!,
              method: "function requestSwap(uint256 maAmount) returns (uint256)",
              params: [amountWei],
              gas: BigInt(500000),
            })
          }
          onTransactionConfirmed={() => {
            setStep("input");
            setAmount("");
            toast({
              title: t("flashSwap.submitted", "闪兑请求已提交"),
              description: t("flashSwap.processing", "MA 已销毁，USDT 正在处理中..."),
            });
          }}
          onError={(err) => {
            setStep("input");
            toast({ title: t("flashSwap.failed", "闪兑失败"), description: err.message, variant: "destructive" });
          }}
          style={{ width: "100%" }}
        >
          {t("flashSwap.confirm", "确认闪兑")} → ${quote?.usdtOut.toFixed(2)} USDT
        </TransactionButton>
      )}
    </div>
  );
}
