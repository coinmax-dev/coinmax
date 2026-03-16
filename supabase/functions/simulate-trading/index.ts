import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * Simulate Trading — Multi-Strategy AI Paper Trading
 *
 * Runs every 5 minutes to:
 * 1. Fetch real-time prices + multi-timeframe candle data from Binance
 * 2. Load AI model accuracy weights
 * 3. Evaluate 6 independent strategies per asset
 * 4. Each strategy that triggers opens a $1000 position
 * 5. Record predictions for all timeframes
 * 6. Check existing positions for SL/TP/trailing stop/time limit
 *
 * Strategies: trend_following, mean_reversion, breakout, scalping, momentum, swing
 * Max 15 concurrent positions across all assets/strategies
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ASSETS = ["BTC", "ETH", "SOL", "BNB"];
const POSITION_SIZE_USD = 1000;
const MAX_OPEN_POSITIONS = 15;

const AI_MODELS = [
  { name: "GPT-4o",    defaultWeight: 0.5 },
  { name: "DeepSeek",  defaultWeight: 0.8 },
  { name: "Llama 3.1", defaultWeight: 0.6 },
  { name: "Gemini",    defaultWeight: 0.4 },
  { name: "Grok",      defaultWeight: 0.4 },
];

const PREDICTION_TIMEFRAMES = [
  { tf: "5m",  interval: "1m",  expiresMin: 5,    candleLimit: 20 },
  { tf: "15m", interval: "5m",  expiresMin: 15,   candleLimit: 20 },
  { tf: "30m", interval: "5m",  expiresMin: 30,   candleLimit: 30 },
  { tf: "1H",  interval: "15m", expiresMin: 60,   candleLimit: 30 },
  { tf: "4H",  interval: "1h",  expiresMin: 240,  candleLimit: 30 },
];

// ── Price & candle fetching ─────────────────────────────────

async function fetchPrices(): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  await Promise.all(
    ASSETS.map(async (asset) => {
      try {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${asset}USDT`);
        if (res.ok) { const d = await res.json(); const p = parseFloat(d.price); if (p > 0) prices[asset] = p; }
      } catch {}
    })
  );
  return prices;
}

interface Candle { open: number; high: number; low: number; close: number; volume: number; }

async function fetchCandles(asset: string, interval: string, limit: number): Promise<Candle[]> {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${asset}USDT&interval=${interval}&limit=${limit}`);
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
    const ch = candles[i].close - candles[i - 1].close;
    if (ch > 0) gains += ch; else losses += Math.abs(ch);
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + (gains / period) / (losses / period));
}

function calcEMA(candles: Candle[], period: number): number {
  if (candles.length < period) return candles[candles.length - 1]?.close ?? 0;
  const k = 2 / (period + 1);
  let ema = candles[0].close;
  for (let i = 1; i < candles.length; i++) ema = candles[i].close * k + ema * (1 - k);
  return ema;
}

function calcSMA(candles: Candle[], period: number): number {
  const slice = candles.slice(-period);
  if (slice.length === 0) return 0;
  return slice.reduce((s, c) => s + c.close, 0) / slice.length;
}

function calcMACD(candles: Candle[]) {
  const ema12 = calcEMA(candles, 12);
  const ema26 = calcEMA(candles, 26);
  const macd = ema12 - ema26;
  return { macd, signal: macd * 0.8, histogram: macd - macd * 0.8 };
}

function calcMomentum(candles: Candle[], lookback = 5): number {
  if (candles.length < lookback) return 0;
  const r = candles.slice(-lookback);
  return ((r[lookback - 1].close - r[0].close) / r[0].close) * 100;
}

function calcVolatility(candles: Candle[]): number {
  if (candles.length < 10) return 1;
  const ret: number[] = [];
  for (let i = 1; i < candles.length; i++) ret.push(Math.abs((candles[i].close - candles[i - 1].close) / candles[i - 1].close));
  return ret.reduce((s, v) => s + v, 0) / ret.length * 100;
}

function calcBB(candles: Candle[], period = 20) {
  const closes = candles.slice(-period).map(c => c.close);
  if (closes.length < period) return { upper: 0, lower: 0, mid: 0, pctB: 0.5, width: 0 };
  const mean = closes.reduce((s, v) => s + v, 0) / closes.length;
  const std = Math.sqrt(closes.reduce((s, v) => s + (v - mean) ** 2, 0) / closes.length);
  const upper = mean + 2 * std, lower = mean - 2 * std;
  const width = mean > 0 ? (upper - lower) / mean * 100 : 0;
  return { upper, lower, mid: mean, pctB: std > 0 ? (closes[closes.length - 1] - lower) / (upper - lower) : 0.5, width };
}

function calcATR(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  let atr = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const tr = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
    atr += tr;
  }
  return atr / period;
}

