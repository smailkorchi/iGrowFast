// instance-disconnect
// Admin-only. Tells Evolution to log out the Baileys session. DB row stays;
// status will transition via the connection.update webhook. Worker stops
// dispatching this number automatically once status leaves 'connected'.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { json } from '../_shared/cors.ts'
import { logoutInstance } from '../_shared/evolution.ts'
import { withInstance } from '../_shared/instance.ts'

Deno.serve((req) =>
  withInstance(req, async (ctx) => {
    const evo = await logoutInstance(ctx.evolutionBaseUrl, ctx.evolutionInstanceName)
    // 404 from Evolution = instance already gone there; treat as success.
    if (!evo.ok && evo.status !== 404) {
      return json({
        ok: false, reason: 'evolution_logout_failed',
        status: evo.status, evolution_error: evo.body,
      }, { status: 502 })
    }
    return json({ ok: true }, { status: 200 })
  }),
)
