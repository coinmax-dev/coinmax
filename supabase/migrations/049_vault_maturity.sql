-- 049: Vault maturity + release tracking
--
-- Vault: ACTIVE → MATURED (24h window) → RENEWED or REDEEMED
-- Release: DB-only tracking, claimed_amount tracks what's been minted to user

-- Add maturity tracking columns
ALTER TABLE vault_positions
  ADD COLUMN IF NOT EXISTS matured_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS renewed_from UUID REFERENCES vault_positions(id) DEFAULT NULL;

-- Add claimed_amount to release_schedules (tracks minted to user wallet)
ALTER TABLE release_schedules
  ADD COLUMN IF NOT EXISTS claimed_amount NUMERIC DEFAULT 0;

-- ── Mark matured positions (called by settle cron) ──
CREATE OR REPLACE FUNCTION process_vault_maturity()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  matured_count INT := 0;
  renewed_count INT := 0;
  pos RECORD;
  new_end TIMESTAMPTZ;
  plan_days INT;
BEGIN
  -- 1. Mark ACTIVE positions that passed end_date → MATURED
  UPDATE vault_positions
  SET status = 'MATURED', matured_at = NOW()
  WHERE status = 'ACTIVE'
    AND end_date IS NOT NULL
    AND end_date <= NOW()
    AND matured_at IS NULL;
  GET DIAGNOSTICS matured_count = ROW_COUNT;

  -- 2. Auto-renew positions past 24h window
  FOR pos IN
    SELECT * FROM vault_positions
    WHERE status = 'MATURED'
      AND matured_at IS NOT NULL
      AND matured_at + INTERVAL '24 hours' < NOW()
  LOOP
    -- Determine plan duration
    plan_days := CASE pos.plan_type
      WHEN '5_DAYS' THEN 5
      WHEN '45_DAYS' THEN 45
      WHEN '90_DAYS' THEN 90
      WHEN '180_DAYS' THEN 180
      WHEN '360_DAYS' THEN 360
      ELSE 90
    END;

    new_end := NOW() + (plan_days || ' days')::INTERVAL;

    -- Create new position (same principal, same plan)
    INSERT INTO vault_positions (
      user_id, plan_type, principal, daily_rate,
      start_date, end_date, status, is_bonus, bonus_yield_locked, renewed_from
    ) VALUES (
      pos.user_id, pos.plan_type, pos.principal, pos.daily_rate,
      NOW(), new_end, 'ACTIVE', false, false, pos.id
    );

    -- Mark old position as RENEWED
    UPDATE vault_positions SET status = 'RENEWED' WHERE id = pos.id;

    renewed_count := renewed_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'matured', matured_count,
    'renewed', renewed_count
  );
END;
$$;
