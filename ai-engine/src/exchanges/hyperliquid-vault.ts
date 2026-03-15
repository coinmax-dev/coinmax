/**
 * HyperLiquid Vault Integration
 *
 * Manages HyperLiquid Vaults for copy-trading.
 * Users deposit USDC into a vault, and the vault leader's trades are auto-copied.
 *
 * Vault API:
 *   - Deposit: POST /exchange { action: { type: "vaultTransfer", vault, isDeposit: true, usd } }
 *   - Withdraw: POST /exchange { action: { type: "vaultTransfer", vault, isDeposit: false, usd } }
 *   - Query: POST /info { type: "vaultDetails", user, vaultAddress }
 *
 * Reference: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint
 */

const MAINNET_URL = "https://api.hyperliquid.xyz";
const TESTNET_URL = "https://api.hyperliquid-testnet.xyz";

// ── Types ───────────────────────────────────────────────────

export interface VaultInfo {
  vaultAddress: string;
  name: string;
  leader: string;
  description?: string;
  portfolio: VaultPortfolio;
  followers: number;
  aum: number;           // Assets under management (USDC)
  pnl: number;           // Total PnL
  apr: number;            // Annualized return %
  maxDrawdown: number;
  age: number;            // Days since creation
}

export interface VaultPortfolio {
  accountValue: number;
  totalMarginUsed: number;
  positions: VaultPosition[];
  pnlHistory: Array<{ time: number; pnl: number }>;
}

export interface VaultPosition {
  coin: string;
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  side: "LONG" | "SHORT";
}

export interface VaultDeposit {
  vaultAddress: string;
  amount: number;
  txHash?: string;
  timestamp: number;
}

export interface UserVaultState {
  vaultAddress: string;
  deposited: number;
  currentValue: number;
  pnl: number;
  pnlPct: number;
  share: number;  // % of vault owned by user
}

// ── Vault Manager ───────────────────────────────────────────

export class HyperLiquidVaultManager {
  private baseUrl: string;

  constructor(testnet = false) {
    this.baseUrl = testnet ? TESTNET_URL : MAINNET_URL;
  }

