import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * Copy Trade Executor — Matches AI signals to user configs and executes trades
 *
 * Runs every 1 minute via cron:
 * 1. Find new paper_trades opened since last run
 * 2. Match each signal to active user_trade_configs (model + strategy + coin filter)
 * 3. Validate risk controls (position limits, daily loss, leverage)
 * 4. Execute on exchange (Binance Futures first, others later)
 * 5. Record in copy_trade_orders
 * 6. Check existing positions for SL/TP hits → close
 *
 * Also handles:
 * - Paper mode: record virtual trades without calling exchange
 * - Signal mode: push notification only (Telegram)
 * - Semi-auto: queue for user confirmation
 * - Full-auto: execute immediately
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENCRYPTION_KEY = Deno.env.get("API_ENCRYPTION_KEY") || "coinmax-default-key-change-me";

// ═══════════════════════════════════════════════════════════════
//  EXCHANGE API CLIENTS
// ═══════════════════════════════════════════════════════════════

interface ExchangeOrder {
  orderId: string;
  status: string;
  filledPrice?: number;
  filledQty?: number;
  raw?: any;
}

// ─── Binance Futures ────────────────────────────────────────

const BINANCE_FUTURES_BASE = "https://fapi.binance.com";

async function binanceSign(queryString: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(queryString));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function binanceFuturesRequest(
  method: string, path: string, params: Record<string, string>,
  apiKey: string, apiSecret: string
): Promise<any> {
  params.timestamp = Date.now().toString();
  params.recvWindow = "5000";
  const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join("&");
  const signature = await binanceSign(qs, apiSecret);
  const url = `${BINANCE_FUTURES_BASE}${path}?${qs}&signature=${signature}`;

  const res = await fetch(url, {
    method,
    headers: { "X-MBX-APIKEY": apiKey },
  });
  const data = await res.json();
  if (data.code && data.code !== 200) {
    throw new Error(`Binance error ${data.code}: ${data.msg}`);
  }
  return data;
}

async function binanceOpenPosition(
  apiKey: string, apiSecret: string,
  symbol: string, side: "LONG" | "SHORT", sizeUsd: number,
  leverage: number, stopLoss: number, takeProfit: number, price: number
): Promise<ExchangeOrder> {
  // 1. Set leverage
  try {
    await binanceFuturesRequest("POST", "/fapi/v1/leverage", {
      symbol: symbol.replace("-", ""),
      leverage: leverage.toString(),
    }, apiKey, apiSecret);
  } catch { /* may already be set */ }

  // 2. Calculate quantity
  const qty = (sizeUsd / price).toFixed(getDecimalPlaces(symbol));
  const binanceSide = side === "LONG" ? "BUY" : "SELL";

  // 3. Open market order
  const order = await binanceFuturesRequest("POST", "/fapi/v1/order", {
    symbol: symbol.replace("-", ""),
    side: binanceSide,
    type: "MARKET",
    quantity: qty,
  }, apiKey, apiSecret);

  // 4. Set stop loss
  try {
    await binanceFuturesRequest("POST", "/fapi/v1/order", {
      symbol: symbol.replace("-", ""),
      side: side === "LONG" ? "SELL" : "BUY",
      type: "STOP_MARKET",
      stopPrice: stopLoss.toFixed(getDecimalPlaces(symbol)),
      closePosition: "true",
    }, apiKey, apiSecret);
  } catch (e) {
    console.warn("SL order failed:", e);
  }

  // 5. Set take profit
  try {
    await binanceFuturesRequest("POST", "/fapi/v1/order", {
      symbol: symbol.replace("-", ""),
      side: side === "LONG" ? "SELL" : "BUY",
      type: "TAKE_PROFIT_MARKET",
      stopPrice: takeProfit.toFixed(getDecimalPlaces(symbol)),
      closePosition: "true",
    }, apiKey, apiSecret);
  } catch (e) {
    console.warn("TP order failed:", e);
  }

  return {
    orderId: String(order.orderId),
    status: order.status,
    filledPrice: parseFloat(order.avgPrice || order.price || "0"),
    filledQty: parseFloat(order.executedQty || "0"),
    raw: order,
  };
}

