# CoinMax AI 策略系统完整文档

> Version: 1.0 | 2026-03-15
> Module: `/ai-engine/`

---

## 一、系统概览

CoinMax AI 跟单系统由 **6 层管道** 组成，将市场数据转化为可执行的交易信号：

```
市场数据 → 技术分析 → AI多模型预测 → 加权共识 → 信号过滤 → 策略选择 → 执行
```

### 核心架构图

```
┌─────────────────────────────────────────────────────┐
│                    数据输入层                         │
│  ├─ Binance K线 (OHLCV)                             │
│  ├─ 技术指标 (RSI, MACD, BB, ADX, Stochastic...)    │
│  ├─ 链上数据 (资金费率, 多空比, 持仓量)               │
│  ├─ 情绪指标 (Fear & Greed Index)                    │
│  └─ K线形态 (吞没, 锤子, 三兵, 十字星...)             │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│                 RAG 记忆增强层                        │
│  ├─ 当前市场状态 → 生成 Embedding (1536维)            │
│  ├─ 向量搜索 → 找到 Top-10 历史相似行情               │
│  ├─ 分析历史中哪个模型最准、哪个策略最优               │
│  └─ 注入增强 Prompt                                  │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│                AI 多模型预测层                        │
│  ├─ GPT-4o        → BULLISH/BEARISH/NEUTRAL + 信心%  │
│  ├─ DeepSeek      → BULLISH/BEARISH/NEUTRAL + 信心%  │
│  ├─ Llama 3.1 70B → BULLISH/BEARISH/NEUTRAL + 信心%  │
│  ├─ Gemini        → BULLISH/BEARISH/NEUTRAL + 信心%  │
│  └─ Grok          → BULLISH/BEARISH/NEUTRAL + 信心%  │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│              加权共识层 (model-weights.ts)            │
│  ├─ 模型权重 = 7d准确率×40% + 30d准确率×30% + RAG×30%│
│  ├─ 加权多空得分 → 确定方向 (LONG/SHORT)              │
│  ├─ 共识信心 = |多空分差| / 总权重 × 100              │
│  └─ 统计模型一致性 (几个模型同方向)                    │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│              信号过滤层 (signal-filter.ts)            │
│  ├─ STRONG: 信心≥75% + 4/5模型一致 → 全仓            │
│  ├─ MEDIUM: 信心≥60% + 3/5模型一致 → 半仓            │
│  ├─ WEAK:   信心≥50% + 3/5模型一致 → 1/4仓           │
│  └─ NONE:   信心<50% 或 <3模型一致 → 不交易           │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│             策略选择层 (strategy-selector.ts)         │
│  ├─ 检测市场状态 (波动率/趋势/动量/成交量)             │
│  ├─ 强趋势+高波动 → Directional (趋势跟踪)           │
│  ├─ 低波动+震荡   → Grid (网格交易)                   │
│  ├─ 下跌+超卖     → DCA (分批建仓)                    │
│  └─ 输出: 策略类型 + 参数 + 理由                      │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│              执行层 (execution-manager.ts)            │
│  ├─ PAPER:     模拟交易 (测试验证)                    │
│  ├─ SIGNAL:    只发信号 (用户手动执行)                 │
│  ├─ SEMI_AUTO: 信号+用户确认后自动执行                 │
│  └─ FULL_AUTO: 完全自动执行                           │
│                                                      │
│  风控: 最大仓位/日亏损/回撤限制/冷却期/交易时段         │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│          交易所执行层 (6个交易所)                      │
│  DEX:  HyperLiquid (EIP-712) | dYdX v4 (Cosmos)     │
│  CEX:  Binance | Bybit | OKX | Bitget               │
│  └─ 统一接口: BaseExchangeClient                     │
└──────────────────────────────────────────────────────┘
```

---

## 二、四种交易策略详解

### 2.1 Directional（趋势跟踪）

