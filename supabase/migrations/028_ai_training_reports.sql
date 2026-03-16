-- ============================================================
-- AI Training Reports table for detailed training analytics
-- ============================================================

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

ALTER TABLE ai_training_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_training" ON ai_training_reports FOR SELECT USING (true);
CREATE POLICY "service_all_training" ON ai_training_reports FOR ALL USING (true) WITH CHECK (true);

-- Schedule ai-training cron every hour
SELECT cron.schedule(
  'ai-training-hourly',
  '15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://jqgimdgtpwnunrlwexib.supabase.co/functions/v1/ai-training',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
