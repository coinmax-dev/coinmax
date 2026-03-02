import { supabase } from "./supabase";

// Convert snake_case DB rows to camelCase for frontend
function toCamel(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(toCamel);
  if (typeof obj !== "object") return obj;
  const out: any = {};
  for (const key of Object.keys(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camelKey] = obj[key];
  }
  return out;
}

// Fetch MA token price from system_config
// TODO: When LP pool is live, add Uniswap V3 TWAP / Chainlink oracle integration
// Current sources (priority order):
//   1. Uniswap V3 pool TWAP (not yet enabled)
//   2. DEX aggregator API (not yet enabled)
//   3. system_config.MA_TOKEN_PRICE (current default: 0.1 USD)
export async function getMaPrice(): Promise<{ price: number; source: string }> {
  const { data, error } = await supabase
    .from("system_config")
    .select("key, value")
    .in("key", ["MA_TOKEN_PRICE", "MA_PRICE_SOURCE"]);
  if (error) throw error;
  const priceRow = (data ?? []).find((r: any) => r.key === "MA_TOKEN_PRICE");
  const sourceRow = (data ?? []).find((r: any) => r.key === "MA_PRICE_SOURCE");
  return {
    price: Number(priceRow?.value) || 0.1,
    source: sourceRow?.value || "DEFAULT",
  };
}

// Helper: proxy external API calls through Supabase Edge Function to avoid CORS
async function proxyFetch(url: string): Promise<any> {
  const { data, error } = await supabase.functions.invoke("api-proxy", {
    body: { url },
  });
  if (error) throw error;
  return data;
}

// ─────────────────────────────────────────────
// A) Direct Supabase queries (simple reads)
// ─────────────────────────────────────────────

export async function getProfile(walletAddress: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("wallet_address", walletAddress)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return toCamel(data);
}

export async function getStrategies() {
  const { data, error } = await supabase
    .from("strategies")
    .select("*")
    .order("created_at");
  if (error) throw error;
  return toCamel(data ?? []);
}

export async function getAiPredictions() {
  const { data, error } = await supabase
    .from("ai_predictions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return toCamel(data ?? []);
}

export async function getTradeBets(walletAddress: string) {
  const profile = await getProfile(walletAddress);
  if (!profile) return [];
  const { data, error } = await supabase
    .from("trade_bets")
    .select("*")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return toCamel(data ?? []);
}

export async function getVaultPositions(walletAddress: string) {
  const profile = await getProfile(walletAddress);
  if (!profile) return [];
  const { data, error } = await supabase
    .from("vault_positions")
    .select("*")
    .eq("user_id", profile.id)
    .order("start_date", { ascending: false });
  if (error) throw error;
  return toCamel(data ?? []);
}

export async function getVaultRewards(walletAddress: string) {
  const profile = await getProfile(walletAddress);
  if (!profile) return [];
  const { data, error } = await supabase
    .from("vault_rewards")
    .select("*")
    .eq("user_id", profile.id)
    .eq("reward_type", "DAILY_YIELD")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return toCamel(data ?? []);
}

export async function getTransactions(walletAddress: string, type?: string) {
  const profile = await getProfile(walletAddress);
  if (!profile) return [];
  let query = supabase
    .from("transactions")
    .select("*")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false });
  if (type) query = query.eq("type", type);
  const { data, error } = await query;
  if (error) throw error;
  return toCamel(data ?? []);
}

export async function getSubscriptions(walletAddress: string) {
  const profile = await getProfile(walletAddress);
  if (!profile) return [];
  const { data, error } = await supabase
    .from("strategy_subscriptions")
    .select("*")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return toCamel(data ?? []);
}

export async function getHedgePositions(walletAddress: string) {
  const profile = await getProfile(walletAddress);
  if (!profile) return [];
  const { data, error } = await supabase
    .from("hedge_positions")
    .select("*")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return toCamel(data ?? []);
}

export async function getHedgePurchases(walletAddress: string) {
  const profile = await getProfile(walletAddress);
  if (!profile) return [];
  const { data, error } = await supabase
    .from("insurance_purchases")
    .select("*")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return toCamel(data ?? []);
}

export async function getPredictionBets(walletAddress: string) {
  const profile = await getProfile(walletAddress);
  if (!profile) return [];
  const { data, error } = await supabase
    .from("prediction_bets")
    .select("*")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return toCamel(data ?? []);
}

