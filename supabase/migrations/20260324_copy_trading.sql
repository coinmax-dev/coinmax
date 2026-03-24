-- ═══════════════════════════════════════════════════════════════
--  CoinMax Copy Trading — Database Schema
-- ═══════════════════════════════════════════════════════════════

-- 1. User Trade Configs (跟单配置)
CREATE TABLE IF NOT EXISTS user_trade_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,

  -- Exchange binding
  exchange TEXT NOT NULL CHECK (exchange IN ('binance', 'bybit', 'okx', 'bitget', 'hyperliquid', 'dydx')),
  api_key_encrypted TEXT,        -- AES-256 encrypted
  api_secret_encrypted TEXT,     -- AES-256 encrypted
  api_passphrase_encrypted TEXT, -- for OKX/Bitget
  api_connected BOOLEAN DEFAULT false,
  api_last_test_at TIMESTAMPTZ,

  -- Follow settings
  models_follow TEXT[] DEFAULT ARRAY['GPT-4o', 'Claude', 'Gemini', 'DeepSeek', 'Llama'],
  strategies_follow TEXT[] DEFAULT ARRAY['trend_following', 'mean_reversion', 'breakout', 'momentum', 'scalping', 'swing', 'ichimoku', 'bb_squeeze', 'rsi_divergence', 'donchian'],
  coins_follow TEXT[] DEFAULT ARRAY['BTC', 'ETH', 'SOL', 'BNB', 'DOGE', 'XRP', 'ADA', 'AVAX', 'LINK', 'DOT'],

  -- Position sizing
  position_size_usd NUMERIC(12,2) DEFAULT 100,
  max_leverage INTEGER DEFAULT 3 CHECK (max_leverage BETWEEN 1 AND 20),
  max_positions INTEGER DEFAULT 5 CHECK (max_positions BETWEEN 1 AND 30),
  max_daily_loss_pct NUMERIC(5,2) DEFAULT 10,

  -- Risk control
  stop_loss_pct NUMERIC(5,2) DEFAULT 3,
  take_profit_pct NUMERIC(5,2) DEFAULT 6,
  trailing_stop BOOLEAN DEFAULT true,
  trailing_stop_pct NUMERIC(5,2) DEFAULT 1.5,

  -- Execution mode
  execution_mode TEXT DEFAULT 'paper' CHECK (execution_mode IN ('paper', 'signal', 'semi-auto', 'full-auto')),

  -- Node type determines limits
  node_type TEXT DEFAULT 'MINI' CHECK (node_type IN ('MINI', 'MAX')),
  max_position_total_usd NUMERIC(12,2) GENERATED ALWAYS AS (
    CASE WHEN node_type = 'MAX' THEN 50000 ELSE 5000 END
  ) STORED,
  profit_share_platform_pct NUMERIC(5,2) GENERATED ALWAYS AS (
    CASE WHEN node_type = 'MAX' THEN 15 ELSE 20 END
  ) STORED,

  -- Status
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_trade_configs_wallet ON user_trade_configs(wallet_address);
CREATE INDEX IF NOT EXISTS idx_trade_configs_active ON user_trade_configs(is_active) WHERE is_active = true;

-- 2. Copy Trade Orders (跟单执行记录)
CREATE TABLE IF NOT EXISTS copy_trade_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_wallet TEXT NOT NULL,
  config_id UUID REFERENCES user_trade_configs(id),

  -- Signal source
  signal_id UUID,                -- paper_trades.id that triggered this
  primary_model TEXT,
  strategy_type TEXT,

  -- Order details
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,           -- e.g. BTC-USDT
  side TEXT NOT NULL CHECK (side IN ('LONG', 'SHORT')),
  leverage INTEGER DEFAULT 1,
  entry_price NUMERIC(20,8),
  size NUMERIC(20,8),             -- in base currency
  size_usd NUMERIC(12,2),        -- in USD

  -- Risk levels
  stop_loss NUMERIC(20,8),
  take_profit NUMERIC(20,8),
  trailing_stop_trigger NUMERIC(20,8),

  -- Exchange response
  exchange_order_id TEXT,
  exchange_response JSONB,

  -- Result
  exit_price NUMERIC(20,8),
  pnl_pct NUMERIC(8,4),
  pnl_usd NUMERIC(12,2),
  fee_usd NUMERIC(12,2),         -- platform share
  fee_collected BOOLEAN DEFAULT false,

  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'filled', 'partial', 'closed', 'cancelled', 'failed')),
  error_message TEXT,

  opened_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_copy_orders_wallet ON copy_trade_orders(user_wallet);
