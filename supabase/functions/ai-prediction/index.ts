import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TIMEFRAME_LABELS: Record<string, string> = {
  "5M": "5-minute", "15M": "15-minute", "30M": "30-minute",
  "1H": "1-hour", "4H": "4-hour", "1D": "1-day", "1W": "1-week",
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { asset, timeframe } = await req.json();
    const assetUp = (asset || "BTC").toUpperCase();
    const tf = timeframe || "1H";
    const tfLabel = TIMEFRAME_LABELS[tf] || tf;

    const [fearGreed, currentPrice] = await Promise.all([fetchFearGreedIndex(), fetchCurrentPrice(assetUp)]);

    const tfMaxMovePct: Record<string, number> = {
      "5M": 0.003, "15M": 0.005, "30M": 0.008,
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
          { role: "system", content: "You are a crypto market analyst. Analyze the market and provide a prediction in JSON format only. Response must be valid JSON with these fields: prediction (BULLISH/BEARISH/NEUTRAL), confidence (0-100), targetPrice (number very close to current price within allowed range), reasoning (1 sentence)." },
          { role: "user", content: `Analyze ${assetUp} at $${currentPrice}. Fear & Greed Index: ${fearGreed.value} (${fearGreed.classification}). Predict the ${tfLabel} price movement. IMPORTANT: targetPrice must be between $${priceFloor.toFixed(2)} and $${priceCeil.toFixed(2)} (max ${(maxMovePct * 100).toFixed(1)}% move for ${tfLabel} timeframe).` },
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

    const prediction = {
      asset: assetUp,
      prediction: parsed.prediction || "NEUTRAL",
      confidence: String(parsed.confidence || 50),
      targetPrice: String(targetPrice),
      currentPrice: String(currentPrice),
      fearGreedIndex: fearGreed.value,
      fearGreedLabel: fearGreed.classification,
      reasoning: parsed.reasoning || "",
      timeframe: tf,
    };

    return new Response(JSON.stringify(prediction), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
