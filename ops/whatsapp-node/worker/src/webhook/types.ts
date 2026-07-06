// Shape of Evolution v2.3.7 webhook envelopes. Only the fields we consume
// are typed; anything else stays in `extra`.

import type { MessageKey, WAPresence } from '../evolution/client.js'

export interface EvolutionWebhookEnvelope {
  event: EvolutionEventType
  instance: string                         // evolution_instance_name
  data: unknown
  date_time?: string
  sender?: string
  server_url?: string
  apikey?: string
  // any extra fields configured via the `extra` payload on webhook setup
  [key: string]: unknown
}

export type EvolutionEventType =
  | 'messages.upsert'
  | 'messages.update'
  | 'messages.delete'
  | 'messages.set'
  | 'send.message'
  | 'connection.update'
  | 'qrcode.updated'
  | 'contacts.update'
  | 'contacts.upsert'
  | 'chats.upsert'
  | 'chats.update'
  | 'groups.update'
  | 'groups.upsert'
  | 'group-participants.update'
  | 'presence.update'
  | 'application.startup'
  | 'instance.create'
  | 'instance.delete'

// ---- messages.upsert / messages.update payloads ---------------------------

/**
 * Subset of Baileys `WAMessage` fields we use. The full Baileys shape has
 * dozens more fields; we only care about identity, direction, content kind,
 * and timestamp.
 */
export interface WAMessageData {
  key: MessageKey
  messageType?: string                      // 'conversation' | 'imageMessage' | ...
  messageTimestamp?: number | string
  pushName?: string
  status?: number | string                  // delivery status code
  message?: WAMessageContent
  isLatest?: boolean                        // v2.3.7+ — true on the final history-sync batch
  progress?: number                         // v2.3.7+ — 0..100 during history sync
  source?: string
  // Group system events (Baileys WAMessage stub). Content-less messages whose
  // semantics live entirely in the stub type + parameters. Evolution may
  // serialize messageStubType as an int, a digit-string, or a symbolic name.
  messageStubType?: number | string
  messageStubParameters?: string[]
}

export interface WAMessageContent {
  conversation?: string
  extendedTextMessage?: {
    text?: string
    // Link-preview fields populated by WhatsApp when a URL is detected in the
    // body. Surfaced into messages.media_meta.link_preview for the UI.
    matchedText?: string
    canonicalUrl?: string
    description?: string
    title?: string
    previewType?: number | string
    jpegThumbnail?: string            // base64 JPEG bytes
    thumbnailDirectPath?: string
    contextInfo?: unknown
  }
  imageMessage?: { caption?: string; mimetype?: string; url?: string; fileName?: string }
  videoMessage?: { caption?: string; mimetype?: string; url?: string }
  audioMessage?: { mimetype?: string; url?: string; ptt?: boolean }
  documentMessage?: { caption?: string; mimetype?: string; url?: string; fileName?: string }
  stickerMessage?: { mimetype?: string; url?: string }
  reactionMessage?: { key: MessageKey; text?: string }
  // type carries the protocol subtype (REVOKE=0, MESSAGE_EDIT=14, …). For a
  // REVOKE (delete-for-everyone), `key` points at the message being deleted.
  protocolMessage?: { type?: number | string; key?: MessageKey }
  placeholderMessage?: { type?: number }
  secretEncryptedMessage?: { encPayload?: string; secretEncType?: number; targetMessageKey?: MessageKey }
  templateMessage?: {
    templateId?: string
    hydratedTemplate?: HydratedTemplate
    hydratedFourRowTemplate?: HydratedTemplate
    interactiveMessageTemplate?: InteractiveMessageTemplate
  }
  associatedChildMessage?: { message?: WAMessageContent }
  albumMessage?: { expectedImageCount?: number; expectedVideoCount?: number }
  locationMessage?: { degreesLatitude?: number; degreesLongitude?: number; name?: string; address?: string; url?: string; jpegThumbnail?: string }
  contactMessage?: { displayName?: string; vcard?: string }
  contactsArrayMessage?: { contacts?: Array<{ displayName?: string; vcard?: string }> }
  liveLocationMessage?: { degreesLatitude?: number; degreesLongitude?: number }
}

interface HydratedTemplate {
  hydratedContentText?: string
  hydratedFooterText?: string
  hydratedButtons?: Array<{ buttonText?: string; quickReplyButton?: { displayText?: string }; urlButton?: { displayText?: string; url?: string }; callButton?: { displayText?: string; phoneNumber?: string } }>
  imageMessage?: { caption?: string; mimetype?: string; url?: string; fileName?: string }
  videoMessage?: { caption?: string; mimetype?: string; url?: string }
  documentMessage?: { caption?: string; mimetype?: string; url?: string; fileName?: string }
}

interface InteractiveMessageTemplate {
  body?: { text?: string }
  footer?: { text?: string }
  header?: {
    imageMessage?: { mimetype?: string; url?: string }
    videoMessage?: { mimetype?: string; url?: string }
    documentMessage?: { mimetype?: string; url?: string; fileName?: string }
    hasMediaAttachment?: boolean
  }
  buttons?: Array<{
    quickReplyButton?: { displayText?: string }
    urlButton?: { displayText?: string; url?: string }
    callButton?: { displayText?: string; phoneNumber?: string }
    [key: string]: unknown
  }>
  nativeFlowMessage?: {
    buttons?: Array<{ name?: string; buttonParamsJson?: string }>
    messageParamsJson?: string
  }
  carouselMessage?: {
    cards?: Array<{
      header?: { imageMessage?: { mimetype?: string; url?: string } }
      body?: { text?: string }
      buttons?: Array<{ quickReplyButton?: { displayText?: string }; urlButton?: { displayText?: string; url?: string } }>
    }>
  }
}

// ---- connection.update payload --------------------------------------------

export interface ConnectionUpdateData {
  state?: 'open' | 'close' | 'connecting' | string
  statusReason?: number | string
  wuid?: string                             // bound JID (e.g. "212600000000@s.whatsapp.net")
  profileName?: string
  profilePictureUrl?: string
}

// ---- qrcode.updated payload ------------------------------------------------

export interface QrCodeUpdatedData {
  qrcode?: { base64?: string; code?: string; count?: number; pairingCode?: string }
}

// ---- presence.update payload ----------------------------------------------

export interface PresenceUpdateData {
  id?: string                               // jid
  presences?: Record<string, { lastKnownPresence: WAPresence; lastSeen?: number }>
}
