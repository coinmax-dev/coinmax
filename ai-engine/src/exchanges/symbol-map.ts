/**
 * Cross-Exchange Symbol Mapping
 *
 * Each exchange uses different symbol formats for the same trading pair.
 * This map normalizes everything to "BASE-QUOTE" format (e.g., "BTC-USDT").
 *
 * Reference:
 *   hummingbot/connector/exchange/hyperliquid/hyperliquid_exchange.py → coin_to_asset
 *   hummingbot/connector/derivative/binance_perpetual/binance_perpetual_constants.py
 *   hummingbot/connector/derivative/bybit_perpetual/bybit_perpetual_constants.py
 */

export type ExchangeId = "hyperliquid" | "dydx" | "binance" | "bybit" | "okx" | "bitget";

/**
 * Maps unified symbol → exchange-specific format
 *
 * HyperLiquid: uses base asset only ("BTC")
 * dYdX v4:     uses "BTC-USD" format
 * Binance:     concatenated "BTCUSDT"
 * Bybit:       concatenated "BTCUSDT"
 * OKX:         instrument "BTC-USDT-SWAP"
 * Bitget:      concatenated "BTCUSDT"
 */
export const SYMBOL_MAP: Record<string, Record<ExchangeId, string>> = {
  "BTC-USDT": {
    hyperliquid: "BTC",
    dydx: "BTC-USD",
    binance: "BTCUSDT",
    bybit: "BTCUSDT",
    okx: "BTC-USDT-SWAP",
    bitget: "BTCUSDT",
  },
  "ETH-USDT": {
    hyperliquid: "ETH",
    dydx: "ETH-USD",
    binance: "ETHUSDT",
    bybit: "ETHUSDT",
    okx: "ETH-USDT-SWAP",
    bitget: "ETHUSDT",
  },
  "SOL-USDT": {
    hyperliquid: "SOL",
    dydx: "SOL-USD",
    binance: "SOLUSDT",
    bybit: "SOLUSDT",
    okx: "SOL-USDT-SWAP",
    bitget: "SOLUSDT",
  },
  "BNB-USDT": {
    hyperliquid: "BNB",
    dydx: "BNB-USD",
    binance: "BNBUSDT",
    bybit: "BNBUSDT",
    okx: "BNB-USDT-SWAP",
    bitget: "BNBUSDT",
  },
  "DOGE-USDT": {
    hyperliquid: "DOGE",
    dydx: "DOGE-USD",
    binance: "DOGEUSDT",
    bybit: "DOGEUSDT",
    okx: "DOGE-USDT-SWAP",
    bitget: "DOGEUSDT",
  },
  "XRP-USDT": {
    hyperliquid: "XRP",
    dydx: "XRP-USD",
    binance: "XRPUSDT",
    bybit: "XRPUSDT",
    okx: "XRP-USDT-SWAP",
    bitget: "XRPUSDT",
  },
};

export function toExchangeSymbol(unified: string, exchange: ExchangeId): string {
  return SYMBOL_MAP[unified]?.[exchange] ?? unified;
}

export function toUnifiedSymbol(exchangeSymbol: string, exchange: ExchangeId): string {
  for (const [unified, map] of Object.entries(SYMBOL_MAP)) {
    if (map[exchange] === exchangeSymbol) return unified;
  }
  return exchangeSymbol;
}

export const SUPPORTED_PAIRS = Object.keys(SYMBOL_MAP);
