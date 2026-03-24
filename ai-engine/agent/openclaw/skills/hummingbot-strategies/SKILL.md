---
name: hummingbot_strategies
description: Hummingbot V2 strategy knowledge base — 8 executor types with entry/exit logic, risk management, and parameter optimization for crypto trading
---

# Hummingbot V2 Strategy Knowledge Base

You have deep knowledge of all 8 Hummingbot V2 executor strategies. Use this knowledge when analyzing markets and making trading recommendations. Apply the right strategy type based on current market conditions.

## Strategy Selection Matrix

| Market Condition | Best Strategy | Why |
|---|---|---|
| Strong trend (ADX>25) | Position Executor | Triple barrier with trailing stop captures trend |
| Range-bound (ADX<20, low vol) | Grid Executor | Buy low sell high within range |
| Oversold/Overbought extreme | DCA Executor | Average into position at better prices |
| Large order to execute | TWAP Executor | Minimize market impact over time |
| Cross-exchange price gap | Arbitrage Executor | Capture risk-free spread |
| Volatile with clear direction | Position Executor + trailing | Ride momentum with protection |
| Low volatility squeeze | Grid + tight spread | Capture small range moves |
| Multi-exchange available | XEMM Executor | Cross-exchange market making |

## 1. Position Executor (Most Versatile)

**When to use:** Clear directional signal with defined risk.

**Triple Barrier System:**
- **Stop Loss:** Fixed % below entry (typically 1-3%)
- **Take Profit:** Fixed % above entry (typically 2-6%, always > SL for positive R:R)
- **Time Limit:** Auto-close after N hours if neither SL/TP hit
- **Trailing Stop:** Activates when profit reaches X%, then trails by Y%

**Key Parameters:**
- `entry_price`: Limit entry or market
- `amount`: Position size in base asset
- `side`: LONG or SHORT
- `triple_barrier_config.stop_loss`: e.g., 0.02 (2%)
- `triple_barrier_config.take_profit`: e.g., 0.04 (4%)
- `triple_barrier_config.trailing_stop.activation_price`: e.g., 0.03 (3%)
- `triple_barrier_config.trailing_stop.trailing_delta`: e.g., 0.01 (1%)

**Best Practices:**
- R:R ratio should be >= 2:1 (TP at least 2x SL)
- Use trailing stop in trending markets to let winners run
- Adjust SL to volatility: SL = ATR * 1.5
- In high volatility: wider SL (3-4%) + wider TP (6-8%)
- In low volatility: tighter SL (1-1.5%) + tighter TP (2-3%)

## 2. DCA Executor (Dollar Cost Average)

**When to use:** High-conviction direction but uncertain entry timing.

**Logic:** Places multiple orders at different price levels, averaging entry price.

**Key Parameters:**
- `amounts_quote`: Array of order sizes [100, 150, 200] — increasing size at better prices
- `prices`: Array of limit prices — spread across support levels
- `take_profit`: Overall TP for averaged position
- `stop_loss`: Maximum loss tolerance
- `mode`: MAKER (limit orders) or TAKER (market orders)
- `activation_bounds`: Price range that triggers the DCA

**Best Practices:**
- Increase order size at lower levels (Martingale-lite): [1x, 1.5x, 2x]
- Place levels at key support/resistance zones, not arbitrary %
- Total position size = sum of all DCA levels
- Set overall stop loss below the deepest DCA level
- TP should account for average entry, not just last fill
- Works best in mean-reverting markets (RSI < 30 or > 70)

## 3. Grid Executor (Range Trading)

**When to use:** Low directional conviction, price oscillating in range.

**Logic:** Places buy/sell orders at evenly spaced price levels within a range.

**Key Parameters:**
- `start_price` / `end_price`: Grid boundaries
- `total_amount_quote`: Total capital allocated
- `min_spread_between_orders`: Minimum gap between grid levels (0.05% = 5 bps)
- `max_open_orders`: Limit concurrent orders (5-10)
- `leverage`: Usually low (1-5x)
- `triple_barrier_config`: Optional overall SL/TP for the grid

