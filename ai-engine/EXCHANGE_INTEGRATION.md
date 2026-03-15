# Exchange Integration Plan — 2 DEX + 4 CEX Copy Trading

> Version: 1.0 | Created: 2026-03-15
> Parent: `TECHNICAL_PLAN.md` Phase 4 Extension
> Hummingbot: `/Users/macbookpro/WebstormProjects/hummingbot/`

---

## Target Exchanges (6 Total)

### DEX (2) — On-Chain, Non-Custodial

| # | Exchange | Type | Hummingbot Connector | Auth Method | Notes |
|---|----------|------|---------------------|-------------|-------|
| 1 | **HyperLiquid** | Perps DEX (L1) | `hyperliquid_perpetual` | EIP-712 Signature | 已在 AxomX 有 HyperGrowth 策略 |
| 2 | **dYdX v4** | Perps DEX (Cosmos) | `dydx_v4_perpetual` | Cosmos Key | 去中心化永续合约 |

### CEX (4) — Centralized, API Key

| # | Exchange | Type | Hummingbot Connector | Auth Method | Notes |
|---|----------|------|---------------------|-------------|-------|
| 3 | **Binance** | Spot + Perps | `binance` / `binance_perpetual` | HMAC-SHA256 | 最大交易量 |
| 4 | **Bybit** | Spot + Perps | `bybit` / `bybit_perpetual` | HMAC-SHA256 | V5 API |
| 5 | **OKX** | Spot + Perps | `okx` / `okx_perpetual` | HMAC-SHA256 + Passphrase | 统一账户 |
| 6 | **Bitget** | Spot + Perps | `bitget` / `bitget_perpetual` | HMAC-SHA256 + Passphrase | 跟单功能原生 |

---

## Architecture: Multi-Exchange Execution

```
                    AI Signal Engine
                         │
                    Trade Signal
          {asset, side, size, sl, tp, leverage}
                         │
              ┌──────────▼──────────┐
              │  Signal Router       │
              │  (per-user config)   │
              └──┬───┬───┬───┬───┬──┘
                 │   │   │   │   │
    ┌────────────▼┐ ┌▼───▼┐ ┌▼───▼────────┐
    │   DEX Layer │ │ CEX Layer            │
    │             │ │                      │
    │ HyperLiquid │ │ Binance  Bybit       │
    │ dYdX v4     │ │ OKX      Bitget      │
    │             │ │                      │
    │ EIP-712/    │ │ HMAC-SHA256          │
    │ Cosmos Sign │ │ API Key + Secret     │
    └─────────────┘ └──────────────────────┘
                         │
              ┌──────────▼──────────┐
              │  Position Aggregator │
              │  (统一仓位视图)       │
              └─────────────────────┘
```

---

## 1. HyperLiquid Integration (DEX #1)

### 1.1 Current State in AxomX
- Strategy card: "HyperGrowth" (226% APR, simulated)
- Exchange logo + branding configured
- 无实际 API 调用

### 1.2 Hummingbot Connector Reference
```
hummingbot/connector/derivative/hyperliquid_perpetual/
├── hyperliquid_perpetual_derivative.py    ← 主文件 (55KB)
├── hyperliquid_perpetual_auth.py          ← EIP-712 签名
├── hyperliquid_perpetual_constants.py     ← API endpoints
├── hyperliquid_perpetual_web_utils.py     ← HTTP 工具
└── hyperliquid_perpetual_utils.py         ← 配置 + 费率
```

### 1.3 API Details
```
REST:  https://api.hyperliquid.xyz
WS:    wss://api.hyperliquid.xyz/ws
Test:  https://api.hyperliquid-testnet.xyz

Endpoints:
  POST /info    → 查询: 余额、持仓、订单状态、K线
  POST /exchange → 执行: 下单、撤单、改杠杆

Authentication: EIP-712 typed data signature
  - 需要: Arbitrum 钱包地址 + 私钥
  - 或: API Wallet 地址 + 私钥 (from app.hyperliquid.xyz/API)
  - 支持 Vault 模式 (地址前缀 "HL:")
```

### 1.4 Implementation Tasks

