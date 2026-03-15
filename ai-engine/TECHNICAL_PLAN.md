# CoinMax AI Trading Engine - Technical Implementation Plan

> Version: 1.0 | Created: 2026-03-15
> Project Module: `/ai-engine/`
> Reference Codebase: `/Users/macbookpro/WebstormProjects/hummingbot/`

---

## System Architecture Overview

```
                    ┌──────────────────────────────────┐
                    │         AxomX Frontend            │
                    │  (Strategy UI + Live Dashboard)   │
                    └──────────────┬───────────────────┘
                                   │
              ┌────────────────────▼────────────────────┐
              │        Supabase Backend (API + DB)       │
              └───┬────────────┬────────────┬───────────┘
                  │            │            │
    ┌─────────────▼──┐  ┌─────▼──────┐  ┌──▼──────────────┐
    │  AI Brain       │  │  Vector    │  │  Signal Router   │
    │  (Multi-Model   │  │  Memory    │  │  (MQTT/WS)       │
    │   Consensus)    │  │  (Pinecone)│  │                  │
    └─────────────┬──┘  └─────┬──────┘  └──┬──────────────┘
                  │            │            │
              ┌───▼────────────▼────────────▼───┐
              │      Strategy Decision Engine    │
              │  (Signal Generation + Scoring)   │
              └────────────────┬────────────────┘
                               │
              ┌────────────────▼────────────────┐
              │   Execution Engine (Hummingbot)   │
              │  Controller → Orchestrator →      │
              │  Executor → Exchange Connector     │
              └────────────────┬────────────────┘
                               │
              ┌────────────────▼────────────────┐
              │        Learning Feedback Loop     │
              │  Result → Embedding → Vector DB   │
              │  → Model Weight Update → Backtest │
              └─────────────────────────────────┘
```

---

## Phase 1: Vector Memory + Prediction Tracking

### Goal
让 AI 从无状态变为有记忆。记录每次预测及实际结果，建立向量记忆库用于检索相似行情。

### Tasks

#### 1.1 Prediction Result Tracker (Supabase Edge Function)
- **File:** `supabase/functions/ai-prediction-tracker/index.ts`
- **Trigger:** 每次 AI 预测后，定时验证结果
- **Logic:**
  1. 预测发出后记录到 `ai_prediction_records` 表
  2. 到达 timeframe 终点时获取实际价格
  3. 计算准确率: 方向是否正确 + 价格偏差 %
  4. 更新每个模型的滚动准确率
- **Database Schema:**
  ```sql
  CREATE TABLE ai_prediction_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset TEXT NOT NULL,           -- BTC, ETH, SOL, BNB
    timeframe TEXT NOT NULL,       -- 5m, 15m, 1H, 4H, 1D
    model TEXT NOT NULL,           -- GPT-4o, DeepSeek, Llama3.1, Gemini, Grok
    prediction TEXT NOT NULL,      -- BULLISH, BEARISH, NEUTRAL
    confidence INT NOT NULL,       -- 0-100
    target_price NUMERIC NOT NULL,
    current_price NUMERIC NOT NULL,
    -- Market state at prediction time
    fear_greed_index INT,
    rsi_14 NUMERIC,
    macd_signal TEXT,              -- BULLISH_CROSS, BEARISH_CROSS, NEUTRAL
    volume_change_pct NUMERIC,
    -- Result (filled after timeframe expires)
    actual_price NUMERIC,
    actual_direction TEXT,         -- BULLISH, BEARISH
    actual_change_pct NUMERIC,
    direction_correct BOOLEAN,
    price_error_pct NUMERIC,
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    embedding_id TEXT              -- Reference to vector DB
  );

  CREATE TABLE ai_model_accuracy (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model TEXT NOT NULL,
    asset TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    period TEXT NOT NULL,          -- '7d', '30d', 'all'
    total_predictions INT DEFAULT 0,
    correct_predictions INT DEFAULT 0,
    accuracy_pct NUMERIC DEFAULT 0,
    avg_confidence NUMERIC DEFAULT 0,
    avg_price_error_pct NUMERIC DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(model, asset, timeframe, period)
  );
  ```

