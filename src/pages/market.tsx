import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUSD, formatCompact } from "@/lib/constants";
import { ArrowLeft, ChevronLeft, ChevronRight, Activity, Flame, Eye, Globe, Calendar, TrendingUp, TrendingDown } from "lucide-react";
import { useLocation } from "wouter";
import { fetchMarketCalendar, fetchFearGreedHistory, fetchSentiment, fetchFuturesOI, fetchExchangePrices } from "@/lib/api";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

/* ───────── Types ───────── */
interface CalendarDay { date: string; day: number; change: number; }
interface CalendarData { dailyChanges: CalendarDay[]; currentPrice: number; }
interface FearGreedHistory {
  current: { value: number; label: string };
  buckets: { extremeFear: number; fear: number; neutral: number; greed: number; extremeGreed: number };
  totalDays: number;
  chartData: { date: string; fgi: number; btcPrice: number }[];
}
interface SentimentCoin {
  id: string; symbol: string; name: string; image: string;
  price: number; change24h: number; netFlow: number;
}
interface SentimentData { coins: SentimentCoin[]; totalNetInflow: number; }
interface FuturesOIPos {
  pair: string; symbol: string; exchange: string;
  openInterestValue: number; openInterest: number; price: number; priceChange24h: number;
}
interface FuturesOIData { positions: FuturesOIPos[]; totalOI: number; }
interface ExchangePriceRow {
  exchange: string; pair: string; symbol: string; price: number; change24h: number; isReal?: boolean;
}
interface CoinExchangeData {
  symbol: string; basePrice: number; baseChange: number; exchanges: ExchangePriceRow[];
}

/* ───────── Reusable Animation Helpers ───────── */

const EXCHANGE_COLORS: Record<string, string> = {
  Binance: "#F0B90B",
  OKX: "#fff",
  Bybit: "#F7A600",
  Coinbase: "#0052FF",
  Bitget: "#00F0FF",
  "Gate.io": "#2354E6",
  KuCoin: "#23AF5F",
  HTX: "#2A70EF",
  MEXC: "#1972E2",
  Kraken: "#5741D9",
};

function getExchangeColor(name: string) {
  return EXCHANGE_COLORS[name] || "#888";
}

/** Fast-jitter animated value (300-600ms tick) */
function AnimatedValue({ value, decimals = 2, prefix = "", suffix = "", color, className = "" }: {
  value: number; decimals?: number; prefix?: string; suffix?: string; color?: string; className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const tickRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { setDisplay(value); }, [value]);

  useEffect(() => {
    const amplitude = Math.max(0.01, Math.abs(value) * 0.003);
    const tick = () => {
      setDisplay(() => {
        const jitter = (Math.random() - 0.5) * 2 * amplitude;
        return value + jitter;
      });
      tickRef.current = setTimeout(tick, 300 + Math.random() * 300);
    };
    tickRef.current = setTimeout(tick, 200 + Math.random() * 400);
    return () => clearTimeout(tickRef.current);
  }, [value]);

  return (
    <span className={`font-mono tabular-nums ${className}`} style={color ? { color } : undefined}>
      {prefix}{display.toFixed(decimals)}{suffix}
    </span>
  );
}

/** Animated compact flow (e.g., $1.2B) with jitter */
function AnimatedCompactFlow({ value, isPositive }: { value: number; isPositive: boolean }) {
  const [display, setDisplay] = useState(value);
  const tickRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { setDisplay(value); }, [value]);

  useEffect(() => {
    const amplitude = Math.max(1, Math.abs(value) * 0.002);
    const tick = () => {
      setDisplay(() => value + (Math.random() - 0.5) * 2 * amplitude);
      tickRef.current = setTimeout(tick, 300 + Math.random() * 300);
    };
    tickRef.current = setTimeout(tick, 300);
    return () => clearTimeout(tickRef.current);
  }, [value]);

  const color = isPositive ? "#34d399" : "#f87171";
  return (
    <span className="font-mono font-bold tabular-nums" style={{ color, textShadow: `0 0 10px ${color}30` }}>
      {isPositive ? "" : "-"}{formatCompact(Math.abs(display))}
    </span>
  );
}

/* ───────── Section header ───────── */
function SectionHeader({ icon: Icon, title, badge, badgeClass }: {
  icon: React.ComponentType<{ className?: string }>; title: string; badge?: string; badgeClass?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      <Icon className="h-4 w-4 text-emerald-400" />
      <h2 className="text-sm font-bold">{title}</h2>
      {badge && (
        <Badge className={`text-[10px] ml-auto no-default-hover-elevate no-default-active-elevate ${badgeClass || "bg-muted/30 text-muted-foreground"}`}>
          {badge}
        </Badge>
      )}
    </div>
  );
}

