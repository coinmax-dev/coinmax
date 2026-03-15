/**
 * Execution Mode Manager
 *
 * Phase 4.4: Manages how trade signals are executed.
 * Supports progressive rollout from paper trading to full auto.
 *
 * Modes:
 *   PAPER     → Record only, no real trades (testing/validation)
 *   SIGNAL    → Publish signal, user manually executes
 *   SEMI_AUTO → Signal + user confirms → auto execute
 *   FULL_AUTO → Fully automated execution via exchange API
 *
 * Reference: hummingbot strategy_v2 execution modes
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { TradeSignal } from "./signal-publisher";

// ── Types ───────────────────────────────────────────────────

export type ExecutionMode = "PAPER" | "SIGNAL" | "SEMI_AUTO" | "FULL_AUTO";

export interface ExecutionConfig {
  mode: ExecutionMode;
  maxPositionSizeUsd: number;
  maxConcurrentPositions: number;
  maxDailyLossUsd: number;
  maxDrawdownPct: number;
  maxLeverage: number;
  allowedAssets: string[];
  tradingHoursUtc?: { start: number; end: number }; // e.g. { start: 8, end: 22 }
  cooldownSeconds: number;
}

export interface PaperPosition {
  id: string;
  signalId: string;
  asset: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  size: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number;
  openedAt: number;
  status: "OPEN" | "CLOSED";
  exitPrice?: number;
  pnl?: number;
  pnlPct?: number;
  closeReason?: "STOP_LOSS" | "TAKE_PROFIT" | "TIME_LIMIT" | "MANUAL" | "TRAILING_STOP";
  closedAt?: number;
}

export interface ExecutionResult {
  executed: boolean;
  mode: ExecutionMode;
  reason: string;
  position?: PaperPosition;
}

// ── Default Configuration ───────────────────────────────────

const DEFAULT_CONFIG: ExecutionConfig = {
  mode: "PAPER",
  maxPositionSizeUsd: 1000,
  maxConcurrentPositions: 3,
  maxDailyLossUsd: 200,
  maxDrawdownPct: 10,
  maxLeverage: 5,
  allowedAssets: ["BTC", "ETH", "SOL", "BNB"],
  cooldownSeconds: 60,
};

// ── Execution Manager ───────────────────────────────────────

export class ExecutionManager {
  private supabase: SupabaseClient;
  private config: ExecutionConfig;
  private openPositions: Map<string, PaperPosition> = new Map();
  private lastExecutionTime: Map<string, number> = new Map();
  private dailyPnl: number = 0;
  private dailyPnlResetDate: string = "";

  constructor(supabaseUrl: string, supabaseKey: string, config?: Partial<ExecutionConfig>) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Process a trade signal through the execution pipeline.
   */
  async executeSignal(signal: TradeSignal, currentPrice: number): Promise<ExecutionResult> {
    // Pre-flight checks
    const check = this.preFlightCheck(signal, currentPrice);
    if (!check.pass) {
      return { executed: false, mode: this.config.mode, reason: check.reason };
    }

    switch (this.config.mode) {
      case "PAPER":
        return this.paperExecute(signal, currentPrice);

      case "SIGNAL":
        // Signal mode: just record, don't execute
        await this.recordSignal(signal);
        return { executed: false, mode: "SIGNAL", reason: "Signal published — awaiting manual execution" };

      case "SEMI_AUTO":
        // Semi-auto: record and wait for user confirmation
        await this.recordSignal(signal);
        return { executed: false, mode: "SEMI_AUTO", reason: "Signal published — awaiting user confirmation" };

      case "FULL_AUTO":
        // Full auto: would call exchange API here
        // For now, fall back to paper trading + signal recording
        await this.recordSignal(signal);
        const paperResult = await this.paperExecute(signal, currentPrice);
        return { ...paperResult, mode: "FULL_AUTO", reason: "Auto-executed (paper mode active until exchange API connected)" };

      default:
        return { executed: false, mode: this.config.mode, reason: "Unknown execution mode" };
    }
  }

  /**
   * Check all risk/permission constraints before execution.
   */
  private preFlightCheck(signal: TradeSignal, currentPrice: number): { pass: boolean; reason: string } {
    // 1. Check if asset is allowed
    const assetBase = signal.asset.split("-")[0];
    if (!this.config.allowedAssets.includes(assetBase)) {
      return { pass: false, reason: `Asset ${assetBase} not in allowed list` };
    }

    // 2. Check signal strength
    if (signal.strength === "NONE" || signal.action === "HOLD") {
      return { pass: false, reason: "Signal too weak to execute" };
    }

    // 3. Check concurrent positions
    const openCount = [...this.openPositions.values()].filter(p => p.status === "OPEN").length;
    if (openCount >= this.config.maxConcurrentPositions) {
      return { pass: false, reason: `Max concurrent positions (${this.config.maxConcurrentPositions}) reached` };
    }

    // 4. Check cooldown
    const lastExec = this.lastExecutionTime.get(assetBase) || 0;
    if (Date.now() - lastExec < this.config.cooldownSeconds * 1000) {
      return { pass: false, reason: `Cooldown active for ${assetBase}` };
    }

    // 5. Check daily loss limit
    this.resetDailyPnlIfNeeded();
    if (this.dailyPnl < -this.config.maxDailyLossUsd) {
      return { pass: false, reason: `Daily loss limit ($${this.config.maxDailyLossUsd}) reached` };
    }

    // 6. Check max drawdown
    // (Would need portfolio value tracking for real implementation)

    // 7. Check leverage
    if (signal.leverage > this.config.maxLeverage) {
      signal.leverage = this.config.maxLeverage; // Clamp, don't reject
    }

    // 8. Check trading hours
    if (this.config.tradingHoursUtc) {
      const hour = new Date().getUTCHours();
      const { start, end } = this.config.tradingHoursUtc;
      if (start < end) {
        if (hour < start || hour >= end) return { pass: false, reason: "Outside trading hours" };
      } else {
        if (hour < start && hour >= end) return { pass: false, reason: "Outside trading hours" };
      }
    }

    return { pass: true, reason: "All checks passed" };
  }

  /**
   * Paper trade execution — simulates the trade.
   */
  private async paperExecute(signal: TradeSignal, currentPrice: number): Promise<ExecutionResult> {
    const positionSize = Math.min(
      this.config.maxPositionSizeUsd * signal.positionSizePct,
      this.config.maxPositionSizeUsd,
    );

    const position: PaperPosition = {
      id: crypto.randomUUID(),
      signalId: signal.id,
      asset: signal.asset,
      side: signal.action === "OPEN_LONG" ? "LONG" : "SHORT",
      entryPrice: currentPrice,
      size: positionSize / currentPrice,
      leverage: Math.min(signal.leverage, this.config.maxLeverage),
      stopLoss: signal.action === "OPEN_LONG"
        ? currentPrice * (1 - signal.stopLossPct)
        : currentPrice * (1 + signal.stopLossPct),
      takeProfit: signal.action === "OPEN_LONG"
        ? currentPrice * (1 + signal.takeProfitPct)
        : currentPrice * (1 - signal.takeProfitPct),
      openedAt: Date.now(),
      status: "OPEN",
    };

    this.openPositions.set(position.id, position);
    this.lastExecutionTime.set(signal.asset.split("-")[0], Date.now());

    // Record to database
    await this.supabase.from("paper_trades").insert({
      id: position.id,
      signal_id: signal.id,
      asset: position.asset,
      side: position.side,
      entry_price: position.entryPrice,
      size: position.size,
      leverage: position.leverage,
      stop_loss: position.stopLoss,
      take_profit: position.takeProfit,
      status: "OPEN",
      opened_at: new Date(position.openedAt).toISOString(),
    }).then(() => {}).catch(() => {}); // Non-critical

    return {
      executed: true,
      mode: "PAPER",
      reason: `Paper ${position.side} opened: ${position.asset} @ $${currentPrice.toFixed(2)}, size $${positionSize.toFixed(2)}, leverage ${position.leverage}x`,
      position,
    };
  }

  /**
   * Check paper positions against current price (call periodically).
   */
  async checkPaperPositions(prices: Record<string, number>): Promise<PaperPosition[]> {
    const closed: PaperPosition[] = [];

    for (const [id, pos] of this.openPositions) {
      if (pos.status !== "OPEN") continue;

      const price = prices[pos.asset.split("-")[0]];
      if (!price) continue;

      let closeReason: PaperPosition["closeReason"] | null = null;

      if (pos.side === "LONG") {
        if (price <= pos.stopLoss) closeReason = "STOP_LOSS";
        else if (price >= pos.takeProfit) closeReason = "TAKE_PROFIT";
      } else {
        if (price >= pos.stopLoss) closeReason = "STOP_LOSS";
        else if (price <= pos.takeProfit) closeReason = "TAKE_PROFIT";
      }

      if (closeReason) {
        pos.status = "CLOSED";
        pos.exitPrice = price;
        pos.closeReason = closeReason;
        pos.closedAt = Date.now();

        const pnlMultiplier = pos.side === "LONG" ? 1 : -1;
        pos.pnlPct = ((price - pos.entryPrice) / pos.entryPrice) * 100 * pnlMultiplier;
        pos.pnl = pos.size * (price - pos.entryPrice) * pnlMultiplier * pos.leverage;

        this.dailyPnl += pos.pnl;
        closed.push(pos);

        // Update in database
        await this.supabase.from("paper_trades").update({
          status: "CLOSED",
          exit_price: pos.exitPrice,
          pnl: pos.pnl,
          pnl_pct: pos.pnlPct,
          close_reason: pos.closeReason,
          closed_at: new Date(pos.closedAt).toISOString(),
        }).eq("id", id).then(() => {}).catch(() => {});
      }
    }

    return closed;
  }

  private async recordSignal(signal: TradeSignal): Promise<void> {
    await this.supabase.from("trade_signals").insert({
      id: signal.id,
      asset: signal.asset,
      action: signal.action,
      confidence: signal.confidence,
      strength: signal.strength,
      strategy_type: signal.strategyType,
      leverage: signal.leverage,
      stop_loss_pct: signal.stopLossPct,
      take_profit_pct: signal.takeProfitPct,
      position_size_pct: signal.positionSizePct,
      source_models: signal.sourceModels,
      status: "active",
      created_at: new Date(signal.timestamp).toISOString(),
    }).then(() => {}).catch(() => {});
  }

  private resetDailyPnlIfNeeded() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyPnlResetDate !== today) {
      this.dailyPnl = 0;
      this.dailyPnlResetDate = today;
    }
  }

  // ── Getters ─────────────────────────────────────────────

  getConfig(): ExecutionConfig { return { ...this.config }; }
  setMode(mode: ExecutionMode) { this.config.mode = mode; }
  getOpenPositions(): PaperPosition[] { return [...this.openPositions.values()].filter(p => p.status === "OPEN"); }
  getDailyPnl(): number { this.resetDailyPnlIfNeeded(); return this.dailyPnl; }
}
