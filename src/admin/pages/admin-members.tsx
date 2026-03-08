import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
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

  const handleSearch = () => {
    setSearch(searchInput.trim());
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-foreground">
        {t("admin.members", "Members")}
      </h1>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/40" />
          <Input
            placeholder={t("admin.searchWalletOrRef", "Search wallet address or ref code...")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="pl-9 bg-background/50 border-border/30"
          />
        </div>
        <Button onClick={handleSearch} variant="outline" size="sm">
          {t("admin.search", "Search")}
        </Button>
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
                <TableHead>{t("admin.walletAddress", "Wallet Address")}</TableHead>
                <TableHead>{t("admin.refCode", "Ref Code")}</TableHead>
                <TableHead>{t("admin.rank", "Rank")}</TableHead>
                <TableHead>{t("admin.nodeType", "Node Type")}</TableHead>
                <TableHead>{t("admin.vip", "VIP")}</TableHead>
                <TableHead>{t("admin.totalDeposited", "Total Deposited")}</TableHead>
                <TableHead>{t("admin.createdAt", "Created At")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-foreground/40 py-8">
                    {t("admin.noData", "No data found")}
                  </TableCell>
                </TableRow>
              ) : (
                profiles.map((profile: any) => (
                  <TableRow key={profile.id} className="border-border/10">
                    <TableCell className="font-mono text-xs text-foreground/70">
                      {shortenAddress(profile.walletAddress)}
                    </TableCell>
                    <TableCell className="text-foreground/70">
                      {profile.refCode}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {profile.rank}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-foreground/70">
                      {profile.nodeType || "-"}
                    </TableCell>
                    <TableCell>
                      {profile.isVip ? (
                        <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20">
                          VIP
                        </Badge>
                      ) : (
                        <span className="text-foreground/30">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-foreground/70">
                      {formatUSD(Number(profile.totalDeposited ?? 0))}
                    </TableCell>
                    <TableCell className="text-foreground/40 text-xs">
                      {profile.createdAt
                        ? new Date(profile.createdAt).toLocaleDateString()
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
