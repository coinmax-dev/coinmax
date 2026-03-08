import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Users, Wallet, Server, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatsCard } from "@/admin/components/stats-card";
import { adminGetPerformanceStats } from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth";
import { formatUSD } from "@/lib/constants";

export default function AdminDashboard() {
  const { t } = useTranslation();
  const { adminUser } = useAdminAuth();

  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin", "performance-stats"],
    queryFn: () => adminGetPerformanceStats(),
    enabled: !!adminUser,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-foreground">
        {t("admin.dashboard", "Dashboard")}
      </h1>

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            title={t("admin.totalUsers", "Total Users")}
            value={stats?.totalUsers ?? 0}
            icon={Users}
            subtitle={t("admin.registeredAccounts", "Registered accounts")}
          />
          <StatsCard
            title={t("admin.totalDeposited", "Total Deposited")}
            value={formatUSD(Number(stats?.totalDeposited ?? 0))}
            icon={Wallet}
            subtitle={t("admin.allTimeDeposits", "All time deposits")}
          />
          <StatsCard
            title={t("admin.activeNodes", "Active Nodes")}
            value={stats?.activeNodes ?? 0}
            icon={Server}
            subtitle={t("admin.currentlyActive", "Currently active")}
          />
          <StatsCard
            title={t("admin.totalCommissions", "Total Commissions")}
            value={formatUSD(Number(stats?.totalCommissions ?? 0))}
            icon={TrendingUp}
            subtitle={t("admin.allTimeCommissions", "All time commissions")}
          />
        </div>
      )}
    </div>
  );
}
