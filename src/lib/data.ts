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
  "5_DAYS":   { days: 5,   dailyRate: 0.005, label: "5天",   apr: "182.5%", minAmount: 100, platformFee: 0.10, planIndex: 0 },
  "45_DAYS":  { days: 45,  dailyRate: 0.007, label: "45天",  apr: "255.5%", minAmount: 100, platformFee: 0.10, planIndex: 1 },
  "90_DAYS":  { days: 90,  dailyRate: 0.009, label: "90天",  apr: "328.5%", minAmount: 100, platformFee: 0.10, planIndex: 2 },
  "180_DAYS": { days: 180, dailyRate: 0.012, label: "180天", apr: "438%",   minAmount: 100, platformFee: 0.10, planIndex: 3 },
} as const;


export const NODE_PLANS = {
  MINI: {
    price: 100, label: "Small Node", frozenAmount: 1000, dailyRate: 0.009, dailyYield: 9,
    durationDays: 90, contributionRate: 0.10,
    activationDesc: "存入金库激活V1-V4等级",
    features: ["basicStrategies", "communityAccess"],
  },
  MAX: {
    price: 600, label: "Large Node", frozenAmount: 6000, dailyRate: 0.009, dailyYield: 54,
    durationDays: 120, contributionRate: 0.10,
    activationDesc: "存入金库激活V1-V6等级",
    features: ["allStrategiesUnlocked", "prioritySupport", "higherVaultYields"],
  },
} as const;

// Vault deposit thresholds to activate node rank
export const NODE_ACTIVATION_TIERS = {
  MINI: [
    { rank: "V1", vaultDeposit: 100, requiredMiniReferrals: 0 },
    { rank: "V2", vaultDeposit: 300, requiredMiniReferrals: 0 },
    { rank: "V3", vaultDeposit: 500, requiredMiniReferrals: 0 },
    { rank: "V4", vaultDeposit: 600, requiredMiniReferrals: 0 },
  ],
  MAX: [
    { rank: "V1", vaultDeposit: 100, requiredMiniReferrals: 3 },
    { rank: "V2", vaultDeposit: 300, requiredMiniReferrals: 0 },
    { rank: "V3", vaultDeposit: 500, requiredMiniReferrals: 0 },
    { rank: "V4", vaultDeposit: 600, requiredMiniReferrals: 0 },
    { rank: "V5", vaultDeposit: 800, requiredMiniReferrals: 0 },
    { rank: "V6", vaultDeposit: 1000, requiredMiniReferrals: 0 },
  ],
} as const;

// Qualification checks at specific days after node activation
// passAction/failAction: UNLOCK_PARTIAL, UNLOCK_ALL, DESTROY, UNLOCK_FROZEN, CONTINUE, PAUSE, KEEP_LOCKED, KEEP_FROZEN
export const NODE_QUALIFICATION_CHECKS = {
  MINI: [
    { checkDay: 30, requiredRank: "V2", passAction: "UNLOCK_PARTIAL", failAction: "KEEP_LOCKED",
      earningRange: "1-60", desc: "V2达标：解锁1-60天锁仓收益" },
    { checkDay: 90, requiredRank: "V2", passAction: "UNLOCK_ALL", failAction: "DESTROY",
      earningRange: "1-90", desc: "V2达标：解锁全部收益；不达标：收益销毁" },
    { checkDay: 90, requiredRank: "V4", passAction: "UNLOCK_FROZEN", failAction: "KEEP_FROZEN",
      earningRange: null, desc: "V4达标：解锁1000U铸造MA" },
  ],
  MAX: [
    { checkDay: 15, requiredRank: "V1", passAction: "CONTINUE", failAction: "PAUSE",
      earningRange: "16-30", desc: "V1达标：继续领取收益" },
    { checkDay: 30, requiredRank: "V2", passAction: "CONTINUE", failAction: "PAUSE",
      earningRange: "31-60", desc: "V2达标：继续领取收益" },
    { checkDay: 60, requiredRank: "V4", passAction: "CONTINUE", failAction: "PAUSE",
      earningRange: "61-120", desc: "V4达标：继续领取收益" },
    { checkDay: 120, requiredRank: "V6", passAction: "UNLOCK_FROZEN", failAction: "KEEP_FROZEN",
      earningRange: null, desc: "V6达标：解锁6000U铸造MA" },
  ],
} as const;

