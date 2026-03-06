import { getContract } from "thirdweb";
import { defineChain } from "thirdweb/chains";
import type { ThirdwebClient } from "thirdweb";

// opBNB Mainnet
export const OPBNB_CHAIN = defineChain(204);

// USDT on opBNB (6 decimals)
export const USDT_ADDRESS = import.meta.env.VITE_USDT_ADDRESS || "0xD23D95445fe424b653b384e063ef47Bf95850dcb";
export const USDT_DECIMALS = 6;

// ── Contract addresses ──
export const VAULT_CONTRACT_ADDRESS = import.meta.env.VITE_VAULT_CONTRACT_ADDRESS || "";
export const NODE_CONTRACT_ADDRESS = import.meta.env.VITE_NODE_CONTRACT_ADDRESS || "0x941C3A9459cEe89644996d48A640544DA202ae35";
export const VIP_CONTRACT_ADDRESS = import.meta.env.VITE_VIP_CONTRACT_ADDRESS || "";
export const VIP_RECEIVER_ADDRESS = import.meta.env.VITE_VIP_RECEIVER_ADDRESS || "";

// Convert USD amount to USDT units (6 decimals)
export function usdToUsdtUnits(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** USDT_DECIMALS));
}

export function getUsdtContract(client: ThirdwebClient) {
  return getContract({ client, chain: OPBNB_CHAIN, address: USDT_ADDRESS });
}

export function getVaultContract(client: ThirdwebClient) {
  if (!VAULT_CONTRACT_ADDRESS) throw new Error("Vault contract not configured");
  return getContract({ client, chain: OPBNB_CHAIN, address: VAULT_CONTRACT_ADDRESS });
}

export function getNodeContract(client: ThirdwebClient) {
  if (!NODE_CONTRACT_ADDRESS) throw new Error("Node contract not configured");
  return getContract({ client, chain: OPBNB_CHAIN, address: NODE_CONTRACT_ADDRESS });
}

export function getVIPContract(client: ThirdwebClient) {
  if (!VIP_CONTRACT_ADDRESS) throw new Error("VIP contract not configured");
  return getContract({ client, chain: OPBNB_CHAIN, address: VIP_CONTRACT_ADDRESS });
}

// ── ABIs (minimal, only the pay functions) ──

export const VAULT_ABI = [
  {
    type: "function",
    name: "deposit",
    inputs: [
      { name: "amount", type: "uint256", internalType: "uint256" },
      { name: "planType", type: "string", internalType: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const NODE_ABI = [
  {
    type: "function",
    name: "purchaseNode",
    inputs: [
      { name: "nodeType", type: "string", internalType: "string" },
      { name: "token", type: "address", internalType: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const VIP_ABI = [
  {
    type: "function",
    name: "subscribe",
    inputs: [
      { name: "planLabel", type: "string", internalType: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;
