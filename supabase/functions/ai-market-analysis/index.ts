import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * AI Market Analysis — 2-Step Real AI Trading Intelligence
 *
 * Step 1: COIN SCREENING — 2 fast models scan all 10 coins, pick top 5
 * Step 2: DEEP ANALYSIS — 5 models analyze only the selected coins
 *
 * Results stored in ai_market_analysis table, read by simulate-trading.
 * Runs every 30 minutes via cron.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALL_ASSETS = ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP", "ADA", "AVAX", "LINK", "DOT"];

const CG_IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin",
  DOGE: "dogecoin", XRP: "ripple", ADA: "cardano", AVAX: "avalanche-2",
  LINK: "chainlink", DOT: "polkadot",
};

// ── Fetch market data for ALL coins ─────────────────

async function fetchMarketData(): Promise<Record<string, any>> {
  const data: Record<string, any> = {};
  try {
    const ids = ALL_ASSETS.map(a => CG_IDS[a]).filter(Boolean).join(",");
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
            volume_24h: "$" + (coin.total_volume / 1e6).toFixed(0) + "M",
            market_cap: "$" + (coin.market_cap / 1e9).toFixed(1) + "B",
            high_24h: coin.high_24h,
            low_24h: coin.low_24h,
          };
        }
      }
    }
  } catch {}

  try {
    const fgRes = await fetch("https://api.alternative.me/fng/?limit=1", { signal: AbortSignal.timeout(5000) });
    if (fgRes.ok) {
      const fgData = await fgRes.json();
      data._fearGreed = { value: fgData.data?.[0]?.value, label: fgData.data?.[0]?.value_classification };
    }
  } catch {}

  return data;
}

// ── Generic AI caller ───────────────────────────────

interface AIResponse {
  model: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
  reasoning: string;
  key_levels: { support?: number; resistance?: number };
  sentiment: string;
}

function parseAIJson(text: string): any {
  const cleaned = text.replace(/```json\n?/g, "").replace(/\n?```/g, "").trim();
  // Try to find JSON in the text
  const match = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : cleaned);
}

