-- =============================================
-- 043: Node-Vault Activation & Qualification Check System
-- Links vault deposits to node rank activation
-- Implements periodic qualification checks with pass/fail consequences
-- =============================================

-- ─────────────────────────────────────────────
-- A) Add new columns to node_memberships
-- ─────────────────────────────────────────────
DO $$
BEGIN
  -- Which rank was activated via vault deposit
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'node_memberships' AND column_name = 'activated_rank'
  ) THEN
    ALTER TABLE node_memberships ADD COLUMN activated_rank TEXT DEFAULT NULL;
  END IF;

  -- Whether earnings are currently paused (for MAX qualification failures)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'node_memberships' AND column_name = 'earnings_paused'
  ) THEN
    ALTER TABLE node_memberships ADD COLUMN earnings_paused BOOLEAN DEFAULT FALSE;
  END IF;

  -- Amount of earnings destroyed (MINI day-90 V2 fail)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'node_memberships' AND column_name = 'destroyed_earnings'
  ) THEN
    ALTER TABLE node_memberships ADD COLUMN destroyed_earnings NUMERIC DEFAULT 0;
  END IF;

  -- Whether the frozen amount has been unlocked as MA
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'node_memberships' AND column_name = 'frozen_unlocked'
  ) THEN
    ALTER TABLE node_memberships ADD COLUMN frozen_unlocked BOOLEAN DEFAULT FALSE;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────
-- B) Add pass/fail action columns to node_milestones
-- ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'node_milestones' AND column_name = 'pass_action'
  ) THEN
    ALTER TABLE node_milestones ADD COLUMN pass_action TEXT DEFAULT 'CONTINUE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'node_milestones' AND column_name = 'fail_action'
  ) THEN
    ALTER TABLE node_milestones ADD COLUMN fail_action TEXT DEFAULT 'PAUSE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'node_milestones' AND column_name = 'earning_range'
  ) THEN
    ALTER TABLE node_milestones ADD COLUMN earning_range TEXT DEFAULT NULL;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────
-- C) Update milestone configs in system_config
-- ─────────────────────────────────────────────
INSERT INTO system_config (key, value) VALUES
  ('MINI_MILESTONES', '[
    {"rank":"V2","days":30,"pass_action":"UNLOCK_PARTIAL","fail_action":"KEEP_LOCKED","earning_range":"1-60","desc":"V2达标解锁1-60天收益"},
    {"rank":"V2","days":90,"pass_action":"UNLOCK_ALL","fail_action":"DESTROY","earning_range":"1-90","desc":"V2达标解锁全部收益"},
    {"rank":"V4","days":90,"pass_action":"UNLOCK_FROZEN","fail_action":"KEEP_FROZEN","earning_range":null,"desc":"V4达标解锁1000U铸造MA"}
  ]'),
  ('MAX_MILESTONES', '[
    {"rank":"V1","days":15,"pass_action":"CONTINUE","fail_action":"PAUSE","earning_range":"16-30","desc":"V1达标继续领取收益"},
    {"rank":"V2","days":30,"pass_action":"CONTINUE","fail_action":"PAUSE","earning_range":"31-60","desc":"V2达标继续领取收益"},
    {"rank":"V4","days":60,"pass_action":"CONTINUE","fail_action":"PAUSE","earning_range":"61-120","desc":"V4达标继续领取收益"},
    {"rank":"V6","days":120,"pass_action":"UNLOCK_FROZEN","fail_action":"KEEP_FROZEN","earning_range":null,"desc":"V6达标解锁6000U铸造MA"}
  ]'),
  ('MINI_ACTIVATION_TIERS', '[
    {"rank":"V1","vault_deposit":100,"required_mini_referrals":0},
    {"rank":"V2","vault_deposit":300,"required_mini_referrals":0},
    {"rank":"V3","vault_deposit":500,"required_mini_referrals":0},
    {"rank":"V4","vault_deposit":600,"required_mini_referrals":0}
  ]'),
  ('MAX_ACTIVATION_TIERS', '[
    {"rank":"V1","vault_deposit":100,"required_mini_referrals":3},
    {"rank":"V2","vault_deposit":300,"required_mini_referrals":0},
    {"rank":"V3","vault_deposit":500,"required_mini_referrals":0},
    {"rank":"V4","vault_deposit":600,"required_mini_referrals":0},
    {"rank":"V5","vault_deposit":800,"required_mini_referrals":0},
    {"rank":"V6","vault_deposit":1000,"required_mini_referrals":0}
  ]')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- ─────────────────────────────────────────────