export async function getNodeMembership(walletAddress: string) {
  const profile = await getProfile(walletAddress);
  if (!profile) return null;
  const { data, error } = await supabase
    .from("node_memberships")
    .select("*")
    .eq("user_id", profile.id)
    .order("start_date", { ascending: false })
    .limit(1)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return toCamel(data);
}

export async function getNodeMemberships(walletAddress: string) {
  const profile = await getProfile(walletAddress);
  if (!profile) return [];
  const { data, error } = await supabase
    .from("node_memberships")
    .select("*")
    .eq("user_id", profile.id)
    .order("start_date", { ascending: false });
  if (error) throw error;
  return toCamel(data ?? []);
}

export async function getNodeOverview(walletAddress: string) {
  const { data, error } = await supabase.rpc("get_node_overview", {
    addr: walletAddress,
  });
  if (error) throw error;
  return toCamel(data);
}

// ─────────────────────────────────────────────
// B) Supabase RPC functions (business logic)
// ─────────────────────────────────────────────

export async function authWallet(walletAddress: string, refCode?: string) {
  const { data, error } = await supabase.rpc("auth_wallet", {
    addr: walletAddress,
    ref_code: refCode || null,
  });
  if (error) throw error;
  return toCamel(data);
}

export async function vaultDeposit(walletAddress: string, planType: string, amount: number, txHash?: string) {
  const { data, error } = await supabase.rpc("vault_deposit", {
    addr: walletAddress,
    plan_type: planType,
    deposit_amount: amount,
    tx_hash: txHash || null,
  });
  if (error) throw error;
  return toCamel(data);
}

export async function vaultWithdraw(walletAddress: string, position_id: string) {
  const { data, error } = await supabase.rpc("vault_withdraw", {
    addr: walletAddress,
    pos_id: position_id,
  });
  if (error) throw error;
  return toCamel(data);
}

export async function placeTradeBet(
  walletAddress: string,
  asset: string,
  direction: string,
  amount: number,
  duration: string,
  entryPrice?: number
) {
  const { data, error } = await supabase.rpc("place_trade_bet", {
    addr: walletAddress,
    bet_asset: asset,
    bet_direction: direction,
    bet_amount: amount,
    bet_duration: duration || "1min",
    bet_entry_price: entryPrice || null,
  });
  if (error) throw error;
  return data;
}

export async function getTradeStats(walletAddress: string) {
  const { data, error } = await supabase.rpc("get_trade_stats", {
    addr: walletAddress,
  });
  if (error) throw error;
  return data ?? { total: 0, wins: 0, losses: 0, totalStaked: "0" };
}

export async function subscribeStrategy(walletAddress: string, strategyId: string, amount: number) {
  const { data, error } = await supabase.rpc("subscribe_strategy", {
    addr: walletAddress,
    strat_id: strategyId,
    capital: amount,
  });
  if (error) throw error;
  return toCamel(data);
}

export async function purchaseHedge(walletAddress: string, amount: number) {
  const { data, error } = await supabase.rpc("purchase_hedge", {
    addr: walletAddress,
    hedge_amount: amount,
  });
  if (error) throw error;
  return toCamel(data);
}

export async function subscribeVip(walletAddress: string, txHash?: string, planLabel?: string) {
  const { data, error } = await supabase.rpc("subscribe_vip", {
    addr: walletAddress,
    tx_hash: txHash || null,
    plan_label: planLabel || "monthly",
  });
  if (error) throw error;
  return toCamel(data);
}

export async function purchaseNode(walletAddress: string, nodeType: string, txHash?: string, paymentMode?: string) {
  const { data, error } = await supabase.rpc("purchase_node", {
    addr: walletAddress,
    node_type_param: nodeType,
    tx_hash: txHash || null,
    payment_mode_param: paymentMode || "FULL",
  });
  if (error) throw error;
  return toCamel(data);
}

export async function checkNodeMilestones(walletAddress: string) {
  const { data, error } = await supabase.rpc("check_node_milestones", {
    addr: walletAddress,
  });
  if (error) throw error;
  return toCamel(data);
}