#### 1.2 Vector Memory Store (Pinecone / Supabase pgvector)
- **File:** `ai-engine/src/vector-store.ts`
- **Option A:** Pinecone (hosted, production-ready)
- **Option B:** Supabase pgvector extension (self-hosted, lower cost)
- **Embedding Model:** OpenAI `text-embedding-3-small` (1536 dimensions)
- **What gets embedded:**
  ```typescript
  interface MarketStateVector {
    // Numerical features (normalized)
    price: number;
    price_change_1h: number;
    price_change_24h: number;
    volume_change_24h: number;
    fear_greed_index: number;
    rsi_14: number;
    macd_histogram: number;
    bb_position: number;      // 0-1 where in Bollinger Bands
    // Text features (for embedding)
    news_sentiment: string;
    model_predictions_summary: string;
  }
  ```
- **Storage per prediction:**
  ```typescript
  {
    id: "pred_xxxxx",
    vector: [1536-dim embedding],
    metadata: {
      asset: "BTC",
      timeframe: "1H",
      timestamp: 1710520200,
      fgi: 62,
      rsi: 55.3,
      predictions: { gpt4o: "BULLISH:85", deepseek: "BULLISH:72", ... },
      actual_result: "BULLISH:+1.2%",
      best_model: "GPT-4o",
      best_strategy: "trend_follow"
    }
  }
  ```
- **Query:** 当新预测时，搜索 top-5 最相似的历史行情

#### 1.3 Model Accuracy Dashboard (Admin)
- **File:** `src/admin/pages/admin-ai-accuracy.tsx`
- **Display:**
  - 每个模型 × 每个资产 × 每个 timeframe 的准确率
  - 滚动 7d / 30d / all-time 准确率趋势图
  - 模型对比雷达图
  - 最近 50 次预测结果列表

#### 1.4 Cron Job: Resolve Predictions
- **File:** `supabase/functions/resolve-predictions/index.ts`
- **Schedule:** 每 1 分钟执行
- **Logic:**
  1. 查找所有 `resolved_at IS NULL` 且已过期的预测
  2. 获取实际价格
  3. 计算结果并更新
  4. 生成 embedding 存入向量库
  5. 更新 `ai_model_accuracy` 汇总表

### Hummingbot Reference
- **不直接使用**，但参考其 `trailing_indicators` 设计模式
- **File:** `hummingbot/strategy/__utils__/trailing_indicators/base_trailing_indicator.py`
- 学习其滑动窗口采样 + 指标计算架构

---

## Phase 2: Enhanced Data Sources + Technical Analysis

### Goal
给 AI 更丰富的分析维度，从"只看价格+FGI"升级到完整技术分析。

### Tasks

#### 2.1 Technical Indicator Service
- **File:** `ai-engine/src/indicators.ts`
- **Indicators to implement:**
  ```
  Trend:     SMA(20,50,200), EMA(9,21), MACD, Supertrend, ADX
  Momentum:  RSI(14), Stochastic, CCI, Williams %R
  Volatility: Bollinger Bands, ATR, Keltner Channels
  Volume:    OBV, VWAP, Volume Profile, CMF
  Custom:    Order Book Imbalance, Funding Rate Trend
  ```
- **Data Source:** Binance Klines API (已有 `useBinanceKlines`)
- **Implementation:** 使用 `technicalindicators` npm 库 或 自行计算

#### 2.2 On-Chain Data Feed
- **File:** `ai-engine/src/onchain-data.ts`
- **Data Sources:**
  - Whale Alert API (大额转账)
  - Coinglass API (资金费率、持仓量、清算数据)
  - DeFiLlama API (TVL 变化)
- **Metrics:**
  ```typescript
  interface OnChainMetrics {
    funding_rate: number;         // 永续合约资金费率
    open_interest_change: number; // 持仓量变化 %
    long_short_ratio: number;     // 多空比
    whale_flow_24h: number;       // 大额转账净流入/流出
    exchange_netflow: number;     // 交易所净流入
    liquidation_24h: {
      long: number;
      short: number;
    };
  }
  ```

