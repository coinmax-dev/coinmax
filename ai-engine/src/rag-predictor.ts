/**
 * RAG-Enhanced Prediction Pipeline
 *
 * Phase 3.1: The core intelligence layer that combines:
 *   1. Current market state (price + indicators + on-chain + sentiment)
 *   2. Vector similarity search against historical predictions
 *   3. Historical accuracy analysis per model
 *   4. Dynamic model weighting
 *   5. Enhanced AI prompt with RAG context
 *   6. Weighted consensus → filtered signal → strategy selection
 *
 * This module orchestrates the entire prediction flow.
 *
 * Reference: hummingbot ai_livestream.py → signal pipeline
 */

import { createClient } from "@supabase/supabase-js";
import type { MarketState, SimilarPrediction } from "./vector-store";
import { generateEmbedding } from "./vector-store";
import { weightedConsensus, type ModelPrediction, type WeightedSignal } from "./model-weights";
import { filterSignal, type FilteredSignal, type FilterConfig } from "./signal-filter";
import { selectStrategy, detectMarketRegime, type StrategyRecommendation } from "./strategy-selector";
import { calculateAllIndicators, indicatorSummary, type IndicatorResult, type Candle } from "./indicators";
import { fetchAllOnChainMetrics, onChainSummary, type OnChainMetrics } from "./onchain-data";
import { detectPatterns, patternSummary } from "./patterns";

// ── Types ───────────────────────────────────────────────────

export interface RAGContext {
  similarPredictions: SimilarPrediction[];
  historicalAccuracy: Map<string, number>; // model → accuracy in similar conditions
  bestModel: string | null;
  bestStrategy: string | null;
  avgOutcome: number; // average actual_change_pct from similar predictions
  summary: string;    // human-readable for AI prompt injection
}

export interface PredictionPipelineResult {
  // Raw model predictions (from AI models)
  predictions: ModelPrediction[];
  // Weighted consensus
  consensus: WeightedSignal;
  // Filtered signal
  signal: FilteredSignal;
  // Strategy recommendation
  strategy: StrategyRecommendation;
  // RAG context used
  ragContext: RAGContext | null;
  // Technical analysis used
  indicators: IndicatorResult | null;
  onChain: OnChainMetrics | null;
  // Enhanced prompt that was sent to models
  enhancedPrompt: string;
}

// ── RAG Context Builder ─────────────────────────────────────

/**
 * Search for similar historical market states and build RAG context.
 */
export async function buildRAGContext(
  supabaseUrl: string,
  supabaseKey: string,
  openaiKey: string,
  marketState: MarketState,
): Promise<RAGContext | null> {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Generate embedding for current market state
    const embedding = await generateEmbedding(marketState, openaiKey);

    // Vector search for similar historical predictions
    const { data: similar, error } = await supabase.rpc("match_similar_predictions", {
      query_embedding: embedding,
      match_asset: marketState.asset,
      match_timeframe: marketState.timeframe,
      match_count: 10,
    });

    if (error || !similar || similar.length === 0) return null;

    const predictions: SimilarPrediction[] = similar.map((row: any) => ({
      id: row.id,
      asset: row.asset,
      timeframe: row.timeframe,
      model: row.model,
      prediction: row.prediction,
      confidence: row.confidence,
      directionCorrect: row.direction_correct,
      actualChangePct: row.actual_change_pct,
      similarity: row.similarity,
    }));

    // Analyze which models performed best in similar conditions
    const modelCorrect = new Map<string, { correct: number; total: number }>();
    let totalChange = 0;
    let changeCount = 0;

    for (const p of predictions) {
      if (!modelCorrect.has(p.model)) {
        modelCorrect.set(p.model, { correct: 0, total: 0 });
      }
      const mc = modelCorrect.get(p.model)!;
      mc.total++;
      if (p.directionCorrect) mc.correct++;
      if (p.actualChangePct !== null) {
        totalChange += p.actualChangePct;
        changeCount++;
      }
    }

    // Model accuracy in similar conditions
    const historicalAccuracy = new Map<string, number>();
    let bestModel: string | null = null;
    let bestAccuracy = 0;

    for (const [model, stats] of modelCorrect) {
      const accuracy = stats.total > 0 ? (stats.correct / stats.total) * 100 : 50;
      historicalAccuracy.set(model, accuracy);
      if (accuracy > bestAccuracy) {
        bestAccuracy = accuracy;
        bestModel = model;
      }
    }

    const avgOutcome = changeCount > 0 ? totalChange / changeCount : 0;

    // Determine dominant outcome
    const bullishCount = predictions.filter(p => p.directionCorrect && p.prediction === "BULLISH").length;
    const bearishCount = predictions.filter(p => p.directionCorrect && p.prediction === "BEARISH").length;
    const dominantDirection = bullishCount > bearishCount ? "BULLISH" : bearishCount > bullishCount ? "BEARISH" : "MIXED";

    // Build summary for AI prompt
    const totalCorrect = predictions.filter(p => p.directionCorrect).length;
    const summaryParts = [
      `Similar History (RAG): ${predictions.length} similar patterns found`,
      `${totalCorrect}/${predictions.length} predictions were correct`,
      `Average outcome: ${avgOutcome > 0 ? "+" : ""}${avgOutcome.toFixed(2)}% (${dominantDirection})`,
    ];

    if (bestModel) {
      summaryParts.push(`Best model in similar conditions: ${bestModel} (${bestAccuracy.toFixed(0)}% accuracy)`);
    }

    return {
      similarPredictions: predictions,
      historicalAccuracy,
      bestModel,
      bestStrategy: null, // Will be populated when we have strategy tracking
      avgOutcome,
      summary: summaryParts.join(", "),
    };
  } catch {
    return null; // RAG is optional — don't break the pipeline
  }
}

