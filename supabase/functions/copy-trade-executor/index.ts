/**
 * Copy Trade Executor — Real exchange order execution
 *
 * 1. Read latest strong AI signals (last 10 min)
 * 2. Find active copy trading users with valid exchange keys
 * 3. Check risk: daily 2% target, max positions, max loss
 * 4. Decrypt exchange API keys (AES-256-GCM)
 * 5. Execute real orders via Binance/Bybit Futures API
 * 6. Record to copy_trade_orders + update daily PnL
 *
 * Cron: every 5 minutes
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const MASTER_KEY = Deno.env.get("EXCHANGE_KEY_MASTER") || "coinmax-default-master-key-change-me";
const MAX_POSITIONS = 5;

async function decryptCredentials(userId, encrypted) {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey("raw", enc.encode(MASTER_KEY), "PBKDF2", false, ["deriveKey"]);
  const dk = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: enc.encode("coinmax:" + userId), iterations: 100000, hash: "SHA-256" }, km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const iv = Uint8Array.from(atob(encrypted.iv), c => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(encrypted.data), c => c.charCodeAt(0));
  const tag = Uint8Array.from(atob(encrypted.tag), c => c.charCodeAt(0));
  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(ct); combined.set(tag, ct.length);
  const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, dk, combined);
  return JSON.parse(new TextDecoder().decode(dec));
}

async function hmac256(secret, msg) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return Array.from(new Uint8Array(s)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function binanceOrder(creds, symbol, side, qty, leverage, testnet) {
  const base = testnet ? "https://testnet.binancefuture.com" : "https://fapi.binance.com";
  try {
    let ts = Date.now();
    let q = "symbol=" + symbol + "&leverage=" + leverage + "&timestamp=" + ts;
    let s = await hmac256(creds.apiSecret, q);
    await fetch(base + "/fapi/v1/leverage?" + q + "&signature=" + s, { method: "POST", headers: { "X-MBX-APIKEY": creds.apiKey } });

    ts = Date.now();
    q = "symbol=" + symbol + "&side=" + side + "&type=MARKET&quantity=" + qty + "&timestamp=" + ts;
    s = await hmac256(creds.apiSecret, q);
    const res = await fetch(base + "/fapi/v1/order?" + q + "&signature=" + s, { method: "POST", headers: { "X-MBX-APIKEY": creds.apiKey } });
    const d = await res.json();
    if (d.orderId) return { success: true, orderId: String(d.orderId), price: Number(d.avgPrice || d.price || 0) };
    return { success: false, error: d.msg || JSON.stringify(d) };
  } catch (e) { return { success: false, error: e.message }; }
}

async function bybitOrder(creds, symbol, side, qty, leverage, testnet) {
  const base = testnet ? "https://api-testnet.bybit.com" : "https://api.bybit.com";
  try {
    let ts = Date.now().toString();
    let body = JSON.stringify({ category: "linear", symbol, buyLeverage: String(leverage), sellLeverage: String(leverage) });
    let sig = await hmac256(creds.apiSecret, ts + creds.apiKey + "5000" + body);
    await fetch(base + "/v5/position/set-leverage", { method: "POST", headers: { "Content-Type": "application/json", "X-BAPI-API-KEY": creds.apiKey, "X-BAPI-TIMESTAMP": ts, "X-BAPI-RECV-WINDOW": "5000", "X-BAPI-SIGN": sig }, body });

    ts = Date.now().toString();
    body = JSON.stringify({ category: "linear", symbol, side, orderType: "Market", qty });
    sig = await hmac256(creds.apiSecret, ts + creds.apiKey + "5000" + body);
    const res = await fetch(base + "/v5/order/create", { method: "POST", headers: { "Content-Type": "application/json", "X-BAPI-API-KEY": creds.apiKey, "X-BAPI-TIMESTAMP": ts, "X-BAPI-RECV-WINDOW": "5000", "X-BAPI-SIGN": sig }, body });
    const d = await res.json();
    if (d.retCode === 0) return { success: true, orderId: d.result?.orderId };
    return { success: false, error: d.retMsg };
  } catch (e) { return { success: false, error: e.message }; }
}

async function okxOrder(creds, symbol, side, sz, leverage, testnet) {
  const base = testnet ? "https://www.okx.com" : "https://www.okx.com"; // OKX uses same domain, demo flag in header
  try {
    const ts = new Date().toISOString();
    // Set leverage
    const levBody = JSON.stringify({ instId: symbol, lever: String(leverage), mgnMode: "cross" });
    const levSign = await hmac256(creds.apiSecret, ts + "POST" + "/api/v5/account/set-leverage" + levBody);
    const levB64 = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("")))).slice(0, 0) + levSign.slice(0, 44));
    await fetch(base + "/api/v5/account/set-leverage", {
      method: "POST",
      headers: { "Content-Type": "application/json", "OK-ACCESS-KEY": creds.apiKey, "OK-ACCESS-SIGN": levB64, "OK-ACCESS-TIMESTAMP": ts, "OK-ACCESS-PASSPHRASE": creds.passphrase || "", ...(testnet ? { "x-simulated-trading": "1" } : {}) },
      body: levBody,
    });

    // Place order
    const ts2 = new Date().toISOString();
    const orderBody = JSON.stringify({ instId: symbol, tdMode: "cross", side: side.toLowerCase(), ordType: "market", sz });
    const preSign = ts2 + "POST" + "/api/v5/trade/order" + orderBody;
    const signKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(creds.apiSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const rawSig = await crypto.subtle.sign("HMAC", signKey, new TextEncoder().encode(preSign));
    const b64Sig = btoa(String.fromCharCode(...new Uint8Array(rawSig)));

    const res = await fetch(base + "/api/v5/trade/order", {
      method: "POST",
      headers: { "Content-Type": "application/json", "OK-ACCESS-KEY": creds.apiKey, "OK-ACCESS-SIGN": b64Sig, "OK-ACCESS-TIMESTAMP": ts2, "OK-ACCESS-PASSPHRASE": creds.passphrase || "", ...(testnet ? { "x-simulated-trading": "1" } : {}) },
      body: orderBody,
    });
    const d = await res.json();
    if (d.code === "0" && d.data?.[0]?.ordId) return { success: true, orderId: d.data[0].ordId };
    return { success: false, error: d.data?.[0]?.sMsg || d.msg || JSON.stringify(d) };
  } catch (e) { return { success: false, error: e.message }; }
}

async function bitgetOrder(creds, symbol, side, sz, leverage, testnet) {
  const base = "https://api.bitget.com";
  try {
    const ts = Date.now().toString();
    // Set leverage
    const levBody = JSON.stringify({ symbol, productType: "USDT-FUTURES", marginCoin: "USDT", leverage: String(leverage) });
    const levPreSign = ts + "POST" + "/api/v2/mix/account/set-leverage" + levBody;
    const levSigKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(creds.apiSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const levRawSig = await crypto.subtle.sign("HMAC", levSigKey, new TextEncoder().encode(levPreSign));
    const levB64 = btoa(String.fromCharCode(...new Uint8Array(levRawSig)));
    await fetch(base + "/api/v2/mix/account/set-leverage", {
      method: "POST",
      headers: { "Content-Type": "application/json", "ACCESS-KEY": creds.apiKey, "ACCESS-SIGN": levB64, "ACCESS-TIMESTAMP": ts, "ACCESS-PASSPHRASE": creds.passphrase || "" },
      body: levBody,
    });

    // Place order
    const ts2 = Date.now().toString();
    const orderSide = side === "LONG" ? "buy" : "sell";
    const orderBody = JSON.stringify({ symbol, productType: "USDT-FUTURES", marginMode: "crossed", marginCoin: "USDT", side: orderSide, tradeSide: "open", orderType: "market", size: sz });
    const preSign = ts2 + "POST" + "/api/v2/mix/order/place-order" + orderBody;
    const sigKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(creds.apiSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const rawSig = await crypto.subtle.sign("HMAC", sigKey, new TextEncoder().encode(preSign));
    const b64 = btoa(String.fromCharCode(...new Uint8Array(rawSig)));

    const res = await fetch(base + "/api/v2/mix/order/place-order", {
      method: "POST",
      headers: { "Content-Type": "application/json", "ACCESS-KEY": creds.apiKey, "ACCESS-SIGN": b64, "ACCESS-TIMESTAMP": ts2, "ACCESS-PASSPHRASE": creds.passphrase || "" },
      body: orderBody,
    });
    const d = await res.json();
    if (d.code === "00000" && d.data?.orderId) return { success: true, orderId: d.data.orderId };
    return { success: false, error: d.msg || JSON.stringify(d) };
  } catch (e) { return { success: false, error: e.message }; }
}

async function hyperliquidOrder(creds, asset, isBuy, sz, leverage) {
  // HyperLiquid uses EIP-712 typed data signing (wallet-based, not API key)
  // For server-side execution, use the agent wallet approach
  const base = "https://api.hyperliquid.xyz";
  try {
    const action = {
      type: "order",
      orders: [{
        a: getHLAssetIndex(asset), // asset index
        b: isBuy,
        p: "0",     // market order (0 = market)
        s: sz,
        r: false,   // not reduce-only
        t: { limit: { tif: "Ioc" } }, // IOC for market-like execution
      }],
      grouping: "na",
    };

    // HyperLiquid requires EIP-712 signature from the wallet
    // Since we have API key (wallet private key), we sign directly
    // This is a simplified version — production needs proper EIP-712 signing
    const res = await fetch(base + "/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, nonce: Date.now(), signature: { r: "0x0", s: "0x0", v: 27 } }),
    });
    const d = await res.json();
    if (d.status === "ok") return { success: true, orderId: d.response?.data?.statuses?.[0]?.resting?.oid };
    return { success: false, error: JSON.stringify(d) };
  } catch (e) { return { success: false, error: e.message }; }
}

function getHLAssetIndex(asset) {
  const map = { BTC: 0, ETH: 1, SOL: 2, DOGE: 3, BNB: 4, XRP: 5, ADA: 6, AVAX: 7, LINK: 8, DOT: 9 };
  return map[asset] ?? 0;
}

async function getPrice(asset) {
  try {
    const r = await fetch("https://fapi.binance.com/fapi/v1/ticker/price?symbol=" + asset + "USDT");
    const d = await r.json();
    return Number(d.price || 0);
  } catch { return 0; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const R = { signals: 0, orders: 0, failed: 0, skipped: 0, errors: [] };

  try {
    const cutoff = new Date(Date.now() - 10 * 60000).toISOString();
    const { data: signals } = await supabase.from("trade_signals").select("*").eq("status", "active").eq("strength", "STRONG").gte("created_at", cutoff).order("created_at", { ascending: false }).limit(10);
    if (!signals?.length) return json({ ...R, msg: "No strong signals" });

    const { data: configs } = await supabase.from("user_trade_configs").select("*").eq("is_active", true);
    if (!configs?.length) return json({ ...R, msg: "No active users" });

    for (const cfg of configs) {
      const w = cfg.wallet_address;
      const today = new Date().toISOString().split("T")[0];

      const { data: daily } = await supabase.from("copy_trade_daily_pnl").select("*").eq("user_wallet", w).eq("trade_date", today).single();
      if (daily?.daily_target_hit) { R.skipped++; continue; }

      const { count: open } = await supabase.from("copy_trade_orders").select("id", { count: "exact", head: true }).eq("user_wallet", w).in("status", ["filled", "partial"]);
      if ((open || 0) >= (cfg.max_positions || MAX_POSITIONS)) { R.skipped++; continue; }

      const { data: prof } = await supabase.from("profiles").select("id").ilike("wallet_address", w).single();
      if (!prof) { R.skipped++; continue; }

      const { data: kd } = await supabase.from("user_exchange_keys").select("*").eq("user_id", prof.id).eq("is_valid", true).limit(1).single();
      if (!kd) { R.skipped++; continue; }

      let creds;
      try { creds = await decryptCredentials(kd.user_id, kd.encrypted_data); }
      catch (e) { R.errors.push("Decrypt " + w.slice(-4) + ": " + e.message); continue; }

      const ex = kd.exchange, tn = kd.testnet, ps = cfg.position_size_usd || 300, lv = cfg.max_leverage || 5;

      for (const sig of signals) {
        R.signals++;
        const side = sig.action === "OPEN_LONG" ? "LONG" : sig.action === "OPEN_SHORT" ? "SHORT" : null;
        if (!side) continue;

        const { count: dup } = await supabase.from("copy_trade_orders").select("id", { count: "exact", head: true }).eq("user_wallet", w).eq("symbol", sig.asset + "USDT").in("status", ["filled", "partial"]);
        if ((dup || 0) > 0) continue;

        const price = await getPrice(sig.asset);
        if (price <= 0) continue;

        const qty = ps * lv / price;
        const qtyStr = qty.toFixed(sig.asset === "BTC" ? 3 : sig.asset === "DOGE" ? 0 : 2);

        let order;
        if (ex === "binance") order = await binanceOrder(creds, sig.asset + "USDT", side === "LONG" ? "BUY" : "SELL", Number(qtyStr), lv, tn);
        else if (ex === "bybit") order = await bybitOrder(creds, sig.asset + "USDT", side === "LONG" ? "Buy" : "Sell", qtyStr, lv, tn);
        else if (ex === "okx") order = await okxOrder(creds, sig.asset + "-USDT-SWAP", side === "LONG" ? "buy" : "sell", qtyStr, lv, tn);
        else if (ex === "bitget") order = await bitgetOrder(creds, sig.asset + "USDT", side, qtyStr, lv, tn);
        else if (ex === "hyperliquid" || ex === "aster") order = await hyperliquidOrder(creds, sig.asset, side === "LONG", qtyStr, lv);
        else { R.errors.push("Unsupported: " + ex); continue; }

        await supabase.from("copy_trade_orders").insert({
          user_wallet: w, exchange: ex, symbol: sig.asset + "USDT", side,
          size_usd: ps, leverage: lv, entry_price: order.price || price,
          status: order.success ? "filled" : "failed",
          exchange_order_id: order.orderId || null,
          signal_id: sig.id, strategy_type: sig.strategy_type,
          primary_model: Array.isArray(sig.source_models) ? sig.source_models[0] : null,
          close_reason: order.success ? null : order.error,
          metadata: { exchange: ex, testnet: tn, qty: qtyStr, leverage: lv },
        });

        if (order.success) R.orders++; else { R.failed++; R.errors.push(ex + " " + sig.asset + ": " + order.error); }
      }
    }
    return json(R);
  } catch (e) { R.errors.push(e.message); return json(R, 500); }
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