**适用条件:** 强趋势 + 中高波动率
**触发规则:** ADX > 30, EMA9 > EMA21 (多) 或 EMA9 < EMA21 (空), Supertrend 确认

| 参数 | STRONG信号 | MEDIUM信号 | WEAK信号 |
|------|-----------|-----------|---------|
| 仓位 | 100% | 50% | 25% |
| 杠杆 | ≤5x | ≤3x | ≤2x |
| 止损 | 2.0% | 1.5% | 1.0% |
| 止盈 | 4.5% | 3.0% | 2.25% |
| 追踪止损 | ✅ 激活2%, 回撤0.5% | ❌ | ❌ |

**Hummingbot 执行:** `PositionExecutor` + `TripleBarrierConfig`

```python
PositionExecutorConfig(
    side=TradeType.BUY,  # or SELL
    amount=calculated_size,
    leverage=signal_leverage,
    triple_barrier_config=TripleBarrierConfig(
        stop_loss=Decimal("0.02"),
        take_profit=Decimal("0.03"),
        time_limit=3600,  # 1小时
        trailing_stop=TrailingStop(
            activation_price=Decimal("0.02"),
            trailing_delta=Decimal("0.005"),
        ),
    ),
)
```

### 2.2 Grid（网格交易）

**适用条件:** 低波动率 + 横盘震荡
**触发规则:** ADX < 20, BB width < 3%, 趋势中性

| 参数 | 值 |
|------|----|
| 网格层数 | 3-5 层 |
| 网格间距 | BB width / 4 (最小 0.5%) |
| 仓位上限 | 50% (低波) 或 25% (高波) |

**逻辑:** 在支撑位买入，阻力位卖出，反复捕获震荡利润。

### 2.3 DCA（分批建仓）

**适用条件:** 下跌趋势 + 超卖信号
**触发规则:** RSI < 30, Stochastic K < 20, 趋势 DOWN/STRONG_DOWN

| 参数 | 值 |
|------|----|
| 分批次数 | 4 层 |
| 每层间距 | 1.5% |
| 止损 | 4% (更宽, 给 DCA 空间) |
| 仓位上限 | 75% |

**Hummingbot 执行:** `DCAExecutor`

```python
DCAExecutorConfig(
    amounts_quote=[250, 250, 250, 250],  # 每层等额
    prices=[0, -0.015, -0.03, -0.045],    # 逐级下移
    stop_loss=Decimal("0.04"),
    take_profit=Decimal("0.03"),
)
```

### 2.4 Arbitrage（套利）

**适用条件:** 跨交易所价差
**状态:** 规划中, 需要多交易所同时连接

---

## 三、市场状态检测

系统自动从技术指标中检测当前市场状态：

```typescript
MarketRegime {
  volatility: "HIGH" | "MEDIUM" | "LOW"
  // HIGH:   BB width > 6%
  // MEDIUM: BB width 3-6%
  // LOW:    BB width < 3%

  trend: "STRONG_UP" | "UP" | "NEUTRAL" | "DOWN" | "STRONG_DOWN"
  // STRONG_UP:   ADX > 30 + EMA9 > EMA21 + Supertrend BUY
  // UP:          ADX > 20 + EMA9 > EMA21
  // NEUTRAL:     ADX < 20
  // DOWN:        ADX > 20 + EMA9 < EMA21
  // STRONG_DOWN: ADX > 30 + EMA9 < EMA21 + Supertrend SELL

  momentum: "OVERBOUGHT" | "NEUTRAL" | "OVERSOLD"
  // OVERBOUGHT: RSI > 70 AND Stochastic K > 80
  // OVERSOLD:   RSI < 30 AND Stochastic K < 20

  volume: "HIGH" | "NORMAL" | "LOW"
  // Based on CMF (Chaikin Money Flow)
}
```

**策略选择矩阵:**

