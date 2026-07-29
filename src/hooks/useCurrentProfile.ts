import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Canonical current-user profile. ONE shared query key ['current-profile'],
// consumed by the admin/owner/courier sidebars and the admin Profile page (which
// invalidates this key on identity/avatar save). React Query dedupes all readers
// onto a single fetch.
//
// PROFILE_COLS is the verified UNION of every consumer's field usage — never
// select('*') (wide row + needless egress). staleTime kills the focus-refetch
// storm: the profile is near-static and every write path invalidates this key
// explicitly, so a 5-minute window costs nothing in freshness. getSession (local
// JWT) instead of getUser avoids a GoTrue round-trip per fetch; RLS on the users
// select still enforces via the token, and supabase-js refreshes an expired token
// on the call.
const PROFILE_COLS =
  'id, name, role, avatar_url, avatar_config, username, email, phone, backup_admin, permissions';

/** Shape the consumers rely on. `permissions.pages` gates the admin sidebar (see lib/permissions.ts). */
export interface CurrentProfile {
  id: string;
  name: string | null;
  role: string | null;
  avatar_url: string | null;
  avatar_config: unknown | null;
  username: string | null;
  email: string | null;
  phone: string | null;
  backup_admin: boolean | null;
  permissions: { pages?: Record<string, boolean> | null } | null;
}

export function useCurrentProfile() {
  return useQuery({
    queryKey: ['current-profile'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return null;
      const { data, error } = await supabase
        .from('users')
        .select(PROFILE_COLS)
        .eq('id', uid)
        .single();
      if (error) return null;
      return data as unknown as CurrentProfile;
    },
  });
}
