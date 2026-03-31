-- Fix check_rank_promotion: node activated_rank is the minimum rank floor
-- If node is activated at V2, user can never drop below V2 even without team
CREATE OR REPLACE FUNCTION check_rank_promotion(addr TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $fn$
DECLARE
  profile_row profiles%ROWTYPE;
  conditions JSONB;
  current_rank TEXT;
  new_rank TEXT := NULL;
  node_floor_rank TEXT := NULL;
  node_floor_idx INT := 0;
  personal_holding NUMERIC;
  direct_referral_count INT;
  team_performance NUMERIC;
  team_performance_3gen NUMERIC;
  rank_levels TEXT[] := ARRAY['V1','V2','V3','V4','V5','V6','V7'];
  target_rank_idx INT;
  cond_holding NUMERIC;
  cond_referrals INT;
  cond_sub_ranks INT;
  cond_sub_level TEXT;
  cond_team_perf NUMERIC;
  qualified_line_count INT;
  qualified BOOLEAN;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  current_rank := profile_row.rank;
  SELECT value::JSONB INTO conditions FROM system_config WHERE key = 'RANK_CONDITIONS';

  -- Get node activation floor rank (minimum guaranteed rank)
  SELECT nm.activated_rank INTO node_floor_rank
  FROM node_memberships nm
  WHERE nm.user_id = profile_row.id
    AND nm.activated_rank IS NOT NULL
    AND nm.status IN ('ACTIVE', 'PENDING_MILESTONES')
  ORDER BY CASE
    WHEN nm.activated_rank = 'V1' THEN 1 WHEN nm.activated_rank = 'V2' THEN 2
    WHEN nm.activated_rank = 'V3' THEN 3 WHEN nm.activated_rank = 'V4' THEN 4
    WHEN nm.activated_rank = 'V5' THEN 5 WHEN nm.activated_rank = 'V6' THEN 6
    ELSE 0
  END DESC
  LIMIT 1;

  IF node_floor_rank IS NOT NULL THEN
    node_floor_idx := COALESCE(array_position(rank_levels, node_floor_rank), 0);
  END IF;

  -- Personal holding (exclude bonus)
  SELECT COALESCE(SUM(principal), 0) INTO personal_holding
  FROM vault_positions
  WHERE user_id = profile_row.id AND status = 'ACTIVE' AND plan_type != 'BONUS_5D';

  -- Direct referrals with active deposits
  SELECT COUNT(*) INTO direct_referral_count
  FROM profiles p
  WHERE p.referrer_id = profile_row.id
    AND EXISTS (
      SELECT 1 FROM vault_positions vp
      WHERE vp.user_id = p.id AND vp.status = 'ACTIVE' AND vp.plan_type != 'BONUS_5D'
    );

  -- Full team performance
  WITH RECURSIVE downline AS (
    SELECT id FROM profiles WHERE referrer_id = profile_row.id
    UNION ALL
    SELECT p.id FROM profiles p JOIN downline d ON p.referrer_id = d.id
  )
  SELECT COALESCE(SUM(vp.principal), 0) INTO team_performance
  FROM vault_positions vp
  JOIN downline d ON vp.user_id = d.id
  WHERE vp.status = 'ACTIVE' AND vp.plan_type != 'BONUS_5D';

  -- 3-gen team performance (for V1)
  WITH RECURSIVE downline_3gen AS (
    SELECT id, 1 as depth FROM profiles WHERE referrer_id = profile_row.id
    UNION ALL
    SELECT p.id, d.depth + 1 FROM profiles p JOIN downline_3gen d ON p.referrer_id = d.id
    WHERE d.depth < 3
  )
  SELECT COALESCE(SUM(vp.principal), 0) INTO team_performance_3gen
  FROM vault_positions vp
  JOIN downline_3gen d ON vp.user_id = d.id
  WHERE vp.status = 'ACTIVE' AND vp.plan_type != 'BONUS_5D';

  -- Check each rank
  FOR target_rank_idx IN 1..array_length(rank_levels, 1) LOOP
    SELECT
      COALESCE((elem->>'personalHolding')::NUMERIC, 0),
      COALESCE((elem->>'directReferrals')::INT, 0),
      COALESCE((elem->>'requiredSubRanks')::INT, 0),
      COALESCE(elem->>'subRankLevel', ''),
      COALESCE((elem->>'teamPerformance')::NUMERIC, 0)
    INTO cond_holding, cond_referrals, cond_sub_ranks, cond_sub_level, cond_team_perf
    FROM jsonb_array_elements(conditions) AS elem
    WHERE elem->>'level' = rank_levels[target_rank_idx];

    qualified := TRUE;

    IF personal_holding < cond_holding THEN qualified := FALSE; END IF;

    IF qualified THEN
      IF rank_levels[target_rank_idx] = 'V1' THEN
        IF team_performance_3gen < cond_team_perf THEN qualified := FALSE; END IF;
      ELSE
        IF team_performance < cond_team_perf THEN qualified := FALSE; END IF;
      END IF;
    END IF;

    IF qualified AND rank_levels[target_rank_idx] = 'V1' THEN
      IF direct_referral_count < cond_referrals THEN qualified := FALSE; END IF;
    END IF;

    IF qualified AND cond_sub_ranks > 0 AND cond_sub_level != '' THEN
      SELECT COUNT(*) INTO qualified_line_count
      FROM (
        SELECT dr.id AS line_root
        FROM profiles dr
        WHERE dr.referrer_id = profile_row.id
        AND EXISTS (
          WITH RECURSIVE line_tree AS (
            SELECT dr.id AS mid
            UNION ALL
            SELECT p.id FROM profiles p JOIN line_tree lt ON p.referrer_id = lt.mid
          )
          SELECT 1 FROM profiles lp
          JOIN line_tree lt ON lp.id = lt.mid
          WHERE lp.rank IS NOT NULL
            AND array_position(rank_levels, lp.rank) >= array_position(rank_levels, cond_sub_level)
        )
      ) qualified_lines;

      IF qualified_line_count < cond_sub_ranks THEN qualified := FALSE; END IF;
    END IF;

    IF qualified THEN
      new_rank := rank_levels[target_rank_idx];
    ELSE
      EXIT;
    END IF;
  END LOOP;

  -- Apply node floor: never drop below node activated rank
  IF node_floor_idx > 0 THEN
    IF new_rank IS NULL OR COALESCE(array_position(rank_levels, new_rank), 0) < node_floor_idx THEN
      new_rank := node_floor_rank;
    END IF;
  END IF;

  -- Apply rank change
  IF new_rank IS DISTINCT FROM current_rank THEN
    UPDATE profiles SET rank = new_rank WHERE id = profile_row.id;
  END IF;

  RETURN jsonb_build_object(
    'previousRank', current_rank,
    'currentRank', new_rank,
    'promoted', (new_rank IS NOT NULL AND current_rank IS NOT NULL AND
                 COALESCE(array_position(rank_levels, new_rank), 0) > COALESCE(array_position(rank_levels, current_rank), 0)),
    'demoted', (COALESCE(array_position(rank_levels, new_rank), 0) < COALESCE(array_position(rank_levels, current_rank), 0)),
    'personalHolding', ROUND(personal_holding, 2)::TEXT,
    'directReferrals', direct_referral_count,
    'teamPerformance', ROUND(team_performance, 2)::TEXT,
    'teamPerformance3gen', ROUND(team_performance_3gen, 2)::TEXT,
    'nodeFloorRank', node_floor_rank
  );
END;
$fn$;
