import NiceAvatar, { genConfig } from 'react-nice-avatar'
import type { AvatarConfig } from '../../lib/database.types'

export type AvatarSize = number | string

type Props = {
  config: AvatarConfig | null | undefined
  size?: AvatarSize
  shape?: 'circle' | 'rounded' | 'square'
  /** Fallback seed used when config is empty so the avatar is still stable per user. */
  seed?: string
  className?: string
  style?: React.CSSProperties
}

const px = (s: AvatarSize) => (typeof s === 'number' ? `${s}px` : s)

/**
 * Render an avatar from a stored config. If config is empty/null and a seed is
 * provided, we generate a deterministic config from the seed so the user gets a
 * stable identity until they pick one explicitly.
 */
export default function Avatar({ config, size = 56, shape = 'circle', seed, className, style }: Props) {
  const empty = !config || Object.keys(config as object).length === 0
  const final = empty && seed ? (genConfig(seed) as AvatarConfig) : (config ?? {})
  const dim = px(size)
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
