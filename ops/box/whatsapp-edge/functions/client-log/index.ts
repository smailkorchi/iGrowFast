// client-log: browser runtime errors -> system_logs source='client'. JWT-gated (actor_uid from the
// verified token only, never client input). Fire-and-forget ingest; always benign response.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin, requireUser } from '../_shared/admin.ts'
import { capPayload, scrubStr } from '../_shared/sanitizeLog.ts'
import { json, preflight } from '../_shared/cors.ts'
Deno.serve(async (req) => {
  try {
    const pre = preflight(req); if (pre) return pre
    if (req.method !== 'POST') return json({ ok: false }, { status: 405 })
    const caller = await requireUser(req); if (!caller) return json({ ok: false, reason: 'unauth' }, { status: 401 })
    let raw: unknown; try { raw = await req.json() } catch { return json({ ok: false, reason: 'invalid_input' }, { status: 400 }) }
    const b = (raw ?? {}) as Record<string, unknown>
    const kindIn = String(b.kind ?? 'error')
    const kind = ['error', 'unhandledrejection', 'react', 'ratelimited'].includes(kindIn) ? kindIn : 'error'
    const entry = {
      occurred_at: new Date().toISOString(), source: 'client', level: 'error', event: `client.${kind}`,
      worker_id: null, instance_id: null, conversation_id: null, actor_uid: caller.uid, target_type: null, target_id: null,
      payload: capPayload({
        message: scrubStr(String(b.message ?? '')).slice(0, 600),
        stack_top: b.stack_top ? scrubStr(String(b.stack_top)).slice(0, 600) : null,
        route: scrubStr(String(b.route ?? '')).slice(0, 200),
        ua: String(b.ua ?? '').slice(0, 200), kind,
      }),
    }
    void admin.schema('whatsapp').rpc('ingest_system_logs', { p_entries: [entry] }).then(() => {}, () => {})
    return json({ ok: true })
  } catch (err) { return json({ ok: false, reason: 'exception', detail: err instanceof Error ? err.message : String(err) }, { status: 500 }) }
})
