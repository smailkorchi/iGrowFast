// @ts-nocheck
// ╔══════════════════════════════════════════════════════════════════╗
// ║  ai-stt — speech-to-text with parallel A/B test.                  ║
// ║                                                                    ║
// ║  Primary:  Speechmatics /v2/jobs/ (async, language=ar enhanced).  ║
// ║  Parallel: Deepgram nova-3 (sync, language=ar-MA).                ║
// ║  Fallback: OpenAI Whisper-1 if both fail.                          ║
// ║                                                                    ║
// ║  Both Speechmatics + Deepgram run concurrently. Primary transcript║
// ║  goes to wa_messages.text_content; both alternatives are returned ║
// ║  in the response payload AND logged so the user can compare.      ║
// ║                                                                    ║
// ║  Body: { business_id, audio_base64, mime_type? }                  ║
// ║  Returns: {                                                        ║
// ║    ok, transcript, model_id, cost_usd, duration_seconds,          ║
// ║    alt_transcripts: { speechmatics, deepgram, whisper },          ║
// ║    primary, latency_ms                                             ║
// ║  }                                                                 ║
// ╚══════════════════════════════════════════════════════════════════╝
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SPEECHMATICS_MODEL = "speechmatics-batch-ar";
const SPEECHMATICS_COST_PER_MIN = 0.0117;
const DEEPGRAM_MODEL = "deepgram-nova-3-ar-ma";
const DEEPGRAM_COST_PER_MIN = 0.0077;
const WHISPER_MODEL = "whisper-1";
const WHISPER_COST_PER_MIN = 0.006;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const SM_POLL_INTERVAL_MS = 700;
const SM_POLL_TIMEOUT_MS  = 25_000;

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
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function ext(mime: string) {
  return mime.includes("mp4") ? "mp4" : mime.includes("mpeg") ? "mp3" : mime.includes("wav") ? "wav" : "ogg";
}

type SttResult = { ok: boolean; transcript?: string; duration_seconds?: number; language?: string | null; error?: string };

// ─── Speechmatics: async batch ────────────────────────────────────────
async function transcribeSpeechmatics(apiKey: string, bytes: Uint8Array, mime: string): Promise<SttResult> {
  const fd = new FormData();
  fd.append("data_file", new Blob([bytes], { type: mime }), `audio.${ext(mime)}`);
  // Auto-detect language across { Arabic (incl. Darija/Maghrebi), French,
  // English }. Speechmatics picks the dominant language per voice note,
  // which is the right model for WhatsApp where customers anchor in one
  // language at a time. operating_point=enhanced for accuracy.
  fd.append("config", JSON.stringify({
    type: "transcription",
    transcription_config: {
      language: "auto",
      operating_point: "enhanced",
    },
    language_identification_config: {
      expected_languages: ["ar", "fr", "en"],
    },
  }));

  const submit = await fetch("https://asr.api.speechmatics.com/v2/jobs/", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}` },
    body: fd,
  });
  const submitTxt = await submit.text();
  if (!submit.ok) return { ok: false, error: `speechmatics submit ${submit.status}: ${submitTxt.slice(0, 200)}` };
  const submitJson = JSON.parse(submitTxt);
  const jobId: string | undefined = submitJson?.id;
  if (!jobId) return { ok: false, error: "speechmatics: no job id" };

  // Poll until job status=done
  const deadline = Date.now() + SM_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(SM_POLL_INTERVAL_MS);
    const statusResp = await fetch(`https://asr.api.speechmatics.com/v2/jobs/${jobId}`, {
      headers: { "Authorization": `Bearer ${apiKey}` },
    });
    const statusTxt = await statusResp.text();
    if (!statusResp.ok) return { ok: false, error: `speechmatics poll ${statusResp.status}: ${statusTxt.slice(0, 200)}` };
    const statusJson = JSON.parse(statusTxt);
    const jobStatus: string | undefined = statusJson?.job?.status;
    if (jobStatus === "rejected" || jobStatus === "deleted") return { ok: false, error: `speechmatics job ${jobStatus}` };
    if (jobStatus !== "done") continue;

    const tResp = await fetch(`https://asr.api.speechmatics.com/v2/jobs/${jobId}/transcript?format=txt`, {
      headers: { "Authorization": `Bearer ${apiKey}` },
    });
    const tTxt = await tResp.text();
    if (!tResp.ok) return { ok: false, error: `speechmatics transcript ${tResp.status}: ${tTxt.slice(0, 200)}` };
    // Fetch json-v2 for duration + detected language metadata. With language=auto
    // the response carries `metadata.language` indicating which language ID won.
    const dResp = await fetch(`https://asr.api.speechmatics.com/v2/jobs/${jobId}/transcript?format=json-v2`, {
      headers: { "Authorization": `Bearer ${apiKey}` },
    });
    let duration = 0;
    let detectedLang: string | null = null;
    try {
      const dJson = JSON.parse(await dResp.text());
      duration = Number(dJson?.metadata?.duration ?? 0);
      detectedLang = dJson?.metadata?.language ?? dJson?.metadata?.language_identification?.predicted_language ?? null;
    } catch { /* metadata optional */ }
    return { ok: true, transcript: tTxt.trim(), duration_seconds: duration, language: detectedLang };
  }
  return { ok: false, error: "speechmatics poll timeout" };
}

