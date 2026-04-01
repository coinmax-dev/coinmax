import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { MobileDataCard } from "@/admin/components/mobile-card";
import { adminGetNodeMemberships } from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth";
import { shortenAddress, formatUSD } from "@/lib/constants";

const PAGE_SIZE = 20;

export default function AdminNodes() {
  const { adminUser } = useAdminAuth();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "node-memberships", page],
    queryFn: () => adminGetNodeMemberships(page, PAGE_SIZE),
    enabled: !!adminUser,
  });

  const memberships = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4 lg:space-y-6">
      <h1 className="text-lg lg:text-xl font-bold text-foreground">
        节点管理
        {total > 0 && <span className="text-sm font-normal text-foreground/40 ml-2">({total})</span>}
      </h1>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 lg:h-10 w-full rounded-xl" />)}</div>
      ) : (
        <>
          {/* Mobile */}
          <div className="lg:hidden space-y-3">
            {memberships.length === 0 ? (
              <p className="text-center text-foreground/40 py-8 text-sm">暂无数据</p>
            ) : memberships.map((n: any) => (
              <MobileDataCard
                key={n.id}
                header={
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-primary">{shortenAddress(n.userWallet ?? n.userId)}</span>
                    <Badge className={n.status === "active" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20 text-[10px] h-5" : "bg-gray-500/15 text-gray-400 border-gray-500/20 text-[10px] h-5"}>{n.status}</Badge>
                  </div>
                }
                fields={[
                  { label: "节点类型", value: <Badge variant="outline" className="text-[10px] h-5 capitalize">{n.nodeType}</Badge> },
                  { label: "价格", value: formatUSD(Number(n.price)) },
                  { label: "里程碑", value: `${n.milestoneStage} / ${n.totalMilestones}` },
                  { label: "开始时间", value: n.startDate ? new Date(n.startDate).toLocaleDateString() : "-" },
                  ...(n.tag ? [{ label: "标签", value: <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 text-[10px] h-5">{n.tag}</Badge> }] : []),
                ]}
              />
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden lg:block rounded-2xl border border-border/30 backdrop-blur-sm overflow-x-auto" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)" }}>
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow className="border-border/20 hover:bg-transparent">
                  <TableHead>用户钱包</TableHead><TableHead>节点类型</TableHead><TableHead>价格</TableHead>
                  <TableHead>状态</TableHead><TableHead>标签</TableHead><TableHead>开始时间</TableHead><TableHead>里程碑</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberships.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-foreground/40 py-8">暂无数据</TableCell></TableRow>
                ) : memberships.map((n: any) => (
                  <TableRow key={n.id} className="border-border/10 hover:bg-white/[0.015]">
                    <TableCell className="font-mono text-xs text-foreground/70">{shortenAddress(n.userWallet ?? n.userId)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs capitalize">{n.nodeType}</Badge></TableCell>
                    <TableCell className="text-foreground/70">{formatUSD(Number(n.price))}</TableCell>
                    <TableCell><Badge className={n.status === "active" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" : "bg-gray-500/15 text-gray-400 border-gray-500/20"}>{n.status}</Badge></TableCell>
                    <TableCell>{n.tag ? <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 text-[10px]">{n.tag}</Badge> : <span className="text-foreground/20">-</span>}</TableCell>
                    <TableCell className="text-foreground/40 text-xs">{n.startDate ? new Date(n.startDate).toLocaleDateString() : "-"}</TableCell>
                    <TableCell className="text-foreground/70">{n.milestoneStage} / {n.totalMilestones}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-foreground/40">{page} / {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>上一页</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>下一页</Button>
          </div>
        </div>
      )}
    </div>
  );
}
