/**
 * Claim Yield — Mint interest MA and release to user wallet
 *
 * Since InterestEngine cron isn't running yet, this edge function:
 * 1. Calculates yield from DB (vault_positions)
 * 2. Mints MA to Release contract via Server Wallet
 * 3. Calls addAccumulated() on Release contract via Server Wallet
 * 4. Returns success — frontend then calls createRelease() from user wallet
 *
 * For instant release (plan 4): directly mint 80% MA to user, burn 20%
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "EwFZ-cz8maTnDHEukynx4UgOx_0oqeqg1qR1gx2cHIM0L-Nks5ogM0U7JhZGQMyg3489Tc42J_QSZ9rLGojFSQ";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "vt_act_B6LKUWDDFVRRESRTNN2OYYYKTOCLDEAYSVFMSYI6A4L47R4ENX26GDBYUVCAGT2WVMNWCQNQWXOR6AFXILSR2DFIJAH3AM5QG4ERZIPV";
const EOA_WALLET = "0xeBAB6D22278c9839A46B86775b3AC9469710F84b";
const MA_TOKEN = "0xdFaC84b2f9cfD02b3f44760E0Ff88b4EeC0e1593";
const RELEASE_CONTRACT = "0x842b48a616fA107bcd18e3656edCe658D4279f92";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const BSC_RPC = "https://bsc-dataseed1.binance.org";

// Release plans (match contract)
const PLANS: Record<number, { release: number; burn: number; days: number }> = {
  0: { release: 100, burn: 0, days: 60 },
  1: { release: 95, burn: 5, days: 30 },
  2: { release: 90, burn: 10, days: 15 },
  3: { release: 85, burn: 15, days: 7 },
  4: { release: 80, burn: 20, days: 0 }, // instant
};

async function getMAPrice(): Promise<number> {
  try {
    const res = await fetch(BSC_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", id: 1, params: [{ to: "0xff5Ab71939Fa021A7BCa38Db8b3c1672D1B819dD", data: "0xa035b1fe" }, "latest"] }),
    });
    const d = await res.json();
    return parseInt(d.result || "0x0", 16) / 1e6;
  } catch { return 0.59; }
}

async function callThirdweb(calls: any[]) {
  const res = await fetch("https://engine.thirdweb.com/v1/write/contract", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-secret-key": THIRDWEB_SECRET, "x-vault-access-token": VAULT_ACCESS_TOKEN },
    body: JSON.stringify({ executionOptions: { type: "EOA", from: EOA_WALLET, chainId: "56" }, params: calls }),
  });
  return res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    const { walletAddress, planIndex, amount } = body;

    if (!walletAddress || planIndex === undefined) {
      return json({ error: "Missing walletAddress or planIndex" }, 400);
    }

    const plan = PLANS[planIndex];
    if (!plan) return json({ error: "Invalid plan" }, 400);

    // Get profile + yield
    const { data: profile } = await supabase.from("profiles").select("id, referral_earnings").eq("wallet_address", walletAddress).single();
    if (!profile) return json({ error: "Profile not found" }, 404);

    // Read settled yield from vault_rewards (already in MA)
    const { data: rewards } = await supabase
      .from("vault_rewards")
      .select("ar_amount, vault_positions!inner(plan_type, bonus_yield_locked)")
      .eq("user_id", profile.id)
      .eq("reward_type", "DAILY_YIELD");

    let totalYieldMA = 0;
    for (const r of (rewards || [])) {
      const vp = (r as any).vault_positions;
      if (vp?.plan_type === "BONUS_5D" && vp?.bonus_yield_locked) continue;
      totalYieldMA += Number(r.ar_amount || 0);
    }

    // Also add broker commissions (already in MA)
    const brokerMA = Number(profile.referral_earnings || 0);
    totalYieldMA += brokerMA;

    // Also add node earnings (available_balance from node_memberships, already in MA)
    const { data: nodeRows } = await supabase
      .from("node_memberships")
      .select("available_balance")
      .eq("user_id", profile.id)
      .in("status", ["ACTIVE", "PENDING_MILESTONES"]);
    const nodeMA = (nodeRows || []).reduce((s: number, n: any) => s + Number(n.available_balance || 0), 0);
    totalYieldMA += nodeMA;

    // Subtract already claimed amount
    const { data: claimedTxs } = await supabase
      .from("transactions")
      .select("amount")
      .eq("user_id", profile.id)
      .eq("type", "YIELD_CLAIM");
    const alreadyClaimed = (claimedTxs || []).reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
    totalYieldMA = Math.max(0, totalYieldMA - alreadyClaimed);

    const maPrice = await getMAPrice();

    // Use requested amount or total available
    const claimMA = amount ? Math.min(Number(amount), totalYieldMA) : totalYieldMA;
    if (claimMA <= 0) return json({ error: "No yield to claim" }, 400);

    const claimWei = BigInt(Math.floor(claimMA * 1e18)).toString();
    const releaseMA = claimMA * plan.release / 100;
    const burnMA = claimMA * plan.burn / 100;
    const releaseWei = BigInt(Math.floor(releaseMA * 1e18)).toString();
    const burnWei = BigInt(Math.floor(burnMA * 1e18)).toString();

    let txIds: string[] = [];

    if (plan.days === 0) {
      // INSTANT RELEASE: mint directly to user (80%) + burn (20%)
      const calls: any[] = [];

      // Mint 80% to user
      if (releaseMA > 0) {
        calls.push({
          contractAddress: MA_TOKEN,
          method: "function mintTo(address to, uint256 amount)",
          params: [walletAddress, releaseWei],
        });
      }

      // Mint 20% to dead address (burn)
      if (burnMA > 0) {
        calls.push({
          contractAddress: MA_TOKEN,
          method: "function mintTo(address to, uint256 amount)",
          params: [DEAD_ADDRESS, burnWei],
        });
      }

      const result = await callThirdweb(calls);
      txIds = result?.result?.transactionIds || result?.result?.transactions?.map((t: any) => t.id) || [];

    } else {
      // LINEAR RELEASE: mint to Release contract + addAccumulated
      // Then user calls createRelease() from their wallet
      const calls = [
        // Mint MA to Release contract
        {
          contractAddress: MA_TOKEN,
          method: "function mintTo(address to, uint256 amount)",
          params: [RELEASE_CONTRACT, claimWei],
        },
        // Call addAccumulated on Release contract
        {
          contractAddress: RELEASE_CONTRACT,
          method: "function addAccumulated(address, uint256)",
          params: [walletAddress, claimWei],
        },
      ];

      const result = await callThirdweb(calls);
      txIds = result?.result?.transactionIds || result?.result?.transactions?.map((t: any) => t.id) || [];
    }

    // Record in DB
    await supabase.from("transactions").insert({
      user_id: profile.id,
      type: "YIELD_CLAIM",
      token: "MA",
      amount: claimMA,
      status: "COMPLETED",
      tx_hash: txIds[0] || `yield_${Date.now()}`,
      details: {
        planIndex,
        planDays: plan.days,
        releaseMA,
        burnMA,
        yieldMA: totalYieldMA,
        maPrice,
      },
    });

    // Record earnings release
    const releaseEndDt = new Date(Date.now() + plan.days * 86400000).toISOString();
    await supabase.from("earnings_releases").insert({
      user_id: profile.id,
      source_type: "VAULT",
      gross_amount: claimMA,
      burn_rate: plan.burn / 100,
      burn_amount: burnMA,
      net_amount: releaseMA,
      release_days: plan.days,
      status: plan.days === 0 ? "COMPLETED" : "RELEASING",
      release_start: new Date().toISOString(),
      release_end: releaseEndDt,
      released_at: plan.days === 0 ? new Date().toISOString() : null,
    });

    return json({
      success: true,
      claimMA,
      releaseMA,
      burnMA,
      planDays: plan.days,
      txIds,
      needsCreateRelease: plan.days > 0, // user needs to call createRelease() on-chain
    });

  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
