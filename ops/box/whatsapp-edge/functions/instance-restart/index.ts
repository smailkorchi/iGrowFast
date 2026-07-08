// instance-restart
// Admin-only. Restarts the Baileys session WITHOUT unpairing. Use to recover
// from a stuck state (websocket dead but session still authenticated).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { json } from '../_shared/cors.ts'
import { restartInstance } from '../_shared/evolution.ts'
import { withInstance } from '../_shared/instance.ts'

Deno.serve((req) =>
  withInstance(req, async (ctx) => {
    const evo = await restartInstance(ctx.evolutionBaseUrl, ctx.evolutionInstanceName)
    if (!evo.ok) {
      return json({
        ok: false, reason: 'evolution_restart_failed',
        status: evo.status, evolution_error: evo.body,
      }, { status: 502 })
    }
    return json({ ok: true }, { status: 200 })
  }),
)
