import { useState, useCallback } from "react";
import { useActiveAccount, useSendTransaction } from "thirdweb/react";
import { approve, transfer } from "thirdweb/extensions/erc20";
import { prepareContractCall, waitForReceipt } from "thirdweb";
import { useThirdwebClient } from "./use-thirdweb";
import {
  getUsdtContract,
  getVaultContract,
  getNodeContract,
  getSwapRouterContract,
  usdToUsdtUnits,
  VAULT_CONTRACT_ADDRESS,
  NODE_CONTRACT_ADDRESS,
  SWAP_ROUTER_ADDRESS,
  VAULT_ABI,
  NODE_ABI,
  SWAP_ROUTER_ABI,
  BSC_CHAIN,
  USDT_ADDRESS,
} from "@/lib/contracts";
import { VIP_PLANS } from "@/lib/data";

export type PaymentStatus =
  | "idle"
  | "approving"
  | "paying"
  | "confirming"
  | "recording"
  | "success"
  | "error";

export function usePayment() {
  const [status, setStatus] = useState<PaymentStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const account = useActiveAccount();
  const { client } = useThirdwebClient();
  const { mutateAsync: sendTransaction } = useSendTransaction();

  const reset = useCallback(() => {
    setStatus("idle");
    setTxHash(null);
    setError(null);
  }, []);

  const markSuccess = useCallback(() => {
    setStatus("success");
  }, []);

  /**
   * Shared approve + call + confirm flow.
   * @param contractAddress - The payment contract to call
   * @param spenderAddress - Address to approve USDT to
   * @param amountUsd - USD amount for approval
   * @param prepareTx - Function that prepares the contract call transaction
   */
  const _executePayment = useCallback(
    async (
      spenderAddress: string,
      amountUsd: number,
      prepareTx: () => ReturnType<typeof prepareContractCall>,
    ): Promise<string> => {
      if (!account) throw new Error("Wallet not connected");
      if (!client) throw new Error("Thirdweb client not ready");

      setStatus("approving");
      setError(null);
      setTxHash(null);

      try {
        const usdtContract = getUsdtContract(client);

        // Step 1: Approve USDT spend
        const approveTx = approve({
          contract: usdtContract,
          spender: spenderAddress,
          amount: amountUsd,
        });
        const approveResult = await sendTransaction(approveTx);
        await waitForReceipt({
          client,
          chain: BSC_CHAIN,
          transactionHash: approveResult.transactionHash,
        });

        // Step 2: Execute contract call
        setStatus("paying");
        const tx = prepareTx();
        const payResult = await sendTransaction(tx);

        // Step 3: Wait for on-chain confirmation
        setStatus("confirming");
        const receipt = await waitForReceipt({
          client,
          chain: BSC_CHAIN,
          transactionHash: payResult.transactionHash,
        });

        if (receipt.status === "reverted") {
          throw new Error("Transaction reverted");
        }

        const confirmedHash = receipt.transactionHash;
        setTxHash(confirmedHash);
        setStatus("recording");
        return confirmedHash;
      } catch (err: any) {
        const message = err?.message || "Payment failed";
        setError(message);
        setStatus("error");
        throw err;
      }
    },
    [account, client, sendTransaction],
  );

  // ── Vault deposit ──
  const payVaultDeposit = useCallback(
    async (amountUsd: number, planType: string): Promise<string> => {
      if (!VAULT_CONTRACT_ADDRESS) throw new Error("Vault contract not configured");
      if (!client) throw new Error("Thirdweb client not ready");
      const amount = usdToUsdtUnits(amountUsd);
      return _executePayment(VAULT_CONTRACT_ADDRESS, amountUsd, () =>
        prepareContractCall({
          contract: getVaultContract(client),
          method: VAULT_ABI[0],
          params: [amount, planType],
        }),
      );
    },
    [client, _executePayment],
  );

  // ── Node purchase (V1 — direct USDT to Node contract) ──
  const payNodePurchase = useCallback(
    async (nodeType: string, paymentMode: string = "FULL"): Promise<string> => {
      if (!NODE_CONTRACT_ADDRESS) throw new Error("Node contract not configured");
      if (!client) throw new Error("Thirdweb client not ready");
      const contributions: Record<string, number> = { MINI: 100, MAX: 600 };
      const amountUsd = contributions[nodeType] || 0;
      return _executePayment(NODE_CONTRACT_ADDRESS, amountUsd, () =>
        prepareContractCall({
          contract: getNodeContract(client),
          method: NODE_ABI[0],
          params: [nodeType, USDT_ADDRESS],
        }),
      );
    },
    [client, _executePayment],
  );

  // ── Node purchase V2 (USDT → SwapRouter → PancakeSwap V3 → USDC → NodesV2) ──
  const payNodePurchaseV2 = useCallback(
    async (nodeType: string): Promise<string> => {
      if (!SWAP_ROUTER_ADDRESS) throw new Error("SwapRouter not configured");
      if (!client) throw new Error("Thirdweb client not ready");

      const contributions: Record<string, number> = { MINI: 100, MAX: 600 };
      const amountUsd = contributions[nodeType] || 0;
      if (!amountUsd) throw new Error("Invalid node type");

      const usdtAmount = usdToUsdtUnits(amountUsd);
      // minUsdcOut = 99.9% of input (0.1% slippage for stablecoin pair)
      const minUsdcOut = usdtAmount * BigInt(999) / BigInt(1000);

      // Approve USDT to SwapRouter, then SwapRouter handles the rest
      return _executePayment(SWAP_ROUTER_ADDRESS, amountUsd, () =>
        prepareContractCall({
          contract: getSwapRouterContract(client),
          method: SWAP_ROUTER_ABI[0], // swapAndPurchaseNode
          params: [usdtAmount, nodeType, minUsdcOut],
        }),
      );
    },
    [client, _executePayment],
  );

  // ── VIP subscribe (cross-chain: BSC USDT → Arb USDC via thirdweb Bridge) ──
  const payVIPSubscribe = useCallback(
    async (planKey: keyof typeof VIP_PLANS): Promise<{ txHash?: string; profile?: any }> => {
      if (!client) throw new Error("Thirdweb client not ready");
      if (!account) throw new Error("Wallet not connected");

      const plan = VIP_PLANS[planKey];
      if (!plan) throw new Error("Invalid VIP plan");

      const receiverAddress = import.meta.env.VITE_VIP_RECEIVER_ADDRESS;
      if (!receiverAddress) throw new Error("VIP receiver address not configured");

      setStatus("paying");
      setError(null);
      setTxHash(null);

      try {
        const { Bridge } = await import("thirdweb/bridge");
        const { defineChain } = await import("thirdweb/chains");

        // Cross-chain: BSC USDT → Arb USDC
        const quote = await Bridge.Transfer.prepare({
          client,
          originChainId: 56,
          originTokenAddress: USDT_ADDRESS,
          destinationChainId: 42161,
          destinationTokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
          amount: BigInt(plan.price) * BigInt(10n ** 6n), // USDC 6 decimals dest
          sender: account.address,
          receiver: receiverAddress,
        });

        // Execute all transactions from the quote
        let lastTxHash = "";
        for (const step of quote.steps) {
          for (const preparedTx of step.transactions) {
            setStatus("approving");
            const result = await sendTransaction(preparedTx as any);

            setStatus("confirming");
            const txChain = defineChain((preparedTx as any).chainId || 56);
            const receipt = await waitForReceipt({
              client,
              chain: txChain,
              transactionHash: result.transactionHash,
            });

            if (receipt.status === "reverted") throw new Error("Transaction reverted");
            lastTxHash = receipt.transactionHash;
          }
        }

        setTxHash(lastTxHash);

        // Activate VIP via edge function
        setStatus("recording");
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const resp = await fetch(`${supabaseUrl}/functions/v1/vip-subscribe`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-payment": JSON.stringify({ txHash: lastTxHash, settled: true }),
          },
          body: JSON.stringify({ planKey, walletAddress: account.address }),
        });

        const result = await resp.json();
        if (!resp.ok) throw new Error(result.error || "VIP activation failed");

        return { txHash: lastTxHash, profile: result.profile };
      } catch (err: any) {
        const message = err?.message || "Payment failed";
        setError(message);
        setStatus("error");
        throw err;
      }
    },
    [account, client, sendTransaction],
  );

  return {
    payVaultDeposit,
    payNodePurchase,
    payNodePurchaseV2,
    payVIPSubscribe,
    status,
    txHash,
    error,
    reset,
    markSuccess,
  };
}

/** Status label helper for UI */
export function getPaymentStatusLabel(status: PaymentStatus): string {
  switch (status) {
    case "approving":  return "Approving USDT...";
    case "paying":     return "Sending payment...";
    case "confirming": return "Confirming on-chain...";
    case "recording":  return "Recording to database...";
    case "success":    return "Payment confirmed";
    case "error":      return "Payment failed";
    default:           return "";
  }
}