-- D) Function: check_node_activation
-- Checks vault deposits and activates node rank accordingly
-- Called on vault_deposit and periodically
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_node_activation(addr TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  v_vault_deposited NUMERIC := 0;
  v_mini_referrals INT := 0;
  membership RECORD;
  tiers_json JSONB;
  tier JSONB;
  best_rank TEXT := NULL;
  best_rank_idx INT := 0;
  tier_rank_idx INT;
  tier_vault NUMERIC;
  tier_refs INT;
  activated_count INT := 0;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Profile not found');
  END IF;

  -- Get total vault deposits
  SELECT COALESCE(SUM(principal), 0) INTO v_vault_deposited
  FROM vault_positions
  WHERE user_id = profile_row.id AND status IN ('ACTIVE', 'COMPLETED');

  -- Get count of direct referrals who have MINI nodes
  SELECT COUNT(DISTINCT nm.user_id) INTO v_mini_referrals
  FROM node_memberships nm
  JOIN profiles p ON p.id = nm.user_id
  WHERE p.referrer_id = profile_row.id
    AND nm.node_type = 'MINI'
    AND nm.status IN ('ACTIVE', 'PENDING_MILESTONES');

  -- Process each node membership
  FOR membership IN
    SELECT * FROM node_memberships
    WHERE user_id = profile_row.id
      AND status IN ('ACTIVE', 'PENDING_MILESTONES')
  LOOP
    -- Get activation tiers for this node type
    IF membership.node_type = 'MAX' THEN
      SELECT value::JSONB INTO tiers_json FROM system_config WHERE key = 'MAX_ACTIVATION_TIERS';
    ELSE
      SELECT value::JSONB INTO tiers_json FROM system_config WHERE key = 'MINI_ACTIVATION_TIERS';
    END IF;

    IF tiers_json IS NULL THEN CONTINUE; END IF;

    -- Find the highest tier the user qualifies for
    best_rank := NULL;
    best_rank_idx := 0;

    FOR tier IN SELECT * FROM jsonb_array_elements(tiers_json)
    LOOP
      tier_vault := (tier->>'vault_deposit')::NUMERIC;
      tier_refs := COALESCE((tier->>'required_mini_referrals')::INT, 0);
      tier_rank_idx := CASE
        WHEN tier->>'rank' = 'V1' THEN 1 WHEN tier->>'rank' = 'V2' THEN 2
        WHEN tier->>'rank' = 'V3' THEN 3 WHEN tier->>'rank' = 'V4' THEN 4
        WHEN tier->>'rank' = 'V5' THEN 5 WHEN tier->>'rank' = 'V6' THEN 6
        WHEN tier->>'rank' = 'V7' THEN 7 ELSE 0
      END;

      IF v_vault_deposited >= tier_vault AND v_mini_referrals >= tier_refs THEN
        IF tier_rank_idx > best_rank_idx THEN
          best_rank := tier->>'rank';
          best_rank_idx := tier_rank_idx;
        END IF;
      END IF;
    END LOOP;

    -- Update the membership if a new activation rank is found
    IF best_rank IS NOT NULL THEN
      -- Only update if rank improved or was not set
      IF membership.activated_rank IS NULL OR best_rank_idx > CASE
        WHEN membership.activated_rank = 'V1' THEN 1 WHEN membership.activated_rank = 'V2' THEN 2
        WHEN membership.activated_rank = 'V3' THEN 3 WHEN membership.activated_rank = 'V4' THEN 4
        WHEN membership.activated_rank = 'V5' THEN 5 WHEN membership.activated_rank = 'V6' THEN 6
        ELSE 0
      END THEN
        UPDATE node_memberships
        SET activated_rank = best_rank,
            status = CASE WHEN status = 'PENDING_MILESTONES' AND activated_rank IS NULL THEN 'PENDING_MILESTONES' ELSE status END,
            earnings_capacity = CASE WHEN activated_rank IS NULL THEN 1.0 ELSE earnings_capacity END
        WHERE id = membership.id;

        -- Update profile rank to activated rank if it's higher
        UPDATE profiles
        SET rank = best_rank
        WHERE id = profile_row.id
          AND (rank IS NULL OR CASE
            WHEN rank = 'V1' THEN 1 WHEN rank = 'V2' THEN 2 WHEN rank = 'V3' THEN 3
            WHEN rank = 'V4' THEN 4 WHEN rank = 'V5' THEN 5 WHEN rank = 'V6' THEN 6
            WHEN rank = 'V7' THEN 7 ELSE 0
          END < best_rank_idx);

        activated_count := activated_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'activated', activated_count,
    'vaultDeposited', v_vault_deposited,
    'miniReferrals', v_mini_referrals
  );
