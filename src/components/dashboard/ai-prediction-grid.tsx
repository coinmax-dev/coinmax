import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, TrendingUp, TrendingDown, Minus, Clock, Brain } from "lucide-react";
import { formatUSD } from "@/lib/constants";
import { getAiPrediction } from "@/lib/api";
import { useTranslation } from "react-i18next";

const PREDICTION_TIMEFRAMES = ["5M", "15M", "30M", "1H", "4H", "1D", "1W"] as const;

interface PredictionResult {
  asset: string;
  prediction: string;
  confidence: string;
  targetPrice: string;
  currentPrice: string;
  fearGreedIndex: number;
  fearGreedLabel: string;
  reasoning: string;
  timeframe: string;
}

interface AiPredictionGridProps {
  asset: string;
  currentPrice: number | null;
}

export function AiPredictionGrid({ asset, currentPrice }: AiPredictionGridProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [selectedTf, setSelectedTf] = useState<string>("1H");

  const { data: prediction, isLoading, isFetching } = useQuery<PredictionResult>({
    queryKey: ["ai-prediction", asset, selectedTf, lang],
    queryFn: () => getAiPrediction(asset, selectedTf, lang),
    staleTime: 3 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const isBullish = prediction?.prediction === "BULLISH";
  const isBearish = prediction?.prediction === "BEARISH";
  const confidence = prediction ? parseFloat(prediction.confidence) : 0;
  const target = prediction ? parseFloat(prediction.targetPrice) : 0;
  const priceDiff = currentPrice && target ? ((target - currentPrice) / currentPrice * 100).toFixed(2) : "0.00";

  return (
    <Card className="border-border bg-card" data-testid="card-ai-prediction">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Brain className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold">{t("dashboard.aiPricePrediction")}</span>
            {isFetching && (
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            )}
          </div>
          <Badge variant="outline" className="text-[11px] text-primary/70 border-primary/30 no-default-hover-elevate no-default-active-elevate">
            <Sparkles className="h-3 w-3 mr-1" />
            GPT-4o
          </Badge>
        </div>

        <div className="flex gap-1 mb-4 overflow-x-auto" data-testid="prediction-timeframe-grid">
          {PREDICTION_TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              className={`
                flex-1 min-w-[38px] py-2 rounded-md text-xs font-bold text-center transition-all
                ${selectedTf === tf
                  ? "bg-primary text-white shadow-[0_0_10px_rgba(0,188,165,0.4)]"
                  : "bg-card border border-border/60 text-muted-foreground hover-elevate"
                }
              `}
              onClick={() => setSelectedTf(tf)}
              data-testid={`button-predict-${tf}`}
            >
              {tf}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-4 w-3/4 rounded-md" />
          </div>
        ) : prediction ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                {isBullish ? (
                  <div className="h-10 w-10 rounded-full bg-emerald-500/20 flex items-center justify-center"
                    style={{ boxShadow: "0 0 12px rgba(16,185,129,0.3)" }}>
                    <TrendingUp className="h-5 w-5 text-emerald-400" />
                  </div>
                ) : isBearish ? (
                  <div className="h-10 w-10 rounded-full bg-red-500/20 flex items-center justify-center"
                    style={{ boxShadow: "0 0 12px rgba(239,68,68,0.3)" }}>
                    <TrendingDown className="h-5 w-5 text-red-400" />
                  </div>
                ) : (
                  <div className="h-10 w-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
                    <Minus className="h-5 w-5 text-yellow-400" />
                  </div>
                )}
                <div>
                  <div className={`text-lg font-bold ${isBullish ? "text-emerald-400" : isBearish ? "text-red-400" : "text-yellow-400"}`}
                    style={isBullish ? { textShadow: "0 0 8px rgba(16,185,129,0.5)" } : isBearish ? { textShadow: "0 0 8px rgba(239,68,68,0.5)" } : {}}
                    data-testid="text-prediction-direction"
                  >
                    {prediction.prediction}
                  </div>
                  <div className="text-[12px] text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {selectedTf} {t("dashboard.timeframe")}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground mb-0.5">{t("dashboard.confidence")}</div>
                <div className="text-lg font-bold text-neon-value" data-testid="text-prediction-confidence">
                  {confidence}%
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-background/50 rounded-md p-2.5 border border-border/30">
                <div className="text-[12px] text-muted-foreground mb-0.5">{t("dashboard.targetPrice")}</div>
                <div className={`text-sm font-bold ${isBullish ? "text-emerald-400" : isBearish ? "text-red-400" : "text-foreground"}`}
                  data-testid="text-prediction-target"
                >
                  {target > 0 ? formatUSD(target) : "--"}
                </div>
              </div>
              <div className="bg-background/50 rounded-md p-2.5 border border-border/30">
                <div className="text-[12px] text-muted-foreground mb-0.5">{t("dashboard.expectedChange")}</div>
                <div className={`text-sm font-bold ${parseFloat(priceDiff) >= 0 ? "text-emerald-400" : "text-red-400"}`}
                  data-testid="text-prediction-change"
                >
                  {parseFloat(priceDiff) >= 0 ? "+" : ""}{priceDiff}%
                </div>
              </div>
            </div>

            <div className="bg-background/30 rounded-md p-2.5 border border-border/20">
              <div className="text-[12px] text-muted-foreground mb-0.5">{t("dashboard.aiAnalysis")}</div>
              <p className="text-xs text-foreground/80" data-testid="text-prediction-reasoning">
                {prediction.reasoning}
              </p>
            </div>

            <div className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground flex-wrap">
              <span>{t("dashboard.fearGreed")}: {prediction.fearGreedIndex} ({prediction.fearGreedLabel})</span>
              <span>{t("dashboard.sourceOpenAI")}</span>
            </div>
          </div>
        ) : (
          <div className="text-center py-4">
            <Sparkles className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">{t("dashboard.selectTimeframe")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
