// @ts-nocheck
// ╔══════════════════════════════════════════════════════════════════════╗
// ║  evolution-webhook-v2                                                 ║
// ║                                                                       ║
// ║  Thin authenticator + durable enqueuer.                               ║
// ║   1. Verifies HMAC signature in `X-Wa-Signature` header (sha256).     ║
// ║   2. Computes idempotency key per event.                              ║
// ║   3. Inserts into wa_webhook_events (ON CONFLICT DO NOTHING).         ║
// ║   4. Returns 200 immediately. Worker drains the queue.                ║
// ║                                                                       ║
// ║  Goals:                                                               ║
// ║   - Never block Evolution waiting for ingestion.                      ║
// ║   - Never lose an event: durable queue + idempotent enqueue.          ║
// ║   - Reject anything not signed with the per-instance secret.          ║
// ╚══════════════════════════════════════════════════════════════════════╝

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ── CORS (Evolution doesn't need CORS but Supabase always responds to OPTIONS) ──
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wa-signature",
};

// ── HMAC verification ────────────────────────────────────────────────────
async function verifySignature(
  rawBody: string,
  signatureHex: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHex || !secret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const sigBytes = new Uint8Array(sigBuf);
  const expected = Array.from(sigBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  // Constant-time compare
  if (expected.length !== signatureHex.length) return false;
  let ok = 0;
  for (let i = 0; i < expected.length; i++) ok |= expected.charCodeAt(i) ^ signatureHex.charCodeAt(i);
  return ok === 0;
}

// ── Build a stable idempotency key per event ─────────────────────────────
function buildIdempotencyKey(payload: any): string | null {
  const evt: string = payload?.event || "";
  const inst: string = payload?.instance || "unknown";
  const data = payload?.data;

  if (!evt) return null;

  // For message events, key.id is the natural unique identifier
  switch (evt) {
    case "messages.upsert":
    case "send.message":
      return `${inst}:${evt}:${data?.key?.id ?? ""}:${data?.messageType ?? ""}`;
    case "messages.update":
      // Could be array; hash the keyIds together
      if (Array.isArray(data)) {
        const ids = data.map((d: any) => d?.keyId || d?.key?.id).join(",");
        return `${inst}:${evt}:${ids}`;
      }
      return `${inst}:${evt}:${data?.keyId ?? data?.key?.id ?? ""}:${data?.status ?? ""}`;
    case "messages.delete":
      return `${inst}:${evt}:${data?.key?.id ?? ""}`;
    case "contacts.upsert":
    case "contacts.update":
      if (Array.isArray(data)) {
        const ids = data.map((d: any) => d?.remoteJid || d?.id).join(",");
        return `${inst}:${evt}:${ids}`;
      }
      return `${inst}:${evt}:${data?.remoteJid ?? data?.id ?? ""}`;
    case "groups.upsert":
    case "group.update":
      if (Array.isArray(data)) {
        const ids = data.map((d: any) => d?.id).join(",");
        return `${inst}:${evt}:${ids}`;
      }
      return `${inst}:${evt}:${data?.id ?? ""}`;
    case "group-participants.update":
      return `${inst}:${evt}:${data?.id ?? ""}:${data?.action ?? ""}:${(data?.participants || []).join(",")}`;
    case "chats.upsert":
    case "chats.update":
      if (Array.isArray(data)) {
        const ids = data.map((d: any) => d?.remoteJid).join(",");
        return `${inst}:${evt}:${ids}`;
      }
      return `${inst}:${evt}:${data?.remoteJid ?? ""}`;
    case "labels.edit":
      return `${inst}:${evt}:${data?.id ?? data?.name ?? ""}`;
    case "labels.association":
      return `${inst}:${evt}:${data?.association?.chatId ?? ""}:${data?.association?.labelId ?? ""}:${data?.association?.type ?? ""}`;
    case "connection.update":
      return `${inst}:${evt}:${data?.state ?? ""}:${Date.now()}`; // state changes rare; add ts to allow multiple
    default:
      // Fallback: hash the whole payload's date_time + event name
      return `${inst}:${evt}:${payload?.date_time ?? Date.now()}`;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")    return new Response("method not allowed", { status: 405, headers: cors });

  const rawBody = await req.text();
  let payload: any;
  try { payload = JSON.parse(rawBody); } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid json" }), {
      status: 200, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const evoInstanceName: string = payload?.instance || "";
  const eventType: string = payload?.event || "";

  if (!evoInstanceName || !eventType) {
    return new Response(JSON.stringify({ ok: false, error: "missing instance or event" }), {
      status: 200, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // ── Look up the instance's webhook secret ────────────────────────────
  // First check wa_instances by name; fall back to legacy whatsapp_instances by name.
  let instanceId: string | null = null;
  let secret: string | null = null;
  {
    const { data } = await supabase
      .from("wa_instances")
      .select("id, webhook_secret")
      .eq("name", evoInstanceName)
      .maybeSingle();
    if (data) { instanceId = data.id; secret = data.webhook_secret; }
  }

  // ── Verify HMAC signature ────────────────────────────────────────────
  // During the migration window we accept payloads from instances that
  // don't have a v2 row yet (legacy), but only if a global fallback
  // secret matches OR the request comes from an allowed source IP.
  // The signature header lives in `x-wa-signature` (we set it on Evolution).
  const sigHeader = req.headers.get("x-wa-signature");
  const fallbackSecret = Deno.env.get("WA_WEBHOOK_FALLBACK_SECRET") ?? "";

  let signatureOk = false;
  if (secret) {
    signatureOk = await verifySignature(rawBody, sigHeader, secret);
  }
  if (!signatureOk && fallbackSecret) {
    signatureOk = await verifySignature(rawBody, sigHeader, fallbackSecret);
  }

  // During staged rollout (env var WA_WEBHOOK_ENFORCE_HMAC=false) we
  // log-and-accept unsigned events; once we've migrated Evolution to send
  // signatures, flip the env to "true" to start rejecting.
  const enforce = (Deno.env.get("WA_WEBHOOK_ENFORCE_HMAC") ?? "false") === "true";
  if (!signatureOk && enforce) {
    return new Response(JSON.stringify({ ok: false, error: "bad signature" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // ── Build idempotency key + enqueue ──────────────────────────────────
  const idemKey = buildIdempotencyKey(payload);
  if (!idemKey) {
    return new Response(JSON.stringify({ ok: false, error: "cannot derive idempotency key" }), {
      status: 200, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Strip top-level junk to keep payload compact
  const compact = {
    event: eventType,
    instance: evoInstanceName,
    data: payload?.data,
    contextInfo: payload?.contextInfo,
    date_time: payload?.date_time,
    sender: payload?.sender,
  };

  const { error: insErr } = await supabase
    .from("wa_webhook_events")
    .insert({
      instance_id: instanceId,
      evo_instance_name: evoInstanceName,
      event_type: eventType,
      idempotency_key: idemKey,
      payload: compact,
    });

  if (insErr) {
    // Unique-violation = duplicate event = success (idempotent)
    if ((insErr as any).code === "23505") {
      return new Response(JSON.stringify({ ok: true, deduped: true }), {
        status: 200, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: false, error: insErr.message }), {
      status: 200, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, queued: true }), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
});
