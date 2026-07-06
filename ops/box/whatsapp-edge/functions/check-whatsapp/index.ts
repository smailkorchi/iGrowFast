// check-whatsapp
// Admin-only. Checks whether a list of phone numbers have WhatsApp accounts.
// Body: { instance_id: string, numbers: string[] }
// Returns the raw Evolution response so the caller can inspect each number's
// exists/jid fields.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { json } from '../_shared/cors.ts'
import { checkWhatsApp } from '../_shared/evolution.ts'
import { withInstance } from '../_shared/instance.ts'

Deno.serve((req) =>
  withInstance(req, async (ctx) => {
    // withInstance already consumed the request stream; use its parsed body
    // (re-reading req here returns empty → false 400s).
    const raw = ctx.body

    const numbers = (raw as { numbers?: unknown })?.numbers
    if (!Array.isArray(numbers) || numbers.length === 0) {
      return json({ ok: false, reason: 'invalid_numbers' }, { status: 400 })
    }

    const evo = await checkWhatsApp(ctx.evolutionInstanceName, numbers as string[])
    if (!evo.ok) {
      return json({
        ok: false, reason: 'evolution_check_failed',
        status: evo.status, evolution_error: evo.body,
      }, { status: 502 })
    }
    return json({ ok: true, result: evo.body })
  }),
)
