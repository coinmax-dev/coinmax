import { useLocation, Link } from "wouter";
import { LayoutDashboard, Users, GitBranch, Wallet, Server, TrendingUp, KeyRound, LogOut, Menu, X, ScrollText, FileCode2, ShieldCheck, Banknote, Brain, Radio } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useState, createContext, useContext } from "react";
import { useAdminAuth } from "@/admin/admin-auth";

interface NavItem {
  path: string;
  icon: any;
  label: string;
  exact?: boolean;
  permission: string;
}

export const navItems: NavItem[] = [
  { path: "/admin", icon: LayoutDashboard, label: "概览", exact: true, permission: "dashboard" },
  { path: "/admin/members", icon: Users, label: "会员", permission: "members" },
  { path: "/admin/referrals", icon: GitBranch, label: "推荐", permission: "referrals" },
  { path: "/admin/vaults", icon: Wallet, label: "金库", permission: "vaults" },
  { path: "/admin/nodes", icon: Server, label: "节点", permission: "nodes" },
  { path: "/admin/node-funds", icon: Banknote, label: "节点资金", permission: "node-funds" },
  { path: "/admin/auth-codes", icon: KeyRound, label: "授权码", permission: "auth-codes" },
  { path: "/admin/performance", icon: TrendingUp, label: "业绩", permission: "performance" },
  { path: "/admin/contracts", icon: FileCode2, label: "合约", permission: "contracts" },
  { path: "/admin/logs", icon: ScrollText, label: "日志", permission: "logs" },
  { path: "/admin/ai-accuracy", icon: Brain, label: "AI准确率", permission: "ai-accuracy" },
  { path: "/admin/providers", icon: Radio, label: "策略商", permission: "providers" },
  { path: "/admin/admins", icon: ShieldCheck, label: "管理员", permission: "admins" },
];

const DrawerContext = createContext<{ open: boolean; setOpen: (v: boolean) => void }>({ open: false, setOpen: () => {} });
export function useDrawer() { return useContext(DrawerContext); }
export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <DrawerContext.Provider value={{ open, setOpen }}>{children}</DrawerContext.Provider>;
}

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  superadmin: { label: "超级管理", color: "bg-amber-500/12 text-amber-400 border-amber-500/20" },
  admin: { label: "管理员", color: "bg-primary/12 text-primary border-primary/20" },
  support: { label: "客服", color: "bg-blue-500/12 text-blue-400 border-blue-500/20" },
};

export function AdminSidebar() {
  const [location] = useLocation();
  const { t } = useTranslation();
  const { hasPermission, adminRole, adminUser } = useAdminAuth();

  const handleLogout = () => {
    sessionStorage.removeItem("coinmax_admin_token");
    sessionStorage.removeItem("coinmax_admin_user");
    sessionStorage.removeItem("coinmax_admin_role");
    window.location.href = "/admin";
  };

  const visibleItems = navItems.filter((item) => {
    if (item.permission === "contracts") {
      return hasPermission("contracts") || hasPermission("contracts-view");
    }
    return hasPermission(item.permission);
  });

  const roleInfo = ROLE_LABELS[adminRole || "support"];

  return (
    <aside className="hidden lg:flex fixed left-0 top-0 z-50 flex-col w-[240px] h-screen border-r border-white/[0.06] bg-background/95 backdrop-blur-xl">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-white/[0.06]">
        <img src="/logo-glass-pure.png" alt="Logo" className="h-8" />
        <span className="font-display text-sm font-bold tracking-widest text-foreground">
          Coin<span className="text-primary">Max</span>
        </span>
        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border ${roleInfo.color}`}>
          {roleInfo.label}
        </span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleItems.map((item) => {
          const isActive = item.exact ? location === item.path : location.startsWith(item.path);
          const Icon = item.icon;
          return (
            <Link key={item.path} href={item.path}>
              <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all cursor-pointer ${isActive ? "text-primary bg-primary/[0.08] border border-primary/15" : "text-foreground/45 hover:text-foreground/75 hover:bg-white/[0.03] border border-transparent"}`}>
                <Icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? "text-primary" : ""}`} />
                <span>{item.label}</span>
                {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/[0.06] px-3 py-3">
        <div className="px-3 py-1.5 mb-1">
          <span className="text-[10px] text-foreground/25">{adminUser}</span>
        </div>
        <button onClick={handleLogout} className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-[13px] font-medium text-foreground/35 hover:text-red-400 hover:bg-red-500/5 transition-all cursor-pointer">
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          <span>{t("admin.logout", "退出登录")}</span>
        </button>
      </div>
    </aside>
  );
}

export function MobileDrawer() {
  const { open, setOpen } = useDrawer();
  const [location] = useLocation();
  const { t } = useTranslation();
  const { hasPermission, adminRole, adminUser } = useAdminAuth();

  const handleLogout = () => {
    sessionStorage.removeItem("coinmax_admin_token");
    sessionStorage.removeItem("coinmax_admin_user");
    sessionStorage.removeItem("coinmax_admin_role");
    window.location.href = "/admin";
  };

  const visibleItems = navItems.filter((item) => {
    if (item.permission === "contracts") {
      return hasPermission("contracts") || hasPermission("contracts-view");
    }
    return hasPermission(item.permission);
  });

  const roleInfo = ROLE_LABELS[adminRole || "support"];

  if (!open) return null;

  return (
    <>
      <div className="lg:hidden fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="lg:hidden fixed left-0 top-0 bottom-0 z-[70] w-[260px] bg-background border-r border-border/30 flex flex-col animate-in slide-in-from-left duration-200">
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <img src="/logo-glass-pure.png" alt="Logo" className="h-7" />
            <span className="font-display text-sm font-bold tracking-widest text-foreground">
              Coin<span className="text-primary">Max</span>
            </span>
            <span className={`text-[8px] font-bold px-1 py-0.5 rounded border ${roleInfo.color}`}>
              {roleInfo.label}
            </span>
          </div>
          <button onClick={() => setOpen(false)} className="h-8 w-8 rounded-lg flex items-center justify-center text-foreground/40 hover:text-foreground/70 hover:bg-white/[0.05] transition-colors">
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {visibleItems.map((item) => {
            const isActive = item.exact ? location === item.path : location.startsWith(item.path);
            const Icon = item.icon;
            return (
              <Link key={item.path} href={item.path}>
                <div
                  className={`flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                    isActive ? "text-primary bg-primary/10 border border-primary/20" : "text-foreground/50 hover:text-foreground/80 hover:bg-white/[0.03] border border-transparent"
                  }`}
                  onClick={() => setOpen(false)}
                >
                  <Icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? "text-primary" : ""}`} />
                  <span>{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border/20 px-3 py-3">
          <div className="px-3.5 py-1.5 mb-1">
            <span className="text-[10px] text-foreground/25">{adminUser}</span>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-3 w-full px-3.5 py-3 rounded-xl text-sm font-medium text-foreground/40 hover:text-red-400 hover:bg-red-500/5 transition-all cursor-pointer">
            <LogOut className="h-[18px] w-[18px] shrink-0" />
            <span>{t("admin.logout", "退出登录")}</span>
          </button>
        </div>
      </div>
    </>
  );
}