CREATE INDEX IF NOT EXISTS idx_copy_orders_status ON copy_trade_orders(status) WHERE status IN ('pending', 'queued', 'filled', 'partial');
CREATE INDEX IF NOT EXISTS idx_copy_orders_signal ON copy_trade_orders(signal_id);

-- 3. Exchange Order Queue (交易所下单队列)
CREATE TABLE IF NOT EXISTS exchange_order_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_wallet TEXT NOT NULL,
  config_id UUID REFERENCES user_trade_configs(id),
  copy_order_id UUID REFERENCES copy_trade_orders(id),

  exchange TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('open_long', 'open_short', 'close', 'modify_sl', 'modify_tp', 'cancel')),
  params JSONB NOT NULL,          -- exchange-specific params

  status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'done', 'failed', 'retry')),
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  error_message TEXT,
  exchange_response JSONB,

  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_order_queue_status ON exchange_order_queue(status) WHERE status IN ('queued', 'retry');

-- 4. Copy Trading Stats (跟单统计，每日快照)
CREATE TABLE IF NOT EXISTS copy_trade_daily_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_wallet TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,

  trades_opened INTEGER DEFAULT 0,
  trades_closed INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  total_pnl_usd NUMERIC(12,2) DEFAULT 0,
  total_fee_usd NUMERIC(12,2) DEFAULT 0,
  max_drawdown_pct NUMERIC(8,4) DEFAULT 0,
  win_rate_pct NUMERIC(5,2) DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_wallet, date)
);

-- ═══════════════════════════════════════════════════════════════
--  RLS POLICIES
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE user_trade_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE copy_trade_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_order_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE copy_trade_daily_stats ENABLE ROW LEVEL SECURITY;

-- Users can read/write their own configs
CREATE POLICY "Users manage own trade configs"
  ON user_trade_configs FOR ALL
  USING (wallet_address = current_setting('request.jwt.claims', true)::json->>'sub')
  WITH CHECK (wallet_address = current_setting('request.jwt.claims', true)::json->>'sub');

-- Anon can read own configs (for frontend)
CREATE POLICY "Anon read own trade configs"
  ON user_trade_configs FOR SELECT
  USING (true);

-- Users can read own orders
CREATE POLICY "Users read own copy orders"
  ON copy_trade_orders FOR SELECT
  USING (true);

-- Only service_role can insert/update orders (executor function)
CREATE POLICY "Service role manages copy orders"
  ON copy_trade_orders FOR ALL
  USING (auth.role() = 'service_role');

-- Queue: service_role only
CREATE POLICY "Service role manages order queue"
  ON exchange_order_queue FOR ALL
  USING (auth.role() = 'service_role');

-- Stats: anyone can read
CREATE POLICY "Anyone read copy stats"
  ON copy_trade_daily_stats FOR SELECT
  USING (true);

CREATE POLICY "Service role manages copy stats"
  ON copy_trade_daily_stats FOR ALL
  USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════════
--  HELPER FUNCTIONS
-- ═══════════════════════════════════════════════════════════════

-- Get active configs matching a signal
CREATE OR REPLACE FUNCTION match_signal_to_configs(
  p_model TEXT,
  p_strategy TEXT,
  p_coin TEXT
) RETURNS SETOF user_trade_configs AS $$
  SELECT * FROM user_trade_configs
  WHERE is_active = true
    AND api_connected = true
    AND execution_mode IN ('semi-auto', 'full-auto')
    AND p_model = ANY(models_follow)
    AND p_strategy = ANY(strategies_follow)
    AND (p_coin = ANY(coins_follow) OR 'ALL' = ANY(coins_follow));
$$ LANGUAGE sql STABLE;

-- Calculate user's current open position total
CREATE OR REPLACE FUNCTION get_user_open_position_usd(p_wallet TEXT)
RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(size_usd), 0)
  FROM copy_trade_orders
  WHERE user_wallet = p_wallet
    AND status IN ('filled', 'partial');
$$ LANGUAGE sql STABLE;

-- Calculate user's daily PnL
CREATE OR REPLACE FUNCTION get_user_daily_pnl(p_wallet TEXT)
RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(pnl_usd), 0)
  FROM copy_trade_orders
  WHERE user_wallet = p_wallet
    AND status = 'closed'
    AND closed_at >= CURRENT_DATE;
$$ LANGUAGE sql STABLE;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_trade_configs_updated
  BEFORE UPDATE ON user_trade_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_copy_orders_updated
  BEFORE UPDATE ON copy_trade_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
