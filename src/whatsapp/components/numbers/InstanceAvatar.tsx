// Avatar with graceful fallback. If profile_pic_url is set (Evolution
// fetched it from WA), render the image. Otherwise show a generated initials
// disc colored from the brand palette.

interface Props {
  size?: number
  url?: string | null
  displayName: string
}

const ACCENTS = ['#d97757', '#6a9bcc', '#788c5d']

export function InstanceAvatar({ size = 40, url, displayName }: Props) {
  const initials = (displayName.match(/\b\w/g) ?? [displayName[0] ?? '?'])
    .slice(0, 2).join('').toUpperCase()
  // Deterministic color per name
  let h = 0
  for (let i = 0; i < displayName.length; i++) h = (h * 31 + displayName.charCodeAt(i)) | 0
  const color = ACCENTS[Math.abs(h) % ACCENTS.length]!

  if (url) {
    return (
      <span className="instance-avatar" style={{ width: size, height: size }}>
        <img src={url} alt={displayName} className="instance-avatar__img" />
      </span>
    )
  }

  return (
    <span
      className="instance-avatar instance-avatar--initials"
      style={{
        width: size, height: size,
        background: `linear-gradient(135deg, ${color}, ${color}dd)`,
        fontSize: Math.round(size * 0.36),
      }}
      aria-label={displayName}
    >
      {initials}
    </span>
  )
}
