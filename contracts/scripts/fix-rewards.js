const { Client } = require("pg");

async function main() {
  const c = new Client({ connectionString: "postgresql://postgres:onelong53541314@db.enedbksmftcgtszrkppc.supabase.co:5432/postgres" });
  await c.connect();

  const PRICE = 0.60;

  // 1. Fix vault_rewards
  const fix1 = await c.query("UPDATE vault_rewards SET ar_price = $1, ar_amount = amount::NUMERIC / $1 RETURNING id", [PRICE]);
  console.log("vault_rewards fixed:", fix1.rows.length);

  // Verify
  const v = await c.query("SELECT amount, ar_price, ar_amount FROM vault_rewards ORDER BY created_at DESC LIMIT 3");
  for (const r of v.rows) {
    console.log("  $" + Number(r.amount).toFixed(0), "/ $" + r.ar_price, "=", Number(r.ar_amount).toFixed(2), "MA");
  }

  // 2. Delete all old team commissions
  const del = await c.query("DELETE FROM node_rewards WHERE reward_type = 'TEAM_COMMISSION' RETURNING id");
  console.log("\nDeleted", del.rows.length, "old commissions");

  // 3. Re-settle from each vault_reward
  const rewards = await c.query("SELECT ar_amount, user_id FROM vault_rewards ORDER BY created_at");
  console.log("Re-settling", rewards.rows.length, "yields...");

  let ok = 0, fail = 0;
  for (const r of rewards.rows) {
    try {
      await c.query("SELECT settle_team_commission($1::NUMERIC, $2::UUID)", [r.ar_amount, r.user_id]);
      ok++;
    } catch (e) {
      fail++;
    }
  }
  console.log("Settled:", ok, "| Failed:", fail);

  // 4. Check results
  const nr = await c.query("SELECT COUNT(*) as cnt, SUM(amount) as total FROM node_rewards WHERE reward_type = 'TEAM_COMMISSION'");
  console.log("\nNew commissions:", nr.rows[0].cnt, "| Total:", Number(nr.rows[0].total).toFixed(2), "MA");

  // 5. Check 00Fe direct referral from 8Af1
  const check = await c.query(`
    SELECT amount, details FROM node_rewards
    WHERE user_id = (SELECT id FROM profiles WHERE wallet_address = '0x6A38C45d599AB4B93935B321dD3Ba7462d7C00Fe')
    AND details->>'source_user' = 'd21824fd-db8b-472c-ab2d-39f88379341e'
    AND details->>'type' = 'direct_referral'
  `);
  console.log("\n00Fe direct from 8Af1:");
  for (const r of check.rows) {
    console.log("  " + Number(r.amount).toFixed(2) + " MA");
  }

  await c.end();
}
main().catch(console.error);
