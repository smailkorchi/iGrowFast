// media-sign
//
// Returns a public R2 URL for a media object referenced by a messages row.
// The URL routes through the Cloudflare R2 custom domain (media.igrowfast.com)
// so responses are cached at CF edge POPs worldwide — repeat views serve in
// ~5ms instead of ~300ms from raw R2.
//
// Security model: the URL path contains 3 UUIDs (instance/conversation/message,
// 366 bits of entropy total). R2 custom domains expose no LIST endpoint, so
// the URL is a capability token — knowing it = access, not knowing it = zero
// attack surface. The RLS check in this function gates WHO learns the URL.
// This is the same model Slack, Discord, and Telegram Web use for media.
//
// Body:    { message_id: string }
// Returns: { ok: true, url, expires_at, mime, size_bytes, filename? }
//        | { ok: false, reason: 'invalid_input'
//                              | 'forbidden'
//                              | 'not_found'
//                              | 'pending'
//                              | 'no_media' }
//
// Every successful resolve writes a `media_access` row into the hash-chained
// audit log (actor = caller, target = message id).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { json, preflight } from '../_shared/cors.ts'
import { asCaller } from '../_shared/admin.ts'
import { logError } from '../_shared/logError.ts'

// R2 custom domain — media.igrowfast.com CNAME → R2 bucket. Cloudflare edge
// caches responses using the object's Cache-Control (public, immutable, 1yr).
const R2_PUBLIC_DOMAIN = Deno.env.get('R2_MEDIA_PUBLIC_DOMAIN') ?? 'media.igrowfast.com'

// Browser-side cache hint. The URL itself never expires (capability token),
// but we tell the frontend to re-check RLS every 30 min in case the user
// gets unassigned. TanStack Query uses this for staleTime.
const CLIENT_TTL_SECONDS = 30 * 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  try {
    const pre = preflight(req); if (pre) return pre
    if (req.method !== 'POST') {
      return json({ ok: false, reason: 'method_not_allowed' }, { status: 405 })
    }

    // ── Authn ──
    const auth = req.headers.get('authorization') ?? ''
    if (!auth.toLowerCase().startsWith('bearer ')) {
      return json({ ok: false, reason: 'forbidden' }, { status: 401 })
    }
    const jwt = auth.slice(7).trim()
    const caller = asCaller(jwt)
    const { data: u, error: ue } = await caller.auth.getUser()
    if (ue || !u?.user) {
      return json({ ok: false, reason: 'forbidden' }, { status: 401 })
    }

    // ── Input ──
    let body: { message_id?: unknown }
    try { body = await req.json() }
    catch { return json({ ok: false, reason: 'invalid_input' }, { status: 400 }) }
    const messageId = body.message_id
    if (typeof messageId !== 'string' || !UUID_RE.test(messageId)) {
      return json({ ok: false, reason: 'invalid_input' }, { status: 400 })
    }

    // ── Authz via RLS ──
    // messages_decrypted is security_invoker, so if the caller can't read
    // this row under RLS, .maybeSingle() returns null. That is the gate.
    const { data: msg, error: re } = await caller
      .schema('whatsapp')
      .from('messages_decrypted')
      .select(
        'id, media_storage_bucket, media_storage_key, media_mime, ' +
        'media_size_bytes, media_pending, media_meta',
      )
      .eq('id', messageId)
      .maybeSingle()

    if (re) {
      return json({ ok: false, reason: 'forbidden' }, { status: 403 })
    }
    if (!msg) {
      return json({ ok: false, reason: 'not_found' }, { status: 404 })
    }
    if (msg.media_pending) {
      // Worker hasn't uploaded yet; client should retry shortly. 425 Too Early.
      return json({ ok: false, reason: 'pending' }, { status: 425 })
    }
    if (!msg.media_storage_key || !msg.media_storage_bucket) {
      return json({ ok: false, reason: 'no_media' }, { status: 404 })
    }

    // ── Build public URL via R2 custom domain ──
    const key = msg.media_storage_key as string
    const encodedKey = key.split('/').map(encodeURIComponent).join('/')
    const publicUrl = `https://${R2_PUBLIC_DOMAIN}/${encodedKey}`

    // ── Audit (fire-and-forget; never blocks the response) ──
    caller.schema('whatsapp').rpc('audit', {
      p_event_type:  'media_access',
      p_target_type: 'message',
      p_target_id:   messageId,
      p_payload: {
        key,
        domain: R2_PUBLIC_DOMAIN,
      },
    }).then(({ error }) => {
      if (error) console.warn('media-sign.audit_failed', error.message)
    })

    const meta = (msg.media_meta ?? {}) as Record<string, unknown>
    const filename = typeof meta.fileName === 'string' ? meta.fileName : null

    return json({
      ok:         true,
      url:        publicUrl,
      expires_at: new Date(Date.now() + CLIENT_TTL_SECONDS * 1000).toISOString(),
      mime:       msg.media_mime ?? null,
      size_bytes: msg.media_size_bytes ?? null,
      filename,
    })
  } catch (err) {
    console.error('media-sign.unhandled', err)
    logError('media-sign', err, { status: 500 })
    return json({ ok: false, reason: 'signing_failed' }, { status: 500 })
  }
})
