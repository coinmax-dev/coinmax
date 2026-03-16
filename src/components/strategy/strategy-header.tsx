import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, BarChart3, Target, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useHLVault } from "@/hooks/use-hl-vault";

function seededRandom(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

function getHourlyValue(min: number, max: number, salt: number) {
  const hourSeed = Math.floor(Date.now() / (1000 * 60 * 60));
  return min + seededRandom(hourSeed + salt) * (max - min);
}

function useHourlyValue(min: number, max: number, salt: number) {
  const [value, setValue] = useState(() => getHourlyValue(min, max, salt));
  useEffect(() => {
    const interval = setInterval(() => {
      setValue(getHourlyValue(min, max, salt));
    }, 60_000);
    return () => clearInterval(interval);
  }, [min, max, salt]);
  return value;
}

export function getCalendarDays(calendarMonth: Date, timeSeed = 0) {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days: { day: number; pnl: number }[] = [];
  for (let i = 0; i < firstDay; i++) days.push({ day: 0, pnl: 0 });

  const now = new Date();
  const dataStartDate = new Date(now.getFullYear(), now.getMonth() - 9, 1);
  const isHistorical = new Date(year, month, 1) >= dataStartDate && new Date(year, month, 1) <= now;

  if (!isHistorical) {
    for (let d = 1; d <= daysInMonth; d++) days.push({ day: d, pnl: 0 });
    return days;
  }

  const monthSeed = year * 100 + (month + 1);
  const monthRng = ((Math.sin(monthSeed * 4729 + 17389) % 1) + 1) % 1;
  const targetMonthly = 28 + monthRng * 17;

  const rawPnls: number[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    if (date > now) { rawPnls.push(0); continue; }

    const daysAgo = Math.floor((now.getTime() - date.getTime()) / 86400000);
    // Recent 5 days fluctuate with timeSeed; older days are stable
    const tf = daysAgo <= 5 ? timeSeed * (d + 3) : 0;
    const seed = year * 10000 + (month + 1) * 100 + d + tf;
    const rng = ((Math.sin(seed * 9301 + 49297) % 1) + 1) % 1;
    const rng2 = ((Math.sin(seed * 7919 + 31337) % 1) + 1) % 1;
    const rng3 = ((Math.sin(seed * 6271 + 15731) % 1) + 1) % 1;
    const winThreshold = daysAgo > 7 ? 0.30 : 0.25 + (rng3 * 0.1);
    const isWin = rng > winThreshold;
    let pnl: number;
    if (isWin) {
      pnl = 0.8 + rng2 * 2.4;
      if (daysAgo <= 3) pnl *= (0.9 + rng3 * 0.4);
    } else {
      pnl = -(0.3 + rng3 * 1.7);
      if (daysAgo <= 3) pnl *= (0.8 + rng2 * 0.3);
    }
    const dow = date.getDay();
    if (dow === 0 || dow === 6) pnl *= 0.4;

    // Today fluctuates with hour progress
    if (date.toDateString() === now.toDateString()) {
      const hourProgress = (now.getHours() * 60 + now.getMinutes()) / 1440;
      const jitter = ((Math.sin(timeSeed * 1337) % 1) + 1) % 1;
      pnl *= (0.3 + hourProgress * 0.7) * (0.85 + jitter * 0.3);
    }

    rawPnls.push(pnl);
  }

  const rawTotal = rawPnls.reduce((s, v) => s + v, 0);
  const scale = rawTotal > 0 ? targetMonthly / rawTotal : 1;

  for (let d = 1; d <= daysInMonth; d++) {
    const scaled = rawPnls[d - 1] * scale;
    days.push({ day: d, pnl: Math.round(scaled * 100) / 100 });
  }
  return days;
}

function getCumulativeStats(timeSeed = 0) {
  const now = new Date();
  const dataStart = new Date(now.getFullYear(), now.getMonth() - 9, 1);
  let totalPnl = 0;
  let wins = 0;
  let losses = 0;
  for (let m = 0; m < 9; m++) {
    const mDate = new Date(dataStart.getFullYear(), dataStart.getMonth() + m, 1);
    const days = getCalendarDays(mDate, timeSeed);
    for (const cell of days) {
      if (cell.day === 0 || cell.pnl === 0) continue;
      totalPnl += cell.pnl;
      if (cell.pnl > 0) wins++; else losses++;
    }
  }
  return { totalPnl, wins, losses };
}

export function StrategyHeader() {
  const { t } = useTranslation();
  const { tvlFormatted } = useHLVault();
  const floatingWinRate = useHourlyValue(80, 85, 100);
  const floatingMonthlyReturn = useHourlyValue(25, 35, 200);
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [timeSeed, setTimeSeed] = useState(() => Math.floor(Date.now() / 30000));
  useEffect(() => {
    const timer = setInterval(() => setTimeSeed(Math.floor(Date.now() / 30000)), 30000);
    return () => clearInterval(timer);
  }, []);

  const calendarDays = getCalendarDays(calendarMonth, timeSeed);
  const stats = getCumulativeStats(timeSeed);

  const weekDays = [
    t("calendar.sun"), t("calendar.mon"), t("calendar.tue"),
    t("calendar.wed"), t("calendar.thu"), t("calendar.fri"), t("calendar.sat"),
  ];
  const calendarLabel = `${t(`calendar.month${calendarMonth.getMonth()}`)} ${calendarMonth.getFullYear()}`;

  return (
    <div className="gradient-green-dark p-4 pt-2 rounded-b-2xl" style={{ animation: "fadeSlideIn 0.4s ease-out" }}>
      <h2 className="text-lg font-bold mb-3" data-testid="text-strategy-title">{t("strategy.aiStrategies")}</h2>
      <Card className="border-border bg-card/50 glow-green-sm">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[12px] text-muted-foreground mb-1">{t("strategy.totalAum")}</div>
              <div className="text-2xl font-bold" data-testid="text-total-aum">{tvlFormatted}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowCalendar(!showCalendar)}
                className={`h-10 w-10 rounded-full flex items-center justify-center transition-all active:scale-95 ${showCalendar ? "bg-primary/30 ring-1 ring-primary/50" : "bg-primary/20 hover:bg-primary/30"}`}
                data-testid="button-pnl-calendar"
              >
                <CalendarDays className="h-5 w-5 text-primary" />
              </button>
              <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Card className="border-border bg-card/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-1 text-[12px] text-muted-foreground mb-1">
              <Target className="h-3 w-3" /> {t("strategy.avgWinRate")}
            </div>
            <div className="text-xl font-bold text-neon-value" data-testid="text-win-rate">{floatingWinRate.toFixed(1)}%</div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-1 text-[12px] text-muted-foreground mb-1">
              <BarChart3 className="h-3 w-3" /> {t("strategy.avgMonthlyReturn")}
            </div>
            <div className="text-xl font-bold text-neon-value" data-testid="text-avg-return">{floatingMonthlyReturn.toFixed(1)}%</div>
          </CardContent>
        </Card>
      </div>

      {/* Inline Calendar Panel */}
      {showCalendar && (
        <div className="mt-3 space-y-3" style={{ animation: "fadeSlideIn 0.3s ease-out" }}>
          {/* Monthly Stats — based on selected calendar month */}
          {(() => {
            const activeDays = calendarDays.filter(c => c.day > 0 && c.pnl !== 0);
            const mWins = activeDays.filter(c => c.pnl > 0).length;
            const mLosses = activeDays.filter(c => c.pnl < 0).length;
            const mPnl = activeDays.reduce((s, c) => s + c.pnl, 0);
            const mWinRate = activeDays.length > 0 ? (mWins / activeDays.length * 100) : 0;
            return (
              <Card className="border-border bg-card/50">
                <CardContent className="p-3">
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div>
                      <div className={`text-base font-bold tabular-nums ${mPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>{mPnl >= 0 ? "+" : ""}{mPnl.toFixed(1)}%</div>
                      <div className="text-[11px] text-muted-foreground">{t("strategy.cumulativeReturn")}</div>
                    </div>
                    <div>
                      <div className="text-base font-bold tabular-nums">{mWinRate.toFixed(0)}%</div>
                      <div className="text-[11px] text-muted-foreground">{t("strategy.avgWinRate", "胜率")}</div>
                    </div>
                    <div>
                      <div className="text-base font-bold text-emerald-400 tabular-nums">{mWins}</div>
                      <div className="text-[11px] text-muted-foreground">{t("strategy.winCount")}</div>
                    </div>
                    <div>
                      <div className="text-base font-bold text-red-400 tabular-nums">{mLosses}</div>
                      <div className="text-[11px] text-muted-foreground">{t("strategy.lossCount")}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* Calendar */}
          <Card className="border-border bg-card/50">
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-3">
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-bold">{calendarLabel}</span>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center">
                {weekDays.map((d) => (
                  <div key={d} className="text-[11px] text-muted-foreground font-semibold py-1">{d}</div>
                ))}
                {calendarDays.map((cell, idx) => (
                  <div
                    key={idx}
                    className={`rounded-md py-1 text-center ${cell.day === 0 ? "" : "bg-muted/30 border border-border/30"}`}
                  >
                    {cell.day > 0 && (
                      <>
                        <div className="text-[12px] font-semibold leading-tight">{cell.day}</div>
                        <div className={`text-[10px] font-medium leading-tight ${cell.pnl > 0 ? "text-emerald-400" : cell.pnl < 0 ? "text-red-400" : "text-muted-foreground/50"}`}>
                          {cell.pnl !== 0 ? `${cell.pnl > 0 ? "+" : ""}${cell.pnl.toFixed(1)}%` : "--"}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
              {/* Monthly summary */}
              {(() => {
                const monthPnl = calendarDays.reduce((sum, c) => sum + c.pnl, 0);
                const monthWins = calendarDays.filter((c) => c.day > 0 && c.pnl > 0).length;
                const monthLosses = calendarDays.filter((c) => c.day > 0 && c.pnl < 0).length;
                const hasData = monthWins + monthLosses > 0;
                return hasData ? (
                  <div className="flex items-center justify-between mt-3 px-2 py-2 rounded-lg bg-muted/20 border border-border/20">
                    <div className="text-[11px] text-muted-foreground font-medium">{t("strategy.monthly")}</div>
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-bold tabular-nums ${monthPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {monthPnl >= 0 ? "+" : ""}{monthPnl.toFixed(1)}%
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        <span className="text-emerald-400 font-medium">{monthWins}W</span> / <span className="text-red-400 font-medium">{monthLosses}L</span>
                      </span>
                    </div>
                  </div>
                ) : null;
              })()}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