export async function placePredictionBet(
  walletAddress: string,
  marketId: string,
  marketType: string,
  question: string,
  choice: string,
  odds: number,
  amount: number
) {
  const { data, error } = await supabase.rpc("place_prediction_bet", {
    addr: walletAddress,
    market_id_param: marketId,
    market_type_param: marketType || "polymarket",
    question_param: question || "",
    choice_param: choice,
    odds_param: odds || 1,
    amount_param: amount,
  });
  if (error) throw error;
  return toCamel(data);
}

export async function getVaultOverview() {
  const { data, error } = await supabase.rpc("get_vault_overview");
  if (error) throw error;
  return toCamel(data);
}

export async function getStrategyOverview() {
  const { data, error } = await supabase.rpc("get_strategy_overview");
  if (error) throw error;
  return toCamel(data);
}

export async function getInsurancePool() {
  const { data, error } = await supabase.rpc("get_insurance_pool");
  if (error) throw error;
  return toCamel(data);
}

export async function getCommissionRecords(walletAddress: string) {
  const profile = await getProfile(walletAddress);
  if (!profile) return { totalCommission: "0", directReferralTotal: "0", differentialTotal: "0", records: [] };

  const { data, error } = await supabase
    .from("node_rewards")
    .select("*")
    .eq("user_id", profile.id)
    .eq("reward_type", "TEAM_COMMISSION")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const records = (data ?? []).map((r: any) => {
    const rec = toCamel(r);
    rec.details = r.details || {};
    return rec;
  });

  let directTotal = 0;
  let diffTotal = 0;
  for (const r of records) {
    const amt = Number(r.amount || 0);
    if (r.details?.type === "direct_referral") directTotal += amt;
    else diffTotal += amt;
  }

  // Enrich with source user wallet addresses
  const sourceIds = Array.from(new Set(records.map((r: any) => r.details?.source_user || r.details?.sourceUser).filter(Boolean)));
  let sourceMap: Record<string, { wallet: string; rank: string }> = {};
  if (sourceIds.length > 0) {
    const { data: sources } = await supabase
      .from("profiles")
      .select("id, wallet_address, rank")
      .in("id", sourceIds);
    if (sources) {
      for (const s of sources) {
        sourceMap[s.id] = { wallet: s.wallet_address, rank: s.rank };
      }
    }
  }

  for (const r of records) {
    const sid = r.details?.source_user || r.details?.sourceUser;
    if (sid && sourceMap[sid]) {
      r.sourceWallet = sourceMap[sid].wallet;
      r.sourceRank = sourceMap[sid].rank;
    }
  }

  return {
    totalCommission: (directTotal + diffTotal).toFixed(6),
    directReferralTotal: directTotal.toFixed(6),
    differentialTotal: diffTotal.toFixed(6),
    records,
  };
}

export async function getNodeEarningsRecords(walletAddress: string) {
  const profile = await getProfile(walletAddress);
  if (!profile) return [];

  const { data, error } = await supabase
    .from("node_rewards")
    .select("*")
    .eq("user_id", profile.id)
    .in("reward_type", ["FIXED_YIELD", "POOL_DIVIDEND"])
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((r: any) => {
    const rec = toCamel(r);
    rec.details = r.details || {};
    return rec;
  });
}

export async function getReferralTree(walletAddress: string) {
  const { data, error } = await supabase.rpc("get_referral_tree", {
    addr: walletAddress,
  });
  if (error) throw error;
  return data ?? { referrals: [], teamSize: 0, directCount: 0 };
}

// ─────────────────────────────────────────────
// C) Direct external API calls (public, no keys)
// ─────────────────────────────────────────────

const COIN_MAP: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", BNB: "binancecoin", DOGE: "dogecoin", SOL: "solana",
};

async function getBinancePrice(symbol: string): Promise<number> {
  try {
    const pair = symbol === "DOGE" ? "DOGEUSDT" : `${symbol}USDT`;
    const res = await fetch(`https://api.binance.us/api/v3/ticker/price?symbol=${pair}`);
    if (res.ok) {
      const data = await res.json();
      return parseFloat(data.price) || 0;
    }
  } catch {}
  return 0;
}

async function getBinanceKlines(symbol: string, days: number): Promise<[number, number][]> {
  try {
    const pair = symbol === "DOGE" ? "DOGEUSDT" : `${symbol}USDT`;
    const endTime = Date.now();
    const startTime = endTime - days * 24 * 60 * 60 * 1000;
    const res = await fetch(
      `https://api.binance.us/api/v3/klines?symbol=${pair}&interval=1d&startTime=${startTime}&endTime=${endTime}&limit=${days + 1}`
    );
    if (res.ok) {
      const data = await res.json();
      return (data as any[]).map((k: any) => [k[0], parseFloat(k[4])]);
    }
  } catch {}
  return [];
}

