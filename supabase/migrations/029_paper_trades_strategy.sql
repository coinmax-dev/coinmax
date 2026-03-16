-- Add strategy_type to paper_trades for multi-strategy positions
ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS strategy_type TEXT;

-- Add more strategy types to trade_signals
ALTER TABLE trade_signals DROP CONSTRAINT IF EXISTS trade_signals_strategy_type_check;
ALTER TABLE trade_signals ADD CONSTRAINT trade_signals_strategy_type_check
  CHECK (strategy_type IN ('directional', 'grid', 'dca', 'trend_following', 'mean_reversion', 'breakout', 'scalping', 'momentum', 'swing'));

-- Increase max concurrent positions (index helps query performance)
CREATE INDEX IF NOT EXISTS idx_paper_trades_strategy ON paper_trades(strategy_type, status);
