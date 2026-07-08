// instance-presence
//
// Admin-only. Sets the per-instance `manual_presence` column AND, when the
// new value is not 'auto', immediately projects that presence to all WA peers
// via Evolution's /chat/sendPresence (Baileys' sendPresenceUpdate).
//
// The DB write happens through set_instance_settings (single mutation path).
// We use service-role to bypass RLS on the WA-owner-JID lookup we need for
// the Baileys call, then call set_instance_settings via the CALLER's client
// so the is_admin() guard fires under the caller's auth context.
//
// Body: { instance_id: uuid, state: 'auto' | 'online' | 'offline' }
// Returns: { ok, state, evolution_status? }

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin } from '../_shared/admin.ts'
import { json } from '../_shared/cors.ts'
import { setOwnPresence } from '../_shared/evolution.ts'
import { withInstance } from '../_shared/instance.ts'

type PresenceState = 'auto' | 'online' | 'offline'

function isValidState(s: unknown): s is PresenceState {
  return s === 'auto' || s === 'online' || s === 'offline'
}

Deno.serve((req) =>
  withInstance(req, async (ctx) => {
    // Read `state` from the body withInstance already parsed. The request
    // stream was consumed there, so re-reading req.clone().json() returns an
    // empty body — that was the 400 invalid_state on every presence toggle.
    const state = ctx.body.state
    if (!isValidState(state)) {
      return json({ ok: false, reason: 'invalid_state' }, { status: 400 })
    }

    // 1. Persist intent via the canonical settings RPC (caller-scoped so
    //    is_admin() passes under the caller's JWT).
    const { error: rpcErr } = await ctx.callerClient.schema('whatsapp').rpc('set_instance_settings', {
      p_instance_id: ctx.instanceId,
      p_patch: { manual_presence: state },
    })
    if (rpcErr) {
      return json({ ok: false, reason: 'persist_failed', error: rpcErr.message }, { status: 500 })
    }

    // 2. If admin wants 'auto', stop here — the dispatcher will manage
    //    presence based on alwaysOnline / per-action 'composing'.
    if (state === 'auto') {
      return json({ ok: true, state }, { status: 200 })
    }

    // 3. Fetch the owner JID for the Baileys broadcast. Service-role read so
    //    we get it even if RLS would otherwise hide it.
    const { data: row, error: lookupErr } = await admin
      .schema('whatsapp')
      .from('whatsapp_instances')
      .select('wa_owner_jid')
      .eq('id', ctx.instanceId)
      .maybeSingle()
    if (lookupErr) {
      return json({ ok: false, reason: 'owner_lookup_failed', error: lookupErr.message }, { status: 500 })
    }
    const ownerJid = row?.wa_owner_jid
    if (!ownerJid) {
      // Number isn't paired / no JID yet. Persistence already succeeded; the
      // dispatcher will pick this up after pairing.
      return json({ ok: true, state, note: 'no_owner_jid_yet' }, { status: 200 })
    }

    // 4. Fire the Baileys presence update.
    const presence = state === 'online' ? 'available' : 'unavailable'
    const evo = await setOwnPresence(ctx.evolutionBaseUrl, ctx.evolutionInstanceName, ownerJid, presence)
    if (!evo.ok) {
      // The DB write already succeeded; the Evolution call is best-effort.
      // Surface the failure but return ok so the UI reflects the persisted
      // intent — the dispatcher will reproject on its next tick.
      return json({
        ok: true, state, note: 'evolution_call_failed',
        evolution_status: evo.status, evolution_error: evo.body,
      }, { status: 200 })
    }

    return json({ ok: true, state, evolution_status: evo.status }, { status: 200 })
  }),
)
