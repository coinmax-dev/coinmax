/**
 * Strategy Selector (RAG-based)
 *
 * Phase 3.4: Auto-select the best trading strategy based on current market regime.
 * Uses technical indicators + similar historical patterns to determine optimal approach.
 *
 * Strategies:
 *   高波动+强趋势 → Directional (趋势跟踪)
 *   低波动+震荡   → Grid (网格交易)
 *   下跌趋势      → DCA (分批抄底)
 *   交叉信号      → Arbitrage (套利)
 *
 * Reference: hummingbot strategy_v2/controllers/ — multiple strategy types
 */

import type { IndicatorResult } from "./indicators";
import type { FilteredSignal } from "./signal-filter";

// ── Types ───────────────────────────────────────────────────

export type StrategyType = "directional" | "grid" | "dca" | "arbitrage";

export interface MarketRegime {
  volatility: "HIGH" | "MEDIUM" | "LOW";
  trend: "STRONG_UP" | "UP" | "NEUTRAL" | "DOWN" | "STRONG_DOWN";
  momentum: "OVERBOUGHT" | "NEUTRAL" | "OVERSOLD";
  volume: "HIGH" | "NORMAL" | "LOW";
}

export interface StrategyRecommendation {
  strategy: StrategyType;
  confidence: number;       // 0-100
  regime: MarketRegime;
  params: StrategyParams;
  reason: string;
}

export interface StrategyParams {
  // Directional
  leverage?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  trailingStop?: boolean;
  // Grid
  gridLevels?: number;
  gridSpreadPct?: number;
  // DCA
  dcaLevels?: number;
  dcaStepPct?: number;
  // Common
  timeLimit?: number;        // seconds
  maxPositionSize?: number;  // % of capital
}

// ── Market Regime Detection ─────────────────────────────────

export function detectMarketRegime(indicators: IndicatorResult): MarketRegime {
  // Volatility: based on ATR relative to price and BB width
  const bbWidth = indicators.bollingerBands.upper - indicators.bollingerBands.lower;
  const bbPct = indicators.bollingerBands.middle > 0
    ? (bbWidth / indicators.bollingerBands.middle) * 100
    : 0;

  const volatility: MarketRegime["volatility"] =
    bbPct > 6 ? "HIGH" :
    bbPct > 3 ? "MEDIUM" :
    "LOW";

  // Trend: based on ADX + EMA alignment + price vs SMA
  const adx = indicators.adx;
  const emaBullish = indicators.ema9 > indicators.ema21;
  const superBuy = indicators.supertrend.direction === "BUY";

  let trend: MarketRegime["trend"];
  if (adx > 30 && emaBullish && superBuy) trend = "STRONG_UP";
  else if (adx > 20 && emaBullish) trend = "UP";
  else if (adx > 30 && !emaBullish && !superBuy) trend = "STRONG_DOWN";
  else if (adx > 20 && !emaBullish) trend = "DOWN";
  else trend = "NEUTRAL";

  // Momentum: RSI + Stochastic
  const rsi = indicators.rsi14;
  const stochK = indicators.stochastic.k;
  const momentum: MarketRegime["momentum"] =
    (rsi > 70 && stochK > 80) ? "OVERBOUGHT" :
    (rsi < 30 && stochK < 20) ? "OVERSOLD" :
    "NEUTRAL";

  // Volume: CMF direction
  const volume: MarketRegime["volume"] =
    Math.abs(indicators.cmf) > 0.15 ? "HIGH" :
    Math.abs(indicators.cmf) > 0.05 ? "NORMAL" :
    "LOW";

  return { volatility, trend, momentum, volume };
}

// ── Strategy Selection ──────────────────────────────────────

