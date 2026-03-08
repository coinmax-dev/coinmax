import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Users, Wallet, Server, TrendingUp, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { StatsCard } from "@/admin/components/stats-card";
import { adminGetPerformanceStats, adminGetCommissions } from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth";
import { shortenAddress, formatUSD } from "@/lib/constants";

const PAGE_SIZE = 20;

function commissionTypeBadge(type: string) {
  switch (type?.toLowerCase()) {
    case "direct":
      return (
        <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20">
          Direct
        </Badge>
      );
    case "differential":
      return (
        <Badge className="bg-purple-500/15 text-purple-400 border-purple-500/20">
          Differential
        </Badge>
      );
    default:
      return <Badge variant="outline">{type}</Badge>;
  }
}

export default function AdminPerformance() {
  const { t } = useTranslation();
  const { adminUser } = useAdminAuth();
  const [page, setPage] = useState(1);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["admin", "performance-stats"],
    queryFn: () => adminGetPerformanceStats(),
    enabled: !!adminUser,
  });

  const { data: commissionData, isLoading: commissionsLoading } = useQuery({
    queryKey: ["admin", "commissions", page],
    queryFn: () => adminGetCommissions(page, PAGE_SIZE),
    enabled: !!adminUser,
  });

  const commissions = commissionData?.data ?? [];
  const total = commissionData?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-foreground">
        {t("admin.performance", "Performance")}
      </h1>

      {/* Stats Cards */}
      {statsLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatsCard
            title={t("admin.totalUsers", "Total Users")}
            value={stats?.totalUsers ?? 0}
            icon={Users}
          />
          <StatsCard
            title={t("admin.totalDeposited", "Total Deposited")}
            value={formatUSD(Number(stats?.totalDeposited ?? 0))}
            icon={Wallet}
          />
          <StatsCard
            title={t("admin.activeNodes", "Active Nodes")}
            value={stats?.activeNodes ?? 0}
            icon={Server}
          />
          <StatsCard
            title={t("admin.totalCommissions", "Total Commissions")}
            value={formatUSD(Number(stats?.totalCommissions ?? 0))}
            icon={TrendingUp}
          />
          <StatsCard
            title={t("admin.totalDeposited", "Total Deposited")}
            value={formatUSD(Number(stats?.totalDeposited ?? 0))}
            icon={DollarSign}
          />
        </div>
      )}

      {/* Commission Records */}
      <h2 className="text-lg font-semibold text-foreground/80">
        {t("admin.commissionRecords", "Commission Records")}
      </h2>

      <div
        className="rounded-2xl border border-border/30 backdrop-blur-sm overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
        }}
      >
        {commissionsLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border/20 hover:bg-transparent">
                <TableHead>{t("admin.userWallet", "User Wallet")}</TableHead>
                <TableHead>{t("admin.amount", "Amount")}</TableHead>
                <TableHead>{t("admin.type", "Type")}</TableHead>
                <TableHead>{t("admin.sourceWallet", "Source Wallet")}</TableHead>
                <TableHead>{t("admin.createdAt", "Created At")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commissions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-foreground/40 py-8">
                    {t("admin.noData", "No data found")}
                  </TableCell>
                </TableRow>
              ) : (
                commissions.map((record: any) => (
                  <TableRow key={record.id} className="border-border/10">
                    <TableCell className="font-mono text-xs text-foreground/70">
                      {shortenAddress(record.userWallet ?? record.userId)}
                    </TableCell>
                    <TableCell className="text-foreground/70 font-medium">
                      {formatUSD(Number(record.amount))}
                    </TableCell>
                    <TableCell>
                      {commissionTypeBadge(record.details?.type ?? record.rewardType)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-foreground/40">
                      {record.sourceWallet
                        ? shortenAddress(record.sourceWallet)
                        : record.details?.sourceUser
                        ? shortenAddress(record.details.sourceUser)
                        : "-"}
                    </TableCell>
                    <TableCell className="text-foreground/40 text-xs">
                      {record.createdAt
                        ? new Date(record.createdAt).toLocaleDateString()
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-foreground/40">
            {t("admin.pageInfo", "Page {{page}} of {{total}}", { page, total: totalPages })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              {t("admin.prev", "Prev")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              {t("admin.next", "Next")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