function calcVolumeRatio(candles: Candle[], period = 10): number {
  if (candles.length < period + 1) return 1;
  const avgVol = candles.slice(-period - 1, -1).reduce((s, c) => s + c.volume, 0) / period;
  return avgVol > 0 ? candles[candles.length - 1].volume / avgVol : 1;
}

function calcADX(candles: Candle[], period = 14): number {
  if (candles.length < period * 2) return 25;
  let pdm = 0, ndm = 0, tr = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const dn = candles[i - 1].low - candles[i].low;
    pdm += (up > dn && up > 0) ? up : 0;
    ndm += (dn > up && dn > 0) ? dn : 0;
    tr += Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
  }
  if (tr === 0) return 25;
  const pdi = (pdm / tr) * 100, ndi = (ndm / tr) * 100;
  const dx = Math.abs(pdi - ndi) / (pdi + ndi || 1) * 100;
  return dx;
}

// ── Multi-timeframe data ────────────────────────────────────

interface TechIndicators {
  rsi: number;
  mom: number;
  mom10: number;
  macd: { macd: number; signal: number; histogram: number };
  bb: { upper: number; lower: number; mid: number; pctB: number; width: number };
  vol: number;
  atr: number;
  volRatio: number;
  adx: number;
  ema9: number;
  ema21: number;
  sma50: number;
  price: number;
}

function computeIndicators(candles: Candle[], price: number): TechIndicators {
  return {
    rsi: calcRSI(candles),
    mom: calcMomentum(candles, 5),
    mom10: calcMomentum(candles, 10),
    macd: calcMACD(candles),
    bb: calcBB(candles),
    vol: calcVolatility(candles),
    atr: calcATR(candles),
    volRatio: calcVolumeRatio(candles),
    adx: calcADX(candles),
    ema9: calcEMA(candles, 9),
    ema21: calcEMA(candles, 21),
    sma50: calcSMA(candles, Math.min(50, candles.length)),
    price,
  };
}

// ── Strategy Definitions ────────────────────────────────────

interface StrategySignal {
  strategy: string;
  side: "LONG" | "SHORT";
  confidence: number;
  leverage: number;
  slPct: number;
  tpPct: number;
  timeLimit: number; // hours
  reason: string;
}

// 1. Trend Following: EMA crossover + ADX trend strength + MACD confirmation
function strategyTrendFollowing(ind: TechIndicators): StrategySignal | null {
  const { ema9, ema21, sma50, price, adx, macd, mom, vol } = ind;
  if (adx < 20) return null; // No clear trend

  const emaBullish = ema9 > ema21 && price > sma50;
  const emaBearish = ema9 < ema21 && price < sma50;
  const macdConfirm = macd.histogram > 0;
  const macdBearConfirm = macd.histogram < 0;

  if (emaBullish && macdConfirm && mom > 0.1) {
    const conf = Math.min(90, 55 + adx * 0.5 + Math.abs(mom) * 3);
    return {
      strategy: "trend_following", side: "LONG", confidence: conf,
      leverage: conf > 75 ? 3 : 2,
      slPct: Math.max(0.015, vol * 0.02),
      tpPct: Math.max(0.03, vol * 0.04),
      timeLimit: 12,
      reason: `EMA9>21, 价格>SMA50, ADX=${adx.toFixed(0)}, MACD+`,
    };
  }
  if (emaBearish && macdBearConfirm && mom < -0.1) {
    const conf = Math.min(90, 55 + adx * 0.5 + Math.abs(mom) * 3);
    return {
      strategy: "trend_following", side: "SHORT", confidence: conf,
      leverage: conf > 75 ? 3 : 2,
      slPct: Math.max(0.015, vol * 0.02),
      tpPct: Math.max(0.03, vol * 0.04),
      timeLimit: 12,
      reason: `EMA9<21, 价格<SMA50, ADX=${adx.toFixed(0)}, MACD-`,
    };
  }
  return null;
}