| 波动率 | 趋势 | 动量 | → 策略 | 信心 |
|--------|------|------|--------|------|
| HIGH | STRONG_UP/DOWN | Any | Directional | 85% |
| LOW | NEUTRAL/UP/DOWN | Any | Grid | 75% |
| Any | DOWN/STRONG_DOWN | OVERSOLD | DCA | 70% |
| MEDIUM | UP/DOWN | Any | Directional (保守) | 65% |
| HIGH | NEUTRAL | Any | Grid (小仓) | 55% |
| Any | Any | Any | Directional (默认) | 50% |

---

## 四、技术指标清单

系统计算的完整指标列表（文件: `indicators.ts`）:

### 趋势类
| 指标 | 参数 | 用途 |
|------|------|------|
| SMA | 20, 50, 200 | 移动平均线交叉, 趋势方向 |
| EMA | 9, 21 | 快慢线交叉, 短期趋势 |
| MACD | 12/26/9 | 动量+趋势, 金叉/死叉检测 |
| Supertrend | 10, 3 | 趋势方向确认 |
| ADX | 14 | 趋势强度 (>25 有趋势, >30 强趋势) |

### 动量类
| 指标 | 参数 | 用途 |
|------|------|------|
| RSI | 14 | 超买(>70)/超卖(<30) |
| Stochastic | K=14, D=3 | 超买(>80)/超卖(<20) |
| CCI | 20 | 价格偏离均值程度 |
| Williams %R | 14 | 超买/超卖确认 |

### 波动率类
| 指标 | 参数 | 用途 |
|------|------|------|
| Bollinger Bands | 20, 2σ | 价格位置(0-100%), 波动率宽度 |
| ATR | 14 | 绝对波动率, 止损计算 |

### 成交量类
| 指标 | 用途 |
|------|------|
| OBV | 量价确认 |
| VWAP | 成交量加权均价 |
| CMF | 资金流向 (>0 买入, <0 卖出) |

### K线形态
| 形态 | 类型 | 强度 |
|------|------|------|
| Doji 十字星 | 中性 | ★ |
| Hammer 锤子 | 看涨 | ★★ |
| Shooting Star 流星 | 看跌 | ★★ |
| Bullish Engulfing 看涨吞没 | 看涨 | ★★ |
| Bearish Engulfing 看跌吞没 | 看跌 | ★★ |
| Morning Star 晨星 | 看涨 | ★★★ |
| Evening Star 暮星 | 看跌 | ★★★ |
| Three White Soldiers 三白兵 | 看涨 | ★★★ |
| Three Black Crows 三黑鸦 | 看跌 | ★★★ |

---

## 五、链上数据

系统从 Binance Futures 公开 API 获取（文件: `onchain-data.ts`）:

| 数据 | API | 含义 |
|------|-----|------|
| 资金费率 | `fapi/v1/fundingRate` | 正=多头付费(多头拥挤), 负=空头付费 |
| 多空比 | `futures/data/globalLongShortAccountRatio` | >1.2 多头偏重, <0.8 空头偏重 |
| 持仓量变化 | `fapi/v1/openInterest` | 上升=新资金进入, 下降=平仓 |
| 大户多空比 | `futures/data/topLongShortPositionRatio` | 聪明钱方向 |
| 多空成交量 | `futures/data/takerlongshortRatio` | 主动买卖力量 |

---

## 六、AI Prompt 示例

**增强前（Phase 1）:**
```
Analyze BTC/USDT at $67,230. Fear & Greed Index: 62 (Greed).
Predict the 1-hour movement.
```

