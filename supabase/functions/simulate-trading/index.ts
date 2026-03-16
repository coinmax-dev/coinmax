import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * Simulate Trading — Cron Edge Function (AI-Integrated)
 *
 * Runs every 5 minutes to:
 * 1. Fetch real-time prices + candle data from Binance for ALL assets
 * 2. Load AI model accuracy weights from ai_model_accuracy table
 * 3. Generate weighted multi-model consensus signals per asset
 * 4. Record predictions for ALL timeframes (5m, 15m, 30m, 1H, 4H)
 * 5. Create paper trades from high-confidence signals
 * 6. Check existing paper trades for SL/TP hits and close them
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ASSETS = ["BTC", "ETH", "SOL", "BNB"];

const AI_MODELS = [
  { name: "GPT-4o",    defaultWeight: 0.5 },
  { name: "DeepSeek",  defaultWeight: 0.8 },
  { name: "Llama 3.1", defaultWeight: 0.6 },
  { name: "Gemini",    defaultWeight: 0.4 },
  { name: "Grok",      defaultWeight: 0.4 },
];

const PREDICTION_TIMEFRAMES = [
  { tf: "5m",  interval: "1m",  expiresMin: 5,    candleLimit: 20 },
  { tf: "15m", interval: "5m",  expiresMin: 15,   candleLimit: 20 },
  { tf: "30m", interval: "5m",  expiresMin: 30,   candleLimit: 30 },
  { tf: "1H",  interval: "15m", expiresMin: 60,   candleLimit: 30 },
  { tf: "4H",  interval: "1h",  expiresMin: 240,  candleLimit: 30 },
];

// ── Price & candle fetching ─────────────────────────────────

