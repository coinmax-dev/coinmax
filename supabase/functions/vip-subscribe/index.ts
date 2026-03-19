import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-payment",
  "Access-Control-Expose-Headers": "x-payment-response",
};

// ── x402 payment config ─────────────────────────────────────
// Receiver: Arbitrum USDC — thirdweb facilitator handles cross-chain bridge
const PAY_TO = Deno.env.get("VIP_RECEIVER_ADDRESS") || "";
const RECEIVER_CHAIN_ID = 42161; // Arbitrum One
const RECEIVER_ASSET = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"; // USDC on Arbitrum (native)
const RECEIVER_ASSET_DECIMALS = 6;

const VIP_PLANS: Record<string, { price: number; days: number; label: string }> = {
  monthly:  { price: 49,  days: 30,  label: "monthly" },
  halfyear: { price: 149, days: 180, label: "halfyear" },
};

// ── Facilitator verification ─────────────────────────────────
const THIRDWEB_SECRET_KEY = Deno.env.get("THIRDWEB_SECRET_KEY") || "";

/**
 * Build the 402 Payment Required response per x402 spec.
 * The client (thirdweb SDK) reads these headers and prompts the user to sign.
 */
function buildPaymentRequired(priceUsd: number, planKey: string) {
  // x402 payment requirements — receiver is on Arbitrum USDC
  // thirdweb facilitator handles cross-chain: user pays BSC USDT → bridge → Arb USDC
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
 * Verify x402 payment via thirdweb facilitator.
 * Returns the settlement result or null if verification fails.
 */
async function verifyPayment(
  paymentHeader: string,
  expectedAmount: number,
): Promise<{ settled: boolean; txHash?: string } | null> {
  try {
    // Decode the payment payload from the client
    const paymentData = JSON.parse(paymentHeader);

    // Verify via thirdweb facilitator API
    const resp = await fetch("https://x402.thirdweb.com/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-secret-key": THIRDWEB_SECRET_KEY,
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
    // Parse plan from body or URL
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

    // ── Check for x402 payment header ──
    const paymentHeader = req.headers.get("x-payment");

    if (!paymentHeader) {
      // No payment yet — return 402 with payment requirements
      return buildPaymentRequired(plan.price, planKey);
    }

    // ── Verify payment ──
    const verification = await verifyPayment(paymentHeader, plan.price);

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
