-- ============================================================
-- Phase 1: AI Prediction Tracking + pgvector
-- ============================================================

-- Enable pgvector extension for embedding storage
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Prediction Records ──────────────────────────────────────

CREATE TABLE ai_prediction_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  model TEXT NOT NULL,
  prediction TEXT NOT NULL CHECK (prediction IN ('BULLISH', 'BEARISH', 'NEUTRAL')),
  confidence INT NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  target_price NUMERIC NOT NULL,
  current_price NUMERIC NOT NULL,
  reasoning TEXT,
  -- Market context at prediction time (Phase 2)
  fear_greed_index INT,
  rsi_14 NUMERIC,
  macd_signal TEXT,
  bb_position NUMERIC,
  funding_rate NUMERIC,
  long_short_ratio NUMERIC,
  candle_patterns TEXT,
  -- Result (filled after timeframe expires)
  actual_price NUMERIC,
  actual_direction TEXT CHECK (actual_direction IN ('BULLISH', 'BEARISH')),
  actual_change_pct NUMERIC,
  direction_correct BOOLEAN,
  price_error_pct NUMERIC,
  -- Vector embedding (1536-dim for text-embedding-3-small)
  embedding vector(1536),
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved'))
);

-- Indexes for common queries
CREATE INDEX idx_predictions_pending ON ai_prediction_records (status, expires_at)
  WHERE status = 'pending';
CREATE INDEX idx_predictions_model_asset ON ai_prediction_records (model, asset, timeframe);
CREATE INDEX idx_predictions_created ON ai_prediction_records (created_at DESC);

-- HNSW index for fast vector similarity search
CREATE INDEX idx_predictions_embedding ON ai_prediction_records
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── Model Accuracy Aggregates ───────────────────────────────

CREATE TABLE ai_model_accuracy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model TEXT NOT NULL,
  asset TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  period TEXT NOT NULL,
  total_predictions INT NOT NULL DEFAULT 0,
  correct_predictions INT NOT NULL DEFAULT 0,
  accuracy_pct NUMERIC NOT NULL DEFAULT 0,
  avg_confidence NUMERIC NOT NULL DEFAULT 0,
  avg_price_error_pct NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (model, asset, timeframe, period)
);

CREATE INDEX idx_accuracy_model ON ai_model_accuracy (model, asset);

-- ── RPC: Refresh accuracy for a given model/asset/timeframe ─

CREATE OR REPLACE FUNCTION refresh_model_accuracy(
  p_model TEXT,
  p_asset TEXT,
  p_timeframe TEXT
) RETURNS void AS $$
DECLARE
  rec RECORD;
  periods TEXT[] := ARRAY['7d', '30d', 'all'];
  p TEXT;
  cutoff TIMESTAMPTZ;
BEGIN
  FOREACH p IN ARRAY periods LOOP
    IF p = '7d' THEN cutoff := NOW() - INTERVAL '7 days';
    ELSIF p = '30d' THEN cutoff := NOW() - INTERVAL '30 days';
    ELSE cutoff := '1970-01-01'::TIMESTAMPTZ;
    END IF;

    SELECT
      COUNT(*)::INT AS total,
      COUNT(*) FILTER (WHERE direction_correct = TRUE)::INT AS correct,
      CASE WHEN COUNT(*) > 0
        THEN ROUND(100.0 * COUNT(*) FILTER (WHERE direction_correct = TRUE) / COUNT(*), 2)
        ELSE 0
      END AS acc,
      COALESCE(ROUND(AVG(confidence), 2), 0) AS avg_conf,
      COALESCE(ROUND(AVG(ABS(price_error_pct)), 4), 0) AS avg_err
    INTO rec
    FROM ai_prediction_records
    WHERE model = p_model
      AND asset = p_asset
      AND timeframe = p_timeframe
      AND status = 'resolved'
      AND created_at >= cutoff;

    INSERT INTO ai_model_accuracy (model, asset, timeframe, period,
      total_predictions, correct_predictions, accuracy_pct, avg_confidence, avg_price_error_pct, updated_at)
    VALUES (p_model, p_asset, p_timeframe, p,
      rec.total, rec.correct, rec.acc, rec.avg_conf, rec.avg_err, NOW())
    ON CONFLICT (model, asset, timeframe, period) DO UPDATE SET
      total_predictions = rec.total,
      correct_predictions = rec.correct,
      accuracy_pct = rec.acc,
      avg_confidence = rec.avg_conf,
      avg_price_error_pct = rec.avg_err,
      updated_at = NOW();
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ── RPC: Find similar market states via vector search ───────

CREATE OR REPLACE FUNCTION match_similar_predictions(
  query_embedding vector(1536),
  match_asset TEXT DEFAULT NULL,
  match_timeframe TEXT DEFAULT NULL,
  match_count INT DEFAULT 5
) RETURNS TABLE (
  id UUID,
  asset TEXT,
  timeframe TEXT,
  model TEXT,
  prediction TEXT,
  confidence INT,
  direction_correct BOOLEAN,
  actual_change_pct NUMERIC,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id, r.asset, r.timeframe, r.model, r.prediction, r.confidence,
    r.direction_correct, r.actual_change_pct,
    1 - (r.embedding <=> query_embedding) AS similarity
  FROM ai_prediction_records r
  WHERE r.status = 'resolved'
    AND r.embedding IS NOT NULL
    AND (match_asset IS NULL OR r.asset = match_asset)
    AND (match_timeframe IS NULL OR r.timeframe = match_timeframe)
  ORDER BY r.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- ── RLS ─────────────────────────────────────────────────────

ALTER TABLE ai_prediction_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_model_accuracy ENABLE ROW LEVEL SECURITY;

-- Service role (edge functions) can do everything
CREATE POLICY "service_all_predictions" ON ai_prediction_records
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_all_accuracy" ON ai_model_accuracy
  FOR ALL USING (auth.role() = 'service_role');

-- Authenticated users can read
CREATE POLICY "users_read_predictions" ON ai_prediction_records
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "users_read_accuracy" ON ai_model_accuracy
  FOR SELECT USING (auth.role() = 'authenticated');
