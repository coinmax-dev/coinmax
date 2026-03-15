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

  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return jsonResp({ error: "Unauthorized" }, 401);

  const hashed = await hashKey(auth.slice(7));

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: provider, error: pErr } = await supabase
    .from("strategy_providers")
    .select("id, status")
    .eq("api_key", hashed)
    .single();

  if (pErr || !provider) return jsonResp({ error: "Invalid API key" }, 401);
  if (provider.status === "suspended" || provider.status === "rejected") {
    return jsonResp({ error: `Provider is ${provider.status}` }, 403);
  }

  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
  const asset = url.searchParams.get("asset");
  const status = url.searchParams.get("status");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let query = supabase
    .from("trade_signals")
    .select("*", { count: "exact" })
    .eq("provider_id", provider.id)
    .order("created_at", { ascending: false });

  if (asset) query = query.eq("asset", asset);
  if (status) query = query.eq("status", status);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  const offset = (page - 1) * limit;
  query = query.range(offset, offset + limit - 1);

  const { data: signals, error, count } = await query;

  if (error) return jsonResp({ error: error.message }, 500);

  return jsonResp({
    signals: signals || [],
    total: count ?? 0,
    page,
    limit,
    total_pages: Math.ceil((count ?? 0) / limit),
  });
});
