import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * V4 Redeem — 金库赎回
 *
 * 赎回 = 关闭 position → 锁仓MA 转入未提现余额 (不涉及 burn/split)
 * 用户之后从"未提现余额"发起提现才走 A/B/C/D/E 分成
 *
 * 锁仓MA = principal ÷ MA价格
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ORACLE = "0x35580292fA5c8b7110034EA1a1521952E6F42bbb";
const BSC_RPC = "https://bsc-dataseed1.binance.org";

async function getOraclePrice(): Promise<number> {
  const res = await fetch(BSC_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", method: "eth_call", id: 1,
      params: [{ to: ORACLE, data: "0x98d5fdca" }, "latest"],
    }),
  });
  const d = await res.json();
  return parseInt(d.result || "0x0", 16) / 1e6;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { walletAddress, positionId } = await req.json();
    if (!walletAddress || !positionId) {
      return json({ error: "Missing walletAddress or positionId" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Validate user & position
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .ilike("wallet_address", walletAddress)
      .single();
    if (!profile) return json({ error: "Profile not found" }, 404);

    const { data: position } = await supabase
      .from("vault_positions")
      .select("*")
      .eq("id", positionId)
      .eq("user_id", profile.id)
      .single();
    if (!position) return json({ error: "Position not found" }, 404);

    if (position.status !== "ACTIVE" && position.status !== "MATURED") {
      return json({ error: `Position status ${position.status} cannot be redeemed` }, 400);
    }
    if (position.is_bonus || position.plan_type === "BONUS_5D") {
      return json({ error: "Cannot redeem bonus positions" }, 400);
    }

    // 2. Get MA price
    const maPrice = await getOraclePrice();
    if (maPrice <= 0) return json({ error: "Oracle price unavailable" }, 500);

    // 3. Calculate principal in MA
    const principal = Number(position.principal);
    const principalMA = principal / maPrice;

    console.log(`Redeem: ${walletAddress} pos:${positionId} | $${principal} ÷ $${maPrice} = ${principalMA.toFixed(2)} MA → 未提现余额`);

    // 4. Add principal MA to vault_rewards as REDEEM type (goes to 未提现余额)
    await supabase.from("vault_rewards").insert({
      user_id: profile.id,
      position_id: positionId,
      reward_type: "REDEEM_PRINCIPAL",
      amount: principal,
      ar_price: maPrice,
      ar_amount: principalMA,
    });

    // 5. Close position
    await supabase.from("vault_positions").update({
      status: "REDEEMED",
    }).eq("id", positionId);

    // 6. Record transaction
    await supabase.from("transactions").insert({
      user_id: profile.id,
      type: "VAULT_REDEEM",
      amount: principalMA,
      token: "MA",
      status: "CONFIRMED",
      details: {
        positionId,
        principal,
        maPrice,
        principalMA,
        isMatured: position.status === "MATURED",
      },
    });

    return json({
      status: "redeemed",
      positionId,
      principal,
      maPrice,
      principalMA,
      note: `${principalMA.toFixed(2)} MA 已转入未提现余额`,
    });

  } catch (e: unknown) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
