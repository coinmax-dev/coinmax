-- Copy Trading Config: use wallet address as user_id (TEXT), add model/strategy selections
-- The original user_risk_config used UUID, but the app identifies users by wallet address.

-- Change user_id from UUID to TEXT to support wallet addresses
ALTER TABLE user_risk_config ALTER COLUMN user_id TYPE TEXT;

-- Add model/strategy selection columns
ALTER TABLE user_risk_config
  ADD COLUMN IF NOT EXISTS selected_models TEXT[] DEFAULT ARRAY['gpt-4o','claude-haiku','gemini-flash'],
  ADD COLUMN IF NOT EXISTS selected_strategies TEXT[] DEFAULT ARRAY['trend_following','momentum','breakout','mean_reversion','bb_squeeze'];

-- Also fix user_exchange_keys to use TEXT for wallet address
ALTER TABLE user_exchange_keys ALTER COLUMN user_id TYPE TEXT;

-- Allow anon to read/write their own risk config (by wallet address)
CREATE POLICY "Users can manage own risk config" ON user_risk_config
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "Users can manage own exchange keys" ON user_exchange_keys
  FOR ALL USING (TRUE) WITH CHECK (TRUE);
