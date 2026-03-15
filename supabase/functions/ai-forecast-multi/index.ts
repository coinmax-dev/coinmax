import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Supabase client (service role for inserts) ──────────────

function getSupabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key);
}

// ── In-memory cache ─────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const forecastCache = new Map<string, CacheEntry<any>>();
const FORECAST_CACHE_TTL = 3 * 60 * 1000; // 3 minutes

let fgiCache: CacheEntry<{ value: number; classification: string }> | null = null;
const FGI_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let priceCache = new Map<string, CacheEntry<number>>();
const PRICE_CACHE_TTL = 30 * 1000; // 30 seconds

// ── Market data ─────────────────────────────────────

async function fetchFearGreedIndex() {
  if (fgiCache && Date.now() < fgiCache.expiresAt) return fgiCache.data;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("https://api.alternative.me/fng/?limit=1", { signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json();
    const result = { value: parseInt(data.data[0].value), classification: data.data[0].value_classification };
    fgiCache = { data: result, expiresAt: Date.now() + FGI_CACHE_TTL };
    return result;
  } catch {
    return { value: 50, classification: "Neutral" };
  }
}

async function fetchCurrentPrice(asset: string): Promise<number> {
  const cached = priceCache.get(asset);
  if (cached && Date.now() < cached.expiresAt) return cached.data;
  // Race Binance global + Bybit — fastest wins
  const pair = `${asset}USDT`;
  const result = await Promise.any([
    fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`).then(async (r) => {
      if (!r.ok) throw new Error("not ok");
      const d = await r.json(); const p = parseFloat(d.price); if (p <= 0) throw new Error("bad"); return p;
    }),
    fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${pair}`).then(async (r) => {
      if (!r.ok) throw new Error("not ok");
      const d = await r.json(); const p = parseFloat(d.result?.list?.[0]?.lastPrice); if (!p) throw new Error("bad"); return p;
    }),
  ]).catch(() => 0);
  if (result > 0) { priceCache.set(asset, { data: result, expiresAt: Date.now() + PRICE_CACHE_TTL }); return result; }
  return 0;
}

// ── Binance Klines + Indicators (Phase 2) ───────────

const BINANCE_TF_MAP: Record<string, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1H": "1h", "4H": "4h", "1D": "1d", "1W": "1w",
};

interface Candle { timestamp: number; open: number; high: number; low: number; close: number; volume: number; }

let klinesCache = new Map<string, CacheEntry<Candle[]>>();

