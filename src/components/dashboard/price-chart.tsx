import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type HistogramData,
  type UTCTimestamp,
} from "lightweight-charts";
import { formatUSD } from "@/lib/constants";
import type { ChartDataPoint, ChartTimeframe, OhlcDataPoint } from "@/hooks/use-crypto-price";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Sparkles, CandlestickChart, LineChart, AreaChart, BarChart3 } from "lucide-react";
import { useTranslation } from "react-i18next";

type ChartType = "candle" | "line" | "area" | "bar";

interface ForecastData {
  direction: string;
  confidence: number;
  currentPrice: number;
  targetPrice: number;
  reasoning: string;
  forecastPoints: { timestamp: number; time: string; price: number; predicted: boolean }[];
}

interface PriceChartProps {
  data?: ChartDataPoint[] | undefined;
  ohlcData?: OhlcDataPoint[] | undefined;
  isLoading: boolean;
  color?: string;
  forecast?: ForecastData | null;
  forecastLoading?: boolean;
  selectedTimeframe?: ChartTimeframe;
  onTimeframeChange?: (tf: ChartTimeframe) => void;
  activeModel?: string;
}

const TIMEFRAMES: { key: ChartTimeframe; label: string }[] = [
  { key: "1m", label: "1m" },
  { key: "5m", label: "5m" },
  { key: "15m", label: "15m" },
  { key: "30m", label: "30m" },
  { key: "1H", label: "1H" },
  { key: "4H", label: "4H" },
  { key: "1D", label: "1D" },
  { key: "1W", label: "1W" },
];

const CHART_TYPES: { key: ChartType; icon: any; label: string }[] = [
  { key: "candle", icon: CandlestickChart, label: "Candlestick" },
  { key: "line", icon: LineChart, label: "Line" },
  { key: "area", icon: AreaChart, label: "Area" },
  { key: "bar", icon: BarChart3, label: "Bar" },
];

function getVisibleBars(tf?: ChartTimeframe): number {
  if (!tf) return 30;
  switch (tf) {
    case "1m": return 25;
    case "5m": return 28;
    case "15m": return 30;
    case "30m": return 32;
    case "1H": return 35;
    case "4H": return 35;
    case "1D": return 40;
    case "1W": return 30;
    default: return 30;
  }
}

const BG_COLOR = "transparent";
const TEXT_COLOR = "rgba(180, 195, 190, 0.6)";
const GRID_COLOR = "rgba(255, 255, 255, 0.025)";
const CROSSHAIR_COLOR = "rgba(0, 231, 160, 0.3)";
const UP_COLOR = "#00e7a0";
const DOWN_COLOR = "#ff4976";

function toUTC(ts: number): UTCTimestamp {
  return (Math.floor(ts / 1000)) as UTCTimestamp;
}