export async function fetchExchangeDepth(symbol: string) {
  const pair = `${symbol.toUpperCase()}USDT`;
  const [depthRes, tickerRes] = await Promise.all([
    fetch(`https://api.binance.us/api/v3/depth?symbol=${pair}&limit=20`),
    fetch(`https://api.binance.us/api/v3/ticker/24hr?symbol=${pair}`),
  ]);

  const depth = depthRes.ok ? await depthRes.json() : { bids: [], asks: [] };
  const ticker = tickerRes.ok ? await tickerRes.json() : {};

  const bidsTotal = (depth.bids || []).reduce((s: number, b: [string, string]) => s + parseFloat(b[0]) * parseFloat(b[1]), 0);
  const asksTotal = (depth.asks || []).reduce((s: number, a: [string, string]) => s + parseFloat(a[0]) * parseFloat(a[1]), 0);
  const total = bidsTotal + asksTotal || 1;
  const baseBuy = (bidsTotal / total) * 100;
  const priceChange = parseFloat(ticker.priceChangePercent || "0");

  // Simulate multi-exchange data with realistic variance from Binance real data
  const exchangeNames = [
    "Binance", "OKX", "Bybit", "Bitget", "Kraken",
    "Coinbase", "Gate", "MEXC", "CoinEx", "LBank",
    "Hyperliquid", "Bitmex", "Crypto.com", "Bitunix",
    "KuCoin", "Huobi",
  ];
  const exchanges = exchangeNames.map((name, i) => {
    // Use a deterministic seed per symbol+exchange for consistent data
    const seed = (symbol.charCodeAt(0) * 31 + i * 17) % 100;
    const variance = ((seed - 50) / 50) * 6; // ±6% variance
    const buy = Math.max(20, Math.min(80, baseBuy + variance));
    const sell = 100 - buy;
    return {
      name,
      buyPercent: parseFloat(buy.toFixed(1)),
      sellPercent: parseFloat(sell.toFixed(1)),
    };
  });

  // Calculate FGI based on buy/sell ratio and price change
  let fgi = 50;
  fgi += (baseBuy - 50) * 0.6; // order book sentiment
  fgi += Math.max(-15, Math.min(15, priceChange * 3)); // price momentum
  fgi = Math.max(0, Math.min(100, Math.round(fgi)));
  const fgiLabel = fgi <= 25 ? "Extreme Fear" : fgi <= 45 ? "Fear" : fgi <= 55 ? "Neutral" : fgi <= 75 ? "Greed" : "Extreme Greed";

  return {
    symbol: symbol.toUpperCase(),
    price: parseFloat(ticker.lastPrice || "0"),
    change24h: priceChange,
    buyPercent: parseFloat(baseBuy.toFixed(1)),
    sellPercent: parseFloat((100 - baseBuy).toFixed(1)),
    buyVolume: bidsTotal,
    sellVolume: asksTotal,
    fearGreedIndex: fgi,
    fearGreedLabel: fgiLabel,
    exchanges,
  };
}

export async function fetchPolymarkets() {
  try {
    const markets = await proxyFetch(
      "https://gamma-api.polymarket.com/markets?closed=false&limit=20&order=volume24hr&ascending=false&tag=crypto"
    );
    return (markets || [])
      .filter((m: any) => m.active && !m.closed)
      .slice(0, 15)
      .map((m: any) => {
        let prices: string[] = [];
        try {
          prices = typeof m.outcomePrices === "string" ? JSON.parse(m.outcomePrices) : m.outcomePrices || [];
        } catch { prices = []; }
        const yesRaw = parseFloat(prices[0] || m.bestAsk || "0.5");
        const noRaw = parseFloat(prices[1] || m.bestBid || "0.5");
        return {
          id: m.id || m.conditionId,
          question: m.question,
          yesPrice: isNaN(yesRaw) ? 0.5 : yesRaw,
          noPrice: isNaN(noRaw) ? 0.5 : noRaw,
          volume: parseFloat(m.volume24hr || m.volume || "0") || 0,
          liquidity: parseFloat(m.liquidity || "0") || 0,
          endDate: m.endDate || m.expirationDate,
          image: m.image,
          category: "crypto",
          slug: m.slug || m.conditionId || m.id,
        };
      });
  } catch {
    return [];
  }
}

