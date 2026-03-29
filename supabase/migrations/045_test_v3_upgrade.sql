-- ═══════════════════════════════════════════════════════════════
-- Migration 045: Test V2 → V3 rank upgrade for 4f4f account
--
-- V3 requirements:
--   personalHolding ≥ 500
--   2 direct referrals at V2
--   teamPerformance ≥ 50,000
--
-- V2 requirements (for each sub-leader):
--   personalHolding ≥ 300
--   2 direct referrals at V1
--   teamPerformance ≥ 20,000
--
-- V1 requirements (for each sub-sub):
--   personalHolding ≥ 100
--   1 direct referral with deposit
--   teamPerformance ≥ 5,000
--
-- Tree structure:
--   4f4f (V2 → V3)  [500U personal]
--   ├── Sub-Leader A (→V2)  [300U personal]
--   │   ├── Sub-A1 (→V1)  [200U personal]
--   │   │   └── Leaf-A1a  [5200U deposit]
--   │   ├── Sub-A2 (→V1)  [200U personal]
--   │   │   └── Leaf-A2a  [5200U deposit]
--   │   └── Filler-A3     [10000U deposit]  (team perf boost)
--   │
--   └── Sub-Leader B (→V2)  [300U personal]
--       ├── Sub-B1 (→V1)  [200U personal]
--       │   └── Leaf-B1a  [5200U deposit]
--       ├── Sub-B2 (→V1)  [200U personal]
--       │   └── Leaf-B2a  [5200U deposit]
--       └── Filler-B3     [10000U deposit]
--
-- Total team perf under 4f4f:
--   SubA(300) + SubA1(200) + LeafA1a(5200) + SubA2(200) + LeafA2a(5200)
--   + FillerA3(10000) + SubB(300) + SubB1(200) + LeafB1a(5200) + SubB2(200)
--   + LeafB2a(5200) + FillerB3(10000) = 52,200 ≥ 50,000 ✓
-- ═══════════════════════════════════════════════════════════════

-- Cleanup previous test data (if re-running)
DO $$
DECLARE
  test_addrs TEXT[] := ARRAY[
    '0xA1b2C3d4E5f60718293a4B5c6D7e8F9001234aaa',
    '0xB2c3D4e5F6071829304A5b6C7d8E9f0012345bbb',
    '0xC3d4E5f607182930415B6c7D8e9F001234567ccc',
    '0xD4e5F60718293041526C7d8E9f00123456789ddd',
    '0xE5f6071829304152637D8e9F0012345678901eee',
    '0xF607182930415263748E9f001234567890123fff',
    '0x0718293041526374859F001234567890abcde111',
    '0x1829304152637485960012345678901abcdef222',
    '0x2930415263748596a70123456789012abcdef333',
    '0x3041526374859607b812345678901234abcde444'
  ];
  addr TEXT;
  uid VARCHAR;
BEGIN
  FOREACH addr IN ARRAY test_addrs LOOP
    SELECT id INTO uid FROM profiles WHERE wallet_address = addr;
    IF uid IS NOT NULL THEN
      DELETE FROM vault_positions WHERE user_id = uid;
      DELETE FROM transactions WHERE user_id = uid;
      DELETE FROM node_rewards WHERE user_id = uid;
      DELETE FROM profiles WHERE id = uid;
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────
-- Step 1: Ensure 4f4f has 500U personal holding
-- ─────────────────────────────────────────────
DO $$
DECLARE
  leader_id VARCHAR;
  leader_addr TEXT := '0x3070063A913AF0b676BAcdeea2F73DA415614f4f';
  current_holding NUMERIC;
BEGIN
  SELECT id INTO leader_id FROM profiles WHERE wallet_address = leader_addr;
  IF leader_id IS NULL THEN
    RAISE EXCEPTION '4f4f account not found';
  END IF;

  -- Check current holding
  SELECT COALESCE(SUM(principal), 0) INTO current_holding
  FROM vault_positions WHERE user_id = leader_id AND status = 'ACTIVE';

  RAISE NOTICE '4f4f current holding: %U', current_holding;

  -- Top up to 500U if needed
  IF current_holding < 500 THEN
    INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, end_date, status)
    VALUES (leader_id, '90_DAYS', 500 - current_holding, 0.009, NOW() + INTERVAL '90 days', 'ACTIVE');
    RAISE NOTICE 'Added %U to reach 500U personal holding', 500 - current_holding;
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- Step 2: Create Sub-Leader A + team → V2
-- ─────────────────────────────────────────────
DO $$
DECLARE
  leader_id VARCHAR;
  sub_a_id VARCHAR;
  sub_a1_id VARCHAR;
  sub_a2_id VARCHAR;
  leaf_a1a_id VARCHAR;
  leaf_a2a_id VARCHAR;
  filler_a3_id VARCHAR;
