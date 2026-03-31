/**
 * Bridge Webhook — Receives thirdweb Bridge status updates
 *
 * URL: https://enedbksmftcgtszrkppc.supabase.co/functions/v1/bridge-webhook
 *
 * thirdweb sends POST with bridge status:
 *   - PENDING: bridge initiated
 *   - COMPLETED: funds arrived on destination chain
 *   - FAILED: bridge failed
 *
 * On COMPLETED:
 *   1. Update bridge_cycles status
 *   2. Record fees
 *   3. If hl_deposit_enabled: trigger HL deposit (30% of bridged amount)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const {
      id,
      status,
      originChainId,
      destinationChainId,
      originTokenAddress,
      destinationTokenAddress,
      originAmount,
      destinationAmount,
      sender,
      receiver,
      transactionHash,
      transactions,
      fees,
    } = body;

    console.log("Bridge webhook:", status, "| from:", originChainId, "→", destinationChainId, "| amount:", originAmount);

    // Calculate fee
    const originUsd = Number(originAmount || 0) / 1e18;
    const destUsd = Number(destinationAmount || 0) / (destinationChainId === 42161 ? 1e6 : 1e18); // ARB USDT = 6 decimals
    const bridgeFee = originUsd - destUsd;

    // Record/update bridge cycle
    if (status === "COMPLETED") {
      // Update existing BRIDGING cycle or insert new
      const { data: existing } = await supabase
        .from("bridge_cycles")
        .select("id")
        .eq("status", "BRIDGING")
        .order("started_at", { ascending: false })
        .limit(1)
        .single();

      if (existing) {
        await supabase.from("bridge_cycles").update({
          status: "COMPLETED",
          amount_usd: originUsd,
          fees_usd: bridgeFee > 0 ? bridgeFee : 0,
          arb_tx: transactionHash || transactions?.[transactions.length - 1]?.hash,
          completed_at: new Date().toISOString(),
          details: {
            webhook: body,
            originAmount: originUsd,
            destinationAmount: destUsd,
            fee: bridgeFee,
          },
        }).eq("id", existing.id);
      } else {
        await supabase.from("bridge_cycles").insert({
          cycle_type: "BRIDGE_WEBHOOK",
          status: "COMPLETED",
          amount_usd: originUsd,
          fees_usd: bridgeFee > 0 ? bridgeFee : 0,
          arb_tx: transactionHash,
          initiated_by: "webhook",
          completed_at: new Date().toISOString(),
          details: {
            webhook: body,
            originAmount: originUsd,
            destinationAmount: destUsd,
            fee: bridgeFee,
          },
        });
      }

      // Record fee transaction
      if (bridgeFee > 0) {
        await supabase.from("transactions").insert({
          user_id: null,
          type: "BRIDGE",
          token: "USDT",
          amount: bridgeFee,
          status: "COMPLETED",
          tx_hash: transactionHash || `bridge_fee_${Date.now()}`,
          details: {
            type: "bridge_fee",
            from: originChainId,
            to: destinationChainId,
            originAmount: originUsd,
            destinationAmount: destUsd,
            fee: bridgeFee,
          },
        });
      }

      // Auto HL deposit if enabled
      const { data: hlSwitch } = await supabase
        .from("system_config")
        .select("value")
        .eq("key", "hl_deposit_enabled")
        .single();

      const { data: hlRatio } = await supabase
        .from("system_config")
        .select("value")
        .eq("key", "hl_deposit_ratio")
        .single();

      if (hlSwitch?.value === "true") {
        const ratio = parseFloat(hlRatio?.value || "0.30");
        const hlAmount = destUsd * ratio;

        if (hlAmount > 10) { // min $10 to HL
          try {
            const hlRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/hl-treasury`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              },
              body: JSON.stringify({ action: "deposit", amount: hlAmount }),
            });
            const hlData = await hlRes.json();

            await supabase.from("bridge_cycles").insert({
              cycle_type: "HL_AUTO_DEPOSIT",
              status: hlData.success ? "COMPLETED" : "FAILED",
              amount_usd: hlAmount,
              initiated_by: "webhook_auto",
              hl_tx: hlData.txHash || null,
              details: { ratio, sourceAmount: destUsd, hlResult: hlData },
            });
          } catch (e: any) {
            console.error("HL auto-deposit failed:", e.message);
          }
        }
      }

    } else if (status === "FAILED") {
      // Update cycle as failed
      const { data: existing } = await supabase
        .from("bridge_cycles")
        .select("id")
        .eq("status", "BRIDGING")
        .order("started_at", { ascending: false })
        .limit(1)
        .single();

      if (existing) {
        await supabase.from("bridge_cycles").update({
          status: "FAILED",
          error_message: body.error || "Bridge failed",
          details: { webhook: body },
        }).eq("id", existing.id);
      }
    }

    // Always record raw webhook
    await supabase.from("treasury_events").insert({
      event_type: "BRIDGE_WEBHOOK",
      details: { status, originChainId, destinationChainId, originAmount, destinationAmount, transactionHash, fees: body.fees },
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error("bridge-webhook error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
