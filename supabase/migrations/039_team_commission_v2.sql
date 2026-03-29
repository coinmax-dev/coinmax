-- Team Commission V2: add same-rank bonus (10%) + override bonus (5%)
--
-- Reward types:
--   1. direct_referral (10%): referrer_id gets 10% of source daily yield
--   2. differential: placement upline gets (own_rate - prev_rate) × base
--   3. same_rank: same rank as below → extra 10% of that level's differential
--   4. override: lower rank gets 5% of higher-rank downline's yield

CREATE OR REPLACE FUNCTION settle_team_commission(
  base_amount NUMERIC,
  source_user_id UUID
) RETURNS JSONB AS $$
DECLARE
  ranks_json JSONB;
  max_depth INT;
  direct_rate NUMERIC;
  same_rank_rate NUMERIC;
  override_rate NUMERIC;
  direct_referrer_id UUID;
  current_user_id UUID;
  upline_id UUID;
  current_depth INT := 0;
  prev_rate NUMERIC := 0;
  prev_rank TEXT := NULL;
  upline_rank TEXT;
  upline_commission NUMERIC;
  diff_rate NUMERIC;
  commission NUMERIC;
  total_commission NUMERIC := 0;
  commissions_paid INT := 0;
  same_rank_paid BOOLEAN := FALSE;
  override_paid BOOLEAN := FALSE;
BEGIN
  SELECT value::JSONB INTO ranks_json FROM system_config WHERE key = 'RANKS';
  SELECT COALESCE(value::INT, 15) INTO max_depth FROM system_config WHERE key = 'TEAM_MAX_DEPTH';
  SELECT COALESCE(value::NUMERIC, 0.10) INTO direct_rate FROM system_config WHERE key = 'DIRECT_REFERRAL_RATE';
  SELECT COALESCE(value::NUMERIC, 0.10) INTO same_rank_rate FROM system_config WHERE key = 'SAME_RANK_RATE';
  SELECT COALESCE(value::NUMERIC, 0.05) INTO override_rate FROM system_config WHERE key = 'OVERRIDE_RATE';

  -- ── 1. Direct referral bonus: 10% to REFERRER (推荐人) ──
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

  -- ── 2-4. Walk up PLACEMENT tree for differential + same-rank + override ──
  current_user_id := source_user_id;

  LOOP
    current_depth := current_depth + 1;
    IF current_depth > max_depth THEN EXIT; END IF;

    SELECT placement_id INTO upline_id FROM profiles WHERE id = current_user_id;
    IF upline_id IS NULL THEN EXIT; END IF;

    SELECT rank INTO upline_rank FROM profiles WHERE id = upline_id;

    SELECT COALESCE((elem->>'commission')::NUMERIC, 0)
    INTO upline_commission
    FROM jsonb_array_elements(ranks_json) AS elem
    WHERE elem->>'level' = upline_rank;

    IF upline_commission IS NULL THEN upline_commission := 0; END IF;

    -- ── 2. Differential commission (级差奖励) ──
    diff_rate := GREATEST(upline_commission - prev_rate, 0);
    IF diff_rate > 0 THEN
      commission := base_amount * diff_rate;
      INSERT INTO node_rewards (user_id, reward_type, amount, details)
      VALUES (upline_id, 'TEAM_COMMISSION', commission,
        jsonb_build_object('type', 'differential', 'source_user', source_user_id,
          'depth', current_depth, 'rate', diff_rate));
      total_commission := total_commission + commission;
      commissions_paid := commissions_paid + 1;
    END IF;

    -- ── 3. Same-rank bonus (同级奖励) — ONLY ONCE ──
    IF NOT same_rank_paid
       AND upline_rank IS NOT NULL AND prev_rank IS NOT NULL
       AND upline_rank = prev_rank AND same_rank_rate > 0
    THEN
      commission := base_amount * upline_commission * same_rank_rate;
      IF commission > 0 THEN
        INSERT INTO node_rewards (user_id, reward_type, amount, details)
        VALUES (upline_id, 'TEAM_COMMISSION', commission,
          jsonb_build_object('type', 'same_rank', 'source_user', source_user_id,
            'depth', current_depth, 'rate', same_rank_rate, 'matched_rank', upline_rank));
        total_commission := total_commission + commission;
        commissions_paid := commissions_paid + 1;
        same_rank_paid := TRUE;
      END IF;
    END IF;

    -- ── 4. Override bonus (越级奖励) — ONLY ONCE ──
    IF NOT override_paid
       AND upline_commission > 0 AND upline_commission < prev_rate
       AND override_rate > 0
    THEN
      commission := base_amount * override_rate;
      IF commission > 0 THEN
        INSERT INTO node_rewards (user_id, reward_type, amount, details)
        VALUES (upline_id, 'TEAM_COMMISSION', commission,
          jsonb_build_object('type', 'override', 'source_user', source_user_id,
            'depth', current_depth, 'rate', override_rate));
        total_commission := total_commission + commission;
        commissions_paid := commissions_paid + 1;
        override_paid := TRUE;
      END IF;
    END IF;

    -- Track highest rate seen and rank
    IF upline_commission > prev_rate THEN
      prev_rate := upline_commission;
    END IF;
    prev_rank := upline_rank;

    current_user_id := upline_id;
  END LOOP;

  RETURN jsonb_build_object('totalCommission', ROUND(total_commission, 6)::TEXT, 'commissionsPaid', commissions_paid);
END;
$$ LANGUAGE plpgsql;

-- Add config values for same-rank and override rates
INSERT INTO system_config (key, value, description) VALUES
  ('SAME_RANK_RATE', '0.10', '同级奖励比例 (10%)'),
  ('OVERRIDE_RATE', '0.05', '越级奖励比例 (5%)')
ON CONFLICT (key) DO NOTHING;