async function fetchKlines(asset: string, tf: string, limit = 100): Promise<Candle[]> {
  const key = `${asset}:${tf}`;
  const cached = klinesCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.data;
  try {
    const interval = BINANCE_TF_MAP[tf] || "1h";
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${asset}USDT&interval=${interval}&limit=${limit}`);
    if (!res.ok) return [];
    const raw = await res.json();
    const candles: Candle[] = raw.map((k: any[]) => ({
      timestamp: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
      low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
    }));
    klinesCache.set(key, { data: candles, expiresAt: Date.now() + 60_000 });
    return candles;
  } catch { return []; }
}

// Inline indicator calculations (same logic as ai-engine/src/indicators.ts)
function _sma(v: number[], p: number) { if (v.length < p) return v[v.length-1]??0; const s=v.slice(-p); return s.reduce((a,b)=>a+b,0)/p; }
function _ema(v: number[], p: number) { if(!v.length)return 0;if(v.length<p)return _sma(v,v.length);const k=2/(p+1);let r=_sma(v.slice(0,p),p);for(let i=p;i<v.length;i++)r=v[i]*k+r*(1-k);return r; }
function _emaArr(v: number[], p: number) { const k=2/(p+1);const r=[_sma(v.slice(0,p),Math.min(p,v.length))];for(let i=1;i<v.length;i++)r.push(v[i]*k+r[i-1]*(1-k));return r; }

function calcRSI(closes: number[], period=14): number {
  if(closes.length<period+1)return 50;let ag=0,al=0;
  for(let i=1;i<=period;i++){const d=closes[i]-closes[i-1];if(d>0)ag+=d;else al+=Math.abs(d);}
  ag/=period;al/=period;
  for(let i=period+1;i<closes.length;i++){const d=closes[i]-closes[i-1];ag=(ag*(period-1)+(d>0?d:0))/period;al=(al*(period-1)+(d<0?Math.abs(d):0))/period;}
  if(al===0)return 100;return 100-100/(1+ag/al);
}

function calcMACD(closes: number[]) {
  const f=_emaArr(closes,12),s=_emaArr(closes,26);
  const ml=f.map((v,i)=>v-s[i]);const sl=_emaArr(ml.slice(-27),9);
  const m=ml[ml.length-1],sig=sl[sl.length-1],h=m-sig;
  let label="NEUTRAL";
  if(ml.length>=2&&sl.length>=2){const pm=ml[ml.length-2],ps=sl[sl.length-2];if(pm<=ps&&m>sig)label="BULLISH_CROSS";else if(pm>=ps&&m<sig)label="BEARISH_CROSS";}
  return {histogram:h,signal:label};
}

function calcBBPosition(closes: number[], period=20) {
  const mid=_sma(closes,period);const sl=closes.slice(-period);
  const v=sl.reduce((s,x)=>s+(x-mid)**2,0)/period;const sd=Math.sqrt(v);
  const u=mid+2*sd,l=mid-2*sd,c=closes[closes.length-1];
  return u===l?0.5:Math.max(0,Math.min(1,(c-l)/(u-l)));
}

function calcSupertrend(candles: Candle[]) {
  // Simplified ATR
  let atr=candles[0].high-candles[0].low;
  for(let i=1;i<Math.min(10,candles.length);i++){
    const c=candles[i],pc=candles[i-1].close;
    const tr=Math.max(c.high-c.low,Math.abs(c.high-pc),Math.abs(c.low-pc));
    atr=(atr*9+tr)/10;
  }
  const last=candles[candles.length-1],hl2=(last.high+last.low)/2;
  return last.close>hl2?"BUY":"SELL";
}

function calcADX(candles: Candle[]) {
  if(candles.length<15)return 25;
  const pd:number[]=[],md:number[]=[];
  for(let i=1;i<candles.length;i++){const u=candles[i].high-candles[i-1].high,d=candles[i-1].low-candles[i].low;pd.push(u>d&&u>0?u:0);md.push(d>u&&d>0?d:0);}
  const sp=_ema(pd,14),sm=_ema(md,14);
  let str=0;for(let i=1;i<candles.length;i++){const c=candles[i],p=candles[i-1].close;str=(str*13+Math.max(c.high-c.low,Math.abs(c.high-p),Math.abs(c.low-p)))/14;}
  const pi=str===0?0:(sp/str)*100,mi=str===0?0:(sm/str)*100,s=pi+mi;
  return s===0?0:(Math.abs(pi-mi)/s)*100;
}

function calcStochastic(candles: Candle[], kp=14) {
  if(candles.length<kp)return{k:50,d:50};
  const sl=candles.slice(-kp),h=Math.max(...sl.map(c=>c.high)),l=Math.min(...sl.map(c=>c.low));
  return {k:h===l?50:((candles[candles.length-1].close-l)/(h-l))*100,d:50};
}

// Candle patterns (inline, simplified)
function detectPatterns(candles: Candle[]): string {
  if(candles.length<3) return "None";
  const n=candles.length,c1=candles[n-3],c2=candles[n-2],c3=candles[n-1];
  const patterns:string[]=[];
  const bs=(c:Candle)=>Math.abs(c.close-c.open),ig=(c:Candle)=>c.close>c.open,ir=(c:Candle)=>c.close<c.open;
  const avg=candles.slice(-10).reduce((s,c)=>s+bs(c),0)/Math.min(10,candles.length);
  // Engulfing
  if(ir(c2)&&ig(c3)&&c3.open<=c2.close&&c3.close>=c2.open) patterns.push("Bullish_Engulfing");
  if(ig(c2)&&ir(c3)&&c3.open>=c2.close&&c3.close<=c2.open) patterns.push("Bearish_Engulfing");
  // Doji
  const r3=c3.high-c3.low;if(r3>0&&bs(c3)/r3<0.1) patterns.push("Doji");
  // Hammer
  const lw=Math.min(c3.open,c3.close)-c3.low,uw=c3.high-Math.max(c3.open,c3.close);
  if(lw>=bs(c3)*2&&uw<bs(c3)*0.5) patterns.push("Hammer");
  if(uw>=bs(c3)*2&&lw<bs(c3)*0.5) patterns.push("Shooting_Star");
  // Three soldiers/crows
  if(ig(c1)&&ig(c2)&&ig(c3)&&c2.close>c1.close&&c3.close>c2.close&&bs(c1)>avg*0.5) patterns.push("Three_White_Soldiers");
  if(ir(c1)&&ir(c2)&&ir(c3)&&c2.close<c1.close&&c3.close<c2.close&&bs(c1)>avg*0.5) patterns.push("Three_Black_Crows");
  return patterns.length?patterns.join(", "):"None";
}

// On-chain data (Binance Futures public API)
interface OnChainData { funding: number; oiChange: number; lsRatio: number; }
let onchainCache = new Map<string, CacheEntry<OnChainData>>();

async function fetchOnChainData(asset: string): Promise<OnChainData> {
  const key = `onchain:${asset}`;
  const cached = onchainCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const symbol = `${asset}USDT`;
  const defaults: OnChainData = { funding: 0, oiChange: 0, lsRatio: 1 };
  try {
    const [fundRes, lsRes] = await Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`).then(r=>r.json()).catch(()=>[]),
      fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`).then(r=>r.json()).catch(()=>[]),
    ]);
    const data: OnChainData = {
      funding: parseFloat(fundRes?.[0]?.fundingRate ?? "0"),
      oiChange: 0,
      lsRatio: parseFloat(lsRes?.[0]?.longShortRatio ?? "1"),
    };
    onchainCache.set(key, { data, expiresAt: Date.now() + 5 * 60_000 });
    return data;
  } catch { return defaults; }
}

function buildTechnicalContext(closes: number[], candles: Candle[], onchain: OnChainData, currentPrice: number): string {
  const rsi = calcRSI(closes);
  const macd = calcMACD(closes);
  const bbPos = calcBBPosition(closes);
  const st = calcSupertrend(candles);
  const adx = calcADX(candles);
  const stoch = calcStochastic(candles);
  const patterns = detectPatterns(candles);

  const rsiLabel = rsi > 70 ? "OVERBOUGHT" : rsi < 30 ? "OVERSOLD" : "NEUTRAL";
  const bbLabel = bbPos > 0.8 ? "near_upper" : bbPos < 0.2 ? "near_lower" : "mid_band";
  const fundLabel = onchain.funding > 0.0001 ? "positive(longs_pay)" : onchain.funding < -0.0001 ? "negative(shorts_pay)" : "neutral";
  const lsLabel = onchain.lsRatio > 1.2 ? "long_heavy" : onchain.lsRatio < 0.8 ? "short_heavy" : "balanced";

  const ema9 = _ema(closes, 9), ema21 = _ema(closes, 21);
  const emaTrend = ema9 > ema21 ? "EMA9>EMA21(bullish)" : "EMA9<EMA21(bearish)";
  const sma50 = _sma(closes, 50);
  const priceVsSma = currentPrice > sma50 ? "Above_SMA50" : "Below_SMA50";

  return [
    `Technical: RSI(14)=${rsi.toFixed(1)}(${rsiLabel}), MACD=${macd.signal}, MACD_hist=${macd.histogram.toFixed(2)}`,
    `${emaTrend}, ${priceVsSma}, Supertrend=${st}, ADX=${adx.toFixed(1)}`,
    `BB=${bbLabel}(${(bbPos*100).toFixed(0)}%), Stoch_K=${stoch.k.toFixed(1)}`,
    `Patterns: ${patterns}`,
    `On-Chain: Funding=${(onchain.funding*100).toFixed(4)}%(${fundLabel}), L/S_ratio=${onchain.lsRatio.toFixed(2)}(${lsLabel})`,
  ].join("\n     ");
}

// ── Phase 3: Weighted Consensus ─────────────────────

interface ConsensusResult {
  direction: "LONG" | "SHORT" | "NEUTRAL";
  confidence: number;
  strength: "STRONG" | "MEDIUM" | "WEAK" | "NONE";
  bullishScore: number;
  bearishScore: number;
  agreeingModels: number;
  totalModels: number;
  positionSizePct: number;
  suggestedLeverage: number;
  stopLossPct: number;
  takeProfitPct: number;
  // Hummingbot-compatible
  signal: -1 | 0 | 1;
  probabilities: [number, number, number];
  regime: string;
}

function buildWeightedConsensus(forecasts: Array<{model:string;direction:string;confidence:number}>): ConsensusResult {
  let bullish = 0, bearish = 0, total = 0, bCount = 0, sCount = 0;
  for (const f of forecasts) {
    // Equal weights for now (accuracy-based weighting applies after enough data accumulates)
    const w = 1.0;
    const score = w * (f.confidence / 100);
    if (f.direction === "BULLISH") { bullish += score; bCount++; }
    else if (f.direction === "BEARISH") { bearish += score; sCount++; }
    total += w;
  }

  const direction: "LONG"|"SHORT"|"NEUTRAL" = total === 0 ? "NEUTRAL" : bullish > bearish ? "LONG" : bearish > bullish ? "SHORT" : "NEUTRAL";
  const confidence = total === 0 ? 0 : (Math.abs(bullish - bearish) / total) * 100;
  const agreeing = direction === "LONG" ? bCount : direction === "SHORT" ? sCount : 0;

  // Classify strength
  let strength: "STRONG"|"MEDIUM"|"WEAK"|"NONE" = "NONE";
  if (confidence >= 75 && agreeing >= 4) strength = "STRONG";
  else if (confidence >= 60 && agreeing >= 3) strength = "MEDIUM";
  else if (confidence >= 50 && agreeing >= 3) strength = "WEAK";

  const posMap = { STRONG: 1.0, MEDIUM: 0.5, WEAK: 0.25, NONE: 0 };
  const levMap = { STRONG: 5, MEDIUM: 3, WEAK: 2, NONE: 1 };
  const slMap = { STRONG: 0.02, MEDIUM: 0.015, WEAK: 0.01, NONE: 0.02 };
  const tpMap = { STRONG: 0.045, MEDIUM: 0.03, WEAK: 0.0225, NONE: 0.03 };

  const dir = strength === "NONE" ? "NEUTRAL" : direction;
  const sig: -1|0|1 = dir === "LONG" ? 1 : dir === "SHORT" ? -1 : 0;
  const t = bullish + bearish;
  const probs: [number,number,number] = t === 0 ? [0,1,0] : [
    parseFloat((bearish/t).toFixed(4)),
    strength === "NONE" ? 1 : 0,
    parseFloat((bullish/t).toFixed(4)),
  ];

  return {
    direction: dir, confidence: parseFloat(confidence.toFixed(2)), strength,
    bullishScore: parseFloat(bullish.toFixed(4)), bearishScore: parseFloat(bearish.toFixed(4)),
    agreeingModels: agreeing, totalModels: forecasts.length,
    positionSizePct: posMap[strength], suggestedLeverage: levMap[strength],
    stopLossPct: slMap[strength], takeProfitPct: tpMap[strength],
    signal: sig, probabilities: probs,
    regime: `${agreeing}/${forecasts.length} models agree`,
  };
}

// ── Constants ───────────────────────────────────────

const TIMEFRAME_LABELS: Record<string, string> = {
  "1m": "1-minute", "5m": "5-minute", "15m": "15-minute",
  "30m": "30-minute", "1H": "1-hour", "4H": "4-hour",
  "1D": "1-day", "1W": "1-week",
};

const tfMinutes: Record<string, number> = {
  "1m": 1, "5m": 5, "15m": 15, "30m": 30,
  "1H": 60, "4H": 240, "1D": 1440, "1W": 10080,
};

// ── Save predictions to database ────────────────────────────

interface TechnicalSnapshot {
  fearGreedIndex: number;
  rsi14?: number;
  macdSignal?: string;
  bbPosition?: number;
  fundingRate?: number;
  longShortRatio?: number;
  candlePatterns?: string;
}

async function savePredictions(
  forecasts: Array<{ model: string; asset: string; timeframe: string; direction: string; confidence: number; currentPrice: number; targetPrice: number; reasoning: string }>,
  snapshot: TechnicalSnapshot,
) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const tf = forecasts[0]?.timeframe;
  const minutes = tfMinutes[tf] || 60;
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();

  const rows = forecasts.map(f => ({
    asset: f.asset,
    timeframe: f.timeframe,
    model: f.model,
    prediction: f.direction,
    confidence: f.confidence,
    target_price: f.targetPrice,
    current_price: f.currentPrice,
    reasoning: f.reasoning,
    fear_greed_index: snapshot.fearGreedIndex,
    rsi_14: snapshot.rsi14 ?? null,
    macd_signal: snapshot.macdSignal ?? null,
    bb_position: snapshot.bbPosition ?? null,
    funding_rate: snapshot.fundingRate ?? null,
    long_short_ratio: snapshot.longShortRatio ?? null,
    candle_patterns: snapshot.candlePatterns ?? null,
    expires_at: expiresAt,
    status: "pending",
  }));

  try {
    await supabase.from("ai_prediction_records").insert(rows);
  } catch {
    // Non-critical — don't break the response
  }
}

const SYSTEM_PROMPT =
  "You are a professional crypto market analyst with access to technical indicators, on-chain data, and candlestick patterns. " +
  "Analyze ALL provided data holistically — consider trend alignment, momentum divergence, volume confirmation, and on-chain sentiment. " +
  "Return ONLY a JSON object. " +
  'Format: {"prediction":"BULLISH","confidence":70,"targetPrice":NUMBER,"reasoning":"2-3 sentences citing specific indicators"} ' +
  "prediction must be BULLISH, BEARISH, or NEUTRAL. confidence 0-100. " +
  "targetPrice MUST be within the allowed range provided. " +
  "Weight your confidence based on indicator agreement — high confidence only when multiple indicators align. " +
  "No markdown, no explanation.";

const TF_MAX_MOVE_PCT: Record<string, number> = {
  "1m": 0.001, "5m": 0.003, "15m": 0.005, "30m": 0.008,
  "1H": 0.012, "4H": 0.025, "1D": 0.05, "1W": 0.10,
};

// ── Model definitions ───────────────────────────────

interface ModelDef {
  type: "openai" | "workers" | "custom";
  model: string;
  label: string;
  maxTokens?: number;
  apiKey?: string;  // For custom endpoints
}

const BUILT_IN_MODELS: ModelDef[] = [
  { type: "openai",  model: "gpt-4o",                                    label: "GPT-4o" },
  { type: "workers", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",  label: "DeepSeek" },
  { type: "workers", model: "@cf/meta/llama-3.1-70b-instruct",           label: "Llama 3.1" },
  { type: "workers", model: "@cf/meta/llama-3.1-8b-instruct",            label: "Gemini" },
  { type: "workers", model: "@cf/meta/llama-3-8b-instruct",              label: "Grok" },
];

// Load custom strategy provider models from env (方式 B)
// Format: CUSTOM_MODELS=label1|url1|key1,label2|url2|key2
function loadCustomModels(): ModelDef[] {
  const raw = Deno.env.get("CUSTOM_MODELS") || "";
  if (!raw) return [];
  return raw.split(",").map(entry => {
    const [label, url, apiKey] = entry.trim().split("|");
    if (!label || !url) return null;
    return { type: "custom" as const, model: url, label, apiKey: apiKey || undefined };
  }).filter(Boolean) as ModelDef[];
}

const MODELS: ModelDef[] = [...BUILT_IN_MODELS, ...loadCustomModels()];

// ── JSON parsing ────────────────────────────────────

function parseJsonSafe(text: string | Record<string, any>): Record<string, any> {
  // Workers AI sometimes returns an object directly
  if (typeof text === "object" && text !== null) return text;
  if (typeof text !== "string") return {};
  try { return JSON.parse(text); } catch {}
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) try { return JSON.parse(codeBlock[1].trim()); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) try { return JSON.parse(m[0]); } catch {}
  return {};
}

// ── API calls ───────────────────────────────────────

interface ModelResult {
  model: string;
  prediction: string;
  confidence: number;
  targetPrice: number;
  reasoning: string;
}

async function callOpenAI(
  gatewayBase: string, cfToken: string, openaiKey: string,
  def: ModelDef, userPrompt: string,
): Promise<ModelResult> {
  const url = `${gatewayBase}/openai/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-aig-authorization": `Bearer ${cfToken}`,
      "Authorization": `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: def.model,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userPrompt }],
      max_tokens: def.maxTokens || 256,
      temperature: 0.7,
    }),
  });
  const result = await res.json();
  const raw = result?.choices?.[0]?.message?.content || "{}";
  const parsed = parseJsonSafe(raw);
  return {
    model: def.label,
    prediction: parsed.prediction || "NEUTRAL",
    confidence: Number(parsed.confidence) || 50,
    targetPrice: Number(parsed.targetPrice) || 0,
    reasoning: parsed.reasoning || "",
  };
}

async function callWorkersAI(
  gatewayBase: string, cfToken: string,
  def: ModelDef, userPrompt: string,
): Promise<ModelResult> {
  const url = `${gatewayBase}/workers-ai/${def.model}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-aig-authorization": `Bearer ${cfToken}`,
      "Authorization": `Bearer ${cfToken}`,
    },
    body: JSON.stringify({
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userPrompt }],
      max_tokens: def.maxTokens || 256,
    }),
  });
  const result = await res.json();
  const raw = result?.result?.response || result?.choices?.[0]?.message?.content || "{}";
  const parsed = parseJsonSafe(raw);
  return {
    model: def.label,
    prediction: parsed.prediction || "NEUTRAL",
    confidence: Number(parsed.confidence) || 50,
    targetPrice: Number(parsed.targetPrice) || 0,
    reasoning: parsed.reasoning || "",
  };
}