#### Task HL-1: HyperLiquid API Client
- **File:** `ai-engine/src/exchanges/hyperliquid.ts`
- **Reference:** `hummingbot/connector/derivative/hyperliquid_perpetual/hyperliquid_perpetual_derivative.py`
- **Features:**
  ```typescript
  class HyperLiquidClient {
    // Auth (ref: hyperliquid_perpetual_auth.py)
    private signL1Action(action: any): SignedAction;
    private signOrder(order: OrderParams): SignedOrder;

    // Info queries (ref: hyperliquid_perpetual_derivative.py → _update_balances)
    async getBalances(): Promise<Balance[]>;
    async getPositions(): Promise<Position[]>;
    async getOrderStatus(orderId: string): Promise<OrderStatus>;
    async getOpenOrders(): Promise<Order[]>;
    async getFundingRate(symbol: string): Promise<FundingInfo>;
    async getMarkPrice(symbol: string): Promise<number>;

    // Trading (ref: hyperliquid_perpetual_derivative.py → _place_order)
    async placeOrder(params: OrderParams): Promise<OrderResult>;
    async cancelOrder(orderId: string, asset: number): Promise<void>;
    async setLeverage(symbol: string, leverage: number): Promise<void>;

    // WebSocket (ref: hyperliquid_perpetual_api_order_book_data_source.py)
    subscribeOrderBook(symbol: string, callback: (data) => void): void;
    subscribeUserUpdates(callback: (data) => void): void;
    subscribeTrades(symbol: string, callback: (data) => void): void;
  }
  ```

#### Task HL-2: HyperLiquid Vault Integration
- **File:** `ai-engine/src/exchanges/hyperliquid-vault.ts`
- **Purpose:** 连接 HyperLiquid Vault 实现自动跟单
- **Logic:**
  ```
  1. 用户绑定 Vault 地址 (HL:0x...)
  2. AI 信号触发 → 通过 Vault 代理下单
  3. 用户资金在 Vault 内自动管理
  4. 收益自动结算到 Vault
  ```
- **Reference:** `hyperliquid_perpetual_utils.py` 的 Vault 配置

#### Task HL-3: HyperLiquid Position Sync
- **File:** `ai-engine/src/exchanges/hyperliquid-sync.ts`
- **WebSocket channels:**
  ```
  { method: "subscribe", subscription: { type: "orderUpdates", user: address } }
  { method: "subscribe", subscription: { type: "l2Book", coin: "BTC" } }
  { method: "subscribe", subscription: { type: "trades", coin: "BTC" } }
  ```
- **Sync interval:** WebSocket 实时 + 每 30s REST 验证

---

## 2. dYdX v4 Integration (DEX #2)

### 2.1 Hummingbot Connector Reference
```
hummingbot/connector/derivative/dydx_v4_perpetual/
├── dydx_v4_perpetual_derivative.py       ← 主文件
├── dydx_v4_perpetual_auth.py             ← Cosmos 签名
├── dydx_v4_perpetual_constants.py
└── dydx_v4_perpetual_utils.py
```

### 2.2 API Details
```
REST:  https://indexer.dydx.trade/v4
WS:    wss://indexer.dydx.trade/v4/ws
Test:  https://indexer.v4testnet.dydx.exchange/v4

Authentication: Cosmos SDK (DYDX chain)
  - 需要: dYdX mnemonic 或 private key
  - Cosmos address derivation
```

### 2.3 Implementation Tasks

#### Task DX-1: dYdX v4 API Client
- **File:** `ai-engine/src/exchanges/dydx-v4.ts`
- **Reference:** `hummingbot/connector/derivative/dydx_v4_perpetual/dydx_v4_perpetual_derivative.py`
- **Features:**
  ```typescript
  class DydxV4Client {
    async getBalances(): Promise<Balance[]>;
    async getPositions(): Promise<Position[]>;
    async placeOrder(params: OrderParams): Promise<OrderResult>;
    async cancelOrder(orderId: string): Promise<void>;
    async setLeverage(symbol: string, leverage: number): Promise<void>;
    subscribePositionUpdates(callback: (data) => void): void;
  }
  ```

---

## 3. Binance Perpetual Integration (CEX #1)

### 3.1 Hummingbot Connector Reference
```
hummingbot/connector/derivative/binance_perpetual/
├── binance_perpetual_derivative.py        ← 主文件 (38KB)
├── binance_perpetual_auth.py              ← HMAC-SHA256
├── binance_perpetual_constants.py         ← Rate limits
├── binance_perpetual_web_utils.py
└── binance_perpetual_user_stream_data_source.py ← 用户流
```