// 2. Mean Reversion: RSI extreme + BB band touch + volume confirmation
function strategyMeanReversion(ind: TechIndicators): StrategySignal | null {
  const { rsi, bb, volRatio, vol } = ind;

  if (rsi < 25 && bb.pctB < 0.1 && volRatio > 1.2) {
    const conf = Math.min(88, 60 + (30 - rsi) * 1.5 + (1 - bb.pctB) * 10);
    return {
      strategy: "mean_reversion", side: "LONG", confidence: conf,
      leverage: 2,
      slPct: Math.max(0.02, vol * 0.025),
      tpPct: Math.max(0.02, vol * 0.02), // Smaller TP, mean reversion
      timeLimit: 6,
      reason: `RSI=${rsi.toFixed(0)}超卖, BB%B=${bb.pctB.toFixed(2)}, 放量${volRatio.toFixed(1)}x`,
    };
  }
  if (rsi > 75 && bb.pctB > 0.9 && volRatio > 1.2) {
    const conf = Math.min(88, 60 + (rsi - 70) * 1.5 + bb.pctB * 10);
    return {
      strategy: "mean_reversion", side: "SHORT", confidence: conf,
      leverage: 2,
      slPct: Math.max(0.02, vol * 0.025),
      tpPct: Math.max(0.02, vol * 0.02),
      timeLimit: 6,
      reason: `RSI=${rsi.toFixed(0)}超买, BB%B=${bb.pctB.toFixed(2)}, 放量${volRatio.toFixed(1)}x`,
    };
  }
  return null;
}

// 3. Breakout: Price breaks BB bands + high volume + ADX rising
function strategyBreakout(ind: TechIndicators): StrategySignal | null {
  const { price, bb, volRatio, adx, mom, vol } = ind;
  if (volRatio < 1.5 || adx < 22) return null; // Need volume spike + some trend

  if (price > bb.upper && mom > 0.3) {
    const conf = Math.min(85, 55 + volRatio * 5 + adx * 0.3);
    return {
      strategy: "breakout", side: "LONG", confidence: conf,
      leverage: Math.min(4, Math.round(conf / 25)),
      slPct: Math.max(0.01, vol * 0.012),
      tpPct: Math.max(0.025, vol * 0.035),
      timeLimit: 8,
      reason: `突破BB上轨, 量比${volRatio.toFixed(1)}x, ADX=${adx.toFixed(0)}`,
    };
  }
  if (price < bb.lower && mom < -0.3) {
    const conf = Math.min(85, 55 + volRatio * 5 + adx * 0.3);
    return {
      strategy: "breakout", side: "SHORT", confidence: conf,
      leverage: Math.min(4, Math.round(conf / 25)),
      slPct: Math.max(0.01, vol * 0.012),
      tpPct: Math.max(0.025, vol * 0.035),
      timeLimit: 8,
      reason: `跌破BB下轨, 量比${volRatio.toFixed(1)}x, ADX=${adx.toFixed(0)}`,
    };
  }
  return null;
}