/**
 * Call a custom strategy provider API (方式 B).
 * The provider's endpoint receives market context and returns standard prediction JSON.
 */
async function callCustomAPI(
  def: ModelDef, userPrompt: string,
  context: { asset: string; timeframe: string; currentPrice: number; indicators?: any; onchain?: any; fearGreed?: number },
): Promise<ModelResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(def.model, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(def.apiKey ? { "Authorization": `Bearer ${def.apiKey}` } : {}),
      },
      signal: controller.signal,
      body: JSON.stringify({
        prompt: userPrompt,
        asset: context.asset,
        timeframe: context.timeframe,
        currentPrice: context.currentPrice,
        indicators: context.indicators,
        onchain: context.onchain,
        fearGreed: context.fearGreed,
      }),
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const parsed = parseJsonSafe(data);
    return {
      model: def.label,
      prediction: parsed.prediction || "NEUTRAL",
      confidence: Number(parsed.confidence) || 50,
      targetPrice: Number(parsed.targetPrice) || 0,
      reasoning: parsed.reasoning || "",
    };
  } catch {
    clearTimeout(timer);
    return { model: def.label, prediction: "NEUTRAL", confidence: 50, targetPrice: 0, reasoning: "Custom API timeout/error" };
  }
}

// ── Forecast points generator ───────────────────────

