// instance-status
// Admin-only. Snapshots Evolution-side state for a number: connection state,
// owner JID, profile, settings. Used by the Numbers detail page's "Refresh"
// action and the linked-device audit display.
//
// Note: Evolution v2.3.7 does not expose a dedicated "linked devices"
// endpoint (the WhatsApp device list is a Baileys-internal concept). This
// returns what Evolution does expose — connection + owner info — which is
// sufficient for the operator to confirm the right number is paired.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { json } from '../_shared/cors.ts'
import { connectionState, fetchInstanceDetail } from '../_shared/evolution.ts'
import { withInstance } from '../_shared/instance.ts'

Deno.serve((req) =>
  withInstance(req, async (ctx) => {
    const [state, detail] = await Promise.all([
      connectionState(ctx.evolutionInstanceName),
      fetchInstanceDetail(ctx.evolutionInstanceName),
    ])
    return json({
      ok: true,
      connection_state: state.body,
      detail: detail.body,
    }, { status: 200 })
  }),
)
