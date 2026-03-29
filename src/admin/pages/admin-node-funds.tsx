import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { MobileDataCard } from "@/admin/components/mobile-card";
import {
  adminGetNodeFundRecords, adminGetNodeFundStats,
  adminGetFundDistributions, adminGetFundDistributionStats,
} from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth";
import { useThirdwebClient } from "@/hooks/use-thirdweb";
import { readContract, getContract } from "thirdweb";
import { bsc } from "thirdweb/chains";
import { shortenAddress, formatUSD } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { NODE_V2_CONTRACT_ADDRESS, USDC_ADDRESS } from "@/lib/contracts";
import { Banknote, TrendingUp, Receipt, ArrowRightLeft, Globe, ExternalLink, Server, RefreshCw } from "lucide-react";
import { StatsCard } from "@/admin/components/stats-card";

const NODE_POOL = "0x7dE393D02C153cF943E0cf30C7B2B7A073E5e75a";
const NODE_WALLET = "0xeb8AbD9b47F9Ca0d20e22636B2004B75E84BdcD9";

const PAGE_SIZE = 20;

type Tab = "purchases" | "distributions";

// ── On-chain node contract data ──
function useNodeOnChainData() {
  const { client } = useThirdwebClient();

  return useQuery({
    queryKey: ["admin", "node-onchain"],
    queryFn: async () => {
      if (!client || !NODE_V2_CONTRACT_ADDRESS) return null;
      const nodesC = getContract({ client, chain: bsc, address: NODE_V2_CONTRACT_ADDRESS });
      const usdcC = getContract({ client, chain: bsc, address: USDC_ADDRESS });
      const balAbi = "function balanceOf(address) view returns (uint256)";
      const planAbi = "function nodePlans(string) view returns (uint256 price, bool active)";

      const [miniPlan, maxPlan, purchaseCount, poolBal, walletBal, nodesBal] = await Promise.all([
        readContract({ contract: nodesC, method: planAbi, params: ["MINI"] }),
        readContract({ contract: nodesC, method: planAbi, params: ["MAX"] }),
        readContract({ contract: nodesC, method: "function purchaseCount() view returns (uint256)" }),
        readContract({ contract: usdcC, method: balAbi, params: [NODE_POOL] }),
        readContract({ contract: usdcC, method: balAbi, params: [NODE_WALLET] }),
        readContract({ contract: usdcC, method: balAbi, params: [NODE_V2_CONTRACT_ADDRESS] }),
      ]);

      return {
        miniPrice: Number(miniPlan[0]) / 1e18,
        miniActive: miniPlan[1],
        maxPrice: Number(maxPlan[0]) / 1e18,
        maxActive: maxPlan[1],
        purchaseCount: Number(purchaseCount),
        poolBalance: Number(poolBal) / 1e18,
        walletBalance: Number(walletBal) / 1e18,
        nodesBalance: Number(nodesBal) / 1e18,
      };
    },
    enabled: !!client,
    refetchInterval: 60_000,
  });
}