function getFgiLabel(v: number): string {
  if (v <= 25) return "Extreme Fear";
  if (v <= 45) return "Fear";
  if (v <= 55) return "Neutral";
  if (v <= 75) return "Greed";
  return "Extreme Greed";
}

function addToBuckets(buckets: any, v: number) {
  if (v <= 25) buckets.extremeFear++;
  else if (v <= 45) buckets.fear++;
  else if (v <= 55) buckets.neutral++;
  else if (v <= 75) buckets.greed++;
  else buckets.extremeGreed++;
}

export async function fetchFearGreedHistory(coin: string) {
  const symbol = (coin || "BTC").toUpperCase();
  const coinId = COIN_MAP[symbol] || "bitcoin";

  const fngRes = await fetch("https://api.alternative.me/fng/?limit=90");
  const fngData = await fngRes.json();
  const fgiEntries = fngData.data || [];

  if (symbol === "BTC") {
    const buckets = { extremeFear: 0, fear: 0, neutral: 0, greed: 0, extremeGreed: 0 };
    for (const entry of fgiEntries) addToBuckets(buckets, parseInt(entry.value));
    const current = fgiEntries[0]
      ? { value: parseInt(fgiEntries[0].value), label: fgiEntries[0].value_classification }
      : { value: 50, label: "Neutral" };
    const chartData: { date: string; fgi: number; btcPrice: number }[] = [];
    const reversed = [...fgiEntries].reverse();
    for (const entry of reversed) {
      const ts = parseInt(entry.timestamp) * 1000;
      chartData.push({ date: new Date(ts).toISOString().split("T")[0], fgi: parseInt(entry.value), btcPrice: 0 });
    }
    return { current, buckets, totalDays: fgiEntries.length, chartData, lastUpdated: new Date().toISOString() };
  }

  let coinPrices: [number, number][] = [];
  let coinVolumes: [number, number][] = [];
  try {
    const coinData = await proxyFetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=90&interval=daily`
    );
    coinPrices = (coinData.prices as [number, number][]) || [];
    coinVolumes = (coinData.total_volumes as [number, number][]) || [];
  } catch {}

  const buckets = { extremeFear: 0, fear: 0, neutral: 0, greed: 0, extremeGreed: 0 };
  const chartData: { date: string; fgi: number; btcPrice: number }[] = [];

  if (coinPrices.length >= 2) {
    const dailyScores: { date: string; score: number; price: number }[] = [];
    for (let i = 1; i < coinPrices.length; i++) {
      const [ts, price] = coinPrices[i];
      const prevPrice = coinPrices[i - 1][1];
      const dateStr = new Date(ts).toISOString().split("T")[0];
      const priceChange1d = ((price - prevPrice) / prevPrice) * 100;
      const lookback7 = Math.max(0, i - 7);
      const momentum7d = ((price - coinPrices[lookback7][1]) / coinPrices[lookback7][1]) * 100;
      const lookback14 = Math.max(0, i - 14);
      const priceSlice = coinPrices.slice(lookback14, i + 1).map(p => p[1]);
      const mean = priceSlice.reduce((a, b) => a + b, 0) / priceSlice.length;
      const variance = priceSlice.reduce((a, b) => a + (b - mean) ** 2, 0) / priceSlice.length;
      const volatility = Math.sqrt(variance) / mean * 100;
      let volChange = 0;
      if (coinVolumes.length > i && i > 0) {
        const vol = coinVolumes[i][1];
        const prevVol = coinVolumes[Math.max(0, i - 1)][1];
        volChange = prevVol > 0 ? ((vol - prevVol) / prevVol) * 100 : 0;
      }
      let score = 50;
      score += Math.max(-20, Math.min(20, momentum7d * 2.5));
      score += Math.max(-10, Math.min(10, priceChange1d * 3));
      score -= Math.max(0, Math.min(15, (volatility - 3) * 3));
      score += Math.max(-5, Math.min(5, volChange * 0.05));
      score = Math.max(0, Math.min(100, Math.round(score)));
      dailyScores.push({ date: dateStr, score, price });
    }
    for (const ds of dailyScores) {
      addToBuckets(buckets, ds.score);
      chartData.push({ date: ds.date, fgi: ds.score, btcPrice: ds.price });
    }
    const latest = dailyScores[dailyScores.length - 1];
    return { current: { value: latest.score, label: getFgiLabel(latest.score) }, buckets, totalDays: dailyScores.length, chartData, lastUpdated: new Date().toISOString() };
  }

  // Fallback: adjust global BTC FGI with coin offset
  const baseFgi = fgiEntries[0] ? parseInt(fgiEntries[0].value) : 50;
  const coinOffsets: Record<string, number> = { ETH: -3, SOL: 8, BNB: 2, DOGE: 12 };
  const offset = coinOffsets[symbol] || 0;
  const adjusted = Math.max(0, Math.min(100, baseFgi + offset));
  const reversed = [...fgiEntries].reverse();
  for (const entry of reversed) {
    const rawVal = parseInt(entry.value);
    const coinVal = Math.max(0, Math.min(100, rawVal + offset));
    const ts = parseInt(entry.timestamp) * 1000;
    addToBuckets(buckets, coinVal);
    chartData.push({ date: new Date(ts).toISOString().split("T")[0], fgi: coinVal, btcPrice: 0 });
  }
  return { current: { value: adjusted, label: getFgiLabel(adjusted) }, buckets, totalDays: fgiEntries.length, chartData, lastUpdated: new Date().toISOString() };
}

export async function fetchMarketCalendar(coin: string) {
  const symbol = (coin || "BTC").toUpperCase();
  const coinId = COIN_MAP[symbol] || "bitcoin";

  let prices: [number, number][] = [];
  let currentPrice = 0;

  try {
    const data = await proxyFetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=30&interval=daily`
    );
    prices = data.prices as [number, number][];
    currentPrice = prices[prices.length - 1]?.[1] || 0;
  } catch {}

  if (prices.length < 2) {
    prices = await getBinanceKlines(symbol, 30);
    if (prices.length > 0) currentPrice = prices[prices.length - 1][1];
  }

  if (currentPrice === 0) currentPrice = await getBinancePrice(symbol);

  const dailyChanges: { date: string; day: number; change: number }[] = [];
  for (let i = 1; i < prices.length; i++) {
    const [ts, price] = prices[i];
    const prevPrice = prices[i - 1][1];
    if (prevPrice === 0) continue;
    const change = ((price - prevPrice) / prevPrice) * 100;
    const d = new Date(ts);
    dailyChanges.push({
      date: d.toISOString().split("T")[0],
      day: d.getDate(),
      change: parseFloat(change.toFixed(2)),
    });
  }

  return { dailyChanges, currentPrice };
}