// 4. Scalping: Short-term RSI + MACD crossover + tight SL/TP
function strategyScalping(ind: TechIndicators): StrategySignal | null {
  const { rsi, macd, mom, vol, volRatio } = ind;
  if (vol < 0.2) return null; // Too flat

  // Quick RSI bounce from 35-40 zone with MACD turning positive
  if (rsi > 35 && rsi < 45 && macd.histogram > 0 && mom > 0.05 && volRatio > 0.8) {
    const conf = Math.min(78, 50 + (45 - rsi) * 1.5 + macd.histogram * 500);
    if (conf < 55) return null;
    return {
      strategy: "scalping", side: "LONG", confidence: conf,
      leverage: Math.min(5, Math.round(conf / 20)),
      slPct: Math.max(0.005, vol * 0.008),
      tpPct: Math.max(0.008, vol * 0.012),
      timeLimit: 2,
      reason: `RSI反弹=${rsi.toFixed(0)}, MACD柱转正, 短线做多`,
    };
  }
  // RSI dropping from 55-65 zone with MACD turning negative
  if (rsi > 55 && rsi < 65 && macd.histogram < 0 && mom < -0.05 && volRatio > 0.8) {
    const conf = Math.min(78, 50 + (rsi - 55) * 1.5 + Math.abs(macd.histogram) * 500);
    if (conf < 55) return null;
    return {
      strategy: "scalping", side: "SHORT", confidence: conf,
      leverage: Math.min(5, Math.round(conf / 20)),
      slPct: Math.max(0.005, vol * 0.008),
      tpPct: Math.max(0.008, vol * 0.012),
      timeLimit: 2,
      reason: `RSI回落=${rsi.toFixed(0)}, MACD柱转负, 短线做空`,
    };
  }
  return null;
}

// 5. Momentum: Strong directional move + volume surge + all indicators aligned
function strategyMomentum(ind: TechIndicators): StrategySignal | null {
  const { rsi, mom, mom10, macd, volRatio, adx, ema9, ema21, vol } = ind;
  if (adx < 25 || volRatio < 1.3) return null; // Need strong trend + volume

  const allBullish = mom > 0.4 && mom10 > 0.6 && rsi > 55 && rsi < 80 && macd.histogram > 0 && ema9 > ema21;
  const allBearish = mom < -0.4 && mom10 < -0.6 && rsi < 45 && rsi > 20 && macd.histogram < 0 && ema9 < ema21;

  if (allBullish) {
    const conf = Math.min(92, 60 + adx * 0.4 + volRatio * 3 + Math.abs(mom) * 5);
    return {
      strategy: "momentum", side: "LONG", confidence: conf,
      leverage: Math.min(4, Math.round(conf / 25)),
      slPct: Math.max(0.012, vol * 0.015),
      tpPct: Math.max(0.025, vol * 0.04),
      timeLimit: 8,
      reason: `强势多头: Mom=${mom.toFixed(2)}%, ADX=${adx.toFixed(0)}, 量比${volRatio.toFixed(1)}x`,
    };
  }
  if (allBearish) {
    const conf = Math.min(92, 60 + adx * 0.4 + volRatio * 3 + Math.abs(mom) * 5);
    return {
      strategy: "momentum", side: "SHORT", confidence: conf,
      leverage: Math.min(4, Math.round(conf / 25)),
      slPct: Math.max(0.012, vol * 0.015),
      tpPct: Math.max(0.025, vol * 0.04),
      timeLimit: 8,
      reason: `强势空头: Mom=${mom.toFixed(2)}%, ADX=${adx.toFixed(0)}, 量比${volRatio.toFixed(1)}x`,
    };
  }
  return null;
}

// 6. Swing: Multi-timeframe EMA alignment + BB mid retest
function strategySwing(ind: TechIndicators, ind1h: TechIndicators | null): StrategySignal | null {
  const { rsi, bb, ema9, ema21, price, mom, vol } = ind;
  if (!ind1h) return null;

  // 1h trend up + 5m price pulling back to BB mid = swing long entry
  const htfBullish = ind1h.ema9 > ind1h.ema21 && ind1h.mom > 0;
  const htfBearish = ind1h.ema9 < ind1h.ema21 && ind1h.mom < 0;

  if (htfBullish && bb.pctB > 0.3 && bb.pctB < 0.55 && rsi > 40 && rsi < 55 && mom > 0) {
    const conf = Math.min(85, 55 + (ind1h.adx || 25) * 0.3 + Math.abs(ind1h.mom) * 3);
    return {
      strategy: "swing", side: "LONG", confidence: conf,
      leverage: 2,
      slPct: Math.max(0.02, vol * 0.025),
      tpPct: Math.max(0.04, vol * 0.05),
      timeLimit: 24,
      reason: `1H趋势多+5M回踩BB中轨, RSI=${rsi.toFixed(0)}`,
    };
  }
  if (htfBearish && bb.pctB > 0.45 && bb.pctB < 0.7 && rsi > 45 && rsi < 60 && mom < 0) {
    const conf = Math.min(85, 55 + (ind1h.adx || 25) * 0.3 + Math.abs(ind1h.mom) * 3);
    return {
      strategy: "swing", side: "SHORT", confidence: conf,
      leverage: 2,
      slPct: Math.max(0.02, vol * 0.025),
      tpPct: Math.max(0.04, vol * 0.05),
      timeLimit: 24,
      reason: `1H趋势空+5M反弹BB中轨, RSI=${rsi.toFixed(0)}`,
    };
  }
  return null;
}

