// IGF IDENTITY ADAPTER — trimmed WA Mancer lib/queries/users.ts (seam #3).
// Only the directory read survives (see ../usersApi.ts). The invitation /
// role / active mutations belong to iGrowFast's own user management.
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { listProfiles, type DirectoryProfile } from '../usersApi'

export const userKeys = {
  all:      ['users'] as const,
  profiles: ['users', 'profiles'] as const,
}

export function useProfiles() {
  return useQuery<DirectoryProfile[]>({
    queryKey: userKeys.profiles,
    queryFn:  listProfiles,
  })
}

export function prefetchUsers(qc: QueryClient) {
  void qc.prefetchQuery({ queryKey: userKeys.profiles, queryFn: listProfiles })
}
