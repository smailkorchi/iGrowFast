// WhatsApp module supabase client. Reuses IGF's SINGLE client + auth session
// (NO second GoTrue client). Cast permissive so the ported WA code's explicit
// .schema('whatsapp').from()/.rpc() type-checks against the shared client —
// exactly WA Mancer's own `supabase.rpc as unknown as ...` pattern. Row types
// are supplied at the call sites via ./database.types aliases.
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase as igfClient } from '@/lib/supabase'

export const supabase = igfClient as unknown as SupabaseClient<any, any, any>

// Self-host PostgREST caps every response at PGRST_DB_MAX_ROWS (=1000). Any
// unpaginated `.select()` on a table that can exceed 1000 rows silently
// truncates (e.g. Contacts: 1030+ resolved contacts per number were showing
// only 1000). This pages through the whole result set with `.range()`.
// A STABLE order column is mandatory — `.range()` over an unstable order
// dup/skips rows across pages; defaults to 'id'.
const PGRST_PAGE = 1000

export async function fetchAllWa<T = Record<string, unknown>>(
  build: (q: any) => any,
  opts?: { orderBy?: string; ascending?: boolean },
): Promise<T[]> {
  const all: T[] = []
  const orderBy = opts?.orderBy ?? 'id'
  const ascending = opts?.ascending ?? true
  for (let from = 0; ; from += PGRST_PAGE) {
    const base = build(supabase).order(orderBy, { ascending }).range(from, from + PGRST_PAGE - 1)
    const { data, error } = await base
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    all.push(...rows)
    if (rows.length < PGRST_PAGE) break
  }
  return all
}
