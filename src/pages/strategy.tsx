import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useActiveAccount } from "thirdweb/react";
import { useToast } from "@/hooks/use-toast";
import {
  getStrategies, getProfile, getSubscriptions, getHedgePositions,
  getInsurancePool, getHedgePurchases, getAiPredictions, fetchPolymarkets,
  getNewsPredictions, getPredictionBets, subscribeStrategy, purchaseHedge,
  subscribeVip, placePredictionBet,
} from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { formatCompact, formatUSD } from "@/lib/constants";
import {
  Crown, Zap, Shield, CheckCircle2, TrendingUp, TrendingDown,
  Minus, Clock, Brain, Info, RefreshCw, Wallet, ChevronLeft, ChevronRight,
  Search, RotateCcw, Send, Copy, Eye, EyeOff, Key, Link2, MessageCircle,
  Newspaper, Globe, ExternalLink, BarChart3, Sparkles, DollarSign, Trophy,
} from "lucide-react";
import type { Strategy, StrategySubscription, Profile, HedgePosition, InsurancePurchase, AiPrediction, PredictionBet } from "@shared/types";
import { StrategyHeader } from "@/components/strategy/strategy-header";
import { StrategyCard } from "@/components/strategy/strategy-card";

type TabId = "strategies" | "hedge" | "predictions";

const TABS: { id: TabId; labelKey: string }[] = [
  { id: "strategies", labelKey: "strategy.strategyList" },
  { id: "hedge", labelKey: "strategy.hedgeProtection" },
  { id: "predictions", labelKey: "strategy.predictions" },
];

import { EXCHANGES, HEDGE_CONFIG } from "@/lib/data";