// ── Model vote simulation (kept for predictions) ────────────

interface ModelVote { model: string; direction: "BULLISH" | "BEARISH" | "NEUTRAL"; confidence: number; weight: number; }

function simulateModelVote(name: string, rsi: number, mom: number, macd: { histogram: number }, bb: { pctB: number }, vol: number): { direction: "BULLISH" | "BEARISH" | "NEUTRAL"; confidence: number } {
  let ls = 0, ss = 0;
  const n1 = (Math.random() - 0.5) * 8, n2 = (Math.random() - 0.5) * 8;

  switch (name) {
    case "DeepSeek":
      if (rsi < 35) ls += 30; else if (rsi > 65) ss += 30;
      if (mom > 0.3) ls += 25; else if (mom < -0.3) ss += 25;
      if (macd.histogram > 0) ls += 20; else ss += 20;
      ls += n1; ss += n2; break;
    case "Llama 3.1":
      if (rsi < 30) ls += 35; else if (rsi > 70) ss += 35;
      if (bb.pctB < 0.2) ls += 25; else if (bb.pctB > 0.8) ss += 25;
      ls += n1 * 1.2; ss += n2 * 1.2; break;
    case "GPT-4o":
      if (rsi < 25) ls += 20; else if (rsi > 75) ss += 20;
      if (mom > 0.3) ls += 15; else if (mom < -0.3) ss += 15;
      ls += n1 * 1.5; ss += n2 * 1.5; break;
    case "Gemini":
      if (vol > 1.5 && mom > 0) ls += 25; else if (vol > 1.5 && mom < 0) ss += 25;
      if (rsi < 40) ls += 15; else if (rsi > 60) ss += 15;
      ls += n1 * 1.3; ss += n2 * 1.3; break;
    case "Grok":
      if (rsi > 70) ls += 10; else if (rsi < 30) ss += 10;
      if (mom > 0.5) ss += 15; else if (mom < -0.5) ls += 15;
      ls += n1 * 1.8; ss += n2 * 1.8; break;
  }

  const net = ls - ss, abs = Math.abs(net);
  if (abs < 8) return { direction: "NEUTRAL", confidence: Math.min(55, 40 + Math.random() * 15) };
  if (net > 0) return { direction: "BULLISH", confidence: Math.min(95, 50 + abs * 1.5 + Math.random() * 5) };
  return { direction: "BEARISH", confidence: Math.min(95, 50 + abs * 1.5 + Math.random() * 5) };
}

// ── Consensus (kept for signals + predictions) ──────────────

function buildConsensus(votes: ModelVote[]) {
  let tw = 0, lw = 0, sw = 0, nw = 0, cs = 0;
  const src: string[] = [];
  for (const v of votes) {
    tw += v.weight; cs += v.confidence * v.weight;
    if (v.direction === "BULLISH") { lw += v.weight * (v.confidence / 100); src.push(v.model); }
    else if (v.direction === "BEARISH") { sw += v.weight * (v.confidence / 100); src.push(v.model); }
    else nw += v.weight * (v.confidence / 100);
  }
  const td = lw + sw + nw || 1;
  const pL = lw / td, pS = sw / td, pN = nw / td;
  const wc = tw > 0 ? cs / tw : 50;
  const adv = pL - pS;
  let action: "OPEN_LONG" | "OPEN_SHORT" | "HOLD", conf: number;
  if (adv > 0.15 && pL > 0.35) { action = "OPEN_LONG"; conf = wc * (0.8 + adv * 0.4); }
  else if (adv < -0.15 && pS > 0.35) { action = "OPEN_SHORT"; conf = wc * (0.8 + Math.abs(adv) * 0.4); }
  else { action = "HOLD"; conf = wc * 0.6; }
  conf = Math.min(95, Math.max(30, conf));
  const strength = conf >= 78 ? "STRONG" : conf >= 63 ? "MEDIUM" : conf >= 48 ? "WEAK" : "NONE";
  return { action, confidence: Math.round(conf), strength, probabilities: [parseFloat(pS.toFixed(3)), parseFloat(pN.toFixed(3)), parseFloat(pL.toFixed(3))] as [number, number, number], sourceModels: [...new Set(src)], votes };
}

