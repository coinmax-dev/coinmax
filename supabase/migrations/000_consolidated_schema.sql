-- ═══════════════════════════════════════════════════════════════
-- CoinMax 2.0 Consolidated Schema
-- Clean, unified UUID types, no seed data
-- ═══════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════
-- 1. Extensions
-- ══════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ══════════════════════════════════════════════════════════════
-- 2. Core Tables
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT UNIQUE NOT NULL,
  ref_code TEXT UNIQUE DEFAULT substr(md5(random()::text), 1, 8),
  referrer_id UUID REFERENCES profiles(id),
  rank TEXT,
  node_type TEXT DEFAULT 'NONE',
  is_vip BOOLEAN DEFAULT FALSE,
  vip_expires_at TIMESTAMPTZ,
  total_deposited NUMERIC DEFAULT 0,
  total_withdrawn NUMERIC DEFAULT 0,
  referral_earnings NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_wallet ON profiles(wallet_address);
CREATE INDEX IF NOT EXISTS idx_profiles_referrer ON profiles(referrer_id);
CREATE INDEX IF NOT EXISTS idx_profiles_ref_code ON profiles(ref_code);

CREATE TABLE IF NOT EXISTS vault_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  plan_type TEXT NOT NULL,
  principal NUMERIC NOT NULL,
  daily_rate NUMERIC NOT NULL,
  start_date TIMESTAMPTZ DEFAULT NOW(),
  end_date TIMESTAMPTZ,
  status TEXT DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_positions_user ON vault_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_vault_positions_status ON vault_positions(status);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  type TEXT NOT NULL,
  token TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  tx_hash TEXT,
  status TEXT DEFAULT 'PENDING',
  details JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);

CREATE TABLE IF NOT EXISTS trade_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  asset TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  duration TEXT DEFAULT '1min',
  entry_price NUMERIC,
  exit_price NUMERIC,
  result TEXT,
  pnl NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_bets_user ON trade_bets(user_id);

CREATE TABLE IF NOT EXISTS strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'ACTIVE',
  total_aum NUMERIC DEFAULT 0,
  win_rate NUMERIC DEFAULT 0,
  monthly_return NUMERIC DEFAULT 0,
  is_vip_only BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strategy_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  strategy_id UUID NOT NULL REFERENCES strategies(id),
  allocated_capital NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hedge_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  amount NUMERIC NOT NULL,
  purchase_amount NUMERIC DEFAULT 0,
  current_pnl NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS insurance_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  amount NUMERIC NOT NULL,
  status TEXT DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prediction_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  market_id TEXT NOT NULL,
  market_type TEXT NOT NULL,
  question TEXT,
  choice TEXT,
  odds NUMERIC,
  amount NUMERIC NOT NULL,
  potential_payout NUMERIC,
  status TEXT DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'support',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════
-- 3. Node System Tables
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS node_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  node_type TEXT NOT NULL,
  price NUMERIC NOT NULL,
  status TEXT DEFAULT 'PENDING_MILESTONES',
  start_date TIMESTAMPTZ DEFAULT NOW(),
  end_date TIMESTAMPTZ,
  -- From migration 005
  payment_mode TEXT DEFAULT 'FULL',
  deposit_amount NUMERIC DEFAULT 0,
  milestone_stage INT DEFAULT 0,
  total_milestones INT DEFAULT 0,
  earnings_capacity NUMERIC DEFAULT 0.0,
  -- From migration 007
  contribution_amount NUMERIC DEFAULT 0,
  frozen_amount NUMERIC DEFAULT 0,
  daily_rate NUMERIC DEFAULT 0,
  locked_earnings NUMERIC DEFAULT 0,
  released_earnings NUMERIC DEFAULT 0,
  available_balance NUMERIC DEFAULT 0,
  -- From migration 017
  duration_days INT,
  tx_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_node_memberships_user ON node_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_node_memberships_status ON node_memberships(status);

CREATE TABLE IF NOT EXISTS node_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id UUID REFERENCES node_memberships(id) ON DELETE CASCADE,
  milestone_index INT NOT NULL,
  required_rank TEXT NOT NULL,
  deadline_days INT NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL,
  achieved_at TIMESTAMPTZ,
  status TEXT DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_node_milestones_membership ON node_milestones(membership_id);
CREATE INDEX IF NOT EXISTS idx_node_milestones_status ON node_milestones(status);

CREATE TABLE IF NOT EXISTS node_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  reward_type TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_node_rewards_user ON node_rewards(user_id);

CREATE TABLE IF NOT EXISTS node_auth_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  node_type TEXT NOT NULL DEFAULT 'MAX',
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'USED', 'INACTIVE')),
  max_uses INT DEFAULT 1,
  used_count INT DEFAULT 0,
  used_by TEXT,
  used_at TIMESTAMPTZ,
  created_by TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_codes_code ON node_auth_codes(code);
CREATE INDEX IF NOT EXISTS idx_auth_codes_status ON node_auth_codes(status);

-- ══════════════════════════════════════════════════════════════
-- 4. Vault & Revenue Tables
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS revenue_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS revenue_pools (
  pool_name TEXT PRIMARY KEY,
  balance NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vault_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  position_id UUID NOT NULL REFERENCES vault_positions(id),
  reward_type TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  ar_price NUMERIC,
  ar_amount NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_rewards_user ON vault_rewards(user_id);

CREATE TABLE IF NOT EXISTS earnings_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  source_type TEXT NOT NULL,
  gross_amount NUMERIC NOT NULL DEFAULT 0,
  burn_rate NUMERIC NOT NULL DEFAULT 0,
  burn_amount NUMERIC NOT NULL DEFAULT 0,
  net_amount NUMERIC NOT NULL DEFAULT 0,
  release_days INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  release_start TIMESTAMP NOT NULL DEFAULT NOW(),
  release_end TIMESTAMP NOT NULL DEFAULT NOW(),
  released_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════
-- 5. AI & Trading Tables
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ai_prediction_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  model TEXT NOT NULL,
  prediction TEXT NOT NULL CHECK (prediction IN ('BULLISH', 'BEARISH', 'NEUTRAL')),
  confidence INT NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  target_price NUMERIC NOT NULL,
  current_price NUMERIC NOT NULL,
  reasoning TEXT,
  fear_greed_index INT,
  rsi_14 NUMERIC,
  macd_signal TEXT,
  bb_position NUMERIC,
  funding_rate NUMERIC,
  long_short_ratio NUMERIC,
  candle_patterns TEXT,
  actual_price NUMERIC,
  actual_direction TEXT CHECK (actual_direction IN ('BULLISH', 'BEARISH')),
  actual_change_pct NUMERIC,
  direction_correct BOOLEAN,
  price_error_pct NUMERIC,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved'))
);

CREATE INDEX IF NOT EXISTS idx_predictions_pending ON ai_prediction_records (status, expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_predictions_model_asset ON ai_prediction_records (model, asset, timeframe);
CREATE INDEX IF NOT EXISTS idx_predictions_created ON ai_prediction_records (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_embedding ON ai_prediction_records USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE TABLE IF NOT EXISTS ai_model_accuracy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model TEXT NOT NULL,
  asset TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT '30d',
  total_predictions INT NOT NULL DEFAULT 0,
  correct_predictions INT NOT NULL DEFAULT 0,
  accuracy_pct NUMERIC NOT NULL DEFAULT 0,
  avg_confidence NUMERIC NOT NULL DEFAULT 0,
  avg_price_error_pct NUMERIC NOT NULL DEFAULT 0,
  computed_weight NUMERIC DEFAULT 1.0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (model, asset, timeframe, period)
);

CREATE INDEX IF NOT EXISTS idx_accuracy_model ON ai_model_accuracy (model, asset);

CREATE TABLE IF NOT EXISTS trade_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('OPEN_LONG', 'OPEN_SHORT', 'CLOSE', 'HOLD')),
  direction TEXT CHECK (direction IN ('LONG', 'SHORT', 'NEUTRAL')),
  probabilities JSONB,
  target_pct NUMERIC,
  confidence INT NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  stop_loss_pct NUMERIC,
  take_profit_pct NUMERIC,
  leverage INT DEFAULT 1,
  position_size_pct NUMERIC,
  strategy_type TEXT,
  strength TEXT CHECK (strength IN ('STRONG', 'MEDIUM', 'WEAK', 'NONE')),
  source_models TEXT[],
  rag_context TEXT,
  provider_id UUID,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'executed', 'expired', 'cancelled')),
  result_pnl NUMERIC,
  close_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_signals_status ON trade_signals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_asset ON trade_signals (asset, created_at DESC);

CREATE TABLE IF NOT EXISTS paper_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID REFERENCES trade_signals(id),
  user_id UUID,
  asset TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('LONG', 'SHORT')),
  entry_price NUMERIC NOT NULL,
  exit_price NUMERIC,
  size NUMERIC NOT NULL,
  leverage INT DEFAULT 1,
  stop_loss NUMERIC,
  take_profit NUMERIC,
  pnl NUMERIC,
  pnl_pct NUMERIC,
  strategy_type TEXT,
  close_reason TEXT CHECK (close_reason IN ('STOP_LOSS', 'TAKE_PROFIT', 'TIME_LIMIT', 'MANUAL', 'TRAILING_STOP', 'LIQUIDATION')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_paper_status ON paper_trades (status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_user ON paper_trades (user_id, status);
CREATE INDEX IF NOT EXISTS idx_paper_trades_strategy ON paper_trades(strategy_type, status);

CREATE TABLE IF NOT EXISTS user_exchange_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  exchange TEXT NOT NULL CHECK (exchange IN ('binance', 'bybit', 'okx', 'bitget', 'hyperliquid', 'dydx')),
  encrypted_data JSONB NOT NULL,
  masked_key TEXT NOT NULL,
  label TEXT DEFAULT '',
  testnet BOOLEAN DEFAULT FALSE,
  is_valid BOOLEAN DEFAULT TRUE,
  last_validated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, exchange)
);

CREATE INDEX IF NOT EXISTS idx_keys_user ON user_exchange_keys (user_id);

-- ══════════════════════════════════════════════════════════════
-- 6. Strategy Provider Tables
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS strategy_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  contact_email TEXT NOT NULL,
  description TEXT DEFAULT '',
  website TEXT DEFAULT '',
  api_key TEXT UNIQUE NOT NULL,
  api_key_prefix TEXT NOT NULL,
  allowed_assets TEXT[] DEFAULT '{BTC,ETH,SOL,BNB}',
  max_leverage INT DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'suspended', 'rejected')),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  total_signals INT DEFAULT 0,
  win_count INT DEFAULT 0,
  loss_count INT DEFAULT 0,
  total_pnl NUMERIC DEFAULT 0,
  avg_confidence NUMERIC DEFAULT 0,
  last_signal_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_providers_status ON strategy_providers(status);
CREATE INDEX IF NOT EXISTS idx_providers_api_key ON strategy_providers(api_key);
CREATE INDEX IF NOT EXISTS idx_providers_slug ON strategy_providers(slug);

-- Add FK for trade_signals.provider_id
ALTER TABLE trade_signals ADD CONSTRAINT fk_signals_provider FOREIGN KEY (provider_id) REFERENCES strategy_providers(id);
CREATE INDEX IF NOT EXISTS idx_signals_provider ON trade_signals(provider_id, created_at DESC);

