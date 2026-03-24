import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * Activate VIP Trial — 7 days free trial for copy trading
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { wallet } = await req.json();
    if (!wallet) {
      return new Response(JSON.stringify({ error: "Missing wallet" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Check if trial already used
    const { data: profile, error: fetchErr } = await supabase
      .from("profiles")
      .select("is_vip, vip_expires_at, vip_trial_used")
      .eq("wallet_address", wallet)
      .single();

    if (fetchErr || !profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (profile.vip_trial_used) {
      return new Response(JSON.stringify({ error: "免费试用已使用过" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Already VIP
    if (profile.is_vip && profile.vip_expires_at && new Date(profile.vip_expires_at) > new Date()) {
      return new Response(JSON.stringify({ error: "已经是VIP" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Activate 7-day trial
    const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: updateErr } = await supabase
      .from("profiles")
      .update({
        is_vip: true,
        vip_expires_at: trialEnd,
        vip_trial_used: true,
      })
      .eq("wallet_address", wallet);

    if (updateErr) {
      return new Response(JSON.stringify({ error: updateErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      vip_expires_at: trialEnd,
      message: "7天免费VIP已激活",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