export async function fetchSentiment() {
  const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "DOGEUSDT"];
  const symbolToName: Record<string, { name: string; symbol: string; id: string }> = {
    BTCUSDT: { name: "Bitcoin", symbol: "BTC", id: "bitcoin" },
    ETHUSDT: { name: "Ethereum", symbol: "ETH", id: "ethereum" },
    SOLUSDT: { name: "Solana", symbol: "SOL", id: "solana" },
    BNBUSDT: { name: "BNB", symbol: "BNB", id: "binancecoin" },
    DOGEUSDT: { name: "Dogecoin", symbol: "DOGE", id: "dogecoin" },
  };

  const [binanceRes, coingeckoCoins] = await Promise.all([
    fetch("https://api.binance.us/api/v3/ticker/24hr"),
    proxyFetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,binancecoin,dogecoin,solana&order=market_cap_desc&sparkline=false&price_change_percentage=24h,7d").catch(() => []),
  ]);

  let binanceTickers: any[] = [];
  try { binanceTickers = await binanceRes.json(); } catch {}

  const coingeckoMap = new Map<string, any>();
  if (Array.isArray(coingeckoCoins)) {
    for (const c of coingeckoCoins) coingeckoMap.set(c.id, c);
  }

  const sentiment = symbols.map((pair) => {
    const meta = symbolToName[pair];
    const cgCoin = coingeckoMap.get(meta.id);
    const bnTicker = Array.isArray(binanceTickers) ? binanceTickers.find((t: any) => t.symbol === pair) : null;
    const bnVolume = bnTicker ? parseFloat(bnTicker.quoteVolume || "0") : 0;
    const bnChange = bnTicker ? parseFloat(bnTicker.priceChangePercent || "0") : 0;
    const bnPrice = bnTicker ? parseFloat(bnTicker.lastPrice || "0") : 0;
    const cgVol = cgCoin?.total_volume || 0;
    const cgChange = cgCoin?.price_change_percentage_24h || 0;
    const totalVolume = bnVolume + cgVol;
    const avgChange = bnTicker ? (bnChange + cgChange) / 2 : cgChange;
    const netFlowRaw = totalVolume * (avgChange / 100) * 0.15;
    return {
      id: meta.id, symbol: meta.symbol, name: meta.name,
      image: cgCoin?.image || "",
      price: bnPrice || cgCoin?.current_price || 0,
      change24h: avgChange,
      change7d: cgCoin?.price_change_percentage_7d_in_currency || 0,
      marketCap: cgCoin?.market_cap || 0,
      volume: totalVolume,
      netFlow: parseFloat(netFlowRaw.toFixed(0)),
      binanceVolume: bnVolume,
      exchanges: bnTicker ? ["Binance", "CoinGecko Aggregated"] : ["CoinGecko Aggregated"],
    };
  });

  sentiment.sort((a, b) => Math.abs(b.netFlow) - Math.abs(a.netFlow));
  return { coins: sentiment, totalNetInflow: sentiment.reduce((s, c) => s + c.netFlow, 0) };
}

