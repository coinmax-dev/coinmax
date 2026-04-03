import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * V4 一键释放 — Transfer pre-minted MA from Engine wallet to user
 *
 * settle-v4 每日预铸造释放总额到 Engine 钱包
 * 用户点"一键释放"时，Engine transfer MA 到用户钱包 (不是 mint)
 *
 * claimable = SUM(released_amount - claimed_amount) across all schedules
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "";
const ENGINE_WALLET = "0xDd6660E403d0242c1BeE52a4de50484AAF004446";
const MA_TOKEN = "0xc6d2dbC85DC3091C41692822A128c19F9eAc7988";

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { walletAddress } = await req.json();
    if (!walletAddress) return json({ error: "Missing walletAddress" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Get user
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .ilike("wallet_address", walletAddress)
      .single();
    if (!profile) return json({ error: "Profile not found" }, 404);

    // 2. Get all schedules with claimable balance
    const { data: schedules } = await supabase
      .from("release_schedules")
      .select("id, released_amount, claimed_amount")
      .eq("user_id", profile.id);

    if (!schedules || schedules.length === 0) {
      return json({ error: "No release schedules", totalClaimable: 0 }, 400);
    }

    // Calculate claimable per schedule
    let totalClaimable = 0;
    const claimableSchedules: Array<{ id: string; claimable: number }> = [];

    for (const s of schedules) {
      const released = Number(s.released_amount || 0);
      const claimed = Number(s.claimed_amount || 0);
      const claimable = released - claimed;
      if (claimable > 0.0001) {
        claimableSchedules.push({ id: s.id, claimable });
        totalClaimable += claimable;
      }
    }

    if (totalClaimable < 0.001) {
      return json({ error: "No claimable balance", totalClaimable: 0 }, 400);
    }

    console.log(`一键释放: ${walletAddress} | ${totalClaimable.toFixed(4)} MA from ${claimableSchedules.length} schedules`);

    // 3. Engine: Mint MA directly to user wallet
    // (后续优化: settle 预铸造到 Engine 后改为 transfer)
    const totalWei = "0x" + BigInt(Math.floor(totalClaimable * 1e18)).toString(16);
    const mintResult = await engineWriteOne({
      contractAddress: MA_TOKEN,
      method: "function mint(address to, uint256 amount)",
      params: [walletAddress, totalWei],
    });

    const txId = mintResult?.result?.transactions?.[0]?.id || "failed";
    const txError = mintResult?.error?.message || null;
    console.log("Mint TX:", txId, txError || "ok");

    if (txId === "failed") {
      return json({ error: "Mint failed: " + (txError || "unknown") }, 500);
    }

    // 4. Update claimed_amount in each schedule
    for (const s of claimableSchedules) {
      const { data: current } = await supabase
        .from("release_schedules")
        .select("claimed_amount")
        .eq("id", s.id)
        .single();
      const newClaimed = Number(current?.claimed_amount || 0) + s.claimable;
      await supabase.from("release_schedules").update({
        claimed_amount: newClaimed,
      }).eq("id", s.id);
    }

    // 5. Wait for on-chain tx hash (poll thirdweb Engine V1)
    let onChainHash: string | null = null;
    try {
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const statusRes = await fetch(`https://engine.thirdweb.com/v1/transactions/${txId}`, {
          headers: {
            "x-secret-key": THIRDWEB_SECRET,
            "x-vault-access-token": VAULT_ACCESS_TOKEN,
          },
        });
        if (!statusRes.ok) continue;
        const statusData = await statusRes.json();
        const tx = statusData?.result;
        // V1 Engine: transactionHash at top level
        if (tx?.transactionHash) {
          onChainHash = tx.transactionHash;
          console.log("On-chain confirmed:", onChainHash);
          break;
        }
        if (tx?.status === "FAILED") {
          console.log("TX failed:", tx?.executionResult?.error?.message?.slice(0, 100));
          break;
        }
      }
    } catch (e) {
      console.log("Polling error (non-critical):", e);
    }

    // 6. Record transaction with on-chain hash
    await supabase.from("transactions").insert({
      user_id: profile.id,
      type: "MA_RELEASE",
      amount: totalClaimable,
      token: "MA",
      status: "CONFIRMED",
      tx_hash: onChainHash,
      details: {
        schedulesCount: claimableSchedules.length,
        engineTxId: txId,
        note: "释放到账",
      },
    });

    return json({
      status: "released",
      totalMinted: totalClaimable,
      schedulesProcessed: claimableSchedules.length,
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
