import { useLocation, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { User, Server, GitBranch, ArrowLeftRight, History, Bell, Settings, TrendingUp, ChevronRight, Coins } from "lucide-react";

const PROFILE_MENU = [
  { path: "/profile", labelKey: "profile.overviewTab", icon: User, exact: true },
  { path: "/profile/nodes", labelKey: "profile.nodeDetailsTitle", icon: Server },
  { path: "/profile/nodes/earnings", labelKey: "profile.nodeEarningsDetail", icon: TrendingUp },
  { path: "/profile/referral", labelKey: "profile.referralTeam", icon: GitBranch },
  { path: "/profile/ma", labelKey: "profile.maToken", icon: Coins },
  { path: "/profile/swap", labelKey: "profile.swap", icon: ArrowLeftRight },
  { path: "/profile/transactions", labelKey: "profile.transactionHistory", icon: History },
  { path: "/profile/notifications", labelKey: "profile.notifications", icon: Bell },
  { path: "/profile/settings", labelKey: "profile.settings", icon: Settings },
];

export function ProfileNav() {
  const [location] = useLocation();
  const { t } = useTranslation();

  return (
    <nav className="hidden lg:block w-[220px] xl:w-[240px] shrink-0 py-4 pr-3">
      <div className="sticky top-[69px] space-y-0.5">
        <div className="px-3 pb-2 text-[11px] font-semibold text-foreground/30 uppercase tracking-wider">
          {t("nav.profile")}
        </div>
        {PROFILE_MENU.map((item) => {
          const isActive = location === item.path;
          const Icon = item.icon;
          return (
            <Link key={item.path} href={item.path}>
              <div
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all cursor-pointer ${
                  isActive
                    ? "text-primary bg-primary/10"
                    : "text-foreground/40 hover:text-foreground/65 hover:bg-white/[0.03]"
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                <span className="flex-1">{t(item.labelKey)}</span>
                <ChevronRight className={`h-3.5 w-3.5 ${isActive ? "opacity-50" : "opacity-20"}`} />
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