#### 2.3 Enhanced AI Prompt with Full Context
- **File:** 更新 `supabase/functions/ai-forecast-multi/index.ts`
- **改进 prompt:**
  ```
  当前:
    "Analyze BTC/USDT at $45230. Fear & Greed: 62 (Greed). Predict 1H movement."

  改进为:
    "Analyze BTC/USDT at $45230.
     Technical: RSI(14)=55.3, MACD=BULLISH_CROSS, BB=mid_band,
     Supertrend=BUY, ADX=28.5
     On-Chain: Funding=+0.01%, OI_change=+3.2%, L/S_ratio=1.15,
     Exchange_netflow=-$50M (outflow)
     Sentiment: FGI=62(Greed), News=3_BULLISH/1_BEARISH
     Similar History (RAG): 5 similar patterns found,
     4/5 resulted in BULLISH (+1.2% avg), best model was DeepSeek (88% accuracy)
     Predict the 1H movement."
  ```

#### 2.4 Candle Pattern Recognition
- **File:** `ai-engine/src/patterns.ts`
- **Patterns:** Doji, Hammer, Engulfing, Morning/Evening Star, Three White Soldiers
- **Reference:** hummingbot 的 `candles_feed` 数据结构
  - `hummingbot/data_feed/candles_feed/candles_base.py`
  - Columns: timestamp, open, high, low, close, volume

### Hummingbot Reference
- **Market Data Provider pattern:**
  - `hummingbot/data_feed/market_data_provider.py` — 统一数据访问接口
  - `hummingbot/data_feed/candles_feed/` — K线数据管道设计
- **Trailing Indicators:**
  - `hummingbot/strategy/__utils__/trailing_indicators/exponential_moving_average.py`
  - `hummingbot/strategy/__utils__/trailing_indicators/historical_volatility.py`
- 学习其 `CandlesConfig` 配置模式（connector + pair + interval + max_records）

---

## Phase 3: Weighted Consensus + RAG-Enhanced Prediction

### Goal
用向量记忆库增强预测质量，实现"越用越准"的 AI。

### Tasks

#### 3.1 RAG-Enhanced Prediction Pipeline
- **File:** `ai-engine/src/rag-predictor.ts`
- **Flow:**
  ```
  1. 收集当前市场状态 (价格+指标+链上+情绪)
  2. 生成 embedding
  3. 向量库搜索 top-5 相似历史行情
  4. 提取历史结果:
     - 哪些模型预测最准?
     - 哪个策略表现最好?
     - 实际涨跌幅是多少?
  5. 注入到 AI prompt 作为 context
  6. 动态调整模型权重
  ```

#### 3.2 Dynamic Model Weighting
- **File:** `ai-engine/src/model-weights.ts`
- **Algorithm:**
  ```typescript
  function calculateModelWeight(model: string, asset: string, tf: string): number {
    const recentAccuracy = getAccuracy(model, asset, tf, '7d');   // 40%
    const overallAccuracy = getAccuracy(model, asset, tf, '30d'); // 30%
    const ragAccuracy = getRAGAccuracy(model, asset, tf);         // 30%

    return recentAccuracy * 0.4 + overallAccuracy * 0.3 + ragAccuracy * 0.3;
  }

  function weightedConsensus(predictions: ModelPrediction[]): Signal {
    let bullishScore = 0, bearishScore = 0, totalWeight = 0;

    for (const p of predictions) {
      const w = calculateModelWeight(p.model, p.asset, p.timeframe);
      const score = w * (p.confidence / 100);

      if (p.prediction === 'BULLISH') bullishScore += score;
      else if (p.prediction === 'BEARISH') bearishScore += score;
      totalWeight += w;
    }

    return {
      direction: bullishScore > bearishScore ? 'LONG' : 'SHORT',
      confidence: Math.abs(bullishScore - bearishScore) / totalWeight * 100,
      model_weights: predictions.map(p => ({
        model: p.model,
        weight: calculateModelWeight(p.model, p.asset, p.timeframe)
      }))
    };
  }
  ```

