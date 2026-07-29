// IGF IDENTITY ADAPTER — replaces WA Mancer's lib/auth.tsx (sanctioned seam #3).
//
// WA Mancer shipped a full AuthProvider (profiles table + localStorage cache).
// iGrowFast owns identity (public.users, 6-role model, ProtectedRoute guards),
// so this module keeps ONLY the consumer-facing contract the inbox files were
// built against — same import path ('../lib/auth'), same useAuth() shape:
//
//   { session, profile, loading, profileLoading, revalidating,
//     signIn, signOut, refreshProfile }
//
// profile is the WA `Profile` row shape (whatsapp.profiles view contract),
// mapped from public.users:
//   full_name    <- users.name
//   role         <- {'super admin','business owner','admin'} -> 'admin', else 'user'
//                   (WA user_role value space; every UI gate compares === 'admin',
//                    parity with public.current_user_is_business_admin())
//   is_active    <- users.active
//   avatar_config passthrough (public.users.avatar_config jsonb)
//   avatar_url   passthrough (public.users.avatar_url — uploaded photo; IGF
//                 precedence photo → config → fallback, see UserAvatar.tsx)
//
// No provider needed: session comes from the single IGF GoTrue client, the
// profile row through TanStack Query (WaShell's waQueryClient). Consumers all
// null-guard (`session?.user.id`, `profile?.role`), so the brief async gap on
// first mount is safe.
import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Profile } from './database.types'

const PROFILE_KEY = ['wa-current-profile'] as const

// Module-level session mirror so remounts render with the last-known session
// immediately instead of a null flash on every navigation.
let cachedSession: Session | null = null

function mapUsersRow(row: {
  id: string
  name: string | null
  email: string | null
  role: string | null
  active: boolean | null
  avatar_config: unknown
  avatar_url: string | null
  created_at: string | null
}): Profile {
  return {
    id: row.id,
    email: row.email ?? '',
    full_name: row.name,
    role: row.role === 'super admin' || row.role === 'business owner' || row.role === 'admin' ? 'admin' : 'user',
    is_active: row.active ?? true,
    avatar_config: (row.avatar_config ?? null) as Profile['avatar_config'],
    avatar_url: row.avatar_url ?? null,
    created_at: row.created_at ?? '',
    last_auto_assigned_at: null,
    updated_at: row.created_at ?? '',
  }
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, role, active, avatar_config, avatar_url, created_at')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.warn('wa profile fetch error', error)
    return null
  }
  return data ? mapUsersRow(data) : null
}

export function useAuth() {
  const qc = useQueryClient()
  const [session, setSession] = useState<Session | null>(cachedSession)
  const [loading, setLoading] = useState(cachedSession === null)

  useEffect(() => {
    let cancelled = false
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      cachedSession = data.session
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (cancelled) return
      cachedSession = next
      setSession(next)
      setLoading(false)
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  const uid = session?.user.id ?? null
  const profileQuery = useQuery({
    queryKey: [...PROFILE_KEY, uid],
    enabled: uid !== null,
    staleTime: 5 * 60_000,
    queryFn: () => fetchProfile(uid as string),
    meta: { silent: true },
  })

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const refreshProfile = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: PROFILE_KEY })
  }, [qc])

  return {
    session,
    profile: (profileQuery.data ?? null) as Profile | null,
    loading,
    profileLoading: profileQuery.isLoading,
    revalidating: profileQuery.isFetching && !profileQuery.isLoading,
    signIn,
    signOut,
    refreshProfile,
  }
}