export default function AdminNodeFunds() {
  const { adminUser } = useAdminAuth();
  const [tab, setTab] = useState<Tab>("purchases");
  const [page, setPage] = useState(1);
  const [distPage, setDistPage] = useState(1);
  const { data: onChain, isLoading: onChainLoading, refetch: refetchOnChain } = useNodeOnChainData();

  // Purchases
  const { data: purchaseData, isLoading: purchaseLoading } = useQuery({
    queryKey: ["admin", "node-fund-records", page],
    queryFn: () => adminGetNodeFundRecords(page, PAGE_SIZE),
    enabled: !!adminUser,
  });

  const { data: purchaseStats } = useQuery({
    queryKey: ["admin", "node-fund-stats"],
    queryFn: () => adminGetNodeFundStats(),
    enabled: !!adminUser,
  });

  // Distributions
  const { data: distData, isLoading: distLoading } = useQuery({
    queryKey: ["admin", "fund-distributions", distPage],
    queryFn: () => adminGetFundDistributions(distPage, PAGE_SIZE),
    enabled: !!adminUser,
  });

  const { data: distStats } = useQuery({
    queryKey: ["admin", "fund-distribution-stats"],
    queryFn: () => adminGetFundDistributionStats(),
    enabled: !!adminUser,
  });

  const records = purchaseData?.data ?? [];
  const purchaseTotal = purchaseData?.total ?? 0;
  const purchaseTotalPages = Math.ceil(purchaseTotal / PAGE_SIZE);

  const distributions = distData?.data ?? [];
  const distTotal = distData?.total ?? 0;
  const distTotalPages = Math.ceil(distTotal / PAGE_SIZE);

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg lg:text-xl font-bold text-foreground">节点资金记录</h1>
        <button onClick={() => refetchOnChain()} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold text-primary bg-primary/8 hover:bg-primary/15">
          <RefreshCw className="h-3 w-3" /> 刷新链上
        </button>
      </div>

      {/* On-chain overview */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Globe className="h-4 w-4 text-primary/60" />
          <span className="text-[12px] font-bold text-foreground/60">链上数据 (NodesV2)</span>
          <a href={`https://bscscan.com/address/${NODE_V2_CONTRACT_ADDRESS}`} target="_blank" rel="noopener noreferrer" className="text-[9px] text-primary/40 hover:text-primary font-mono flex items-center gap-0.5">
            {NODE_V2_CONTRACT_ADDRESS?.slice(0,6)}...{NODE_V2_CONTRACT_ADDRESS?.slice(-4)} <ExternalLink className="h-2 w-2" />
          </a>
        </div>
        {onChainLoading ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : onChain ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-foreground/40">MINI 节点</span>
                  <Badge className={`text-[8px] ${onChain.miniActive ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                    {onChain.miniActive ? "启用" : "禁用"}
                  </Badge>
                </div>
                <span className="text-[18px] font-bold font-mono text-foreground/70">${onChain.miniPrice}</span>
                <span className="text-[10px] text-foreground/25 ml-1">USDC</span>
              </div>
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-foreground/40">MAX 节点</span>
                  <Badge className={`text-[8px] ${onChain.maxActive ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                    {onChain.maxActive ? "启用" : "禁用"}
                  </Badge>
                </div>
                <span className="text-[18px] font-bold font-mono text-foreground/70">${onChain.maxPrice}</span>
                <span className="text-[10px] text-foreground/25 ml-1">USDC</span>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div className="text-center p-2 rounded-lg bg-white/[0.02]">
                <p className="text-[9px] text-foreground/30">购买总数</p>
                <p className="text-[14px] font-bold font-mono text-foreground/60">{onChain.purchaseCount}</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-white/[0.02]">
                <p className="text-[9px] text-foreground/30">NodesV2 余额</p>
                <p className="text-[14px] font-bold font-mono text-foreground/60">${onChain.nodesBalance.toFixed(0)}</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-white/[0.02]">
                <p className="text-[9px] text-foreground/30">NodePool 待归集</p>
                <p className={cn("text-[14px] font-bold font-mono", onChain.poolBalance > 0 ? "text-amber-400" : "text-foreground/60")}>${onChain.poolBalance.toFixed(0)}</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-white/[0.02]">
                <p className="text-[9px] text-foreground/30">节点钱包</p>
                <p className="text-[14px] font-bold font-mono text-foreground/60">${onChain.walletBalance.toFixed(0)}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 text-[9px] text-foreground/20">
              <span>资金路径:</span>
              <span className="px-1 py-0.5 rounded bg-purple-500/10 text-purple-400">SwapRouter</span>
              <span>→</span>
              <span className="px-1 py-0.5 rounded bg-green-500/10 text-green-400">NodesV2</span>
              <span>→</span>
              <span className="px-1 py-0.5 rounded bg-amber-500/10 text-amber-400">NodePool</span>
              <span>→ 30min cron →</span>
              <span className="px-1 py-0.5 rounded bg-blue-500/10 text-blue-400">节点钱包 0xeb8A</span>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-foreground/30">连接钱包后显示链上数据</p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setTab("purchases")}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            tab === "purchases"
              ? "bg-primary/15 text-primary border border-primary/30"
              : "bg-white/[0.04] text-foreground/50 border border-white/[0.06] hover:text-foreground/70"
          }`}
        >
          节点购买 {purchaseTotal > 0 && `(${purchaseTotal})`}
        </button>
        <button
          onClick={() => setTab("distributions")}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            tab === "distributions"
              ? "bg-primary/15 text-primary border border-primary/30"
              : "bg-white/[0.04] text-foreground/50 border border-white/[0.06] hover:text-foreground/70"
          }`}
        >
          资金分配 {distTotal > 0 && `(${distTotal})`}
        </button>
      </div>

      {tab === "purchases" ? (
        <PurchasesTab
          stats={purchaseStats}
          records={records}
          isLoading={purchaseLoading}
          page={page}
          setPage={setPage}
          totalPages={purchaseTotalPages}
        />
      ) : (
        <DistributionsTab
          stats={distStats}
          distributions={distributions}
          isLoading={distLoading}
          page={distPage}
          setPage={setDistPage}
          totalPages={distTotalPages}
        />
      )}
    </div>
  );
}

// ── Purchases Tab ────────────────────────────────────

function PurchasesTab({ stats, records, isLoading, page, setPage, totalPages }: any) {
  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <StatsCard title="总交易数" value={stats?.totalRecords ?? 0} icon={Receipt} subtitle="购买笔数" color="#6366f1" />
        <StatsCard title="总贡献金" value={formatUSD(Number(stats?.totalContribution ?? 0))} icon={Banknote} subtitle="实付金额" color="#22c55e" />
        <StatsCard title="总金额" value={formatUSD(Number(stats?.totalAmount ?? 0))} icon={TrendingUp} subtitle="含冻结" color="#f59e0b" />
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 lg:h-10 w-full rounded-xl" />)}</div>
      ) : (
        <>
          {/* Mobile */}
          <div className="lg:hidden space-y-3">
            {records.length === 0 ? (
              <p className="text-center text-foreground/40 py-8 text-sm">暂无数据</p>
            ) : records.map((r: any) => (
              <MobileDataCard
                key={r.id}
                header={
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-primary">{shortenAddress(r.userWallet ?? r.userId)}</span>
                    <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 text-[10px] h-5">{r.status}</Badge>
                  </div>
                }
                fields={[
                  { label: "节点类型", value: <Badge variant="outline" className="text-[10px] h-5 capitalize">{r.details?.nodeType ?? "-"}</Badge> },
                  { label: "购买价格", value: formatUSD(Number(r.details?.nodeType === "MAX" ? 600 : r.details?.nodeType === "MINI" ? 100 : r.amount)) + " USDC" },
                  { label: "实付金额", value: formatUSD(Number(r.amount)) },
                  { label: "Tx Hash", value: r.txHash ? <a href={`https://bscscan.com/tx/${r.txHash}`} target="_blank" rel="noreferrer" className="text-primary hover:underline font-mono">{shortenAddress(r.txHash)}</a> : "-" },
                  { label: "时间", value: r.createdAt ? new Date(r.createdAt).toLocaleString() : "-" },
                ]}
              />
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden lg:block rounded-2xl border border-border/30 backdrop-blur-sm overflow-x-auto" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)" }}>
            <Table className="min-w-[800px]">
              <TableHeader>
                <TableRow className="border-border/20 hover:bg-transparent">
                  <TableHead>用户钱包</TableHead><TableHead>节点类型</TableHead><TableHead>购买价格</TableHead>
                  <TableHead>实付金额</TableHead><TableHead>Tx Hash</TableHead>
                  <TableHead>状态</TableHead><TableHead>时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-foreground/40 py-8">暂无数据</TableCell></TableRow>
                ) : records.map((r: any) => (
                  <TableRow key={r.id} className="border-border/10 hover:bg-white/[0.015]">
                    <TableCell className="font-mono text-xs text-foreground/70">{shortenAddress(r.userWallet ?? r.userId)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs capitalize">{r.details?.nodeType ?? "-"}</Badge></TableCell>
                    <TableCell className="text-foreground/70 font-medium">{r.details?.nodeType === "MAX" ? "$600" : r.details?.nodeType === "MINI" ? "$100" : "-"} USDC</TableCell>
                    <TableCell className="text-foreground/70">{formatUSD(Number(r.amount))}</TableCell>
                    <TableCell>
                      {r.txHash ? (
                        <a href={`https://bscscan.com/tx/${r.txHash}`} target="_blank" rel="noreferrer" className="text-primary hover:underline font-mono text-xs">{shortenAddress(r.txHash)}</a>
                      ) : <span className="text-foreground/30">-</span>}
                    </TableCell>
                    <TableCell><Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20">{r.status}</Badge></TableCell>
                    <TableCell className="text-foreground/40 text-xs">{r.createdAt ? new Date(r.createdAt).toLocaleString() : "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-foreground/40">{page} / {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p: number) => Math.max(1, p - 1))} disabled={page <= 1}>上一页</Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p: number) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>下一页</Button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Distributions Tab ────────────────────────────────

function DistributionsTab({ stats, distributions, isLoading, page, setPage, totalPages }: any) {
  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <StatsCard title="分配次数" value={stats?.totalRecords ?? 0} icon={ArrowRightLeft} subtitle="总笔数" color="#6366f1" />
        <StatsCard title="USDT 分配" value={formatUSD(Number(stats?.usdtTotal ?? 0))} icon={Banknote} subtitle="累计" color="#22c55e" />
        <StatsCard title="USDC 分配" value={formatUSD(Number(stats?.usdcTotal ?? 0))} icon={Banknote} subtitle="累计" color="#3b82f6" />
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 lg:h-10 w-full rounded-xl" />)}</div>
      ) : (
        <>
          {/* Mobile */}
          <div className="lg:hidden space-y-3">
            {distributions.length === 0 ? (
              <p className="text-center text-foreground/40 py-8 text-sm">暂无分配记录</p>
            ) : distributions.map((d: any) => (
              <MobileDataCard
                key={d.id}
                header={
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-[10px] h-5">{d.token}</Badge>
                    <span className="text-sm font-bold text-foreground">{formatUSD(Number(d.amount))}</span>
                  </div>
                }
                fields={[
                  { label: "接收地址", value: <span className="font-mono text-xs">{shortenAddress(d.recipient)}</span> },
                  { label: "Tx Hash", value: d.txHash ? <a href={`https://bscscan.com/tx/${d.txHash}`} target="_blank" rel="noreferrer" className="text-primary hover:underline font-mono">{shortenAddress(d.txHash)}</a> : "-" },
                  { label: "时间", value: d.createdAt ? new Date(d.createdAt).toLocaleString() : "-" },
                ]}
              />
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden lg:block rounded-2xl border border-border/30 backdrop-blur-sm overflow-x-auto" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)" }}>
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow className="border-border/20 hover:bg-transparent">
                  <TableHead>代币</TableHead><TableHead>金额</TableHead><TableHead>FundManager</TableHead>
                  <TableHead>接收地址</TableHead><TableHead>Tx Hash</TableHead><TableHead>状态</TableHead><TableHead>时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {distributions.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-foreground/40 py-8">暂无分配记录</TableCell></TableRow>
                ) : distributions.map((d: any) => (
                  <TableRow key={d.id} className="border-border/10 hover:bg-white/[0.015]">
                    <TableCell><Badge variant="outline" className="text-xs">{d.token}</Badge></TableCell>
                    <TableCell className="text-foreground/70 font-medium">{formatUSD(Number(d.amount))}</TableCell>
                    <TableCell className="font-mono text-xs text-foreground/50">{shortenAddress(d.fundManager)}</TableCell>
                    <TableCell className="font-mono text-xs text-foreground/70">{shortenAddress(d.recipient)}</TableCell>
                    <TableCell>
                      {d.txHash ? (
                        <a href={`https://bscscan.com/tx/${d.txHash}`} target="_blank" rel="noreferrer" className="text-primary hover:underline font-mono text-xs">{shortenAddress(d.txHash)}</a>
                      ) : <span className="text-foreground/30">-</span>}
                    </TableCell>
                    <TableCell><Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20">{d.status}</Badge></TableCell>
                    <TableCell className="text-foreground/40 text-xs">{d.createdAt ? new Date(d.createdAt).toLocaleString() : "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-foreground/40">{page} / {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p: number) => Math.max(1, p - 1))} disabled={page <= 1}>上一页</Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p: number) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>下一页</Button>
          </div>
        </div>
      )}
    </>
  );
}
