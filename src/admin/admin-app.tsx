import { Switch, Route, useLocation, Redirect } from "wouter";
import { AdminSidebar, MobileDrawer, DrawerProvider, useDrawer, navItems } from "./components/admin-sidebar";
import { AdminAuthProvider, useAdminAuth } from "./admin-auth";
import { useTranslation } from "react-i18next";
import { Shield, Menu, Lock } from "lucide-react";

// Page imports
import AdminDashboard from "./pages/admin-dashboard";
import AdminMembers from "./pages/admin-members";
import AdminReferrals from "./pages/admin-referrals";
import AdminVaults from "./pages/admin-vaults";
import AdminNodes from "./pages/admin-nodes";
import AdminNodeFunds from "./pages/admin-node-funds";
import AdminAuthCodes from "./pages/admin-auth-codes";
import AdminPerformance from "./pages/admin-performance";
import AdminLogs from "./pages/admin-logs";
import AdminContracts from "./pages/admin-contracts";
import AdminAdmins from "./pages/admin-admins";
import AdminAIAccuracy from "./pages/admin-ai-accuracy";
import AdminProviders from "./pages/admin-providers";

function NoPermission() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Lock className="h-10 w-10 text-foreground/15 mb-4" />
      <h2 className="text-lg font-bold text-foreground/40 mb-1">无权限访问</h2>
      <p className="text-sm text-foreground/25">您的角色没有此页面的访问权限</p>
    </div>
  );
}

function ProtectedRoute({ permission, children }: { permission: string; children: React.ReactNode }) {
  const { hasPermission } = useAdminAuth();
  // contracts page: admin can view (contracts-view), superadmin can edit (contracts)
  if (permission === "contracts") {
    if (!hasPermission("contracts") && !hasPermission("contracts-view")) {
      return <NoPermission />;
    }
    return <>{children}</>;
  }
  if (!hasPermission(permission)) return <NoPermission />;
  return <>{children}</>;
}

function AdminHeader() {
  const [location] = useLocation();
  const { t } = useTranslation();
  const { setOpen } = useDrawer();
  const { adminRole } = useAdminAuth();

  const current = navItems.find((item) =>
    item.exact ? location === item.path : location.startsWith(item.path)
  );

  const roleLabels: Record<string, string> = {
    superadmin: "超级管理",
    admin: "管理员",
    support: "客服",
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-12 lg:h-14 px-4 lg:px-6 border-b border-white/[0.06] bg-background/90 backdrop-blur-xl">
      <div className="flex items-center gap-3 lg:hidden">
        <button
          onClick={() => setOpen(true)}
          className="h-8 w-8 rounded-lg flex items-center justify-center text-foreground/50 hover:text-foreground/80 hover:bg-white/[0.05] transition-colors -ml-1"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-sm font-semibold text-foreground/80">{current?.label ?? "Admin"}</span>
      </div>

      <h1 className="hidden lg:block text-sm font-semibold text-foreground/80 tracking-wide">
        {current?.label ?? "Admin"}
      </h1>

      <div className="flex items-center gap-2.5">
        <div className="h-7 w-7 lg:h-8 lg:w-8 rounded-lg flex items-center justify-center"
          style={{ background: "rgba(10,186,181,0.08)", border: "1px solid rgba(10,186,181,0.15)" }}>
          <Shield className="h-3.5 w-3.5 lg:h-4 lg:w-4 text-primary" />
        </div>
        <span className="text-[11px] font-semibold text-foreground/40 hidden sm:inline uppercase tracking-wider">
          {roleLabels[adminRole || ""] || "管理员"}
        </span>
      </div>
    </header>
  );
}

function AdminLayout() {
  return (
    <DrawerProvider>
      <div className="min-h-screen bg-background text-foreground">
        <AdminSidebar />
        <MobileDrawer />
        <div className="lg:ml-[240px]">
          <AdminHeader />
          <main className="px-3 py-4 lg:p-6">
            <Switch>
              <Route path="/admin" component={AdminDashboard} />
              <Route path="/admin/members">
                <ProtectedRoute permission="members"><AdminMembers /></ProtectedRoute>
              </Route>
              <Route path="/admin/referrals">
                <ProtectedRoute permission="referrals"><AdminReferrals /></ProtectedRoute>
              </Route>
              <Route path="/admin/vaults">
                <ProtectedRoute permission="vaults"><AdminVaults /></ProtectedRoute>
              </Route>
              <Route path="/admin/nodes">
                <ProtectedRoute permission="nodes"><AdminNodes /></ProtectedRoute>
              </Route>
              <Route path="/admin/node-funds">
                <ProtectedRoute permission="node-funds"><AdminNodeFunds /></ProtectedRoute>
              </Route>
              <Route path="/admin/auth-codes">
                <ProtectedRoute permission="auth-codes"><AdminAuthCodes /></ProtectedRoute>
              </Route>
              <Route path="/admin/performance">
                <ProtectedRoute permission="performance"><AdminPerformance /></ProtectedRoute>
              </Route>
              <Route path="/admin/contracts">
                <ProtectedRoute permission="contracts"><AdminContracts /></ProtectedRoute>
              </Route>
              <Route path="/admin/logs">
                <ProtectedRoute permission="logs"><AdminLogs /></ProtectedRoute>
              </Route>
              <Route path="/admin/admins">
                <ProtectedRoute permission="admins"><AdminAdmins /></ProtectedRoute>
              </Route>
              <Route path="/admin/ai-accuracy">
                <ProtectedRoute permission="ai-accuracy"><AdminAIAccuracy /></ProtectedRoute>
              </Route>
              <Route path="/admin/providers">
                <ProtectedRoute permission="providers"><AdminProviders /></ProtectedRoute>
              </Route>
            </Switch>
          </main>
        </div>
      </div>
    </DrawerProvider>
  );
}

export default function AdminApp() {
  return (
    <AdminAuthProvider>
      <AdminLayout />
    </AdminAuthProvider>
  );
}
