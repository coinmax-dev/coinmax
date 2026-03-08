import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
import { adminGetVaultPositions } from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth";
import { shortenAddress, formatUSD } from "@/lib/constants";

const PAGE_SIZE = 20;
const STATUS_FILTERS = ["ALL", "ACTIVE", "COMPLETED", "WITHDRAWN"] as const;

function statusBadge(status: string) {
  switch (status.toUpperCase()) {
    case "ACTIVE":
      return (
        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20">
          ACTIVE
        </Badge>
      );
    case "COMPLETED":
      return (
        <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20">
          COMPLETED
        </Badge>
      );
    case "WITHDRAWN":
      return (
        <Badge className="bg-gray-500/15 text-gray-400 border-gray-500/20">
          WITHDRAWN
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function AdminVaults() {
  const { t } = useTranslation();
  const { adminUser } = useAdminAuth();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "vault-positions", page, statusFilter],
    queryFn: () =>
      adminGetVaultPositions(
        page,
        PAGE_SIZE,
        statusFilter === "ALL" ? undefined : statusFilter
      ),
    enabled: !!adminUser,
  });

  const positions = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-foreground">
        {t("admin.vaults", "Vaults")}
      </h1>

      {/* Status Filter */}
      <div className="flex items-center gap-2">
        {STATUS_FILTERS.map((status) => (
          <Button
            key={status}
            variant={statusFilter === status ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setStatusFilter(status);
              setPage(1);
            }}
          >
            {t(`admin.status${status.charAt(0) + status.slice(1).toLowerCase()}`, status)}
          </Button>
        ))}
      </div>

      {/* Table */}
      <div
        className="rounded-2xl border border-border/30 backdrop-blur-sm overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
        }}
      >
        {isLoading ? (
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
                <TableHead>{t("admin.planType", "Plan Type")}</TableHead>
                <TableHead>{t("admin.principal", "Principal")}</TableHead>
                <TableHead>{t("admin.dailyRate", "Daily Rate")}</TableHead>
                <TableHead>{t("admin.startDate", "Start Date")}</TableHead>
                <TableHead>{t("admin.endDate", "End Date")}</TableHead>
                <TableHead>{t("admin.status", "Status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-foreground/40 py-8">
                    {t("admin.noData", "No data found")}
                  </TableCell>
                </TableRow>
              ) : (
                positions.map((pos: any) => (
                  <TableRow key={pos.id} className="border-border/10">
                    <TableCell className="font-mono text-xs text-foreground/70">
                      {shortenAddress(pos.userWallet ?? pos.userId)}
                    </TableCell>
                    <TableCell className="text-foreground/70">
                      {pos.planType}
                    </TableCell>
                    <TableCell className="text-foreground/70">
                      {formatUSD(Number(pos.principal))}
                    </TableCell>
                    <TableCell className="text-foreground/70">
                      {(Number(pos.dailyRate) * 100).toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-foreground/40 text-xs">
                      {pos.startDate
                        ? new Date(pos.startDate).toLocaleDateString()
                        : "-"}
                    </TableCell>
                    <TableCell className="text-foreground/40 text-xs">
                      {pos.endDate
                        ? new Date(pos.endDate).toLocaleDateString()
                        : "-"}
                    </TableCell>
                    <TableCell>{statusBadge(pos.status)}</TableCell>
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
