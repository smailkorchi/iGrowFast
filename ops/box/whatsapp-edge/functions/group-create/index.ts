// group-create
// Admins AND assigned agents. Creates a WhatsApp group on the given instance.
// Body: { instance_id: string, subject: string, participants: string[] }

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin } from '../_shared/admin.ts'
import { json } from '../_shared/cors.ts'
import { createGroup, updateGroupPicture } from '../_shared/evolution.ts'
import { appendOwnGroupEvent } from '../_shared/groupEvents.ts'
import { withInstance } from '../_shared/instance.ts'

Deno.serve((req) =>
  withInstance(req, async (ctx) => {
    // Use the body withInstance already parsed — the request stream is consumed
    // there, so re-reading req.json()/req.clone().json() yields an empty body
    // (this is exactly what was 400-ing every group create).
    const raw = ctx.body

    const subject = (raw as { subject?: unknown })?.subject
    const participants = (raw as { participants?: unknown })?.participants
    if (typeof subject !== 'string' || subject.trim() === '') {
      return json({ ok: false, reason: 'invalid_subject' }, { status: 400 })
    }
    if (!Array.isArray(participants) || participants.length === 0) {
      return json({ ok: false, reason: 'invalid_participants' }, { status: 400 })
    }

    const image = (raw as { image?: unknown })?.image

    const evo = await createGroup(ctx.evolutionInstanceName, subject, participants as string[])
    if (!evo.ok) {
      return json({
        ok: false, reason: 'evolution_group_create_failed',
        status: evo.status, evolution_error: evo.body,
      }, { status: 502 })
    }

    const groupJid = (evo.body as { id?: string })?.id
      ?? (evo.body as { groupJid?: string })?.groupJid

    if (typeof image === 'string' && image.length > 0 && groupJid) {
      const picResult = await updateGroupPicture(ctx.evolutionInstanceName, groupJid, image)
      if (!picResult.ok) {
        return json({ ok: true, result: evo.body, picture_error: picResult.body })
      }
    }

    // Materialize the conversation row + assign the creator NOW, via the
    // service-role client (bypasses RLS AND the is_admin gate on
    // ensure_conversation, which would 403 a non-admin agent). We return its id
    // so the frontend navigates straight to it — no client-side ensure/claim
    // that could 403/hang and leave the create panel frozen. Idempotent: if the
    // worker webhook already created the row, we reuse it.
    let conversationId: string | null = null
    if (groupJid) {
      await appendOwnGroupEvent(ctx.instanceId, groupJid, 'create', [])
      try {
        const { data: existing } = await admin.schema('whatsapp').from('conversations').select('id')
          .eq('instance_id', ctx.instanceId).eq('remote_jid', groupJid).maybeSingle()
        conversationId = (existing as { id?: string } | null)?.id ?? null
        if (!conversationId) {
          const { data: ins, error: insErr } = await admin.schema('whatsapp').from('conversations')
            .insert({ instance_id: ctx.instanceId, remote_jid: groupJid, is_group: true, peer_display_name: subject.trim(), status: 'open', unread_count: 0, is_pinned: false, is_archived: false })
            .select('id').single()
          if (insErr) {
            const { data: again } = await admin.schema('whatsapp').from('conversations').select('id')
              .eq('instance_id', ctx.instanceId).eq('remote_jid', groupJid).maybeSingle()
            conversationId = (again as { id?: string } | null)?.id ?? null
          } else {
            conversationId = (ins as { id?: string } | null)?.id ?? null
          }
        }
        if (conversationId) {
          await admin.schema('whatsapp').from('conversation_assignments')
            .upsert({ conversation_id: conversationId, user_id: ctx.callerUid, assigned_by: ctx.callerUid, is_group: true }, { onConflict: 'conversation_id,user_id' })
        }
      } catch { /* best-effort; worker webhook is the backstop */ }
    }

    return json({ ok: true, result: evo.body, conversation_id: conversationId })
  }, { allowUsers: true }),
)