END;
$$;

-- ─────────────────────────────────────────────
-- E) Rewrite check_node_milestones with new qualification logic
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_node_milestones(addr TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  ms RECORD;
  user_rank_index INT;
  required_rank_index INT;
  achieved_count INT := 0;
  failed_count INT := 0;
  days_since_start INT;
  actual_rank TEXT;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Profile not found');
  END IF;

  -- First, run activation check
  PERFORM check_node_activation(addr);

  -- Re-read profile after activation
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;

  user_rank_index := CASE
    WHEN profile_row.rank = 'V1' THEN 1 WHEN profile_row.rank = 'V2' THEN 2
    WHEN profile_row.rank = 'V3' THEN 3 WHEN profile_row.rank = 'V4' THEN 4
    WHEN profile_row.rank = 'V5' THEN 5 WHEN profile_row.rank = 'V6' THEN 6
    WHEN profile_row.rank = 'V7' THEN 7 ELSE 0
  END;

  -- Process each pending milestone
  FOR ms IN
    SELECT nm_ms.*, nm.user_id, nm.node_type, nm.total_milestones, nm.id AS mem_id,
           nm.locked_earnings, nm.frozen_amount, nm.start_date AS node_start_date,
           nm.activated_rank, nm.earnings_paused
    FROM node_milestones nm_ms
    JOIN node_memberships nm ON nm.id = nm_ms.membership_id
    WHERE nm.user_id = profile_row.id
      AND nm.status = 'PENDING_MILESTONES'
      AND nm_ms.status = 'PENDING'
      AND nm.activated_rank IS NOT NULL  -- Only check milestones for activated nodes
    ORDER BY nm_ms.deadline_days ASC, nm_ms.milestone_index ASC
  LOOP
    -- Calculate days since node start
    days_since_start := EXTRACT(DAY FROM (NOW() - ms.node_start_date));

    -- Skip if we haven't reached the check day yet
    IF days_since_start < ms.deadline_days THEN
      CONTINUE;
    END IF;

    required_rank_index := CASE
      WHEN ms.required_rank = 'V1' THEN 1 WHEN ms.required_rank = 'V2' THEN 2
      WHEN ms.required_rank = 'V3' THEN 3 WHEN ms.required_rank = 'V4' THEN 4
      WHEN ms.required_rank = 'V5' THEN 5 WHEN ms.required_rank = 'V6' THEN 6
      WHEN ms.required_rank = 'V7' THEN 7 ELSE 0
    END;

    IF user_rank_index >= required_rank_index THEN
      -- ===== PASSED =====
      UPDATE node_milestones SET status = 'ACHIEVED', achieved_at = NOW()
      WHERE id = ms.id;

      UPDATE node_memberships
      SET milestone_stage = milestone_stage + 1
      WHERE id = ms.mem_id;

      -- Execute pass action
      IF COALESCE(ms.pass_action, 'CONTINUE') = 'UNLOCK_PARTIAL' THEN
        -- MINI Day 30 V2 pass: unlock locked earnings (days 1-60 worth)
        UPDATE node_memberships
        SET released_earnings = released_earnings + COALESCE(locked_earnings, 0),
            available_balance = available_balance + COALESCE(locked_earnings, 0),
            locked_earnings = 0
        WHERE id = ms.mem_id;

      ELSIF ms.pass_action = 'UNLOCK_ALL' THEN
        -- MINI Day 90 V2 pass: unlock all remaining locked earnings
        UPDATE node_memberships
        SET released_earnings = released_earnings + COALESCE(locked_earnings, 0),
            available_balance = available_balance + COALESCE(locked_earnings, 0),
            locked_earnings = 0
        WHERE id = ms.mem_id;

      ELSIF ms.pass_action = 'UNLOCK_FROZEN' THEN
        -- MINI Day 90 V4 pass / MAX Day 120 V6 pass: unlock frozen amount as MA
        UPDATE node_memberships
        SET frozen_unlocked = TRUE,
            available_balance = available_balance + frozen_amount
        WHERE id = ms.mem_id AND NOT frozen_unlocked;

      ELSIF ms.pass_action = 'CONTINUE' THEN
        -- MAX: resume/continue earnings
        UPDATE node_memberships
        SET earnings_paused = FALSE
        WHERE id = ms.mem_id;
      END IF;

      achieved_count := achieved_count + 1;

    ELSE
      -- ===== FAILED =====
      UPDATE node_milestones SET status = 'FAILED'
      WHERE id = ms.id;

      -- Execute fail action
      IF COALESCE(ms.fail_action, 'PAUSE') = 'KEEP_LOCKED' THEN
        -- MINI Day 30 V2 fail: earnings stay locked, rank drops to actual
        -- Calculate actual rank from vault deposits
        actual_rank := NULL;
        SELECT p.rank INTO actual_rank FROM profiles p WHERE p.id = ms.user_id;
        -- Rank already reflects actual state

      ELSIF ms.fail_action = 'DESTROY' THEN
        -- MINI Day 90 V2 fail: destroy all locked earnings
        UPDATE node_memberships
        SET destroyed_earnings = COALESCE(destroyed_earnings, 0) + COALESCE(locked_earnings, 0),
            locked_earnings = 0
        WHERE id = ms.mem_id;

      ELSIF ms.fail_action = 'PAUSE' THEN
        -- MAX: pause earnings until next check
        UPDATE node_memberships
        SET earnings_paused = TRUE
        WHERE id = ms.mem_id;

      ELSIF ms.fail_action = 'KEEP_FROZEN' THEN
        -- Cannot unlock frozen amount, keep as is
        NULL;
      END IF;

      failed_count := failed_count + 1;
    END IF;
  END LOOP;

  -- Promote fully-achieved nodes to ACTIVE
  UPDATE node_memberships
  SET status = 'ACTIVE'
  WHERE user_id = profile_row.id
    AND status = 'PENDING_MILESTONES'
    AND milestone_stage >= total_milestones;

  -- Update profile node_type
  UPDATE profiles SET node_type = (
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM node_memberships WHERE user_id = profile_row.id AND node_type = 'MAX' AND status IN ('ACTIVE', 'PENDING_MILESTONES'))
      THEN 'MAX'
      WHEN EXISTS (SELECT 1 FROM node_memberships WHERE user_id = profile_row.id AND node_type = 'MINI' AND status IN ('ACTIVE', 'PENDING_MILESTONES'))
      THEN 'MINI'
      ELSE 'NONE'
    END
  ) WHERE id = profile_row.id;

  RETURN jsonb_build_object('achieved', achieved_count, 'failed', failed_count);
