import { useState } from "react";
import { useActiveAccount, useSendTransaction } from "thirdweb/react";
import { prepareContractCall, getContract, waitForReceipt } from "thirdweb";
import { useThirdwebClient } from "@/hooks/use-thirdweb";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { BSC_CHAIN, USDT_ADDRESS, USDC_ADDRESS } from "@/lib/contracts";
import { useTranslation } from "react-i18next";

/**
 * V4 Node Purchase — User pays USDT → swap USDC → Server, Engine mints NFT + cUSD + MA
 *
 * Flow:
 *   1. Approve USDT → PancakeSwap Router
 *   2. Swap USDT → USDC → Receiver Server (0xe193)
 *   3. Frontend callback → POST /vault-bridge-v4 {type:"node"}
 *   4. Engine: VaultV4 position + NodeNFT mint + MAStaking lock
 */

const USDC_RECEIVER = "0xe193ACcf11aBf508e8c7D0CeE03ea4E6f75B09ff";
const PANCAKE_ROUTER = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";

const NODE_PLANS = {
  MAX: { label: "大节点", price: 600, frozen: 6000, rate: "0.9%", days: 120, daily: 54 },
  MINI: { label: "小节点", price: 100, frozen: 1000, rate: "0.9%", days: 90, daily: 9 },
};

export function NodePurchaseV4({ nodeType, onClose }: { nodeType: "MAX" | "MINI"; onClose?: () => void }) {
  const { t } = useTranslation();
  const account = useActiveAccount();
  const { client } = useThirdwebClient();
  const { toast } = useToast();
  const { mutateAsync: sendTx } = useSendTransaction({ payModal: { theme: "dark" } });
  const [isPending, setIsPending] = useState(false);

  const plan = NODE_PLANS[nodeType];

  const handlePurchase = async () => {
    if (!account || !client) return;
    setIsPending(true);

    try {
      const usdtC = getContract({ client, chain: BSC_CHAIN, address: USDT_ADDRESS });
      const amountWei = BigInt(Math.floor(plan.price * 1e18));
      const minOut = amountWei * BigInt(995) / BigInt(1000);

      // Step 1: Approve USDT → PancakeSwap Router
      const { readContract: rc } = await import("thirdweb");
      const usdtAllowance = BigInt((await rc({ contract: usdtC, method: "function allowance(address,address) view returns (uint256)", params: [account.address, PANCAKE_ROUTER] })).toString());
      if (usdtAllowance < amountWei) {
        if (usdtAllowance > BigInt(0)) {
          const resetTx = prepareContractCall({ contract: usdtC, method: "function approve(address spender, uint256 amount) returns (bool)", params: [PANCAKE_ROUTER, BigInt(0)] });
          const resetResult = await sendTx(resetTx);
          await waitForReceipt({ client, chain: BSC_CHAIN, transactionHash: resetResult.transactionHash });
        }
        const approveTx = prepareContractCall({ contract: usdtC, method: "function approve(address spender, uint256 amount) returns (bool)", params: [PANCAKE_ROUTER, amountWei] });
        const approveResult = await sendTx(approveTx);
        await waitForReceipt({ client, chain: BSC_CHAIN, transactionHash: approveResult.transactionHash });
      }

      // Step 2: Swap USDT → USDC → Server
      const router = getContract({ client, chain: BSC_CHAIN, address: PANCAKE_ROUTER });
      const swapTx = prepareContractCall({
        contract: router,
        method: "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)",
        params: [{
          tokenIn: USDT_ADDRESS, tokenOut: USDC_ADDRESS, fee: 100,
          recipient: USDC_RECEIVER, amountIn: amountWei,
          amountOutMinimum: minOut, sqrtPriceLimitX96: BigInt(0),
        }],
        gas: BigInt(300000),
      });
      const result = await sendTx(swapTx);
      const receipt = await waitForReceipt({ client, chain: BSC_CHAIN, transactionHash: result.transactionHash });

      if (receipt.status === "reverted") throw new Error("Swap failed");

      // Step 2: Trigger Engine to mint NFT + cUSD + MA
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/vault-bridge-v4`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: account.address,
          amount: plan.price,
          type: "node",
          nodeType,
          txHash: receipt.transactionHash,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      toast({
        title: t("node.purchased", "购买成功"),
        description: `${plan.label} NFT 已铸造，${plan.frozen}U cUSD 配资已锁仓`,
      });
      queryClient.invalidateQueries({ queryKey: ["node-memberships"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      onClose?.();

    } catch (err: any) {
      toast({ title: t("node.failed", "购买失败"), description: err.message, variant: "destructive" });
    } finally {
      setIsPending(false);
    }
  };

  if (!account || !client) return null;

  return (
    <div className="space-y-4 p-4">
      <h3 className="text-lg font-bold">{t("node.buy", "购买")}{plan.label}</h3>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="p-3 rounded-xl bg-white/5">
          <div className="text-xs text-white/40">{t("node.contribution", "贡献金额")}</div>
          <div className="text-lg font-bold">${plan.price}</div>
        </div>
        <div className="p-3 rounded-xl bg-white/5">
          <div className="text-xs text-white/40">{t("node.total", "节点总额")}</div>
          <div className="text-lg font-bold">${plan.frozen.toLocaleString()}</div>
        </div>
        <div className="p-3 rounded-xl bg-white/5">
          <div className="text-xs text-white/40">{t("node.dailyRate", "日利率")}</div>
          <div className="text-lg font-bold text-green-400">{plan.rate}</div>
        </div>
      </div>

      <div className="p-3 rounded-xl bg-white/5 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-white/50">{t("node.daily", "每日收益")}</span>
          <span>${plan.daily}/日 → 铸造 MA</span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/50">{t("node.period", "周期")}</span>
          <span>{plan.days} {t("common.days", "天")}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/50">{t("node.leverage", "配资倍数")}</span>
          <span>10×</span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/50">{t("node.nft", "节点 NFT")}</span>
          <span className="text-green-400">Soulbound (不可转让)</span>
        </div>
      </div>

      <button
        className="w-full p-3 rounded-xl bg-green-500 text-white font-bold disabled:opacity-40"
        disabled={isPending}
        onClick={handlePurchase}
      >
        {isPending ? t("common.processing", "处理中...") : `${t("node.confirm", "确认购买")} $${plan.price} USDT`}
      </button>
    </div>
  );
}
