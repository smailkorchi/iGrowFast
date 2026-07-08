// instance-wa-profile
//
// Admin-only. Pushes our app-side profile fields up to WhatsApp via Evolution:
//   - wa_profile_name   -> /chat/updateProfileName
//   - wa_profile_status -> /chat/updateProfileStatus
//   - picture           -> /chat/updateProfilePicture
//     (picture_data_url from the request body when the admin picked a file,
//      else falls back to the stored profile_pic_url)
//
// Body shape: { instance_id, fields: ('name'|'status'|'picture')[], picture_data_url? }
// Returns: { ok, results: { [field]: 'ok' | 'failed' } }
//
// NOTE (fix over WA Mancer v8): the original never read picture_data_url, so
// the file-picker upload path silently no-oped ('skipped' — profile_pic_url is
// NULL until Evolution caches an avatar). The frontend contract (instancesApi
// pushWaProfile sends picture_data_url; WaProfileCard mirrors MAX_PICTURE_BYTES)
// always expected this handler. Evolution's /chat/updateProfilePicture accepts
// a URL or RAW base64 (a data: URL fails its isBase64 check), so we strip the
// data-URL prefix before forwarding. Verified against the running Evolution
// 2.3.7 bundle (updateProfilePicture: isURL → axios fetch, isBase64 → Buffer).
//
// SELF-AVATAR REFRESH (2026-07-06): after a successful picture push we must
// also update whatsapp_instances.profile_pic_url, or every UI surface keeps
// showing the OLD avatar. On stock Evolution this happened as a side effect of
// updateProfilePicture's reloadConnection() (reconnect → connection.update →
// worker refreshInstanceProfile). We removed that reload — it spawned a second
// socket and got the device unlinked (conflict:replaced), see
// ops/whatsapp-node/evolution-patches/001. So instead of round-tripping through
// WhatsApp's CDN (propagation race), we write the EXACT bytes the admin picked
// to R2 under the worker's avatar-key prefix (avatars/<instanceId>/, which the
// instance-delete R2 sweep already covers) and set profile_pic_url directly —
// instant, race-free, exact. This is the OWNER's own avatar, distinct from the
// peer-identity single-writer path (resolve_identity / contacts bible); the
// worker's next-reconnect refreshInstanceProfile reconciles to WhatsApp's own
// re-encoded copy harmlessly (COALESCE, same image).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { admin } from '../_shared/admin.ts'
import { json } from '../_shared/cors.ts'
import { updateWaProfileName, updateWaProfileStatus, updateWaProfilePicture } from '../_shared/evolution.ts'
import { withInstance } from '../_shared/instance.ts'

type Field = 'name' | 'status' | 'picture'
const ALL: Field[] = ['name', 'status', 'picture']

// Hard cap on the decoded image size. The frontend (WaProfileCard) enforces
// the same 5 MB client-side so users fail fast; this is the authoritative gate.
const MAX_PICTURE_BYTES = 5 * 1024 * 1024

const R2_ENDPOINT          = Deno.env.get('R2_MEDIA_ENDPOINT')!
const R2_ACCESS_KEY_ID     = Deno.env.get('R2_MEDIA_ACCESS_KEY_ID')!
const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_MEDIA_SECRET_ACCESS_KEY')!
const R2_BUCKET            = Deno.env.get('R2_MEDIA_BUCKET') ?? 'whatsapp-media'
// Public custom domain fronting the R2 bucket (mirror of the worker's
// MEDIA_PUBLIC_HOST). Default matches the bound CF domain so a missing env
// var can't silently fall back to WA Mancer's host.
const R2_PUBLIC_DOMAIN     = Deno.env.get('R2_MEDIA_PUBLIC_DOMAIN') ?? 'media.igrowfast.com'

const r2 = new AwsClient({
  accessKeyId:     R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  service:         's3',
  region:          'auto',
})

interface PickedPicture { b64: string; bytes: Uint8Array; mime: string }

// Accepts a browser FileReader data URL for any image type and returns the
// raw base64 (for Evolution) + decoded bytes + mime (for R2), or an error
// reason, or null when no data URL was provided.
function extractPicture(dataUrl: unknown): PickedPicture | { reason: string } | null {
  if (dataUrl === undefined || dataUrl === null) return null
  if (typeof dataUrl !== 'string') return { reason: 'picture_data_url_not_string' }
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl)
  if (!m) return { reason: 'picture_data_url_invalid' }
  const mime = m[1].toLowerCase()
  const b64 = m[2]
  // Decoded size ≈ 3/4 of base64 length; exact enough for a cap check.
  if (Math.floor(b64.length * 3 / 4) > MAX_PICTURE_BYTES) return { reason: 'picture_too_large' }
  let bytes: Uint8Array
  try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }
  catch { return { reason: 'picture_data_url_invalid' } }
  if (bytes.length === 0) return { reason: 'picture_data_url_invalid' }
  return { b64, bytes, mime }
}

