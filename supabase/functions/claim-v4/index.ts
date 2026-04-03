import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * V4 Claim — User withdraws from 待释放余额
 *
 * Flow:
 *   1. User requests claim (amount, split ratio)
 *   2. DB: validate available balance, create release schedule
 *   3. Chain: Engine mints MA to Release contract
 *   4. Chain: Burn ratio applied (0-20% destroyed immediately)
 *   5. Chain: Remaining MA → linear release schedule to user wallet
 *
 * Split Ratios:
 *   A: 0% burn,  longest release
 *   B: 5% burn,  long release
 *   C: 10% burn, short release
 *   D: 20% burn, fastest release
 *
 * Release: 0x1de32fF0aa9884536C8ba7Aa7fD1f6Ea6cf523Bc
 * Engine:  0xDd6660E403d0242c1BeE52a4de50484AAF004446
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "";
const ENGINE_WALLET = "0xDd6660E403d0242c1BeE52a4de50484AAF004446";
const RELEASE = "0x1de32fF0aa9884536C8ba7Aa7fD1f6Ea6cf523Bc";
const MA_TOKEN = "0xc6d2dbC85DC3091C41692822A128c19F9eAc7988";

const SPLIT_RATIOS: Record<string, { burnPct: number; releaseDays: number }> = {
  A: { burnPct: 0, releaseDays: 60 },
  B: { burnPct: 5, releaseDays: 45 },
  C: { burnPct: 10, releaseDays: 30 },
  D: { burnPct: 20, releaseDays: 14 },
};

async function engineWriteOne(call: { contractAddress: string; method: string; params: unknown[] }) {
  const res = await fetch("https://engine.thirdweb.com/v1/write/contract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-secret-key": THIRDWEB_SECRET,
      "x-vault-access-token": VAULT_ACCESS_TOKEN,
    },
    body: JSON.stringify({
      executionOptions: { type: "EOA", from: ENGINE_WALLET, chainId: "56" },
      params: [call],
    }),
  });
  return res.json();
}

async function engineWrite(calls: Array<{ contractAddress: string; method: string; params: unknown[] }>) {
  const results = [];
  for (const call of calls) {
    const r = await engineWriteOne(call);
    console.log("Engine:", call.method.slice(0, 40), "→", r?.result?.transactions?.[0]?.id || r?.error?.message?.slice(0, 60) || "?");
    results.push(r);
    if (calls.indexOf(call) < calls.length - 1) await new Promise(resolve => setTimeout(resolve, 3000));
  }
  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { walletAddress, amount, splitRatio } = await req.json();
    if (!walletAddress || !amount || !splitRatio) {
      return json({ error: "Missing walletAddress, amount, or splitRatio" }, 400);
    }

    const ratio = SPLIT_RATIOS[splitRatio];
    if (!ratio) return json({ error: "Invalid splitRatio (A/B/C/D)" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Validate user has enough released balance
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("wallet_address", walletAddress)
      .single();
    if (!profile) return json({ error: "Profile not found" }, 404);

    // TODO: Check actual released balance from Release contract or DB
    const claimAmount = Number(amount);
    if (claimAmount <= 0) return json({ error: "Invalid amount" }, 400);

    // 2. Calculate burn + release
    const burnAmount = claimAmount * ratio.burnPct / 100;
    const releaseAmount = claimAmount - burnAmount;
    const dailyRelease = releaseAmount / ratio.releaseDays;

    const amountWei = "0x" + BigInt(Math.floor(claimAmount * 1e18)).toString(16);
    const burnWei = "0x" + BigInt(Math.floor(burnAmount * 1e18)).toString(16);
    const releaseWei = "0x" + BigInt(Math.floor(releaseAmount * 1e18)).toString(16);

    // 3. On-chain: Mint MA to Release contract
    const calls: Array<{ contractAddress: string; method: string; params: unknown[] }> = [];

    // Mint total MA to Release
    calls.push({
      contractAddress: MA_TOKEN,
      method: "function mint(address to, uint256 amount)",
      params: [RELEASE, amountWei],
    });

    // Burn portion via Release.destroy()
    if (burnAmount > 0) {
      calls.push({
        contractAddress: RELEASE,
        method: "function destroy(address user, uint256 amount, string reason)",
        params: [walletAddress, burnWei, "claim_burn_" + splitRatio],
      });
    }

    // Add released portion
    calls.push({
      contractAddress: RELEASE,
      method: "function addReleased(address user, uint256 amount, string source)",
      params: [walletAddress, releaseWei, "claim_release_" + splitRatio],
    });

    const txResults = await engineWrite(calls);
    const txIds = txResults.map((r: any) => r?.result?.transactions?.[0]?.id || "failed");
    const txId = txIds.join(",");

    // 4. DB: Record claim and release schedule
    await supabase.from("transactions").insert({
      user_id: profile.id,
      type: "MA_CLAIM",
      amount: claimAmount,
      token: "MA",
      status: "CONFIRMED",
      details: {
        splitRatio,
        burnPct: ratio.burnPct,
        burnAmount,
        releaseAmount,
        releaseDays: ratio.releaseDays,
        dailyRelease,
        txId,
      },
    });

    return json({
      status: "claimed",
      total: claimAmount,
      burned: burnAmount,
      released: releaseAmount,
      releaseDays: ratio.releaseDays,
      dailyRelease,
      txId,
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
