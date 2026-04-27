// @ts-nocheck
// ╔══════════════════════════════════════════════════════════════════╗
// ║  ai-memory-write — owner-curated business memory entry point.     ║
// ║                                                                    ║
// ║  Body: { business_id, action: "create"|"update"|"archive",        ║
// ║          memory_type?, content?, evidence?, confidence?,          ║
// ║          memory_id? (for update/archive),                          ║
// ║          status? (active|archived|rejected on update) }            ║
// ║                                                                    ║
// ║  Why an edge fn (vs raw PostgREST insert):                        ║
// ║  - We need to embed the `content` via ai-embed and store the      ║
// ║    1536-dim vector so the brain can vector-search the memory.     ║
// ║  - JS-side embed call keeps the trigger-free, sync write path     ║
// ║    explicit (no waiting for an async cron).                        ║
// ║                                                                    ║
// ║  Auth: forwards the caller's JWT to a user-scoped supabase client ║
// ║  so RLS (admin-or-owner of this business) governs writes. Service ║
// ║  role only used for the embed RPC call.                            ║
// ╚══════════════════════════════════════════════════════════════════╝

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(s: number, b: unknown) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}

const VALID_TYPES   = new Set(["pattern","preference","warning","tactic","fact"]);
const VALID_STATUS  = new Set(["pending","active","archived","rejected"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")    return json(405, { ok: false, error: "method not allowed" });

  const auth = req.headers.get("authorization") ?? "";
  if (!auth) return json(401, { ok: false, error: "auth header required" });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "bad json" }); }

  const action: string | undefined = body?.action;
  const businessId: string | undefined = body?.business_id;
  if (!businessId) return json(200, { ok: false, error: "business_id required" });
  if (!action || !["create","update","archive"].includes(action)) return json(200, { ok: false, error: "action must be create|update|archive" });

  // User-scoped client honours RLS — caller must be admin/owner of business.
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: auth } } },
  );
  const service = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // ── archive ───────────────────────────────────────────────────────
  if (action === "archive") {
    const memoryId: string | undefined = body?.memory_id;
    if (!memoryId) return json(200, { ok: false, error: "memory_id required" });
    const { error } = await userClient
      .from("ai_business_memory")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", memoryId)
      .eq("business_id", businessId);
    if (error) return json(200, { ok: false, error: `archive: ${error.message}` });
    return json(200, { ok: true, memory_id: memoryId, status: "archived" });
  }

  // ── update ────────────────────────────────────────────────────────
  if (action === "update") {
    const memoryId: string | undefined = body?.memory_id;
    if (!memoryId) return json(200, { ok: false, error: "memory_id required" });
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body?.memory_type === "string") {
      if (!VALID_TYPES.has(body.memory_type)) return json(200, { ok: false, error: "invalid memory_type" });
      updates.memory_type = body.memory_type;
    }
    if (typeof body?.status === "string") {
      if (!VALID_STATUS.has(body.status)) return json(200, { ok: false, error: "invalid status" });
      updates.status = body.status;
    }
    if (typeof body?.evidence === "string") updates.evidence = body.evidence;
    if (typeof body?.confidence === "number") updates.confidence = Math.max(0, Math.min(1, body.confidence));

    let needsEmbed = false;
    if (typeof body?.content === "string" && body.content.trim().length >= 10) {
      updates.content = body.content.trim();
      needsEmbed = true;
    }
    const { error: upErr } = await userClient
      .from("ai_business_memory")
      .update(updates)
      .eq("id", memoryId)
      .eq("business_id", businessId);
    if (upErr) return json(200, { ok: false, error: `update: ${upErr.message}` });

    if (needsEmbed) {
      const literal = await embedToLiteral(updates.content as string, businessId);
      if (literal) await service.from("ai_business_memory").update({ embedding: literal }).eq("id", memoryId);
    }
    return json(200, { ok: true, memory_id: memoryId });
  }

  // ── create (owner_curated) ────────────────────────────────────────
  const memoryType: string = body?.memory_type;
  const content: string    = typeof body?.content === "string" ? body.content.trim() : "";
  if (!VALID_TYPES.has(memoryType)) return json(200, { ok: false, error: "memory_type must be pattern|preference|warning|tactic|fact" });
  if (content.length < 10)         return json(200, { ok: false, error: "content must be at least 10 chars" });
  if (content.length > 600)        return json(200, { ok: false, error: "content must be at most 600 chars" });

  const { data: ins, error: insErr } = await userClient
    .from("ai_business_memory")
    .insert({
      business_id: businessId,
      memory_type: memoryType,
      source:      "owner_curated",
      status:      "active",                       // owner-curated → active immediately
      content,
      evidence:    typeof body?.evidence === "string" ? body.evidence : null,
      confidence:  Number.isFinite(body?.confidence) ? Math.max(0, Math.min(1, body.confidence)) : 0.9,
    })
    .select("id")
    .maybeSingle();
  if (insErr) return json(200, { ok: false, error: `insert: ${insErr.message}` });

  const literal = await embedToLiteral(content, businessId);
  if (literal && ins?.id) {
    await service.from("ai_business_memory").update({ embedding: literal }).eq("id", ins.id);
  }
  return json(200, { ok: true, memory_id: ins!.id });

  // ── helper ────────────────────────────────────────────────────────
  async function embedToLiteral(text: string, businessId: string): Promise<string | null> {
    try {
      const er = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ texts: [text], business_id: businessId }),
      });
      const ej = await er.json();
      if (ej?.ok && Array.isArray(ej.embeddings?.[0])) return `[${ej.embeddings[0].join(",")}]`;
      return null;
    } catch { return null; }
  }
});
