/**
 * CoinMax AI Trading Agent
 *
 * Runs on Mac Mini with local LLMs (Ollama) + cloud AI cross-validation.
 * Every 15 minutes:
 *   1. Fetch market data + news
 *   2. Local LLM screens coins (free, fast, no limit)
 *   3. Cloud LLMs cross-validate top picks
 *   4. Deep analysis with reasoning
 *   5. Push results to Supabase → simulate-trading reads them
 *
 * Setup: npm install && cp .env.example .env && npm start
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// ── Load .env ──
try {
  const env = readFileSync(new URL(".env", import.meta.url), "utf8");
  env.split("\n").forEach((line) => {
    const [key, ...vals] = line.split("=");
    if (key && !key.startsWith("#")) process.env[key.trim()] = vals.join("=").trim();
  });
} catch {}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const INTERVAL = (Number(process.env.ANALYSIS_INTERVAL_MIN) || 15) * 60_000;
const TOP_N = Number(process.env.TOP_COINS_COUNT) || 5;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ALL_COINS = ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP", "ADA", "AVAX", "LINK", "DOT"];
const CG_IDS = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin",
  DOGE: "dogecoin", XRP: "ripple", ADA: "cardano", AVAX: "avalanche-2",
  LINK: "chainlink", DOT: "polkadot",
};

// ── Helpers ──

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000), ...opts });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function parseAIJson(text) {
  const cleaned = text.replace(/```json\n?/g, "").replace(/\n?```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : cleaned);
}

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

// ── Market Data ──

async function fetchMarketData() {
  const data = {};
  try {
    const ids = ALL_COINS.map((a) => CG_IDS[a]).filter(Boolean).join(",");
    const coins = await fetchJson(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=false&price_change_percentage=1h,24h,7d`
    );
    for (const coin of coins) {
      const asset = Object.entries(CG_IDS).find(([_, v]) => v === coin.id)?.[0];
      if (asset) {
        data[asset] = {
          price: coin.current_price,
          change_1h: coin.price_change_percentage_1h_in_currency?.toFixed(2) + "%",
          change_24h: coin.price_change_percentage_24h?.toFixed(2) + "%",
          change_7d: coin.price_change_percentage_7d?.toFixed(2) + "%",
          volume_24h: "$" + (coin.total_volume / 1e6).toFixed(0) + "M",
          high_24h: coin.high_24h,
          low_24h: coin.low_24h,
          market_cap: "$" + (coin.market_cap / 1e9).toFixed(1) + "B",
        };
      }
    }
  } catch (e) {
    log(`Market data error: ${e.message}`);
  }

  // Fear & Greed
  try {
    const fg = await fetchJson("https://api.alternative.me/fng/?limit=1");
    data._fearGreed = { value: fg.data?.[0]?.value, label: fg.data?.[0]?.value_classification };
  } catch {}

  return data;
}

// ── News Search ──

async function fetchCryptoNews() {
  const key = process.env.NEWS_API_KEY;
  if (!key) return [];
  try {
    const data = await fetchJson(
      `https://newsapi.org/v2/everything?q=crypto+bitcoin+trading&language=en&sortBy=publishedAt&pageSize=5&apiKey=${key}`
    );
    return (data.articles || []).map((a) => `${a.title} (${a.source?.name})`);
  } catch {
    return [];
  }
}

// ── Ollama (Local LLM) ──

async function checkOllama() {
  try {
    const data = await fetchJson(`${OLLAMA_URL}/api/tags`);
    const models = data.models?.map((m) => m.name) || [];
    return models;
  } catch {
    return [];
  }
}

async function callOllama(model, prompt) {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0.3, num_predict: 300 },
      }),
      signal: AbortSignal.timeout(60000), // Local models can be slower
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    return data.response?.trim() || "";
  } catch (e) {
    log(`Ollama ${model} error: ${e.message}`);
    return "";
  }
}

// ── Cloud AI Models ──

async function callCloud(model, prompt) {
  try {
    let text = "";
    if (model === "GPT-4o" && process.env.OPENAI_API_KEY) {
      const d = await fetchJson("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: 300 }),
      });
      text = d.choices?.[0]?.message?.content?.trim() || "";
    } else if (model === "Claude" && process.env.CLAUDE_API_KEY) {
      const d = await fetchJson("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.CLAUDE_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 300, messages: [{ role: "user", content: prompt }] }),
      });
      text = d.content?.[0]?.text?.trim() || "";
    } else if (model === "DeepSeek" && process.env.DEEPSEEK_API_KEY) {
      const d = await fetchJson("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
        body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: 300 }),
      });
      text = d.choices?.[0]?.message?.content?.trim() || "";
    }
    return text;
  } catch (e) {
    log(`Cloud ${model} error: ${e.message}`);
    return "";
  }
}

// ── Analysis Prompts ──

function screeningPrompt(marketData, news) {
  const lines = ALL_COINS.filter((a) => marketData[a]).map((a) => {
    const d = marketData[a];
    return `${a}: $${d.price} | 1h:${d.change_1h} | 24h:${d.change_24h} | 7d:${d.change_7d} | vol:${d.volume_24h}`;
  }).join("\n");
  const fg = marketData._fearGreed;
  const newsStr = news.length > 0 ? `\nRECENT NEWS:\n${news.join("\n")}` : "";

  return `You are a crypto trading screener. Pick the TOP ${TOP_N} coins with the BEST trading opportunity.

MARKET DATA:
${lines}
${fg ? `Fear & Greed: ${fg.value} (${fg.label})` : ""}${newsStr}

Criteria: strong momentum, high volume, clear trend direction, good risk/reward.
Respond ONLY in this JSON (no markdown):
{"picks":["BTC","ETH","SOL"],"reasoning":"why these coins"}`;
}

function analysisPrompt(asset, marketData, news) {
  const d = marketData[asset];
  const fg = marketData._fearGreed;
  const newsStr = news.length > 0 ? `\nRecent crypto news:\n${news.slice(0, 3).join("\n")}` : "";

  return `You are a professional crypto trader. Analyze ${asset}/USDT for a 4H trading window.

${asset}: $${d?.price} | 1h:${d?.change_1h} | 24h:${d?.change_24h} | 7d:${d?.change_7d}
Volume: ${d?.volume_24h} | Range: $${d?.low_24h} - $${d?.high_24h} | MCap: ${d?.market_cap}
${fg ? `Fear & Greed: ${fg.value} (${fg.label})` : ""}${newsStr}

Give your trading direction with detailed reasoning.
Respond ONLY in this JSON (no markdown):
{"direction":"BULLISH|BEARISH|NEUTRAL","confidence":0-100,"reasoning":"2-3 sentence analysis","support":0,"resistance":0,"sentiment":"greedy|fearful|neutral"}`;
}

// ── Main Agent Loop ──

async function runAnalysis() {
  const startTime = Date.now();
  log("=== Starting AI Analysis ===");

  // 1. Check Ollama models
  const ollamaModels = await checkOllama();
  const hasLocal = ollamaModels.length > 0;
  const localModel = ollamaModels.find((m) => m.includes("llama")) || ollamaModels.find((m) => m.includes("qwen")) || ollamaModels[0];
  log(`Ollama: ${hasLocal ? `${ollamaModels.length} models (using ${localModel})` : "not running"}`);

  // 2. Fetch market data + news
  const [marketData, news] = await Promise.all([fetchMarketData(), fetchCryptoNews()]);
  const availableCoins = ALL_COINS.filter((a) => marketData[a]);
  log(`Market: ${availableCoins.length} coins | News: ${news.length} articles`);

  if (availableCoins.length === 0) {
    log("No market data, skipping");
    return;
  }

  // 3. Step 1: Coin Screening (local + 1 cloud)
  log("Step 1: AI Coin Screening...");
  const screenPrompt = screeningPrompt(marketData, news);
  const screenResults = [];

  // Local screening (free, fast)
  if (hasLocal) {
    const localText = await callOllama(localModel, screenPrompt);
    if (localText) {
      try {
        const json = parseAIJson(localText);
        if (json.picks) screenResults.push({ model: localModel, picks: json.picks, reasoning: json.reasoning });
      } catch {}
    }
    log(`  Local (${localModel}): ${screenResults.length > 0 ? screenResults[0].picks.join(",") : "failed"}`);
  }

  // Cloud screening (1 call)
  const cloudText = await callCloud("GPT-4o", screenPrompt);
  if (cloudText) {
    try {
      const json = parseAIJson(cloudText);
      if (json.picks) screenResults.push({ model: "GPT-4o", picks: json.picks, reasoning: json.reasoning });
    } catch {}
  }
  log(`  GPT-4o: ${screenResults.length > (hasLocal ? 1 : 0) ? screenResults[screenResults.length - 1].picks.join(",") : "failed"}`);

  // Merge picks
  const freq = {};
  for (const r of screenResults) for (const p of r.picks) if (ALL_COINS.includes(p)) freq[p] = (freq[p] || 0) + 1;
  let topPicks = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, TOP_N).map(([c]) => c);
  if (topPicks.length === 0) topPicks = ["BTC", "ETH", "SOL", "BNB", "DOGE"];
  if (!topPicks.includes("BTC")) topPicks[topPicks.length - 1] = "BTC";

  const screenReasoning = screenResults.map((r) => `[${r.model}] ${r.reasoning}`).join(" | ");
  log(`  Selected: ${topPicks.join(", ")}`);

  // Save screening result
  await supabase.from("ai_market_analysis").insert({
    asset: "SCREENING", model: "agent", direction: "NEUTRAL", confidence: 0,
    reasoning: `AI Agent优选: [${topPicks.join(",")}] — ${screenReasoning}`,
    key_levels: { picks: topPicks, source: "mac-mini-agent" },
    market_sentiment: "screening", timeframe: "4H",
    expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
  });

  // 4. Step 2: Deep Analysis (local + cloud for each coin)
  log("Step 2: Deep Analysis...");
  let totalInserted = 0;
  const expiresAt = new Date(Date.now() + 20 * 60_000).toISOString();

  for (const asset of topPicks) {
    if (!marketData[asset]) continue;
    const prompt = analysisPrompt(asset, marketData, news);

    // Run local + cloud models in parallel
    const tasks = [];
    if (hasLocal) tasks.push({ model: localModel, fn: () => callOllama(localModel, prompt) });
    tasks.push({ model: "GPT-4o", fn: () => callCloud("GPT-4o", prompt) });
    tasks.push({ model: "Claude", fn: () => callCloud("Claude", prompt) });
    tasks.push({ model: "DeepSeek", fn: () => callCloud("DeepSeek", prompt) });

    const results = await Promise.allSettled(tasks.map((t) => t.fn()));

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status !== "fulfilled" || !r.value) continue;
      try {
        const json = parseAIJson(r.value);
        await supabase.from("ai_market_analysis").insert({
          asset,
          model: tasks[i].model,
          direction: (json.direction || "NEUTRAL").toUpperCase(),
          confidence: Math.min(100, Math.max(0, Number(json.confidence) || 50)),
          reasoning: json.reasoning || "",
          key_levels: { support: Number(json.support) || 0, resistance: Number(json.resistance) || 0 },
          market_sentiment: json.sentiment || "neutral",
          timeframe: "4H",
          expires_at: expiresAt,
        });
        totalInserted++;
      } catch {}
    }
    log(`  ${asset}: ${results.filter((r) => r.status === "fulfilled" && r.value).length}/${tasks.length} models`);
  }

  // 5. Cleanup expired
  await supabase.from("ai_market_analysis").delete().lt("expires_at", new Date().toISOString());

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`=== Done: ${topPicks.length} coins, ${totalInserted} analyses in ${elapsed}s ===\n`);
}

// ── Entry Point ──

const runOnce = process.argv.includes("--once");

log("CoinMax AI Trading Agent starting...");
log(`Supabase: ${SUPABASE_URL}`);
log(`Ollama: ${OLLAMA_URL}`);
log(`Interval: ${INTERVAL / 60000} min`);
log(`Mode: ${runOnce ? "single run" : "continuous"}`);
log("");

await runAnalysis();

if (!runOnce) {
  setInterval(runAnalysis, INTERVAL);
  log(`Next run in ${INTERVAL / 60000} min. Press Ctrl+C to stop.`);
}
