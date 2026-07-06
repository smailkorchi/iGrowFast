// instance-pair
// Admin-only. FORCES a fresh pairing QR for an instance.
//
// Why restart, not bare connect: Baileys' QR loop is finite (~5 codes / ~2 min)
// then the socket closes. A passive GET /instance/connect on a closed socket
// does NOT spawn a new loop — so "Refresh QR" was a no-op once the window
// lapsed (the dominant cause of "scanning does nothing"). POST /instance/restart
// tears the socket down and starts a brand-new QR loop; connect then returns the
// first code. Fresh codes also arrive via the qrcode.updated webhook → DB →
// Realtime, so the dialog keeps rotating regardless of this response.
//
// Guard: never restart an already-connected instance — that would disconnect a
// live number if the dialog is opened on a connected one. If connectionState is
// 'open' we report connected and do nothing.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { json } from '../_shared/cors.ts'
import { connectInstance, connectionState, restartInstance } from '../_shared/evolution.ts'
import { withInstance } from '../_shared/instance.ts'

function readState(body: unknown): string | null {
  const s = body as { instance?: { state?: unknown }; state?: unknown } | null
  const v = s?.instance?.state ?? s?.state
  return typeof v === 'string' ? v : null
}

function hasQr(body: unknown): boolean {
  const b = body as { base64?: unknown; code?: unknown } | null
  return typeof b?.base64 === 'string' || typeof b?.code === 'string'
}

Deno.serve((req) =>
  withInstance(req, async (ctx) => {
    // 1. Already connected? Do not restart — that would drop a live session.
    const st = await connectionState(ctx.evolutionInstanceName)
    if (st.ok && readState(st.body) === 'open') {
      return json({ ok: true, connected: true, qr: { state: 'open' } }, { status: 200 })
    }

    // 2. Force a fresh Baileys socket + QR loop. Tolerate a restart failure
    //    (e.g. instance never connected yet) and fall through to connect.
    await restartInstance(ctx.evolutionInstanceName)

    // 3. Pull the first code of the new loop.
    const evo = await connectInstance(ctx.evolutionInstanceName)
    if (!evo.ok) {
      return json({
        ok: false, reason: 'evolution_connect_failed',
        status: evo.status, evolution_error: evo.body,
      }, { status: 502 })
    }

    // 4. Right after restart Baileys may not have minted the code yet. Rather
    //    than ship an empty QR (infinite shimmer with no recovery), report
    //    not-ready with ok:true so the client doesn't throw — the real code
    //    lands via the qrcode.updated webhook → Realtime within ~1–2s.
    if (!hasQr(evo.body)) {
      return json({ ok: true, qr_pending: true, qr: {} }, { status: 200 })
    }

    return json({ ok: true, qr: evo.body }, { status: 200 })
  }),
)
