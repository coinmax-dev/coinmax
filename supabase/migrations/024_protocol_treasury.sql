-- Protocol Treasury: unified fund management for Node + Vault deposits
-- Revenue distribution from strategy yields back to users

-- ── Treasury Yields ──────────────────────────────────────────────
-- Tracks each yield period from HyperLiquid strategy execution
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

-- ── Revenue Claims ──────────────────────────────────────────────
-- Per-user claimable revenue from strategy yields
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

-- ── Treasury Events ──────────────────────────────────────────────
-- Audit log for all treasury operations
CREATE TABLE IF NOT EXISTS treasury_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_treasury_events_type ON treasury_events(event_type);

-- ── Treasury State ──────────────────────────────────────────────
-- Current state snapshot (updated by strategy deployer)
CREATE TABLE IF NOT EXISTS treasury_state (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton row
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

-- Insert default singleton
INSERT INTO treasury_state (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ── Vault Deposits (tracking on-chain vault deposits in DB) ─────
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

-- ── RLS Policies ────────────────────────────────────────────────

ALTER TABLE treasury_yields ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_deposits ENABLE ROW LEVEL SECURITY;

-- Treasury yields: public read
CREATE POLICY "Anyone can read yields" ON treasury_yields FOR SELECT USING (true);

-- Revenue claims: users can read their own
CREATE POLICY "Users read own claims" ON revenue_claims FOR SELECT
  USING (user_id = auth.uid());

-- Treasury events: admin only (service_role bypasses RLS)
CREATE POLICY "Admin only events" ON treasury_events FOR ALL USING (false);

-- Treasury state: public read
CREATE POLICY "Anyone can read treasury state" ON treasury_state FOR SELECT USING (true);

-- Vault deposits: users can read their own
CREATE POLICY "Users read own vault deposits" ON vault_deposits FOR SELECT
  USING (user_id = auth.uid());

-- ── Function: Claim Revenue ─────────────────────────────────────

CREATE OR REPLACE FUNCTION claim_revenue(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  total_claimable NUMERIC;
  claim_count INT;
BEGIN
  -- Sum all claimable amounts
  SELECT COALESCE(SUM(amount), 0), COUNT(*)
  INTO total_claimable, claim_count
  FROM revenue_claims
  WHERE user_id = p_user_id AND status = 'CLAIMABLE';

  IF total_claimable <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Nothing to claim');
  END IF;

  -- Mark all as claimed
  UPDATE revenue_claims
  SET status = 'CLAIMED', claimed_at = NOW()
  WHERE user_id = p_user_id AND status = 'CLAIMABLE';

  -- Record transaction
  INSERT INTO transactions (user_id, type, token, amount, status, details)
  VALUES (p_user_id, 'REVENUE_CLAIM', 'USDC', total_claimable, 'CONFIRMED',
    jsonb_build_object('claim_count', claim_count, 'source', 'strategy_yield'));

  -- Log event
  INSERT INTO treasury_events (event_type, details)
  VALUES ('USER_CLAIMED', jsonb_build_object(
    'user_id', p_user_id,
    'amount', total_claimable,
    'claim_count', claim_count
  ));

  RETURN jsonb_build_object(
    'success', true,
    'amount', total_claimable,
    'claims', claim_count
  );
END;
$$;