async function binanceClosePosition(
  apiKey: string, apiSecret: string,
  symbol: string, side: "LONG" | "SHORT"
): Promise<ExchangeOrder> {
  const closeSide = side === "LONG" ? "SELL" : "BUY";

  // Get current position size
  const positions = await binanceFuturesRequest("GET", "/fapi/v2/positionRisk", {
    symbol: symbol.replace("-", ""),
  }, apiKey, apiSecret);

  const pos = positions.find((p: any) => p.symbol === symbol.replace("-", ""));
  const qty = Math.abs(parseFloat(pos?.positionAmt || "0"));

  if (qty === 0) return { orderId: "no_position", status: "NO_POSITION" };

  const order = await binanceFuturesRequest("POST", "/fapi/v1/order", {
    symbol: symbol.replace("-", ""),
    side: closeSide,
    type: "MARKET",
    quantity: qty.toFixed(getDecimalPlaces(symbol)),
    reduceOnly: "true",
  }, apiKey, apiSecret);

  return {
    orderId: String(order.orderId),
    status: order.status,
    filledPrice: parseFloat(order.avgPrice || "0"),
    filledQty: parseFloat(order.executedQty || "0"),
    raw: order,
  };
}

function getDecimalPlaces(symbol: string): number {
  const m: Record<string, number> = {
    "BTCUSDT": 3, "ETHUSDT": 3, "SOLUSDT": 1, "BNBUSDT": 2,
    "DOGEUSDT": 0, "XRPUSDT": 1, "ADAUSDT": 0, "AVAXUSDT": 1,
    "LINKUSDT": 1, "DOTUSDT": 1,
  };
  return m[symbol.replace("-", "")] ?? 2;
}

// ─── Other Exchanges (stubs for Phase 3) ────────────────────

async function executeOnExchange(
  exchange: string, apiKey: string, apiSecret: string, passphrase: string,
  symbol: string, side: "LONG" | "SHORT", sizeUsd: number,
  leverage: number, stopLoss: number, takeProfit: number, price: number
): Promise<ExchangeOrder> {
  switch (exchange) {
    case "binance":
      return binanceOpenPosition(apiKey, apiSecret, symbol, side, sizeUsd, leverage, stopLoss, takeProfit, price);
    case "bybit":
    case "okx":
    case "bitget":
      // Phase 3: implement these
      throw new Error(`${exchange} not yet implemented`);
    case "hyperliquid":
    case "dydx":
      // Phase 4: on-chain exchanges
      throw new Error(`${exchange} not yet implemented`);
    default:
      throw new Error(`Unknown exchange: ${exchange}`);
  }
}

// ═══════════════════════════════════════════════════════════════
//  CRYPTO HELPERS
// ═══════════════════════════════════════════════════════════════

function decryptApiKey(encrypted: string): string {
  // Simple XOR decrypt with key — in production use AES-256-GCM
  if (!encrypted) return "";
  try {
    const data = atob(encrypted);
    let result = "";
    for (let i = 0; i < data.length; i++) {
      result += String.fromCharCode(data.charCodeAt(i) ^ ENCRYPTION_KEY.charCodeAt(i % ENCRYPTION_KEY.length));
    }
    return result;
  } catch {
    return encrypted; // fallback: stored in plain text
  }
}

// ═══════════════════════════════════════════════════════════════
//  MAIN EXECUTOR
// ═══════════════════════════════════════════════════════════════

serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const results = {
    signals_found: 0,
    configs_matched: 0,
    orders_created: 0,
    orders_executed: 0,
    positions_checked: 0,
    positions_closed: 0,
    errors: [] as string[],
  };

  try {
    // ── 1. Find new signals (paper_trades opened in last 2 minutes) ──
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: newTrades } = await supabase
      .from("paper_trades")
      .select("id, asset, side, entry_price, leverage, stop_loss, take_profit, primary_model, strategy_type")
      .eq("status", "open")
      .gte("opened_at", twoMinAgo)
      .order("opened_at", { ascending: false })
      .limit(20);

    results.signals_found = newTrades?.length || 0;

    // ── 2. For each signal, find matching user configs ──
    for (const trade of (newTrades || [])) {
      const { data: configs } = await supabase
        .from("user_trade_configs")
        .select("*")
        .eq("is_active", true)
        .eq("api_connected", true)
        .contains("models_follow", [trade.primary_model])
        .contains("strategies_follow", [trade.strategy_type])
        .contains("coins_follow", [trade.asset]);

      for (const cfg of (configs || [])) {
        results.configs_matched++;

        // ── 3. Risk validation ──
        // Check existing position count
        const { count: openCount } = await supabase
          .from("copy_trade_orders")
          .select("id", { count: "exact", head: true })
          .eq("user_wallet", cfg.wallet_address)
          .in("status", ["filled", "partial"]);

        if ((openCount || 0) >= cfg.max_positions) {
          results.errors.push(`${cfg.wallet_address}: max positions (${cfg.max_positions}) reached`);
          continue;
        }

        // Check daily loss limit
        const { data: dailyPnl } = await supabase.rpc("get_user_daily_pnl", { p_wallet: cfg.wallet_address });
        const dailyLossLimit = -(cfg.position_size_usd * cfg.max_positions * cfg.max_daily_loss_pct / 100);
        if ((dailyPnl || 0) < dailyLossLimit) {
          results.errors.push(`${cfg.wallet_address}: daily loss limit hit`);
          continue;
        }

        // Check total position size
        const { data: totalOpen } = await supabase.rpc("get_user_open_position_usd", { p_wallet: cfg.wallet_address });
        const maxTotal = cfg.node_type === "MAX" ? 50000 : 5000;
        if ((totalOpen || 0) + cfg.position_size_usd > maxTotal) {
          results.errors.push(`${cfg.wallet_address}: position total limit`);
          continue;
        }

        // Don't duplicate same signal
        const { count: dupCount } = await supabase
          .from("copy_trade_orders")
          .select("id", { count: "exact", head: true })
          .eq("user_wallet", cfg.wallet_address)
          .eq("signal_id", trade.id);
        if ((dupCount || 0) > 0) continue;

        // ── 4. Calculate order params ──
        const symbol = `${trade.asset}-USDT`;
        const leverage = Math.min(trade.leverage || 1, cfg.max_leverage);
        const sl = trade.stop_loss;
        const tp = trade.take_profit;

        // Override SL/TP with user's config if tighter
        const userSl = trade.side === "LONG"
          ? trade.entry_price * (1 - cfg.stop_loss_pct / 100)
          : trade.entry_price * (1 + cfg.stop_loss_pct / 100);
        const userTp = trade.side === "LONG"
          ? trade.entry_price * (1 + cfg.take_profit_pct / 100)
          : trade.entry_price * (1 - cfg.take_profit_pct / 100);

        const finalSl = trade.side === "LONG"
          ? Math.max(sl, userSl) // tighter SL for longs
          : Math.min(sl, userSl);
        const finalTp = trade.side === "LONG"
          ? Math.min(tp, userTp) // tighter TP for longs
          : Math.max(tp, userTp);

        // ── 5. Create order record ──
        const orderRecord = {
          user_wallet: cfg.wallet_address,
          config_id: cfg.id,
          signal_id: trade.id,
          primary_model: trade.primary_model,
          strategy_type: trade.strategy_type,
          exchange: cfg.exchange,
          symbol,
          side: trade.side,
          leverage,
          entry_price: trade.entry_price,
          size_usd: cfg.position_size_usd,
          stop_loss: finalSl,
          take_profit: finalTp,
          status: "pending" as const,
        };

        // ── 6. Execute based on mode ──
        if (cfg.execution_mode === "paper") {
          // Paper trade: just record, mark as filled immediately
          const { error } = await supabase.from("copy_trade_orders").insert({
            ...orderRecord,
            status: "filled",
            exchange_order_id: `paper_${Date.now()}`,
            size: cfg.position_size_usd / trade.entry_price,
          });
          if (!error) results.orders_created++;

        } else if (cfg.execution_mode === "signal") {
          // Signal only: record + would send notification (Telegram)
          await supabase.from("copy_trade_orders").insert({
            ...orderRecord,
            status: "filled",
            exchange_order_id: `signal_${Date.now()}`,
            size: cfg.position_size_usd / trade.entry_price,
          });
          results.orders_created++;
          // TODO: send Telegram notification

        } else if (cfg.execution_mode === "semi-auto") {
          // Queue for user confirmation
          await supabase.from("copy_trade_orders").insert({
            ...orderRecord,
            status: "queued",
          });
          results.orders_created++;
          // TODO: push notification asking user to confirm

        } else if (cfg.execution_mode === "full-auto") {
          // Execute on exchange
          try {
            // Decrypt API keys
            const apiKey = decryptApiKey(cfg.api_key_encrypted);
            const apiSecret = decryptApiKey(cfg.api_secret_encrypted);
            const passphrase = decryptApiKey(cfg.api_passphrase_encrypted || "");

            if (!apiKey || !apiSecret) {
              throw new Error("API keys not configured");
            }

            const result = await executeOnExchange(
              cfg.exchange, apiKey, apiSecret, passphrase,
              symbol, trade.side, cfg.position_size_usd,
              leverage, finalSl, finalTp, trade.entry_price
            );

            await supabase.from("copy_trade_orders").insert({
              ...orderRecord,
              status: "filled",
              exchange_order_id: result.orderId,
              entry_price: result.filledPrice || trade.entry_price,
              size: result.filledQty || (cfg.position_size_usd / trade.entry_price),
              exchange_response: result.raw,
            });

            results.orders_executed++;
            results.orders_created++;
          } catch (e: any) {
            await supabase.from("copy_trade_orders").insert({
              ...orderRecord,
              status: "failed",
              error_message: e.message,
            });
            results.errors.push(`${cfg.wallet_address}/${cfg.exchange}: ${e.message}`);
          }
        }
      }
    }

    // ── 7. Check open positions for paper SL/TP ──
    await checkPaperPositions(supabase, results);

  } catch (e: any) {
    results.errors.push(`Fatal: ${e.message}`);
  }

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" },
  });
});

