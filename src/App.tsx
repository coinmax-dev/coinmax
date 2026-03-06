import { Switch, Route, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { authWallet } from "./lib/api";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThirdwebProvider, ConnectButton, useActiveAccount } from "thirdweb/react";
import { createWallet, inAppWallet } from "thirdweb/wallets";
import { useThirdwebClient } from "@/hooks/use-thirdweb";
import { BottomNav } from "@/components/bottom-nav";
import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

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
import NotFound from "@/pages/not-found";

const wallets = [
  inAppWallet(),
  createWallet("pro.tokenpocket"),
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
  createWallet("me.rainbow"),
  createWallet("io.rabby"),
];

function getRefCodeFromUrl(): string | null {
  const urlParams = new URLSearchParams(window.location.search);
  const urlRef = urlParams.get("ref");
  if (urlRef) {
    sessionStorage.setItem("coinmax_ref_code", urlRef);
    urlParams.delete("ref");
    const newUrl = urlParams.toString()
      ? `${window.location.pathname}?${urlParams.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, "", newUrl);
    return urlRef;
  }
  return sessionStorage.getItem("coinmax_ref_code");
}

function WalletSync() {
  const { t } = useTranslation();
  const account = useActiveAccount();
  const refCodeRef = useRef<string | null>(null);
  const [showRefDialog, setShowRefDialog] = useState(false);
  const [refInput, setRefInput] = useState("");
  const [refError, setRefError] = useState("");
  const [refLoading, setRefLoading] = useState(false);

  useEffect(() => {
    refCodeRef.current = getRefCodeFromUrl();
  }, []);

  const doAuth = useCallback(async (address: string, refCode?: string) => {
    const result = await authWallet(address, refCode);
    if (result?.error === "REFERRAL_REQUIRED") {
      setShowRefDialog(true);
      return false;
    }
    if (refCode) sessionStorage.removeItem("coinmax_ref_code");
    return true;
  }, []);

  useEffect(() => {
    if (account?.address) {
      const refCode = refCodeRef.current || sessionStorage.getItem("coinmax_ref_code");
      doAuth(account.address, refCode || undefined).catch(console.error);
    }
  }, [account?.address, doAuth]);

  const handleRefSubmit = async () => {
    if (!refInput.trim() || !account?.address) return;
    setRefError("");
    setRefLoading(true);
    try {
      const ok = await doAuth(account.address, refInput.trim());
      if (ok) {
        setShowRefDialog(false);
        setRefInput("");
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
    <Dialog open={showRefDialog} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-[340px] p-0 overflow-hidden"
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
        <div className="px-6 pt-6 pb-2">
          <div className="text-center mb-4">
            <div className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #0abab5, #34d399)", boxShadow: "0 4px 15px rgba(10,186,181,0.4)" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
              </svg>
            </div>
            <h3 className="text-base font-bold text-white">{t("profile.enterRefCode")}</h3>
            <p className="text-xs text-white/40 mt-1">{t("profile.refCodeRequired")}</p>
          </div>
        </div>
        <div className="px-6 pb-6 space-y-3">
          <input
            type="text"
            value={refInput}
            onChange={(e) => { setRefInput(e.target.value); setRefError(""); }}
            placeholder={t("profile.refCodePlaceholder")}
            className="w-full h-11 rounded-xl px-4 text-sm text-white placeholder:text-white/25 outline-none"
            style={{ background: "rgba(255,255,255,0.06)", border: refError ? "1px solid #ef4444" : "1px solid rgba(10,186,181,0.15)" }}
            onKeyDown={(e) => e.key === "Enter" && handleRefSubmit()}
            autoFocus
          />
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
  );
}

function Header() {
  const { client, isLoading } = useThirdwebClient();
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between px-4 py-2.5 border-b border-border/40 bg-background/90 backdrop-blur-xl">
      <Link href="/" className="flex items-center gap-2.5 cursor-pointer" data-testid="link-logo-home">
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary/25 to-primary/10 flex items-center justify-center neon-glow-sm border border-primary/30 relative overflow-hidden">
          <span className="font-display text-sm font-black text-primary drop-shadow-[0_0_8px_rgba(0,188,165,0.6)]">C</span>
          <div className="absolute inset-0 bg-gradient-to-t from-transparent to-white/5" />
        </div>
        <span className="font-display text-sm font-bold tracking-widest text-foreground">
          Coin<span className="text-primary drop-shadow-[0_0_6px_rgba(0,188,165,0.5)]">Max</span>
        </span>
      </Link>
      {isLoading || !client ? (
        <div className="h-9 w-24 animate-pulse rounded-md bg-muted" />
      ) : (
        <ConnectButton
          client={client}
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
        />
      )}
    </header>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
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

function App() {
  return (
    <ThirdwebProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <div className="min-h-screen bg-background text-foreground">
            <Header />
            <main className="mx-auto max-w-lg">
              <Router />
            </main>
            <BottomNav />
            <WalletSync />
          </div>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThirdwebProvider>
  );
}

export default App;
