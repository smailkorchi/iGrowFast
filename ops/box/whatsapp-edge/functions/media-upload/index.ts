// media-upload
//
// Mints a short-lived presigned PUT URL for the browser to upload outbound
// chat media directly to R2. The frontend then calls send_message with the
// returned storage key.
//
// Body (conversation upload):
//   { conversation_id: string, mime: string, size_bytes: number }
//
// Body (quick reply upload — any authenticated user with access to the instance):
//   { instance_id: string, purpose: 'quick_reply', mime: string, size_bytes: number }
//
// Body (scheduled message upload — any authenticated user with conv access):
//   { conversation_id: string, purpose: 'scheduled_message', mime: string, size_bytes: number }
//
// Returns: { ok: true, bucket, key, url, expires_at, max_bytes }
//        | { ok: false, reason: 'invalid_input'
//                              | 'forbidden'
//                              | 'too_large'
//                              | 'unsupported_mime'
//                              | 'signing_failed' }
//
// Authorization:
//   - Requires Supabase JWT.
//   - conversation_id path: Caller must have RLS read access to the target
//     conversation; otherwise returns 403.
//   - quick_reply path: Caller must have RLS read access to the instance.
//   - scheduled_message path: Caller must have RLS read access to the conv.
//   - Key shape: <instance_id>/<conversation_id>/<draft_uuid>.<ext> (chat)
//                <instance_id>/qr/<draft_uuid>.<ext> (quick reply)
//                <instance_id>/<conversation_id>/sm/<draft_uuid>.<ext> (sched)
//
// Orphan handling:
//   If the caller PUTs the bytes but never calls send_message, the object
//   sits at the key forever. R2 lifecycle rule (configured separately) will
//   sweep unclaimed objects after 24h based on creation time.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { json, preflight } from '../_shared/cors.ts'
import { asCaller } from '../_shared/admin.ts'
import { logError } from '../_shared/logError.ts'

const R2_ENDPOINT          = Deno.env.get('R2_MEDIA_ENDPOINT')!
const R2_ACCESS_KEY_ID     = Deno.env.get('R2_MEDIA_ACCESS_KEY_ID')!
const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_MEDIA_SECRET_ACCESS_KEY')!
const R2_BUCKET            = Deno.env.get('R2_MEDIA_BUCKET') ?? 'whatsapp-media'

const TTL_SECONDS = 15 * 60                   // 15 min PUT window
const MAX_BYTES   = 100 * 1024 * 1024         // 100 MB (matches WA Business cap)
const UUID_RE     = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Allow-list mirrors what the dispatcher actually sends to Evolution
// (image/video/audio/document/sticker). Unknown mimes are rejected.
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/heic': 'heic',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm',
  'application/pdf': 'pdf', 'application/zip': 'zip',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt', 'text/csv': 'csv',
  'text/markdown': 'md', 'text/html': 'html', 'application/json': 'json',
  'text/xml': 'xml', 'application/xml': 'xml', 'application/rtf': 'rtf',
  // Generic fallback so any document the agent stages can be sent. The real
  // filename + mime travel in media_meta / Evolution payload; the R2 key
  // extension is cosmetic. Size cap (MAX_BYTES) still applies.
  'application/octet-stream': 'bin',
}

const aws = new AwsClient({
  accessKeyId:     R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  service:         's3',
  region:          'auto',
})

