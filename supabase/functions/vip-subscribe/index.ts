import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-payment, payment-signature",
  "Access-Control-Expose-Headers": "x-payment-response, payment-response",
};

// ── x402 payment config ─────────────────────────────────────
// Receiver: Arbitrum USDC — thirdweb facilitator handles cross-chain bridge
const PAY_TO = Deno.env.get("VIP_RECEIVER_ADDRESS") || "";
const RECEIVER_CHAIN_ID = 42161; // Arbitrum One
const RECEIVER_ASSET = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"; // USDC on Arbitrum (native)
const RECEIVER_ASSET_DECIMALS = 6;

// thirdweb server wallet — executes on-chain settlement via EIP-7702
const THIRDWEB_SECRET_KEY = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "vt_act_B6LKUWDDFVRRESRTNN2OYYYKTOCLDEAYSVFMSYI6A4L47R4ENX26GDBYUVCAGT2WVMNWCQNQWXOR6AFXILSR2DFIJAH3AM5QG4ERZIPV";
const SERVER_WALLET_ADDRESS = Deno.env.get("THIRDWEB_SERVER_WALLET") || "";

const VIP_PLANS: Record<string, { price: number; days: number; label: string }> = {
  monthly:  { price: 49,  days: 30,  label: "monthly" },
  halfyear: { price: 149, days: 180, label: "halfyear" },
};

/**
 * Build the 402 Payment Required response per x402 spec.
 */
function buildPaymentRequired(priceUsd: number, planKey: string) {
  const paymentRequirements = {
    scheme: "exact",
    network: `eip155:${RECEIVER_CHAIN_ID}`,
    maxAmountRequired: String(priceUsd * 10 ** RECEIVER_ASSET_DECIMALS),
    resource: `vip-subscribe/${planKey}`,
    description: `CoinMax VIP ${planKey} subscription - $${priceUsd}`,
    mimeType: "application/json",
    payTo: PAY_TO,
    maxTimeoutSeconds: 600,
    asset: RECEIVER_ASSET,
    outputSchema: null,
    extra: { planKey },
  };

  return new Response(
    JSON.stringify({
      error: "Payment Required",
      paymentRequirements: [paymentRequirements],
    }),
    {
      status: 402,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "X-Payment-Required": JSON.stringify(paymentRequirements),
      },
    },
  );
}

/**
 * Settle x402 payment via thirdweb facilitator with server wallet.
 * The server wallet executes the on-chain transfer (gasless via EIP-7702).
 */
async function settlePayment(
  paymentHeader: string,
  expectedAmount: number,
  resourceUrl: string,
): Promise<{ settled: boolean; txHash?: string } | null> {
  try {
    const paymentData = JSON.parse(paymentHeader);

    // Call thirdweb facilitator settle endpoint
    const resp = await fetch("https://x402.thirdweb.com/settle", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-secret-key": THIRDWEB_SECRET_KEY,
        "x-vault-access-token": VAULT_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        paymentData,
        payTo: PAY_TO,
        network: `eip155:${RECEIVER_CHAIN_ID}`,
        asset: RECEIVER_ASSET,
        maxAmountRequired: String(expectedAmount * 10 ** RECEIVER_ASSET_DECIMALS),
        resource: resourceUrl,
        serverWalletAddress: SERVER_WALLET_ADDRESS,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Facilitator settle failed:", resp.status, errText);

      // Fallback: try verify-only mode if settle fails
      return await verifyPayment(paymentHeader, expectedAmount);
    }

    const result = await resp.json();
    return {
      settled: result.success === true || result.settled === true || result.isValid === true,
      txHash: result.txHash || result.transactionHash || paymentData.txHash,
    };
  } catch (err) {
    console.error("Settlement error:", err);
    // Fallback to verify mode
    return await verifyPayment(paymentHeader, expectedAmount);
  }
}

/**
 * Fallback: verify-only mode (no server wallet needed).
 */
async function verifyPayment(
  paymentHeader: string,
  expectedAmount: number,
): Promise<{ settled: boolean; txHash?: string } | null> {
  try {
    const paymentData = JSON.parse(paymentHeader);

    const resp = await fetch("https://x402.thirdweb.com/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-secret-key": THIRDWEB_SECRET_KEY,
        "x-vault-access-token": VAULT_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        paymentData,
        payTo: PAY_TO,
        network: `eip155:${RECEIVER_CHAIN_ID}`,
        asset: RECEIVER_ASSET,
        maxAmountRequired: String(expectedAmount * 10 ** RECEIVER_ASSET_DECIMALS),
      }),
    });

    if (!resp.ok) {
      console.error("Facilitator verify failed:", resp.status, await resp.text());
      return null;
    }

    const result = await resp.json();
    return {
      settled: result.isValid === true || result.settled === true,
      txHash: result.txHash || result.transactionHash || paymentData.txHash,
    };
  } catch (err) {
    console.error("Payment verification error:", err);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let planKey = "monthly";
    let walletAddress = "";

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      planKey = body.planKey || body.plan || "monthly";
      walletAddress = body.walletAddress || body.addr || "";
    }

    const plan = VIP_PLANS[planKey];
    if (!plan) {
      return new Response(JSON.stringify({ error: "Invalid plan" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Check for x402 payment header (v2: PAYMENT-SIGNATURE, v1: x-payment) ──
    const paymentHeader = req.headers.get("payment-signature") || req.headers.get("x-payment");

    if (!paymentHeader) {
      return buildPaymentRequired(plan.price, planKey);
    }

    // ── Settle payment via server wallet ──
    const resourceUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/vip-subscribe`;
    const verification = SERVER_WALLET_ADDRESS
      ? await settlePayment(paymentHeader, plan.price, resourceUrl)
      : await verifyPayment(paymentHeader, plan.price);

    if (!verification || !verification.settled) {
      return new Response(
        JSON.stringify({ error: "Payment verification failed" }),
        {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ── Payment verified — activate VIP ──
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase.rpc("subscribe_vip", {
      addr: walletAddress,
      tx_hash: verification.txHash || null,
      plan_label: plan.label,
    });

    if (error) {
      console.error("subscribe_vip error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        profile: data,
        txHash: verification.txHash,
        plan: planKey,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "X-Payment-Response": JSON.stringify({
            success: true,
            txHash: verification.txHash,
          }),
        },
      },
    );
  } catch (err) {
    console.error("vip-subscribe error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
