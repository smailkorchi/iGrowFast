// iGrowFast port of WA Mancer _shared/admin.ts.
// L1 IDENTITY REWRITE (the only change vs source): WA Mancer's requireAdmin gated on the global
// rpc('is_admin'); iGrowFast "admin" = ACTIVE business admin (public.users.role in
// ('super admin','admin') with a "DigiCom Business"). requireAdmin also returns businessId so
// instance-scoped fns can stamp/verify tenant ownership. Instance-level authorization is enforced
// AGAIN in the DB by whatsapp.is_wa_admin() inside every SECURITY DEFINER RPC — this edge gate is
// the outer layer, not the only one.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const URL  = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SR   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/** Service-role client. Bypasses RLS and can call auth.admin.*. */
export const admin: SupabaseClient = createClient(URL, SR, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** Public anon client (no session). */
export const anon: SupabaseClient = createClient(URL, ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** Build a client scoped to the caller's JWT — used to verify identity + run RLS-aware RPCs. */
export function asCaller(jwt: string): SupabaseClient {
  return createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Returns { uid, client, businessId } when the caller's JWT is valid and they're an ACTIVE
 *  business admin (super admin/admin of a business), otherwise null. */
export async function requireAdmin(
  req: Request,
): Promise<{ uid: string; client: SupabaseClient; businessId: string } | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const jwt = auth.slice(7).trim()
  if (!jwt) return null

  const caller = asCaller(jwt)
  const { data: u, error: ue } = await caller.auth.getUser()
  if (ue || !u?.user) return null

  const { data: row, error: re } = await caller
    .from('users')
    .select('role, active, "DigiCom Business"')
    .eq('id', u.user.id)
    .single()
  if (re || !row || !row.active) return null
  if (row.role !== 'super admin' && row.role !== 'admin') return null
  const businessId = row['DigiCom Business'] as string | null
  if (!businessId) return null

  return { uid: u.user.id, client: caller, businessId }
}

/** Returns { uid, client } for ANY valid authenticated user (admin or agent).
 *  Used by features agents are allowed to perform (e.g. group create/edit in the
 *  shared inbox), where requireAdmin would wrongly 403 them. */
export async function requireUser(req: Request): Promise<{ uid: string; client: SupabaseClient } | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const jwt = auth.slice(7).trim()
  if (!jwt) return null

  const caller = asCaller(jwt)
  const { data: u, error: ue } = await caller.auth.getUser()
  if (ue || !u?.user) return null

  return { uid: u.user.id, client: caller }
}