#### 3.3 Confidence Threshold System
- **File:** `ai-engine/src/signal-filter.ts`
- **Rules:**
  ```
  STRONG_SIGNAL:  consensus_confidence >= 75 AND 4/5 models agree → Full position
  MEDIUM_SIGNAL:  consensus_confidence >= 60 AND 3/5 models agree → Half position
  WEAK_SIGNAL:    consensus_confidence >= 50 AND 3/5 models agree → Quarter position
  NO_SIGNAL:      consensus_confidence < 50 OR < 3 models agree   → No trade
  ```

#### 3.4 Strategy Selector (RAG-based)
- **File:** `ai-engine/src/strategy-selector.ts`
- **Logic:** 根据相似历史行情自动选择最优策略类型
  ```
  高波动+强趋势 → Directional (趋势跟踪)
  低波动+震荡   → Grid (网格)
  下跌趋势      → DCA (分批抄底)
  交叉信号      → Arbitrage (套利)
  ```

### Hummingbot Reference
- **Controller signal pattern:**
  - `hummingbot/strategy_v2/controllers/directional_trading_controller_base.py`
  - 学习其 `processed_data["signal"]` 设计: -1 (short), 0 (neutral), 1 (long)
  - 学习其 `can_create_executor()` 冷却机制
- **AILivestreamController (核心参考):**
  - `hummingbot/controllers/directional_trading/ai_livestream.py`
  - MQTT signal format: `{probabilities: [short, neutral, long], target_pct}`
  - Threshold-based signal conversion

---

## Phase 4: Execution Engine (Hummingbot Integration)

### Goal
将 AI 信号转化为实际交易执行，实现自动跟单。

### Tasks

#### 4.1 Signal Publisher Service
- **File:** `ai-engine/src/signal-publisher.ts`
- **Protocol:** MQTT or WebSocket
- **Signal Format (compatible with hummingbot AILivestreamController):**
  ```typescript
  interface TradeSignal {
    id: string;
    timestamp: number;
    asset: string;              // "BTC-USDT"
    action: 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE' | 'HOLD';
    probabilities: [number, number, number]; // [short, neutral, long]
    target_pct: number;         // Expected move %
    confidence: number;         // 0-100
    stop_loss_pct: number;      // Suggested SL
    take_profit_pct: number;    // Suggested TP
    leverage: number;           // Suggested leverage
    position_size_pct: number;  // % of allocated capital
    strategy_type: 'directional' | 'grid' | 'dca';
    source_models: string[];    // Which models contributed
    rag_context: string;        // Similar history summary
  }
  ```