END;
$$;

-- ─────────────────────────────────────────────
-- F) Update settle_node_fixed_yield for paused earnings and locking
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION settle_node_fixed_yield()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  node RECORD;
  daily_profit NUMERIC;
  total_settled NUMERIC := 0;
  nodes_processed INT := 0;
  days_since_start INT;
BEGIN
  FOR node IN
    SELECT nm.*, p.id AS profile_id, p.rank AS user_rank
    FROM node_memberships nm
    JOIN profiles p ON p.id = nm.user_id
    WHERE nm.status IN ('ACTIVE', 'PENDING_MILESTONES')
      AND nm.activated_rank IS NOT NULL  -- Must be activated via vault deposit
      AND (nm.end_date IS NULL OR nm.end_date > NOW())
  LOOP
    -- Skip if earnings are paused (MAX node failed qualification)
    IF COALESCE(node.earnings_paused, FALSE) THEN
      nodes_processed := nodes_processed + 1;
      CONTINUE;
    END IF;

    -- Calculate daily profit: frozen_amount * daily_rate
    daily_profit := node.frozen_amount * COALESCE(node.daily_rate, 0.009);

    IF daily_profit <= 0 THEN
      CONTINUE;
    END IF;

    -- Calculate days since node start (earnings start day after activation)
    days_since_start := EXTRACT(DAY FROM (NOW() - node.start_date));
    IF days_since_start < 1 THEN
      CONTINUE; -- Earnings start the day after activation
    END IF;

    IF node.node_type = 'MINI' THEN
      -- MINI: all earnings go to locked until V2 qualification at day 30
      -- After V2 pass at day 30, locked earnings are released via check_node_milestones
      -- Daily earnings still accumulate as locked until day 90 check
      UPDATE node_memberships
      SET locked_earnings = locked_earnings + daily_profit
      WHERE id = node.id;

      -- Record the earning
      INSERT INTO node_rewards (user_id, reward_type, amount, details)
      VALUES (node.user_id, 'FIXED_YIELD', daily_profit,
        jsonb_build_object('node_type', node.node_type, 'frozen_amount', node.frozen_amount,
          'daily_rate', node.daily_rate, 'status', 'LOCKED', 'day', days_since_start));

    ELSE
      -- MAX: earnings go directly to released (not locked)
      UPDATE node_memberships
      SET released_earnings = released_earnings + daily_profit,
          available_balance = available_balance + daily_profit
      WHERE id = node.id;

      INSERT INTO node_rewards (user_id, reward_type, amount, details)
      VALUES (node.user_id, 'FIXED_YIELD', daily_profit,
        jsonb_build_object('node_type', node.node_type, 'frozen_amount', node.frozen_amount,
          'daily_rate', node.daily_rate, 'status', 'RELEASED', 'day', days_since_start));
    END IF;

    total_settled := total_settled + daily_profit;
    nodes_processed := nodes_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('nodesProcessed', nodes_processed, 'totalSettled', ROUND(total_settled, 6)::TEXT);
