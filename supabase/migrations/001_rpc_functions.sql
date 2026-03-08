-- =============================================
-- CoinMax RPC Functions for Supabase
-- =============================================

-- auth_wallet: upsert profile, handle referral code
CREATE OR REPLACE FUNCTION auth_wallet(addr TEXT, ref_code TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  result profiles%ROWTYPE;
  referrer_profile profiles%ROWTYPE;
BEGIN
  SELECT * INTO result FROM profiles WHERE wallet_address = addr;

  -- Resolve referrer if ref_code provided
  IF ref_code IS NOT NULL AND ref_code != '' THEN
    SELECT * INTO referrer_profile FROM profiles WHERE profiles.ref_code = auth_wallet.ref_code;
  END IF;

  IF result.id IS NOT NULL THEN
    -- Existing user: bind referrer if not yet bound and referrer is valid
    IF result.referrer_id IS NULL AND referrer_profile.id IS NOT NULL AND referrer_profile.id != result.id THEN
      UPDATE profiles SET referrer_id = referrer_profile.id WHERE id = result.id
      RETURNING * INTO result;
    END IF;
    RETURN to_jsonb(result);
  END IF;

  -- New user: require valid referral code
  IF referrer_profile.id IS NULL THEN
    RETURN jsonb_build_object('error', 'REFERRAL_REQUIRED', 'message', 'A valid referral code is required to register');
  END IF;

  INSERT INTO profiles (wallet_address, referrer_id)
  VALUES (addr, referrer_profile.id)
  RETURNING * INTO result;

  RETURN to_jsonb(result);
END;
$$;

-- vault_deposit: validate plan, create position + transaction, update totalDeposited
CREATE OR REPLACE FUNCTION vault_deposit(addr TEXT, plan_type TEXT, deposit_amount NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  plan_days INT;
  plan_rate NUMERIC;
  end_dt TIMESTAMP;
  pos vault_positions%ROWTYPE;
  tx transactions%ROWTYPE;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    INSERT INTO profiles (wallet_address) VALUES (addr) RETURNING * INTO profile_row;
  END IF;

  IF plan_type = '7_DAYS' THEN plan_days := 7; plan_rate := 0.005;
  ELSIF plan_type = '30_DAYS' THEN plan_days := 30; plan_rate := 0.007;
  ELSIF plan_type = '90_DAYS' THEN plan_days := 90; plan_rate := 0.009;
  ELSIF plan_type = '180_DAYS' THEN plan_days := 180; plan_rate := 0.012;
  ELSIF plan_type = '360_DAYS' THEN plan_days := 360; plan_rate := 0.015;
  ELSE plan_days := 7; plan_rate := 0.005;
  END IF;

  end_dt := NOW() + (plan_days || ' days')::INTERVAL;

  INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, end_date, status)
  VALUES (profile_row.id, plan_type, deposit_amount, plan_rate, end_dt, 'ACTIVE')
  RETURNING * INTO pos;

  INSERT INTO transactions (user_id, type, token, amount, status)
  VALUES (profile_row.id, 'DEPOSIT', 'USDT', deposit_amount, 'CONFIRMED')
  RETURNING * INTO tx;

  UPDATE profiles SET total_deposited = COALESCE(total_deposited, 0) + deposit_amount
  WHERE id = profile_row.id;

  RETURN jsonb_build_object('position', to_jsonb(pos), 'transaction', to_jsonb(tx));
END;
$$;

-- vault_withdraw: calculate yield, update position, create transaction
CREATE OR REPLACE FUNCTION vault_withdraw(addr TEXT, pos_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  pos vault_positions%ROWTYPE;
  days_elapsed INT;
  yield_amount NUMERIC;
  total_withdraw NUMERIC;
  is_early BOOLEAN;
  tx transactions%ROWTYPE;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  SELECT * INTO pos FROM vault_positions WHERE id = pos_id AND user_id = profile_row.id;
  IF pos.id IS NULL THEN
    RAISE EXCEPTION 'Position not found';
  END IF;

  days_elapsed := GREATEST(0, EXTRACT(DAY FROM NOW() - pos.start_date)::INT);
  yield_amount := pos.principal * pos.daily_rate * days_elapsed;
  total_withdraw := pos.principal + yield_amount;
  is_early := pos.end_date IS NOT NULL AND NOW() < pos.end_date;

  UPDATE vault_positions SET status = CASE WHEN is_early THEN 'EARLY_EXIT' ELSE 'COMPLETED' END
  WHERE id = pos_id;

  INSERT INTO transactions (user_id, type, token, amount, status)
  VALUES (profile_row.id, 'WITHDRAW', 'USDT', ROUND(total_withdraw, 6), 'CONFIRMED')
  RETURNING * INTO tx;

  IF yield_amount > 0 THEN
    INSERT INTO transactions (user_id, type, token, amount, status)
    VALUES (profile_row.id, 'YIELD', 'USDT', ROUND(yield_amount, 6), 'CONFIRMED');
  END IF;

  UPDATE profiles SET total_withdrawn = COALESCE(total_withdrawn, 0) + total_withdraw
  WHERE id = profile_row.id;

  RETURN jsonb_build_object(
    'transaction', to_jsonb(tx),
    'yieldAmount', ROUND(yield_amount, 6)::TEXT,
    'totalWithdraw', ROUND(total_withdraw, 6)::TEXT
  );
END;
$$;

-- place_trade_bet: create bet with entry price
CREATE OR REPLACE FUNCTION place_trade_bet(
  addr TEXT, bet_asset TEXT, bet_direction TEXT, bet_amount NUMERIC,
  bet_duration TEXT DEFAULT '1min', bet_entry_price NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  bet trade_bets%ROWTYPE;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    INSERT INTO profiles (wallet_address) VALUES (addr) RETURNING * INTO profile_row;
  END IF;

  INSERT INTO trade_bets (user_id, asset, direction, amount, duration, entry_price)
  VALUES (profile_row.id, bet_asset, bet_direction, bet_amount, bet_duration, bet_entry_price)
  RETURNING * INTO bet;

  RETURN to_jsonb(bet);
END;
$$;

-- get_trade_stats: aggregate wins/losses/total from trade_bets
CREATE OR REPLACE FUNCTION get_trade_stats(addr TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  total_count INT;
  win_count INT;
  loss_count INT;
  staked_sum NUMERIC;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'wins', 0, 'losses', 0, 'totalStaked', '0');
  END IF;

  SELECT COUNT(*), COALESCE(SUM(amount), 0)
  INTO total_count, staked_sum
  FROM trade_bets WHERE user_id = profile_row.id;

  SELECT COUNT(*) INTO win_count
  FROM trade_bets WHERE user_id = profile_row.id AND result = 'WIN';

  SELECT COUNT(*) INTO loss_count
  FROM trade_bets WHERE user_id = profile_row.id AND result = 'LOSS';

  RETURN jsonb_build_object(
    'total', total_count,
    'wins', win_count,
    'losses', loss_count,
    'totalStaked', staked_sum::TEXT
  );
END;
$$;

-- subscribe_strategy: check VIP status, create subscription
CREATE OR REPLACE FUNCTION subscribe_strategy(addr TEXT, strat_id TEXT, capital NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  strat strategies%ROWTYPE;
  sub strategy_subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  SELECT * INTO strat FROM strategies WHERE id = strat_id;
  IF strat.id IS NULL THEN
    RAISE EXCEPTION 'Strategy not found';
  END IF;

  IF strat.is_vip_only AND NOT profile_row.is_vip THEN
    RAISE EXCEPTION 'VIP subscription required';
  END IF;

  INSERT INTO strategy_subscriptions (user_id, strategy_id, allocated_capital)
  VALUES (profile_row.id, strat_id, capital)
  RETURNING * INTO sub;

  RETURN to_jsonb(sub);
END;
$$;

-- purchase_hedge: min 100, create position + purchase + transaction
CREATE OR REPLACE FUNCTION purchase_hedge(addr TEXT, hedge_amount NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  hedge hedge_positions%ROWTYPE;
BEGIN
  IF hedge_amount < 100 THEN
    RAISE EXCEPTION 'Minimum 100 USDT required';
  END IF;

  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    INSERT INTO profiles (wallet_address) VALUES (addr) RETURNING * INTO profile_row;
  END IF;

  INSERT INTO hedge_positions (user_id, amount, purchase_amount, current_pnl, status)
  VALUES (profile_row.id, hedge_amount, 0, 0, 'ACTIVE')
  RETURNING * INTO hedge;

  INSERT INTO insurance_purchases (user_id, amount, status)
  VALUES (profile_row.id, hedge_amount, 'ACTIVE');

  INSERT INTO transactions (user_id, type, token, amount, status)
  VALUES (profile_row.id, 'HEDGE_PURCHASE', 'USDT', hedge_amount, 'CONFIRMED');

  RETURN to_jsonb(hedge);
END;
$$;

-- subscribe_vip: update profile, create transaction
CREATE OR REPLACE FUNCTION subscribe_vip(addr TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  UPDATE profiles SET is_vip = TRUE, vip_expires_at = NOW() + INTERVAL '1 month'
  WHERE id = profile_row.id
  RETURNING * INTO profile_row;

  INSERT INTO transactions (user_id, type, token, amount, status)
  VALUES (profile_row.id, 'VIP_PURCHASE', 'USDT', '99', 'CONFIRMED');

  RETURN to_jsonb(profile_row);
END;
$$;

-- purchase_node: create membership, update profile, create transaction
CREATE OR REPLACE FUNCTION purchase_node(addr TEXT, node_type_param TEXT, tx_hash TEXT DEFAULT NULL, payment_mode_param TEXT DEFAULT 'FULL')
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  node_price NUMERIC;
  node_duration INT;
  node_rank TEXT;
  charge_amount NUMERIC;
  membership node_memberships%ROWTYPE;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  -- New pricing: MINI=100 USDC, MAX=1000 USDC
  IF node_type_param = 'MAX' THEN
    node_price := 1000;
    node_duration := 120;
  ELSE
    node_price := 100;
    node_duration := 90;
  END IF;

  IF payment_mode_param = 'DEPOSIT' THEN
    charge_amount := node_price * 0.1;
  ELSE
    charge_amount := node_price;
  END IF;

  INSERT INTO node_memberships (user_id, node_type, price, status, start_date, end_date)
  VALUES (profile_row.id, node_type_param, node_price,
    CASE WHEN payment_mode_param = 'DEPOSIT' THEN 'PENDING_MILESTONES' ELSE 'ACTIVE' END,
    NOW(), NOW() + (node_duration || ' days')::INTERVAL)
  RETURNING * INTO membership;

  -- Don't auto-set rank on purchase; rank is evaluated separately
  UPDATE profiles SET node_type = node_type_param
  WHERE id = profile_row.id;

  INSERT INTO transactions (user_id, type, token, amount, tx_hash, status)
  VALUES (profile_row.id, 'NODE_PURCHASE', 'USDC', charge_amount, tx_hash, 'CONFIRMED');

  RETURN to_jsonb(membership);
END;
$$;

-- place_prediction_bet: create prediction bet with calculated payout
CREATE OR REPLACE FUNCTION place_prediction_bet(
  addr TEXT, market_id_param TEXT, market_type_param TEXT,
  question_param TEXT, choice_param TEXT, odds_param NUMERIC, amount_param NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  odds_val NUMERIC;
  payout NUMERIC;
  bet prediction_bets%ROWTYPE;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF profile_row.id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  odds_val := GREATEST(odds_param, 0.01);
  payout := ROUND(amount_param * (1.0 / odds_val), 6);

  INSERT INTO prediction_bets (user_id, market_id, market_type, question, choice, odds, amount, potential_payout, status)
  VALUES (profile_row.id, market_id_param, market_type_param, question_param, choice_param, odds_val, amount_param, payout, 'ACTIVE')
  RETURNING * INTO bet;

  RETURN to_jsonb(bet);
END;
$$;

-- get_vault_overview: count/sum from vault_positions
CREATE OR REPLACE FUNCTION get_vault_overview()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  tvl NUMERIC;
  holder_count INT;
  active_count INT;
BEGIN
  SELECT COALESCE(SUM(principal), 0), COUNT(DISTINCT user_id), COUNT(*)
  INTO tvl, holder_count, active_count
  FROM vault_positions WHERE status = 'ACTIVE';

  RETURN jsonb_build_object(
    'tvl', tvl::TEXT,
    'holders', holder_count,
    'activePositions', active_count,
    'maxApr', '65.7'
  );
END;
$$;

-- get_strategy_overview: aggregate from strategies
CREATE OR REPLACE FUNCTION get_strategy_overview()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  total_aum_val NUMERIC;
  avg_win NUMERIC;
  avg_monthly NUMERIC;
BEGIN
  SELECT COALESCE(SUM(total_aum), 0), COALESCE(AVG(win_rate), 0), COALESCE(AVG(monthly_return), 0)
  INTO total_aum_val, avg_win, avg_monthly
  FROM strategies WHERE status = 'ACTIVE';

  RETURN jsonb_build_object(
    'totalAum', total_aum_val::TEXT,
    'avgWinRate', ROUND(avg_win, 2)::TEXT,
    'avgMonthlyReturn', ROUND(avg_monthly, 2)::TEXT
  );
END;
$$;

-- get_insurance_pool: aggregate from insurance_purchases
CREATE OR REPLACE FUNCTION get_insurance_pool()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  pool_size NUMERIC;
  total_policies INT;
  total_paid NUMERIC;
BEGIN
  SELECT COALESCE(SUM(amount), 0), COUNT(*)
  INTO pool_size, total_policies
  FROM insurance_purchases WHERE status = 'ACTIVE';

  -- total_paid = sum of actual payouts (purchase_amount) from hedge_positions
  SELECT COALESCE(SUM(purchase_amount), 0) INTO total_paid FROM hedge_positions WHERE status = 'ACTIVE';

  RETURN jsonb_build_object(
    'poolSize', pool_size::TEXT,
    'totalPolicies', total_policies,
    'totalPaid', total_paid::TEXT
  );
END;
$$;

-- get_referral_tree: recursive 2-level referral tree with subCount for level 2
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

  WITH direct AS (
    SELECT * FROM profiles WHERE referrer_id = profile_row.id
  ),
  sub_counts AS (
    SELECT referrer_id, COUNT(*)::INT AS cnt
    FROM profiles
    WHERE referrer_id IN (SELECT id FROM profiles WHERE referrer_id IN (SELECT id FROM direct))
    GROUP BY referrer_id
  ),
  team AS (
    SELECT d.*, jsonb_agg(
      CASE WHEN s.id IS NOT NULL THEN
        jsonb_build_object(
          'id', s.id, 'walletAddress', s.wallet_address, 'rank', s.rank,
          'nodeType', s.node_type, 'totalDeposited', s.total_deposited, 'level', 2,
          'subCount', COALESCE(sc.cnt, 0)
        )
      ELSE NULL END
    ) FILTER (WHERE s.id IS NOT NULL) AS sub_referrals
    FROM direct d
    LEFT JOIN profiles s ON s.referrer_id = d.id
    LEFT JOIN sub_counts sc ON sc.referrer_id = s.id
    GROUP BY d.id, d.wallet_address, d.ref_code, d.referrer_id, d.rank,
             d.node_type, d.is_vip, d.vip_expires_at, d.total_deposited,
             d.total_withdrawn, d.referral_earnings, d.created_at
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', t.id, 'walletAddress', t.wallet_address, 'rank', t.rank,
      'nodeType', t.node_type, 'totalDeposited', t.total_deposited, 'level', 1,
      'subReferrals', COALESCE(t.sub_referrals, '[]'::JSONB)
    )
  ), COUNT(*)::INT
  INTO direct_refs, direct_count
  FROM team t;

  SELECT direct_count + COALESCE(
    (SELECT COUNT(*) FROM profiles WHERE referrer_id IN (SELECT id FROM profiles WHERE referrer_id = profile_row.id)),
    0
  ) INTO total_team;

  RETURN jsonb_build_object(
    'referrals', COALESCE(direct_refs, '[]'::JSONB),
    'teamSize', total_team,
    'directCount', direct_count
  );
END;
$$;
