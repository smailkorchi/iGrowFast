// Webhook authentication.
//
// Trust model:
//   * The worker runs on the same internal docker network as Evolution.
//     Inbound requests SHOULD only come from `wa-mancer-evolution`. Compose
//     networking enforces this when published only on the internal network.
//   * Belt-and-suspenders: each webhook URL embeds the instance_id (UUID) in
//     the path. Per-instance secret in a custom header authenticates that
//     the caller really is Evolution holding the secret we issued at instance
//     creation time. Constant-time comparison to avoid timing side-channels.
//
// Why not HMAC: Evolution v2.3.7 does not sign payloads. It does support
// static custom headers on outbound webhook calls, which is what we use.
// A future Evolution release with per-payload HMAC can plug in here.

import { timingSafeEqual } from 'node:crypto'
import { pool } from '../db.js'

const SECRET_HEADER = 'x-wa-mancer-secret'

// In-memory cache of decrypted secrets keyed by instance_id. TTL bounded so
// a rotated secret takes effect within ~30s without restarting the worker.
interface CachedSecret { value: string; fetchedAt: number }
const cache = new Map<string, CachedSecret>()
const CACHE_TTL_MS = 30_000

async function getInstanceSecret(instanceId: string): Promise<string | null> {
  const now = Date.now()
  const cached = cache.get(instanceId)
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value
  }
  const { rows } = await pool.query<{ secret: string | null }>(
    `SELECT public.reveal_instance_webhook_secret($1) AS secret`,
    [instanceId],
  )
  const secret = rows[0]?.secret ?? null
  if (secret) {
    cache.set(instanceId, { value: secret, fetchedAt: now })
  } else {
    cache.delete(instanceId)
  }
  return secret
}

export function invalidateSecretCache(instanceId: string): void {
  cache.delete(instanceId)
}

function constantTimeEqual(a: string, b: string): boolean {
  // Different-length buffers throw in timingSafeEqual. Pad to equal length
  // before comparing so the comparison itself remains constant-time.
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/**
 * Verify that the incoming request carries the right secret for the
 * instance_id from the URL.
 *
 * Returns `null` on success, or a brief error string suitable for an HTTP
 * response body on failure.
 */
export async function verifyWebhook(
  instanceId: string,
  headerSecret: string | undefined,
): Promise<string | null> {
  if (!headerSecret) return 'missing secret header'
  const expected = await getInstanceSecret(instanceId)
  if (!expected) return 'no secret configured for instance'
  if (!constantTimeEqual(headerSecret, expected)) return 'secret mismatch'
  return null
}

export { SECRET_HEADER }
