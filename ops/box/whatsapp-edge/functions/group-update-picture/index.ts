// group-update-picture
// Admin-only. Changes (or attempts to remove) a WhatsApp group icon.
// Body: { instance_id, group_jid, image?: string (base64 / data URL) }
//   - image present  → change icon
//   - image omitted/empty → attempt removal (Evolution has no removeGroupPicture
//     endpoint in v2.3.7, so this may fail; the caller surfaces that).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { json } from '../_shared/cors.ts'
import { updateGroupPicture } from '../_shared/evolution.ts'
import { appendOwnGroupEvent } from '../_shared/groupEvents.ts'
import { withInstance } from '../_shared/instance.ts'

Deno.serve((req) =>
  withInstance(req, async (ctx) => {
    const b = ctx.body as { group_jid?: unknown; image?: unknown }
    const groupJid = b.group_jid
    if (typeof groupJid !== 'string' || !groupJid.endsWith('@g.us')) {
      return json({ ok: false, reason: 'invalid_group_jid' }, { status: 400 })
    }
    const rawImage = typeof b.image === 'string' ? b.image : ''
    const removing = rawImage.trim() === ''
    // Strip a data-URL prefix; Evolution wants bare base64.
    const image = rawImage.replace(/^data:[^;]+;base64,/, '')

    const evo = await updateGroupPicture(ctx.evolutionBaseUrl, ctx.evolutionInstanceName, groupJid, image)
    if (!evo.ok) {
      return json({
        ok: false, reason: removing ? 'evolution_remove_picture_unsupported' : 'evolution_update_picture_failed',
        status: evo.status, evolution_error: evo.body,
      }, { status: 502 })
    }

    // Instant icon pill (deduped vs the contacts.update-driven worker detection).
    await appendOwnGroupEvent(ctx.instanceId, groupJid, removing ? 'icon_remove' : 'icon', [])

    return json({ ok: true, result: evo.body })
  }, { allowUsers: true }),
)
