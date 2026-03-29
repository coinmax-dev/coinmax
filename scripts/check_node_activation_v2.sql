CREATE OR REPLACE FUNCTION check_node_activation(addr TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $body$
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
  IF profile_row.id IS NULL THEN RETURN jsonb_build_object('error','not found'); END IF;

  SELECT COALESCE(SUM(principal),0) INTO v_vault_deposited
  FROM vault_positions WHERE user_id = profile_row.id AND status IN ('ACTIVE','COMPLETED') AND plan_type != 'BONUS_5D';

  SELECT COUNT(DISTINCT nm.user_id) INTO v_mini_referrals
  FROM node_memberships nm JOIN profiles p ON p.id = nm.user_id
  WHERE p.referrer_id = profile_row.id AND nm.node_type = 'MINI' AND nm.status IN ('ACTIVE','PENDING_MILESTONES');

  FOR membership IN SELECT * FROM node_memberships WHERE user_id = profile_row.id AND status IN ('ACTIVE','PENDING_MILESTONES')
  LOOP
    IF membership.node_type = 'MAX' THEN
      SELECT value::JSONB INTO tiers_json FROM system_config WHERE key = 'MAX_ACTIVATION_TIERS';
    ELSE
      SELECT value::JSONB INTO tiers_json FROM system_config WHERE key = 'MINI_ACTIVATION_TIERS';
    END IF;
    IF tiers_json IS NULL THEN CONTINUE; END IF;
    best_rank := NULL; best_rank_idx := 0;
    FOR tier IN SELECT * FROM jsonb_array_elements(tiers_json) LOOP
      tier_vault := (tier->>'vault_deposit')::NUMERIC;
      tier_refs := COALESCE((tier->>'required_mini_referrals')::INT, 0);
      tier_rank_idx := CASE WHEN tier->>'rank'='V1' THEN 1 WHEN tier->>'rank'='V2' THEN 2 WHEN tier->>'rank'='V3' THEN 3 WHEN tier->>'rank'='V4' THEN 4 WHEN tier->>'rank'='V5' THEN 5 WHEN tier->>'rank'='V6' THEN 6 ELSE 0 END;
      IF v_vault_deposited >= tier_vault AND v_mini_referrals >= tier_refs THEN
        IF tier_rank_idx > best_rank_idx THEN best_rank := tier->>'rank'; best_rank_idx := tier_rank_idx; END IF;
      END IF;
    END LOOP;
    IF best_rank IS NOT NULL THEN
      IF membership.activated_rank IS NULL OR best_rank_idx > (CASE WHEN membership.activated_rank='V1' THEN 1 WHEN membership.activated_rank='V2' THEN 2 WHEN membership.activated_rank='V3' THEN 3 WHEN membership.activated_rank='V4' THEN 4 WHEN membership.activated_rank='V5' THEN 5 WHEN membership.activated_rank='V6' THEN 6 ELSE 0 END) THEN
        UPDATE node_memberships SET activated_rank = best_rank,
          earnings_capacity = CASE WHEN activated_rank IS NULL THEN 1.0 ELSE earnings_capacity END,
          activated_at = CASE WHEN activated_rank IS NULL THEN NOW() ELSE activated_at END
        WHERE id = membership.id;
        UPDATE profiles SET rank = best_rank WHERE id = profile_row.id
          AND (rank IS NULL OR CASE WHEN rank='V1' THEN 1 WHEN rank='V2' THEN 2 WHEN rank='V3' THEN 3 WHEN rank='V4' THEN 4 WHEN rank='V5' THEN 5 WHEN rank='V6' THEN 6 WHEN rank='V7' THEN 7 ELSE 0 END < best_rank_idx);
        activated_count := activated_count + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('activated', activated_count, 'vaultDeposited', v_vault_deposited, 'miniReferrals', v_mini_referrals);
END;
$body$;
