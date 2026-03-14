import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCode2, Save, Lock, RefreshCw, ExternalLink, ChevronDown, ChevronRight, Shield, Zap, Wallet, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { adminGetContractConfigs, adminUpdateContractConfig, adminAddLog } from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { useThirdwebClient } from "@/hooks/use-thirdweb";
import { readContract, getContract } from "thirdweb";
import { bsc } from "thirdweb/chains";
import {
  SWAP_ROUTER_ADDRESS,
  NODE_V2_CONTRACT_ADDRESS,
  NODE_CONTRACT_ADDRESS,
  USDT_ADDRESS,
  USDC_ADDRESS,
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

      {/* On-chain Contract Configurations (superadmin only) */}
      {isSuperAdmin && client && (
        <div className="space-y-3">
          <h2 className="text-[13px] font-bold text-foreground/50 uppercase tracking-wider flex items-center gap-2">
            <Shield className="h-3.5 w-3.5" />
            链上合约配置
          </h2>

          {SWAP_ROUTER_ADDRESS && (
            <ContractSection
              title="SwapRouter (V2)"
              icon={<ArrowRightLeft className="h-4 w-4 text-blue-400" />}
              address={SWAP_ROUTER_ADDRESS}
              items={swapRouter.data}
              loading={swapRouter.loading}
              error={swapRouter.error}
              onRefresh={swapRouter.refresh}
            />
          )}

          {NODE_V2_CONTRACT_ADDRESS && (
            <ContractSection
              title="NodesV2 节点合约"
              icon={<Zap className="h-4 w-4 text-green-400" />}
              address={NODE_V2_CONTRACT_ADDRESS}
              items={nodesV2.data}
              loading={nodesV2.loading}
              error={nodesV2.error}
              onRefresh={nodesV2.refresh}
            />
          )}

          {NODE_CONTRACT_ADDRESS && (
            <ContractSection
              title="NodesV1 节点合约"
              icon={<Zap className="h-4 w-4 text-yellow-400" />}
              address={NODE_CONTRACT_ADDRESS}
              items={nodesV1.data}
              loading={nodesV1.loading}
              error={nodesV1.error}
              onRefresh={nodesV1.refresh}
              defaultOpen={false}
            />
          )}

          {FUND_MANAGER_ADDRESS && (
            <ContractSection
              title="资金分配合约"
              icon={<Wallet className="h-4 w-4 text-purple-400" />}
              address={FUND_MANAGER_ADDRESS}
              items={fundManager.data}
              loading={fundManager.loading}
              error={fundManager.error}
              onRefresh={fundManager.refresh}
            />
          )}

          {/* Deployed addresses summary */}
          <ContractSection
            title="已部署合约地址"
            icon={<FileCode2 className="h-4 w-4 text-foreground/40" />}
            address=""
            items={[
              { label: "USDT (BSC)", value: USDT_ADDRESS, type: "address" },
              { label: "USDC (BSC)", value: USDC_ADDRESS, type: "address" },
              { label: "SwapRouter V2", value: SWAP_ROUTER_ADDRESS || "未配置", type: SWAP_ROUTER_ADDRESS ? "address" : "text" },
              { label: "NodesV2", value: NODE_V2_CONTRACT_ADDRESS || "未配置", type: NODE_V2_CONTRACT_ADDRESS ? "address" : "text" },
              { label: "NodesV1", value: NODE_CONTRACT_ADDRESS || "未配置", type: NODE_CONTRACT_ADDRESS ? "address" : "text" },
              { label: "FundManager", value: FUND_MANAGER_ADDRESS, type: "address" },
            ]}
            loading={false}
            onRefresh={() => {}}
            defaultOpen={false}
          />
        </div>
      )}

      {/* Database Config Section */}
      <div className="space-y-3">
        <h2 className="text-[13px] font-bold text-foreground/50 uppercase tracking-wider">
          数据库配置
        </h2>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
          </div>
        ) : (
          <div className="space-y-3">
            {(configs ?? []).map((cfg: any) => {
              const editVal = editValues[cfg.key];
              const isEditing = editVal !== undefined;
              const currentVal = isEditing ? editVal : cfg.value;
              const hasChanged = isEditing && editVal !== cfg.value;

              return (
                <div
                  key={cfg.key}
                  className="rounded-xl border border-border/15 p-3 lg:p-4 transition-colors"
                  style={{ background: hasChanged ? "rgba(10,186,181,0.03)" : "rgba(255,255,255,0.01)" }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-foreground/70">{cfg.key}</span>
                      {cfg.description && (
                        <span className="text-[10px] text-foreground/25">({cfg.description})</span>
                      )}
                    </div>
                    {cfg.updated_by && (
                      <span className="text-[9px] text-foreground/20">
                        {cfg.updated_by} · {new Date(cfg.updated_at).toLocaleDateString("zh-CN")}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Input
                      value={currentVal}
                      onChange={(e) => setEditValues((prev) => ({ ...prev, [cfg.key]: e.target.value }))}
                      className="flex-1 h-9 text-xs font-mono bg-background/50 border-border/20"
                      disabled={isReadOnly}
                      placeholder="未配置"
                    />
                    {canEdit && hasChanged && (
                      <Button
                        size="sm"
                        className="h-9 shrink-0"
                        onClick={() => handleSave(cfg.key)}
                        disabled={saving === cfg.key}
                      >
                        <Save className="h-3.5 w-3.5 mr-1" />
                        {saving === cfg.key ? "保存中..." : "保存"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