export async function fetchFuturesOI() {
  const pairs = [
    { symbol: "BTCUSDT", label: "BTC" },
    { symbol: "ETHUSDT", label: "ETH" },
    { symbol: "SOLUSDT", label: "SOL" },
  ];
  const exchanges = [
    { name: "Binance", weight: 0.38 },
    { name: "OKX", weight: 0.22 },
    { name: "Bybit", weight: 0.18 },
    { name: "Bitget", weight: 0.12 },
    { name: "Gate", weight: 0.10 },
  ];

  const tickerRes = await fetch("https://api.binance.us/api/v3/ticker/24hr");
  let allTickers: any[] = [];
  try { allTickers = await tickerRes.json(); } catch {}

  const results: any[] = [];
  let totalOI = 0;

  for (const pair of pairs) {
    const ticker = Array.isArray(allTickers) ? allTickers.find((t: any) => t.symbol === pair.symbol) : null;
    const price = ticker ? parseFloat(ticker.lastPrice || "0") : 0;
    const volume = ticker ? parseFloat(ticker.quoteVolume || "0") : 0;
    const priceChange = ticker ? parseFloat(ticker.priceChangePercent || "0") : 0;

    for (const ex of exchanges) {
      const oiBase = volume * ex.weight * 0.4;
      const jitter = 1 + (Math.random() * 0.06 - 0.03);
      const oiValue = oiBase * jitter;
      totalOI += oiValue;
      results.push({
        pair: pair.symbol, symbol: pair.label, exchange: ex.name,
        openInterestValue: oiValue,
        openInterest: price > 0 ? Math.round(oiValue / price) : 0,
        price, priceChange24h: priceChange,
      });
    }
  }

  return { positions: results, totalOI };
}

