import { useState, useCallback } from "react";
import { useActiveAccount, useSendTransaction } from "thirdweb/react";
import { approve, transfer } from "thirdweb/extensions/erc20";
import { prepareContractCall, waitForReceipt } from "thirdweb";
import { useThirdwebClient } from "./use-thirdweb";
import {
  getUsdcContract,
  getVaultContract,
  getNodeContract,
  usdToUsdcUnits,
  VAULT_CONTRACT_ADDRESS,
  NODE_CONTRACT_ADDRESS,
  VIP_RECEIVER_ADDRESS,
  VAULT_ABI,
  NODE_ABI,
  BASE_CHAIN,
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
   * @param spenderAddress - Address to approve USDC to
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
        const usdcContract = getUsdcContract(client);

        // Step 1: Approve USDC spend
        const approveTx = approve({
          contract: usdcContract,
          spender: spenderAddress,
          amount: amountUsd,
        });
        const approveResult = await sendTransaction(approveTx);
        await waitForReceipt({
          client,
          chain: BASE_CHAIN,
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
          chain: BASE_CHAIN,
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
      const amount = usdToUsdcUnits(amountUsd);
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

  // ── Node purchase ──
  const payNodePurchase = useCallback(
    async (nodeType: string, paymentMode: string = "FULL"): Promise<string> => {
      if (!NODE_CONTRACT_ADDRESS) throw new Error("Node contract not configured");
      if (!client) throw new Error("Thirdweb client not ready");
      const contributions: Record<string, number> = { MINI: 100, MAX: 600 };
      const frozenAmounts: Record<string, number> = { MINI: 1000, MAX: 6000 };
      const contribution = contributions[nodeType] || 0;
      const frozen = frozenAmounts[nodeType] || 0;
      const amountUsd = contribution + frozen;
      return _executePayment(NODE_CONTRACT_ADDRESS, amountUsd, () =>
        prepareContractCall({
          contract: getNodeContract(client),
          method: NODE_ABI[0],
          params: [nodeType],
        }),
      );
    },
    [client, _executePayment],
  );

  // ── VIP subscribe (x402 direct USDC transfer) ──
  const payVIPSubscribe = useCallback(
    async (planKey: keyof typeof VIP_PLANS): Promise<string> => {
      if (!VIP_RECEIVER_ADDRESS) throw new Error("VIP receiver address not configured");
      if (!client) throw new Error("Thirdweb client not ready");
      if (!account) throw new Error("Wallet not connected");

      const plan = VIP_PLANS[planKey];
      if (!plan) throw new Error("Invalid VIP plan");

      setStatus("paying");
      setError(null);
      setTxHash(null);

      try {
        const usdcContract = getUsdcContract(client);
        const tx = transfer({
          contract: usdcContract,
          to: VIP_RECEIVER_ADDRESS,
          amount: plan.price,
        });
        const payResult = await sendTransaction(tx);

        setStatus("confirming");
        const receipt = await waitForReceipt({
          client,
          chain: BASE_CHAIN,
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

  return {
    payVaultDeposit,
    payNodePurchase,
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
    case "approving":  return "Approving USDC...";
    case "paying":     return "Sending payment...";
    case "confirming": return "Confirming on-chain...";
    case "recording":  return "Recording to database...";
    case "success":    return "Payment confirmed";
    case "error":      return "Payment failed";
    default:           return "";
  }
}
