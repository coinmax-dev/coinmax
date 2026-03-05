import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

const TIMEFRAME_LABELS: Record<string, string> = {
  "1m": "1-minute", "5m": "5-minute", "5M": "5-minute", "15m": "15-minute", "15M": "15-minute",
  "30m": "30-minute", "30M": "30-minute", "1H": "1-hour", "4H": "4-hour",
  "1D": "1-day", "1W": "1-week",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { asset, timeframe } = await req.json();
    const assetUp = (asset || "BTC").toUpperCase();
    const tf = timeframe || "1H";
    const tfLabel = TIMEFRAME_LABELS[tf] || tf;

    const [fearGreed, currentPrice] = await Promise.all([fetchFearGreedIndex(), fetchCurrentPrice(assetUp)]);

    const tfMaxMovePct: Record<string, number> = {
      "1m": 0.001, "5m": 0.003, "15m": 0.005, "30m": 0.008,
      "1H": 0.012, "4H": 0.025, "1D": 0.05, "1W": 0.10,
    };
    const maxMovePct = tfMaxMovePct[tf] || 0.05;
    const maxMove = currentPrice * maxMovePct;
    const priceFloor = Math.max(0, currentPrice - maxMove);
    const priceCeil = currentPrice + maxMove;

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) throw new Error("OPENAI_API_KEY not set");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a crypto market analyst. Provide a prediction in JSON: prediction (BULLISH/BEARISH/NEUTRAL), confidence (0-100), targetPrice (number very close to current price within allowed range), reasoning (1 sentence)." },
          { role: "user", content: `Analyze ${assetUp} at $${currentPrice}. FGI: ${fearGreed.value} (${fearGreed.classification}). Predict ${tfLabel} movement. IMPORTANT: targetPrice must be between $${priceFloor.toFixed(2)} and $${priceCeil.toFixed(2)} (max ${(maxMovePct * 100).toFixed(1)}% move for ${tfLabel} timeframe).` },
        ],
        max_tokens: 200,
        response_format: { type: "json_object" },
      }),
    });

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    let targetPrice = Number(parsed.targetPrice) || currentPrice;
    targetPrice = Math.max(priceFloor, Math.min(priceCeil, targetPrice));
    const direction = parsed.prediction || "NEUTRAL";
    const confidence = Number(parsed.confidence) || 50;
    if (targetPrice === currentPrice) {
      const nudge = currentPrice * maxMovePct * 0.3;
      if (direction === "BULLISH") targetPrice = currentPrice + nudge;
      else if (direction === "BEARISH") targetPrice = currentPrice - nudge;
    }

    const tfMinutes: Record<string, number> = {
      "1m": 1, "5m": 5, "10m": 10, "15m": 15, "30m": 30, "1H": 60, "4H": 240, "1D": 1440, "1W": 10080, "7D": 10080,
    };
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

    const forecast = {
      asset: assetUp, timeframe: tf, direction, confidence, currentPrice, targetPrice,
      reasoning: parsed.reasoning || "",
      forecastPoints: points,
    };

    return new Response(JSON.stringify(forecast), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
