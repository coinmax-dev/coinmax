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
import { adminGetReferralPairs } from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth";
import { shortenAddress } from "@/lib/constants";

const PAGE_SIZE = 20;

export default function AdminReferrals() {
  const { t } = useTranslation();
  const { adminUser } = useAdminAuth();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "referral-pairs", page],
    queryFn: () => adminGetReferralPairs(page, PAGE_SIZE),
    enabled: !!adminUser,
  });

  const pairs = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-foreground">
        {t("admin.referrals", "Referrals")}
      </h1>

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
                <TableHead>{t("admin.referrerWallet", "Referrer Wallet")}</TableHead>
                <TableHead>{t("admin.userRank", "User Rank")}</TableHead>
                <TableHead>{t("admin.userNodeType", "User Node Type")}</TableHead>
                <TableHead>{t("admin.createdAt", "Created At")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pairs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-foreground/40 py-8">
                    {t("admin.noData", "No data found")}
                  </TableCell>
                </TableRow>
              ) : (
                pairs.map((pair: any) => (
                  <TableRow key={pair.id} className="border-border/10">
                    <TableCell className="font-mono text-xs text-foreground/70">
                      {shortenAddress(pair.userWallet)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-foreground/70">
                      {shortenAddress(pair.referrerWallet)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {pair.userRank}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-foreground/70">
                      {pair.userNodeType || "-"}
                    </TableCell>
                    <TableCell className="text-foreground/40 text-xs">
                      {pair.createdAt
                        ? new Date(pair.createdAt).toLocaleDateString()
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
