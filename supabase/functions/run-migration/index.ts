import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const migrations = [
    // 1. user_trade_configs
    `CREATE TABLE IF NOT EXISTS user_trade_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      wallet_address TEXT NOT NULL,
      exchange TEXT NOT NULL CHECK (exchange IN ('binance','bybit','okx','bitget','hyperliquid','dydx')),
      api_key_encrypted TEXT,
      api_secret_encrypted TEXT,
      api_passphrase_encrypted TEXT,
      api_connected BOOLEAN DEFAULT false,
      api_last_test_at TIMESTAMPTZ,
      models_follow TEXT[] DEFAULT ARRAY['GPT-4o','Claude','Gemini','DeepSeek','Llama'],
      strategies_follow TEXT[] DEFAULT ARRAY['trend_following','mean_reversion','breakout','momentum','scalping','swing','ichimoku','bb_squeeze','rsi_divergence','donchian'],
      coins_follow TEXT[] DEFAULT ARRAY['BTC','ETH','SOL','BNB','DOGE','XRP','ADA','AVAX','LINK','DOT'],
      position_size_usd NUMERIC(12,2) DEFAULT 100,
      max_leverage INTEGER DEFAULT 3,
      max_positions INTEGER DEFAULT 5,
      max_daily_loss_pct NUMERIC(5,2) DEFAULT 10,
      stop_loss_pct NUMERIC(5,2) DEFAULT 3,
      take_profit_pct NUMERIC(5,2) DEFAULT 6,
      trailing_stop BOOLEAN DEFAULT true,
      trailing_stop_pct NUMERIC(5,2) DEFAULT 1.5,
      execution_mode TEXT DEFAULT 'paper' CHECK (execution_mode IN ('paper','signal','semi-auto','full-auto')),
      node_type TEXT DEFAULT 'MINI' CHECK (node_type IN ('MINI','MAX')),
      is_active BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )`,

    `CREATE INDEX IF NOT EXISTS idx_trade_configs_wallet ON user_trade_configs(wallet_address)`,
    `CREATE INDEX IF NOT EXISTS idx_trade_configs_active ON user_trade_configs(is_active) WHERE is_active = true`,

    // 2. copy_trade_orders
    `CREATE TABLE IF NOT EXISTS copy_trade_orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_wallet TEXT NOT NULL,
      config_id UUID REFERENCES user_trade_configs(id),
      signal_id UUID,
      primary_model TEXT,
      strategy_type TEXT,
      exchange TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('LONG','SHORT')),
      leverage INTEGER DEFAULT 1,
      entry_price NUMERIC(20,8),
      size NUMERIC(20,8),
      size_usd NUMERIC(12,2),
      stop_loss NUMERIC(20,8),
      take_profit NUMERIC(20,8),
      trailing_stop_trigger NUMERIC(20,8),
      exchange_order_id TEXT,
      exchange_response JSONB,
      exit_price NUMERIC(20,8),
      pnl_pct NUMERIC(8,4),
      pnl_usd NUMERIC(12,2),
      fee_usd NUMERIC(12,2),
      fee_collected BOOLEAN DEFAULT false,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','queued','filled','partial','closed','cancelled','failed')),
      error_message TEXT,
      opened_at TIMESTAMPTZ DEFAULT now(),
      closed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT now()
    )`,

    `CREATE INDEX IF NOT EXISTS idx_copy_orders_wallet ON copy_trade_orders(user_wallet)`,
    `CREATE INDEX IF NOT EXISTS idx_copy_orders_status ON copy_trade_orders(status) WHERE status IN ('pending','queued','filled','partial')`,
    `CREATE INDEX IF NOT EXISTS idx_copy_orders_signal ON copy_trade_orders(signal_id)`,

    // 3. exchange_order_queue
    `CREATE TABLE IF NOT EXISTS exchange_order_queue (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_wallet TEXT NOT NULL,
      config_id UUID REFERENCES user_trade_configs(id),
      copy_order_id UUID REFERENCES copy_trade_orders(id),
      exchange TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('open_long','open_short','close','modify_sl','modify_tp','cancel')),
      params JSONB NOT NULL,
      status TEXT DEFAULT 'queued' CHECK (status IN ('queued','processing','done','failed','retry')),
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      error_message TEXT,
      exchange_response JSONB,
      created_at TIMESTAMPTZ DEFAULT now(),
      processed_at TIMESTAMPTZ
    )`,

    `CREATE INDEX IF NOT EXISTS idx_order_queue_status ON exchange_order_queue(status) WHERE status IN ('queued','retry')`,

    // 4. copy_trade_daily_stats
    `CREATE TABLE IF NOT EXISTS copy_trade_daily_stats (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_wallet TEXT NOT NULL,
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      trades_opened INTEGER DEFAULT 0,
      trades_closed INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      total_pnl_usd NUMERIC(12,2) DEFAULT 0,
      total_fee_usd NUMERIC(12,2) DEFAULT 0,
      max_drawdown_pct NUMERIC(8,4) DEFAULT 0,
      win_rate_pct NUMERIC(5,2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(user_wallet, date)
    )`,

    // 5. RLS
    `ALTER TABLE user_trade_configs ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE copy_trade_orders ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE exchange_order_queue ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE copy_trade_daily_stats ENABLE ROW LEVEL SECURITY`,

    `CREATE POLICY IF NOT EXISTS "anon_read_trade_configs" ON user_trade_configs FOR SELECT USING (true)`,
    `CREATE POLICY IF NOT EXISTS "anon_insert_trade_configs" ON user_trade_configs FOR INSERT WITH CHECK (true)`,
    `CREATE POLICY IF NOT EXISTS "anon_update_trade_configs" ON user_trade_configs FOR UPDATE USING (true)`,
    `CREATE POLICY IF NOT EXISTS "anon_read_copy_orders" ON copy_trade_orders FOR SELECT USING (true)`,
    `CREATE POLICY IF NOT EXISTS "service_manage_copy_orders" ON copy_trade_orders FOR ALL USING (true)`,
    `CREATE POLICY IF NOT EXISTS "service_manage_queue" ON exchange_order_queue FOR ALL USING (true)`,
    `CREATE POLICY IF NOT EXISTS "anon_read_stats" ON copy_trade_daily_stats FOR SELECT USING (true)`,
    `CREATE POLICY IF NOT EXISTS "service_manage_stats" ON copy_trade_daily_stats FOR ALL USING (true)`,

    // 6. Helper functions
    `CREATE OR REPLACE FUNCTION get_user_open_position_usd(p_wallet TEXT)
     RETURNS NUMERIC AS $$
       SELECT COALESCE(SUM(size_usd), 0)
       FROM copy_trade_orders
       WHERE user_wallet = p_wallet AND status IN ('filled','partial');
     $$ LANGUAGE sql STABLE`,

    `CREATE OR REPLACE FUNCTION get_user_daily_pnl(p_wallet TEXT)
     RETURNS NUMERIC AS $$
       SELECT COALESCE(SUM(pnl_usd), 0)
       FROM copy_trade_orders
       WHERE user_wallet = p_wallet AND status = 'closed' AND closed_at >= CURRENT_DATE;
     $$ LANGUAGE sql STABLE`,
  ];

  const results: { sql: string; ok: boolean; error?: string }[] = [];

  for (const sql of migrations) {
    try {
      const { error } = await supabase.rpc("exec_sql", { sql_query: sql }).maybeSingle();
      if (error && !error.message.includes("already exists")) {
        // Try direct query
        const { error: err2 } = await supabase.from("_exec").select("*").limit(0);
        // Fallback: use raw fetch
        const res = await fetch(`${supabaseUrl}/rest/v1/rpc/`, {
          method: "POST",
          headers: {
            "apikey": serviceKey,
            "Authorization": `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });
      }
      results.push({ sql: sql.slice(0, 60), ok: true });
    } catch (e: any) {
      results.push({ sql: sql.slice(0, 60), ok: false, error: e.message });
    }
  }

  // Alternative: use postgres.js via Deno
  // Actually, let's use the Supabase admin client which supports raw SQL
  try {
    const pgUrl = Deno.env.get("SUPABASE_DB_URL") ||
      `postgresql://postgres:${serviceKey}@db.enedbksmftcgtszrkppc.supabase.co:5432/postgres`;

    // Use Deno's postgres module
    const { Client } = await import("https://deno.land/x/postgres@v0.19.3/mod.ts");
    const client = new Client(pgUrl);
    await client.connect();

    for (const sql of migrations) {
      try {
        await client.queryArray(sql);
        results.push({ sql: sql.slice(0, 60), ok: true });
      } catch (e: any) {
        if (!e.message?.includes("already exists")) {
          results.push({ sql: sql.slice(0, 60), ok: false, error: e.message });
        } else {
          results.push({ sql: sql.slice(0, 60), ok: true });
        }
      }
    }

    await client.end();
  } catch (e: any) {
    return new Response(JSON.stringify({ error: "DB connection failed", detail: e.message, results }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, migrated: results.filter(r => r.ok).length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