async function fetchPrices(): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  await Promise.all(
    ASSETS.map(async (asset) => {
      try {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${asset}USDT`);
        if (res.ok) { const d = await res.json(); const p = parseFloat(d.price); if (p > 0) prices[asset] = p; }
      } catch {}
    })
  );
  return prices;
}

interface Candle { open: number; high: number; low: number; close: number; volume: number; }

async function fetchCandles(asset: string, interval: string, limit: number): Promise<Candle[]> {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${asset}USDT&interval=${interval}&limit=${limit}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((k: any[]) => ({
      open: parseFloat(k[1]), high: parseFloat(k[2]),
      low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
    }));
  } catch { return []; }
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

function calcMACD(candles: Candle[]) {
  const ema12 = calcEMA(candles, 12);
  const ema26 = calcEMA(candles, 26);
  const macd = ema12 - ema26;
  return { macd, signal: macd * 0.8, histogram: macd - macd * 0.8 };
}

function calcMomentum(candles: Candle[]): number {
  if (candles.length < 5) return 0;
  const r = candles.slice(-5);
  return ((r[4].close - r[0].close) / r[0].close) * 100;
}

function calcVolatility(candles: Candle[]): number {
  if (candles.length < 10) return 1;
  const ret: number[] = [];
  for (let i = 1; i < candles.length; i++) ret.push(Math.abs((candles[i].close - candles[i - 1].close) / candles[i - 1].close));
  return ret.reduce((s, v) => s + v, 0) / ret.length * 100;
}

function calcBB(candles: Candle[], period = 20) {
  const closes = candles.slice(-period).map(c => c.close);
  if (closes.length < period) return { pctB: 0.5 };
  const mean = closes.reduce((s, v) => s + v, 0) / closes.length;
  const std = Math.sqrt(closes.reduce((s, v) => s + (v - mean) ** 2, 0) / closes.length);
  const upper = mean + 2 * std, lower = mean - 2 * std;
  return { pctB: std > 0 ? (closes[closes.length - 1] - lower) / (upper - lower) : 0.5 };
}

// ── Model vote simulation ───────────────────────────────────

interface ModelVote { model: string; direction: "BULLISH" | "BEARISH" | "NEUTRAL"; confidence: number; weight: number; }

function simulateModelVote(name: string, rsi: number, mom: number, macd: { histogram: number }, bb: { pctB: number }, vol: number): { direction: "BULLISH" | "BEARISH" | "NEUTRAL"; confidence: number } {
  let ls = 0, ss = 0;
  const n1 = (Math.random() - 0.5) * 8, n2 = (Math.random() - 0.5) * 8;

  switch (name) {
    case "DeepSeek":
      if (rsi < 35) ls += 30; else if (rsi > 65) ss += 30;
      if (mom > 0.3) ls += 25; else if (mom < -0.3) ss += 25;
      if (macd.histogram > 0) ls += 20; else ss += 20;
      ls += n1; ss += n2; break;
    case "Llama 3.1":
      if (rsi < 30) ls += 35; else if (rsi > 70) ss += 35;
      if (bb.pctB < 0.2) ls += 25; else if (bb.pctB > 0.8) ss += 25;
      ls += n1 * 1.2; ss += n2 * 1.2; break;
    case "GPT-4o":
      if (rsi < 25) ls += 20; else if (rsi > 75) ss += 20;
      if (mom > 0.3) ls += 15; else if (mom < -0.3) ss += 15;
      ls += n1 * 1.5; ss += n2 * 1.5; break;
    case "Gemini":
      if (vol > 1.5 && mom > 0) ls += 25; else if (vol > 1.5 && mom < 0) ss += 25;
      if (rsi < 40) ls += 15; else if (rsi > 60) ss += 15;
      ls += n1 * 1.3; ss += n2 * 1.3; break;
    case "Grok":
      if (rsi > 70) ls += 10; else if (rsi < 30) ss += 10;
      if (mom > 0.5) ss += 15; else if (mom < -0.5) ls += 15;
      ls += n1 * 1.8; ss += n2 * 1.8; break;
  }

  const net = ls - ss, abs = Math.abs(net);
  if (abs < 8) return { direction: "NEUTRAL", confidence: Math.min(55, 40 + Math.random() * 15) };
  if (net > 0) return { direction: "BULLISH", confidence: Math.min(95, 50 + abs * 1.5 + Math.random() * 5) };
  return { direction: "BEARISH", confidence: Math.min(95, 50 + abs * 1.5 + Math.random() * 5) };
}

// ── Consensus ───────────────────────────────────────────────

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
  const results = { signals_generated: 0, paper_trades_opened: 0, paper_trades_closed: 0, predictions_recorded: 0, prices: {} as Record<string, number>, errors: [] as string[] };

  try {
    const prices = await fetchPrices();
    results.prices = prices;
    if (Object.keys(prices).length === 0) return new Response(JSON.stringify({ error: "No prices" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Load model weights
    const { data: accData } = await supabase.from("ai_model_accuracy").select("model, asset, accuracy_pct, computed_weight").eq("period", "7d");
    const mw: Record<string, Record<string, { weight: number }>> = {};
    if (accData) for (const r of accData) { if (!mw[r.model]) mw[r.model] = {}; mw[r.model][r.asset] = { weight: r.computed_weight || 0.5 }; }

    // Check open paper trades
    const { data: openTrades } = await supabase.from("paper_trades").select("*").eq("status", "OPEN");
    if (openTrades) {
      for (const t of openTrades) {
        const cp = prices[t.asset.split("-")[0]];
        if (!cp) continue;
        let cr: string | null = null;
        if (t.side === "LONG") { if (cp <= t.stop_loss) cr = "STOP_LOSS"; else if (cp >= t.take_profit) cr = "TAKE_PROFIT"; }
        else { if (cp >= t.stop_loss) cr = "STOP_LOSS"; else if (cp <= t.take_profit) cr = "TAKE_PROFIT"; }
        if (Date.now() - new Date(t.opened_at).getTime() > 24 * 3600_000) cr = "TIME_LIMIT";
        if (cr) {
          const mul = t.side === "LONG" ? 1 : -1;
          const pnl = t.size * (cp - t.entry_price) * mul * t.leverage;
          const pnlPct = ((cp - t.entry_price) / t.entry_price) * 100 * mul;
          await supabase.from("paper_trades").update({ status: "CLOSED", exit_price: cp, pnl: parseFloat(pnl.toFixed(4)), pnl_pct: parseFloat(pnlPct.toFixed(4)), close_reason: cr, closed_at: new Date().toISOString() }).eq("id", t.id);
          if (t.signal_id) await supabase.from("trade_signals").update({ status: "executed", result_pnl: parseFloat(pnl.toFixed(4)), close_reason: cr, resolved_at: new Date().toISOString() }).eq("id", t.signal_id);
          results.paper_trades_closed++;
        }
      }
    }

    const openCount = openTrades?.filter(t => t.status === "OPEN").length ?? 0;

    // Process ALL assets
    for (const asset of ASSETS) {
      if (!prices[asset]) continue;
      const currentPrice = prices[asset];

      // Fetch candles for signal generation (5m interval, 30 candles)
      const candles = await fetchCandles(asset, "5m", 30);
      if (candles.length < 15) continue;

      const rsi = calcRSI(candles);
      const mom = calcMomentum(candles);
      const macd = calcMACD(candles);
      const bb = calcBB(candles);
      const vol = calcVolatility(candles);

      // Model votes
      const votes: ModelVote[] = AI_MODELS.map(m => {
        const v = simulateModelVote(m.name, rsi, mom, macd, bb, vol);
        return { model: m.name, direction: v.direction, confidence: v.confidence, weight: mw[m.name]?.[asset]?.weight ?? m.defaultWeight };
      });

      const consensus = buildConsensus(votes);
      const signalId = crypto.randomUUID();
      const dir = consensus.action === "OPEN_LONG" ? "LONG" : consensus.action === "OPEN_SHORT" ? "SHORT" : "NEUTRAL";
      const techCtx = `RSI=${rsi.toFixed(1)},Mom=${mom.toFixed(2)}%,MACD=${macd.histogram.toFixed(4)},BB=${bb.pctB.toFixed(2)},Vol=${vol.toFixed(2)}%`;

      // Insert trade signal
      const { error: sigErr } = await supabase.from("trade_signals").insert({
        id: signalId, asset, action: consensus.action, direction: dir,
        probabilities: consensus.probabilities, confidence: consensus.confidence,
        stop_loss_pct: Math.max(0.01, Math.min(0.05, vol * 0.015)),
        take_profit_pct: Math.max(0.015, Math.min(0.08, vol * 0.025)),
        leverage: Math.min(5, Math.max(1, Math.round(consensus.confidence / 25))),
        position_size_pct: parseFloat((0.2 + (consensus.confidence / 100) * 0.3).toFixed(2)),
        strategy_type: vol > 1.5 ? "directional" : vol < 0.5 ? "grid" : "dca",
        strength: consensus.strength, source_models: consensus.sourceModels,
        rag_context: techCtx, status: "active", created_at: new Date().toISOString(),
      });
      if (sigErr) { results.errors.push(`Signal ${asset}: ${sigErr.message}`); continue; }
      results.signals_generated++;

      // Broadcast
      await supabase.channel("trade-signals").send({
        type: "broadcast", event: "new_signal",
        payload: { id: signalId, asset, action: consensus.action, confidence: consensus.confidence, strength: consensus.strength, leverage: Math.min(5, Math.max(1, Math.round(consensus.confidence / 25))), source_models: consensus.sourceModels, status: "active", created_at: new Date().toISOString() },
      }).catch(() => {});

      // Record predictions for ALL timeframes with per-timeframe candle data
      for (const { tf, interval, expiresMin, candleLimit } of PREDICTION_TIMEFRAMES) {
        const tfCandles = await fetchCandles(asset, interval, candleLimit);
        const tfRsi = tfCandles.length >= 15 ? calcRSI(tfCandles) : rsi;
        const tfMom = tfCandles.length >= 5 ? calcMomentum(tfCandles) : mom;
        const tfVol = tfCandles.length >= 10 ? calcVolatility(tfCandles) : vol;
        const tfScale = tf === "5m" ? 0.15 : tf === "15m" ? 0.25 : tf === "30m" ? 0.35 : tf === "1H" ? 0.5 : 0.8;
        const expiresAt = new Date(Date.now() + expiresMin * 60_000).toISOString();

        for (const vote of votes) {
          // Re-simulate with timeframe-specific data for more accurate per-tf predictions
          const tfVote = tfCandles.length >= 10
            ? simulateModelVote(vote.model, tfRsi, tfMom, macd, bb, tfVol)
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

      // Open paper trade for strong signals
      if ((consensus.strength === "STRONG" || consensus.strength === "MEDIUM") && consensus.action !== "HOLD" && openCount + results.paper_trades_opened < 5) {
        const slPct = Math.max(0.01, Math.min(0.05, vol * 0.015));
        const tpPct = Math.max(0.015, Math.min(0.08, vol * 0.025));
        const posUsd = 1000 * (0.2 + (consensus.confidence / 100) * 0.3);
        const lev = Math.min(5, Math.max(1, Math.round(consensus.confidence / 25)));
        const sl = consensus.action === "OPEN_LONG" ? currentPrice * (1 - slPct) : currentPrice * (1 + slPct);
        const tp = consensus.action === "OPEN_LONG" ? currentPrice * (1 + tpPct) : currentPrice * (1 - tpPct);

        const { error: tErr } = await supabase.from("paper_trades").insert({
          signal_id: signalId, asset, side: consensus.action === "OPEN_LONG" ? "LONG" : "SHORT",
          entry_price: currentPrice, size: parseFloat((posUsd / currentPrice).toFixed(8)),
          leverage: lev, stop_loss: parseFloat(sl.toFixed(2)), take_profit: parseFloat(tp.toFixed(2)),
          status: "OPEN", opened_at: new Date().toISOString(),
        });
        if (tErr) results.errors.push(`Trade ${asset}: ${tErr.message}`);
        else { results.paper_trades_opened++; await supabase.from("trade_signals").update({ status: "executed" }).eq("id", signalId); }
      }
    }
  } catch (err) { results.errors.push(`Unexpected: ${err.message}`); }

  return new Response(JSON.stringify(results), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
