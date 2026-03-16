/**
 * Strategy Deployer
 *
 * Off-chain engine that deploys Protocol Treasury funds to HyperLiquid strategies.
 *
 * Flow:
 *   1. Protocol Treasury (BSC) → 70% USDC allocated to Strategy Vault
 *   2. Admin/Bot bridges USDC from BSC → Arbitrum/HyperLiquid
 *   3. This engine deploys funds to HyperLiquid strategies:
 *      - AI-driven market signals (from ai-engine forecasts)
 *      - Copy-trading via HyperLiquid Vaults
 *      - Grid/DCA strategies
 *   4. Yield is accumulated, periodically bridged back to BSC
 *   5. Protocol Treasury → RevenueDistributor → Users
 *
 * Architecture:
 *   ┌─────────────────┐
 *   │ Protocol Treasury│ (BSC, on-chain)
 *   │   USDC collected │
 *   └────────┬────────┘
 *            │ Bridge (admin/bot)
 *   ┌────────▼────────┐
 *   │ Strategy Deployer│ (this module, off-chain)
 *   │ - Risk limits    │
 *   │ - Position mgmt  │
 *   │ - PnL tracking   │
 *   └────────┬────────┘
 *            │
 *   ┌────────▼────────┐
 *   │   HyperLiquid   │ (DEX execution)
 *   │ - Perpetuals     │
 *   │ - Vaults         │
 *   └─────────────────┘
 */

export interface StrategyConfig {
  /** Max % of treasury allocated to active positions */
  maxUtilization: number;       // e.g. 0.60 = 60%
  /** Max leverage per position */
  maxLeverage: number;          // e.g. 3
  /** Max single position size as % of total */
  maxPositionPct: number;       // e.g. 0.15 = 15%
  /** Stop loss per position (%) */
  stopLossPct: number;          // e.g. 0.03 = 3%
  /** Take profit per position (%) */
  takeProfitPct: number;        // e.g. 0.06 = 6%
  /** Max portfolio drawdown before kill switch */
  maxDrawdownPct: number;       // e.g. 0.10 = 10%
  /** Minimum signal confidence to execute */
  minConfidence: number;        // e.g. 0.75
  /** Assets allowed for trading */
  allowedAssets: string[];
  /** HyperLiquid vault addresses for copy-trading allocation */
  copyTradeVaults: Array<{
    address: string;
    name: string;
    allocationPct: number;      // % of strategy vault to this vault
  }>;
}

export interface PositionState {
  asset: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  currentPrice: number;
  leverage: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  stopLoss: number;
  takeProfit: number;
  openedAt: number;
  signalId?: string;
}

export interface TreasuryState {
  totalDeployed: number;        // Total USDC in HyperLiquid
  availableBalance: number;     // Free USDC (not in positions)
  activePositions: PositionState[];
  totalUnrealizedPnl: number;
  totalRealizedPnl: number;
  utilization: number;          // activePositions value / totalDeployed
  peakValue: number;            // Highest portfolio value (for drawdown calc)
  currentDrawdown: number;      // Current drawdown from peak
  killSwitchTriggered: boolean;
  lastUpdated: number;
}

export interface YieldReport {
  epoch: number;
  periodStart: number;
  periodEnd: number;
  startingCapital: number;
  endingCapital: number;
  grossYield: number;           // USDC profit before fees
  protocolFee: number;          // 20% performance fee
  netYield: number;             // distributable to users
  apr: number;                  // annualized
  tradesExecuted: number;
  winRate: number;
}

// ── Default Strategy Config ────────────────────────────────────

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  maxUtilization: 0.60,
  maxLeverage: 3,
  maxPositionPct: 0.15,
  stopLossPct: 0.03,
  takeProfitPct: 0.06,
  maxDrawdownPct: 0.10,
  minConfidence: 0.75,
  allowedAssets: ['BTC', 'ETH', 'SOL', 'BNB', 'ARB'],
  copyTradeVaults: [],
};

// ── Strategy Deployer ──────────────────────────────────────────

export class StrategyDeployer {
  private config: StrategyConfig;
  private state: TreasuryState;
  private hlBaseUrl: string;

