-- Real copy trade orders — actual exchange execution records
CREATE TABLE IF NOT EXISTS copy_trade_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_wallet TEXT NOT NULL,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,          -- e.g. BTCUSDT
  side TEXT NOT NULL CHECK (side IN ('LONG', 'SHORT')),
  size_usd NUMERIC NOT NULL,
  leverage INT DEFAULT 1,
  entry_price NUMERIC,
  exit_price NUMERIC,
  pnl_usd NUMERIC DEFAULT 0,
  fee_usd NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'filled', 'partial', 'closed', 'cancelled', 'failed')),
  exchange_order_id TEXT,        -- exchange's order ID
  signal_id UUID,                -- reference to trade_signals
  strategy_type TEXT,
  primary_model TEXT,
  ai_reasoning TEXT,
  close_reason TEXT,
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_cto_wallet ON copy_trade_orders(user_wallet);
CREATE INDEX IF NOT EXISTS idx_cto_status ON copy_trade_orders(status);
CREATE INDEX IF NOT EXISTS idx_cto_opened ON copy_trade_orders(opened_at DESC);

ALTER TABLE copy_trade_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Copy trade orders access" ON copy_trade_orders FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- Daily PnL tracking per user
CREATE TABLE IF NOT EXISTS copy_trade_daily_pnl (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_wallet TEXT NOT NULL,
  trade_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_pnl_usd NUMERIC DEFAULT 0,
  total_fees_usd NUMERIC DEFAULT 0,
  trade_count INT DEFAULT 0,
  daily_target_hit BOOLEAN DEFAULT FALSE, -- true = 2% reached, stop trading
  UNIQUE(user_wallet, trade_date)
);

ALTER TABLE copy_trade_daily_pnl ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Daily PnL access" ON copy_trade_daily_pnl FOR ALL USING (TRUE) WITH CHECK (TRUE);