**增强后（Phase 2+3）:**
```
Analyze BTC/USDT at $67,230.
  Sentiment: Fear & Greed Index=62 (Greed)
  Technical: RSI(14)=55.3(NEUTRAL), MACD=BULLISH_CROSS, MACD_hist=0.42
  EMA9>EMA21(bullish), Above_SMA50, Supertrend=BUY, ADX=28.5
  BB=mid_band(52%), Stoch_K=65.3
  Patterns: Bullish_Engulfing
  On-Chain: Funding=0.0100%(positive(longs_pay)), L/S_ratio=1.15(balanced)
  Similar History (RAG): 10 similar patterns found, 7/10 correct,
  Average outcome: +1.2% (BULLISH), Best model: DeepSeek (85% accuracy)
  Predict the 1-hour movement. targetPrice must be between $66,423 and $68,037.
```

---

## 七、信号输出格式

### API 响应 (ai-forecast-multi)

```json
{
  "forecasts": [
    {
      "model": "GPT-4o",
      "asset": "BTC",
      "timeframe": "1H",
      "direction": "BULLISH",
      "confidence": 78,
      "currentPrice": 67230,
      "targetPrice": 67850,
      "reasoning": "RSI neutral with MACD bullish cross...",
      "forecastPoints": [...]
    }
  ],
  "consensus": {
    "direction": "LONG",
    "confidence": 72.5,
    "strength": "MEDIUM",
    "agreeingModels": 4,
    "totalModels": 5,
    "positionSizePct": 0.5,
    "suggestedLeverage": 3,
    "stopLossPct": 0.015,
    "takeProfitPct": 0.03,
    "signal": 1,
    "probabilities": [0.12, 0, 0.88]
  }
}
```

### TradeSignal (Hummingbot 兼容)

```json
{
  "id": "uuid",
  "timestamp": 1710520200000,
  "asset": "BTC-USDT",
  "action": "OPEN_LONG",
  "probabilities": [0.12, 0, 0.88],
  "confidence": 72,
  "stopLossPct": 0.015,
  "takeProfitPct": 0.03,
  "leverage": 3,
  "positionSizePct": 0.5,
  "strategyType": "directional",
  "sourceModels": ["GPT-4o", "DeepSeek", "Llama3.1", "Grok"],
  "strength": "MEDIUM"
}
```

---

## 八、风控体系

### 信号级风控 (signal-filter.ts)
- 信心<50% 或 <3个模型一致 → 不交易
- 仓位按信号强度缩放: 100% → 50% → 25%
- 杠杆按信号强度递减: 5x → 3x → 2x

### 执行级风控 (execution-manager.ts)
- 最大单笔仓位: $1,000 (可配置)
- 最大同时持仓: 3 个
- 日亏损上限: $200 → 暂停交易
- 最大回撤: 10% → kill switch
- 冷却期: 同资产 60秒 间隔
- 交易时段: 可限制 UTC 时段

### Hummingbot 级风控 (coinmax_ai_controller.py)
- 信心低于阈值 → 拒绝信号
- 最大杠杆限制
- 执行器并发数限制
- 回撤 kill switch
- 填充后冷却

### 全局风控 (coinmax_ai_trading.py)
- 全局最大回撤: 15% → 关闭所有仓位
- 每日最大亏损: $500
- 最大总仓位: $5,000

---

## 九、数据库表结构

| 表 | 用途 | 创建于 |
|----|------|--------|
| `ai_prediction_records` | 每次 AI 预测记录 + 验证结果 + 向量嵌入 | Migration 018 |
| `ai_model_accuracy` | 各模型准确率汇总 (7d/30d/all) | Migration 018 |
| `trade_signals` | 交易信号发布 + Realtime 广播 | Migration 019 |
| `paper_trades` | 模拟交易记录 + P&L | Migration 019 |
| `user_exchange_keys` | 加密存储用户交易所 API Key | Migration 019 |
| `strategies` | 策略定义 | Migration 001 |
| `strategy_subscriptions` | 用户订阅的策略 | Migration 001 |

---

## 十、当前前端策略展示

### 策略列表 (6个)

