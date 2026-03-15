/**
 * Vector Store — Market State Embeddings + Similarity Search
 *
 * Uses Supabase pgvector for storage and OpenAI text-embedding-3-small for embeddings.
 * Embeds market context at prediction time, enabling RAG-based similar market lookup.
 *
 * Reference: TECHNICAL_PLAN.md Phase 1.2
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ── Types ───────────────────────────────────────────────────

export interface MarketState {
  asset: string;
  timeframe: string;
  currentPrice: number;
  priceChange1h?: number;
  priceChange24h?: number;
  volumeChange24h?: number;
  fearGreedIndex: number;
  rsi14?: number;
  macdSignal?: string;
  predictions: Record<string, { direction: string; confidence: number }>;
}

export interface SimilarPrediction {
  id: string;
  asset: string;
  timeframe: string;
  model: string;
  prediction: string;
  confidence: number;
  directionCorrect: boolean | null;
  actualChangePct: number | null;
  similarity: number;
}

// ── Embedding Generation ────────────────────────────────────

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

/**
 * Generate a text embedding from a market state description.
 * Uses OpenAI's text-embedding-3-small (1536 dimensions).
 */
export async function generateEmbedding(
  state: MarketState,
  openaiKey: string,
): Promise<number[]> {
  const text = buildEmbeddingText(state);

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI embedding failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.data[0].embedding;
}

/**
 * Build a text description of market state for embedding.
 * Structured text produces better embeddings than raw numbers.
 */
function buildEmbeddingText(state: MarketState): string {
  const parts = [
    `Asset: ${state.asset}/USDT`,
    `Price: $${state.currentPrice}`,
    `Timeframe: ${state.timeframe}`,
    `Fear & Greed: ${state.fearGreedIndex}`,
  ];

  if (state.priceChange1h !== undefined) parts.push(`1h change: ${state.priceChange1h.toFixed(2)}%`);
  if (state.priceChange24h !== undefined) parts.push(`24h change: ${state.priceChange24h.toFixed(2)}%`);
  if (state.volumeChange24h !== undefined) parts.push(`Volume change 24h: ${state.volumeChange24h.toFixed(2)}%`);
  if (state.rsi14 !== undefined) parts.push(`RSI(14): ${state.rsi14.toFixed(1)}`);
  if (state.macdSignal) parts.push(`MACD: ${state.macdSignal}`);

  const predSummary = Object.entries(state.predictions)
    .map(([model, p]) => `${model}: ${p.direction} (${p.confidence}%)`)
    .join(", ");
  if (predSummary) parts.push(`Model predictions: ${predSummary}`);

  return parts.join(". ");
}

// ── Vector Store Operations ─────────────────────────────────

export class VectorStore {
  private supabase: SupabaseClient;
  private openaiKey: string;

  constructor(supabaseUrl: string, supabaseKey: string, openaiKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.openaiKey = openaiKey;
  }

  /**
   * Store embedding for a prediction record.
   */
  async embedPrediction(predictionId: string, state: MarketState): Promise<void> {
    const embedding = await generateEmbedding(state, this.openaiKey);

    const { error } = await this.supabase
      .from("ai_prediction_records")
      .update({ embedding })
      .eq("id", predictionId);

    if (error) throw new Error(`Failed to store embedding: ${error.message}`);
  }

  /**
   * Find similar historical market states using vector similarity search.
   * Returns resolved predictions with similarity scores.
   */
  async findSimilar(
    state: MarketState,
    options: { matchCount?: number; filterAsset?: boolean; filterTimeframe?: boolean } = {},
  ): Promise<SimilarPrediction[]> {
    const { matchCount = 5, filterAsset = false, filterTimeframe = false } = options;
    const embedding = await generateEmbedding(state, this.openaiKey);

    const { data, error } = await this.supabase.rpc("match_similar_predictions", {
      query_embedding: embedding,
      match_asset: filterAsset ? state.asset : null,
      match_timeframe: filterTimeframe ? state.timeframe : null,
      match_count: matchCount,
    });

    if (error) throw new Error(`Vector search failed: ${error.message}`);

    return (data || []).map((row: any) => ({
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
  }

  /**
   * Get accuracy stats for all models on a given asset/timeframe.
   */
  async getModelAccuracy(
    asset: string,
    timeframe: string,
    period: string = "30d",
  ): Promise<Array<{ model: string; accuracy: number; total: number; avgConfidence: number }>> {
    const { data, error } = await this.supabase
      .from("ai_model_accuracy")
      .select("model, accuracy_pct, total_predictions, avg_confidence")
      .eq("asset", asset)
      .eq("timeframe", timeframe)
      .eq("period", period)
      .order("accuracy_pct", { ascending: false });

    if (error) throw new Error(`Failed to fetch accuracy: ${error.message}`);

    return (data || []).map((row: any) => ({
      model: row.model,
      accuracy: row.accuracy_pct,
      total: row.total_predictions,
      avgConfidence: row.avg_confidence,
    }));
  }
}

export default VectorStore;
