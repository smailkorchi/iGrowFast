// instance-wa-settings
//
// Admin-only. Reads the current per-instance WA peer-side flag columns from
// our DB and pushes them to Evolution's /settings/set/<name>. Use after the
// admin toggles any of: wa_reject_calls, wa_call_reply_text, wa_always_online,
// wa_auto_read_inbound, wa_read_status, wa_ignore_groups, wa_sync_full_history.
//
// We don't accept the values in the body — the UI writes them to our DB via
// set_instance_settings RPC first, then calls this function to push to WA.
// Single source of truth = DB.
//
// Body: { instance_id: uuid }

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin } from '../_shared/admin.ts'
import { json } from '../_shared/cors.ts'
import { setInstanceBehavior } from '../_shared/evolution.ts'
import { withInstance } from '../_shared/instance.ts'

Deno.serve((req) =>
  withInstance(req, async (ctx) => {
    const { data: row, error } = await admin
      .schema('whatsapp')
      .from('whatsapp_instances')
      .select('wa_reject_calls, wa_call_reply_text, wa_always_online, wa_auto_read_inbound, wa_read_status, wa_ignore_groups, wa_sync_full_history')
      .eq('id', ctx.instanceId)
      .maybeSingle()
    if (error) return json({ ok: false, reason: 'lookup_failed', error: error.message }, { status: 500 })
    if (!row)  return json({ ok: false, reason: 'not_found' }, { status: 404 })

    const evo = await setInstanceBehavior(ctx.evolutionBaseUrl, ctx.evolutionInstanceName, {
      rejectCall:      row.wa_reject_calls,
      msgCall:         row.wa_call_reply_text ?? '',
      alwaysOnline:    row.wa_always_online,
      readMessages:    row.wa_auto_read_inbound,
      readStatus:      row.wa_read_status,
      groupsIgnore:    row.wa_ignore_groups,
      syncFullHistory: row.wa_sync_full_history,
    })
    if (!evo.ok) {
      return json({ ok: false, reason: 'evolution_set_failed', status: evo.status, evolution_error: evo.body }, { status: 502 })
    }
    return json({ ok: true, evolution_status: evo.status }, { status: 200 })
  }),
)
