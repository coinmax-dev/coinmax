/**
 * Dynamic Model Weighting
 *
 * Phase 3.2: Weight each AI model based on historical accuracy.
 * Models that perform better on specific asset/timeframe combos get higher weight.
 *
 * Algorithm:
 *   weight = recentAccuracy(7d) * 0.4 + overallAccuracy(30d) * 0.3 + ragAccuracy * 0.3
 *
 * Reference: TECHNICAL_PLAN.md Phase 3.2
 * Hummingbot ref: directional_trading_controller_base.py → signal weighting
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ── Types ───────────────────────────────────────────────────

export interface ModelWeight {
  model: string;
  weight: number;
  accuracy7d: number;
  accuracy30d: number;
  ragAccuracy: number;
  totalPredictions: number;
}

export interface ModelPrediction {
  model: string;
  asset: string;
  timeframe: string;
  prediction: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
  targetPrice: number;
}

export interface WeightedSignal {
  direction: "LONG" | "SHORT" | "NEUTRAL";
  confidence: number;
  bullishScore: number;
  bearishScore: number;
  modelWeights: ModelWeight[];
  agreeingModels: number;
  totalModels: number;
}

// ── Accuracy Fetcher ────────────────────────────────────────

interface AccuracyCache {
  data: Map<string, number>;
  expiresAt: number;
}

let accuracyCache: AccuracyCache | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchAccuracyMap(supabase: SupabaseClient): Promise<Map<string, number>> {
  if (accuracyCache && Date.now() < accuracyCache.expiresAt) return accuracyCache.data;

  const { data, error } = await supabase
    .from("ai_model_accuracy")
    .select("model, asset, timeframe, period, accuracy_pct, total_predictions");

  if (error || !data) return new Map();

  const map = new Map<string, number>();
  for (const row of data) {
    const key = `${row.model}:${row.asset}:${row.timeframe}:${row.period}`;
    map.set(key, row.accuracy_pct);
    // Also store total predictions for minimum threshold
    map.set(`${key}:count`, row.total_predictions);
  }

  accuracyCache = { data: map, expiresAt: Date.now() + CACHE_TTL };
  return map;
}

// ── Weight Calculation ──────────────────────────────────────

const DEFAULT_ACCURACY = 50; // Assume 50% for models with no history
const MIN_PREDICTIONS_FOR_WEIGHT = 5; // Need at least 5 resolved predictions

export function calculateModelWeight(
  accuracyMap: Map<string, number>,
  model: string,
  asset: string,
  timeframe: string,
  ragAccuracy: number = DEFAULT_ACCURACY,
): ModelWeight {
  const acc7d = accuracyMap.get(`${model}:${asset}:${timeframe}:7d`) ?? DEFAULT_ACCURACY;
  const acc30d = accuracyMap.get(`${model}:${asset}:${timeframe}:30d`) ?? DEFAULT_ACCURACY;
  const count = accuracyMap.get(`${model}:${asset}:${timeframe}:30d:count`) ?? 0;

  // If too few predictions, use default weight
  if (count < MIN_PREDICTIONS_FOR_WEIGHT) {
    return {
      model,
      weight: 1.0, // Equal weight when insufficient data
      accuracy7d: acc7d,
      accuracy30d: acc30d,
      ragAccuracy,
      totalPredictions: count,
    };
  }

  // Weighted accuracy: 40% recent + 30% overall + 30% RAG-based
  const weight = (acc7d * 0.4 + acc30d * 0.3 + ragAccuracy * 0.3) / 100;

  return {
    model,
    weight: Math.max(0.1, Math.min(2.0, weight)), // Clamp to [0.1, 2.0]
    accuracy7d: acc7d,
    accuracy30d: acc30d,
    ragAccuracy,
    totalPredictions: count,
  };
}

// ── Weighted Consensus ──────────────────────────────────────

/**
 * Combine multiple model predictions into a single weighted signal.
 *
 * Reference: hummingbot's processed_data["signal"] pattern
 *   -1 = short, 0 = neutral, 1 = long
 */
export function weightedConsensus(
  predictions: ModelPrediction[],
  accuracyMap: Map<string, number>,
  ragAccuracies?: Map<string, number>,
): WeightedSignal {
  if (predictions.length === 0) {
    return {
      direction: "NEUTRAL",
      confidence: 0,
      bullishScore: 0,
      bearishScore: 0,
      modelWeights: [],
      agreeingModels: 0,
      totalModels: 0,
    };
  }

  const asset = predictions[0].asset;
  const timeframe = predictions[0].timeframe;

  let bullishScore = 0;
  let bearishScore = 0;
  let totalWeight = 0;
  let bullishCount = 0;
  let bearishCount = 0;

  const modelWeights: ModelWeight[] = [];

  for (const p of predictions) {
    const ragAcc = ragAccuracies?.get(p.model) ?? DEFAULT_ACCURACY;
    const mw = calculateModelWeight(accuracyMap, p.model, asset, timeframe, ragAcc);
    modelWeights.push(mw);

    const score = mw.weight * (p.confidence / 100);

    if (p.prediction === "BULLISH") {
      bullishScore += score;
      bullishCount++;
    } else if (p.prediction === "BEARISH") {
      bearishScore += score;
      bearishCount++;
    }

    totalWeight += mw.weight;
  }

  // Direction: whichever side has higher weighted score
  const direction: "LONG" | "SHORT" | "NEUTRAL" =
    totalWeight === 0 ? "NEUTRAL" :
    bullishScore > bearishScore ? "LONG" :
    bearishScore > bullishScore ? "SHORT" :
    "NEUTRAL";

  // Confidence: how strong is the consensus (0-100)
  const confidence = totalWeight === 0
    ? 0
    : (Math.abs(bullishScore - bearishScore) / totalWeight) * 100;

  // How many models agree with the majority direction
  const agreeingModels = direction === "LONG" ? bullishCount :
    direction === "SHORT" ? bearishCount : 0;

  return {
    direction,
    confidence: parseFloat(confidence.toFixed(2)),
    bullishScore: parseFloat(bullishScore.toFixed(4)),
    bearishScore: parseFloat(bearishScore.toFixed(4)),
    modelWeights,
    agreeingModels,
    totalModels: predictions.length,
  };
}

// ── Main: Get Weights from DB ───────────────────────────────

export async function getWeightedConsensus(
  supabaseUrl: string,
  supabaseKey: string,
  predictions: ModelPrediction[],
): Promise<WeightedSignal> {
  const supabase = createClient(supabaseUrl, supabaseKey);
  const accuracyMap = await fetchAccuracyMap(supabase);
  return weightedConsensus(predictions, accuracyMap);
}