// Store the owner's chosen avatar bytes in R2 under a content-addressed key
// beneath the instance's avatar prefix, and return the stable public URL.
// Returns null on any failure (caller leaves profile_pic_url unchanged).
async function cacheOwnAvatar(instanceId: string, bytes: Uint8Array, mime: string): Promise<string | null> {
  try {
    const digestBuf = await crypto.subtle.digest('SHA-256', bytes)
    const hex = [...new Uint8Array(digestBuf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
    // .jpg suffix mirrors the worker's avatarKey convention (cosmetic — the
    // object is served with its real Content-Type). Prefix avatars/<id>/ so the
    // instance-delete R2 prefix sweep reaps it.
    const key = `avatars/${instanceId}/${hex}.jpg`
    const url =
      `${R2_ENDPOINT.replace(/\/+$/, '')}` +
      `/${encodeURIComponent(R2_BUCKET)}` +
      `/${key.split('/').map(encodeURIComponent).join('/')}`
    const res = await r2.fetch(url, {
      method: 'PUT',
      headers: { 'content-type': mime, 'cache-control': 'public, max-age=31536000, immutable' },
      body: bytes,
    })
    if (!res.ok) {
      console.error('instance-wa-profile.avatar_put_failed', res.status, (await res.text().catch(() => '')).slice(0, 200))
      return null
    }
    return `https://${R2_PUBLIC_DOMAIN}/${key}`
  } catch (err) {
    console.error('instance-wa-profile.avatar_cache_failed', err instanceof Error ? err.message : err)
    return null
  }
}

Deno.serve((req) =>
  withInstance(req, async (ctx) => {
    // withInstance already consumed the request stream; use its parsed body
    // (re-reading req here returns empty).
    const raw = ctx.body
    const rawFields = (raw as { fields?: unknown }).fields
    const fields: Field[] = Array.isArray(rawFields)
      ? rawFields.filter((f): f is Field => ALL.includes(f as Field))
      : ALL
    if (fields.length === 0) return json({ ok: false, reason: 'no_fields_selected' }, { status: 400 })

    const { data: row, error } = await admin
      .schema('whatsapp')
      .from('whatsapp_instances')
      .select('wa_profile_name, wa_profile_status, profile_pic_url')
      .eq('id', ctx.instanceId)
      .maybeSingle()
    if (error) return json({ ok: false, reason: 'lookup_failed', error: error.message }, { status: 500 })
    if (!row)  return json({ ok: false, reason: 'not_found' }, { status: 404 })

    const results: Record<Field, 'ok' | 'failed' | 'skipped'> = { name: 'skipped', status: 'skipped', picture: 'skipped' }

    if (fields.includes('name') && row.wa_profile_name) {
      const r = await updateWaProfileName(ctx.evolutionBaseUrl, ctx.evolutionInstanceName, row.wa_profile_name)
      results.name = r.ok ? 'ok' : 'failed'
    }
    if (fields.includes('status') && row.wa_profile_status !== null && row.wa_profile_status !== undefined) {
      const r = await updateWaProfileStatus(ctx.evolutionBaseUrl, ctx.evolutionInstanceName, row.wa_profile_status)
      results.status = r.ok ? 'ok' : 'failed'
    }
    if (fields.includes('picture')) {
      // Prefer the freshly-picked file (data URL from the browser); fall back
      // to re-pushing the stored avatar URL (the original v8 behavior).
      const picked = extractPicture((raw as { picture_data_url?: unknown }).picture_data_url)
      if (picked && 'reason' in picked) {
        return json({ ok: false, reason: picked.reason }, { status: 400 })
      }
      if (picked) {
        const r = await updateWaProfilePicture(ctx.evolutionBaseUrl, ctx.evolutionInstanceName, picked.b64)
        results.picture = r.ok ? 'ok' : 'failed'
        // On a successful WhatsApp push, persist the new avatar to R2 + DB so
        // every UI surface reflects it immediately (see header note). Best
        // effort: a caching failure leaves the OLD url but the WA push still
        // succeeded, so we don't downgrade results.picture.
        if (r.ok) {
          const cachedUrl = await cacheOwnAvatar(ctx.instanceId, picked.bytes, picked.mime)
          if (cachedUrl) {
            const { error: upErr } = await admin
              .schema('whatsapp')
              .from('whatsapp_instances')
              .update({ profile_pic_url: cachedUrl })
              .eq('id', ctx.instanceId)
            if (upErr) console.error('instance-wa-profile.avatar_db_update_failed', upErr.message)
          }
        }
      } else if (row.profile_pic_url) {
        const r = await updateWaProfilePicture(ctx.evolutionBaseUrl, ctx.evolutionInstanceName, row.profile_pic_url)
        results.picture = r.ok ? 'ok' : 'failed'
      }
    }

    return json({ ok: true, results }, { status: 200 })
  }),
)
