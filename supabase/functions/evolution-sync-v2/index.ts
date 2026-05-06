// @ts-nocheck
// ╔══════════════════════════════════════════════════════════════════════╗
// ║  evolution-sync-v2                                                    ║
// ║                                                                       ║
// ║  Pulls bulk data from Evolution API and feeds it through the SAME     ║
// ║  ingest pipeline that the live webhook uses (wa_dispatch_event).      ║
// ║  Therefore: no schema drift, no parallel logic, idempotent across     ║
// ║  webhook/sync/manual runs.                                            ║
// ║                                                                       ║
// ║  Phases (all optional via `kinds` param):                             ║
// ║    contacts  — POST /chat/findContacts                                ║
// ║    chats     — POST /chat/findChats                                   ║
// ║    groups    — GET  /group/fetchAllGroups?getParticipants=true        ║
// ║    labels    — GET  /label/findLabels                                 ║
// ║    messages  — POST /chat/findMessages per chat (paginated)           ║
// ║                                                                       ║
// ║  Resumable via wa_sync_jobs.phase_cursor jsonb.                       ║
// ║  Yields cleanly when 110s elapsed and self-chains.                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EVO_URL = Deno.env.get("EVO_API_URL") ?? "";
const EVO_KEY = Deno.env.get("EVO_API_KEY") ?? "";
const TIME_BUDGET_MS = 110_000;

async function evo<T = any>(path: string, method = "GET", body: unknown = null): Promise<T> {
  const res = await fetch(`${EVO_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", apikey: EVO_KEY },
    body: body ? JSON.stringify(body) : null,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Evo ${method} ${path} → ${res.status}: ${text.slice(0,300)}`);
  try { return text ? JSON.parse(text) : ({} as T); } catch { return text as any; }
}

function shouldYield(start: number): boolean {
  return Date.now() - start > TIME_BUDGET_MS;
}

