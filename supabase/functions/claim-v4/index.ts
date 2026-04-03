import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * V4 Claim — 提现线性释放
 *
 * 1. 用户选择提现金额 + 分成比例
 * 2. Engine 铸造 MA → Release 合约持有
 * 3. 立即销毁 burn 部分
 * 4. DB 创建线性释放计划 (不立即 addReleased)
 * 5. 每日 settle cron 按天释放 → Release.addReleased
 * 6. 用户每天可 claim 已释放的部分
 *
 * Split Ratios:
 *   A: 0% burn, 60天释放
 *   B: 5% burn, 45天释放
 *   C: 10% burn, 30天释放
 *   D: 20% burn, 14天释放
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

    // 1. Validate user
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("wallet_address", walletAddress)
      .single();
    if (!profile) return json({ error: "Profile not found" }, 404);

    const claimAmount = Number(amount);
    if (claimAmount <= 0) return json({ error: "Invalid amount" }, 400);

    // 2. Calculate
    const burnAmount = claimAmount * ratio.burnPct / 100;
    const releaseAmount = claimAmount - burnAmount;
    const dailyRelease = releaseAmount / ratio.releaseDays;

    const totalWei = "0x" + BigInt(Math.floor(claimAmount * 1e18)).toString(16);
    const burnWei = "0x" + BigInt(Math.floor(burnAmount * 1e18)).toString(16);

    // 3. On-chain: Mint total MA → Release contract
    console.log(`Claim: ${walletAddress} | total:${claimAmount} burn:${burnAmount} release:${releaseAmount} over ${ratio.releaseDays}d`);

    const mintResult = await engineWriteOne({
      contractAddress: MA_TOKEN,
      method: "function mint(address to, uint256 amount)",
      params: [RELEASE, totalWei],
    });
    const mintTxId = mintResult?.result?.transactions?.[0]?.id || "failed";
    console.log("Mint TX:", mintTxId);

    // 4. On-chain: Burn portion directly from MA Token (not Release.destroy)
    let burnTxId = "none";
    if (burnAmount > 0) {
      await new Promise(r => setTimeout(r, 3000));
      // Engine burns from Release contract's MA balance
      // Use Release.destroy which burns locked MA — but we need to lock first
      // Simpler: just burn via MA.burnFrom(Release, burnAmount) — Engine has MINTER_ROLE
      const burnResult = await engineWriteOne({
        contractAddress: MA_TOKEN,
        method: "function burnFrom(address from, uint256 amount)",
        params: [RELEASE, burnWei],
      });
      burnTxId = burnResult?.result?.transactions?.[0]?.id || "failed";
      console.log("Burn TX:", burnTxId);
    }

    // 5. DB: Create linear release schedule (NOT immediate addReleased)
    const now = new Date();
    const endDate = new Date(now.getTime() + ratio.releaseDays * 86400000);

    await supabase.from("release_schedules").insert({
      user_id: profile.id,
      wallet_address: walletAddress,
      total_amount: releaseAmount,
      daily_amount: dailyRelease,
      released_amount: 0,
      remaining_amount: releaseAmount,
      days_total: ratio.releaseDays,
      days_released: 0,
      split_ratio: splitRatio,
      burn_amount: burnAmount,
      start_date: now.toISOString(),
      end_date: endDate.toISOString(),
      status: "ACTIVE",
      mint_tx_id: mintTxId,
      burn_tx_id: burnTxId,
    });

    // 6. DB: Record in transactions history
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
        mintTxId,
        burnTxId,
        schedule: "linear_release",
      },
    });

    return json({
      status: "claimed",
      total: claimAmount,
      burned: burnAmount,
      released: releaseAmount,
      releaseDays: ratio.releaseDays,
      dailyRelease,
      mintTxId,
      burnTxId,
      note: `${releaseAmount} MA will be released over ${ratio.releaseDays} days at ${dailyRelease.toFixed(4)} MA/day`,
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