| # | 策略名 | 类型 | 杠杆 | 胜率 | 月回报 | 状态 |
|---|--------|------|------|------|--------|------|
| 1 | HyperGrowth | HyperLiquid Vault | 3x | 76-82% | 16-22% | 活跃 |
| 2 | OpenClaw GPT | AI 模型 | 3x | 80-86% | 13-19% | Coming Soon |
| 3 | OpenClaw Gemini | AI 模型 | 5x | 82-88% | 15-21% | Coming Soon |
| 4 | OpenClaw DeepSeek | AI 模型 | 5x | 88-94% | 22-28% | Coming Soon 🔥 |
| 5 | OpenClaw Qwen | AI 模型 | 8x | 85-92% | 25-31% | Coming Soon |
| 6 | OpenClaw Grok | AI 模型 | 8x | 86-93% | 30-36% | Coming Soon |

### 前端文件
- `src/pages/strategy.tsx` — 策略页面 (3个Tab: 策略/对冲保护/预测)
- `src/components/strategy/strategy-card.tsx` — 策略卡片 (动画指标+迷你图表)
- `src/components/strategy/strategy-header.tsx` — 策略头部 (AUM/胜率/日历PnL)
- `src/lib/data.ts` — 策略硬编码数据 (LocalStrategy 接口)

---

# 策略提供方接入指南

## 一、什么是策略提供方？

策略提供方（Strategy Provider）是指拥有自己交易策略的个人或团队，希望将策略接入 CoinMax 平台供用户跟单。

**策略来源可以是:**
- 量化交易算法 (Python/TS)
- AI/ML 预测模型
- 手动交易信号 (人工发布)
- 外部信号源 (TradingView, 3Commas 等)
- Hummingbot 策略脚本

---

## 二、接入方式

### 方式 A: 通过 TradeSignal API 接入（推荐）

最简单的方式 — 策略提供方只需向 Supabase 发布标准格式的 `TradeSignal`。

**步骤:**

1. **获取 API 凭证**
```
SUPABASE_URL=https://jqgimdgtpwnunrlwexib.supabase.co
SUPABASE_SERVICE_KEY=<provided by CoinMax admin>
```

2. **发布信号**
```typescript
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// 发布一个交易信号
await supabase.from("trade_signals").insert({
  asset: "BTC",
  action: "OPEN_LONG",          // OPEN_LONG | OPEN_SHORT | CLOSE | HOLD
  direction: "LONG",
  confidence: 78,                // 0-100
  strength: "MEDIUM",           // STRONG | MEDIUM | WEAK
  strategy_type: "directional", // directional | grid | dca
  leverage: 3,
  stop_loss_pct: 0.02,          // 2%
  take_profit_pct: 0.03,        // 3%
  position_size_pct: 0.5,       // 50% of allocated capital
  source_models: ["MyStrategy v2.1"],
  rag_context: "Based on EMA crossover + volume confirmation",
  status: "active",
});
```

3. **信号自动广播**
- 插入 `trade_signals` 表后，Supabase Realtime 自动推送给所有订阅的客户端
- Hummingbot 控制器通过 MQTT bridge 或 Supabase Realtime 接收

**最低要求字段:**
```typescript
{
  asset: string;           // "BTC", "ETH", "SOL"...
  action: string;          // "OPEN_LONG" | "OPEN_SHORT"
  confidence: number;      // 0-100
  strength: string;        // "STRONG" | "MEDIUM" | "WEAK"
  stop_loss_pct: number;   // 建议止损%
  take_profit_pct: number; // 建议止盈%
}
```

---

### 方式 B: 作为 AI 模型接入

将你的 AI/ML 模型作为第 6 个（或更多）预测模型加入现有的多模型共识系统。

**步骤:**

1. **部署你的模型为 API**

你的模型需要接收以下 prompt 并返回 JSON:

