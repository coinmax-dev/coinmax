-- =============================================
-- 009: Pause Node System Until Vault Goes Live
-- - Add NODE_SYSTEM_ACTIVE flag (default false)
-- - Settlement and milestone checks respect this flag
-- - activate_node_system() resets all milestone deadlines from NOW
-- =============================================

-- A) Add system flag
INSERT INTO system_config (key, value) VALUES
  ('NODE_SYSTEM_ACTIVE', 'false')
ON CONFLICT (key) DO UPDATE SET value = 'false', updated_at = NOW();

-- B) Update settle_node_fixed_yield to check flag
CREATE OR REPLACE FUNCTION settle_node_fixed_yield()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  node RECORD;
  daily_profit NUMERIC;
  total_settled NUMERIC := 0;
  nodes_processed INT := 0;
  system_active BOOLEAN;
BEGIN
  SELECT value::BOOLEAN INTO system_active FROM system_config WHERE key = 'NODE_SYSTEM_ACTIVE';
  IF NOT COALESCE(system_active, false) THEN
    RETURN jsonb_build_object('nodesProcessed', 0, 'totalSettled', '0', 'paused', true);
  END IF;

  FOR node IN
    SELECT nm.*, p.id AS profile_id, p.rank AS user_rank
    FROM node_memberships nm
    JOIN profiles p ON p.id = nm.user_id
    WHERE nm.status IN ('ACTIVE', 'PENDING_MILESTONES')
      AND (nm.end_date IS NULL OR nm.end_date > NOW())
  LOOP
    daily_profit := node.frozen_amount * COALESCE(node.daily_rate, 0) * COALESCE(node.earnings_capacity, 0);

    IF node.node_type = 'MINI' AND node.milestone_stage < 1 THEN
      UPDATE node_memberships
      SET locked_earnings = locked_earnings + daily_profit
      WHERE id = node.id;
    ELSE
      IF daily_profit > 0 THEN
        UPDATE node_memberships
        SET released_earnings = released_earnings + daily_profit,
            available_balance = available_balance + daily_profit
        WHERE id = node.id;

        INSERT INTO node_rewards (user_id, reward_type, amount, details)
        VALUES (node.user_id, 'FIXED_YIELD', daily_profit,
          jsonb_build_object('node_type', node.node_type, 'frozen_amount', node.frozen_amount,
            'daily_rate', node.daily_rate, 'earnings_capacity', node.earnings_capacity));
      END IF;
    END IF;

    total_settled := total_settled + daily_profit;
    nodes_processed := nodes_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('nodesProcessed', nodes_processed, 'totalSettled', ROUND(total_settled, 6)::TEXT);
END;
$$;

-- C) Update check_node_milestones to skip when paused
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
  system_active BOOLEAN;
