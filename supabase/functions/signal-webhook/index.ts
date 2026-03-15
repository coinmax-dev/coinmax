import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * Signal Webhook — External Strategy Provider Endpoint (方式 D)
 *
 * Receives trade signals from external sources (TradingView, 3Commas, custom systems)
 * via HTTP POST webhook and writes them to the trade_signals table.
 *
 * Authentication: Bearer token (WEBHOOK_SECRET env var) or provider-specific API key.
 *
 * Supports 3 input formats:
 *   1. CoinMax Standard Format (full TradeSignal)
 *   2. TradingView Alert Format (simplified)
 *   3. Simple Format (minimal fields)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

// ── Provider Registry ───────────────────────────────

interface ProviderConfig {
  name: string;
  apiKey: string;
  allowedAssets: string[];
  maxLeverage: number;
  enabled: boolean;
}

// Load providers from env: SIGNAL_PROVIDERS=name1|key1|assets|maxLev,name2|key2|assets|maxLev
function loadProviders(): Map<string, ProviderConfig> {
  const map = new Map<string, ProviderConfig>();
  const raw = Deno.env.get("SIGNAL_PROVIDERS") || "";
  if (!raw) return map;
  for (const entry of raw.split(",")) {
    const [name, apiKey, assets, maxLev] = entry.trim().split("|");
    if (!name || !apiKey) continue;
    map.set(apiKey, {
      name,
      apiKey,
      allowedAssets: assets ? assets.split(";") : ["BTC", "ETH", "SOL", "BNB"],
      maxLeverage: parseInt(maxLev || "5"),
      enabled: true,
    });
  }
  return map;
}

// ── Authentication ──────────────────────────────────

interface DbProvider {
  id: string;
  name: string;
  allowedAssets: string[];
  maxLeverage: number;
}

