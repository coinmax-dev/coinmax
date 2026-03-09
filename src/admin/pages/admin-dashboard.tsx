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
    <div className="space-y-4 lg:space-y-6">
      <h1 className="text-lg lg:text-xl font-bold text-foreground">
        {t("admin.dashboard", "仪表盘")}
      </h1>

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[90px] lg:h-[120px] rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatsCard title="总用户" value={stats?.totalUsers ?? 0} icon={Users} subtitle="注册账户" color="#6366f1" />
          <StatsCard title="总存入" value={formatUSD(Number(stats?.totalDeposited ?? 0))} icon={Wallet} subtitle="历史总额" color="#0abab5" />
          <StatsCard title="活跃节点" value={stats?.activeNodes ?? 0} icon={Server} subtitle="当前活跃" color="#f59e0b" />
          <StatsCard title="总佣金" value={formatUSD(Number(stats?.totalCommissions ?? 0))} icon={TrendingUp} subtitle="历史总额" color="#22c55e" />
        </div>
      )}
    </div>
  );
}
