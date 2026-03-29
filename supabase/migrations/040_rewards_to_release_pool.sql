-- All team/direct rewards flow to release pool (earnings_releases table)
-- Users claim from release pool using the 5-plan release mechanism

-- Modify settle_vault_daily to route commissions to earnings_releases
-- instead of just node_rewards. The node_rewards insert stays as ledger,
-- but we also create a pending release entry.

-- Add a trigger: after insert on node_rewards with TEAM_COMMISSION type,
-- auto-create an earnings_releases entry

CREATE OR REPLACE FUNCTION auto_create_release_for_commission()
RETURNS TRIGGER AS $$
BEGIN
  -- Only for TEAM_COMMISSION rewards
  IF NEW.reward_type = 'TEAM_COMMISSION' AND NEW.amount > 0 THEN
    INSERT INTO earnings_releases (
      user_id,
      source_type,
      gross_amount,
      net_amount,
      burn_amount,
      release_days,
      status,
      released_at
    ) VALUES (
      NEW.user_id,
      'TEAM_COMMISSION',
      NEW.amount,
      NEW.amount,  -- full amount available (burn happens at claim time)
      0,
      0,           -- pending: user chooses plan when claiming
      'PENDING',
      NULL
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Check if source_type column exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'earnings_releases' AND column_name = 'source_type') THEN
    ALTER TABLE earnings_releases ADD COLUMN source_type TEXT DEFAULT 'VAULT_YIELD';
  END IF;
END $$;

-- Create trigger
DROP TRIGGER IF EXISTS trg_commission_to_release ON node_rewards;
CREATE TRIGGER trg_commission_to_release
  AFTER INSERT ON node_rewards
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_release_for_commission();

-- Also update referral_earnings in profiles when direct_referral commission is paid
CREATE OR REPLACE FUNCTION update_referral_earnings()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reward_type = 'TEAM_COMMISSION' AND NEW.amount > 0 THEN
    UPDATE profiles SET referral_earnings = COALESCE(referral_earnings, 0) + NEW.amount
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_referral_earnings ON node_rewards;
CREATE TRIGGER trg_update_referral_earnings
  AFTER INSERT ON node_rewards
  FOR EACH ROW
  EXECUTE FUNCTION update_referral_earnings();
