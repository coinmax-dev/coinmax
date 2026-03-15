-- ============================================================
-- Phase 4: Trade Signals, Paper Trades, API Key Vault
-- ============================================================

-- ── Trade Signals ───────────────────────────────────────────

CREATE TABLE trade_signals (
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
  strategy_type TEXT CHECK (strategy_type IN ('directional', 'grid', 'dca')),
  strength TEXT CHECK (strength IN ('STRONG', 'MEDIUM', 'WEAK', 'NONE')),
  source_models TEXT[],
  rag_context TEXT,
  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'executed', 'expired', 'cancelled')),
  result_pnl NUMERIC,
  close_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_signals_status ON trade_signals (status, created_at DESC);
CREATE INDEX idx_signals_asset ON trade_signals (asset, created_at DESC);

-- ── Paper Trades ────────────────────────────────────────────

CREATE TABLE paper_trades (
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
  close_reason TEXT CHECK (close_reason IN ('STOP_LOSS', 'TAKE_PROFIT', 'TIME_LIMIT', 'MANUAL', 'TRAILING_STOP')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX idx_paper_status ON paper_trades (status, opened_at DESC);
CREATE INDEX idx_paper_user ON paper_trades (user_id, status);

-- ── User Exchange API Keys (Encrypted) ─────────────────────

CREATE TABLE user_exchange_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  exchange TEXT NOT NULL CHECK (exchange IN ('binance', 'bybit', 'okx', 'bitget', 'hyperliquid', 'dydx')),
  encrypted_data JSONB NOT NULL,           -- AES-256-GCM encrypted {apiKey, apiSecret, passphrase}
  masked_key TEXT NOT NULL,                -- First 4 + last 4 chars
  label TEXT DEFAULT '',
  testnet BOOLEAN DEFAULT FALSE,
  is_valid BOOLEAN DEFAULT TRUE,
  last_validated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, exchange)
);

CREATE INDEX idx_keys_user ON user_exchange_keys (user_id);

-- ── RLS ─────────────────────────────────────────────────────

ALTER TABLE trade_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_exchange_keys ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "service_all_signals" ON trade_signals FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_all_paper" ON paper_trades FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_all_keys" ON user_exchange_keys FOR ALL USING (auth.role() = 'service_role');

-- Authenticated users can read signals
CREATE POLICY "users_read_signals" ON trade_signals FOR SELECT USING (auth.role() = 'authenticated');

-- Users can manage their own paper trades
CREATE POLICY "users_own_paper" ON paper_trades FOR ALL USING (auth.uid() = user_id);

-- Users can only access their own API keys
CREATE POLICY "users_own_keys" ON user_exchange_keys FOR ALL USING (auth.uid() = user_id);

-- ── Realtime ────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE trade_signals;
