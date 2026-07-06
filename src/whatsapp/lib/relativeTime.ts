// Tiny relative-time formatter. No deps. Updates well at any scale.
//
//   formatRelative(new Date()) → "just now"
//   formatRelative(new Date(Date.now() - 90_000)) → "1 min ago"
//   formatRelative(new Date(Date.now() - 3_600_000 * 5)) → "5 h ago"
//   formatRelative(new Date(Date.now() - 86_400_000 * 3)) → "3 d ago"

export function formatRelative(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  const diffMs = Date.now() - date.getTime()
  if (diffMs < 0) return 'just now'

  const sec = Math.floor(diffMs / 1000)
  if (sec < 10)    return 'just now'
  if (sec < 60)    return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60)    return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24)     return `${hr} h ago`
  const day = Math.floor(hr / 24)
  if (day < 30)    return `${day} d ago`
  const mo = Math.floor(day / 30)
  if (mo < 12)     return `${mo} mo ago`
  return `${Math.floor(mo / 12)} y ago`
}

/**
 * WhatsApp-style list-row time:
 *   - today:           "13:01"
 *   - yesterday:       "Hier"
 *   - this week:       "lun." / "mar." / etc.
 *   - older:           "DD/MM/YYYY"
 */
export function formatListTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Hier'
  const daysAgo = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (daysAgo < 7) {
    return new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(d).replace('.', '')
  }
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

/** "13:01" — used inside message bubbles. */
export function formatBubbleTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Day divider label: "Aujourd'hui" / "Hier" / "DD/MM/YYYY". */
export function formatDayDivider(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return "Aujourd'hui"
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Hier'
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

/** "in 12s", "in 2 min" — for future timestamps like queue not_before. */
export function formatFuture(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  const diffMs = date.getTime() - Date.now()
  if (diffMs <= 0) return 'now'

  const sec = Math.ceil(diffMs / 1000)
  if (sec < 60)   return `in ${sec}s`
  const min = Math.ceil(sec / 60)
  if (min < 60)   return `in ${min} min`
  const hr = Math.ceil(min / 60)
  if (hr < 24)    return `in ${hr} h`
  return `in ${Math.ceil(hr / 24)} d`
}