BEGIN
  SELECT id INTO leader_id FROM profiles WHERE wallet_address = '0x3070063A913AF0b676BAcdeea2F73DA415614f4f';

  -- Sub-Leader A
  INSERT INTO profiles (wallet_address, referrer_id, referral_code)
  VALUES ('0xA1b2C3d4E5f60718293a4B5c6D7e8F9001234aaa', leader_id, 'TEST_SUB_A')
  RETURNING id INTO sub_a_id;
  INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, end_date, status)
  VALUES (sub_a_id, '90_DAYS', 300, 0.009, NOW() + INTERVAL '90 days', 'ACTIVE');

  -- Sub-A1 (→V1: 200U personal, 1 referral, 5200U team)
  INSERT INTO profiles (wallet_address, referrer_id, referral_code)
  VALUES ('0xC3d4E5f607182930415B6c7D8e9F001234567ccc', sub_a_id, 'TEST_SUB_A1')
  RETURNING id INTO sub_a1_id;
  INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, end_date, status)
  VALUES (sub_a1_id, '90_DAYS', 200, 0.009, NOW() + INTERVAL '90 days', 'ACTIVE');

  -- Leaf-A1a (deposit 5200U under Sub-A1)
  INSERT INTO profiles (wallet_address, referrer_id, referral_code)
  VALUES ('0xD4e5F60718293041526C7d8E9f00123456789ddd', sub_a1_id, 'TEST_LEAF_A1A')
  RETURNING id INTO leaf_a1a_id;
  INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, end_date, status)
  VALUES (leaf_a1a_id, '90_DAYS', 5200, 0.009, NOW() + INTERVAL '90 days', 'ACTIVE');

  -- Sub-A2 (→V1: 200U personal, 1 referral, 5200U team)
  INSERT INTO profiles (wallet_address, referrer_id, referral_code)
  VALUES ('0xE5f6071829304152637D8e9F0012345678901eee', sub_a_id, 'TEST_SUB_A2')
  RETURNING id INTO sub_a2_id;
  INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, end_date, status)
  VALUES (sub_a2_id, '90_DAYS', 200, 0.009, NOW() + INTERVAL '90 days', 'ACTIVE');

  -- Leaf-A2a (deposit 5200U under Sub-A2)
  INSERT INTO profiles (wallet_address, referrer_id, referral_code)
  VALUES ('0xF607182930415263748E9f001234567890123fff', sub_a2_id, 'TEST_LEAF_A2A')
  RETURNING id INTO leaf_a2a_id;
  INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, end_date, status)
  VALUES (leaf_a2a_id, '90_DAYS', 5200, 0.009, NOW() + INTERVAL '90 days', 'ACTIVE');

  -- Filler-A3 (10000U boost for Sub-A team perf)
  INSERT INTO profiles (wallet_address, referrer_id, referral_code)
  VALUES ('0x0718293041526374859F001234567890abcde111', sub_a_id, 'TEST_FILLER_A3')
  RETURNING id INTO filler_a3_id;
  INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, end_date, status)
  VALUES (filler_a3_id, '180_DAYS', 10000, 0.012, NOW() + INTERVAL '180 days', 'ACTIVE');

  RAISE NOTICE 'Sub-Leader A team created: SubA=%, A1=%, A2=%, LeafA1a=%, LeafA2a=%, FillerA3=%',
    sub_a_id, sub_a1_id, sub_a2_id, leaf_a1a_id, leaf_a2a_id, filler_a3_id;
END $$;

-- ─────────────────────────────────────────────
-- Step 3: Create Sub-Leader B + team → V2
-- ─────────────────────────────────────────────
DO $$
DECLARE
  leader_id VARCHAR;
  sub_b_id VARCHAR;
  sub_b1_id VARCHAR;
  sub_b2_id VARCHAR;
  leaf_b1a_id VARCHAR;
  leaf_b2a_id VARCHAR;
  filler_b3_id VARCHAR;