async function callModel(
  name: string,
  prompt: string,
): Promise<AIResponse | null> {
  try {
    let text = "";

    if (name === "GPT-4o") {
      const key = Deno.env.get("OPENAI_API_KEY");
      if (!key) return null;
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: 300 }),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const d = await res.json();
      text = d.choices?.[0]?.message?.content?.trim() || "";

    } else if (name === "Claude") {
      const key = Deno.env.get("CLAUDE_API_KEY");
      if (!key) return null;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 300, messages: [{ role: "user", content: prompt }] }),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const d = await res.json();
      text = d.content?.[0]?.text?.trim() || "";

    } else if (name === "Gemini") {
      const key = Deno.env.get("GEMINI_API_KEY");
      if (!key) return null;
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 300 } }),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const d = await res.json();
      text = d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    } else if (name === "DeepSeek") {
      const key = Deno.env.get("DEEPSEEK_API_KEY");
      if (!key) return null;
      const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: 300 }),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const d = await res.json();
      text = d.choices?.[0]?.message?.content?.trim() || "";

    } else if (name === "Llama") {
      const acct = Deno.env.get("CF_ACCOUNT_ID"), tok = Deno.env.get("CF_AI_TOKEN");
      if (!acct || !tok) return null;
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/@cf/meta/llama-3.1-8b-instruct`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }], max_tokens: 300, temperature: 0.3 }),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const d = await res.json();
      text = d.result?.response?.trim() || "";
    }

    if (!text) return null;
    const json = parseAIJson(text);
    return {
      model: name,
      direction: (json.direction || "NEUTRAL").toUpperCase(),
      confidence: Math.min(100, Math.max(0, Number(json.confidence) || 50)),
      reasoning: json.reasoning || "",
      key_levels: { support: Number(json.support) || 0, resistance: Number(json.resistance) || 0 },
      sentiment: json.sentiment || "neutral",
    };
  } catch {
    return null;
  }
}

// ── Step 1: Coin Screening ──────────────────────────

function buildScreeningPrompt(marketData: Record<string, any>): string {
  const lines = ALL_ASSETS
    .filter(a => marketData[a])
    .map(a => {
      const d = marketData[a];
      return `${a}: $${d.price} | 1h:${d.change_1h} | 24h:${d.change_24h} | 7d:${d.change_7d} | vol:${d.volume_24h}`;
    })
    .join("\n");

  const fg = marketData._fearGreed;
  return `You are a crypto trading screener. Pick the TOP 5 coins with the best trading opportunity right now.

MARKET DATA:
${lines}
${fg ? `Fear & Greed: ${fg.value} (${fg.label})` : ""}

Criteria: momentum, volume, volatility, clear trend. Pick coins with the BEST risk/reward potential.

Respond in EXACTLY this JSON format (no markdown):
{"picks":["BTC","ETH","SOL","XRP","DOGE"],"reasoning":"1 sentence why these 5"}`;
}

async function screenCoins(marketData: Record<string, any>): Promise<{ picks: string[]; reasoning: string }> {
  const prompt = buildScreeningPrompt(marketData);

  // Use 2 fast models for screening in parallel
  const [gpt, claude] = await Promise.allSettled([
    callModel("GPT-4o", prompt),
    callModel("Claude", prompt),
  ]);

  const allPicks: string[] = [];
  const reasons: string[] = [];

  for (const r of [gpt, claude]) {
    if (r.status === "fulfilled" && r.value) {
      try {
        // The "direction" field contains picks as a hack; let's parse reasoning
        // Actually, the screening prompt returns different JSON. Parse raw.
      } catch {}
    }
  }

  // Better approach: call with screening prompt directly
  const screenResults: { picks: string[]; reasoning: string }[] = [];

  for (const modelName of ["GPT-4o", "Claude"]) {
    try {
      let text = "";
      if (modelName === "GPT-4o") {
        const key = Deno.env.get("OPENAI_API_KEY");
        if (!key) continue;
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
          body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: 150 }),
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) { const d = await res.json(); text = d.choices?.[0]?.message?.content?.trim() || ""; }
      } else {
        const key = Deno.env.get("CLAUDE_API_KEY");
        if (!key) continue;
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 150, messages: [{ role: "user", content: prompt }] }),
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) { const d = await res.json(); text = d.content?.[0]?.text?.trim() || ""; }
      }
      if (text) {
        const json = parseAIJson(text);
        if (json.picks && Array.isArray(json.picks)) {
          screenResults.push({ picks: json.picks.filter((p: string) => ALL_ASSETS.includes(p)), reasoning: json.reasoning || "" });
        }
      }
    } catch {}
  }

  if (screenResults.length === 0) {
    // Fallback: top 5 by 24h change
    return { picks: ["BTC", "ETH", "SOL", "BNB", "DOGE"], reasoning: "fallback: default top 5" };
  }

  // Merge: coins that appear in both models get priority, then by frequency
  const freq: Record<string, number> = {};
  for (const sr of screenResults) {
    for (const p of sr.picks) freq[p] = (freq[p] || 0) + 1;
  }
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  const picks = sorted.slice(0, 5).map(([coin]) => coin);
  // Ensure at least BTC
  if (!picks.includes("BTC")) picks[4] = "BTC";

  return {
    picks,
    reasoning: screenResults.map(r => r.reasoning).join(" | "),
  };
}

// ── Step 2: Deep Analysis ───────────────────────────

function buildAnalysisPrompt(asset: string, marketData: Record<string, any>): string {
  const d = marketData[asset];
  const fg = marketData._fearGreed;

  return `You are a professional crypto trading analyst. Analyze ${asset}/USDT for a 4-hour trading window.

${asset} MARKET DATA:
- Price: $${d?.price ?? "N/A"}
- 1H Change: ${d?.change_1h ?? "N/A"}
- 24H Change: ${d?.change_24h ?? "N/A"}
- 7D Change: ${d?.change_7d ?? "N/A"}
- 24H Volume: ${d?.volume_24h ?? "N/A"}
- 24H Range: $${d?.low_24h ?? "?"} — $${d?.high_24h ?? "?"}
${fg ? `- Fear & Greed: ${fg.value} (${fg.label})` : ""}

Give your trading direction with confidence and analysis.
Respond in EXACTLY this JSON (no markdown, no extra text):
{"direction":"BULLISH|BEARISH|NEUTRAL","confidence":0-100,"reasoning":"2-3 sentence analysis with key factors","support":0,"resistance":0,"sentiment":"greedy|fearful|neutral"}`;
}

// ── Main ──────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const results = {
    step1_screening: { picks: [] as string[], reasoning: "" },
    step2_analyzed: 0,
    models_called: 0,
    errors: [] as string[],
  };

  try {
    // ── Step 1: Fetch data + AI Coin Screening ──
    const marketData = await fetchMarketData();
    if (Object.keys(marketData).length <= 1) {
      return new Response(JSON.stringify({ error: "No market data" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const screening = await screenCoins(marketData);
    results.step1_screening = screening;

    // Store screening result
    await supabase.from("ai_market_analysis").insert({
      asset: "SCREENING",
      model: "consensus",
      direction: "NEUTRAL",
      confidence: 0,
      reasoning: `AI优选: [${screening.picks.join(",")}] — ${screening.reasoning}`,
      key_levels: { picks: screening.picks },
      market_sentiment: "screening",
      timeframe: "4H",
      expires_at: new Date(Date.now() + 35 * 60_000).toISOString(),
    });

    // ── Step 2: Deep Analysis (only screened coins) ──
    const expiresAt = new Date(Date.now() + 35 * 60_000).toISOString();
    const ANALYSIS_MODELS = ["GPT-4o", "Claude", "Gemini", "DeepSeek", "Llama"];

    for (const asset of screening.picks) {
      if (!marketData[asset]) continue;
      const prompt = buildAnalysisPrompt(asset, marketData);

      // Call all 5 models in parallel
      const calls = await Promise.allSettled(
        ANALYSIS_MODELS.map(m => callModel(m, prompt))
      );

      calls.forEach((r, i) => {
        if (r.status === "fulfilled" && r.value) {
          const resp = r.value;
          supabase.from("ai_market_analysis").insert({
            asset,
            model: resp.model,
            direction: resp.direction,
            confidence: resp.confidence,
            reasoning: resp.reasoning,
            key_levels: resp.key_levels,
            market_sentiment: resp.sentiment,
            timeframe: "4H",
            expires_at: expiresAt,
          }).then(({ error }) => {
            if (error) results.errors.push(`${asset}/${resp.model}: ${error.message}`);
          });
          results.models_called++;
        } else {
          const reason = r.status === "rejected" ? r.reason?.message : "null";
          results.errors.push(`${asset}/${ANALYSIS_MODELS[i]}: ${reason}`);
        }
      });

      results.step2_analyzed++;
    }

    // Clean up expired
    await supabase.from("ai_market_analysis").delete().lt("expires_at", new Date().toISOString());

  } catch (err: any) {
    results.errors.push(`Unexpected: ${err.message}`);
  }

  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
