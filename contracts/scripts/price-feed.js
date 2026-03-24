/**
 * MA Price Feed — High-Frequency K-Line
 *
 * Phase 0 (Mar 24-31): $0.30 → $0.90 (每小时更新，168个价格点)
 * Phase 1 (Apr):       $0.90 → $1.00 (每小时，稳定波动)
 * Phase 2 (May+):      $1.00+ (每小时，月均5%增长)
 *
 * Cron: every 1 hour via thirdweb Engine
 *
 * Usage:
 *   node scripts/price-feed.js                  # preview K-line
 *   node scripts/price-feed.js --execute        # push current price
 */

const ORACLE_ADDRESS = process.env.ORACLE_ADDRESS;
const THIRDWEB_SECRET_KEY = process.env.THIRDWEB_SECRET_KEY || process.env.VITE_THIRDWEB_SECRET_KEY;
const SERVER_WALLET = process.env.SERVER_WALLET_ADDRESS || "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";
const CHAIN_ID = 56;
const LAUNCH_DATE = new Date("2026-03-24T00:00:00Z");

// ═══════════════════════════════════════════════════════════════
//  PHASE 0 CONFIG: $0.30 → $0.90 in 168 hours
// ═══════════════════════════════════════════════════════════════

// 7天 = 168小时, 每小时一个价格点
// 总体趋势: S曲线上涨 + 噪声模拟真实K线
// 每小时波动 ±1-3%，有回调有拉升

const PHASE0 = {
  startPrice: 0.30,
  endPrice: 0.90,
  hours: 168,

  // 每日的"情绪"(控制涨跌节奏)
  // momentum > 0 = 多头, < 0 = 空头回调
  dailyMomentum: [
    // Mar 24: 试探性上涨
    { base: 0.6, volatility: 0.015 },
    // Mar 25: 突破确认，放量
    { base: 0.8, volatility: 0.020 },
    // Mar 26: 强势拉升
    { base: 1.0, volatility: 0.025 },
    // Mar 27: 获利回吐，震荡
    { base: 0.3, volatility: 0.020 },
    // Mar 28: 二次拉升
    { base: 0.9, volatility: 0.025 },
    // Mar 29: 主升浪
    { base: 1.2, volatility: 0.030 },
    // Mar 30-31: 冲刺+整理
    { base: 0.7, volatility: 0.020 },
  ],

  // 日内节奏 (24小时内的波动模式)
  // 亚洲早盘活跃 → 欧盘拉升 → 美盘波动 → 深夜平稳
  hourlyPattern: [
    0.3, 0.2, 0.1, 0.0, -0.1, -0.2,  // 00-05 UTC 深夜平淡
    0.4, 0.6, 0.8, 0.7, 0.5, 0.3,     // 06-11 UTC 亚洲早盘活跃
    0.5, 0.7, 0.9, 1.0, 0.8, 0.6,     // 12-17 UTC 欧盘+美盘
    0.4, 0.2, 0.0, -0.1, 0.1, 0.2,    // 18-23 UTC 收盘整理
  ],
};

// ═══════════════════════════════════════════════════════════════
//  PHASE 1 & 2 CONFIG
// ═══════════════════════════════════════════════════════════════

const PHASE1 = {
  startHour: 168,
  endHour: 168 + 30 * 24, // 30 days
  startPrice: 0.90,
  endPrice: 1.00,
  hourlyVolatility: 0.008, // ±0.8% per hour
};

const PHASE2 = {
  startHour: 168 + 30 * 24,
  monthlyGrowth: 0.05,
  hourlyVolatility: 0.010, // ±1% per hour
  maxHourlyChange: 0.03,   // 3% per hour cap
};

// ═══════════════════════════════════════════════════════════════
//  PRICE CALCULATION
// ═══════════════════════════════════════════════════════════════

function calculatePrice(prevPrice, hoursSinceLaunch) {
  // Phase 0: K-line to $0.90
  if (hoursSinceLaunch <= PHASE0.hours) {
    return calcPhase0(prevPrice, hoursSinceLaunch);
  }

  // Phase 1: Stabilize $0.90 → $1.00
  if (hoursSinceLaunch <= PHASE1.endHour) {
    return calcPhase1(prevPrice, hoursSinceLaunch);
  }

  // Phase 2: Growth
  return calcPhase2(prevPrice, hoursSinceLaunch);
}

