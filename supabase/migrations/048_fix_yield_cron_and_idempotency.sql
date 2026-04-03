-- 048: Fix yield cron timing + idempotency + JWT fixes
-- 1. daily-settlement → SGT noon (UTC 04:00)
-- 2. settle-node-interest cron → SGT 12:05 (UTC 04:05)
-- 3. settle_node_fixed_yield idempotency guard
-- 4. vault-bridge-flush JWT fix (was 401 Invalid JWT for all 29 runs)
-- 5. settle-node-interest JWT fix (was using unavailable current_setting)

-- ─── 1. Reschedule daily-settlement to SGT noon ────────────────────
SELECT cron.unschedule('daily-settlement');
SELECT cron.schedule('daily-settlement', '0 4 * * *', $$SELECT run_daily_settlement()$$);

-- ─── 2. Add settle-node-interest cron (5 min after daily settlement) ───
SELECT cron.unschedule('settle-node-interest');
SELECT cron.schedule(
  'settle-node-interest',
  '5 4 * * *',
  $$SELECT net.http_post(
    url := 'https://enedbksmftcgtszrkppc.supabase.co/functions/v1/settle-node-interest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuZWRia3NtZnRjZ3RzenJrcHBjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzc5MzEyMCwiZXhwIjoyMDg5MzY5MTIwfQ.URK9Jw6uW0XbqB30dSQwE_x576Y0-6w-Ximb2gW6H5A'
    ),
    body := '{}'::jsonb
  )$$
);

-- ─── 4. Fix vault-bridge-flush JWT (was using wrong token → 401 on all runs) ───
SELECT cron.unschedule('vault-bridge-flush');
SELECT cron.schedule(
  'vault-bridge-flush',
  '*/10 * * * *',
  $$SELECT net.http_post(
    url := 'https://enedbksmftcgtszrkppc.supabase.co/functions/v1/vault-bridge-flush',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuZWRia3NtZnRjZ3RzenJrcHBjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzc5MzEyMCwiZXhwIjoyMDg5MzY5MTIwfQ.URK9Jw6uW0XbqB30dSQwE_x576Y0-6w-Ximb2gW6H5A'
    ),
    body := '{}'::jsonb
  )$$
);

-- ─── 3. settle_node_fixed_yield with idempotency guard ─────────────
CREATE OR REPLACE FUNCTION settle_node_fixed_yield()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  node RECORD;
  daily_profit NUMERIC;
  total_settled NUMERIC := 0;
  nodes_processed INT := 0;
  days_since_activation INT;
  already_settled BOOLEAN;
  today_start TIMESTAMP := date_trunc('day', NOW() AT TIME ZONE 'Asia/Singapore') AT TIME ZONE 'Asia/Singapore';
BEGIN
  FOR node IN
    SELECT nm.*, p.id AS profile_id, p.rank AS user_rank
    FROM node_memberships nm
    JOIN profiles p ON p.id = nm.user_id
    WHERE nm.status IN ('ACTIVE', 'PENDING_MILESTONES')
      AND nm.activated_rank IS NOT NULL
      AND nm.activated_at IS NOT NULL
      AND (nm.end_date IS NULL OR nm.end_date > NOW())
  LOOP
    IF COALESCE(node.earnings_paused, FALSE) THEN
      nodes_processed := nodes_processed + 1;
      CONTINUE;
    END IF;

    -- Idempotency guard: skip if already settled today (SGT)
    SELECT EXISTS(
      SELECT 1 FROM node_rewards
      WHERE user_id = node.user_id
        AND reward_type = 'FIXED_YIELD'
        AND created_at >= today_start
        AND (details->>'node_type') = node.node_type
    ) INTO already_settled;
    IF already_settled THEN
      nodes_processed := nodes_processed + 1;
      CONTINUE;
    END IF;

    daily_profit := node.frozen_amount * COALESCE(node.daily_rate, 0.009);
    IF daily_profit <= 0 THEN CONTINUE; END IF;

    days_since_activation := EXTRACT(DAY FROM (NOW() - node.activated_at));
    IF days_since_activation < 1 THEN CONTINUE; END IF;

    IF node.node_type = 'MINI' THEN
      UPDATE node_memberships SET locked_earnings = locked_earnings + daily_profit WHERE id = node.id;
      INSERT INTO node_rewards (user_id, reward_type, amount, details)
      VALUES (node.user_id, 'FIXED_YIELD', daily_profit,
        jsonb_build_object('node_type', 'MINI', 'frozen_amount', node.frozen_amount,
          'daily_rate', node.daily_rate, 'status', 'LOCKED', 'day', days_since_activation));
    ELSE
      UPDATE node_memberships
      SET released_earnings = released_earnings + daily_profit,
          available_balance = available_balance + daily_profit
      WHERE id = node.id;
      INSERT INTO node_rewards (user_id, reward_type, amount, details)
      VALUES (node.user_id, 'FIXED_YIELD', daily_profit,
        jsonb_build_object('node_type', 'MAX', 'frozen_amount', node.frozen_amount,
          'daily_rate', node.daily_rate, 'status', 'RELEASED', 'day', days_since_activation));
    END IF;

    total_settled := total_settled + daily_profit;
    nodes_processed := nodes_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('nodesProcessed', nodes_processed, 'totalSettled', ROUND(total_settled, 6)::TEXT);
END;
$fn$;
