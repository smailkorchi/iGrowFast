import NiceAvatar, { genConfig } from 'react-nice-avatar'
import type { AvatarConfig } from '../../lib/database.types'

export type AvatarSize = number | string

type Props = {
  config: AvatarConfig | null | undefined
  /** IGF adaptation: uploaded photo (public.users.avatar_url). Wins over config. */
  url?: string | null
  size?: AvatarSize
  shape?: 'circle' | 'rounded' | 'square'
  /** Fallback seed used when config is empty so the avatar is still stable per user. */
  seed?: string
  className?: string
  style?: React.CSSProperties
}

const px = (s: AvatarSize) => (typeof s === 'number' ? `${s}px` : s)

// react-nice-avatar shape radii, mirrored so the photo path matches.
const radius = { circle: '50%', rounded: '6px', square: '0' } as const

/**
 * Render an avatar. IGF precedence (parity with src/components/users/
 * UserAvatar.tsx): uploaded photo → stored config → seeded deterministic
 * config, so the user keeps a stable identity until they pick one explicitly.
 */
export default function Avatar({ config, url, size = 56, shape = 'circle', seed, className, style }: Props) {
  const dim = px(size)
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className={className}
        style={{
          width: dim,
          height: dim,
          flexShrink: 0,
          borderRadius: radius[shape],
          objectFit: 'cover',
          display: 'inline-block',
          ...style,
        }}
      />
    )
  }
  const empty = !config || Object.keys(config as object).length === 0
  const final = empty && seed ? (genConfig(seed) as AvatarConfig) : (config ?? {})
  return (
    <NiceAvatar
      {...(final as object)}
      shape={shape}
      className={className}
      style={{
        width: dim,
        height: dim,
        flexShrink: 0,
        ...style,
      }}
    />
  )
}
