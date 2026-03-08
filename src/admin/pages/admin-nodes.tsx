import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MobileDataCard } from "@/admin/components/mobile-card";
import {
  adminGetNodeMemberships, adminGetAuthCodes, adminGetAuthCodeStats,
  adminBatchCreateAuthCodes, adminDeactivateAuthCode,
} from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth";
import { shortenAddress, formatUSD } from "@/lib/constants";

const PAGE_SIZE = 20;

function codeBadge(status: string) {
  const s = status.toUpperCase();
  const map: Record<string, string> = {
    ACTIVE: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    USED: "bg-amber-500/15 text-amber-400 border-amber-500/20",
    INACTIVE: "bg-red-500/15 text-red-400 border-red-500/20",
  };
  return <Badge className={`text-[10px] h-5 ${map[s] || ""}`}>{s}</Badge>;
}

export default function AdminNodes() {
  const { t } = useTranslation();
  const { adminUser } = useAdminAuth();
  const queryClient = useQueryClient();

  const [nodePage, setNodePage] = useState(1);
  const [codePage, setCodePage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [batchCount, setBatchCount] = useState("10");
  const [batchPrefix, setBatchPrefix] = useState("");
  const [batchNodeType, setBatchNodeType] = useState("MAX");

  const { data: nodeData, isLoading: nodesLoading } = useQuery({
    queryKey: ["admin", "node-memberships", nodePage],
    queryFn: () => adminGetNodeMemberships(nodePage, PAGE_SIZE),
    enabled: !!adminUser,
  });

  const { data: codeData, isLoading: codesLoading } = useQuery({
    queryKey: ["admin", "auth-codes", codePage],
    queryFn: () => adminGetAuthCodes(codePage, PAGE_SIZE),
    enabled: !!adminUser,
  });

  const { data: codeStats } = useQuery({
    queryKey: ["admin", "auth-code-stats"],
    queryFn: () => adminGetAuthCodeStats(),
    enabled: !!adminUser,
  });

  const batchCreateMutation = useMutation({
    mutationFn: () => adminBatchCreateAuthCodes(Number(batchCount), batchNodeType, batchPrefix, adminUser ?? "admin"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "auth-codes"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "auth-code-stats"] });
      setDialogOpen(false);
      setBatchCount("10"); setBatchPrefix(""); setBatchNodeType("MAX");
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => adminDeactivateAuthCode(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "auth-codes"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "auth-code-stats"] });
    },
  });

  const memberships = nodeData?.data ?? [];
  const nodeTotal = nodeData?.total ?? 0;
  const nodeTotalPages = Math.ceil(nodeTotal / PAGE_SIZE);
  const codes = codeData?.data ?? [];
  const codeTotal = codeData?.total ?? 0;
  const codeTotalPages = Math.ceil(codeTotal / PAGE_SIZE);

  return (
    <div className="space-y-6 lg:space-y-8">
      <h1 className="text-lg lg:text-xl font-bold text-foreground">节点管理</h1>

      {/* ===== Node Memberships ===== */}
      <section className="space-y-3">
        <h2 className="text-sm lg:text-lg font-semibold text-foreground/80">节点会员</h2>

        {nodesLoading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
        ) : (
          <>
            {/* Mobile */}
            <div className="lg:hidden space-y-3">
              {memberships.length === 0 ? (
                <p className="text-center text-foreground/40 py-6 text-sm">暂无数据</p>
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
                    <TableHead>状态</TableHead><TableHead>开始时间</TableHead><TableHead>里程碑</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {memberships.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-foreground/40 py-8">暂无数据</TableCell></TableRow>
                  ) : memberships.map((n: any) => (
                    <TableRow key={n.id} className="border-border/10 hover:bg-white/[0.015]">
                      <TableCell className="font-mono text-xs text-foreground/70">{shortenAddress(n.userWallet ?? n.userId)}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs capitalize">{n.nodeType}</Badge></TableCell>
                      <TableCell className="text-foreground/70">{formatUSD(Number(n.price))}</TableCell>
                      <TableCell><Badge className={n.status === "active" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" : "bg-gray-500/15 text-gray-400 border-gray-500/20"}>{n.status}</Badge></TableCell>
                      <TableCell className="text-foreground/40 text-xs">{n.startDate ? new Date(n.startDate).toLocaleDateString() : "-"}</TableCell>
                      <TableCell className="text-foreground/70">{n.milestoneStage} / {n.totalMilestones}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        {nodeTotalPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-foreground/40">{nodePage} / {nodeTotalPages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setNodePage(p => Math.max(1, p - 1))} disabled={nodePage <= 1}>上一页</Button>
              <Button variant="outline" size="sm" onClick={() => setNodePage(p => Math.min(nodeTotalPages, p + 1))} disabled={nodePage >= nodeTotalPages}>下一页</Button>
            </div>
          </div>
        )}
      </section>

      {/* ===== Authorization Codes ===== */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm lg:text-lg font-semibold text-foreground/80">授权码</h2>
          <Button size="sm" className="h-8 text-xs" onClick={() => setDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> 批量生成
          </Button>
        </div>

        {/* Stats */}
        {codeStats && (
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "总数", value: codeStats.total ?? 0, sub: "/ 2000", color: "text-foreground" },
              { label: "已用", value: codeStats.used ?? 0, color: "text-amber-400" },
              { label: "可用", value: codeStats.available ?? 0, color: "text-emerald-400" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-border/20 bg-white/[0.02] py-2 px-3">
                <div className="text-[10px] text-foreground/40 mb-0.5">{s.label}</div>
                <div className={`text-base font-bold ${s.color}`}>
                  {s.value}
                  {s.sub && <span className="text-xs text-foreground/25 ml-0.5">{s.sub}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {codesLoading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
        ) : (
          <>
            {/* Mobile */}
            <div className="lg:hidden space-y-3">
              {codes.length === 0 ? (
                <p className="text-center text-foreground/40 py-6 text-sm">暂无授权码</p>
              ) : codes.map((c: any) => (
                <MobileDataCard
                  key={c.id}
                  header={
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold text-foreground/80">{c.code}</span>
                      {codeBadge(c.status)}
                    </div>
                  }
                  fields={[
                    { label: "节点类型", value: <Badge variant="outline" className="text-[10px] h-5 capitalize">{c.nodeType}</Badge> },
                    { label: "创建人", value: c.createdBy || "-" },
                    { label: "使用者", value: c.usedByWallet ? shortenAddress(c.usedByWallet) : "-", mono: true },
                    { label: "使用时间", value: c.usedAt ? new Date(c.usedAt).toLocaleDateString() : "-" },
                  ]}
                  actions={
                    c.status?.toUpperCase() === "ACTIVE" ? (
                      <Button variant="outline" size="sm" className="w-full h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 border-red-500/20"
                        onClick={() => deactivateMutation.mutate(c.id)} disabled={deactivateMutation.isPending}>
                        停用
                      </Button>
                    ) : undefined
                  }
                />
              ))}
            </div>

            {/* Desktop */}
            <div className="hidden lg:block rounded-2xl border border-border/30 backdrop-blur-sm overflow-x-auto" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)" }}>
              <Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow className="border-border/20 hover:bg-transparent">
                    <TableHead>授权码</TableHead><TableHead>节点类型</TableHead><TableHead>状态</TableHead>
                    <TableHead>创建人</TableHead><TableHead>使用者</TableHead><TableHead>使用时间</TableHead><TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {codes.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-foreground/40 py-8">暂无授权码</TableCell></TableRow>
                  ) : codes.map((c: any) => (
                    <TableRow key={c.id} className="border-border/10 hover:bg-white/[0.015]">
                      <TableCell className="font-mono text-xs text-foreground/70 font-semibold">{c.code}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs capitalize">{c.nodeType}</Badge></TableCell>
                      <TableCell>{codeBadge(c.status)}</TableCell>
                      <TableCell className="text-foreground/50 text-xs">{c.createdBy}</TableCell>
                      <TableCell className="font-mono text-xs text-foreground/40">{c.usedByWallet ? shortenAddress(c.usedByWallet) : "-"}</TableCell>
                      <TableCell className="text-foreground/40 text-xs">{c.usedAt ? new Date(c.usedAt).toLocaleDateString() : "-"}</TableCell>
                      <TableCell>
                        {c.status?.toUpperCase() === "ACTIVE" && (
                          <Button variant="outline" size="sm" className="text-red-400 hover:text-red-300 hover:bg-red-500/10 border-red-500/20 h-7 text-xs"
                            onClick={() => deactivateMutation.mutate(c.id)} disabled={deactivateMutation.isPending}>停用</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        {codeTotalPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-foreground/40">{codePage} / {codeTotalPages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setCodePage(p => Math.max(1, p - 1))} disabled={codePage <= 1}>上一页</Button>
              <Button variant="outline" size="sm" onClick={() => setCodePage(p => Math.min(codeTotalPages, p + 1))} disabled={codePage >= codeTotalPages}>下一页</Button>
            </div>
          </div>
        )}
      </section>

      {/* Batch Generate Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[340px] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>批量生成授权码</DialogTitle>
            <DialogDescription>生成格式: 前缀 + 8位随机字符</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground/70">数量</label>
              <Input type="number" min={1} max={100} value={batchCount} onChange={(e) => setBatchCount(e.target.value)} placeholder="10" className="bg-background/50 border-border/30" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground/70">前缀 <span className="text-foreground/30">(可选)</span></label>
              <Input value={batchPrefix} onChange={(e) => setBatchPrefix(e.target.value.toUpperCase())} placeholder="例如 AX" className="bg-background/50 border-border/30" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground/70">节点类型</label>
              <Select value={batchNodeType} onValueChange={setBatchNodeType}>
                <SelectTrigger className="bg-background/50 border-border/30"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MAX">大节点 (MAX)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={batchCreateMutation.isPending}>取消</Button>
            <Button onClick={() => batchCreateMutation.mutate()} disabled={batchCreateMutation.isPending || !batchCount || Number(batchCount) < 1}>
              {batchCreateMutation.isPending ? "生成中..." : "生成"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
