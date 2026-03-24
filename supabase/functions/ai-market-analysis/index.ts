import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * AI Market Analysis — Real AI Model Calls
 *
 * Runs every 30 minutes. Calls 3 real AI models (GPT-4o, Claude, Gemini)
 * with current market data to get directional analysis per asset.
 * Results stored in ai_market_analysis table, read by simulate-trading.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ASSETS = ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"];

const CG_IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin",
  DOGE: "dogecoin", XRP: "ripple", ADA: "cardano", AVAX: "avalanche-2",
};

// ── Fetch market data ─────────────────────────────

async function fetchMarketData(): Promise<Record<string, any>> {
  const data: Record<string, any> = {};
  try {
    // CoinGecko detailed market data
    const ids = ASSETS.map(a => CG_IDS[a]).filter(Boolean).join(",");
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=false&price_change_percentage=1h,24h,7d`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (res.ok) {
      const coins = await res.json();
      for (const coin of coins) {
        const asset = Object.entries(CG_IDS).find(([_, v]) => v === coin.id)?.[0];
        if (asset) {
          data[asset] = {
            price: coin.current_price,
            change_1h: coin.price_change_percentage_1h_in_currency?.toFixed(2) + "%",
            change_24h: coin.price_change_percentage_24h?.toFixed(2) + "%",
            change_7d: coin.price_change_percentage_7d?.toFixed(2) + "%",
            volume_24h: (coin.total_volume / 1e6).toFixed(0) + "M",
            market_cap: (coin.market_cap / 1e9).toFixed(1) + "B",
            high_24h: coin.high_24h,
            low_24h: coin.low_24h,
            ath_change: coin.ath_change_percentage?.toFixed(1) + "%",
          };
        }
      }
    }
  } catch {}

  // Fear & Greed Index
  try {
    const fgRes = await fetch("https://api.alternative.me/fng/?limit=1", { signal: AbortSignal.timeout(5000) });
    if (fgRes.ok) {
      const fgData = await fgRes.json();
      data._fearGreed = {
        value: fgData.data?.[0]?.value,
        label: fgData.data?.[0]?.value_classification,
      };
    }
  } catch {}

  return data;
}

// ── Build analysis prompt ─────────────────────────

function buildPrompt(asset: string, marketData: Record<string, any>): string {
  const d = marketData[asset];
  const fg = marketData._fearGreed;

  return `You are a professional crypto trading analyst. Analyze ${asset}/USDT and give a trading direction.

CURRENT MARKET DATA for ${asset}:
- Price: $${d?.price ?? "N/A"}
- 1H Change: ${d?.change_1h ?? "N/A"}
- 24H Change: ${d?.change_24h ?? "N/A"}
- 7D Change: ${d?.change_7d ?? "N/A"}
- 24H Volume: $${d?.volume_24h ?? "N/A"}
- 24H High/Low: $${d?.high_24h ?? "N/A"} / $${d?.low_24h ?? "N/A"}
- Market Cap: $${d?.market_cap ?? "N/A"}
- From ATH: ${d?.ath_change ?? "N/A"}
${fg ? `- Crypto Fear & Greed Index: ${fg.value} (${fg.label})` : ""}

Respond in EXACTLY this JSON format (no markdown, no extra text):
{"direction":"BULLISH|BEARISH|NEUTRAL","confidence":0-100,"reasoning":"1-2 sentence analysis","support":0,"resistance":0,"sentiment":"greedy|fearful|neutral"}`;
}

// ── Call AI Models ─────────────────────────────────

interface AIResponse {
  model: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
  reasoning: string;
  key_levels: { support?: number; resistance?: number };
  sentiment: string;
}

async function callGPT4o(prompt: string): Promise<AIResponse | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    const json = JSON.parse(text.replace(/```json\n?|\n?```/g, ""));
    return {
      model: "GPT-4o",
      direction: json.direction || "NEUTRAL",
      confidence: Math.min(100, Math.max(0, json.confidence || 50)),
      reasoning: json.reasoning || "",
      key_levels: { support: json.support, resistance: json.resistance },
      sentiment: json.sentiment || "neutral",
    };
  } catch { return null; }
}

async function callClaude(prompt: string): Promise<AIResponse | null> {
  const apiKey = Deno.env.get("CLAUDE_API_KEY");
  if (!apiKey) throw new Error("no CLAUDE_API_KEY");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  const text = data.content?.[0]?.text?.trim();
  const json = JSON.parse(text.replace(/```json\n?|\n?```/g, ""));
  return {
    model: "Claude",
    direction: json.direction || "NEUTRAL",
    confidence: Math.min(100, Math.max(0, json.confidence || 50)),
    reasoning: json.reasoning || "",
    key_levels: { support: json.support, resistance: json.resistance },
    sentiment: json.sentiment || "neutral",
  };
}

async function callGemini(prompt: string): Promise<AIResponse | null> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("no GEMINI_API_KEY");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 200 },
      }),
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  const json = JSON.parse(text.replace(/```json\n?|\n?```/g, ""));
  return {
    model: "Gemini",
    direction: json.direction || "NEUTRAL",
    confidence: Math.min(100, Math.max(0, json.confidence || 50)),
    reasoning: json.reasoning || "",
    key_levels: { support: json.support, resistance: json.resistance },
    sentiment: json.sentiment || "neutral",
  };
}

async function callDeepSeek(prompt: string): Promise<AIResponse | null> {
  const apiKey = Deno.env.get("DEEPSEEK_API_KEY");
  if (!apiKey) return null; // optional
  try {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text().catch(() => "")}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    const json = JSON.parse(text.replace(/```json\n?|\n?```/g, ""));
    return {
      model: "DeepSeek",
      direction: json.direction || "NEUTRAL",
      confidence: Math.min(100, Math.max(0, json.confidence || 50)),
      reasoning: json.reasoning || "",
      key_levels: { support: json.support, resistance: json.resistance },
      sentiment: json.sentiment || "neutral",
    };
  } catch (e: any) { throw e; }
}

// ── Main ──────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const results = { analyzed: 0, models_called: 0, errors: [] as string[] };

  try {
    const marketData = await fetchMarketData();
    if (Object.keys(marketData).length <= 1) {
      return new Response(JSON.stringify({ error: "No market data" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expiresAt = new Date(Date.now() + 35 * 60_000).toISOString(); // 35 min expiry

    for (const asset of ASSETS) {
      if (!marketData[asset]) continue;
      const prompt = buildPrompt(asset, marketData);

      // Call all 3 models in parallel
      // Call all 4 models in parallel with error tracking
      const calls = await Promise.allSettled([
        callGPT4o(prompt),
        callClaude(prompt),
        callGemini(prompt),
        callDeepSeek(prompt),
      ]);
      const responses: AIResponse[] = [];
      calls.forEach((r, i) => {
        const name = ["GPT-4o", "Claude", "Gemini", "DeepSeek"][i];
        if (r.status === "fulfilled" && r.value) {
          responses.push(r.value);
        } else {
          const reason = r.status === "rejected" ? r.reason?.message : "null response";
          results.errors.push(`${asset}/${name}: ${reason}`);
        }
      });

      for (const resp of responses) {
        const { error } = await supabase.from("ai_market_analysis").insert({
          asset,
          model: resp.model,
          direction: resp.direction,
          confidence: resp.confidence,
          reasoning: resp.reasoning,
          key_levels: resp.key_levels,
          market_sentiment: resp.sentiment,
          timeframe: "4H",
          expires_at: expiresAt,
        });
        if (error) results.errors.push(`${asset}/${resp.model}: ${error.message}`);
        else results.models_called++;
      }

      if (responses.length > 0) results.analyzed++;
    }

    // Clean up expired analyses
    await supabase.from("ai_market_analysis").delete().lt("expires_at", new Date().toISOString());

  } catch (err: any) {
    results.errors.push(`Unexpected: ${err.message}`);
  }

  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