// Legacy NODE_MILESTONES kept for backward compatibility in milestone tracker UI
export const NODE_MILESTONES = {
  MINI: [
    { rank: "V1", days: 0, unlocks: "activation", desc: "存入金库100U激活", requiredHolding: 100, requiredReferrals: 0 },
    { rank: "V2", days: 30, unlocks: "earnings", desc: "达标解锁1-60天收益", requiredHolding: 300, requiredReferrals: 0 },
    { rank: "V4", days: 90, unlocks: "earnings_and_package", desc: "达标解锁收益+1000U铸造MA", requiredHolding: 600, requiredReferrals: 0 },
  ],
  MAX: [
    { rank: "V1", days: 15, unlocks: "earnings", desc: "100U+推荐3个小节点", requiredHolding: 100, requiredReferrals: 3 },
    { rank: "V2", days: 30, unlocks: "earnings", desc: "存入金库300U", requiredHolding: 300, requiredReferrals: 0 },
    { rank: "V4", days: 60, unlocks: "earnings", desc: "存入金库600U", requiredHolding: 600, requiredReferrals: 0 },
    { rank: "V6", days: 120, unlocks: "earnings_and_package", desc: "存入金库1000U，解锁全部", requiredHolding: 1000, requiredReferrals: 0 },
  ],
} as const;

export const RANKS = [
  { level: "V1", commission: 0.05 },
  { level: "V2", commission: 0.10 },
  { level: "V3", commission: 0.15 },
  { level: "V4", commission: 0.20 },
  { level: "V5", commission: 0.25 },
  { level: "V6", commission: 0.30 },
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
  trial: { price: 0, label: "trial", period: "7 days", days: 7 },
  monthly: { price: 49, label: "monthly", period: "1 month", days: 30 },
  halfyear: { price: 250, label: "halfyear", period: "6 months", days: 180 },
} as const;

export const WITHDRAW_BURN_RATES = [
  { days: 0, burn: 0.20, label: "Immediate" },
  { days: 7, burn: 0.15, label: "7 days" },
  { days: 15, burn: 0.10, label: "15 days" },
  { days: 30, burn: 0.05, label: "30 days" },
  { days: 60, burn: 0.00, label: "60 days" },
] as const;

export const RANK_CONDITIONS = [
  { level: "V1", personalHolding: 100, directReferrals: 1, teamPerformance: 5000 },
  { level: "V2", personalHolding: 300, requiredSubRanks: 2, subRankLevel: "V1", teamPerformance: 20000 },
  { level: "V3", personalHolding: 500, requiredSubRanks: 2, subRankLevel: "V2", teamPerformance: 50000 },
  { level: "V4", personalHolding: 1000, requiredSubRanks: 2, subRankLevel: "V3", teamPerformance: 100000 },
  { level: "V5", personalHolding: 3000, requiredSubRanks: 2, subRankLevel: "V4", teamPerformance: 500000 },
  { level: "V6", personalHolding: 5000, requiredSubRanks: 2, subRankLevel: "V5", teamPerformance: 1000000 },
  { level: "V7", personalHolding: 10000, requiredSubRanks: 2, subRankLevel: "V6", teamPerformance: 3000000 },
] as const;

export const EXCHANGES = [
  { name: "Aster", tag: "Aster" },
  { name: "Hyperliquid", tag: "Hyperliquid" },
  { name: "Binance", tag: "Binance" },
  { name: "OKX", tag: "OKX" },
  { name: "Bybit", tag: "Bybit" },
] as const;

