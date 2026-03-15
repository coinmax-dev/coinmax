-- Phase 6: Cron Jobs for Learning Feedback Loop
-- Schedules resolve-predictions (every 5 min) and adjust-weights (every hour)

-- Ensure pg_cron and pg_net are enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ══════════════════════════════════════════════════════
-- Cron Job 1: Resolve predictions every 5 minutes
-- Checks expired predictions, fetches actual prices, marks direction_correct
-- ══════════════════════════════════════════════════════
SELECT cron.schedule(
  'resolve-predictions-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://jqgimdgtpwnunrlwexib.supabase.co/functions/v1/resolve-predictions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpxZ2ltZGd0cHdudW5ybHdleGliIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDgyODk5MCwiZXhwIjoyMDg2NDA0OTkwfQ.TnkFULDxBIWFyM-ppDfPRqOCT7jFSH5iTr06n7IqmZQ'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ══════════════════════════════════════════════════════
-- Cron Job 2: Adjust model weights every hour
-- Recalculates model accuracy and dynamic weights
-- ══════════════════════════════════════════════════════
SELECT cron.schedule(
  'adjust-weights-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://jqgimdgtpwnunrlwexib.supabase.co/functions/v1/adjust-weights',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpxZ2ltZGd0cHdudW5ybHdleGliIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDgyODk5MCwiZXhwIjoyMDg2NDA0OTkwfQ.TnkFULDxBIWFyM-ppDfPRqOCT7jFSH5iTr06n7IqmZQ'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ══════════════════════════════════════════════════════
-- Cron Job 3: Auto-resolve paper trades every minute
-- Checks open paper trades against current prices for SL/TP triggers
-- ══════════════════════════════════════════════════════

-- Function to auto-close expired paper trades (24h time limit)
CREATE OR REPLACE FUNCTION auto_close_expired_paper_trades() RETURNS void AS $$
BEGIN
  UPDATE paper_trades SET
    status = 'CLOSED',
    close_reason = 'TIME_LIMIT',
    closed_at = NOW(),
    pnl = 0,
    pnl_pct = 0
  WHERE status = 'OPEN'
    AND opened_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

SELECT cron.schedule(
  'close-expired-paper-trades',
  '*/10 * * * *',
  $$SELECT auto_close_expired_paper_trades();$$
);

-- ══════════════════════════════════════════════════════
-- Verify cron jobs are scheduled
-- ══════════════════════════════════════════════════════
-- SELECT * FROM cron.job;