END;
$$;

-- ─────────────────────────────────────────────
-- G) Update purchase_node to use new activation system
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION purchase_node(
  addr TEXT,
  node_type_param TEXT,
  tx_hash TEXT DEFAULT NULL,
  payment_mode_param TEXT DEFAULT 'FULL'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  contribution NUMERIC;
  frozen NUMERIC;
  daily_rate_val NUMERIC;
  node_duration INT;
  membership node_memberships%ROWTYPE;
  milestones_json JSONB;
  milestone JSONB;
  m_index INT := 0;
  total_m INT;
  highest_node TEXT;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF node_type_param = 'MAX' THEN
    contribution := 600;
    frozen := 6000;
    daily_rate_val := 0.009;
    node_duration := 120;
    SELECT value::JSONB INTO milestones_json FROM system_config WHERE key = 'MAX_MILESTONES';
  ELSE
    contribution := 100;
    frozen := 1000;
    daily_rate_val := 0.009;
    node_duration := 90;
    SELECT value::JSONB INTO milestones_json FROM system_config WHERE key = 'MINI_MILESTONES';
  END IF;

  total_m := jsonb_array_length(COALESCE(milestones_json, '[]'::JSONB));

  -- Create membership in PENDING_MILESTONES status (needs vault deposit to activate)
  INSERT INTO node_memberships (
    user_id, node_type, price, contribution_amount, frozen_amount, daily_rate,
    status, start_date, end_date,
    payment_mode, deposit_amount, milestone_stage, total_milestones, earnings_capacity,
    locked_earnings, released_earnings, available_balance,
    activated_rank, earnings_paused, destroyed_earnings, frozen_unlocked
  )
  VALUES (
    profile_row.id, node_type_param, contribution + frozen,
    contribution, frozen, daily_rate_val,
    'PENDING_MILESTONES', NOW(), NOW() + (node_duration || ' days')::INTERVAL,
    'FULL', contribution, 0, total_m, 0.0,
    0, 0, 0,
    NULL, FALSE, 0, FALSE
  )
  RETURNING * INTO membership;

  -- Create milestone rows with pass/fail actions
  IF milestones_json IS NOT NULL THEN
    FOR milestone IN SELECT * FROM jsonb_array_elements(milestones_json)
    LOOP
      INSERT INTO node_milestones (
        membership_id, milestone_index, required_rank, deadline_days, deadline_at,
        pass_action, fail_action, earning_range
      )
      VALUES (
        membership.id,
        m_index,
        milestone->>'rank',
        (milestone->>'days')::INT,
        NOW() + ((milestone->>'days')::INT || ' days')::INTERVAL,
        COALESCE(milestone->>'pass_action', 'CONTINUE'),
        COALESCE(milestone->>'fail_action', 'PAUSE'),
        milestone->>'earning_range'
      );
      m_index := m_index + 1;
    END LOOP;
  END IF;

  -- Record purchase transaction
  INSERT INTO transactions (user_id, type, token, amount, tx_hash, status, details)
  VALUES (profile_row.id, 'NODE_PURCHASE', 'USDC', contribution + frozen, tx_hash, 'CONFIRMED',
    jsonb_build_object('node_type', node_type_param, 'contribution', contribution, 'frozen', frozen));

  -- Update profile node_type
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM node_memberships WHERE user_id = profile_row.id AND node_type = 'MAX' AND status IN ('ACTIVE', 'PENDING_MILESTONES'))
    THEN 'MAX'
    WHEN EXISTS (SELECT 1 FROM node_memberships WHERE user_id = profile_row.id AND node_type = 'MINI' AND status IN ('ACTIVE', 'PENDING_MILESTONES'))
    THEN 'MINI'
    ELSE 'NONE'
  END INTO highest_node;

  UPDATE profiles SET node_type = highest_node WHERE id = profile_row.id;

  -- Immediately check if vault deposits already qualify for activation
  PERFORM check_node_activation(addr);

  RETURN to_jsonb(membership);