/* ───────── Constants ───────── */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ───────── Fear & Greed Gauge ───────── */
function FearGreedGauge({ value, label }: { value: number; label: string }) {
  const { t } = useTranslation();
  const angle = -90 + (value / 100) * 180;
  const overshootAngle = angle + 6;
  const gaugeColor =
    value <= 25 ? "#ef4444" : value <= 45 ? "#f97316" : value <= 55 ? "#eab308" : value <= 75 ? "#84cc16" : "#22c55e";

  return (
    <div className="flex flex-col items-center py-4" data-testid="fear-greed-gauge">
      <svg viewBox="0 0 220 130" className="w-full max-w-[14rem] h-auto">
        <defs>
          <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="25%" stopColor="#f97316" />
            <stop offset="50%" stopColor="#eab308" />
            <stop offset="75%" stopColor="#84cc16" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
          <filter id="gaugeGlow">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* Glow layer */}
        <path d="M 30 110 A 80 80 0 0 1 190 110" fill="none" stroke="url(#gaugeGrad)" strokeWidth="14" strokeLinecap="round" opacity="0.3" filter="url(#gaugeGlow)" />
        {/* Main arc */}
        <path d="M 30 110 A 80 80 0 0 1 190 110" fill="none" stroke="url(#gaugeGrad)" strokeWidth="14" strokeLinecap="round" />
        <text x="15" y="118" fontSize="7" fill="#ef4444" textAnchor="start" fontWeight="bold">{t("market.extremeFear")}</text>
        <text x="58" y="52" fontSize="7" fill="#f97316" textAnchor="middle" fontWeight="bold">{t("market.fear")}</text>
        <text x="110" y="30" fontSize="7" fill="#eab308" textAnchor="middle" fontWeight="bold">{t("market.neutral")}</text>
        <text x="162" y="52" fontSize="7" fill="#84cc16" textAnchor="middle" fontWeight="bold">{t("market.greed")}</text>
        <text x="205" y="118" fontSize="7" fill="#22c55e" textAnchor="end" fontWeight="bold">{t("market.extremeGreed")}</text>
        {/* Needle with easeOutBack overshoot animation */}
        <g
          style={{
            transformOrigin: "110px 110px",
            "--needle-angle": `${angle}deg`,
            "--needle-angle-overshoot": `${overshootAngle}deg`,
            "--gauge-color": gaugeColor,
            animation: "gaugeNeedleIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
          } as React.CSSProperties}
        >
          <polygon points="110,40 106,110 114,110" fill={gaugeColor} opacity="0.9" />
          {/* Pulsing glow center */}
          <circle
            cx="110" cy="110" r="6" fill={gaugeColor}
            style={{ animation: "pulseCenter 2s ease-in-out infinite" } as React.CSSProperties}
          />
        </g>
      </svg>
      <div
        className="text-4xl font-display font-bold mt-1"
        style={{ color: gaugeColor, textShadow: `0 0 16px ${gaugeColor}50` }}
        data-testid="text-fear-greed-value"
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5" data-testid="text-fear-greed-label">{label}</div>
    </div>
  );
}

