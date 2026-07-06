// Worker configuration loaded from environment. Fail fast if anything's missing.
// All callers import `config` (singleton); no scattered process.env reads.

function required(name: string): string {
  const v = process.env[name]
  if (!v || v.trim() === '') {
    throw new Error(`missing required env: ${name}`)
  }
  return v
}

function optional(name: string, fallback: string): string {
  const v = process.env[name]
  return v && v.trim() !== '' ? v : fallback
}

function optionalNumber(name: string, fallback: number): number {
  const v = process.env[name]
  if (!v) return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`env ${name} must be a number, got: ${v}`)
  return n
}

export const config = {
  // --- Postgres (Supabase pooler in session mode — preserves LISTEN/NOTIFY
  // and pg_advisory_lock; required for the dispatcher) ---
  databaseUrl: required('DATABASE_URL'),

  // --- Supabase JS (service role for Realtime + RPC) ---
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),

  // --- Evolution API (talks over internal docker network) ---
  evolutionApiUrl: required('EVOLUTION_API_URL'),
  evolutionGlobalApiKey: required('EVOLUTION_GLOBAL_API_KEY'),

  // --- Worker identity (persisted across restarts via env, not generated) ---
  workerId: optional('WORKER_ID', 'wa-mancer-worker-1'),
  workerVersion: optional('WORKER_VERSION', 'dev'),
  hostname: optional('HOSTNAME', 'unknown'),

  // --- Webhook HTTP server (reachable only on the internal docker network) ---
  webhookPort: optionalNumber('WEBHOOK_PORT', 8090),

  // Orphan reaper is OBSERVE-ONLY unless explicitly enabled (iGrowFast guard: deleting
  // Evolution instances is destructive; every legit instance has a DB row, but default
  // to logging so a DB outage can never cascade into instance deletion).
  reapOrphans: optional('WORKER_REAP_ORPHANS', 'false') === 'true',

  // --- Cloudflare R2 (chat media) ---
  // S3-compatible endpoint + access key scoped to a single bucket. The token
  // is scoped at Cloudflare; we don't need cross-bucket isolation here.
  r2MediaEndpoint:        required('R2_MEDIA_ENDPOINT'),
  r2MediaAccessKeyId:     required('R2_MEDIA_ACCESS_KEY_ID'),
  r2MediaSecretAccessKey: required('R2_MEDIA_SECRET_ACCESS_KEY'),
  r2MediaBucket:          optional('R2_MEDIA_BUCKET', 'whatsapp-media'),
  // Public custom domain fronting the R2 bucket. Profile pictures are cached
  // into R2 and served from here so the frontend never points at the
  // short-lived (expiring) pps.whatsapp.net CDN URLs.
  mediaPublicHost:        optional('MEDIA_PUBLIC_HOST', 'media.welcomdeal.ma'),

  // --- Operational ---
  heartbeatIntervalMs: optionalNumber('HEARTBEAT_INTERVAL_MS', 5_000),
  logLevel: optional('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',
} as const

export type Config = typeof config
