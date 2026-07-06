// Standardized edge-fn exception logging. Call in a catch block; fire-and-forget, never throws,
// never alters the handler's HTTP response. Writes system_logs source='edge' via service_role.
import { admin } from './admin.ts'
import { capPayload, sanitizePayload, scrubStr } from './sanitizeLog.ts'
export function logError(fn: string, err: unknown, opts: { status?: number; level?: 'warn' | 'error'; request_id?: string; extra?: Record<string, unknown> } = {}): void {
  try {
    const message = scrubStr(err instanceof Error ? err.message : String(err))
    const stack_top = err instanceof Error && err.stack ? scrubStr(err.stack.split('\n').slice(0, 4).join(' | ')) : null
    const payload = { ...capPayload({ fn, message, stack_top, status: opts.status ?? null, request_id: opts.request_id ?? null }), ...(opts.extra ? { extra: sanitizePayload(opts.extra) } : {}) }
    const entry = { occurred_at: new Date().toISOString(), source: 'edge', level: opts.level ?? 'error', event: `edge.${fn}.exception`, worker_id: null, instance_id: null, conversation_id: null, actor_uid: null, target_type: null, target_id: null, payload }
    void admin.schema('whatsapp').rpc('ingest_system_logs', { p_entries: [entry] }).then(() => {}, () => {})
  } catch { /* logging must never throw */ }
}