// ═══════════════════════════════════════════════════════════════
//  CHECK PAPER/SIGNAL POSITIONS FOR SL/TP
// ═══════════════════════════════════════════════════════════════

async function checkPaperPositions(supabase: any, results: any) {
  // Get all open paper/signal positions
  const { data: openOrders } = await supabase
    .from("copy_trade_orders")
    .select("id, symbol, side, entry_price, stop_loss, take_profit, size_usd, user_wallet, config_id")
    .in("status", ["filled", "partial"])
    .or("exchange_order_id.like.paper_%,exchange_order_id.like.signal_%")
    .limit(100);

  if (!openOrders?.length) return;
  results.positions_checked = openOrders.length;

  // Get current prices
  const assets = [...new Set(openOrders.map((o: any) => o.symbol.replace("-USDT", "")))];
  const prices: Record<string, number> = {};

  try {
    const symbols = assets.map(a => `"${a}USDT"`).join(",");
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbols=[${symbols}]`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      for (const d of data) {
        prices[d.symbol.replace("USDT", "")] = parseFloat(d.price);
      }
    }
  } catch { /* fallback below */ }

  for (const order of openOrders) {
    const asset = order.symbol.replace("-USDT", "");
    const currentPrice = prices[asset];
    if (!currentPrice) continue;

    const isLong = order.side === "LONG";
    const hitSL = isLong
      ? currentPrice <= order.stop_loss
      : currentPrice >= order.stop_loss;
    const hitTP = isLong
      ? currentPrice >= order.take_profit
      : currentPrice <= order.take_profit;

    if (hitSL || hitTP) {
      const pnlPct = isLong
        ? ((currentPrice - order.entry_price) / order.entry_price) * 100
        : ((order.entry_price - currentPrice) / order.entry_price) * 100;
      const pnlUsd = order.size_usd * (pnlPct / 100);

      // Get config for fee calculation
      const { data: cfg } = await supabase
        .from("user_trade_configs")
        .select("node_type")
        .eq("id", order.config_id)
        .single();

      const feeRate = cfg?.node_type === "MAX" ? 0.15 : 0.20;
      const feeUsd = pnlUsd > 0 ? pnlUsd * feeRate : 0; // only charge on profit

      await supabase.from("copy_trade_orders").update({
        status: "closed",
        exit_price: currentPrice,
        pnl_pct: parseFloat(pnlPct.toFixed(4)),
        pnl_usd: parseFloat(pnlUsd.toFixed(2)),
        fee_usd: parseFloat(feeUsd.toFixed(2)),
        closed_at: new Date().toISOString(),
      }).eq("id", order.id);

      results.positions_closed++;
    }
  }
}
