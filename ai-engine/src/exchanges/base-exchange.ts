/**
 * Unified Exchange Interface
 *
 * All 6 exchange clients (2 DEX + 4 CEX) implement this interface.
 * Reference: hummingbot/connector/exchange_py_base.py
 *
 * DEX: HyperLiquid, dYdX v4
 * CEX: Binance, Bybit, OKX, Bitget
 */

// ── Unified Types ──

export interface UnifiedBalance {
  exchange: string;
  asset: string;
  total: number;
  available: number;
  inPosition: number;
}

export interface UnifiedPosition {
  exchange: string;
  symbol: string;
  side: "LONG" | "SHORT";
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  leverage: number;
  liquidationPrice: number;
  marginType: "CROSS" | "ISOLATED";
  timestamp: number;
}

export interface UnifiedOrder {
  exchange: string;
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET" | "STOP_MARKET" | "TAKE_PROFIT_MARKET";
  price: number;
  amount: number;
  filledAmount: number;
  avgFillPrice: number;
  status: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "FAILED";
  fee: number;
  feeAsset: string;
  timestamp: number;
}

export interface FundingInfo {
  symbol: string;
  rate: number;
  nextFundingTime: number;
  predictedRate?: number;
}

export interface OrderParams {
  symbol: string;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET";
  amount: number;
  price?: number;
  leverage?: number;
  stopLoss?: number;
  takeProfit?: number;
  reduceOnly?: boolean;
  clientOrderId?: string;
}

// ── Credentials ──

export type ExchangeCredentials =
  | { exchange: "hyperliquid"; mode: "arb_wallet" | "api_wallet"; address: string; privateKey: string; vaultAddress?: string }
  | { exchange: "dydx"; mnemonic: string }
  | { exchange: "binance"; apiKey: string; apiSecret: string; testnet?: boolean }
  | { exchange: "bybit"; apiKey: string; apiSecret: string; testnet?: boolean }
  | { exchange: "okx"; apiKey: string; apiSecret: string; passphrase: string; demo?: boolean }
  | { exchange: "bitget"; apiKey: string; apiSecret: string; passphrase: string };

// ── Abstract Base ──

export abstract class BaseExchangeClient {
  abstract readonly name: string;
  abstract readonly type: "DEX" | "CEX";

  // Connection lifecycle
  abstract connect(credentials: ExchangeCredentials): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract isConnected(): boolean;

  // Account queries
  abstract getBalances(): Promise<UnifiedBalance[]>;
  abstract getPositions(): Promise<UnifiedPosition[]>;
  abstract getOpenOrders(): Promise<UnifiedOrder[]>;

  // Trading
  abstract placeOrder(params: OrderParams): Promise<UnifiedOrder>;
  abstract cancelOrder(orderId: string, symbol: string): Promise<void>;
  abstract cancelAllOrders(symbol?: string): Promise<void>;

  // Position management
  abstract setLeverage(symbol: string, leverage: number): Promise<void>;
  abstract closePosition(symbol: string, side?: "LONG" | "SHORT"): Promise<void>;

  // Market data
  abstract getMarkPrice(symbol: string): Promise<number>;
  abstract getFundingRate(symbol: string): Promise<FundingInfo>;

  // Real-time subscriptions
  abstract subscribePositions(callback: (positions: UnifiedPosition[]) => void): void;
  abstract subscribeOrders(callback: (order: UnifiedOrder) => void): void;

  // Symbol normalization (exchange-specific ↔ unified)
  abstract normalizeSymbol(exchangeSymbol: string): string;
  abstract denormalizeSymbol(unifiedSymbol: string): string;
}

// ── Exchange Registry ──

export const SUPPORTED_EXCHANGES = {
  // DEX
  hyperliquid: { name: "HyperLiquid", type: "DEX" as const, maxLeverage: 50, takerFee: 0.00025 },
  dydx: { name: "dYdX v4", type: "DEX" as const, maxLeverage: 20, takerFee: 0.0005 },
  // CEX
  binance: { name: "Binance", type: "CEX" as const, maxLeverage: 125, takerFee: 0.0004 },
  bybit: { name: "Bybit", type: "CEX" as const, maxLeverage: 100, takerFee: 0.00055 },
  okx: { name: "OKX", type: "CEX" as const, maxLeverage: 100, takerFee: 0.0005 },
  bitget: { name: "Bitget", type: "CEX" as const, maxLeverage: 125, takerFee: 0.0006 },
} as const;

export type ExchangeName = keyof typeof SUPPORTED_EXCHANGES;
