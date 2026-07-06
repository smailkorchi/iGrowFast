// WhatsApp module supabase client. Reuses IGF's SINGLE client + auth session
// (NO second GoTrue client). Cast permissive so the ported WA code's explicit
// .schema('whatsapp').from()/.rpc() type-checks against the shared client —
// exactly WA Mancer's own `supabase.rpc as unknown as ...` pattern. Row types
// are supplied at the call sites via ./database.types aliases.
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase as igfClient } from '@/lib/supabase'

export const supabase = igfClient as unknown as SupabaseClient<any, any, any>
