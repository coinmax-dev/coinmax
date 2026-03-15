-- ============================================================
-- Phase 4+: Strategy Provider Management
-- ============================================================

-- ── Strategy Providers ────────────────────────────────────────

CREATE TABLE strategy_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identity
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  contact_email TEXT NOT NULL,
  description TEXT DEFAULT '',
  website TEXT DEFAULT '',
  -- Auth
  api_key TEXT UNIQUE NOT NULL,          -- SHA-256 hashed
  api_key_prefix TEXT NOT NULL,          -- first 8 chars for display "sp_a3f2..."
  -- Config
  allowed_assets TEXT[] DEFAULT '{BTC,ETH,SOL,BNB}',
  max_leverage INT DEFAULT 5,
  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'suspended', 'rejected')),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  -- Cached performance (refreshed by cron)
  total_signals INT DEFAULT 0,
  win_count INT DEFAULT 0,
  loss_count INT DEFAULT 0,
  total_pnl NUMERIC DEFAULT 0,
  avg_confidence NUMERIC DEFAULT 0,
  last_signal_at TIMESTAMPTZ,
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_providers_status ON strategy_providers(status);
CREATE INDEX idx_providers_api_key ON strategy_providers(api_key);
CREATE INDEX idx_providers_slug ON strategy_providers(slug);

-- ── Add provider_id to trade_signals ──────────────────────────

ALTER TABLE trade_signals ADD COLUMN provider_id UUID REFERENCES strategy_providers(id);
CREATE INDEX idx_signals_provider ON trade_signals(provider_id, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────

ALTER TABLE strategy_providers ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "service_all_providers" ON strategy_providers
  FOR ALL USING (auth.role() = 'service_role');

-- Authenticated users can read approved providers
CREATE POLICY "users_read_approved_providers" ON strategy_providers
  FOR SELECT USING (auth.role() = 'authenticated' AND status = 'approved');

-- ── Refresh provider stats RPC ────────────────────────────────

CREATE OR REPLACE FUNCTION refresh_provider_stats()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE strategy_providers sp SET
    total_signals = COALESCE(sub.cnt, 0),
    win_count = COALESCE(sub.wins, 0),
    loss_count = COALESCE(sub.losses, 0),
    total_pnl = COALESCE(sub.pnl, 0),
    avg_confidence = COALESCE(sub.avg_conf, 0),
    last_signal_at = sub.last_at,
    updated_at = NOW()
  FROM (
    SELECT
      provider_id,
      COUNT(*) as cnt,
      COUNT(*) FILTER (WHERE result_pnl > 0) as wins,
      COUNT(*) FILTER (WHERE result_pnl < 0) as losses,
      COALESCE(SUM(result_pnl), 0) as pnl,
      AVG(confidence) as avg_conf,
      MAX(created_at) as last_at
    FROM trade_signals
    WHERE provider_id IS NOT NULL
    GROUP BY provider_id
  ) sub
  WHERE sp.id = sub.provider_id;
END;
$$;