// ── Enhanced Prompt Builder ─────────────────────────────────

/**
 * Build the enhanced AI prompt with all available context.
 */
export function buildEnhancedPrompt(
  asset: string,
  currentPrice: number,
  timeframeLabel: string,
  priceFloor: number,
  priceCeil: number,
  maxMovePct: number,
  fearGreed: { value: number; classification: string },
  indicators: IndicatorResult | null,
  onChain: OnChainMetrics | null,
  patterns: string | null,
  ragContext: RAGContext | null,
): string {
  const parts: string[] = [
    `Analyze ${asset}/USDT at $${currentPrice.toLocaleString()}.`,
  ];

  // Sentiment
  parts.push(`Sentiment: Fear & Greed Index=${fearGreed.value} (${fearGreed.classification})`);

  // Technical indicators
  if (indicators) {
    parts.push(`Technical: ${indicatorSummary(indicators, currentPrice)}`);
  }

  // Candle patterns
  if (patterns && patterns !== "None" && patterns !== "No significant candle patterns") {
    parts.push(`Patterns: ${patterns}`);
  }

  // On-chain data
  if (onChain) {
    parts.push(`On-Chain: ${onChainSummary(onChain)}`);
  }

  // RAG context
  if (ragContext) {
    parts.push(ragContext.summary);
  }

  // Price constraints
  parts.push(
    `Predict the ${timeframeLabel} movement. targetPrice must be between $${priceFloor.toFixed(2)} and $${priceCeil.toFixed(2)} (max ${(maxMovePct * 100).toFixed(1)}% move).`
  );

  return parts.join("\n     ");
}

// ── Full Pipeline ───────────────────────────────────────────

/**
 * Run the complete RAG-enhanced prediction pipeline.
 *
 * This is the main entry point that orchestrates:
 * 1. Technical analysis
 * 2. On-chain data
 * 3. RAG context (vector similarity search)
 * 4. Enhanced prompt generation
 * 5. Model predictions (external — passed in)
 * 6. Weighted consensus
 * 7. Signal filtering
 * 8. Strategy selection
 */
export function processPredictions(
  predictions: ModelPrediction[],
  accuracyMap: Map<string, number>,
  indicators: IndicatorResult | null,
  ragContext: RAGContext | null,
  filterConfig?: Partial<FilterConfig>,
): {
  consensus: WeightedSignal;
  signal: FilteredSignal;
  strategy: StrategyRecommendation;
} {
  // Get RAG-based accuracy for weighting
  const ragAccuracies = ragContext?.historicalAccuracy;

  // Step 1: Weighted consensus
  const consensus = weightedConsensus(predictions, accuracyMap, ragAccuracies);

  // Step 2: Filter signal
  const signal = filterSignal(consensus, filterConfig);

  // Step 3: Select strategy
  const strategy = indicators
    ? selectStrategy(detectMarketRegime(indicators), signal, indicators)
    : {
        strategy: "directional" as const,
        confidence: 50,
        regime: { volatility: "MEDIUM" as const, trend: "NEUTRAL" as const, momentum: "NEUTRAL" as const, volume: "NORMAL" as const },
        params: { leverage: 2, stopLossPct: 0.02, takeProfitPct: 0.03, maxPositionSize: 0.5 },
        reason: "No indicator data — default conservative directional",
      };

  return { consensus, signal, strategy };
}
