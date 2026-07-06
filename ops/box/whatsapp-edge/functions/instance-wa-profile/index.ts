// instance-wa-profile
//
// Admin-only. Pushes our app-side profile fields up to WhatsApp via Evolution:
//   - wa_profile_name   -> /chat/updateProfileName
//   - wa_profile_status -> /chat/updateProfileStatus
//   - profile_pic_url   -> /chat/updateProfilePicture
//
// Body shape: { instance_id, fields: ('name'|'status'|'picture')[] }
// Returns: { ok, results: { [field]: 'ok' | 'failed' } }

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin } from '../_shared/admin.ts'
import { json } from '../_shared/cors.ts'
import { updateWaProfileName, updateWaProfileStatus, updateWaProfilePicture } from '../_shared/evolution.ts'
import { withInstance } from '../_shared/instance.ts'

type Field = 'name' | 'status' | 'picture'
const ALL: Field[] = ['name', 'status', 'picture']

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
    if (fields.includes('picture') && row.profile_pic_url) {
      const r = await updateWaProfilePicture(ctx.evolutionInstanceName, row.profile_pic_url)
      results.picture = r.ok ? 'ok' : 'failed'
    }

    return json({ ok: true, results }, { status: 200 })
  }),
)
