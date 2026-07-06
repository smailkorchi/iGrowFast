// Evolution API v2.3.7 client.
//
// Scope: only the endpoints the worker's dispatcher needs (messaging,
// presence, read receipts, reactions, edits, retracts). Instance lifecycle
// endpoints (create/delete/connect) live in the edge functions, which call
// Evolution with the GLOBAL api key — separate concern, separate client.
//
// Auth: per-instance `apikey` header (a different token for each WhatsApp
// number). The dispatcher fetches the token via reveal_instance_token RPC
// when spawning a number's loop and caches it for the loop's lifetime.

import { config } from '../config.js'
import { log } from '../logger.js'

// --- Types matching Evolution v2.3.7 DTOs --------------------------------

export type WAPresence = 'unavailable' | 'available' | 'composing' | 'recording' | 'paused'
export type MediaType = 'image' | 'document' | 'video' | 'audio' | 'ptv'

/** A WhatsApp message key — uniquely identifies a message on the wire. */
export interface MessageKey {
  id: string
  fromMe: boolean
  remoteJid: string
  participant?: string
  addressingMode?: string
  remoteJidAlt?: string
  participantAlt?: string
  participantPn?: string          // phone-number form of participant under LID migration
}

export interface SendTextInput {
  number: string             // recipient JID without @s.whatsapp.net (Evolution accepts both, prefers raw number for 1:1)
  text: string
  delay?: number             // ms — Evolution-internal pre-send wait; we pace upstream so leave 0
  linkPreview?: boolean
  mentionsEveryOne?: boolean
  mentioned?: string[]
  quoted?: { key: MessageKey; message: unknown }
}

export interface SendMediaInput {
  number: string
  mediatype: MediaType
  media: string              // URL or base64
  mimetype?: string
  caption?: string
  fileName?: string
  delay?: number
}

export interface SendWhatsAppAudioInput {
  number: string
  audio: string              // URL or base64 (Evolution accepts both)
  delay?: number
  encoding?: boolean         // when true, Evolution re-encodes to opus/ogg (PTT)
}

export interface SendPollInput {
  number: string
  name: string               // poll question
  selectableCount: number    // 1 = single-select, 2+ = multi-select
  values: string[]           // poll options (2..12)
  delay?: number
}

export interface SendReactionInput {
  key: MessageKey
  reaction: string           // emoji, or '' to remove
}

/** One shared contact card. `wuid` (WhatsApp user id = digits, no suffix) lets
 *  Evolution synthesize the protocol vCard with the `waid=` TEL param so the
 *  recipient sees a native card (Message/Save buttons). */
export interface ContactCard {
  fullName: string
  phoneNumber: string        // intl display, e.g. +212600000000
  wuid?: string              // digits only, e.g. 212600000000
  organization?: string
  email?: string
  url?: string
}

export interface SendContactInput {
  number: string             // recipient JID / digits
  contact: ContactCard[]     // 1 = contactMessage; N = one contactsArrayMessage
}

export interface SendPresenceInput {
  number: string
  presence: WAPresence
  delay?: number             // ms — Evolution holds the presence for this duration
}

export interface MarkReadInput {
  readMessages: MessageKey[]
}

export interface UpdateMessageInput {
  number: string
  key: MessageKey
  text: string
}

export interface DeleteMessageInput {
  id: string
  fromMe: boolean
  remoteJid: string
  participant?: string
}

export interface GetBase64FromMediaMessageInput {
  /**
   * Evolution accepts either the full Baileys message envelope OR just the
   * key. Passing the key alone is enough — the server looks up the cached
   * message by id+remoteJid+fromMe.
   */
  message: { key: MessageKey }
  /** Re-encode video to mp4 (Evolution-side) before returning base64. */
  convertToMp4?: boolean
}

export interface GetBase64FromMediaMessageResponse {
  mediaType?: 'image' | 'video' | 'audio' | 'document' | 'sticker'
  fileName?: string | null
  caption?:  string | null
  size?:     { fileLength?: string | number } | number | null
  mimetype?: string | null
  /** Base64 (no data: prefix). */
  base64:    string
}

/**
 * The shape Evolution returns for send-message ops. We only consume `key.id`
 * (stored as evolution_msg_id for webhook reconciliation). Everything else is
 * passed through opaquely if a caller wants it.
 */
export interface SendMessageResponse {
  key: MessageKey
  message?: unknown
  messageTimestamp?: string | number
  status?: string
  [k: string]: unknown
}

// --- Error types ---------------------------------------------------------

export class EvolutionError extends Error {
  override readonly name = 'EvolutionError'
  constructor(
    message: string,
    readonly status: number,          // HTTP status, 0 = network/timeout
    readonly body?: unknown,
    readonly endpoint?: string,
  ) {
    super(message)
  }

  /** Status the dispatcher should treat as transient (retry-eligible). */
  get isRetryable(): boolean {
    // 0 = network/timeout; 5xx = server; 429 = rate-limited.
    return this.status === 0 || this.status === 429 || (this.status >= 500 && this.status < 600)
  }
}

// --- Client --------------------------------------------------------------