BEGIN
  SELECT value::BOOLEAN INTO system_active FROM system_config WHERE key = 'NODE_SYSTEM_ACTIVE';
  IF NOT COALESCE(system_active, false) THEN
    RETURN jsonb_build_object('achieved', 0, 'failed', 0, 'paused', true);
  END IF;

  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    RETURN jsonb_build_object('error', 'Profile not found');
  END IF;

  FOR ms IN
    SELECT nm_ms.*, nm.user_id, nm.node_type, nm.total_milestones, nm.id AS mem_id,
           nm.locked_earnings, nm.frozen_amount
    FROM node_milestones nm_ms
    JOIN node_memberships nm ON nm.id = nm_ms.membership_id
    WHERE nm.user_id = profile_row.id
      AND nm.status = 'PENDING_MILESTONES'
      AND nm_ms.status = 'PENDING'
    ORDER BY nm_ms.milestone_index ASC
  LOOP
    user_rank_index := CASE
      WHEN profile_row.rank = 'V1' THEN 1
      WHEN profile_row.rank = 'V2' THEN 2
      WHEN profile_row.rank = 'V3' THEN 3
      WHEN profile_row.rank = 'V4' THEN 4
      WHEN profile_row.rank = 'V5' THEN 5
      WHEN profile_row.rank = 'V6' THEN 6
      WHEN profile_row.rank = 'V7' THEN 7
      ELSE 0
    END;

    required_rank_index := CASE
      WHEN ms.required_rank = 'V1' THEN 1
      WHEN ms.required_rank = 'V2' THEN 2
      WHEN ms.required_rank = 'V3' THEN 3
      WHEN ms.required_rank = 'V4' THEN 4
      WHEN ms.required_rank = 'V5' THEN 5
      WHEN ms.required_rank = 'V6' THEN 6
      WHEN ms.required_rank = 'V7' THEN 7
      ELSE 0
    END;

    IF user_rank_index >= required_rank_index THEN
      UPDATE node_milestones SET status = 'ACHIEVED', achieved_at = NOW()
      WHERE id = ms.id;

      UPDATE node_memberships
      SET milestone_stage = milestone_stage + 1,
          earnings_capacity = LEAST(earnings_capacity + (1.0 / ms.total_milestones), 1.0)
      WHERE id = ms.mem_id;

      IF ms.node_type = 'MINI' AND ms.required_rank = 'V2' THEN
        UPDATE node_memberships
        SET released_earnings = released_earnings + COALESCE(locked_earnings, 0),
            available_balance = available_balance + COALESCE(locked_earnings, 0),
            locked_earnings = 0
        WHERE id = ms.mem_id;
      END IF;

      achieved_count := achieved_count + 1;

    ELSIF NOW() > ms.deadline_at THEN
      UPDATE node_milestones SET status = 'FAILED'
      WHERE id = ms.id;

      UPDATE node_milestones SET status = 'FAILED'
      WHERE membership_id = ms.mem_id AND status = 'PENDING';

      UPDATE node_memberships
      SET status = 'CANCELLED',
          locked_earnings = 0,
          available_balance = 0
      WHERE id = ms.mem_id;

      failed_count := failed_count + 1;
    END IF;
  END LOOP;

  UPDATE node_memberships
  SET status = 'ACTIVE'
  WHERE user_id = profile_row.id
    AND status = 'PENDING_MILESTONES'
    AND milestone_stage >= total_milestones;

  IF EXISTS (
    SELECT 1 FROM node_memberships
    WHERE user_id = profile_row.id AND node_type = 'MAX' AND status = 'ACTIVE'
      AND milestone_stage >= total_milestones
  ) THEN
    UPDATE node_memberships
    SET available_balance = available_balance + frozen_amount,
        frozen_amount = 0
    WHERE user_id = profile_row.id AND node_type = 'MAX' AND status = 'ACTIVE'
      AND milestone_stage >= total_milestones AND frozen_amount > 0;
  END IF;

  IF EXISTS (
    SELECT 1 FROM node_memberships
    WHERE user_id = profile_row.id AND node_type = 'MINI' AND status = 'ACTIVE'
      AND milestone_stage >= total_milestones
  ) THEN
    UPDATE node_memberships
    SET available_balance = available_balance + frozen_amount,
        frozen_amount = 0
    WHERE user_id = profile_row.id AND node_type = 'MINI' AND status = 'ACTIVE'
      AND milestone_stage >= total_milestones AND frozen_amount > 0;
  END IF;

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

-- D) Activate function: call when Vault goes live
--    Resets all milestone deadlines from NOW, resets start/end dates
CREATE OR REPLACE FUNCTION activate_node_system()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  mem RECORD;
  milestones_json JSONB;
  milestone JSONB;
  m_index INT;
  node_duration INT;
  nodes_updated INT := 0;
BEGIN
  -- Enable the system
  UPDATE system_config SET value = 'true', updated_at = NOW() WHERE key = 'NODE_SYSTEM_ACTIVE';

  -- Reset all active/pending memberships
  FOR mem IN
    SELECT nm.id, nm.node_type
    FROM node_memberships nm
    WHERE nm.status IN ('ACTIVE', 'PENDING_MILESTONES')
  LOOP
    IF mem.node_type = 'MAX' THEN
      node_duration := 120;
      SELECT value::JSONB INTO milestones_json FROM system_config WHERE key = 'MAX_MILESTONES';
    ELSE
      node_duration := 90;
      SELECT value::JSONB INTO milestones_json FROM system_config WHERE key = 'MINI_MILESTONES';
    END IF;

    -- Reset membership dates from NOW
    UPDATE node_memberships
    SET start_date = NOW(),
        end_date = NOW() + (node_duration || ' days')::INTERVAL
    WHERE id = mem.id;

    -- Delete old milestones and recreate from NOW
    DELETE FROM node_milestones WHERE membership_id = mem.id;

    m_index := 0;
    FOR milestone IN SELECT * FROM jsonb_array_elements(milestones_json)
    LOOP
      INSERT INTO node_milestones (membership_id, milestone_index, required_rank, deadline_days, deadline_at, status)
      VALUES (
        mem.id,
        m_index,
        milestone->>'rank',
        (milestone->>'days')::INT,
        NOW() + ((milestone->>'days')::INT || ' days')::INTERVAL,
        'PENDING'
      );
      m_index := m_index + 1;
    END LOOP;

    nodes_updated := nodes_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('activated', true, 'nodesReset', nodes_updated, 'activatedAt', NOW());
END;
$$;
