// @ts-nocheck
// ╔══════════════════════════════════════════════════════════════════╗
// ║  ai-stt — speech-to-text via OpenAI Whisper-1.                    ║
// ║                                                                    ║
// ║  Body: { business_id, audio_base64, mime_type?, language? }       ║
// ║         (mime_type defaults to "audio/ogg" — WhatsApp PTT format) ║
// ║         (language defaults to "ar" — best for Moroccan Darija)    ║
// ║                                                                    ║
// ║  Returns: { ok, transcript, duration_seconds, cost_usd, model_id }║
// ║                                                                    ║
// ║  Service-role only. Cost is recorded against the business via     ║
// ║  ai_record_usage (audio_minutes × $0.006).                         ║
// ╚══════════════════════════════════════════════════════════════════╝
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MODEL_NAME = "whisper-1";
const COST_PER_MINUTE = 0.006;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;   // 25 MB OpenAI limit

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function base64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(cleaned);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")    return json(405, { ok: false, error: "method not allowed" });

  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`;
  if (auth !== expected) return json(401, { ok: false, error: "service_role required" });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "bad json" }); }

  const businessId: string | undefined = body?.business_id;
  const audioB64:   string | undefined = body?.audio_base64;
  const mime = typeof body?.mime_type === "string" ? body.mime_type : "audio/ogg";
  // Default empty string = auto-detect. Locking language=ar makes Whisper-1
  // mangle French loanwords (ambulancier → marahil, livraison → libariyya).
  // Moroccan WhatsApp audios are heavily code-switched Darija + French + Arabic.
  const lang = typeof body?.language  === "string" ? body.language  : "";
  // Optional bias prompt — Whisper uses this as "previous context" so common
  // Moroccan e-commerce vocabulary gets preferred over similar-sounding Arabic.
  // Max 224 tokens. Explicit French loanwords prevent the model from squashing
  // them into Arabic look-alikes.
  const promptDefault =
    "Salam, 3afak, barakallahofik, smha liya, wakha, bghit, kayn, kayna, 3andkoum, 3andek, 3andna. " +
    "Macaron, Ambulancier, Police, Gendarmerie, Protection Civile, Pompier, Douane, Inspection, Royaume, Maroc. " +
    "Livraison, commande, COD, paiement, prix, dirham, dh, MAD, casquette, t-shirt, sticker, autocollant. " +
    "Casablanca, Rabat, Marrakech, Tanger, Fes, Agadir, Tétouan, Meknès, Salé. " +
    "Bghiti, n3am, la, daba, ghedda, lbarah, lyoum, chwiya, bzaf, ach, fin, kifash, ch7al.";
  const prompt = typeof body?.prompt === "string" ? body.prompt : promptDefault;

  if (!businessId) return json(200, { ok: false, error: "business_id required" });
  if (!audioB64 || audioB64.length < 32) return json(200, { ok: false, error: "audio_base64 required" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Pre-flight quota
  const { data: spendCheck } = await supabase.rpc("ai_can_spend", { p_business_id: businessId });
  if (spendCheck && spendCheck !== "ok") return json(200, { ok: false, error: `quota: ${spendCheck}` });

  // Resolve provider + model
  const [{ data: provRow }, { data: modelRow }] = await Promise.all([
    supabase.from("ai_providers").select("id").eq("slug", "openai").maybeSingle(),
    supabase.from("ai_models").select("id, model_id").eq("model_id", MODEL_NAME).maybeSingle(),
  ]);
  if (!provRow?.id || !modelRow?.id) return json(200, { ok: false, error: "openai whisper model not registered" });

  const { data: keyPlain } = await supabase.rpc("ai_decrypt_platform_key", { p_provider_id: provRow.id });
  if (!keyPlain) return json(200, { ok: false, error: "openai key missing" });

  // Decode audio
  let bytes: Uint8Array;
  try { bytes = base64ToBytes(audioB64); }
  catch (e: any) { return json(200, { ok: false, error: `bad base64: ${e?.message || e}` }); }
  if (bytes.length > MAX_AUDIO_BYTES) return json(200, { ok: false, error: `audio too large: ${bytes.length} bytes` });

  // Build multipart form-data
  const ext = mime.includes("mp4") ? "mp4" : mime.includes("mpeg") ? "mp3" : mime.includes("wav") ? "wav" : "ogg";
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: mime }), `audio.${ext}`);
  fd.append("model", MODEL_NAME);
  fd.append("response_format", "verbose_json");
  if (lang && lang.length === 2) fd.append("language", lang);
  if (prompt && prompt.length > 0) fd.append("prompt", prompt);

  const startedAt = Date.now();
  const oaResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${keyPlain}` },
    body: fd,
  });
  const oaText = await oaResp.text();
  let oaJson: any;
  try { oaJson = JSON.parse(oaText); } catch { oaJson = null; }
  if (!oaResp.ok || !oaJson) {
    return json(200, { ok: false, error: oaJson?.error?.message || `whisper ${oaResp.status}: ${oaText.slice(0, 200)}` });
  }

  const transcript: string = (oaJson.text ?? "").trim();
  const duration_seconds: number = Number(oaJson.duration ?? 0);
  const minutes = duration_seconds / 60;
  const cost_usd = minutes * COST_PER_MINUTE;

  // Record cost
  await supabase.rpc("ai_record_usage", {
    p_business_id: businessId,
    p_provider_id: provRow.id,
    p_model_id:    modelRow.id,
    p_tokens_in:   0,
    p_tokens_out:  0,
    p_audio_minutes: minutes,
    p_cost_usd:    cost_usd,
  });

  return json(200, {
    ok: true,
    transcript,
    duration_seconds,
    cost_usd,
    model_id: MODEL_NAME,
    language: oaJson.language ?? null,
    latency_ms: Date.now() - startedAt,
  });
});
