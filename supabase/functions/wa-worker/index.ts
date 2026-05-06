// @ts-nocheck
// ╔══════════════════════════════════════════════════════════════════════╗
// ║  wa-worker                                                            ║
// ║                                                                       ║
// ║  Drains the wa_webhook_events queue. Triggered by:                    ║
// ║    1. The webhook (fire-and-forget after enqueue), OR                 ║
// ║    2. A pg_cron job every 30 s as a safety net.                       ║
// ║                                                                       ║
// ║  For each unprocessed event:                                          ║
// ║    - Call wa_dispatch_event(instance_name, event_type, payload).      ║
// ║    - On success → set processed_at = now().                           ║
// ║    - On failure → bump retry_count, set processing_error,             ║
// ║      schedule next_retry_at with exponential backoff.                 ║
// ║    - After max_retries, leave processed_at NULL but stop trying;      ║
// ║      these surface in monitoring as "dead-letter".                    ║
// ║                                                                       ║
// ║  Concurrency-safe via SELECT … FOR UPDATE SKIP LOCKED.                ║
// ╚══════════════════════════════════════════════════════════════════════╝

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 120s edge runtime budget; reserve 10s for response.
const MAX_RUN_MS = 110_000;
// Per batch
const BATCH_SIZE = 25;

function backoffSeconds(retryCount: number): number {
  // 5s, 15s, 60s, 5m, 30m
  const ladder = [5, 15, 60, 300, 1800];
  return ladder[Math.min(retryCount, ladder.length - 1)];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let processed = 0;
  let failed = 0;

  while (Date.now() - start < MAX_RUN_MS) {
    // Lock-and-grab a batch of pending events.
    // Postgres `FOR UPDATE SKIP LOCKED` lets multiple workers run safely.
    const { data: rows, error: selErr } = await supabase.rpc("wa_worker_claim_batch", {
      p_batch_size: BATCH_SIZE,
    });
    if (selErr) {
      console.error("claim error:", selErr);
      break;
    }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      try {
        const { error: dispErr } = await supabase.rpc("wa_dispatch_event", {
          p_evo_instance_name: row.evo_instance_name,
          p_event_type:        row.event_type,
          p_payload:           row.payload?.data ?? row.payload,
        });
        if (dispErr) throw new Error(dispErr.message);

        await supabase.from("wa_webhook_events")
          .update({ processed_at: new Date().toISOString(), processing_error: null })
          .eq("id", row.id);
        processed++;
      } catch (err: any) {
        failed++;
        const nextRetry = row.retry_count + 1 < row.max_retries
          ? new Date(Date.now() + backoffSeconds(row.retry_count) * 1000).toISOString()
          : null;
        await supabase.from("wa_webhook_events")
          .update({
            retry_count: row.retry_count + 1,
            processing_error: String(err?.message ?? err).slice(0, 4000),
            next_retry_at: nextRetry,
          })
          .eq("id", row.id);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, processed, failed, ms: Date.now() - start }), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
});