BEGIN
  SELECT id INTO leader_id FROM profiles WHERE wallet_address = '0x3070063A913AF0b676BAcdeea2F73DA415614f4f';

  -- Sub-Leader B
  INSERT INTO profiles (wallet_address, referrer_id, referral_code)
  VALUES ('0xB2c3D4e5F6071829304A5b6C7d8E9f0012345bbb', leader_id, 'TEST_SUB_B')
  RETURNING id INTO sub_b_id;
  INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, end_date, status)
  VALUES (sub_b_id, '90_DAYS', 300, 0.009, NOW() + INTERVAL '90 days', 'ACTIVE');

  -- Sub-B1 (→V1)
  INSERT INTO profiles (wallet_address, referrer_id, referral_code)
  VALUES ('0x1829304152637485960012345678901abcdef222', sub_b_id, 'TEST_SUB_B1')
  RETURNING id INTO sub_b1_id;
  INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, end_date, status)
  VALUES (sub_b1_id, '90_DAYS', 200, 0.009, NOW() + INTERVAL '90 days', 'ACTIVE');

  -- Leaf-B1a
  INSERT INTO profiles (wallet_address, referrer_id, referral_code)
  VALUES ('0x2930415263748596a70123456789012abcdef333', sub_b1_id, 'TEST_LEAF_B1A')
  RETURNING id INTO leaf_b1a_id;
  INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, end_date, status)
  VALUES (leaf_b1a_id, '90_DAYS', 5200, 0.009, NOW() + INTERVAL '90 days', 'ACTIVE');

  -- Sub-B2 (→V1)
  INSERT INTO profiles (wallet_address, referrer_id, referral_code)
  VALUES ('0x3041526374859607b812345678901234abcde444', sub_b_id, 'TEST_SUB_B2')
  RETURNING id INTO sub_b2_id;
  INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, end_date, status)
  VALUES (sub_b2_id, '90_DAYS', 200, 0.009, NOW() + INTERVAL '90 days', 'ACTIVE');

  -- Leaf-B2a
  INSERT INTO profiles (wallet_address, referrer_id, referral_code)
  VALUES ('0x4152637485960718c923456789012345abcde555', sub_b2_id, 'TEST_LEAF_B2A')
  RETURNING id INTO leaf_b2a_id;
  INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, end_date, status)
  VALUES (leaf_b2a_id, '90_DAYS', 5200, 0.009, NOW() + INTERVAL '90 days', 'ACTIVE');

  -- Filler-B3
  INSERT INTO profiles (wallet_address, referrer_id, referral_code)
  VALUES ('0x5263748596071829da34567890123456abcde666', sub_b_id, 'TEST_FILLER_B3')
  RETURNING id INTO filler_b3_id;
  INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, end_date, status)
  VALUES (filler_b3_id, '180_DAYS', 10000, 0.012, NOW() + INTERVAL '180 days', 'ACTIVE');

  RAISE NOTICE 'Sub-Leader B team created: SubB=%, B1=%, B2=%, LeafB1a=%, LeafB2a=%, FillerB3=%',
    sub_b_id, sub_b1_id, sub_b2_id, leaf_b1a_id, leaf_b2a_id, filler_b3_id;
END $$;

-- ─────────────────────────────────────────────
-- Step 4: Trigger rank promotions bottom-up
--   Leaf nodes → V1 subs → V2 sub-leaders → V3 leader
-- ─────────────────────────────────────────────

-- Promote V1 subs (they each have 1 referral + ≥5000U team + ≥100U personal)
SELECT check_rank_promotion('0xC3d4E5f607182930415B6c7D8e9F001234567ccc') AS sub_a1_rank;
SELECT check_rank_promotion('0xE5f6071829304152637D8e9F0012345678901eee') AS sub_a2_rank;
SELECT check_rank_promotion('0x1829304152637485960012345678901abcdef222') AS sub_b1_rank;
SELECT check_rank_promotion('0x3041526374859607b812345678901234abcde444') AS sub_b2_rank;

-- Promote V2 sub-leaders (they each have 2xV1 subs + ≥20000U team + ≥300U personal)
SELECT check_rank_promotion('0xA1b2C3d4E5f60718293a4B5c6D7e8F9001234aaa') AS sub_a_rank;
SELECT check_rank_promotion('0xB2c3D4e5F6071829304A5b6C7d8E9f0012345bbb') AS sub_b_rank;

-- Finally promote 4f4f → should become V3
SELECT check_rank_promotion('0x3070063A913AF0b676BAcdeea2F73DA415614f4f') AS leader_rank;

-- ─────────────────────────────────────────────
-- Step 5: Verify results
-- ─────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  RAISE NOTICE '═══ V3 Upgrade Test Results ═══';
  FOR r IN
    SELECT wallet_address, rank,
      (SELECT COALESCE(SUM(principal),0) FROM vault_positions WHERE user_id = p.id AND status='ACTIVE') AS holding
    FROM profiles p
    WHERE wallet_address IN (
      '0x3070063A913AF0b676BAcdeea2F73DA415614f4f',
      '0xA1b2C3d4E5f60718293a4B5c6D7e8F9001234aaa',
      '0xB2c3D4e5F6071829304A5b6C7d8E9f0012345bbb',
      '0xC3d4E5f607182930415B6c7D8e9F001234567ccc',
      '0xE5f6071829304152637D8e9F0012345678901eee',
      '0x1829304152637485960012345678901abcdef222',
      '0x3041526374859607b812345678901234abcde444'
    )
    ORDER BY rank DESC NULLS LAST
  LOOP
    RAISE NOTICE '% | rank=% | holding=%U',
      SUBSTRING(r.wallet_address FROM 39), r.rank, r.holding;
  END LOOP;
END $$;
