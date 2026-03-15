import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function hashKey(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return jsonResp({ error: "Method not allowed" }, 405);

  // Authenticate via Bearer token
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return jsonResp({ error: "Unauthorized" }, 401);

  const rawKey = auth.slice(7);
  const hashed = await hashKey(rawKey);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // Look up provider
  const { data: provider, error } = await supabase
    .from("strategy_providers")
    .select("*")
    .eq("api_key", hashed)
    .single();

  if (error || !provider) return jsonResp({ error: "Invalid API key" }, 401);
  if (provider.status !== "approved" && provider.status !== "pending") {
    return jsonResp({ error: `Provider is ${provider.status}` }, 403);
  }

  const url = new URL(req.url);
  const detailed = url.searchParams.get("detailed") === "true";

  const winRate = provider.total_signals > 0
    ? ((provider.win_count / provider.total_signals) * 100).toFixed(1)
    : "0.0";

  const result: any = {
    provider: {
      id: provider.id,
      name: provider.name,
      slug: provider.slug,
      status: provider.status,
      allowed_assets: provider.allowed_assets,
      max_leverage: provider.max_leverage,
      created_at: provider.created_at,
    },
    stats: {
      total_signals: provider.total_signals,
      win_count: provider.win_count,
      loss_count: provider.loss_count,
      win_rate: winRate,
      total_pnl: provider.total_pnl,
      avg_confidence: provider.avg_confidence,
      last_signal_at: provider.last_signal_at,
    },
  };

  if (detailed) {
    const { data: signals } = await supabase
      .from("trade_signals")
      .select("id, asset, action, direction, confidence, strength, leverage, status, result_pnl, created_at")
      .eq("provider_id", provider.id)
      .order("created_at", { ascending: false })
      .limit(20);

    result.recent_signals = signals || [];
  }

  return jsonResp(result);
});
