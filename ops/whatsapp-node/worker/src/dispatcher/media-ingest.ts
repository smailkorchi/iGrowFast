// Media-ingest dispatcher.
//
// Drains whatsapp.media_fetch_jobs. For each job:
//   1) Claim atomically (SKIP LOCKED + lease bump) — connection released
//      immediately so we don't hog the pool while Evolution/R2 are talking.
//   2) Fetch base64 from Evolution (per-instance token).
//   3) Decode → SHA-256 → upload to R2 under <inst>/<conv>/<msg>.<ext>.
//   4) Call complete_media_fetch on success / fail_media_fetch on error.
//
// Wakeups:
//   - pg NOTIFY 'media_fetch_ready' from enqueue_media_fetch (instant).
//   - 30s timer fallback (covers backed-off retries + missed notifications).
//
// Concurrency: a single in-process worker pulls jobs sequentially. Adding
// more workers later is a config knob (MEDIA_INGEST_CONCURRENCY); the queue
// uses FOR UPDATE SKIP LOCKED so any number of workers can drain in parallel.

import { createDecipheriv, createHmac } from 'node:crypto'
import { hkdf } from 'node:crypto'
import { pool } from '../db.js'
import { log } from '../logger.js'
import { EvolutionClient, EvolutionError } from '../evolution/client.js'
import { buildMediaKey, MEDIA_BUCKET, putMedia } from '../r2/client.js'

// ─── WhatsApp direct media download ────────────────────────────────────────
// Fallback for when Evolution's getBase64FromMediaMessage can't find the media
// (e.g. template header images nested inside templateMessage.header.imageMessage).
// Downloads the encrypted blob directly from WhatsApp's CDN and decrypts
// using the standard WhatsApp media protocol (same as Baileys).

const WA_MEDIA_INFO: Record<string, string> = {
  image:    'WhatsApp Image Keys',
  video:    'WhatsApp Video Keys',
  audio:    'WhatsApp Audio Keys',
  document: 'WhatsApp Document Keys',
  sticker:  'WhatsApp Image Keys',
}

/**
 * Decode a WhatsApp mediaKey that may arrive in either of two shapes:
 *  - base64 string (what Baileys exposes when serialized as JSON)
 *  - object-keyed byte array {"0": 190, "1": 97, ...} (what protobuf-to-JSON
 *    serializers emit for Uint8Array fields when not explicitly base64-encoded)
 *
 * Both are valid representations of a 32-byte AES key. We accept both so this
 * function is robust against webhook-handler serialization choices and legacy
 * rows. Returns null on any malformed input.
 */
function decodeMediaKey(raw: unknown): Buffer | null {
  if (typeof raw === 'string') {
    if (raw.length === 0) return null
    try {
      const b = Buffer.from(raw, 'base64')
      return b.length > 0 ? b : null
    } catch {
      return null
    }
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    // Sort keys numerically to reconstruct the original byte order. Object
    // serializers don't guarantee insertion order across all paths.
    const indices = Object.keys(o)
      .map((k) => Number.parseInt(k, 10))
      .filter((n) => Number.isFinite(n) && n >= 0)
      .sort((a, b) => a - b)
    if (indices.length === 0) return null
    const bytes = new Uint8Array(indices.length)
    for (let i = 0; i < indices.length; i++) {
      const v = o[String(indices[i])]
      if (typeof v !== 'number' || v < 0 || v > 255 || !Number.isInteger(v)) {
        return null
      }
      bytes[i] = v
    }
    return Buffer.from(bytes)
  }
  return null
}

