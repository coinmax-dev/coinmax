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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const { name, contact_email, description, website, allowed_assets } = body;

    if (!name || !contact_email) {
      return jsonResp({ error: "name and contact_email are required" }, 400);
    }

    // Generate slug
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);

    // Generate raw API key
    const rawBytes = new Uint8Array(36);
    crypto.getRandomValues(rawBytes);
    const rawKey = "sp_" + Array.from(rawBytes).map(b => b.toString(16).padStart(2, "0")).join("");

    // SHA-256 hash for storage
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(rawKey));
    const hashedKey = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

    const prefix = rawKey.slice(0, 11); // "sp_" + 8 chars

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data, error } = await supabase
      .from("strategy_providers")
      .insert({
        name,
        slug,
        contact_email,
        description: description || "",
        website: website || "",
        api_key: hashedKey,
        api_key_prefix: prefix,
        allowed_assets: allowed_assets || ["BTC", "ETH", "SOL", "BNB"],
        status: "pending",
      })
      .select("id, name, slug, status, created_at")
      .single();

    if (error) {
      if (error.message.includes("duplicate")) {
        return jsonResp({ error: "Provider name already exists" }, 409);
      }
      return jsonResp({ error: error.message }, 500);
    }

    return jsonResp({
      provider_id: data.id,
      name: data.name,
      slug: data.slug,
      status: data.status,
      api_key: rawKey,
      api_key_note: "Save this key — it will NOT be shown again.",
    });
  } catch (e: any) {
    return jsonResp({ error: e.message || "Invalid request" }, 400);
  }
});
