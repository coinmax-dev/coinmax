import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * Simulate Trading — Cron Edge Function (AI-Integrated)
 *
 * Runs every 5 minutes to:
 * 1. Fetch real-time prices + candle data from Binance
 * 2. Load AI model accuracy weights from ai_model_accuracy table
 * 3. Generate weighted multi-model consensus signals
 * 4. Create paper trades from high-confidence signals
 * 5. Check existing paper trades for SL/TP hits and close them
 * 6. Record predictions for accuracy tracking
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ASSETS = ["BTC", "ETH", "SOL", "BNB"];

// Multiple timeframes for predictions
const PREDICTION_TIMEFRAMES: { tf: string; interval: string; expiresMin: number }[] = [
  { tf: "5m",  interval: "1m",  expiresMin: 5 },
  { tf: "15m", interval: "5m",  expiresMin: 15 },
  { tf: "1H",  interval: "5m",  expiresMin: 60 },
];

// Models matching the ones in ai_model_accuracy table
const AI_MODELS = [
  { name: "GPT-4o",    defaultWeight: 0.5 },
  { name: "DeepSeek",  defaultWeight: 0.8 },
  { name: "Llama 3.1", defaultWeight: 0.6 },
  { name: "Gemini",    defaultWeight: 0.4 },
  { name: "Grok",      defaultWeight: 0.4 },
];

// ── Price fetching ──────────────────────────────────────────