### 3.2 API Details
```
REST:  https://fapi.binance.com/fapi/
WS:    wss://fstream.binance.com/
Test:  https://testnet.binancefuture.com/fapi/

Auth: API Key + HMAC-SHA256(secret, query_string)
Headers: X-MBX-APIKEY

Rate Limits:
  REQUEST_WEIGHT: 2400/min
  ORDERS_1MIN: 1200/min
  ORDERS_1SEC: 300/10s
```

### 3.3 Key Endpoints
```
POST /fapi/v1/order            → 下单
DELETE /fapi/v1/order          → 撤单
GET  /fapi/v2/positionRisk     → 持仓查询
POST /fapi/v1/leverage         → 设置杠杆
POST /fapi/v1/positionSide/dual → 切换仓位模式
GET  /fapi/v1/premiumIndex     → 资金费率
```

### 3.4 Implementation Tasks

#### Task BN-1: Binance Perpetual Client
- **File:** `ai-engine/src/exchanges/binance-perp.ts`
- **Reference:** `hummingbot/connector/derivative/binance_perpetual/binance_perpetual_derivative.py`
- **Key points:**
  - Leverage 1-125x
  - ONEWAY + HEDGE 仓位模式
  - User Stream listenKey 需定期续期 (每 30 分钟)
  - 资金费率每 8 小时结算

---

## 4. Bybit Perpetual Integration (CEX #2)

### 4.1 Hummingbot Connector Reference
```
hummingbot/connector/derivative/bybit_perpetual/
├── bybit_perpetual_derivative.py          ← 主文件 (40KB)
├── bybit_perpetual_auth.py                ← HMAC-SHA256
├── bybit_perpetual_constants.py
└── bybit_perpetual_web_utils.py           ← 含 V5 API 逻辑
```

### 4.2 API Details
```
REST:  https://api.bybit.com/v5/
WS:    wss://stream.bybit.com/v5/public/linear  (公共)
       wss://stream.bybit.com/v5/private         (私有)
Test:  https://api-testnet.bybit.com/v5/

Auth: API Key + HMAC-SHA256
Headers: X-BAPI-API-KEY, X-BAPI-SIGN, X-BAPI-TIMESTAMP, X-BAPI-RECV-WINDOW
```

### 4.3 Key Endpoints
```
POST /v5/order/create          → 下单
POST /v5/order/cancel          → 撤单
GET  /v5/position/list         → 持仓查询
POST /v5/position/set-leverage → 设置杠杆
POST /v5/position/switch-mode  → 切换仓位模式
GET  /v5/market/funding/history → 资金费率
```

### 4.4 Implementation Tasks

#### Task BB-1: Bybit Perpetual Client
- **File:** `ai-engine/src/exchanges/bybit-perp.ts`
- **Reference:** `hummingbot/connector/derivative/bybit_perpetual/bybit_perpetual_derivative.py`
- **Key points:**
  - V5 API 统一接口
  - Leverage 1-100x
  - HEDGE 模式 position_idx: 0=单向, 1=多头, 2=空头
  - 心跳 20s

---

## 5. OKX Perpetual Integration (CEX #3)

### 5.1 Hummingbot Connector Reference
```
hummingbot/connector/derivative/okx_perpetual/ (not available, use exchange/)
hummingbot/connector/exchange/okx/
├── okx_exchange.py
├── okx_auth.py                           ← HMAC + Passphrase
└── okx_constants.py
```

### 5.2 API Details
```
REST:  https://www.okx.com/api/v5/
WS:    wss://ws.okx.com:8443/ws/v5/public
       wss://ws.okx.com:8443/ws/v5/private
Test:  https://www.okx.com/api/v5/ (demo mode)

Auth: API Key + Secret + Passphrase + HMAC-SHA256
  - 需要额外 Passphrase (创建 API Key 时设置)
  - Header: OK-ACCESS-KEY, OK-ACCESS-SIGN, OK-ACCESS-TIMESTAMP, OK-ACCESS-PASSPHRASE
```

