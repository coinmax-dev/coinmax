-- 7-day VIP trial: each user gets one free trial, then must pay

-- Add trial tracking column
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS vip_trial_used BOOLEAN DEFAULT FALSE;

-- Update subscribe_vip to handle trial plan
CREATE OR REPLACE FUNCTION subscribe_vip(
  addr TEXT,
  tx_hash TEXT DEFAULT NULL,
  plan_label TEXT DEFAULT 'monthly'
) RETURNS JSONB AS $$
DECLARE
  profile_row profiles%ROWTYPE;
  vip_interval INTERVAL;
  vip_amount NUMERIC;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE wallet_address = addr;
  IF NOT FOUND THEN
    INSERT INTO profiles (wallet_address) VALUES (addr) RETURNING * INTO profile_row;
  END IF;

  -- Determine plan
  IF plan_label = 'trial' THEN
    -- Check if trial already used
    IF profile_row.vip_trial_used THEN
      RAISE EXCEPTION 'Free trial already used for this account';
    END IF;
    vip_interval := INTERVAL '7 days';
    vip_amount := 0;
  ELSIF plan_label = 'halfyear' THEN
    vip_interval := INTERVAL '180 days';
    vip_amount := 149;
  ELSIF plan_label = 'yearly' THEN
    vip_interval := INTERVAL '365 days';
    vip_amount := 899;
  ELSE
    -- monthly (default)
    vip_interval := INTERVAL '30 days';
    vip_amount := 49;
  END IF;

  -- Activate VIP (extend if already active)
  UPDATE profiles SET
    is_vip = TRUE,
    vip_expires_at = CASE
      WHEN is_vip AND vip_expires_at > NOW() THEN vip_expires_at + vip_interval
      ELSE NOW() + vip_interval
    END,
    vip_trial_used = CASE WHEN plan_label = 'trial' THEN TRUE ELSE vip_trial_used END,
    updated_at = NOW()
  WHERE id = profile_row.id
  RETURNING * INTO profile_row;

  -- Record transaction
  INSERT INTO transactions (user_id, type, amount, status, tx_hash, metadata)
  VALUES (
    profile_row.id,
    'VIP_PURCHASE',
    vip_amount,
    'COMPLETED',
    tx_hash,
    jsonb_build_object('plan', plan_label, 'days', EXTRACT(DAY FROM vip_interval)::int)
  );

  RETURN to_jsonb(profile_row);
END;
$$ LANGUAGE plpgsql;
