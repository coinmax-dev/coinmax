/**
 * Confidence Threshold & Signal Filter
 *
 * Phase 3.3: Filter weighted consensus signals into actionable trade signals.
 * Only strong enough signals pass through to execution.
 *
 * Rules:
 *   STRONG:  confidence >= 75 AND 4/5 models agree → Full position
 *   MEDIUM:  confidence >= 60 AND 3/5 models agree → Half position
 *   WEAK:    confidence >= 50 AND 3/5 models agree → Quarter position
 *   NONE:    confidence < 50 OR < 3 models agree   → No trade
 *
 * Reference: hummingbot ai_livestream.py → threshold-based signal conversion
 */

import type { WeightedSignal } from "./model-weights";

// ── Types ───────────────────────────────────────────────────

export type SignalStrength = "STRONG" | "MEDIUM" | "WEAK" | "NONE";

export interface FilteredSignal {
  direction: "LONG" | "SHORT" | "NEUTRAL";
  strength: SignalStrength;
  confidence: number;
  positionSizePct: number;       // % of allocated capital to use
  suggestedLeverage: number;     // Conservative leverage suggestion
  stopLossPct: number;           // Suggested stop-loss %
  takeProfitPct: number;         // Suggested take-profit %
  reason: string;                // Human-readable explanation
  // Hummingbot-compatible signal (-1, 0, 1)
  hummingbotSignal: -1 | 0 | 1;
  // Probabilities format for AILivestreamController
  probabilities: [number, number, number]; // [short, neutral, long]
}

// ── Configuration ───────────────────────────────────────────

export interface FilterConfig {
  strongConfidence: number;      // default: 75
  mediumConfidence: number;      // default: 60
  weakConfidence: number;        // default: 50
  strongAgreeMin: number;        // default: 4
  mediumAgreeMin: number;        // default: 3
  weakAgreeMin: number;          // default: 3
  maxLeverage: number;           // default: 5
  baseStopLoss: number;          // default: 0.02 (2%)
  baseTakeProfit: number;        // default: 0.03 (3%)
}

const DEFAULT_CONFIG: FilterConfig = {
  strongConfidence: 75,
  mediumConfidence: 60,
  weakConfidence: 50,
  strongAgreeMin: 4,
  mediumAgreeMin: 3,
  weakAgreeMin: 3,
  maxLeverage: 5,
  baseStopLoss: 0.02,
  baseTakeProfit: 0.03,
};

// ── Filter Logic ────────────────────────────────────────────

/**
 * Classify the strength of a weighted consensus signal.
 */
export function classifySignal(
  signal: WeightedSignal,
  config: Partial<FilterConfig> = {},
): SignalStrength {
  const c = { ...DEFAULT_CONFIG, ...config };

  if (signal.direction === "NEUTRAL") return "NONE";

  if (signal.confidence >= c.strongConfidence && signal.agreeingModels >= c.strongAgreeMin) {
    return "STRONG";
  }
  if (signal.confidence >= c.mediumConfidence && signal.agreeingModels >= c.mediumAgreeMin) {
    return "MEDIUM";
  }
  if (signal.confidence >= c.weakConfidence && signal.agreeingModels >= c.weakAgreeMin) {
    return "WEAK";
  }

  return "NONE";
}

/**
 * Convert a weighted consensus into a filtered, actionable trade signal.
 */
export function filterSignal(
  signal: WeightedSignal,
  config: Partial<FilterConfig> = {},
): FilteredSignal {
  const c = { ...DEFAULT_CONFIG, ...config };
  const strength = classifySignal(signal, config);

  // Position sizing by strength
  const positionSizeMap: Record<SignalStrength, number> = {
    STRONG: 1.0,    // 100% of allocated capital
    MEDIUM: 0.5,    // 50%
    WEAK: 0.25,     // 25%
    NONE: 0,        // No trade
  };

  // Leverage scaling by strength (conservative)
  const leverageMap: Record<SignalStrength, number> = {
    STRONG: Math.min(c.maxLeverage, 5),
    MEDIUM: Math.min(c.maxLeverage, 3),
    WEAK: Math.min(c.maxLeverage, 2),
    NONE: 1,
  };

  // Stop-loss tighter for weaker signals
  const slMap: Record<SignalStrength, number> = {
    STRONG: c.baseStopLoss,
    MEDIUM: c.baseStopLoss * 0.75,
    WEAK: c.baseStopLoss * 0.5,
    NONE: c.baseStopLoss,
  };

  // Take-profit wider for stronger signals
  const tpMap: Record<SignalStrength, number> = {
    STRONG: c.baseTakeProfit * 1.5,
    MEDIUM: c.baseTakeProfit,
    WEAK: c.baseTakeProfit * 0.75,
    NONE: c.baseTakeProfit,
  };

  const direction = strength === "NONE" ? "NEUTRAL" : signal.direction;

  // Hummingbot signal format
  const hummingbotSignal: -1 | 0 | 1 =
    direction === "LONG" ? 1 :
    direction === "SHORT" ? -1 :
    0;

  // Probabilities for AILivestreamController format
  const total = signal.bullishScore + signal.bearishScore;
  const neutralProb = strength === "NONE" ? 1 : 0;
  const probabilities: [number, number, number] = total === 0
    ? [0, 1, 0]
    : [
        parseFloat((signal.bearishScore / total * (1 - neutralProb)).toFixed(4)),
        neutralProb,
        parseFloat((signal.bullishScore / total * (1 - neutralProb)).toFixed(4)),
      ];

  // Reason
  const reason = strength === "NONE"
    ? `Signal too weak: confidence=${signal.confidence.toFixed(1)}%, ${signal.agreeingModels}/${signal.totalModels} models agree`
    : `${strength} ${direction}: confidence=${signal.confidence.toFixed(1)}%, ${signal.agreeingModels}/${signal.totalModels} models agree`;

  return {
    direction,
    strength,
    confidence: signal.confidence,
    positionSizePct: positionSizeMap[strength],
    suggestedLeverage: leverageMap[strength],
    stopLossPct: slMap[strength],
    takeProfitPct: tpMap[strength],
    reason,
    hummingbotSignal,
    probabilities,
  };
}

/**
 * Quick check: should we trade?
 */
export function shouldTrade(signal: WeightedSignal, config: Partial<FilterConfig> = {}): boolean {
  return classifySignal(signal, config) !== "NONE";
}