-- ══════════════════════════════════════════════════════════════
-- 7. Copy Trading & Feedback Loop Tables
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_risk_config (
  user_id UUID PRIMARY KEY,
  max_position_size_usd NUMERIC DEFAULT 1000,
  max_concurrent_positions INT DEFAULT 3,
  max_daily_loss_usd NUMERIC DEFAULT 200,
  max_drawdown_pct NUMERIC DEFAULT 10,
  max_leverage INT DEFAULT 5,
  allowed_assets TEXT[] DEFAULT ARRAY['BTC','ETH','SOL','BNB'],
  copy_enabled BOOLEAN DEFAULT FALSE,
  execution_mode TEXT DEFAULT 'PAPER' CHECK (execution_mode IN ('PAPER','SIGNAL','SEMI_AUTO','FULL_AUTO')),
  trading_hours_enabled BOOLEAN DEFAULT FALSE,
  trading_hours_start INT DEFAULT 8,
  trading_hours_end INT DEFAULT 22,
  cooldown_minutes INT DEFAULT 1,
  min_signal_strength TEXT DEFAULT 'MEDIUM' CHECK (min_signal_strength IN ('STRONG','MEDIUM','WEAK')),
  kill_switch BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trade_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID REFERENCES trade_signals(id),
  asset TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_price NUMERIC NOT NULL,
  exit_price NUMERIC NOT NULL,
  size NUMERIC,
  leverage INT DEFAULT 1,
  pnl_usd NUMERIC NOT NULL,
  pnl_pct NUMERIC NOT NULL,
  close_reason TEXT NOT NULL,
  duration_seconds INT,
  strategy_type TEXT,
  contributing_models TEXT[],
  is_win BOOLEAN NOT NULL,
  fees NUMERIC DEFAULT 0,
  exchange TEXT,
  entry_state JSONB,
  exit_state JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_results_asset ON trade_results(asset);
CREATE INDEX IF NOT EXISTS idx_trade_results_created ON trade_results(created_at);
CREATE INDEX IF NOT EXISTS idx_trade_results_strategy ON trade_results(strategy_type);

CREATE TABLE IF NOT EXISTS weight_adjustment_log (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  models_adjusted INT,
  assets_covered TEXT[],
  total_predictions INT,
  overall_accuracy NUMERIC,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS backtest_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config JSONB NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  total_trades INT,
  winning_trades INT,
  losing_trades INT,
  win_rate NUMERIC,
  total_pnl_usd NUMERIC,
  total_pnl_pct NUMERIC,
  avg_pnl_per_trade NUMERIC,
  best_trade NUMERIC,
  worst_trade NUMERIC,
  sharpe_ratio NUMERIC,
  max_drawdown_pct NUMERIC,
  max_drawdown_usd NUMERIC,
  profit_factor NUMERIC,
  calmar_ratio NUMERIC,
  avg_trade_duration INT,
  by_asset JSONB,
  by_strategy JSONB,
  by_close_reason JSONB,
  previous_report_id UUID,
  performance_change NUMERIC,
  alert TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backtest_reports_completed ON backtest_reports(completed_at DESC);

CREATE TABLE IF NOT EXISTS tuning_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  total_combinations INT,
  combinations_run INT,
  best_params JSONB,
  best_sharpe NUMERIC,
  best_pnl_pct NUMERIC,
  best_win_rate NUMERIC,
  top_results JSONB,
  current_params JSONB,
  improvement JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS active_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════
-- 8. Treasury Tables
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS treasury_yields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  epoch INT NOT NULL DEFAULT 0,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  starting_capital NUMERIC NOT NULL DEFAULT 0,
  ending_capital NUMERIC NOT NULL DEFAULT 0,
  gross_yield NUMERIC NOT NULL DEFAULT 0,
  protocol_fee NUMERIC NOT NULL DEFAULT 0,
  net_yield NUMERIC NOT NULL DEFAULT 0,
  apr NUMERIC NOT NULL DEFAULT 0,
  trades_executed INT NOT NULL DEFAULT 0,
  win_rate NUMERIC NOT NULL DEFAULT 0,
  distributed BOOLEAN NOT NULL DEFAULT FALSE,
  user_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS revenue_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  yield_id UUID NOT NULL REFERENCES treasury_yields(id),
  contribution_type TEXT NOT NULL CHECK (contribution_type IN ('NODE', 'VAULT')),
  principal NUMERIC NOT NULL DEFAULT 0,
  weight NUMERIC NOT NULL DEFAULT 0,
  share_pct NUMERIC NOT NULL DEFAULT 0,
  amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'CLAIMABLE' CHECK (status IN ('CLAIMABLE', 'CLAIMED', 'EXPIRED')),
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revenue_claims_user ON revenue_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_revenue_claims_yield ON revenue_claims(yield_id);
CREATE INDEX IF NOT EXISTS idx_revenue_claims_status ON revenue_claims(status);

CREATE TABLE IF NOT EXISTS treasury_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_treasury_events_type ON treasury_events(event_type);

CREATE TABLE IF NOT EXISTS treasury_state (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  total_deployed NUMERIC NOT NULL DEFAULT 0,
  available_balance NUMERIC NOT NULL DEFAULT 0,
  total_unrealized_pnl NUMERIC NOT NULL DEFAULT 0,
  total_realized_pnl NUMERIC NOT NULL DEFAULT 0,
  utilization NUMERIC NOT NULL DEFAULT 0,
  peak_value NUMERIC NOT NULL DEFAULT 0,
  current_drawdown NUMERIC NOT NULL DEFAULT 0,
  kill_switch BOOLEAN NOT NULL DEFAULT FALSE,
  active_positions JSONB DEFAULT '[]',
  strategy_config JSONB DEFAULT '{}',
  allocation_strategy JSONB DEFAULT '{"strategy": 7000, "operations": 2000, "reserve": 1000}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO treasury_state (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS vault_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  deposit_amount NUMERIC NOT NULL,
  interest_rate NUMERIC NOT NULL DEFAULT 0,
  plan_index INT NOT NULL DEFAULT 0,
  deposit_date TIMESTAMPTZ DEFAULT NOW(),
  maturity_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'MATURED', 'CLAIMED')),
  tx_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_deposits_user ON vault_deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_vault_deposits_status ON vault_deposits(status);

-- ══════════════════════════════════════════════════════════════
-- 9. Admin & Operations Tables
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS operation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_username TEXT NOT NULL,
  admin_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_logs_created ON operation_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operation_logs_action ON operation_logs(action);

CREATE TABLE IF NOT EXISTS contract_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fund_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  tx_hash TEXT,
  fund_manager TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fund_distributions_created ON fund_distributions(created_at DESC);

-- ══════════════════════════════════════════════════════════════
-- 10. AI Training & Snapshots
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS accuracy_daily_snapshots (
  id BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  model TEXT NOT NULL,
  asset TEXT NOT NULL,
  timeframe TEXT NOT NULL DEFAULT '1H',
  accuracy_pct NUMERIC NOT NULL DEFAULT 0,
  total_predictions INT NOT NULL DEFAULT 0,
  correct_predictions INT NOT NULL DEFAULT 0,
  avg_confidence NUMERIC NOT NULL DEFAULT 0,
  computed_weight NUMERIC NOT NULL DEFAULT 1.0,
  avg_price_error_pct NUMERIC NOT NULL DEFAULT 0,
  UNIQUE (snapshot_date, model, asset, timeframe),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_date ON accuracy_daily_snapshots(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_model ON accuracy_daily_snapshots(model, asset, snapshot_date DESC);

CREATE TABLE IF NOT EXISTS ai_training_reports (
  id BIGSERIAL PRIMARY KEY,
  report_date DATE NOT NULL,
  report_type TEXT NOT NULL DEFAULT 'hourly',
  total_predictions INT NOT NULL DEFAULT 0,
  overall_accuracy NUMERIC NOT NULL DEFAULT 0,
  model_performance JSONB DEFAULT '[]',
  asset_performance JSONB DEFAULT '[]',
  timeframe_performance JSONB DEFAULT '[]',
  bias_alerts JSONB DEFAULT '[]',
  degradation_alerts JSONB DEFAULT '[]',
  trade_attribution JSONB DEFAULT '[]',
  recommendations JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_reports_date ON ai_training_reports(report_date DESC);

-- ══════════════════════════════════════════════════════════════
-- 11. Simulation Config
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS simulation_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  position_size_usd NUMERIC NOT NULL DEFAULT 1000,
  max_positions INT NOT NULL DEFAULT 15,
  max_leverage INT NOT NULL DEFAULT 5,
  max_drawdown_pct NUMERIC NOT NULL DEFAULT 10,
  cooldown_min INT NOT NULL DEFAULT 5,
  enabled_strategies TEXT[] NOT NULL DEFAULT ARRAY['trend_following','mean_reversion','breakout','scalping','momentum','swing'],
  enabled_assets TEXT[] NOT NULL DEFAULT ARRAY['BTC','ETH','SOL','BNB','DOGE','XRP'],
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO simulation_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- 12. System Config Values (required for functions)
-- ══════════════════════════════════════════════════════════════

INSERT INTO system_config (key, value) VALUES
  ('NODE_MAX_DURATION_DAYS', '120'),
  ('NODE_MAX_FIXED_RETURN', '0.10'),
  ('NODE_MINI_DURATION_DAYS', '90'),
  ('NODE_MINI_FIXED_RETURN', '0.10'),
  ('NODE_MAX_WEIGHT_MULTIPLIER', '1.5'),
  ('NODE_MINI_WEIGHT_MULTIPLIER', '1.0'),
  ('NODE_EARLY_EXIT_PENALTY', '0.10'),
  ('NODE_DIVIDEND_USER_KEEP', '0.90'),
  ('NODE_DIVIDEND_TEAM_POOL', '0.10'),
  ('REVENUE_NODE_POOL_SHARE', '0.50'),
  ('REVENUE_BUYBACK_SHARE', '0.20'),
  ('REVENUE_INSURANCE_SHARE', '0.10'),
  ('REVENUE_TREASURY_SHARE', '0.10'),
  ('REVENUE_OPERATIONS_SHARE', '0.10'),
  ('VAULT_PLATFORM_FEE', '0.10'),
  ('VAULT_EARLY_EXIT_PENALTY', '0.10'),
  ('VAULT_MIN_AMOUNT', '50'),
  ('DIRECT_REFERRAL_RATE', '0.10'),
  ('TEAM_MAX_DEPTH', '15'),
  ('NODE_SYSTEM_ACTIVE', 'false'),
  ('MA_TOKEN_PRICE', '0.10'),
  ('NODE_MAX_CONTRIBUTION', '600'),
  ('NODE_MAX_FROZEN', '6000'),
  ('NODE_MAX_DAILY_RATE', '0.009'),
  ('NODE_MINI_CONTRIBUTION', '100'),
  ('NODE_MINI_FROZEN', '1000'),
  ('NODE_MINI_DAILY_RATE', '0.009'),
  ('EARLY_BIRD_DEPOSIT_RATE', '0.10')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

INSERT INTO system_config (key, value) VALUES
  ('RANKS', '[
    {"level":"V1","commission":0.05},
    {"level":"V2","commission":0.10},
    {"level":"V3","commission":0.15},
    {"level":"V4","commission":0.20},
    {"level":"V5","commission":0.25},
    {"level":"V6","commission":0.30},
    {"level":"V7","commission":0.50}
  ]'),
  ('RANK_CONDITIONS', '[
    {"level":"V1","personalHolding":100,"directReferrals":1,"teamPerformance":5000},
    {"level":"V2","personalHolding":300,"requiredSubRanks":2,"subRankLevel":"V1","teamPerformance":20000},
    {"level":"V3","personalHolding":500,"requiredSubRanks":2,"subRankLevel":"V2","teamPerformance":50000},
    {"level":"V4","personalHolding":1000,"requiredSubRanks":2,"subRankLevel":"V3","teamPerformance":100000},
    {"level":"V5","personalHolding":3000,"requiredSubRanks":2,"subRankLevel":"V4","teamPerformance":500000},
    {"level":"V6","personalHolding":5000,"requiredSubRanks":2,"subRankLevel":"V5","teamPerformance":1000000},
    {"level":"V7","personalHolding":10000,"requiredSubRanks":2,"subRankLevel":"V6","teamPerformance":3000000}
  ]'),
  ('MINI_MILESTONES', '[
    {"rank":"V2","days":15,"unlocks":"earnings","desc":"Unlock daily 0.5% earnings"},
    {"rank":"V4","days":90,"unlocks":"earnings_and_package","desc":"Withdraw 1000 USDC equivalent MA"}
  ]'),
  ('MAX_MILESTONES', '[
    {"rank":"V1","days":15,"unlocks":"none","desc":"Reach V1"},
    {"rank":"V2","days":30,"unlocks":"earnings","desc":"100U holding + 3 small node referrals"},
    {"rank":"V3","days":45,"unlocks":"earnings","desc":"500U holding / 45 days"},
    {"rank":"V4","days":60,"unlocks":"earnings","desc":"500U holding / 45 days"},
    {"rank":"V5","days":90,"unlocks":"earnings","desc":"500U holding / 45 days"},
    {"rank":"V6","days":120,"unlocks":"earnings_and_package","desc":"1000U holding / 45 days, unlock all"}
  ]')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

INSERT INTO revenue_pools (pool_name, balance) VALUES
  ('NODE_POOL', 0), ('BUYBACK_POOL', 0), ('INSURANCE_POOL', 0),
  ('TREASURY_POOL', 0), ('OPERATIONS', 0)
ON CONFLICT (pool_name) DO NOTHING;

INSERT INTO contract_configs (key, value, description) VALUES
  ('USDT_ADDRESS', '0x55d398326f99059fF775485246999027B3197955', 'USDT contract (BSC)'),
  ('VAULT_CONTRACT', '', 'Vault contract'),
  ('NODE_CONTRACT', '', 'Node contract'),
  ('VIP_CONTRACT', '', 'VIP contract'),
  ('VIP_RECEIVER', '', 'VIP receiver address'),
  ('CHAIN_ID', '56', 'Chain ID (56=BSC)'),
  ('USDT_DECIMALS', '18', 'USDT decimals')
ON CONFLICT (key) DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- 13. RLS Policies
-- ══════════════════════════════════════════════════════════════

ALTER TABLE ai_prediction_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_model_accuracy ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_exchange_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_risk_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuning_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_auth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE accuracy_daily_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_training_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulation_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_yields ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_deposits ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "service_all_predictions" ON ai_prediction_records FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_all_accuracy" ON ai_model_accuracy FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_all_signals" ON trade_signals FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_all_paper" ON paper_trades FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_all_keys" ON user_exchange_keys FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_all_providers" ON strategy_providers FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_all_risk_config" ON user_risk_config FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_all_exchange_keys" ON user_exchange_keys FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_all_paper_trades" ON paper_trades FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_all_trade_results" ON trade_results FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- Authenticated read policies
CREATE POLICY "users_read_predictions" ON ai_prediction_records FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "users_read_accuracy" ON ai_model_accuracy FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "users_read_signals" ON trade_signals FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "users_read_approved_providers" ON strategy_providers FOR SELECT USING (auth.role() = 'authenticated' AND status = 'approved');
CREATE POLICY "users_own_paper" ON paper_trades FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users_own_keys" ON user_exchange_keys FOR ALL USING (auth.uid() = user_id);

-- Anon access policies (for admin panel)
CREATE POLICY "anon_read_all_providers" ON strategy_providers FOR SELECT USING (true);
CREATE POLICY "anon_update_providers" ON strategy_providers FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "anon_read_all_signals" ON trade_signals FOR SELECT USING (true);
CREATE POLICY "anon_all_paper_trades" ON paper_trades FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_write_signals" ON trade_signals FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_update_signals" ON trade_signals FOR UPDATE USING (true) WITH CHECK (true);

-- Auth codes
CREATE POLICY "auth_codes_full_access" ON node_auth_codes FOR ALL USING (true) WITH CHECK (true);

-- Snapshots & training
CREATE POLICY "anon_read_snapshots" ON accuracy_daily_snapshots FOR SELECT USING (true);
CREATE POLICY "service_all_snapshots" ON accuracy_daily_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_read_training" ON ai_training_reports FOR SELECT USING (true);
CREATE POLICY "service_all_training" ON ai_training_reports FOR ALL USING (true) WITH CHECK (true);

-- Simulation config
CREATE POLICY "service_all_sim_config" ON simulation_config FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "anon_read_sim_config" ON simulation_config FOR SELECT USING (true);
CREATE POLICY "anon_update_sim_config" ON simulation_config FOR UPDATE USING (true);

-- Backtest & tuning
CREATE POLICY "read_backtest_reports" ON backtest_reports FOR SELECT USING (TRUE);
CREATE POLICY "service_write_backtest" ON backtest_reports FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "read_tuning_results" ON tuning_results FOR SELECT USING (TRUE);
CREATE POLICY "service_write_tuning" ON tuning_results FOR INSERT WITH CHECK (TRUE);

-- Treasury
CREATE POLICY "anyone_read_yields" ON treasury_yields FOR SELECT USING (true);
CREATE POLICY "users_read_own_claims" ON revenue_claims FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "admin_only_events" ON treasury_events FOR ALL USING (false);
CREATE POLICY "anyone_read_treasury_state" ON treasury_state FOR SELECT USING (true);
CREATE POLICY "users_read_own_vault_deposits" ON vault_deposits FOR SELECT USING (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════
-- 14. Realtime
-- ══════════════════════════════════════════════════════════════

ALTER PUBLICATION supabase_realtime ADD TABLE trade_signals;

-- ══════════════════════════════════════════════════════════════
-- 15. RPC Functions (final versions)
-- ══════════════════════════════════════════════════════════════

-- auth_wallet: upsert profile, handle referral code
CREATE OR REPLACE FUNCTION auth_wallet(addr TEXT, ref_code TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  result profiles%ROWTYPE;
  referrer_profile profiles%ROWTYPE;
BEGIN
  SELECT * INTO result FROM profiles WHERE wallet_address = addr;

  IF ref_code IS NOT NULL AND ref_code != '' THEN
    SELECT * INTO referrer_profile FROM profiles WHERE profiles.ref_code = auth_wallet.ref_code;
  END IF;

  IF result.id IS NOT NULL THEN
    IF result.referrer_id IS NULL AND referrer_profile.id IS NOT NULL AND referrer_profile.id != result.id THEN
      UPDATE profiles SET referrer_id = referrer_profile.id WHERE id = result.id
      RETURNING * INTO result;
    END IF;
    RETURN to_jsonb(result);
  END IF;

  IF referrer_profile.id IS NULL THEN
    RETURN jsonb_build_object('error', 'REFERRAL_REQUIRED', 'message', 'A valid referral code is required to register');
  END IF;

  INSERT INTO profiles (wallet_address, referrer_id)
  VALUES (addr, referrer_profile.id)
  RETURNING * INTO result;

  RETURN to_jsonb(result);
END;
$$;

-- vault_deposit with auto rank promotion
CREATE OR REPLACE FUNCTION vault_deposit(addr TEXT, plan_type TEXT, deposit_amount NUMERIC, tx_hash TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  plan_days INT;
  plan_rate NUMERIC;
  end_dt TIMESTAMP;
  min_amount NUMERIC;
  pos vault_positions%ROWTYPE;
  tx transactions%ROWTYPE;
  upline_id UUID;
  current_id UUID;
  depth INT := 0;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    INSERT INTO profiles (wallet_address) VALUES (addr) RETURNING * INTO profile_row;
  END IF;

  SELECT value::NUMERIC INTO min_amount FROM system_config WHERE key = 'VAULT_MIN_AMOUNT';
  IF min_amount IS NULL THEN min_amount := 50; END IF;

  IF deposit_amount < min_amount THEN
    RAISE EXCEPTION 'Minimum deposit is % USDC', min_amount;
  END IF;

  IF plan_type = '5_DAYS' THEN plan_days := 5; plan_rate := 0.005;
  ELSIF plan_type = '45_DAYS' THEN plan_days := 45; plan_rate := 0.007;
  ELSIF plan_type = '90_DAYS' THEN plan_days := 90; plan_rate := 0.009;
  ELSIF plan_type = '180_DAYS' THEN plan_days := 180; plan_rate := 0.012;
  ELSIF plan_type = '360_DAYS' THEN plan_days := 360; plan_rate := 0.015;
  ELSE
    RAISE EXCEPTION 'Invalid plan type: %', plan_type;
  END IF;

  end_dt := NOW() + (plan_days || ' days')::INTERVAL;

  INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, end_date, status)
  VALUES (profile_row.id, plan_type, deposit_amount, plan_rate, end_dt, 'ACTIVE')
  RETURNING * INTO pos;

  INSERT INTO transactions (user_id, type, token, amount, tx_hash, status)
  VALUES (profile_row.id, 'DEPOSIT', 'USDC', deposit_amount, tx_hash, 'CONFIRMED')
  RETURNING * INTO tx;

  UPDATE profiles SET total_deposited = COALESCE(total_deposited, 0) + deposit_amount
  WHERE id = profile_row.id;

  PERFORM check_rank_promotion(addr);

  current_id := profile_row.id;
  LOOP
    depth := depth + 1;
    IF depth > 15 THEN EXIT; END IF;
    SELECT referrer_id INTO upline_id FROM profiles WHERE id = current_id;
    IF upline_id IS NULL THEN EXIT; END IF;
    PERFORM check_rank_promotion(
      (SELECT wallet_address FROM profiles WHERE id = upline_id)
    );
    current_id := upline_id;
  END LOOP;

  RETURN jsonb_build_object('position', to_jsonb(pos), 'transaction', to_jsonb(tx));
END;
$$;

-- vault_withdraw
CREATE OR REPLACE FUNCTION vault_withdraw(addr TEXT, pos_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  pos vault_positions%ROWTYPE;
  days_elapsed INT;
  yield_amount NUMERIC;
  total_withdraw NUMERIC;
  is_early BOOLEAN;
  penalty_rate NUMERIC;
  tx transactions%ROWTYPE;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  SELECT * INTO pos FROM vault_positions WHERE id = pos_id::UUID AND user_id = profile_row.id;
  IF pos.id IS NULL THEN
    RAISE EXCEPTION 'Position not found';
  END IF;

  days_elapsed := GREATEST(0, EXTRACT(DAY FROM NOW() - pos.start_date)::INT);
  yield_amount := pos.principal * pos.daily_rate * days_elapsed;
  is_early := pos.end_date IS NOT NULL AND NOW() < pos.end_date;

  IF is_early THEN
    SELECT COALESCE(value::NUMERIC, 0.10) INTO penalty_rate FROM system_config WHERE key = 'VAULT_EARLY_EXIT_PENALTY';
    total_withdraw := pos.principal * (1 - penalty_rate) + yield_amount;
  ELSE
    total_withdraw := pos.principal + yield_amount;
  END IF;

  UPDATE vault_positions SET status = CASE WHEN is_early THEN 'EARLY_EXIT' ELSE 'COMPLETED' END
  WHERE id = pos_id::UUID;

  INSERT INTO transactions (user_id, type, token, amount, status)
  VALUES (profile_row.id, 'WITHDRAW', 'USDC', ROUND(total_withdraw, 6), 'CONFIRMED')
  RETURNING * INTO tx;

  IF yield_amount > 0 THEN
    INSERT INTO transactions (user_id, type, token, amount, status)
    VALUES (profile_row.id, 'YIELD', 'USDC', ROUND(yield_amount, 6), 'CONFIRMED');
  END IF;

  UPDATE profiles SET total_withdrawn = COALESCE(total_withdrawn, 0) + total_withdraw
  WHERE id = profile_row.id;

  RETURN jsonb_build_object(
    'transaction', to_jsonb(tx),
    'yieldAmount', ROUND(yield_amount, 6)::TEXT,
    'totalWithdraw', ROUND(total_withdraw, 6)::TEXT
  );
END;
$$;

-- subscribe_vip
CREATE OR REPLACE FUNCTION subscribe_vip(addr TEXT, tx_hash TEXT DEFAULT NULL, plan_label TEXT DEFAULT 'monthly')
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  vip_price NUMERIC;
  vip_interval INTERVAL;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF plan_label = 'yearly' THEN
    vip_price := 899;
    vip_interval := INTERVAL '1 year';
  ELSE
    vip_price := 69;
    vip_interval := INTERVAL '1 month';
  END IF;

  UPDATE profiles SET is_vip = TRUE, vip_expires_at = NOW() + vip_interval
  WHERE id = profile_row.id
  RETURNING * INTO profile_row;

  INSERT INTO transactions (user_id, type, token, amount, tx_hash, status)
  VALUES (profile_row.id, 'VIP_PURCHASE', 'USDC', vip_price, tx_hash, 'CONFIRMED');

  RETURN to_jsonb(profile_row);
END;
$$;

-- purchase_node (final version from 023)
CREATE OR REPLACE FUNCTION purchase_node(
  addr TEXT,
  node_type_param TEXT,
  tx_hash TEXT DEFAULT NULL,
  payment_mode_param TEXT DEFAULT 'FULL'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  contribution NUMERIC;
  frozen NUMERIC;
  daily_rate_val NUMERIC;
  node_duration INT;
  membership node_memberships%ROWTYPE;
  milestones_json JSONB;
  milestone JSONB;
  m_index INT := 0;
  total_m INT;
  highest_node TEXT;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF node_type_param = 'MAX' THEN
    contribution := 600;
    frozen := 6000;
    daily_rate_val := 0.009;
    node_duration := 120;
    SELECT value::JSONB INTO milestones_json FROM system_config WHERE key = 'MAX_MILESTONES';
  ELSE
    contribution := 100;
    frozen := 1000;
    daily_rate_val := 0.009;
    node_duration := 90;
    SELECT value::JSONB INTO milestones_json FROM system_config WHERE key = 'MINI_MILESTONES';
  END IF;

  total_m := jsonb_array_length(COALESCE(milestones_json, '[]'::JSONB));

  INSERT INTO node_memberships (
    user_id, node_type, price, contribution_amount, frozen_amount, daily_rate,
    status, start_date, end_date,
    payment_mode, deposit_amount, milestone_stage, total_milestones, earnings_capacity,
    locked_earnings, released_earnings, available_balance
  )
  VALUES (
    profile_row.id, node_type_param, contribution + frozen,
    contribution, frozen, daily_rate_val,
    'PENDING_MILESTONES', NOW(), NOW() + (node_duration || ' days')::INTERVAL,
    'FULL', contribution, 0, total_m, 0.0,
    0, 0, 0
  )
  RETURNING * INTO membership;

  IF milestones_json IS NOT NULL THEN
    FOR milestone IN SELECT * FROM jsonb_array_elements(milestones_json)
    LOOP
      INSERT INTO node_milestones (membership_id, milestone_index, required_rank, deadline_days, deadline_at)
      VALUES (
        membership.id, m_index,
        milestone->>'rank',
        (milestone->>'days')::INT,
        NOW() + ((milestone->>'days')::INT || ' days')::INTERVAL
      );
      m_index := m_index + 1;
    END LOOP;
  END IF;

  INSERT INTO transactions (user_id, type, token, amount, tx_hash, status, details)
  VALUES (profile_row.id, 'NODE_PURCHASE', 'USDC', frozen, tx_hash, 'CONFIRMED',
    jsonb_build_object('node_type', node_type_param, 'contribution', contribution, 'frozen', frozen));

  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM node_memberships WHERE user_id = profile_row.id AND node_type = 'MAX' AND status IN ('ACTIVE', 'PENDING_MILESTONES'))
    THEN 'MAX'
    WHEN EXISTS (SELECT 1 FROM node_memberships WHERE user_id = profile_row.id AND node_type = 'MINI' AND status IN ('ACTIVE', 'PENDING_MILESTONES'))
    THEN 'MINI'
    ELSE 'NONE'
  END INTO highest_node;

  UPDATE profiles SET node_type = highest_node WHERE id = profile_row.id;

  RETURN jsonb_build_object(
    'success', true,
    'membership_id', membership.id,
    'node_type', node_type_param,
    'contribution', contribution,
    'frozen', frozen,
    'daily_rate', daily_rate_val,
    'duration', node_duration,
    'milestones', total_m
  );
END;
$$;

-- place_trade_bet
CREATE OR REPLACE FUNCTION place_trade_bet(
  addr TEXT, bet_asset TEXT, bet_direction TEXT, bet_amount NUMERIC,
  bet_duration TEXT DEFAULT '1min', bet_entry_price NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  bet trade_bets%ROWTYPE;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    INSERT INTO profiles (wallet_address) VALUES (addr) RETURNING * INTO profile_row;
  END IF;

  INSERT INTO trade_bets (user_id, asset, direction, amount, duration, entry_price)
  VALUES (profile_row.id, bet_asset, bet_direction, bet_amount, bet_duration, bet_entry_price)
  RETURNING * INTO bet;

  RETURN to_jsonb(bet);
END;
$$;

-- get_trade_stats
CREATE OR REPLACE FUNCTION get_trade_stats(addr TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  total_count INT;
  win_count INT;
  loss_count INT;
  staked_sum NUMERIC;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'wins', 0, 'losses', 0, 'totalStaked', '0');
  END IF;

  SELECT COUNT(*), COALESCE(SUM(amount), 0)
  INTO total_count, staked_sum
  FROM trade_bets WHERE user_id = profile_row.id;

  SELECT COUNT(*) INTO win_count FROM trade_bets WHERE user_id = profile_row.id AND result = 'WIN';
  SELECT COUNT(*) INTO loss_count FROM trade_bets WHERE user_id = profile_row.id AND result = 'LOSS';

  RETURN jsonb_build_object(
    'total', total_count, 'wins', win_count, 'losses', loss_count, 'totalStaked', staked_sum::TEXT
  );
END;
$$;

-- subscribe_strategy
CREATE OR REPLACE FUNCTION subscribe_strategy(addr TEXT, strat_id TEXT, capital NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  strat strategies%ROWTYPE;
  sub strategy_subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;

  SELECT * INTO strat FROM strategies WHERE id = strat_id::UUID;
  IF strat.id IS NULL THEN RAISE EXCEPTION 'Strategy not found'; END IF;

  IF strat.is_vip_only AND NOT profile_row.is_vip THEN
    RAISE EXCEPTION 'VIP subscription required';
  END IF;

  INSERT INTO strategy_subscriptions (user_id, strategy_id, allocated_capital)
  VALUES (profile_row.id, strat.id, capital)
  RETURNING * INTO sub;

  RETURN to_jsonb(sub);
END;
$$;

-- purchase_hedge
CREATE OR REPLACE FUNCTION purchase_hedge(addr TEXT, hedge_amount NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  hedge hedge_positions%ROWTYPE;
BEGIN
  IF hedge_amount < 100 THEN RAISE EXCEPTION 'Minimum 100 USDT required'; END IF;

  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    INSERT INTO profiles (wallet_address) VALUES (addr) RETURNING * INTO profile_row;
  END IF;

  INSERT INTO hedge_positions (user_id, amount, purchase_amount, current_pnl, status)
  VALUES (profile_row.id, hedge_amount, 0, 0, 'ACTIVE')
  RETURNING * INTO hedge;

  INSERT INTO insurance_purchases (user_id, amount, status)
  VALUES (profile_row.id, hedge_amount, 'ACTIVE');

  INSERT INTO transactions (user_id, type, token, amount, status)
  VALUES (profile_row.id, 'HEDGE_PURCHASE', 'USDT', hedge_amount, 'CONFIRMED');

  RETURN to_jsonb(hedge);
END;
$$;

-- place_prediction_bet
CREATE OR REPLACE FUNCTION place_prediction_bet(
  addr TEXT, market_id_param TEXT, market_type_param TEXT,
  question_param TEXT, choice_param TEXT, odds_param NUMERIC, amount_param NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  odds_val NUMERIC;
  payout NUMERIC;
  bet prediction_bets%ROWTYPE;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;

  odds_val := GREATEST(odds_param, 0.01);
  payout := ROUND(amount_param * (1.0 / odds_val), 6);

  INSERT INTO prediction_bets (user_id, market_id, market_type, question, choice, odds, amount, potential_payout, status)
  VALUES (profile_row.id, market_id_param, market_type_param, question_param, choice_param, odds_val, amount_param, payout, 'ACTIVE')
  RETURNING * INTO bet;

  RETURN to_jsonb(bet);
END;
$$;

-- get_vault_overview
CREATE OR REPLACE FUNCTION get_vault_overview()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE tvl NUMERIC; holder_count INT; active_count INT;
BEGIN
  SELECT COALESCE(SUM(principal), 0), COUNT(DISTINCT user_id), COUNT(*)
  INTO tvl, holder_count, active_count
  FROM vault_positions WHERE status = 'ACTIVE';

  RETURN jsonb_build_object('tvl', tvl::TEXT, 'holders', holder_count, 'activePositions', active_count, 'maxApr', '65.7');
END;
$$;

-- get_strategy_overview
CREATE OR REPLACE FUNCTION get_strategy_overview()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE total_aum_val NUMERIC; avg_win NUMERIC; avg_monthly NUMERIC;
BEGIN
  SELECT COALESCE(SUM(total_aum), 0), COALESCE(AVG(win_rate), 0), COALESCE(AVG(monthly_return), 0)
  INTO total_aum_val, avg_win, avg_monthly
  FROM strategies WHERE status = 'ACTIVE';

  RETURN jsonb_build_object('totalAum', total_aum_val::TEXT, 'avgWinRate', ROUND(avg_win, 2)::TEXT, 'avgMonthlyReturn', ROUND(avg_monthly, 2)::TEXT);
END;
$$;

-- get_insurance_pool
CREATE OR REPLACE FUNCTION get_insurance_pool()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE pool_size NUMERIC; total_policies INT; total_paid NUMERIC;
BEGIN
  SELECT COALESCE(SUM(amount), 0), COUNT(*)
  INTO pool_size, total_policies
  FROM insurance_purchases WHERE status = 'ACTIVE';

  SELECT COALESCE(SUM(purchase_amount), 0) INTO total_paid FROM hedge_positions WHERE status = 'ACTIVE';

  RETURN jsonb_build_object('poolSize', pool_size::TEXT, 'totalPolicies', total_policies, 'totalPaid', total_paid::TEXT);
END;
$$;

-- get_referral_tree
CREATE OR REPLACE FUNCTION get_referral_tree(addr TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  direct_refs JSONB;
  direct_count INT;
  total_team INT;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    RETURN jsonb_build_object('referrals', '[]'::JSONB, 'teamSize', 0, 'directCount', 0);
  END IF;

  WITH direct AS (
    SELECT * FROM profiles WHERE referrer_id = profile_row.id
  ),
  sub_counts AS (
    SELECT referrer_id, COUNT(*)::INT AS cnt
    FROM profiles
    WHERE referrer_id IN (SELECT id FROM profiles WHERE referrer_id IN (SELECT id FROM direct))
    GROUP BY referrer_id
  ),
  team AS (
    SELECT d.*, jsonb_agg(
      CASE WHEN s.id IS NOT NULL THEN
        jsonb_build_object(
          'id', s.id, 'walletAddress', s.wallet_address, 'rank', s.rank,
          'nodeType', s.node_type, 'totalDeposited', s.total_deposited, 'level', 2,
          'subCount', COALESCE(sc.cnt, 0)
        )
      ELSE NULL END
    ) FILTER (WHERE s.id IS NOT NULL) AS sub_referrals
    FROM direct d
    LEFT JOIN profiles s ON s.referrer_id = d.id
    LEFT JOIN sub_counts sc ON sc.referrer_id = s.id
    GROUP BY d.id, d.wallet_address, d.ref_code, d.referrer_id, d.rank,
             d.node_type, d.is_vip, d.vip_expires_at, d.total_deposited,
             d.total_withdrawn, d.referral_earnings, d.created_at
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', t.id, 'walletAddress', t.wallet_address, 'rank', t.rank,
      'nodeType', t.node_type, 'totalDeposited', t.total_deposited, 'level', 1,
      'subReferrals', COALESCE(t.sub_referrals, '[]'::JSONB)
    )
  ), COUNT(*)::INT
  INTO direct_refs, direct_count
  FROM team t;

  WITH RECURSIVE team_tree AS (
    SELECT id FROM profiles WHERE referrer_id = profile_row.id
    UNION ALL
    SELECT p.id FROM profiles p INNER JOIN team_tree t ON p.referrer_id = t.id
  )
  SELECT COUNT(*)::INT INTO total_team FROM team_tree;

  RETURN jsonb_build_object(
    'referrals', COALESCE(direct_refs, '[]'::JSONB),
    'teamSize', total_team,
    'directCount', direct_count
  );
END;
$$;

-- get_team_counts
CREATE OR REPLACE FUNCTION get_team_counts(profile_ids UUID[])
RETURNS TABLE(profile_id UUID, team_count INT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT pid, (
    WITH RECURSIVE team_tree AS (
      SELECT p.id FROM profiles p WHERE p.referrer_id = pid
      UNION ALL
      SELECT p2.id FROM profiles p2 INNER JOIN team_tree t ON p2.referrer_id = t.id
    )
    SELECT COUNT(*)::INT FROM team_tree
  ) AS team_count
  FROM unnest(profile_ids) AS pid;
END;
$$;

-- settle_team_commission
CREATE OR REPLACE FUNCTION settle_team_commission(base_amount NUMERIC, source_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  ranks_json JSONB;
  max_depth INT;
  direct_rate NUMERIC;
  current_user_id UUID;
  upline_id UUID;
  current_depth INT := 0;
  prev_rate NUMERIC := 0;
  upline_rank TEXT;
  upline_commission NUMERIC;
  diff_rate NUMERIC;
  commission NUMERIC;
  total_commission NUMERIC := 0;
  commissions_paid INT := 0;
BEGIN
  SELECT value::JSONB INTO ranks_json FROM system_config WHERE key = 'RANKS';
  SELECT COALESCE(value::INT, 15) INTO max_depth FROM system_config WHERE key = 'TEAM_MAX_DEPTH';
  SELECT COALESCE(value::NUMERIC, 0.10) INTO direct_rate FROM system_config WHERE key = 'DIRECT_REFERRAL_RATE';

  current_user_id := source_user_id;

  LOOP
    current_depth := current_depth + 1;
    IF current_depth > max_depth THEN EXIT; END IF;

    SELECT referrer_id INTO upline_id FROM profiles WHERE id = current_user_id;
    IF upline_id IS NULL THEN EXIT; END IF;

    SELECT rank INTO upline_rank FROM profiles WHERE id = upline_id;

    SELECT COALESCE((elem->>'commission')::NUMERIC, 0)
    INTO upline_commission
    FROM jsonb_array_elements(ranks_json) AS elem
    WHERE elem->>'level' = upline_rank;

    IF upline_commission IS NULL THEN upline_commission := 0; END IF;

    IF current_depth = 1 AND direct_rate > 0 THEN
      commission := base_amount * direct_rate;
      IF commission > 0 THEN
        INSERT INTO node_rewards (user_id, reward_type, amount, details)
        VALUES (upline_id, 'TEAM_COMMISSION', commission,
          jsonb_build_object('type', 'direct_referral', 'source_user', source_user_id, 'depth', current_depth));
        total_commission := total_commission + commission;
        commissions_paid := commissions_paid + 1;
      END IF;
    END IF;

    diff_rate := GREATEST(upline_commission - prev_rate, 0);
    IF diff_rate > 0 THEN
      commission := base_amount * diff_rate;
      INSERT INTO node_rewards (user_id, reward_type, amount, details)
      VALUES (upline_id, 'TEAM_COMMISSION', commission,
        jsonb_build_object('type', 'differential', 'source_user', source_user_id,
          'depth', current_depth, 'rate', diff_rate, 'upline_rate', upline_commission, 'prev_rate', prev_rate));
      total_commission := total_commission + commission;
      commissions_paid := commissions_paid + 1;
    END IF;

    IF upline_commission > prev_rate THEN
      prev_rate := upline_commission;
    END IF;

    current_user_id := upline_id;
  END LOOP;

  RETURN jsonb_build_object('totalCommission', ROUND(total_commission, 6)::TEXT, 'commissionsPaid', commissions_paid);
END;
$$;

-- settle_vault_daily
-- MA yield = principal × dailyRate ÷ MA price (no platform fee)
-- Commission base = full MA yield amount
CREATE OR REPLACE FUNCTION settle_vault_daily()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  pos RECORD;
  ar_token_price NUMERIC;
  daily_yield NUMERIC;
  ma_amount NUMERIC;
  total_yield NUMERIC := 0;
  positions_processed INT := 0;
BEGIN
  SELECT COALESCE(value::NUMERIC, 0.10) INTO ar_token_price FROM system_config WHERE key = 'MA_TOKEN_PRICE';

  FOR pos IN
    SELECT vp.*, p.id AS profile_id
    FROM vault_positions vp
    JOIN profiles p ON p.id = vp.user_id
    WHERE vp.status = 'ACTIVE'
      AND (vp.end_date IS NULL OR vp.end_date > NOW())
      AND vp.plan_type != 'BONUS_5D'
  LOOP
    daily_yield := pos.principal * pos.daily_rate;
    ma_amount := daily_yield / ar_token_price;

    INSERT INTO vault_rewards (user_id, position_id, reward_type, amount, ar_price, ar_amount)
    VALUES (pos.user_id, pos.id, 'DAILY_YIELD', daily_yield, ar_token_price, ma_amount);

    total_yield := total_yield + daily_yield;
    positions_processed := positions_processed + 1;

    -- Commission base = MA yield amount (in MA tokens)
    PERFORM settle_team_commission(ma_amount, pos.user_id);
  END LOOP;

  RETURN jsonb_build_object(
    'positionsProcessed', positions_processed,
    'totalYield', ROUND(total_yield, 6)::TEXT,
    'arPrice', ar_token_price::TEXT
  );
END;
$$;

-- settle_node_fixed_yield (with system pause check)
CREATE OR REPLACE FUNCTION settle_node_fixed_yield()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  node RECORD;
  daily_profit NUMERIC;
  total_settled NUMERIC := 0;
  nodes_processed INT := 0;
  system_active BOOLEAN;
BEGIN
  SELECT value::BOOLEAN INTO system_active FROM system_config WHERE key = 'NODE_SYSTEM_ACTIVE';
  IF NOT COALESCE(system_active, false) THEN
    RETURN jsonb_build_object('nodesProcessed', 0, 'totalSettled', '0', 'paused', true);
  END IF;

  FOR node IN
    SELECT nm.*, p.id AS profile_id, p.rank AS user_rank
    FROM node_memberships nm
    JOIN profiles p ON p.id = nm.user_id
    WHERE nm.status IN ('ACTIVE', 'PENDING_MILESTONES')
      AND (nm.end_date IS NULL OR nm.end_date > NOW())
  LOOP
    daily_profit := node.frozen_amount * COALESCE(node.daily_rate, 0) * COALESCE(node.earnings_capacity, 0);

    IF node.node_type = 'MINI' AND node.milestone_stage < 1 THEN
      UPDATE node_memberships SET locked_earnings = locked_earnings + daily_profit WHERE id = node.id;
    ELSE
      IF daily_profit > 0 THEN
        UPDATE node_memberships
        SET released_earnings = released_earnings + daily_profit,
            available_balance = available_balance + daily_profit
        WHERE id = node.id;

        INSERT INTO node_rewards (user_id, reward_type, amount, details)
        VALUES (node.user_id, 'FIXED_YIELD', daily_profit,
          jsonb_build_object('node_type', node.node_type, 'frozen_amount', node.frozen_amount,
            'daily_rate', node.daily_rate, 'earnings_capacity', node.earnings_capacity));
      END IF;
    END IF;

    total_settled := total_settled + daily_profit;
    nodes_processed := nodes_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('nodesProcessed', nodes_processed, 'totalSettled', ROUND(total_settled, 6)::TEXT);
END;
$$;

-- distribute_daily_revenue
CREATE OR REPLACE FUNCTION distribute_daily_revenue()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  today_revenue NUMERIC;
  node_share NUMERIC; buyback_share NUMERIC; insurance_share NUMERIC;
  treasury_share NUMERIC; operations_share NUMERIC;
  node_rate NUMERIC; buyback_rate NUMERIC; insurance_rate NUMERIC;
  treasury_rate NUMERIC; operations_rate NUMERIC;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO today_revenue
  FROM revenue_events WHERE created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + INTERVAL '1 day';

  IF today_revenue <= 0 THEN RETURN jsonb_build_object('revenue', 0, 'distributed', false); END IF;

  SELECT COALESCE(value::NUMERIC, 0.50) INTO node_rate FROM system_config WHERE key = 'REVENUE_NODE_POOL_SHARE';
  SELECT COALESCE(value::NUMERIC, 0.20) INTO buyback_rate FROM system_config WHERE key = 'REVENUE_BUYBACK_SHARE';
  SELECT COALESCE(value::NUMERIC, 0.10) INTO insurance_rate FROM system_config WHERE key = 'REVENUE_INSURANCE_SHARE';
  SELECT COALESCE(value::NUMERIC, 0.10) INTO treasury_rate FROM system_config WHERE key = 'REVENUE_TREASURY_SHARE';
  SELECT COALESCE(value::NUMERIC, 0.10) INTO operations_rate FROM system_config WHERE key = 'REVENUE_OPERATIONS_SHARE';

  node_share := today_revenue * node_rate;
  buyback_share := today_revenue * buyback_rate;
  insurance_share := today_revenue * insurance_rate;
  treasury_share := today_revenue * treasury_rate;
  operations_share := today_revenue * operations_rate;

  UPDATE revenue_pools SET balance = balance + node_share, updated_at = NOW() WHERE pool_name = 'NODE_POOL';
  UPDATE revenue_pools SET balance = balance + buyback_share, updated_at = NOW() WHERE pool_name = 'BUYBACK_POOL';
  UPDATE revenue_pools SET balance = balance + insurance_share, updated_at = NOW() WHERE pool_name = 'INSURANCE_POOL';
  UPDATE revenue_pools SET balance = balance + treasury_share, updated_at = NOW() WHERE pool_name = 'TREASURY_POOL';
  UPDATE revenue_pools SET balance = balance + operations_share, updated_at = NOW() WHERE pool_name = 'OPERATIONS';

  RETURN jsonb_build_object(
    'revenue', ROUND(today_revenue, 6)::TEXT, 'distributed', true,
    'nodePool', ROUND(node_share, 6)::TEXT, 'buybackPool', ROUND(buyback_share, 6)::TEXT,
    'insurancePool', ROUND(insurance_share, 6)::TEXT, 'treasuryPool', ROUND(treasury_share, 6)::TEXT,
    'operations', ROUND(operations_share, 6)::TEXT
  );
END;
$$;

-- settle_node_pool_dividend
CREATE OR REPLACE FUNCTION settle_node_pool_dividend()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  pool_balance NUMERIC; total_weight NUMERIC := 0;
  node RECORD; node_weight NUMERIC; dividend NUMERIC;
  user_keep_rate NUMERIC; team_pool_rate NUMERIC;
  user_amount NUMERIC; team_amount NUMERIC;
  max_multiplier NUMERIC; mini_multiplier NUMERIC;
  total_distributed NUMERIC := 0; nodes_processed INT := 0;
BEGIN
  SELECT balance INTO pool_balance FROM revenue_pools WHERE pool_name = 'NODE_POOL';
  IF pool_balance IS NULL OR pool_balance <= 0 THEN
    RETURN jsonb_build_object('poolBalance', 0, 'distributed', false);
  END IF;

  SELECT COALESCE(value::NUMERIC, 1.5) INTO max_multiplier FROM system_config WHERE key = 'NODE_MAX_WEIGHT_MULTIPLIER';
  SELECT COALESCE(value::NUMERIC, 1.0) INTO mini_multiplier FROM system_config WHERE key = 'NODE_MINI_WEIGHT_MULTIPLIER';
  SELECT COALESCE(value::NUMERIC, 0.90) INTO user_keep_rate FROM system_config WHERE key = 'NODE_DIVIDEND_USER_KEEP';
  SELECT COALESCE(value::NUMERIC, 0.10) INTO team_pool_rate FROM system_config WHERE key = 'NODE_DIVIDEND_TEAM_POOL';

  SELECT COALESCE(SUM(price * max_multiplier * COALESCE(earnings_capacity, 1.0)), 0)
  INTO total_weight FROM node_memberships
  WHERE node_type = 'MAX' AND status IN ('ACTIVE', 'PENDING_MILESTONES')
    AND (end_date IS NULL OR end_date > NOW());

  IF total_weight <= 0 THEN
    RETURN jsonb_build_object('poolBalance', pool_balance::TEXT, 'distributed', false, 'reason', 'no_eligible_max_nodes');
  END IF;

  FOR node IN
    SELECT nm.* FROM node_memberships nm
    WHERE nm.node_type = 'MAX' AND nm.status IN ('ACTIVE', 'PENDING_MILESTONES')
      AND (nm.end_date IS NULL OR nm.end_date > NOW())
  LOOP
    node_weight := node.price * max_multiplier * COALESCE(node.earnings_capacity, 1.0);
    dividend := pool_balance * (node_weight / total_weight);
    user_amount := dividend * user_keep_rate;

    INSERT INTO node_rewards (user_id, reward_type, amount, details)
    VALUES (node.user_id, 'POOL_DIVIDEND', user_amount,
      jsonb_build_object('node_type', node.node_type, 'weight', node_weight,
        'total_weight', total_weight, 'pool_balance', pool_balance,
        'gross_dividend', dividend, 'earnings_capacity', node.earnings_capacity));

    total_distributed := total_distributed + dividend;
    nodes_processed := nodes_processed + 1;
  END LOOP;

  UPDATE revenue_pools SET balance = balance - total_distributed, updated_at = NOW() WHERE pool_name = 'NODE_POOL';

  RETURN jsonb_build_object(
    'poolBalance', ROUND(pool_balance, 6)::TEXT, 'distributed', true,
    'totalDistributed', ROUND(total_distributed, 6)::TEXT, 'nodesProcessed', nodes_processed
  );
END;
$$;

-- check_node_milestones (with system pause check)
CREATE OR REPLACE FUNCTION check_node_milestones(addr TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  ms RECORD;
  user_rank_index INT;
  required_rank_index INT;
  achieved_count INT := 0;
  failed_count INT := 0;
  system_active BOOLEAN;
BEGIN
  SELECT value::BOOLEAN INTO system_active FROM system_config WHERE key = 'NODE_SYSTEM_ACTIVE';
  IF NOT COALESCE(system_active, false) THEN
    RETURN jsonb_build_object('achieved', 0, 'failed', 0, 'paused', true);
  END IF;

  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Profile not found');
  END IF;

  FOR ms IN
    SELECT nm_ms.*, nm.user_id, nm.node_type, nm.total_milestones, nm.id AS mem_id,
           nm.locked_earnings, nm.frozen_amount
    FROM node_milestones nm_ms
    JOIN node_memberships nm ON nm.id = nm_ms.membership_id
    WHERE nm.user_id = profile_row.id
      AND nm.status = 'PENDING_MILESTONES'
      AND nm_ms.status = 'PENDING'
    ORDER BY nm_ms.milestone_index ASC
  LOOP
    user_rank_index := CASE
      WHEN profile_row.rank = 'V1' THEN 1 WHEN profile_row.rank = 'V2' THEN 2
      WHEN profile_row.rank = 'V3' THEN 3 WHEN profile_row.rank = 'V4' THEN 4
      WHEN profile_row.rank = 'V5' THEN 5 WHEN profile_row.rank = 'V6' THEN 6
      WHEN profile_row.rank = 'V7' THEN 7 ELSE 0
    END;

    required_rank_index := CASE
      WHEN ms.required_rank = 'V1' THEN 1 WHEN ms.required_rank = 'V2' THEN 2
      WHEN ms.required_rank = 'V3' THEN 3 WHEN ms.required_rank = 'V4' THEN 4
      WHEN ms.required_rank = 'V5' THEN 5 WHEN ms.required_rank = 'V6' THEN 6
      WHEN ms.required_rank = 'V7' THEN 7 ELSE 0
    END;

    IF user_rank_index >= required_rank_index THEN
      UPDATE node_milestones SET status = 'ACHIEVED', achieved_at = NOW() WHERE id = ms.id;
      UPDATE node_memberships
      SET milestone_stage = milestone_stage + 1,
          earnings_capacity = LEAST(earnings_capacity + (1.0 / ms.total_milestones), 1.0)
      WHERE id = ms.mem_id;

      IF ms.node_type = 'MINI' AND ms.required_rank = 'V2' THEN
        UPDATE node_memberships
        SET released_earnings = released_earnings + COALESCE(locked_earnings, 0),
            available_balance = available_balance + COALESCE(locked_earnings, 0),
            locked_earnings = 0
        WHERE id = ms.mem_id;
      END IF;

      achieved_count := achieved_count + 1;

    ELSIF NOW() > ms.deadline_at THEN
      UPDATE node_milestones SET status = 'FAILED' WHERE id = ms.id;
      UPDATE node_milestones SET status = 'FAILED' WHERE membership_id = ms.mem_id AND status = 'PENDING';
      UPDATE node_memberships SET status = 'CANCELLED', locked_earnings = 0, available_balance = 0
      WHERE id = ms.mem_id;
      failed_count := failed_count + 1;
    END IF;
  END LOOP;

  UPDATE node_memberships SET status = 'ACTIVE'
  WHERE user_id = profile_row.id AND status = 'PENDING_MILESTONES'
    AND milestone_stage >= total_milestones;

  -- Release frozen amount for fully completed nodes
  UPDATE node_memberships
  SET available_balance = available_balance + frozen_amount, frozen_amount = 0
  WHERE user_id = profile_row.id AND status = 'ACTIVE'
    AND milestone_stage >= total_milestones AND frozen_amount > 0;

  UPDATE profiles SET node_type = (
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM node_memberships WHERE user_id = profile_row.id AND node_type = 'MAX' AND status IN ('ACTIVE', 'PENDING_MILESTONES'))
      THEN 'MAX'
      WHEN EXISTS (SELECT 1 FROM node_memberships WHERE user_id = profile_row.id AND node_type = 'MINI' AND status IN ('ACTIVE', 'PENDING_MILESTONES'))
      THEN 'MINI'
      ELSE 'NONE'
    END
  ) WHERE id = profile_row.id;

  RETURN jsonb_build_object('achieved', achieved_count, 'failed', failed_count);
END;
$$;

-- get_node_overview
CREATE OR REPLACE FUNCTION get_node_overview(addr TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  nodes_json JSONB;
  fixed_yield_total NUMERIC; pool_dividend_total NUMERIC; team_commission_total NUMERIC;
  pool_balance NUMERIC; pool_updated TIMESTAMPTZ;
  total_available NUMERIC; total_locked NUMERIC; total_released NUMERIC;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    RETURN jsonb_build_object(
      'nodes', '[]'::JSONB, 'rewards', NULL, 'pool', NULL,
      'rank', 'V0', 'availableBalance', '0', 'lockedEarnings', '0', 'releasedEarnings', '0'
    );
  END IF;

  SELECT COALESCE(jsonb_agg(
    to_jsonb(nm) || jsonb_build_object(
      'milestones', COALESCE(
        (SELECT jsonb_agg(to_jsonb(ms) ORDER BY ms.milestone_index)
         FROM node_milestones ms WHERE ms.membership_id = nm.id),
        '[]'::JSONB
      )
    )
  ORDER BY nm.start_date DESC), '[]'::JSONB)
  INTO nodes_json FROM node_memberships nm WHERE nm.user_id = profile_row.id;

  SELECT COALESCE(SUM(amount), 0) INTO fixed_yield_total FROM node_rewards WHERE user_id = profile_row.id AND reward_type = 'FIXED_YIELD';
  SELECT COALESCE(SUM(amount), 0) INTO pool_dividend_total FROM node_rewards WHERE user_id = profile_row.id AND reward_type = 'POOL_DIVIDEND';
  SELECT COALESCE(SUM(amount), 0) INTO team_commission_total FROM node_rewards WHERE user_id = profile_row.id AND reward_type = 'TEAM_COMMISSION';

  SELECT balance, updated_at INTO pool_balance, pool_updated FROM revenue_pools WHERE pool_name = 'NODE_POOL';

  SELECT COALESCE(SUM(available_balance), 0), COALESCE(SUM(locked_earnings), 0), COALESCE(SUM(released_earnings), 0)
  INTO total_available, total_locked, total_released
  FROM node_memberships WHERE user_id = profile_row.id AND status IN ('ACTIVE', 'PENDING_MILESTONES');

  RETURN jsonb_build_object(
    'nodes', nodes_json,
    'rank', COALESCE(profile_row.rank, 'V0'),
    'availableBalance', COALESCE(ROUND(total_available, 2), 0)::TEXT,
    'lockedEarnings', COALESCE(ROUND(total_locked, 2), 0)::TEXT,
    'releasedEarnings', COALESCE(ROUND(total_released, 2), 0)::TEXT,
    'rewards', jsonb_build_object(
      'fixedYield', COALESCE(ROUND(fixed_yield_total, 2), 0)::TEXT,
      'poolDividend', COALESCE(ROUND(pool_dividend_total, 2), 0)::TEXT,
      'teamCommission', COALESCE(ROUND(team_commission_total, 2), 0)::TEXT,
      'totalEarnings', COALESCE(ROUND(fixed_yield_total + pool_dividend_total + team_commission_total, 2), 0)::TEXT
    ),
    'pool', jsonb_build_object(
      'balance', COALESCE(ROUND(pool_balance, 2), 0)::TEXT,
      'updatedAt', pool_updated
    )
  );
END;
$$;

-- get_node_milestone_requirements
CREATE OR REPLACE FUNCTION get_node_milestone_requirements(addr TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_vault_deposited NUMERIC := 0;
  v_direct_node_referrals INT := 0;
BEGIN
  SELECT id INTO v_user_id FROM profiles WHERE wallet_address = lower(addr);
  IF v_user_id IS NULL THEN
    RETURN json_build_object('vault_deposited', 0, 'direct_node_referrals', 0);
  END IF;

  SELECT COALESCE(SUM(principal), 0) INTO v_vault_deposited
  FROM vault_positions WHERE user_id = v_user_id AND status IN ('ACTIVE', 'COMPLETED');

  SELECT COUNT(*) INTO v_direct_node_referrals
  FROM node_memberships nm JOIN profiles p ON p.id = nm.user_id
  WHERE p.referrer_id = v_user_id AND nm.status IN ('ACTIVE', 'PENDING_MILESTONES');

  RETURN json_build_object('vault_deposited', v_vault_deposited, 'direct_node_referrals', v_direct_node_referrals);
END;
$$;

-- activate_node_system
CREATE OR REPLACE FUNCTION activate_node_system()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  mem RECORD; milestones_json JSONB; milestone JSONB;
  m_index INT; node_duration INT; nodes_updated INT := 0;
BEGIN
  UPDATE system_config SET value = 'true', updated_at = NOW() WHERE key = 'NODE_SYSTEM_ACTIVE';

  FOR mem IN SELECT nm.id, nm.node_type FROM node_memberships nm WHERE nm.status IN ('ACTIVE', 'PENDING_MILESTONES')
  LOOP
    IF mem.node_type = 'MAX' THEN
      node_duration := 120;
      SELECT value::JSONB INTO milestones_json FROM system_config WHERE key = 'MAX_MILESTONES';
    ELSE
      node_duration := 90;
      SELECT value::JSONB INTO milestones_json FROM system_config WHERE key = 'MINI_MILESTONES';
    END IF;

    UPDATE node_memberships SET start_date = NOW(), end_date = NOW() + (node_duration || ' days')::INTERVAL WHERE id = mem.id;
    DELETE FROM node_milestones WHERE membership_id = mem.id;

    m_index := 0;
    FOR milestone IN SELECT * FROM jsonb_array_elements(milestones_json)
    LOOP
      INSERT INTO node_milestones (membership_id, milestone_index, required_rank, deadline_days, deadline_at, status)
      VALUES (mem.id, m_index, milestone->>'rank', (milestone->>'days')::INT, NOW() + ((milestone->>'days')::INT || ' days')::INTERVAL, 'PENDING');
      m_index := m_index + 1;
    END LOOP;

    nodes_updated := nodes_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('activated', true, 'nodesReset', nodes_updated, 'activatedAt', NOW());
END;
$$;

-- check_rank_promotion
CREATE OR REPLACE FUNCTION check_rank_promotion(addr TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  conditions JSONB;
  current_rank TEXT; new_rank TEXT;
  personal_holding NUMERIC; direct_referral_count INT; team_performance NUMERIC;
  rank_levels TEXT[] := ARRAY['V1','V2','V3','V4','V5','V6','V7'];
  current_rank_idx INT := 0; target_rank_idx INT;
  cond_holding NUMERIC; cond_referrals INT; cond_sub_ranks INT;
  cond_sub_level TEXT; cond_team_perf NUMERIC; qualified_sub_count INT;
  promoted BOOLEAN := FALSE;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;

  current_rank := profile_row.rank;
  SELECT value::JSONB INTO conditions FROM system_config WHERE key = 'RANK_CONDITIONS';

  SELECT COALESCE(SUM(principal), 0) INTO personal_holding
  FROM vault_positions WHERE user_id = profile_row.id AND status = 'ACTIVE';

  SELECT COUNT(*) INTO direct_referral_count
  FROM profiles p WHERE p.referrer_id = profile_row.id
    AND EXISTS (SELECT 1 FROM vault_positions vp WHERE vp.user_id = p.id AND vp.status = 'ACTIVE');

  WITH RECURSIVE downline AS (
    SELECT id FROM profiles WHERE referrer_id = profile_row.id
    UNION ALL
    SELECT p.id FROM profiles p JOIN downline d ON p.referrer_id = d.id
  )
  SELECT COALESCE(SUM(vp.principal), 0) INTO team_performance
  FROM vault_positions vp JOIN downline d ON vp.user_id = d.id WHERE vp.status = 'ACTIVE';

  IF current_rank IS NOT NULL THEN
    FOR i IN 1..array_length(rank_levels, 1) LOOP
      IF rank_levels[i] = current_rank THEN current_rank_idx := i; EXIT; END IF;
    END LOOP;
  END IF;

  new_rank := current_rank;

  FOR target_rank_idx IN (current_rank_idx + 1)..array_length(rank_levels, 1) LOOP
    SELECT COALESCE((elem->>'personalHolding')::NUMERIC, 0),
           COALESCE((elem->>'directReferrals')::INT, 0),
           COALESCE((elem->>'requiredSubRanks')::INT, 0),
           COALESCE(elem->>'subRankLevel', ''),
           COALESCE((elem->>'teamPerformance')::NUMERIC, 0)
    INTO cond_holding, cond_referrals, cond_sub_ranks, cond_sub_level, cond_team_perf
    FROM jsonb_array_elements(conditions) AS elem
    WHERE elem->>'level' = rank_levels[target_rank_idx];

    IF personal_holding < cond_holding THEN EXIT; END IF;
    IF team_performance < cond_team_perf THEN EXIT; END IF;

    IF rank_levels[target_rank_idx] = 'V1' THEN
      IF direct_referral_count < cond_referrals THEN EXIT; END IF;
    END IF;

    IF cond_sub_ranks > 0 AND cond_sub_level != '' THEN
      SELECT COUNT(*) INTO qualified_sub_count
      FROM profiles p WHERE p.referrer_id = profile_row.id AND p.rank IS NOT NULL
        AND array_position(rank_levels, p.rank) >= array_position(rank_levels, cond_sub_level);
      IF qualified_sub_count < cond_sub_ranks THEN EXIT; END IF;
    END IF;

    new_rank := rank_levels[target_rank_idx];
    promoted := TRUE;
  END LOOP;

  IF promoted AND new_rank IS DISTINCT FROM current_rank THEN
    UPDATE profiles SET rank = new_rank WHERE id = profile_row.id;
  END IF;

  RETURN jsonb_build_object(
    'previousRank', current_rank, 'currentRank', new_rank,
    'promoted', promoted AND new_rank IS DISTINCT FROM current_rank,
    'personalHolding', ROUND(personal_holding, 2)::TEXT,
    'directReferrals', direct_referral_count,
    'teamPerformance', ROUND(team_performance, 2)::TEXT
  );
END;
$$;

-- batch_check_rank_promotions
CREATE OR REPLACE FUNCTION batch_check_rank_promotions()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  p RECORD; result JSONB;
  promoted_count INT := 0; checked_count INT := 0;
BEGIN
  FOR p IN
    SELECT DISTINCT pr.wallet_address FROM profiles pr
    WHERE EXISTS (SELECT 1 FROM vault_positions vp WHERE vp.user_id = pr.id AND vp.status = 'ACTIVE')
    ORDER BY pr.wallet_address
  LOOP
    SELECT check_rank_promotion(p.wallet_address) INTO result;
    checked_count := checked_count + 1;
    IF (result->>'promoted')::BOOLEAN THEN promoted_count := promoted_count + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('checkedCount', checked_count, 'promotedCount', promoted_count);
END;
$$;

-- request_earnings_release
CREATE OR REPLACE FUNCTION request_earnings_release(
  addr TEXT, release_days INT, amount NUMERIC, source_type TEXT DEFAULT 'VAULT'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  burn_rate NUMERIC; burn_amount NUMERIC; net_amount NUMERIC;
  release_end_dt TIMESTAMP; release_rec earnings_releases%ROWTYPE;
  available NUMERIC;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;
  IF amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  IF release_days = 0 THEN burn_rate := 0.20;
  ELSIF release_days = 7 THEN burn_rate := 0.15;
  ELSIF release_days = 15 THEN burn_rate := 0.10;
  ELSIF release_days = 30 THEN burn_rate := 0.05;
  ELSIF release_days = 60 THEN burn_rate := 0.00;
  ELSE RAISE EXCEPTION 'Invalid release period. Use 0, 7, 15, 30, or 60 days';
  END IF;

  IF source_type = 'VAULT' THEN
    SELECT COALESCE(SUM(vr.amount), 0) INTO available
    FROM vault_rewards vr WHERE vr.user_id = profile_row.id AND vr.reward_type = 'DAILY_YIELD';
    SELECT available - COALESCE(SUM(er.gross_amount), 0) INTO available
    FROM earnings_releases er WHERE er.user_id = profile_row.id AND er.source_type = 'VAULT' AND er.status IN ('PENDING', 'RELEASING', 'COMPLETED');
  ELSIF source_type = 'NODE' THEN
    SELECT COALESCE(SUM(available_balance), 0) INTO available
    FROM node_memberships WHERE user_id = profile_row.id AND status IN ('ACTIVE', 'PENDING_MILESTONES');
  ELSE RAISE EXCEPTION 'Invalid source_type. Use VAULT or NODE';
  END IF;

  IF amount > available THEN RAISE EXCEPTION 'Insufficient balance. Available: %', ROUND(available, 2); END IF;

  burn_amount := amount * burn_rate;
  net_amount := amount - burn_amount;
  release_end_dt := NOW() + (release_days || ' days')::INTERVAL;

  INSERT INTO earnings_releases (user_id, source_type, gross_amount, burn_rate, burn_amount, net_amount, release_days, status, release_start, release_end)
  VALUES (profile_row.id, source_type, amount, burn_rate, burn_amount, net_amount, release_days,
    CASE WHEN release_days = 0 THEN 'COMPLETED' ELSE 'RELEASING' END, NOW(), release_end_dt)
  RETURNING * INTO release_rec;

  IF source_type = 'NODE' AND release_days = 0 THEN
    UPDATE node_memberships SET available_balance = GREATEST(available_balance - amount, 0)
    WHERE user_id = profile_row.id AND status IN ('ACTIVE', 'PENDING_MILESTONES');
  END IF;

  RETURN jsonb_build_object(
    'release', to_jsonb(release_rec),
    'burnRate', burn_rate,
    'burnAmount', ROUND(burn_amount, 2)::TEXT,
    'netAmount', ROUND(net_amount, 2)::TEXT
  );
END;
$$;

-- process_pending_releases
CREATE OR REPLACE FUNCTION process_pending_releases()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  rel RECORD; processed INT := 0;
  total_released NUMERIC := 0; total_burned NUMERIC := 0;
BEGIN
  FOR rel IN SELECT * FROM earnings_releases WHERE status = 'RELEASING' AND release_end <= NOW()
  LOOP
    UPDATE earnings_releases SET status = 'COMPLETED', released_at = NOW() WHERE id = rel.id;
    IF rel.source_type = 'NODE' THEN
      UPDATE node_memberships SET available_balance = GREATEST(available_balance - rel.gross_amount, 0)
      WHERE user_id = rel.user_id AND status IN ('ACTIVE', 'PENDING_MILESTONES');
    END IF;
    processed := processed + 1;
    total_released := total_released + rel.net_amount;
    total_burned := total_burned + rel.burn_amount;
  END LOOP;

  RETURN jsonb_build_object('processed', processed, 'totalReleased', ROUND(total_released, 2)::TEXT, 'totalBurned', ROUND(total_burned, 2)::TEXT);
END;
$$;

-- run_daily_settlement
CREATE OR REPLACE FUNCTION run_daily_settlement()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  vault_result JSONB; node_result JSONB; release_result JSONB;
  revenue_result JSONB; rank_result JSONB; node_active BOOLEAN;
BEGIN
  SELECT settle_vault_daily() INTO vault_result;

  SELECT COALESCE(value::BOOLEAN, FALSE) INTO node_active FROM system_config WHERE key = 'NODE_SYSTEM_ACTIVE';
  IF node_active THEN
    SELECT settle_node_fixed_yield() INTO node_result;
    SELECT distribute_daily_revenue() INTO revenue_result;
  ELSE
    node_result := '{"skipped": true, "reason": "NODE_SYSTEM_INACTIVE"}'::JSONB;
    revenue_result := '{"skipped": true}'::JSONB;
  END IF;

  SELECT process_pending_releases() INTO release_result;
  SELECT batch_check_rank_promotions() INTO rank_result;

  RETURN jsonb_build_object(
    'vault', vault_result, 'node', node_result, 'revenue', revenue_result,
    'releases', release_result, 'ranks', rank_result, 'settledAt', NOW()::TEXT
  );
END;
$$;

-- get_earnings_releases
CREATE OR REPLACE FUNCTION get_earnings_releases(addr TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE profile_row profiles%ROWTYPE; releases JSONB;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN RETURN '{"releases": []}'::JSONB; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(er) ORDER BY er.created_at DESC), '[]'::JSONB)
  INTO releases FROM earnings_releases er WHERE er.user_id = profile_row.id;

  RETURN jsonb_build_object('releases', releases);
END;
$$;

-- get_rank_status
CREATE OR REPLACE FUNCTION get_rank_status(addr TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  personal_holding NUMERIC; direct_referral_count INT; team_performance NUMERIC;
  conditions JSONB; next_cond JSONB;
  rank_levels TEXT[] := ARRAY['V1','V2','V3','V4','V5','V6','V7'];
  current_idx INT := 0;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN RETURN '{"error": "User not found"}'::JSONB; END IF;

  SELECT COALESCE(SUM(principal), 0) INTO personal_holding
  FROM vault_positions WHERE user_id = profile_row.id AND status = 'ACTIVE';

  SELECT COUNT(*) INTO direct_referral_count
  FROM profiles p WHERE p.referrer_id = profile_row.id
    AND EXISTS (SELECT 1 FROM vault_positions vp WHERE vp.user_id = p.id AND vp.status = 'ACTIVE');

  WITH RECURSIVE downline AS (
    SELECT id FROM profiles WHERE referrer_id = profile_row.id
    UNION ALL
    SELECT p.id FROM profiles p JOIN downline d ON p.referrer_id = d.id
  )
  SELECT COALESCE(SUM(vp.principal), 0) INTO team_performance
  FROM vault_positions vp JOIN downline d ON vp.user_id = d.id WHERE vp.status = 'ACTIVE';

  SELECT value::JSONB INTO conditions FROM system_config WHERE key = 'RANK_CONDITIONS';

  IF profile_row.rank IS NOT NULL THEN
    FOR i IN 1..array_length(rank_levels, 1) LOOP
      IF rank_levels[i] = profile_row.rank THEN current_idx := i; EXIT; END IF;
    END LOOP;
  END IF;

  IF current_idx < array_length(rank_levels, 1) THEN
    SELECT elem INTO next_cond FROM jsonb_array_elements(conditions) AS elem
    WHERE elem->>'level' = rank_levels[current_idx + 1];
  END IF;

  RETURN jsonb_build_object(
    'currentRank', profile_row.rank,
    'personalHolding', ROUND(personal_holding, 2)::TEXT,
    'directReferrals', direct_referral_count,
    'teamPerformance', ROUND(team_performance, 2)::TEXT,
    'nextRankConditions', next_cond,
    'allConditions', conditions
  );
END;
$$;

-- get_user_team_stats (admin)
CREATE OR REPLACE FUNCTION get_user_team_stats(user_id_param UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  team_size INT; team_perf NUMERIC; personal NUMERIC; direct INT;
  own_node TEXT; direct_max_nodes INT; direct_mini_nodes INT; total_team_nodes INT;
BEGIN
  SELECT COUNT(*) INTO direct FROM profiles WHERE referrer_id = user_id_param;

  WITH RECURSIVE downline AS (
    SELECT id FROM profiles WHERE referrer_id = user_id_param
    UNION ALL
    SELECT p.id FROM profiles p JOIN downline d ON p.referrer_id = d.id
  )
  SELECT COUNT(*) INTO team_size FROM downline;

  WITH RECURSIVE downline AS (
    SELECT id FROM profiles WHERE referrer_id = user_id_param
    UNION ALL
    SELECT p.id FROM profiles p JOIN downline d ON p.referrer_id = d.id
  )
  SELECT COALESCE(SUM(vp.principal), 0) INTO team_perf
  FROM vault_positions vp JOIN downline d ON vp.user_id = d.id WHERE vp.status = 'ACTIVE';

  SELECT COALESCE(SUM(principal), 0) INTO personal
  FROM vault_positions WHERE user_id = user_id_param AND status = 'ACTIVE';

  SELECT node_type INTO own_node FROM node_memberships WHERE user_id = user_id_param ORDER BY created_at DESC LIMIT 1;

  SELECT COUNT(*) INTO direct_max_nodes FROM node_memberships nm JOIN profiles p ON nm.user_id = p.id
  WHERE p.referrer_id = user_id_param AND nm.node_type = 'MAX';

  SELECT COUNT(*) INTO direct_mini_nodes FROM node_memberships nm JOIN profiles p ON nm.user_id = p.id
  WHERE p.referrer_id = user_id_param AND nm.node_type = 'MINI';

  WITH RECURSIVE downline AS (
    SELECT id FROM profiles WHERE referrer_id = user_id_param
    UNION ALL
    SELECT p.id FROM profiles p JOIN downline d ON p.referrer_id = d.id
  )
  SELECT COUNT(*) INTO total_team_nodes FROM node_memberships nm JOIN downline d ON nm.user_id = d.id;

  RETURN jsonb_build_object(
    'teamSize', team_size, 'teamPerformance', ROUND(team_perf, 2)::TEXT,
    'personalHolding', ROUND(personal, 2)::TEXT, 'directCount', direct,
    'ownNode', COALESCE(own_node, 'NONE'),
    'directMaxNodes', direct_max_nodes, 'directMiniNodes', direct_mini_nodes,
    'totalTeamNodes', total_team_nodes
  );
END;
$$;

-- refresh_model_accuracy
CREATE OR REPLACE FUNCTION refresh_model_accuracy(p_model TEXT, p_asset TEXT, p_timeframe TEXT)
RETURNS void AS $$
DECLARE rec RECORD; periods TEXT[] := ARRAY['7d', '30d', 'all']; p TEXT; cutoff TIMESTAMPTZ;
BEGIN
  FOREACH p IN ARRAY periods LOOP
    IF p = '7d' THEN cutoff := NOW() - INTERVAL '7 days';
    ELSIF p = '30d' THEN cutoff := NOW() - INTERVAL '30 days';
    ELSE cutoff := '1970-01-01'::TIMESTAMPTZ;
    END IF;

    SELECT COUNT(*)::INT AS total,
      COUNT(*) FILTER (WHERE direction_correct = TRUE)::INT AS correct,
      CASE WHEN COUNT(*) > 0 THEN ROUND(100.0 * COUNT(*) FILTER (WHERE direction_correct = TRUE) / COUNT(*), 2) ELSE 0 END AS acc,
      COALESCE(ROUND(AVG(confidence), 2), 0) AS avg_conf,
      COALESCE(ROUND(AVG(ABS(price_error_pct)), 4), 0) AS avg_err
    INTO rec FROM ai_prediction_records
    WHERE model = p_model AND asset = p_asset AND timeframe = p_timeframe AND status = 'resolved' AND created_at >= cutoff;

    INSERT INTO ai_model_accuracy (model, asset, timeframe, period, total_predictions, correct_predictions, accuracy_pct, avg_confidence, avg_price_error_pct, updated_at)
    VALUES (p_model, p_asset, p_timeframe, p, rec.total, rec.correct, rec.acc, rec.avg_conf, rec.avg_err, NOW())
    ON CONFLICT (model, asset, timeframe, period) DO UPDATE SET
      total_predictions = rec.total, correct_predictions = rec.correct, accuracy_pct = rec.acc,
      avg_confidence = rec.avg_conf, avg_price_error_pct = rec.avg_err, updated_at = NOW();
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- match_similar_predictions
CREATE OR REPLACE FUNCTION match_similar_predictions(
  query_embedding vector(1536), match_asset TEXT DEFAULT NULL,
  match_timeframe TEXT DEFAULT NULL, match_count INT DEFAULT 5
) RETURNS TABLE (
  id UUID, asset TEXT, timeframe TEXT, model TEXT, prediction TEXT,
  confidence INT, direction_correct BOOLEAN, actual_change_pct NUMERIC, similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT r.id, r.asset, r.timeframe, r.model, r.prediction, r.confidence,
    r.direction_correct, r.actual_change_pct, 1 - (r.embedding <=> query_embedding) AS similarity
  FROM ai_prediction_records r
  WHERE r.status = 'resolved' AND r.embedding IS NOT NULL
    AND (match_asset IS NULL OR r.asset = match_asset)
    AND (match_timeframe IS NULL OR r.timeframe = match_timeframe)
  ORDER BY r.embedding <=> query_embedding LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- update_model_accuracy (atomic)
CREATE OR REPLACE FUNCTION update_model_accuracy(
  p_model TEXT, p_asset TEXT, p_timeframe TEXT, p_correct BOOLEAN, p_pnl_pct NUMERIC
) RETURNS VOID AS $$
DECLARE v_period TEXT;
BEGIN
  FOREACH v_period IN ARRAY ARRAY['7d', '30d'] LOOP
    INSERT INTO ai_model_accuracy (model, asset, timeframe, period, accuracy_pct, total_predictions, updated_at)
    VALUES (p_model, p_asset, p_timeframe, v_period, CASE WHEN p_correct THEN 100 ELSE 0 END, 1, NOW())
    ON CONFLICT (model, asset, timeframe, period) DO UPDATE SET
      accuracy_pct = (ai_model_accuracy.accuracy_pct * ai_model_accuracy.total_predictions + CASE WHEN p_correct THEN 100 ELSE 0 END) / (ai_model_accuracy.total_predictions + 1),
      total_predictions = ai_model_accuracy.total_predictions + 1,
      updated_at = NOW();
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- refresh_provider_stats
CREATE OR REPLACE FUNCTION refresh_provider_stats()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE strategy_providers sp SET
    total_signals = COALESCE(sub.cnt, 0), win_count = COALESCE(sub.wins, 0),
    loss_count = COALESCE(sub.losses, 0), total_pnl = COALESCE(sub.pnl, 0),
    avg_confidence = COALESCE(sub.avg_conf, 0), last_signal_at = sub.last_at, updated_at = NOW()
  FROM (
    SELECT provider_id, COUNT(*) as cnt,
      COUNT(*) FILTER (WHERE result_pnl > 0) as wins,
      COUNT(*) FILTER (WHERE result_pnl < 0) as losses,
      COALESCE(SUM(result_pnl), 0) as pnl,
      AVG(confidence) as avg_conf, MAX(created_at) as last_at
    FROM trade_signals WHERE provider_id IS NOT NULL GROUP BY provider_id
  ) sub WHERE sp.id = sub.provider_id;
END;
$$;

-- auto_close_expired_paper_trades
CREATE OR REPLACE FUNCTION auto_close_expired_paper_trades() RETURNS void AS $$
BEGIN
  UPDATE paper_trades SET status = 'CLOSED', close_reason = 'TIME_LIMIT', closed_at = NOW(), pnl = 0, pnl_pct = 0
  WHERE status = 'OPEN' AND opened_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- claim_revenue
CREATE OR REPLACE FUNCTION claim_revenue(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE total_claimable NUMERIC; claim_count INT;
BEGIN
  SELECT COALESCE(SUM(amount), 0), COUNT(*) INTO total_claimable, claim_count
  FROM revenue_claims WHERE user_id = p_user_id AND status = 'CLAIMABLE';

  IF total_claimable <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Nothing to claim');
  END IF;

  UPDATE revenue_claims SET status = 'CLAIMED', claimed_at = NOW()
  WHERE user_id = p_user_id AND status = 'CLAIMABLE';

  INSERT INTO transactions (user_id, type, token, amount, status, details)
  VALUES (p_user_id, 'REVENUE_CLAIM', 'USDC', total_claimable, 'CONFIRMED',
    jsonb_build_object('claim_count', claim_count, 'source', 'strategy_yield'));

  INSERT INTO treasury_events (event_type, details)
  VALUES ('USER_CLAIMED', jsonb_build_object('user_id', p_user_id, 'amount', total_claimable, 'claim_count', claim_count));

  RETURN jsonb_build_object('success', true, 'amount', total_claimable, 'claims', claim_count);
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 16. Cron Jobs
-- ══════════════════════════════════════════════════════════════

SELECT cron.schedule('daily-settlement', '0 0 * * *', $$SELECT run_daily_settlement()$$);
SELECT cron.schedule('close-expired-paper-trades', '*/10 * * * *', $$SELECT auto_close_expired_paper_trades();$$);
