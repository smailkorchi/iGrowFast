// @ts-nocheck
// ╔══════════════════════════════════════════════════════════════════════╗
// ║  wa-instance-watchdog                                                ║
// ║                                                                       ║
// ║  Connection-state reconciler. Source of truth = Evolution's          ║
// ║  /instance/connectionState. The DB column wa_instances.status is     ║
// ║  treated as a CACHE — this function rebuilds it from Evolution every ║
// ║  minute (cron) and on demand.                                         ║
// ║                                                                       ║
// ║  Why this exists:                                                     ║
// ║   - Webhooks can drop. CONNECTION_UPDATE events sometimes never      ║
// ║     arrive (Evolution restart, Supabase function cold start, etc),   ║
// ║     leaving wa_instances.status frozen at a wrong value indefinitely.║
// ║   - The previous-only watchdog (`wa_detect_silent_instances`) just   ║
// ║     flagged silence — it had no way to verify whether the socket     ║
// ║     was actually live. Result: dashboard lied for hours.              ║
// ║   - "Scan QR" returns "already connected or QR unavailable" when     ║
// ║     Evolution holds a zombie socket. Owner is stuck. We need active  ║
// ║     recovery (logout + reconnect) to break the deadlock.             ║
// ║                                                                       ║
// ║  What it does for each wa_instance:                                  ║
// ║   1. GET /instance/connectionState/{name} from Evolution.            ║
// ║   2. Reconcile DB status = Evolution state.                          ║
// ║   3. SELF-HEAL: if status has been bad for >5 min OR caller passed   ║
// ║      force_recover=true, run logout → connect to spawn a fresh QR.   ║
// ║   4. AUDIT: write to audit_logs so the dashboard can show a banner.  ║
// ║                                                                       ║
// ║  Invocation:                                                          ║
// ║   - Cron: POST {} every minute                                        ║
// ║   - Manual: POST { instance_id: uuid, force_recover?: boolean }      ║
// ║                                                                       ║
// ║  Auth: service-role only (no JWT).                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EVO_URL = Deno.env.get("EVO_API_URL") ?? "";
const EVO_KEY = Deno.env.get("EVO_API_KEY") ?? "";

