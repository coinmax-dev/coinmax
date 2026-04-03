import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * V4 Daily Settlement — Cron 12:00 SGT (04:00 UTC)
 *
 * Flow:
 *   1. DB: settle vault yields + node yields + team commissions
 *   2. Chain: VaultV4.addInterest(totalCUSD) → cUSD interest on-chain (记账)
 *   3. Chain: Engine mints MA → Release contract (based on DB totals)
 *   4. Chain: MAStaking — no action (MA already locked from deposit)
 *
 * VaultV4 only holds cUSD (no MA). MA minting is separate.
 *
 * Contracts:
 *   VaultV4:    0x08a24206b7AcAA7cf68E8a5bE16fE6cE7a4D1744
 *   MAToken:    0xc6d2dbC85DC3091C41692822A128c19F9eAc7988
 *   ReleaseV4:  0x1de32fF0aa9884536C8ba7Aa7fD1f6Ea6cf523Bc
 *   Oracle:     0x35580292fA5c8b7110034EA1a1521952E6F42bbb
 *   Engine:     0xDd6660E403d0242c1BeE52a4de50484AAF004446
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "";
const ENGINE_WALLET = "0xDd6660E403d0242c1BeE52a4de50484AAF004446";
const VAULT_V4 = "0x08a24206b7AcAA7cf68E8a5bE16fE6cE7a4D1744";
const MA_TOKEN = "0xc6d2dbC85DC3091C41692822A128c19F9eAc7988";
const RELEASE_V4 = "0x1de32fF0aa9884536C8ba7Aa7fD1f6Ea6cf523Bc";
const ORACLE = "0x35580292fA5c8b7110034EA1a1521952E6F42bbb";
const BSC_RPC = "https://bsc-dataseed1.binance.org";

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
    console.log("Engine:", call.method.slice(0,40), "→", r?.result?.transactions?.[0]?.id || r?.error?.message?.slice(0,60) || "?");
    results.push(r);
    if (calls.indexOf(call) < calls.length - 1) await new Promise(resolve => setTimeout(resolve, 3000));
  }
  return results;
}

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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Step 1: DB settlement ──
    const { data: dbResult, error: dbErr } = await supabase.rpc("run_daily_settlement");
    if (dbErr) throw new Error("DB settlement failed: " + dbErr.message);
    console.log("DB settlement:", JSON.stringify(dbResult));

    // ── Step 2: Calculate totals for on-chain ──
    const maPrice = await getOraclePrice();
    if (maPrice <= 0) throw new Error("Oracle price zero");

    // Get today's vault_rewards total
    const todayStart = new Date();
    todayStart.setUTCHours(todayStart.getUTCHours() - 1);
    const { data: vaultRewards } = await supabase
      .from("vault_rewards")
      .select("amount")
      .gte("created_at", todayStart.toISOString());

    const totalCusdYield = (vaultRewards || []).reduce((s: number, r: { amount: string }) => s + Number(r.amount || 0), 0);

    // Get today's total MA to mint (vault + node + broker rewards)
    const { data: nodeRewards } = await supabase
      .from("node_rewards")
      .select("amount")
      .gte("created_at", todayStart.toISOString());

    const { data: brokerRewards } = await supabase
      .from("broker_rewards")
      .select("amount")
      .gte("created_at", todayStart.toISOString());

    const totalNodeYield = (nodeRewards || []).reduce((s: number, r: { amount: string }) => s + Number(r.amount || 0), 0);
    const totalBrokerYield = (brokerRewards || []).reduce((s: number, r: { amount: string }) => s + Number(r.amount || 0), 0);

    // Total MA to mint = (vault yield + node yield + broker yield) / MA price
    const totalYieldUsd = totalCusdYield + totalNodeYield + totalBrokerYield;
    const totalMAToMint = totalYieldUsd / maPrice;

    if (totalYieldUsd <= 0) {
      return json({ status: "settled_db_only", dbResult, reason: "no yield to mint" });
    }

    // ── Step 3: On-chain — Only cUSD interest to Vault (no MA mint daily) ──
    // MA is NOT minted daily. Only minted when user claims (提现).
    // This saves massive gas costs.
    let txIds: string[] = [];

    if (totalCusdYield > 0) {
      const cusdWei = "0x" + BigInt(Math.floor(totalCusdYield * 1e18)).toString(16);
      const result = await engineWriteOne({
        contractAddress: VAULT_V4,
        method: "function addInterest(uint256 cusdAmount)",
        params: [cusdWei],
      });
      const txId = result?.result?.transactions?.[0]?.id || "?";
      txIds.push(txId);
      console.log(`On-chain: ${totalCusdYield.toFixed(2)} cUSD interest → ${txId}`);
    }

    // MA minting is DB-only. Actual mint happens in claim-v4 when user withdraws.
    console.log(`DB-only: ${totalMAToMint.toFixed(2)} MA recorded (not minted until claim)`);

    // ── Step 4: Process linear release schedules ──
    // DB: 每日从 remaining → released (待释放余额递增)
    // Chain: Engine 预铸造当天释放总额到 Engine 钱包, 一键释放时 transfer 给用户
    const { data: activeSchedules } = await supabase
      .from("release_schedules")
      .select("*")
      .eq("status", "ACTIVE");

    let releasedCount = 0;
    let releasedTotal = 0;

    if (activeSchedules && activeSchedules.length > 0) {
      for (const schedule of activeSchedules) {
        if (schedule.days_released >= schedule.days_total) {
          await supabase.from("release_schedules").update({ status: "COMPLETED" }).eq("id", schedule.id);
          continue;
        }

        const dailyAmount = Number(schedule.daily_amount);
        const remaining = Number(schedule.remaining_amount);
        const releaseToday = Math.min(dailyAmount, remaining);

        if (releaseToday <= 0) continue;

        // DB: move from remaining → released (待释放余额递增)
        const newDaysReleased = schedule.days_released + 1;
        const newReleasedAmount = Number(schedule.released_amount) + releaseToday;
        const newRemaining = remaining - releaseToday;
        const isCompleted = newDaysReleased >= schedule.days_total || newRemaining <= 0.001;

        await supabase.from("release_schedules").update({
          days_released: newDaysReleased,
          released_amount: newReleasedAmount,
          remaining_amount: Math.max(0, newRemaining),
          status: isCompleted ? "COMPLETED" : "ACTIVE",
        }).eq("id", schedule.id);

        releasedCount++;
        releasedTotal += releaseToday;
        console.log(`Release: ${schedule.wallet_address.slice(0,8)} +${releaseToday.toFixed(2)} MA → 待释放 (${newDaysReleased}/${schedule.days_total}d)`);
      }
    }

    // Chain: Engine 预铸造今日释放总额到 Engine 钱包 (一键释放时 transfer 给用户)
    let preMintTxId = "skipped";
    if (releasedTotal > 0.001) {
      const releaseMintWei = "0x" + BigInt(Math.floor(releasedTotal * 1e18)).toString(16);
      const preMintResult = await engineWriteOne({
        contractAddress: MA_TOKEN,
        method: "function mint(address to, uint256 amount)",
        params: [ENGINE_WALLET, releaseMintWei],
      });
      preMintTxId = preMintResult?.result?.transactions?.[0]?.id || "?";
      console.log(`Pre-mint: ${releasedTotal.toFixed(2)} MA → Engine wallet → ${preMintTxId}`);
    }

    // ── Step 5: Process vault maturity (到期 + 自动续期) ──
    let maturityResult: any = null;
    try {
      const { data: matData, error: matErr } = await supabase.rpc("process_vault_maturity");
      if (matErr) console.error("Maturity error:", matErr.message);
      else maturityResult = matData;
      console.log("Maturity:", JSON.stringify(maturityResult));
    } catch (e) {
      console.error("Maturity processing failed:", e);
    }

    return json({
      status: "settled",
      db: dbResult,
      maturity: maturityResult,
      onchain: {
        cusdInterest: totalCusdYield,
        maRecorded: totalMAToMint,
        maNote: "DB only, minted on claim",
        maPrice,
        txIds,
      },
      linearRelease: {
        schedulesProcessed: releasedCount,
        totalReleased: releasedTotal,
        preMintTxId,
      },
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Settlement error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