// ─── Deepgram: sync ────────────────────────────────────────────────────
async function transcribeDeepgram(apiKey: string, bytes: Uint8Array, mime: string): Promise<SttResult> {
  const url = "https://api.deepgram.com/v1/listen?model=nova-3&language=ar-MA&smart_format=true&punctuate=true";
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Token ${apiKey}`,
      "Content-Type": mime,
    },
    body: bytes,
  });
  const txt = await r.text();
  if (!r.ok) return { ok: false, error: `deepgram ${r.status}: ${txt.slice(0, 200)}` };
  const j = JSON.parse(txt);
  const transcript: string = (j?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim();
  const duration = Number(j?.metadata?.duration ?? 0);
  if (!transcript) return { ok: false, error: "deepgram: empty transcript", duration_seconds: duration };
  return { ok: true, transcript, duration_seconds: duration, language: "ar-MA" };
}

// ─── OpenAI Whisper-1: ultimate fallback ──────────────────────────────
async function transcribeWhisper(apiKey: string, bytes: Uint8Array, mime: string): Promise<SttResult> {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: mime }), `audio.${ext(mime)}`);
  fd.append("model", WHISPER_MODEL);
  fd.append("response_format", "verbose_json");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}` },
    body: fd,
  });
  const txt = await r.text();
  if (!r.ok) return { ok: false, error: `whisper ${r.status}: ${txt.slice(0, 200)}` };
  const j = JSON.parse(txt);
  return { ok: true, transcript: (j?.text ?? "").trim(), duration_seconds: Number(j?.duration ?? 0), language: j?.language ?? null };
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
  if (!businessId) return json(200, { ok: false, error: "business_id required" });
  if (!audioB64 || audioB64.length < 32) return json(200, { ok: false, error: "audio_base64 required" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Pre-flight quota
  const { data: spendCheck } = await supabase.rpc("ai_can_spend", { p_business_id: businessId });
  if (spendCheck && spendCheck !== "ok") return json(200, { ok: false, error: `quota: ${spendCheck}` });

  // Resolve providers + models in parallel
  const [
    { data: smProv },     { data: dgProv },     { data: oaiProv },
    { data: smModel },    { data: dgModel },    { data: whisperModel },
  ] = await Promise.all([
    supabase.from("ai_providers").select("id").eq("slug", "speechmatics").maybeSingle(),
    supabase.from("ai_providers").select("id").eq("slug", "deepgram").maybeSingle(),
    supabase.from("ai_providers").select("id").eq("slug", "openai").maybeSingle(),
    supabase.from("ai_models").select("id").eq("model_id", SPEECHMATICS_MODEL).maybeSingle(),
    supabase.from("ai_models").select("id").eq("model_id", DEEPGRAM_MODEL).maybeSingle(),
    supabase.from("ai_models").select("id").eq("model_id", WHISPER_MODEL).maybeSingle(),
  ]);

  const [{ data: smKey }, { data: dgKey }, { data: oaiKey }] = await Promise.all([
    smProv?.id  ? supabase.rpc("ai_decrypt_platform_key", { p_provider_id: smProv.id })  : Promise.resolve({ data: null }),
    dgProv?.id  ? supabase.rpc("ai_decrypt_platform_key", { p_provider_id: dgProv.id })  : Promise.resolve({ data: null }),
    oaiProv?.id ? supabase.rpc("ai_decrypt_platform_key", { p_provider_id: oaiProv.id }) : Promise.resolve({ data: null }),
  ]);

  if (!smKey && !dgKey && !oaiKey) return json(200, { ok: false, error: "no STT keys configured" });

  // Decode audio once
  let bytes: Uint8Array;
  try { bytes = base64ToBytes(audioB64); }
  catch (e: any) { return json(200, { ok: false, error: `bad base64: ${e?.message || e}` }); }
  if (bytes.length > MAX_AUDIO_BYTES) return json(200, { ok: false, error: `audio too large: ${bytes.length} bytes` });

  const startedAt = Date.now();

  // A/B: run Speechmatics + Deepgram concurrently. Deepgram is sync (~1-2s),
  // Speechmatics is async with polling (~5-10s). Total wall-clock = max() so
  // running in parallel costs nothing extra in latency terms.
  const [smResult, dgResult] = await Promise.all([
    smKey ? transcribeSpeechmatics(smKey, bytes, mime) : Promise.resolve({ ok: false, error: "speechmatics not configured" } as SttResult),
    dgKey ? transcribeDeepgram(dgKey, bytes, mime)     : Promise.resolve({ ok: false, error: "deepgram not configured"     } as SttResult),
  ]);

  // Log both transcripts side-by-side so the user can compare per voice note.
  console.log(`[STT_AB] business=${businessId} speechmatics_ok=${smResult.ok} deepgram_ok=${dgResult.ok}`);
  if (smResult.ok)  console.log(`[STT_AB][speechmatics] ${smResult.transcript}`);
  else              console.log(`[STT_AB][speechmatics] ERROR: ${smResult.error}`);
  if (dgResult.ok)  console.log(`[STT_AB][deepgram]     ${dgResult.transcript}`);
  else              console.log(`[STT_AB][deepgram]     ERROR: ${dgResult.error}`);

  const altTranscripts = {
    speechmatics: smResult.ok ? smResult.transcript : `[error: ${smResult.error}]`,
    deepgram:     dgResult.ok ? dgResult.transcript : `[error: ${dgResult.error}]`,
  };

  // Pick primary: Speechmatics if it returned content, else Deepgram, else Whisper
  let primary: { provider: "speechmatics" | "deepgram" | "whisper"; result: SttResult; provId: string; modelId: string; costPerMin: number; modelName: string } | null = null;

  if (smResult.ok && smResult.transcript && smProv?.id && smModel?.id) {
    primary = { provider: "speechmatics", result: smResult, provId: smProv.id, modelId: smModel.id, costPerMin: SPEECHMATICS_COST_PER_MIN, modelName: SPEECHMATICS_MODEL };
  } else if (dgResult.ok && dgResult.transcript && dgProv?.id && dgModel?.id) {
    primary = { provider: "deepgram", result: dgResult, provId: dgProv.id, modelId: dgModel.id, costPerMin: DEEPGRAM_COST_PER_MIN, modelName: DEEPGRAM_MODEL };
  }

  // Final fallback: Whisper-1
  let whisperResult: SttResult | null = null;
  if (!primary && oaiKey && oaiProv?.id && whisperModel?.id) {
    whisperResult = await transcribeWhisper(oaiKey, bytes, mime);
    if (whisperResult.ok && whisperResult.transcript) {
      primary = { provider: "whisper", result: whisperResult, provId: oaiProv.id, modelId: whisperModel.id, costPerMin: WHISPER_COST_PER_MIN, modelName: WHISPER_MODEL };
    }
  }
  if (whisperResult) {
    altTranscripts.whisper = whisperResult.ok ? whisperResult.transcript : `[error: ${whisperResult.error}]`;
  }

  if (!primary) {
    return json(200, {
      ok: false,
      error: "all STT providers failed",
      alt_transcripts: altTranscripts,
      latency_ms: Date.now() - startedAt,
    });
  }

  // Record cost for the WINNER. Also record a separate (small) cost for the
  // parallel Deepgram call when Speechmatics won, since Deepgram still ran
  // and incurred charges. This keeps the per-business spend ledger honest.
  const billingPromises: Promise<unknown>[] = [];
  const minutesPrimary = (primary.result.duration_seconds ?? 0) / 60;
  const costPrimary = minutesPrimary * primary.costPerMin;
  billingPromises.push(supabase.rpc("ai_record_usage", {
    p_business_id: businessId,
    p_provider_id: primary.provId,
    p_model_id:    primary.modelId,
    p_tokens_in:   0, p_tokens_out: 0,
    p_audio_minutes: minutesPrimary,
    p_cost_usd:    costPrimary,
  }));
  // If Deepgram also ran AND it wasn't the chosen primary, bill it separately.
  if (primary.provider !== "deepgram" && dgResult.ok && dgProv?.id && dgModel?.id) {
    const minutesDg = (dgResult.duration_seconds ?? 0) / 60;
    const costDg    = minutesDg * DEEPGRAM_COST_PER_MIN;
    billingPromises.push(supabase.rpc("ai_record_usage", {
      p_business_id: businessId,
      p_provider_id: dgProv.id,
      p_model_id:    dgModel.id,
      p_tokens_in:   0, p_tokens_out: 0,
      p_audio_minutes: minutesDg,
      p_cost_usd:    costDg,
    }));
  }
  // Same for Speechmatics.
  if (primary.provider !== "speechmatics" && smResult.ok && smProv?.id && smModel?.id) {
    const minutesSm = (smResult.duration_seconds ?? 0) / 60;
    const costSm    = minutesSm * SPEECHMATICS_COST_PER_MIN;
    billingPromises.push(supabase.rpc("ai_record_usage", {
      p_business_id: businessId,
      p_provider_id: smProv.id,
      p_model_id:    smModel.id,
      p_tokens_in:   0, p_tokens_out: 0,
      p_audio_minutes: minutesSm,
      p_cost_usd:    costSm,
    }));
  }
  await Promise.all(billingPromises);

  return json(200, {
    ok: true,
    transcript: primary.result.transcript,
    duration_seconds: primary.result.duration_seconds ?? 0,
    cost_usd: costPrimary,
    model_id: primary.modelName,
    primary: primary.provider,
    language: primary.result.language ?? null,
    alt_transcripts: altTranscripts,
    latency_ms: Date.now() - startedAt,
  });
});