export interface LocalStrategy {
  id: string;
  name: string;
  description: string;
  leverage: string;
  winRateRange: [number, number];    // min, max — floating
  monthlyReturnRange: [number, number]; // min, max — floating
  totalAumRange: [number, number];
  status: string;
  isHot: boolean;
  isVipOnly: boolean;
  type: "hyperliquid" | "openclaw";
  updateIntervalMs: number;          // how often values float
}

export const LOCAL_STRATEGIES: LocalStrategy[] = [
  {
    id: "hyperliquid-vault",
    name: "[Systemic Strategies] HyperGrowth",
    description: "HyperLiquid on-chain vault — 226% APR systematic growth strategy",
    leverage: "3x",
    winRateRange: [76, 82],
    monthlyReturnRange: [16, 22],
    totalAumRange: [7_800_000, 8_400_000],
    status: "ACTIVE",
    isHot: true,
    isVipOnly: false,
    type: "hyperliquid",
    updateIntervalMs: 3600_000, // 1 hour
  },
  {
    id: "openclaw-gpt",
    name: "OpenClaw GPT",
    description: "GPT-powered multi-factor momentum strategy",
    leverage: "5x",
    winRateRange: [80, 88],
    monthlyReturnRange: [22, 26],
    totalAumRange: [1_200_000, 1_800_000],
    status: "ACTIVE",
    isHot: false,
    isVipOnly: false,
    type: "openclaw",
    updateIntervalMs: 7200_000, // 2 hours
  },
  {
    id: "openclaw-gemini",
    name: "OpenClaw Gemini",
    description: "Gemini deep-learning trend-following engine",
    leverage: "5x",
    winRateRange: [83, 87],
    monthlyReturnRange: [25, 29],
    totalAumRange: [900_000, 1_400_000],
    status: "ACTIVE",
    isHot: false,
    isVipOnly: false,
    type: "openclaw",
    updateIntervalMs: 7200_000,
  },
  {
    id: "openclaw-deepseek",
    name: "OpenClaw DeepSeek",
    description: "DeepSeek quantitative analysis with adaptive risk control",
    leverage: "8x",
    winRateRange: [80, 84],
    monthlyReturnRange: [32, 36],
    totalAumRange: [600_000, 1_000_000],
    status: "ACTIVE",
    isHot: true,
    isVipOnly: false,
    type: "openclaw",
    updateIntervalMs: 7200_000,
  },
  {
    id: "openclaw-qwen",
    name: "OpenClaw Claude",
    description: "Claude conservative risk-aware analysis with high precision",
    leverage: "3x",
    winRateRange: [90, 94],
    monthlyReturnRange: [13, 17],
    totalAumRange: [1_500_000, 2_000_000],
    status: "ACTIVE",
    isHot: false,
    isVipOnly: false,
    type: "openclaw",
    updateIntervalMs: 7200_000,
  },
  {
    id: "openclaw-grok",
    name: "OpenClaw Llama",
    description: "Llama mean-reversion + BB squeeze local AI strategy",
    leverage: "5x",
    winRateRange: [87, 91],
    monthlyReturnRange: [18, 22],
    totalAumRange: [800_000, 1_200_000],
    status: "ACTIVE",
    isHot: false,
    isVipOnly: false,
    type: "openclaw",
    updateIntervalMs: 7200_000,
  },
  {
    id: "coinmax-ai",
    name: "CoinMax AI",
    description: "Multi-model consensus + deep learning meta-strategy",
    leverage: "5x",
    winRateRange: [88, 95] as const,
    monthlyReturnRange: [20, 28] as const,
    totalAumRange: [3_000_000, 5_000_000] as const,
    status: "ACTIVE",
    isHot: true,
    isVipOnly: false,
    type: "openclaw" as const,
    updateIntervalMs: 7200_000,
  },
];

export const SETTINGS_ITEMS = [
  { key: "leaderboard", label: "Leaderboard" },
  { key: "contact-us", label: "Contact Us" },
  { key: "language-settings", label: "Language Settings" },
  { key: "disconnect-wallet", label: "Disconnect Wallet" },
] as const;
