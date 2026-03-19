import { Switch, Route, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { authWallet, getProfile, getProfileByRefCode } from "./lib/api";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThirdwebProvider, ConnectButton, useActiveAccount } from "thirdweb/react";
import { createWallet } from "thirdweb/wallets";
import { useThirdwebClient } from "@/hooks/use-thirdweb";
import { BSC_CHAIN } from "@/lib/contracts";
import { BottomNav } from "@/components/bottom-nav";
import { DesktopSidebar } from "@/components/desktop-sidebar";
import LangSwitcher from "@/components/lang-switcher";
import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

import Dashboard from "@/pages/dashboard";
import Trade from "@/pages/trade";
import Vault from "@/pages/vault";
import StrategyPage from "@/pages/strategy";
import ProfilePage from "@/pages/profile";
import ProfileReferralPage from "@/pages/profile-referral";
import ProfileTransactionsPage from "@/pages/profile-transactions";
import ProfileNotificationsPage from "@/pages/profile-notifications";
import ProfileSettingsPage from "@/pages/profile-settings";
import ProfileNodesPage from "@/pages/profile-nodes";
import ProfileNodeEarningsPage from "@/pages/profile-node-earnings";
import ProfileSwapPage from "@/pages/profile-swap";
import MarketPage from "@/pages/market";
import AdminApp from "@/admin/admin-app";
import ProviderApp from "@/provider/provider-app";
import CopyTradingPage from "@/pages/copy-trading";
import NotFound from "@/pages/not-found";

const wallets = [
  createWallet("pro.tokenpocket"),
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
  createWallet("me.rainbow"),
  createWallet("io.rabby"),
];

/**
 * Parse referral codes from URL.
 * Supports two formats:
 *   - New: /r/{refCode}/{placementCode}  (dual referral)
 *   - Legacy: ?ref={refCode}              (single referral, placement = referrer)
 */
