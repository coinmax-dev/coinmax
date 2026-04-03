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

    // ── Step 3: On-chain — Add cUSD interest to Vault ──
    const cusdWei = "0x" + BigInt(Math.floor(totalCusdYield * 1e18)).toString(16);
    const maWei = "0x" + BigInt(Math.floor(totalMAToMint * 1e18)).toString(16);

    const calls: Array<{ contractAddress: string; method: string; params: unknown[] }> = [];

    // VaultV4.addInterest(cusdAmount) — cUSD 链上记账
    if (totalCusdYield > 0) {
      calls.push({
        contractAddress: VAULT_V4,
        method: "function addInterest(uint256 cusdAmount)",
        params: [cusdWei],
      });
    }

    // MA Token.mint(Release, totalMA) — 铸造 MA 到 Release 合约
    if (totalMAToMint > 0) {
      calls.push({
        contractAddress: MA_TOKEN,
        method: "function mint(address to, uint256 amount)",
        params: [RELEASE_V4, maWei],
      });
    }

    console.log(`On-chain: ${totalCusdYield.toFixed(2)} cUSD interest + ${totalMAToMint.toFixed(2)} MA mint`);
    const txResult = await engineWrite(calls);
    const txId = txResult?.result?.transactions?.[0]?.id || "unknown";

    return json({
      status: "settled",
      db: dbResult,
      onchain: {
        cusdInterest: totalCusdYield,
        maMinted: totalMAToMint,
        maPrice,
        txId,
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