END;
$$;

-- ─────────────────────────────────────────────
-- H) Update get_node_overview to include new fields
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_node_overview(addr TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  nodes_json JSONB;
  fixed_yield_total NUMERIC;
  pool_dividend_total NUMERIC;
  team_commission_total NUMERIC;
  pool_balance NUMERIC;
  pool_updated TIMESTAMPTZ;
  total_available NUMERIC;
  total_locked NUMERIC;
  total_released NUMERIC;
  total_destroyed NUMERIC;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    RETURN jsonb_build_object(
      'nodes', '[]'::JSONB, 'rewards', NULL, 'pool', NULL,
      'rank', 'V0', 'availableBalance', '0', 'lockedEarnings', '0',
      'releasedEarnings', '0', 'destroyedEarnings', '0'
    );
  END IF;

  SELECT COALESCE(jsonb_agg(
    to_jsonb(nm) || jsonb_build_object(
      'milestones', COALESCE(
        (SELECT jsonb_agg(to_jsonb(ms) ORDER BY ms.milestone_index)
         FROM node_milestones ms WHERE ms.membership_id = nm.id),
        '[]'::JSONB
      )
    )
  ORDER BY nm.start_date DESC), '[]'::JSONB)
  INTO nodes_json
  FROM node_memberships nm
  WHERE nm.user_id = profile_row.id;

  SELECT COALESCE(SUM(amount), 0) INTO fixed_yield_total
  FROM node_rewards WHERE user_id = profile_row.id AND reward_type = 'FIXED_YIELD';

  SELECT COALESCE(SUM(amount), 0) INTO pool_dividend_total
  FROM node_rewards WHERE user_id = profile_row.id AND reward_type = 'POOL_DIVIDEND';

  SELECT COALESCE(SUM(amount), 0) INTO team_commission_total
  FROM node_rewards WHERE user_id = profile_row.id AND reward_type = 'TEAM_COMMISSION';

  SELECT balance, updated_at INTO pool_balance, pool_updated
  FROM revenue_pools WHERE pool_name = 'NODE_POOL';

  SELECT
    COALESCE(SUM(available_balance), 0),
    COALESCE(SUM(locked_earnings), 0),
    COALESCE(SUM(released_earnings), 0),
    COALESCE(SUM(destroyed_earnings), 0)
  INTO total_available, total_locked, total_released, total_destroyed
  FROM node_memberships
  WHERE user_id = profile_row.id AND status IN ('ACTIVE', 'PENDING_MILESTONES');

  RETURN jsonb_build_object(
    'nodes', nodes_json,
    'rank', COALESCE(profile_row.rank, 'V0'),
    'availableBalance', COALESCE(ROUND(total_available, 2), 0)::TEXT,
    'lockedEarnings', COALESCE(ROUND(total_locked, 2), 0)::TEXT,
    'releasedEarnings', COALESCE(ROUND(total_released, 2), 0)::TEXT,
    'destroyedEarnings', COALESCE(ROUND(total_destroyed, 2), 0)::TEXT,
    'rewards', jsonb_build_object(
      'fixedYield', COALESCE(ROUND(fixed_yield_total, 2), 0)::TEXT,
      'poolDividend', COALESCE(ROUND(pool_dividend_total, 2), 0)::TEXT,
      'teamCommission', COALESCE(ROUND(team_commission_total, 2), 0)::TEXT,
      'totalEarnings', COALESCE(ROUND(fixed_yield_total + pool_dividend_total + team_commission_total, 2), 0)::TEXT
    ),
    'pool', jsonb_build_object(
      'balance', COALESCE(ROUND(pool_balance, 2), 0)::TEXT,
      'updatedAt', pool_updated
    )
  );
END;
$$;

-- ─────────────────────────────────────────────
-- I) Update vault_deposit to trigger node activation check
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION vault_deposit(addr TEXT, plan_type TEXT, deposit_amount NUMERIC, tx_hash TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  plan_days INT;
  plan_rate NUMERIC;
  end_dt TIMESTAMP;
  min_amount NUMERIC;
  pos vault_positions%ROWTYPE;
  tx transactions%ROWTYPE;
  upline_id VARCHAR;
  current_id VARCHAR;
  depth INT := 0;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    INSERT INTO profiles (wallet_address) VALUES (addr) RETURNING * INTO profile_row;
  END IF;

  SELECT value::NUMERIC INTO min_amount FROM system_config WHERE key = 'VAULT_MIN_AMOUNT';
  IF min_amount IS NULL THEN min_amount := 50; END IF;

  IF deposit_amount < min_amount THEN
    RAISE EXCEPTION 'Minimum deposit is % USDC', min_amount;
  END IF;

  IF plan_type = '5_DAYS' THEN plan_days := 5; plan_rate := 0.005;
  ELSIF plan_type = '45_DAYS' THEN plan_days := 45; plan_rate := 0.007;
  ELSIF plan_type = '90_DAYS' THEN plan_days := 90; plan_rate := 0.009;
  ELSIF plan_type = '180_DAYS' THEN plan_days := 180; plan_rate := 0.012;
  ELSIF plan_type = '360_DAYS' THEN plan_days := 360; plan_rate := 0.015;
  ELSE
    RAISE EXCEPTION 'Invalid plan type: %', plan_type;
  END IF;

  end_dt := NOW() + (plan_days || ' days')::INTERVAL;

  INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, end_date, status)
  VALUES (profile_row.id, plan_type, deposit_amount, plan_rate, end_dt, 'ACTIVE')
  RETURNING * INTO pos;

  INSERT INTO transactions (user_id, type, token, amount, tx_hash, status)
  VALUES (profile_row.id, 'DEPOSIT', 'USDC', deposit_amount, tx_hash, 'CONFIRMED')
  RETURNING * INTO tx;

  UPDATE profiles SET total_deposited = COALESCE(total_deposited, 0) + deposit_amount
  WHERE id = profile_row.id;

  -- Auto rank promotion: check depositor
  PERFORM check_rank_promotion(addr);

  -- Check node activation based on new vault deposit
  PERFORM check_node_activation(addr);

  -- Auto rank promotion: check upline chain (up to 15 levels)
  current_id := profile_row.id;
  LOOP
    depth := depth + 1;
    IF depth > 15 THEN EXIT; END IF;

    SELECT referrer_id INTO upline_id FROM profiles WHERE id = current_id;
    IF upline_id IS NULL THEN EXIT; END IF;

    PERFORM check_rank_promotion(
      (SELECT wallet_address FROM profiles WHERE id = upline_id)
    );

    current_id := upline_id;
  END LOOP;

  RETURN jsonb_build_object('position', to_jsonb(pos), 'transaction', to_jsonb(tx));
