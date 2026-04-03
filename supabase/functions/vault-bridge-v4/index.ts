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
 *   Oracle:     0x35580292fA5c8b7110034EA1a1521952E6F42bbb
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
const ORACLE = "0x35580292fA5c8b7110034EA1a1521952E6F42bbb";
const BSC_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const BSC_RPC = "https://bsc-dataseed1.binance.org";

// Execute one contract call at a time (EOA doesn't support batch)
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

// Execute multiple calls sequentially
async function engineWrite(calls: Array<{ contractAddress: string; method: string; params: unknown[] }>) {
  const results = [];
  for (const call of calls) {
    const result = await engineWriteOne(call);
    console.log("Engine call:", call.method.slice(0,40), "→", result?.result?.transactions?.[0]?.id || result?.error?.message?.slice(0,60) || "unknown");
    results.push(result);
    // Wait 3s between calls for nonce
    if (calls.indexOf(call) < calls.length - 1) await new Promise(r => setTimeout(r, 3000));
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

    // Execute all on-chain calls (sequentially, one at a time)
    const txResults = await engineWrite(calls);
    const txIds = txResults.map((r: Record<string, unknown>) =>
      (r as any)?.result?.transactions?.[0]?.id || "failed"
    );
    const engineErrors = txResults.filter((r: Record<string, unknown>) => (r as any)?.error).map((r: Record<string, unknown>) => (r as any).error);
    const engineError = engineErrors.length > 0 ? engineErrors : null;

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
          engineTxIds: txIds,
        },
      });
    }

    // ── Auto Bridge USDC to ARB via thirdweb Bridge ──
    const ARB_TRADING = "0x3869100A4F165aE9C85024A32D90C5D7412D6b9c";
    const ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"; // ARB native USDC (6 decimals)
    let bridgeResult: any = null;

    try {
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

      if (receiverBalance >= 1) {
        const bridgeAmountWei = BigInt(Math.floor(receiverBalance * 1e18));

        // Step 1: Approve USDC to thirdweb Bridge universal router
        // thirdweb bridge prepare endpoint to get the router address + tx
        const prepareRes = await fetch("https://bridge.thirdweb.com/v1/transactions/prepare", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-secret-key": THIRDWEB_SECRET,
          },
          body: JSON.stringify({
            type: "transfer",
            params: {
              senderAddress: RECEIVER,
              receiverAddress: ARB_TRADING,
              originChainId: 56,
              destinationChainId: 42161,
              originTokenAddress: BSC_USDC,
              destinationTokenAddress: ARB_USDC,
              amount: bridgeAmountWei.toString(),
            },
          }),
        });
        const prepareData = await prepareRes.json();
        console.log("Bridge prepare:", JSON.stringify(prepareData).slice(0, 200));

        if (prepareData?.result?.steps) {
          // Execute each bridge step via Engine
          for (const step of prepareData.result.steps) {
            for (const tx of (step.transactions || [])) {
              const execRes = await fetch("https://engine.thirdweb.com/v1/write/contract", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-secret-key": THIRDWEB_SECRET,
                  "x-vault-access-token": VAULT_ACCESS_TOKEN,
                },
                body: JSON.stringify({
                  executionOptions: {
                    type: "EOA",
                    from: RECEIVER,
                    chainId: String(tx.chainId || 56),
                  },
                  params: [{
                    contractAddress: tx.to,
                    method: "raw",
                    params: [],
                    // Raw transaction data
                    ...(tx.data ? { rawTransaction: { to: tx.to, data: tx.data, value: tx.value || "0x0" } } : {}),
                  }],
                }),
              });
              const execData = await execRes.json();
              const txId = execData?.result?.transactions?.[0]?.id || "?";
              console.log("Bridge step tx:", txId);
              await new Promise(r => setTimeout(r, 3000));
            }
          }
          bridgeResult = { status: "bridged", steps: prepareData.result.steps.length };
        } else {
          // Fallback: simple transfer on BSC to Trading wallet
          console.log("Bridge API no steps, fallback to BSC transfer");
          const transferRes = await engineWriteOne({
            contractAddress: BSC_USDC,
            method: "function transfer(address to, uint256 amount) returns (bool)",
            params: [ARB_TRADING, "0x" + bridgeAmountWei.toString(16)],
          });
          bridgeResult = { status: "bsc_transfer", txId: transferRes?.result?.transactions?.[0]?.id };
        }
        console.log("Bridge result:", JSON.stringify(bridgeResult).slice(0, 100));
      }
    } catch (bridgeErr) {
      console.log("Bridge error (non-critical):", bridgeErr);
    }

    return json({
      status: "ok",
      type: isNode ? "node" : "vault",
      cusdAmount,
      maAmount: isNode ? (cusdAmount * 10) / maPrice : maAmount,
      maPrice,
      engineTxIds: txIds,
      engineError,
      bridge: bridgeResult ? "triggered" : "skipped",
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
