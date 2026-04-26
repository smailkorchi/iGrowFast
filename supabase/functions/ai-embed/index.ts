// @ts-nocheck
// ╔════════════════════════════════════════════════════════════════════╗
// ║  ai-embed — text → 1536-dim embedding (text-embedding-3-small).    ║
// ║                                                                     ║
// ║  Body:  { texts: string[], business_id: uuid }                      ║
// ║         (single string also accepted as { text: string, ... })      ║
// ║                                                                     ║
// ║  Returns: { embeddings: number[][], tokens, cost_usd, model_id }    ║
// ║                                                                     ║
// ║  Service-role only. The platform OpenAI key is decrypted via vault. ║
// ║  Cost is recorded against the caller's business_id automatically.   ║
// ╚════════════════════════════════════════════════════════════════════╝

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const MODEL_NAME = "text-embedding-3-small";
const INPUT_COST_PER_1M = 0.02;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")    return json(405, { ok: false, error: "method not allowed" });

  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`;
  if (auth !== expected) return json(401, { ok: false, error: "service_role required" });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "bad json" }); }

  const texts: string[] = Array.isArray(body?.texts)
    ? body.texts.filter((t: unknown) => typeof t === "string" && t.length > 0)
    : (typeof body?.text === "string" ? [body.text] : []);
  const businessId: string | undefined = body?.business_id;

  if (texts.length === 0)      return json(200, { ok: false, error: "no texts" });
  if (texts.length > 100)      return json(200, { ok: false, error: "max 100 texts per call" });
  if (!businessId)             return json(200, { ok: false, error: "business_id required" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Resolve provider + model ids
  const [{ data: provRow }, { data: modelRow }] = await Promise.all([
    supabase.from("ai_providers").select("id").eq("slug", "openai").maybeSingle(),
    supabase.from("ai_models").select("id, model_id").eq("model_id", MODEL_NAME).maybeSingle(),
  ]);
  if (!provRow?.id)  return json(200, { ok: false, error: "openai provider missing" });
  if (!modelRow?.id) return json(200, { ok: false, error: "embedding model missing" });

  // Pre-flight quota check (skip embed if budget already exhausted)
  const { data: spendCheck } = await supabase.rpc("ai_can_spend", { p_business_id: businessId });
  if (spendCheck && spendCheck !== "ok") {
    return json(200, { ok: false, error: `quota: ${spendCheck}` });
  }

  // Decrypt key (service-role only)
  const { data: keyPlain, error: keyErr } = await supabase.rpc("ai_decrypt_platform_key", { p_provider_id: provRow.id });
  if (keyErr || !keyPlain) return json(200, { ok: false, error: `key: ${keyErr?.message || "missing"}` });

  // Call OpenAI
  const oaResp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${keyPlain}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL_NAME, input: texts }),
  });
  const oaText = await oaResp.text();
  let oaJson: any;
  try { oaJson = JSON.parse(oaText); } catch { return json(200, { ok: false, error: `non-json from openai (${oaResp.status})` }); }
  if (!oaResp.ok) {
    return json(200, { ok: false, error: oaJson?.error?.message || `openai ${oaResp.status}` });
  }

  const embeddings: number[][] = (oaJson.data || []).map((d: any) => d.embedding);
  const tokens: number = oaJson.usage?.total_tokens ?? texts.reduce((s, t) => s + Math.ceil(t.length / 4), 0);
  const costUsd = (tokens / 1_000_000) * INPUT_COST_PER_1M;

  // Record cost
  await supabase.rpc("ai_record_usage", {
    p_business_id: businessId,
    p_provider_id: provRow.id,
    p_model_id:    modelRow.id,
    p_tokens_in:   tokens,
    p_tokens_out:  0,
    p_audio_minutes: null,
    p_cost_usd:    costUsd,
  });

  return json(200, {
    ok: true,
    embeddings,
    tokens,
    cost_usd: costUsd,
    model_id: MODEL_NAME,
  });
});
