import { Switch, Route, Link, useLocation } from "wouter";
import { useState, createContext, useContext, useCallback, type ReactNode } from "react";
import { Radio, BarChart3, List, Key, FileText, LogOut, Menu, X, Settings, DollarSign } from "lucide-react";
import ProviderLogin from "./pages/provider-login";
import ProviderOverview from "./pages/provider-overview";
import ProviderSignals from "./pages/provider-signals";
import ProviderKeys from "./pages/provider-keys";
import ProviderDocs from "./pages/provider-docs";
import ProviderStrategy from "./pages/provider-strategy";
import ProviderRevenue from "./pages/provider-revenue";

// ── Auth Context ──────────────────────────────────

interface ProviderInfo {
  id: string;
  name: string;
  slug: string;
  status: string;
  allowed_assets: string[];
  max_leverage: number;
}

interface ProviderAuthContextValue {
  isAuthenticated: boolean;
  provider: ProviderInfo | null;
  apiKey: string | null;
  login: (key: string) => Promise<string | null>;
  logout: () => void;
}

const ProviderAuthContext = createContext<ProviderAuthContextValue>({
  isAuthenticated: false,
  provider: null,
  apiKey: null,
  login: async () => "Not initialized",
  logout: () => {},
});

export function useProviderAuth() {
  return useContext(ProviderAuthContext);
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://jqgimdgtpwnunrlwexib.supabase.co";

function ProviderAuthProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKey] = useState<string | null>(() => {
    try { return sessionStorage.getItem("coinmax_provider_key"); } catch { return null; }
  });
  const [provider, setProvider] = useState<ProviderInfo | null>(() => {
    try {
      const stored = sessionStorage.getItem("coinmax_provider_info");
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  const login = useCallback(async (key: string): Promise<string | null> => {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/provider-dashboard`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        return err.error || "Invalid API key";
      }
      const data = await resp.json();
      const info: ProviderInfo = data.provider;
      setApiKey(key);
      setProvider(info);
      try {
        sessionStorage.setItem("coinmax_provider_key", key);
        sessionStorage.setItem("coinmax_provider_info", JSON.stringify(info));
      } catch {}
      return null;
    } catch {
      return "Network error";
    }
  }, []);

  const logout = useCallback(() => {
    setApiKey(null);
    setProvider(null);
    try {
      sessionStorage.removeItem("coinmax_provider_key");
      sessionStorage.removeItem("coinmax_provider_info");
    } catch {}
  }, []);

  const isAuthenticated = !!apiKey && !!provider;

  if (!isAuthenticated) {
    return (
      <ProviderAuthContext.Provider value={{ isAuthenticated, provider, apiKey, login, logout }}>
        <ProviderLogin onLogin={login} />
      </ProviderAuthContext.Provider>
    );
  }

  return (
    <ProviderAuthContext.Provider value={{ isAuthenticated, provider, apiKey, login, logout }}>
      {children}
    </ProviderAuthContext.Provider>
  );
}

// ── Nav Items ─────────────────────────────────────

const navItems = [
  { path: "/provider", icon: BarChart3, label: "概览", exact: true },
  { path: "/provider/signals", icon: List, label: "信号记录" },
  { path: "/provider/strategy", icon: Settings, label: "策略管理" },
  { path: "/provider/revenue", icon: DollarSign, label: "收益分成" },
  { path: "/provider/keys", icon: Key, label: "API Key" },
  { path: "/provider/docs", icon: FileText, label: "对接文档" },
];

// ── Layout ────────────────────────────────────────

function ProviderSidebar() {
  const [location] = useLocation();
  const { provider, logout } = useProviderAuth();

  return (
    <aside className="hidden lg:flex fixed left-0 top-0 z-50 flex-col w-[240px] h-screen border-r border-white/[0.06] bg-background/95 backdrop-blur-xl">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-white/[0.06]">
        <Radio className="h-5 w-5 text-primary" />
        <span className="font-display text-sm font-bold tracking-widest text-foreground">
          策略<span className="text-primary">中心</span>
        </span>
      </div>

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

      <div className="border-t border-white/[0.06] px-3 py-3">
        <div className="px-3 py-1.5 mb-1">
          <span className="text-[10px] text-foreground/25">{provider?.name}</span>
        </div>
        <button onClick={logout} className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-[13px] font-medium text-foreground/35 hover:text-red-400 hover:bg-red-500/5 transition-all cursor-pointer">
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          <span>退出登录</span>
        </button>
      </div>
    </aside>
  );
}

function MobileNav() {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  const { provider, logout } = useProviderAuth();

  return (
    <>
      <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between h-12 px-4 border-b border-white/[0.06] bg-background/90 backdrop-blur-xl">
        <button onClick={() => setOpen(true)} className="h-8 w-8 rounded-lg flex items-center justify-center text-foreground/50 hover:text-foreground/80">
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-sm font-semibold text-foreground/80">{provider?.name}</span>
        <Radio className="h-4 w-4 text-primary" />
      </header>

      {open && (
        <>
          <div className="lg:hidden fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="lg:hidden fixed left-0 top-0 bottom-0 z-[70] w-[260px] bg-background border-r border-border/30 flex flex-col animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between px-4 py-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Radio className="h-5 w-5 text-primary" />
                <span className="text-sm font-bold">策略中心</span>
              </div>
              <button onClick={() => setOpen(false)} className="h-8 w-8 rounded-lg flex items-center justify-center text-foreground/40">
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              {navItems.map((item) => {
                const isActive = item.exact ? location === item.path : location.startsWith(item.path);
                const Icon = item.icon;
                return (
                  <Link key={item.path} href={item.path}>
                    <div
                      className={`flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer ${isActive ? "text-primary bg-primary/10 border border-primary/20" : "text-foreground/50 hover:text-foreground/80 border border-transparent"}`}
                      onClick={() => setOpen(false)}
                    >
                      <Icon className={`h-[18px] w-[18px] ${isActive ? "text-primary" : ""}`} />
                      <span>{item.label}</span>
                    </div>
                  </Link>
                );
              })}
            </nav>
            <div className="border-t border-border/20 px-3 py-3">
              <button onClick={logout} className="flex items-center gap-3 w-full px-3.5 py-3 rounded-xl text-sm font-medium text-foreground/40 hover:text-red-400">
                <LogOut className="h-[18px] w-[18px]" />
                <span>退出</span>
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function ProviderLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <ProviderSidebar />
      <MobileNav />
      <div className="lg:ml-[240px]">
        <header className="hidden lg:flex sticky top-0 z-30 items-center h-14 px-6 border-b border-white/[0.06] bg-background/90 backdrop-blur-xl">
          <h1 className="text-sm font-semibold text-foreground/80">策略提供方中心</h1>
        </header>
        <main className="px-3 py-4 lg:p-6">
          <Switch>
            <Route path="/provider" component={ProviderOverview} />
            <Route path="/provider/signals" component={ProviderSignals} />
            <Route path="/provider/strategy" component={ProviderStrategy} />
            <Route path="/provider/revenue" component={ProviderRevenue} />
            <Route path="/provider/keys" component={ProviderKeys} />
            <Route path="/provider/docs" component={ProviderDocs} />
          </Switch>
        </main>
      </div>
    </div>
  );
}

export default function ProviderApp() {
  return (
    <ProviderAuthProvider>
      <ProviderLayout />
    </ProviderAuthProvider>
  );
}
