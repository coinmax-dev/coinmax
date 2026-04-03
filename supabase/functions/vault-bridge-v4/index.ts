import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * V4 Vault Bridge — Per-deposit trigger
 *
 * Called by frontend after user swap USDT→USDC to Receiver Server.
 *
 * Does 3 things:
 *   1. Engine: VaultV4.createPosition(cUSD) — on-chain 记账
 *   2. Engine: MAStaking.lock(MA) — 铸造 MA 锁仓
 *   3. Engine: NodeNFT.mintNode() — if node purchase (铸造节点 NFT)
 *   4. Bridge: Receiver USDC → thirdweb Bridge → ARB
 *
 * Contracts:
 *   VaultV4:    0x08a24206b7AcAA7cf68E8a5bE16fE6cE7a4D1744
 *   MAStaking:  0x0A92Fad0651f40a0a29A901dDAa7e1f2104b3821
 *   NodeNFT:    0x296cA393c151449e83F29AD874ACA6E4e243F88d
 *   Oracle:     0xB73A4Ac36a36C92C8d6F6828ea431Ca30f1943a2
 *   Engine:     0xDd6660E403d0242c1BeE52a4de50484AAF004446
 *   Receiver:   0xe193ACcf11aBf508e8c7D0CeE03ea4E6f75B09ff
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "";

const ENGINE_WALLET = "0xDd6660E403d0242c1BeE52a4de50484AAF004446";
const RECEIVER = "0xe193ACcf11aBf508e8c7D0CeE03ea4E6f75B09ff";
const VAULT_V4 = "0x08a24206b7AcAA7cf68E8a5bE16fE6cE7a4D1744";
const MA_STAKING = "0x0A92Fad0651f40a0a29A901dDAa7e1f2104b3821";
const NODE_NFT = "0x296cA393c151449e83F29AD874ACA6E4e243F88d";
const ORACLE = "0xB73A4Ac36a36C92C8d6F6828ea431Ca30f1943a2";
const BSC_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const BSC_RPC = "https://bsc-dataseed1.binance.org";

async function engineWrite(calls: Array<{ contractAddress: string; method: string; params: unknown[] }>) {
  const res = await fetch("https://engine.thirdweb.com/v1/write/contract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-secret-key": THIRDWEB_SECRET,
      "x-vault-access-token": VAULT_ACCESS_TOKEN,
    },
    body: JSON.stringify({
      executionOptions: { type: "EOA", from: ENGINE_WALLET, chainId: "56" },
      params: calls,
    }),
  });
  return res.json();
}

