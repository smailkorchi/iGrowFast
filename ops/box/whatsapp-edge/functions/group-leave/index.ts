// group-leave
// Admin-only. The WhatsApp number leaves a group on the given instance.
// Body: { instance_id: string, group_jid: string }

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin } from '../_shared/admin.ts'
import { json } from '../_shared/cors.ts'
import { leaveGroup } from '../_shared/evolution.ts'
import { appendOwnGroupEvent } from '../_shared/groupEvents.ts'
import { withInstance } from '../_shared/instance.ts'

Deno.serve((req) =>
  withInstance(req, async (ctx) => {
    // withInstance already consumed the request stream — read from ctx.body.
    const groupJid = (ctx.body as { group_jid?: unknown })?.group_jid
    if (typeof groupJid !== 'string' || !groupJid.endsWith('@g.us')) {
      return json({ ok: false, reason: 'invalid_group_jid' }, { status: 400 })
    }

    const evo = await leaveGroup(ctx.evolutionInstanceName, groupJid)
    if (!evo.ok) {
      return json({
        ok: false, reason: 'evolution_leave_failed',
        status: evo.status, evolution_error: evo.body,
      }, { status: 502 })
    }

    // Mark the conversation left so the UI swaps the composer for the
    // "no longer a member" notice (propagates to all agents via Realtime).
    await admin
      .schema('whatsapp')
      .from('conversations')
      .update({ left_at: new Date().toISOString() })
      .eq('instance_id', ctx.instanceId)
      .eq('remote_jid', groupJid)

    // Remove OURSELVES from the stored member list so the info panel stops
    // showing the number as a participant (count drops by 1). Match by the
    // owner's phone digits in either jid column.
    const { data: inst } = await admin
      .schema('whatsapp')
      .from('whatsapp_instances')
      .select('wa_owner_jid')
      .eq('id', ctx.instanceId)
      .maybeSingle()
    const ownerDigits = String((inst as { wa_owner_jid?: string } | null)?.wa_owner_jid ?? '')
      .replace(/@.*$/, '').replace(/[^0-9]/g, '')
    if (ownerDigits) {
      await admin
        .schema('whatsapp')
        .from('group_participants')
        .delete()
        .eq('instance_id', ctx.instanceId)
        .eq('group_jid', groupJid)
        .or(`phone_jid.like.${ownerDigits}@%,participant_jid.like.${ownerDigits}@%`)
    }

    // Instant "Vous avez quitté le groupe" pill (deduped against the webhook echo).
    await appendOwnGroupEvent(ctx.instanceId, groupJid, 'leave', [])

    return json({ ok: true, result: evo.body })
  }, { allowUsers: true }),
)
