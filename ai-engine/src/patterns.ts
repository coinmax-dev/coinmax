/**
 * Candle Pattern Recognition
 *
 * Phase 2: Detect classic candlestick patterns from OHLCV data.
 * Pure functions, no external dependencies.
 *
 * Reference: hummingbot/data_feed/candles_feed/candles_base.py (candle format)
 */

import type { Candle } from "./indicators";

// ── Types ───────────────────────────────────────────────────

export interface PatternMatch {
  name: string;
  type: "BULLISH" | "BEARISH" | "NEUTRAL";
  strength: number; // 1-3 (1=weak, 2=moderate, 3=strong)
  index: number;    // candle index where pattern ends
}

// ── Helpers ─────────────────────────────────────────────────

function bodySize(c: Candle): number {
  return Math.abs(c.close - c.open);
}

function totalRange(c: Candle): number {
  return c.high - c.low;
}

function isGreen(c: Candle): boolean {
  return c.close > c.open;
}

function isRed(c: Candle): boolean {
  return c.close < c.open;
}

function upperWick(c: Candle): number {
  return c.high - Math.max(c.open, c.close);
}

function lowerWick(c: Candle): number {
  return Math.min(c.open, c.close) - c.low;
}

function avgBody(candles: Candle[], count = 10): number {
  const slice = candles.slice(-count);
  return slice.reduce((sum, c) => sum + bodySize(c), 0) / slice.length;
}

// ── Single-Candle Patterns ──────────────────────────────────

function detectDoji(c: Candle, avg: number): PatternMatch | null {
  const body = bodySize(c);
  const range = totalRange(c);
  if (range === 0) return null;
  if (body / range < 0.1 && body < avg * 0.1) {
    return { name: "Doji", type: "NEUTRAL", strength: 1, index: 0 };
  }
  return null;
}

function detectHammer(c: Candle, avg: number, prevTrend: "up" | "down"): PatternMatch | null {
  const body = bodySize(c);
  const range = totalRange(c);
  const lower = lowerWick(c);
  const upper = upperWick(c);
  if (range === 0 || body === 0) return null;

  // Hammer: small body at top, long lower wick (≥2x body), minimal upper wick
  if (lower >= body * 2 && upper < body * 0.5 && prevTrend === "down") {
    return { name: "Hammer", type: "BULLISH", strength: 2, index: 0 };
  }

  // Inverted Hammer: small body at bottom, long upper wick
  if (upper >= body * 2 && lower < body * 0.5 && prevTrend === "down") {
    return { name: "Inverted Hammer", type: "BULLISH", strength: 1, index: 0 };
  }

  // Shooting Star: small body at bottom, long upper wick (after uptrend)
  if (upper >= body * 2 && lower < body * 0.5 && prevTrend === "up") {
    return { name: "Shooting Star", type: "BEARISH", strength: 2, index: 0 };
  }

  // Hanging Man: small body at top, long lower wick (after uptrend)
  if (lower >= body * 2 && upper < body * 0.5 && prevTrend === "up") {
    return { name: "Hanging Man", type: "BEARISH", strength: 1, index: 0 };
  }

  return null;
}

// ── Two-Candle Patterns ─────────────────────────────────────

function detectEngulfing(c1: Candle, c2: Candle): PatternMatch | null {
  const body1 = bodySize(c1);
  const body2 = bodySize(c2);
  if (body1 === 0 || body2 === 0) return null;

  // Bullish Engulfing: red candle followed by green candle that engulfs it
  if (isRed(c1) && isGreen(c2) && c2.open <= c1.close && c2.close >= c1.open) {
    return { name: "Bullish Engulfing", type: "BULLISH", strength: 2, index: 1 };
  }

  // Bearish Engulfing: green candle followed by red candle that engulfs it
  if (isGreen(c1) && isRed(c2) && c2.open >= c1.close && c2.close <= c1.open) {
    return { name: "Bearish Engulfing", type: "BEARISH", strength: 2, index: 1 };
  }

  return null;
}

// ── Three-Candle Patterns ───────────────────────────────────

