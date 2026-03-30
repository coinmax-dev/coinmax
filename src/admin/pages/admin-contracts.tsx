import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCode2, Save, Lock, RefreshCw, ExternalLink, ChevronDown, ChevronRight, Shield, Zap, Wallet, ArrowRightLeft, Sparkles, Send, Plus, Fuel } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { adminGetContractConfigs, adminUpdateContractConfig, adminAddLog } from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { useThirdwebClient } from "@/hooks/use-thirdweb";
import { readContract, getContract, prepareContractCall, prepareTransaction, waitForReceipt, toWei } from "thirdweb";
import { useActiveAccount, useSendTransaction, ConnectButton } from "thirdweb/react";
import { createWallet } from "thirdweb/wallets";
import { bsc } from "thirdweb/chains";
import {
  SWAP_ROUTER_ADDRESS,
  NODE_V2_CONTRACT_ADDRESS,
  NODE_CONTRACT_ADDRESS,
  USDT_ADDRESS,
  USDC_ADDRESS,
  MA_TOKEN_ADDRESS,
  CUSD_ADDRESS,
  PRICE_ORACLE_ADDRESS,
  VAULT_V3_ADDRESS,
  ENGINE_ADDRESS,
  RELEASE_ADDRESS,
  FORWARDER_ADDRESS,
  TIMELOCK_ADDRESS,
  BATCH_BRIDGE_ADDRESS,
  ARB_FUND_ROUTER_ADDRESS,
  FLASH_SWAP_ADDRESS,
  ARB_FLASH_SWAP_ADDRESS,
  NODE_ENGINE_ADDRESS,
} from "@/lib/contracts";

// ── Known deployed addresses ──
const FUND_MANAGER_ADDRESS = "0xbab0f5ab980870789f88807f2987ca569b875616";

// ── Minimal ABIs for reading on-chain state ──

