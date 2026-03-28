-- 500U Experience Bonus for first 1000 registered users
-- Bonus is a 5-day vault position with locked yield
-- Yield unlocks only when user deposits ≥100U on a 45/90/180 day plan

-- Track bonus grants
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bonus_granted BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bonus_yield_unlocked BOOLEAN DEFAULT FALSE;

-- Add bonus flag to vault_positions
ALTER TABLE vault_positions ADD COLUMN IF NOT EXISTS is_bonus BOOLEAN DEFAULT FALSE;
ALTER TABLE vault_positions ADD COLUMN IF NOT EXISTS bonus_yield_locked BOOLEAN DEFAULT FALSE;

-- Grant bonus on registration (called by auth_wallet)
CREATE OR REPLACE FUNCTION grant_registration_bonus(user_id UUID)
RETURNS JSONB AS $$
DECLARE
  total_granted INT;
  profile_row profiles%ROWTYPE;
BEGIN
  SELECT * INTO profile_row FROM profiles WHERE id = user_id;
  IF profile_row IS NULL THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'profile_not_found');
  END IF;

  -- Already granted
  IF profile_row.bonus_granted THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'already_granted');
  END IF;

  -- Check limit: first 1000 users only
  SELECT COUNT(*) INTO total_granted FROM profiles WHERE bonus_granted = TRUE;
  IF total_granted >= 1000 THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'limit_reached', 'total', total_granted);
  END IF;

  -- Grant: create 5-day vault position with 500U, yield locked
  INSERT INTO vault_positions (user_id, plan_type, principal, daily_rate, start_date, end_date, status, is_bonus, bonus_yield_locked)
  VALUES (
    user_id,
    'BONUS_5D',
    500,
    0.005,  -- 0.5% daily (same as 5-day plan)
    CURRENT_DATE,
    CURRENT_DATE + INTERVAL '5 days',
    'ACTIVE',
    TRUE,
    TRUE    -- yield is locked until user deposits ≥100U on 45/90/180 day plan
  );

  -- Mark profile
  UPDATE profiles SET bonus_granted = TRUE WHERE id = user_id;

  -- Record transaction
  INSERT INTO transactions (user_id, type, token, amount, status, tx_hash, details)
  VALUES (user_id, 'BONUS_GRANT', 'USDT', 500, 'COMPLETED', 'bonus_' || user_id::text,
    jsonb_build_object('type', 'registration_bonus', 'amount', 500, 'days', 5, 'yield_locked', true,
      'sequence', total_granted + 1));

  RETURN jsonb_build_object('granted', true, 'amount', 500, 'days', 5, 'sequence', total_granted + 1);
END;
$$ LANGUAGE plpgsql;

-- Unlock bonus yield when user deposits ≥100U on qualifying plan
-- Called by vault_deposit or vault-record edge function
CREATE OR REPLACE FUNCTION check_bonus_yield_unlock(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  has_qualifying BOOLEAN;
BEGIN
  -- Already unlocked?
  IF (SELECT bonus_yield_unlocked FROM profiles WHERE id = p_user_id) THEN
    RETURN TRUE;
  END IF;

  -- Check if user has any 45/90/180 day deposit ≥ 100U
  SELECT EXISTS(
    SELECT 1 FROM vault_positions
    WHERE user_id = p_user_id
      AND is_bonus = FALSE
      AND principal >= 100
      AND plan_type IN ('45_DAYS', '90_DAYS', '180_DAYS')
      AND status = 'ACTIVE'
  ) INTO has_qualifying;

  IF has_qualifying THEN
    -- Unlock all bonus yields
    UPDATE vault_positions SET bonus_yield_locked = FALSE
    WHERE user_id = p_user_id AND is_bonus = TRUE AND bonus_yield_locked = TRUE;

    UPDATE profiles SET bonus_yield_unlocked = TRUE WHERE id = p_user_id;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- Trigger: auto-check bonus unlock after any vault deposit
CREATE OR REPLACE FUNCTION trg_check_bonus_unlock()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_bonus = FALSE AND NEW.principal >= 100 THEN
    PERFORM check_bonus_yield_unlock(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vault_bonus_unlock ON vault_positions;
CREATE TRIGGER trg_vault_bonus_unlock
  AFTER INSERT ON vault_positions
  FOR EACH ROW
  EXECUTE FUNCTION trg_check_bonus_unlock();
