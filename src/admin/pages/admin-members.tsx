import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { MobileDataCard } from "@/admin/components/mobile-card";
import { adminGetProfiles } from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth";
import { shortenAddress, formatUSD } from "@/lib/constants";

const PAGE_SIZE = 20;

export default function AdminMembers() {
  const { t } = useTranslation();
  const { adminUser } = useAdminAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "profiles", page, search],
    queryFn: () => adminGetProfiles(page, PAGE_SIZE, search || undefined),
    enabled: !!adminUser,
  });

  const profiles = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleSearch = () => { setSearch(searchInput.trim()); setPage(1); };

  return (
    <div className="space-y-4 lg:space-y-6">
      <h1 className="text-lg lg:text-xl font-bold text-foreground">
        {t("admin.members", "会员管理")}
        {total > 0 && <span className="text-sm font-normal text-foreground/40 ml-2">({total})</span>}
      </h1>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/40" />
          <Input
            placeholder={t("admin.searchWalletOrRef", "搜索钱包地址或推荐码...")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="pl-9 bg-background/50 border-border/30 h-9 text-sm"
          />
        </div>
        <Button onClick={handleSearch} variant="outline" size="sm" className="shrink-0 h-9">
          {t("common.search", "搜索")}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 lg:h-10 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="lg:hidden space-y-3">
            {profiles.length === 0 ? (
              <p className="text-center text-foreground/40 py-8 text-sm">{t("admin.noData", "暂无数据")}</p>
            ) : profiles.map((p: any) => (
              <MobileDataCard
                key={p.id}
                header={
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-primary">{shortenAddress(p.walletAddress)}</span>
                    <div className="flex items-center gap-1.5">
                      <Badge className="text-[10px] h-5 bg-primary/10 text-primary border border-primary/20">{p.rank}</Badge>
                      {p.isVip && <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 text-[10px] h-5">VIP</Badge>}
                    </div>
                  </div>
                }
                fields={[
                  { label: "推荐码", value: p.refCode || "-" },
                  { label: "节点", value: p.nodeType || "-" },
                  { label: "团队", value: <span className="flex items-center gap-1"><Users className="h-3 w-3 text-primary" />{p.teamCount ?? 0}</span> },
                  { label: "总存入", value: formatUSD(Number(p.totalDeposited ?? 0)) },
                  { label: "注册时间", value: p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "-" },
                ]}
              />
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden lg:block rounded-2xl border border-border/30 backdrop-blur-sm overflow-x-auto" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)" }}>
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow className="border-border/20 hover:bg-transparent">
                  <TableHead>钱包地址</TableHead>
                  <TableHead>推荐码</TableHead>
                  <TableHead>等级</TableHead>
                  <TableHead>节点</TableHead>
                  <TableHead>团队</TableHead>
                  <TableHead>VIP</TableHead>
                  <TableHead>总存入</TableHead>
                  <TableHead>注册时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-foreground/40 py-8">{t("admin.noData", "暂无数据")}</TableCell></TableRow>
                ) : profiles.map((p: any) => (
                  <TableRow key={p.id} className="border-border/10 hover:bg-white/[0.015]">
                    <TableCell className="font-mono text-xs text-foreground/70">{shortenAddress(p.walletAddress)}</TableCell>
                    <TableCell className="text-foreground/70">{p.refCode}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{p.rank}</Badge></TableCell>
                    <TableCell className="text-foreground/70">{p.nodeType || "-"}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1 text-xs text-foreground/70">
                        <Users className="h-3 w-3 text-primary" />{p.teamCount ?? 0}
                      </span>
                    </TableCell>
                    <TableCell>{p.isVip ? <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20">VIP</Badge> : <span className="text-foreground/30">-</span>}</TableCell>
                    <TableCell className="text-foreground/70">{formatUSD(Number(p.totalDeposited ?? 0))}</TableCell>
                    <TableCell className="text-foreground/40 text-xs">{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "-"}</TableCell>
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
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>上一页</Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>下一页</Button>
          </div>
        </div>
      )}
    </div>
  );
}
