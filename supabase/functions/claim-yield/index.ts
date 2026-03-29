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
const SERVER_WALLET = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";
const MA_TOKEN = "0x4f71f2d1bD1480EC002e5c7A331BfA5F7A6c5C5b";
const RELEASE_CONTRACT = "0xC80724a4133c90824A64914323fE856019D52B67";
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
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", id: 1, params: [{ to: "0x3EC635802091b9F95b2891f3fd2504499f710145", data: "0xa035b1fe" }, "latest"] }),
    });
    const d = await res.json();
    return parseInt(d.result || "0x0", 16) / 1e6;
  } catch { return 0.59; }
}

async function callThirdweb(calls: any[]) {
  const res = await fetch("https://api.thirdweb.com/v1/contracts/write", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-secret-key": THIRDWEB_SECRET, "x-vault-access-token": VAULT_ACCESS_TOKEN },
    body: JSON.stringify({ chainId: 56, from: SERVER_WALLET, calls }),
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
    const { data: profile } = await supabase.from("profiles").select("id").eq("wallet_address", walletAddress).single();
    if (!profile) return json({ error: "Profile not found" }, 404);

    const { data: positions } = await supabase.from("vault_positions").select("*").eq("user_id", profile.id).eq("status", "ACTIVE");
    if (!positions || positions.length === 0) return json({ error: "No active positions" }, 400);

    // Calculate available yield in MA
    const maPrice = await getMAPrice();
    const now = new Date();
    let totalYieldUsd = 0;
    for (const pos of positions) {
      const start = new Date(pos.start_date);
      const days = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86400_000));
      totalYieldUsd += Number(pos.principal) * Number(pos.daily_rate) * days;
    }
    const totalYieldMA = totalYieldUsd / maPrice;

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
      txIds = result?.result?.transactionIds || [];

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
          method: "function addAccumulated(address user, uint256 amount)",
          params: [walletAddress, claimWei],
        },
      ];

      const result = await callThirdweb(calls);
      txIds = result?.result?.transactionIds || [];
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
        yieldUsd: totalYieldUsd,
        maPrice,
      },
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
