-- Treasury config: global switches for batch/bridge/deposit-withdraw operations
CREATE TABLE IF NOT EXISTS treasury_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO treasury_config (key, value, description) VALUES
  ('bridge_enabled', 'false', '跨链桥接总开关 (BSC↔ARB)'),
  ('hl_deposit_enabled', 'false', 'HyperLiquid 存入开关'),
  ('hl_withdraw_enabled', 'false', 'HyperLiquid 提取开关'),
  ('batch_distribute_enabled', 'true', '批量分配开关 (Splitter flush)'),
  ('auto_bridge_enabled', 'false', '自动跨链开关 (定时触发)'),
  ('auto_bridge_min_usd', '1000', '自动跨链最低金额 (USD)'),
  ('auto_bridge_interval_hours', '24', '自动跨链间隔 (小时)'),
  ('hl_vault_address', '0xd6e56265890b76413d1d527eb9b75e334c0c5b42', 'HyperLiquid Vault 地址'),
  ('arb_server_wallet', '0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b', 'ARB 链 Server Wallet'),
  ('stargate_adapter', '', 'Stargate Bridge Adapter 合约地址 (BSC)'),
  ('max_bridge_amount', '50000', '单次跨链最大金额 (USD)'),
  ('bridge_slippage_bps', '50', '跨链滑点容忍度 (基点, 50=0.5%)')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE treasury_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin access treasury config" ON treasury_config FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- Bridge cycle tracking
CREATE TABLE IF NOT EXISTS bridge_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_type TEXT NOT NULL CHECK (cycle_type IN ('BSC_TO_ARB', 'ARB_TO_BSC', 'DEPOSIT_HL', 'WITHDRAW_HL', 'FULL_ROUND')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'BRIDGING', 'DEPOSITING', 'IN_HL', 'WITHDRAWING', 'RETURNING', 'DISTRIBUTING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  amount_usd NUMERIC NOT NULL,
  bsc_tx TEXT,
  arb_tx TEXT,
  hl_tx TEXT,
  return_tx TEXT,
  pnl_usd NUMERIC DEFAULT 0,
  fees_usd NUMERIC DEFAULT 0,
  initiated_by TEXT DEFAULT 'admin',
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bridge_cycles_status ON bridge_cycles(status);
CREATE INDEX IF NOT EXISTS idx_bridge_cycles_started ON bridge_cycles(started_at DESC);

ALTER TABLE bridge_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin access bridge cycles" ON bridge_cycles FOR ALL USING (TRUE) WITH CHECK (TRUE);