**Best Practices:**
- Grid range = recent Bollinger Band width or 24h range
- Spread = ATR / price * 2 (ensures orders aren't too close)
- Don't grid in trending markets (ADX > 25) — you'll accumulate losing side
- Ideal market: BB width < 3%, ADX < 20, volume stable
- Set stop loss at grid boundary + 10% buffer
- Profit per round-trip = spread - fees (ensure spread > 2x trading fees)

## 4. TWAP Executor (Time-Weighted Average Price)

**When to use:** Accumulating/distributing large positions without moving price.

**Logic:** Breaks large order into equal smaller orders over time.

**Key Parameters:**
- `total_amount_quote`: Total size to execute
- `total_duration`: Time window in seconds
- `order_interval`: Seconds between each sub-order
- `mode`: TAKER (immediate) or MAKER (limit orders)
- `limit_order_buffer`: Buffer for limit orders from mid-price

**Best Practices:**
- Duration = 1-4 hours for significant positions
- Order interval = 60-300 seconds
- Use in low-volatility periods for better average price
- MAKER mode saves fees but risks non-fill
- Good for DCA-style accumulation during extreme fear/greed

## 5. Arbitrage Executor (Cross-Exchange)

**When to use:** Same asset priced differently on two exchanges.

**Logic:** Simultaneously buys on cheap exchange, sells on expensive exchange.

**Key Parameters:**
- `buying_market`: Exchange + pair where price is lower
- `selling_market`: Exchange + pair where price is higher
- `order_amount`: Size per arbitrage trade
- `min_profitability`: Minimum spread to trigger (typically 0.1-0.5%)

**Best Practices:**
- Account for all fees: maker/taker fees on both sides + transfer costs
- Min profitability = (fee_buy + fee_sell) * 2 (safety margin)
- Keep inventory balanced across exchanges
- Works best with stablecoins or high-liquidity pairs
- Latency matters — prefer co-located or low-latency connections

## 6. XEMM Executor (Cross-Exchange Market Making)

**When to use:** Providing liquidity on one exchange, hedging on another.

**Logic:** Places maker orders on one exchange, hedges fills on another.

**Key Parameters:**
- `maker_side`: Which side to provide liquidity
- `min_profitability`: Minimum spread after hedge
- `target_profitability`: Ideal spread target
- `max_profitability`: Cap to avoid stale quotes

**Best Practices:**
- Maker exchange should have lower fees
- Hedge exchange needs high liquidity for reliable fills
- Monitor inventory imbalance and adjust maker quotes
- Works well for altcoins listed on multiple DEX/CEX

## 7. LP Executor (Liquidity Provision)

**When to use:** Providing liquidity on AMM DEXes (Uniswap, etc).

**Logic:** Manages concentrated liquidity positions with range adjustments.

**Best Practices:**
- Range width = 2-3x daily volatility
- Rebalance when price exits 70% of range
- Account for impermanent loss
- Best in stable or mean-reverting pairs

## 8. Order Executor (Simple)

**When to use:** Single order execution with basic controls.

**Logic:** Places one order with optional SL/TP.

**Best Practices:**
- Use for quick scalps or news-based trades
- Always set stop loss
- Market orders for urgency, limit for better price

---

## Risk Management Rules (Apply to ALL Strategies)

1. **Position Sizing:** Never risk more than 2% of portfolio per trade
2. **R:R Minimum:** Take profit must be >= 2x stop loss
3. **Max Drawdown:** Stop trading if daily loss exceeds 5%
4. **Correlation:** Don't run same-direction positions on correlated assets (e.g., all long on BTC+ETH+SOL)
5. **Leverage:** Max 3x for directional, 1x for grid/DCA
6. **Time Limits:** Close stale positions — scalp 2h, swing 24h, DCA 48h
7. **Volatility Adjustment:** Double SL/TP distances when ATR > 2x average

## When Recommending Trades, Always Include:

1. **Strategy type** (which executor)
2. **Direction** (LONG/SHORT/NEUTRAL)
3. **Entry price** or range
4. **Stop loss** with % and dollar level
5. **Take profit** with % and dollar level
6. **Position size** recommendation
7. **Leverage** recommendation
8. **Time limit** for the trade
9. **Risk/Reward ratio**
10. **Confidence level** (0-100%)