```
Input (POST /predict):
{
  "asset": "BTC",
  "timeframe": "1H",
  "currentPrice": 67230,
  "indicators": {
    "rsi14": 55.3,
    "macd": "BULLISH_CROSS",
    "bbPosition": 0.52,
    "adx": 28.5,
    "supertrend": "BUY"
  },
  "onchain": {
    "fundingRate": 0.0001,
    "longShortRatio": 1.15
  },
  "fearGreed": 62
}

Output:
{
  "prediction": "BULLISH",   // BULLISH | BEARISH | NEUTRAL
  "confidence": 78,           // 0-100
  "targetPrice": 67850,
  "reasoning": "EMA crossover with volume confirmation..."
}
```

2. **注册到模型列表**

在 `ai-forecast-multi/index.ts` 的 `MODELS` 数组中添加:

```typescript
const MODELS: ModelDef[] = [
  // ... existing models ...
  {
    type: "custom",
    model: "https://your-api.com/predict",
    label: "YourStrategy",
    maxTokens: 256,
  },
];
```

3. **自动获得的能力:**
- 准确率自动追踪 (7d/30d/all)
- 动态权重调整 (越准权重越高)
- RAG 记忆增强 (相似行情学习)
- 前端 AI准确率 Dashboard 展示

---

### 方式 C: 通过 Hummingbot Controller 接入

如果你已经有 Hummingbot 策略，可以直接扩展我们的控制器。

**步骤:**

1. **创建你的 Controller**

```python
# ai-engine/hummingbot/controllers/your_strategy_controller.py

from hummingbot.strategy_v2.controllers.directional_trading_controller_base import (
    DirectionalTradingControllerBase,
    DirectionalTradingControllerConfigBase,
)

class YourStrategyConfig(DirectionalTradingControllerConfigBase):
    controller_name = "your_strategy"
    connector_name: str = "binance_perpetual"
    trading_pair: str = "BTC-USDT"
    # 你的自定义参数
    your_param_1: float = 0.5
    your_param_2: int = 14

class YourStrategyController(DirectionalTradingControllerBase):
    def __init__(self, config, *args, **kwargs):
        super().__init__(config, *args, **kwargs)

    def determine_executor_actions(self):
        """你的策略逻辑"""
        actions = []

        # 获取市场数据
        candles = self.market_data_provider.get_candles(...)

        # 你的分析逻辑
        signal = your_analysis(candles)

        # 设置信号 (-1=做空, 0=观望, 1=做多)
        self.processed_data["signal"] = signal

        if signal != 0:
            # 创建执行器
            config = PositionExecutorConfig(
                trading_pair=self.config.trading_pair,
                connector_name=self.config.connector_name,
                side=TradeType.BUY if signal == 1 else TradeType.SELL,
                amount=Decimal("100"),
                leverage=3,
                triple_barrier_config=TripleBarrierConfig(
                    stop_loss=Decimal("0.02"),
                    take_profit=Decimal("0.03"),
                    time_limit=3600,
                ),
            )
            actions.append(CreateExecutorAction(
                controller_id=self.config.id,
                executor_config=config,
            ))

        return actions
```

2. **注册到交易脚本**

在 `coinmax_ai_trading.py` 的 controllers 列表中添加你的 controller。

---

### 方式 D: 通过 MQTT 信号桥接入

适用于外部信号源（TradingView Webhook, 3Commas, 自建系统）。

**MQTT Topic 格式:**
```
coinmax/signals/{asset}

例如:
coinmax/signals/BTC-USDT
coinmax/signals/ETH-USDT
```

**消息格式 (JSON):**
```json
{
  "id": "unique-signal-id",
  "action": "OPEN_LONG",
  "confidence": 75,
  "strength": "MEDIUM",
  "leverage": 3,
  "stop_loss_pct": 0.02,
  "take_profit_pct": 0.03,
  "position_size_pct": 0.5,
  "strategy_type": "directional",
  "source_models": ["TradingView:PineScript:RSI_EMA"]
}
```

**TradingView Webhook 示例:**

```
URL: https://your-mqtt-bridge.com/webhook
Body:
{
  "action": "{{strategy.order.action}}",
  "asset": "{{ticker}}",
  "confidence": 70
}
```

