import { getContract } from "thirdweb";
import { bsc } from "thirdweb/chains";
import type { ThirdwebClient } from "thirdweb";

// BSC Mainnet (chain ID 56)
export const BSC_CHAIN = bsc;

// USDT on BSC (18 decimals)
export const USDT_ADDRESS = import.meta.env.VITE_USDT_ADDRESS || "0x55d398326f99059fF775485246999027B3197955";
export const USDT_DECIMALS = 18;

// USDC on BSC (18 decimals)
export const USDC_ADDRESS = import.meta.env.VITE_USDC_ADDRESS || "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
export const USDC_DECIMALS = 18;

// ── V1 Contract addresses ──
export const VAULT_CONTRACT_ADDRESS = import.meta.env.VITE_VAULT_CONTRACT_ADDRESS || "";
export const NODE_CONTRACT_ADDRESS = import.meta.env.VITE_NODE_CONTRACT_ADDRESS || "0x71237E535d5E00CDf18A609eA003525baEae3489";
export const VIP_CONTRACT_ADDRESS = import.meta.env.VITE_VIP_CONTRACT_ADDRESS || "";
export const VIP_RECEIVER_ADDRESS = import.meta.env.VITE_VIP_RECEIVER_ADDRESS || "";

// ── V2 Contract addresses (PancakeSwap V3 swap flow) ──
export const SWAP_ROUTER_ADDRESS = import.meta.env.VITE_SWAP_ROUTER_ADDRESS || "0xF179A34CCE54F6337A337eaE2Bc4e3c5fBf51135";
export const NODE_V2_CONTRACT_ADDRESS = import.meta.env.VITE_NODE_V2_CONTRACT_ADDRESS || "0x17DDad4C9c2fD61859D37dD40300c419cBdd4cE2";

// Convert USD amount to USDT units (6 decimals)
export function usdToUsdtUnits(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** USDT_DECIMALS));
}

export function getUsdtContract(client: ThirdwebClient) {
  return getContract({ client, chain: BSC_CHAIN, address: USDT_ADDRESS });
}

export function getUsdcContract(client: ThirdwebClient) {
  return getContract({ client, chain: BSC_CHAIN, address: USDC_ADDRESS });
}

export function getVaultContract(client: ThirdwebClient) {
  if (!VAULT_CONTRACT_ADDRESS) throw new Error("Vault contract not configured");
  return getContract({ client, chain: BSC_CHAIN, address: VAULT_CONTRACT_ADDRESS });
}

export function getNodeContract(client: ThirdwebClient) {
  if (!NODE_CONTRACT_ADDRESS) throw new Error("Node contract not configured");
  return getContract({ client, chain: BSC_CHAIN, address: NODE_CONTRACT_ADDRESS });
}

export function getVIPContract(client: ThirdwebClient) {
  if (!VIP_CONTRACT_ADDRESS) throw new Error("VIP contract not configured");
  return getContract({ client, chain: BSC_CHAIN, address: VIP_CONTRACT_ADDRESS });
}

// ── V2 contract getters ──

export function getSwapRouterContract(client: ThirdwebClient) {
  if (!SWAP_ROUTER_ADDRESS) throw new Error("SwapRouter contract not configured");
  return getContract({ client, chain: BSC_CHAIN, address: SWAP_ROUTER_ADDRESS });
}

export function getNodeV2Contract(client: ThirdwebClient) {
  if (!NODE_V2_CONTRACT_ADDRESS) throw new Error("NodeV2 contract not configured");
  return getContract({ client, chain: BSC_CHAIN, address: NODE_V2_CONTRACT_ADDRESS });
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
      { name: "token", type: "address", internalType: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

// ── V2 ABIs (SwapRouter: USDT → PancakeSwap V3 → USDC → Node/Vault) ──

export const SWAP_ROUTER_ABI = [
  {
    type: "function",
    name: "swapAndPurchaseNode",
    inputs: [
      { name: "usdtAmount", type: "uint256", internalType: "uint256" },
      { name: "nodeType", type: "string", internalType: "string" },
      { name: "minUsdcOut", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "swapAndDepositVault",
    inputs: [
      { name: "usdtAmount", type: "uint256", internalType: "uint256" },
      { name: "planIndex", type: "uint256", internalType: "uint256" },
      { name: "minUsdcOut", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "maxSlippageBps",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
] as const;
