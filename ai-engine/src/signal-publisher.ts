/**
 * Signal Publisher Service
 *
 * Phase 4.1: Publish trade signals via Supabase Realtime (Postgres changes)
 * and optional MQTT for hummingbot AILivestreamController compatibility.
 *
 * Signal format is compatible with hummingbot's MQTT signal structure.
 *
 * Reference: hummingbot/controllers/directional_trading/ai_livestream.py
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ── Types ───────────────────────────────────────────────────

export interface TradeSignal {
  id: string;
  timestamp: number;
  asset: string;
  action: "OPEN_LONG" | "OPEN_SHORT" | "CLOSE" | "HOLD";
  probabilities: [number, number, number]; // [short, neutral, long]
  targetPct: number;
  confidence: number;
  stopLossPct: number;
  takeProfitPct: number;
  leverage: number;
  positionSizePct: number;
  strategyType: "directional" | "grid" | "dca";
  sourceModels: string[];
  ragContext: string;
  strength: "STRONG" | "MEDIUM" | "WEAK" | "NONE";
}

export interface SignalSubscription {
  unsubscribe: () => void;
}

// ── Signal Publisher ────────────────────────────────────────

export class SignalPublisher {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Publish a trade signal to the database + realtime channel.
   * Subscribers (frontend, hummingbot) receive it instantly via Supabase Realtime.
   */
  async publish(signal: TradeSignal): Promise<void> {
    // Store in database for history
    const { error } = await this.supabase.from("trade_signals").insert({
      id: signal.id,
      asset: signal.asset,
      action: signal.action,
      direction: signal.action === "OPEN_LONG" ? "LONG" : signal.action === "OPEN_SHORT" ? "SHORT" : "NEUTRAL",
      probabilities: signal.probabilities,
      target_pct: signal.targetPct,
      confidence: signal.confidence,
      stop_loss_pct: signal.stopLossPct,
      take_profit_pct: signal.takeProfitPct,
      leverage: signal.leverage,
      position_size_pct: signal.positionSizePct,
      strategy_type: signal.strategyType,
      source_models: signal.sourceModels,
      rag_context: signal.ragContext,
      strength: signal.strength,
      status: "active",
      created_at: new Date(signal.timestamp).toISOString(),
    });

    if (error) throw new Error(`Failed to publish signal: ${error.message}`);

    // Broadcast to realtime channel (for connected clients)
    await this.supabase.channel("trade-signals").send({
      type: "broadcast",
      event: "new_signal",
      payload: signal,
    });
  }

  /**
   * Mark a signal as executed/expired/cancelled.
   */
  async updateSignalStatus(
    signalId: string,
    status: "executed" | "expired" | "cancelled",
    result?: { pnl: number; closeReason: string },
  ): Promise<void> {
    const update: Record<string, any> = {
      status,
      resolved_at: new Date().toISOString(),
    };
    if (result) {
      update.result_pnl = result.pnl;
      update.close_reason = result.closeReason;
    }

    await this.supabase.from("trade_signals").update(update).eq("id", signalId);
  }

  /**
   * Get recent active signals.
   */
  async getActiveSignals(asset?: string): Promise<TradeSignal[]> {
    let query = this.supabase
      .from("trade_signals")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(20);

    if (asset) query = query.eq("asset", asset);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch signals: ${error.message}`);

    return (data || []).map(mapRowToSignal);
  }
}

function mapRowToSignal(row: any): TradeSignal {
  return {
    id: row.id,
    timestamp: new Date(row.created_at).getTime(),
    asset: row.asset,
    action: row.action,
    probabilities: row.probabilities || [0, 1, 0],
    targetPct: row.target_pct,
    confidence: row.confidence,
    stopLossPct: row.stop_loss_pct,
    takeProfitPct: row.take_profit_pct,
    leverage: row.leverage,
    positionSizePct: row.position_size_pct,
    strategyType: row.strategy_type,
    sourceModels: row.source_models || [],
    ragContext: row.rag_context || "",
    strength: row.strength,
  };
}

// ── Signal Subscriber (Frontend / Client) ───────────────────

export class SignalSubscriber {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Subscribe to real-time trade signals.
   */
  subscribe(callback: (signal: TradeSignal) => void): SignalSubscription {
    const channel = this.supabase
      .channel("trade-signals")
      .on("broadcast", { event: "new_signal" }, (payload) => {
        callback(payload.payload as TradeSignal);
      })
      .subscribe();

    return {
      unsubscribe: () => { channel.unsubscribe(); },
    };
  }

  /**
   * Subscribe to DB changes on trade_signals table.
   */
  subscribeDB(callback: (signal: TradeSignal) => void): SignalSubscription {
    const channel = this.supabase
      .channel("trade-signals-db")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "trade_signals" },
        (payload) => { callback(mapRowToSignal(payload.new)); },
      )
      .subscribe();

    return {
      unsubscribe: () => { channel.unsubscribe(); },
    };
  }
}

/**
 * Build a TradeSignal from consensus result.
 */
export function buildTradeSignal(
  asset: string,
  consensus: {
    direction: string;
    confidence: number;
    strength: string;
    probabilities: [number, number, number];
    positionSizePct: number;
    suggestedLeverage: number;
    stopLossPct: number;
    takeProfitPct: number;
  },
  strategyType: "directional" | "grid" | "dca",
  sourceModels: string[],
  ragSummary: string = "",
): TradeSignal {
  const action: TradeSignal["action"] =
    consensus.direction === "LONG" ? "OPEN_LONG" :
    consensus.direction === "SHORT" ? "OPEN_SHORT" :
    "HOLD";

  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    asset,
    action,
    probabilities: consensus.probabilities,
    targetPct: consensus.confidence / 100 * consensus.stopLossPct * 2, // rough target
    confidence: consensus.confidence,
    stopLossPct: consensus.stopLossPct,
    takeProfitPct: consensus.takeProfitPct,
    leverage: consensus.suggestedLeverage,
    positionSizePct: consensus.positionSizePct,
    strategyType,
    sourceModels,
    ragContext: ragSummary,
    strength: consensus.strength as TradeSignal["strength"],
  };
}
