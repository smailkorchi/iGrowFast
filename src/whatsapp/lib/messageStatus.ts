// The `messages.delivery_status` column is written from multiple sources in
// multiple value spaces (Baileys numeric ACKs from the webhook, uppercase
// identifiers from the dispatcher, lowercase doc-spec values that nothing
// actually emits). The UI needs a single normalized view. Map every known
// form into the four buckets that drive the tick icon.
//
//   pending   → clock        (queued, dispatching, error/retrying)
//   sent      → single check (SERVER_ACK — reached WA servers)
//   delivered → double check (DELIVERY_ACK — reached recipient device)
//   read      → double check (READ/PLAYED — privacy-gated by recipient)
//
// Privacy note: a recipient with "read receipts" disabled never emits READ,
// so outbound messages to them cap at `delivered`. That is correct WA
// behavior, not a bug.

export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed'

export function normalizeDeliveryStatus(raw: string | null | undefined): DeliveryStatus {
  if (raw == null) return 'sent'
  const v = String(raw).trim()
  if (!v) return 'sent'

  // Baileys numeric ACK codes (webhook handler writes these as digit strings).
  switch (v) {
    case '0': return 'failed'    // ERROR
    case '1': return 'pending'   // PENDING_ACK (on-device queue)
    case '2': return 'sent'      // SERVER_ACK
    case '3': return 'delivered' // DELIVERY_ACK
    case '4': return 'read'      // READ
    case '5': return 'read'      // PLAYED (voice/video opened)
  }

  // Uppercase identifiers (dispatcher writes these).
  const u = v.toUpperCase()
  switch (u) {
    case 'QUEUED':
    case 'DISPATCHING':
    case 'PENDING':
    case 'PENDING_ACK':       return 'pending'
    case 'SERVER_ACK':
    case 'SENT':              return 'sent'
    case 'DELIVERY_ACK':
    case 'DELIVERED':         return 'delivered'
    case 'READ':
    case 'PLAYED':            return 'read'
    case 'ERROR':
    case 'FAILED':
    case 'DEAD':              return 'failed'
  }

  // Anything else — be conservative; assume it left our side at minimum.
  return 'sent'
}
