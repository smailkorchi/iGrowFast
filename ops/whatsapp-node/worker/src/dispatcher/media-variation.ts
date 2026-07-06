// Per-send media hash variation for canned (quick-reply / scheduled) media.
//
// THE PROBLEM (ban vector): a quick reply stores its media ONCE in R2 and the
// dispatcher sends the exact same bytes to every recipient. Baileys derives the
// WhatsApp `fileSha256` from the plaintext bytes we hand it, so identical bytes
// → identical fileSha256 on every send. At volume that is a stable media
// fingerprint WhatsApp can cluster as spam/broadcast (ban-avoidance rule #9:
// "media re-encode if sent to >5"). The encrypted blob already differs per send
// (random media key), but the *content* hash does not — and that is the one
// that fingerprints.
//
// THE FIX: vary the plaintext bytes per send so each recipient gets a unique
// fileSha256, WITHOUT touching visible content and WITHOUT new dependencies.
// We append a short run of random bytes AFTER the format's end marker. For the
// formats handled here that trailing data is, by spec, ignored by every decoder
// (it sits past EOI / IEND / GIF trailer / %%EOF), so the image/document renders
// byte-identical to the recipient while the file hash changes every time.
//
// SCOPE: only formats whose trailing-data tolerance is rock-solid:
//   image/jpeg, image/png, image/gif, application/pdf.
// Video (mp4 atoms) and audio (ogg/opus pages, and PTT is server re-encoded)
// are NOT touched — trailing-byte surgery there can break playback or be
// stripped by server transcode. Those return unchanged (residual risk logged by
// the caller). webp is excluded (RIFF carries an explicit size; some decoders
// reject trailing bytes).

import { randomBytes } from 'node:crypto'

const VARIABLE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'application/pdf',
])

/** Lower bound / span for the appended random run. Length itself is randomized
 *  so even the file size differs between sends. */
const PAD_MIN = 9
const PAD_SPAN = 40

export interface MediaVariationResult {
  buffer: Buffer
  /** true when bytes were actually altered (caller logs/audits it). */
  varied: boolean
}

/**
 * Return a per-send unique variant of `buf` for hash-fingerprint avoidance.
 * No-op (returns the original buffer, varied:false) for unsupported mime types
 * or missing mime — never throws, never corrupts.
 */
export function varyMediaHash(buf: Buffer, mime: string | null | undefined): MediaVariationResult {
  if (!buf || buf.length === 0) return { buffer: buf, varied: false }
  const m = (mime ?? '').toLowerCase().split(';')[0]?.trim() ?? ''
  if (!VARIABLE_MIME.has(m)) return { buffer: buf, varied: false }

  // Random length in [PAD_MIN, PAD_MIN+PAD_SPAN]; random content. Both vary the
  // resulting fileSha256. Trailing bytes land past the format's end marker.
  const padLen = PAD_MIN + (randomBytes(1)[0]! % (PAD_SPAN + 1))
  const pad = randomBytes(padLen)
  return { buffer: Buffer.concat([buf, pad]), varied: true }
}