  /**
   * Get vault details (public, no auth).
   */
  async getVaultDetails(vaultAddress: string): Promise<VaultInfo | null> {
    try {
      const res = await fetch(`${this.baseUrl}/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "vaultDetails",
          vaultAddress,
        }),
      });

      if (!res.ok) return null;
      const data = await res.json();
      if (!data) return null;

      return this.parseVaultInfo(vaultAddress, data);
    } catch {
      return null;
    }
  }

  /**
   * Get user's position in a vault.
   */
  async getUserVaultState(
    userAddress: string,
    vaultAddress: string,
  ): Promise<UserVaultState | null> {
    try {
      const res = await fetch(`${this.baseUrl}/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "vaultDetails",
          vaultAddress,
          user: userAddress,
        }),
      });

      if (!res.ok) return null;
      const data = await res.json();

      const userVaultEquity = data?.userVaultEquity;
      if (!userVaultEquity) return null;

      const deposited = parseFloat(userVaultEquity.totalDeposited || "0");
      const currentValue = parseFloat(userVaultEquity.equity || "0");

      return {
        vaultAddress,
        deposited,
        currentValue,
        pnl: currentValue - deposited,
        pnlPct: deposited > 0 ? ((currentValue - deposited) / deposited) * 100 : 0,
        share: parseFloat(userVaultEquity.ownershipShare || "0") * 100,
      };
    } catch {
      return null;
    }
  }

  /**
   * List all public vaults with their performance metrics.
   */
  async listTopVaults(limit = 20): Promise<VaultInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "vaultSummaries" }),
      });

      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];

      return data
        .slice(0, limit)
        .map((v: any) => this.parseVaultSummary(v))
        .filter((v): v is VaultInfo => v !== null);
    } catch {
      return [];
    }
  }

  /**
   * Deposit USDC into a vault (requires auth — build action for signing).
   */
  buildDepositAction(vaultAddress: string, amountUsd: number): {
    action: Record<string, unknown>;
    nonce: number;
  } {
    return {
      action: {
        type: "vaultTransfer",
        vaultAddress,
        isDeposit: true,
        usd: amountUsd.toString(),
      },
      nonce: Date.now(),
    };
  }

  /**
   * Withdraw USDC from a vault (requires auth — build action for signing).
   */
  buildWithdrawAction(vaultAddress: string, amountUsd: number): {
    action: Record<string, unknown>;
    nonce: number;
  } {
    return {
      action: {
        type: "vaultTransfer",
        vaultAddress,
        isDeposit: false,
        usd: amountUsd.toString(),
      },
      nonce: Date.now(),
    };
  }

  /**
   * Get vault PnL history for charting.
   */
  async getVaultPnlHistory(vaultAddress: string): Promise<Array<{
    time: number;
    pnl: number;
    accountValue: number;
  }>> {
    try {
      const res = await fetch(`${this.baseUrl}/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "vaultDetails",
          vaultAddress,
        }),
      });

      if (!res.ok) return [];
      const data = await res.json();

      const history = data?.portfolio?.pnlHistory || [];
      return history.map((h: any) => ({
        time: h.time || h.t,
        pnl: parseFloat(h.pnl || h.p || "0"),
        accountValue: parseFloat(h.accountValue || h.av || "0"),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get all positions currently held by a vault.
   */
  async getVaultPositions(vaultAddress: string): Promise<VaultPosition[]> {
    try {
      const res = await fetch(`${this.baseUrl}/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "clearinghouseState",
          user: vaultAddress,
        }),
      });

      if (!res.ok) return [];
      const state = await res.json();

      return (state?.assetPositions || [])
        .filter((ap: any) => parseFloat(ap.position.szi) !== 0)
        .map((ap: any) => {
          const pos = ap.position;
          const size = parseFloat(pos.szi);
          return {
            coin: pos.coin,
            size: Math.abs(size),
            entryPrice: parseFloat(pos.entryPx),
            markPrice: parseFloat(pos.entryPx),
            unrealizedPnl: parseFloat(pos.unrealizedPnl),
            leverage: pos.leverage?.value || 1,
            side: size > 0 ? "LONG" as const : "SHORT" as const,
          };
        });
    } catch {
      return [];
    }
  }

  // ── Private Helpers ────────────────────────────────────

  private parseVaultInfo(vaultAddress: string, data: any): VaultInfo {
    const portfolio = data.portfolio || {};
    const accountValue = parseFloat(portfolio.accountValue || "0");

    const positions: VaultPosition[] = (portfolio.positions || []).map((p: any) => ({
      coin: p.coin,
      size: Math.abs(parseFloat(p.szi || "0")),
      entryPrice: parseFloat(p.entryPx || "0"),
      markPrice: parseFloat(p.entryPx || "0"),
      unrealizedPnl: parseFloat(p.unrealizedPnl || "0"),
      leverage: p.leverage?.value || 1,
      side: parseFloat(p.szi || "0") > 0 ? "LONG" as const : "SHORT" as const,
    }));

    return {
      vaultAddress,
      name: data.name || "Unknown Vault",
      leader: data.leader || "",
      description: data.description,
      portfolio: {
        accountValue,
        totalMarginUsed: parseFloat(portfolio.totalMarginUsed || "0"),
        positions,
        pnlHistory: [],
      },
      followers: data.followerCount || 0,
      aum: accountValue,
      pnl: parseFloat(data.allTimePnl || "0"),
      apr: parseFloat(data.apr || "0") * 100,
      maxDrawdown: parseFloat(data.maxDrawdown || "0") * 100,
      age: data.ageDays || 0,
    };
  }

  private parseVaultSummary(v: any): VaultInfo | null {
    try {
      return {
        vaultAddress: v.vaultAddress || v.vault || "",
        name: v.name || "Unknown",
        leader: v.leader || "",
        portfolio: {
          accountValue: parseFloat(v.tvl || "0"),
          totalMarginUsed: 0,
          positions: [],
          pnlHistory: [],
        },
        followers: v.followerCount || 0,
        aum: parseFloat(v.tvl || "0"),
        pnl: parseFloat(v.allTimePnl || "0"),
        apr: parseFloat(v.apr || "0") * 100,
        maxDrawdown: parseFloat(v.maxDrawdown || "0") * 100,
        age: v.ageDays || 0,
      };
    } catch {
      return null;
    }
  }
}

// ── Convenience Functions ───────────────────────────────────

/**
 * Quick check: get a vault's AUM and APR.
 */
export async function quickVaultStats(vaultAddress: string, testnet = false): Promise<{
  aum: number;
  apr: number;
  positions: number;
  pnl: number;
} | null> {
  const mgr = new HyperLiquidVaultManager(testnet);
  const info = await mgr.getVaultDetails(vaultAddress);
  if (!info) return null;

  return {
    aum: info.aum,
    apr: info.apr,
    positions: info.portfolio.positions.length,
    pnl: info.pnl,
  };
}
