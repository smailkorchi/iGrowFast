// WhatsApp JID formatting helpers.
//
//   <country+number>@s.whatsapp.net  → "+212 600 123 456"   (real phone)
//   <number>@lid                     → "Anonymous · #1234…" (privacy-only ID)
//   <number>@g.us                    → "Group · #1234…"     (until subject known)
//   status@broadcast / @newsletter   → caller usually filters; we still label
//
// `@lid` is WhatsApp's privacy identifier — it is NOT a phone number and you
// cannot derive one from it. It appears when the contact's phone isn't
// disclosed (group members, hidden numbers, etc.).

export type JidKind = 'phone' | 'lid' | 'group' | 'broadcast' | 'newsletter' | 'unknown'

export interface ParsedJid {
  raw: string
  user: string
  domain: string
  kind: JidKind
}

export function parseJid(raw: string): ParsedJid {
  const [user, domain] = raw.split('@')
  const u = (user ?? '').split(':')[0] ?? '' // strip device suffix like "123:1"
  const d = domain ?? ''
  const kind: JidKind =
    d === 's.whatsapp.net' ? 'phone'
    : d === 'lid'          ? 'lid'
    : d === 'g.us'         ? 'group'
    : d === 'broadcast'    ? 'broadcast'
    : d === 'newsletter'   ? 'newsletter'
    : 'unknown'
  return { raw, user: u, domain: d, kind }
}

/**
 * Country codes that are NOT 3 digits. The previous formatter assumed every
 * country code was 3 digits, which formatted "12172817825" (US +1) as
 * "+121 728 178 25" instead of "+1 217 281 7825". ITU-T E.164 country codes
 * are 1-3 digits — we enumerate the 1- and 2-digit codes, default to 3.
 */
const CC_1: ReadonlySet<string> = new Set(['1', '7'])
const CC_2: ReadonlySet<string> = new Set([
  '20','27','30','31','32','33','34','36','39','40','41','43','44','45','46','47','48','49',
  '51','52','53','54','55','56','57','58','60','61','62','63','64','65','66',
  '81','82','84','86','90','91','92','93','94','95','98',
])

/**
 * NANP (+1) follows NPA-NXX-XXXX. Other countries don't have a single
 * universal block pattern in their national number, so we fall back to even
 * 3-digit grouping which reads reasonably for any locale.
 */
function detectCountryCode(d: string): { cc: string; rest: string } {
  const c1 = d.slice(0, 1)
  if (CC_1.has(c1)) return { cc: c1, rest: d.slice(1) }
  const c2 = d.slice(0, 2)
  if (CC_2.has(c2)) return { cc: c2, rest: d.slice(2) }
  return { cc: d.slice(0, 3), rest: d.slice(3) }
}

/** Pretty E.164-ish formatting: "+212 600 123 456" / "+1 217 281 7825". */
export function formatPhone(rawDigits: string): string {
  const d = rawDigits.replace(/\D/g, '')
  if (!d) return rawDigits
  const { cc, rest } = detectCountryCode(d)
  // NANP convention: 3-3-4 grouping for the national number.
  let groups: string
  if (cc === '1' && rest.length === 10) {
    groups = `${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`
  } else {
    groups = rest.replace(/(\d{3})(?=\d)/g, '$1 ')
  }
  return `+${cc}${groups ? ' ' + groups : ''}`.trim()
}

/**
 * Resolve the best human label for a conversation.
 * Priority: bookName (phone book) > peerDisplayName (pushName) > formatted JID.
 */
export function conversationLabel(
  remoteJid: string,
  peerDisplayName: string | null | undefined,
  bookName?: string | null,
): string {
  if (bookName && bookName.trim()) return bookName.trim()
  if (peerDisplayName && peerDisplayName.trim()) return peerDisplayName.trim()

  const p = parseJid(remoteJid)
  switch (p.kind) {
    case 'phone':      return formatPhone(p.user)
    case 'lid':        return `Anonymous · #${p.user.slice(-6)}`
    case 'group':      return `Group · #${p.user.slice(-6)}`
    case 'broadcast':  return 'Broadcast'
    case 'newsletter': return 'Channel'
    default:           return p.user || remoteJid
  }
}

/** Format an unread count with overflow cap. */
export function formatUnread(n: number | null | undefined): string | null {
  if (!n || n <= 0) return null
  if (n > 999) return '999+'
  return String(n)
}