async function dispatch(supabase: any, instanceName: string, eventType: string, payload: any) {
  const { error } = await supabase.rpc("wa_dispatch_event", {
    p_evo_instance_name: instanceName,
    p_event_type: eventType,
    p_payload: payload,
  });
  if (error) throw new Error(`dispatch ${eventType}: ${error.message}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let body: any = {};
  try { body = await req.json(); } catch {}

  const action: string = body.action ?? "start";

  // ── action: start ──────────────────────────────────────────────────
  if (action === "start") {
    const { instance_id, business_id, kinds } = body;
    if (!instance_id || !business_id) {
      return new Response(JSON.stringify({ error: "instance_id+business_id required" }), { status: 200, headers: cors });
    }
    // Refuse if a job is already active for this instance
    const { data: existing } = await supabase.from("wa_sync_jobs")
      .select("id, status").eq("instance_id", instance_id)
      .in("status", ["pending","running","paused"]).maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ resumed: existing.id }), { status: 200, headers: cors });
    }
    const { data: newJob } = await supabase.from("wa_sync_jobs").insert({
      business_id, instance_id, kind: body.kind ?? "full",
      status: "running", current_phase: "contacts",
      started_at: new Date().toISOString(),
      metadata: { kinds: kinds ?? ["contacts","chats","groups","labels","messages"] },
    }).select("*").single();

    EdgeRuntime?.waitUntil?.(runJob(supabase, newJob).catch(e => console.error("runJob:", e)));
    return new Response(JSON.stringify({ job_id: newJob.id }), { status: 200, headers: cors });
  }

  // ── action: continue (self-chain) ──────────────────────────────────
  if (action === "continue") {
    const { data: job } = await supabase.from("wa_sync_jobs").select("*").eq("id", body.job_id).single();
    if (!job || job.status === "cancelled" || job.status === "completed") {
      return new Response(JSON.stringify({ status: job?.status ?? "missing" }), { status: 200, headers: cors });
    }
    EdgeRuntime?.waitUntil?.(runJob(supabase, job).catch(e => console.error("runJob:", e)));
    return new Response(JSON.stringify({ continued: true }), { status: 200, headers: cors });
  }

  // ── action: cancel ─────────────────────────────────────────────────
  if (action === "cancel") {
    await supabase.from("wa_sync_jobs").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", body.job_id);
    return new Response(JSON.stringify({ cancelled: true }), { status: 200, headers: cors });
  }

  return new Response(JSON.stringify({ error: `unknown action ${action}` }), { status: 200, headers: cors });

  // ─────────────────────────────────────────────────────────────────────
  async function runJob(sb: any, job: any) {
    const inst = await sb.from("wa_instances").select("id, name").eq("id", job.instance_id).single();
    if (!inst.data) return;
    const instName = inst.data.name;
    const kinds: string[] = job.metadata?.kinds ?? ["contacts","chats","groups","labels","messages"];
    const cursor = job.phase_cursor ?? {};

    try {
      // 1) contacts
      if (kinds.includes("contacts") && (cursor.contacts_done !== true)) {
        await sb.from("wa_sync_jobs").update({ current_phase: "contacts" }).eq("id", job.id);
        const contacts = await evo<any[]>(`/chat/findContacts/${instName}`, "POST", {});
        if (Array.isArray(contacts)) {
          for (const c of contacts) {
            if (shouldYield(start)) { await chain(sb, job.id, { ...cursor, contacts_partial: true }); return; }
            await dispatch(sb, instName, "contacts.upsert", c).catch(e => console.warn(e.message));
          }
        }
        cursor.contacts_done = true;
        await sb.from("wa_sync_jobs").update({ phase_cursor: cursor }).eq("id", job.id);
      }

      // 2) labels
      if (kinds.includes("labels") && (cursor.labels_done !== true)) {
        await sb.from("wa_sync_jobs").update({ current_phase: "labels" }).eq("id", job.id);
        const labels = await evo<any[]>(`/label/findLabels/${instName}`, "GET");
        if (Array.isArray(labels)) {
          for (const l of labels) await dispatch(sb, instName, "labels.edit", l).catch(e => console.warn(e.message));
        }
        cursor.labels_done = true;
        await sb.from("wa_sync_jobs").update({ phase_cursor: cursor }).eq("id", job.id);
      }

      // 3) groups (also seeds participants + chat-label associations)
      if (kinds.includes("groups") && (cursor.groups_done !== true)) {
        await sb.from("wa_sync_jobs").update({ current_phase: "groups" }).eq("id", job.id);
        const groups = await evo<any[]>(`/group/fetchAllGroups/${instName}?getParticipants=true`, "GET");
        if (Array.isArray(groups)) {
          for (const g of groups) {
            if (shouldYield(start)) { await chain(sb, job.id, cursor); return; }
            await dispatch(sb, instName, "groups.upsert", g).catch(e => console.warn(e.message));
          }
        }
        cursor.groups_done = true;
        await sb.from("wa_sync_jobs").update({ phase_cursor: cursor }).eq("id", job.id);
      }

      // 4) chats — drive the message-sync iteration
      if (kinds.includes("chats") && (cursor.chats_done !== true)) {
        await sb.from("wa_sync_jobs").update({ current_phase: "chats" }).eq("id", job.id);
        const chats = await evo<any[]>(`/chat/findChats/${instName}`, "POST", {});
        const chat_jids: string[] = (Array.isArray(chats) ? chats : [])
          .map((c: any) => c.remoteJid)
          .filter((j: string) => j && j !== "status@broadcast");
        cursor.chat_jids = chat_jids;
        cursor.chats_done = true;
        cursor.msg_chat_index = 0;
        cursor.msg_page = 1;
        await sb.from("wa_sync_jobs").update({ phase_cursor: cursor }).eq("id", job.id);
      }

      // 5) messages — paginate per chat, dispatch each as messages.upsert
      if (kinds.includes("messages")) {
        await sb.from("wa_sync_jobs").update({ current_phase: "messages" }).eq("id", job.id);
        const chat_jids: string[] = cursor.chat_jids ?? [];
        let ci = cursor.msg_chat_index ?? 0;
        let page = cursor.msg_page ?? 1;
        let synced = cursor.msg_synced ?? 0;

        while (ci < chat_jids.length) {
          if (shouldYield(start)) {
            await chain(sb, job.id, { ...cursor, msg_chat_index: ci, msg_page: page, msg_synced: synced });
            return;
          }
          const jid = chat_jids[ci];
          const isGroup = jid.endsWith("@g.us");
          const maxPages = isGroup ? 3 : 999;

          let hasMore = true;
          while (hasMore && page <= maxPages && !shouldYield(start)) {
            const data = await evo<any>(`/chat/findMessages/${instName}`, "POST", {
              where: { key: { remoteJid: jid } },
              limit: 100, page,
            }).catch(() => ({ messages: { records: [] }, pages: 1 }));

            const records: any[] = data?.messages?.records ?? data?.records ?? [];
            const totalPages: number = data?.messages?.pages ?? 1;
            if (records.length === 0) { hasMore = false; break; }

            for (const rec of records) {
              await dispatch(sb, instName, "messages.upsert", rec).catch(e => console.warn(e.message));
              synced++;
            }
            hasMore = page < totalPages;
            page++;
          }

          ci++;
          page = 1;
          if (ci % 20 === 0) {
            await sb.from("wa_sync_jobs").update({
              phase_cursor: { ...cursor, msg_chat_index: ci, msg_page: 1, msg_synced: synced },
              metadata: { ...job.metadata, msg_synced: synced },
            }).eq("id", job.id);
          }
        }

        cursor.msg_chat_index = ci;
        cursor.msg_synced = synced;
        await sb.from("wa_sync_jobs").update({ phase_cursor: cursor }).eq("id", job.id);
      }

      await sb.from("wa_sync_jobs").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        current_phase: null,
      }).eq("id", job.id);
    } catch (e: any) {
      console.error("sync error:", e);
      await sb.from("wa_sync_jobs").update({
        status: "failed",
        error_message: String(e.message ?? e).slice(0,4000),
        retry_count: job.retry_count + 1,
      }).eq("id", job.id);
    }
  }

  async function chain(sb: any, job_id: string, cursor: any) {
    await sb.from("wa_sync_jobs").update({ phase_cursor: cursor }).eq("id", job_id);
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    fetch(`${url}/functions/v1/evolution-sync-v2`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ action: "continue", job_id }),
    }).catch(e => console.error("chain:", e));
  }
});
