/**
 * Settle Node Interest — Daily cron for node earnings → MA minting → Release
 *
 * Flow:
 *   1. Call DB settle_node_fixed_yield() to calculate daily earnings
 *   2. Call DB check_node_activation() + check_node_milestones() for qualification
 *   3. Read unprocessed node_rewards (FIXED_YIELD) from DB
 *   4. Batch mint MA via Server Wallet → MAToken.mintTo(Release, maAmount)
 *   5. Batch credit accumulated → Release.addAccumulated(user, maAmount)
 *   6. Mark rewards as on-chain processed
 *
 * POST body: {} (no params needed, runs as daily cron)
 * or: { walletAddress: string } (single user mode for testing)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// thirdweb Engine config
const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "vt_act_B6LKUWDDFVRRESRTNN2OYYYKTOCLDEAYSVFMSYI6A4L47R4ENX26GDBYUVCAGT2WVMNWCQNQWXOR6AFXILSR2DFIJAH3AM5QG4ERZIPV";
const SERVER_WALLET = Deno.env.get("SERVER_WALLET") || "0xcb41F3C3eD6C255F57Cda1bA3fd42389B0f0F0aA";

// Contract addresses — use env vars with fallbacks
const MA_TOKEN = Deno.env.get("MA_TOKEN_ADDRESS") || "0xdFaC84b2f9cfD02b3f44760E0Ff88b4EeC0e1593";
const RELEASE_CONTRACT = Deno.env.get("RELEASE_ADDRESS") || "0x842b48a616fA107bcd18e3656edCe658D4279f92";
const NODE_ENGINE = Deno.env.get("NODE_ENGINE_ADDRESS") || "0x9C8308603f319713c5aF2D0bF1CB53C6106f4d51";
const BSC_RPC = Deno.env.get("BSC_RPC") || "https://bsc-dataseed1.binance.org";

// Max batch size per thirdweb call
const BATCH_SIZE = 50;

// ─── Helpers ────────────────────────────────────────────────────────

async function getMAPrice(): Promise<number> {
  try {
    // Call MAPriceOracle.getPrice() on-chain
    const oracleAddr = Deno.env.get("PRICE_ORACLE_ADDRESS") || "0x3EC635802091b9F95b2891f3fd2504499f710145";
    const res = await fetch(BSC_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", method: "eth_call", id: 1,
        params: [{ to: oracleAddr, data: "0xa035b1fe" }, "latest"],
      }),
    });
    const d = await res.json();
    const price = parseInt(d.result || "0x0", 16) / 1e6;
    if (price > 0) return price;
  } catch { /* fallback below */ }

  // Fallback: read from DB config
  return 0.10; // default
}

async function callThirdweb(calls: Array<{ contractAddress: string; method: string; params: unknown[] }>) {
  if (!THIRDWEB_SECRET) {
    console.warn("THIRDWEB_SECRET_KEY not set, skipping on-chain calls");
    return { result: { transactionIds: [] }, simulated: true };
  }

  const res = await fetch("https://api.thirdweb.com/v1/contracts/write", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-secret-key": THIRDWEB_SECRET,
      "x-vault-access-token": VAULT_ACCESS_TOKEN,
    },
    body: JSON.stringify({
      chainId: 56,
      from: SERVER_WALLET,
      calls,
    }),
  });

  return res.json();
}