export function selectStrategy(
  regime: MarketRegime,
  signal: FilteredSignal,
  indicators: IndicatorResult,
): StrategyRecommendation {
  // Rule-based strategy selection
  const { volatility, trend, momentum } = regime;

  // 1. Strong trend + high volatility → Directional (trend following)
  if ((trend === "STRONG_UP" || trend === "STRONG_DOWN") && volatility !== "LOW") {
    const isUp = trend === "STRONG_UP";
    return {
      strategy: "directional",
      confidence: 85,
      regime,
      params: {
        leverage: signal.suggestedLeverage,
        stopLossPct: signal.stopLossPct,
        takeProfitPct: signal.takeProfitPct * 1.5, // Wider TP for strong trends
        trailingStop: true,
        maxPositionSize: signal.positionSizePct,
      },
      reason: `Strong ${isUp ? "uptrend" : "downtrend"} (ADX=${indicators.adx.toFixed(0)}) with ${volatility.toLowerCase()} volatility — trend following optimal`,
    };
  }

  // 2. Low volatility + neutral trend → Grid trading
  if (volatility === "LOW" && (trend === "NEUTRAL" || trend === "UP" || trend === "DOWN")) {
    const bbSpread = indicators.bollingerBands.upper - indicators.bollingerBands.lower;
    const gridSpread = (bbSpread / indicators.bollingerBands.middle) * 100;
    return {
      strategy: "grid",
      confidence: 75,
      regime,
      params: {
        gridLevels: 5,
        gridSpreadPct: parseFloat(Math.max(0.5, gridSpread / 4).toFixed(2)),
        maxPositionSize: 0.5,
      },
      reason: `Low volatility ranging market (BB width=${gridSpread.toFixed(1)}%) — grid trading optimal`,
    };
  }

  // 3. Downtrend + oversold → DCA (buy the dip)
  if ((trend === "DOWN" || trend === "STRONG_DOWN") && momentum === "OVERSOLD") {
    return {
      strategy: "dca",
      confidence: 70,
      regime,
      params: {
        dcaLevels: 4,
        dcaStepPct: 1.5,
        stopLossPct: signal.stopLossPct * 2, // Wider SL for DCA
        maxPositionSize: 0.75,
      },
      reason: `Downtrend with oversold conditions (RSI=${indicators.rsi14.toFixed(0)}, Stoch=${indicators.stochastic.k.toFixed(0)}) — DCA accumulation zone`,
    };
  }

  // 4. Medium volatility + moderate trend → Directional with caution
  if (volatility === "MEDIUM" && (trend === "UP" || trend === "DOWN")) {
    return {
      strategy: "directional",
      confidence: 65,
      regime,
      params: {
        leverage: Math.min(signal.suggestedLeverage, 3),
        stopLossPct: signal.stopLossPct,
        takeProfitPct: signal.takeProfitPct,
        trailingStop: false,
        maxPositionSize: signal.positionSizePct * 0.75,
      },
      reason: `Moderate ${trend.toLowerCase()} trend with medium volatility — cautious directional trade`,
    };
  }

  // 5. High volatility + no clear trend → Reduce exposure or grid
  if (volatility === "HIGH" && (trend === "NEUTRAL")) {
    return {
      strategy: "grid",
      confidence: 55,
      regime,
      params: {
        gridLevels: 3,
        gridSpreadPct: 2.0,
        maxPositionSize: 0.25,
      },
      reason: `High volatility with no clear trend — wide grid with reduced size`,
    };
  }

  // Default: conservative directional
  return {
    strategy: "directional",
    confidence: 50,
    regime,
    params: {
      leverage: 2,
      stopLossPct: signal.stopLossPct,
      takeProfitPct: signal.takeProfitPct,
      trailingStop: false,
      maxPositionSize: signal.positionSizePct * 0.5,
    },
    reason: `Mixed signals — conservative directional with reduced exposure`,
  };
}

/**
 * Generate human-readable strategy summary for AI prompt / frontend display.
 */
export function strategySummary(rec: StrategyRecommendation): string {
  const s = rec.strategy.toUpperCase();
  const r = rec.regime;
  return `[${s}] ${r.volatility} vol, ${r.trend} trend, ${r.momentum} momentum → ${rec.reason} (${rec.confidence}% confidence)`;
}
