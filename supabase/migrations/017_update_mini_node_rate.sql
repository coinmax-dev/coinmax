-- Update MINI node daily rate from 0.5% to 0.9%
UPDATE node_memberships
SET daily_rate = 0.009
WHERE node_type = 'MINI';

-- Update config table if exists
UPDATE app_config
SET value = '0.009'
WHERE key = 'NODE_MINI_DAILY_RATE';

-- Update the purchase_node function to use new rate
CREATE OR REPLACE FUNCTION purchase_node(
  p_user_id UUID,
  p_node_type TEXT,
  p_payment_type TEXT DEFAULT 'FULL',
  p_tx_hash TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  contribution NUMERIC;
  frozen NUMERIC;
  daily_rate_val NUMERIC;
  duration_days INT;
  result_record RECORD;
BEGIN
  IF p_node_type = 'MAX' THEN
    contribution := 600;
    frozen := 6000;
    daily_rate_val := 0.009;
    duration_days := 120;
  ELSIF p_node_type = 'MINI' THEN
    contribution := 100;
    frozen := 1000;
    daily_rate_val := 0.009;
    duration_days := 90;
  ELSE
    RAISE EXCEPTION 'Invalid node type: %', p_node_type;
  END IF;

  INSERT INTO node_memberships (
    user_id, node_type, price, contribution_amount, frozen_amount, daily_rate,
    duration_days, end_date, status, tx_hash
  ) VALUES (
    p_user_id, p_node_type,
    contribution, frozen, daily_rate_val,
    duration_days, NOW() + (duration_days || ' days')::INTERVAL,
    'ACTIVE', p_tx_hash
  )
  RETURNING * INTO result_record;

  RETURN json_build_object('success', true, 'membership_id', result_record.id);
END;
$$;
