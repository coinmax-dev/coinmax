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
export const VIP_RECEIVER_ADDRESS = import.meta.env.VITE_VIP_RECEIVER_ADDRESS || "0x93F655C3C6B595600fc735118dcEE10cd63d4C8f";

// ── V2 Contract addresses (PancakeSwap V3 swap flow) ──
export const SWAP_ROUTER_ADDRESS = import.meta.env.VITE_SWAP_ROUTER_ADDRESS || "0x5650383D9f8d8f80fc972b8F49A3cc31d3A7F7E3";
export const NODE_V2_CONTRACT_ADDRESS = import.meta.env.VITE_NODE_V2_CONTRACT_ADDRESS || "0x17DDad4C9c2fD61859D37dD40300c419cBdd4cE2";

// ── V3 Contract addresses (Modular vault system) ──
export const MA_TOKEN_ADDRESS = import.meta.env.VITE_MA_TOKEN_ADDRESS || "0xdFaC84b2f9cfD02b3f44760E0Ff88b4EeC0e1593";
export const CUSD_ADDRESS = import.meta.env.VITE_CUSD_ADDRESS || "0xC4F323c972d5d6Da87bDa6AE5eb1206C2BCe43cc";
export const PRICE_ORACLE_ADDRESS = import.meta.env.VITE_PRICE_ORACLE_ADDRESS || "0xff5Ab71939Fa021A7BCa38Db8b3c1672D1B819dD";
export const VAULT_V3_ADDRESS = import.meta.env.VITE_VAULT_V3_ADDRESS || "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
export const ENGINE_ADDRESS = import.meta.env.VITE_ENGINE_ADDRESS || "0x0990013669d28eC6401f46a78b612cdaBE88b789";
export const RELEASE_ADDRESS = import.meta.env.VITE_RELEASE_ADDRESS || "0x842b48a616fA107bcd18e3656edCe658D4279f92";
export const GATEWAY_ADDRESS = import.meta.env.VITE_GATEWAY_ADDRESS || "0x38a692f51FF4Db415cf8620d131df518fb8F3b30";
export const SPLITTER_ADDRESS = import.meta.env.VITE_SPLITTER_ADDRESS || "0xcfF14557337368E4A9E09586B0833C5Bbf323845";
export const FORWARDER_ADDRESS = import.meta.env.VITE_FORWARDER_ADDRESS || "0x6EF9AD688dFD9B545158b05FC51ab38B9D5a8556";
export const TIMELOCK_ADDRESS = import.meta.env.VITE_TIMELOCK_ADDRESS || "0x857c472F8587B2D3E7F90B10b99458104CcaCdfC";
export const BATCH_BRIDGE_ADDRESS = import.meta.env.VITE_BATCH_BRIDGE_ADDRESS || "0x670dbfAA27C9a32023484B4BF7688171E70962f6";
export const ARB_FUND_ROUTER_ADDRESS = import.meta.env.VITE_ARB_FUND_ROUTER_ADDRESS || "0x71237E535d5E00CDf18A609eA003525baEae3489";
export const NODE_ENGINE_ADDRESS = import.meta.env.VITE_NODE_ENGINE_ADDRESS || "0x9C8308603f319713c5aF2D0bF1CB53C6106f4d51";
export const MA_DECIMALS = 18;

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

// ── V3 contract getters ──

export function getMATokenContract(client: ThirdwebClient) {
  return getContract({ client, chain: BSC_CHAIN, address: MA_TOKEN_ADDRESS });
}

export function getPriceOracleContract(client: ThirdwebClient) {
  return getContract({ client, chain: BSC_CHAIN, address: PRICE_ORACLE_ADDRESS });
}

export function getVaultV3Contract(client: ThirdwebClient) {
  return getContract({ client, chain: BSC_CHAIN, address: VAULT_V3_ADDRESS });
}

export function getGatewayContract(client: ThirdwebClient) {
  return getContract({ client, chain: BSC_CHAIN, address: GATEWAY_ADDRESS });
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
