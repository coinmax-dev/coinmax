/**
 * On-Chain Data Feed
 *
 * Phase 2: Fetch derivatives & on-chain metrics from public APIs.
 * Sources: Coinglass (funding, OI, L/S ratio), CoinGecko (market data).
 *
 * Reference: TECHNICAL_PLAN.md Phase 2.2
 */

// ── Types ───────────────────────────────────────────────────

export interface OnChainMetrics {
  fundingRate: number;
  openInterestChange: number;
  longShortRatio: number;
  exchangeNetflow: number;
  liquidation24h: { long: number; short: number };
}

export interface MarketOverview {
  marketCap: number;
  volume24h: number;
  btcDominance: number;
  priceChange1h: number;
  priceChange24h: number;
  priceChange7d: number;
}

// ── Cache ───────────────────────────────────────────────────

interface CacheEntry<T> { data: T; expiresAt: number; }
const cache = new Map<string, CacheEntry<any>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  return null;
}

function setCache<T>(key: string, data: T, ttlMs: number): T {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

// ── Fetchers ────────────────────────────────────────────────

async function fetchWithTimeout(url: string, timeoutMs = 5000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

/**
 * Fetch funding rate from Binance Futures API (public, no auth needed).
 */
export async function fetchFundingRate(asset: string): Promise<number> {
  const key = `funding:${asset}`;
  const cached = getCached<number>(key);
  if (cached !== null) return cached;

  try {
    const symbol = `${asset.toUpperCase()}USDT`;
    const data = await fetchWithTimeout(
      `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`
    );
    const rate = parseFloat(data?.[0]?.fundingRate ?? "0");
    return setCache(key, rate, 5 * 60 * 1000);
  } catch {
    return 0;
  }
}

/**
 * Fetch open interest from Binance Futures (public).
 */
export async function fetchOpenInterest(asset: string): Promise<{ current: number; change: number }> {
  const key = `oi:${asset}`;
  const cached = getCached<{ current: number; change: number }>(key);
  if (cached !== null) return cached;

  try {
    const symbol = `${asset.toUpperCase()}USDT`;
    const data = await fetchWithTimeout(
      `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`
    );
    const current = parseFloat(data?.openInterest ?? "0");
    // Get historical for change calculation
    const hist = await fetchWithTimeout(
      `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=2`
    );
    const prev = parseFloat(hist?.[0]?.sumOpenInterest ?? "0");
    const change = prev > 0 ? ((current - prev) / prev) * 100 : 0;
    return setCache(key, { current, change }, 5 * 60 * 1000);
  } catch {
    return { current: 0, change: 0 };
  }
}

/**
 * Fetch long/short ratio from Binance Futures (public).
 */
export async function fetchLongShortRatio(asset: string): Promise<number> {
  const key = `lsr:${asset}`;
  const cached = getCached<number>(key);
  if (cached !== null) return cached;

  try {
    const symbol = `${asset.toUpperCase()}USDT`;
    const data = await fetchWithTimeout(
      `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`
    );
    const ratio = parseFloat(data?.[0]?.longShortRatio ?? "1");
    return setCache(key, ratio, 5 * 60 * 1000);
  } catch {
    return 1;
  }
}

/**
 * Fetch top trader long/short ratio (position-based).
 */
export async function fetchTopTraderRatio(asset: string): Promise<number> {
  const key = `toptrader:${asset}`;
  const cached = getCached<number>(key);
  if (cached !== null) return cached;

  try {
    const symbol = `${asset.toUpperCase()}USDT`;
    const data = await fetchWithTimeout(
      `https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=1h&limit=1`
    );
    const ratio = parseFloat(data?.[0]?.longShortRatio ?? "1");
    return setCache(key, ratio, 5 * 60 * 1000);
  } catch {
    return 1;
  }
}

/**
 * Fetch 24h liquidation data from Binance Futures.
 */
export async function fetchLiquidations(asset: string): Promise<{ long: number; short: number }> {
  const key = `liq:${asset}`;
  const cached = getCached<{ long: number; short: number }>(key);
  if (cached !== null) return cached;

  try {
    const symbol = `${asset.toUpperCase()}USDT`;
    // Use recent forced orders (allForceOrders) — limited in public API
    // Fallback: use taker buy/sell volume as proxy
    const data = await fetchWithTimeout(
      `https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${symbol}&period=1d&limit=1`
    );
    const buyVol = parseFloat(data?.[0]?.buyVol ?? "0");
    const sellVol = parseFloat(data?.[0]?.sellVol ?? "0");
    return setCache(key, { long: sellVol, short: buyVol }, 10 * 60 * 1000);
  } catch {
    return { long: 0, short: 0 };
  }
}

/**
 * Fetch market overview from CoinGecko (free, no API key).
 */
export async function fetchMarketOverview(asset: string): Promise<MarketOverview> {
  const key = `market:${asset}`;
  const cached = getCached<MarketOverview>(key);
  if (cached !== null) return cached;

  const coinIds: Record<string, string> = {
    BTC: "bitcoin", ETH: "ethereum", SOL: "solana",
    BNB: "binancecoin", DOGE: "dogecoin", XRP: "ripple",
  };
  const coinId = coinIds[asset.toUpperCase()] ?? asset.toLowerCase();

  try {
    const data = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`
    );
    const md = data?.market_data;
    const result: MarketOverview = {
      marketCap: md?.market_cap?.usd ?? 0,
      volume24h: md?.total_volume?.usd ?? 0,
      btcDominance: 0,
      priceChange1h: md?.price_change_percentage_1h_in_currency?.usd ?? 0,
      priceChange24h: md?.price_change_percentage_24h ?? 0,
      priceChange7d: md?.price_change_percentage_7d ?? 0,
    };
    return setCache(key, result, 5 * 60 * 1000);
  } catch {
    return { marketCap: 0, volume24h: 0, btcDominance: 0, priceChange1h: 0, priceChange24h: 0, priceChange7d: 0 };
  }
}

// ── Aggregate: All On-Chain Metrics ─────────────────────────

export async function fetchAllOnChainMetrics(asset: string): Promise<OnChainMetrics> {
  const [fundingRate, oi, lsr, liq] = await Promise.all([
    fetchFundingRate(asset),
    fetchOpenInterest(asset),
    fetchLongShortRatio(asset),
    fetchLiquidations(asset),
  ]);

  return {
    fundingRate,
    openInterestChange: oi.change,
    longShortRatio: lsr,
    exchangeNetflow: 0, // Would need Glassnode/CryptoQuant API (paid)
    liquidation24h: liq,
  };
}

/**
 * Generate a human-readable summary for AI prompt injection.
 */
export function onChainSummary(metrics: OnChainMetrics): string {
  const parts: string[] = [];

  // Funding
  const fundingLabel = metrics.fundingRate > 0.0001 ? "positive(longs_pay)" :
    metrics.fundingRate < -0.0001 ? "negative(shorts_pay)" : "neutral";
  parts.push(`Funding=${(metrics.fundingRate * 100).toFixed(4)}%(${fundingLabel})`);

  // OI
  const oiLabel = metrics.openInterestChange > 2 ? "rising" :
    metrics.openInterestChange < -2 ? "falling" : "stable";
  parts.push(`OI_change=${metrics.openInterestChange.toFixed(1)}%(${oiLabel})`);

  // L/S ratio
  const lsLabel = metrics.longShortRatio > 1.2 ? "long_heavy" :
    metrics.longShortRatio < 0.8 ? "short_heavy" : "balanced";
  parts.push(`L/S_ratio=${metrics.longShortRatio.toFixed(2)}(${lsLabel})`);

  // Liquidations
  if (metrics.liquidation24h.long > 0 || metrics.liquidation24h.short > 0) {
    const total = metrics.liquidation24h.long + metrics.liquidation24h.short;
    const longPct = total > 0 ? (metrics.liquidation24h.long / total * 100).toFixed(0) : "50";
    parts.push(`Liq: ${longPct}%_longs_liquidated`);
  }

  return parts.join(", ");
}