function calcPhase0(prevPrice, hour) {
  const h = Math.floor(hour);
  const dayIndex = Math.min(Math.floor(h / 24), 6);
  const hourOfDay = h % 24;

  // S-curve base trend
  const progress = h / PHASE0.hours;
  const sCurve = smoothStep(progress);
  const trendPrice = PHASE0.startPrice + (PHASE0.endPrice - PHASE0.startPrice) * sCurve;

  // Daily momentum
  const daily = PHASE0.dailyMomentum[dayIndex];

  // Intra-day pattern
  const hourlyBias = PHASE0.hourlyPattern[hourOfDay] * 0.005 * daily.base;

  // Random noise (deterministic)
  const r1 = rng(h * 7 + 1);
  const r2 = rng(h * 13 + 2);
  const noise = (r1 - 0.5) * 2 * daily.volatility;

  // Occasional dip (every ~8-12 hours, random)
  const isDip = rng(h * 31 + 3) < 0.15; // 15% chance of dip hour
  const dipFactor = isDip ? -daily.volatility * 1.5 : 0;

  // Occasional spike (every ~6-10 hours)
  const isSpike = !isDip && rng(h * 47 + 5) < 0.12;
  const spikeFactor = isSpike ? daily.volatility * 2.0 : 0;

  let newPrice = trendPrice * (1 + noise + hourlyBias + dipFactor + spikeFactor);

  // Clamp to max 3% change from previous price per hour
  if (prevPrice > 0) {
    const maxChange = prevPrice * 0.03;
    newPrice = Math.max(prevPrice - maxChange, Math.min(prevPrice + maxChange, newPrice));
  }

  // Never below $0.28
  return Math.max(0.28, newPrice);
}

function calcPhase1(prevPrice, hour) {
  const progress = (hour - PHASE1.startHour) / (PHASE1.endHour - PHASE1.startHour);
  const base = PHASE1.startPrice + (PHASE1.endPrice - PHASE1.startPrice) * smoothStep(progress);

  const r = rng(hour * 19 + 7);
  const noise = (r - 0.5) * 2 * PHASE1.hourlyVolatility;

  let p = base * (1 + noise);
  if (prevPrice > 0) {
    const max = prevPrice * 0.02;
    p = Math.max(prevPrice - max, Math.min(prevPrice + max, p));
  }
  return Math.max(0.85, p);
}

function calcPhase2(prevPrice, hour) {
  const monthsIn = (hour - PHASE2.startHour) / (30 * 24);
  const base = 1.0 * Math.pow(1 + PHASE2.monthlyGrowth, monthsIn);

  const r = rng(hour * 23 + 11);
  const noise = (r - 0.5) * 2 * PHASE2.hourlyVolatility;

  let p = base * (1 + noise);
  if (prevPrice > 0) {
    const max = prevPrice * PHASE2.maxHourlyChange;
    p = Math.max(prevPrice - max, Math.min(prevPrice + max, p));
  }
  return p;
}

function smoothStep(x) {
  x = Math.max(0, Math.min(1, x));
  return x * x * x * (x * (x * 6 - 15) + 10); // smoother S-curve
}

function rng(seed) {
  let h = Math.abs(seed | 0) * 2654435761;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  return ((h >>> 16) ^ h & 0xFFFF) / 0xFFFF;
}

function toRaw6(usd) { return Math.round(usd * 1e6); }

// ═══════════════════════════════════════════════════════════════
//  PREVIEW K-LINE (per hour for Phase 0)
// ═══════════════════════════════════════════════════════════════