async function hashKey(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function lookupDbProvider(token: string, supabase: any): Promise<{ config: ProviderConfig; dbProvider: DbProvider } | null> {
  if (!token || !token.startsWith("sp_")) return null;
  const hashed = await hashKey(token);
  const { data, error } = await supabase
    .from("strategy_providers")
    .select("id, name, allowed_assets, max_leverage, status")
    .eq("api_key", hashed)
    .single();
  if (error || !data || data.status !== "approved") return null;
  return {
    config: {
      name: data.name,
      apiKey: token,
      allowedAssets: data.allowed_assets || ["BTC", "ETH", "SOL", "BNB"],
      maxLeverage: data.max_leverage || 5,
      enabled: true,
    },
    dbProvider: { id: data.id, name: data.name, allowedAssets: data.allowed_assets, maxLeverage: data.max_leverage },
  };
}

async function authenticate(req: Request, providers: Map<string, ProviderConfig>, supabase: any): Promise<{ config: ProviderConfig; dbProviderId?: string } | null> {
  const extractToken = (header: string) => header.startsWith("Bearer ") ? header.slice(7) : header;

  for (const header of [req.headers.get("authorization") || "", req.headers.get("x-webhook-secret") || ""]) {
    if (!header) continue;
    const token = extractToken(header);

    // Check webhook secret
    const webhookSecret = Deno.env.get("WEBHOOK_SECRET") || "";
    if (webhookSecret && token === webhookSecret) {
      return { config: { name: "webhook", apiKey: token, allowedAssets: ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"], maxLeverage: 10, enabled: true } };
    }

    // Check env-var providers
    const envProvider = providers.get(token);
    if (envProvider?.enabled) return { config: envProvider };

    // Check DB providers (sp_ prefixed keys)
    const dbResult = await lookupDbProvider(token, supabase);
    if (dbResult) return { config: dbResult.config, dbProviderId: dbResult.dbProvider.id };
  }

  return null;
}

// ── Signal Parsing ──────────────────────────────────

interface ParsedSignal {
  asset: string;
  action: "OPEN_LONG" | "OPEN_SHORT" | "CLOSE" | "HOLD";
  confidence: number;
  strength: "STRONG" | "MEDIUM" | "WEAK";
  strategyType: "directional" | "grid" | "dca";
  leverage: number;
  stopLossPct: number;
  takeProfitPct: number;
  positionSizePct: number;
  sourceModels: string[];
  ragContext: string;
}

function parseSignal(body: any, provider: ProviderConfig): ParsedSignal {
  // ── Format 1: CoinMax Standard ──
  if (body.action && body.confidence !== undefined) {
    return {
      asset: normalizeAsset(body.asset || "BTC"),
      action: normalizeAction(body.action),
      confidence: clamp(Number(body.confidence) || 70, 0, 100),
      strength: body.strength || classifyStrength(Number(body.confidence) || 70),
      strategyType: body.strategy_type || body.strategyType || "directional",
      leverage: clamp(Number(body.leverage) || 2, 1, provider.maxLeverage),
      stopLossPct: Number(body.stop_loss_pct || body.stopLossPct) || 0.02,
      takeProfitPct: Number(body.take_profit_pct || body.takeProfitPct) || 0.03,
      positionSizePct: clamp(Number(body.position_size_pct || body.positionSizePct) || 0.5, 0, 1),
      sourceModels: body.source_models || body.sourceModels || [provider.name],
      ragContext: body.rag_context || body.ragContext || "",
    };
  }

  // ── Format 2: TradingView Alert ──
  // TradingView sends: { "action": "buy", "ticker": "BTCUSDT", "price": 67230 }
  if (body.ticker || body.symbol) {
    const ticker = body.ticker || body.symbol || "";
    const asset = ticker.replace(/USDT$|USD$|PERP$/i, "").toUpperCase();
    const tvAction = (body.action || body.order || body.side || "").toLowerCase();

    let action: ParsedSignal["action"] = "HOLD";
    if (tvAction === "buy" || tvAction === "long") action = "OPEN_LONG";
    else if (tvAction === "sell" || tvAction === "short") action = "OPEN_SHORT";
    else if (tvAction === "close" || tvAction === "exit" || tvAction === "flat") action = "CLOSE";

    return {
      asset,
      action,
      confidence: Number(body.confidence) || 70,
      strength: classifyStrength(Number(body.confidence) || 70),
      strategyType: "directional",
      leverage: clamp(Number(body.leverage) || 2, 1, provider.maxLeverage),
      stopLossPct: Number(body.stoploss || body.stop_loss) || 0.02,
      takeProfitPct: Number(body.takeprofit || body.take_profit) || 0.03,
      positionSizePct: clamp(Number(body.size || body.qty_pct) || 0.5, 0, 1),
      sourceModels: [provider.name, body.strategy || "TradingView"],
      ragContext: body.comment || body.message || "",
    };
  }

  // ── Format 3: Simple ──
  // Minimal: { "direction": "long", "asset": "BTC" }
  const dir = (body.direction || body.side || "").toUpperCase();
  return {
    asset: normalizeAsset(body.asset || body.coin || "BTC"),
    action: dir === "LONG" || dir === "BUY" ? "OPEN_LONG" : dir === "SHORT" || dir === "SELL" ? "OPEN_SHORT" : "HOLD",
    confidence: Number(body.confidence) || 65,
    strength: classifyStrength(Number(body.confidence) || 65),
    strategyType: "directional",
    leverage: clamp(Number(body.leverage) || 2, 1, provider.maxLeverage),
    stopLossPct: 0.02,
    takeProfitPct: 0.03,
    positionSizePct: 0.5,
    sourceModels: [provider.name],
    ragContext: "",
  };
}

// ── Helpers ─────────────────────────────────────────

function normalizeAsset(asset: string): string {
  return asset.replace(/[-_/]?USDT$|[-_/]?USD$|[-_/]?PERP$/i, "").toUpperCase();
}

function normalizeAction(action: string): ParsedSignal["action"] {
  const a = action.toUpperCase();
  if (a === "OPEN_LONG" || a === "BUY" || a === "LONG") return "OPEN_LONG";
  if (a === "OPEN_SHORT" || a === "SELL" || a === "SHORT") return "OPEN_SHORT";
  if (a === "CLOSE" || a === "EXIT" || a === "FLAT") return "CLOSE";
  return "HOLD";
}

function classifyStrength(confidence: number): "STRONG" | "MEDIUM" | "WEAK" {
  if (confidence >= 75) return "STRONG";
  if (confidence >= 60) return "MEDIUM";
  return "WEAK";
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ── Main ────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Only POST allowed
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Init Supabase early for DB provider auth
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const providers = loadProviders();

  // Authenticate
  const authResult = await authenticate(req, providers, supabase);
  if (!authResult) {
    return new Response(JSON.stringify({ error: "Unauthorized. Provide Bearer token or x-webhook-secret header." }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const provider = authResult.config;
  const dbProviderId = authResult.dbProviderId;

  try {
    const body = await req.json();

    // Parse signal (supports 3 formats)
    const signal = parseSignal(body, provider);

    // Validate asset
    if (!provider.allowedAssets.includes(signal.asset)) {
      return new Response(JSON.stringify({ error: `Asset ${signal.asset} not allowed for provider ${provider.name}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip HOLD signals
    if (signal.action === "HOLD") {
      return new Response(JSON.stringify({ status: "skipped", reason: "HOLD signal, no action taken" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Write to trade_signals table
    const direction = signal.action === "OPEN_LONG" ? "LONG" : signal.action === "OPEN_SHORT" ? "SHORT" : "NEUTRAL";

    const insertData: any = {
      asset: signal.asset,
      action: signal.action,
      direction,
      confidence: signal.confidence,
      strength: signal.strength,
      strategy_type: signal.strategyType,
      leverage: signal.leverage,
      stop_loss_pct: signal.stopLossPct,
      take_profit_pct: signal.takeProfitPct,
      position_size_pct: signal.positionSizePct,
      source_models: signal.sourceModels,
      rag_context: signal.ragContext,
      status: "active",
    };
    if (dbProviderId) insertData.provider_id = dbProviderId;

    const { data, error } = await supabase.from("trade_signals").insert(insertData).select("id").single();

    if (error) {
      return new Response(JSON.stringify({ error: `DB error: ${error.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Broadcast via Supabase Realtime
    try {
      await supabase.channel("trade-signals").send({
        type: "broadcast",
        event: "new_signal",
        payload: { ...signal, id: data.id, timestamp: Date.now(), provider: provider.name },
      });
    } catch {} // Non-critical

    return new Response(JSON.stringify({
      status: "ok",
      signal_id: data.id,
      provider: provider.name,
      action: signal.action,
      asset: signal.asset,
      confidence: signal.confidence,
      strength: signal.strength,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || "Invalid request body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