/* ───────── Fear & Greed Chart ───────── */
function FearGreedChart({ data, coinSymbol }: { data: { date: string; fgi: number; btcPrice: number }[]; coinSymbol: string }) {
  const { t } = useTranslation();
  if (!data || data.length === 0) return null;
  const sampled = data.filter((_, i) => i % 3 === 0 || i === data.length - 1);
  const hasPrice = sampled.some(d => d.btcPrice > 0);

  const formatPrice = (v: number) => {
    if (v >= 1000) return `$${(v/1000).toFixed(0)}K`;
    if (v >= 1) return `$${v.toFixed(0)}`;
    return `$${v.toFixed(4)}`;
  };

  return (
    <div className="mt-4" data-testid="fear-greed-chart">
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        {hasPrice && <div className="flex items-center gap-1"><div className="w-3 h-[2px] bg-white/80" /><span className="text-[12px] text-muted-foreground">{t("dashboard.priceLabel", { symbol: coinSymbol })}</span></div>}
        <div className="flex items-center gap-1"><div className="w-3 h-[2px] bg-amber-500" /><span className="text-[12px] text-muted-foreground">{t("dashboard.sentimentIndex")}</span></div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={sampled} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="date" tick={{ fontSize: 8, fill: "hsl(150,5%,45%)" }} tickFormatter={(d) => { const dt = new Date(d); return `${dt.getMonth()+1}/${dt.getDate()}`; }} interval={Math.floor(sampled.length / 6)} />
          {hasPrice && <YAxis yAxisId="price" orientation="right" tick={{ fontSize: 8, fill: "rgba(255,255,255,0.5)" }} tickFormatter={formatPrice} domain={["dataMin","dataMax"]} />}
          <YAxis yAxisId="fgi" orientation="left" tick={{ fontSize: 8, fill: "rgba(245,158,11,0.6)" }} domain={[0, 100]} />
          <Tooltip contentStyle={{ backgroundColor: "hsl(160,20%,8%)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", fontSize: "11px" }} formatter={(value: number, name: string) => name === "btcPrice" ? [formatPrice(value), t("dashboard.priceLabel", { symbol: coinSymbol })] : [value, t("dashboard.sentimentIndex")]} />
          {hasPrice && <Line yAxisId="price" type="monotone" dataKey="btcPrice" stroke="rgba(255,255,255,0.8)" strokeWidth={1.5} dot={false} />}
          <Area yAxisId="fgi" type="monotone" dataKey="fgi" stroke="#f59e0b" fill="rgba(245,158,11,0.15)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ───────── Price Calendar ───────── */
const WEEKDAYS_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function PriceCalendar({ data }: { data: CalendarData | undefined }) {
  const { t, i18n } = useTranslation();
  const [monthOffset, setMonthOffset] = useState(0);
  const isZh = i18n.language?.startsWith("zh");
  const weekdays = isZh ? WEEKDAYS_ZH : WEEKDAYS;

  const calendarData = useMemo(() => {
    if (!data?.dailyChanges?.length) return null;
    const now = new Date();
    const targetMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const year = targetMonth.getFullYear(); const month = targetMonth.getMonth();
    const firstDayOfWeek = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const changeMap = new Map<number, number>();
    for (const dc of data.dailyChanges) { const d = new Date(dc.date); if (d.getFullYear() === year && d.getMonth() === month) changeMap.set(dc.day, dc.change); }
    const monthLabel = isZh
      ? `${targetMonth.toLocaleDateString("zh-CN", { month: "long" })} ${year}`
      : targetMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const today = new Date();
    const todayDay = (today.getFullYear() === year && today.getMonth() === month) ? today.getDate() : (monthOffset < 0 ? daysInMonth + 1 : 0);
    return { firstDayOfWeek, daysInMonth, changeMap, monthName: monthLabel, todayDay, isCurrentMonth: monthOffset === 0 };
  }, [data, monthOffset, isZh]);

  if (!calendarData) return <Skeleton className="h-64 w-full rounded-md" />;
  const { firstDayOfWeek, daysInMonth, changeMap, monthName, todayDay } = calendarData;
  const cells: (null | { day: number; change: number | undefined })[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, change: changeMap.get(d) });
  while (cells.length % 7 !== 0) cells.push(null);

  const changes = Array.from(changeMap.values());
  const gainDays = changes.filter(c => c > 0).length;
  const lossDays = changes.filter(c => c < 0).length;
  const totalChange = changes.reduce((s, c) => s + c, 0);

  return (
    <div data-testid="price-calendar">
      <div className="flex items-center justify-end gap-3 mb-4">
        <button
          onClick={() => setMonthOffset(o => o - 1)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-prev-month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold tracking-wide" data-testid="text-calendar-month">{monthName}</span>
        <button
          onClick={() => setMonthOffset(o => Math.min(o + 1, 0))}
          className={`transition-colors ${monthOffset >= 0 ? "text-muted-foreground/30 cursor-not-allowed" : "text-muted-foreground hover:text-foreground"}`}
          disabled={monthOffset >= 0}
          data-testid="button-next-month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-2">
        {weekdays.map((wd) => (
          <div key={wd} className="text-center text-[11px] text-muted-foreground/60 font-medium py-1.5">{wd}</div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`empty-${i}`} className="aspect-square" />;
          const change = cell.change;
          const hasData = change !== undefined;
          const isFuture = cell.day > todayDay;
          const isToday = cell.day === todayDay;

          let cellBg = "rgba(255,255,255,0.02)";
          let changeColor = "rgba(180,195,190,0.4)";
          let cellShadow = "none";
          if (hasData) {
            if (change > 5)       { cellBg = "rgba(0,231,160,0.25)"; changeColor = "#00e7a0"; }
            else if (change > 2)  { cellBg = "rgba(0,231,160,0.15)"; changeColor = "#00e7a0"; }
            else if (change > 0)  { cellBg = "rgba(0,231,160,0.07)"; changeColor = "rgba(0,231,160,0.8)"; }
            else if (change > -2) { cellBg = "rgba(255,73,118,0.07)"; changeColor = "rgba(255,73,118,0.8)"; }
            else if (change > -5) { cellBg = "rgba(255,73,118,0.15)"; changeColor = "#ff4976"; }
            else                  { cellBg = "rgba(255,73,118,0.25)"; changeColor = "#ff4976"; }
          }

          if (isFuture) {
            cellBg = "linear-gradient(145deg, rgba(30,42,36,0.9) 0%, rgba(20,30,25,0.95) 100%)";
            changeColor = "rgba(180,195,190,0.2)";
            cellShadow = "0 2px 6px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.2)";
          }

          const row = Math.floor(i / 7);
          const col = i % 7;
          const borderRight = col < 6 ? "1px solid rgba(255,255,255,0.04)" : "none";
          const borderBottom = row < Math.ceil(cells.length / 7) - 1 ? "1px solid rgba(255,255,255,0.04)" : "none";

          return (
            <div
              key={`day-${cell.day}`}
              className={`aspect-square flex flex-col items-center justify-center gap-0.5 transition-all duration-200 ${isFuture ? "rounded-md m-[1px]" : ""} ${isToday ? "ring-1 ring-[#00e7a0]/40" : ""}`}
              style={{
                background: isFuture ? cellBg : undefined,
                backgroundColor: isFuture ? undefined : (hasData ? cellBg as string : cellBg as string),
                borderRight: isFuture ? "none" : borderRight,
                borderBottom: isFuture ? "none" : borderBottom,
                boxShadow: cellShadow,
                border: isFuture ? "1px solid rgba(255,255,255,0.05)" : undefined,
              }}
              data-testid={`calendar-day-${cell.day}`}
            >
              <span className={`text-[11px] leading-none ${isToday ? "text-[#00e7a0] font-bold" : "text-muted-foreground/50"}`}>{cell.day}</span>
              <span
                className="text-[10px] font-bold font-mono tabular-nums leading-none"
                style={{ color: isFuture ? changeColor : (hasData ? changeColor : "rgba(180,195,190,0.25)") }}
              >
                {hasData ? `${change > 0 ? "+" : ""}${change.toFixed(2)}%` : "0.00%"}
              </span>
            </div>
          );
        })}
      </div>

      {changes.length > 0 && (
        <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-muted-foreground/60">{changes.length} {isZh ? "天" : "days"}</span>
            <span className="text-[#00e7a0] font-medium">{gainDays} <TrendingUp className="inline h-3 w-3" /></span>
            <span className="text-[#ff4976] font-medium">{lossDays} <TrendingDown className="inline h-3 w-3" /></span>
          </div>
          <span className={`text-xs font-bold font-mono tabular-nums ${totalChange >= 0 ? "text-[#00e7a0]" : "text-[#ff4976]"}`}>
            {totalChange >= 0 ? "+" : ""}{totalChange.toFixed(2)}%
          </span>
        </div>
      )}
    </div>
  );
}

/* ───────── Main ───────── */
const COINS = ["BTC", "ETH", "SOL", "BNB", "DOGE"] as const;

export default function MarketPage() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const urlParams = new URLSearchParams(window.location.search);
  const initialCoin = urlParams.get("coin")?.toUpperCase() || "BTC";
  const [selectedCoinTab, setSelectedCoinTab] = useState(
    COINS.includes(initialCoin as any) ? initialCoin : "BTC"
  );
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(false); const t = setTimeout(() => setMounted(true), 100); return () => clearTimeout(t); }, [selectedCoinTab]);

  const { data: calendarData, isLoading: calLoading } = useQuery<CalendarData>({
    queryKey: ["market-calendar", selectedCoinTab],
    queryFn: () => fetchMarketCalendar(selectedCoinTab),
    staleTime: 5 * 60 * 1000,
  });
  const { data: fgHistory, isLoading: fgLoading } = useQuery<FearGreedHistory>({
    queryKey: ["market-fear-greed", selectedCoinTab],
    queryFn: () => fetchFearGreedHistory(selectedCoinTab),
    staleTime: 5 * 60 * 1000,
  });
  const { data: sentimentData, isLoading: sentLoading } = useQuery<SentimentData>({ queryKey: ["market-sentiment"], queryFn: fetchSentiment, staleTime: 60 * 1000 });
  const { data: futuresData, isLoading: oiLoading } = useQuery<FuturesOIData>({ queryKey: ["market-futures-oi"], queryFn: fetchFuturesOI, staleTime: 60 * 1000 });
  const { data: exchangePrices, isLoading: epLoading } = useQuery<CoinExchangeData[]>({ queryKey: ["market-exchange-prices"], queryFn: fetchExchangePrices, staleTime: 60 * 1000 });

  const selectedCoinExchanges = exchangePrices?.find(c => c.symbol === selectedCoinTab);

  return (
    <div className="space-y-4 pb-24" data-testid="page-market">
      {/* ═══ Section 1: Header + Coin Tabs + Calendar ═══ */}
      <div className="gradient-green-dark rounded-b-2xl p-4 pt-2" style={{ animation: "fadeSlideIn 0.5s ease-out" }}>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Button size="icon" variant="ghost" onClick={() => navigate("/")} data-testid="button-back-home"><ArrowLeft className="h-4 w-4" /></Button>
          <h1 className="text-lg font-bold">{t("market.marketAnalysis")}</h1>
        </div>

        <div className="flex items-center gap-1.5 mb-3 overflow-x-auto flex-nowrap pb-1" data-testid="coin-selector-tabs">
          {COINS.map(sym => (
            <Button
              key={sym}
              variant={selectedCoinTab === sym ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCoinTab(sym)}
              data-testid={`button-market-coin-${sym}`}
            >
              {sym}
            </Button>
          ))}
        </div>

        {calLoading ? <Skeleton className="h-8 w-48 mb-2" /> : (
          <div className="mb-3">
            <span className="text-xs text-muted-foreground">{t("dashboard.priceLabel", { symbol: selectedCoinTab })}</span>
            <div className="text-2xl font-bold font-mono tabular-nums" data-testid="text-coin-price">
              {selectedCoinTab === "DOGE" ? `$${(calendarData?.currentPrice || 0).toFixed(5)}` : formatUSD(calendarData?.currentPrice || 0)}
            </div>
          </div>
        )}
        <div
          className="rounded-xl overflow-hidden backdrop-blur-sm"
          style={{
            background: "linear-gradient(180deg, rgba(15,25,20,0.6) 0%, rgba(10,18,14,0.8) 100%)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div className="p-3">
            {calLoading ? <Skeleton className="h-64 w-full" /> : <PriceCalendar data={calendarData} />}
          </div>
        </div>
      </div>

      {/* ═══ Section 2: Fear & Greed Index ═══ */}
      <div className="px-4" style={{ animation: "fadeSlideIn 0.6s ease-out" }}>
        <SectionHeader
          icon={Eye}
          title={t("market.fearGreedIndex", { coin: selectedCoinTab })}
          badge={selectedCoinTab === "BTC" ? t("market.marketIndex") : t("market.priceBased")}
        />
        {fgLoading ? <Skeleton className="h-48 w-full rounded-md" /> : fgHistory ? (
          <Card className="border-border bg-gradient-to-b from-card to-background/80"><CardContent className="p-4">
            {/* Section 3: Distribution Bars with staggered animation + shimmer */}
            <div className="space-y-2.5 mb-2">
              {[
                { label: t("market.extremeFear"), value: fgHistory.buckets.extremeFear, color: "text-red-400", barColor: "bg-red-500", glow: "rgba(239,68,68,0.4)" },
                { label: t("market.fear"), value: fgHistory.buckets.fear, color: "text-orange-400", barColor: "bg-orange-500", glow: "rgba(249,115,22,0.4)" },
                { label: t("market.neutral"), value: fgHistory.buckets.neutral, color: "text-yellow-400", barColor: "bg-yellow-500", glow: "rgba(234,179,8,0.3)" },
                { label: t("market.greed"), value: fgHistory.buckets.greed, color: "text-lime-400", barColor: "bg-lime-500", glow: "rgba(132,204,22,0.4)" },
                { label: t("market.extremeGreed"), value: fgHistory.buckets.extremeGreed, color: "text-emerald-400", barColor: "bg-emerald-500", glow: "rgba(16,185,129,0.4)" },
              ].map((item, idx) => {
                const pct = fgHistory.totalDays > 0 ? (item.value / fgHistory.totalDays) * 100 : 0;
                return (
                  <div
                    key={item.label}
                    className="space-y-0.5"
                    style={{
                      opacity: mounted ? 1 : 0,
                      transform: mounted ? "translateX(0)" : "translateX(-12px)",
                      transition: `opacity 0.5s ease ${idx * 80}ms, transform 0.5s ease ${idx * 80}ms`,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className={`font-medium ${item.color}`}>{item.label}</span>
                      <span className="text-muted-foreground tabular-nums font-mono">
                        {item.value} days (<AnimatedValue value={pct} decimals={2} suffix="%" className="font-medium" />)
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden relative">
                      <div
                        className={`h-full rounded-full ${item.barColor} relative overflow-hidden`}
                        style={{
                          width: mounted ? `${pct}%` : "0%",
                          transition: `width 0.7s ease ${idx * 80}ms`,
                          boxShadow: `0 0 6px ${item.glow}`,
                        }}
                      >
                        {/* Shimmer overlay */}
                        <div
                          className="absolute inset-0 opacity-40"
                          style={{
                            background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)",
                            animation: `shimmer 2s ease-in-out infinite ${idx * 0.2}s`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <FearGreedGauge value={fgHistory.current.value} label={fgHistory.current.label} />
            <FearGreedChart data={fgHistory.chartData} coinSymbol={selectedCoinTab} />
          </CardContent></Card>
        ) : null}
      </div>

      {/* ═══ Section 4: Market Sentiment ═══ */}
      <div className="px-4" style={{ animation: "fadeSlideIn 0.7s ease-out" }}>
        <SectionHeader
          icon={Flame}
          title={t("market.sentiment", { coin: selectedCoinTab })}
        />
        <div className="flex items-center gap-1 mb-3 -mt-1">
          <span className="text-[12px] text-muted-foreground">{t("market.netInflow")}</span>
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[12px] text-emerald-400">{t("market.realTime")}</span>
        </div>
        {sentLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full rounded-md" />)}</div>
        ) : sentimentData?.coins ? (() => {
          const selectedCoin = sentimentData.coins.find(c => c.symbol === selectedCoinTab);
          const otherCoins = sentimentData.coins.filter(c => c.symbol !== selectedCoinTab);
          return (
            <>
              {selectedCoin && (() => {
                const isInflow = selectedCoin.netFlow >= 0;
                const gradBg = isInflow
                  ? "linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(8,12,10,0.95) 70%)"
                  : "linear-gradient(135deg, rgba(239,68,68,0.08) 0%, rgba(8,12,10,0.95) 70%)";
                return (
                  <Card
                    className="border-primary/30"
                    style={{ background: gradBg }}
                    data-testid={`sentiment-card-${selectedCoin.symbol}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-3 min-w-0 flex-wrap">
                          <div className="relative h-10 w-10 rounded-full shrink-0 flex items-center justify-center" style={{ boxShadow: isInflow ? "0 0 12px rgba(16,185,129,0.4)" : "0 0 12px rgba(239,68,68,0.4)" }}>
                            {selectedCoin.image ? <img src={selectedCoin.image} alt={selectedCoin.name} className="h-10 w-10 rounded-full" /> : <div className="h-10 w-10 rounded-full bg-card flex items-center justify-center text-sm font-bold">{selectedCoin.symbol}</div>}
                            {/* Live pulsing dot */}
                            <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                            </span>
                          </div>
                          <div>
                            <div className="text-sm font-bold">{selectedCoin.name}</div>
                            <div className="text-xs text-muted-foreground">{selectedCoin.symbol} · {t("market.inflow24h")}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg" data-testid={`text-netflow-${selectedCoin.symbol}`}>
                            <AnimatedCompactFlow value={selectedCoin.netFlow} isPositive={isInflow} />
                          </div>
                          <div className={`text-xs font-medium font-mono tabular-nums ${selectedCoin.change24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            <AnimatedValue value={selectedCoin.change24h} decimals={2} prefix={selectedCoin.change24h >= 0 ? "+" : ""} suffix="%" />
                          </div>
                          <div className="text-[12px] text-muted-foreground mt-0.5 font-mono tabular-nums">
                            {t("common.price")}: {selectedCoinTab === "DOGE" ? `$${selectedCoin.price.toFixed(5)}` : formatUSD(selectedCoin.price)}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}
              {otherCoins.length > 0 && (
                <div className="space-y-1.5 mt-3">
                  <div className="text-[12px] text-muted-foreground uppercase font-medium">{t("market.otherCoins")}</div>
                  {otherCoins.map((coin, idx) => {
                    const isInflow = coin.netFlow >= 0;
                    return (
                      <Card
                        key={coin.id}
                        className="border-border bg-card cursor-pointer hover-elevate"
                        onClick={() => setSelectedCoinTab(coin.symbol)}
                        data-testid={`sentiment-card-${coin.symbol}`}
                        style={{
                          opacity: mounted ? 1 : 0,
                          transform: mounted ? "translateY(0)" : "translateY(8px)",
                          transition: `opacity 0.4s ease ${idx * 60}ms, transform 0.4s ease ${idx * 60}ms`,
                        }}
                      >
                        <CardContent className="p-2.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                              <div className="relative h-6 w-6 rounded-full shrink-0 flex items-center justify-center">
                                {coin.image ? <img src={coin.image} alt={coin.name} className="h-6 w-6 rounded-full" /> : <div className="h-6 w-6 rounded-full bg-card flex items-center justify-center text-[11px] font-bold">{coin.symbol}</div>}
                              </div>
                              <span className="text-xs font-medium">{coin.symbol}</span>
                            </div>
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className={`text-xs font-bold font-mono tabular-nums ${isInflow ? "text-emerald-400" : "text-red-400"}`} data-testid={`text-netflow-${coin.symbol}`}>
                                {isInflow ? "" : "-"}{formatCompact(Math.abs(coin.netFlow))}
                              </span>
                              <span className={`text-[12px] font-medium font-mono tabular-nums ${coin.change24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {coin.change24h >= 0 ? "+" : ""}{coin.change24h.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
              <Card className="border-border bg-card mt-3">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">{t("market.totalNetInflow")}</span>
                    <span className="text-lg" data-testid="text-total-net-inflow">
                      <AnimatedCompactFlow value={sentimentData.totalNetInflow} isPositive={sentimentData.totalNetInflow >= 0} />
                    </span>
                  </div>
                </CardContent>
              </Card>
            </>
          );
        })() : null}
      </div>

      {/* ═══ Section 5: Futures Open Interest ═══ */}
      <div className="px-4" style={{ animation: "fadeSlideIn 0.8s ease-out" }}>
        <SectionHeader
          icon={Activity}
          title={t("market.futuresOI", { coin: selectedCoinTab })}
        />
        {oiLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full rounded-md" />)}</div>
        ) : futuresData?.positions ? (() => {
          const filteredPositions = futuresData.positions.filter(p => p.symbol === selectedCoinTab);
          const filteredOI = filteredPositions.reduce((sum, p) => sum + p.openInterestValue, 0);
          const maxOI = Math.max(...filteredPositions.map(p => p.openInterestValue), 1);
          return filteredPositions.length > 0 ? (
            <>
              <Card className="border-border bg-card">
                <CardContent className="p-0">
                  {filteredPositions.map((item, idx) => {
                    const isPositive = item.priceChange24h >= 0;
                    const oiPct = (item.openInterestValue / maxOI) * 100;
                    const exColor = getExchangeColor(item.exchange);
                    return (
                      <div
                        key={`${item.pair}-${item.exchange}`}
                        className={`p-3 ${idx < filteredPositions.length - 1 ? "border-b border-border" : ""}`}
                        data-testid={`futures-oi-${item.symbol}-${item.exchange}`}
                        style={{
                          opacity: mounted ? 1 : 0,
                          transform: mounted ? "translateX(0)" : "translateX(-12px)",
                          transition: `opacity 0.4s ease ${idx * 60}ms, transform 0.4s ease ${idx * 60}ms`,
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: exColor }} />
                            <div className="min-w-0">
                              <div className="text-xs font-bold">{item.pair}</div>
                              <div className="text-[11px] text-muted-foreground">{item.exchange}</div>
                            </div>
                            <Badge className={`text-[10px] shrink-0 no-default-hover-elevate no-default-active-elevate ${isPositive ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}`}>
                              <AnimatedValue value={item.priceChange24h} decimals={2} prefix={isPositive ? "+" : ""} suffix="%" />
                            </Badge>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold font-mono tabular-nums" data-testid={`text-oi-value-${item.symbol}-${item.exchange}`}>
                              <AnimatedCompactFlow value={item.openInterestValue} isPositive={true} />
                            </div>
                            <div className="text-[11px] text-muted-foreground font-mono tabular-nums">{item.openInterest.toLocaleString()} {t("market.contracts")}</div>
                          </div>
                        </div>
                        <div className="h-1 rounded-full bg-muted/20 overflow-hidden mt-2 relative">
                          <div
                            className="h-full rounded-full bg-emerald-500/60 relative overflow-hidden"
                            style={{
                              width: mounted ? `${oiPct}%` : "0%",
                              transition: `width 0.7s ease ${idx * 80}ms`,
                            }}
                          >
                            <div
                              className="absolute inset-0 opacity-40"
                              style={{
                                background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)",
                                animation: `shimmer 2s ease-in-out infinite ${idx * 0.15}s`,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
              <Card className="border-border bg-card mt-3">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">{t("market.totalOI", { coin: selectedCoinTab })}</span>
                    <span className="text-lg" data-testid="text-total-oi">
                      <AnimatedCompactFlow value={filteredOI} isPositive={true} />
                    </span>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="border-border bg-card"><CardContent className="p-4 text-center text-xs text-muted-foreground">{t("market.noFuturesData", { coin: selectedCoinTab })}</CardContent></Card>
          );
        })() : (
          <Card className="border-border bg-card"><CardContent className="p-4 text-center text-xs text-muted-foreground">{t("market.futuresUnavailable")}</CardContent></Card>
        )}
      </div>

      {/* ═══ Section 6: Cross-Exchange Price Table ═══ */}
      <div className="px-4" style={{ animation: "fadeSlideIn 0.9s ease-out" }}>
        <SectionHeader
          icon={Globe}
          title={t("market.crossExchangePrices", { coin: selectedCoinTab })}
        />

        {epLoading ? (
          <div className="space-y-1">{Array.from({length: 8}, (_, i) => <Skeleton key={i} className="h-10 w-full rounded-sm" />)}</div>
        ) : selectedCoinExchanges ? (() => {
          const rows = selectedCoinExchanges.exchanges;
          const prices = rows.map(r => r.price);
          const minPrice = Math.min(...prices);
          const maxPrice = Math.max(...prices);
          return (
            <Card className="border-border bg-card">
              <CardContent className="p-0">
                <div className="flex items-center justify-between gap-1 p-3 border-b border-border text-[12px] text-muted-foreground uppercase font-medium">
                  <span className="w-24 shrink-0">{t("market.exchange")}</span>
                  <span className="flex-1 text-center">{t("market.spotPrice")}</span>
                  <span className="w-14 text-right shrink-0">{t("market.change24h")}</span>
                </div>
                {rows.map((row, idx) => {
                  const isPos = row.change24h >= 0;
                  const exColor = getExchangeColor(row.exchange);
                  const isLowest = row.price === minPrice && rows.length > 1;
                  const isHighest = row.price === maxPrice && rows.length > 1;
                  return (
                    <div
                      key={row.exchange}
                      className={`flex items-center justify-between gap-1 px-3 py-2 ${idx < rows.length - 1 ? "border-b border-border/50" : ""}`}
                      data-testid={`exchange-price-${row.exchange}-${row.symbol}`}
                      style={{
                        opacity: mounted ? 1 : 0,
                        transform: mounted ? "translateY(0)" : "translateY(6px)",
                        transition: `opacity 0.4s ease ${idx * 50}ms, transform 0.4s ease ${idx * 50}ms`,
                      }}
                    >
                      <div className="w-24 shrink-0 flex items-center gap-1.5">
                        <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: exColor }} />
                        <span className="text-[13px] font-medium truncate">{row.exchange}</span>
                      </div>
                      <div className="flex-1 text-center flex items-center justify-center gap-1.5">
                        <span className="text-xs font-bold font-mono tabular-nums">
                          <AnimatedValue
                            value={row.price}
                            decimals={selectedCoinTab === "DOGE" ? 5 : 2}
                            prefix="$"
                          />
                        </span>
                        {isLowest && (
                          <Badge className="text-[8px] px-1 py-0 h-3.5 bg-emerald-500/20 text-emerald-400 border-emerald-500/30 no-default-hover-elevate no-default-active-elevate">
                            LOW
                          </Badge>
                        )}
                        {isHighest && (
                          <Badge className="text-[8px] px-1 py-0 h-3.5 bg-amber-500/20 text-amber-400 border-amber-500/30 no-default-hover-elevate no-default-active-elevate">
                            HIGH
                          </Badge>
                        )}
                      </div>
                      <span className={`w-14 text-right text-[13px] font-medium font-mono tabular-nums shrink-0 ${isPos ? "text-emerald-400" : "text-red-400"}`}>
                        <AnimatedValue value={row.change24h} decimals={2} prefix={isPos ? "+" : ""} suffix="%" />
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })() : (
          <Card className="border-border bg-card"><CardContent className="p-4 text-center text-xs text-muted-foreground">{t("common.noData")}</CardContent></Card>
        )}
      </div>
    </div>
  );
}
