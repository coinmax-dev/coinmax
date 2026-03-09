-- ═══════════════════════════════════════════════════════════════
-- Migration 013: Auto rank promotion on vault deposit + daily settlement
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- A) Update vault_deposit to trigger rank promotion for depositor + upline chain
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

  -- Auto rank promotion: check upline chain (up to 15 levels)
  current_id := profile_row.id;
  LOOP
    depth := depth + 1;
    IF depth > 15 THEN EXIT; END IF;

    SELECT referrer_id INTO upline_id FROM profiles WHERE id = current_id;
    IF upline_id IS NULL THEN EXIT; END IF;

    -- Get upline wallet address and check promotion
    PERFORM check_rank_promotion(
      (SELECT wallet_address FROM profiles WHERE id = upline_id)
    );

    current_id := upline_id;
  END LOOP;

  RETURN jsonb_build_object('position', to_jsonb(pos), 'transaction', to_jsonb(tx));
END;
$$;

-- ─────────────────────────────────────────────
-- B) Batch rank check for all users (run in daily settlement)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION batch_check_rank_promotions()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  p RECORD;
  result JSONB;
  promoted_count INT := 0;
  checked_count INT := 0;
BEGIN
  -- Check all users with active vault deposits
  FOR p IN
    SELECT DISTINCT pr.wallet_address
    FROM profiles pr
    WHERE EXISTS (
      SELECT 1 FROM vault_positions vp
      WHERE vp.user_id = pr.id AND vp.status = 'ACTIVE'
    )
    ORDER BY pr.wallet_address
  LOOP
    SELECT check_rank_promotion(p.wallet_address) INTO result;
    checked_count := checked_count + 1;

    IF (result->>'promoted')::BOOLEAN THEN
      promoted_count := promoted_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'checkedCount', checked_count,
    'promotedCount', promoted_count
  );
END;
$$;

-- ─────────────────────────────────────────────
-- C) Update run_daily_settlement to include batch rank check
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
  node_active BOOLEAN;
BEGIN
  -- 1. Settle vault daily yields
  SELECT settle_vault_daily() INTO vault_result;

  -- 2. Check if node system is active
  SELECT COALESCE(value::BOOLEAN, FALSE) INTO node_active
  FROM system_config WHERE key = 'NODE_SYSTEM_ACTIVE';

  IF node_active THEN
    SELECT settle_node_fixed_yield() INTO node_result;
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
-- D) Test helper: create test users with deposits and referral chain
--    Usage: SELECT create_test_team();
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_test_team()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  leader_id VARCHAR;
  sub1_id VARCHAR;
  sub2_id VARCHAR;
  sub3_id VARCHAR;
  leader_addr TEXT := '0xTEST_LEADER_001';
  sub1_addr TEXT := '0xTEST_SUB_001';
  sub2_addr TEXT := '0xTEST_SUB_002';
  sub3_addr TEXT := '0xTEST_SUB_003';
  ref_code_leader TEXT;
BEGIN
  -- Clean up previous test data
  DELETE FROM vault_positions WHERE user_id IN (SELECT id FROM profiles WHERE wallet_address LIKE '0xTEST_%');
  DELETE FROM node_rewards WHERE user_id IN (SELECT id FROM profiles WHERE wallet_address LIKE '0xTEST_%');
  DELETE FROM earnings_releases WHERE user_id IN (SELECT id FROM profiles WHERE wallet_address LIKE '0xTEST_%');
  DELETE FROM transactions WHERE user_id IN (SELECT id FROM profiles WHERE wallet_address LIKE '0xTEST_%');
  DELETE FROM profiles WHERE wallet_address LIKE '0xTEST_%';

  -- Create leader (will be V1: 100U holding + 1 referral + 5000U team)
  INSERT INTO profiles (wallet_address, ref_code) VALUES (leader_addr, 'TEST_LEADER')
  RETURNING id, ref_code INTO leader_id, ref_code_leader;

  -- Create 3 sub-users under leader
  INSERT INTO profiles (wallet_address, referrer_id, ref_code) VALUES (sub1_addr, leader_id, 'TEST_SUB1')
  RETURNING id INTO sub1_id;

  INSERT INTO profiles (wallet_address, referrer_id, ref_code) VALUES (sub2_addr, leader_id, 'TEST_SUB2')
  RETURNING id INTO sub2_id;

  INSERT INTO profiles (wallet_address, referrer_id, ref_code) VALUES (sub3_addr, leader_id, 'TEST_SUB3')
  RETURNING id INTO sub3_id;

  -- Leader deposits 500U (personal holding)
  INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, end_date, status)
  VALUES (leader_id, '90_DAYS', 500, 0.009, NOW() + INTERVAL '90 days', 'ACTIVE');
  UPDATE profiles SET total_deposited = 500 WHERE id = leader_id;

  -- Sub1 deposits 2000U
  INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, end_date, status)
  VALUES (sub1_id, '90_DAYS', 2000, 0.009, NOW() + INTERVAL '90 days', 'ACTIVE');
  UPDATE profiles SET total_deposited = 2000 WHERE id = sub1_id;

  -- Sub2 deposits 2000U
  INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, end_date, status)
  VALUES (sub2_id, '90_DAYS', 2000, 0.009, NOW() + INTERVAL '90 days', 'ACTIVE');
  UPDATE profiles SET total_deposited = 2000 WHERE id = sub2_id;

  -- Sub3 deposits 1500U
  INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, end_date, status)
  VALUES (sub3_id, '90_DAYS', 1500, 0.009, NOW() + INTERVAL '90 days', 'ACTIVE');
  UPDATE profiles SET total_deposited = 1500 WHERE id = sub3_id;

  -- Now check rank promotion for leader
  -- Leader: 500U holding (≥100), 3 referrals with deposits (≥1), 5500U team (≥5000) → should be V1
  PERFORM check_rank_promotion(leader_addr);

  RETURN jsonb_build_object(
    'leader', jsonb_build_object('address', leader_addr, 'id', leader_id, 'holding', 500, 'refCode', ref_code_leader),
    'sub1', jsonb_build_object('address', sub1_addr, 'id', sub1_id, 'deposit', 2000),
    'sub2', jsonb_build_object('address', sub2_addr, 'id', sub2_id, 'deposit', 2000),
    'sub3', jsonb_build_object('address', sub3_addr, 'id', sub3_id, 'deposit', 1500),
    'teamPerformance', 5500,
    'expectedRank', 'V1'
  );
END;
$$;
