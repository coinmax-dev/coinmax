import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Market data ─────────────────────────────────────

async function fetchFearGreedIndex() {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1");
    const data = await res.json();
    return { value: parseInt(data.data[0].value), classification: data.data[0].value_classification };
  } catch {
    return { value: 50, classification: "Neutral" };
  }
}

async function fetchCurrentPrice(asset: string): Promise<number> {
  try {
    const res = await fetch(`https://api.binance.us/api/v3/ticker/price?symbol=${asset}USDT`);
    if (res.ok) { const d = await res.json(); const p = parseFloat(d.price); if (p > 0) return p; }
  } catch {}
  const ids: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin", DOGE: "dogecoin" };
  try {
    const id = ids[asset] || "bitcoin";
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currency=usd`);
    const data = await res.json();
    return data[id]?.usd || 0;
  } catch { return 0; }
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

const SYSTEM_PROMPT =
  "You are a crypto market analyst. Return ONLY a JSON object. " +
  'Format: {"prediction":"BULLISH","confidence":70,"targetPrice":NUMBER,"reasoning":"one sentence"} ' +
  "prediction must be BULLISH, BEARISH, or NEUTRAL. confidence 0-100. " +
  "targetPrice MUST be extremely close to the current price — within the allowed range provided. " +
  "No markdown, no explanation.";

const TF_MAX_MOVE_PCT: Record<string, number> = {
  "1m": 0.001, "5m": 0.003, "15m": 0.005, "30m": 0.008,
  "1H": 0.012, "4H": 0.025, "1D": 0.05, "1W": 0.10,
};

// ── Model definitions ───────────────────────────────

interface ModelDef {
  type: "openai" | "workers";
  model: string;
  label: string;
  maxTokens?: number;
}

const MODELS: ModelDef[] = [
  { type: "openai",  model: "gpt-4o",                                    label: "GPT-4o" },
  { type: "workers", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",  label: "DeepSeek" },
  { type: "workers", model: "@cf/meta/llama-3.1-70b-instruct",           label: "Llama 3.1" },
  { type: "workers", model: "@cf/meta/llama-3.1-8b-instruct",            label: "Gemini" },
  { type: "workers", model: "@cf/meta/llama-3-8b-instruct",              label: "Grok" },
];

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
    const { asset, timeframe } = await req.json();
    const assetUp = (asset || "BTC").toUpperCase();
    const tf = timeframe || "1H";
    const tfLabel = TIMEFRAME_LABELS[tf] || tf;

    const cfGatewayRaw = Deno.env.get("CF_AI_GATEWAY_URL") || "";
    const cfToken = Deno.env.get("CF_AI_TOKEN") || "";
    const openaiKey = Deno.env.get("OPENAI_API_KEY") || "";

    if (!cfToken) throw new Error("CF_AI_TOKEN must be set");
    const gatewayBase = cfGatewayRaw
      .replace(/\/(compat|openai|workers-ai)\/.*$/, "")
      .replace(/\/$/, "");
    if (!gatewayBase) throw new Error("CF_AI_GATEWAY_URL must be set");

    const [fearGreed, currentPrice] = await Promise.all([fetchFearGreedIndex(), fetchCurrentPrice(assetUp)]);
    const maxMovePct = TF_MAX_MOVE_PCT[tf] || 0.05;
    const maxMove = currentPrice * maxMovePct;
    const priceFloor = Math.max(0, currentPrice - maxMove);
    const priceCeil = currentPrice + maxMove;
    const userPrompt = `Analyze ${assetUp}/USDT at $${currentPrice.toLocaleString()}. Fear & Greed Index: ${fearGreed.value} (${fearGreed.classification}). Predict the ${tfLabel} movement. IMPORTANT: targetPrice must be between $${priceFloor.toFixed(2)} and $${priceCeil.toFixed(2)} (max ${(maxMovePct * 100).toFixed(1)}% move for ${tfLabel} timeframe).`;

    const activeModels = MODELS.filter(m => m.type !== "openai" || openaiKey);

    const results = await Promise.allSettled(
      activeModels.map(def =>
        def.type === "openai"
          ? callOpenAI(gatewayBase, cfToken, openaiKey, def, userPrompt)
          : callWorkersAI(gatewayBase, cfToken, def, userPrompt)
      )
    );

    const forecasts = results
      .filter((r): r is PromiseFulfilledResult<ModelResult> => r.status === "fulfilled")
      .map(r => {
        const m = r.value;
        if (!m.reasoning && m.prediction === "NEUTRAL" && m.confidence === 50) return null;
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
      })
      .filter(Boolean);

    if (forecasts.length === 0) throw new Error("All AI models failed");
    forecasts.sort((a, b) => (b?.confidence || 0) - (a?.confidence || 0));

    return new Response(JSON.stringify({ forecasts }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
