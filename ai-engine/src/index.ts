/**
 * CoinMax AI Trading Engine
 *
 * Module Index — each file is implemented per the phases in TECHNICAL_PLAN.md
 *
 * Phase 1:
 *   vector-store.ts      — Vector memory (Pinecone/pgvector) for market state embeddings
 *
 * Phase 2:
 *   indicators.ts        — Technical indicator calculations (RSI, MACD, BB, etc.)
 *   onchain-data.ts      — On-chain data feeds (funding rate, OI, whale flow)
 *
 * Phase 3:
 *   rag-predictor.ts     — RAG-enhanced multi-model prediction pipeline
 *   model-weights.ts     — Dynamic model weighting based on historical accuracy
 *   signal-filter.ts     — Confidence threshold filtering
 *   strategy-selector.ts — Auto strategy selection based on market regime
 *
 * Phase 4:
 *   signal-publisher.ts  — Trade signal MQTT/WebSocket publisher
 *   execution-manager.ts — Execution mode management (paper/signal/auto)
 *   api-key-vault.ts     — Encrypted exchange API key storage
 *
 * Phase 6:
 *   trade-recorder.ts    — Trade result recording → vector DB
 *   weight-adjuster.ts   — Automated model weight tuning
 *   auto-backtest.ts     — Automated backtesting pipeline
 *   strategy-tuner.ts    — Parameter optimization via grid search
 */

export const AI_ENGINE_VERSION = "0.1.0";