function generateForecastPoints(currentPrice: number, targetPrice: number, tf: string) {
  const totalMinutes = tfMinutes[tf] || 60;
  const numPoints = 8;
  const stepMs = (totalMinutes * 60 * 1000) / numPoints;
  const now = Date.now();
  const diff = targetPrice - currentPrice;
  const points: { timestamp: number; time: string; price: number; predicted: boolean }[] = [];
  for (let i = 1; i <= numPoints; i++) {
    const t = i / numPoints;
    const ease = t * t * (3 - 2 * t);
    const noise = (Math.random() - 0.5) * Math.abs(diff) * 0.15 * (1 - t);
    const price = currentPrice + diff * ease + noise;
    const ts = now + stepMs * i;
    const d = new Date(ts);
    const time = totalMinutes >= 1440
      ? d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    points.push({ timestamp: ts, time, price: parseFloat(price.toFixed(currentPrice < 1 ? 6 : 2)), predicted: true });
  }
  return points;
}

// ── Main ────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { asset, timeframe, model: modelLabel } = await req.json();
    const assetUp = (asset || "BTC").toUpperCase();
    const tf = timeframe || "1H";
    const tfLabel = TIMEFRAME_LABELS[tf] || tf;
    const singleMode = !!modelLabel;

    // Check forecast cache
    const cacheKey = singleMode ? `${assetUp}:${tf}:${modelLabel}` : `${assetUp}:${tf}`;
    const cached = forecastCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return new Response(JSON.stringify(cached.data), {
        headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "HIT" },
      });
    }

    const cfGatewayRaw = Deno.env.get("CF_AI_GATEWAY_URL") || "";
    const cfToken = Deno.env.get("CF_AI_TOKEN") || "";
    const openaiKey = Deno.env.get("OPENAI_API_KEY") || "";

    if (!cfToken) throw new Error("CF_AI_TOKEN must be set");
    const gatewayBase = cfGatewayRaw
      .replace(/\/(compat|openai|workers-ai)\/.*$/, "")
      .replace(/\/$/, "");
    if (!gatewayBase) throw new Error("CF_AI_GATEWAY_URL must be set");

    // Fetch all data sources in parallel (Phase 2 enhancement)
    const [fearGreed, currentPrice, candles, onchain] = await Promise.all([
      fetchFearGreedIndex(),
      fetchCurrentPrice(assetUp),
      fetchKlines(assetUp, tf),
      fetchOnChainData(assetUp),
    ]);
    const maxMovePct = TF_MAX_MOVE_PCT[tf] || 0.05;
    const maxMove = currentPrice * maxMovePct;
    const priceFloor = Math.max(0, currentPrice - maxMove);
    const priceCeil = currentPrice + maxMove;

    // Build enhanced prompt with technical context
    const closes = candles.map(c => c.close);
    const techContext = candles.length >= 14
      ? buildTechnicalContext(closes, candles, onchain, currentPrice)
      : "";

    const userPrompt = techContext
      ? `Analyze ${assetUp}/USDT at $${currentPrice.toLocaleString()}.
     Sentiment: Fear & Greed Index=${fearGreed.value} (${fearGreed.classification})
     ${techContext}
     Predict the ${tfLabel} movement. targetPrice must be between $${priceFloor.toFixed(2)} and $${priceCeil.toFixed(2)} (max ${(maxMovePct * 100).toFixed(1)}% move).`
      : `Analyze ${assetUp}/USDT at $${currentPrice.toLocaleString()}. Fear & Greed Index: ${fearGreed.value} (${fearGreed.classification}). Predict the ${tfLabel} movement. IMPORTANT: targetPrice must be between $${priceFloor.toFixed(2)} and $${priceCeil.toFixed(2)} (max ${(maxMovePct * 100).toFixed(1)}% move for ${tfLabel} timeframe).`;

    // Single model mode — call one model and return immediately
    const targetModels = singleMode
      ? MODELS.filter(m => m.label === modelLabel && (m.type !== "openai" || openaiKey))
      : MODELS.filter(m => m.type === "custom" || m.type === "workers" || (m.type === "openai" && openaiKey));

    if (targetModels.length === 0) throw new Error(`Model "${modelLabel}" not found`);

    // Build technical snapshot for DB storage
    const techSnapshot: TechnicalSnapshot = { fearGreedIndex: fearGreed.value };
    if (closes.length >= 14) {
      techSnapshot.rsi14 = parseFloat(calcRSI(closes).toFixed(2));
      techSnapshot.macdSignal = calcMACD(closes).signal;
      techSnapshot.bbPosition = parseFloat(calcBBPosition(closes).toFixed(4));
      techSnapshot.fundingRate = onchain.funding;
      techSnapshot.longShortRatio = onchain.lsRatio;
      techSnapshot.candlePatterns = detectPatterns(candles);
    }

    function buildForecast(m: ModelResult) {
      let target = m.targetPrice > 0 ? m.targetPrice : currentPrice;
      target = Math.max(priceFloor, Math.min(priceCeil, target));
      if (target === currentPrice) {
        const nudge = currentPrice * maxMovePct * 0.3;
        if (m.prediction === "BULLISH") target = currentPrice + nudge;
        else if (m.prediction === "BEARISH") target = currentPrice - nudge;
      }
      return {
        model: m.model,
        asset: assetUp,
        timeframe: tf,
        direction: m.prediction,
        confidence: m.confidence,
        currentPrice,
        targetPrice: parseFloat(target.toFixed(currentPrice < 1 ? 6 : 2)),
        reasoning: m.reasoning,
        forecastPoints: generateForecastPoints(currentPrice, target, tf),
      };
    }

    const customContext = { asset: assetUp, timeframe: tf, currentPrice, indicators: techSnapshot, onchain, fearGreed: fearGreed.value };

    function callModel(def: ModelDef): Promise<ModelResult> {
      if (def.type === "openai") return callOpenAI(gatewayBase, cfToken, openaiKey, def, userPrompt);
      if (def.type === "custom") return callCustomAPI(def, userPrompt, customContext);
      return callWorkersAI(gatewayBase, cfToken, def, userPrompt);
    }

    if (singleMode) {
      const def = targetModels[0];
      const result = await callModel(def);
      const forecast = buildForecast(result);
      const responseData = { forecasts: [forecast] };
      forecastCache.set(cacheKey, { data: responseData, expiresAt: Date.now() + FORECAST_CACHE_TTL });
      // Save prediction to DB (fire and forget)
      savePredictions([forecast], techSnapshot);
      return new Response(JSON.stringify(responseData), {
        headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "MISS" },
      });
    }

    // Multi mode — race for 3 results
    const MIN_MODELS = 3;
    function raceForN(promises: Promise<ModelResult>[], minCount: number): Promise<ModelResult[]> {
      return new Promise((resolve) => {
        const results: ModelResult[] = [];
        let settled = 0;
        const total = promises.length;
        const needed = Math.min(minCount, total);
        let resolved = false;
        const deadline = setTimeout(() => { if (!resolved) { resolved = true; resolve(results); } }, 10000);
        for (const p of promises) {
          p.then((r) => {
            if (resolved) return;
            if (r.reasoning && !(r.prediction === "NEUTRAL" && r.confidence === 50)) results.push(r);
            settled++;
            if (results.length >= needed || settled >= total) { resolved = true; clearTimeout(deadline); resolve(results); }
          }).catch(() => { settled++; if (!resolved && settled >= total) { resolved = true; clearTimeout(deadline); resolve(results); } });
        }
      });
    }

    const modelPromises = targetModels.map(def => callModel(def));
    const successResults = await raceForN(modelPromises, MIN_MODELS);
    const forecasts = successResults.map(buildForecast);

    if (forecasts.length === 0) throw new Error("All AI models failed");
    forecasts.sort((a, b) => (b?.confidence || 0) - (a?.confidence || 0));

    // Phase 3: Weighted consensus + signal classification
    const consensus = buildWeightedConsensus(forecasts);

    const responseData = { forecasts, consensus };
    forecastCache.set(cacheKey, { data: responseData, expiresAt: Date.now() + FORECAST_CACHE_TTL });
    // Save predictions to DB (fire and forget)
    savePredictions(forecasts, techSnapshot);

    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "MISS" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
