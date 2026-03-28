-- Fix get_referral_tree: replace SELECT d.* with explicit columns
-- (vip_trial_used column broke GROUP BY)

CREATE OR REPLACE FUNCTION get_referral_tree(addr TEXT)
RETURNS JSONB AS $$
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

  WITH direct AS (
    SELECT id, wallet_address, rank, node_type, total_deposited, ref_code, referrer_id, placement_id
    FROM profiles WHERE placement_id = profile_row.id
  ),
  sub_counts AS (
    SELECT p2.placement_id AS parent_id, COUNT(*)::INT AS cnt
    FROM profiles p2
    WHERE p2.placement_id IN (SELECT id FROM direct)
    GROUP BY p2.placement_id
  ),
  team AS (
    SELECT d.id, d.wallet_address, d.rank, d.node_type, d.total_deposited, d.ref_code,
      d.referrer_id, d.placement_id,
      (SELECT wallet_address FROM profiles WHERE id = d.referrer_id) AS sponsor_wallet,
      (SELECT ref_code FROM profiles WHERE id = d.referrer_id) AS sponsor_code,
      (SELECT wallet_address FROM profiles WHERE id = d.placement_id) AS placed_by_wallet,
      jsonb_agg(
        CASE WHEN s.id IS NOT NULL THEN
          jsonb_build_object(
            'id', s.id, 'walletAddress', s.wallet_address, 'rank', s.rank,
            'nodeType', s.node_type, 'totalDeposited', s.total_deposited, 'level', 2,
            'refCode', s.ref_code,
            'sponsorWallet', (SELECT wallet_address FROM profiles WHERE id = s.referrer_id),
            'placedByWallet', (SELECT wallet_address FROM profiles WHERE id = s.placement_id),
            'subCount', COALESCE(sc.cnt, 0)
          )
        ELSE NULL END
      ) FILTER (WHERE s.id IS NOT NULL) AS sub_referrals
    FROM direct d
    LEFT JOIN profiles s ON s.placement_id = d.id
    LEFT JOIN sub_counts sc ON sc.parent_id = s.id
    GROUP BY d.id, d.wallet_address, d.rank, d.node_type, d.total_deposited, d.ref_code,
             d.referrer_id, d.placement_id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', t.id, 'walletAddress', t.wallet_address, 'rank', t.rank,
      'nodeType', t.node_type, 'totalDeposited', t.total_deposited, 'level', 1,
      'refCode', t.ref_code,
      'sponsorWallet', t.sponsor_wallet, 'sponsorCode', t.sponsor_code,
      'placedByWallet', t.placed_by_wallet,
      'subReferrals', COALESCE(t.sub_referrals, '[]'::JSONB),
      'teamSize', (
        WITH RECURSIVE tree AS (
          SELECT id FROM profiles WHERE placement_id = t.id
          UNION ALL
          SELECT p.id FROM profiles p JOIN tree ON p.placement_id = tree.id
        ) SELECT COUNT(*)::INT FROM tree
      )
    )
  ) INTO direct_refs FROM team t;

  SELECT COUNT(*)::INT INTO direct_count FROM profiles WHERE placement_id = profile_row.id;

  WITH RECURSIVE tree AS (
    SELECT id FROM profiles WHERE placement_id = profile_row.id
    UNION ALL
    SELECT p.id FROM profiles p JOIN tree ON p.placement_id = tree.id
  ) SELECT COUNT(*)::INT INTO total_team FROM tree;

  RETURN jsonb_build_object(
    'referrals', COALESCE(direct_refs, '[]'::JSONB),
    'teamSize', total_team,
    'directCount', direct_count
  );
END;
$$ LANGUAGE plpgsql;
