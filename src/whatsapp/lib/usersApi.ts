// IGF IDENTITY ADAPTER — trimmed WA Mancer lib/usersApi.ts (sanctioned seam #3).
//
// WA Mancer's file also carried its whole user-management stack (invitations
// table, admin_set_user_active/admin_set_user_role RPCs, create-invitations /
// admin-delete-user edge fns, readJwtSync storage hack). iGrowFast owns user
// management (manage-users / invitation lifecycle), so per the integration
// blueprint that stack is CUT — only the agent DIRECTORY survives, which is
// what the inbox consumes (assignment picker, InfoPane assignees, creator
// badges, unassign-scheduled safety modal).
//
// listProfiles reads whatsapp.profiles — a business-scoped view over
// public.users mirroring WA's profiles contract (same admin-sees-all /
// agent-sees-self asymmetry, agents = 'commercial' role) plus avatar_url,
// the IGF photo avatar WA Mancer never had (precedence photo → config).
import { supabase } from './supabase'
import type { Profile } from './database.types'

export type DirectoryProfile = Pick<
  Profile,
  'id' | 'email' | 'full_name' | 'role' | 'is_active' | 'avatar_config' | 'avatar_url' | 'created_at'
>

export async function listProfiles(): Promise<DirectoryProfile[]> {
  const { data, error } = await supabase
    .schema('whatsapp')
    .from('profiles')
    .select('id, email, full_name, role, is_active, avatar_config, avatar_url, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as DirectoryProfile[]
}