async function downloadWhatsAppMedia(
  directPath: string,
  mediaKeyRaw: unknown,
  mediaType: string,
): Promise<Buffer | null> {
  const url = `https://mmg.whatsapp.net${directPath}`
  const info = WA_MEDIA_INFO[mediaType] ?? WA_MEDIA_INFO['image']!

  // 0. Decode the mediaKey (accepts base64 string OR object-shaped byte array)
  const mediaKey = decodeMediaKey(mediaKeyRaw)
  if (!mediaKey) {
    log.warn('wa_direct.media_key_decode_failed', {
      type: typeof mediaKeyRaw,
      shape: mediaKeyRaw && typeof mediaKeyRaw === 'object' ? 'object' : typeof mediaKeyRaw,
    })
    return null
  }

  // 1. Download encrypted blob
  let encBytes: Buffer
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) {
      log.warn('wa_direct.download_failed', { status: res.status, url: url.slice(0, 100) })
      return null
    }
    encBytes = Buffer.from(await res.arrayBuffer())
  } catch (err) {
    log.warn('wa_direct.download_error', { error: err instanceof Error ? err.message : String(err) })
    return null
  }

  if (encBytes.length < 26 + 10) {
    // Too small to contain iv(16) + at least 16 bytes ciphertext + mac(10)
    log.warn('wa_direct.too_small', { bytes: encBytes.length })
    return null
  }

  // 2. Expand mediaKey via HKDF-SHA256 → 112 bytes
  const expanded = await new Promise<Buffer>((resolve, reject) => {
    hkdf('sha256', mediaKey, Buffer.alloc(0), info, 112, (err, dk) => {
      if (err) reject(err)
      else resolve(Buffer.from(dk))
    })
  })

  const iv        = expanded.subarray(0, 16)
  const cipherKey = expanded.subarray(16, 48)
  const macKey    = expanded.subarray(48, 80)

  // 3. Split: file = ciphertext_body + mac(last 10 bytes)
  // HMAC is over (iv_from_hkdf || ciphertext_body), verified with first 10 bytes
  const macFromFile = encBytes.subarray(encBytes.length - 10)
  const cipherBody  = encBytes.subarray(0, encBytes.length - 10)

  // 4. Verify HMAC-SHA256(macKey, iv || ciphertext_body)
  const hmac = createHmac('sha256', macKey)
    .update(Buffer.concat([iv, cipherBody]))
    .digest()
  if (!hmac.subarray(0, 10).equals(macFromFile)) {
    log.warn('wa_direct.hmac_mismatch', {
      fileLen: encBytes.length,
      expected: macFromFile.toString('hex'),
      got: hmac.subarray(0, 10).toString('hex'),
    })
    return null
  }

  // 5. Decrypt AES-256-CBC
  const decipher = createDecipheriv('aes-256-cbc', cipherKey, iv)
  const plain = Buffer.concat([
    decipher.update(cipherBody),
    decipher.final(),
  ])

  return plain
}

// ─── Token cache ────────────────────────────────────────────────────────────
// reveal_instance_token is service-role + audited; cache 5 min per instance.

const TOKEN_TTL_MS = 5 * 60 * 1000
const tokenCache = new Map<string, { name: string; token: string; expiresAt: number }>()

async function getInstanceCreds(
  instanceId: string,
): Promise<{ name: string; token: string } | null> {
  const cached = tokenCache.get(instanceId)
  if (cached && cached.expiresAt > Date.now()) {
    return { name: cached.name, token: cached.token }
  }
  const { rows } = await pool.query<{ name: string; token: string | null }>(
    `SELECT i.evolution_instance_name AS name,
            whatsapp.reveal_instance_token(i.id) AS token
       FROM whatsapp.whatsapp_instances i
      WHERE i.id = $1`,
    [instanceId],
  )
  const r = rows[0]
  if (!r || !r.token) return null
  const creds = { name: r.name, token: r.token, expiresAt: Date.now() + TOKEN_TTL_MS }
  tokenCache.set(instanceId, creds)
  return { name: r.name, token: r.token }
}

// ─── Job claim ──────────────────────────────────────────────────────────────

interface Claimed {
  job_id:               string
  message_id:           string
  instance_id:          string
  evolution_message_id: string
  kind:                 string
  conversation_id:      string
  remote_jid:           string
  from_me:              boolean
  caption_meta:         Record<string, unknown> | null
}

/**
 * Atomically claim the next ready job:
 *   - locks the row with SKIP LOCKED so parallel workers don't fight
 *   - bumps next_attempt_at by 5 min (a lease) so a crashed worker doesn't
 *     leave the job stuck; another worker picks it up after the lease expires
 *   - joins messages + conversations so the caller has everything it needs
 *     to call Evolution without further DB roundtrips
 */
async function claimNextJob(): Promise<Claimed | null> {
  // Newest-first: WhatsApp CDN media URLs expire on the order of hours, so
  // when there's a queue backlog the freshest messages have the best chance
  // of still being downloadable. Lose-vs-save ratio is dominated by URL
  // expiry, not by who waited longest. Ties broken by job creation order.
  const { rows } = await pool.query<Claimed>(`
    WITH locked AS (
      SELECT j.id
        FROM whatsapp.media_fetch_jobs j
        JOIN whatsapp.messages m ON m.id = j.message_id
       WHERE j.completed_at IS NULL
         AND j.next_attempt_at <= now()
       ORDER BY m.whatsapp_timestamp DESC NULLS LAST, j.next_attempt_at
       LIMIT 1
       FOR UPDATE SKIP LOCKED
    ),
    leased AS (
      UPDATE whatsapp.media_fetch_jobs j
         SET next_attempt_at = now() + interval '5 minutes'
        FROM locked
       WHERE j.id = locked.id
       RETURNING j.id, j.message_id, j.instance_id,
                 j.evolution_message_id, j.kind
    )
    SELECT l.id::text                     AS job_id,
           l.message_id::text              AS message_id,
           l.instance_id::text             AS instance_id,
           l.evolution_message_id          AS evolution_message_id,
           l.kind::text                    AS kind,
           m.conversation_id::text         AS conversation_id,
           c.remote_jid                    AS remote_jid,
           (m.direction = 'outbound')      AS from_me,
           m.media_meta                    AS caption_meta
      FROM leased l
      JOIN whatsapp.messages m      ON m.id = l.message_id
      JOIN whatsapp.conversations c ON c.id = m.conversation_id
  `)
  return rows[0] ?? null
}

