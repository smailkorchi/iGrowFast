// Shared helper for the five admin-gated instance-lifecycle edge functions
// (pair / disconnect / restart / delete / status).
//
// Each of them follows the same shape:
//   1. preflight + admin check
//   2. read instance_id from body
//   3. look up evolution_instance_name
//   4. call Evolution
//   5. return result
//
// `withInstance` collapses 1–3 so the per-function index.ts is ~15 lines.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { admin, requireAdmin, requireUser } from './admin.ts'
import { json, preflight } from './cors.ts'
import { logError } from './logError.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface InstanceCtx {
  instanceId: string
  evolutionInstanceName: string
  callerUid: string
  /** Supabase client scoped to the admin caller's JWT. Use this when invoking
   *  RPCs that gate on is_admin()/auth.uid(); the service-role `admin`
   *  client has no auth context and would fail those checks. */
  callerClient: SupabaseClient
  /** The already-parsed request body. The request stream is consumed here, so
   *  handlers MUST read extra fields from this — re-reading req.json() (even
   *  via req.clone()) yields an empty body and breaks (was the 400 on the
   *  presence toggle). */
  body: Record<string, unknown>
}

/**
 * Common admin-gated lookup. Returns a Response on any failure, or the ctx
 * the handler should use.
 */
export async function withInstance(
  req: Request,
  handler: (ctx: InstanceCtx) => Promise<Response>,
  opts?: { allowUsers?: boolean },
): Promise<Response> {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, { status: 405 })

  // Lifecycle fns (pair/delete/restart/...) stay admin-only (default). Group
  // fns opt into allowUsers so agents can create/manage groups they work.
  const caller = opts?.allowUsers ? await requireUser(req) : await requireAdmin(req)
  if (!caller) return json({ ok: false, reason: 'forbidden' }, { status: 403 })

  let raw: unknown
  try { raw = await req.json() }
  catch { return json({ ok: false, reason: 'invalid_input' }, { status: 400 }) }

  const instanceId = (raw as { instance_id?: unknown })?.instance_id
  if (typeof instanceId !== 'string' || !UUID_RE.test(instanceId)) {
    return json({ ok: false, reason: 'invalid_instance_id' }, { status: 400 })
  }

  const { data: row, error } = await admin
    .schema('whatsapp')
    .from('whatsapp_instances')
    .select('id, evolution_instance_name')
    .eq('id', instanceId)
    .maybeSingle()

  if (error) return json({ ok: false, reason: 'lookup_failed', error: error.message }, { status: 500 })
  if (!row)  return json({ ok: false, reason: 'not_found' }, { status: 404 })

  try {
    return await handler({
      instanceId: row.id as string,
      evolutionInstanceName: row.evolution_instance_name as string,
      callerUid: caller.uid,
      callerClient: caller.client,
      body: (raw ?? {}) as Record<string, unknown>,
    })
  } catch (err) {
    let fn = 'instance'
    try { fn = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? 'instance' } catch { /* keep default */ }
    logError(fn, err, { status: 500, extra: { instance_id: instanceId } })
    return json({
      ok: false, reason: 'handler_threw',
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }
}