END;
$$;

-- ─────────────────────────────────────────────
-- J) Update daily settlement to include node activation + milestone checks
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION run_daily_settlement()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  vault_result JSONB;
  node_result JSONB;
  release_result JSONB;
  revenue_result JSONB;
  rank_result JSONB;
  milestone_result JSONB;
  node_active BOOLEAN;
  p RECORD;
BEGIN
  -- 1. Settle vault daily yields
  SELECT settle_vault_daily() INTO vault_result;

  -- 2. Check if node system is active
  SELECT COALESCE(value::BOOLEAN, FALSE) INTO node_active
  FROM system_config WHERE key = 'NODE_SYSTEM_ACTIVE';

  IF node_active THEN
    -- 2a. Check all node activations first
    FOR p IN
      SELECT DISTINCT pr.wallet_address
      FROM profiles pr
      JOIN node_memberships nm ON nm.user_id = pr.id
      WHERE nm.status IN ('ACTIVE', 'PENDING_MILESTONES')
    LOOP
      PERFORM check_node_activation(p.wallet_address);
    END LOOP;

    -- 2b. Settle node fixed yield
    SELECT settle_node_fixed_yield() INTO node_result;

    -- 2c. Check all milestones
    FOR p IN
      SELECT DISTINCT pr.wallet_address
      FROM profiles pr
      JOIN node_memberships nm ON nm.user_id = pr.id
      WHERE nm.status = 'PENDING_MILESTONES'
    LOOP
      PERFORM check_node_milestones(p.wallet_address);
    END LOOP;

    SELECT distribute_daily_revenue() INTO revenue_result;
  ELSE
    node_result := '{"skipped": true, "reason": "NODE_SYSTEM_INACTIVE"}'::JSONB;
    revenue_result := '{"skipped": true}'::JSONB;
  END IF;

  -- 3. Process pending earnings releases
  SELECT process_pending_releases() INTO release_result;

  -- 4. Batch check rank promotions
  SELECT batch_check_rank_promotions() INTO rank_result;

  RETURN jsonb_build_object(
    'vault', vault_result,
    'node', node_result,
    'revenue', revenue_result,
    'releases', release_result,
    'ranks', rank_result,
    'settledAt', NOW()::TEXT
  );
END;
$$;

