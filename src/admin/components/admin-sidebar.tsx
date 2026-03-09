import { useLocation, Link } from "wouter";
import { LayoutDashboard, Users, GitBranch, Wallet, Server, TrendingUp, KeyRound, LogOut, Menu, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useState, createContext, useContext } from "react";

export const navItems = [
  { path: "/admin", icon: LayoutDashboard, labelKey: "admin.dashboard", label: "概览", exact: true },
  { path: "/admin/members", icon: Users, labelKey: "admin.members", label: "会员" },
  { path: "/admin/referrals", icon: GitBranch, labelKey: "admin.referrals", label: "推荐" },
  { path: "/admin/vaults", icon: Wallet, labelKey: "admin.vaults", label: "金库" },
  { path: "/admin/nodes", icon: Server, labelKey: "admin.nodes", label: "节点" },
  { path: "/admin/auth-codes", icon: KeyRound, labelKey: "admin.authCodes", label: "授权码" },
  { path: "/admin/performance", icon: TrendingUp, labelKey: "admin.performance", label: "业绩" },
];

// Mobile drawer open/close context
const DrawerContext = createContext<{ open: boolean; setOpen: (v: boolean) => void }>({ open: false, setOpen: () => {} });
export function useDrawer() { return useContext(DrawerContext); }
export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <DrawerContext.Provider value={{ open, setOpen }}>{children}</DrawerContext.Provider>;
}

/** Desktop sidebar — hidden on mobile */
export function AdminSidebar() {
  const [location] = useLocation();
  const { t } = useTranslation();

  const handleLogout = () => {
    sessionStorage.removeItem("coinmax_admin_token");
    sessionStorage.removeItem("coinmax_admin_user");
    window.location.href = "/admin";
  };

  return (
    <aside className="hidden lg:flex fixed left-0 top-0 z-50 flex-col w-[240px] h-screen border-r border-white/[0.06] bg-background/95 backdrop-blur-xl">
      {/* Logo */}
      <div className="flex items-center gap-2 px-5 py-4 border-b border-white/[0.06]">
        <img src="/logo-glass-pure.png" alt="Logo" className="h-8" />
        <span className="font-display text-sm font-bold tracking-widest text-foreground">
          Coin<span className="text-primary">Max</span>
        </span>
        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-primary/12 text-primary border border-primary/20">
          Admin
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
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

      {/* Logout */}
      <div className="border-t border-white/[0.06] px-3 py-3">
        <button onClick={handleLogout} className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-[13px] font-medium text-foreground/35 hover:text-red-400 hover:bg-red-500/5 transition-all cursor-pointer">
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          <span>{t("admin.logout", "退出登录")}</span>
        </button>
      </div>
    </aside>
  );
}

/** Mobile slide-out drawer — hidden on desktop */
export function MobileDrawer() {
  const { open, setOpen } = useDrawer();
  const [location] = useLocation();
  const { t } = useTranslation();

  const handleLogout = () => {
    sessionStorage.removeItem("coinmax_admin_token");
    sessionStorage.removeItem("coinmax_admin_user");
    window.location.href = "/admin";
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="lg:hidden fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      {/* Drawer panel */}
      <div className="lg:hidden fixed left-0 top-0 bottom-0 z-[70] w-[260px] bg-background border-r border-border/30 flex flex-col animate-in slide-in-from-left duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <img src="/logo-glass-pure.png" alt="Logo" className="h-7" />
            <span className="font-display text-sm font-bold tracking-widest text-foreground">
              Coin<span className="text-primary">Max</span>
            </span>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-foreground/40 hover:text-foreground/70 hover:bg-white/[0.05] transition-colors"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = item.exact ? location === item.path : location.startsWith(item.path);
            const Icon = item.icon;
            return (
              <Link key={item.path} href={item.path}>
                <div
                  className={`flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                    isActive
                      ? "text-primary bg-primary/10 border border-primary/20"
                      : "text-foreground/50 hover:text-foreground/80 hover:bg-white/[0.03] border border-transparent"
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

        {/* Logout */}
        <div className="border-t border-border/20 px-3 py-3">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3.5 py-3 rounded-xl text-sm font-medium text-foreground/40 hover:text-red-400 hover:bg-red-500/5 transition-all cursor-pointer"
          >
            <LogOut className="h-[18px] w-[18px] shrink-0" />
            <span>{t("admin.logout", "退出登录")}</span>
          </button>
        </div>
      </div>
    </>
  );
}