#### 4.2 Hummingbot Controller (CoinMax AI Controller)
- **File:** `ai-engine/hummingbot/controllers/coinmax_ai_controller.py`
- **Base:** Extend `DirectionalTradingControllerBase`
- **Reference:** `hummingbot/controllers/directional_trading/ai_livestream.py`
- **Implementation:**
  ```python
  class CoinMaxAIControllerConfig(DirectionalTradingControllerConfigBase):
      controller_name = "coinmax_ai"
      connector_name: str = "binance_perpetual"
      trading_pair: str = "BTC-USDT"
      signal_source: str = "mqtt"           # mqtt or websocket
      signal_topic: str = "coinmax/signals/BTC-USDT"
      min_confidence: int = 60
      max_leverage: int = 5
      max_position_size_quote: Decimal = Decimal("1000")
      max_drawdown_pct: Decimal = Decimal("0.10")  # 10%
      cooldown_after_fill: int = 60         # seconds

  class CoinMaxAIController(DirectionalTradingControllerBase):
      def __init__(self, config, market_data_provider, connectors):
          super().__init__(config, market_data_provider, connectors)
          self._signal_listener = None
          self._latest_signal = None

      async def start(self):
          # Subscribe to signal topic (reference: ai_livestream.py)
          self._signal_listener = ExternalTopicFactory.create_async(
              topic=self.config.signal_topic,
              callback=self._handle_signal
          )

      def _handle_signal(self, msg):
          signal = json.loads(msg)
          if signal['confidence'] < self.config.min_confidence:
              return
          self._latest_signal = signal
          self.processed_data['signal'] = (
              1 if signal['action'] == 'OPEN_LONG'
              else -1 if signal['action'] == 'OPEN_SHORT'
              else 0
          )

      def determine_executor_actions(self):
          actions = []
          signal = self._latest_signal
          if not signal:
              return actions

          # Risk checks
          if not self._check_drawdown():
              return actions
          if not self.can_create_executor(signal['action']):
              return actions

          # Create executor based on strategy type
          if signal['strategy_type'] == 'directional':
              actions.append(self._create_position_action(signal))
          elif signal['strategy_type'] == 'dca':
              actions.append(self._create_dca_action(signal))

          return actions

      def _create_position_action(self, signal):
          # Reference: PositionExecutor triple barrier
          config = PositionExecutorConfig(
              trading_pair=self.config.trading_pair,
              connector_name=self.config.connector_name,
              side=TradeType.BUY if signal['action'] == 'OPEN_LONG' else TradeType.SELL,
              amount=self._calculate_position_size(signal),
              leverage=min(signal['leverage'], self.config.max_leverage),
              triple_barrier_config=TripleBarrierConfig(
                  stop_loss=Decimal(str(signal['stop_loss_pct'])),
                  take_profit=Decimal(str(signal['take_profit_pct'])),
                  time_limit=self._timeframe_to_seconds(signal),
                  trailing_stop=TrailingStop(
                      activation_price=Decimal("0.02"),
                      trailing_delta=Decimal("0.005"),
                  ),
              ),
          )
          return CreateExecutorAction(
              controller_id=self.config.id,
              executor_config=config,
          )
  ```

#### 4.3 Hummingbot Script (Entry Point)
- **File:** `ai-engine/hummingbot/scripts/coinmax_ai_trading.py`
- **Base:** Extend `StrategyV2Base`
- **Reference:** `hummingbot/scripts/v2_with_controllers.py`
- **Features:**
  - 加载 CoinMaxAIController
  - 全局最大回撤控制
  - 每个 controller 独立 kill switch
  - 实时 performance report → 推送到 Supabase

#### 4.4 Execution Mode Manager
- **File:** `ai-engine/src/execution-manager.ts`
- **Modes:**
  ```
  PAPER:     纸上交易，只记录不执行 (Phase 4 初期)
  SIGNAL:    只发信号，用户手动执行
  SEMI_AUTO: 发信号+用户确认后自动执行
  FULL_AUTO: 完全自动执行 (需要 API Key)
  ```

#### 4.5 User API Key Management
- **File:** `ai-engine/src/api-key-vault.ts`
- **Security:**
  - API Key 加密存储 (AES-256-GCM)
  - 只存 trade 权限 key（禁止 withdrawal）
  - Key 验证: 检查权限范围
  - 独立加密密钥 per user

### Hummingbot Reference (核心集成)
- **直接使用的组件:**
  - `hummingbot/strategy_v2/executors/position_executor/` — 三重屏障仓位管理
  - `hummingbot/strategy_v2/executors/dca_executor/` — DCA 分批建仓
  - `hummingbot/strategy_v2/executors/executor_orchestrator.py` — 执行编排
  - `hummingbot/connector/exchange/binance/` — Binance 交易所连接器
  - `hummingbot/connector/derivative/` — 永续合约支持
- **Controller 参考:**
  - `hummingbot/controllers/directional_trading/ai_livestream.py` — MQTT 信号监听模式
  - `hummingbot/controllers/directional_trading/bollinger_v1.py` — 技术指标信号生成
- **Script 参考:**
  - `hummingbot/scripts/v2_with_controllers.py` — 多 controller 管理 + 全局风控
