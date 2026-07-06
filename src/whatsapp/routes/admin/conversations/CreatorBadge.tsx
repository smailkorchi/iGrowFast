// CreatorBadge — shows who authored a shared object (quick reply, scheduled
// message). Shared-inbox affordance so an admin can tell at a glance which agent
// (or admin) created an item. Admin-only by nature: RLS profiles_read only lets
// an admin resolve other users' profiles, so callers gate rendering on isAdmin.
import { useMemo } from 'react'
import Avatar from '../../../components/Avatar/Avatar'
import type { AvatarConfig } from '../../../lib/database.types'

export interface CreatorProfile {
  id: string
  email: string | null
  full_name: string | null
  role: string
  avatar_config: unknown
}

/** Build an id -> profile map once; pass to <CreatorBadge profile=...>. */
export function useCreatorMap(profiles: CreatorProfile[] | undefined) {
  return useMemo(
    () => new Map((profiles ?? []).map((p) => [p.id, p])),
    [profiles],
  )
}

export function CreatorBadge({ profile }: { profile: CreatorProfile | undefined }) {
  if (!profile) return null
  const name = profile.full_name || profile.email || 'Inconnu'
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, minWidth: 0 }}>
      <Avatar config={profile.avatar_config as AvatarConfig} size={16} seed={profile.email ?? profile.id} />
      <span
        style={{
          fontSize: 11,
          color: 'var(--wa-text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
      {profile.role === 'admin' && (
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 0.3,
            textTransform: 'uppercase',
            color: '#8fc6ff',
            background: 'rgba(99, 155, 209, 0.18)',
            borderRadius: 4,
            padding: '1px 5px',
            flexShrink: 0,
          }}
        >
          Admin
        </span>
      )}
    </span>
  )
}