function previewKLine() {
  console.log("\n═════════════════════════════════════════════════════════════════════");
  console.log("  MA Token K-Line: $0.30 → $0.90 (Mar 24-31, hourly updates)");
  console.log("═════════════════════════════════════════════════════════════════════\n");

  let price = PHASE0.startPrice;
  let dayOpen = price, dayHigh = price, dayLow = price;
  let prevDay = -1;

  // Collect daily OHLC for K-line display
  const dailyCandles = [];
  let currentCandle = { open: price, high: price, low: price, close: price, day: 0 };

  for (let h = 0; h <= PHASE0.hours; h++) {
    const newPrice = calculatePrice(price, h);
    const day = Math.floor(h / 24);

    if (day !== currentCandle.day) {
      dailyCandles.push({ ...currentCandle });
      currentCandle = { open: newPrice, high: newPrice, low: newPrice, close: newPrice, day };
    }

    currentCandle.high = Math.max(currentCandle.high, newPrice);
    currentCandle.low = Math.min(currentCandle.low, newPrice);
    currentCandle.close = newPrice;
    price = newPrice;
  }
  dailyCandles.push({ ...currentCandle });

  // Print daily K-line
  console.log("  Daily K-Line (OHLC):\n");
  console.log("  Date    │  Open   High    Low   Close │ Change │ Candle");
  console.log("  ────────┼───────────────────────────────┼────────┼──────────────────────");

  for (const c of dailyCandles) {
    const date = new Date(LAUNCH_DATE.getTime() + c.day * 24 * 3600000);
    const dateStr = `${date.getMonth()+1}/${date.getDate()}`.padStart(5);
    const change = c.day > 0
      ? ((c.close - dailyCandles[c.day - 1].close) / dailyCandles[c.day - 1].close * 100).toFixed(1)
      : "0.0";

    // ASCII candle
    const isGreen = c.close >= c.open;
    const body = isGreen ? "▓" : "░";
    const barMin = 0.25;
    const barScale = 40;
    const bodyStart = Math.round((Math.min(c.open, c.close) - barMin) * barScale);
    const bodyEnd = Math.round((Math.max(c.open, c.close) - barMin) * barScale);
    const wickLow = Math.round((c.low - barMin) * barScale);
    const wickHigh = Math.round((c.high - barMin) * barScale);

    let candle = "";
    for (let i = 0; i < 28; i++) {
      if (i >= bodyStart && i <= bodyEnd) candle += body;
      else if (i >= wickLow && i <= wickHigh) candle += "│";
      else candle += " ";
    }

    console.log(
      `  ${dateStr}   │ $${c.open.toFixed(3)} $${c.high.toFixed(3)} $${c.low.toFixed(3)} $${c.close.toFixed(3)} │ ${(change >= 0 ? "+" : "") + change.padStart(5)}% │ ${candle}`
    );
  }

  // Print hourly sample (show first 2 days in detail)
  console.log("\n  Hourly Detail (Mar 24-25):\n");
  console.log("  Hour │ Price   │ Chg%  │ Tick");
  console.log("  ─────┼─────────┼───────┼────────────────────────────────");

  price = PHASE0.startPrice;
  for (let h = 0; h <= 48; h++) {
    const newPrice = calculatePrice(price, h);
    const change = ((newPrice - price) / price * 100).toFixed(2);
    const time = `${Math.floor(h/24)}d ${(h%24).toString().padStart(2,"0")}h`;

    const tickLen = Math.round(Math.abs(parseFloat(change)) * 5);
    const tick = parseFloat(change) >= 0
      ? " ".repeat(10) + "▓".repeat(Math.min(tickLen, 15))
      : " ".repeat(Math.max(0, 10 - tickLen)) + "░".repeat(Math.min(tickLen, 10));

    console.log(`  ${time}  │ $${newPrice.toFixed(4)} │ ${(change >= 0 ? "+" : "") + change.padStart(5)}% │ ${tick}`);
    price = newPrice;
  }

  console.log("\n  ... (continues hourly until Mar 31)\n");
}

// ═══════════════════════════════════════════════════════════════
//  EXECUTE
// ═══════════════════════════════════════════════════════════════

async function pushPrice() {
  if (!THIRDWEB_SECRET_KEY || !ORACLE_ADDRESS) {
    throw new Error("Set THIRDWEB_SECRET_KEY and ORACLE_ADDRESS in env");
  }

  const now = new Date();
  const hoursSinceLaunch = (now - LAUNCH_DATE) / (1000 * 3600);

  const currentPrice = Number(process.env.CURRENT_PRICE || "300000") / 1e6;
  const newPrice = calculatePrice(currentPrice, hoursSinceLaunch);
  const newPriceRaw = toRaw6(newPrice);

  console.log(`  Hour ${hoursSinceLaunch.toFixed(1)} | $${currentPrice.toFixed(4)} → $${newPrice.toFixed(4)} (raw: ${newPriceRaw})`);

  const res = await fetch("https://api.thirdweb.com/v1/contracts/write", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-secret-key": THIRDWEB_SECRET_KEY,
    },
    body: JSON.stringify({
      chainId: CHAIN_ID,
      from: SERVER_WALLET,
      calls: [{
        contractAddress: ORACLE_ADDRESS,
        method: "function updatePrice(uint256 _newPrice)",
        params: [newPriceRaw],
      }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`API error: ${JSON.stringify(data)}`);
  console.log("  Pushed!", data.result?.transactionId || "OK");
}

// ═══════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  previewKLine();

  if (args.includes("--execute")) {
    await pushPrice();
  } else {
    console.log("  Run: node price-feed.js --execute  (push to oracle)");
    console.log("  Cron: every 1 hour\n");
  }
}

main().catch(console.error);
