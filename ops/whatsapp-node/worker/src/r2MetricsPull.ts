// R2 storage sampler. Every 10min, ListObjectsV2 (paginated) over the media bucket using the
// worker's EXISTING R2 S3 credentials → authoritative storage_bytes + object_count → ingest_r2_metrics
// (PostgREST + service_role). No Cloudflare API token needed (the CF token lacks Account Analytics
// Read + can't mint sub-tokens; the worker's own R2 creds are durable and live with the app).
// class A/B ops + egress are left null (advisory) — those need the GraphQL analytics dataset.
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { config } from './config.js'
import { log } from './logger.js'

const s3 = new S3Client({
  region: 'auto', endpoint: config.r2MediaEndpoint, forcePathStyle: true,
  credentials: { accessKeyId: config.r2MediaAccessKeyId, secretAccessKey: config.r2MediaSecretAccessKey },
})
const INGEST = `${config.supabaseUrl}/rest/v1/rpc/ingest_r2_metrics`
let timer: ReturnType<typeof setInterval> | null = null
const INTERVAL_MS = 10 * 60_000

async function sampleOnce(): Promise<void> {
  let entry: Record<string, unknown>
  try {
    let token: string | undefined, bytes = 0, count = 0, pages = 0
    do {
      const r = await s3.send(new ListObjectsV2Command({ Bucket: config.r2MediaBucket, ContinuationToken: token, MaxKeys: 1000 }))
      for (const o of r.Contents ?? []) { bytes += o.Size ?? 0; count++ }
      token = r.IsTruncated ? r.NextContinuationToken : undefined; pages++
    } while (token && pages < 100)
    entry = { bucket: config.r2MediaBucket, storage_bytes: bytes, object_count: count, class_a_ops: null, class_b_ops: null, egress_bytes: null, sample_ok: true }
  } catch (e) {
    entry = { bucket: config.r2MediaBucket, storage_bytes: null, object_count: null, sample_ok: false, err: (e as Error).message?.slice(0, 200) }
    log.debug('r2metrics.list_failed', { err: (e as Error).message })
  }
  try {
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 10_000)
    const r = await fetch(INGEST, { method: 'POST', signal: ac.signal,
      headers: { apikey: config.supabaseServiceRoleKey, Authorization: 'Bearer ' + config.supabaseServiceRoleKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_entries: [entry] }) })
    clearTimeout(to)
    if (!r.ok) log.debug('r2metrics.ingest_non_ok', { status: r.status })
  } catch (e) { log.debug('r2metrics.ingest_failed', { err: (e as Error).message }) }
}

export function startR2MetricsPull(): void {
  if (timer) return
  timer = setInterval(() => { void sampleOnce() }, INTERVAL_MS)
  timer.unref?.()
  void sampleOnce()
}
export function stopR2MetricsPull(): void {
  if (timer) { clearInterval(timer); timer = null }
}
