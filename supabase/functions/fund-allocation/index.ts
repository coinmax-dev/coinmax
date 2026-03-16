/**
 * Fund Allocation Edge Function
 *
 * Manages the 50% principal that comes back from ProtocolTreasury.
 * All allocation is tracked in database, actual transfers done by platform.
 *
 * Actions:
 *   1. record:     Record incoming funds from treasury (50% principal)
 *   2. allocate:   Allocate funds to categories (ops, reserve, marketing, etc.)
 *   3. transfer:   Mark allocation as transferred (after platform sends on-chain)
 *   4. config:     Get/set allocation ratios
 *   5. stats:      Get fund allocation overview
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Default allocation ratios (can be changed via config action)
const DEFAULT_ALLOCATION = {
  operations: 4000,   // 40% of the 50% = 20% total
  reserve: 2000,      // 20% of the 50% = 10% total
  marketing: 2000,    // 20% of the 50% = 10% total
  development: 1000,  // 10% of the 50% = 5% total
  insurance: 1000,    // 10% of the 50% = 5% total
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
    const { action } = body;

    switch (action) {
      // ── 1. Record incoming principal from treasury ────────────
      case "record": {
        const { amount, txHash, source } = body;
        if (!amount || amount <= 0) {
          return jsonResponse({ error: "amount required" }, 400);
        }

        const { data, error } = await supabase.from("fund_allocations").insert({
          total_amount: amount,
          source: source || "treasury_50pct",
          tx_hash: txHash || null,
          status: "PENDING",
        }).select().single();

        if (error) return jsonResponse({ error: error.message }, 500);

        await supabase.from("treasury_events").insert({
          event_type: "PRINCIPAL_RECEIVED",
          details: { allocation_id: data.id, amount, source },
        });

        return jsonResponse({ success: true, allocationId: data.id, amount });
      }

      // ── 2. Allocate to categories ─────────────────────────────
      case "allocate": {
        const { allocationId } = body;
        if (!allocationId) return jsonResponse({ error: "allocationId required" }, 400);

        // Get allocation record
        const { data: allocation, error: allocErr } = await supabase
          .from("fund_allocations")
          .select("*")
          .eq("id", allocationId)
          .single();

        if (allocErr || !allocation) {
          return jsonResponse({ error: "Allocation not found" }, 404);
        }

        if (allocation.status !== "PENDING") {
          return jsonResponse({ error: "Already allocated" }, 400);
        }

        // Get config or use defaults
        const { data: configRow } = await supabase
          .from("system_config")
          .select("value")
          .eq("key", "FUND_ALLOCATION_RATIOS")
          .single();

        const ratios = configRow?.value
          ? (typeof configRow.value === "string" ? JSON.parse(configRow.value) : configRow.value)
          : DEFAULT_ALLOCATION;

        const totalBps = Object.values(ratios).reduce((s: number, v: any) => s + Number(v), 0);
        if (totalBps !== 10000) {
          return jsonResponse({ error: `Ratios must sum to 10000, got ${totalBps}` }, 400);
        }

        // Create allocation items
        const items = Object.entries(ratios).map(([category, bps]) => ({
          allocation_id: allocationId,
          category,
          bps: Number(bps),
          amount: Math.floor((allocation.total_amount * Number(bps)) / 10000 * 100) / 100,
          status: "ALLOCATED",
        }));

        const { error: itemErr } = await supabase
          .from("fund_allocation_items")
          .insert(items);

        if (itemErr) return jsonResponse({ error: itemErr.message }, 500);

        // Update allocation status
        await supabase.from("fund_allocations")
          .update({ status: "ALLOCATED", allocated_at: new Date().toISOString() })
          .eq("id", allocationId);

        await supabase.from("treasury_events").insert({
          event_type: "PRINCIPAL_ALLOCATED",
          details: { allocation_id: allocationId, items },
        });

        return jsonResponse({ success: true, allocationId, items });
      }

      // ── 3. Mark as transferred ────────────────────────────────
      case "transfer": {
        const { itemId, txHash } = body;
        if (!itemId) return jsonResponse({ error: "itemId required" }, 400);

        await supabase.from("fund_allocation_items")
          .update({
            status: "TRANSFERRED",
            tx_hash: txHash || null,
            transferred_at: new Date().toISOString(),
          })
          .eq("id", itemId);

        return jsonResponse({ success: true, itemId });
      }

      // ── 4. Config: get/set allocation ratios ──────────────────
      case "config": {
        const { ratios } = body;

        if (ratios) {
          // Set new ratios
          const totalBps = Object.values(ratios).reduce((s: number, v: any) => s + Number(v), 0);
          if (totalBps !== 10000) {
            return jsonResponse({ error: `Must sum to 10000, got ${totalBps}` }, 400);
          }

          await supabase.from("system_config").upsert({
            key: "FUND_ALLOCATION_RATIOS",
            value: JSON.stringify(ratios),
          }, { onConflict: "key" });

          return jsonResponse({ success: true, ratios });
        }

        // Get current ratios
        const { data: configRow } = await supabase
          .from("system_config")
          .select("value")
          .eq("key", "FUND_ALLOCATION_RATIOS")
          .single();

        const current = configRow?.value
          ? (typeof configRow.value === "string" ? JSON.parse(configRow.value) : configRow.value)
          : DEFAULT_ALLOCATION;

        return jsonResponse({ ratios: current });
      }

      // ── 5. Stats ──────────────────────────────────────────────
      case "stats": {
        const { data: allocations } = await supabase
          .from("fund_allocations")
          .select("id, total_amount, status, source, created_at")
          .order("created_at", { ascending: false })
          .limit(20);

        const { data: items } = await supabase
          .from("fund_allocation_items")
          .select("category, amount, status")
          .order("created_at", { ascending: false })
          .limit(100);

        // Sum by category
        const byCat: Record<string, { allocated: number; transferred: number }> = {};
        for (const item of (items || [])) {
          if (!byCat[item.category]) byCat[item.category] = { allocated: 0, transferred: 0 };
          byCat[item.category].allocated += item.amount;
          if (item.status === "TRANSFERRED") byCat[item.category].transferred += item.amount;
        }

        const totalAllocated = (allocations || []).reduce((s, a) => s + a.total_amount, 0);

        return jsonResponse({
          totalAllocated,
          recentAllocations: allocations,
          byCategory: byCat,
        });
      }

      default:
        return jsonResponse({ error: "Invalid action. Use: record, allocate, transfer, config, stats" }, 400);
    }
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500);
  }
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