const SWAP_ROUTER_READ_ABI = {
  pancakeRouter: { type: "function", name: "pancakeRouter", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  pancakePool: { type: "function", name: "pancakePool", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  usdt: { type: "function", name: "usdt", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  usdc: { type: "function", name: "usdc", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  poolFee: { type: "function", name: "poolFee", inputs: [], outputs: [{ name: "", type: "uint24" }], stateMutability: "view" },
  nodesV2: { type: "function", name: "nodesV2", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  vaultV2: { type: "function", name: "vaultV2", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  maxSlippageBps: { type: "function", name: "maxSlippageBps", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  maxPriceDeviationBps: { type: "function", name: "maxPriceDeviationBps", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  maxSwapAmount: { type: "function", name: "maxSwapAmount", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  twapWindow: { type: "function", name: "twapWindow", inputs: [], outputs: [{ name: "", type: "uint32" }], stateMutability: "view" },
  maxTwapDeviationBps: { type: "function", name: "maxTwapDeviationBps", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  cooldownPeriod: { type: "function", name: "cooldownPeriod", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  twapCheckEnabled: { type: "function", name: "twapCheckEnabled", inputs: [], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
  deadlineExtension: { type: "function", name: "deadlineExtension", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  isToken0Usdt: { type: "function", name: "isToken0Usdt", inputs: [], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
  owner: { type: "function", name: "owner", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  paused: { type: "function", name: "paused", inputs: [], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
} as const;

const NODES_V2_READ_ABI = {
  usdc: { type: "function", name: "usdc", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  fundDistributor: { type: "function", name: "fundDistributor", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  swapRouter: { type: "function", name: "swapRouter", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  purchaseCount: { type: "function", name: "purchaseCount", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  owner: { type: "function", name: "owner", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  paused: { type: "function", name: "paused", inputs: [], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
  nodePlans: { type: "function", name: "nodePlans", inputs: [{ name: "", type: "string" }], outputs: [{ name: "price", type: "uint256" }, { name: "active", type: "bool" }], stateMutability: "view" },
} as const;

const NODES_V1_READ_ABI = {
  fundDistributor: { type: "function", name: "fundDistributor", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  purchaseCount: { type: "function", name: "purchaseCount", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  owner: { type: "function", name: "owner", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  paused: { type: "function", name: "paused", inputs: [], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
  nodePlans: { type: "function", name: "nodePlans", inputs: [{ name: "", type: "string" }], outputs: [{ name: "price", type: "uint256" }, { name: "active", type: "bool" }], stateMutability: "view" },
} as const;

const FUND_MANAGER_READ_ABI = {
  owner: { type: "function", name: "owner", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  paused: { type: "function", name: "paused", inputs: [], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
  getRecipientsCount: { type: "function", name: "getRecipientsCount", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  recipients: { type: "function", name: "recipients", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "wallet", type: "address" }, { name: "share", type: "uint256" }], stateMutability: "view" },
  getBalance: { type: "function", name: "getBalance", inputs: [{ name: "token", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  allowedTokens: { type: "function", name: "allowedTokens", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
} as const;

const ERC20_BALANCE_ABI = {
  balanceOf: { type: "function", name: "balanceOf", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
} as const;

const FLASH_SWAP_READ_ABI = {
  feeBps: { type: "function", name: "feeBps", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  holdingRuleBps: { type: "function", name: "holdingRuleBps", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  minSwapAmount: { type: "function", name: "minSwapAmount", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  swapCount: { type: "function", name: "swapCount", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  totalMAReceived: { type: "function", name: "totalMAReceived", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  totalUSDTPaid: { type: "function", name: "totalUSDTPaid", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  totalFees: { type: "function", name: "totalFees", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  paused: { type: "function", name: "paused", inputs: [], outputs: [{ name: "", type: "bool" }], stateMutability: "view" },
  getLiquidity: { type: "function", name: "getLiquidity", inputs: [], outputs: [{ name: "maLiq", type: "uint256" }, { name: "usdtLiq", type: "uint256" }, { name: "usdcLiq", type: "uint256" }], stateMutability: "view" },
} as const;

// ── Server Wallets for gas monitoring ──
const SERVER_WALLETS = [
  { label: "Server Wallet (ERC-4337·MINTER/FEEDER/ENGINE)", address: "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b" },
  { label: "Deployer (EOA·合约admin·跨链)", address: "0x1B6B492d8fbB8ded7dC6E1D48564695cE5BCB9b1" },
  { label: "Relayer (EIP-7702·BSC不可用)", address: "0xcb41F3C3eD6C255F57Cda1bA3fd42389B0f0F0aA" },
  { label: "VIP接收钱包", address: "0x927eDe64b4B8a7C08Cf4225924Fa9c6759943E0A" },
  { label: "节点接收钱包", address: "0xeb8AbD9b47F9Ca0d20e22636B2004B75E84BdcD9" },
  { label: "HL Treasury (ARB)", address: "0x60D416dA873508c23C1315a2b750a31201959d78" },
] as const;

const BSC_RPC = "https://bsc-dataseed1.binance.org";
const GAS_ALERT_THRESHOLD = 0.005; // BNB

// ── Helpers ──

function formatAddress(addr: string) {
  if (!addr || addr === "0x0000000000000000000000000000000000000000") return "未配置";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function bscScanUrl(addr: string) {
  return `https://bscscan.com/address/${addr}`;
}

function formatBigAmount(val: bigint, decimals = 18) {
  const num = Number(val) / 10 ** decimals;
  return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

type ConfigItem = { label: string; value: string; type?: "address" | "bool" | "number" | "text" };

function ConfigRow({ item }: { item: ConfigItem }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/[0.02] transition-colors">
      <span className="text-[11px] text-foreground/40 font-medium shrink-0 mr-3">{item.label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        {item.type === "address" && item.value !== "未配置" ? (
          <a
            href={bscScanUrl(item.value)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-mono text-primary/80 hover:text-primary flex items-center gap-1 truncate"
          >
            {formatAddress(item.value)}
            <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
          </a>
        ) : item.type === "bool" ? (
          <Badge className={`text-[9px] ${item.value === "true" ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
            {item.value === "true" ? "启用" : "禁用"}
          </Badge>
        ) : (
          <span className="text-[11px] font-mono text-foreground/70 truncate">{item.value}</span>
        )}
      </div>
    </div>
  );
}

function ContractSection({
  title,
  icon,
  address,
  items,
  loading,
  error,
  onRefresh,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ReactNode;
  address: string;
  items: ConfigItem[];
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className="rounded-xl border border-border/15 overflow-hidden"
      style={{ background: "rgba(255,255,255,0.01)" }}
    >
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2.5">
          {icon}
          <span className="text-[13px] font-bold text-foreground/80">{title}</span>
          {address && (
            <a
              href={bscScanUrl(address)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-mono text-primary/50 hover:text-primary flex items-center gap-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              {formatAddress(address)}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="h-6 w-6 rounded flex items-center justify-center text-foreground/30 hover:text-foreground/60 hover:bg-white/[0.05] transition-colors"
            onClick={(e) => { e.stopPropagation(); onRefresh(); }}
            title="刷新"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </button>
          {open ? <ChevronDown className="h-4 w-4 text-foreground/30" /> : <ChevronRight className="h-4 w-4 text-foreground/30" />}
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 border-t border-border/10">
          {loading ? (
            <div className="space-y-2 pt-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-7 w-full rounded-lg" />)}
            </div>
          ) : error ? (
            <div className="text-[11px] text-red-400 py-3 px-3">{error}</div>
          ) : (
            <div className="divide-y divide-border/5">
              {items.map((item, i) => <ConfigRow key={i} item={item} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── On-chain data hooks ──

function useOnChainData(contractAddress: string, readFn: () => Promise<ConfigItem[]>, enabled: boolean) {
  const [data, setData] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const fetch = useCallback(async () => {
    if (!enabled || !contractAddress) return;
    setLoading(true);
    setError(undefined);
    try {
      const items = await readFn();
      setData(items);
    } catch (err: any) {
      setError(err?.message || "读取失败");
    } finally {
      setLoading(false);
    }
  }, [enabled, contractAddress, readFn]);

  useEffect(() => { fetch(); }, [fetch]);

  return { data, loading, error, refresh: fetch };
}

export default function AdminContracts() {
  const { adminUser, adminRole, hasPermission } = useAdminAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const { client } = useThirdwebClient();

  const canEdit = hasPermission("contracts");
  const isReadOnly = !canEdit;
  const isSuperAdmin = adminRole === "superadmin";

  const { data: configs, isLoading } = useQuery({
    queryKey: ["admin", "contract-configs"],
    queryFn: adminGetContractConfigs,
    enabled: !!adminUser,
  });

  const handleSave = async (key: string) => {
    if (!adminUser || !adminRole) return;
    const newValue = editValues[key];
    if (newValue === undefined) return;

    setSaving(key);
    try {
      await adminUpdateContractConfig(key, newValue, adminUser);
      await adminAddLog(adminUser, adminRole, "update", "contract_config", key, { key, value: newValue });
      queryClient.invalidateQueries({ queryKey: ["admin", "contract-configs"] });
      setEditValues((prev) => { const next = { ...prev }; delete next[key]; return next; });
      toast({ title: "已保存", description: `${key} 已更新` });
    } catch {
      toast({ title: "保存失败", description: "请重试", variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  // ── SwapRouter on-chain data ──
  const readSwapRouter = useCallback(async (): Promise<ConfigItem[]> => {
    if (!client || !SWAP_ROUTER_ADDRESS) return [];
    const c = getContract({ client, chain: bsc, address: SWAP_ROUTER_ADDRESS });
    const read = (method: any, params?: any[]) => readContract({ contract: c, method, params: params as any });

    const [
      pancakeRouter, pancakePool, usdt, usdc, poolFee,
      nodesV2, vaultV2, maxSlippageBps, maxPriceDeviationBps,
      maxSwapAmount, twapWindow, maxTwapDeviationBps,
      cooldownPeriod, twapCheckEnabled, deadlineExtension,
      isToken0Usdt, owner, paused,
    ] = await Promise.all([
      read(SWAP_ROUTER_READ_ABI.pancakeRouter),
      read(SWAP_ROUTER_READ_ABI.pancakePool),
      read(SWAP_ROUTER_READ_ABI.usdt),
      read(SWAP_ROUTER_READ_ABI.usdc),
      read(SWAP_ROUTER_READ_ABI.poolFee),
      read(SWAP_ROUTER_READ_ABI.nodesV2),
      read(SWAP_ROUTER_READ_ABI.vaultV2),
      read(SWAP_ROUTER_READ_ABI.maxSlippageBps),
      read(SWAP_ROUTER_READ_ABI.maxPriceDeviationBps),
      read(SWAP_ROUTER_READ_ABI.maxSwapAmount),
      read(SWAP_ROUTER_READ_ABI.twapWindow),
      read(SWAP_ROUTER_READ_ABI.maxTwapDeviationBps),
      read(SWAP_ROUTER_READ_ABI.cooldownPeriod),
      read(SWAP_ROUTER_READ_ABI.twapCheckEnabled),
      read(SWAP_ROUTER_READ_ABI.deadlineExtension),
      read(SWAP_ROUTER_READ_ABI.isToken0Usdt),
      read(SWAP_ROUTER_READ_ABI.owner),
      read(SWAP_ROUTER_READ_ABI.paused),
    ]);

    return [
      { label: "Owner", value: String(owner), type: "address" },
      { label: "暂停状态", value: String(paused), type: "bool" },
      { label: "PancakeSwap Router", value: String(pancakeRouter), type: "address" },
      { label: "PancakeSwap Pool", value: String(pancakePool), type: "address" },
      { label: "USDT Token", value: String(usdt), type: "address" },
      { label: "USDC Token", value: String(usdc), type: "address" },
      { label: "Pool Fee", value: `${Number(poolFee)} (${(Number(poolFee) / 10000 * 100).toFixed(2)}%)` },
      { label: "NodesV2 合约", value: String(nodesV2), type: "address" },
      { label: "VaultV2 合约", value: String(vaultV2), type: "address" },
      { label: "最大滑点", value: `${Number(maxSlippageBps)} bps (${(Number(maxSlippageBps) / 100).toFixed(2)}%)` },
      { label: "最大价格偏差", value: `${Number(maxPriceDeviationBps)} bps (${(Number(maxPriceDeviationBps) / 100).toFixed(2)}%)` },
      { label: "单笔最大交换", value: `${formatBigAmount(BigInt(String(maxSwapAmount)))} USDT` },
      { label: "TWAP 窗口", value: `${Number(twapWindow)} 秒` },
      { label: "TWAP 最大偏差", value: `${Number(maxTwapDeviationBps)} bps` },
      { label: "冷却期", value: `${Number(cooldownPeriod)} 秒` },
      { label: "TWAP 检查", value: String(twapCheckEnabled), type: "bool" },
      { label: "截止时间延长", value: `${Number(deadlineExtension)} 秒` },
      { label: "Token0 是 USDT", value: String(isToken0Usdt), type: "bool" },
    ];
  }, [client]);

  const swapRouter = useOnChainData(SWAP_ROUTER_ADDRESS, readSwapRouter, !!client && isSuperAdmin);

  // ── NodesV2 on-chain data ──
  const readNodesV2 = useCallback(async (): Promise<ConfigItem[]> => {
    if (!client || !NODE_V2_CONTRACT_ADDRESS) return [];
    const c = getContract({ client, chain: bsc, address: NODE_V2_CONTRACT_ADDRESS });
    const read = (method: any, params?: any[]) => readContract({ contract: c, method, params: params as any });

    const [usdc, fundDist, router, count, owner, paused, miniPlan, maxPlan] = await Promise.all([
      read(NODES_V2_READ_ABI.usdc),
      read(NODES_V2_READ_ABI.fundDistributor),
      read(NODES_V2_READ_ABI.swapRouter),
      read(NODES_V2_READ_ABI.purchaseCount),
      read(NODES_V2_READ_ABI.owner),
      read(NODES_V2_READ_ABI.paused),
      read(NODES_V2_READ_ABI.nodePlans, ["MINI"]),
      read(NODES_V2_READ_ABI.nodePlans, ["MAX"]),
    ]);

    return [
      { label: "Owner", value: String(owner), type: "address" },
      { label: "暂停状态", value: String(paused), type: "bool" },
      { label: "USDC Token", value: String(usdc), type: "address" },
      { label: "资金分配合约", value: String(fundDist), type: "address" },
      { label: "SwapRouter", value: String(router), type: "address" },
      { label: "购买总数", value: String(Number(count)) },
      { label: "MINI 价格", value: `$${formatBigAmount(BigInt(String((miniPlan as any)[0] || miniPlan)))} USDT` },
      { label: "MINI 状态", value: String((miniPlan as any)[1] ?? true), type: "bool" },
      { label: "MAX 价格", value: `$${formatBigAmount(BigInt(String((maxPlan as any)[0] || maxPlan)))} USDT` },
      { label: "MAX 状态", value: String((maxPlan as any)[1] ?? true), type: "bool" },
    ];
  }, [client]);

  const nodesV2 = useOnChainData(NODE_V2_CONTRACT_ADDRESS, readNodesV2, !!client && isSuperAdmin);

  // ── NodesV1 on-chain data ──
  const readNodesV1 = useCallback(async (): Promise<ConfigItem[]> => {
    if (!client || !NODE_CONTRACT_ADDRESS) return [];
    const c = getContract({ client, chain: bsc, address: NODE_CONTRACT_ADDRESS });
    const read = (method: any, params?: any[]) => readContract({ contract: c, method, params: params as any });

    const [fundDist, count, owner, paused, miniPlan, maxPlan] = await Promise.all([
      read(NODES_V1_READ_ABI.fundDistributor),
      read(NODES_V1_READ_ABI.purchaseCount),
      read(NODES_V1_READ_ABI.owner),
      read(NODES_V1_READ_ABI.paused),
      read(NODES_V1_READ_ABI.nodePlans, ["MINI"]),
      read(NODES_V1_READ_ABI.nodePlans, ["MAX"]),
    ]);

    return [
      { label: "Owner", value: String(owner), type: "address" },
      { label: "暂停状态", value: String(paused), type: "bool" },
      { label: "资金分配合约", value: String(fundDist), type: "address" },
      { label: "购买总数", value: String(Number(count)) },
      { label: "MINI 价格", value: `$${formatBigAmount(BigInt(String((miniPlan as any)[0] || miniPlan)))} USDT` },
      { label: "MINI 状态", value: String((miniPlan as any)[1] ?? true), type: "bool" },
      { label: "MAX 价格", value: `$${formatBigAmount(BigInt(String((maxPlan as any)[0] || maxPlan)))} USDT` },
      { label: "MAX 状态", value: String((maxPlan as any)[1] ?? true), type: "bool" },
    ];
  }, [client]);

  const nodesV1 = useOnChainData(NODE_CONTRACT_ADDRESS, readNodesV1, !!client && isSuperAdmin);

  // ── FundManager on-chain data ──
  const readFundManager = useCallback(async (): Promise<ConfigItem[]> => {
    if (!client || !FUND_MANAGER_ADDRESS) return [];
    const c = getContract({ client, chain: bsc, address: FUND_MANAGER_ADDRESS });
    const read = (method: any, params?: any[]) => readContract({ contract: c, method, params: params as any });

    const [owner, paused, recipientCount] = await Promise.all([
      read(FUND_MANAGER_READ_ABI.owner),
      read(FUND_MANAGER_READ_ABI.paused),
      read(FUND_MANAGER_READ_ABI.getRecipientsCount),
    ]);

    const items: ConfigItem[] = [
      { label: "Owner", value: String(owner), type: "address" },
      { label: "暂停状态", value: String(paused), type: "bool" },
      { label: "接收方数量", value: String(Number(recipientCount)) },
    ];

    // Read each recipient
    const count = Number(recipientCount);
    for (let i = 0; i < count; i++) {
      try {
        const r = await read(FUND_MANAGER_READ_ABI.recipients, [BigInt(i)]);
        const wallet = String((r as any)[0] || r);
        const share = Number((r as any)[1] || 0);
        items.push({
          label: `接收方 ${i + 1} (${(share / 100).toFixed(1)}%)`,
          value: wallet,
          type: "address",
        });
      } catch { /* skip */ }
    }

    // Read token balances
    try {
      const usdtBalance = await read(FUND_MANAGER_READ_ABI.getBalance, [USDT_ADDRESS]);
      items.push({ label: "USDT 余额", value: `${formatBigAmount(BigInt(String(usdtBalance)))} USDT` });
    } catch { /* skip */ }

    try {
      const usdcBalance = await read(FUND_MANAGER_READ_ABI.getBalance, [USDC_ADDRESS]);
      items.push({ label: "USDC 余额", value: `${formatBigAmount(BigInt(String(usdcBalance)))} USDC` });
    } catch { /* skip */ }

    // Check token whitelist
    try {
      const usdtAllowed = await read(FUND_MANAGER_READ_ABI.allowedTokens, [USDT_ADDRESS]);
      items.push({ label: "USDT 白名单", value: String(usdtAllowed), type: "bool" });
    } catch { /* skip */ }

    try {
      const usdcAllowed = await read(FUND_MANAGER_READ_ABI.allowedTokens, [USDC_ADDRESS]);
      items.push({ label: "USDC 白名单", value: String(usdcAllowed), type: "bool" });
    } catch { /* skip */ }

    return items;
  }, [client]);

  const fundManager = useOnChainData(FUND_MANAGER_ADDRESS, readFundManager, !!client && isSuperAdmin);

  // ── V3 Vault on-chain data ──
  const readV3Vault = useCallback(async (): Promise<ConfigItem[]> => {
    if (!client || !VAULT_V3_ADDRESS) return [];
    const c = getContract({ client, chain: bsc, address: VAULT_V3_ADDRESS });
    const read = (method: string, outputs: string, params?: any[]) =>
      readContract({ contract: c, method: `function ${method} view returns (${outputs})`, params: params as any });

    try {
      const [totalMA, totalCUsd, plansCount, maPrice] = await Promise.all([
        read("totalMAStaked()", "uint256"),
        read("totalCUsdDeposited()", "uint256"),
        read("getPlansCount()", "uint256"),
        read("maPrice()", "uint256"),
      ]);

      const items: ConfigItem[] = [
        { label: "MA 总质押", value: `${formatBigAmount(BigInt(String(totalMA)))} MA` },
        { label: "cUSD 总存入", value: `${formatBigAmount(BigInt(String(totalCUsd)))} cUSD` },
        { label: "MA 价格", value: `$${(Number(maPrice) / 1e6).toFixed(4)}` },
        { label: "质押计划数", value: String(Number(plansCount)) },
      ];

      // Read each plan
      const count = Number(plansCount);
      for (let i = 0; i < count; i++) {
        try {
          const plan = await read("getStakePlan(uint256)", "uint256 duration, uint256 dailyRate, bool active", [BigInt(i)]);
          const duration = Number((plan as any)[0]) / 86400;
          const rate = Number((plan as any)[1]);
          const active = (plan as any)[2];
          items.push({
            label: `计划 ${i}: ${duration}天 ${(rate / 100).toFixed(1)}%/日`,
            value: String(active),
            type: "bool",
          });
        } catch { /* skip */ }
      }

      return items;
    } catch (err: any) {
      return [{ label: "错误", value: err?.message || "读取失败" }];
    }
  }, [client]);

  const v3Vault = useOnChainData(VAULT_V3_ADDRESS, readV3Vault, !!client && isSuperAdmin);

  // ── V3 Oracle on-chain data ──
  const readV3Oracle = useCallback(async (): Promise<ConfigItem[]> => {
    if (!client || !PRICE_ORACLE_ADDRESS) return [];
    const c = getContract({ client, chain: bsc, address: PRICE_ORACLE_ADDRESS });
    const read = (method: string, outputs: string) =>
      readContract({ contract: c, method: `function ${method} view returns (${outputs})`, params: [] });

    try {
      const [price, lastUpdate, heartbeat, maxChange, minP, maxP, mode, histLen] = await Promise.all([
        read("price()", "uint256"),
        read("lastUpdateTime()", "uint256"),
        read("heartbeat()", "uint256"),
        read("maxChangeRate()", "uint256"),
        read("minPrice()", "uint256"),
        read("maxPrice()", "uint256"),
        read("mode()", "uint8"),
        read("getHistoryLength()", "uint256"),
      ]);

      const modes = ["手动", "TWAP", "混合"];
      const lastTime = new Date(Number(lastUpdate) * 1000);
      const stale = Date.now() / 1000 > Number(lastUpdate) + Number(heartbeat);

      return [
        { label: "当前价格", value: `$${(Number(price) / 1e6).toFixed(4)}` },
        { label: "模式", value: modes[Number(mode)] || "未知" },
        { label: "最后更新", value: lastTime.toLocaleString("zh-CN") },
        { label: "价格状态", value: stale ? "false" : "true", type: "bool" },
        { label: "心跳超时", value: `${Number(heartbeat) / 3600} 小时` },
        { label: "最大涨跌", value: `${Number(maxChange) / 100}%` },
        { label: "价格下限", value: `$${(Number(minP) / 1e6).toFixed(4)}` },
        { label: "价格上限", value: `$${(Number(maxP) / 1e6).toFixed(2)}` },
        { label: "历史记录数", value: String(Number(histLen)) },
      ];
    } catch (err: any) {
      return [{ label: "错误", value: err?.message || "读取失败" }];
    }
  }, [client]);

  const v3Oracle = useOnChainData(PRICE_ORACLE_ADDRESS, readV3Oracle, !!client && isSuperAdmin);

  const [activeTab, setActiveTab] = useState<"flows" | "config" | "bridge">("flows");

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg lg:text-xl font-bold text-foreground flex items-center gap-2">
          <FileCode2 className="h-5 w-5 text-primary" />
          合约管理
        </h1>
        {isReadOnly && (
          <Badge className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
            <Lock className="h-3 w-3" /> 只读
          </Badge>
        )}
      </div>

      {/* ═══ Tab Bar ═══ */}
      <div className="flex gap-1 p-1 rounded-xl bg-white/[0.02] border border-white/[0.06]">
        {([
          { key: "flows" as const, label: "链路", icon: <ArrowRightLeft className="h-3.5 w-3.5" /> },
          { key: "config" as const, label: "配置", icon: <Shield className="h-3.5 w-3.5" /> },
          { key: "bridge" as const, label: "跨链", icon: <Send className="h-3.5 w-3.5" /> },
        ]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-bold transition-all ${
              activeTab === tab.key
                ? "bg-primary/10 text-primary border border-primary/20"
                : "text-foreground/40 hover:text-foreground/60 hover:bg-white/[0.03]"
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ Tab: 链路 ═══ */}
      {activeTab === "flows" && (
        <div className="space-y-3">
          <VaultFlowDiagram />
          <NodeFlowDiagram />
          <ReleaseFlowDiagram />
          <FlashSwapFlowDiagram />
          <VIPFlowDiagram />

          {/* BSC 合约地址 */}
          <ContractSection
            title="BSC 合约"
            icon={<FileCode2 className="h-4 w-4 text-amber-400" />}
            address=""
            items={[
              { label: "── 核心 ──", value: "" },
              { label: "Vault (存入+节点) UUPS", value: VAULT_V3_ADDRESS, type: "address" },
              { label: "BatchBridgeV2 (USDT→swap→USDC→跨链)", value: "0x5BDc4220Ea06CfaD6B42fD1c69ce4D2BAA46C0Db", type: "address" },
              { label: "Oracle (价格预言机) UUPS", value: PRICE_ORACLE_ADDRESS, type: "address" },
              { label: "── 收益 ──", value: "" },
              { label: "Engine (利息引擎) UUPS", value: ENGINE_ADDRESS, type: "address" },
              { label: "Release (释放合约) UUPS", value: RELEASE_ADDRESS, type: "address" },
              { label: "FlashSwap (MA闪兑) UUPS", value: FLASH_SWAP_ADDRESS, type: "address" },
              { label: "── 代币 ──", value: "" },
              { label: "MA Token", value: MA_TOKEN_ADDRESS, type: "address" },
              { label: "cUSD (记账)", value: "0x90B99a1495E5DBf8bF44c3623657020BB1BDa3C6", type: "address" },
              { label: "── 安全 ──", value: "" },
              { label: "Forwarder (EIP-2771)", value: FORWARDER_ADDRESS, type: "address" },
              { label: "Timelock (24h延迟)", value: TIMELOCK_ADDRESS, type: "address" },
              { label: "── DEX ──", value: "" },
              { label: "PancakeSwap V3 Pool (0.01%)", value: "0x92b7807bF19b7DDdf89b706143896d05228f3121", type: "address" },
            ]}
            loading={false}
            onRefresh={() => {}}
            defaultOpen={false}
          />

          {/* ARB 合约地址 */}
          <ContractSection
            title="ARB 合约"
            icon={<FileCode2 className="h-4 w-4 text-blue-400" />}
            address=""
            items={[
              { label: "FundRouter (分配) UUPS", value: ARB_FUND_ROUTER_ADDRESS, type: "address" },
              { label: "FlashSwap (MA闪兑) UUPS", value: ARB_FLASH_SWAP_ADDRESS, type: "address" },
              { label: "── 分配钱包 (30/8/12/20/30) ──", value: "" },
              { label: "Trading 30%", value: "0xd12097C9A12617c49220c032C84aCc99B6fFf57b", type: "address" },
              { label: "Ops 8%", value: "0xDf90770C89732a7eba5B727fCd6a12f827102EE6", type: "address" },
              { label: "Marketing 12%", value: "0x1C4D983620B3c8c2f7607c0943f2A5989e655599", type: "address" },
              { label: "Investor 20%", value: "0x85c3d07Ee3be12d6502353b4cA52B30cD85Ac5ff", type: "address" },
              { label: "Withdraw 30%", value: "0x7DEa369864583E792D230D360C0a4C56c2103FE4", type: "address" },
            ]}
            loading={false}
            onRefresh={() => {}}
            defaultOpen={false}
          />

          {/* 钱包 */}
          <ContractSection
            title="钱包管理"
            icon={<Wallet className="h-4 w-4 text-amber-400" />}
            address=""
            items={[
              { label: "── 执行钱包 ──", value: "" },
              { label: "Server Wallet (ERC-4337·主执行)", value: "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b", type: "address" },
              { label: "Deployer (EOA·跨链+紧急恢复)", value: "0x1B6B492d8fbB8ded7dC6E1D48564695cE5BCB9b1", type: "address" },
              { label: "Relayer (EIP-7702·BSC不可用)", value: "0xcb41F3C3eD6C255F57Cda1bA3fd42389B0f0F0aA", type: "address" },
              { label: "── 接收钱包 ──", value: "" },
              { label: "VIP接收 (USDT)", value: "0x927eDe64b4B8a7C08Cf4225924Fa9c6759943E0A", type: "address" },
              { label: "节点接收 (USDC)", value: "0xeb8AbD9b47F9Ca0d20e22636B2004B75E84BdcD9", type: "address" },
              { label: "HL Treasury (ARB)", value: "0x60D416dA873508c23C1315a2b750a31201959d78", type: "address" },
            ]}
            loading={false}
            onRefresh={() => {}}
            defaultOpen={false}
          />
        </div>
      )}

      {/* ═══ Tab: 配置 ═══ */}
      {activeTab === "config" && isSuperAdmin && client && (
        <div className="space-y-3">
          <ContractSection
            title="金库合约 (Vault)"
            icon={<Shield className="h-4 w-4 text-cyan-400" />}
            address={VAULT_V3_ADDRESS}
            items={v3Vault.data}
            loading={v3Vault.loading}
            error={v3Vault.error}
            onRefresh={v3Vault.refresh}
          />

          <ContractSection
            title="价格预言机 (Oracle)"
            icon={<Zap className="h-4 w-4 text-amber-400" />}
            address={PRICE_ORACLE_ADDRESS}
            items={v3Oracle.data}
            loading={v3Oracle.loading}
            error={v3Oracle.error}
            onRefresh={v3Oracle.refresh}
          />

          <AdminWalletConnect />

          {FLASH_SWAP_ADDRESS && <FlashSwapPanel onRefresh={() => {}} />}

          <BatchGasPanel />

          {isSuperAdmin && <OracleAdminPanel onPriceUpdated={v3Oracle.refresh} />}

          <ContractSection
            title="收益引擎 (Engine)"
            icon={<Zap className="h-4 w-4 text-orange-400" />}
            address={ENGINE_ADDRESS}
            items={[
              { label: "合约地址", value: ENGINE_ADDRESS, type: "address" },
            ]}
            loading={false}
            onRefresh={() => {}}
            defaultOpen={false}
          />

          {NODE_V2_CONTRACT_ADDRESS && (
            <ContractSection
              title="节点合约 (NodesV2)"
              icon={<Zap className="h-4 w-4 text-green-400" />}
              address={NODE_V2_CONTRACT_ADDRESS}
              items={nodesV2.data}
              loading={nodesV2.loading}
              error={nodesV2.error}
              onRefresh={nodesV2.refresh}
            />
          )}

          {SWAP_ROUTER_ADDRESS && (
            <ContractSection
              title="SwapRouter"
              icon={<ArrowRightLeft className="h-4 w-4 text-blue-400" />}
              address={SWAP_ROUTER_ADDRESS}
              items={swapRouter.data}
              loading={swapRouter.loading}
              error={swapRouter.error}
              onRefresh={swapRouter.refresh}
            />
          )}
        </div>
      )}

      {/* ═══ Tab: 跨链 ═══ */}
      {activeTab === "bridge" && (
        <div className="space-y-3">
          <CrossChainPanel />

          <ContractSection
            title="跨链相关合约"
            icon={<Send className="h-4 w-4 text-indigo-400" />}
            address=""
            items={[
              { label: "── BSC ──", value: "" },
              { label: "BatchBridgeV2 (USDT→swap→USDC→桥)", value: "0x5BDc4220Ea06CfaD6B42fD1c69ce4D2BAA46C0Db", type: "address" },
              { label: "Vault (USDT来源)", value: VAULT_V3_ADDRESS, type: "address" },
              { label: "PancakeSwap Pool (swap用)", value: "0x92b7807bF19b7DDdf89b706143896d05228f3121", type: "address" },
              { label: "── ARB ──", value: "" },
              { label: "FundRouter (分配)", value: ARB_FUND_ROUTER_ADDRESS, type: "address" },
              { label: "Trading 30%", value: "0xd12097C9A12617c49220c032C84aCc99B6fFf57b", type: "address" },
              { label: "Ops 8%", value: "0xDf90770C89732a7eba5B727fCd6a12f827102EE6", type: "address" },
              { label: "Marketing 12%", value: "0x1C4D983620B3c8c2f7607c0943f2A5989e655599", type: "address" },
              { label: "Investor 20%", value: "0x85c3d07Ee3be12d6502353b4cA52B30cD85Ac5ff", type: "address" },
              { label: "Withdraw 30%", value: "0x7DEa369864583E792D230D360C0a4C56c2103FE4", type: "address" },
            ]}
            loading={false}
            onRefresh={() => {}}
          />

          <CronPanel />
        </div>
      )}

    </div>
  );
}

// ── Admin Wallet Connect ──

const adminWallets = [createWallet("io.metamask"), createWallet("io.rabby"), createWallet("com.coinbase.wallet")];

function AdminWalletConnect() {
  const { client } = useThirdwebClient();
  const account = useActiveAccount();

  if (!client) return null;

  return (
    <div className="rounded-xl border border-primary/15 overflow-hidden" style={{ background: "rgba(10,186,181,0.02)" }}>
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-primary" />
          <span className="text-[13px] font-bold text-foreground/80">管理钱包</span>
          {account && (
            <span className="text-[10px] font-mono text-primary/60">{account.address.slice(0, 6)}...{account.address.slice(-4)}</span>
          )}
        </div>
        <ConnectButton
          client={client}
          chain={bsc}
          wallets={adminWallets}
          connectButton={{ label: "连接钱包", style: { height: "28px", fontSize: "11px", padding: "0 12px", borderRadius: "8px" } }}
          detailsButton={{ style: { height: "28px", fontSize: "11px", padding: "0 12px", borderRadius: "8px" } }}
          theme="dark"
        />
      </div>
      {!account && (
        <div className="px-4 pb-3">
          <p className="text-[10px] text-foreground/25">连接钱包后可直接转账补充流动性、发送 Gas</p>
        </div>
      )}
    </div>
  );
}

// ── FlashSwap Liquidity Monitor Panel ──

const LIQUIDITY_ALERT_USDT = 500;  // USDT threshold for warning
const LIQUIDITY_ALERT_MA = 5000;   // MA threshold for warning

function FlashSwapPanel({ onRefresh }: { onRefresh?: () => void }) {
  const { toast } = useToast();
  const { client } = useThirdwebClient();
  const account = useActiveAccount();
  const { mutateAsync: sendTx } = useSendTransaction();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [depositToken, setDepositToken] = useState<"USDT" | "MA">("USDT");
  const [depositAmount, setDepositAmount] = useState("");
  const [data, setData] = useState<{
    maLiq: string; usdtLiq: string; usdcLiq: string;
    feeBps: number; holdingRuleBps: number; minSwap: string;
    swapCount: number; totalMAReceived: string; totalUSDTPaid: string; totalFees: string;
    paused: boolean;
  } | null>(null);

  const fetchData = useCallback(async () => {
    if (!client || !FLASH_SWAP_ADDRESS) return;
    setLoading(true);
    try {
      const c = getContract({ client, chain: bsc, address: FLASH_SWAP_ADDRESS });
      const read = (method: any, params?: any[]) => readContract({ contract: c, method, params: params as any });

      const [liq, feeBps, holdingRuleBps, minSwapAmount, swapCount, totalMAReceived, totalUSDTPaid, totalFees, paused] = await Promise.all([
        read(FLASH_SWAP_READ_ABI.getLiquidity),
        read(FLASH_SWAP_READ_ABI.feeBps),
        read(FLASH_SWAP_READ_ABI.holdingRuleBps),
        read(FLASH_SWAP_READ_ABI.minSwapAmount),
        read(FLASH_SWAP_READ_ABI.swapCount),
        read(FLASH_SWAP_READ_ABI.totalMAReceived),
        read(FLASH_SWAP_READ_ABI.totalUSDTPaid),
        read(FLASH_SWAP_READ_ABI.totalFees),
        read(FLASH_SWAP_READ_ABI.paused),
      ]);

      const maLiq = Number((liq as any)[0] || 0) / 1e18;
      const usdtLiq = Number((liq as any)[1] || 0) / 1e18;
      const usdcLiq = Number((liq as any)[2] || 0) / 1e18;

      setData({
        maLiq: maLiq.toLocaleString("en-US", { maximumFractionDigits: 2 }),
        usdtLiq: usdtLiq.toLocaleString("en-US", { maximumFractionDigits: 2 }),
        usdcLiq: usdcLiq.toLocaleString("en-US", { maximumFractionDigits: 2 }),
        feeBps: Number(feeBps),
        holdingRuleBps: Number(holdingRuleBps),
        minSwap: (Number(minSwapAmount) / 1e18).toFixed(0),
        swapCount: Number(swapCount),
        totalMAReceived: (Number(totalMAReceived) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 2 }),
        totalUSDTPaid: (Number(totalUSDTPaid) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 2 }),
        totalFees: (Number(totalFees) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 4 }),
        paused: Boolean(paused),
      });
    } catch (err: any) {
      toast({ title: "FlashSwap 读取失败", description: err?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [client, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Deposit liquidity: direct transfer ERC20 to FlashSwap contract
  const handleDeposit = async () => {
    if (!client || !account || !depositAmount) return;
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) return;

    const tokenAddr = depositToken === "USDT" ? USDT_ADDRESS : MA_TOKEN_ADDRESS;
    const tokenContract = getContract({ client, chain: bsc, address: tokenAddr });

    try {
      setBusy("sending");
      const tx = prepareContractCall({
        contract: tokenContract,
        method: "function transfer(address to, uint256 amount) returns (bool)",
        params: [FLASH_SWAP_ADDRESS, toWei(depositAmount)],
      });
      const result = await sendTx(tx);
      await waitForReceipt({ client, chain: bsc, transactionHash: result.transactionHash });

      toast({ title: "补充成功", description: `${depositAmount} ${depositToken} -> FlashSwap` });
      setDepositAmount("");
      setTimeout(fetchData, 3000);
    } catch (err: any) {
      toast({ title: "补充失败", description: err?.shortMessage || err?.message, variant: "destructive" });
    } finally {
      setBusy("");
    }
  };

  const maNum = data ? parseFloat(data.maLiq.replace(/,/g, "")) : 0;
  const usdtNum = data ? parseFloat(data.usdtLiq.replace(/,/g, "")) : 0;
  const usdcNum = data ? parseFloat(data.usdcLiq.replace(/,/g, "")) : 0;
  const maLow = maNum < LIQUIDITY_ALERT_MA;
  const usdtLow = usdtNum < LIQUIDITY_ALERT_USDT;
  const usdcLow = usdcNum < LIQUIDITY_ALERT_USDT;
  const anyAlert = data && (maLow || usdtLow);

  return (
    <div className={`rounded-xl border overflow-hidden ${anyAlert ? "border-red-500/30" : "border-cyan-500/15"}`}
      style={{ background: anyAlert ? "rgba(239,68,68,0.03)" : "rgba(6,182,212,0.02)" }}>
      <div className="px-4 py-3 border-b border-cyan-500/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="h-4 w-4 text-cyan-400" />
          <span className="text-[13px] font-bold text-foreground/80">FlashSwap 流动性监控</span>
          <a href={bscScanUrl(FLASH_SWAP_ADDRESS)} target="_blank" rel="noopener noreferrer"
            className="text-[10px] font-mono text-primary/50 hover:text-primary flex items-center gap-0.5">
            {formatAddress(FLASH_SWAP_ADDRESS)}<ExternalLink className="h-2.5 w-2.5" />
          </a>
          {data?.paused && <Badge className="text-[9px] bg-red-500/10 text-red-400 border-red-500/20">已暂停</Badge>}
          {anyAlert && <Badge className="text-[9px] bg-red-500/10 text-red-400 border-red-500/20 animate-pulse">流动性不足</Badge>}
        </div>
        <button
          className="h-6 w-6 rounded flex items-center justify-center text-foreground/30 hover:text-foreground/60 hover:bg-white/[0.05] transition-colors"
          onClick={() => { fetchData(); onRefresh?.(); }}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && !data ? (
        <div className="p-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
        </div>
      ) : data ? (
        <div className="p-4 space-y-4">
          {/* Liquidity Pools */}
          <div>
            <p className="text-[10px] text-foreground/30 mb-2">流动性池余额</p>
            <div className="grid grid-cols-3 gap-2">
              <div className={`rounded-lg p-3 text-center border ${maLow ? "bg-red-500/5 border-red-500/20" : "bg-white/[0.02] border-white/[0.06]"}`}>
                <div className={`text-lg font-bold font-mono ${maLow ? "text-red-400" : "text-foreground/80"}`}>{data.maLiq}</div>
                <div className="text-[10px] text-foreground/30">MA Token</div>
                {maLow && <div className="text-[9px] text-red-400 mt-1">低于 {LIQUIDITY_ALERT_MA.toLocaleString()}</div>}
              </div>
              <div className={`rounded-lg p-3 text-center border ${usdtLow ? "bg-red-500/5 border-red-500/20" : "bg-white/[0.02] border-white/[0.06]"}`}>
                <div className={`text-lg font-bold font-mono ${usdtLow ? "text-red-400" : "text-foreground/80"}`}>${data.usdtLiq}</div>
                <div className="text-[10px] text-foreground/30">USDT</div>
                {usdtLow && <div className="text-[9px] text-red-400 mt-1">低于 ${LIQUIDITY_ALERT_USDT}</div>}
              </div>
              <div className={`rounded-lg p-3 text-center border ${usdcLow ? "bg-amber-500/5 border-amber-500/20" : "bg-white/[0.02] border-white/[0.06]"}`}>
                <div className={`text-lg font-bold font-mono ${usdcLow ? "text-amber-400" : "text-foreground/80"}`}>${data.usdcLiq}</div>
                <div className="text-[10px] text-foreground/30">USDC</div>
                {usdcLow && <div className="text-[9px] text-amber-400 mt-1">低于 ${LIQUIDITY_ALERT_USDT}</div>}
              </div>
            </div>
          </div>

          {/* Deposit Liquidity */}
          {account && (
            <div className="pt-3 border-t border-white/[0.04]">
              <p className="text-[10px] text-foreground/30 mb-2 flex items-center gap-1">
                <Plus className="h-3 w-3" /> 补充流动性
              </p>
              <div className="flex items-center gap-2">
                <select
                  value={depositToken}
                  onChange={(e) => setDepositToken(e.target.value as "USDT" | "MA")}
                  className="h-8 text-[11px] bg-background/50 border border-border/20 rounded px-2 text-foreground/70"
                >
                  <option value="USDT">USDT</option>
                  <option value="MA">MA</option>
                </select>
                <Input
                  type="number"
                  step="100"
                  min="1"
                  placeholder="数量"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="flex-1 h-8 text-[11px] font-mono"
                />
                <Button
                  size="sm"
                  className="h-8 text-[11px]"
                  disabled={!depositAmount || !!busy}
                  onClick={handleDeposit}
                >
                  {busy === "sending" ? (
                    <><RefreshCw className="h-3 w-3 mr-1 animate-spin" />转账中</>
                  ) : (
                    <><Send className="h-3 w-3 mr-1" />补充</>
                  )}
                </Button>
              </div>
              <p className="text-[9px] text-foreground/20 mt-1">从已连接钱包直接转账 {depositToken} 到 FlashSwap 合约</p>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2 text-center">
              <div className="text-sm font-bold font-mono text-foreground/70">{data.swapCount}</div>
              <div className="text-[9px] text-foreground/25">总交易数</div>
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2 text-center">
              <div className="text-sm font-bold font-mono text-foreground/70">{data.totalMAReceived}</div>
              <div className="text-[9px] text-foreground/25">收到 MA</div>
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2 text-center">
              <div className="text-sm font-bold font-mono text-foreground/70">${data.totalUSDTPaid}</div>
              <div className="text-[9px] text-foreground/25">支出 USDT</div>
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2 text-center">
              <div className="text-sm font-bold font-mono text-foreground/70">${data.totalFees}</div>
              <div className="text-[9px] text-foreground/25">累计手续费</div>
            </div>
          </div>

          {/* Config */}
          <div className="text-[10px] text-foreground/20 space-y-1 pt-2 border-t border-white/[0.04]">
            <div className="flex justify-between"><span>手续费</span><span>{data.feeBps} bps ({(data.feeBps / 100).toFixed(1)}%)</span></div>
            <div className="flex justify-between"><span>持仓规则</span><span>{data.holdingRuleBps} bps (保留{(data.holdingRuleBps / 100).toFixed(0)}%)</span></div>
            <div className="flex justify-between"><span>最低交换</span><span>{data.minSwap} 单位</span></div>
            <div className="flex justify-between"><span>警告阈值</span><span>MA &lt; {LIQUIDITY_ALERT_MA.toLocaleString()} / USDT &lt; ${LIQUIDITY_ALERT_USDT}</span></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Batch Gas Panel — monitor & send BNB to Server Wallets ──

function BatchGasPanel() {
  const { toast } = useToast();
  const { client } = useThirdwebClient();
  const account = useActiveAccount();
  const { mutateAsync: sendTx } = useSendTransaction();
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState("");
  const [sendAmount, setSendAmount] = useState("0.01");
  const [selectedWallets, setSelectedWallets] = useState<Set<string>>(new Set());

  const fetchBalances = useCallback(async () => {
    setLoading(true);
    try {
      const calls = SERVER_WALLETS.map((w) => ({
        jsonrpc: "2.0", method: "eth_getBalance", id: w.address,
        params: [w.address, "latest"],
      }));
      const res = await fetch(BSC_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(calls),
      });
      const results = await res.json();
      const map: Record<string, string> = {};
      for (const r of results) {
        const bnb = parseInt(r.result || "0x0", 16) / 1e18;
        map[r.id] = bnb.toFixed(4);
      }
      setBalances(map);

      // Auto-select wallets below threshold
      const lowWallets = new Set<string>();
      for (const w of SERVER_WALLETS) {
        if (parseFloat(map[w.address] || "0") < GAS_ALERT_THRESHOLD) {
          lowWallets.add(w.address);
        }
      }
      if (lowWallets.size > 0) setSelectedWallets(lowWallets);
    } catch (err: any) {
      toast({ title: "余额查询失败", description: err?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchBalances(); }, [fetchBalances]);

  const toggleWallet = (addr: string) => {
    setSelectedWallets((prev) => {
      const next = new Set(prev);
      if (next.has(addr)) next.delete(addr); else next.add(addr);
      return next;
    });
  };

  const selectAllLow = () => {
    const low = new Set<string>();
    for (const w of SERVER_WALLETS) {
      if (parseFloat(balances[w.address] || "0") < GAS_ALERT_THRESHOLD) low.add(w.address);
    }
    setSelectedWallets(low);
  };

  const selectAll = () => {
    if (selectedWallets.size === SERVER_WALLETS.length) {
      setSelectedWallets(new Set());
    } else {
      setSelectedWallets(new Set(SERVER_WALLETS.map(w => w.address)));
    }
  };

  const lowCount = SERVER_WALLETS.filter(w => parseFloat(balances[w.address] || "0") < GAS_ALERT_THRESHOLD).length;
  const totalCost = selectedWallets.size * parseFloat(sendAmount || "0");

  // Wallet-connected batch send
  const handleBatchSend = async () => {
    if (!client || !account || selectedWallets.size === 0) return;
    const targets = SERVER_WALLETS.filter(w => selectedWallets.has(w.address));
    setSending(true);
    let sent = 0;

    try {
      for (const w of targets) {
        setSendProgress(`${sent + 1}/${targets.length}: ${w.label}`);
        const tx = prepareTransaction({
          client,
          chain: bsc,
          to: w.address as `0x${string}`,
          value: toWei(sendAmount),
        });
        const result = await sendTx(tx);
        await waitForReceipt({ client, chain: bsc, transactionHash: result.transactionHash });
        sent++;
      }
      toast({ title: "批量发送完成", description: `${sent}/${targets.length} 个钱包，每个 ${sendAmount} BNB` });
      setTimeout(fetchBalances, 3000);
    } catch (err: any) {
      toast({
        title: `发送中断 (${sent}/${targets.length})`,
        description: err?.shortMessage || err?.message,
        variant: "destructive",
      });
    } finally {
      setSending(false);
      setSendProgress("");
    }
  };

  return (
    <div className={`rounded-xl border overflow-hidden ${lowCount > 0 ? "border-amber-500/20" : "border-green-500/15"}`}
      style={{ background: lowCount > 0 ? "rgba(245,158,11,0.02)" : "rgba(16,185,129,0.02)" }}>
      <div className="px-4 py-3 border-b border-amber-500/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Fuel className="h-4 w-4 text-amber-400" />
          <span className="text-[13px] font-bold text-foreground/80">Executor Gas 管理</span>
          {lowCount > 0 && (
            <Badge className="text-[9px] bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse">
              {lowCount} 个余额不足
            </Badge>
          )}
        </div>
        <button
          className="h-6 w-6 rounded flex items-center justify-center text-foreground/30 hover:text-foreground/60 hover:bg-white/[0.05] transition-colors"
          onClick={fetchBalances}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="p-4 space-y-3">
        {/* Wallet List */}
        <div className="space-y-1">
          {SERVER_WALLETS.map((w) => {
            const bal = parseFloat(balances[w.address] || "0");
            const isLow = bal < GAS_ALERT_THRESHOLD;
            const selected = selectedWallets.has(w.address);
            return (
              <div key={w.address}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  selected ? "bg-primary/5 border border-primary/20" : "hover:bg-white/[0.02] border border-transparent"
                }`}
                onClick={() => toggleWallet(w.address)}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleWallet(w.address)}
                  className="h-3.5 w-3.5 rounded accent-primary cursor-pointer"
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="text-[11px] text-foreground/50 flex-1">{w.label}</span>
                <a
                  href={bscScanUrl(w.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-mono text-primary/40 hover:text-primary flex items-center gap-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  {formatAddress(w.address)}<ExternalLink className="h-2.5 w-2.5" />
                </a>
                <span className={`text-[11px] font-mono font-bold min-w-[70px] text-right ${
                  isLow ? "text-red-400" : bal < 0.02 ? "text-amber-400" : "text-green-400"
                }`}>
                  {loading ? "..." : `${balances[w.address] || "0"} BNB`}
                </span>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-white/[0.04]">
          <button
            className="text-[10px] text-primary/60 hover:text-primary transition-colors"
            onClick={selectAll}
          >
            {selectedWallets.size === SERVER_WALLETS.length ? "取消全选" : "全选"}
          </button>
          <span className="text-foreground/10">|</span>
          <button
            className="text-[10px] text-amber-400/60 hover:text-amber-400 transition-colors"
            onClick={selectAllLow}
          >
            选择余额不足
          </button>
          <div className="flex-1" />
          <span className="text-[10px] text-foreground/25">每个</span>
          <input
            type="number"
            step="0.005"
            min="0.001"
            value={sendAmount}
            onChange={(e) => setSendAmount(e.target.value)}
            className="w-20 h-7 text-[11px] font-mono text-center bg-background/50 border border-border/20 rounded px-1"
          />
          <span className="text-[10px] text-foreground/25">BNB</span>
        </div>

        {account ? (
          <Button
            size="sm"
            disabled={selectedWallets.size === 0 || sending}
            className="w-full bg-amber-600 text-white hover:bg-amber-500"
            onClick={handleBatchSend}
          >
            {sending ? (
              <><RefreshCw className="h-3 w-3 mr-1 animate-spin" />{sendProgress}</>
            ) : (
              <><Send className="h-3 w-3 mr-1" />发送 Gas ({selectedWallets.size} 个钱包，共 {totalCost.toFixed(4)} BNB)</>
            )}
          </Button>
        ) : (
          <p className="text-[10px] text-foreground/25 text-center py-1">请先连接钱包</p>
        )}

        <p className="text-[9px] text-foreground/20 text-center">
          通过已连接钱包逐笔发送 BNB。阈值: {GAS_ALERT_THRESHOLD} BNB
        </p>
      </div>
    </div>
  );
}

// ── Oracle Admin Panel — write operations via thirdweb Executor Wallet ──

const THIRDWEB_SECRET = import.meta.env.VITE_THIRDWEB_SECRET_KEY || "";
const THIRDWEB_VAULT_TOKEN = import.meta.env.VITE_THIRDWEB_VAULT_TOKEN || "";
const EXECUTOR_ADDR = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";
const FEEDER_ROLE_HASH = "0x80a586cc4ecf40a390b370be075aa38ab3cc512c5c1a7bc1007974dbdf2663c7";

async function callExecutor(calls: { contractAddress: string; method: string; params: string[] }[]) {
  const res = await fetch("https://api.thirdweb.com/v1/contracts/write", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-secret-key": THIRDWEB_SECRET, "x-vault-access-token": THIRDWEB_VAULT_TOKEN },
    body: JSON.stringify({ chainId: 56, from: EXECUTOR_ADDR, calls }),
  });
  return res.json();
}

function OracleAdminPanel({ onPriceUpdated }: { onPriceUpdated: () => void }) {
  const { toast } = useToast();
  const [newPrice, setNewPrice] = useState("");
  const [maxChangeRate, setMaxChangeRate] = useState("");
  const [grantAddress, setGrantAddress] = useState(EXECUTOR_ADDR);
  const [busy, setBusy] = useState("");

  const exec = async (label: string, calls: { contractAddress: string; method: string; params: string[] }[]) => {
    setBusy(label);
    try {
      const data = await callExecutor(calls);
      const txId = data?.result?.transactionIds?.[0];
      if (txId) {
        toast({ title: `${label} 已提交`, description: `TX: ${txId}` });
        setTimeout(onPriceUpdated, 8000);
      } else {
        toast({ title: `${label} 失败`, description: JSON.stringify(data.error || data), variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "错误", description: e.message, variant: "destructive" });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="rounded-xl border border-amber-500/15 overflow-hidden" style={{ background: "rgba(234,179,8,0.02)" }}>
      <div className="px-4 py-3 border-b border-amber-500/10 flex items-center gap-2">
        <Zap className="h-4 w-4 text-amber-400" />
        <span className="text-[13px] font-bold text-foreground/80">Oracle 管理操作</span>
        <Badge className="text-[9px] bg-amber-500/10 text-amber-400 border-amber-500/20">Executor</Badge>
      </div>
      <div className="p-4 space-y-4">
        {/* Emergency Set Price */}
        <div>
          <label className="text-[11px] text-foreground/40 mb-1 block">紧急设置价格 (emergencySetPrice)</label>
          <div className="flex gap-2">
            <Input
              type="number"
              step="0.0001"
              placeholder="输入美元价格 (如 0.53)"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              className="text-sm font-mono"
            />
            <Button
              size="sm"
              disabled={!newPrice || !!busy}
              onClick={() => {
                const raw = Math.round(parseFloat(newPrice) * 1e6);
                exec("设置价格", [{
                  contractAddress: PRICE_ORACLE_ADDRESS,
                  method: "function emergencySetPrice(uint256 _price)",
                  params: [raw.toString()],
                }]);
              }}
            >
              {busy === "设置价格" ? "提交中..." : "设置"}
            </Button>
          </div>
          <p className="text-[9px] text-foreground/20 mt-1">绕过涨跌幅限制，立即生效。6位精度（530000 = $0.53）</p>
        </div>

        {/* Set Max Change Rate */}
        <div>
          <label className="text-[11px] text-foreground/40 mb-1 block">设置最大涨跌幅 (setMaxChangeRate)</label>
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="基点 (5000 = 50%)"
              value={maxChangeRate}
              onChange={(e) => setMaxChangeRate(e.target.value)}
              className="text-sm font-mono"
            />
            <Button
              size="sm"
              disabled={!maxChangeRate || !!busy}
              onClick={() => exec("设置涨跌幅", [{
                contractAddress: PRICE_ORACLE_ADDRESS,
                method: "function setMaxChangeRate(uint256 _bps)",
                params: [maxChangeRate],
              }])}
            >
              {busy === "设置涨跌幅" ? "提交中..." : "设置"}
            </Button>
          </div>
          <p className="text-[9px] text-foreground/20 mt-1">1000=10%, 5000=50%。影响 updatePrice 的单次最大变化</p>
        </div>

        {/* Grant FEEDER_ROLE */}
        <div>
          <label className="text-[11px] text-foreground/40 mb-1 block">授权 FEEDER_ROLE (grantRole)</label>
          <div className="flex gap-2">
            <Input
              type="text"
              placeholder="钱包地址"
              value={grantAddress}
              onChange={(e) => setGrantAddress(e.target.value)}
              className="text-sm font-mono"
            />
            <Button
              size="sm"
              disabled={!grantAddress || !!busy}
              onClick={() => exec("授权FEEDER", [{
                contractAddress: PRICE_ORACLE_ADDRESS,
                method: "function grantRole(bytes32 role, address account)",
                params: [FEEDER_ROLE_HASH, grantAddress],
              }])}
            >
              {busy === "授权FEEDER" ? "提交中..." : "授权"}
            </Button>
          </div>
          <p className="text-[9px] text-foreground/20 mt-1">默认填中继器地址。FEEDER 可调用 updatePrice</p>
        </div>

        {/* Quick Sync */}
        <div className="pt-2 border-t border-white/[0.04]">
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy}
            className="w-full text-amber-400 border-amber-500/20 hover:bg-amber-500/10"
            onClick={async () => {
              // Trigger price feed edge function
              setBusy("同步");
              try {
                const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ma-price-feed`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                  },
                  body: "{}",
                });
                const data = await res.json();
                toast({
                  title: "价格同步",
                  description: `${data.onChainBefore || data.prevPrice} → ${data.target || data.newPrice} (${data.status})`,
                });
                setTimeout(onPriceUpdated, 8000);
              } catch (e: any) {
                toast({ title: "同步失败", description: e.message, variant: "destructive" });
              } finally {
                setBusy("");
              }
            }}
          >
            {busy === "同步" ? "同步中..." : "立即同步 K 线价格 → Oracle"}
          </Button>
          <p className="text-[9px] text-foreground/20 mt-1 text-center">
            触发 ma-price-feed，通过中继器 {EXECUTOR_ADDR.slice(0, 6)}...{EXECUTOR_ADDR.slice(-4)} 调用 updatePrice
          </p>
        </div>

        {/* Info */}
        <div className="text-[10px] text-foreground/20 space-y-1 pt-2 border-t border-white/[0.04]">
          <div className="flex justify-between"><span>Executor 中继器</span><span className="font-mono">{EXECUTOR_ADDR.slice(0, 6)}...{EXECUTOR_ADDR.slice(-4)}</span></div>
          <div className="flex justify-between"><span>中继器 (Feeder)</span><span className="font-mono">{EXECUTOR_ADDR.slice(0, 6)}...{EXECUTOR_ADDR.slice(-4)}</span></div>
          <div className="flex justify-between"><span>Oracle 合约</span><span className="font-mono">{PRICE_ORACLE_ADDRESS.slice(0, 6)}...{PRICE_ORACLE_ADDRESS.slice(-4)}</span></div>
          <div className="flex justify-between"><span>自动同步</span><span>Cron 每 5 分钟</span></div>
        </div>
      </div>
    </div>
  );
}

// ── Cross-Chain Bridge Panel ──

function CrossChainPanel() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [bridgeBalance, setBridgeBalance] = useState<string | null>(null);

  const checkBridgeBalance = async () => {
    try {
      const res = await fetch("https://bsc-dataseed1.binance.org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", method: "eth_call", id: 1,
          params: [{ to: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", data: "0x70a08231000000000000000000000000" + BATCH_BRIDGE_ADDRESS.slice(2).toLowerCase() }, "latest"],
        }),
      });
      const d = await res.json();
      setBridgeBalance((parseInt(d.result || "0x0", 16) / 1e18).toFixed(2));
    } catch { setBridgeBalance("error"); }
  };

  useEffect(() => { checkBridgeBalance(); }, []);

  const handleManualBridge = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/batch-bridge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      toast({ title: "BatchBridge", description: data.error ? `失败: ${data.error}` : `成功: ${data.bridged || data.status || "OK"}` });
      setTimeout(checkBridgeBalance, 15000);
    } catch (e: any) {
      toast({ title: "跨链失败", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleManualNodeFlush = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/flush-node-pool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      toast({ title: "NodePool Flush", description: data.error ? `失败: ${data.error}` : `成功: ${data.flushed || data.status || "OK"}` });
    } catch (e: any) {
      toast({ title: "Flush 失败", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-indigo-500/15 overflow-hidden" style={{ background: "rgba(99,102,241,0.02)" }}>
      <div className="px-4 py-3 border-b border-indigo-500/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-indigo-400" />
          <span className="text-[13px] font-bold text-foreground/80">跨链 & 资金管理</span>
        </div>
        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={checkBridgeBalance}>
          <RefreshCw className="h-3 w-3 mr-1" />刷新
        </Button>
      </div>
      <div className="p-4 space-y-3">
        {/* BatchBridge USDC balance */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-white/[0.05]">
          <div>
            <div className="text-[11px] text-foreground/50">BatchBridge 待跨链 USDC</div>
            <div className="text-[10px] text-foreground/30 font-mono">{BATCH_BRIDGE_ADDRESS.slice(0,6)}...{BATCH_BRIDGE_ADDRESS.slice(-4)}</div>
          </div>
          <div className="text-[16px] font-bold font-mono text-indigo-400">
            ${bridgeBalance !== null ? bridgeBalance : "..."}
          </div>
        </div>

        {/* Cron status */}
        <div className="text-[10px] text-foreground/30 space-y-1">
          <div className="flex justify-between"><span>BSC→ARB 跨链</span><span>Cron 每 4 小时 (Stargate)</span></div>
          <div className="flex justify-between"><span>NodePool 归集</span><span>Cron 每 30 分钟 → 0xeb8A</span></div>
          <div className="flex justify-between"><span>MA 价格喂价</span><span>Cron 每 5 分钟</span></div>
          <div className="flex justify-between"><span>每日结算</span><span>每天 00:00 UTC</span></div>
        </div>

        {/* Manual triggers */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            disabled={busy}
            className="bg-indigo-600 text-white hover:bg-indigo-500 text-[10px]"
            onClick={handleManualBridge}
          >
            {busy ? "执行中..." : "手动跨链 BSC→ARB"}
          </Button>
          <Button
            size="sm"
            disabled={busy}
            variant="outline"
            className="text-[10px]"
            onClick={handleManualNodeFlush}
          >
            {busy ? "执行中..." : "手动 NodePool Flush"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Vault Flow Diagram ──

// ── Cron Jobs Panel (editable) ──

const CRON_DESCRIPTIONS: Record<string, string> = {
  "simulate-trading-5min": "AI策略模拟开单",
  "resolve-predictions-5min": "预测结算",
  "adjust-weights-hourly": "模型权重调整",
  "close-expired-paper-trades": "关闭过期模拟单",
  "batch-bridge": "BSC→ARB Stargate跨链",
  "flush-node-pool": "NodePool→节点钱包",
  "ma-price-feed": "Oracle MA价格喂价",
  "daily-settlement": "利息结算+等级检查",
  "copy-trade-executor": "跟单执行下单",
  "copy-trade-notify": "Telegram推送",
};

function CronPanel() {
  const { toast } = useToast();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingJob, setEditingJob] = useState<string | null>(null);
  const [editSchedule, setEditSchedule] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_cron_jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: "{}",
      });
      if (res.ok) {
        const data = await res.json();
        setJobs(Array.isArray(data) ? data : []);
      } else {
        // Fallback: try direct query
        setJobs([]);
      }
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchJobs(); }, []);

  const handleSaveSchedule = async (jobName: string) => {
    setSaving(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      await fetch(`${supabaseUrl}/rest/v1/rpc/update_cron_schedule`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ job_name: jobName, new_schedule: editSchedule }),
      });
      toast({ title: "已更新", description: `${jobName} → ${editSchedule}` });
      setEditingJob(null);
      fetchJobs();
    } catch (e: any) {
      toast({ title: "更新失败", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleTrigger = async (jobName: string) => {
    // Find the edge function URL from the job command
    const job = jobs.find(j => j.jobname === jobName);
    const fnMatch = job?.command?.match(/functions\/v1\/([a-z-]+)/);
    if (fnMatch) {
      try {
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fnMatch[1]}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const data = await res.json();
        toast({ title: `${fnMatch[1]}`, description: data.error ? `失败: ${data.error}` : "已触发" });
      } catch (e: any) {
        toast({ title: "触发失败", description: e.message, variant: "destructive" });
      }
    } else {
      toast({ title: "无法触发", description: "非 edge function 任务", variant: "destructive" });
    }
  };

  return (
    <div className="rounded-xl border border-purple-500/15 overflow-hidden" style={{ background: "rgba(147,51,234,0.02)" }}>
      <div className="px-4 py-3 border-b border-purple-500/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-purple-400" />
          <span className="text-[13px] font-bold text-foreground/80">Cron 定时任务</span>
          <Badge className="text-[9px] bg-purple-500/10 text-purple-400 border-purple-500/20">{jobs.length}</Badge>
        </div>
        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={fetchJobs}>
          <RefreshCw className="h-3 w-3 mr-1" />刷新
        </Button>
      </div>
      <div className="divide-y divide-white/[0.03]">
        {loading ? (
          <div className="p-4 text-[11px] text-foreground/30">加载中...</div>
        ) : jobs.length === 0 ? (
          <div className="p-4 space-y-2">
            <p className="text-[11px] text-foreground/30">无法读取 cron 任务（需要 RPC 函数）</p>
            <p className="text-[10px] text-foreground/20">请在 Supabase SQL Editor 执行以下函数：</p>
            <pre className="text-[9px] text-foreground/20 bg-white/[0.02] p-2 rounded overflow-x-auto">{`CREATE OR REPLACE FUNCTION get_cron_jobs()
RETURNS TABLE(jobid bigint, jobname text, schedule text, command text, active boolean)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT jobid, jobname, schedule, command, active FROM cron.job ORDER BY jobname;
$$;

CREATE OR REPLACE FUNCTION update_cron_schedule(job_name text, new_schedule text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE cron.job SET schedule = new_schedule WHERE jobname = job_name;
END;
$$;`}</pre>
          </div>
        ) : (
          jobs.map((job: any) => (
            <div key={job.jobid} className="px-4 py-2.5 flex items-center gap-3">
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${job.active !== false ? "bg-green-400" : "bg-red-400"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-foreground/70 truncate">{job.jobname}</span>
                  <span className="text-[9px] text-foreground/25">{CRON_DESCRIPTIONS[job.jobname] || ""}</span>
                </div>
                {editingJob === job.jobname ? (
                  <div className="flex items-center gap-1.5 mt-1">
                    <Input
                      value={editSchedule}
                      onChange={(e) => setEditSchedule(e.target.value)}
                      className="h-6 text-[10px] font-mono w-32 px-1.5"
                      placeholder="*/5 * * * *"
                    />
                    <Button size="sm" className="h-6 text-[9px] px-2" disabled={saving} onClick={() => handleSaveSchedule(job.jobname)}>
                      {saving ? "..." : "保存"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 text-[9px] px-1.5" onClick={() => setEditingJob(null)}>取消</Button>
                  </div>
                ) : (
                  <span className="text-[10px] font-mono text-foreground/30">{job.schedule}</span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm" variant="ghost" className="h-6 text-[9px] px-1.5 text-foreground/30 hover:text-foreground/60"
                  onClick={() => { setEditingJob(job.jobname); setEditSchedule(job.schedule); }}
                >
                  编辑
                </Button>
                <Button
                  size="sm" variant="ghost" className="h-6 text-[9px] px-1.5 text-purple-400 hover:text-purple-300"
                  onClick={() => handleTrigger(job.jobname)}
                >
                  触发
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function VaultFlowDiagram() {
  return (
    <FlowDiagram
      title="金库存入链路"
      icon={<Wallet className="h-4 w-4 text-primary/60" />}
      flows={[
        { label: "存入: 用户USDT → Vault.depositPublic() → 累积跨链", steps: [
          { label: "用户", addr: "USDT (BSC)", color: "text-blue-400", bg: "bg-blue-500/10" },
          { label: "Vault", addr: formatAddress(VAULT_V3_ADDRESS), fullAddr: VAULT_V3_ADDRESS, color: "text-primary", bg: "bg-primary/10" },
          { label: "BatchBridgeV2", addr: formatAddress("0x5BDc4220Ea06CfaD6B42fD1c69ce4D2BAA46C0Db"), fullAddr: "0x5BDc4220Ea06CfaD6B42fD1c69ce4D2BAA46C0Db", color: "text-emerald-400", bg: "bg-emerald-500/10" },
        ]},
        { label: "Vault内部: USDT→cUSD记账 + Oracle定价 → mint MA锁仓", steps: [
          { label: "mint cUSD", addr: formatAddress("0x90B99a1495E5DBf8bF44c3623657020BB1BDa3C6"), fullAddr: "0x90B99a1495E5DBf8bF44c3623657020BB1BDa3C6", color: "text-cyan-400", bg: "bg-cyan-500/10" },
          { label: "Oracle", addr: formatAddress(PRICE_ORACLE_ADDRESS), fullAddr: PRICE_ORACLE_ADDRESS, color: "text-amber-400", bg: "bg-amber-500/10" },
          { label: "mint MA", addr: formatAddress(MA_TOKEN_ADDRESS), fullAddr: MA_TOKEN_ADDRESS, color: "text-yellow-400", bg: "bg-yellow-500/10" },
          { label: "锁仓", addr: "5/45/90/180天", color: "text-green-400", bg: "bg-green-500/10" },
        ]},
        { label: "跨链(4h cron): BatchBridgeV2 swap USDT→USDC → Stargate → ARB", steps: [
          { label: "BatchBridgeV2", addr: formatAddress("0x5BDc4220Ea06CfaD6B42fD1c69ce4D2BAA46C0Db"), fullAddr: "0x5BDc4220Ea06CfaD6B42fD1c69ce4D2BAA46C0Db", color: "text-emerald-400", bg: "bg-emerald-500/10" },
          { label: "PancakeSwap", addr: "USDT→USDC (0.01%)", fullAddr: "0x92b7807bF19b7DDdf89b706143896d05228f3121", color: "text-pink-400", bg: "bg-pink-500/10" },
          { label: "Stargate", addr: "USDC桥接→ARB", color: "text-indigo-400", bg: "bg-indigo-500/10" },
          { label: "FundRouter", addr: formatAddress(ARB_FUND_ROUTER_ADDRESS), fullAddr: ARB_FUND_ROUTER_ADDRESS, color: "text-blue-400", bg: "bg-blue-500/10" },
          { label: "5钱包", addr: "30/8/12/20/30%", color: "text-green-400", bg: "bg-green-500/10" },
        ]},
        { label: "赎回: 到期100% / 提前80%+20%销毁 → 触发等级检查", steps: [
          { label: "Vault", addr: formatAddress(VAULT_V3_ADDRESS), fullAddr: VAULT_V3_ADDRESS, color: "text-primary", bg: "bg-primary/10" },
          { label: "到期", addr: "100% MA→钱包", color: "text-green-400", bg: "bg-green-500/10" },
          { label: "提前", addr: "80% MA→钱包", color: "text-yellow-400", bg: "bg-yellow-500/10" },
          { label: "降级检查", addr: "recheck_ranks", color: "text-red-400", bg: "bg-red-500/10" },
        ]},
      ]}
    />
  );
}

function FlashSwapFlowDiagram() {
  return (
    <FlowDiagram
      title="MA 闪兑链路"
      icon={<ArrowRightLeft className="h-4 w-4 text-cyan-400/60" />}
      flows={[
        { label: "卖出: MA → FlashSwap → USDT (Oracle定价)", steps: [
          { label: "用户", addr: "MA Token", color: "text-blue-400", bg: "bg-blue-500/10" },
          { label: "50%规则", addr: "必须保留一半", color: "text-amber-400", bg: "bg-amber-500/10" },
          { label: "FlashSwap", addr: formatAddress(FLASH_SWAP_ADDRESS), fullAddr: FLASH_SWAP_ADDRESS, color: "text-cyan-400", bg: "bg-cyan-500/10" },
          { label: "USDT", addr: "Oracle价格-0.3%", color: "text-green-400", bg: "bg-green-500/10" },
        ]},
        { label: "买入: USDT → FlashSwap → MA", steps: [
          { label: "用户", addr: "USDT", color: "text-blue-400", bg: "bg-blue-500/10" },
          { label: "FlashSwap", addr: "扣0.3%手续费", fullAddr: FLASH_SWAP_ADDRESS, color: "text-cyan-400", bg: "bg-cyan-500/10" },
          { label: "Oracle", addr: formatAddress(PRICE_ORACLE_ADDRESS), fullAddr: PRICE_ORACLE_ADDRESS, color: "text-amber-400", bg: "bg-amber-500/10" },
          { label: "MA", addr: "按价格计算", color: "text-green-400", bg: "bg-green-500/10" },
        ]},
      ]}
    />
  );
}

function NodeFlowDiagram() {
  return (
    <FlowDiagram
      title="节点购买链路"
      icon={<Zap className="h-4 w-4 text-green-400/60" />}
      flows={[
        { label: "购买: USDT → Vault.purchaseNodePublic() → 跨链 → ARB → 节点钱包", steps: [
          { label: "用户", addr: "USDT (MINI=$100/MAX=$600)", color: "text-blue-400", bg: "bg-blue-500/10" },
          { label: "Vault", addr: formatAddress(VAULT_V3_ADDRESS), fullAddr: VAULT_V3_ADDRESS, color: "text-primary", bg: "bg-primary/10" },
          { label: "BatchBridgeV2", addr: formatAddress("0x5BDc4220Ea06CfaD6B42fD1c69ce4D2BAA46C0Db"), fullAddr: "0x5BDc4220Ea06CfaD6B42fD1c69ce4D2BAA46C0Db", color: "text-emerald-400", bg: "bg-emerald-500/10" },
          { label: "4h cron", addr: "swap+Stargate→ARB", color: "text-indigo-400", bg: "bg-indigo-500/10" },
          { label: "API分发", addr: "→节点钱包", color: "text-amber-400", bg: "bg-amber-500/10" },
        ]},
        { label: "激活: 金库存入达标 → 等级升级", steps: [
          { label: "金库存入", addr: "≥100U", color: "text-cyan-400", bg: "bg-cyan-500/10" },
          { label: "DB trigger", addr: "check_rank", color: "text-amber-400", bg: "bg-amber-500/10" },
          { label: "V1→V7", addr: "实时升级", color: "text-green-400", bg: "bg-green-500/10" },
        ]},
      ]}
    />
  );
}

function VIPFlowDiagram() {
  return (
    <FlowDiagram
      title="VIP 购买链路 (x402)"
      icon={<Shield className="h-4 w-4 text-amber-400/60" />}
      flows={[
        { label: "x402: 前端 → 402响应 → 钱包授权 → 支付", steps: [
          { label: "前端", addr: "fetchWithPayment", color: "text-blue-400", bg: "bg-blue-500/10" },
          { label: "vip-subscribe", addr: "HTTP 402", color: "text-amber-400", bg: "bg-amber-500/10" },
          { label: "thirdweb", addr: "钱包签名", color: "text-purple-400", bg: "bg-purple-500/10" },
          { label: "ARB USDC", addr: "支付结算", color: "text-indigo-400", bg: "bg-indigo-500/10" },
        ]},
        { label: "激活: 验证 → subscribe_vip → VIP 生效", steps: [
          { label: "验证", addr: "x402 settle", color: "text-cyan-400", bg: "bg-cyan-500/10" },
          { label: "DB RPC", addr: "subscribe_vip", color: "text-green-400", bg: "bg-green-500/10" },
          { label: "用户", addr: "is_vip=true", color: "text-yellow-400", bg: "bg-yellow-500/10" },
        ]},
      ]}
    />
  );
}

function ReleaseFlowDiagram() {
  const planSteps = [
    { label: "用户", addr: "选择释放方案", color: "text-blue-400", bg: "bg-blue-500/10" },
    { label: "Release合约", addr: "createRelease()", color: "text-cyan-400", bg: "bg-cyan-500/10" },
    { label: "MA 拆分", addr: "释放% + 销毁%", color: "text-amber-400", bg: "bg-amber-500/10" },
    { label: "销毁", addr: "burn() 立即执行", color: "text-red-400", bg: "bg-red-500/10" },
  ];
  const vestSteps = [
    { label: "线性释放", addr: "每天可领取", color: "text-green-400", bg: "bg-green-500/10" },
    { label: "claimAll()", addr: "领取已解锁", color: "text-emerald-400", bg: "bg-emerald-500/10" },
    { label: "MA转账", addr: "→ 用户钱包", color: "text-primary", bg: "bg-primary/10" },
  ];
  const plans = [
    { label: "80%即时", desc: "20%销毁, 0天", color: "text-green-400" },
    { label: "85%/7天", desc: "15%销毁", color: "text-emerald-400" },
    { label: "90%/15天", desc: "10%销毁", color: "text-cyan-400" },
    { label: "95%/30天", desc: "5%销毁", color: "text-blue-400" },
    { label: "100%/60天", desc: "0%销毁", color: "text-purple-400" },
  ];

  return (
    <div className="rounded-xl border border-white/[0.06] overflow-hidden" style={{ background: "rgba(255,255,255,0.01)" }}>
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-400/60" />
        <span className="text-[13px] font-bold text-foreground/80">MA 盈利释放链路</span>
      </div>
      <div className="p-4 space-y-4">
        <FlowDiagram title="" icon={null} flows={[
          { label: "释放流程", steps: planSteps },
          { label: "线性领取", steps: vestSteps },
        ]} />
        <div>
          <p className="text-[10px] text-foreground/30 mb-2">释放方案</p>
          <div className="flex flex-wrap gap-1.5">
            {plans.map((p, i) => (
              <div key={i} className="px-2 py-1 rounded-lg bg-white/[0.02] border border-white/[0.06] text-center">
                <div className={`text-[10px] font-bold ${p.color}`}>{p.label}</div>
                <div className="text-[8px] text-foreground/20">{p.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FlowDiagram({ title, icon, flows }: {
  title: string;
  icon: React.ReactNode;
  flows: { label: string; steps: { label: string; addr: string; fullAddr?: string; color: string; bg: string }[] }[];
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] overflow-hidden" style={{ background: "rgba(255,255,255,0.01)" }}>
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
        {icon}
        <span className="text-[13px] font-bold text-foreground/80">{title}</span>
      </div>
      <div className="p-4 space-y-4">
        {flows.map((flow, fi) => (
          <div key={fi}>
            <p className="text-[10px] text-foreground/30 mb-2">{flow.label}</p>
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {flow.steps.map((s, i) => (
                <div key={i} className="flex items-center shrink-0">
                  <div className={`px-2 py-1.5 rounded-lg ${s.bg} text-center`}>
                    <div className={`text-[10px] font-bold ${s.color}`}>{s.label}</div>
                    {s.fullAddr ? (
                      <a href={`https://bscscan.com/address/${s.fullAddr}`} target="_blank" rel="noopener noreferrer" className="text-[8px] text-primary/50 hover:text-primary font-mono flex items-center justify-center gap-0.5">
                        {s.addr} <ExternalLink className="h-2 w-2" />
                      </a>
                    ) : (
                      <div className="text-[8px] text-foreground/25 font-mono">{s.addr}</div>
                    )}
                  </div>
                  {i < flow.steps.length - 1 && <span className="text-[10px] text-foreground/15 mx-0.5">→</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
