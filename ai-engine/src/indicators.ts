/**
 * Technical Indicator Service
 *
 * Phase 2: Calculate all major indicators from OHLCV candle data.
 * Pure functions — no external dependencies, works in both Node/Deno/browser.
 *
 * Reference: hummingbot/strategy/__utils__/trailing_indicators/
 */

// ── Types ───────────────────────────────────────────────────

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorResult {
  // Trend
  sma20: number;
  sma50: number;
  sma200: number;
  ema9: number;
  ema21: number;
  macd: { macd: number; signal: number; histogram: number };
  macdSignal: "BULLISH_CROSS" | "BEARISH_CROSS" | "NEUTRAL";
  supertrend: { value: number; direction: "BUY" | "SELL" };
  adx: number;
  // Momentum
  rsi14: number;
  stochastic: { k: number; d: number };
  cci: number;
  williamsR: number;
  // Volatility
  bollingerBands: { upper: number; middle: number; lower: number; position: number };
  atr14: number;
  // Volume
  obv: number;
  vwap: number;
  cmf: number;
}

// ── Helpers ─────────────────────────────────────────────────

function sma(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1] ?? 0;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length < period) return sma(values, values.length);
  const k = 2 / (period + 1);
  let result = sma(values.slice(0, period), period);
  for (let i = period; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }
  return result;
}

function emaArray(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [sma(values.slice(0, period), Math.min(period, values.length))];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function trueRange(candles: Candle[]): number[] {
  const tr: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  return tr;
}

// ── Indicator Calculations ──────────────────────────────────

export function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff; else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function calcMACD(closes: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = emaArray(closes, fast);
  const emaSlow = emaArray(closes, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = emaArray(macdLine.slice(-signal * 3), signal);
  const macdVal = macdLine[macdLine.length - 1];
  const sigVal = signalLine[signalLine.length - 1];
  const histogram = macdVal - sigVal;

  // Detect crossover
  let macdSignal: "BULLISH_CROSS" | "BEARISH_CROSS" | "NEUTRAL" = "NEUTRAL";
  if (macdLine.length >= 2 && signalLine.length >= 2) {
    const prevMACD = macdLine[macdLine.length - 2];
    const prevSig = signalLine.length >= 2 ? signalLine[signalLine.length - 2] : sigVal;
    if (prevMACD <= prevSig && macdVal > sigVal) macdSignal = "BULLISH_CROSS";
    else if (prevMACD >= prevSig && macdVal < sigVal) macdSignal = "BEARISH_CROSS";
  }

  return { macd: { macd: macdVal, signal: sigVal, histogram }, macdSignal };
}

export function calcBollingerBands(closes: number[], period = 20, stdDev = 2) {
  const middle = sma(closes, period);
  const slice = closes.slice(-period);
  const variance = slice.reduce((sum, v) => sum + (v - middle) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = middle + stdDev * sd;
  const lower = middle - stdDev * sd;
  const current = closes[closes.length - 1];
  const position = upper === lower ? 0.5 : (current - lower) / (upper - lower);

  return { upper, middle, lower, position: Math.max(0, Math.min(1, position)) };
}

export function calcStochastic(candles: Candle[], kPeriod = 14, dPeriod = 3) {
  if (candles.length < kPeriod) return { k: 50, d: 50 };
  const kValues: number[] = [];
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const slice = candles.slice(i - kPeriod + 1, i + 1);
    const high = Math.max(...slice.map(c => c.high));
    const low = Math.min(...slice.map(c => c.low));
    const k = high === low ? 50 : ((candles[i].close - low) / (high - low)) * 100;
    kValues.push(k);
  }
  const k = kValues[kValues.length - 1];
  const d = sma(kValues, dPeriod);
  return { k, d };
}

export function calcCCI(candles: Candle[], period = 20): number {
  if (candles.length < period) return 0;
  const tp = candles.map(c => (c.high + c.low + c.close) / 3);
  const tpSlice = tp.slice(-period);
  const mean = tpSlice.reduce((a, b) => a + b, 0) / period;
  const meanDev = tpSlice.reduce((sum, v) => sum + Math.abs(v - mean), 0) / period;
  return meanDev === 0 ? 0 : (tp[tp.length - 1] - mean) / (0.015 * meanDev);
}

export function calcWilliamsR(candles: Candle[], period = 14): number {
  if (candles.length < period) return -50;
  const slice = candles.slice(-period);
  const high = Math.max(...slice.map(c => c.high));
  const low = Math.min(...slice.map(c => c.low));
  if (high === low) return -50;
  return ((high - candles[candles.length - 1].close) / (high - low)) * -100;
}

export function calcATR(candles: Candle[], period = 14): number {
  const tr = trueRange(candles);
  if (tr.length < period) return tr.reduce((a, b) => a + b, 0) / tr.length;
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
  }
  return atr;
}

export function calcSupertrend(candles: Candle[], period = 10, multiplier = 3) {
  const atr = calcATR(candles, period);
  const last = candles[candles.length - 1];
  const hl2 = (last.high + last.low) / 2;
  const upperBand = hl2 + multiplier * atr;
  const lowerBand = hl2 - multiplier * atr;
  // Simplified: if close > upper → BUY (trend up)
  const direction: "BUY" | "SELL" = last.close > hl2 ? "BUY" : "SELL";
  const value = direction === "BUY" ? lowerBand : upperBand;
  return { value, direction };
}

export function calcADX(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 25;
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const tr = trueRange(candles).slice(1);
  const smoothTR = ema(tr, period);
  const smoothPlusDM = ema(plusDM, period);
  const smoothMinusDM = ema(minusDM, period);
  const plusDI = smoothTR === 0 ? 0 : (smoothPlusDM / smoothTR) * 100;
  const minusDI = smoothTR === 0 ? 0 : (smoothMinusDM / smoothTR) * 100;
  const diSum = plusDI + minusDI;
  const dx = diSum === 0 ? 0 : (Math.abs(plusDI - minusDI) / diSum) * 100;
  return dx; // Simplified; full ADX would smooth DX over period
}

export function calcOBV(candles: Candle[]): number {
  let obv = 0;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) obv += candles[i].volume;
    else if (candles[i].close < candles[i - 1].close) obv -= candles[i].volume;
  }
  return obv;
}

