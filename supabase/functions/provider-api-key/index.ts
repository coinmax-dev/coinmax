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
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return jsonResp({ error: "Unauthorized" }, 401);

  const oldHashed = await hashKey(auth.slice(7));

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: provider, error: pErr } = await supabase
    .from("strategy_providers")
    .select("id, name, status")
    .eq("api_key", oldHashed)
    .single();

  if (pErr || !provider) return jsonResp({ error: "Invalid API key" }, 401);

  try {
    const body = await req.json();
    if (body.action !== "rotate") {
      return jsonResp({ error: "Only action 'rotate' is supported" }, 400);
    }
  } catch {
    return jsonResp({ error: "Body must be JSON with { action: 'rotate' }" }, 400);
  }

  // Generate new key
  const rawBytes = new Uint8Array(36);
  crypto.getRandomValues(rawBytes);
  const newRawKey = "sp_" + Array.from(rawBytes).map(b => b.toString(16).padStart(2, "0")).join("");
  const newHashed = await hashKey(newRawKey);
  const newPrefix = newRawKey.slice(0, 11);

  const { error: updateErr } = await supabase
    .from("strategy_providers")
    .update({
      api_key: newHashed,
      api_key_prefix: newPrefix,
      updated_at: new Date().toISOString(),
    })
    .eq("id", provider.id);

  if (updateErr) return jsonResp({ error: updateErr.message }, 500);

  return jsonResp({
    status: "ok",
    provider_name: provider.name,
    new_api_key: newRawKey,
    api_key_note: "Old key is now invalid. Save this new key — it will NOT be shown again.",
  });
});
