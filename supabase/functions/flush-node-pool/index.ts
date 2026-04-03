import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Flush Node Funds — 3-hop Server Wallet relay for privacy
 * Cron: every 30 minutes
 *
 * Flow:
 *   BatchBridgeV2 (USDT) → deployer withdraws
 *   → Server Wallet A (0xeBAB) → Server Wallet B (0x0831) → 节点钱包 (0xeb8A)
 *
 * Privacy: on-chain only shows wallet-to-wallet transfers, not traceable to node purchase
 *
 * Note: Node purchases go through Vault.purchaseNodePublic → BatchBridgeV2 (same as vault)
 *       This function checks DB for pending node purchases and routes their USDT portion
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "vt_act_B6LKUWDDFVRRESRTNN2OYYYKTOCLDEAYSVFMSYI6A4L47R4ENX26GDBYUVCAGT2WVMNWCQNQWXOR6AFXILSR2DFIJAH3AM5QG4ERZIPV";

const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
const BATCH_BRIDGE = "0x96dBfe3aAa877A4f9fB41d592f1D990368a4B2C1";
const EOA_WALLET = "0xeBAB6D22278c9839A46B86775b3AC9469710F84b"; // vault admin
const SERVER_WALLET_B = "0x0831e8875685C796D05F2302D3c5C2Dd77fAc3B6"; // trade server
const NODE_WALLET = "0xeb8AbD9b47F9Ca0d20e22636B2004B75E84BdcD9";    // final destination

const TRANSFER_METHOD = "function transfer(address to, uint256 amount) returns (bool)";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Check pending node purchases (not yet flushed)
    const { data: pendingNodes } = await supabase
      .from("transactions")
      .select("id, amount")
      .eq("type", "NODE_PURCHASE")
      .eq("status", "CONFIRMED")
      .is("details->flushed", null)
      .order("created_at", { ascending: true })
      .limit(20);

    if (!pendingNodes || pendingNodes.length === 0) {
      return json({ status: "skip", reason: "no pending node purchases" });
    }

    const totalAmount = pendingNodes.reduce((sum: number, n: any) => sum + Number(n.amount || 0), 0);
    if (totalAmount < 1) {
      return json({ status: "skip", reason: "total amount too small", amount: totalAmount });
    }

    const amountWei = "0x" + BigInt(Math.floor(totalAmount * 1e18)).toString(16);

    // 2. Hop 1: Vault sends node funds to nodeReceiver (Server Wallet A)
    //    Vault.purchaseNodePublic → nodeReceiver = Server Wallet A
    //    So USDT is already in Server Wallet A after purchase
    //    Check Server Wallet A USDT balance
    const balRes = await fetch("https://bsc-dataseed1.binance.org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", method: "eth_call", id: 1,
        params: [{
          to: BSC_USDT,
          data: "0x70a08231000000000000000000000000" + EOA_WALLET.slice(2).toLowerCase(),
        }, "latest"],
      }),
    });
    const balData = await balRes.json();
    const walletABalance = parseInt(balData.result || "0x0", 16) / 1e18;

    if (walletABalance < totalAmount) {
      return json({
        status: "waiting",
        reason: `Server Wallet A has $${walletABalance.toFixed(2)}, need $${totalAmount.toFixed(2)}. Withdraw from BatchBridge first.`,
        pendingCount: pendingNodes.length,
        totalAmount,
      });
    }

    // 3. Hop 2: Server Wallet A → Server Wallet B
    const hop2Res = await fetch("https://engine.thirdweb.com/v1/write/contract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-secret-key": THIRDWEB_SECRET,
        "x-vault-access-token": VAULT_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        executionOptions: { type: "EOA", from: EOA_WALLET, chainId: "56" },
        params: [{
          contractAddress: BSC_USDT,
          method: TRANSFER_METHOD,
          params: [SERVER_WALLET_B, amountWei],
        }],
      }),
    });
    const hop2Data = await hop2Res.json();
    const hop2TxId = hop2Data?.result?.transactionIds?.[0];

    if (!hop2TxId) {
      return json({ status: "error", reason: "Hop 2 failed (A→B)", error: hop2Data }, 500);
    }

    // Wait a bit for tx to confirm
    await new Promise(r => setTimeout(r, 5000));

    // 4. Hop 3: Server Wallet B → Node Wallet
    const hop3Res = await fetch("https://engine.thirdweb.com/v1/write/contract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-secret-key": THIRDWEB_SECRET,
        "x-vault-access-token": VAULT_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        executionOptions: { type: "EOA", from: SERVER_WALLET_B, chainId: "56" },
        params: [{
          contractAddress: BSC_USDT,
          method: TRANSFER_METHOD,
          params: [NODE_WALLET, amountWei],
        }],
      }),
    });
    const hop3Data = await hop3Res.json();
    const hop3TxId = hop3Data?.result?.transactionIds?.[0];

    // 5. Mark node purchases as flushed
    for (const node of pendingNodes) {
      await supabase
        .from("transactions")
        .update({ details: { flushed: true, hop2TxId, hop3TxId, flushedAt: new Date().toISOString() } })
        .eq("id", node.id);
    }

    return json({
      status: "flushed",
      count: pendingNodes.length,
      amount: totalAmount,
      hops: {
        "A→B": hop2TxId || "failed",
        "B→节点": hop3TxId || "failed",
      },
    });

  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
