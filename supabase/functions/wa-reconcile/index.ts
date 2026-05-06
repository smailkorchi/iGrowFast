// @ts-nocheck
// ╔══════════════════════════════════════════════════════════════════════╗
// ║  wa-reconcile                                                         ║
// ║                                                                       ║
// ║  Nightly cron + on-demand. For every connected wa_instance:           ║
// ║   1. Compare Evolution's message count vs ours.                       ║
// ║   2. If diff > 1% OR > 50 absolute → trigger evolution-sync-v2 with   ║
// ║      kind=delta to backfill from MAX(received_at)-1h forward.         ║
// ║                                                                       ║
// ║  Self-healing: catches anything webhook + worker missed.              ║
// ╚══════════════════════════════════════════════════════════════════════╝

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EVO_URL = Deno.env.get("EVO_API_URL") ?? "";
const EVO_KEY = Deno.env.get("EVO_API_KEY") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const report: any[] = [];

  // 1) Pull all wa_instances that are open
  const { data: insts } = await supabase.from("wa_instances")
    .select("id, business_id, name, status, last_event_at")
    .in("status", ["open"]);

  for (const inst of insts ?? []) {
    try {
      // Evolution side count
      const evoRes = await fetch(`${EVO_URL}/instance/fetchInstances?instanceName=${inst.name}`, {
        headers: { apikey: EVO_KEY },
      });
      const evoData = await evoRes.json();
      const evoMsgs: number = (Array.isArray(evoData) ? evoData[0] : evoData)?._count?.Message ?? 0;

      // Our side count
      const { count: ourMsgs } = await supabase.from("wa_messages")
        .select("*", { head: true, count: "exact" })
        .eq("instance_id", inst.id);

      const diff = evoMsgs - (ourMsgs ?? 0);
      const driftPct = evoMsgs ? (diff / evoMsgs) * 100 : 0;
      const needsResync = diff > 50 || (driftPct > 1 && diff > 0);

      report.push({
        name: inst.name, evo: evoMsgs, ours: ourMsgs, diff,
        drift_pct: driftPct.toFixed(2),
        needs_resync: needsResync,
      });

      if (needsResync) {
        // Avoid duplicate sync jobs
        const { data: active } = await supabase.from("wa_sync_jobs")
          .select("id").eq("instance_id", inst.id)
          .in("status", ["pending","running","paused"]).maybeSingle();
        if (active) continue;

        // Trigger delta sync
        const url = Deno.env.get("SUPABASE_URL")!;
        const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        await fetch(`${url}/functions/v1/evolution-sync-v2`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            action: "start",
            instance_id: inst.id,
            business_id: inst.business_id,
            kind: "reconcile",
            kinds: ["chats","messages"],
          }),
        }).catch(e => console.error("trigger sync:", e));
      }
    } catch (e: any) {
      report.push({ name: inst.name, error: String(e.message ?? e) });
    }
  }

  return new Response(JSON.stringify({ ok: true, report }, null, 2), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
});