### 5.3 Key Endpoints
```
POST /api/v5/trade/order        → 下单
POST /api/v5/trade/cancel-order → 撤单
GET  /api/v5/account/positions  → 持仓
POST /api/v5/account/set-leverage → 杠杆
GET  /api/v5/public/funding-rate → 资金费率
POST /api/v5/account/set-position-mode → 仓位模式
```

### 5.4 Implementation Tasks

#### Task OKX-1: OKX Perpetual Client
- **File:** `ai-engine/src/exchanges/okx-perp.ts`
- **Key points:**
  - 统一账户模式（spot + perp 共享保证金）
  - 需要三项凭证: key + secret + passphrase
  - 支持模拟盘 (demo trading)
  - instType: SWAP (永续), FUTURES (交割), MARGIN (保证金)

---

## 6. Bitget Perpetual Integration (CEX #4)

### 6.1 Hummingbot Connector Reference
```
hummingbot/connector/derivative/bitget_perpetual/
├── bitget_perpetual_derivative.py
├── bitget_perpetual_auth.py
├── bitget_perpetual_constants.py
└── bitget_perpetual_web_utils.py
```

### 6.2 API Details
```
REST:  https://api.bitget.com/api/v2/mix/
WS:    wss://ws.bitget.com/v2/ws/public
       wss://ws.bitget.com/v2/ws/private

Auth: API Key + Secret + Passphrase + HMAC-SHA256
```

### 6.3 Implementation Tasks

#### Task BG-1: Bitget Perpetual Client
- **File:** `ai-engine/src/exchanges/bitget-perp.ts`
- **Key points:**
  - V2 API
  - 类似 OKX (key + secret + passphrase)
  - 原生跟单功能可参考其 API 设计
  - productType: USDT-FUTURES, COIN-FUTURES

---

## 7. Unified Exchange Interface

### 7.1 Abstract Exchange Client
- **File:** `ai-engine/src/exchanges/base-exchange.ts`
- **Purpose:** 所有交易所实现统一接口

```typescript
// Unified types
interface UnifiedPosition {
  exchange: string;           // "hyperliquid" | "dydx" | "binance" | "bybit" | "okx" | "bitget"
  symbol: string;             // "BTC-USDT" (normalized)
  side: "LONG" | "SHORT";
  size: number;               // In base asset
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  liquidationPrice: number;
  marginType: "CROSS" | "ISOLATED";
}

interface UnifiedOrder {
  exchange: string;
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET" | "STOP_MARKET" | "TAKE_PROFIT_MARKET";
  price: number;
  amount: number;
  filledAmount: number;
  status: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "FAILED";
  timestamp: number;
}

interface UnifiedBalance {
  exchange: string;
  asset: string;
  total: number;
  available: number;
  inPosition: number;
}

// Unified exchange interface
abstract class BaseExchangeClient {
  abstract readonly name: string;
  abstract readonly type: "DEX" | "CEX";

  // Connection
  abstract connect(credentials: ExchangeCredentials): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract isConnected(): boolean;

  // Account
  abstract getBalances(): Promise<UnifiedBalance[]>;
  abstract getPositions(): Promise<UnifiedPosition[]>;
  abstract getOpenOrders(): Promise<UnifiedOrder[]>;

  // Trading
  abstract placeOrder(params: {
    symbol: string;
    side: "BUY" | "SELL";
    type: "LIMIT" | "MARKET";
    amount: number;
    price?: number;
    leverage?: number;
    stopLoss?: number;
    takeProfit?: number;
    reduceOnly?: boolean;
  }): Promise<UnifiedOrder>;
  abstract cancelOrder(orderId: string, symbol: string): Promise<void>;
  abstract cancelAllOrders(symbol?: string): Promise<void>;

  // Position Management
  abstract setLeverage(symbol: string, leverage: number): Promise<void>;
  abstract closePosition(symbol: string, side?: "LONG" | "SHORT"): Promise<void>;

  // Market Data
  abstract getMarkPrice(symbol: string): Promise<number>;
  abstract getFundingRate(symbol: string): Promise<{ rate: number; nextTime: number }>;

  // WebSocket
  abstract subscribePositions(callback: (pos: UnifiedPosition[]) => void): void;
  abstract subscribeOrders(callback: (order: UnifiedOrder) => void): void;

  // Symbol normalization
  abstract normalizeSymbol(symbol: string): string;  // "BTCUSDT" → "BTC-USDT"
  abstract denormalizeSymbol(symbol: string): string; // "BTC-USDT" → "BTCUSDT"
}
```