export async function fetchExchangePrices() {
  const coins = [
    { symbol: "BTC", binancePair: "BTCUSDT", krakenPair: "XXBTZUSD", coinbaseId: "BTC", cgId: "bitcoin" },
    { symbol: "ETH", binancePair: "ETHUSDT", krakenPair: "XETHZUSD", coinbaseId: "ETH", cgId: "ethereum" },
    { symbol: "SOL", binancePair: "SOLUSDT", krakenPair: "SOLUSD", coinbaseId: "SOL", cgId: "solana" },
    { symbol: "BNB", binancePair: "BNBUSDT", krakenPair: null as string | null, coinbaseId: null as string | null, cgId: "binancecoin" },
    { symbol: "DOGE", binancePair: "DOGEUSDT", krakenPair: "XDGUSD", coinbaseId: "DOGE", cgId: "dogecoin" },
  ];

  const exchangeNames = [
    "Binance", "OKX", "Bybit", "Bitget", "Kraken",
    "Coinbase", "Gate", "MEXC", "CoinEx", "LBank",
    "Hyperliquid", "Bitmex", "Crypto.com", "Bitunix",
    "KuCoin", "Huobi",
  ];

  const coinbaseSymbols = coins.map(c => c.symbol);
  const [bnTickersRaw, krakenRaw, cgRaw, ...coinbaseResults] = await Promise.all([
    fetch("https://api.binance.us/api/v3/ticker/24hr").then(r => r.json()).catch(() => []),
    fetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSD,XETHZUSD,SOLUSD,XDGUSD").then(r => r.json()).catch(() => null),
    proxyFetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin,dogecoin&vs_currencies=usd").catch(() => null),
    ...coinbaseSymbols.map(sym =>
      fetch(`https://api.coinbase.com/v2/prices/${sym}-USD/spot`).then(r => r.json()).catch(() => null)
    ),
  ]);

  const bnTickers = Array.isArray(bnTickersRaw) ? bnTickersRaw : [];
  const krakenResult = krakenRaw?.result || {};
  const coinbasePrices: Record<string, number> = {};
  coinbaseSymbols.forEach((sym, i) => {
    const amt = coinbaseResults[i]?.data?.amount;
    if (amt) coinbasePrices[sym] = parseFloat(amt);
  });

  const allCoinsData: any[] = [];
  for (const coin of coins) {
    const bnTicker = bnTickers.find((t: any) => t.symbol === coin.binancePair);
    const bnPrice = bnTicker ? parseFloat(bnTicker.lastPrice || "0") : 0;
    const bnChange = bnTicker ? parseFloat(bnTicker.priceChangePercent || "0") : 0;
    let krakenPrice = 0;
    if (coin.krakenPair && krakenResult[coin.krakenPair]) {
      krakenPrice = parseFloat(krakenResult[coin.krakenPair].c?.[0] || "0");
    }
    const cbPrice = coinbasePrices[coin.symbol] || 0;
    const cgPrice = cgRaw?.[coin.cgId]?.usd || 0;
    const basePrice = bnPrice || krakenPrice || cbPrice || cgPrice || 0;
    if (basePrice === 0) continue;

    const realPrices: Record<string, number> = {};
    if (bnPrice > 0) realPrices["Binance"] = bnPrice;
    if (krakenPrice > 0) realPrices["Kraken"] = krakenPrice;
    if (cbPrice > 0) realPrices["Coinbase"] = cbPrice;
    if (cgPrice > 0) realPrices["CoinGecko"] = cgPrice;

    const spreadFactor = basePrice * 0.0003;
    const rows = exchangeNames.map((exName) => {
      const realP = realPrices[exName];
      const spread = (Math.random() * 2 - 1) * spreadFactor;
      const price = realP || (basePrice + spread);
      const change = bnChange + (Math.random() * 0.4 - 0.2);
      return {
        exchange: exName, pair: `${coin.symbol}/USDT`, symbol: coin.symbol,
        price: parseFloat(price.toFixed(coin.symbol === "DOGE" ? 5 : 2)),
        change24h: parseFloat(change.toFixed(2)),
        isReal: !!realP,
      };
    });
    allCoinsData.push({ symbol: coin.symbol, basePrice, baseChange: bnChange, exchanges: rows });
  }
  return allCoinsData;
}

// ─────────────────────────────────────────────
// D) Supabase Edge Functions (need API keys)
// ─────────────────────────────────────────────

export async function getAiPrediction(asset: string, timeframe: string, lang?: string) {
  const { data, error } = await supabase.functions.invoke("ai-prediction", {
    body: { asset, timeframe, lang: lang || "en" },
  });
  if (error) throw error;
  return data;
}

export async function getAiForecast(asset: string, timeframe: string, lang?: string) {
  const { data, error } = await supabase.functions.invoke("ai-forecast", {
    body: { asset, timeframe, lang: lang || "en" },
  });
  if (error) throw error;
  return data;
}

export async function getAiForecastMulti(asset: string, timeframe: string, lang?: string) {
  const { data, error } = await supabase.functions.invoke("ai-forecast-multi", {
    body: { asset, timeframe, lang: lang || "en" },
  });
  if (error) throw error;
  return data;
}

export async function getAiFearGreed() {
  const { data, error } = await supabase.functions.invoke("ai-fear-greed");
  if (error) throw error;
  return data;
}

export async function getNewsPredictions() {
  const { data, error } = await supabase.functions.invoke("news-predictions");
  if (error) throw error;
  return data;
}
