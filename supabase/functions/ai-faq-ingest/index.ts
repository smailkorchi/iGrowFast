// @ts-nocheck
// ╔═══════════════════════════════════════════════════════════════════╗
// ║  ai-faq-ingest — admin/owner UI calls this to upsert FAQs.          ║
// ║                                                                     ║
// ║  Body: { business_id, faqs: [{ id?, question, answer, active? }] } ║
// ║  • admin/owner authorization enforced via JWT lookup                ║
// ║  • Each FAQ embedded via ai-embed, stored in ai_knowledge_chunks   ║
// ║    with source_kind='faq', metadata={question, answer}              ║
// ║  • verify_jwt=true → Supabase pre-validates the caller's JWT       ║
// ╚═══════════════════════════════════════════════════════════════════╝
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")    return json(405, { ok: false, error: "method not allowed" });

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json(401, { ok: false, error: "missing auth" });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "bad json" }); }
  const businessId: string | undefined = body?.business_id;
  const faqs: any[] = Array.isArray(body?.faqs) ? body.faqs : [];
  if (!businessId) return json(200, { ok: false, error: "business_id required" });
  if (faqs.length === 0)  return json(200, { ok: false, error: "no faqs" });
  if (faqs.length > 20)   return json(200, { ok: false, error: "max 20 faqs per call" });

  // Authorization: caller must be admin/owner/super_admin of this business.
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: auth } } },
  );
  const { data: userInfo } = await userClient.auth.getUser();
  const uid = userInfo?.user?.id;
  if (!uid) return json(401, { ok: false, error: "invalid jwt" });

  const service = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { data: profile } = await service.from("users").select("id, role, active, \"DigiCom Business\"").eq("id", uid).maybeSingle();
  if (!profile || profile.active === false) return json(403, { ok: false, error: "inactive user" });
  const role = profile.role;
  const sameBiz = profile["DigiCom Business"] === businessId;
  const isAdminOrOwner = role === "admin" || role === "owner" || role === "super admin";
  if (!(isAdminOrOwner && (sameBiz || role === "super admin"))) {
    return json(403, { ok: false, error: "forbidden (must be admin/owner of this business)" });
  }

  // Build texts to embed.
  const items = faqs
    .map((f) => ({
      id: typeof f?.id === "string" ? f.id : null,
      question: typeof f?.question === "string" ? f.question.trim() : "",
      answer:   typeof f?.answer   === "string" ? f.answer.trim()   : "",
      active:   typeof f?.active   === "boolean" ? f.active : true,
    }))
    .filter((f) => f.question.length >= 2 && f.answer.length >= 2);
  if (items.length === 0) return json(200, { ok: false, error: "no valid faqs" });

  const texts = items.map((f) => `Q: ${f.question}\nA: ${f.answer}`);

  // Embed in one batch.
  const embedResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
    body: JSON.stringify({ texts, business_id: businessId }),
  });
  const embedJson = await embedResp.json();
  if (!embedJson.ok) return json(200, { ok: false, error: `embed: ${embedJson.error}` });

  const embeddings: number[][] = embedJson.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== items.length) {
    return json(200, { ok: false, error: "embed: count mismatch" });
  }

  // Upsert each.
  const out: Array<{ id: string; status: string }> = [];
  for (let i = 0; i < items.length; i++) {
    const f = items[i];
    const embeddingLiteral = `[${embeddings[i].join(",")}]`;
    const row: any = {
      business_id: businessId,
      source_kind: "faq",
      chunk_index: 0,
      text:        texts[i],
      source_label: f.question.slice(0, 120),
      metadata:    { question: f.question, answer: f.answer },
      embedding:   embeddingLiteral,
      active:      f.active,
      language:    null,
      token_count: Math.ceil(texts[i].length / 4),
      updated_at:  new Date().toISOString(),
    };
    if (f.id) {
      const { data, error } = await service.from("ai_knowledge_chunks").update(row).eq("id", f.id).eq("business_id", businessId).select("id").maybeSingle();
      if (error) out.push({ id: f.id, status: `error:${error.message}` });
      else if (!data) out.push({ id: f.id, status: "not_found" });
      else out.push({ id: data.id, status: "updated" });
    } else {
      const { data, error } = await service.from("ai_knowledge_chunks").insert(row).select("id").maybeSingle();
      if (error) out.push({ id: "", status: `error:${error.message}` });
      else out.push({ id: data!.id, status: "created" });
    }
  }

  return json(200, { ok: true, results: out, embed_cost_usd: embedJson.cost_usd, embed_tokens: embedJson.tokens });
});
