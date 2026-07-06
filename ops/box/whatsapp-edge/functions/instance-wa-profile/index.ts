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

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin } from '../_shared/admin.ts'
import { json } from '../_shared/cors.ts'
import { updateWaProfileName, updateWaProfileStatus, updateWaProfilePicture } from '../_shared/evolution.ts'
import { withInstance } from '../_shared/instance.ts'

type Field = 'name' | 'status' | 'picture'
const ALL: Field[] = ['name', 'status', 'picture']

// Hard cap on the decoded image size. The frontend (WaProfileCard) enforces
// the same 5 MB client-side so users fail fast; this is the authoritative gate.
const MAX_PICTURE_BYTES = 5 * 1024 * 1024

// Accepts a browser FileReader data URL for any image type and returns the
// raw base64 payload Evolution expects, or null when invalid/oversized.
function extractPictureBase64(dataUrl: unknown): { b64: string } | { reason: string } | null {
  if (dataUrl === undefined || dataUrl === null) return null
  if (typeof dataUrl !== 'string') return { reason: 'picture_data_url_not_string' }
  const m = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl)
  if (!m) return { reason: 'picture_data_url_invalid' }
  const b64 = m[1]
  // Decoded size ≈ 3/4 of base64 length; exact enough for a cap check.
  if (Math.floor(b64.length * 3 / 4) > MAX_PICTURE_BYTES) return { reason: 'picture_too_large' }
  return { b64 }
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
      const r = await updateWaProfileName(ctx.evolutionInstanceName, row.wa_profile_name)
      results.name = r.ok ? 'ok' : 'failed'
    }
    if (fields.includes('status') && row.wa_profile_status !== null && row.wa_profile_status !== undefined) {
      const r = await updateWaProfileStatus(ctx.evolutionInstanceName, row.wa_profile_status)
      results.status = r.ok ? 'ok' : 'failed'
    }
    if (fields.includes('picture')) {
      // Prefer the freshly-picked file (data URL from the browser); fall back
      // to re-pushing the stored avatar URL (the original v8 behavior).
      const picked = extractPictureBase64((raw as { picture_data_url?: unknown }).picture_data_url)
      if (picked && 'reason' in picked) {
        return json({ ok: false, reason: picked.reason }, { status: 400 })
      }
      if (picked) {
        const r = await updateWaProfilePicture(ctx.evolutionInstanceName, picked.b64)
        results.picture = r.ok ? 'ok' : 'failed'
      } else if (row.profile_pic_url) {
        const r = await updateWaProfilePicture(ctx.evolutionInstanceName, row.profile_pic_url)
        results.picture = r.ok ? 'ok' : 'failed'
      }
    }

    return json({ ok: true, results }, { status: 200 })
  }),
)
