import { useLocation, Link } from "wouter";
import { LayoutDashboard, Users, GitBranch, Wallet, Server, TrendingUp, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";

const navItems = [
  { path: "/admin", icon: LayoutDashboard, label: "Dashboard", exact: true },
  { path: "/admin/members", icon: Users, label: "会员管理" },
  { path: "/admin/referrals", icon: GitBranch, label: "推荐管理" },
  { path: "/admin/vaults", icon: Wallet, label: "金库管理" },
  { path: "/admin/nodes", icon: Server, label: "节点管理" },
  { path: "/admin/performance", icon: TrendingUp, label: "业绩管理" },
];

export function AdminSidebar() {
  const [location] = useLocation();
  const { t } = useTranslation();

  const handleLogout = () => {
    localStorage.removeItem("admin_token");
    window.location.href = "/admin/login";
  };

  return (
    <aside className="fixed left-0 top-0 z-40 flex flex-col w-[240px] h-screen border-r border-border/30 bg-background/95 backdrop-blur-xl">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-border/20">
        <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary/25 to-primary/10 flex items-center justify-center border border-primary/30 relative overflow-hidden">
          <span className="font-display text-base font-black text-primary drop-shadow-[0_0_8px_rgba(0,188,165,0.6)]">C</span>
          <div className="absolute inset-0 bg-gradient-to-t from-transparent to-white/5" />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-display text-base font-bold tracking-widest text-foreground">
            Coin<span className="text-primary drop-shadow-[0_0_6px_rgba(0,188,165,0.5)]">Max</span>
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/20">
            Admin
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = item.exact
            ? location === item.path
            : location.startsWith(item.path);
          const Icon = item.icon;
          return (
            <Link key={item.path} href={item.path}>
              <div
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all cursor-pointer ${
                  isActive
                    ? "text-primary bg-primary/10 shadow-[0_0_12px_rgba(0,188,165,0.08)]"
                    : "text-foreground/45 hover:text-foreground/75 hover:bg-white/[0.03]"
                }`}
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
          className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-[13px] font-medium text-foreground/40 hover:text-red-400 hover:bg-red-500/5 transition-all cursor-pointer"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          <span>{t("common.logout", "退出登录")}</span>
        </button>
      </div>
    </aside>
  );
}