- **Backtesting:**
  - `hummingbot/strategy_v2/backtesting/backtesting_engine_base.py` — 回测引擎

---

## Phase 5: User Copy Trading Frontend

### Goal
产品化用户跟单体验。

### Tasks

#### 5.1 Strategy Dashboard Upgrade
- **File:** `src/pages/strategy.tsx` (重构)
- **New Sections:**
  - AI 信号实时流 (WebSocket)
  - 各模型准确率 + 权重显示
  - RAG 相似行情面板
  - 一键启动/停止跟单

#### 5.2 Live Trading Panel
- **File:** `src/components/strategy/live-trading-panel.tsx`
- **Display:**
  ```
  ┌─────────────────────────────────────┐
  │  Active Positions                    │
  │  BTC-USDT LONG  Entry: $45,230      │
  │  PnL: +$123.45 (+1.2%)             │
  │  SL: $44,320  TP: $46,500          │
  │  [Close] [Modify SL/TP]            │
  ├─────────────────────────────────────┤
  │  Recent Signals                      │
  │  14:30 BTC LONG (Conf: 82%)  ✅     │
  │  14:15 ETH SHORT (Conf: 65%) ❌     │
  │  14:00 SOL LONG (Conf: 71%)  ✅     │
  ├─────────────────────────────────────┤
  │  Performance                         │
  │  Today: +2.3%  Week: +8.7%          │
  │  Win Rate: 67%  Avg RR: 1.8         │
  │  Max Drawdown: -3.2%                │
  └─────────────────────────────────────┘
  ```

#### 5.3 Risk Control Panel
- **File:** `src/components/strategy/risk-control.tsx`
- **User Controls:**
  - 最大单笔仓位 (% of capital)
  - 最大同时持仓数
  - 全局最大回撤 → 自动停止
  - 每日最大亏损 → 暂停信号
  - 杠杆上限
  - 交易时段设置

#### 5.4 API Key Binding Flow
- **File:** `src/components/strategy/api-key-bind.tsx`
- **Flow:**
  1. 选择交易所 (Binance / Bybit)
  2. 输入 API Key + Secret (+ Passphrase if needed)
  3. 前端验证: 检查 trade 权限, 拒绝 withdrawal 权限
  4. 加密传输到后端存储
  5. 测试连接: 获取余额确认有效

#### 5.5 Real-time PnL WebSocket
- **File:** `supabase/functions/trading-ws/index.ts`
- **Events:**
  ```typescript
  type WSEvent =
    | { type: 'signal', data: TradeSignal }
    | { type: 'position_open', data: Position }
    | { type: 'position_update', data: { pnl, unrealized_pnl } }
    | { type: 'position_close', data: { pnl, close_reason } }
    | { type: 'performance', data: PerformanceReport }
  ```

### Hummingbot Reference
- **Performance Report:**
  - `hummingbot/strategy_v2/models/executors_info.py` — `PerformanceReport` 类
  - Fields: realized_pnl, unrealized_pnl, volume_traded, close_type_counts
- **Position Summary:**
  - `hummingbot/strategy_v2/executors/data_types.py` — `PositionSummary`
  - Fields: breakeven_price, unrealized_pnl, realized_pnl, cum_fees

---

## Phase 6: Learning Feedback Loop + Auto Backtest

### Goal
实现闭环学习：交易结果 → 更新记忆 → 优化权重 → 更好的预测。

### Tasks

