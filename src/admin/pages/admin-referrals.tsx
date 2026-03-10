import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search, GitBranch, X, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { MobileDataCard } from "@/admin/components/mobile-card";
import { ReferralTreeView } from "@/admin/components/referral-tree";
import { adminGetReferralPairs, adminGetReferralTree, type ReferralNode } from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth";
import { shortenAddress } from "@/lib/constants";

const PAGE_SIZE = 20;

export default function AdminReferrals() {
  const { t } = useTranslation();
  const { adminUser } = useAdminAuth();
  const [page, setPage] = useState(1);
  const [treeWallet, setTreeWallet] = useState("");
  const [treeInput, setTreeInput] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "referral-pairs", page],
    queryFn: () => adminGetReferralPairs(page, PAGE_SIZE),
    enabled: !!adminUser,
  });

  const { data: treeData, isLoading: treeLoading } = useQuery<ReferralNode | null>({
    queryKey: ["admin", "referral-tree", treeWallet],
    queryFn: () => adminGetReferralTree(treeWallet),
    enabled: !!treeWallet,
  });

  const pairs = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const openTree = (wallet: string) => {
    setTreeWallet(wallet);
    setTreeInput(wallet);
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      <h1 className="text-lg lg:text-xl font-bold text-foreground">
        推荐管理
        {total > 0 && <span className="text-sm font-normal text-foreground/40 ml-2">({total})</span>}
      </h1>

      {/* Referral Tree Search */}
      <div className="rounded-xl border border-primary/20 p-3 lg:p-4" style={{ background: "linear-gradient(135deg, rgba(0,188,165,0.04) 0%, rgba(0,188,165,0.01) 100%)" }}>
        <div className="flex items-center gap-2 mb-2">
          <GitBranch className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground/80">递归推荐图</span>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="输入钱包地址查看推荐树..."
            value={treeInput}
            onChange={(e) => setTreeInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setTreeWallet(treeInput.trim())}
            className="flex-1 h-9 text-xs bg-background/50 border-border/30 font-mono"
          />
          <Button size="sm" className="h-9 shrink-0" onClick={() => setTreeWallet(treeInput.trim())} disabled={!treeInput.trim()}>
            <Search className="h-3.5 w-3.5 mr-1" /> 查看
          </Button>
          {treeWallet && (
            <Button size="sm" variant="ghost" className="h-9 shrink-0 text-foreground/40" onClick={() => { setTreeWallet(""); setTreeInput(""); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {treeLoading && <Skeleton className="h-32 w-full mt-3 rounded-xl" />}
        {treeData && <div className="mt-3"><ReferralTreeView tree={treeData} onNavigateToUser={(wallet) => { setTreeInput(wallet); setTreeWallet(wallet); }} /></div>}
        {treeWallet && !treeLoading && !treeData && (
          <p className="text-xs text-foreground/40 mt-3 text-center py-4">未找到该钱包地址</p>
        )}
      </div>

      {/* Referral Pairs List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 lg:h-10 w-full rounded-xl" />)}
        </div>
      ) : (
        <>
          {/* Mobile */}
          <div className="lg:hidden space-y-3">
            {pairs.length === 0 ? (
              <p className="text-center text-foreground/40 py-8 text-sm">暂无数据</p>
            ) : pairs.map((p: any) => (
              <MobileDataCard
                key={p.id}
                header={
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-primary">{shortenAddress(p.walletAddress)}</span>
                    <Badge variant="outline" className="text-[10px] h-5">{p.rank}</Badge>
                  </div>
                }
                fields={[
                  { label: "推荐人", value: p.referrerWallet ? shortenAddress(p.referrerWallet) : "-", mono: true },
                  { label: "节点", value: p.nodeType || "-" },
                  { label: "团队", value: <span className="flex items-center gap-1"><Users className="h-3 w-3 text-primary" />{p.teamCount ?? 0}</span> },
                  { label: "注册时间", value: p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "-" },
                ]}
                actions={
                  <Button variant="ghost" size="sm" className="w-full h-7 text-xs text-primary hover:text-primary/80" onClick={() => openTree(p.walletAddress)}>
                    <GitBranch className="h-3 w-3 mr-1" /> 查看推荐树
                  </Button>
                }
              />
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden lg:block rounded-2xl border border-border/30 backdrop-blur-sm overflow-x-auto" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)" }}>
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow className="border-border/20 hover:bg-transparent">
                  <TableHead>用户钱包</TableHead>
                  <TableHead>推荐人</TableHead>
                  <TableHead>等级</TableHead>
                  <TableHead>节点</TableHead>
                  <TableHead>团队</TableHead>
                  <TableHead>注册时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pairs.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-foreground/40 py-8">暂无数据</TableCell></TableRow>
                ) : pairs.map((p: any) => (
                  <TableRow key={p.id} className="border-border/10 hover:bg-white/[0.015]">
                    <TableCell className="font-mono text-xs text-foreground/70">{shortenAddress(p.walletAddress)}</TableCell>
                    <TableCell className="font-mono text-xs text-foreground/50">{p.referrerWallet ? shortenAddress(p.referrerWallet) : "-"}</TableCell>
                    <TableCell><Badge className="text-[10px] h-5 bg-primary/10 text-primary border border-primary/20">{p.rank}</Badge></TableCell>
                    <TableCell className="text-foreground/70 text-xs">{p.nodeType || "-"}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1 text-xs text-foreground/70">
                        <Users className="h-3 w-3 text-primary" />{p.teamCount ?? 0}
                      </span>
                    </TableCell>
                    <TableCell className="text-foreground/40 text-xs">{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "-"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-primary hover:text-primary/80" onClick={() => openTree(p.walletAddress)}>
                        <GitBranch className="h-3 w-3 mr-1" /> 推荐树
                      </Button>
                    </TableCell>
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
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>上一页</Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>下一页</Button>
          </div>
        </div>
      )}
    </div>
  );
}
