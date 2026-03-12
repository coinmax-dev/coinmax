import { useState, useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { fetchExchangeDepth, getAiForecastSingle, AI_MODEL_LABELS } from "@/lib/api";
import { useCryptoPrices, useBinanceKlines, useOrderBook } from "@/hooks/use-crypto-price";
import type { ChartTimeframe } from "@/hooks/use-crypto-price";
import { PriceHeader } from "@/components/dashboard/price-header";
import { PriceChart } from "@/components/dashboard/price-chart";
import { AssetTabs } from "@/components/dashboard/asset-tabs";
import { DepthBar } from "@/components/dashboard/depth-bar";
import { TrendingFeed } from "@/components/dashboard/trending-feed";
import { ExchangeDepth } from "@/components/dashboard/exchange-depth";
import { AiModelCarousel } from "@/components/dashboard/ai-model-carousel";
import { BarChart3 } from "lucide-react";

interface ForecastResponse {
  model: string;
  asset: string;
  timeframe: string;
  direction: string;
  confidence: number;
  currentPrice: number;
  targetPrice: number;
  reasoning: string;
  forecastPoints: { timestamp: number; time: string; price: number; predicted: boolean }[];
}


export default function Dashboard() {
  const [, navigate] = useLocation();
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const [selectedAsset, setSelectedAsset] = useState("BTC");
  const [selectedTimeframe, setSelectedTimeframe] = useState<ChartTimeframe>("1H");
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  const { data: prices, isLoading: pricesLoading } = useCryptoPrices();
  const { data: klineData, isLoading: chartLoading } = useBinanceKlines(selectedAsset, selectedTimeframe);
  const { data: orderBook, isLoading: bookLoading } = useOrderBook(selectedAsset);

  const { data: exchangeData, isLoading: exchangeLoading } = useQuery<{
    exchanges: Array<{ name: string; buy: number; sell: number }>;
    aggregatedBuy: number;
    aggregatedSell: number;
    fearGreedIndex: number;
    fearGreedLabel: string;
    longShortRatio: number;
    timestamp: number;
  }>({
    queryKey: ["exchange-depth", selectedAsset],
    queryFn: async () => {
      const depth = await fetchExchangeDepth(selectedAsset);
      return {
        exchanges: depth.exchanges.map(e => ({ name: e.name, buy: e.buyPercent, sell: e.sellPercent })),
        aggregatedBuy: depth.buyPercent,
        aggregatedSell: depth.sellPercent,
        fearGreedIndex: depth.fearGreedIndex,
        fearGreedLabel: depth.fearGreedLabel,
        longShortRatio: depth.buyPercent / (depth.sellPercent || 1),
        timestamp: Date.now(),
      };
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  // Fire parallel per-model queries — each model shows as soon as it returns
  const modelQueries = useQueries({
    queries: AI_MODEL_LABELS.map((modelLabel) => {
      const lsCacheKey = `forecast:${selectedAsset}:${selectedTimeframe}:${modelLabel}`;
      return {
        queryKey: ["ai-forecast-single", selectedAsset, selectedTimeframe, modelLabel, lang],
        queryFn: async () => {
          const result = await getAiForecastSingle(selectedAsset, selectedTimeframe, modelLabel, lang);
          const forecast = result?.forecasts?.[0] || null;
          if (forecast) try { localStorage.setItem(lsCacheKey, JSON.stringify(forecast)); } catch {}
          return forecast as ForecastResponse | null;
        },
        staleTime: 3 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchInterval: 5 * 60 * 1000,
        placeholderData: (prev: ForecastResponse | null | undefined) => {
          if (prev) return prev;
          try {
            const cached = localStorage.getItem(lsCacheKey);
            if (cached) return JSON.parse(cached) as ForecastResponse;
          } catch {}
          return undefined;
        },
        retry: 1,
      };
    }),
  });

  // Merge all resolved forecasts into a single list (updates progressively)
  const allForecasts = useMemo(() => {
    return modelQueries
      .map(q => q.data)
      .filter((f): f is ForecastResponse => !!f && !!f.model)
      .sort((a, b) => b.confidence - a.confidence);
  }, [modelQueries.map(q => q.data)]);

  const forecastLoading = modelQueries.every(q => q.isLoading);

  // Chart always shows the highest-confidence model (fixed, no switching)
  const chartForecast = useMemo(() => {
    if (!allForecasts.length) return null;
    return allForecasts[0];
  }, [allForecasts]);

  const chartModelName = chartForecast?.model || null;

  // Active model for carousel highlight only (does NOT affect chart)
  const activeModelName = selectedModel || chartModelName;

  const selectedCoin = prices?.find(
    (p) => p.symbol.toUpperCase() === selectedAsset
  );

  const depthBuy = exchangeData ? String(exchangeData.aggregatedBuy) : (orderBook?.buyPercent || "50.0");
  const depthSell = exchangeData ? String(exchangeData.aggregatedSell) : (orderBook?.sellPercent || "50.0");

  return (
    <div className="space-y-4 pb-24 lg:pb-8 lg:px-6 lg:pt-4" data-testid="page-dashboard">
      <div
        className="gradient-green-dark rounded-b-2xl lg:rounded-2xl px-3 pb-3 pt-1.5 lg:pt-3"
      >
        <div className="flex items-start justify-between gap-2">
          <PriceHeader coin={selectedCoin} isLoading={pricesLoading} />
          <button
            onClick={() => navigate(`/market?coin=${selectedAsset}`)}
            className="mt-0.5 shrink-0 h-8 w-8 rounded-lg flex items-center justify-center transition-all duration-200 active:translate-y-[1px] active:shadow-none"
            style={{
              background: "linear-gradient(145deg, rgba(0,231,160,0.2) 0%, rgba(0,180,130,0.12) 100%)",
              border: "1px solid rgba(0,231,160,0.25)",
              boxShadow: "0 2px 8px rgba(0,231,160,0.15), inset 0 1px 0 rgba(255,255,255,0.08), 0 1px 2px rgba(0,0,0,0.3)",
            }}
            data-testid="button-market-analysis"
          >
            <BarChart3 className="h-4 w-4 text-[#00e7a0]" />
          </button>
        </div>
        <PriceChart
          ohlcData={klineData}
          isLoading={chartLoading}
          forecast={chartForecast || null}
          forecastLoading={forecastLoading}
          selectedTimeframe={selectedTimeframe}
          onTimeframeChange={setSelectedTimeframe}
          activeModel={chartModelName || undefined}
        />
      </div>

      <div className="px-4 lg:px-0">
        <AssetTabs selected={selectedAsset} onChange={setSelectedAsset} />
      </div>

      {/* AI Model Carousel */}
      <div className="px-4 lg:px-0">
        <AiModelCarousel
          forecasts={allForecasts}
          isLoading={forecastLoading}
          activeModel={activeModelName || null}
          onSelectModel={setSelectedModel}
        />
      </div>

      {/* Desktop: two-column grid for depth + trending */}
      <div className="lg:grid lg:grid-cols-2 lg:gap-4 space-y-4 lg:space-y-0">
        <div className="px-4 lg:px-0">
          <DepthBar
            buyPercent={depthBuy}
            sellPercent={depthSell}
            isLoading={bookLoading && exchangeLoading}
            fearGreedIndex={exchangeData?.fearGreedIndex}
            fearGreedLabel={exchangeData?.fearGreedLabel}
          />
        </div>

        <div className="px-4 lg:px-0">
          <div className="glass-card rounded-2xl p-4 relative overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <TrendingFeed prices={prices} isLoading={pricesLoading} />
          </div>
        </div>
      </div>

      <div className="px-4 lg:px-0">
        <div className="glass-card rounded-2xl p-4 relative overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <ExchangeDepth symbol={selectedAsset} />
        </div>
      </div>
    </div>
  );
}