export function calcVWAP(candles: Candle[]): number {
  let cumTPV = 0, cumVol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumTPV += tp * c.volume;
    cumVol += c.volume;
  }
  return cumVol === 0 ? 0 : cumTPV / cumVol;
}

export function calcCMF(candles: Candle[], period = 20): number {
  const slice = candles.slice(-period);
  let mfvSum = 0, volSum = 0;
  for (const c of slice) {
    const range = c.high - c.low;
    const mfm = range === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / range;
    mfvSum += mfm * c.volume;
    volSum += c.volume;
  }
  return volSum === 0 ? 0 : mfvSum / volSum;
}

// ── Main: Calculate All Indicators ──────────────────────────

export function calculateAllIndicators(candles: Candle[]): IndicatorResult {
  if (candles.length < 2) {
    throw new Error("Need at least 2 candles to calculate indicators");
  }

  const closes = candles.map(c => c.close);
  const { macd, macdSignal } = calcMACD(closes);

  return {
    // Trend
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    macd,
    macdSignal,
    supertrend: calcSupertrend(candles),
    adx: calcADX(candles),
    // Momentum
    rsi14: calcRSI(closes, 14),
    stochastic: calcStochastic(candles),
    cci: calcCCI(candles),
    williamsR: calcWilliamsR(candles),
    // Volatility
    bollingerBands: calcBollingerBands(closes),
    atr14: calcATR(candles, 14),
    // Volume
    obv: calcOBV(candles),
    vwap: calcVWAP(candles),
    cmf: calcCMF(candles),
  };
}

/**
 * Generate a human-readable summary of indicators for AI prompt injection.
 */
export function indicatorSummary(ind: IndicatorResult, currentPrice: number): string {
  const parts: string[] = [];

  // Trend
  const trendSignals: string[] = [];
  if (currentPrice > ind.sma50) trendSignals.push("Above SMA50");
  if (currentPrice < ind.sma50) trendSignals.push("Below SMA50");
  if (ind.ema9 > ind.ema21) trendSignals.push("EMA9>EMA21(bullish)");
  else trendSignals.push("EMA9<EMA21(bearish)");
  parts.push(`Trend: ${trendSignals.join(", ")}`);

  // MACD
  parts.push(`MACD: ${ind.macdSignal}, histogram=${ind.macd.histogram.toFixed(2)}`);

  // Supertrend + ADX
  parts.push(`Supertrend=${ind.supertrend.direction}, ADX=${ind.adx.toFixed(1)}`);

  // RSI
  const rsiLabel = ind.rsi14 > 70 ? "OVERBOUGHT" : ind.rsi14 < 30 ? "OVERSOLD" : "NEUTRAL";
  parts.push(`RSI(14)=${ind.rsi14.toFixed(1)}(${rsiLabel})`);

  // Stochastic
  parts.push(`Stoch K=${ind.stochastic.k.toFixed(1)}, D=${ind.stochastic.d.toFixed(1)}`);

  // Bollinger
  const bbPos = ind.bollingerBands.position;
  const bbLabel = bbPos > 0.8 ? "near_upper" : bbPos < 0.2 ? "near_lower" : "mid_band";
  parts.push(`BB=${bbLabel}(${(bbPos * 100).toFixed(0)}%)`);

  // ATR
  const atrPct = (ind.atr14 / currentPrice) * 100;
  parts.push(`ATR=${ind.atr14.toFixed(2)}(${atrPct.toFixed(2)}%)`);

  // Volume
  parts.push(`CMF=${ind.cmf.toFixed(3)}`);

  return parts.join(", ");
}
