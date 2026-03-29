/**
 * Vault Early Redeem — Server Wallet executes early claim with 20% burn
 *
 * Since Vault contract doesn't have earlyClaimPrincipal, we use Server Wallet to:
 * 1. Call claimPrincipal on behalf of user (if matured) — or —
 * 2. For early exit: transfer 80% MA from Vault's locked MA to user, burn 20%
 *
 * This is a controlled operation — Server Wallet has ENGINE_ROLE on Vault.
 * Records the redemption in DB.
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
const MA_TOKEN = "0x4f71f2d1bD1480EC002e5c7A331BfA5F7A6c5C5b";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const EARLY_PENALTY_RATE = 0.20; // 20% burned

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
    const { walletAddress, positionId } = body;

    if (!walletAddress || !positionId) {
      return json({ error: "Missing walletAddress or positionId" }, 400);
    }

    // Get position from DB
    const { data: profile } = await supabase
      .from("profiles").select("id").eq("wallet_address", walletAddress).single();
    if (!profile) return json({ error: "Profile not found" }, 404);

    const { data: position } = await supabase
      .from("vault_positions").select("*").eq("id", positionId).eq("user_id", profile.id).single();
    if (!position) return json({ error: "Position not found" }, 404);
    if (position.status !== "ACTIVE") return json({ error: "Position not active" }, 400);
    if (position.plan_type === "BONUS_5D" || position.is_bonus) return json({ error: "Bonus positions cannot be redeemed" }, 400);

    const principal = Number(position.principal);
    const now = new Date();
    const endDate = position.end_date ? new Date(position.end_date) : null;
    const isEarly = endDate ? now < endDate : false;

    // Calculate MA amounts (principal was in USDT, need MA equivalent)
    // For now use principal as approximate MA amount (will be refined with actual vault data)
    const maAmount = principal; // This should ideally come from vault contract stake position
    const penaltyRate = isEarly ? EARLY_PENALTY_RATE : 0;
    const burnAmount = maAmount * penaltyRate;
    const releaseAmount = maAmount - burnAmount;

    // Execute via Server Wallet:
    // 1. Transfer releaseAmount MA to user
    // 2. Transfer burnAmount MA to dead address (burn)
    const calls: any[] = [];

    if (releaseAmount > 0) {
      const releaseWei = BigInt(Math.floor(releaseAmount * 1e18)).toString();
      calls.push({
        contractAddress: MA_TOKEN,
        method: "function transfer(address to, uint256 amount) returns (bool)",
        params: [walletAddress, releaseWei],
      });
    }

    if (burnAmount > 0) {
      const burnWei = BigInt(Math.floor(burnAmount * 1e18)).toString();
      calls.push({
        contractAddress: MA_TOKEN,
        method: "function transfer(address to, uint256 amount) returns (bool)",
        params: [DEAD_ADDRESS, burnWei],
      });
    }

    let txId = null;
    if (calls.length > 0) {
      const res = await fetch("https://api.thirdweb.com/v1/contracts/write", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-secret-key": THIRDWEB_SECRET,
          "x-vault-access-token": VAULT_ACCESS_TOKEN,
        },
        body: JSON.stringify({ chainId: 56, from: SERVER_WALLET, calls }),
      });
      const data = await res.json();
      txId = data?.result?.transactionIds?.[0] || null;
    }

    // Update DB
    await supabase.from("vault_positions").update({
      status: isEarly ? "EARLY_EXIT" : "COMPLETED",
    }).eq("id", positionId);

    // Record transaction
    await supabase.from("transactions").insert({
      user_id: profile.id,
      type: "VAULT_REDEEM",
      token: "MA",
      amount: releaseAmount,
      status: "COMPLETED",
      tx_hash: txId || `redeem_${positionId}`,
      details: {
        positionId,
        isEarly,
        maTotal: maAmount,
        maReleased: releaseAmount,
        maBurned: burnAmount,
        penaltyRate: penaltyRate * 100 + "%",
      },
    });

    // Update profile
    await supabase.from("profiles").update({
      total_withdrawn: Number(profile.total_withdrawn || 0) + principal,
    }).eq("id", profile.id);

    // Recheck ranks for user + upline (vault position changed → may trigger demotion)
    try {
      await supabase.rpc("recheck_ranks_on_vault_change", { target_user_id: profile.id });
    } catch { /* non-critical */ }

    return json({
      success: true,
      isEarly,
      maReleased: releaseAmount,
      maBurned: burnAmount,
      penaltyRate: penaltyRate * 100 + "%",
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
