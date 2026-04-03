import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Batch Bridge — BSC USDT → ARB via thirdweb Bridge SDK
 *
 * Cron: every 10 minutes
 * Flow:
 *   1. Check BatchBridgeV2 USDT balance on BSC
 *   2. Owner withdraws USDT to deployer
 *   3. thirdweb Bridge SDK: BSC USDT → ARB (Sell.prepare + execute)
 *   4. Record bridge cycle + fees in DB
 *   5. If hl_deposit_enabled: auto-deposit 30% to HyperLiquid
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "vt_act_B6LKUWDDFVRRESRTNN2OYYYKTOCLDEAYSVFMSYI6A4L47R4ENX26GDBYUVCAGT2WVMNWCQNQWXOR6AFXILSR2DFIJAH3AM5QG4ERZIPV";

const BATCH_BRIDGE = "0x1Baa40837a253DA171a458A979f87b9A29CE0Efa";
const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
const ARB_FUND_ROUTER = "0x71237E535d5E00CDf18A609eA003525baEae3489";
const DEPLOYER = "0x1B6B492d8fbB8ded7dC6E1D48564695cE5BCB9b1";
const MIN_BRIDGE_AMOUNT = 50; // minimum $50

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Check BatchBridge USDT balance
    const balRes = await fetch("https://bsc-dataseed1.binance.org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", method: "eth_call", id: 1,
        params: [{
          to: BSC_USDT,
          data: "0x70a08231000000000000000000000000" + BATCH_BRIDGE.slice(2).toLowerCase(),
        }, "latest"],
      }),
    });
    const balData = await balRes.json();
    const balance = parseInt(balData.result || "0x0", 16) / 1e18;

    if (balance < MIN_BRIDGE_AMOUNT) {
      return json({ status: "skipped", reason: `$${balance.toFixed(2)} < min $${MIN_BRIDGE_AMOUNT}`, balance });
    }

    // 2. Withdraw USDT from BatchBridge to deployer (owner call)
    const withdrawRes = await fetch("https://api.thirdweb.com/v1/contracts/write", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-secret-key": THIRDWEB_SECRET,
        "x-vault-access-token": VAULT_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        chainId: 56,
        from: DEPLOYER,
        calls: [{
          contractAddress: BATCH_BRIDGE,
          method: "function withdrawAll(address to)",
          params: [DEPLOYER],
        }],
      }),
    });
    const withdrawData = await withdrawRes.json();
    const withdrawTxId = withdrawData?.result?.transactionIds?.[0];

    if (!withdrawTxId) {
      return json({ status: "error", reason: "Withdraw from BatchBridge failed", error: withdrawData }, 500);
    }

    // Wait for withdraw to confirm
    await new Promise(r => setTimeout(r, 8000));

    // 3. Get thirdweb Bridge quote (Sell)
    const amountWei = BigInt(Math.floor(balance * 1e18)).toString();
    const quoteRes = await fetch("https://api.thirdweb.com/v1/bridge/quote?" +
      `originChainId=56` +
      `&originTokenAddress=${BSC_USDT}` +
      `&destinationChainId=42161` +
      `&destinationTokenAddress=0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` +
      `&amount=${amountWei}` +
      `&sender=${DEPLOYER}` +
      `&receiver=${ARB_FUND_ROUTER}`, {
        headers: { "x-secret-key": THIRDWEB_SECRET },
      }
    );

    let bridgeStatus = "QUOTED";
    let bridgeFee = 0;
    let bridgeTxId = null;
    let quoteData: any = null;

    if (quoteRes.ok) {
      quoteData = await quoteRes.json();
      bridgeFee = Number(quoteData?.estimate?.feeCosts?.[0]?.amount || 0) / 1e18;

      // 4. Execute bridge steps (approve + send)
      if (quoteData?.steps) {
        for (const step of quoteData.steps) {
          for (const tx of (step.transactions || [])) {
            if (tx.to && tx.data) {
              const execRes = await fetch("https://api.thirdweb.com/v1/contracts/write", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-secret-key": THIRDWEB_SECRET,
                  "x-vault-access-token": VAULT_ACCESS_TOKEN,
                },
                body: JSON.stringify({
                  chainId: tx.chainId || 56,
                  from: DEPLOYER,
                  calls: [{ contractAddress: tx.to, method: "", params: [], rawCalldata: tx.data, value: tx.value || "0" }],
                }),
              });
              const execData = await execRes.json();
              bridgeTxId = execData?.result?.transactionIds?.[0] || bridgeTxId;
            }
          }
        }
        bridgeStatus = bridgeTxId ? "BRIDGING" : "QUOTE_ONLY";
      }
    } else {
      // Bridge API failed — record as quote only, admin can retry
      bridgeStatus = "QUOTE_FAILED";
    }

    // 5. Record in DB
    await supabase.from("bridge_cycles").insert({
      cycle_type: "BATCH_BRIDGE_V2",
      status: bridgeStatus,
      amount_usd: balance,
      fees_usd: bridgeFee,
      initiated_by: "cron",
      bsc_tx: withdrawTxId,
      arb_tx: bridgeTxId,
      metadata: {
        bridgeContract: BATCH_BRIDGE,
        fromChain: "BSC",
        toChain: "ARB",
        fromToken: "USDT",
        amount: balance,
        fee: bridgeFee,
        withdrawTxId,
        bridgeTxId,
        quoteStatus: quoteRes.ok ? "success" : "failed",
      },
    });

    // 6. Check if HL deposit should be triggered
    const { data: hlSwitch } = await supabase
      .from("system_config")
      .select("value")
      .eq("key", "hl_deposit_enabled")
      .single();

    const hlEnabled = hlSwitch?.value === "true";
    let hlResult = null;

    if (hlEnabled && bridgeStatus === "BRIDGING") {
      // Wait for bridge to arrive on ARB (~30s)
      await new Promise(r => setTimeout(r, 30000));

      // Auto-deposit 30% to HL
      const hlAmount = balance * 0.30;
      try {
        const hlRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/hl-treasury`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ action: "deposit", amount: hlAmount }),
        });
        hlResult = await hlRes.json();
      } catch (e: any) {
        hlResult = { error: e.message };
      }
    }

    return json({
      status: bridgeStatus,
      balance,
      fee: bridgeFee,
      withdrawTxId,
      bridgeTxId,
      hlEnabled,
      hlDeposit: hlResult,
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
