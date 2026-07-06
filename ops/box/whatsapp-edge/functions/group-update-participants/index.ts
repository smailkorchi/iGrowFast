// group-update-participants
// Admin-only. Add / remove / promote / demote group members on an instance.
// Body: { instance_id, group_jid, action: 'add'|'remove'|'promote'|'demote', participants: string[] }

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { json } from '../_shared/cors.ts'
import { updateGroupParticipants } from '../_shared/evolution.ts'
import { appendOwnGroupEvent } from '../_shared/groupEvents.ts'
import { withInstance } from '../_shared/instance.ts'

const ACTIONS = ['add', 'remove', 'promote', 'demote'] as const

Deno.serve((req) =>
  withInstance(req, async (ctx) => {
    // withInstance already consumed the request stream — read from ctx.body.
    const b = ctx.body as { group_jid?: unknown; action?: unknown; participants?: unknown }

    const groupJid = b.group_jid
    if (typeof groupJid !== 'string' || !groupJid.endsWith('@g.us')) {
      return json({ ok: false, reason: 'invalid_group_jid' }, { status: 400 })
    }
    const action = typeof b.action === 'string' ? b.action : 'add'
    if (!ACTIONS.includes(action as typeof ACTIONS[number])) {
      return json({ ok: false, reason: 'invalid_action' }, { status: 400 })
    }
    if (!Array.isArray(b.participants) || b.participants.length === 0) {
      return json({ ok: false, reason: 'invalid_participants' }, { status: 400 })
    }
    // Evolution wants bare digits (no @suffix).
    const participants = (b.participants as unknown[])
      .map((p) => String(p).replace(/@.*$/, '').replace(/[^0-9]/g, ''))
      .filter((p) => p.length > 0)
    if (participants.length === 0) {
      return json({ ok: false, reason: 'invalid_participants' }, { status: 400 })
    }

    const evo = await updateGroupParticipants(
      ctx.evolutionInstanceName, groupJid, action as typeof ACTIONS[number], participants,
    )
    if (!evo.ok) {
      return json({
        ok: false, reason: 'evolution_update_participant_failed',
        status: evo.status, evolution_error: evo.body,
      }, { status: 502 })
    }

    // Instant pill ("Vous avez ajouté X" / retiré / nommé administrateur …),
    // deduped against the webhook stub echo.
    await appendOwnGroupEvent(
      ctx.instanceId, groupJid,
      action as 'add' | 'remove' | 'promote' | 'demote',
      participants,
    )

    return json({ ok: true, result: evo.body })
  }, { allowUsers: true }),
)
