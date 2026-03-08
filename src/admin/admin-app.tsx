import { Switch, Route, useLocation } from "wouter";
import { AdminSidebar } from "./components/admin-sidebar";
import { AdminAuthProvider } from "./admin-auth";
import { useTranslation } from "react-i18next";
import { Shield } from "lucide-react";

// Page imports
import AdminDashboard from "./pages/admin-dashboard";
import AdminMembers from "./pages/admin-members";
import AdminReferrals from "./pages/admin-referrals";
import AdminVaults from "./pages/admin-vaults";
import AdminNodes from "./pages/admin-nodes";
import AdminPerformance from "./pages/admin-performance";

const sectionNames: Record<string, string> = {
  "/admin": "Dashboard",
  "/admin/members": "会员管理",
  "/admin/referrals": "推荐管理",
  "/admin/vaults": "金库管理",
  "/admin/nodes": "节点管理",
  "/admin/performance": "业绩管理",
};

function AdminHeader() {
  const [location] = useLocation();
  const { t } = useTranslation();

  const currentSection =
    Object.entries(sectionNames).find(([path]) =>
      path === "/admin" ? location === "/admin" : location.startsWith(path)
    )?.[1] ?? "Admin";

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-14 px-6 border-b border-border/30 bg-background/90 backdrop-blur-xl">
      <h1 className="text-sm font-semibold text-foreground tracking-wide">
        {currentSection}
      </h1>
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
          <Shield className="h-4 w-4 text-primary" />
        </div>
        <span className="text-xs font-medium text-foreground/50">
          {t("common.admin", "管理员")}
        </span>
      </div>
    </header>
  );
}

function AdminLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <AdminSidebar />
      <div className="ml-[240px]">
        <AdminHeader />
        <main className="p-6">
          <Switch>
            <Route path="/admin" component={AdminDashboard} />
            <Route path="/admin/members" component={AdminMembers} />
            <Route path="/admin/referrals" component={AdminReferrals} />
            <Route path="/admin/vaults" component={AdminVaults} />
            <Route path="/admin/nodes" component={AdminNodes} />
            <Route path="/admin/performance" component={AdminPerformance} />
          </Switch>
        </main>
      </div>
    </div>
  );
}

export default function AdminApp() {
  return (
    <AdminAuthProvider>
      <AdminLayout />
    </AdminAuthProvider>
  );
}