// How long an instance can be in disconnected/connecting before we trigger a
// hard recovery (logout + reconnect). Short enough that owners aren't stuck,
// long enough to absorb routine reconnect blips.
const STUCK_THRESHOLD_MS = 5 * 60 * 1000;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, error: "method not allowed" });

  if (!EVO_URL || !EVO_KEY) return json(500, { ok: false, error: "EVO_API_URL or EVO_API_KEY not configured" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body is fine for cron */ }
  const targetInstanceId: string | undefined = body?.instance_id;
  const forceRecover: boolean = body?.force_recover === true;

  // Pull instances. For cron run we touch ALL of them; manual run targets one.
  let q = supabase.from("wa_instances")
    .select("id, business_id, name, status, status_reason, status_changed_at, last_event_at");
  if (targetInstanceId) q = q.eq("id", targetInstanceId);
  const { data: instances, error: instErr } = await q;
  if (instErr) return json(500, { ok: false, error: `db: ${instErr.message}` });

  const report: any[] = [];

  // Process in series — keeps Evolution gentle and our DB writes ordered.
  // For SaaS scale (>50 instances) we'll move to bounded parallelism
  // (Promise.all in chunks of 10) once we hit that volume.
  for (const inst of instances ?? []) {
    const r: any = { id: inst.id, name: inst.name, was: inst.status };

    try {
      // ── 1. Ground-truth state from Evolution ────────────────────────
      const stateRes = await fetch(`${EVO_URL}/instance/connectionState/${inst.name}`, {
        headers: { apikey: EVO_KEY },
      });

      if (stateRes.status === 404) {
        // Instance was deleted on Evolution side. Owner must re-create.
        if (inst.status !== "disconnected" || inst.status_reason !== "deleted on evolution") {
          await supabase.from("wa_instances").update({
            status: "disconnected",
            status_reason: "deleted on evolution",
            status_changed_at: new Date().toISOString(),
          }).eq("id", inst.id);
          await audit(supabase, inst, "wa_instance.deleted_remote", { detail: "Evolution returned 404 — instance no longer exists." });
          r.action = "marked deleted-remote";
        } else {
          r.action = "still deleted-remote";
        }
        report.push(r);
        continue;
      }

      if (!stateRes.ok) {
        r.error = `evolution ${stateRes.status}`;
        report.push(r);
        continue;
      }

      const stateData = await stateRes.json().catch(() => null);
      // Evolution returns { instance: { instanceName, state } } in v2.
      const evoState: string = String(stateData?.instance?.state ?? stateData?.state ?? "").toLowerCase();
      const newStatus = evoState === "open"
        ? "open"
        : evoState === "connecting"
        ? "connecting"
        : "disconnected";
      r.evo_state = evoState;

      // ── 2. Reconcile DB ─────────────────────────────────────────────
      if (newStatus !== inst.status) {
        await supabase.from("wa_instances").update({
          status: newStatus,
          status_reason: `reconciled from evolution: ${evoState || "unknown"}`,
          status_changed_at: new Date().toISOString(),
          // last_event_at is NOT touched here — that field tracks message
          // ingestion, not connection state polling. Mixing them would mask
          // truly silent instances.
        }).eq("id", inst.id);
        r.action = `${inst.status} → ${newStatus}`;
        await audit(supabase, inst, "wa_instance.reconciled", { from: inst.status, to: newStatus });
      }

      // ── 3. Self-heal stuck connections ──────────────────────────────
      // Trigger when:
      //   - status is bad (anything but 'open') AND status_changed_at is old, OR
      //   - caller explicitly asked for recovery (owner clicked "Force re-pair")
      const ageMs = inst.status_changed_at
        ? Date.now() - new Date(inst.status_changed_at).getTime()
        : Number.MAX_SAFE_INTEGER;
      const isStuck = newStatus !== "open" && ageMs > STUCK_THRESHOLD_MS;

      if (isStuck || forceRecover) {
        const recovery = await recoverInstance(inst.name);
        r.action = (r.action ? r.action + "; " : "") + (recovery.ok ? "recovered (new QR)" : `recovery failed: ${recovery.error}`);
        r.recovery = recovery;
        await audit(supabase, inst, "wa_instance.recover_attempted", recovery);
      }
    } catch (e: any) {
      r.error = e?.message || String(e);
    }

    report.push(r);
  }

  return json(200, { ok: true, count: report.length, report });
});

// Force-clear a stuck Evolution session and request a fresh QR. Used when the
// dashboard "Scan QR" button errors with "already connected or QR unavailable"
// — that error means Evolution holds a zombie socket that won't release the
// QR slot. Logout drops the socket; connect spawns the QR.
async function recoverInstance(name: string): Promise<{ ok: boolean; logout_status?: number; connect_status?: number; qr_available?: boolean; error?: string }> {
  try {
    const logoutRes = await fetch(`${EVO_URL}/instance/logout/${name}`, {
      method: "DELETE",
      headers: { apikey: EVO_KEY },
    });
    // Logout returning 404 is fine — instance was already cleared. Other
    // failures we surface but still try connect; sometimes a partial logout
    // is enough to unblock the socket.
    const connectRes = await fetch(`${EVO_URL}/instance/connect/${name}`, {
      headers: { apikey: EVO_KEY },
    });
    const connectData = await connectRes.json().catch(() => null);
    return {
      ok: connectRes.ok,
      logout_status: logoutRes.status,
      connect_status: connectRes.status,
      qr_available: !!(connectData?.base64 || connectData?.code),
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function audit(supabase: any, inst: any, action: string, metadata: any) {
  try {
    await supabase.from("audit_logs").insert({
      scope: "business",
      business_id: inst.business_id,
      actor_id: null,
      actor_role: null,
      actor_name: "wa-instance-watchdog",
      action,
      entity_table: "wa_instances",
      entity_id: inst.id,
      metadata: { instance_name: inst.name, ...metadata },
    });
  } catch { /* never block reconciliation on audit failure */ }
}