  constructor(
    config: Partial<StrategyConfig> = {},
    testnet = false,
  ) {
    this.config = { ...DEFAULT_STRATEGY_CONFIG, ...config };
    this.hlBaseUrl = testnet
      ? 'https://api.hyperliquid-testnet.xyz'
      : 'https://api.hyperliquid.xyz';

    this.state = {
      totalDeployed: 0,
      availableBalance: 0,
      activePositions: [],
      totalUnrealizedPnl: 0,
      totalRealizedPnl: 0,
      utilization: 0,
      peakValue: 0,
      currentDrawdown: 0,
      killSwitchTriggered: false,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Sync state from HyperLiquid account.
   */
  async syncState(vaultAddress: string): Promise<TreasuryState> {
    try {
      // Get clearinghouse state
      const res = await fetch(`${this.hlBaseUrl}/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'clearinghouseState', user: vaultAddress }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const accountValue = parseFloat(data.marginSummary?.accountValue || '0');
      const totalMargin = parseFloat(data.marginSummary?.totalMarginUsed || '0');

      const positions: PositionState[] = (data.assetPositions || [])
        .filter((ap: any) => parseFloat(ap.position.szi) !== 0)
        .map((ap: any) => {
          const pos = ap.position;
          const size = parseFloat(pos.szi);
          const entryPx = parseFloat(pos.entryPx);
          const upnl = parseFloat(pos.unrealizedPnl);
          const notional = Math.abs(size) * entryPx;

          return {
            asset: pos.coin,
            side: size > 0 ? 'LONG' as const : 'SHORT' as const,
            size: Math.abs(size),
            entryPrice: entryPx,
            currentPrice: entryPx, // Will be updated with mark price
            leverage: pos.leverage?.value || 1,
            unrealizedPnl: upnl,
            unrealizedPnlPct: notional > 0 ? upnl / notional : 0,
            stopLoss: 0, // Set from our order management
            takeProfit: 0,
            openedAt: 0,
          };
        });

      const totalUnrealizedPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);

      // Track peak for drawdown
      if (accountValue > this.state.peakValue) {
        this.state.peakValue = accountValue;
      }

      const currentDrawdown = this.state.peakValue > 0
        ? (this.state.peakValue - accountValue) / this.state.peakValue
        : 0;

      this.state = {
        ...this.state,
        totalDeployed: accountValue,
        availableBalance: accountValue - totalMargin,
        activePositions: positions,
        totalUnrealizedPnl,
        utilization: accountValue > 0 ? totalMargin / accountValue : 0,
        currentDrawdown,
        killSwitchTriggered: currentDrawdown >= this.config.maxDrawdownPct,
        lastUpdated: Date.now(),
      };

      return this.state;
    } catch (e: any) {
      console.error('[StrategyDeployer] syncState error:', e.message);
      return this.state;
    }
  }

  /**
   * Evaluate whether a signal should be executed given current treasury state.
   */
  evaluateSignal(signal: {
    asset: string;
    direction: 'LONG' | 'SHORT';
    confidence: number;
    suggestedLeverage: number;
    suggestedSizePct: number;
  }): {
    approved: boolean;
    reason?: string;
    adjustedSize?: number;
    adjustedLeverage?: number;
  } {
    // Kill switch check
    if (this.state.killSwitchTriggered) {
      return { approved: false, reason: 'Kill switch active — max drawdown exceeded' };
    }

    // Confidence check
    if (signal.confidence < this.config.minConfidence) {
      return { approved: false, reason: `Confidence ${(signal.confidence * 100).toFixed(0)}% below minimum ${(this.config.minConfidence * 100).toFixed(0)}%` };
    }

    // Asset allowed check
    if (!this.config.allowedAssets.includes(signal.asset)) {
      return { approved: false, reason: `Asset ${signal.asset} not in allowed list` };
    }

    // Utilization check
    if (this.state.utilization >= this.config.maxUtilization) {
      return { approved: false, reason: `Utilization ${(this.state.utilization * 100).toFixed(0)}% exceeds max ${(this.config.maxUtilization * 100).toFixed(0)}%` };
    }

    // Check for conflicting position
    const existing = this.state.activePositions.find(p => p.asset === signal.asset);
    if (existing && existing.side !== signal.direction) {
      return { approved: false, reason: `Conflicting ${existing.side} position on ${signal.asset}` };
    }

    // Adjust leverage
    const adjustedLeverage = Math.min(signal.suggestedLeverage, this.config.maxLeverage);

    // Adjust size (cap at maxPositionPct of deployed capital)
    const maxSize = this.state.totalDeployed * this.config.maxPositionPct;
    const requestedSize = this.state.totalDeployed * signal.suggestedSizePct;
    const adjustedSize = Math.min(requestedSize, maxSize, this.state.availableBalance);

    if (adjustedSize < 10) { // $10 minimum
      return { approved: false, reason: 'Position size too small' };
    }

    return {
      approved: true,
      adjustedSize,
      adjustedLeverage,
    };
  }

  /**
   * Generate a yield report for the given period.
   */
  generateYieldReport(
    epoch: number,
    periodStart: number,
    periodEnd: number,
    startingCapital: number,
    trades: Array<{ pnl: number; won: boolean }>,
  ): YieldReport {
    const endingCapital = this.state.totalDeployed;
    const grossYield = endingCapital - startingCapital;
    const protocolFee = grossYield > 0 ? grossYield * 0.20 : 0; // 20% performance fee
    const netYield = grossYield - protocolFee;

    const periodDays = (periodEnd - periodStart) / (24 * 60 * 60 * 1000);
    const apr = periodDays > 0 && startingCapital > 0
      ? (netYield / startingCapital) * (365 / periodDays) * 100
      : 0;

    const wins = trades.filter(t => t.won).length;

    return {
      epoch,
      periodStart,
      periodEnd,
      startingCapital,
      endingCapital,
      grossYield,
      protocolFee,
      netYield,
      apr,
      tradesExecuted: trades.length,
      winRate: trades.length > 0 ? wins / trades.length : 0,
    };
  }

  /**
   * Compute per-user revenue share based on their contribution.
   * Called by the distribute-revenue edge function.
   */
  computeUserShares(
    netYield: number,
    users: Array<{
      address: string;
      contributionType: 'NODE' | 'VAULT';
      principal: number;        // frozen amount (node) or deposit amount (vault)
      dailyRate: number;        // daily rate or interest rate
      daysActive: number;       // days in this period
    }>,
  ): Array<{ address: string; share: number; amount: number }> {
    // Weight = principal × dailyRate × daysActive
    const weights = users.map(u => ({
      ...u,
      weight: u.principal * u.dailyRate * u.daysActive,
    }));

    const totalWeight = weights.reduce((s, w) => s + w.weight, 0);
    if (totalWeight === 0) return [];

    return weights.map(w => ({
      address: w.address,
      share: w.weight / totalWeight,
      amount: (w.weight / totalWeight) * netYield,
    }));
  }

  getState(): TreasuryState { return this.state; }
  getConfig(): StrategyConfig { return this.config; }

  updateConfig(partial: Partial<StrategyConfig>): void {
    this.config = { ...this.config, ...partial };
  }
}