### 7.2 Exchange Credential Types
- **File:** `ai-engine/src/exchanges/credentials.ts`

```typescript
type ExchangeCredentials =
  | { exchange: "hyperliquid"; mode: "arb_wallet" | "api_wallet";
      address: string; privateKey: string; vaultAddress?: string; }
  | { exchange: "dydx"; mnemonic: string; }
  | { exchange: "binance"; apiKey: string; apiSecret: string; testnet?: boolean; }
  | { exchange: "bybit"; apiKey: string; apiSecret: string; testnet?: boolean; }
  | { exchange: "okx"; apiKey: string; apiSecret: string; passphrase: string; demo?: boolean; }
  | { exchange: "bitget"; apiKey: string; apiSecret: string; passphrase: string; };
```

### 7.3 Symbol Mapping
- **File:** `ai-engine/src/exchanges/symbol-map.ts`

```typescript
const SYMBOL_MAP: Record<string, Record<string, string>> = {
  "BTC-USDT": {
    hyperliquid: "BTC",        // HyperLiquid uses base asset only
    dydx: "BTC-USD",           // dYdX uses -USD suffix
    binance: "BTCUSDT",        // Binance concatenated
    bybit: "BTCUSDT",          // Bybit same as Binance
    okx: "BTC-USDT-SWAP",      // OKX instrument format
    bitget: "BTCUSDT",         // Bitget similar
  },
  "ETH-USDT": { ... },
  "SOL-USDT": { ... },
  "BNB-USDT": { ... },
};
```

---

## 8. Multi-Exchange Signal Router

### 8.1 Router Logic
- **File:** `ai-engine/src/signal-router.ts`

```typescript
class SignalRouter {
  /**
   * Route a trade signal to user's configured exchanges
   *
   * Each user can have:
   * - Multiple exchanges enabled
   * - Different capital allocation per exchange
   * - Different leverage limits per exchange
   * - Different risk parameters per exchange
   */
  async routeSignal(signal: TradeSignal, userId: string): Promise<ExecutionResult[]> {
    const userConfig = await this.getUserExchangeConfig(userId);
    const results: ExecutionResult[] = [];

    for (const exchangeConfig of userConfig.exchanges) {
      if (!exchangeConfig.enabled) continue;

      // Adjust position size for this exchange's allocation
      const adjustedSignal = this.adjustSignalForExchange(signal, exchangeConfig);

      // Skip if below minimum order size
      if (adjustedSignal.amount < exchangeConfig.minOrderSize) continue;

      // Execute on this exchange
      const client = this.getClient(exchangeConfig.exchange);
      try {
        const order = await client.placeOrder({
          symbol: adjustedSignal.symbol,
          side: adjustedSignal.side,
          type: adjustedSignal.orderType,
          amount: adjustedSignal.amount,
          leverage: Math.min(adjustedSignal.leverage, exchangeConfig.maxLeverage),
          stopLoss: adjustedSignal.stopLoss,
          takeProfit: adjustedSignal.takeProfit,
        });
        results.push({ exchange: exchangeConfig.exchange, status: "SUCCESS", order });
      } catch (err) {
        results.push({ exchange: exchangeConfig.exchange, status: "FAILED", error: err.message });
      }
    }

    return results;
  }
}
```

### 8.2 User Exchange Configuration
```typescript
interface UserExchangeConfig {
  userId: string;
  exchanges: {
    exchange: string;          // "hyperliquid" | "binance" | ...
    enabled: boolean;
    credentials: EncryptedCredentials;
    allocationPct: number;     // % of total capital for this exchange
    maxLeverage: number;       // User's max leverage limit
    maxPositionSize: number;   // Max single position in USD
    maxConcurrentPositions: number;
    tradingPairs: string[];    // Allowed pairs on this exchange
    mode: "PAPER" | "LIVE";
  }[];
  globalConfig: {
    maxTotalDrawdownPct: number;
    maxDailyLossPct: number;
    emergencyStopEnabled: boolean;
  };
}
```