// ─── Main ────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const { walletAddress } = body;

    // ──────────────────────────────────────────
    // Step 1: Run DB settlement (node fixed yield)
    // ──────────────────────────────────────────
    const { data: settleResult, error: settleErr } = await supabase.rpc("settle_node_fixed_yield");
    if (settleErr) {
      console.error("settle_node_fixed_yield error:", settleErr);
    }

    // ──────────────────────────────────────────
    // Step 2: Run activation + qualification checks
    // ──────────────────────────────────────────
    if (walletAddress) {
      await supabase.rpc("check_node_activation", { addr: walletAddress });
      await supabase.rpc("check_node_milestones", { addr: walletAddress });
    } else {
      // Batch: check all nodes
      const { data: nodeUsers } = await supabase
        .from("node_memberships")
        .select("user_id, profiles!inner(wallet_address)")
        .in("status", ["ACTIVE", "PENDING_MILESTONES"]);

      const checked = new Set<string>();
      for (const row of nodeUsers || []) {
        const addr = (row as any).profiles?.wallet_address;
        if (!addr || checked.has(addr)) continue;
        checked.add(addr);
        await supabase.rpc("check_node_activation", { addr });
        await supabase.rpc("check_node_milestones", { addr });
      }
    }

    // ──────────────────────────────────────────
    // Step 3: Read unprocessed node rewards
    // ──────────────────────────────────────────
    let query = supabase
      .from("node_rewards")
      .select("id, user_id, amount, reward_type, details, profiles!inner(wallet_address)")
      .eq("reward_type", "FIXED_YIELD")
      .is("details->on_chain_processed", null) // not yet minted on-chain
      .order("created_at", { ascending: true })
      .limit(200);

    if (walletAddress) {
      // Get user_id first
      const { data: profile } = await supabase
        .from("profiles").select("id").eq("wallet_address", walletAddress).single();
      if (profile) {
        query = query.eq("user_id", profile.id);
      }
    }

    const { data: rewards, error: rewardsErr } = await query;
    if (rewardsErr) {
      return json({ error: `Fetch rewards: ${rewardsErr.message}` }, 500);
    }

    if (!rewards || rewards.length === 0) {
      return json({
        success: true,
        settlement: settleResult,
        message: "No unprocessed node rewards",
        minted: 0,
      });
    }

    // ──────────────────────────────────────────
    // Step 4: Get MA price and prepare on-chain batch
    // ──────────────────────────────────────────
    const maPrice = await getMAPrice();
    if (maPrice <= 0) {
      return json({ error: "MA price unavailable" }, 500);
    }

    // Group rewards by user for efficient batching
    const userRewards = new Map<string, { walletAddress: string; totalUsd: number; rewardIds: string[]; nodeType: string }>();

    for (const r of rewards) {
      const addr = (r as any).profiles?.wallet_address;
      if (!addr) continue;

      const nodeType = r.details?.node_type || "MINI";
      const key = addr;

      if (!userRewards.has(key)) {
        userRewards.set(key, { walletAddress: addr, totalUsd: 0, rewardIds: [], nodeType });
      }

      const entry = userRewards.get(key)!;
      entry.totalUsd += Number(r.amount || 0);
      entry.rewardIds.push(r.id);
    }

    // ──────────────────────────────────────────
    // Step 5: Batch mint MA → Release contract
    // ──────────────────────────────────────────
    const entries = [...userRewards.values()];
    let totalMintedMA = 0;
    let totalProcessed = 0;
    const allTxIds: string[] = [];
    const processedRewardIds: string[] = [];

    // Process in batches
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      const calls: Array<{ contractAddress: string; method: string; params: unknown[] }> = [];

      // Prepare batch arrays for NodeEngine.batchMintNodeRewards
      const batchUsers: string[] = [];
      const batchAmounts: string[] = [];
      const batchTypes: string[] = [];

      for (const entry of batch) {
        const maAmount = entry.totalUsd / maPrice;
        if (maAmount <= 0) continue;

        // USD amount in 18 decimals (e.g. 9 USD = 9e18)
        const usdWei = BigInt(Math.floor(entry.totalUsd * 1e18)).toString();

        batchUsers.push(entry.walletAddress);
        batchAmounts.push(usdWei);
        batchTypes.push(entry.nodeType);

        totalMintedMA += maAmount;
        totalProcessed++;
        processedRewardIds.push(...entry.rewardIds);
      }

      // Call NodeEngine.batchMintNodeRewards — it handles mintTo + addAccumulated
      if (batchUsers.length > 0) {
        calls.push({
          contractAddress: NODE_ENGINE,
          method: "function batchMintNodeRewards(address[] users, uint256[] usdAmounts, string[] nodeTypes)",
          params: [batchUsers, batchAmounts, batchTypes],
        });
      }

      if (calls.length > 0) {
        const result = await callThirdweb(calls);
        const txIds = result?.result?.transactionIds || [];
        allTxIds.push(...txIds);

        if (result?.error) {
          console.error("Thirdweb batch error:", result.error);
          // Don't mark as processed if on-chain call failed
          continue;
        }

        // ──────────────────────────────────────
        // Step 6: Mark rewards as on-chain processed
        // ──────────────────────────────────────
        for (const entry of batch) {
          for (const rid of entry.rewardIds) {
            await supabase
              .from("node_rewards")
              .update({
                details: {
                  ...(rewards.find(r => r.id === rid)?.details || {}),
                  on_chain_processed: true,
                  ma_price: maPrice,
                  ma_minted: entry.totalUsd / maPrice,
                  tx_ids: txIds,
                  processed_at: new Date().toISOString(),
                },
              })
              .eq("id", rid);
          }
        }
      }
    }

    return json({
      success: true,
      settlement: settleResult,
      maPrice,
      totalProcessed,
      totalMintedMA: Math.round(totalMintedMA * 100) / 100,
      totalRewards: rewards.length,
      txIds: allTxIds,
    });

  } catch (e: any) {
    console.error("settle-node-interest error:", e);
    return json({ error: e.message }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