#### 6.1 Trade Result Recorder
- **File:** `ai-engine/src/trade-recorder.ts`
- **On every trade close:**
  ```typescript
  async function recordTradeResult(trade: ClosedTrade) {
    // 1. Record to database
    await supabase.from('trade_results').insert({
      signal_id: trade.signal_id,
      asset: trade.asset,
      side: trade.side,
      entry_price: trade.entry_price,
      exit_price: trade.exit_price,
      pnl_pct: trade.pnl_pct,
      close_reason: trade.close_reason,  // SL, TP, TIME_LIMIT, TRAILING
      duration_seconds: trade.duration,
      strategy_type: trade.strategy_type,
      contributing_models: trade.models,
      market_state_at_entry: trade.entry_state,
      market_state_at_exit: trade.exit_state,
    });

    // 2. Generate embedding for this trade
    const embedding = await generateEmbedding(trade.entry_state);

    // 3. Store in vector DB with result
    await vectorStore.upsert({
      id: `trade_${trade.id}`,
      vector: embedding,
      metadata: {
        ...trade.entry_state,
        trade_result: trade.pnl_pct > 0 ? 'WIN' : 'LOSS',
        pnl_pct: trade.pnl_pct,
        best_model: identifyBestModel(trade),
        strategy_used: trade.strategy_type,
      }
    });

    // 4. Update model accuracy scores
    await updateModelAccuracy(trade);

    // 5. Check if strategy needs adjustment
    await evaluateStrategyPerformance(trade.strategy_type);
  }
  ```

#### 6.2 Auto Weight Adjuster
- **File:** `ai-engine/src/weight-adjuster.ts`
- **Schedule:** 每小时运行
- **Logic:**
  ```
  1. 计算每个模型近 7 天准确率
  2. 计算每个模型在相似行情下的准确率 (RAG)
  3. 计算新权重
  4. 如果某模型准确率 < 40%，降权到最低
  5. 如果某模型准确率 > 80%，提升权重
  6. 权重归一化，确保总和 = 1.0
  7. 保存新权重到数据库
  ```

#### 6.3 Automated Backtesting
- **File:** `ai-engine/src/auto-backtest.ts`
- **Schedule:** 每日凌晨运行
- **Reference:** `hummingbot/strategy_v2/backtesting/backtesting_engine_base.py`
- **Logic:**
  ```
  1. 获取过去 30 天的历史数据
  2. 用当前模型权重 + 策略参数回测
  3. 计算: Sharpe Ratio, Max Drawdown, Win Rate, Profit Factor
  4. 与上次回测结果对比
  5. 如果表现下降 > 10%, 触发策略审查告警
  6. 生成回测报告存入数据库
  ```

#### 6.4 Strategy Auto-Tuning
- **File:** `ai-engine/src/strategy-tuner.ts`
- **Tunable Parameters:**
  ```
  - min_confidence threshold
  - stop_loss / take_profit ratios
  - position_size per confidence level
  - cooldown periods
  - max concurrent positions
  ```
- **Method:** Grid search on backtest results → 选择最优参数组合

### Hummingbot Reference
- **Backtesting Engine:**
  - `hummingbot/strategy_v2/backtesting/backtesting_engine_base.py`
  - `run_backtesting(config, start, end, resolution, trade_cost)`
- **Executor Simulators:**
  - `hummingbot/strategy_v2/backtesting/executors_simulator/`
  - 模拟 PositionExecutor / DCAExecutor 的三重屏障逻辑
- **Performance Metrics:**
  - `hummingbot/strategy_v2/models/executors_info.py`
  - `PerformanceReport` with PnL, drawdown, volume, close_type_counts

---

## Project File Structure

```
ai-engine/
├── TECHNICAL_PLAN.md              ← This document
├── README.md                      ← Quick start guide
├── package.json                   ← Node.js dependencies
│
├── src/                           ← Core AI engine (TypeScript)
│   ├── vector-store.ts            ← Vector memory (Pinecone/pgvector)
│   ├── indicators.ts              ← Technical indicator calculations
│   ├── onchain-data.ts            ← On-chain data feeds
│   ├── rag-predictor.ts           ← RAG-enhanced prediction pipeline
│   ├── model-weights.ts           ← Dynamic model weighting
│   ├── signal-filter.ts           ← Confidence threshold filtering
│   ├── strategy-selector.ts       ← Auto strategy selection
│   ├── signal-publisher.ts        ← Trade signal MQTT/WS publisher
│   ├── execution-manager.ts       ← Execution mode management
│   ├── api-key-vault.ts           ← Encrypted API key storage
│   ├── trade-recorder.ts          ← Trade result → vector DB
│   ├── weight-adjuster.ts         ← Auto model weight tuning
│   ├── auto-backtest.ts           ← Automated backtesting
│   └── strategy-tuner.ts          ← Parameter optimization
│
├── hummingbot/                    ← Hummingbot integration (Python)
│   ├── controllers/
│   │   └── coinmax_ai_controller.py  ← Custom AI signal controller
│   ├── scripts/
│   │   └── coinmax_ai_trading.py     ← Main trading script
│   └── configs/
│       └── coinmax_ai.yml            ← Controller configuration
│
├── supabase/                      ← Edge functions for this module
│   ├── ai-prediction-tracker/
│   ├── resolve-predictions/
│   └── trading-ws/
│
└── tests/
    ├── backtest/                  ← Backtest scripts and results
    └── unit/                      ← Unit tests
```