### 8.3 Database Schema
```sql
CREATE TABLE user_exchange_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  exchange TEXT NOT NULL,              -- hyperliquid, dydx, binance, bybit, okx, bitget
  exchange_type TEXT NOT NULL,         -- DEX, CEX
  enabled BOOLEAN DEFAULT false,
  encrypted_credentials JSONB,         -- AES-256-GCM encrypted
  allocation_pct NUMERIC DEFAULT 0,
  max_leverage INT DEFAULT 3,
  max_position_size NUMERIC DEFAULT 1000,
  max_concurrent_positions INT DEFAULT 3,
  trading_pairs TEXT[] DEFAULT '{"BTC-USDT","ETH-USDT"}',
  mode TEXT DEFAULT 'PAPER',           -- PAPER or LIVE
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, exchange)
);

CREATE TABLE exchange_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  signal_id TEXT,
  exchange TEXT NOT NULL,
  exchange_order_id TEXT,
  client_order_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  order_type TEXT NOT NULL,
  price NUMERIC,
  amount NUMERIC NOT NULL,
  filled_amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'NEW',
  leverage INT,
  stop_loss NUMERIC,
  take_profit NUMERIC,
  pnl NUMERIC,
  fee NUMERIC,
  close_reason TEXT,                    -- STOP_LOSS, TAKE_PROFIT, TRAILING, MANUAL, SIGNAL
  created_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE exchange_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  size NUMERIC NOT NULL,
  entry_price NUMERIC NOT NULL,
  mark_price NUMERIC,
  unrealized_pnl NUMERIC,
  leverage INT,
  liquidation_price NUMERIC,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, exchange, symbol, side)
);
```

---

## 9. Position Aggregator (Multi-Exchange Dashboard)

### 9.1 Aggregator Service
- **File:** `ai-engine/src/position-aggregator.ts`

```typescript
class PositionAggregator {
  /**
   * Aggregate positions across all user's exchanges
   * into a single unified view
   */
  async getAggregatedView(userId: string): Promise<AggregatedView> {
    const configs = await this.getUserExchangeConfigs(userId);
    const allPositions: UnifiedPosition[] = [];
    const allBalances: UnifiedBalance[] = [];

    for (const config of configs) {
      if (!config.enabled) continue;
      const client = this.getClient(config.exchange);
      const positions = await client.getPositions();
      const balances = await client.getBalances();
      allPositions.push(...positions);
      allBalances.push(...balances);
    }

    return {
      totalEquity: allBalances.reduce((sum, b) => sum + b.total, 0),
      totalUnrealizedPnl: allPositions.reduce((sum, p) => sum + p.unrealizedPnl, 0),
      positions: allPositions,
      balances: allBalances,
      byExchange: this.groupByExchange(allPositions, allBalances),
      byAsset: this.groupByAsset(allPositions),
    };
  }
}
```

### 9.2 Frontend Component
- **File:** `src/components/strategy/multi-exchange-dashboard.tsx`
- **Display:**
  ```
  ┌────────────────────────────────────────────────────┐
  │  Total Portfolio: $12,345.67  (+$234.56 / +1.9%)   │
  ├────────────────────────────────────────────────────┤
  │  Exchange      │ Balance  │ Positions │ PnL        │
  │  HyperLiquid   │ $3,200   │ 2 active  │ +$89.32   │
  │  Binance       │ $4,500   │ 1 active  │ +$145.24  │
  │  Bybit         │ $2,800   │ 1 active  │ -$12.50   │
  │  OKX           │ $1,845   │ 0 active  │ $0.00     │
  ├────────────────────────────────────────────────────┤
  │  Active Positions                                   │
  │  [HL] BTC-USDT LONG  $45,230 → $45,890  +$89.32  │
  │  [HL] ETH-USDT SHORT $3,200  → $3,180   +$34.00  │
  │  [BN] BTC-USDT LONG  $45,235 → $45,890  +$145.24 │
  │  [BB] SOL-USDT LONG  $178.50 → $177.20  -$12.50  │
  └────────────────────────────────────────────────────┘
  ```

---

## 10. Copy Trading Flow (End-to-End)