async function fetchPrices(): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  await Promise.all(
    ASSETS.map(async (asset) => {
      try {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${asset}USDT`);
        if (res.ok) {
          const d = await res.json();
          const p = parseFloat(d.price);
          if (p > 0) prices[asset] = p;
        }
      } catch { /* skip */ }
    })
  );
  return prices;
}

interface Candle { open: number; high: number; low: number; close: number; volume: number; }

async function fetchCandles(asset: string, limit = 30): Promise<Candle[]> {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${asset}USDT&interval=5m&limit=${limit}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((k: any[]) => ({
      open: parseFloat(k[1]), high: parseFloat(k[2]),
      low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
    }));
  } catch { return []; }
}

// ── Technical indicators ────────────────────────────────────

function calcRSI(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gains += change; else losses += Math.abs(change);
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}

function calcEMA(candles: Candle[], period: number): number {
  if (candles.length < period) return candles[candles.length - 1]?.close ?? 0;
  const k = 2 / (period + 1);
  let ema = candles[0].close;
  for (let i = 1; i < candles.length; i++) ema = candles[i].close * k + ema * (1 - k);
  return ema;
}

function calcMACD(candles: Candle[]): { macd: number; signal: number; histogram: number } {
  const ema12 = calcEMA(candles, 12);
  const ema26 = calcEMA(candles, 26);
  const macd = ema12 - ema26;
  // Approximate signal line
  const signal = macd * 0.8; // simplified
  return { macd, signal, histogram: macd - signal };
}

function calcMomentum(candles: Candle[]): number {
  if (candles.length < 5) return 0;
  const recent = candles.slice(-5);
  return ((recent[4].close - recent[0].close) / recent[0].close) * 100;
}

function calcVolatility(candles: Candle[]): number {
  if (candles.length < 10) return 1;
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    returns.push(Math.abs((candles[i].close - candles[i - 1].close) / candles[i - 1].close));
  }
  return returns.reduce((s, v) => s + v, 0) / returns.length * 100;
}

function calcBollingerBands(candles: Candle[], period = 20): { upper: number; middle: number; lower: number; pctB: number } {
  const closes = candles.slice(-period).map(c => c.close);
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0, pctB: 0.5 };
  const mean = closes.reduce((s, v) => s + v, 0) / closes.length;
  const std = Math.sqrt(closes.reduce((s, v) => s + (v - mean) ** 2, 0) / closes.length);
  const upper = mean + 2 * std;
  const lower = mean - 2 * std;
  const price = closes[closes.length - 1];
  const pctB = std > 0 ? (price - lower) / (upper - lower) : 0.5;
  return { upper, middle: mean, lower, pctB };
}

// ── Model simulation (each model has a different bias) ──────

interface ModelVote {
  model: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
  weight: number;
}

function simulateModelVote(
  modelName: string,
  rsi: number,
  momentum: number,
  macd: { histogram: number },
  bb: { pctB: number },
  volatility: number,
): { direction: "BULLISH" | "BEARISH" | "NEUTRAL"; confidence: number } {
  let longScore = 0;
  let shortScore = 0;

  switch (modelName) {
    case "DeepSeek": // Best model - momentum + trend follower
      if (rsi < 35) longScore += 30;
      else if (rsi > 65) shortScore += 30;
      if (momentum > 0.3) longScore += 25;
      else if (momentum < -0.3) shortScore += 25;
      if (macd.histogram > 0) longScore += 20;
      else shortScore += 20;
      // Small noise
      longScore += (Math.random() - 0.5) * 8;
      shortScore += (Math.random() - 0.5) * 8;
      break;

    case "Llama 3.1": // Mean-reversion focused
      if (rsi < 30) longScore += 35;
      else if (rsi > 70) shortScore += 35;
      if (bb.pctB < 0.2) longScore += 25;
      else if (bb.pctB > 0.8) shortScore += 25;
      longScore += (Math.random() - 0.5) * 10;
      shortScore += (Math.random() - 0.5) * 10;
      break;

    case "GPT-4o": // Conservative, often neutral
      if (rsi < 25) longScore += 20;
      else if (rsi > 75) shortScore += 20;
      if (Math.abs(momentum) < 0.2) { /* stays neutral */ }
      else if (momentum > 0) longScore += 15;
      else shortScore += 15;
      longScore += (Math.random() - 0.5) * 15;
      shortScore += (Math.random() - 0.5) * 15;
      break;

    case "Gemini": // Volatility-based
      if (volatility > 1.5 && momentum > 0) longScore += 25;
      else if (volatility > 1.5 && momentum < 0) shortScore += 25;
      if (rsi < 40) longScore += 15;
      else if (rsi > 60) shortScore += 15;
      longScore += (Math.random() - 0.5) * 12;
      shortScore += (Math.random() - 0.5) * 12;
      break;

    case "Grok": // Contrarian
      if (rsi > 70) longScore += 10; // buys overbought (contrarian)
      else if (rsi < 30) shortScore += 10;
      if (momentum > 0.5) shortScore += 15; // fades momentum
      else if (momentum < -0.5) longScore += 15;
      longScore += (Math.random() - 0.5) * 18;
      shortScore += (Math.random() - 0.5) * 18;
      break;
  }

  const netScore = longScore - shortScore;
  const absScore = Math.abs(netScore);

  let direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  let confidence: number;

  if (absScore < 8) {
    direction = "NEUTRAL";
    confidence = 40 + Math.random() * 15;
  } else if (netScore > 0) {
    direction = "BULLISH";
    confidence = 50 + Math.min(absScore * 1.5, 40) + Math.random() * 5;
  } else {
    direction = "BEARISH";
    confidence = 50 + Math.min(absScore * 1.5, 40) + Math.random() * 5;
  }

  return { direction, confidence: Math.min(95, Math.max(35, confidence)) };
}

// ── Weighted consensus ──────────────────────────────────────

interface ConsensusResult {
  action: "OPEN_LONG" | "OPEN_SHORT" | "HOLD";
  confidence: number;
  strength: "STRONG" | "MEDIUM" | "WEAK" | "NONE";
  probabilities: [number, number, number]; // [short, neutral, long]
  sourceModels: string[];
  votes: ModelVote[];
  ragContext: string;
}

function buildConsensus(votes: ModelVote[]): ConsensusResult {
  let totalWeight = 0;
  let longWeight = 0;
  let shortWeight = 0;
  let neutralWeight = 0;
  let confidenceSum = 0;
  const contributing: string[] = [];

  for (const v of votes) {
    totalWeight += v.weight;
    confidenceSum += v.confidence * v.weight;

    if (v.direction === "BULLISH") {
      longWeight += v.weight * (v.confidence / 100);
      contributing.push(v.model);
    } else if (v.direction === "BEARISH") {
      shortWeight += v.weight * (v.confidence / 100);
      contributing.push(v.model);
    } else {
      neutralWeight += v.weight * (v.confidence / 100);
    }
  }

  const totalDirectional = longWeight + shortWeight + neutralWeight || 1;
  const pLong = longWeight / totalDirectional;
  const pShort = shortWeight / totalDirectional;
  const pNeutral = neutralWeight / totalDirectional;

  const weightedConfidence = totalWeight > 0 ? confidenceSum / totalWeight : 50;

  // Determine action
  let action: ConsensusResult["action"];
  let confidence: number;

  const longAdvantage = pLong - pShort;

  if (longAdvantage > 0.15 && pLong > 0.35) {
    action = "OPEN_LONG";
    confidence = weightedConfidence * (0.8 + longAdvantage * 0.4);
  } else if (longAdvantage < -0.15 && pShort > 0.35) {
    action = "OPEN_SHORT";
    confidence = weightedConfidence * (0.8 + Math.abs(longAdvantage) * 0.4);
  } else {
    action = "HOLD";
    confidence = weightedConfidence * 0.6;
  }

  confidence = Math.min(95, Math.max(30, confidence));

  let strength: ConsensusResult["strength"];
  if (confidence >= 78) strength = "STRONG";
  else if (confidence >= 63) strength = "MEDIUM";
  else if (confidence >= 48) strength = "WEAK";
  else strength = "NONE";

  // Build context string
  const votesSummary = votes.map(v =>
    `${v.model}:${v.direction}(${v.confidence.toFixed(0)}%,w=${v.weight.toFixed(2)})`
  ).join(", ");

  return {
    action,
    confidence: Math.round(confidence),
    strength,
    probabilities: [
      parseFloat(pShort.toFixed(3)),
      parseFloat(pNeutral.toFixed(3)),
      parseFloat(pLong.toFixed(3)),
    ],
    sourceModels: [...new Set(contributing)],
    votes,
    ragContext: `Consensus: ${votesSummary}`,
  };
}

// ── Main handler ────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const results = {
    signals_generated: 0,
    paper_trades_opened: 0,
    paper_trades_closed: 0,
    predictions_recorded: 0,
    prices: {} as Record<string, number>,
    model_weights: {} as Record<string, number>,
    errors: [] as string[],
  };

  try {
    // ── Step 1: Fetch prices ──────────────────────────────
    const prices = await fetchPrices();
    results.prices = prices;
    if (Object.keys(prices).length === 0) {
      return new Response(JSON.stringify({ error: "Failed to fetch prices" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Step 2: Load AI model weights from DB ─────────────
    const { data: accuracyData } = await supabase
      .from("ai_model_accuracy")
      .select("model, asset, accuracy_pct, computed_weight, total_predictions")
      .eq("period", "7d");

    // Build weight lookup: model → { weight, accuracy }
    const modelWeights: Record<string, Record<string, { weight: number; accuracy: number }>> = {};
    if (accuracyData) {
      for (const row of accuracyData) {
        if (!modelWeights[row.model]) modelWeights[row.model] = {};
        modelWeights[row.model][row.asset] = {
          weight: row.computed_weight || 0.5,
          accuracy: row.accuracy_pct || 50,
        };
      }
    }

    // ── Step 3: Check open paper trades for SL/TP ─────────
    const { data: openTrades } = await supabase
      .from("paper_trades").select("*").eq("status", "OPEN");

    if (openTrades && openTrades.length > 0) {
      for (const trade of openTrades) {
        const assetBase = trade.asset.split("-")[0];
        const currentPrice = prices[assetBase];
        if (!currentPrice) continue;

        let closeReason: string | null = null;
        if (trade.side === "LONG") {
          if (currentPrice <= trade.stop_loss) closeReason = "STOP_LOSS";
          else if (currentPrice >= trade.take_profit) closeReason = "TAKE_PROFIT";
        } else {
          if (currentPrice >= trade.stop_loss) closeReason = "STOP_LOSS";
          else if (currentPrice <= trade.take_profit) closeReason = "TAKE_PROFIT";
        }
        if (Date.now() - new Date(trade.opened_at).getTime() > 24 * 3600_000) closeReason = "TIME_LIMIT";

        if (closeReason) {
          const mul = trade.side === "LONG" ? 1 : -1;
          const pnl = trade.size * (currentPrice - trade.entry_price) * mul * trade.leverage;
          const pnlPct = ((currentPrice - trade.entry_price) / trade.entry_price) * 100 * mul;

          await supabase.from("paper_trades").update({
            status: "CLOSED", exit_price: currentPrice,
            pnl: parseFloat(pnl.toFixed(4)), pnl_pct: parseFloat(pnlPct.toFixed(4)),
            close_reason: closeReason, closed_at: new Date().toISOString(),
          }).eq("id", trade.id);

          if (trade.signal_id) {
            await supabase.from("trade_signals").update({
              status: "executed", result_pnl: parseFloat(pnl.toFixed(4)),
              close_reason: closeReason, resolved_at: new Date().toISOString(),
            }).eq("id", trade.signal_id);
          }
          results.paper_trades_closed++;
        }
      }
    }

    // ── Step 4: Generate AI-weighted signals ──────────────
    const assetsToAnalyze = [...ASSETS]
      .sort(() => Math.random() - 0.5)
      .slice(0, 1 + Math.floor(Math.random() * 2));

    const openCount = openTrades?.filter(t => t.status === "OPEN").length ?? 0;
    const maxConcurrent = 3;

    for (const asset of assetsToAnalyze) {
      if (!prices[asset]) continue;
      const candles = await fetchCandles(asset, 30);
      if (candles.length < 15) continue;

      const currentPrice = prices[asset];
      const rsi = calcRSI(candles);
      const momentum = calcMomentum(candles);
      const macd = calcMACD(candles);
      const bb = calcBollingerBands(candles);
      const volatility = calcVolatility(candles);

      // Each AI model votes with its DB-calibrated weight
      const votes: ModelVote[] = [];
      for (const model of AI_MODELS) {
        const vote = simulateModelVote(model.name, rsi, momentum, macd, bb, volatility);
        const dbData = modelWeights[model.name]?.[asset];
        const weight = dbData?.weight ?? model.defaultWeight;

        votes.push({
          model: model.name,
          direction: vote.direction,
          confidence: vote.confidence,
          weight,
        });

        results.model_weights[`${model.name}:${asset}`] = weight;
      }

      // Build weighted consensus
      const consensus = buildConsensus(votes);

      // Enrich context
      const techContext = `RSI=${rsi.toFixed(1)}, Mom=${momentum.toFixed(2)}%, MACD=${macd.histogram.toFixed(4)}, BB%B=${bb.pctB.toFixed(2)}, Vol=${volatility.toFixed(2)}%`;
      const fullContext = `${techContext} | ${consensus.ragContext}`;

      // Insert signal
      const signalId = crypto.randomUUID();
      const direction = consensus.action === "OPEN_LONG" ? "LONG" : consensus.action === "OPEN_SHORT" ? "SHORT" : "NEUTRAL";

      const { error: sigErr } = await supabase.from("trade_signals").insert({
        id: signalId, asset, action: consensus.action, direction,
        probabilities: consensus.probabilities, confidence: consensus.confidence,
        stop_loss_pct: Math.max(0.01, Math.min(0.05, volatility * 0.015)),
        take_profit_pct: Math.max(0.015, Math.min(0.08, volatility * 0.025)),
        leverage: Math.min(5, Math.max(1, Math.round(consensus.confidence / 25))),
        position_size_pct: parseFloat((0.2 + (consensus.confidence / 100) * 0.3).toFixed(2)),
        strategy_type: volatility > 1.5 ? "directional" : volatility < 0.5 ? "grid" : "dca",
        strength: consensus.strength,
        source_models: consensus.sourceModels,
        rag_context: fullContext,
        status: "active",
        created_at: new Date().toISOString(),
      });

      if (sigErr) { results.errors.push(`Signal: ${sigErr.message}`); continue; }
      results.signals_generated++;

      // Broadcast realtime
      await supabase.channel("trade-signals").send({
        type: "broadcast", event: "new_signal",
        payload: {
          id: signalId, asset, action: consensus.action,
          confidence: consensus.confidence, strength: consensus.strength,
          strategy_type: volatility > 1.5 ? "directional" : "dca",
          leverage: Math.min(5, Math.max(1, Math.round(consensus.confidence / 25))),
          source_models: consensus.sourceModels,
          status: "active", created_at: new Date().toISOString(),
        },
      }).catch(() => {});

      // ── Step 5: Record predictions for multiple timeframes ──
      for (const { tf, expiresMin } of PREDICTION_TIMEFRAMES) {
        const expiresAt = new Date(Date.now() + expiresMin * 60_000).toISOString();
        // Scale volatility expectation by timeframe
        const tfScale = tf === "5m" ? 0.15 : tf === "15m" ? 0.3 : 0.5;

        for (const vote of votes) {
          const targetMul = vote.direction === "BULLISH" ? 1 : vote.direction === "BEARISH" ? -1 : 0;
          const targetChangePct = targetMul * (vote.confidence / 100) * volatility * tfScale;
          const targetPrice = currentPrice * (1 + targetChangePct / 100);

          const { error: predErr } = await supabase.from("ai_prediction_records").insert({
            asset, timeframe: tf, model: vote.model,
            prediction: vote.direction, confidence: Math.round(vote.confidence),
            current_price: currentPrice,
            target_price: parseFloat(targetPrice.toFixed(2)),
            status: "pending",
            expires_at: expiresAt,
            created_at: new Date().toISOString(),
          });
          if (predErr) results.errors.push(`Pred ${vote.model}/${tf}: ${predErr.message}`);
          results.predictions_recorded++;
        }
      }

      // ── Step 6: Open paper trade for strong signals ───────
      if (
        (consensus.strength === "STRONG" || consensus.strength === "MEDIUM") &&
        consensus.action !== "HOLD" &&
        openCount + results.paper_trades_opened < maxConcurrent
      ) {
        const slPct = Math.max(0.01, Math.min(0.05, volatility * 0.015));
        const tpPct = Math.max(0.015, Math.min(0.08, volatility * 0.025));
        const positionSizeUsd = 1000 * (0.2 + (consensus.confidence / 100) * 0.3);
        const size = positionSizeUsd / currentPrice;
        const leverage = Math.min(5, Math.max(1, Math.round(consensus.confidence / 25)));

        const stopLoss = consensus.action === "OPEN_LONG"
          ? currentPrice * (1 - slPct) : currentPrice * (1 + slPct);
        const takeProfit = consensus.action === "OPEN_LONG"
          ? currentPrice * (1 + tpPct) : currentPrice * (1 - tpPct);

        const { error: tradeErr } = await supabase.from("paper_trades").insert({
          signal_id: signalId,
          asset, side: consensus.action === "OPEN_LONG" ? "LONG" : "SHORT",
          entry_price: currentPrice, size: parseFloat(size.toFixed(8)),
          leverage, stop_loss: parseFloat(stopLoss.toFixed(2)),
          take_profit: parseFloat(takeProfit.toFixed(2)),
          status: "OPEN", opened_at: new Date().toISOString(),
        });

        if (tradeErr) {
          results.errors.push(`Trade: ${tradeErr.message}`);
        } else {
          results.paper_trades_opened++;
          await supabase.from("trade_signals").update({ status: "executed" }).eq("id", signalId);
        }
      }
    }
  } catch (err) {
    results.errors.push(`Unexpected: ${err.message}`);
  }

  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
