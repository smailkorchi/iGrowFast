// @ts-nocheck
// ╔══════════════════════════════════════════════════════════════════╗
// ║  ai-indexer — auto-indexes products, customers, orders, business  ║
// ║  profile into ai_knowledge_chunks so the brain can RAG-search     ║
// ║  them. Runs every 30 min via cron + on-demand from the UI.        ║
// ║                                                                    ║
// ║  Body (POST): { business_id?, kind?, force? }                     ║
// ║   - both omitted: indexes every dirty source for every business   ║
// ║   - kind set, business_id set: indexes that one source            ║
// ║   - force=true: re-indexes even if not dirty                      ║
// ╚══════════════════════════════════════════════════════════════════╝
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } }); }

const KIND_TO_KB_KIND: Record<string,string> = {
  product:           "product",
  customer:          "customer",
  order:             "order",
  business_profile:  "business_profile",
  faq:               "faq",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")    return json(405, { ok: false, error: "method not allowed" });

  // Loose gate: the internal supabase client below uses SERVICE_ROLE_KEY for
  // every RPC, so privileged ops are gated at the DB layer regardless of the
  // incoming auth header. The function is verify_jwt=false but still requires
  // SOME auth header to keep it off the open internet.
  if (!req.headers.get("authorization")) return json(401, { ok: false, error: "auth header required" });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const filterBiz: string | undefined = body?.business_id;
  const filterKind: string | undefined = body?.kind;
  const force: boolean = !!body?.force;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Pick sources to process.
  let q = supabase.from("ai_indexable_sources").select("business_id, kind, last_indexed_at, dirty_at, enabled").eq("enabled", true);
  if (filterBiz)  q = q.eq("business_id", filterBiz);
  if (filterKind) q = q.eq("kind", filterKind);
  const { data: rows, error: rowsErr } = await q;
  if (rowsErr) return json(200, { ok: false, error: `select sources: ${rowsErr.message}` });

  const todo = (rows || []).filter((r: any) => {
    if (r.kind === "faq") return false;     // FAQs are indexed by ai-faq-ingest already
    if (force) return true;
    return !r.last_indexed_at || new Date(r.dirty_at) > new Date(r.last_indexed_at);
  });

  const results: any[] = [];
  for (const row of todo) {
    try {
      const out = await indexSource(supabase, row.business_id, row.kind);
      results.push({ business_id: row.business_id, kind: row.kind, ...out });
      await supabase.from("ai_indexable_sources").update({
        last_indexed_at: new Date().toISOString(),
        rows_indexed: out.embedded ?? 0,
        rows_total:   out.total ?? 0,
        last_error:   out.error ?? null,
        updated_at:   new Date().toISOString(),
      }).eq("business_id", row.business_id).eq("kind", row.kind);
    } catch (e: any) {
      const err = e?.message || String(e);
      results.push({ business_id: row.business_id, kind: row.kind, ok: false, error: err });
      await supabase.from("ai_indexable_sources").update({
        last_error: err, updated_at: new Date().toISOString(),
      }).eq("business_id", row.business_id).eq("kind", row.kind);
    }
  }

  return json(200, { ok: true, processed: results.length, results });
});

async function indexSource(supabase: any, businessId: string, kind: string) {
  const { data: rows, error } = await supabase.rpc("ai_indexer_fetch_payload", {
    p_business_id: businessId, p_kind: kind, p_limit: 200,
  });
  if (error) return { ok: false, error: `fetch: ${error.message}`, total: 0, embedded: 0 };
  const list = rows || [];
  const kbKind = KIND_TO_KB_KIND[kind] || "doc";

  // Orphan cleanup: remove chunks whose source_id is no longer in the live
  // payload. Without this, deleted/trashed records leave stale chunks that
  // poison RAG search and inflate the dashboard count. Runs even when
  // list.length === 0 (full wipe scenario).
  const liveIds: string[] = list.map((r: any) => r.source_id).filter(Boolean);
  let orphansDeleted = 0;
  if (liveIds.length === 0) {
    const { count } = await supabase.from("ai_knowledge_chunks")
      .delete({ count: "exact" })
      .eq("business_id", businessId)
      .eq("source_kind", kbKind);
    orphansDeleted = count ?? 0;
  } else {
    // Supabase doesn't expose `not in (uuid[])` cleanly; use a direct SQL RPC
    // would be tidier, but the array filter via PostgREST works for ≤ ~1000 ids.
    const { count } = await supabase.from("ai_knowledge_chunks")
      .delete({ count: "exact" })
      .eq("business_id", businessId)
      .eq("source_kind", kbKind)
      .not("source_id", "in", `(${liveIds.join(",")})`);
    orphansDeleted = count ?? 0;
  }

  if (list.length === 0) return { ok: true, total: 0, embedded: 0, orphans_deleted: orphansDeleted };

  // Embed in batches of 50 (OpenAI accepts up to 2048 inputs but we keep it small for cost spread).
  const BATCH = 50;
  let embedded = 0;

  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    const texts = batch.map((r: any) => r.payload || "").filter((t: string) => t.length > 5);
    if (texts.length === 0) continue;

    const er = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
      body: JSON.stringify({ texts, business_id: businessId }),
    });
    const ej = await er.json();
    if (!ej.ok) return { ok: false, error: `embed: ${ej.error}`, total: list.length, embedded };

    const embeddings: number[][] = ej.embeddings;
    for (let j = 0; j < batch.length; j++) {
      const r = batch[j];
      if (!embeddings[j]) continue;
      const literal = `[${embeddings[j].join(",")}]`;
      // Upsert by (business_id, source_kind, source_id) — use delete+insert pattern.
      await supabase.from("ai_knowledge_chunks")
        .delete()
        .eq("business_id", businessId)
        .eq("source_kind", kbKind)
        .eq("source_id",   r.source_id);
      await supabase.from("ai_knowledge_chunks").insert({
        business_id:  businessId,
        source_kind:  kbKind,
        source_id:    r.source_id,
        source_label: r.source_label,
        chunk_index:  0,
        text:         r.payload,
        embedding:    literal,
        active:       true,
        token_count:  Math.ceil((r.payload || "").length / 4),
        metadata:     r.metadata || {},
        updated_at:   new Date().toISOString(),
      });
      embedded++;
    }
  }
  return { ok: true, total: list.length, embedded, orphans_deleted: orphansDeleted };
}