---

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| AI Models | OpenAI GPT-4o, Cloudflare Workers AI (Llama, DeepSeek) | Multi-model prediction |
| Vector DB | Pinecone or Supabase pgvector | Embedding storage + similarity search |
| Embeddings | OpenAI text-embedding-3-small | Market state vectorization |
| Backend | Supabase Edge Functions (Deno) | API + Cron jobs |
| Database | Supabase PostgreSQL | Prediction records, trade history |
| Execution | Hummingbot (Python) | Order execution + position management |
| Messaging | MQTT (via commlib) or WebSocket | Signal delivery |
| Frontend | React + Vite (existing) | User interface |
| Exchange | Binance Perpetual, Bybit Perpetual | Trading venues |

---

## Dependencies on Hummingbot

| What We Use | Hummingbot Source | How |
|-------------|-------------------|-----|
| Position Management | `strategy_v2/executors/position_executor/` | Direct use — triple barrier SL/TP/trailing |
| DCA Execution | `strategy_v2/executors/dca_executor/` | Direct use — multi-level entry |
| Executor Orchestration | `strategy_v2/executors/executor_orchestrator.py` | Direct use — lifecycle management |
| Signal Controller Pattern | `controllers/directional_trading/ai_livestream.py` | Template — MQTT signal → executor |
| Binance Connector | `connector/exchange/binance/` | Direct use — order placement |
| Bybit Connector | `connector/exchange/bybit/` | Direct use — order placement |
| Perpetual Trading | `connector/perpetual_trading.py` | Direct use — leverage, funding |
| Market Data | `data_feed/market_data_provider.py` | Reference — data pipeline design |
| Backtesting | `strategy_v2/backtesting/` | Direct use — historical validation |
| Trailing Indicators | `strategy/__utils__/trailing_indicators/` | Reference — indicator architecture |
| Strategy V2 Base | `strategy/strategy_v2_base.py` | Extend — main entry point |
| Performance Report | `strategy_v2/models/executors_info.py` | Direct use — PnL calculation |

---

## Risk Considerations

1. **API Key Security** — 加密存储 + 仅 trade 权限 + 定期轮换
2. **Max Drawdown** — 全局 + 每个 controller 独立回撤限制
3. **Signal Latency** — MQTT < 100ms, 超时自动跳过
4. **Exchange Rate Limits** — 遵循 Binance/Bybit rate limit
5. **Paper Trading First** — Phase 4 先 paper trade 验证 30 天
6. **Kill Switch** — 全局紧急停止按钮 (admin + user)
7. **Position Size Limit** — 单笔不超过总资金的 5%
8. **Slippage Protection** — 大单使用 TWAP 分拆

---

## Success Metrics

| Phase | KPI | Target |
|-------|-----|--------|
| Phase 1 | Prediction tracking coverage | 100% of predictions recorded |
| Phase 2 | Data sources per prediction | >= 8 features |
| Phase 3 | Model accuracy improvement | +15% vs baseline |
| Phase 4 | Paper trading Sharpe Ratio | > 1.5 |
| Phase 5 | User activation rate | > 30% of subscribers |
| Phase 6 | Live trading monthly return | > 10% with < 5% max DD |