export default function StrategyPage() {
  const { t } = useTranslation();
  const account = useActiveAccount();
  const { toast } = useToast();
  const walletAddr = account?.address || "";
  const [activeTab, setActiveTab] = useState<TabId>("strategies");
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [capitalAmount, setCapitalAmount] = useState("");
  const [hedgeAmount, setHedgeAmount] = useState<string>(HEDGE_CONFIG.defaultAmount);
  const [investmentOpen, setInvestmentOpen] = useState(false);
  const [investmentExchange, setInvestmentExchange] = useState("Aster");
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [copyFilterType, setCopyFilterType] = useState("all");
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [bindApiOpen, setBindApiOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [apiPassphrase, setApiPassphrase] = useState("");
  const [depositNetwork, setDepositNetwork] = useState("ERC-20");
  const [showApiSecret, setShowApiSecret] = useState(false);
  const [showApiPassphrase, setShowApiPassphrase] = useState(false);
  const [bindTelegramOpen, setBindTelegramOpen] = useState(false);
  const [telegramUsername, setTelegramUsername] = useState("");
  const [predSubTab, setPredSubTab] = useState<"polymarket" | "news" | "ai">("polymarket");
  const [betDialogOpen, setBetDialogOpen] = useState(false);
  const [betMarket, setBetMarket] = useState<{
    id: string; question: string; type: string;
    choices: { label: string; odds: number; color: string }[];
  } | null>(null);
  const [betChoice, setBetChoice] = useState("");
  const [betAmount, setBetAmount] = useState("");

  const { data: strategies = [], isLoading } = useQuery<Strategy[]>({
    queryKey: ["strategies"],
    queryFn: getStrategies,
  });

  const { data: profile } = useQuery<Profile>({
    queryKey: ["profile", walletAddr],
    queryFn: () => getProfile(walletAddr),
    enabled: !!walletAddr,
  });

  const { data: subscriptions = [] } = useQuery<(StrategySubscription & { strategyName?: string })[]>({
    queryKey: ["subscriptions", walletAddr],
    queryFn: () => getSubscriptions(walletAddr),
    enabled: !!walletAddr,
  });

  const { data: hedgePositions = [] } = useQuery<HedgePosition[]>({
    queryKey: ["hedge-positions", walletAddr],
    queryFn: () => getHedgePositions(walletAddr),
    enabled: !!walletAddr,
  });

  const { data: insurancePool } = useQuery<{ poolSize: string; totalPolicies: number; totalPaid: string; payoutRate: string }>({
    queryKey: ["insurance-pool"],
    queryFn: getInsurancePool,
  });

  const { data: purchases = [] } = useQuery<InsurancePurchase[]>({
    queryKey: ["hedge-purchases", walletAddr],
    queryFn: () => getHedgePurchases(walletAddr),
    enabled: !!walletAddr,
  });

  const { data: aiPredictions = [], isLoading: predsLoading } = useQuery<AiPrediction[]>({
    queryKey: ["ai-predictions"],
    queryFn: getAiPredictions,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  interface PolymarketMarket {
    id: string;
    question: string;
    yesPrice: number;
    noPrice: number;
    volume: number;
    liquidity: number;
    endDate: string;
    category: string;
    slug: string;
  }

  interface NewsPred {
    id: string;
    headline: string;
    source: string;
    publishedAt: string;
    url: string;
    asset: string;
    prediction: "BULLISH" | "BEARISH" | "NEUTRAL";
    confidence: number;
    impact: "HIGH" | "MEDIUM" | "LOW";
    reasoning: string;
  }

  const { data: polymarkets = [], isLoading: polyLoading } = useQuery<PolymarketMarket[]>({
    queryKey: ["polymarket-markets"],
    queryFn: fetchPolymarkets,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const { data: newsPredictions = [], isLoading: newsLoading } = useQuery<NewsPred[]>({
    queryKey: ["news-predictions"],
    queryFn: getNewsPredictions,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });

  const { data: myBets = [] } = useQuery<PredictionBet[]>({
    queryKey: ["prediction-bets", walletAddr],
    queryFn: () => getPredictionBets(walletAddr),
    enabled: !!walletAddr,
  });

  const placeBetMutation = useMutation({
    mutationFn: async (data: { marketId: string; marketType: string; question: string; choice: string; odds: number; amount: number }) => {
      return placePredictionBet(walletAddr, data.marketId, data.marketType, data.question, data.choice, data.odds, data.amount);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prediction-bets", walletAddr] });
      setBetDialogOpen(false);
      setBetAmount("");
      setBetChoice("");
      toast({ title: t("strategy.betPlacedTitle"), description: t("strategy.betPlacedDesc") });
    },
    onError: (err: any) => {
      toast({ title: t("common.error"), description: err.message || "Failed to place bet", variant: "destructive" });
    },
  });

  const openBetDialog = (id: string, question: string, type: string, choices: { label: string; odds: number; color: string }[]) => {
    if (!walletAddr) {
      toast({ title: t("common.connectWallet"), description: t("strategy.connectWalletDesc"), variant: "destructive" });
      return;
    }
    setBetMarket({ id, question, type, choices });
    setBetChoice(choices[0]?.label || "");
    setBetAmount("");
    setBetDialogOpen(true);
  };

  const subscribeMutation = useMutation({
    mutationFn: async (data: { walletAddress: string; strategyId: string; amount: number }) => {
      return subscribeStrategy(data.walletAddress, data.strategyId, data.amount);
    },
    onSuccess: () => {
      toast({ title: t("strategy.subscribed"), description: t("strategy.subscriptionActivated") });
      queryClient.invalidateQueries({ queryKey: ["subscriptions", walletAddr] });
      setSubscribeOpen(false);
      setCapitalAmount("");
      setSelectedStrategy(null);
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const hedgeMutation = useMutation({
    mutationFn: async (data: { walletAddress: string; amount: number }) => {
      return purchaseHedge(data.walletAddress, data.amount);
    },
    onSuccess: () => {
      toast({ title: t("strategy.hedgeSuccess"), description: t("strategy.hedgeSuccessDesc") });
      queryClient.invalidateQueries({ queryKey: ["hedge-positions", walletAddr] });
      queryClient.invalidateQueries({ queryKey: ["hedge-purchases", walletAddr] });
      queryClient.invalidateQueries({ queryKey: ["insurance-pool"] });
      setHedgeAmount(HEDGE_CONFIG.defaultAmount);
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const vipMutation = useMutation({
    mutationFn: async () => {
      return subscribeVip(walletAddr);
    },
    onSuccess: () => {
      toast({ title: t("strategy.vipActivated"), description: t("strategy.vipActivatedDesc") });
      queryClient.invalidateQueries({ queryKey: ["profile", walletAddr] });
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const handleSubscribeClick = (strategy: Strategy) => {
    if (!walletAddr) {
      toast({ title: t("common.connectWallet"), description: t("strategy.connectWalletDesc"), variant: "destructive" });
      return;
    }
    if (strategy.isVipOnly && !profile?.isVip) {
      toast({ title: t("strategy.vipRequired"), description: t("strategy.vipRequiredDesc"), variant: "destructive" });
      return;
    }
    setSelectedStrategy(strategy);
    setSubscribeOpen(true);
  };

  const handleConfirmSubscribe = () => {
    if (!selectedStrategy || !capitalAmount || Number(capitalAmount) <= 0) {
      toast({ title: t("strategy.invalidAmount"), description: t("strategy.invalidCapitalDesc"), variant: "destructive" });
      return;
    }
    subscribeMutation.mutate({
      walletAddress: walletAddr,
      strategyId: selectedStrategy.id,
      amount: Number(capitalAmount),
    });
  };

  const handleHedgePurchase = () => {
    if (!walletAddr) {
      toast({ title: t("common.connectWallet"), description: t("strategy.connectWalletDesc"), variant: "destructive" });
      return;
    }
    if (!hedgeAmount || Number(hedgeAmount) < HEDGE_CONFIG.minAmount) {
      toast({ title: t("strategy.invalidAmount"), description: t("strategy.hedgeMinError"), variant: "destructive" });
      return;
    }
    hedgeMutation.mutate({ walletAddress: walletAddr, amount: Number(hedgeAmount) });
  };

  const totalPremium = hedgePositions.reduce((sum, h) => sum + Number(h.amount || 0), 0);
  const totalPayout = hedgePositions.reduce((sum, h) => sum + Number(h.purchaseAmount || 0), 0);
  const avgPnl = hedgePositions.length > 0
    ? hedgePositions.reduce((sum, h) => sum + Number(h.currentPnl || 0), 0) / hedgePositions.length
    : 0;

  const handleInvestmentClick = () => {
    setInvestmentOpen(true);
  };

  const getCalendarDays = () => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: { day: number; pnl: number }[] = [];
    for (let i = 0; i < firstDay; i++) days.push({ day: 0, pnl: 0 });
    for (let d = 1; d <= daysInMonth; d++) days.push({ day: d, pnl: 0 });
    return days;
  };

  const calendarDays = getCalendarDays();
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const calendarLabel = `${monthNames[calendarMonth.getMonth()]} ${calendarMonth.getFullYear()}`;

  const getStrategyName = (strategyId: string) => {
    const s = strategies.find((st) => st.id === strategyId);
    return s?.name || "Unknown Strategy";
  };

  return (
    <div className="space-y-4 pb-24" data-testid="page-strategy">
      <StrategyHeader />

      <div className="px-4 space-y-3">
        <Button
          className="w-full text-sm font-bold bg-gradient-to-r from-emerald-600 to-teal-500 border-emerald-500/50 text-white"
          onClick={handleInvestmentClick}
          data-testid="button-investment-panel"
        >
          <Wallet className="h-4 w-4 mr-2" />
          {t("strategy.investment")}
          <ChevronRight className="h-4 w-4 ml-auto" />
        </Button>

        <div className="flex gap-0 bg-card border border-border rounded-md overflow-hidden" data-testid="strategy-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`flex-1 py-2.5 text-xs font-bold text-center transition-all ${
                activeTab === tab.id
                  ? "bg-primary text-white"
                  : "text-muted-foreground hover-elevate"
              }`}
              onClick={() => setActiveTab(tab.id)}
              data-testid={`tab-${tab.id}`}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 space-y-4">
        {activeTab === "strategies" && (
          <>
            <div style={{ animation: "fadeSlideIn 0.4s ease-out 0.1s both" }}>
              <h3 className="text-sm font-bold mb-3" data-testid="text-strategies-list-title">{t("strategy.allStrategies")}</h3>
              {isLoading ? (
                <div className="grid grid-cols-2 gap-3">
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-56 rounded-md" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {strategies.map((s, i) => (
                    <StrategyCard key={s.id} strategy={s} index={i} isVip={profile?.isVip} onSubscribe={handleSubscribeClick} />
                  ))}
                </div>
              )}
            </div>

            {walletAddr && !profile?.isVip && (
              <div style={{ animation: "fadeSlideIn 0.4s ease-out 0.3s both" }}>
                <Card className="border-border bg-card glow-green-sm">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Crown className="h-5 w-5 text-primary" />
                      <h3 className="text-sm font-bold">{t("strategy.upgradeToVip")}</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      {t("strategy.vipDesc")}
                    </p>
                    <div className="space-y-2 mb-4">
                      {[t("strategy.vipBenefit1"), t("strategy.vipBenefit2"), t("strategy.vipBenefit3"), t("strategy.vipBenefit4")].map((benefit) => (
                        <div key={benefit} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                          <span>{benefit}</span>
                        </div>
                      ))}
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => vipMutation.mutate()}
                      disabled={vipMutation.isPending}
                      data-testid="button-upgrade-vip"
                    >
                      <Zap className="mr-1 h-4 w-4" />
                      {vipMutation.isPending ? t("common.processing") : t("strategy.upgradeVipPrice")}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        )}

        {activeTab === "hedge" && (
          <div className="space-y-4" style={{ animation: "fadeSlideIn 0.3s ease-out" }}>
            <Card className="border-border bg-card" data-testid="card-my-hedge">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
                  <h3 className="text-sm font-bold">{t("strategy.myHedgeProtection")}</h3>
                  <Button size="icon" variant="ghost" data-testid="button-hedge-info">
                    <Info className="h-4 w-4" />
                  </Button>
                </div>

                <Card className="border-border bg-background mb-3">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="text-[12px] text-muted-foreground">{t("strategy.premiumPaid", { amount: formatUSD(totalPremium) })}</div>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
                      <div className="text-xs font-bold">{t("strategy.payoutBalance", { amount: formatUSD(totalPayout) })}</div>
                      <Button size="sm" variant="secondary" data-testid="button-withdraw-payout" disabled={totalPayout <= 0}>
                        {t("common.withdraw")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-2 gap-3">
                  <Card className="border-border bg-background">
                    <CardContent className="p-3">
                      <div className="text-[12px] text-muted-foreground mb-1 flex items-center gap-1">
                        <Wallet className="h-3 w-3" /> {t("strategy.purchaseAmount")}
                      </div>
                      <div className="text-lg font-bold" data-testid="text-hedge-purchase-total">
                        {formatUSD(totalPremium)}
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-border bg-background">
                    <CardContent className="p-3">
                      <div className="text-[12px] text-muted-foreground mb-1 flex items-center gap-1">
                        <Shield className="h-3 w-3" /> {t("strategy.payoutMultiplier")}
                      </div>
                      <div className="text-lg font-bold text-primary" data-testid="text-hedge-multiplier">
                        3x~4x
                      </div>
                    </CardContent>
                  </Card>
                </div>
                <div className="bg-muted/30 rounded-md p-2.5 mt-3 text-[11px] text-muted-foreground space-y-1">
                  <div className="flex justify-between"><span>{t("strategy.lossBelow10")}</span><span className="text-emerald-400 font-medium">3x {t("strategy.payout")}</span></div>
                  <div className="flex justify-between"><span>{t("strategy.lossAbove10")}</span><span className="text-emerald-400 font-medium">4x {t("strategy.payout")}</span></div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card" data-testid="card-purchase-hedge">
              <CardContent className="p-4">
                <h3 className="text-sm font-bold mb-3">{t("strategy.purchaseHedge")}</h3>
                <div className="flex items-center justify-between gap-2 mb-2 text-xs text-muted-foreground flex-wrap">
                  <span>{t("strategy.investmentAmount")}</span>
                  <span>{t("strategy.minUsdt")}</span>
                </div>
                <div className="flex gap-2 mb-3">
                  <Input
                    type="number"
                    placeholder={HEDGE_CONFIG.defaultAmount}
                    value={hedgeAmount}
                    onChange={(e) => setHedgeAmount(e.target.value)}
                    className="flex-1"
                    data-testid="input-hedge-amount"
                  />
                  <span className="flex items-center text-xs text-muted-foreground font-medium px-2">USDT</span>
                </div>
                <Button
                  className="w-full"
                  onClick={handleHedgePurchase}
                  disabled={hedgeMutation.isPending}
                  data-testid="button-confirm-hedge"
                >
                  {hedgeMutation.isPending ? t("common.processing") : t("strategy.confirmPurchase")}
                </Button>
              </CardContent>
            </Card>

            <Card className="border-border bg-card" data-testid="card-insurance-pool">
              <CardContent className="p-4">
                <h3 className="text-sm font-bold mb-3">{t("strategy.insurancePool")}</h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: t("strategy.coverage"), value: insurancePool?.poolSize ? formatUSD(Number(insurancePool.poolSize)) : "--", color: "text-emerald-400" },
                    { label: t("strategy.claims"), value: insurancePool?.totalPolicies?.toString() || "--", color: "text-emerald-400" },
                    { label: t("strategy.paidOut"), value: insurancePool?.totalPaid ? formatUSD(Number(insurancePool.totalPaid)) : "--", color: "text-emerald-400" },
                    { label: t("strategy.payoutMultiplier"), value: "3x~4x", color: "text-primary" },
                  ].map((item) => (
                    <Card key={item.label} className="border-border bg-background">
                      <CardContent className="p-3 text-center">
                        <div className={`text-lg font-bold ${item.color}`}
                          style={{ textShadow: "0 0 6px rgba(16,185,129,0.3)" }}
                        >
                          {item.value}
                        </div>
                        <div className="text-[12px] text-muted-foreground">{item.label}</div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card" data-testid="card-hedge-records">
              <CardContent className="p-4">
                <div className="flex gap-0 mb-3">
                  <Badge className="text-[12px] bg-primary text-white no-default-hover-elevate no-default-active-elevate">
                    {t("strategy.purchaseRecords")}
                  </Badge>
                  <Badge variant="secondary" className="text-[12px] ml-1 no-default-hover-elevate no-default-active-elevate">
                    {t("strategy.payoutRecords")}
                  </Badge>
                </div>
                <div className="overflow-x-auto">
                <div className="grid grid-cols-4 gap-2 text-[12px] text-muted-foreground font-medium mb-2 px-1 min-w-[280px]">
                  <span>{t("common.amount")}</span>
                  <span>{t("common.date")}</span>
                  <span>{t("common.status")}</span>
                  <span>{t("common.type")}</span>
                </div>
                {purchases.length === 0 ? (
                  <div className="text-center py-4 text-xs text-muted-foreground" data-testid="text-no-records">
                    {t("strategy.noRecordsYet")}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {purchases.slice(0, 10).map((p) => (
                      <div key={p.id} className="grid grid-cols-4 gap-2 text-[12px] px-1 py-1.5 rounded-md bg-background/30 min-w-[280px]" data-testid={`record-${p.id}`}>
                        <span className="font-medium">{Number(p.amount).toFixed(2)}</span>
                        <span className="text-muted-foreground">{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "--"}</span>
                        <Badge variant="secondary" className="text-[10px] no-default-hover-elevate no-default-active-elevate w-fit">
                          {p.status}
                        </Badge>
                        <span className="text-muted-foreground">{t("strategy.hedge")}</span>
                      </div>
                    ))}
                  </div>
                )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card" data-testid="card-exchange-connect">
              <CardContent className="p-4">
                <div className="flex flex-wrap gap-2 mb-4">
                  {EXCHANGES.map((ex) => (
                    <Badge
                      key={ex.name}
                      variant="outline"
                      className="text-[12px] cursor-pointer"
                      data-testid={`badge-exchange-${ex.tag}`}
                    >
                      {ex.tag}
                    </Badge>
                  ))}
                  <Badge variant="outline" className="text-[12px] cursor-pointer" data-testid="badge-exchange-more">
                    {t("common.more")}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-3">
                  <div>
                    <div className="text-[12px] text-muted-foreground">{t("strategy.positionAmount")}</div>
                    <div className="text-sm font-bold" data-testid="text-position-amount">
                      {formatUSD(subscriptions.reduce((s, sub) => s + Number(sub.allocatedCapital || 0), 0))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[12px] text-muted-foreground">{t("vault.pnl")}</div>
                    <div className="text-sm font-bold" data-testid="text-position-pnl">
                      {formatUSD(subscriptions.reduce((s, sub) => s + Number(sub.currentPnl || 0), 0))}
                      {(() => {
                        const totalCap = subscriptions.reduce((s, sub) => s + Number(sub.allocatedCapital || 0), 0);
                        const totalPnlVal = subscriptions.reduce((s, sub) => s + Number(sub.currentPnl || 0), 0);
                        const pct = totalCap > 0 ? (totalPnlVal / totalCap * 100) : 0;
                        return <span className={`text-[12px] ml-1 ${pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>({pct >= 0 ? "+" : ""}{pct.toFixed(2)}%)</span>;
                      })()}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card" data-testid="card-total-assets">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <div className="text-[12px] text-muted-foreground">{t("strategy.totalAssets")}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground">{t("common.all")}</span>
                      <RefreshCw className="h-3 w-3 text-muted-foreground" />
                    </div>
                  </div>
                </div>
                <div className="text-2xl font-bold mt-2" data-testid="text-total-assets">
                  {formatCompact(totalPremium)}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === "predictions" && (
          <div className="space-y-3" style={{ animation: "fadeSlideIn 0.3s ease-out" }}>
            <div className="flex gap-0 bg-card border border-border rounded-md overflow-hidden" data-testid="prediction-sub-tabs">
              {[
                { id: "polymarket" as const, label: t("strategy.polymarket"), icon: Globe },
                { id: "news" as const, label: t("strategy.news"), icon: Newspaper },
                { id: "ai" as const, label: t("strategy.aiPredict"), icon: Brain },
              ].map((tab) => (
                <button
                  key={tab.id}
                  className={`flex-1 py-2 text-[13px] font-bold text-center transition-all flex items-center justify-center gap-1 ${
                    predSubTab === tab.id
                      ? "bg-gradient-to-r from-emerald-600 to-teal-500 text-white"
                      : "text-muted-foreground"
                  }`}
                  onClick={() => setPredSubTab(tab.id)}
                  data-testid={`button-pred-tab-${tab.id}`}
                >
                  <tab.icon className="h-3 w-3" />
                  {tab.label}
                </button>
              ))}
            </div>

            {predSubTab === "polymarket" && (
              <div className="space-y-2">
                {polyLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-28 w-full rounded-md" />
                  ))
                ) : polymarkets.length > 0 ? (
                  polymarkets.map((market) => {
                    const yesPercent = (market.yesPrice * 100).toFixed(1);
                    const noPercent = (market.noPrice * 100).toFixed(1);
                    const yesOdds = market.yesPrice > 0 ? (1 / market.yesPrice).toFixed(2) : "0";
                    const noOdds = market.noPrice > 0 ? (1 / market.noPrice).toFixed(2) : "0";
                    const vol = market.volume >= 1_000_000
                      ? `$${(market.volume / 1_000_000).toFixed(1)}M`
                      : market.volume >= 1_000
                        ? `$${(market.volume / 1_000).toFixed(0)}K`
                        : `$${market.volume.toFixed(0)}`;
                    const endStr = market.endDate
                      ? new Date(market.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                      : "";
                    const hasBet = myBets.some(b => b.marketId === market.id);

                    return (
                      <Card key={market.id} className="border-border bg-card" data-testid={`polymarket-card-${market.id}`}>
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="text-xs font-bold leading-snug flex-1" data-testid={`text-poly-question-${market.id}`}>
                              {market.question}
                            </div>
                            <a
                              href={`https://polymarket.com/event/${market.slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 text-muted-foreground"
                              data-testid={`link-poly-${market.id}`}
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>

                          <div className="flex h-1.5 overflow-hidden rounded-full mb-2">
                            <div className="bg-emerald-500 transition-all duration-500" style={{ width: `${yesPercent}%` }} />
                            <div className="bg-red-500 transition-all duration-500" style={{ width: `${noPercent}%` }} />
                          </div>

                          <div className="flex gap-2 mb-2">
                            <button
                              className="flex-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 py-2 px-2 text-center transition-all active:scale-[0.98] hover:bg-emerald-500/20"
                              onClick={() => openBetDialog(market.id, market.question, "polymarket", [
                                { label: "Yes", odds: market.yesPrice, color: "emerald" },
                                { label: "No", odds: market.noPrice, color: "red" },
                              ])}
                              data-testid={`button-bet-yes-${market.id}`}
                            >
                              <div className="text-[12px] text-emerald-400 font-medium">{t("common.yes")}</div>
                              <div className="text-sm font-bold text-emerald-400">{yesPercent}%</div>
                              <div className="text-[11px] text-muted-foreground">{yesOdds}x</div>
                            </button>
                            <button
                              className="flex-1 rounded-md border border-red-500/30 bg-red-500/10 py-2 px-2 text-center transition-all active:scale-[0.98] hover:bg-red-500/20"
                              onClick={() => openBetDialog(market.id, market.question, "polymarket", [
                                { label: "Yes", odds: market.yesPrice, color: "emerald" },
                                { label: "No", odds: market.noPrice, color: "red" },
                              ])}
                              data-testid={`button-bet-no-${market.id}`}
                            >
                              <div className="text-[12px] text-red-400 font-medium">{t("common.no")}</div>
                              <div className="text-sm font-bold text-red-400">{noPercent}%</div>
                              <div className="text-[11px] text-muted-foreground">{noOdds}x</div>
                            </button>
                          </div>

                          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="flex items-center gap-0.5">
                                <BarChart3 className="h-2.5 w-2.5" /> {vol}
                              </span>
                              {endStr && <span>{t("strategy.ends", { date: endStr })}</span>}
                            </div>
                            {hasBet && (
                              <Badge className="text-[10px] bg-emerald-500/15 text-emerald-400 no-default-hover-elevate no-default-active-elevate">
                                <Trophy className="h-2 w-2 mr-0.5" /> {t("strategy.betPlaced")}
                              </Badge>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                ) : (
                  <Card className="border-border bg-card">
                    <CardContent className="p-6 text-center">
                      <Globe className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground">{t("strategy.noPolymarketData")}</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {predSubTab === "news" && (
              <div className="space-y-2">
                {newsLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-32 w-full rounded-md" />
                  ))
                ) : newsPredictions.length > 0 ? (
                  newsPredictions.map((news) => {
                    const isBullish = news.prediction === "BULLISH";
                    const isBearish = news.prediction === "BEARISH";
                    const impactColor = news.impact === "HIGH"
                      ? "bg-red-500/15 text-red-400"
                      : news.impact === "MEDIUM"
                        ? "bg-yellow-500/15 text-yellow-400"
                        : "bg-muted/50 text-muted-foreground";
                    const bullOdds = isBullish ? Math.max(1.2, (100 / news.confidence)).toFixed(2) : (100 / (100 - news.confidence)).toFixed(2);
                    const bearOdds = isBearish ? Math.max(1.2, (100 / news.confidence)).toFixed(2) : (100 / (100 - news.confidence)).toFixed(2);
                    const timeAgo = (() => {
                      const diff = Date.now() - new Date(news.publishedAt).getTime();
                      const mins = Math.floor(diff / 60000);
                      if (mins < 60) return `${mins}m ago`;
                      const hrs = Math.floor(mins / 60);
                      if (hrs < 24) return `${hrs}h ago`;
                      return `${Math.floor(hrs / 24)}d ago`;
                    })();
                    const hasBet = myBets.some(b => b.marketId === news.id);

                    return (
                      <Card key={news.id} className="border-border bg-card" data-testid={`news-card-${news.id}`}>
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div className="text-[13px] font-bold leading-snug flex-1 line-clamp-2">{news.headline}</div>
                            <a href={news.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-muted-foreground">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>

                          <div className="flex items-center gap-1.5 flex-wrap mb-2">
                            <Badge className={`text-[10px] ${impactColor} no-default-hover-elevate no-default-active-elevate`}>
                              {news.impact}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] no-default-hover-elevate no-default-active-elevate">
                              {news.asset}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground">{news.source} &middot; {timeAgo}</span>
                          </div>

                          <div className="text-[12px] text-foreground/60 leading-snug mb-2">{news.reasoning}</div>

                          <div className="flex gap-2 mb-1.5">
                            <button
                              className="flex-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 py-1.5 px-2 text-center transition-all active:scale-[0.98] hover:bg-emerald-500/20"
                              onClick={() => openBetDialog(news.id, `${news.asset}: ${news.headline}`, "news", [
                                { label: "Bullish", odds: Number(bullOdds) > 0 ? 1 / Number(bullOdds) : 0.5, color: "emerald" },
                                { label: "Bearish", odds: Number(bearOdds) > 0 ? 1 / Number(bearOdds) : 0.5, color: "red" },
                              ])}
                              data-testid={`button-bet-bull-${news.id}`}
                            >
                              <div className="flex items-center justify-center gap-1">
                                <TrendingUp className="h-3 w-3 text-emerald-400" />
                                <span className="text-[12px] font-bold text-emerald-400">{t("trade.bullish")}</span>
                              </div>
                              <div className="text-[11px] text-muted-foreground">{bullOdds}x</div>
                            </button>
                            <button
                              className="flex-1 rounded-md border border-red-500/30 bg-red-500/10 py-1.5 px-2 text-center transition-all active:scale-[0.98] hover:bg-red-500/20"
                              onClick={() => openBetDialog(news.id, `${news.asset}: ${news.headline}`, "news", [
                                { label: "Bullish", odds: Number(bullOdds) > 0 ? 1 / Number(bullOdds) : 0.5, color: "emerald" },
                                { label: "Bearish", odds: Number(bearOdds) > 0 ? 1 / Number(bearOdds) : 0.5, color: "red" },
                              ])}
                              data-testid={`button-bet-bear-${news.id}`}
                            >
                              <div className="flex items-center justify-center gap-1">
                                <TrendingDown className="h-3 w-3 text-red-400" />
                                <span className="text-[12px] font-bold text-red-400">{t("trade.bearish")}</span>
                              </div>
                              <div className="text-[11px] text-muted-foreground">{bearOdds}x</div>
                            </button>
                          </div>

                          {hasBet && (
                            <div className="flex justify-end">
                              <Badge className="text-[10px] bg-emerald-500/15 text-emerald-400 no-default-hover-elevate no-default-active-elevate">
                                <Trophy className="h-2 w-2 mr-0.5" /> {t("strategy.betPlaced")}
                              </Badge>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })
                ) : (
                  <Card className="border-border bg-card">
                    <CardContent className="p-6 text-center">
                      <Newspaper className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground">{t("strategy.noNewsPredictions")}</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {predSubTab === "ai" && (
              <div className="space-y-2">
                {predsLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-32 w-full rounded-md" />
                  ))
                ) : aiPredictions.length > 0 ? (
                  aiPredictions.map((pred) => {
                    const isBullish = pred.prediction === "BULLISH";
                    const isBearish = pred.prediction === "BEARISH";
                    const confidence = Number(pred.confidence || 0);
                    const current = Number(pred.currentPrice || 0);
                    const target = Number(pred.targetPrice || 0);
                    const pctChange = current > 0 ? ((target - current) / current * 100) : 0;
                    const bullConf = isBullish ? confidence : (100 - confidence);
                    const bearConf = isBearish ? confidence : (100 - confidence);
                    const bullOdds = bullConf > 0 ? Math.max(1.1, (100 / bullConf)).toFixed(2) : "2.00";
                    const bearOdds = bearConf > 0 ? Math.max(1.1, (100 / bearConf)).toFixed(2) : "2.00";
                    const hasBet = myBets.some(b => b.marketId === `ai-${pred.asset}`);

                    return (
                      <Card key={pred.id} className="border-border bg-card" data-testid={`prediction-card-${pred.asset}`}>
                        <CardContent className="p-3">
                          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div
                                className={`h-8 w-8 rounded-full flex items-center justify-center ${
                                  isBullish ? "bg-emerald-500/20" : isBearish ? "bg-red-500/20" : "bg-yellow-500/20"
                                }`}
                                style={{
                                  boxShadow: isBullish
                                    ? "0 0 10px rgba(16,185,129,0.3)"
                                    : isBearish
                                      ? "0 0 10px rgba(239,68,68,0.3)"
                                      : undefined,
                                }}
                              >
                                {isBullish ? (
                                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                                ) : isBearish ? (
                                  <TrendingDown className="h-4 w-4 text-red-400" />
                                ) : (
                                  <Minus className="h-4 w-4 text-yellow-400" />
                                )}
                              </div>
                              <div>
                                <div className="text-xs font-bold">{pred.asset}/USDT</div>
                                <div className="text-[12px] text-muted-foreground flex items-center gap-1">
                                  <Clock className="h-2.5 w-2.5" /> {pred.timeframe} &middot; F&G: {pred.fearGreedIndex}
                                </div>
                              </div>
                            </div>
                            <Badge
                              className={`text-[11px] no-default-hover-elevate no-default-active-elevate ${
                                isBullish
                                  ? "bg-emerald-500/20 text-emerald-400"
                                  : isBearish
                                    ? "bg-red-500/20 text-red-400"
                                    : "bg-yellow-500/20 text-yellow-400"
                              }`}
                            >
                              {pred.prediction} {confidence}%
                            </Badge>
                          </div>

                          <div className="grid grid-cols-3 gap-2 mb-2">
                            <div>
                              <div className="text-[11px] text-muted-foreground">{t("strategy.current")}</div>
                              <div className="text-[13px] font-bold tabular-nums">{current > 0 ? formatUSD(current) : "--"}</div>
                            </div>
                            <div>
                              <div className="text-[11px] text-muted-foreground">{t("dashboard.target")}</div>
                              <div className={`text-[13px] font-bold tabular-nums ${isBullish ? "text-emerald-400" : isBearish ? "text-red-400" : ""}`}>
                                {target > 0 ? formatUSD(target) : "--"}
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] text-muted-foreground">{t("strategy.change")}</div>
                              <div className={`text-[13px] font-bold tabular-nums ${pctChange >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {pctChange >= 0 ? "+" : ""}{pctChange.toFixed(2)}%
                              </div>
                            </div>
                          </div>

                          {pred.reasoning && (
                            <div className="mb-2 bg-background/30 rounded-md p-2 border border-border/20">
                              <div className="flex items-center gap-1 mb-0.5">
                                <Sparkles className="h-2.5 w-2.5 text-primary" />
                                <span className="text-[11px] text-muted-foreground">{t("dashboard.aiAnalysis")}</span>
                              </div>
                              <p className="text-[12px] text-foreground/70">{pred.reasoning}</p>
                            </div>
                          )}

                          <div className="flex gap-2">
                            <button
                              className="flex-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 py-1.5 px-2 text-center transition-all active:scale-[0.98] hover:bg-emerald-500/20"
                              onClick={() => openBetDialog(`ai-${pred.asset}`, `${pred.asset} will go UP within ${pred.timeframe}`, "ai", [
                                { label: "Bullish", odds: bullConf / 100, color: "emerald" },
                                { label: "Bearish", odds: bearConf / 100, color: "red" },
                              ])}
                              data-testid={`button-bet-bull-ai-${pred.asset}`}
                            >
                              <div className="flex items-center justify-center gap-1">
                                <TrendingUp className="h-3 w-3 text-emerald-400" />
                                <span className="text-[12px] font-bold text-emerald-400">{t("trade.bull")}</span>
                              </div>
                              <div className="text-[11px] text-muted-foreground">{bullOdds}x</div>
                            </button>
                            <button
                              className="flex-1 rounded-md border border-red-500/30 bg-red-500/10 py-1.5 px-2 text-center transition-all active:scale-[0.98] hover:bg-red-500/20"
                              onClick={() => openBetDialog(`ai-${pred.asset}`, `${pred.asset} will go DOWN within ${pred.timeframe}`, "ai", [
                                { label: "Bullish", odds: bullConf / 100, color: "emerald" },
                                { label: "Bearish", odds: bearConf / 100, color: "red" },
                              ])}
                              data-testid={`button-bet-bear-ai-${pred.asset}`}
                            >
                              <div className="flex items-center justify-center gap-1">
                                <TrendingDown className="h-3 w-3 text-red-400" />
                                <span className="text-[12px] font-bold text-red-400">{t("trade.bear")}</span>
                              </div>
                              <div className="text-[11px] text-muted-foreground">{bearOdds}x</div>
                            </button>
                          </div>

                          {hasBet && (
                            <div className="flex justify-end mt-1.5">
                              <Badge className="text-[10px] bg-emerald-500/15 text-emerald-400 no-default-hover-elevate no-default-active-elevate">
                                <Trophy className="h-2 w-2 mr-0.5" /> {t("strategy.betPlaced")}
                              </Badge>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })
                ) : (
                  <Card className="border-border bg-card">
                    <CardContent className="p-6 text-center">
                      <Brain className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground">{t("strategy.noAiPredictions")}</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={investmentOpen} onOpenChange={setInvestmentOpen}>
        <DialogContent className="bg-card border-border max-w-sm overflow-hidden">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center" style={{ boxShadow: "0 0 12px rgba(16,185,129,0.3)" }}>
                <Wallet className="h-4 w-4 text-white" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold" data-testid="text-investment-dialog-title">
                  {t("strategy.investmentDialog")}
                </DialogTitle>
                <DialogDescription className="text-[13px] text-muted-foreground">
                  {t("strategy.investmentDesc")}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="w-full grid grid-cols-3 mb-3">
              <TabsTrigger value="overview" className="text-xs">{t("strategy.overviewTab")}</TabsTrigger>
              <TabsTrigger value="calendar" className="text-xs">{t("strategy.calendarTab")}</TabsTrigger>
              <TabsTrigger value="records" className="text-xs">{t("strategy.recordsTab")}</TabsTrigger>
            </TabsList>

            <div className="overflow-y-auto max-h-[calc(85vh-10rem)] pr-1">
              <TabsContent value="overview" className="space-y-4 mt-0">
                <div className="flex flex-wrap gap-1.5" data-testid="investment-exchange-tabs">
                  {EXCHANGES.map((ex) => (
                    <Badge
                      key={ex.name}
                      variant={investmentExchange === ex.name ? "default" : "outline"}
                      className={`text-[12px] cursor-pointer ${investmentExchange === ex.name ? "bg-gradient-to-r from-emerald-600 to-teal-500 border-emerald-500/50 text-white" : ""}`}
                      onClick={() => setInvestmentExchange(ex.name)}
                      data-testid={`badge-inv-exchange-${ex.tag}`}
                    >
                      {ex.tag}
                    </Badge>
                  ))}
                  <Badge variant="outline" className="text-[12px] cursor-pointer" data-testid="badge-inv-exchange-more">
                    {t("common.more")}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Card className="border-border bg-background">
                    <CardContent className="p-3">
                      <div className="text-[12px] text-muted-foreground mb-0.5">{t("strategy.positionAmount")}</div>
                      <div className="text-lg font-bold tabular-nums" data-testid="text-inv-position">0.00</div>
                    </CardContent>
                  </Card>
                  <Card className="border-border bg-background">
                    <CardContent className="p-3">
                      <div className="text-[12px] text-muted-foreground mb-0.5">{t("vault.pnl")}</div>
                      <div className="text-lg font-bold tabular-nums" data-testid="text-inv-pnl">
                        0.00 <span className="text-emerald-400 text-[12px]">(0.00%)</span>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card className="border-border bg-background">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="text-[12px] text-muted-foreground font-medium uppercase tracking-wider">{t("strategy.totalAssets")}</div>
                      <RefreshCw className="h-3 w-3 text-muted-foreground cursor-pointer" />
                    </div>
                    <div className="text-2xl font-bold mt-1 bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent" data-testid="text-inv-total-assets">$0</div>
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground flex-wrap">
                        <span>{t("strategy.unrealizedPnl")}</span>
                        <span className="font-medium text-foreground tabular-nums">$0.00</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground flex-wrap">
                        <span>{t("strategy.completedTrades")}</span>
                        <span className="font-medium text-foreground">--</span>
                      </div>
                      <div className="border-t border-border/50 pt-1.5 mt-1.5">
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground flex-wrap">
                          <span>{t("strategy.perpetual")}</span>
                          <span className="font-medium text-foreground tabular-nums">$0</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground flex-wrap">
                          <span>{t("strategy.spot")}</span>
                          <span className="font-medium text-foreground">--</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {walletAddr && subscriptions.length > 0 && (
                  <Card className="border-border bg-background">
                    <CardContent className="p-3">
                      <h4 className="text-xs font-bold mb-2 flex items-center gap-1.5" data-testid="text-my-subs-title">
                        <Copy className="h-3.5 w-3.5 text-emerald-400" />
                        {t("strategy.mySubscriptions")}
                      </h4>
                      <div className="space-y-2">
                        {subscriptions.map((sub) => (
                          <div
                            key={sub.id}
                            className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/30 border border-border/30"
                            data-testid={`inv-sub-${sub.id}`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium truncate">
                                {sub.strategyName || getStrategyName(sub.strategyId)}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {formatUSD(Number(sub.allocatedCapital || 0))}
                              </div>
                            </div>
                            <Badge
                              className={`text-[10px] shrink-0 ${
                                sub.status === "ACTIVE"
                                  ? "bg-emerald-500/15 text-emerald-400"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {sub.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="calendar" className="mt-0">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                    <Button size="icon" variant="ghost" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))} data-testid="button-cal-prev">
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-xs font-bold" data-testid="text-cal-label">{calendarLabel}</span>
                    <Button size="icon" variant="ghost" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))} data-testid="button-cal-next">
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-7 gap-px text-center">
                    {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                      <div key={d} className="text-[10px] text-muted-foreground font-medium py-0.5">{d}</div>
                    ))}
                    {calendarDays.map((cell, idx) => (
                      <div
                        key={idx}
                        className={`rounded-sm py-1 text-center ${cell.day === 0 ? "" : "bg-muted/30 border border-border/30"}`}
                        data-testid={cell.day > 0 ? `cal-day-${cell.day}` : undefined}
                      >
                        {cell.day > 0 && (
                          <>
                            <div className="text-[12px] font-medium">{cell.day}</div>
                            <div className="text-[11px] text-muted-foreground">{cell.pnl.toFixed(2)}</div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="records" className="space-y-4 mt-0">
                <Card className="border-border bg-background">
                  <CardContent className="p-3">
                    <h4 className="text-xs font-bold mb-3 flex items-center gap-1.5" data-testid="text-copy-records-title">
                      <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                      {t("strategy.copyTradingRecords")}
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-lg font-bold tabular-nums" data-testid="text-cumulative-return">0%</div>
                        <div className="text-[12px] text-muted-foreground">{t("strategy.cumulativeReturn")}</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold tabular-nums" data-testid="text-total-profit">0</div>
                        <div className="text-[12px] text-muted-foreground">{t("strategy.totalProfit")}</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold text-emerald-400 tabular-nums" data-testid="text-win-count">0</div>
                        <div className="text-[12px] text-muted-foreground">{t("strategy.winCount")}</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold text-red-400 tabular-nums" data-testid="text-loss-count">0</div>
                        <div className="text-[12px] text-muted-foreground">{t("strategy.lossCount")}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border bg-background">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Badge
                        variant={copyFilterType === "all" ? "default" : "outline"}
                        className={`text-[12px] cursor-pointer ${copyFilterType === "all" ? "bg-gradient-to-r from-emerald-600 to-teal-500 border-emerald-500/50 text-white" : ""}`}
                        onClick={() => setCopyFilterType("all")}
                        data-testid="badge-filter-all"
                      >
                        {t("strategy.allStrategyTypes")}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-[12px] text-muted-foreground mb-2 flex-wrap">
                      <Clock className="h-3 w-3" />
                      <span>{t("strategy.selectDateRange")}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="text-xs bg-gradient-to-r from-emerald-600 to-teal-500 border-emerald-500/50 text-white" data-testid="button-filter-search">
                        <Search className="h-3 w-3 mr-1" />
                        {t("common.search")}
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs" data-testid="button-filter-reset">
                        <RotateCcw className="h-3 w-3 mr-1" />
                        {t("common.reset")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </div>
          </Tabs>

          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border/50">
            <Button
              className="text-xs bg-gradient-to-r from-emerald-600 to-teal-500 border-emerald-500/50 text-white"
              data-testid="button-inv-deposit"
              onClick={() => setDepositOpen(true)}
            >
              <Wallet className="h-3.5 w-3.5 mr-1" />
              {t("common.deposit")}
            </Button>
            <Button
              className="text-xs bg-gradient-to-r from-cyan-600 to-blue-500 border-cyan-500/50 text-white"
              data-testid="button-inv-bind-api"
              onClick={() => setBindApiOpen(true)}
            >
              <Key className="h-3.5 w-3.5 mr-1" />
              {t("strategy.bindApi")}
            </Button>
            <Button
              className="text-xs bg-gradient-to-r from-blue-600 to-indigo-500 border-blue-500/50 text-white"
              data-testid="button-inv-bind-telegram"
              onClick={() => setBindTelegramOpen(true)}
            >
              <MessageCircle className="h-3.5 w-3.5 mr-1" />
              {t("strategy.bindTg")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={subscribeOpen} onOpenChange={setSubscribeOpen}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center" style={{ boxShadow: "0 0 12px rgba(16,185,129,0.3)" }}>
                <TrendingUp className="h-4 w-4 text-white" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold" data-testid="text-subscribe-dialog-title">
                  {t("strategy.subscribeToStrategy")}
                </DialogTitle>
                <DialogDescription className="text-[13px] text-muted-foreground">
                  {t("strategy.subscribeDesc")}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {selectedStrategy && (
            <div className="space-y-4">
              <div>
                <div className="text-sm font-bold mb-2">{selectedStrategy.name}</div>
                <div className="grid grid-cols-3 gap-1.5">
                  <Card className="border-border bg-background">
                    <CardContent className="p-2 text-center">
                      <div className="text-[12px] text-muted-foreground">{t("strategy.leverage")}</div>
                      <div className="text-sm font-bold" data-testid="text-dialog-leverage">
                        {selectedStrategy.leverage}
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-border bg-background">
                    <CardContent className="p-2.5 text-center">
                      <div className="text-[12px] text-muted-foreground">{t("strategy.winRateLabel")}</div>
                      <div className="text-sm font-bold text-emerald-400" data-testid="text-dialog-winrate">
                        {Number(selectedStrategy.winRate).toFixed(1)}%
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-border bg-background">
                    <CardContent className="p-2.5 text-center">
                      <div className="text-[12px] text-muted-foreground">{t("strategy.monthly")}</div>
                      <div className="text-sm font-bold text-emerald-400" data-testid="text-dialog-return">
                        +{Number(selectedStrategy.monthlyReturn).toFixed(1)}%
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">{t("strategy.capitalAmount")}</label>
                <Input
                  type="number"
                  placeholder={t("vault.enterAmount")}
                  value={capitalAmount}
                  onChange={(e) => setCapitalAmount(e.target.value)}
                  data-testid="input-capital-amount"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setSubscribeOpen(false)} data-testid="button-cancel-subscribe">
              {t("common.cancel")}
            </Button>
            <Button
              className="bg-gradient-to-r from-emerald-600 to-teal-500 border-emerald-500/50 text-white"
              onClick={handleConfirmSubscribe}
              disabled={subscribeMutation.isPending}
              data-testid="button-confirm-subscribe"
            >
              <TrendingUp className="mr-1 h-4 w-4" />
              {subscribeMutation.isPending ? t("strategy.subscribing") : t("strategy.confirmSubscribe")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={depositOpen} onOpenChange={setDepositOpen}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center" style={{ boxShadow: "0 0 12px rgba(16,185,129,0.3)" }}>
                <Wallet className="h-4 w-4 text-white" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold" data-testid="text-deposit-dialog-title">{t("strategy.depositFunds")}</DialogTitle>
                <DialogDescription className="text-[13px] text-muted-foreground">
                  {t("strategy.depositTransferDesc", { exchange: investmentExchange })}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">{t("strategy.network")}</label>
              <div className="flex gap-1.5 flex-wrap">
                {["ERC-20", "TRC-20", "BEP-20", "SOL"].map((net) => (
                  <Badge
                    key={net}
                    variant={depositNetwork === net ? "default" : "outline"}
                    className={`text-[12px] cursor-pointer ${depositNetwork === net ? "bg-gradient-to-r from-emerald-600 to-teal-500 border-emerald-500/50 text-white" : ""}`}
                    onClick={() => setDepositNetwork(net)}
                    data-testid={`badge-network-${net}`}
                  >
                    {net}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">{t("strategy.depositAddress")}</label>
              <div className="flex items-center gap-2">
                <Input
                  value={walletAddr || t("strategy.connectWalletFirstInput")}
                  readOnly
                  className="text-xs font-mono"
                  data-testid="input-deposit-address"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    if (walletAddr) {
                      navigator.clipboard.writeText(walletAddr);
                      toast({ title: t("common.copied"), description: t("common.copiedDesc") });
                    }
                  }}
                  data-testid="button-copy-address"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">{t("vault.amountUSDT")}</label>
              <Input
                type="number"
                placeholder="Min 100 USDT"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                data-testid="input-deposit-amount"
              />
            </div>
            <div className="space-y-1 text-[12px] text-muted-foreground">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span>{t("strategy.minDeposit")}</span><span className="font-medium text-foreground">100 USDT</span>
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span>{t("strategy.fee")}</span><span className="font-medium text-foreground">0 USDT</span>
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span>{t("strategy.expectedArrival")}</span><span className="font-medium text-foreground">{t("strategy.fiveMin")}</span>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDepositOpen(false)} data-testid="button-cancel-deposit">{t("common.cancel")}</Button>
            <Button
              className="bg-gradient-to-r from-emerald-600 to-teal-500 border-emerald-500/50 text-white"
              onClick={() => {
                if (!walletAddr) {
                  toast({ title: t("common.connectWallet"), description: t("strategy.connectWalletDesc"), variant: "destructive" });
                  return;
                }
                const amt = parseFloat(depositAmount);
                if (!amt || amt < 100) {
                  toast({ title: t("strategy.invalidAmount"), description: t("strategy.hedgeMinError"), variant: "destructive" });
                  return;
                }
                toast({ title: t("strategy.depositSubmitted"), description: t("strategy.depositSubmittedDesc", { amount: amt, network: depositNetwork, exchange: investmentExchange }) });
                setDepositAmount("");
                setDepositOpen(false);
              }}
              data-testid="button-confirm-deposit"
            >
              <Wallet className="mr-1 h-4 w-4" />
              {t("strategy.confirmDepositBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bindApiOpen} onOpenChange={setBindApiOpen}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center" style={{ boxShadow: "0 0 12px rgba(6,182,212,0.3)" }}>
                <Key className="h-4 w-4 text-white" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold" data-testid="text-bind-api-dialog-title">{t("strategy.bindApiTitle", { exchange: investmentExchange })}</DialogTitle>
                <DialogDescription className="text-[13px] text-muted-foreground">
                  {t("strategy.bindApiDesc")}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4">
            <Card className="border-border bg-background">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 text-[12px] text-muted-foreground flex-wrap">
                  <Info className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span dangerouslySetInnerHTML={{ __html: t("strategy.apiPermissionNote") }} />
                </div>
              </CardContent>
            </Card>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">{t("strategy.apiKey")}</label>
              <Input
                placeholder={t("strategy.enterApiKey")}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="text-xs font-mono"
                data-testid="input-api-key"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">{t("strategy.apiSecret")}</label>
              <div className="flex items-center gap-2">
                <Input
                  type={showApiSecret ? "text" : "password"}
                  placeholder={t("strategy.enterApiSecret")}
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  className="text-xs font-mono"
                  data-testid="input-api-secret"
                />
                <Button size="icon" variant="ghost" onClick={() => setShowApiSecret(v => !v)} data-testid="button-toggle-secret">
                  {showApiSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">{t("strategy.passphrase")}</label>
              <div className="flex items-center gap-2">
                <Input
                  type={showApiPassphrase ? "text" : "password"}
                  placeholder={t("strategy.optional")}
                  value={apiPassphrase}
                  onChange={(e) => setApiPassphrase(e.target.value)}
                  className="text-xs font-mono"
                  data-testid="input-api-passphrase"
                />
                <Button size="icon" variant="ghost" onClick={() => setShowApiPassphrase(v => !v)} data-testid="button-toggle-passphrase">
                  {showApiPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <Badge variant="outline" className="text-[11px] no-default-hover-elevate no-default-active-elevate">
                <CheckCircle2 className="h-2.5 w-2.5 mr-0.5 text-emerald-400" />{t("strategy.read")}
              </Badge>
              <Badge variant="outline" className="text-[11px] no-default-hover-elevate no-default-active-elevate">
                <CheckCircle2 className="h-2.5 w-2.5 mr-0.5 text-emerald-400" />{t("nav.trade")}
              </Badge>
              <Badge variant="outline" className="text-[11px] no-default-hover-elevate no-default-active-elevate">
                <Shield className="h-2.5 w-2.5 mr-0.5 text-red-400" />{t("strategy.noWithdraw")}
              </Badge>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setBindApiOpen(false)} data-testid="button-cancel-bind-api">{t("common.cancel")}</Button>
            <Button
              className="bg-gradient-to-r from-cyan-600 to-blue-500 border-cyan-500/50 text-white"
              onClick={() => {
                if (!apiKey.trim() || !apiSecret.trim()) {
                  toast({ title: t("strategy.missingFields"), description: t("strategy.missingFieldsDesc"), variant: "destructive" });
                  return;
                }
                toast({ title: t("strategy.apiBound"), description: t("strategy.apiBoundDesc", { exchange: investmentExchange }) });
                setApiKey("");
                setApiSecret("");
                setApiPassphrase("");
                setBindApiOpen(false);
              }}
              data-testid="button-confirm-bind-api"
            >
              <Link2 className="mr-1 h-4 w-4" />
              {t("strategy.bindApiBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={betDialogOpen} onOpenChange={setBetDialogOpen}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center" style={{ boxShadow: "0 0 12px rgba(16,185,129,0.3)" }}>
                <DollarSign className="h-4 w-4 text-white" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold" data-testid="text-bet-dialog-title">{t("strategy.placePredictionBet")}</DialogTitle>
                <DialogDescription className="text-[13px] text-muted-foreground">{t("strategy.betDesc")}</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {betMarket && (
            <div className="space-y-4">
              <div className="bg-background/50 rounded-md p-3 border border-border/30">
                <p className="text-xs font-medium leading-snug" data-testid="text-bet-question">{betMarket.question}</p>
                <Badge variant="outline" className="text-[10px] mt-1 no-default-hover-elevate no-default-active-elevate">{betMarket.type}</Badge>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-2 block">{t("strategy.yourPrediction")}</label>
                <div className="grid grid-cols-2 gap-2">
                  {betMarket.choices.map((c) => {
                    const isSelected = betChoice === c.label;
                    const isGreen = c.color === "emerald";
                    const oddsDisplay = c.odds > 0 ? (1 / c.odds).toFixed(2) : "0";
                    const pctDisplay = (c.odds * 100).toFixed(1);

                    return (
                      <button
                        key={c.label}
                        className={`rounded-md border py-3 px-3 text-center transition-all ${
                          isSelected
                            ? isGreen
                              ? "border-emerald-500 bg-emerald-500/20 ring-1 ring-emerald-500/50"
                              : "border-red-500 bg-red-500/20 ring-1 ring-red-500/50"
                            : isGreen
                              ? "border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10"
                              : "border-red-500/20 bg-red-500/5 hover:bg-red-500/10"
                        }`}
                        onClick={() => setBetChoice(c.label)}
                        data-testid={`button-select-${c.label.toLowerCase()}`}
                      >
                        <div className={`text-sm font-bold ${isGreen ? "text-emerald-400" : "text-red-400"}`}>
                          {c.label}
                        </div>
                        <div className="text-[12px] text-muted-foreground">{pctDisplay}% &middot; {oddsDisplay}x</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">{t("strategy.stakeAmount")}</label>
                <Input
                  type="number"
                  placeholder={t("vault.enterAmount")}
                  value={betAmount}
                  onChange={(e) => setBetAmount(e.target.value)}
                  className="text-sm"
                  data-testid="input-bet-amount"
                />
                <div className="flex gap-1 mt-1.5">
                  {[10, 50, 100, 500].map((amt) => (
                    <Button
                      key={amt}
                      variant="outline"
                      size="sm"
                      className="flex-1 text-[12px]"
                      onClick={() => setBetAmount(String(amt))}
                      data-testid={`button-bet-preset-${amt}`}
                    >
                      {amt}
                    </Button>
                  ))}
                </div>
              </div>

              {betAmount && Number(betAmount) > 0 && betChoice && (
                <div className="bg-background/50 rounded-md p-3 border border-border/30 space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
                    <span className="text-muted-foreground">{t("strategy.yourChoice")}</span>
                    <span className="font-bold">{betChoice}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
                    <span className="text-muted-foreground">{t("trade.stake")}</span>
                    <span className="font-bold">{Number(betAmount).toFixed(2)} USDT</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
                    <span className="text-muted-foreground">{t("strategy.potentialPayout")}</span>
                    <span className="font-bold text-emerald-400">
                      {(() => {
                        const chosen = betMarket.choices.find(c => c.label === betChoice);
                        const payout = chosen && chosen.odds > 0 ? Number(betAmount) / chosen.odds : 0;
                        return payout.toFixed(2);
                      })()} USDT
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setBetDialogOpen(false)} data-testid="button-cancel-bet">{t("common.cancel")}</Button>
            <Button
              className="bg-gradient-to-r from-emerald-600 to-teal-500 border-emerald-500/50 text-white"
              disabled={!betAmount || Number(betAmount) <= 0 || !betChoice || placeBetMutation.isPending}
              onClick={() => {
                if (!betMarket || !betChoice || !betAmount) return;
                const chosen = betMarket.choices.find(c => c.label === betChoice);
                placeBetMutation.mutate({
                  marketId: betMarket.id,
                  marketType: betMarket.type,
                  question: betMarket.question,
                  choice: betChoice,
                  odds: chosen?.odds || 0.5,
                  amount: Number(betAmount),
                });
              }}
              data-testid="button-confirm-bet"
            >
              {placeBetMutation.isPending ? (
                <RefreshCw className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <DollarSign className="mr-1 h-4 w-4" />
              )}
              {t("strategy.placeBet")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bindTelegramOpen} onOpenChange={setBindTelegramOpen}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center" style={{ boxShadow: "0 0 12px rgba(59,130,246,0.3)" }}>
                <MessageCircle className="h-4 w-4 text-white" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold" data-testid="text-bind-telegram-dialog-title">{t("strategy.bindTelegram")}</DialogTitle>
                <DialogDescription className="text-[13px] text-muted-foreground">
                  {t("strategy.bindTelegramDesc")}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4">
            <Card className="border-border bg-background">
              <CardContent className="p-3">
                <div className="space-y-2 text-[12px] text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <span className="bg-primary/20 text-primary rounded-full h-4 w-4 flex items-center justify-center shrink-0 text-[11px] font-bold">1</span>
                    <span dangerouslySetInnerHTML={{ __html: t("strategy.tgStep1") }} />
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="bg-primary/20 text-primary rounded-full h-4 w-4 flex items-center justify-center shrink-0 text-[11px] font-bold">2</span>
                    <span dangerouslySetInnerHTML={{ __html: t("strategy.tgStep2") }} />
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="bg-primary/20 text-primary rounded-full h-4 w-4 flex items-center justify-center shrink-0 text-[11px] font-bold">3</span>
                    <span dangerouslySetInnerHTML={{ __html: t("strategy.tgStep3") }} />
                  </div>
                </div>
              </CardContent>
            </Card>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">{t("strategy.telegramUsername")}</label>
              <Input
                placeholder="@your_username"
                value={telegramUsername}
                onChange={(e) => setTelegramUsername(e.target.value)}
                className="text-xs"
                data-testid="input-telegram-username"
              />
            </div>
            <div className="space-y-1 text-[12px] text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                <span>{t("strategy.tgAlertTrades")}</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                <span>{t("strategy.tgAlertPnl")}</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                <span>{t("strategy.tgAlertRisk")}</span>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setBindTelegramOpen(false)} data-testid="button-cancel-bind-telegram">{t("common.cancel")}</Button>
            <Button
              className="bg-gradient-to-r from-blue-600 to-indigo-500 border-blue-500/50 text-white"
              onClick={() => {
                if (!telegramUsername.trim()) {
                  toast({ title: t("strategy.missingUsername"), description: t("strategy.missingUsernameDesc"), variant: "destructive" });
                  return;
                }
                toast({ title: t("strategy.telegramBound"), description: t("strategy.telegramBoundDesc", { username: telegramUsername }) });
                setTelegramUsername("");
                setBindTelegramOpen(false);
              }}
              data-testid="button-confirm-bind-telegram"
            >
              <MessageCircle className="mr-1 h-4 w-4" />
              {t("strategy.bindTelegramBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
