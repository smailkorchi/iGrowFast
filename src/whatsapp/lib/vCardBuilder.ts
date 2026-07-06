// Builds the data needed to share a contact: the structured fields we hand to
// Evolution (it synthesizes the protocol vCard with the waid= TEL param so the
// recipient sees a native card), AND the vCard string we store in media_meta so
// our OWN ContactCardBody renders the echo identically to an inbound contact.

import type { Contact } from './queries/contacts'

export interface ContactCardData {
  /** Structured form sent to Evolution (→ /message/sendContact contact[]). */
  fullName: string
  phoneNumber: string   // intl display, e.g. +212600000000
  wuid: string          // digits only, e.g. 212600000000
  /** vCard 3.0 string for our own rendering + audit. */
  vcard: string
}

/** RFC 6868 / vCard escaping for free-text values (FN, N). */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

/**
 * Build a shareable card from a resolved contact. Returns null for contacts we
 * can't turn into a valid WhatsApp share (no phone digits) — the picker only
 * surfaces resolved contacts, so this is a safety net.
 */
export function buildContactCard(c: Contact): ContactCardData | null {
  // Prefer the phone JID (proves it's a real WhatsApp number); fall back to the
  // stored phone_number digits.
  const digits = (c.phone_jid?.replace(/@.*$/, '') ?? c.phone_number ?? '').replace(/[^0-9]/g, '')
  if (!digits) return null

  const fullName = (c.book_name || c.push_name || `+${digits}`).trim()
  const phoneNumber = `+${digits}`
  const fn = esc(fullName)
  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:;${fn};;;`,
    `FN:${fn}`,
    `TEL;type=CELL;waid=${digits}:${phoneNumber}`,
    'END:VCARD',
  ].join('\n')

  return { fullName, phoneNumber, wuid: digits, vcard }
}

/**
 * Pack the send_message `media_meta` for a contact share, mirroring the inbound
 * shape exactly so ContactCardBody renders it with zero special-casing.
 * Returns { body, mediaMeta } — body is the display name(s) (matches inbound).
 */
export function buildContactShare(cards: ContactCardData[]): { body: string; mediaMeta: Record<string, unknown> } | null {
  if (cards.length === 0) return null
  const contacts = cards.map((c) => ({ fullName: c.fullName, phoneNumber: c.phoneNumber, wuid: c.wuid }))
  if (cards.length === 1) {
    const only = cards[0]!
    return {
      body: only.fullName,
      mediaMeta: { subtype: 'contact', display_name: only.fullName, vcard: only.vcard, contacts },
    }
  }
  return {
    body: cards.map((c) => c.fullName).join(', '),
    mediaMeta: { subtype: 'contact_list', count: cards.length, vcards: cards.map((c) => c.vcard), contacts },
  }
}
