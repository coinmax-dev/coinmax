export const VAULT_CHART_PERIODS = ["7D", "14D", "30D", "ALL"] as const;
export type VaultChartPeriod = (typeof VAULT_CHART_PERIODS)[number];

export const STRATEGY_FILTERS = ["All", "Trending", "Quantitative", "Completed"] as const;
export const PREDICTION_TIMEFRAMES = ["All", "15min", "1H", "4H"] as const;

export const TRADE_ASSETS = ["BTC", "ETH", "SOL", "BNB"] as const;
export const DASHBOARD_ASSETS = ["BTC", "ETH", "BNB", "DOGE", "SOL"] as const;

export const BET_DEFAULTS = {
  minAmount: 1,
  step: 5,
  defaultAmount: 10,
  defaultDuration: "1min",
  payoutPercent: 84,
};

export const PREDICTION_GRID_CONFIG = {
  totalCells: 54,
  columns: 9,
  hitThreshold: 0.6,
  directionThreshold: 0.5,
};

export const VAULT_PLANS = {
  "7_DAYS": { days: 7, dailyRate: 0.005, label: "7 Days", apr: "182.5%", minAmount: 50, platformFee: 0.10 },
  "30_DAYS": { days: 30, dailyRate: 0.007, label: "30 Days", apr: "255.5%", minAmount: 50, platformFee: 0.10 },
  "90_DAYS": { days: 90, dailyRate: 0.009, label: "90 Days", apr: "328.5%", minAmount: 50, platformFee: 0.10 },
  "180_DAYS": { days: 180, dailyRate: 0.012, label: "180 Days", apr: "438%", minAmount: 50, platformFee: 0.10 },
  "360_DAYS": { days: 360, dailyRate: 0.015, label: "360 Days", apr: "547.5%", minAmount: 50, platformFee: 0.10 },
} as const;

export const EARLY_BIRD_DEPOSIT_RATE = 0.10;

export const NODE_PLANS = {
  MINI: {
    price: 100, label: "Small Node", frozenAmount: 1000, dailyRate: 0.005, dailyYield: 5,
    durationDays: 90, contributionRate: 0.10,
    activationDesc: "V2: 100U holding + 3 small node referrals",
    features: ["basicStrategies", "communityAccess"],
  },
  MAX: {
    price: 600, label: "Large Node", frozenAmount: 6000, dailyRate: 0.009, dailyYield: 54,
    durationDays: 120, contributionRate: 0.10,
    activationDesc: "V2→V6 progressive milestones",
    features: ["allStrategiesUnlocked", "prioritySupport", "higherVaultYields"],
  },
} as const;

export const NODE_MILESTONES = {
  MINI: [
    { rank: "V2", days: 15, unlocks: "earnings", desc: "Unlock daily 0.5% earnings", requiredHolding: 0, requiredReferrals: 0 },
    { rank: "V4", days: 90, unlocks: "earnings_and_package", desc: "Withdraw 1000 USDT equivalent MA", requiredHolding: 0, requiredReferrals: 0 },
  ],
  MAX: [
    { rank: "V1", days: 15, unlocks: "none", desc: "Reach V1", requiredHolding: 0, requiredReferrals: 0 },
    { rank: "V2", days: 30, unlocks: "earnings", desc: "100U holding + 3 direct small node referrals", requiredHolding: 100, requiredReferrals: 3 },
    { rank: "V3", days: 45, unlocks: "earnings", desc: "500U holding", requiredHolding: 500, requiredReferrals: 0 },
    { rank: "V4", days: 60, unlocks: "earnings", desc: "600U holding", requiredHolding: 600, requiredReferrals: 0 },
    { rank: "V5", days: 90, unlocks: "earnings", desc: "800U holding", requiredHolding: 800, requiredReferrals: 0 },
    { rank: "V6", days: 120, unlocks: "earnings_and_package", desc: "1000U holding, unlock all", requiredHolding: 1000, requiredReferrals: 0 },
  ],
} as const;

export const RANKS = [
  { level: "V1", commission: 0.10 },
  { level: "V2", commission: 0.15 },
  { level: "V3", commission: 0.20 },
  { level: "V4", commission: 0.25 },
  { level: "V5", commission: 0.30 },
  { level: "V6", commission: 0.40 },
  { level: "V7", commission: 0.50 },
] as const;

export const REVENUE_DISTRIBUTION = {
  nodePool: 0.50,
  buybackPool: 0.20,
  insurancePool: 0.10,
  treasuryPool: 0.10,
  operations: 0.10,
} as const;

export const HEDGE_CONFIG = {
  minAmount: 100,
  defaultAmount: "300",
} as const;

export const VIP_PLANS = {
  monthly: { price: 39, label: "monthly", period: "1 month", days: 30 },
  semiannual: { price: 169, label: "semiannual", period: "6 months", days: 180 },
} as const;

export const WITHDRAW_BURN_RATES = [
  { days: 0, burn: 0.20, label: "Immediate" },
  { days: 7, burn: 0.15, label: "7 days" },
  { days: 15, burn: 0.10, label: "15 days" },
  { days: 30, burn: 0.05, label: "30 days" },
  { days: 60, burn: 0.00, label: "60 days" },
] as const;

export const RANK_CONDITIONS = [
  { level: "V1", threeGenCount: 100, smallTeamVolume: 5000 },
  { level: "V2", requiredSubRanks: 2, subRankLevel: "V1", personalHolding: 500, differentLines: true },
  { level: "V3", requiredSubRanks: 2, subRankLevel: "V2", personalHolding: 1000, differentLines: true },
  { level: "V4", requiredSubRanks: 2, subRankLevel: "V3", personalHolding: 5000, differentLines: true, airdrop: 5000 },
  { level: "V5", requiredSubRanks: 2, subRankLevel: "V4", personalHolding: 10000, differentLines: true, airdrop: 20000 },
  { level: "V6", requiredSubRanks: 2, subRankLevel: "V5", personalHolding: 50000, differentLines: true, airdrop: 100000 },
  { level: "V7", requiredSubRanks: 2, subRankLevel: "V6", personalHolding: 100000, differentLines: true, airdrop: 200000 },
] as const;

export const EXCHANGES = [
  { name: "Aster", tag: "Aster" },
  { name: "Hyperliquid", tag: "Hyperliquid" },
  { name: "Binance", tag: "Binance" },
  { name: "OKX", tag: "OKX" },
  { name: "Bybit", tag: "Bybit" },
] as const;

export const SETTINGS_ITEMS = [
  { key: "leaderboard", label: "Leaderboard" },
  { key: "contact-us", label: "Contact Us" },
  { key: "language-settings", label: "Language Settings" },
  { key: "disconnect-wallet", label: "Disconnect Wallet" },
] as const;