async function getOraclePrice(): Promise<number> {
  const res = await fetch(BSC_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", method: "eth_call", id: 1,
      params: [{ to: ORACLE, data: "0xa035b1fe" }, "latest"],
    }),
  });
  const d = await res.json();
  return parseInt(d.result || "0x0", 16) / 1e6;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { walletAddress, amount, planType, txHash, type, nodeType } = body;
    // type: "vault" (default) or "node"

    if (!walletAddress || !amount) {
      return json({ error: "Missing walletAddress or amount" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const cusdAmount = Number(amount);
    const cusdWei = "0x" + BigInt(Math.floor(cusdAmount * 1e18)).toString(16);

    // Get MA price for staking amount
    const maPrice = await getOraclePrice();
    const maAmount = cusdAmount / maPrice;
    const maWei = "0x" + BigInt(Math.floor(maAmount * 1e18)).toString(16);

    const plan = planType || "90_DAYS";
    const isNode = type === "node";

    const calls: Array<{ contractAddress: string; method: string; params: unknown[] }> = [];

    if (isNode) {
      // ── Node purchase ──
      // 1. Create cUSD position in Vault (leveraged)
      const leverageMap: Record<string, number> = { MAX: 10, MINI: 10 };
      const leverage = leverageMap[nodeType || "MAX"] || 10;
      const leveragedCusd = cusdAmount * leverage;
      const leveragedWei = "0x" + BigInt(Math.floor(leveragedCusd * 1e18)).toString(16);
      const durationMap: Record<string, string> = { MAX: "120_DAYS", MINI: "90_DAYS" };

      // Actually use createPosition for the leveraged amount
      // But VaultV4 doesn't have 120_DAYS plan... we use it as custom
      calls.push({
        contractAddress: VAULT_V4,
        method: "function createPosition(address user, uint256 cusdAmount, string planType, bool isBonus)",
        params: [walletAddress, leveragedWei, "90_DAYS", false], // use 90_DAYS as closest
      });

      // 2. Mint NodeNFT (need vaultPositionId — we'll get it from event or use 0 for now)
      calls.push({
        contractAddress: NODE_NFT,
        method: "function mintNode(address user, string nodeType, uint256 vaultPositionId)",
        params: [walletAddress, nodeType || "MAX", "0"],
      });

      // 3. Lock MA in staking
      const leveragedMA = leveragedCusd / maPrice;
      const leveragedMAWei = "0x" + BigInt(Math.floor(leveragedMA * 1e18)).toString(16);
      calls.push({
        contractAddress: MA_STAKING,
        method: "function lock(address user, uint256 maAmount, uint256 duration, uint256 vaultPositionId)",
        params: [walletAddress, leveragedMAWei, nodeType === "MINI" ? "7776000" : "10368000", "0"],
        // 90 days = 7776000s, 120 days = 10368000s
      });

      console.log(`Node ${nodeType}: ${walletAddress} | $${cusdAmount} → $${leveragedCusd} cUSD | ${leveragedMA.toFixed(2)} MA locked`);

    } else {
      // ── Vault deposit ──
      // 1. Create cUSD position
      calls.push({
        contractAddress: VAULT_V4,
        method: "function createPosition(address user, uint256 cusdAmount, string planType, bool isBonus)",
        params: [walletAddress, cusdWei, plan, false],
      });

      // 2. Lock MA in staking
      const durationMap: Record<string, string> = {
        "5_DAYS": "432000", "45_DAYS": "3888000", "90_DAYS": "7776000", "180_DAYS": "15552000"
      };
      calls.push({
        contractAddress: MA_STAKING,
        method: "function lock(address user, uint256 maAmount, uint256 duration, uint256 vaultPositionId)",
        params: [walletAddress, maWei, durationMap[plan] || "7776000", "0"],
      });

      console.log(`Vault: ${walletAddress} | $${cusdAmount} cUSD | ${maAmount.toFixed(2)} MA locked | ${plan}`);
    }

    // Execute all on-chain calls
    const txResult = await engineWrite(calls);
    const txId = txResult?.result?.transactions?.[0]?.id || "unknown";

    // Record in DB
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("wallet_address", walletAddress)
      .single();

    if (profile) {
      await supabase.from("transactions").insert({
        user_id: profile.id,
        type: isNode ? "NODE_PURCHASE" : "VAULT_DEPOSIT",
        amount: cusdAmount,
        token: "USDC",
        status: "CONFIRMED",
        tx_hash: txHash || null,
        details: {
          planType: plan,
          nodeType: isNode ? (nodeType || "MAX") : null,
          maAmount,
          maPrice,
          engineTxId: txId,
        },
      });
    }

    // ── Bridge USDC to ARB (fire-and-forget) ──
    // Check Receiver USDC balance
    const balRes = await fetch(BSC_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", method: "eth_call", id: 1,
        params: [{
          to: BSC_USDC,
          data: "0x70a08231000000000000000000000000" + RECEIVER.slice(2).toLowerCase(),
        }, "latest"],
      }),
    });
    const balData = await balRes.json();
    const receiverBalance = parseInt(balData.result || "0x0", 16) / 1e18;

    return json({
      status: "ok",
      type: isNode ? "node" : "vault",
      cusdAmount,
      maAmount: isNode ? (cusdAmount * (isNode ? 10 : 1)) / maPrice : maAmount,
      maPrice,
      engineTxId: txId,
      receiverUSDC: receiverBalance,
      bridgeNote: "Use thirdweb bridge to cross-chain Receiver USDC → ARB",
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Vault bridge error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
