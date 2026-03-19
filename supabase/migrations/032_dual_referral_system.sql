-- ═══════════════════════════════════════════════════════════════
-- Migration 032: Dual Referral System (推荐人 + 安置推荐人)
--
-- referrer_id  = 推荐人 (Sponsor) → direct referral rewards, node referral counts
-- placement_id = 安置推荐人 (Placement) → team tree, team performance, rank, differential commission
--
-- URL format: /{ref_code}/{placement_code}
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Add placement_id column ───────────────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS placement_id UUID REFERENCES profiles(id);
CREATE INDEX IF NOT EXISTS idx_profiles_placement ON profiles(placement_id);

-- ── 2. Backfill: existing users get placement_id = referrer_id ──
UPDATE profiles SET placement_id = referrer_id WHERE placement_id IS NULL AND referrer_id IS NOT NULL;

-- ── 3. Updated auth_wallet: accepts placement_code ───────────

CREATE OR REPLACE FUNCTION auth_wallet(addr TEXT, ref_code TEXT DEFAULT NULL, placement_code TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  result profiles%ROWTYPE;
  referrer_profile profiles%ROWTYPE;
  placement_profile profiles%ROWTYPE;
BEGIN
  SELECT * INTO result FROM profiles WHERE wallet_address = addr;

  -- Resolve referrer (sponsor)
  IF ref_code IS NOT NULL AND ref_code != '' THEN
    SELECT * INTO referrer_profile FROM profiles WHERE profiles.ref_code = auth_wallet.ref_code;
  END IF;

  -- Resolve placement: defaults to referrer if not specified
  IF placement_code IS NOT NULL AND placement_code != '' THEN
    SELECT * INTO placement_profile FROM profiles WHERE profiles.ref_code = auth_wallet.placement_code;
  ELSIF referrer_profile.id IS NOT NULL THEN
    placement_profile := referrer_profile;
  END IF;

  IF result.id IS NOT NULL THEN
    -- Existing user: bind referrer + placement if not yet bound
    IF result.referrer_id IS NULL AND referrer_profile.id IS NOT NULL AND referrer_profile.id != result.id THEN
      UPDATE profiles
      SET referrer_id = referrer_profile.id,
          placement_id = COALESCE(
            CASE WHEN placement_profile.id IS NOT NULL AND placement_profile.id != result.id THEN placement_profile.id END,
            referrer_profile.id
          )
      WHERE id = result.id
      RETURNING * INTO result;
    END IF;
    RETURN to_jsonb(result);
  END IF;

  -- New user: require valid referral code
  IF referrer_profile.id IS NULL THEN
    RETURN jsonb_build_object('error', 'REFERRAL_REQUIRED', 'message', 'A valid referral code is required to register');
  END IF;

  -- Validate placement: must not be self, defaults to referrer
  IF placement_profile.id IS NULL THEN
    placement_profile := referrer_profile;
  END IF;

  INSERT INTO profiles (wallet_address, referrer_id, placement_id)
  VALUES (addr, referrer_profile.id, placement_profile.id)
  RETURNING * INTO result;

  RETURN to_jsonb(result);
END;
$$;

-- ── 4. get_referral_tree: use placement_id for tree structure ──

CREATE OR REPLACE FUNCTION get_referral_tree(addr TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  direct_refs JSONB;
  direct_count INT;
  total_team INT;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    RETURN jsonb_build_object('referrals', '[]'::JSONB, 'teamSize', 0, 'directCount', 0);
  END IF;

  -- Tree is based on placement_id (安置关系)
  WITH direct AS (
    SELECT * FROM profiles WHERE placement_id = profile_row.id
  ),
  sub_counts AS (
    SELECT p2.placement_id AS parent_id, COUNT(*)::INT AS cnt
    FROM profiles p2
    WHERE p2.placement_id IN (SELECT id FROM direct)
    GROUP BY p2.placement_id
  ),
  team AS (
    SELECT d.*,
      -- Also show who is the referrer (sponsor) of each member
      (SELECT wallet_address FROM profiles WHERE id = d.referrer_id) AS sponsor_wallet,
      (SELECT ref_code FROM profiles WHERE id = d.referrer_id) AS sponsor_code,
      jsonb_agg(
        CASE WHEN s.id IS NOT NULL THEN
          jsonb_build_object(
            'id', s.id, 'walletAddress', s.wallet_address, 'rank', s.rank,
            'nodeType', s.node_type, 'totalDeposited', s.total_deposited, 'level', 2,
            'refCode', s.ref_code,
            'sponsorWallet', (SELECT wallet_address FROM profiles WHERE id = s.referrer_id),
            'subCount', COALESCE(sc.cnt, 0)
          )
        ELSE NULL END
      ) FILTER (WHERE s.id IS NOT NULL) AS sub_referrals
    FROM direct d
    LEFT JOIN profiles s ON s.placement_id = d.id
    LEFT JOIN sub_counts sc ON sc.parent_id = s.id
    GROUP BY d.id, d.wallet_address, d.ref_code, d.referrer_id, d.placement_id, d.rank,
             d.node_type, d.is_vip, d.vip_expires_at, d.total_deposited,
             d.total_withdrawn, d.referral_earnings, d.created_at
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', t.id, 'walletAddress', t.wallet_address, 'rank', t.rank,
      'nodeType', t.node_type, 'totalDeposited', t.total_deposited, 'level', 1,
      'refCode', t.ref_code,
      'sponsorWallet', t.sponsor_wallet,
      'sponsorCode', t.sponsor_code,
      'subReferrals', COALESCE(t.sub_referrals, '[]'::JSONB)
    )
  ), COUNT(*)::INT
  INTO direct_refs, direct_count
  FROM team t;

  -- Total team size based on placement tree
  WITH RECURSIVE team_tree AS (
    SELECT id FROM profiles WHERE placement_id = profile_row.id
    UNION ALL
    SELECT p.id FROM profiles p INNER JOIN team_tree t ON p.placement_id = t.id
  )
  SELECT COUNT(*)::INT INTO total_team FROM team_tree;

  RETURN jsonb_build_object(
    'referrals', COALESCE(direct_refs, '[]'::JSONB),
    'teamSize', total_team,
    'directCount', direct_count
  );
END;
$$;

-- ── 5. check_rank_promotion: team performance via placement tree ──

CREATE OR REPLACE FUNCTION check_rank_promotion(addr TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  conditions JSONB;
  current_rank TEXT; new_rank TEXT;
  personal_holding NUMERIC; direct_referral_count INT; team_performance NUMERIC;
  rank_levels TEXT[] := ARRAY['V1','V2','V3','V4','V5','V6','V7'];
  current_rank_idx INT := 0; target_rank_idx INT;
  cond_holding NUMERIC; cond_referrals INT; cond_sub_ranks INT;
  cond_sub_level TEXT; cond_team_perf NUMERIC; qualified_sub_count INT;
  promoted BOOLEAN := FALSE;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;

  current_rank := profile_row.rank;
  SELECT value::JSONB INTO conditions FROM system_config WHERE key = 'RANK_CONDITIONS';

  -- Personal holding = active vault deposits
  SELECT COALESCE(SUM(principal), 0) INTO personal_holding
  FROM vault_positions WHERE user_id = profile_row.id AND status = 'ACTIVE';

  -- Direct referrals count: based on REFERRER relationship (推荐人)
  SELECT COUNT(*) INTO direct_referral_count
  FROM profiles p WHERE p.referrer_id = profile_row.id
    AND EXISTS (SELECT 1 FROM vault_positions vp WHERE vp.user_id = p.id AND vp.status = 'ACTIVE');

  -- Team performance: based on PLACEMENT tree (安置关系)
  WITH RECURSIVE downline AS (
    SELECT id FROM profiles WHERE placement_id = profile_row.id
    UNION ALL
    SELECT p.id FROM profiles p JOIN downline d ON p.placement_id = d.id
  )
  SELECT COALESCE(SUM(vp.principal), 0) INTO team_performance
  FROM vault_positions vp JOIN downline d ON vp.user_id = d.id WHERE vp.status = 'ACTIVE';

  IF current_rank IS NOT NULL THEN
    FOR i IN 1..array_length(rank_levels, 1) LOOP
      IF rank_levels[i] = current_rank THEN current_rank_idx := i; EXIT; END IF;
    END LOOP;
  END IF;

  new_rank := current_rank;

  FOR target_rank_idx IN (current_rank_idx + 1)..array_length(rank_levels, 1) LOOP
    SELECT COALESCE((elem->>'personalHolding')::NUMERIC, 0),
           COALESCE((elem->>'directReferrals')::INT, 0),
           COALESCE((elem->>'requiredSubRanks')::INT, 0),
           COALESCE(elem->>'subRankLevel', ''),
           COALESCE((elem->>'teamPerformance')::NUMERIC, 0)
    INTO cond_holding, cond_referrals, cond_sub_ranks, cond_sub_level, cond_team_perf
    FROM jsonb_array_elements(conditions) AS elem
    WHERE elem->>'level' = rank_levels[target_rank_idx];

    IF personal_holding < cond_holding THEN EXIT; END IF;
    IF team_performance < cond_team_perf THEN EXIT; END IF;

    IF rank_levels[target_rank_idx] = 'V1' THEN
      IF direct_referral_count < cond_referrals THEN EXIT; END IF;
    END IF;

    -- Sub-rank check: based on PLACEMENT tree members
    IF cond_sub_ranks > 0 AND cond_sub_level != '' THEN
      SELECT COUNT(*) INTO qualified_sub_count
      FROM profiles p WHERE p.placement_id = profile_row.id AND p.rank IS NOT NULL
        AND array_position(rank_levels, p.rank) >= array_position(rank_levels, cond_sub_level);
      IF qualified_sub_count < cond_sub_ranks THEN EXIT; END IF;
    END IF;

    new_rank := rank_levels[target_rank_idx];
    promoted := TRUE;
  END LOOP;

  IF promoted AND new_rank IS DISTINCT FROM current_rank THEN
    UPDATE profiles SET rank = new_rank WHERE id = profile_row.id;
  END IF;

  RETURN jsonb_build_object(
    'previousRank', current_rank, 'currentRank', new_rank,
    'promoted', promoted AND new_rank IS DISTINCT FROM current_rank,
    'personalHolding', ROUND(personal_holding, 2)::TEXT,
    'directReferrals', direct_referral_count,
    'teamPerformance', ROUND(team_performance, 2)::TEXT
  );
END;
$$;

-- ── 6. settle_team_commission: direct reward → referrer, differential → placement ──

CREATE OR REPLACE FUNCTION settle_team_commission(base_amount NUMERIC, source_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  ranks_json JSONB;
  max_depth INT;
  direct_rate NUMERIC;
  direct_referrer_id UUID;
  current_user_id UUID;
  upline_id UUID;
  current_depth INT := 0;
  prev_rate NUMERIC := 0;
  upline_rank TEXT;
  upline_commission NUMERIC;
  diff_rate NUMERIC;
  commission NUMERIC;
  total_commission NUMERIC := 0;
  commissions_paid INT := 0;
BEGIN
  SELECT value::JSONB INTO ranks_json FROM system_config WHERE key = 'RANKS';
  SELECT COALESCE(value::INT, 15) INTO max_depth FROM system_config WHERE key = 'TEAM_MAX_DEPTH';
  SELECT COALESCE(value::NUMERIC, 0.10) INTO direct_rate FROM system_config WHERE key = 'DIRECT_REFERRAL_RATE';

  -- ── Direct referral bonus: goes to REFERRER (推荐人) ──
  SELECT referrer_id INTO direct_referrer_id FROM profiles WHERE id = source_user_id;
  IF direct_referrer_id IS NOT NULL AND direct_rate > 0 THEN
    commission := base_amount * direct_rate;
    IF commission > 0 THEN
      INSERT INTO node_rewards (user_id, reward_type, amount, details)
      VALUES (direct_referrer_id, 'TEAM_COMMISSION', commission,
        jsonb_build_object('type', 'direct_referral', 'source_user', source_user_id, 'depth', 1));
      total_commission := total_commission + commission;
      commissions_paid := commissions_paid + 1;
    END IF;
  END IF;

  -- ── Differential commission: walks up PLACEMENT tree (安置关系) ──
  current_user_id := source_user_id;

  LOOP
    current_depth := current_depth + 1;
    IF current_depth > max_depth THEN EXIT; END IF;

    -- Walk up placement tree
    SELECT placement_id INTO upline_id FROM profiles WHERE id = current_user_id;
    IF upline_id IS NULL THEN EXIT; END IF;

    SELECT rank INTO upline_rank FROM profiles WHERE id = upline_id;

    SELECT COALESCE((elem->>'commission')::NUMERIC, 0)
    INTO upline_commission
    FROM jsonb_array_elements(ranks_json) AS elem
    WHERE elem->>'level' = upline_rank;

    IF upline_commission IS NULL THEN upline_commission := 0; END IF;

    -- Differential commission
    diff_rate := GREATEST(upline_commission - prev_rate, 0);
    IF diff_rate > 0 THEN
      commission := base_amount * diff_rate;
      INSERT INTO node_rewards (user_id, reward_type, amount, details)
      VALUES (upline_id, 'TEAM_COMMISSION', commission,
        jsonb_build_object('type', 'differential', 'source_user', source_user_id,
          'depth', current_depth, 'rate', diff_rate, 'upline_rate', upline_commission, 'prev_rate', prev_rate));
      total_commission := total_commission + commission;
      commissions_paid := commissions_paid + 1;
    END IF;

    IF upline_commission > prev_rate THEN
      prev_rate := upline_commission;
    END IF;

    current_user_id := upline_id;
  END LOOP;

  RETURN jsonb_build_object('totalCommission', ROUND(total_commission, 6)::TEXT, 'commissionsPaid', commissions_paid);
END;
$$;

-- ── 7. vault_deposit: promote both referrer and placement chain ──

CREATE OR REPLACE FUNCTION vault_deposit(addr TEXT, plan_type TEXT, deposit_amount NUMERIC, tx_hash TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  plan_days INT; plan_rate NUMERIC;
  end_dt TIMESTAMP; min_amount NUMERIC;
  pos vault_positions%ROWTYPE;
  tx transactions%ROWTYPE;
  upline_id UUID; current_id UUID; depth INT := 0;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    INSERT INTO profiles (wallet_address) VALUES (addr) RETURNING * INTO profile_row;
  END IF;

  SELECT value::NUMERIC INTO min_amount FROM system_config WHERE key = 'VAULT_MIN_AMOUNT';
  IF min_amount IS NULL THEN min_amount := 50; END IF;
  IF deposit_amount < min_amount THEN RAISE EXCEPTION 'Minimum deposit is % USDC', min_amount; END IF;

  IF plan_type = '5_DAYS' THEN plan_days := 5; plan_rate := 0.005;
  ELSIF plan_type = '45_DAYS' THEN plan_days := 45; plan_rate := 0.007;
  ELSIF plan_type = '90_DAYS' THEN plan_days := 90; plan_rate := 0.009;
  ELSIF plan_type = '180_DAYS' THEN plan_days := 180; plan_rate := 0.012;
  ELSIF plan_type = '360_DAYS' THEN plan_days := 360; plan_rate := 0.015;
  ELSE RAISE EXCEPTION 'Invalid plan type: %', plan_type;
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

  -- Auto rank promotion: check placement upline chain (up to 15 levels)
  current_id := profile_row.id;
  LOOP
    depth := depth + 1;
    IF depth > 15 THEN EXIT; END IF;
    SELECT placement_id INTO upline_id FROM profiles WHERE id = current_id;
    IF upline_id IS NULL THEN EXIT; END IF;
    PERFORM check_rank_promotion(
      (SELECT wallet_address FROM profiles WHERE id = upline_id)
    );
    current_id := upline_id;
  END LOOP;

  RETURN jsonb_build_object('position', to_jsonb(pos), 'transaction', to_jsonb(tx));
END;
$$;

-- ── 8. get_rank_status: team perf via placement tree ──

CREATE OR REPLACE FUNCTION get_rank_status(addr TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  personal_holding NUMERIC; direct_referral_count INT; team_performance NUMERIC;
  conditions JSONB; next_cond JSONB;
  rank_levels TEXT[] := ARRAY['V1','V2','V3','V4','V5','V6','V7'];
  current_idx INT := 0;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN RETURN '{"error": "User not found"}'::JSONB; END IF;

  SELECT COALESCE(SUM(principal), 0) INTO personal_holding
  FROM vault_positions WHERE user_id = profile_row.id AND status = 'ACTIVE';

  -- Direct referrals: based on referrer_id (推荐关系)
  SELECT COUNT(*) INTO direct_referral_count
  FROM profiles p WHERE p.referrer_id = profile_row.id
    AND EXISTS (SELECT 1 FROM vault_positions vp WHERE vp.user_id = p.id AND vp.status = 'ACTIVE');

  -- Team performance: based on placement_id (安置关系)
  WITH RECURSIVE downline AS (
    SELECT id FROM profiles WHERE placement_id = profile_row.id
    UNION ALL
    SELECT p.id FROM profiles p JOIN downline d ON p.placement_id = d.id
  )
  SELECT COALESCE(SUM(vp.principal), 0) INTO team_performance
  FROM vault_positions vp JOIN downline d ON vp.user_id = d.id WHERE vp.status = 'ACTIVE';

  SELECT value::JSONB INTO conditions FROM system_config WHERE key = 'RANK_CONDITIONS';

  IF profile_row.rank IS NOT NULL THEN
    FOR i IN 1..array_length(rank_levels, 1) LOOP
      IF rank_levels[i] = profile_row.rank THEN current_idx := i; EXIT; END IF;
    END LOOP;
  END IF;

  IF current_idx < array_length(rank_levels, 1) THEN
    SELECT elem INTO next_cond FROM jsonb_array_elements(conditions) AS elem
    WHERE elem->>'level' = rank_levels[current_idx + 1];
  END IF;

  RETURN jsonb_build_object(
    'currentRank', profile_row.rank,
    'personalHolding', ROUND(personal_holding, 2)::TEXT,
    'directReferrals', direct_referral_count,
    'teamPerformance', ROUND(team_performance, 2)::TEXT,
    'nextRankConditions', next_cond,
    'allConditions', conditions
  );
END;
$$;

-- ── 9. get_user_team_stats: use placement tree ──

CREATE OR REPLACE FUNCTION get_user_team_stats(user_id_param UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  team_size INT; team_perf NUMERIC; personal NUMERIC;
  direct_sponsor INT; direct_placement INT;
  own_node TEXT; direct_max_nodes INT; direct_mini_nodes INT; total_team_nodes INT;
BEGIN
  -- Direct sponsored (推荐)
  SELECT COUNT(*) INTO direct_sponsor FROM profiles WHERE referrer_id = user_id_param;
  -- Direct placement (安置)
  SELECT COUNT(*) INTO direct_placement FROM profiles WHERE placement_id = user_id_param;

  -- Team size via placement tree
  WITH RECURSIVE downline AS (
    SELECT id FROM profiles WHERE placement_id = user_id_param
    UNION ALL
    SELECT p.id FROM profiles p JOIN downline d ON p.placement_id = d.id
  )
  SELECT COUNT(*) INTO team_size FROM downline;

  -- Team performance via placement tree
  WITH RECURSIVE downline AS (
    SELECT id FROM profiles WHERE placement_id = user_id_param
    UNION ALL
    SELECT p.id FROM profiles p JOIN downline d ON p.placement_id = d.id
  )
  SELECT COALESCE(SUM(vp.principal), 0) INTO team_perf
  FROM vault_positions vp JOIN downline d ON vp.user_id = d.id WHERE vp.status = 'ACTIVE';

  SELECT COALESCE(SUM(principal), 0) INTO personal
  FROM vault_positions WHERE user_id = user_id_param AND status = 'ACTIVE';

  SELECT node_type INTO own_node FROM node_memberships WHERE user_id = user_id_param ORDER BY created_at DESC LIMIT 1;

  -- Node counts from referrer tree (推荐关系 for node calculations)
  SELECT COUNT(*) INTO direct_max_nodes FROM node_memberships nm JOIN profiles p ON nm.user_id = p.id
  WHERE p.referrer_id = user_id_param AND nm.node_type = 'MAX';

  SELECT COUNT(*) INTO direct_mini_nodes FROM node_memberships nm JOIN profiles p ON nm.user_id = p.id
  WHERE p.referrer_id = user_id_param AND nm.node_type = 'MINI';

  WITH RECURSIVE downline AS (
    SELECT id FROM profiles WHERE placement_id = user_id_param
    UNION ALL
    SELECT p.id FROM profiles p JOIN downline d ON p.placement_id = d.id
  )
  SELECT COUNT(*) INTO total_team_nodes FROM node_memberships nm JOIN downline d ON nm.user_id = d.id;

  RETURN jsonb_build_object(
    'teamSize', team_size, 'teamPerformance', ROUND(team_perf, 2)::TEXT,
    'personalHolding', ROUND(personal, 2)::TEXT,
    'directSponsorCount', direct_sponsor,
    'directPlacementCount', direct_placement,
    'ownNode', COALESCE(own_node, 'NONE'),
    'directMaxNodes', direct_max_nodes, 'directMiniNodes', direct_mini_nodes,
    'totalTeamNodes', total_team_nodes
  );
END;
$$;

-- ── 10. get_node_milestone_requirements: node referrals via referrer_id ──

CREATE OR REPLACE FUNCTION get_node_milestone_requirements(addr TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_vault_deposited NUMERIC := 0;
  v_direct_node_referrals INT := 0;
BEGIN
  SELECT id INTO v_user_id FROM profiles WHERE wallet_address = lower(addr);
  IF v_user_id IS NULL THEN
    RETURN json_build_object('vault_deposited', 0, 'direct_node_referrals', 0);
  END IF;

  SELECT COALESCE(SUM(principal), 0) INTO v_vault_deposited
  FROM vault_positions WHERE user_id = v_user_id AND status IN ('ACTIVE', 'COMPLETED');

  -- Node referral count: based on referrer_id (推荐关系)
  SELECT COUNT(*) INTO v_direct_node_referrals
  FROM node_memberships nm JOIN profiles p ON p.id = nm.user_id
  WHERE p.referrer_id = v_user_id AND nm.status IN ('ACTIVE', 'PENDING_MILESTONES');

  RETURN json_build_object('vault_deposited', v_vault_deposited, 'direct_node_referrals', v_direct_node_referrals);
END;
$$;

-- ── 11. batch_check_rank_promotions: unchanged but uses updated check_rank_promotion ──
-- (no change needed, it calls check_rank_promotion which is already updated)

-- ── 12. get_team_counts: use placement tree ──

CREATE OR REPLACE FUNCTION get_team_counts(profile_ids UUID[])
RETURNS TABLE(profile_id UUID, team_count INT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT pid, (
    WITH RECURSIVE team_tree AS (
      SELECT p.id FROM profiles p WHERE p.placement_id = pid
      UNION ALL
      SELECT p2.id FROM profiles p2 INNER JOIN team_tree t ON p2.placement_id = t.id
    )
    SELECT COUNT(*)::INT FROM team_tree
  ) AS team_count
  FROM unnest(profile_ids) AS pid;
END;
$$;