export interface EvolutionClientOptions {
  /** Per-instance Evolution API token. */
  apiKey: string
  /** Instance identifier (the `evolution_instance_name`). */
  instance: string
  /** Optional override; falls back to config.evolutionApiUrl. */
  baseUrl?: string
  /** Request timeout in ms. Default 30s — covers media uploads. */
  timeoutMs?: number
}

export class EvolutionClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly instance: string
  private readonly timeoutMs: number

  constructor(opts: EvolutionClientOptions) {
    this.baseUrl = (opts.baseUrl ?? config.evolutionApiUrl).replace(/\/$/, '')
    this.apiKey = opts.apiKey
    this.instance = opts.instance
    this.timeoutMs = opts.timeoutMs ?? 30_000
  }

  // --- Public actions (1:1 with outbound_action_type enum) ----------------

  sendText(body: SendTextInput): Promise<SendMessageResponse> {
    return this.post('/message/sendText', body)
  }

  sendMedia(body: SendMediaInput): Promise<SendMessageResponse> {
    return this.post('/message/sendMedia', body)
  }

  /** Voice notes (PTT). Distinct Evolution endpoint that wraps audio with ptt=true. */
  sendWhatsAppAudio(body: SendWhatsAppAudioInput): Promise<SendMessageResponse> {
    return this.post('/message/sendWhatsAppAudio', body)
  }

  /** Native WhatsApp poll. Up to 12 options; single- or multi-select. */
  sendPoll(body: SendPollInput): Promise<SendMessageResponse> {
    return this.post('/message/sendPoll', body)
  }

  sendReaction(body: SendReactionInput): Promise<SendMessageResponse> {
    return this.post('/message/sendReaction', body)
  }

  /** Share one or more contact cards. A single-element array arrives at the
   *  recipient as a contactMessage; multiple as one contactsArrayMessage. */
  sendContact(body: SendContactInput): Promise<SendMessageResponse> {
    return this.post('/message/sendContact', body)
  }

  sendPresence(body: SendPresenceInput): Promise<unknown> {
    return this.post('/chat/sendPresence', body)
  }

  /** Pull the FULL contact list Evolution holds for this instance (everything
   *  the history sync populated, not just the live webhook trickle). Used to
   *  backfill our contacts table after connect so we don't miss contacts that
   *  arrived via messaging-history.set without a per-contact CONTACTS_UPSERT. */
  findContacts(): Promise<unknown> {
    return this.post('/chat/findContacts', {})
  }

  markMessageAsRead(body: MarkReadInput): Promise<unknown> {
    return this.post('/chat/markMessageAsRead', body)
  }

  updateMessage(body: UpdateMessageInput): Promise<SendMessageResponse> {
    return this.post('/chat/updateMessage', body)
  }

  deleteMessage(body: DeleteMessageInput): Promise<unknown> {
    // Evolution uses DELETE verb with body for retract.
    return this.request('DELETE', '/chat/deleteMessageForEveryone', body)
  }

  /**
   * Fetch a media message as base64. Evolution looks up the cached message
   * by key and returns the decoded bytes. Times out generously — media can
   * be tens of MB.
   *
   * Returns null on 404 (Evolution no longer has the message — beyond its
   * cache window, ~14 days). Caller should treat this as terminal.
   */
  async getBase64FromMediaMessage(
    body: GetBase64FromMediaMessageInput,
  ): Promise<GetBase64FromMediaMessageResponse | null> {
    try {
      return await this.post<GetBase64FromMediaMessageResponse>(
        '/chat/getBase64FromMediaMessage',
        body,
      )
    } catch (err) {
      if (err instanceof EvolutionError && err.status === 404) return null
      throw err
    }
  }

  // --- Internals ----------------------------------------------------------

  private post<TResp = unknown>(path: string, body: unknown): Promise<TResp> {
    return this.request('POST', path, body)
  }

  private async request<TResp = unknown>(method: 'POST' | 'DELETE', path: string, body: unknown): Promise<TResp> {
    const url = `${this.baseUrl}${path}/${encodeURIComponent(this.instance)}`
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), this.timeoutMs)

    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          apikey: this.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (err) {
      // Network error, DNS failure, or AbortError (timeout)
      const msg = err instanceof Error ? err.message : String(err)
      throw new EvolutionError(`network: ${msg}`, 0, undefined, `${method} ${path}`)
    } finally {
      clearTimeout(t)
    }

    const text = await res.text()
    let parsed: unknown
    if (text) {
      try { parsed = JSON.parse(text) } catch { parsed = text }
    }

    if (!res.ok) {
      // Truncate uniformly; never persist the full echoed request body (it can
      // contain the recipient number + message text). The log sink scrubs PII
      // from the string too, but keep it short and stringified here regardless.
      log.warn('evolution.http_error', {
        endpoint: `${method} ${path}`,
        status: res.status,
        body_preview: (typeof parsed === 'string' ? parsed : JSON.stringify(parsed ?? '')).slice(0, 200),
      })
      throw new EvolutionError(
        `evolution ${res.status}`,
        res.status,
        parsed,
        `${method} ${path}`,
      )
    }

    return parsed as TResp
  }
}
