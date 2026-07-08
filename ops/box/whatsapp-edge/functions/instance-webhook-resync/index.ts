// instance-webhook-resync
//
// Operational rescue button. Pushes our canonical event-list to the existing
// Evolution instance's webhook subscription via /webhook/set/<name>. Use
// when a new event type was added to the worker code but pre-existing
// instances are still on the old subscription (see the CONTACTS_UPSERT
// rollout incident).
//
// Body: { instance_id: uuid }

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin } from '../_shared/admin.ts'
import { json } from '../_shared/cors.ts'
import { setInstanceWebhook } from '../_shared/evolution.ts'
import { withInstance } from '../_shared/instance.ts'

const WORKER_WEBHOOK_URL_BASE = (Deno.env.get('WORKER_WEBHOOK_URL_BASE') ?? 'http://wa-mancer-worker:8090/webhook').replace(/\/$/, '')

const CANONICAL_EVENTS = [
  'MESSAGES_UPSERT','MESSAGES_UPDATE','MESSAGES_DELETE','MESSAGES_SET',
  'CONNECTION_UPDATE','QRCODE_UPDATED','SEND_MESSAGE',
  'CONTACTS_UPSERT','CONTACTS_UPDATE','CHATS_UPSERT','CHATS_UPDATE',
  // Realtime peer-typing + online/last-seen — drives the WA-style "typing…"
  // dots in the chat header + bubble. Without this Evolution never forwards
  // presence events so the UI can't show typing for inbound peers.
  'PRESENCE_UPDATE',
  // Group lifecycle. GROUPS_UPDATE/UPSERT carry subject/description/icon
  // changes; GROUP_PARTICIPANTS_UPDATE is the authoritative add/remove/promote/
  // demote roster delta (drives group_participants sync, owner left_at set/
  // clear, and the system-event pill fallback when the messages.upsert stub
  // channel is stripped).
  // NB: Evolution v2.3.7's subscription enum uses GROUP_UPDATE (singular) —
  // GROUPS_UPDATE is rejected (400). The delivered webhook envelope is still
  // `groups.update` / `group-participants.update`, which the worker handles.
  'GROUPS_UPSERT','GROUP_UPDATE','GROUP_PARTICIPANTS_UPDATE',
]

Deno.serve((req) =>
  withInstance(req, async (ctx) => {
    // Decrypt the per-instance webhook secret so we can include it in the
    // header config we push to Evolution.
    const { data: secretData, error: secretErr } = await admin.schema('whatsapp').rpc(
      'reveal_instance_webhook_secret',
      { p_instance_id: ctx.instanceId },
    )
    if (secretErr) return json({ ok: false, reason: 'secret_lookup_failed', error: secretErr.message }, { status: 500 })
    const secret = secretData as string | null
    if (!secret) return json({ ok: false, reason: 'no_webhook_secret' }, { status: 500 })

    const evo = await setInstanceWebhook(ctx.evolutionBaseUrl, ctx.evolutionInstanceName, {
      enabled: true,
      url: `${WORKER_WEBHOOK_URL_BASE}/${ctx.instanceId}`,
      base64: false,
      byEvents: false,
      events: CANONICAL_EVENTS,
      headers: { 'x-wa-mancer-secret': secret },
    })
    if (!evo.ok) {
      return json({ ok: false, reason: 'evolution_webhook_set_failed', status: evo.status, evolution_error: evo.body }, { status: 502 })
    }
    return json({ ok: true, events: CANONICAL_EVENTS, evolution_status: evo.status }, { status: 200 })
  }),
)