// ─── Process one job ────────────────────────────────────────────────────────

async function processJob(job: Claimed): Promise<void> {
  const creds = await getInstanceCreds(job.instance_id)
  if (!creds) {
    await failJob(job, 'no instance token (instance gone or unpaired)')
    return
  }

  const evo = new EvolutionClient({
    apiKey:    creds.token,
    instance:  creds.name,
    timeoutMs: 60_000,
  })

  // Pull bytes — try Evolution first, fall back to direct WA CDN download
  // for template header images (Evolution can't traverse into template structures).
  let buf: Buffer | null = null
  let mime: string | null = null

  // Check if this is a template with direct-download keys in media_meta.
  // headerMediaKey may arrive as either base64 string OR object-shaped byte
  // array depending on the webhook handler's serialization — decodeMediaKey
  // (called inside downloadWhatsAppMedia) accepts both, so we pass it through
  // as `unknown` here without forcing a string cast that would mask the bug.
  const headerDirectPath = (job.caption_meta?.['headerDirectPath'] as string | undefined) ?? null
  const headerMediaKey: unknown = job.caption_meta?.['headerMediaKey'] ?? null
  const headerMimetype   = (job.caption_meta?.['headerMimetype'] as string | undefined) ?? null

  if (headerDirectPath && headerMediaKey) {
    // Template header image — download + decrypt directly from WhatsApp CDN
    log.info('media.ingest.direct_download', { message_id: job.message_id, kind: job.kind })
    const plain = await downloadWhatsAppMedia(headerDirectPath, headerMediaKey, job.kind)
    if (plain && plain.length > 0) {
      buf = plain
      mime = headerMimetype ?? 'image/jpeg'
    } else {
      await failJob(job, 'wa direct download failed (CDN expired or decrypt error)', true)
      return
    }
  } else {
    // Normal media — use Evolution's getBase64FromMediaMessage
    let resp
    try {
      resp = await evo.getBase64FromMediaMessage({
        message: {
          key: {
            id:        job.evolution_message_id,
            fromMe:    job.from_me,
            remoteJid: job.remote_jid,
          },
        },
        convertToMp4: false,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (err instanceof EvolutionError) {
        if (isCdnExpiry(err)) {
          await failJob(job, `whatsapp cdn expired: ${msg}`, true)
          return
        }
        if (!err.isRetryable && err.status !== 404) {
          await failJob(job, `evolution non-retryable ${err.status}: ${msg}`, true)
          return
        }
      }
      await failJob(job, `evolution: ${msg}`)
      return
    }

    if (!resp || !resp.base64) {
      await failJob(job, 'evolution 404: media expired', true)
      return
    }

    try {
      buf = Buffer.from(resp.base64, 'base64')
    } catch (err) {
      await failJob(job, `base64 decode: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    mime = resp.mimetype ?? null
  }

  if (!buf || buf.length === 0) {
    await failJob(job, 'empty media bytes after decode', true)
    return
  }

  // Determine the canonical mime. Evolution sometimes returns 'application/octet-stream'
  // for cleared headers — prefer the mime that the original webhook carried in media_meta.
  const metaMime = (job.caption_meta?.['mimetype'] as string | undefined) ?? null
  const finalMime = pickMime(mime, metaMime, job.kind)
  const filename = (job.caption_meta?.['fileName'] as string | undefined) ?? null
  const key = buildMediaKey({
    instanceId:     job.instance_id,
    conversationId: job.conversation_id,
    messageId:      job.message_id,
    mime:           finalMime,
  })

  let upload
  try {
    upload = await putMedia({ key, body: buf, mimeType: finalMime, filename })
  } catch (err) {
    await failJob(job, `r2 put: ${err instanceof Error ? err.message : String(err)}`)
    return
  }

  // Commit success to the DB.
  try {
    await pool.query(
      `SELECT whatsapp.complete_media_fetch($1, $2, $3, $4, $5, $6)`,
      [job.message_id, upload.bucket, upload.key, upload.sizeBytes, upload.mimeType, upload.sha256],
    )
    log.info('media.ingest.ok', {
      message_id: job.message_id,
      key:        upload.key,
      bytes:      upload.sizeBytes,
      mime:       upload.mimeType,
    })
  } catch (err) {
    // R2 has the bytes but DB failed to record. fail_media_fetch will retry
    // and the next iteration's putMedia call is idempotent (same key, same
    // bytes). Better than silently dropping.
    await failJob(job, `db complete: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function failJob(job: Claimed, error: string, terminal = false): Promise<void> {
  log.warn('media.ingest.fail', {
    job_id:     job.job_id,
    message_id: job.message_id,
    error,
    terminal,
  })
  await pool
    .query(`SELECT whatsapp.fail_media_fetch($1, $2, $3)`, [job.job_id, error, terminal])
    .catch((err) =>
      log.error('media.ingest.fail_rpc_failed', {
        job_id: job.job_id,
        error:  err instanceof Error ? err.message : String(err),
      }),
    )
}

// Evolution wraps the WhatsApp CDN response. When the encrypted media URL has
// expired on WhatsApp's side, Evolution returns HTTP 400 with body containing
// "Failed to fetch stream from https://mmg.whatsapp.net/...". Detect that and
// avoid pointless retries.
function isCdnExpiry(err: EvolutionError): boolean {
  if (err.status !== 400) return false
  const body = err.body
  if (!body || typeof body !== 'object') return false
  const resp = (body as { response?: { message?: unknown } }).response
  const msgs = resp?.message
  const text = Array.isArray(msgs) ? msgs.join(' ') : typeof msgs === 'string' ? msgs : ''
  return /Failed to fetch stream/i.test(text)
}

function pickMime(evoMime: string | null, metaMime: string | null, kind: string): string {
  // Prefer a specific mime over octet-stream; fall back by kind.
  for (const m of [evoMime, metaMime]) {
    if (m && m !== 'application/octet-stream') return m
  }
  switch (kind) {
    case 'image':    return 'image/jpeg'
    case 'video':    return 'video/mp4'
    case 'audio':    return 'audio/ogg'
    case 'document': return 'application/octet-stream'
    case 'sticker':  return 'image/webp'
    default:         return 'application/octet-stream'
  }
}

// ─── Loop control ───────────────────────────────────────────────────────────

let running = false
let timer: NodeJS.Timeout | null = null
let pending = false
let inflight = false

const TICK_INTERVAL_MS = 30_000   // sweep fallback for backed-off jobs

// Pool size — how many fetches run in parallel. The bottleneck is wall-clock
// time before WhatsApp CDN URLs expire, NOT CPU; Evolution + R2 happily
// handle a small fan-out. Override via MEDIA_INGEST_CONCURRENCY env var.
const MEDIA_CONCURRENCY = (() => {
  const raw = process.env['MEDIA_INGEST_CONCURRENCY']
  const n = raw ? parseInt(raw, 10) : 8
  return Number.isFinite(n) && n > 0 ? Math.min(n, 32) : 8
})()

async function runWorker(): Promise<void> {
  // Each worker pulls one job, processes it, repeats — until claimNextJob
  // returns null. SKIP LOCKED in claimNextJob guarantees no two workers
  // ever grab the same row.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const job = await claimNextJob()
    if (!job) return
    try {
      await processJob(job)
    } catch (err) {
      log.error('media.ingest.process_threw', {
        job_id: job.job_id,
        error:  err instanceof Error ? err.message : String(err),
      })
    }
  }
}

async function tick(): Promise<void> {
  if (inflight) { pending = true; return }
  inflight = true
  try {
    // Fan out MEDIA_CONCURRENCY workers; they self-coordinate via the
    // claim query's SKIP LOCKED and exit when the queue is empty.
    const workers: Promise<void>[] = []
    for (let i = 0; i < MEDIA_CONCURRENCY; i++) workers.push(runWorker())
    await Promise.all(workers)
  } finally {
    inflight = false
    if (pending) {
      pending = false
      // Coalesce — one immediate re-tick if a notify came in mid-process.
      setImmediate(() => { void tick() })
    }
  }
}

/** Called by index.ts when LISTEN media_fetch_ready fires. */
export function wakeMediaIngest(_payload: string): void {
  if (!running) return
  void tick()
}

export function startMediaIngest(): void {
  if (running) return
  running = true
  // Kick once on boot to drain anything left from before restart.
  void tick()
  // Sweep timer: also covers retries whose next_attempt_at is in the future.
  timer = setInterval(() => { void tick() }, TICK_INTERVAL_MS)
  timer.unref()
  log.info('media_ingest.started', { bucket: MEDIA_BUCKET, concurrency: MEDIA_CONCURRENCY })
}

export function stopMediaIngest(): void {
  running = false
  if (timer) { clearInterval(timer); timer = null }
  log.info('media_ingest.stopped')
}
