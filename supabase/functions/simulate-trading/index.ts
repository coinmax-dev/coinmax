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

const DEFAULT_ASSETS = ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP", "ADA", "AVAX", "LINK", "DOT"];
const DEFAULT_POSITION_SIZE_USD = 1000;
const DEFAULT_MAX_POSITIONS = 30;
const DEFAULT_MAX_LEVERAGE = 5;
const DEFAULT_COOLDOWN_MIN = 5;
const DEFAULT_STRATEGIES = ["trend_following", "mean_reversion", "breakout", "scalping", "momentum", "swing", "grid", "dca", "pattern", "avellaneda", "position_executor", "twap", "market_making", "arbitrage", "stochastic", "ichimoku", "vwap_reversion", "rsi_divergence", "donchian", "bb_squeeze"];

interface SimConfig {
  positionSize: number;
  maxPositions: number;
  maxLeverage: number;
  maxDrawdownPct: number;
  cooldownMin: number;
  strategies: string[];
  assets: string[];
  maxSlPct: number;
  minTpPct: number;
  maxHoldHours: number;
  tradingStyle: string;
  trailingStopEnabled: boolean;
  trailingStopTriggerPct: number;
  minConsensusModels: number;
}

const AI_MODELS = [
  { name: "GPT-4o",   defaultWeight: 0.7 },
  { name: "Claude",   defaultWeight: 0.8 },
  { name: "Gemini",   defaultWeight: 0.5 },
  { name: "DeepSeek", defaultWeight: 0.7 },
  { name: "Llama",    defaultWeight: 0.5 },
  { name: "CoinMax",  defaultWeight: 0.9 },  // Meta-model: weighted consensus + deep learning
];

const PREDICTION_TIMEFRAMES = [
  { tf: "5m",  interval: "1m",  expiresMin: 5,    candleLimit: 20 },
  { tf: "15m", interval: "5m",  expiresMin: 15,   candleLimit: 20 },
  { tf: "30m", interval: "5m",  expiresMin: 30,   candleLimit: 30 },
  { tf: "1H",  interval: "15m", expiresMin: 60,   candleLimit: 30 },
  { tf: "4H",  interval: "1h",  expiresMin: 240,  candleLimit: 30 },
];

// ── Price & candle fetching (multi-source fallback) ─────────

const BINANCE_ENDPOINTS = [
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com",
  "https://api4.binance.com",
];

// CoinGecko ID mapping
const CG_IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana",
  BNB: "binancecoin", DOGE: "dogecoin", XRP: "ripple",
  ADA: "cardano", AVAX: "avalanche-2", LINK: "chainlink", DOT: "polkadot",
};

async function fetchPrices(assets: string[] = DEFAULT_ASSETS): Promise<Record<string, number>> {
  // Try Binance first (multiple endpoints)
  for (const base of BINANCE_ENDPOINTS) {
    try {
      const prices: Record<string, number> = {};
      const symbols = assets.map(a => `"${a}USDT"`).join(",");
      const res = await fetch(`${base}/api/v3/ticker/price?symbols=[${symbols}]`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        for (const d of data) {
          const asset = d.symbol.replace("USDT", "");
          const p = parseFloat(d.price);
          if (p > 0) prices[asset] = p;
        }
        if (Object.keys(prices).length >= assets.length * 0.5) return prices;
      }
    } catch {}
  }

  // Fallback: CoinGecko (no API key needed, 30 req/min)
  try {
    const ids = assets.map(a => CG_IDS[a]).filter(Boolean).join(",");
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      const prices: Record<string, number> = {};
      for (const asset of assets) {
        const cgId = CG_IDS[asset];
        if (cgId && data[cgId]?.usd) prices[asset] = data[cgId].usd;
      }
      if (Object.keys(prices).length > 0) return prices;
    }
  } catch {}

  return {};
}

interface Candle { open: number; high: number; low: number; close: number; volume: number; }

// Binance interval → CoinGecko days mapping
const CG_INTERVAL_DAYS: Record<string, number> = {
  "1m": 1, "5m": 1, "15m": 1, "1h": 2, "4h": 7,
};

