import { useState } from "react";
import { TransactionButton, useActiveAccount } from "thirdweb/react";
import { approve } from "thirdweb/extensions/erc20";
import { prepareContractCall, getContract, readContract } from "thirdweb";
import { useThirdwebClient } from "@/hooks/use-thirdweb";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import {
  BSC_CHAIN,
  MA_TOKEN_V4_ADDRESS,
  FLASH_SWAP_V4_ADDRESS,
  getFlashSwapV4Contract,
} from "@/lib/contracts-v4";

/**
 * V4 Flash Swap Component — MA → USDT at Oracle Price (No LP Pool)
 *
 * Flow:
 *   1. User approves MA to FlashSwap contract
 *   2. FlashSwap.swap(maAmount)
 *      → reads Oracle price
 *      → burns MA
 *      → sends USDT from reserve to user
 *   3. No slippage, no pool dependency
 */
export function FlashSwapV4() {
  const account = useActiveAccount();
  const { client } = useThirdwebClient();
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"input" | "approve" | "swap">("input");

  const amountNum = parseFloat(amount) || 0;
  const amountWei = BigInt(Math.floor(amountNum * 1e18));

  // Get quote from FlashSwap contract
  const { data: quote } = useQuery({
    queryKey: ["flash-swap-quote", amountNum],
    queryFn: async () => {
      if (!client || !FLASH_SWAP_V4_ADDRESS || amountNum <= 0) return null;
      const contract = getFlashSwapV4Contract(client);
      const result = await readContract({
        contract,
        method: "function quoteSwap(uint256 maAmount) view returns (uint256 usdtOut, uint256 fee, uint256 maPrice)",
        params: [amountWei],
      });
      return {
        usdtOut: Number(result[0]) / 1e18,
        fee: Number(result[1]) / 1e18,
        maPrice: Number(result[2]) / 1e6,
      };
    },
    enabled: amountNum > 0 && !!client && !!FLASH_SWAP_V4_ADDRESS,
    refetchInterval: 30000,
  });

  // Get MA balance
  const { data: maBalance } = useQuery({
    queryKey: ["ma-balance-v4", account?.address],
    queryFn: async () => {
      if (!client || !MA_TOKEN_V4_ADDRESS || !account) return 0;
      const contract = getContract({ client, chain: BSC_CHAIN, address: MA_TOKEN_V4_ADDRESS });
      const bal = await readContract({
        contract,
        method: "function balanceOf(address) view returns (uint256)",
        params: [account.address],
      });
      return Number(bal) / 1e18;
    },
    enabled: !!account && !!client && !!MA_TOKEN_V4_ADDRESS,
  });

  if (!account || !client || !FLASH_SWAP_V4_ADDRESS || !MA_TOKEN_V4_ADDRESS) return null;

  const maContract = getContract({ client, chain: BSC_CHAIN, address: MA_TOKEN_V4_ADDRESS });
  const isValid = amountNum > 0 && amountNum <= (maBalance || 0);

  return (
    <div className="space-y-4 p-4">
      <h3 className="text-lg font-bold">闪兑 MA → USDT</h3>
      <p className="text-xs text-white/40">Oracle 定价，无滑点，MA 销毁后获得 USDT</p>

      {/* Balance */}
      <div className="flex justify-between text-sm">
        <span className="text-white/50">MA 余额</span>
        <span className="font-bold">{(maBalance || 0).toFixed(2)} MA</span>
      </div>

      {/* Amount input */}
      <div className="relative">
        <input
          type="number"
          placeholder="输入 MA 数量"
          value={amount}
          onChange={(e) => { setAmount(e.target.value); setStep("input"); }}
          className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white pr-16"
        />
        <button
          onClick={() => setAmount(String(maBalance || 0))}
          className="absolute right-2 top-2 text-xs text-green-400 px-2 py-1 rounded bg-green-400/10"
        >
          全部
        </button>
      </div>

      {/* Quote */}
      {quote && amountNum > 0 && (
        <div className="p-3 rounded-xl bg-white/5 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-white/50">MA 单价</span>
            <span>${quote.maPrice.toFixed(6)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-white/50">手续费</span>
            <span>${quote.fee.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm font-bold">
            <span>获得 USDT</span>
            <span className="text-green-400">${quote.usdtOut.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Step 1: Approve MA to FlashSwap */}
      {step === "input" && isValid && (
        <TransactionButton
          transaction={() =>
            approve({
              contract: maContract,
              spender: FLASH_SWAP_V4_ADDRESS,
              amountWei,
            })
          }
          onTransactionConfirmed={() => {
            setStep("swap");
            toast({ title: "授权成功" });
          }}
          onError={(err) => toast({ title: "授权失败", description: err.message, variant: "destructive" })}
          style={{ width: "100%" }}
        >
          授权 {amountNum.toFixed(2)} MA
        </TransactionButton>
      )}

      {/* Step 2: Request Swap (burns MA, Engine fulfills with USDT via PancakeSwap) */}
      {step === "swap" && (
        <TransactionButton
          transaction={() =>
            prepareContractCall({
              contract: getFlashSwapV4Contract(client),
              method: "function requestSwap(uint256 maAmount) returns (uint256)",
              params: [amountWei],
              gas: BigInt(300000),
            })
          }
          onTransactionConfirmed={() => {
            setStep("input");
            setAmount("");
            toast({
              title: "闪兑请求已提交",
              description: `MA 已销毁，$${quote?.usdtOut.toFixed(2)} USDT 正在通过 PancakeSwap 处理中...`,
            });
            queryClient.invalidateQueries({ queryKey: ["ma-balance-v4"] });
          }}
          onError={(err) => {
            setStep("input");
            toast({ title: "闪兑失败", description: err.message, variant: "destructive" });
          }}
          style={{ width: "100%" }}
        >
          确认闪兑 → ${quote?.usdtOut.toFixed(2)} USDT
        </TransactionButton>
      )}
    </div>
  );
}