---

## 三、策略提供方后台

接入后，策略提供方可以在 Admin 后台查看:

1. **AI准确率页面** (`/admin/ai-accuracy`)
   - 你的模型在各资产/时间周期的准确率
   - 与其他模型的对比
   - 历史预测记录 + 实际验证结果

2. **信号记录** (`trade_signals` 表)
   - 发出的所有信号
   - 执行状态 (active/executed/expired)
   - 盈亏结果

3. **绩效报告**
   - 胜率, 平均盈亏比, 最大回撤
   - 按资产/策略类型分类统计

---

## 四、收益分成模型

| 策略表现 | 提供方分成 | 平台分成 |
|---------|-----------|---------|
| 月盈利 > 0 | 20% of profit | 80% |
| 用户订阅费 | 50% | 50% |
| 带来新用户 | +5% bonus | — |

*具体分成比例以合约为准*

---

## 五、接入流程

```
1. 联系 CoinMax 团队 → 获取 API 凭证
2. 选择接入方式 (A/B/C/D)
3. 开发 & 对接 (我们提供技术支持)
4. 纸上交易测试 (PAPER 模式, 至少 7 天)
5. 准确率审核 (胜率 > 55%, 盈亏比 > 1.2)
6. 上线 SIGNAL 模式 (用户手动跟)
7. 审核通过 → 开放 SEMI_AUTO / FULL_AUTO
```

---

## 六、技术文件索引

| 文件 | 路径 | 功能 |
|------|------|------|
| 技术指标 | `ai-engine/src/indicators.ts` | RSI, MACD, BB, ADX 等计算 |
| 链上数据 | `ai-engine/src/onchain-data.ts` | 资金费率, 多空比 |
| K线形态 | `ai-engine/src/patterns.ts` | 蜡烛图形态识别 |
| 向量存储 | `ai-engine/src/vector-store.ts` | Embedding 生成 + 相似搜索 |
| 模型权重 | `ai-engine/src/model-weights.ts` | 动态模型加权 |
| 信号过滤 | `ai-engine/src/signal-filter.ts` | 信号分级 + 仓位计算 |
| 策略选择 | `ai-engine/src/strategy-selector.ts` | 市场状态检测 + 策略推荐 |
| RAG管道 | `ai-engine/src/rag-predictor.ts` | 完整预测管道编排 |
| 信号发布 | `ai-engine/src/signal-publisher.ts` | Supabase Realtime 发布 |
| 执行管理 | `ai-engine/src/execution-manager.ts` | 4种执行模式 + 风控 |
| API Key | `ai-engine/src/api-key-vault.ts` | AES-256 加密存储 |
| HB控制器 | `ai-engine/hummingbot/controllers/coinmax_ai_controller.py` | Hummingbot V2 控制器 |
| HB脚本 | `ai-engine/hummingbot/scripts/coinmax_ai_trading.py` | Hummingbot 入口 |
| 交易所映射 | `ai-engine/src/exchanges/symbol-map.ts` | 跨交易所符号标准化 |
| 统一接口 | `ai-engine/src/exchanges/base-exchange.ts` | 6交易所统一接口 |
| 交易所计划 | `ai-engine/EXCHANGE_INTEGRATION.md` | 交易所集成详细方案 |
| 技术计划 | `ai-engine/TECHNICAL_PLAN.md` | 6阶段实施计划 |
| DB: 预测 | `supabase/migrations/018_pgvector_prediction_tracking.sql` | 预测记录+向量 |
| DB: 执行 | `supabase/migrations/019_trade_signals_execution.sql` | 信号+交易+密钥 |
| Edge: 预测 | `supabase/functions/ai-forecast-multi/index.ts` | AI 预测 API |
| Edge: 验证 | `supabase/functions/resolve-predictions/index.ts` | 定时验证预测 |
