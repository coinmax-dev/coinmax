# CoinMax AI Trading Engine

AI-powered copy trading system combining multi-model consensus, vector memory (RAG), and Hummingbot execution.

## Architecture

```
AI Brain (5 Models) → Vector Memory (RAG) → Strategy Decision → Hummingbot Execution → Learning Loop
```

## Quick Reference

- **Technical Plan:** `TECHNICAL_PLAN.md`
- **Hummingbot Codebase:** `/Users/macbookpro/WebstormProjects/hummingbot/`
- **Current AI Functions:** `/supabase/functions/ai-forecast-multi/`

## Phase Status

- [ ] Phase 1: Vector Memory + Prediction Tracking
- [ ] Phase 2: Enhanced Data Sources + Technical Analysis
- [ ] Phase 3: Weighted Consensus + RAG-Enhanced Prediction
- [ ] Phase 4: Execution Engine (Hummingbot Integration)
- [ ] Phase 5: User Copy Trading Frontend
- [ ] Phase 6: Learning Feedback Loop + Auto Backtest

## Key Hummingbot Files to Reference

| Component | Path |
|-----------|------|
| AI Signal Controller | `hummingbot/controllers/directional_trading/ai_livestream.py` |
| Position Executor | `hummingbot/strategy_v2/executors/position_executor/` |
| DCA Executor | `hummingbot/strategy_v2/executors/dca_executor/` |
| Executor Orchestrator | `hummingbot/strategy_v2/executors/executor_orchestrator.py` |
| Directional Controller Base | `hummingbot/strategy_v2/controllers/directional_trading_controller_base.py` |
| Strategy V2 Base | `hummingbot/strategy/strategy_v2_base.py` |
| Market Data Provider | `hummingbot/data_feed/market_data_provider.py` |
| Backtesting Engine | `hummingbot/strategy_v2/backtesting/backtesting_engine_base.py` |
| Binance Connector | `hummingbot/connector/exchange/binance/binance_exchange.py` |
| MQTT Interface | `hummingbot/remote_iface/mqtt.py` |
