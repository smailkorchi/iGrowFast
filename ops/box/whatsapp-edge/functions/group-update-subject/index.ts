// group-update-subject
// Admin-only. Renames a WhatsApp group on the given instance.
// Body: { instance_id: string, group_jid: string, subject: string }

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { json } from '../_shared/cors.ts'
import { updateGroupSubject } from '../_shared/evolution.ts'
import { appendOwnGroupEvent } from '../_shared/groupEvents.ts'
import { withInstance } from '../_shared/instance.ts'

Deno.serve((req) =>
  withInstance(req, async (ctx) => {
    const b = ctx.body as { group_jid?: unknown; subject?: unknown }
    const groupJid = b.group_jid
    if (typeof groupJid !== 'string' || !groupJid.endsWith('@g.us')) {
      return json({ ok: false, reason: 'invalid_group_jid' }, { status: 400 })
    }
    const subject = typeof b.subject === 'string' ? b.subject.trim() : ''
    if (!subject || subject.length > 100) {
      return json({ ok: false, reason: 'invalid_subject' }, { status: 400 })
    }

    const evo = await updateGroupSubject(ctx.evolutionBaseUrl, ctx.evolutionInstanceName, groupJid, subject)
    if (!evo.ok) {
      return json({
        ok: false, reason: 'evolution_update_subject_failed',
        status: evo.status, evolution_error: evo.body,
      }, { status: 502 })
    }

    // Instant "Vous avez modifié le nom du groupe en « X »" pill (deduped vs the
    // chats.update-driven worker detection).
    await appendOwnGroupEvent(ctx.instanceId, groupJid, 'subject', [], subject)

    return json({ ok: true, result: evo.body })
  }, { allowUsers: true }),
)
