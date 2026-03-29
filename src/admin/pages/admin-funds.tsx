/**
 * Admin Fund Details — Comprehensive fund flow tracking
 *
 * Tabs:
 * 1. 合约余额: On-chain USDT/USDC/MA balances across all active contracts
 * 2. 资金流转: Vault deposits → SwapRouter → Vault → BatchBridge flow
 * 3. 跨链记录: BatchBridge → Stargate → ARB FundRouter cycles
 * 4. 闪兑记录: FlashSwap MA↔USDT trades
 * 5. 交易流水: All transactions with filters + search
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAdminAuth } from "@/admin/admin-auth";
import { useThirdwebClient } from "@/hooks/use-thirdweb";
import { readContract, getContract } from "thirdweb";
import { bsc } from "thirdweb/chains";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  SWAP_ROUTER_ADDRESS, VAULT_V3_ADDRESS, ENGINE_ADDRESS,
  RELEASE_ADDRESS, USDT_ADDRESS, USDC_ADDRESS, MA_TOKEN_ADDRESS,
  BATCH_BRIDGE_ADDRESS, FLASH_SWAP_ADDRESS, PRICE_ORACLE_ADDRESS,
  NODE_V2_CONTRACT_ADDRESS,
} from "@/lib/contracts";
import {
  Coins, RefreshCw, Search, ArrowDownToLine, ArrowUpFromLine,
  Sparkles, ShieldCheck, Server, Gift, ExternalLink, Globe,
  Wallet, ArrowRightLeft, Database, TrendingUp, Zap,
} from "lucide-react";

// ── Addresses ──
const NODE_POOL = "0x7dE393D02C153cF943E0cf30C7B2B7A073E5e75a";
const NODE_WALLET = "0xeb8AbD9b47F9Ca0d20e22636B2004B75E84BdcD9";
const CUSD_ADDRESS = "0x90B99a1495E5DBf8bF44c3623657020BB1BDa3C6";

// ── On-chain balance reading ──

const BALANCE_ABI = "function balanceOf(address) view returns (uint256)";

function useOnChainBalances() {
  const { client } = useThirdwebClient();

  return useQuery({
    queryKey: ["admin", "funds", "balances"],
    queryFn: async () => {
      if (!client) return [];
      const tokens = [
        { addr: USDT_ADDRESS, symbol: "USDT", decimals: 18 },
        { addr: USDC_ADDRESS, symbol: "USDC", decimals: 18 },
        { addr: MA_TOKEN_ADDRESS, symbol: "MA", decimals: 18 },
        { addr: CUSD_ADDRESS, symbol: "cUSD", decimals: 18 },
      ];
      const contracts = [
        { addr: SWAP_ROUTER_ADDRESS, label: "SwapRouter (入口)", icon: ArrowRightLeft, chain: "BSC" },
        { addr: VAULT_V3_ADDRESS, label: "Vault (金库)", icon: Database, chain: "BSC" },
        { addr: ENGINE_ADDRESS, label: "Engine (利息)", icon: TrendingUp, chain: "BSC" },
        { addr: RELEASE_ADDRESS, label: "Release (释放)", icon: Sparkles, chain: "BSC" },
        { addr: FLASH_SWAP_ADDRESS, label: "FlashSwap (闪兑)", icon: Zap, chain: "BSC" },
        { addr: BATCH_BRIDGE_ADDRESS, label: "BatchBridge (跨链)", icon: Globe, chain: "BSC" },
        { addr: NODE_POOL, label: "NodePool (节点中转)", icon: Server, chain: "BSC" },
        { addr: NODE_WALLET, label: "节点钱包", icon: Wallet, chain: "BSC" },
        { addr: NODE_V2_CONTRACT_ADDRESS, label: "NodesV2", icon: Server, chain: "BSC" },
      ];

      const results = [];
      for (const c of contracts) {
        if (!c.addr) continue;
        const balances: Record<string, number> = {};
        for (const t of tokens) {
          try {
            const contract = getContract({ client, chain: bsc, address: t.addr });
            const raw = await readContract({ contract, method: BALANCE_ABI, params: [c.addr] });
            balances[t.symbol] = Number(raw) / (10 ** t.decimals);
          } catch { balances[t.symbol] = 0; }
        }
        results.push({ ...c, balances });
      }
      return results;
    },
    enabled: !!client,
    refetchInterval: 60_000,
  });
}

// ── TX types ──

const TX_FILTERS = [
  { key: "ALL", label: "全部", icon: Coins },
  { key: "DEPOSIT,VAULT_DEPOSIT", label: "金库存入", icon: ArrowDownToLine },
  { key: "VAULT_REDEEM,WITHDRAW", label: "赎回", icon: ArrowUpFromLine },
  { key: "YIELD,YIELD_CLAIM", label: "收益", icon: Sparkles },
  { key: "MA_SWAP", label: "闪兑", icon: ArrowRightLeft },
  { key: "NODE_PURCHASE", label: "节点", icon: Server },
  { key: "VIP_PURCHASE", label: "VIP", icon: ShieldCheck },
  { key: "TEAM_COMMISSION,DIRECT_REFERRAL", label: "奖励", icon: Gift },
];

const TYPE_LABELS: Record<string, string> = {
  DEPOSIT: "入金", VAULT_DEPOSIT: "金库存入", WITHDRAW: "提取",
  VAULT_REDEEM: "金库赎回", YIELD: "收益", YIELD_CLAIM: "收益提取",
  VIP_PURCHASE: "VIP购买", NODE_PURCHASE: "节点购买",
  TEAM_COMMISSION: "团队奖励", DIRECT_REFERRAL: "直推奖励",
  FIXED_YIELD: "节点收益", REWARD_RELEASE: "释放到账",
  MA_SWAP: "MA闪兑", BRIDGE: "跨链", NODE_FLUSH: "节点归集",
};

const TYPE_COLORS: Record<string, string> = {
  DEPOSIT: "text-primary", VAULT_DEPOSIT: "text-cyan-400", WITHDRAW: "text-red-400",
  VAULT_REDEEM: "text-orange-400", YIELD: "text-blue-400", YIELD_CLAIM: "text-emerald-400",
  VIP_PURCHASE: "text-purple-400", NODE_PURCHASE: "text-amber-400",
  TEAM_COMMISSION: "text-indigo-400", DIRECT_REFERRAL: "text-pink-400",
  FIXED_YIELD: "text-yellow-400", REWARD_RELEASE: "text-teal-400",
  MA_SWAP: "text-cyan-400", BRIDGE: "text-indigo-400", NODE_FLUSH: "text-green-400",
};

// ── Main ──

export default function AdminFunds() {
  const { adminUser } = useAdminAuth();
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [section, setSection] = useState<"balances" | "flow" | "bridge" | "swap" | "transactions">("balances");
  const pageSize = 50;

  const { data: balances, isLoading: balLoading, refetch: refetchBal } = useOnChainBalances();

  // Vault deposit flow — recent vault_positions + their on-chain flow
  const { data: vaultDeposits = [] } = useQuery({
    queryKey: ["admin", "funds", "vault-deposits"],
    queryFn: async () => {
      const { data } = await supabase
        .from("vault_positions")
        .select("*, profiles!inner(wallet_address)")
        .order("created_at", { ascending: false })
        .limit(30);
      return data || [];
    },
    enabled: !!adminUser && section === "flow",
  });

  // Bridge cycles
  const { data: bridges = [] } = useQuery({
    queryKey: ["admin", "funds", "bridges"],
    queryFn: async () => {
      const { data } = await supabase.from("bridge_cycles").select("*").order("started_at", { ascending: false }).limit(30);
      return data || [];
    },
    enabled: !!adminUser && section === "bridge",
  });

  // MA swap records
  const { data: swaps = [] } = useQuery({
    queryKey: ["admin", "funds", "swaps"],
    queryFn: async () => {
      const { data } = await supabase
        .from("ma_swap_records")
        .select("*, profiles!inner(wallet_address)")
        .order("created_at", { ascending: false })
        .limit(30);
      return data || [];
    },
    enabled: !!adminUser && section === "swap",
  });

  // Transactions
  const { data: txData, isLoading: txLoading, refetch: refetchTx } = useQuery({
    queryKey: ["admin", "funds", "txs", filter, search, page],
    queryFn: async () => {
      let query = supabase
        .from("transactions")
        .select("*, profiles!inner(wallet_address)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (filter !== "ALL") query = query.in("type", filter.split(","));
      if (search) query = query.or(`tx_hash.ilike.%${search}%,profiles.wallet_address.ilike.%${search}%`);

      const { data, count, error } = await query;
      if (error) throw error;
      return { txs: data || [], total: count || 0 };
    },
    enabled: !!adminUser && section === "transactions",
  });

  const txs = txData?.txs || [];
  const total = txData?.total || 0;

  const sections = [
    { id: "balances" as const, label: "合约余额", icon: Wallet },
    { id: "flow" as const, label: "资金流转", icon: ArrowRightLeft },
    { id: "bridge" as const, label: "跨链记录", icon: Globe },
    { id: "swap" as const, label: "闪兑记录", icon: Zap },
    { id: "transactions" as const, label: "交易流水", icon: Database },
  ];

  return (
    <div className="space-y-4 lg:space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Coins className="h-5 w-5 text-primary" />
          <h1 className="text-base lg:text-lg font-bold text-foreground/80">资金详情</h1>
        </div>
        <button onClick={() => { refetchBal(); refetchTx(); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-primary bg-primary/8 hover:bg-primary/15 transition-colors">
          <RefreshCw className="h-3.5 w-3.5" /> 刷新
        </button>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {sections.map(s => {
          const Icon = s.icon;
          return (
            <button key={s.id} onClick={() => setSection(s.id)}
              className={cn("shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold transition-colors border",
                section === s.id ? "bg-primary/10 text-primary border-primary/20" : "bg-white/[0.02] text-foreground/30 border-white/[0.06]"
              )}>
              <Icon className="h-3.5 w-3.5" /> {s.label}
            </button>
          );
        })}
      </div>

      {/* ── Section: On-chain Balances ── */}
      {section === "balances" && (
        <div className="space-y-2">
          {balLoading ? (
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)
          ) : (
            (balances || []).map((c: any) => {
              const Icon = c.icon;
              const hasValue = Object.values(c.balances || {}).some((v: any) => v > 0.01);
              return (
                <div key={c.addr} className={cn("rounded-xl border p-3", hasValue ? "bg-white/[0.03] border-white/[0.08]" : "bg-white/[0.01] border-white/[0.04]")}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-primary/60" />
                      <span className="text-xs font-bold text-foreground/60">{c.label}</span>
                      <Badge className="text-[8px] bg-white/[0.03] text-foreground/20 border-white/[0.06]">{c.chain}</Badge>
                    </div>
                    <a href={`https://bscscan.com/address/${c.addr}`} target="_blank" rel="noopener noreferrer" className="text-[9px] text-primary/40 hover:text-primary font-mono flex items-center gap-0.5">
                      {c.addr?.slice(0, 6)}...{c.addr?.slice(-4)} <ExternalLink className="h-2 w-2" />
                    </a>
                  </div>
                  <div className="flex gap-4">
                    {Object.entries(c.balances || {}).map(([sym, bal]: [string, any]) => (
                      <div key={sym} className="text-center">
                        <p className="text-[9px] text-foreground/25">{sym}</p>
                        <p className={cn("text-xs font-bold font-mono", bal > 0.01 ? "text-foreground/70" : "text-foreground/15")}>
                          {bal > 1000 ? bal.toLocaleString("en-US", { maximumFractionDigits: 0 }) : bal.toFixed(2)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Section: Fund Flow (Vault deposits trail) ── */}
      {section === "flow" && (
        <div className="space-y-2">
          <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3 mb-3">
            <p className="text-[10px] text-foreground/30 mb-2">资金流转路径</p>
            <div className="flex items-center gap-1 text-[9px] flex-wrap">
              <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">用户 USDT</span>
              <span className="text-foreground/15">→</span>
              <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">SwapRouter</span>
              <span className="text-foreground/15">→</span>
              <span className="px-1.5 py-0.5 rounded bg-pink-500/10 text-pink-400">PancakeSwap (USDT→USDC)</span>
              <span className="text-foreground/15">→</span>
              <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary">Vault (mint cUSD+MA)</span>
              <span className="text-foreground/15">→</span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">BatchBridge</span>
              <span className="text-foreground/15">→</span>
              <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400">Stargate→ARB</span>
              <span className="text-foreground/15">→</span>
              <span className="px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">5钱包 (30/8/12/20/30)</span>
            </div>
          </div>

          <h3 className="text-[11px] font-bold text-foreground/40">最近金库仓位</h3>
          {vaultDeposits.length === 0 ? (
            <p className="text-center py-8 text-foreground/20 text-sm">暂无金库仓位</p>
          ) : (
            vaultDeposits.map((d: any) => {
              const wallet = d.profiles?.wallet_address || "";
              const statusColor = d.status === "ACTIVE" ? "text-green-400" : d.status === "COMPLETED" ? "text-foreground/30" : "text-orange-400";
              return (
                <div key={d.id} className="rounded-xl bg-white/[0.02] border border-white/[0.04] px-3 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", statusColor.replace("text-", "bg-"))} />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold text-foreground/60">${Number(d.principal).toFixed(0)} USDC</span>
                        <Badge className={cn("text-[8px]", statusColor, statusColor.replace("text-", "bg-").replace("400", "500/10"))}>{d.status}</Badge>
                        <span className="text-[9px] text-foreground/25">{d.plan_type}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[8px] text-foreground/15 font-mono">{wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "-"}</span>
                        <span className="text-[8px] text-foreground/15">日息 {(Number(d.daily_rate) * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] text-foreground/25">{d.end_date ? new Date(d.end_date).toLocaleDateString("zh-CN") : "-"} 到期</p>
                    <p className="text-[8px] text-foreground/15">{d.created_at ? new Date(d.created_at).toLocaleDateString("zh-CN") : "-"} 创建</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Section: Cross-chain Bridge ── */}
      {section === "bridge" && (
        <div className="space-y-2">
          <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3 mb-3">
            <p className="text-[10px] text-foreground/30 mb-2">跨链路径</p>
            <div className="flex items-center gap-1 text-[9px] flex-wrap">
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">BatchBridge (BSC)</span>
              <span className="text-foreground/15">→ 每4h</span>
              <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400">Stargate (LayerZero)</span>
              <span className="text-foreground/15">→</span>
              <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">FundRouter (ARB)</span>
              <span className="text-foreground/15">→</span>
              <span className="px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">5钱包分配</span>
            </div>
          </div>

          {bridges.length === 0 ? (
            <p className="text-center py-8 text-foreground/20 text-sm">暂无跨链记录</p>
          ) : (
            bridges.map((b: any) => {
              const statusColor = b.status === "COMPLETED" ? "text-green-400" : b.status === "FAILED" ? "text-red-400" : "text-yellow-400";
              return (
                <div key={b.id} className="rounded-xl bg-white/[0.02] border border-white/[0.04] px-3 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-blue-400/50" />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-foreground/60">${Number(b.amount_usd || 0).toLocaleString()}</span>
                        <Badge className={cn("text-[8px]", statusColor, statusColor.replace("text-", "bg-").replace("400", "500/10"))}>{b.status}</Badge>
                        <span className="text-[9px] text-foreground/25">{b.cycle_type}</span>
                      </div>
                      <p className="text-[9px] text-foreground/20 mt-0.5">
                        BSC→ARB · {b.initiated_by || "cron"}
                        {b.tx_hash && (
                          <a href={`https://bscscan.com/tx/${b.tx_hash}`} target="_blank" rel="noopener noreferrer" className="ml-1 text-primary/40 hover:text-primary">
                            <ExternalLink className="h-2 w-2 inline" />
                          </a>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    {b.fees_usd > 0 && <p className="text-[9px] text-red-400/50">费用 ${Number(b.fees_usd).toFixed(2)}</p>}
                    <p className="text-[9px] text-foreground/20">{b.started_at ? new Date(b.started_at).toLocaleDateString("zh-CN") : "-"}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Section: FlashSwap Records ── */}
      {section === "swap" && (
        <div className="space-y-2">
          <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3 mb-3">
            <p className="text-[10px] text-foreground/30 mb-2">闪兑机制</p>
            <div className="flex items-center gap-1 text-[9px] flex-wrap">
              <span className="px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400">MA Token</span>
              <span className="text-foreground/15">↔ Oracle定价</span>
              <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400">FlashSwap (0.3%手续费)</span>
              <span className="text-foreground/15">↔</span>
              <span className="px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">USDT/USDC</span>
              <span className="text-[8px] text-foreground/15 ml-1">50%持仓规则</span>
            </div>
          </div>

          {swaps.length === 0 ? (
            <p className="text-center py-8 text-foreground/20 text-sm">暂无闪兑记录</p>
          ) : (
            swaps.map((s: any) => {
              const wallet = s.profiles?.wallet_address || "";
              const isSell = s.direction === "MA_TO_USD" || s.ma_to_usd;
              return (
                <div key={s.id} className="rounded-xl bg-white/[0.02] border border-white/[0.04] px-3 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <ArrowRightLeft className={cn("h-4 w-4", isSell ? "text-red-400/50" : "text-green-400/50")} />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold text-foreground/60">
                          {isSell ? `${Number(s.ma_amount || 0).toFixed(2)} MA → $${Number(s.usd_amount || 0).toFixed(2)}` : `$${Number(s.usd_amount || 0).toFixed(2)} → ${Number(s.ma_amount || 0).toFixed(2)} MA`}
                        </span>
                        <Badge className={cn("text-[8px]", isSell ? "text-red-400 bg-red-500/10" : "text-green-400 bg-green-500/10")}>
                          {isSell ? "卖出MA" : "买入MA"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[8px] text-foreground/15 font-mono">{wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "-"}</span>
                        {s.fee && <span className="text-[8px] text-foreground/15">手续费 ${Number(s.fee).toFixed(2)}</span>}
                        {s.price && <span className="text-[8px] text-foreground/15">价格 ${Number(s.price).toFixed(4)}</span>}
                      </div>
                    </div>
                  </div>
                  <span className="text-[9px] text-foreground/20">{s.created_at ? new Date(s.created_at).toLocaleDateString("zh-CN") : "-"}</span>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Section: All Transactions ── */}
      {section === "transactions" && (
        <div className="space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/20" />
            <Input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
              placeholder="搜索钱包地址 / 交易哈希" className="pl-9 text-xs" />
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 overflow-x-auto pb-0.5">
            {TX_FILTERS.map(f => {
              const Icon = f.icon;
              return (
                <button key={f.key} onClick={() => { setFilter(f.key); setPage(0); }}
                  className={cn("shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-semibold transition-colors border",
                    filter === f.key ? "bg-primary/10 text-primary border-primary/20" : "bg-white/[0.02] text-foreground/25 border-white/[0.04]"
                  )}>
                  <Icon className="h-2.5 w-2.5" /> {f.label}
                </button>
              );
            })}
          </div>

          {/* List */}
          <div className="space-y-1">
            {txLoading ? (
              Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)
            ) : txs.length === 0 ? (
              <p className="text-center py-8 text-foreground/20 text-sm">暂无记录</p>
            ) : (
              txs.map((tx: any) => {
                const wallet = tx.profiles?.wallet_address || "";
                const label = TYPE_LABELS[tx.type] || tx.type;
                const color = TYPE_COLORS[tx.type] || "text-foreground/40";
                const hasHash = tx.tx_hash && !tx.tx_hash.startsWith("trial") && !tx.tx_hash.startsWith("backfill") && !tx.tx_hash.startsWith("yield_");

                return (
                  <div key={tx.id} className="rounded-lg bg-white/[0.02] border border-white/[0.03] px-3 py-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0", color, color.replace("text-", "bg-").replace("400", "500/10"))}>{label}</span>
                      <div className="min-w-0">
                        <span className="text-[11px] font-bold font-mono text-foreground/60">{Number(tx.amount).toFixed(2)} {tx.token}</span>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[8px] text-foreground/15 font-mono">{wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "-"}</span>
                          {hasHash && (
                            <a href={`https://bscscan.com/tx/${tx.tx_hash}`} target="_blank" rel="noopener noreferrer" className="text-primary/40 hover:text-primary">
                              <ExternalLink className="h-2 w-2" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                    <span className="text-[8px] text-foreground/15 shrink-0">{tx.created_at ? new Date(tx.created_at).toLocaleDateString("zh-CN", { month: "short", day: "numeric" }) : "-"}</span>
                  </div>
                );
              })
            )}
          </div>

          {/* Pagination */}
          {total > pageSize && (
            <div className="flex items-center justify-between text-[10px] text-foreground/25">
              <span>{page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)} / {total}</span>
              <div className="flex gap-1.5">
                <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-2.5 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-30">上一页</button>
                <button disabled={(page + 1) * pageSize >= total} onClick={() => setPage(p => p + 1)} className="px-2.5 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-30">下一页</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