```
Step 1: User Setup
  └→ Select exchanges (e.g., HyperLiquid + Binance)
  └→ Bind API keys / wallet
  └→ Set allocation: HL 40%, BN 60%
  └→ Set risk: max leverage 5x, max DD 10%
  └→ Choose mode: PAPER → test 30 days → LIVE

Step 2: AI Signal Generated
  └→ Multi-model consensus: BTC LONG, confidence 82%
  └→ RAG: similar history 4/5 BULLISH, avg +1.5%
  └→ Strategy: Directional, TP 2.5%, SL 1.0%

Step 3: Signal Router
  └→ HyperLiquid: 40% × $10,000 = $4,000
  │   └→ BTC LONG 5x → position $20,000
  │   └→ SL: $44,777, TP: $46,361
  └→ Binance: 60% × $10,000 = $6,000
      └→ BTC LONG 5x → position $30,000
      └→ SL: $44,777, TP: $46,361

Step 4: Position Management
  └→ WebSocket monitor all exchanges
  └→ Aggregate PnL in real-time
  └→ If global DD > 10% → close all positions

Step 5: Result & Learning
  └→ Record result per exchange
  └→ Update model accuracy
  └→ Store in vector memory
  └→ Adjust weights for next signal
```

---

## 11. Exchange-Specific Considerations

| Feature | HyperLiquid | dYdX v4 | Binance | Bybit | OKX | Bitget |
|---------|------------|---------|---------|-------|-----|--------|
| **Auth** | EIP-712 | Cosmos | HMAC | HMAC | HMAC+Pass | HMAC+Pass |
| **Max Leverage** | 50x | 20x | 125x | 100x | 100x | 125x |
| **Position Mode** | Both | Oneway | Both | Both | Both | Both |
| **Funding** | Continuous | 1h | 8h | 8h | 8h | 8h |
| **Min Order** | $10 | $1 | $5 | $1 | $5 | $5 |
| **Rate Limit** | 1200/min | 100/10s | 2400/min | 600/min | 60/2s | 20/s |
| **WS Heartbeat** | N/A | 30s | N/A | 20s | 30s | 30s |
| **Fee (Taker)** | 0.025% | 0.05% | 0.04% | 0.055% | 0.05% | 0.06% |
| **Testnet** | Yes | Yes | Yes | Yes | Demo | Demo |
| **Custodial** | No | No | Yes | Yes | Yes | Yes |

---

## 12. Implementation Priority

| Priority | Task | Exchange | Effort |
|----------|------|----------|--------|
| P0 | Unified Exchange Interface | All | 2 days |
| P0 | HyperLiquid Client (existing strategy) | DEX | 3 days |
| P0 | Binance Perpetual Client (largest volume) | CEX | 2 days |
| P1 | Bybit Perpetual Client | CEX | 2 days |
| P1 | Signal Router + Multi-Exchange Execution | All | 3 days |
| P1 | Position Aggregator + Dashboard | All | 2 days |
| P2 | OKX Perpetual Client | CEX | 2 days |
| P2 | dYdX v4 Client | DEX | 3 days |
| P2 | Bitget Perpetual Client | CEX | 2 days |
| P3 | Paper Trading Mode | All | 2 days |
| P3 | Credential Encryption Vault | All | 1 day |
| P3 | Cross-Exchange Arbitrage Detection | All | 3 days |

---

## 13. Hummingbot Integration Modes

### Mode A: Direct Use (Recommended for Phase 4)
```
Run hummingbot as separate Python process
  → Load CoinMaxAIController
  → Connect to exchanges via hummingbot connectors
  → Receive signals via MQTT from AI engine
  → Execute via hummingbot's executor framework
  → Report results back to Supabase
```
**Pros:** Mature connectors, tested execution, built-in risk management
**Cons:** Python dependency, separate process management

### Mode B: Port to TypeScript (Long-term)
```
Implement exchange clients in TypeScript (ai-engine/src/exchanges/)
  → Use hummingbot as reference for API details
  → Direct integration with Supabase Edge Functions
  → Single runtime (Node.js/Deno)
```
**Pros:** Unified stack, simpler deployment
**Cons:** Re-implementing tested code, more bugs initially

### Recommended Approach
```
Phase 4.0: Mode A — Use hummingbot directly for HyperLiquid + Binance
Phase 4.1: Mode B — Port HyperLiquid + Binance clients to TypeScript
Phase 4.2: Add Bybit + OKX + dYdX + Bitget in TypeScript
Phase 5+:  Full TypeScript stack, hummingbot only for backtesting reference
```
