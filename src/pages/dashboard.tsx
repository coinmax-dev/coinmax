import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { ASSET_IDS } from "@/lib/constants";
import { fetchExchangeDepth, getAiForecastMulti } from "@/lib/api";
import { useCryptoPrices, useBinanceKlines, useOrderBook } from "@/hooks/use-crypto-price";
import type { ChartTimeframe } from "@/hooks/use-crypto-price";
import { PriceHeader } from "@/components/dashboard/price-header";
import { PriceChart } from "@/components/dashboard/price-chart";
import { AssetTabs } from "@/components/dashboard/asset-tabs";
import { DepthBar } from "@/components/dashboard/depth-bar";
import { TrendingFeed } from "@/components/dashboard/trending-feed";
import { ExchangeDepth } from "@/components/dashboard/exchange-depth";
import { AiModelCarousel } from "@/components/dashboard/ai-model-carousel";
import { Button } from "@/components/ui/button";
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

interface MultiForecastResponse {
  forecasts: ForecastResponse[];
}

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const [selectedAsset, setSelectedAsset] = useState("BTC");
  const [selectedTimeframe, setSelectedTimeframe] = useState<ChartTimeframe>("1H");
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const coinId = ASSET_IDS[selectedAsset] || "bitcoin";

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

  const { data: multiResult, isLoading: forecastLoading } = useQuery<MultiForecastResponse>({
    queryKey: ["ai-forecast-multi", selectedAsset, selectedTimeframe, lang],
    queryFn: () => getAiForecastMulti(selectedAsset, selectedTimeframe, lang),
    staleTime: 3 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  const allForecasts = multiResult?.forecasts || [];

  // Determine which forecast to display on chart
  const activeForecast = useMemo(() => {
    if (!allForecasts.length) return null;
    if (selectedModel) {
      const found = allForecasts.find(f => f.model === selectedModel);
      if (found) return found;
    }
    // Default: highest confidence (already sorted by backend)
    return allForecasts[0];
  }, [allForecasts, selectedModel]);

  // Auto-select best model when data arrives
  const activeModelName = activeForecast?.model || selectedModel;

  const selectedCoin = prices?.find(
    (p) => p.symbol.toUpperCase() === selectedAsset
  );

  const depthBuy = exchangeData ? String(exchangeData.aggregatedBuy) : (orderBook?.buyPercent || "50.0");
  const depthSell = exchangeData ? String(exchangeData.aggregatedSell) : (orderBook?.sellPercent || "50.0");

  return (
    <div className="space-y-4 pb-24" data-testid="page-dashboard">
      <div
        className="gradient-green-dark rounded-b-2xl px-3 pb-3 pt-1.5"
        style={{ animation: "fadeSlideIn 0.5s ease-out" }}
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
          forecast={activeForecast || null}
          forecastLoading={forecastLoading}
          selectedTimeframe={selectedTimeframe}
          onTimeframeChange={setSelectedTimeframe}
          activeModel={activeModelName || undefined}
        />
      </div>

      {/* AI Model Carousel */}
      <div className="px-4" style={{ animation: "fadeSlideIn 0.55s ease-out" }}>
        <AiModelCarousel
          forecasts={allForecasts}
          isLoading={forecastLoading}
          activeModel={activeModelName || null}
          onSelectModel={setSelectedModel}
        />
      </div>

      <div className="px-4" style={{ animation: "fadeSlideIn 0.6s ease-out" }}>
        <AssetTabs selected={selectedAsset} onChange={setSelectedAsset} />
      </div>

      <div className="px-4" style={{ animation: "fadeSlideIn 0.7s ease-out" }}>
        <DepthBar
          buyPercent={depthBuy}
          sellPercent={depthSell}
          isLoading={bookLoading && exchangeLoading}
          fearGreedIndex={exchangeData?.fearGreedIndex}
          fearGreedLabel={exchangeData?.fearGreedLabel}
        />
      </div>

      <div className="px-4" style={{ animation: "fadeSlideIn 0.85s ease-out" }}>
        <div className="glass-card rounded-2xl p-4 relative overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <TrendingFeed prices={prices} isLoading={pricesLoading} />
        </div>
      </div>

      <div className="px-4" style={{ animation: "fadeSlideIn 0.9s ease-out" }}>
        <div className="glass-card rounded-2xl p-4 relative overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <ExchangeDepth symbol={selectedAsset} />
        </div>
      </div>
    </div>
  );
}