function getRefCodesFromUrl(): { refCode: string | null; placementCode: string | null } {
  // New format: /r/{refCode}/{placementCode}
  const pathMatch = window.location.pathname.match(/^\/r\/([^/]+)(?:\/([^/]+))?/);
  if (pathMatch) {
    const ref = pathMatch[1];
    const placement = pathMatch[2] || ref; // default placement = referrer
    localStorage.setItem("coinmax_ref_code", ref);
    localStorage.setItem("coinmax_placement_code", placement);
    window.history.replaceState({}, "", "/");
    return { refCode: ref, placementCode: placement };
  }

  // Legacy format: ?ref={refCode}
  const urlParams = new URLSearchParams(window.location.search);
  const urlRef = urlParams.get("ref");
  if (urlRef) {
    localStorage.setItem("coinmax_ref_code", urlRef);
    localStorage.setItem("coinmax_placement_code", urlRef);
    urlParams.delete("ref");
    const newUrl = urlParams.toString()
      ? `${window.location.pathname}?${urlParams.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, "", newUrl);
    return { refCode: urlRef, placementCode: urlRef };
  }

  return {
    refCode: localStorage.getItem("coinmax_ref_code"),
    placementCode: localStorage.getItem("coinmax_placement_code"),
  };
}

function WalletSync() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const account = useActiveAccount();
  const refCodesRef = useRef<{ refCode: string | null; placementCode: string | null }>({ refCode: null, placementCode: null });
  const [showRefDialog, setShowRefDialog] = useState(false);
  const [showRefConfirm, setShowRefConfirm] = useState(false);
  const [refInput, setRefInput] = useState("");
  const [placementInput, setPlacementInput] = useState("");
  const [refError, setRefError] = useState("");
  const [refLoading, setRefLoading] = useState(false);
  const [referrerWallet, setReferrerWallet] = useState<string | null>(null);
  const [placementWallet, setPlacementWallet] = useState<string | null>(null);

  useEffect(() => {
    refCodesRef.current = getRefCodesFromUrl();
  }, []);

  const doAuth = useCallback(async (address: string, refCode?: string, placementCode?: string) => {
    const result = await authWallet(address, refCode, placementCode);
    if (result?.error === "REFERRAL_REQUIRED") {
      setShowRefDialog(true);
      return false;
    }
    if (refCode) {
      localStorage.removeItem("coinmax_ref_code");
      localStorage.removeItem("coinmax_placement_code");
    }
    return true;
  }, []);

  useEffect(() => {
    if (!account?.address) return;
    const codes = refCodesRef.current;
    const refCode = codes.refCode || localStorage.getItem("coinmax_ref_code");
    const placementCode = codes.placementCode || localStorage.getItem("coinmax_placement_code");

    (async () => {
      try {
        const profile = await getProfile(account.address);
        if (!profile && refCode) {
          // New user with referral code — look up referrer/placement and show confirmation
          try {
            const referrer = await getProfileByRefCode(refCode);
            if (referrer?.walletAddress) setReferrerWallet(referrer.walletAddress);
          } catch {}
          if (placementCode && placementCode !== refCode) {
            try {
              const placement = await getProfileByRefCode(placementCode);
              if (placement?.walletAddress) setPlacementWallet(placement.walletAddress);
            } catch {}
          }
          setRefInput(refCode);
          setPlacementInput(placementCode || refCode);
          setShowRefConfirm(true);
        } else {
          await doAuth(account.address, refCode || undefined, placementCode || undefined);
        }
      } catch {
        await doAuth(account.address, refCode || undefined, placementCode || undefined);
      }
    })();
  }, [account?.address, doAuth]);

  const handleRefConfirm = async () => {
    if (!refInput.trim() || !account?.address) return;
    setRefError("");
    setRefLoading(true);
    try {
      const placement = placementInput.trim() || refInput.trim();
      const ok = await doAuth(account.address, refInput.trim(), placement);
      if (ok) {
        setShowRefConfirm(false);
        setRefInput(""); setPlacementInput("");
        toast({ title: t("common.registerSuccess"), description: t("common.registerSuccessDesc") });
      } else {
        setRefError(t("profile.invalidRefCode"));
      }
    } catch {
      setRefError(t("profile.invalidRefCode"));
    } finally {
      setRefLoading(false);
    }
  };

  const handleRefSubmit = async () => {
    if (!refInput.trim() || !account?.address) return;
    setRefError("");
    setRefLoading(true);
    try {
      const placement = placementInput.trim() || refInput.trim();
      const ok = await doAuth(account.address, refInput.trim(), placement);
      if (ok) {
        setShowRefDialog(false);
        setRefInput(""); setPlacementInput("");
        toast({ title: t("common.registerSuccess"), description: t("common.registerSuccessDesc") });
      } else {
        setRefError(t("profile.invalidRefCode"));
      }
    } catch {
      setRefError(t("profile.invalidRefCode"));
    } finally {
      setRefLoading(false);
    }
  };

  return (
    <>
    <Dialog open={showRefDialog} onOpenChange={() => {}}>
      <DialogContent
        className="w-[calc(100vw-32px)] max-w-[340px] p-0 overflow-hidden"
        style={{
          background: "#1a1a1a",
          border: "1px solid rgba(10,186,181,0.3)",
          borderRadius: 20,
          boxShadow: "0 25px 60px rgba(0,0,0,0.7), 0 0 40px rgba(10,186,181,0.1)",
        }}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{t("profile.enterRefCode")}</DialogTitle>
        <DialogDescription className="sr-only">{t("profile.refCodeRequired")}</DialogDescription>
        <div className="px-4 sm:px-6 pt-5 sm:pt-6 pb-2">
          <div className="text-center mb-3 sm:mb-4">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl mx-auto mb-2.5 sm:mb-3 flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #0abab5, #34d399)", boxShadow: "0 4px 15px rgba(10,186,181,0.4)" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sm:w-6 sm:h-6">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
              </svg>
            </div>
            <h3 className="text-[15px] sm:text-base font-bold text-white">{t("profile.enterRefCode")}</h3>
            <p className="text-[11px] sm:text-xs text-white/40 mt-1">{t("profile.refCodeRequired")}</p>
          </div>
        </div>
        <div className="px-4 sm:px-6 pb-5 sm:pb-6 space-y-3">
          <div>
            <p className="text-[11px] text-white/40 mb-1.5">{t("profile.sponsorCode", "Sponsor Code")}</p>
            <input
              type="text"
              value={refInput}
              onChange={(e) => { setRefInput(e.target.value); setRefError(""); }}
              placeholder={t("profile.refCodePlaceholder")}
              className="w-full h-11 rounded-xl px-4 text-sm text-white placeholder:text-white/25 outline-none"
              style={{ background: "rgba(255,255,255,0.06)", border: refError ? "1px solid #ef4444" : "1px solid rgba(10,186,181,0.15)" }}
              autoFocus
            />
          </div>
          <div>
            <p className="text-[11px] text-white/40 mb-1.5">{t("profile.placementCode", "Placement Code")}</p>
            <input
              type="text"
              value={placementInput}
              onChange={(e) => { setPlacementInput(e.target.value); setRefError(""); }}
              placeholder={t("profile.placementCodePlaceholder", "Placement code (optional)")}
              className="w-full h-11 rounded-xl px-4 text-sm text-white placeholder:text-white/25 outline-none"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(10,186,181,0.15)" }}
              onKeyDown={(e) => e.key === "Enter" && handleRefSubmit()}
            />
            <p className="text-[10px] text-white/25 mt-1">{t("profile.placementCodeHint", "Defaults to sponsor if empty")}</p>
          </div>
          {refError && <p className="text-xs text-red-400">{refError}</p>}
          <button
            onClick={handleRefSubmit}
            disabled={refLoading || !refInput.trim()}
            className="w-full h-11 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.97] disabled:opacity-40"
            style={{
              background: "linear-gradient(135deg, #0abab5, #34d399)",
              boxShadow: "0 4px 15px rgba(10,186,181,0.3)",
            }}
          >
            {refLoading ? t("common.processing") : t("common.confirm")}
          </button>
        </div>
      </DialogContent>
    </Dialog>

    {/* Referral code confirmation dialog for new users from referral link */}
    <Dialog open={showRefConfirm} onOpenChange={() => {}}>
      <DialogContent
        className="w-[calc(100vw-32px)] max-w-[340px] p-0 overflow-hidden"
        style={{
          background: "#1a1a1a",
          border: "1px solid rgba(10,186,181,0.3)",
          borderRadius: 20,
          boxShadow: "0 25px 60px rgba(0,0,0,0.7), 0 0 40px rgba(10,186,181,0.1)",
        }}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{t("profile.confirmRefCode")}</DialogTitle>
        <DialogDescription className="sr-only">{t("profile.confirmRefCodeDesc")}</DialogDescription>
        <div className="px-4 sm:px-6 pt-5 sm:pt-6 pb-2">
          <div className="text-center mb-3 sm:mb-4">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl mx-auto mb-2.5 sm:mb-3 flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #0abab5, #34d399)", boxShadow: "0 4px 15px rgba(10,186,181,0.4)" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sm:w-6 sm:h-6">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <h3 className="text-[15px] sm:text-base font-bold text-white">{t("profile.confirmRefCode")}</h3>
            <p className="text-[11px] sm:text-xs text-white/40 mt-1">{t("profile.confirmRefCodeDesc")}</p>
          </div>
        </div>
        <div className="px-4 sm:px-6 pb-5 sm:pb-6 space-y-3">
          {referrerWallet && (
            <div className="rounded-xl px-3 sm:px-4 py-2.5 sm:py-3" style={{ background: "rgba(10,186,181,0.08)", border: "1px solid rgba(10,186,181,0.15)" }}>
              <p className="text-[11px] text-white/40 mb-1">{t("profile.sponsorLabel", "Sponsor (Referrer)")}</p>
              <p className="text-[11px] sm:text-xs text-primary font-mono truncate">{referrerWallet}</p>
            </div>
          )}
          {placementWallet && placementWallet !== referrerWallet && (
            <div className="rounded-xl px-3 sm:px-4 py-2.5 sm:py-3" style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.15)" }}>
              <p className="text-[11px] text-white/40 mb-1">{t("profile.placementLabel", "Placement (Team)")}</p>
              <p className="text-[11px] sm:text-xs text-yellow-400 font-mono truncate">{placementWallet}</p>
            </div>
          )}
          <div>
            <p className="text-[11px] text-white/40 mb-1.5">{t("profile.sponsorCode", "Sponsor Code")}</p>
            <input
              type="text"
              value={refInput}
              onChange={(e) => { setRefInput(e.target.value); setRefError(""); setReferrerWallet(null); }}
              placeholder={t("profile.refCodePlaceholder")}
              className="w-full h-11 rounded-xl px-4 text-sm text-white placeholder:text-white/25 outline-none text-center font-mono tracking-widest"
              style={{ background: "rgba(255,255,255,0.06)", border: refError ? "1px solid #ef4444" : "1px solid rgba(10,186,181,0.15)" }}
              autoFocus
            />
          </div>
          <div>
            <p className="text-[11px] text-white/40 mb-1.5">{t("profile.placementCode", "Placement Code")}</p>
            <input
              type="text"
              value={placementInput}
              onChange={(e) => { setPlacementInput(e.target.value); setRefError(""); setPlacementWallet(null); }}
              placeholder={t("profile.placementCodePlaceholder", "Placement code (optional)")}
              className="w-full h-11 rounded-xl px-4 text-sm text-white placeholder:text-white/25 outline-none text-center font-mono tracking-widest"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(10,186,181,0.15)" }}
              onKeyDown={(e) => e.key === "Enter" && handleRefConfirm()}
            />
            <p className="text-[10px] text-white/25 mt-1">{t("profile.placementCodeHint", "Defaults to sponsor if empty")}</p>
          </div>
          {refError && <p className="text-xs text-red-400">{refError}</p>}
          <button
            onClick={handleRefConfirm}
            disabled={refLoading || !refInput.trim()}
            className="w-full h-11 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.97] disabled:opacity-40"
            style={{
              background: "linear-gradient(135deg, #0abab5, #34d399)",
              boxShadow: "0 4px 15px rgba(10,186,181,0.3)",
            }}
          >
            {refLoading ? t("common.processing") : t("profile.confirmAndRegister")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

function Header() {
  const { client, isLoading } = useThirdwebClient();
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between px-4 lg:px-8 py-2.5 lg:py-3 border-b border-border/40 bg-background/90 backdrop-blur-xl">
      <Link href="/" className="flex items-center cursor-pointer shrink-0" data-testid="link-logo-home">
        <img src="/logo-glass-pure.png" alt="Logo" className="h-8 lg:h-9" />
        <span className="font-display text-sm lg:text-base font-bold tracking-widest text-foreground ml-1.5">
          Coin<span className="text-primary">Max</span>
        </span>
      </Link>

      <div className="flex items-center gap-2">
        {isLoading || !client ? (
          <div className="h-9 w-20 sm:w-24 animate-pulse rounded-md bg-muted" />
        ) : (
          <ConnectButton
          client={client}
          chain={BSC_CHAIN}
          wallets={wallets}
          connectButton={{
            label: t("common.connect"),
            style: {
              background: "linear-gradient(135deg, hsl(174, 72%, 46%), hsl(170, 60%, 36%))",
              color: "#ffffff",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: "600",
              height: "36px",
              padding: "0 16px",
              border: "none",
              boxShadow: "0 0 12px rgba(0, 188, 165, 0.3), 0 0 4px rgba(0, 188, 165, 0.2)",
            },
          }}
          detailsButton={{
            style: {
              background: "hsl(170, 18%, 10%)",
              color: "hsl(165, 15%, 93%)",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: "500",
              height: "36px",
              padding: "0 12px",
              border: "1px solid rgba(0, 188, 165, 0.2)",
              boxShadow: "0 0 8px rgba(0, 188, 165, 0.06)",
            },
          }}
          theme="dark"
          showThirdwebBranding={false}
        />
      )}
        <LangSwitcher />
      </div>
    </header>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/r/:ref/:placement?" component={Dashboard} />
      <Route path="/trade" component={Trade} />
      <Route path="/vault" component={Vault} />
      <Route path="/strategy" component={StrategyPage} />
      <Route path="/profile" component={ProfilePage} />
      <Route path="/profile/referral" component={ProfileReferralPage} />
      <Route path="/profile/transactions" component={ProfileTransactionsPage} />
      <Route path="/profile/notifications" component={ProfileNotificationsPage} />
      <Route path="/profile/settings" component={ProfileSettingsPage} />
      <Route path="/profile/nodes" component={ProfileNodesPage} />
      <Route path="/profile/swap" component={ProfileSwapPage} />
      <Route path="/profile/nodes/earnings" component={ProfileNodeEarningsPage} />
      <Route path="/market" component={MarketPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppMain() {
  return (
    <main className="flex-1 mx-auto max-w-lg lg:max-w-4xl w-full">
      <Router />
    </main>
  );
}

function MainApp() {
  return (
    <ThirdwebProvider>
      <div className="min-h-screen bg-background text-foreground">
        <Header />
        <div className="flex">
          <DesktopSidebar />
          <AppMain />
        </div>
        <BottomNav />
        <WalletSync />
      </div>
    </ThirdwebProvider>
  );
}

function RootRouter() {
  const [location] = useLocation();

  if (location.startsWith("/admin")) {
    return <AdminApp />;
  }

  if (location.startsWith("/provider")) {
    return <ProviderApp />;
  }

  if (location.startsWith("/copy-trading")) {
    return <CopyTradingPage />;
  }

  return <MainApp />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RootRouter />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