Deno.serve(async (req) => {
  try {
    const pre = preflight(req); if (pre) return pre
    if (req.method !== 'POST') {
      return json({ ok: false, reason: 'method_not_allowed' }, { status: 405 })
    }

    const auth = req.headers.get('authorization') ?? ''
    if (!auth.toLowerCase().startsWith('bearer ')) {
      return json({ ok: false, reason: 'forbidden' }, { status: 401 })
    }
    const jwt = auth.slice(7).trim()
    const caller = asCaller(jwt)
    const { data: u, error: ue } = await caller.auth.getUser()
    if (ue || !u?.user) return json({ ok: false, reason: 'forbidden' }, { status: 401 })

    let body: { conversation_id?: unknown; instance_id?: unknown; message_id?: unknown; purpose?: unknown; mime?: unknown; size_bytes?: unknown }
    try { body = await req.json() }
    catch { return json({ ok: false, reason: 'invalid_input' }, { status: 400 }) }

    const mime      = body.mime
    const sizeBytes = body.size_bytes
    if (typeof mime !== 'string' || mime.length < 3) {
      return json({ ok: false, reason: 'invalid_input' }, { status: 400 })
    }
    if (typeof sizeBytes !== 'number' || sizeBytes <= 0) {
      return json({ ok: false, reason: 'invalid_input' }, { status: 400 })
    }
    if (sizeBytes > MAX_BYTES) {
      return json({ ok: false, reason: 'too_large', max_bytes: MAX_BYTES }, { status: 413 })
    }
    // WhatsApp accepts arbitrary files as documents, so an uncommon-but-valid
    // MIME (e.g. .psd → image/vnd.adobe.photoshop, .ai, .sketch, …) must NOT be
    // rejected — fall back to a generic .bin key. The extension here is cosmetic;
    // the real filename + MIME ride in media_meta / the Evolution payload, so the
    // recipient still sees "ADS.psd". Exception: text/html (and xhtml) is dropped
    // SILENTLY by Baileys — attachment never lands and no error is returned
    // (WhiskeySockets/Baileys + openclaw#53652) — so reject it up-front with a
    // clear error instead of letting the agent believe it sent.
    const lowerMime = mime.toLowerCase()
    const SILENT_FAIL_MIMES = new Set(['text/html', 'application/xhtml+xml'])
    if (SILENT_FAIL_MIMES.has(lowerMime)) {
      return json({ ok: false, reason: 'unsupported_mime' }, { status: 415 })
    }
    const ext = MIME_TO_EXT[lowerMime] ?? 'bin'

    let key: string
    let auditTarget: { type: string; id: string }

    if (body.purpose === 'quick_reply') {
      // Quick reply media: keyed under instance_id/qr/. RLS-gated — any user who
      // can see the instance (admin, or an agent assigned to a conversation on it,
      // per whatsapp_instances wi_select) may attach media to a quick reply for it.
      // (quick_replies INSERT RLS is open to all authenticated, so authoring is not
      // admin-only; the media attach must follow the same access model.)
      const instanceId = body.instance_id
      if (typeof instanceId !== 'string' || !UUID_RE.test(instanceId)) {
        return json({ ok: false, reason: 'invalid_input' }, { status: 400 })
      }
      const { data: inst, error: ie } = await caller
        .schema('whatsapp')
        .from('whatsapp_instances')
        .select('id')
        .eq('id', instanceId)
        .maybeSingle()
      if (ie || !inst) {
        return json({ ok: false, reason: 'forbidden' }, { status: 403 })
      }
      const draftId = crypto.randomUUID()
      key = `${instanceId}/qr/${draftId}.${ext}`
      auditTarget = { type: 'quick_reply', id: instanceId }
    } else if (body.purpose === 'scheduled_message') {
      // Scheduled message media: keyed under <instance>/<conv>/sm/. RLS-gated
      // (same read check as a regular conversation upload) — any authenticated
      // user able to see the conversation can also queue media for it.
      const convId = body.conversation_id
      if (typeof convId !== 'string' || !UUID_RE.test(convId)) {
        return json({ ok: false, reason: 'invalid_input' }, { status: 400 })
      }
      const { data: conv, error: ce } = await caller
        .schema('whatsapp')
        .from('conversations')
        .select('id, instance_id')
        .eq('id', convId)
        .maybeSingle()
      if (ce || !conv) {
        return json({ ok: false, reason: 'forbidden' }, { status: 403 })
      }
      const draftId = crypto.randomUUID()
      key = `${conv.instance_id}/${convId}/sm/${draftId}.${ext}`
      auditTarget = { type: 'scheduled_message', id: convId }
    } else if (body.purpose === 'doc_preview') {
      // Document-preview thumbnail (JPEG) keyed off the source message's media
      // key: <media_storage_key>.preview.jpg. RLS-gated by message access. The
      // thread renders the doc to a thumbnail once, then everyone reads the
      // cached object via the public R2 domain.
      const messageId = body.message_id
      if (typeof messageId !== 'string' || !UUID_RE.test(messageId)) {
        return json({ ok: false, reason: 'invalid_input' }, { status: 400 })
      }
      if (mime.toLowerCase() !== 'image/jpeg') {
        return json({ ok: false, reason: 'unsupported_mime' }, { status: 415 })
      }
      const { data: m, error: me } = await caller
        .schema('whatsapp')
        .from('messages_decrypted')
        .select('id, media_storage_key')
        .eq('id', messageId)
        .maybeSingle()
      if (me || !m || !m.media_storage_key) {
        return json({ ok: false, reason: 'forbidden' }, { status: 403 })
      }
      key = `${m.media_storage_key}.preview.jpg`
      auditTarget = { type: 'message', id: messageId }
    } else {
      // Standard conversation upload: RLS-gated
      const convId = body.conversation_id
      if (typeof convId !== 'string' || !UUID_RE.test(convId)) {
        return json({ ok: false, reason: 'invalid_input' }, { status: 400 })
      }
      const { data: conv, error: ce } = await caller
        .schema('whatsapp')
        .from('conversations')
        .select('id, instance_id')
        .eq('id', convId)
        .maybeSingle()
      if (ce || !conv) {
        return json({ ok: false, reason: 'forbidden' }, { status: 403 })
      }
      const draftId = crypto.randomUUID()
      key = `${conv.instance_id}/${convId}/${draftId}.${ext}`
      auditTarget = { type: 'conversation', id: convId }
    }
    const objectUrl =
      `${R2_ENDPOINT.replace(/\/+$/, '')}` +
      `/${encodeURIComponent(R2_BUCKET)}` +
      `/${key.split('/').map(encodeURIComponent).join('/')}` +
      `?X-Amz-Expires=${TTL_SECONDS}`

    let signedUrl: string
    try {
      const signed = await aws.sign(objectUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': mime,
          'Content-Length': String(sizeBytes),
        },
        aws: { signQuery: true, allHeaders: true },
      })
      signedUrl = signed.url
    } catch (err) {
      console.error('media-upload.sign_failed', err)
      return json({ ok: false, reason: 'signing_failed' }, { status: 500 })
    }

    caller.schema('whatsapp').rpc('audit', {
      p_event_type:  'media_upload_url_issued',
      p_target_type: auditTarget.type,
      p_target_id:   auditTarget.id,
      p_payload: {
        bucket:     R2_BUCKET,
        key,
        mime,
        size_bytes: sizeBytes,
        ttl_s:      TTL_SECONDS,
      },
    }).then(({ error }) => {
      if (error) console.warn('media-upload.audit_failed', error.message)
    })

    return json({
      ok:         true,
      bucket:     R2_BUCKET,
      key,
      url:        signedUrl,
      expires_at: new Date(Date.now() + TTL_SECONDS * 1000).toISOString(),
      max_bytes:  MAX_BYTES,
    })
  } catch (err) {
    console.error('media-upload.unhandled', err)
    logError('media-upload', err, { status: 500 })
    return json({ ok: false, reason: 'signing_failed' }, { status: 500 })
  }
})
