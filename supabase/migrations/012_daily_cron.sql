-- ═══════════════════════════════════════════════════════════════
-- Migration 012: Enable pg_cron and schedule daily settlement
-- ═══════════════════════════════════════════════════════════════

-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule daily settlement at UTC 00:00 (Beijing 08:00)
-- Runs: vault yield settlement, node yield settlement, revenue distribution, pending releases
SELECT cron.schedule('daily-settlement', '0 0 * * *', $$SELECT run_daily_settlement()$$);