-- ─────────────────────────────────────────────
-- K) Update get_node_milestone_requirements to include activation info
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_node_milestone_requirements(addr TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_vault_deposited NUMERIC := 0;
  v_direct_node_referrals INT := 0;
  v_direct_mini_referrals INT := 0;
  v_activated_rank TEXT := NULL;
  v_earnings_paused BOOLEAN := FALSE;
BEGIN
  SELECT id INTO v_user_id
  FROM profiles
  WHERE wallet_address = lower(addr);

  IF v_user_id IS NULL THEN
    RETURN json_build_object(
      'vault_deposited', 0,
      'direct_node_referrals', 0,
      'direct_mini_referrals', 0,
      'activated_rank', NULL,
      'earnings_paused', FALSE
    );
  END IF;

  SELECT COALESCE(SUM(principal), 0) INTO v_vault_deposited
  FROM vault_positions
  WHERE user_id = v_user_id
    AND status IN ('ACTIVE', 'COMPLETED');

  SELECT COUNT(*) INTO v_direct_node_referrals
  FROM node_memberships nm
  JOIN profiles p ON p.id = nm.user_id
  WHERE p.referrer_id = v_user_id
    AND nm.status IN ('ACTIVE', 'PENDING_MILESTONES');

  SELECT COUNT(DISTINCT nm.user_id) INTO v_direct_mini_referrals
  FROM node_memberships nm
  JOIN profiles p ON p.id = nm.user_id
  WHERE p.referrer_id = v_user_id
    AND nm.node_type = 'MINI'
    AND nm.status IN ('ACTIVE', 'PENDING_MILESTONES');

  -- Get activated rank and pause status from latest node
  SELECT nm.activated_rank, nm.earnings_paused
  INTO v_activated_rank, v_earnings_paused
  FROM node_memberships nm
  WHERE nm.user_id = v_user_id
    AND nm.status IN ('ACTIVE', 'PENDING_MILESTONES')
  ORDER BY nm.start_date DESC
  LIMIT 1;

  RETURN json_build_object(
    'vault_deposited', v_vault_deposited,
    'direct_node_referrals', v_direct_node_referrals,
    'direct_mini_referrals', v_direct_mini_referrals,
    'activated_rank', v_activated_rank,
    'earnings_paused', COALESCE(v_earnings_paused, FALSE)
  );
END;
$$;

-- ─────────────────────────────────────────────
-- L) Trigger: auto-check node activation on vault deposit insert
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_check_node_activation_on_vault()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_wallet TEXT;
BEGIN
  -- Get wallet address for the depositing user
  SELECT wallet_address INTO v_wallet
  FROM profiles WHERE id = NEW.user_id;

  IF v_wallet IS NOT NULL THEN
    -- Check if user has any node memberships
    IF EXISTS (
      SELECT 1 FROM node_memberships
      WHERE user_id = NEW.user_id AND status IN ('ACTIVE', 'PENDING_MILESTONES')
    ) THEN
      PERFORM check_node_activation(v_wallet);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vault_deposit_check_node ON vault_positions;
CREATE TRIGGER trg_vault_deposit_check_node
  AFTER INSERT ON vault_positions
  FOR EACH ROW
  EXECUTE FUNCTION trigger_check_node_activation_on_vault();

-- ─────────────────────────────────────────────
-- M) Trigger: auto-check node activation when new MINI node is created
-- (for MAX node V1 that requires 3 small node referrals)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_check_referrer_node_activation()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_referrer_wallet TEXT;
  v_referrer_id UUID;
BEGIN
  IF NEW.node_type = 'MINI' THEN
    -- Get the referrer of this MINI node user
    SELECT referrer_id INTO v_referrer_id
    FROM profiles WHERE id = NEW.user_id;

    IF v_referrer_id IS NOT NULL THEN
      SELECT wallet_address INTO v_referrer_wallet
      FROM profiles WHERE id = v_referrer_id;

      IF v_referrer_wallet IS NOT NULL THEN
        -- Check if referrer has MAX node pending activation
        IF EXISTS (
          SELECT 1 FROM node_memberships
          WHERE user_id = v_referrer_id
            AND node_type = 'MAX'
            AND status IN ('ACTIVE', 'PENDING_MILESTONES')
        ) THEN
          PERFORM check_node_activation(v_referrer_wallet);
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mini_node_check_referrer ON node_memberships;
CREATE TRIGGER trg_mini_node_check_referrer
  AFTER INSERT ON node_memberships
  FOR EACH ROW
  EXECUTE FUNCTION trigger_check_referrer_node_activation();