// ── Main ────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const results = {
    signals_generated: 0, paper_trades_opened: 0, paper_trades_closed: 0,
    predictions_recorded: 0, strategies_evaluated: 0,
    prices: {} as Record<string, number>, errors: [] as string[],
  };

  try {
    const prices = await fetchPrices();
    results.prices = prices;
    if (Object.keys(prices).length === 0) return new Response(JSON.stringify({ error: "No prices" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Load model weights
    const { data: accData } = await supabase.from("ai_model_accuracy").select("model, asset, accuracy_pct, computed_weight").eq("period", "7d");
    const mw: Record<string, Record<string, { weight: number }>> = {};
    if (accData) for (const r of accData) { if (!mw[r.model]) mw[r.model] = {}; mw[r.model][r.asset] = { weight: r.computed_weight || 0.5 }; }

    // Check & close open paper trades
    const { data: openTrades } = await supabase.from("paper_trades").select("*").eq("status", "OPEN");
    if (openTrades) {
      for (const t of openTrades) {
        const cp = prices[t.asset];
        if (!cp) continue;

        // Determine time limit based on strategy
        const stratTimeLimit = t.strategy_type === "scalping" ? 2 : t.strategy_type === "mean_reversion" ? 6 : t.strategy_type === "breakout" ? 8 : t.strategy_type === "swing" ? 24 : 12;
        const timeLimitMs = stratTimeLimit * 3600_000;

        let cr: string | null = null;
        if (t.side === "LONG") {
          if (cp <= t.stop_loss) cr = "STOP_LOSS";
          else if (cp >= t.take_profit) cr = "TAKE_PROFIT";
        } else {
          if (cp >= t.stop_loss) cr = "STOP_LOSS";
          else if (cp <= t.take_profit) cr = "TAKE_PROFIT";
        }
        if (!cr && Date.now() - new Date(t.opened_at).getTime() > timeLimitMs) cr = "TIME_LIMIT";

        // Trailing stop: if in profit > 50% of TP distance, tighten SL to breakeven
        if (!cr && t.side === "LONG" && cp > t.entry_price) {
          const tpDist = t.take_profit - t.entry_price;
          const curProfit = cp - t.entry_price;
          if (curProfit > tpDist * 0.5 && t.stop_loss < t.entry_price) {
            // Move SL to breakeven + small buffer
            const newSl = t.entry_price * 1.001;
            await supabase.from("paper_trades").update({ stop_loss: parseFloat(newSl.toFixed(2)) }).eq("id", t.id);
          }
        } else if (!cr && t.side === "SHORT" && cp < t.entry_price) {
          const tpDist = t.entry_price - t.take_profit;
          const curProfit = t.entry_price - cp;
          if (curProfit > tpDist * 0.5 && t.stop_loss > t.entry_price) {
            const newSl = t.entry_price * 0.999;
            await supabase.from("paper_trades").update({ stop_loss: parseFloat(newSl.toFixed(2)) }).eq("id", t.id);
          }
        }

        if (cr) {
          const mul = t.side === "LONG" ? 1 : -1;
          const pnl = t.size * (cp - t.entry_price) * mul * t.leverage;
          const pnlPct = ((cp - t.entry_price) / t.entry_price) * 100 * mul;
          await supabase.from("paper_trades").update({
            status: "CLOSED", exit_price: cp,
            pnl: parseFloat(pnl.toFixed(4)), pnl_pct: parseFloat(pnlPct.toFixed(4)),
            close_reason: cr, closed_at: new Date().toISOString(),
          }).eq("id", t.id);
          if (t.signal_id) await supabase.from("trade_signals").update({ status: "executed", result_pnl: parseFloat(pnl.toFixed(4)), close_reason: cr, resolved_at: new Date().toISOString() }).eq("id", t.signal_id);
          results.paper_trades_closed++;
        }
      }
    }

    // Count remaining open positions
    let currentOpen = (openTrades?.filter(t => t.status === "OPEN").length ?? 0) - results.paper_trades_closed;

    // Build set of currently open asset+strategy combos to avoid duplicates
    const openCombos = new Set<string>();
    if (openTrades) {
      for (const t of openTrades) {
        if (t.status === "OPEN") openCombos.add(`${t.asset}_${t.strategy_type || "legacy"}`);
      }
    }

    // Process ALL assets
    for (const asset of ASSETS) {
      if (!prices[asset]) continue;
      const currentPrice = prices[asset];

      // Fetch multi-timeframe candles
      const [candles5m, candles15m, candles1h] = await Promise.all([
        fetchCandles(asset, "5m", 50),
        fetchCandles(asset, "15m", 40),
        fetchCandles(asset, "1h", 30),
      ]);

      if (candles5m.length < 20) continue;

      // Compute indicators for different timeframes
      const ind5m = computeIndicators(candles5m, currentPrice);
      const ind1h = candles1h.length >= 15 ? computeIndicators(candles1h, currentPrice) : null;

      // Model votes (for signal + predictions)
      const votes: ModelVote[] = AI_MODELS.map(m => {
        const v = simulateModelVote(m.name, ind5m.rsi, ind5m.mom, ind5m.macd, ind5m.bb, ind5m.vol);
        return { model: m.name, direction: v.direction, confidence: v.confidence, weight: mw[m.name]?.[asset]?.weight ?? m.defaultWeight };
      });

      const consensus = buildConsensus(votes);
      const signalId = crypto.randomUUID();
      const dir = consensus.action === "OPEN_LONG" ? "LONG" : consensus.action === "OPEN_SHORT" ? "SHORT" : "NEUTRAL";
      const techCtx = `RSI=${ind5m.rsi.toFixed(1)},Mom=${ind5m.mom.toFixed(2)}%,MACD=${ind5m.macd.histogram.toFixed(4)},BB=${ind5m.bb.pctB.toFixed(2)},Vol=${ind5m.vol.toFixed(2)}%,ADX=${ind5m.adx.toFixed(0)},VolR=${ind5m.volRatio.toFixed(1)}`;

      // Determine dominant strategy from evaluated signals
      const stratSignals: StrategySignal[] = [];
      const s1 = strategyTrendFollowing(ind5m);  if (s1) stratSignals.push(s1);
      const s2 = strategyMeanReversion(ind5m);    if (s2) stratSignals.push(s2);
      const s3 = strategyBreakout(ind5m);         if (s3) stratSignals.push(s3);
      const s4 = strategyScalping(ind5m);         if (s4) stratSignals.push(s4);
      const s5 = strategyMomentum(ind5m);         if (s5) stratSignals.push(s5);
      const s6 = strategySwing(ind5m, ind1h);     if (s6) stratSignals.push(s6);
      results.strategies_evaluated += 6;

      // Pick dominant strategy for the signal's strategy_type
      const dominantStrategy = stratSignals.length > 0
        ? stratSignals.sort((a, b) => b.confidence - a.confidence)[0].strategy
        : (ind5m.vol > 1.5 ? "directional" : ind5m.vol < 0.5 ? "grid" : "dca");

      // Insert trade signal
      const { error: sigErr } = await supabase.from("trade_signals").insert({
        id: signalId, asset, action: consensus.action, direction: dir,
        probabilities: consensus.probabilities, confidence: consensus.confidence,
        stop_loss_pct: Math.max(0.01, Math.min(0.05, ind5m.vol * 0.015)),
        take_profit_pct: Math.max(0.015, Math.min(0.08, ind5m.vol * 0.025)),
        leverage: Math.min(5, Math.max(1, Math.round(consensus.confidence / 25))),
        position_size_pct: parseFloat((0.2 + (consensus.confidence / 100) * 0.3).toFixed(2)),
        strategy_type: dominantStrategy,
        strength: consensus.strength, source_models: consensus.sourceModels,
        rag_context: techCtx, status: "active", created_at: new Date().toISOString(),
      });
      if (sigErr) { results.errors.push(`Signal ${asset}: ${sigErr.message}`); continue; }
      results.signals_generated++;

      // Broadcast
      await supabase.channel("trade-signals").send({
        type: "broadcast", event: "new_signal",
        payload: { id: signalId, asset, action: consensus.action, confidence: consensus.confidence, strength: consensus.strength, leverage: Math.min(5, Math.max(1, Math.round(consensus.confidence / 25))), source_models: consensus.sourceModels, strategy_type: dominantStrategy, status: "active", created_at: new Date().toISOString() },
      }).catch(() => {});

      // Record predictions for ALL timeframes
      for (const { tf, interval, expiresMin, candleLimit } of PREDICTION_TIMEFRAMES) {
        const tfCandles = await fetchCandles(asset, interval, candleLimit);
        const tfRsi = tfCandles.length >= 15 ? calcRSI(tfCandles) : ind5m.rsi;
        const tfMom = tfCandles.length >= 5 ? calcMomentum(tfCandles) : ind5m.mom;
        const tfVol = tfCandles.length >= 10 ? calcVolatility(tfCandles) : ind5m.vol;
        const tfScale = tf === "5m" ? 0.15 : tf === "15m" ? 0.25 : tf === "30m" ? 0.35 : tf === "1H" ? 0.5 : 0.8;
        const expiresAt = new Date(Date.now() + expiresMin * 60_000).toISOString();

        for (const vote of votes) {
          const tfVote = tfCandles.length >= 10
            ? simulateModelVote(vote.model, tfRsi, tfMom, ind5m.macd, ind5m.bb, tfVol)
            : { direction: vote.direction, confidence: vote.confidence };

          const tMul = tfVote.direction === "BULLISH" ? 1 : tfVote.direction === "BEARISH" ? -1 : 0;
          const tChg = tMul * (tfVote.confidence / 100) * tfVol * tfScale;
          const tPrice = currentPrice * (1 + tChg / 100);

          const { error: pErr } = await supabase.from("ai_prediction_records").insert({
            asset, timeframe: tf, model: vote.model,
            prediction: tfVote.direction, confidence: Math.round(tfVote.confidence),
            current_price: currentPrice, target_price: parseFloat(tPrice.toFixed(2)),
            status: "pending", expires_at: expiresAt, created_at: new Date().toISOString(),
          });
          if (pErr) results.errors.push(`Pred ${vote.model}/${tf}/${asset}: ${pErr.message}`);
          else results.predictions_recorded++;
        }
      }

      // ── Open paper trades: one $1000 position per triggered strategy ──
      for (const sig of stratSignals) {
        if (currentOpen + results.paper_trades_opened >= MAX_OPEN_POSITIONS) break;

        // Skip if already have an open position for this asset+strategy
        const comboKey = `${asset}_${sig.strategy}`;
        if (openCombos.has(comboKey)) continue;

        // Only open if confidence is high enough
        if (sig.confidence < 55) continue;

        const side = sig.side;
        const sl = side === "LONG"
          ? currentPrice * (1 - sig.slPct)
          : currentPrice * (1 + sig.slPct);
        const tp = side === "LONG"
          ? currentPrice * (1 + sig.tpPct)
          : currentPrice * (1 - sig.tpPct);
        const size = parseFloat((POSITION_SIZE_USD / currentPrice).toFixed(8));

        const tradeId = crypto.randomUUID();
        const { error: tErr } = await supabase.from("paper_trades").insert({
          id: tradeId, signal_id: signalId, asset, side,
          entry_price: currentPrice, size,
          leverage: sig.leverage,
          stop_loss: parseFloat(sl.toFixed(2)),
          take_profit: parseFloat(tp.toFixed(2)),
          strategy_type: sig.strategy,
          status: "OPEN", opened_at: new Date().toISOString(),
        });
        if (tErr) {
          results.errors.push(`Trade ${asset}/${sig.strategy}: ${tErr.message}`);
        } else {
          results.paper_trades_opened++;
          openCombos.add(comboKey);
        }
      }
    }
  } catch (err) { results.errors.push(`Unexpected: ${err.message}`); }

  return new Response(JSON.stringify(results), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