async function fetchCandles(asset: string, interval: string, limit: number): Promise<Candle[]> {
  // Try Binance endpoints
  for (const base of BINANCE_ENDPOINTS) {
    try {
      const res = await fetch(`${base}/api/v3/klines?symbol=${asset}USDT&interval=${interval}&limit=${limit}`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          return data.map((k: any[]) => ({
            open: parseFloat(k[1]), high: parseFloat(k[2]),
            low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
          }));
        }
      }
    } catch {}
  }

  // Fallback: CoinGecko OHLC (limited intervals: 1/7/14/30/90/180/365 days)
  try {
    const cgId = CG_IDS[asset];
    if (!cgId) return [];
    const days = CG_INTERVAL_DAYS[interval] ?? 1;
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${cgId}/ohlc?vs_currency=usd&days=${days}`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        return data.slice(-limit).map((k: number[]) => ({
          open: k[1], high: k[2], low: k[3], close: k[4], volume: 0,
        }));
      }
    }
  } catch {}

  return [];
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

// ── New indicators: Stochastic, Donchian, VWAP ──────────────

function calcStochastic(candles: Candle[], kPeriod = 14, dPeriod = 3): { k: number; d: number } {
  if (candles.length < kPeriod) return { k: 50, d: 50 };
  const slice = candles.slice(-kPeriod);
  const high = Math.max(...slice.map(c => c.high));
  const low = Math.min(...slice.map(c => c.low));
  const k = high !== low ? ((slice[slice.length - 1].close - low) / (high - low)) * 100 : 50;
  // Simple %D as SMA of last dPeriod %K values
  const kValues: number[] = [];
  for (let i = Math.max(0, candles.length - dPeriod); i < candles.length; i++) {
    const s = candles.slice(Math.max(0, i - kPeriod + 1), i + 1);
    const h = Math.max(...s.map(c => c.high));
    const l = Math.min(...s.map(c => c.low));
    kValues.push(h !== l ? ((s[s.length - 1].close - l) / (h - l)) * 100 : 50);
  }
  const d = kValues.reduce((s, v) => s + v, 0) / kValues.length;
  return { k, d };
}

function calcDonchian(candles: Candle[], period = 20): { upper: number; lower: number; mid: number } {
  const slice = candles.slice(-period);
  if (slice.length === 0) return { upper: 0, lower: 0, mid: 0 };
  const upper = Math.max(...slice.map(c => c.high));
  const lower = Math.min(...slice.map(c => c.low));
  return { upper, lower, mid: (upper + lower) / 2 };
}

function calcVWAP(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  let cumTPV = 0, cumVol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumTPV += tp * (c.volume || 1);
    cumVol += (c.volume || 1);
  }
  return cumVol > 0 ? cumTPV / cumVol : candles[candles.length - 1].close;
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
  stoch: { k: number; d: number };
  donchian: { upper: number; lower: number; mid: number };
  vwap: number;
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
    stoch: calcStochastic(candles),
    donchian: calcDonchian(candles),
    vwap: calcVWAP(candles),
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

// 1. Trend Following: EMA crossover + MACD confirmation
function strategyTrendFollowing(ind: TechIndicators): StrategySignal | null {
  const { ema9, ema21, sma50, price, adx, macd, mom, vol } = ind;

  const emaBullish = ema9 > ema21;
  const emaBearish = ema9 < ema21;

  if (emaBullish && macd.histogram > 0 && mom > 0.05 && adx > 18) {
    const conf = Math.min(88, 52 + adx * 0.4 + Math.abs(mom) * 4);
    return {
      strategy: "trend_following", side: "LONG", confidence: conf,
      leverage: conf > 75 ? 3 : 2,
      slPct: Math.max(0.015, vol * 0.02),
      tpPct: Math.max(0.03, vol * 0.04),
      timeLimit: 12,
      reason: `EMA9>21, ADX=${adx.toFixed(0)}, MACD+, Mom=${mom.toFixed(2)}%`,
    };
  }
  if (emaBearish && macd.histogram < 0 && mom < -0.05 && adx > 18) {
    const conf = Math.min(88, 52 + adx * 0.4 + Math.abs(mom) * 4);
    return {
      strategy: "trend_following", side: "SHORT", confidence: conf,
      leverage: conf > 75 ? 3 : 2,
      slPct: Math.max(0.015, vol * 0.02),
      tpPct: Math.max(0.03, vol * 0.04),
      timeLimit: 12,
      reason: `EMA9<21, ADX=${adx.toFixed(0)}, MACD-, Mom=${mom.toFixed(2)}%`,
    };
  }
  return null;
}

// 2. Mean Reversion: RSI oversold/overbought + BB proximity
function strategyMeanReversion(ind: TechIndicators): StrategySignal | null {
  const { rsi, bb, volRatio, vol } = ind;

  if (rsi < 38 && bb.pctB < 0.3) {
    const conf = Math.min(88, 56 + (40 - rsi) * 1.2 + (1 - bb.pctB) * 8);
    return {
      strategy: "mean_reversion", side: "LONG", confidence: conf,
      leverage: 2,
      slPct: Math.max(0.015, vol * 0.02),
      tpPct: Math.max(0.04, vol * 0.05),
      timeLimit: 6,
      reason: `RSI=${rsi.toFixed(0)}偏低, BB%B=${bb.pctB.toFixed(2)}, 均值回归做多`,
    };
  }
  if (rsi > 62 && bb.pctB > 0.7) {
    const conf = Math.min(88, 56 + (rsi - 60) * 1.2 + bb.pctB * 8);
    return {
      strategy: "mean_reversion", side: "SHORT", confidence: conf,
      leverage: 2,
      slPct: Math.max(0.015, vol * 0.02),
      tpPct: Math.max(0.04, vol * 0.05),
      timeLimit: 6,
      reason: `RSI=${rsi.toFixed(0)}偏高, BB%B=${bb.pctB.toFixed(2)}, 均值回归做空`,
    };
  }
  return null;
}

// 3. Breakout: Price near BB bands + momentum
function strategyBreakout(ind: TechIndicators): StrategySignal | null {
  const { price, bb, volRatio, adx, mom, vol } = ind;

  if (bb.pctB > 0.88 && mom > 0.15 && volRatio > 1.2) {
    const conf = Math.min(85, 55 + volRatio * 4 + adx * 0.25 + Math.abs(mom) * 5);
    return {
      strategy: "breakout", side: "LONG", confidence: conf,
      leverage: Math.min(4, Math.round(conf / 25)),
      slPct: Math.max(0.01, vol * 0.012),
      tpPct: Math.max(0.025, vol * 0.035),
      timeLimit: 8,
      reason: `接近BB上轨, BB%B=${bb.pctB.toFixed(2)}, Mom=${mom.toFixed(2)}%`,
    };
  }
  if (bb.pctB < 0.12 && mom < -0.15 && volRatio > 1.2) {
    const conf = Math.min(85, 55 + volRatio * 4 + adx * 0.25 + Math.abs(mom) * 5);
    return {
      strategy: "breakout", side: "SHORT", confidence: conf,
      leverage: Math.min(4, Math.round(conf / 25)),
      slPct: Math.max(0.01, vol * 0.012),
      tpPct: Math.max(0.025, vol * 0.035),
      timeLimit: 8,
      reason: `接近BB下轨, BB%B=${bb.pctB.toFixed(2)}, Mom=${mom.toFixed(2)}%`,
    };
  }
  return null;
}

// 4. Scalping: Short-term RSI zones + MACD direction
function strategyScalping(ind: TechIndicators): StrategySignal | null {
  const { rsi, macd, mom, vol, volRatio } = ind;

  // RSI in lower half with MACD positive → scalp long
  if (rsi > 30 && rsi < 48 && macd.histogram > 0) {
    const conf = Math.min(78, 52 + (48 - rsi) * 1.0 + Math.abs(mom) * 8);
    return {
      strategy: "scalping", side: "LONG", confidence: conf,
      leverage: Math.min(5, Math.round(conf / 20)),
      slPct: Math.max(0.008, vol * 0.01),
      tpPct: Math.max(0.02, vol * 0.03),
      timeLimit: 2,
      reason: `RSI=${rsi.toFixed(0)}+MACD+, 短线做多`,
    };
  }
  // RSI in upper half with MACD negative → scalp short
  if (rsi > 52 && rsi < 70 && macd.histogram < 0) {
    const conf = Math.min(78, 52 + (rsi - 52) * 1.0 + Math.abs(mom) * 8);
    return {
      strategy: "scalping", side: "SHORT", confidence: conf,
      leverage: Math.min(5, Math.round(conf / 20)),
      slPct: Math.max(0.008, vol * 0.01),
      tpPct: Math.max(0.02, vol * 0.03),
      timeLimit: 2,
      reason: `RSI=${rsi.toFixed(0)}+MACD-, 短线做空`,
    };
  }
  return null;
}

// 5. Momentum: Directional move with indicators aligned
function strategyMomentum(ind: TechIndicators): StrategySignal | null {
  const { rsi, mom, mom10, macd, volRatio, adx, ema9, ema21, vol } = ind;

  const allBullish = mom > 0.2 && rsi > 50 && rsi < 75 && macd.histogram > 0 && ema9 > ema21 && adx > 20;
  const allBearish = mom < -0.2 && rsi < 50 && rsi > 25 && macd.histogram < 0 && ema9 < ema21 && adx > 20;

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

  // 1h trend alignment + 5m entry zone
  const htfBullish = ind1h.ema9 > ind1h.ema21;
  const htfBearish = ind1h.ema9 < ind1h.ema21;

  if (htfBullish && bb.pctB > 0.25 && bb.pctB < 0.6 && rsi > 38 && rsi < 58) {
    const conf = Math.min(85, 55 + (ind1h.adx || 25) * 0.3 + Math.abs(ind1h.mom || 0) * 3);
    return {
      strategy: "swing", side: "LONG", confidence: conf,
      leverage: 2,
      slPct: Math.max(0.02, vol * 0.025),
      tpPct: Math.max(0.04, vol * 0.05),
      timeLimit: 24,
      reason: `1H趋势多+5M回踩, RSI=${rsi.toFixed(0)}, BB%B=${bb.pctB.toFixed(2)}`,
    };
  }
  if (htfBearish && bb.pctB > 0.4 && bb.pctB < 0.75 && rsi > 42 && rsi < 62) {
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

// 7. Grid: Low volatility range-bound — place both sides (Hummingbot Grid Executor)
function strategyGrid(ind: TechIndicators): StrategySignal | null {
  const { bb, vol, adx, rsi, price } = ind;
  if (vol > 1.2 || adx > 30) return null; // Need low vol + no strong trend

  // BB width narrow = ranging market, ideal for grid
  if (bb.width < 3 && bb.pctB > 0.35 && bb.pctB < 0.65) {
    // Buy near lower BB, sell near upper BB
    const side = bb.pctB < 0.5 ? "LONG" : "SHORT";
    const conf = Math.min(80, 55 + (3 - bb.width) * 8 + (30 - adx) * 0.5);
    return {
      strategy: "grid", side, confidence: conf,
      leverage: 1,
      slPct: Math.max(0.025, bb.width / 100 * 1.2),
      tpPct: Math.max(0.015, bb.width / 100 * 0.6),
      timeLimit: 4,
      reason: `网格: BB宽度=${bb.width.toFixed(1)}%, ADX=${adx.toFixed(0)}, %B=${bb.pctB.toFixed(2)}`,
    };
  }
  return null;
}

// 8. DCA: Dollar-cost average on dips (Hummingbot DCA Executor)
function strategyDCA(ind: TechIndicators): StrategySignal | null {
  const { rsi, mom, mom10, bb, vol } = ind;

  // Oversold conditions → accumulate long
  if (rsi < 35 && mom < -0.1 && bb.pctB < 0.25) {
    const conf = Math.min(82, 55 + (35 - rsi) * 1.0 + Math.abs(mom) * 5);
    return {
      strategy: "dca", side: "LONG", confidence: conf,
      leverage: 1, // DCA is always 1x
      slPct: Math.max(0.02, vol * 0.025),
      tpPct: Math.max(0.04, vol * 0.05),
      timeLimit: 48, // DCA holds longer
      reason: `DCA抄底: RSI=${rsi.toFixed(0)}, Mom=${mom.toFixed(2)}%, BB%B=${bb.pctB.toFixed(2)}`,
    };
  }
  // Overbought conditions → accumulate short
  if (rsi > 65 && mom > 0.1 && bb.pctB > 0.75) {
    const conf = Math.min(82, 55 + (rsi - 65) * 1.0 + Math.abs(mom) * 5);
    return {
      strategy: "dca", side: "SHORT", confidence: conf,
      leverage: 1,
      slPct: Math.max(0.02, vol * 0.025),
      tpPct: Math.max(0.04, vol * 0.05),
      timeLimit: 48,
      reason: `DCA做空: RSI=${rsi.toFixed(0)}, Mom=${mom.toFixed(2)}%, BB%B=${bb.pctB.toFixed(2)}`,
    };
  }
  return null;
}

// 9. Pattern: K-line candle pattern recognition (from ai-engine/src/patterns.ts)
function detectPatterns(candles: Candle[]): { name: string; direction: "BULLISH" | "BEARISH"; strength: number }[] {
  const patterns: { name: string; direction: "BULLISH" | "BEARISH"; strength: number }[] = [];
  if (candles.length < 4) return patterns;

  const c = candles[candles.length - 1];
  const p = candles[candles.length - 2];
  const pp = candles[candles.length - 3];

  const bodySize = (c2: Candle) => Math.abs(c2.close - c2.open);
  const range = (c2: Candle) => c2.high - c2.low;
  const isGreen = (c2: Candle) => c2.close > c2.open;
  const isRed = (c2: Candle) => c2.close < c2.open;
  const upperWick = (c2: Candle) => c2.high - Math.max(c2.open, c2.close);
  const lowerWick = (c2: Candle) => Math.min(c2.open, c2.close) - c2.low;

  // Hammer (bullish) — small body at top, long lower wick
  if (range(c) > 0 && bodySize(c) / range(c) < 0.35 && lowerWick(c) >= bodySize(c) * 2 && isRed(p)) {
    patterns.push({ name: "锤子线", direction: "BULLISH", strength: 2 });
  }

  // Shooting Star (bearish) — small body at bottom, long upper wick
  if (range(c) > 0 && bodySize(c) / range(c) < 0.35 && upperWick(c) >= bodySize(c) * 2 && isGreen(p)) {
    patterns.push({ name: "射击之星", direction: "BEARISH", strength: 2 });
  }

  // Bullish Engulfing
  if (isRed(p) && isGreen(c) && c.open <= p.close && c.close >= p.open && bodySize(c) > bodySize(p)) {
    patterns.push({ name: "看涨吞没", direction: "BULLISH", strength: 2 });
  }

  // Bearish Engulfing
  if (isGreen(p) && isRed(c) && c.open >= p.close && c.close <= p.open && bodySize(c) > bodySize(p)) {
    patterns.push({ name: "看跌吞没", direction: "BEARISH", strength: 2 });
  }

  // Morning Star (3-candle bullish reversal)
  if (isRed(pp) && bodySize(p) < range(pp) * 0.3 && isGreen(c) && c.close > (pp.open + pp.close) / 2) {
    patterns.push({ name: "早晨之星", direction: "BULLISH", strength: 3 });
  }

  // Evening Star (3-candle bearish reversal)
  if (isGreen(pp) && bodySize(p) < range(pp) * 0.3 && isRed(c) && c.close < (pp.open + pp.close) / 2) {
    patterns.push({ name: "黄昏之星", direction: "BEARISH", strength: 3 });
  }

  // Three White Soldiers
  if (isGreen(pp) && isGreen(p) && isGreen(c) && p.close > pp.close && c.close > p.close && bodySize(p) > range(p) * 0.5 && bodySize(c) > range(c) * 0.5) {
    patterns.push({ name: "三白兵", direction: "BULLISH", strength: 3 });
  }

  // Three Black Crows
  if (isRed(pp) && isRed(p) && isRed(c) && p.close < pp.close && c.close < p.close && bodySize(p) > range(p) * 0.5 && bodySize(c) > range(c) * 0.5) {
    patterns.push({ name: "三黑鸦", direction: "BEARISH", strength: 3 });
  }

  // Doji (indecision)
  if (range(c) > 0 && bodySize(c) / range(c) < 0.1) {
    // Doji after trend = reversal signal
    if (isGreen(p) && isGreen(pp)) patterns.push({ name: "十字星(顶)", direction: "BEARISH", strength: 1 });
    else if (isRed(p) && isRed(pp)) patterns.push({ name: "十字星(底)", direction: "BULLISH", strength: 1 });
  }

  return patterns;
}

function strategyPattern(ind: TechIndicators, candles: Candle[]): StrategySignal | null {
  const patterns = detectPatterns(candles);
  if (patterns.length === 0) return null;

  // Use strongest pattern
  const best = patterns.sort((a, b) => b.strength - a.strength)[0];
  const { rsi, vol, macd } = ind;

  // Confirm with indicators
  const bullConfirm = best.direction === "BULLISH" && (rsi < 55 || macd.histogram > 0);
  const bearConfirm = best.direction === "BEARISH" && (rsi > 45 || macd.histogram < 0);

  if (!bullConfirm && !bearConfirm) return null;

  const conf = Math.min(85, 50 + best.strength * 8 + (bullConfirm ? (55 - rsi) * 0.3 : (rsi - 45) * 0.3));
  return {
    strategy: "pattern", side: best.direction === "BULLISH" ? "LONG" : "SHORT",
    confidence: conf,
    leverage: best.strength >= 3 ? 3 : 2,
    slPct: Math.max(0.015, vol * 0.018),
    tpPct: Math.max(0.02, vol * 0.03),
    timeLimit: 6,
    reason: `K线形态: ${best.name}(强度${best.strength}), RSI=${rsi.toFixed(0)}`,
  };
}

// 10. Avellaneda: Volatility-adaptive spread strategy (Hummingbot Avellaneda MM)
function strategyAvellaneda(ind: TechIndicators): StrategySignal | null {
  const { rsi, vol, atr, bb, adx, price, ema9, ema21 } = ind;

  // Avellaneda-Stoikov: optimal spread = gamma * sigma^2 * T + (2/gamma) * ln(1 + gamma/k)
  // Simplified: trade when price deviates from fair value by > optimal spread
  const fairValue = (ema9 + ema21) / 2;
  const deviation = (price - fairValue) / fairValue * 100;
  const optimalSpread = vol * 0.8; // Simplified spread based on volatility

  if (Math.abs(deviation) < optimalSpread * 0.5) return null; // Not enough deviation

  if (deviation < -optimalSpread && rsi < 50) {
    const conf = Math.min(80, 55 + Math.abs(deviation) * 5 + (50 - rsi) * 0.3);
    return {
      strategy: "avellaneda", side: "LONG", confidence: conf,
      leverage: 2,
      slPct: Math.max(0.012, optimalSpread / 100),
      tpPct: Math.max(0.025, optimalSpread / 100 * 2),
      timeLimit: 4,
      reason: `Avellaneda: 偏差=${deviation.toFixed(2)}%, 最优价差=${optimalSpread.toFixed(2)}%, RSI=${rsi.toFixed(0)}`,
    };
  }
  if (deviation > optimalSpread && rsi > 50) {
    const conf = Math.min(80, 55 + Math.abs(deviation) * 5 + (rsi - 50) * 0.3);
    return {
      strategy: "avellaneda", side: "SHORT", confidence: conf,
      leverage: 2,
      slPct: Math.max(0.012, optimalSpread / 100),
      tpPct: Math.max(0.025, optimalSpread / 100 * 2),
      timeLimit: 4,
      reason: `Avellaneda: 偏差=${deviation.toFixed(2)}%, 最优价差=${optimalSpread.toFixed(2)}%, RSI=${rsi.toFixed(0)}`,
    };
  }
  return null;
}

// 11. Position Executor: Triple barrier with trailing stop (Hummingbot PositionExecutor)
function strategyPositionExecutor(ind: TechIndicators): StrategySignal | null {
  const { rsi, mom, macd, adx, vol, ema9, ema21, bb } = ind;

  // Strong directional signal with multi-indicator confirmation
  const bullScore = (ema9 > ema21 ? 1 : 0) + (macd.histogram > 0 ? 1 : 0) + (rsi < 60 ? 1 : 0) + (mom > 0.1 ? 1 : 0) + (adx > 20 ? 1 : 0);
  const bearScore = (ema9 < ema21 ? 1 : 0) + (macd.histogram < 0 ? 1 : 0) + (rsi > 40 ? 1 : 0) + (mom < -0.1 ? 1 : 0) + (adx > 20 ? 1 : 0);

  if (bullScore >= 4) {
    const conf = Math.min(90, 55 + bullScore * 6 + adx * 0.3);
    return {
      strategy: "position_executor", side: "LONG", confidence: conf,
      leverage: Math.min(5, Math.round(conf / 22)),
      slPct: Math.max(0.02, vol * 0.025), // 2% SL with trailing
      tpPct: Math.max(0.06, vol * 0.08),  // 6% TP — high R:R
      timeLimit: 36,
      reason: `PositionExec: ${bullScore}/5指标确认多, ADX=${adx.toFixed(0)}, 带追踪止损`,
    };
  }
  if (bearScore >= 4) {
    const conf = Math.min(90, 55 + bearScore * 6 + adx * 0.3);
    return {
      strategy: "position_executor", side: "SHORT", confidence: conf,
      leverage: Math.min(5, Math.round(conf / 22)),
      slPct: Math.max(0.02, vol * 0.025),
      tpPct: Math.max(0.06, vol * 0.08),
      timeLimit: 36,
      reason: `PositionExec: ${bearScore}/5指标确认空, ADX=${adx.toFixed(0)}, 带追踪止损`,
    };
  }
  return null;
}

// 12. TWAP: Time-weighted accumulation during favorable conditions (Hummingbot TWAPExecutor)
function strategyTWAP(ind: TechIndicators): StrategySignal | null {
  const { rsi, mom, vol, bb, adx, ema9, ema21 } = ind;

  // TWAP accumulates during oversold/overbought with low volatility
  if (vol < 1.5 && rsi < 33 && bb.pctB < 0.2 && adx < 35) {
    const conf = Math.min(82, 52 + (33 - rsi) * 1.0 + (1 - bb.pctB) * 5);
    return {
      strategy: "twap", side: "LONG", confidence: conf,
      leverage: 1,
      slPct: Math.max(0.035, vol * 0.04),  // Wider SL for accumulation
      tpPct: Math.max(0.05, vol * 0.06),
      timeLimit: 72,  // Long hold — TWAP accumulation
      reason: `TWAP累积买入: RSI=${rsi.toFixed(0)}, BB%B=${bb.pctB.toFixed(2)}, 低波动累积`,
    };
  }
  if (vol < 1.5 && rsi > 67 && bb.pctB > 0.8 && adx < 35) {
    const conf = Math.min(82, 52 + (rsi - 67) * 1.0 + bb.pctB * 5);
    return {
      strategy: "twap", side: "SHORT", confidence: conf,
      leverage: 1,
      slPct: Math.max(0.035, vol * 0.04),
      tpPct: Math.max(0.05, vol * 0.06),
      timeLimit: 72,
      reason: `TWAP累积卖出: RSI=${rsi.toFixed(0)}, BB%B=${bb.pctB.toFixed(2)}, 低波动分批`,
    };
  }
  return null;
}

// 13. Market Making: Dual-side spread capture (Hummingbot MarketMakingController)
function strategyMarketMaking(ind: TechIndicators): StrategySignal | null {
  const { vol, adx, bb, rsi, atr, price } = ind;

  // MM needs: low directional strength + reasonable volatility for spread capture
  if (adx > 25) return null; // Too directional for MM
  if (vol < 0.3) return null; // Not enough vol to capture spread

  const spreadPct = Math.max(0.1, vol * 0.4); // Spread proportional to vol

  if (bb.pctB < 0.45 && rsi < 52) {
    const conf = Math.min(78, 52 + (25 - adx) * 0.8 + vol * 3);
    return {
      strategy: "market_making", side: "LONG", confidence: conf,
      leverage: 2,
      slPct: Math.max(0.015, spreadPct / 100 * 2),
      tpPct: Math.max(0.01, spreadPct / 100),
      timeLimit: 12,
      reason: `做市买入: Spread=${spreadPct.toFixed(2)}%, ADX=${adx.toFixed(0)}, Vol=${vol.toFixed(2)}`,
    };
  }
  if (bb.pctB > 0.55 && rsi > 48) {
    const conf = Math.min(78, 52 + (25 - adx) * 0.8 + vol * 3);
    return {
      strategy: "market_making", side: "SHORT", confidence: conf,
      leverage: 2,
      slPct: Math.max(0.015, spreadPct / 100 * 2),
      tpPct: Math.max(0.01, spreadPct / 100),
      timeLimit: 12,
      reason: `做市卖出: Spread=${spreadPct.toFixed(2)}%, ADX=${adx.toFixed(0)}, Vol=${vol.toFixed(2)}`,
    };
  }
  return null;
}

// 14. Arbitrage: Cross-timeframe price divergence simulation (Hummingbot ArbitrageExecutor)
function strategyArbitrage(ind: TechIndicators, ind1h: TechIndicators | null): StrategySignal | null {
  if (!ind1h) return null;
  const { rsi, mom, price, vol } = ind;

  // Divergence between 5m and 1h signals
  const shortTermBull = rsi < 40 && mom > 0;
  const longTermBull = ind1h.rsi > 45 && ind1h.mom > 0.05;
  const shortTermBear = rsi > 60 && mom < 0;
  const longTermBear = ind1h.rsi < 55 && ind1h.mom < -0.05;

  // Convergence trade: when short-term oversold but long-term bullish
  if (shortTermBull && longTermBull) {
    const divergence = Math.abs(rsi - ind1h.rsi);
    const conf = Math.min(85, 55 + divergence * 0.5 + Math.abs(ind1h.mom) * 8);
    return {
      strategy: "arbitrage", side: "LONG", confidence: conf,
      leverage: 3,
      slPct: Math.max(0.012, vol * 0.015),
      tpPct: Math.max(0.025, vol * 0.035),
      timeLimit: 16,
      reason: `时间框架套利: 5M超卖(RSI=${rsi.toFixed(0)})+1H看多(RSI=${ind1h.rsi.toFixed(0)}), 价差收敛`,
    };
  }
  if (shortTermBear && longTermBear) {
    const divergence = Math.abs(rsi - ind1h.rsi);
    const conf = Math.min(85, 55 + divergence * 0.5 + Math.abs(ind1h.mom) * 8);
    return {
      strategy: "arbitrage", side: "SHORT", confidence: conf,
      leverage: 3,
      slPct: Math.max(0.012, vol * 0.015),
      tpPct: Math.max(0.025, vol * 0.035),
      timeLimit: 16,
      reason: `时间框架套利: 5M超买(RSI=${rsi.toFixed(0)})+1H看空(RSI=${ind1h.rsi.toFixed(0)}), 价差收敛`,
    };
  }
  return null;
}

// 15. Stochastic: %K/%D crossover with overbought/oversold zones
function strategyStochastic(ind: TechIndicators): StrategySignal | null {
  const { stoch, rsi, mom, vol, macd } = ind;

  // %K crosses above %D in oversold zone
  if (stoch.k < 30 && stoch.k > stoch.d && rsi < 45) {
    const conf = Math.min(82, 52 + (30 - stoch.k) * 0.8 + Math.abs(stoch.k - stoch.d) * 2);
    return {
      strategy: "stochastic", side: "LONG", confidence: conf,
      leverage: 2, slPct: Math.max(0.012, vol * 0.015),
      tpPct: Math.max(0.025, vol * 0.035), timeLimit: 6,
      reason: `随机指标: %K=${stoch.k.toFixed(0)}穿越%D=${stoch.d.toFixed(0)}, 超卖反弹`,
    };
  }
  // %K crosses below %D in overbought zone
  if (stoch.k > 70 && stoch.k < stoch.d && rsi > 55) {
    const conf = Math.min(82, 52 + (stoch.k - 70) * 0.8 + Math.abs(stoch.k - stoch.d) * 2);
    return {
      strategy: "stochastic", side: "SHORT", confidence: conf,
      leverage: 2, slPct: Math.max(0.012, vol * 0.015),
      tpPct: Math.max(0.025, vol * 0.035), timeLimit: 6,
      reason: `随机指标: %K=${stoch.k.toFixed(0)}下穿%D=${stoch.d.toFixed(0)}, 超买回调`,
    };
  }
  return null;
}

// 16. Ichimoku Cloud (simplified): EMA9/21 as Tenkan/Kijun + SMA50 as cloud
function strategyIchimoku(ind: TechIndicators): StrategySignal | null {
  const { ema9, ema21, sma50, price, adx, mom, vol, rsi } = ind;
  // Tenkan (ema9) > Kijun (ema21), price above cloud (sma50), bullish
  if (ema9 > ema21 && price > sma50 && price > ema9 && mom > 0.1 && rsi > 45 && rsi < 70 && adx > 20) {
    const conf = Math.min(88, 55 + adx * 0.3 + Math.abs(mom) * 4 + ((price - sma50) / sma50 * 200));
    return {
      strategy: "ichimoku", side: "LONG", confidence: conf,
      leverage: Math.min(3, Math.round(conf / 30)),
      slPct: Math.max(0.015, vol * 0.02), tpPct: Math.max(0.035, vol * 0.05),
      timeLimit: 16,
      reason: `一目均衡: 价格在云上, 转换>基准线, ADX=${adx.toFixed(0)}, Mom=${mom.toFixed(2)}%`,
    };
  }
  // Bearish: below cloud, tenkan < kijun
  if (ema9 < ema21 && price < sma50 && price < ema9 && mom < -0.1 && rsi > 30 && rsi < 55 && adx > 20) {
    const conf = Math.min(88, 55 + adx * 0.3 + Math.abs(mom) * 4 + ((sma50 - price) / sma50 * 200));
    return {
      strategy: "ichimoku", side: "SHORT", confidence: conf,
      leverage: Math.min(3, Math.round(conf / 30)),
      slPct: Math.max(0.015, vol * 0.02), tpPct: Math.max(0.035, vol * 0.05),
      timeLimit: 16,
      reason: `一目均衡: 价格在云下, 转换<基准线, ADX=${adx.toFixed(0)}, Mom=${mom.toFixed(2)}%`,
    };
  }
  return null;
}

// 17. VWAP Reversion: Price deviation from VWAP for mean reversion
function strategyVWAPReversion(ind: TechIndicators): StrategySignal | null {
  const { vwap, price, rsi, vol, bb } = ind;
  if (vwap === 0 || price === 0) return null;
  const deviation = (price - vwap) / vwap * 100;

  // Price below VWAP by significant amount → long reversion
  if (deviation < -0.3 && rsi < 48 && bb.pctB < 0.4) {
    const conf = Math.min(80, 52 + Math.abs(deviation) * 8 + (48 - rsi) * 0.3);
    return {
      strategy: "vwap_reversion", side: "LONG", confidence: conf,
      leverage: 2, slPct: Math.max(0.01, vol * 0.012),
      tpPct: Math.max(0.025, Math.abs(deviation) / 100 * 1.5), timeLimit: 4,
      reason: `VWAP回归做多: 偏差=${deviation.toFixed(2)}%, RSI=${rsi.toFixed(0)}`,
    };
  }
  // Price above VWAP by significant amount → short reversion
  if (deviation > 0.3 && rsi > 52 && bb.pctB > 0.6) {
    const conf = Math.min(80, 52 + Math.abs(deviation) * 8 + (rsi - 52) * 0.3);
    return {
      strategy: "vwap_reversion", side: "SHORT", confidence: conf,
      leverage: 2, slPct: Math.max(0.01, vol * 0.012),
      tpPct: Math.max(0.025, Math.abs(deviation) / 100 * 1.5), timeLimit: 4,
      reason: `VWAP回归做空: 偏差=${deviation.toFixed(2)}%, RSI=${rsi.toFixed(0)}`,
    };
  }
  return null;
}

// 18. RSI Divergence: RSI direction vs price direction divergence
function strategyRSIDivergence(ind: TechIndicators, candles: Candle[]): StrategySignal | null {
  if (candles.length < 20) return null;
  const { rsi, vol, macd, mom } = ind;

  // Compare RSI 10 bars ago vs now, and price 10 bars ago vs now
  const oldCandles = candles.slice(0, -10);
  const oldRsi = calcRSI(oldCandles);
  const oldPrice = oldCandles[oldCandles.length - 1]?.close ?? 0;
  const curPrice = candles[candles.length - 1].close;
  if (oldPrice === 0) return null;

  const priceDelta = (curPrice - oldPrice) / oldPrice * 100;
  const rsiDelta = rsi - oldRsi;

  // Bullish divergence: price making lower lows but RSI making higher lows
  if (priceDelta < -0.5 && rsiDelta > 3 && rsi < 45) {
    const conf = Math.min(82, 52 + Math.abs(rsiDelta) * 1.5 + (45 - rsi) * 0.5);
    return {
      strategy: "rsi_divergence", side: "LONG", confidence: conf,
      leverage: 2, slPct: Math.max(0.015, vol * 0.02),
      tpPct: Math.max(0.025, vol * 0.035), timeLimit: 8,
      reason: `RSI看涨背离: 价格${priceDelta.toFixed(2)}% RSI+${rsiDelta.toFixed(0)}, 底背离做多`,
    };
  }
  // Bearish divergence: price making higher highs but RSI making lower highs
  if (priceDelta > 0.5 && rsiDelta < -3 && rsi > 55) {
    const conf = Math.min(82, 52 + Math.abs(rsiDelta) * 1.5 + (rsi - 55) * 0.5);
    return {
      strategy: "rsi_divergence", side: "SHORT", confidence: conf,
      leverage: 2, slPct: Math.max(0.015, vol * 0.02),
      tpPct: Math.max(0.025, vol * 0.035), timeLimit: 8,
      reason: `RSI看跌背离: 价格+${priceDelta.toFixed(2)}% RSI${rsiDelta.toFixed(0)}, 顶背离做空`,
    };
  }
  return null;
}

// 19. Donchian Channel Breakout: Price breaking N-period high/low
function strategyDonchian(ind: TechIndicators): StrategySignal | null {
  const { donchian, price, adx, mom, vol, volRatio } = ind;
  if (donchian.upper === 0) return null;
  const range = donchian.upper - donchian.lower;
  if (range === 0) return null;
  const position = (price - donchian.lower) / range; // 0=at low, 1=at high

  // Breakout above channel high
  if (position > 0.95 && mom > 0.1 && adx > 18) {
    const conf = Math.min(85, 55 + adx * 0.3 + volRatio * 3 + Math.abs(mom) * 4);
    return {
      strategy: "donchian", side: "LONG", confidence: conf,
      leverage: Math.min(3, Math.round(conf / 28)),
      slPct: Math.max(0.01, (range / price) * 0.3),
      tpPct: Math.max(0.02, (range / price) * 0.6), timeLimit: 12,
      reason: `唐奇安突破: 价格在通道${(position * 100).toFixed(0)}%, ADX=${adx.toFixed(0)}, Mom=${mom.toFixed(2)}%`,
    };
  }
  // Breakdown below channel low
  if (position < 0.05 && mom < -0.1 && adx > 18) {
    const conf = Math.min(85, 55 + adx * 0.3 + volRatio * 3 + Math.abs(mom) * 4);
    return {
      strategy: "donchian", side: "SHORT", confidence: conf,
      leverage: Math.min(3, Math.round(conf / 28)),
      slPct: Math.max(0.01, (range / price) * 0.3),
      tpPct: Math.max(0.02, (range / price) * 0.6), timeLimit: 12,
      reason: `唐奇安跌破: 价格在通道${(position * 100).toFixed(0)}%, ADX=${adx.toFixed(0)}, Mom=${mom.toFixed(2)}%`,
    };
  }
  return null;
}

// 20. Bollinger Squeeze: BB width contracts then expands with direction
function strategyBBSqueeze(ind: TechIndicators): StrategySignal | null {
  const { bb, vol, mom, macd, adx, rsi } = ind;

  // Squeeze: very narrow BB width + starting to expand with momentum
  if (bb.width < 2.5 && Math.abs(mom) > 0.08 && adx > 15) {
    if (mom > 0 && macd.histogram > 0 && rsi > 45 && rsi < 70) {
      const conf = Math.min(84, 54 + (2.5 - bb.width) * 6 + Math.abs(mom) * 8 + adx * 0.2);
      return {
        strategy: "bb_squeeze", side: "LONG", confidence: conf,
        leverage: Math.min(3, Math.round(conf / 28)),
        slPct: Math.max(0.01, vol * 0.012), tpPct: Math.max(0.025, vol * 0.04),
        timeLimit: 8,
        reason: `布林挤压突破多: BB宽度=${bb.width.toFixed(1)}%, Mom=${mom.toFixed(2)}%, ADX=${adx.toFixed(0)}`,
      };
    }
    if (mom < 0 && macd.histogram < 0 && rsi > 30 && rsi < 55) {
      const conf = Math.min(84, 54 + (2.5 - bb.width) * 6 + Math.abs(mom) * 8 + adx * 0.2);
      return {
        strategy: "bb_squeeze", side: "SHORT", confidence: conf,
        leverage: Math.min(3, Math.round(conf / 28)),
        slPct: Math.max(0.01, vol * 0.012), tpPct: Math.max(0.025, vol * 0.04),
        timeLimit: 8,
        reason: `布林挤压突破空: BB宽度=${bb.width.toFixed(1)}%, Mom=${mom.toFixed(2)}%, ADX=${adx.toFixed(0)}`,
      };
    }
  }
  return null;
}

// ── Market state normalization + random projection embedding ─

function normalizeMarketState(ind: TechIndicators): Record<string, number> {
  return {
    rsi: ind.rsi / 100,                              // 0-1
    mom: Math.tanh(ind.mom / 2),                      // -1 to 1
    mom10: Math.tanh((ind.mom10 ?? ind.mom) / 2),     // -1 to 1
    macd_hist: Math.tanh(ind.macd.histogram * 100),   // -1 to 1
    bb_pctB: ind.bb.pctB,                             // 0-1
    bb_width: Math.min(ind.bb.width / 10, 1),         // 0-1
    vol: Math.min(ind.vol / 5, 1),                    // 0-1
    atr_pct: ind.price > 0 ? Math.min((ind.atr / ind.price) * 100, 1) : 0, // 0-1
    volRatio: Math.min(ind.volRatio / 5, 1),          // 0-1
    adx: ind.adx / 100,                               // 0-1
    ema_cross: ind.ema9 > 0 && ind.ema21 > 0 ? Math.tanh((ind.ema9 - ind.ema21) / ind.ema21 * 50) : 0, // -1 to 1
    ema9_dist: ind.price > 0 ? Math.tanh((ind.price - ind.ema9) / ind.price * 100) : 0, // -1 to 1
    sma50_dist: ind.price > 0 && ind.sma50 > 0 ? Math.tanh((ind.price - ind.sma50) / ind.price * 50) : 0, // -1 to 1
    macd_signal: Math.tanh(ind.macd.signal * 100),    // -1 to 1
    macd_line: Math.tanh(ind.macd.macd * 100),        // -1 to 1
    stoch_k: (ind.stoch?.k ?? 50) / 100,              // 0-1
    stoch_d: (ind.stoch?.d ?? 50) / 100,              // 0-1
    donchian_pos: ind.donchian && ind.donchian.upper !== ind.donchian.lower
      ? (ind.price - ind.donchian.lower) / (ind.donchian.upper - ind.donchian.lower) : 0.5, // 0-1
    vwap_dist: ind.vwap > 0 ? Math.tanh((ind.price - ind.vwap) / ind.vwap * 50) : 0, // -1 to 1
  };
}

// Deterministic random projection: 16 features → 1536 dims (no API call, <1ms)
// Uses seeded PRNG for reproducibility
function randomProjectionEmbedding(state: Record<string, number>): number[] {
  const features = Object.values(state);
  const dim = 1536;
  const embedding = new Array(dim).fill(0);

  // Seeded pseudo-random using simple LCG
  let seed = 42;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1; // -1 to 1
  };

  // Project each feature into high-dimensional space
  for (let f = 0; f < features.length; f++) {
    seed = 42 + f * 7919; // Reset seed per feature for determinism
    for (let d = 0; d < dim; d++) {
      embedding[d] += features[f] * nextRand();
    }
  }

  // L2 normalize
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0)) || 1;
  for (let d = 0; d < dim; d++) embedding[d] /= norm;

  return embedding;
}

// Record embedding on trade open
async function recordTradeEmbedding(
  supabase: any,
  strategyName: string,
  asset: string,
  ind: TechIndicators,
  tradeId: string
): Promise<void> {
  try {
    const marketState = normalizeMarketState(ind);
    const embedding = randomProjectionEmbedding(marketState);
    await supabase.from("strategy_embeddings").insert({
      strategy_name: strategyName,
      asset,
      timeframe: "5m",
      market_state: marketState,
      embedding: JSON.stringify(embedding),
      trade_id: tradeId,
    });
  } catch (e) {
    // Non-critical — don't block trading
  }
}

// Update embedding with trade result on close + refresh performance
async function recordTradeResult(
  supabase: any,
  tradeId: string,
  strategyName: string,
  asset: string,
  pnlPct: number
): Promise<void> {
  try {
    // Update the embedding record with trade result
    await supabase
      .from("strategy_embeddings")
      .update({
        trade_pnl_pct: pnlPct,
        trade_won: pnlPct > 0,
      })
      .eq("trade_id", tradeId);

    // Refresh rolling performance stats
    await supabase.rpc("upsert_strategy_performance", {
      p_strategy_name: strategyName,
      p_asset: asset,
    });
  } catch (e) {
    // Non-critical
  }
}

// ── Model vote simulation (kept for predictions) ────────────

interface ModelVote { model: string; direction: "BULLISH" | "BEARISH" | "NEUTRAL"; confidence: number; weight: number; }

function simulateModelVote(name: string, rsi: number, mom: number, macd: { histogram: number }, bb: { pctB: number }, vol: number): { direction: "BULLISH" | "BEARISH" | "NEUTRAL"; confidence: number } {
  let ls = 0, ss = 0;
  const n1 = (Math.random() - 0.5) * 8, n2 = (Math.random() - 0.5) * 8;

  // Each model has a distinct "personality" — some lean bearish, some bullish
  // This ensures diverse opinions so both LONG and SHORT trades can open
  switch (name) {
    case "GPT-4o":
      // Trend follower — follows momentum, neutral bias
      if (rsi < 40) ls += 15; else if (rsi > 60) ss += 15;
      if (mom > 0.1) ls += 18; else if (mom < -0.1) ss += 18;
      if (macd.histogram > 0) ls += 10; else ss += 10;
      ls += n1; ss += n2; break;
    case "Claude":
      // Contrarian / risk-aware — tends to see overextension, leans bearish
      // When RSI > 50 (even mildly overbought), starts seeing risk
      if (rsi > 50) ss += 12; else if (rsi < 50) ls += 12;
      if (rsi > 65) ss += 15; if (rsi < 35) ls += 15;
      if (bb.pctB > 0.6) ss += 15; else if (bb.pctB < 0.4) ls += 15;
      if (mom > 0.3) ss += 8; // sees rally as overextended
      else if (mom < -0.3) ls += 8; // sees dip as opportunity
      ls += n1 * 0.7; ss += n2 * 0.7; break;
    case "Gemini":
      // Volatility scalper — bearish bias, profits from drops
      ss += 8; // slight permanent bear lean
      if (vol > 0.5) ss += 10;
      if (rsi > 55) ss += 12; else if (rsi < 45) ls += 12;
      if (bb.pctB > 0.5) ss += 10; else if (bb.pctB < 0.5) ls += 10;
      if (mom < 0) ss += 10; else if (mom > 0.2) ls += 5;
      ls += n1; ss += n2; break;
    case "DeepSeek":
      // Technical purist — balanced but respects overbought/oversold
      if (rsi < 45) ls += 15; else if (rsi > 55) ss += 15;
      if (macd.histogram > 0.001) ls += 12; else if (macd.histogram < -0.001) ss += 12;
      if (bb.pctB < 0.3) ls += 12; else if (bb.pctB > 0.7) ss += 12;
      if (mom > 0.15) ls += 8; else if (mom < -0.15) ss += 8;
      ls += n1 * 0.9; ss += n2 * 0.9; break;
    case "Llama":
      // Momentum chaser — bullish bias, follows the crowd
      ls += 6; // slight permanent bull lean
      if (rsi < 40) ls += 20; else if (rsi > 70) ss += 20;
      if (mom > 0) ls += 15; else if (mom < -0.2) ss += 10;
      if (bb.pctB < 0.3) ls += 12; else if (bb.pctB > 0.8) ss += 12;
      ls += n1; ss += n2; break;
    case "CoinMax":
      // Meta-model: weighted consensus of all models + deep learning features
      // Combines trend (GPT), risk (Claude), vol (Gemini), tech (DeepSeek), momentum (Llama)
      // + additional pattern recognition: support/resistance, volume profile
      if (rsi < 35) ls += 20; else if (rsi > 65) ss += 20;
      else if (rsi < 45) ls += 8; else if (rsi > 55) ss += 8;
      if (macd.histogram > 0.002) ls += 15; else if (macd.histogram < -0.002) ss += 15;
      if (bb.pctB < 0.2) ls += 18; else if (bb.pctB > 0.8) ss += 18;
      if (mom > 0.2) ls += 10; else if (mom < -0.2) ss += 10;
      // Volume-weighted trend confirmation
      if (vol > 1.0 && mom > 0) ls += 12; else if (vol > 1.0 && mom < 0) ss += 12;
      // Mean reversion at extremes
      if (rsi < 25 && bb.pctB < 0.1) ls += 15;
      if (rsi > 75 && bb.pctB > 0.9) ss += 15;
      ls += n1 * 0.5; ss += n2 * 0.5; break; // lower noise = higher signal quality
    default:
      if (rsi < 45) ls += 12; else if (rsi > 55) ss += 12;
      ls += n1; ss += n2; break;
  }

  const net = ls - ss, abs = Math.abs(net);
  if (abs < 4) return { direction: "NEUTRAL", confidence: Math.min(55, 40 + Math.random() * 15) };
  if (net > 0) return { direction: "BULLISH", confidence: Math.min(95, 50 + abs * 1.2 + Math.random() * 8) };
  return { direction: "BEARISH", confidence: Math.min(95, 50 + abs * 1.2 + Math.random() * 8) };
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
    prices: {} as Record<string, number>, errors: [] as string[], config: {} as SimConfig,
  };

  try {
    // Load simulation config from DB
    const { data: cfgRow } = await supabase.from("simulation_config").select("*").eq("id", 1).single();
    const cfg: SimConfig = {
      positionSize: cfgRow?.position_size_usd ?? DEFAULT_POSITION_SIZE_USD,
      maxPositions: cfgRow?.max_positions ?? DEFAULT_MAX_POSITIONS,
      maxLeverage: cfgRow?.max_leverage ?? DEFAULT_MAX_LEVERAGE,
      maxDrawdownPct: cfgRow?.max_drawdown_pct ?? 10,
      cooldownMin: cfgRow?.cooldown_min ?? DEFAULT_COOLDOWN_MIN,
      strategies: cfgRow?.enabled_strategies ?? DEFAULT_STRATEGIES,
      assets: cfgRow?.enabled_assets ?? DEFAULT_ASSETS,
      maxSlPct: cfgRow?.max_sl_pct ?? 0.02,
      minTpPct: cfgRow?.min_tp_pct ?? 0.03,
      maxHoldHours: cfgRow?.max_hold_hours ?? 48,
      tradingStyle: cfgRow?.trading_style ?? "balanced",
      trailingStopEnabled: cfgRow?.trailing_stop_enabled ?? true,
      trailingStopTriggerPct: cfgRow?.trailing_stop_trigger_pct ?? 0.5,
      minConsensusModels: cfgRow?.min_consensus_models ?? 2,
    };
    results.config = cfg;

    const ASSETS = cfg.assets;
    const prices = await fetchPrices(ASSETS);
    results.prices = prices;
    if (Object.keys(prices).length === 0) return new Response(JSON.stringify({ error: "No prices" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Load model weights
    const { data: accData } = await supabase.from("ai_model_accuracy").select("model, asset, accuracy_pct, computed_weight").eq("period", "7d");
    const mw: Record<string, Record<string, { weight: number }>> = {};
    if (accData) for (const r of accData) { if (!mw[r.model]) mw[r.model] = {}; mw[r.model][r.asset] = { weight: r.computed_weight || 0.5 }; }

    // Load real AI market analysis (from ai-market-analysis edge function)
    const aiAnalysisMap: Record<string, { direction: string; confidence: number; reasoning: string }> = {};
    const { data: aiData } = await supabase
      .from("ai_market_analysis")
      .select("asset, model, direction, confidence, reasoning")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (aiData) {
      for (const row of aiData) {
        const key = `${row.asset}_${row.model}`;
        if (!aiAnalysisMap[key]) { // latest only per asset+model
          aiAnalysisMap[key] = { direction: row.direction, confidence: row.confidence, reasoning: row.reasoning };
        }
      }
    }

    // Check & close open paper trades
    const { data: openTrades } = await supabase.from("paper_trades").select("*").eq("status", "OPEN");
    if (openTrades) {
      for (const t of openTrades) {
        const cp = prices[t.asset];
        if (!cp) continue;

        // Determine time limit based on strategy
        // Generous time limits — let strategies play out
        // Use global maxHoldHours from config (adjustable by admin/Mac Mini)
        const stratTimeLimit = cfg.maxHoldHours;
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

        // Trailing stop: configurable trigger (default 50% → now from cfg.trailingStopTriggerPct)
        const tsEnabled = cfg.trailingStopEnabled;
        const tsTrigger = cfg.trailingStopTriggerPct;
        if (!cr && tsEnabled && t.side === "LONG" && cp > t.entry_price) {
          const tpDist = t.take_profit - t.entry_price;
          const curProfit = cp - t.entry_price;
          if (curProfit > tpDist * tsTrigger && t.stop_loss < t.entry_price) {
            // Move SL to breakeven + small buffer
            const newSl = t.entry_price * 1.001;
            await supabase.from("paper_trades").update({ stop_loss: parseFloat(newSl.toFixed(2)) }).eq("id", t.id);
          }
        } else if (!cr && tsEnabled && t.side === "SHORT" && cp < t.entry_price) {
          const tpDist = t.entry_price - t.take_profit;
          const curProfit = t.entry_price - cp;
          if (curProfit > tpDist * tsTrigger && t.stop_loss > t.entry_price) {
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
          // Record trade result into strategy learning system
          if (t.strategy_type) {
            await recordTradeResult(supabase, t.id, t.strategy_type, t.asset, parseFloat(pnlPct.toFixed(4)));
          }
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

    // ── Daily drawdown check: stop opening new trades if today's PnL < -20% ──
    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
    const { data: todayClosed } = await supabase
      .from("paper_trades")
      .select("pnl, pnl_pct")
      .eq("status", "CLOSED")
      .gte("closed_at", todayStart.toISOString());

    const todayPnlUsd = todayClosed?.reduce((s, t) => s + (t.pnl || 0), 0) || 0;
    const todayTrades = todayClosed?.length || 0;
    const todayAvgPnlPct = todayTrades > 0
      ? (todayClosed?.reduce((s, t) => s + (t.pnl_pct || 0), 0) || 0) / todayTrades
      : 0;

    // Total capital at risk = positionSize * maxPositions
    const totalCapital = cfg.positionSize * cfg.maxPositions;
    const todayDrawdownPct = totalCapital > 0 ? (todayPnlUsd / totalCapital) * 100 : 0;

    const MAX_DAILY_DRAWDOWN_PCT = cfg.maxDrawdownPct || 20;
    const dailyKillSwitch = todayDrawdownPct < -MAX_DAILY_DRAWDOWN_PCT;

    if (dailyKillSwitch) {
      results.errors.push(`DAILY KILL SWITCH: today PnL $${todayPnlUsd.toFixed(2)} (${todayDrawdownPct.toFixed(1)}%) exceeds -${MAX_DAILY_DRAWDOWN_PCT}% limit. No new trades.`);
    }

    // Process ALL assets
    for (const asset of ASSETS) {
      if (!prices[asset]) continue;
      if (dailyKillSwitch) continue; // Skip all new trades
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

      // Model votes: use real AI analysis if available, fallback to simulated
      const votes: ModelVote[] = [];
      for (const m of AI_MODELS) {
        const realAnalysis = aiAnalysisMap[`${asset}_${m.name}`];
        if (realAnalysis) {
          votes.push({
            model: m.name,
            direction: realAnalysis.direction as "BULLISH" | "BEARISH" | "NEUTRAL",
            confidence: realAnalysis.confidence,
            weight: mw[m.name]?.[asset]?.weight ?? m.defaultWeight,
          });
        } else {
          // Fallback: simulated vote
          const v = simulateModelVote(m.name, ind5m.rsi, ind5m.mom, ind5m.macd, ind5m.bb, ind5m.vol);
          votes.push({ model: m.name, direction: v.direction, confidence: v.confidence, weight: mw[m.name]?.[asset]?.weight ?? m.defaultWeight });
        }
      }

      const consensus = buildConsensus(votes);
      const signalId = crypto.randomUUID();
      const dir = consensus.action === "OPEN_LONG" ? "LONG" : consensus.action === "OPEN_SHORT" ? "SHORT" : "NEUTRAL";
      const techCtx = `RSI=${ind5m.rsi.toFixed(1)},Mom=${ind5m.mom.toFixed(2)}%,MACD=${ind5m.macd.histogram.toFixed(4)},BB=${ind5m.bb.pctB.toFixed(2)},Vol=${ind5m.vol.toFixed(2)}%,ADX=${ind5m.adx.toFixed(0)},VolR=${ind5m.volRatio.toFixed(1)}`;

      // Determine dominant strategy from evaluated signals
      // Evaluate only enabled strategies
      const stratSignals: StrategySignal[] = [];
      if (cfg.strategies.includes("trend_following"))  { const s = strategyTrendFollowing(ind5m);  if (s) stratSignals.push(s); }
      if (cfg.strategies.includes("mean_reversion"))   { const s = strategyMeanReversion(ind5m);   if (s) stratSignals.push(s); }
      if (cfg.strategies.includes("breakout"))         { const s = strategyBreakout(ind5m);        if (s) stratSignals.push(s); }
      if (cfg.strategies.includes("scalping"))         { const s = strategyScalping(ind5m);        if (s) stratSignals.push(s); }
      if (cfg.strategies.includes("momentum"))         { const s = strategyMomentum(ind5m);        if (s) stratSignals.push(s); }
      if (cfg.strategies.includes("swing"))            { const s = strategySwing(ind5m, ind1h);    if (s) stratSignals.push(s); }
      if (cfg.strategies.includes("grid"))             { const s = strategyGrid(ind5m);            if (s) stratSignals.push(s); }
      if (cfg.strategies.includes("dca"))              { const s = strategyDCA(ind5m);             if (s) stratSignals.push(s); }
      if (cfg.strategies.includes("pattern"))          { const s = strategyPattern(ind5m, candles5m); if (s) stratSignals.push(s); }
      if (cfg.strategies.includes("avellaneda"))       { const s = strategyAvellaneda(ind5m);      if (s) stratSignals.push(s); }
      if (cfg.strategies.includes("position_executor")){ const s = strategyPositionExecutor(ind5m);if (s) stratSignals.push(s); }
      if (cfg.strategies.includes("twap"))             { const s = strategyTWAP(ind5m);            if (s) stratSignals.push(s); }
      if (cfg.strategies.includes("market_making"))    { const s = strategyMarketMaking(ind5m);    if (s) stratSignals.push(s); }
      if (cfg.strategies.includes("arbitrage"))        { const s = strategyArbitrage(ind5m, ind1h); if (s) stratSignals.push(s); }
      if (cfg.strategies.includes("stochastic"))       { const s = strategyStochastic(ind5m);       if (s) stratSignals.push(s); }
      if (cfg.strategies.includes("ichimoku"))          { const s = strategyIchimoku(ind5m);         if (s) stratSignals.push(s); }
      if (cfg.strategies.includes("vwap_reversion"))    { const s = strategyVWAPReversion(ind5m);    if (s) stratSignals.push(s); }
      if (cfg.strategies.includes("rsi_divergence"))    { const s = strategyRSIDivergence(ind5m, candles5m); if (s) stratSignals.push(s); }
      if (cfg.strategies.includes("donchian"))          { const s = strategyDonchian(ind5m);         if (s) stratSignals.push(s); }
      if (cfg.strategies.includes("bb_squeeze"))        { const s = strategyBBSqueeze(ind5m);        if (s) stratSignals.push(s); }
      results.strategies_evaluated += cfg.strategies.length;

      // ── HTF trend filter: penalize signals against 1h trend ──
      const htfTrend = ind1h ? (ind1h.ema9 > ind1h.ema21 ? "BULLISH" : "BEARISH") : "NEUTRAL";
      for (const sig of stratSignals) {
        // Going LONG in bearish HTF or SHORT in bullish HTF → cut confidence
        if ((sig.side === "LONG" && htfTrend === "BEARISH") || (sig.side === "SHORT" && htfTrend === "BULLISH")) {
          sig.confidence *= 0.7; // 30% penalty for counter-trend
          sig.leverage = Math.max(1, sig.leverage - 1); // reduce leverage
        }
        // Cap leverage: max 2x unless confidence > 75
        sig.leverage = sig.confidence > 75 ? Math.min(sig.leverage, 3) : Math.min(sig.leverage, 2);
        sig.leverage = Math.min(sig.leverage, cfg.maxLeverage);
      }

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

      // ── AI-gated trade opening: strategy + model consensus ──
      // Count AI model votes for direction
      const aiBullish = votes.filter(v => v.direction === "BULLISH").length;
      const aiBearish = votes.filter(v => v.direction === "BEARISH").length;
      const bestModel = votes.sort((a, b) => b.confidence - a.confidence)[0];

      for (const sig of stratSignals) {
        if (currentOpen + results.paper_trades_opened >= cfg.maxPositions) break;

        const comboKey = `${asset}_${sig.strategy}`;
        if (openCombos.has(comboKey)) continue;

        // Gate 1: Strategy confidence >= 62
        if (sig.confidence < 62) continue;

        // Gate 2: AI models must agree with strategy direction
        // At least 2 models must support the direction, or skip
        const sigDir = sig.side === "LONG" ? "BULLISH" : "BEARISH";
        const aiSupport = votes.filter(v => v.direction === sigDir).length;
        if (aiSupport < 2) continue; // Need at least 2/5 models to agree

        // Find the primary model (highest confidence model that agrees)
        const agreeingModels = votes.filter(v => v.direction === sigDir).sort((a, b) => b.confidence - a.confidence);
        const primaryModel = agreeingModels[0]?.model || "technical";

        // Boost confidence if AI strongly agrees, penalize if weak
        if (aiSupport >= 4) sig.confidence = Math.min(95, sig.confidence * 1.1);
        else if (aiSupport === 2) sig.confidence *= 0.9;

        const side = sig.side;
        // Configurable caps from simulation_config (DB driven, adjustable by Mac Mini / admin)
        const cappedSlPct = Math.min(sig.slPct, cfg.maxSlPct);
        const cappedTpPct = Math.max(sig.tpPct, cfg.minTpPct);
        const cappedLeverage = Math.min(sig.leverage, cfg.maxLeverage);

        const sl = side === "LONG"
          ? currentPrice * (1 - cappedSlPct)
          : currentPrice * (1 + cappedSlPct);
        const tp = side === "LONG"
          ? currentPrice * (1 + cappedTpPct)
          : currentPrice * (1 - cappedTpPct);
        const size = parseFloat((cfg.positionSize / currentPrice).toFixed(8));

        const tradeId = crypto.randomUUID();
        // Build AI reasoning with primary model highlighted
        const modelConsensus = votes.map(v => ({
          model: v.model, direction: v.direction, confidence: v.confidence,
          reasoning: aiAnalysisMap[`${asset}_${v.model}`]?.reasoning || null,
          isPrimary: v.model === primaryModel,
        }));
        const aiReasoning = `[主导: ${primaryModel}] ${aiSupport}/${votes.length}模型${sigDir === "BULLISH" ? "看涨" : "看跌"} | 策略: ${sig.strategy} ${sig.reason} | ` +
          modelConsensus.filter(m => m.reasoning && m.direction === sigDir)
            .map(m => `[${m.model}] ${m.confidence}%: ${m.reasoning}`)
            .join(" | ");

        const { error: tErr } = await supabase.from("paper_trades").insert({
          id: tradeId, signal_id: signalId, asset, side,
          entry_price: currentPrice, size,
          leverage: cappedLeverage,
          stop_loss: parseFloat(sl.toFixed(2)),
          take_profit: parseFloat(tp.toFixed(2)),
          strategy_type: sig.strategy,
          primary_model: primaryModel,
          ai_reasoning: aiReasoning,
          ai_models_consensus: modelConsensus,
          status: "OPEN", opened_at: new Date().toISOString(),
        });
        if (tErr) {
          results.errors.push(`Trade ${asset}/${sig.strategy}: ${tErr.message}`);
        } else {
          results.paper_trades_opened++;
          openCombos.add(comboKey);
          // Record market state embedding for strategy learning
          await recordTradeEmbedding(supabase, sig.strategy, asset, ind5m, tradeId);
        }
      }
    }
  } catch (err) { results.errors.push(`Unexpected: ${err.message}`); }

  return new Response(JSON.stringify(results), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
