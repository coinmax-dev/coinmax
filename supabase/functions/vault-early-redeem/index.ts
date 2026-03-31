/**
 * Vault Redeem — MA principal goes to Release contract (same as yield)
 *
 * Both matured + early exit go through Release contract with split ratio:
 *   Plan 0: 100% release, 0% burn, 60-day linear
 *   Plan 1: 95% release, 5% burn, 30-day linear
 *   Plan 2: 90% release, 10% burn, 15-day linear
 *   Plan 3: 85% release, 15% burn, 7-day linear
 *   Plan 4: 80% release, 20% burn, instant
 *
 * User selects release plan → MA goes to Release contract → linear vesting
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "EwFZ-cz8maTnDHEukynx4UgOx_0oqeqg1qR1gx2cHIM0L-Nks5ogM0U7JhZGQMyg3489Tc42J_QSZ9rLGojFSQ";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "vt_act_B6LKUWDDFVRRESRTNN2OYYYKTOCLDEAYSVFMSYI6A4L47R4ENX26GDBYUVCAGT2WVMNWCQNQWXOR6AFXILSR2DFIJAH3AM5QG4ERZIPV";
const SERVER_WALLET = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";
const MA_TOKEN = "0xdFaC84b2f9cfD02b3f44760E0Ff88b4EeC0e1593";
const RELEASE_CONTRACT = "0x842b48a616fA107bcd18e3656edCe658D4279f92";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

// Release plans (same as yield claim)
const PLANS: Record<number, { releasePct: number; burnPct: number; days: number }> = {
  0: { releasePct: 100, burnPct: 0, days: 60 },
  1: { releasePct: 95, burnPct: 5, days: 30 },
  2: { releasePct: 90, burnPct: 10, days: 15 },
  3: { releasePct: 85, burnPct: 15, days: 7 },
  4: { releasePct: 80, burnPct: 20, days: 0 }, // instant
};

async function callThirdweb(calls: any[]) {
  const res = await fetch("https://api.thirdweb.com/v1/contracts/write", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-secret-key": THIRDWEB_SECRET,
      "x-vault-access-token": VAULT_ACCESS_TOKEN,
    },
    body: JSON.stringify({ chainId: 56, from: SERVER_WALLET, calls }),
  });
  return res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { walletAddress, positionId, releasePlan } = body;

    if (!walletAddress || !positionId || releasePlan === undefined) {
      return json({ error: "Missing walletAddress, positionId, or releasePlan (0-4)" }, 400);
    }

    const plan = PLANS[releasePlan];
    if (!plan) return json({ error: "Invalid releasePlan. Use 0-4" }, 400);

    // Get position from DB
    const { data: profile } = await supabase
      .from("profiles").select("id").eq("wallet_address", walletAddress).single();
    if (!profile) return json({ error: "Profile not found" }, 404);

    const { data: position } = await supabase
      .from("vault_positions").select("*").eq("id", positionId).eq("user_id", profile.id).single();
    if (!position) return json({ error: "Position not found" }, 404);
    if (position.status !== "ACTIVE") return json({ error: "Position not active" }, 400);
    if (position.plan_type === "BONUS_5D" || position.is_bonus) return json({ error: "Bonus positions cannot be redeemed" }, 400);

    const now = new Date();
    const endDate = position.end_date ? new Date(position.end_date) : null;
    const isEarly = endDate ? now < endDate : false;

    // MA amount = what was minted at deposit time (stored in contract)
    // Use DB approximation: principal / maPrice at deposit
    const maAmount = Number(position.ma_minted || position.principal);
    const releaseMA = maAmount * plan.releasePct / 100;
    const burnMA = maAmount * plan.burnPct / 100;

    const calls: any[] = [];

    if (plan.days === 0) {
      // ═══ INSTANT: 80% mint to user, 20% burn ═══
      if (releaseMA > 0) {
        calls.push({
          contractAddress: MA_TOKEN,
          method: "function mintTo(address to, uint256 amount)",
          params: [walletAddress, BigInt(Math.floor(releaseMA * 1e18)).toString()],
        });
      }
      if (burnMA > 0) {
        calls.push({
          contractAddress: MA_TOKEN,
          method: "function mintTo(address to, uint256 amount)",
          params: [DEAD_ADDRESS, BigInt(Math.floor(burnMA * 1e18)).toString()],
        });
      }
    } else {
      // ═══ LINEAR RELEASE: mint 100% to Release contract, record split ═══
      // Release contract handles the linear vesting
      const totalWei = BigInt(Math.floor(maAmount * 1e18)).toString();
      const releaseWei = BigInt(Math.floor(releaseMA * 1e18)).toString();

      // Mint release portion to Release contract
      if (releaseMA > 0) {
        calls.push({
          contractAddress: MA_TOKEN,
          method: "function mintTo(address to, uint256 amount)",
          params: [RELEASE_CONTRACT, BigInt(Math.floor(releaseMA * 1e18)).toString()],
        });
        calls.push({
          contractAddress: RELEASE_CONTRACT,
          method: "function addAccumulated(address user, uint256 amount)",
          params: [walletAddress, BigInt(Math.floor(releaseMA * 1e18)).toString()],
        });
      }

      // Burn portion → dead address
      if (burnMA > 0) {
        calls.push({
          contractAddress: MA_TOKEN,
          method: "function mintTo(address to, uint256 amount)",
          params: [DEAD_ADDRESS, BigInt(Math.floor(burnMA * 1e18)).toString()],
        });
      }
    }

    let txId = null;
    if (calls.length > 0) {
      const result = await callThirdweb(calls);
      txId = result?.result?.transactionIds?.[0] || null;
    }

    // Update vault position status
    await supabase.from("vault_positions").update({
      status: isEarly ? "EARLY_EXIT" : "COMPLETED",
    }).eq("id", positionId);

    // Record earnings release
    const releaseEndDate = new Date(now.getTime() + plan.days * 86400_000);
    await supabase.from("earnings_releases").insert({
      user_id: profile.id,
      source_type: "VAULT",
      gross_amount: maAmount,
      burn_rate: plan.burnPct / 100,
      burn_amount: burnMA,
      net_amount: releaseMA,
      release_days: plan.days,
      status: plan.days === 0 ? "COMPLETED" : "RELEASING",
      release_start: now.toISOString(),
      release_end: releaseEndDate.toISOString(),
      released_at: plan.days === 0 ? now.toISOString() : null,
    });

    // Record transaction
    await supabase.from("transactions").insert({
      user_id: profile.id,
      type: "VAULT_REDEEM",
      token: "MA",
      amount: maAmount,
      status: "COMPLETED",
      tx_hash: txId || `redeem_${positionId}`,
      details: {
        positionId,
        isEarly,
        releasePlan,
        releaseDays: plan.days,
        maTotal: maAmount,
        maReleased: releaseMA,
        maBurned: burnMA,
        burnRate: plan.burnPct + "%",
      },
    });

    // Update profile
    await supabase.from("profiles").update({
      total_withdrawn: Number(profile.total_withdrawn || 0) + Number(position.principal),
    }).eq("id", profile.id);

    // Recheck ranks (vault position changed → may trigger demotion)
    try {
      await supabase.rpc("recheck_ranks_on_vault_change", { target_user_id: profile.id });
    } catch { /* non-critical */ }

    return json({
      success: true,
      isEarly,
      releasePlan,
      releaseDays: plan.days,
      maTotal: maAmount,
      maReleased: releaseMA,
      maBurned: burnMA,
      burnRate: plan.burnPct + "%",
      txId,
    });

  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
