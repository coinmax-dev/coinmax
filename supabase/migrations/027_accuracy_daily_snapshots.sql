-- ============================================================
-- Daily accuracy snapshots for AI training progress tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS accuracy_daily_snapshots (
  id BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  model TEXT NOT NULL,
  asset TEXT NOT NULL,
  timeframe TEXT NOT NULL DEFAULT '1H',
  -- Metrics
  accuracy_pct NUMERIC NOT NULL DEFAULT 0,
  total_predictions INT NOT NULL DEFAULT 0,
  correct_predictions INT NOT NULL DEFAULT 0,
  avg_confidence NUMERIC NOT NULL DEFAULT 0,
  computed_weight NUMERIC NOT NULL DEFAULT 1.0,
  avg_price_error_pct NUMERIC NOT NULL DEFAULT 0,
  -- Prevent duplicates per day
  UNIQUE (snapshot_date, model, asset, timeframe),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_date ON accuracy_daily_snapshots(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_model ON accuracy_daily_snapshots(model, asset, snapshot_date DESC);

-- RLS: allow anon read for admin panel
ALTER TABLE accuracy_daily_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_snapshots" ON accuracy_daily_snapshots FOR SELECT USING (true);
CREATE POLICY "service_all_snapshots" ON accuracy_daily_snapshots FOR ALL USING (true) WITH CHECK (true);