export function PriceChart({
  data,
  ohlcData,
  isLoading,
  color = "hsl(174, 72%, 46%)",
  forecast,
  forecastLoading,
  selectedTimeframe,
  onTimeframeChange,
  activeModel,
}: PriceChartProps) {
  const { t } = useTranslation();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<any> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const forecastSeriesRef = useRef<ISeriesApi<any> | null>(null);
  const forecastPriceLineRef = useRef<any>(null);
  const [chartType, setChartType] = useState<ChartType>("candle");
  const [visible, setVisible] = useState(false);
  const prevChartTypeRef = useRef<ChartType>(chartType);
  const dataVersionRef = useRef(0);
  const userScrolledRef = useRef(false);

  const hasOhlc = !!(ohlcData && ohlcData.length > 0);
  const hasDataNow = hasOhlc || !!(data && data.length > 0);
  const hadDataRef = useRef(false);
  if (hasDataNow) hadDataRef.current = true;
  const hasData = hasDataNow || hadDataRef.current;

  const direction = forecast?.direction || "NEUTRAL";
  const confidence = forecast?.confidence || 0;
  const targetPrice = forecast?.targetPrice || null;

  const directionColor =
    direction === "BULLISH" ? "bg-primary/15 text-neon-value" :
    direction === "BEARISH" ? "bg-red-500/15 text-red-400" :
    "bg-yellow-500/15 text-yellow-400";

  const forecastLineColor = "#38bdf8";

  useEffect(() => {
    if (hasData) {
      const timer = setTimeout(() => setVisible(true), 80);
      return () => clearTimeout(timer);
    }
    setVisible(false);
  }, [hasData]);

  const destroyChart = useCallback(() => {
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;
      forecastSeriesRef.current = null;
      forecastPriceLineRef.current = null;
    }
  }, []);

  const createChartInstance = useCallback(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    destroyChart();

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 280,
      layout: {
        background: { type: ColorType.Solid, color: BG_COLOR },
        textColor: TEXT_COLOR,
        fontSize: 12,
        fontFamily: "'Space Grotesk', 'Inter', system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: GRID_COLOR },
        horzLines: { color: GRID_COLOR },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: CROSSHAIR_COLOR,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "rgba(0, 231, 160, 0.85)",
        },
        horzLine: {
          color: CROSSHAIR_COLOR,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "rgba(0, 231, 160, 0.85)",
        },
      },
      rightPriceScale: {
        borderColor: "rgba(255, 255, 255, 0.06)",
        scaleMargins: { top: 0.08, bottom: 0.22 },
      },
      timeScale: {
        borderColor: "rgba(255, 255, 255, 0.06)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 14,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      handleScroll: { vertTouchDrag: false },
    });

    chartRef.current = chart;

    let mainSeries: ISeriesApi<any>;

    if (chartType === "candle") {
      mainSeries = chart.addCandlestickSeries({
        upColor: UP_COLOR,
        downColor: DOWN_COLOR,
        borderUpColor: UP_COLOR,
        borderDownColor: DOWN_COLOR,
        wickUpColor: UP_COLOR,
        wickDownColor: DOWN_COLOR,
      });
    } else if (chartType === "bar") {
      mainSeries = chart.addBarSeries({
        upColor: UP_COLOR,
        downColor: DOWN_COLOR,
        thinBars: false,
      });
    } else if (chartType === "area") {
      mainSeries = chart.addAreaSeries({
        topColor: "rgba(0, 231, 160, 0.25)",
        bottomColor: "rgba(0, 231, 160, 0.01)",
        lineColor: UP_COLOR,
        lineWidth: 2,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: UP_COLOR,
        crosshairMarkerBackgroundColor: "#0a0f0d",
      });
    } else {
      mainSeries = chart.addLineSeries({
        color: UP_COLOR,
        lineWidth: 2,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: UP_COLOR,
        crosshairMarkerBackgroundColor: "#0a0f0d",
      });
    }

    mainSeriesRef.current = mainSeries;

    if (hasOhlc) {
      const volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      });
      volumeSeriesRef.current = volumeSeries;
    }

    userScrolledRef.current = false;
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      if (dataVersionRef.current > 1) {
        userScrolledRef.current = true;
      }
    });

    const handleResize = () => {
      if (chartRef.current && container) {
        chartRef.current.applyOptions({ width: container.clientWidth });
      }
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [chartType, destroyChart, hasOhlc]);

  useEffect(() => {
    userScrolledRef.current = false;
    dataVersionRef.current = 0;
  }, [selectedTimeframe]);

  useEffect(() => {
    const cleanup = createChartInstance();
    dataVersionRef.current++;
    return () => {
      cleanup?.();
      destroyChart();
    };
  }, [createChartInstance, destroyChart]);

  useEffect(() => {
    const chart = chartRef.current;
    const mainSeries = mainSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !mainSeries) return;

    if (forecastSeriesRef.current) {
      try { chart.removeSeries(forecastSeriesRef.current); } catch {}
      forecastSeriesRef.current = null;
    }
    if (forecastPriceLineRef.current) {
      try { mainSeries.removePriceLine(forecastPriceLineRef.current); } catch {}
      forecastPriceLineRef.current = null;
    }

    if (hasOhlc && ohlcData) {
      if (chartType === "candle" || chartType === "bar") {
        const candleData: CandlestickData[] = ohlcData.map(d => ({
          time: toUTC(d.timestamp),
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
        }));
        mainSeries.setData(candleData);
      } else {
        const lineData: LineData[] = ohlcData.map(d => ({
          time: toUTC(d.timestamp),
          value: d.close,
        }));
        mainSeries.setData(lineData);
      }

      if (volumeSeries) {
        const volData: HistogramData[] = ohlcData.map(d => ({
          time: toUTC(d.timestamp),
          value: d.volume,
          color: d.close >= d.open ? "rgba(0, 231, 160, 0.18)" : "rgba(255, 73, 118, 0.18)",
        }));
        volumeSeries.setData(volData);
      }
    } else if (data && data.length > 0) {
      const lineData: LineData[] = data.map(d => ({
        time: toUTC(d.timestamp),
        value: d.price,
      }));
      mainSeries.setData(lineData);
    }

    const currentPrice = hasOhlc && ohlcData ? ohlcData[ohlcData.length - 1].close : (data && data.length > 0 ? data[data.length - 1].price : 0);
    const maxDeviationPct = (() => {
      switch (selectedTimeframe) {
        case "1m": return 0.005;
        case "5m": return 0.01;
        case "15m": return 0.02;
        case "30m": return 0.03;
        case "1H": return 0.05;
        case "4H": return 0.10;
        case "1D": return 0.15;
        case "1W": return 0.30;
        default: return 0.10;
      }
    })();
    const maxDeviation = currentPrice * maxDeviationPct;
    const saneForecast = forecast?.forecastPoints?.length && currentPrice > 0
      ? (() => {
          const sanePoints = forecast.forecastPoints.filter(fp =>
            Math.abs(fp.price - currentPrice) <= maxDeviation
          );
          if (sanePoints.length === 0) return null;
          return { ...forecast, forecastPoints: sanePoints };
        })()
      : forecast;
    const saneTargetPrice = targetPrice && currentPrice > 0 && Math.abs(targetPrice - currentPrice) <= maxDeviation
      ? targetPrice
      : null;

    if (saneForecast?.forecastPoints?.length && hasOhlc && ohlcData) {
      const lastCandle = ohlcData[ohlcData.length - 1];
      const prevPrice = lastCandle.close;
      const priceSeq = [prevPrice, ...saneForecast.forecastPoints.map(fp => fp.price)];
      const isCandleMode = chartType === "candle" || chartType === "bar";

      if (isCandleMode) {
        const fcColor = "rgba(56, 189, 248, 0.45)";
        const fcBorder = "rgba(56, 189, 248, 0.7)";

        const forecastCandleSeries = chart.addCandlestickSeries({
          upColor: fcColor,
          downColor: fcColor,
          borderUpColor: fcBorder,
          borderDownColor: fcBorder,
          wickUpColor: fcBorder,
          wickDownColor: fcBorder,
        });

        const forecastCandles: CandlestickData[] = saneForecast.forecastPoints.map((fp, i) => {
          const openPrice = priceSeq[i];
          const closePrice = fp.price;
          const diff = Math.abs(closePrice - openPrice);
          const wickExt = diff * (0.2 + Math.random() * 0.3);
          const high = Math.max(openPrice, closePrice) + wickExt;
          const low = Math.min(openPrice, closePrice) - wickExt;
          return {
            time: toUTC(fp.timestamp),
            open: openPrice,
            high,
            low,
            close: closePrice,
          };
        });
        forecastCandleSeries.setData(forecastCandles);
        forecastSeriesRef.current = forecastCandleSeries;

        forecastCandleSeries.setMarkers([
          {
            time: toUTC(saneForecast.forecastPoints[0].timestamp) as UTCTimestamp,
            position: "aboveBar" as const,
            color: forecastLineColor,
            shape: "arrowDown" as const,
            text: "AI",
            size: 1,
          },
          {
            time: toUTC(saneForecast.forecastPoints[saneForecast.forecastPoints.length - 1].timestamp) as UTCTimestamp,
            position: "aboveBar" as const,
            color: forecastLineColor,
            shape: "circle" as const,
            text: formatUSD(saneForecast.forecastPoints[saneForecast.forecastPoints.length - 1].price),
            size: 1.5,
          },
        ]);
      } else {
        const forecastLineSeries = chart.addLineSeries({
          color: forecastLineColor,
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          crosshairMarkerRadius: 5,
          crosshairMarkerBorderColor: forecastLineColor,
          crosshairMarkerBackgroundColor: "#0a0f0d",
          lastValueVisible: true,
          priceLineVisible: false,
        });

        const fPoints: LineData[] = [
          { time: toUTC(lastCandle.timestamp), value: lastCandle.close },
          ...saneForecast.forecastPoints.map(fp => ({
            time: toUTC(fp.timestamp),
            value: fp.price,
          })),
        ];
        forecastLineSeries.setData(fPoints);
        forecastSeriesRef.current = forecastLineSeries;

        forecastLineSeries.setMarkers(
          saneForecast.forecastPoints.map((fp, i) => ({
            time: toUTC(fp.timestamp) as UTCTimestamp,
            position: "aboveBar" as const,
            color: forecastLineColor,
            shape: "circle" as const,
            text: i === saneForecast.forecastPoints.length - 1 ? formatUSD(fp.price) : "",
            size: i === saneForecast.forecastPoints.length - 1 ? 1.5 : 0.5,
          })),
        );
      }
    }

    if (saneTargetPrice && mainSeries) {
      forecastPriceLineRef.current = mainSeries.createPriceLine({
        price: saneTargetPrice,
        color: forecastLineColor,
        lineWidth: 1,
        lineStyle: LineStyle.SparseDotted,
        axisLabelVisible: true,
        title: `AI ${t("dashboard.target")}`,
      });
    }

    const baseBars = hasOhlc ? ohlcData!.length : (data?.length || 0);
    const forecastBars = saneForecast?.forecastPoints?.length || 0;
    const totalBars = baseBars + forecastBars;
    const visibleBars = getVisibleBars(selectedTimeframe);
    if (!userScrolledRef.current) {
      if (baseBars > visibleBars) {
        chart.timeScale().setVisibleLogicalRange({
          from: totalBars - visibleBars,
          to: totalBars + 8,
        });
      } else {
        chart.timeScale().fitContent();
      }
    }
    dataVersionRef.current++;
  }, [ohlcData, data, forecast, targetPrice, forecastLineColor, hasOhlc, chartType, selectedTimeframe, t]);

  const lastCandle = hasOhlc ? ohlcData![ohlcData!.length - 1] : null;
  const priceChange = lastCandle ? lastCandle.close - lastCandle.open : 0;
  const priceChangePercent = lastCandle && lastCandle.open ? ((priceChange / lastCandle.open) * 100) : 0;

  return (
    <div data-testid="chart-price-container">
      {onTimeframeChange && (
        <div className="mb-2 space-y-1" data-testid="timeframe-selector">
          <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf.key}
                className={`px-1.5 py-0.5 rounded text-[12px] font-medium transition-all duration-200 shrink-0 ${
                  selectedTimeframe === tf.key
                    ? "bg-[rgba(0,231,160,0.15)] text-[#00e7a0] shadow-[0_0_8px_rgba(0,231,160,0.12)]"
                    : "text-[rgba(180,195,190,0.45)] hover:text-[rgba(180,195,190,0.75)] hover:bg-white/[0.03]"
                }`}
                onClick={() => onTimeframeChange(tf.key)}
                data-testid={`button-tf-${tf.key}`}
              >
                {tf.label}
              </button>
            ))}

            <div className="w-px h-3.5 bg-white/[0.08] mx-1 shrink-0" />

            {hasOhlc && CHART_TYPES.map(ct => {
              const Icon = ct.icon;
              return (
                <button
                  key={ct.key}
                  className={`p-0.5 rounded transition-all duration-200 shrink-0 ${
                    chartType === ct.key
                      ? "bg-[rgba(0,231,160,0.15)] text-[#00e7a0]"
                      : "text-[rgba(180,195,190,0.35)] hover:text-[rgba(180,195,190,0.65)] hover:bg-white/[0.03]"
                  }`}
                  onClick={() => setChartType(ct.key)}
                  title={ct.label}
                >
                  <Icon className="h-3 w-3" />
                </button>
              );
            })}

            {forecastLoading && !forecast && (
              <>
                <div className="w-px h-3.5 bg-white/[0.08] mx-1 shrink-0" />
                <Badge className="text-[11px] shrink-0 bg-muted/30 text-muted-foreground no-default-hover-elevate no-default-active-elevate animate-pulse border-0 whitespace-nowrap">
                  <Sparkles className="mr-0.5 h-2 w-2" />
                  {t("common.loading")}
                </Badge>
              </>
            )}
          </div>

          {hasOhlc && lastCandle && (
            <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] font-mono leading-none overflow-x-auto scrollbar-hide">
              <span className="text-[rgba(180,195,190,0.4)] whitespace-nowrap">O <span className="text-[rgba(220,235,230,0.75)]">{formatUSD(lastCandle.open)}</span></span>
              <span className="text-[rgba(180,195,190,0.4)] whitespace-nowrap">H <span className="text-[rgba(220,235,230,0.75)]">{formatUSD(lastCandle.high)}</span></span>
              <span className="text-[rgba(180,195,190,0.4)] whitespace-nowrap">L <span className="text-[rgba(220,235,230,0.75)]">{formatUSD(lastCandle.low)}</span></span>
              <span className="text-[rgba(180,195,190,0.4)] whitespace-nowrap">C <span className="text-[rgba(220,235,230,0.75)]">{formatUSD(lastCandle.close)}</span></span>
              <span className={`font-semibold whitespace-nowrap ${priceChange >= 0 ? "text-[#00e7a0]" : "text-[#ff4976]"}`}>
                {priceChange >= 0 ? "+" : ""}{priceChangePercent.toFixed(2)}%
              </span>
            </div>
          )}

          {forecast && (
            <div className="flex items-center gap-1.5 flex-wrap" data-testid="forecast-target-label">
              <Badge
                className={`text-[11px] shrink-0 ${directionColor} no-default-hover-elevate no-default-active-elevate border-0 whitespace-nowrap`}
                data-testid="badge-forecast-direction"
              >
                <Sparkles className="mr-0.5 h-2 w-2" />
                {activeModel || "AI"} {direction} {confidence}%
              </Badge>
              {targetPrice && (
                <Badge
                  className={`text-[11px] shrink-0 ${directionColor} no-default-hover-elevate no-default-active-elevate border-0 whitespace-nowrap opacity-75`}
                >
                  <Sparkles className="mr-0.5 h-2 w-2" />
                  {t("dashboard.target")}: {formatUSD(targetPrice)}
                </Badge>
              )}
            </div>
          )}
        </div>
      )}

      {isLoading || !hasData ? (
        <Skeleton className="h-[280px] w-full rounded-lg" />
      ) : (
        <div
          className="relative w-full transition-opacity duration-500 ease-out rounded-lg overflow-hidden"
          style={{
            opacity: visible ? 1 : 0,
            background: "linear-gradient(180deg, rgba(10,18,14,0.5) 0%, rgba(8,14,11,0.8) 100%)",
            border: "1px solid rgba(0,231,160,0.06)",
          }}
          data-testid="chart-price"
        >

          <div ref={chartContainerRef} className="w-full tv-hide-logo" style={{ height: 280 }} />
          <div className="absolute bottom-1.5 left-2 text-[9px] font-bold tracking-widest text-white/[0.06] pointer-events-none select-none">
            NEXA AI
          </div>
        </div>
      )}

    </div>
  );
}