function detectMorningStar(c1: Candle, c2: Candle, c3: Candle, avg: number): PatternMatch | null {
  // Morning Star: big red, small body (gap down), big green (closes > midpoint of c1)
  if (isRed(c1) && bodySize(c1) > avg * 0.8 &&
      bodySize(c2) < avg * 0.3 &&
      isGreen(c3) && bodySize(c3) > avg * 0.8 &&
      c3.close > (c1.open + c1.close) / 2) {
    return { name: "Morning Star", type: "BULLISH", strength: 3, index: 2 };
  }
  return null;
}

function detectEveningStar(c1: Candle, c2: Candle, c3: Candle, avg: number): PatternMatch | null {
  // Evening Star: big green, small body (gap up), big red (closes < midpoint of c1)
  if (isGreen(c1) && bodySize(c1) > avg * 0.8 &&
      bodySize(c2) < avg * 0.3 &&
      isRed(c3) && bodySize(c3) > avg * 0.8 &&
      c3.close < (c1.open + c1.close) / 2) {
    return { name: "Evening Star", type: "BEARISH", strength: 3, index: 2 };
  }
  return null;
}

function detectThreeWhiteSoldiers(c1: Candle, c2: Candle, c3: Candle, avg: number): PatternMatch | null {
  if (isGreen(c1) && isGreen(c2) && isGreen(c3) &&
      bodySize(c1) > avg * 0.5 && bodySize(c2) > avg * 0.5 && bodySize(c3) > avg * 0.5 &&
      c2.open > c1.open && c2.close > c1.close &&
      c3.open > c2.open && c3.close > c2.close) {
    return { name: "Three White Soldiers", type: "BULLISH", strength: 3, index: 2 };
  }
  return null;
}

function detectThreeBlackCrows(c1: Candle, c2: Candle, c3: Candle, avg: number): PatternMatch | null {
  if (isRed(c1) && isRed(c2) && isRed(c3) &&
      bodySize(c1) > avg * 0.5 && bodySize(c2) > avg * 0.5 && bodySize(c3) > avg * 0.5 &&
      c2.open < c1.open && c2.close < c1.close &&
      c3.open < c2.open && c3.close < c2.close) {
    return { name: "Three Black Crows", type: "BEARISH", strength: 3, index: 2 };
  }
  return null;
}

// ── Main: Detect All Patterns ───────────────────────────────

/**
 * Scan the last few candles for known candlestick patterns.
 * Returns all detected patterns sorted by strength (strongest first).
 */
export function detectPatterns(candles: Candle[]): PatternMatch[] {
  if (candles.length < 3) return [];

  const patterns: PatternMatch[] = [];
  const avg = avgBody(candles);
  const n = candles.length;

  // Determine recent trend (last 5 candles)
  const recentCloses = candles.slice(-6).map(c => c.close);
  const prevTrend: "up" | "down" = recentCloses[recentCloses.length - 1] > recentCloses[0] ? "up" : "down";

  // Single candle (last candle)
  const last = candles[n - 1];
  const doji = detectDoji(last, avg);
  if (doji) patterns.push(doji);
  const hammer = detectHammer(last, avg, prevTrend);
  if (hammer) patterns.push(hammer);

  // Two candle
  const engulf = detectEngulfing(candles[n - 2], candles[n - 1]);
  if (engulf) patterns.push(engulf);

  // Three candle
  const c1 = candles[n - 3], c2 = candles[n - 2], c3 = candles[n - 1];
  const morning = detectMorningStar(c1, c2, c3, avg);
  if (morning) patterns.push(morning);
  const evening = detectEveningStar(c1, c2, c3, avg);
  if (evening) patterns.push(evening);
  const soldiers = detectThreeWhiteSoldiers(c1, c2, c3, avg);
  if (soldiers) patterns.push(soldiers);
  const crows = detectThreeBlackCrows(c1, c2, c3, avg);
  if (crows) patterns.push(crows);

  patterns.sort((a, b) => b.strength - a.strength);
  return patterns;
}

/**
 * Generate a human-readable summary of detected patterns for AI prompt injection.
 */
export function patternSummary(patterns: PatternMatch[]): string {
  if (patterns.length === 0) return "No significant candle patterns";
  return patterns
    .map(p => `${p.name}(${p.type}, strength=${p.strength})`)
    .join(", ");
}
