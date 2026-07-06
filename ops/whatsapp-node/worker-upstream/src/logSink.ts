// Operational log sink → public.system_logs.
//
// Mirrors HIGH-SIGNAL worker logs into the DB so the in-app monitoring page can
// query them. Deliberately NOT a firehose: warn/error are always persisted; info
// only for a curated allowlist of significant events. debug is never persisted.
// (The worker emits 100–200 lines/s under load — persisting all of it would blow
// the DB. Raw noise stays in journald / the live platform-logs proxy.)
//
// Design constraints: fire-and-forget, batched, never blocks the hot path, and
// drops on backpressure rather than growing unbounded. Registered as a logger
// hook at boot so logger.ts stays free of any db import (no cycle).

import { config } from './config.js'
import { supabase } from './db.js'
import { setLogHook, type LogEntry } from './logger.js'

// info-level events worth persisting (everything warn/error is kept regardless).
const INFO_ALLOWLIST = new Set<string>([
  'worker.boot', 'worker.ready', 'worker.shutdown',
  'webhook.connection.updated', 'webhook.connection.unknown_state',
  'webhook.qrcode.refreshed',
  'watchdog.recovered', 'watchdog.restart', 'watchdog.gave_up', 'watchdog.terminal', 'watchdog.failed',
  'instance.deleted', 'instance.status.reconciled', 'instance.lease.lost', 'instance.no_token',
  'instance.lifecycle_changed',
  'dispatcher.dead', 'dispatcher.spawned', 'dispatcher.stopped',
  'pg.connected', 'listen.reconnecting',
])

// ── payload sanitization ────────────────────────────────────────────────────
// system_logs is all-admin readable, 14-day retained, and CSV/JSON exportable,
// so NOTHING sensitive may land in payload. We (a) redact values under known
// sensitive keys, and (b) scrub phone numbers / JIDs out of EVERY string value
// (catches PII embedded in free-text like evolution error bodies). Bounded depth
// + size so a log payload can never bloat a row.
const SENSITIVE_KEYS = new Set([
  'jid', 'phone_jid', 'phonejid', 'phone', 'phone_number', 'phonenumber', 'lid',
  'remotejid', 'remote_jid', 'senderjid', 'sender_jid', 'participant', 'number',
  'body', 'text', 'caption', 'message', 'vcard', 'contact',
  'token', 'secret', 'apikey', 'api_key', 'authorization', 'password', 'qr', 'pairingcode', 'pairing_code',
])
const MAX_STR = 600
const MAX_PAYLOAD_CHARS = 4000

function scrubString(s: string): string {
  let out = s
    .replace(/\b\d{6,}@[a-z0-9._-]+/gi, '[jid]')   // 2126…@s.whatsapp.net / @lid
    .replace(/\b\d{10,15}\b/g, '[num]')             // bare E.164-ish phone numbers
  if (out.length > MAX_STR) out = out.slice(0, MAX_STR) + '…'
  return out
}

function sanitizeValue(key: string, value: unknown, depth: number): unknown {
  if (SENSITIVE_KEYS.has(key.toLowerCase())) return '[redacted]'
  if (typeof value === 'string') return scrubString(value)
  if (value === null || typeof value !== 'object') return value
  if (depth >= 2) return '[…]'
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitizeValue(key, v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitizeValue(k, v, depth + 1)
  return out
}

function sanitizePayload(extra: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!extra) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(extra)) out[k] = sanitizeValue(k, v, 0)
  // Hard cap on serialized size.
  let json = JSON.stringify(out)
  if (json && json.length > MAX_PAYLOAD_CHARS) return { _truncated: true, preview: json.slice(0, MAX_PAYLOAD_CHARS) }
  return out
}

interface SinkEntry {
  occurred_at: string
  source: 'worker'
  level: string
  event: string
  worker_id: string
  instance_id: string | null
  conversation_id: string | null
  actor_uid: null
  target_type: null
  target_id: string | null
  payload: Record<string, unknown>
}

const MAX_BUFFER = 1000
const FLUSH_MS = 4000
const FLUSH_AT = 50

let buffer: SinkEntry[] = []
let dropped = 0
let timer: ReturnType<typeof setInterval> | null = null
let flushing = false

function pickId(extra: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!extra) return null
  for (const k of keys) {
    const v = extra[k]
    if (typeof v === 'string' && v.length) return v
  }
  return null
}

function shouldPersist(e: LogEntry): boolean {
  if (e.level === 'debug') return false
  if (e.level === 'warn' || e.level === 'error') return true
  return INFO_ALLOWLIST.has(e.msg)
}

function onLog(e: LogEntry): void {
  // Never re-ingest our own sink failures — would loop on a persistent DB error.
  if (e.msg.startsWith('logsink.')) return
  if (!shouldPersist(e)) return

  if (buffer.length >= MAX_BUFFER) { dropped++; return }

  const extra = e.extra
  buffer.push({
    occurred_at: e.t,
    source: 'worker',
    level: e.level,
    event: e.msg,
    worker_id: config.workerId,
    instance_id: pickId(extra, ['number_id', 'instance_id', 'instanceId']),
    conversation_id: pickId(extra, ['conversation_id', 'conversationId']),
    actor_uid: null,
    target_type: null,
    target_id: pickId(extra, ['message_id', 'queue_id', 'target_id']),
    payload: sanitizePayload(extra),
  })

  if (buffer.length >= FLUSH_AT) void flush()
}

async function flush(): Promise<void> {
  if (flushing || buffer.length === 0) return
  flushing = true
  const batch = buffer
  buffer = []
  if (dropped > 0) {
    batch.push({
      occurred_at: new Date().toISOString(), source: 'worker', level: 'warn',
      event: 'logsink.dropped', worker_id: config.workerId,
      instance_id: null, conversation_id: null, actor_uid: null, target_type: null, target_id: null,
      payload: { dropped },
    })
    dropped = 0
  }
  try {
    const { error } = await supabase.rpc('ingest_system_logs', { p_entries: batch })
    // On failure we do NOT requeue (avoid unbounded growth / poison batches);
    // the loss is bounded and only operational logs. Surface to stderr only.
    if (error) process.stderr.write(JSON.stringify({ t: new Date().toISOString(), lvl: 'error', msg: 'logsink.flush_failed', worker: config.workerId, error: error.message, n: batch.length }) + '\n')
  } catch (err) {
    process.stderr.write(JSON.stringify({ t: new Date().toISOString(), lvl: 'error', msg: 'logsink.flush_threw', worker: config.workerId, error: err instanceof Error ? err.message : String(err) }) + '\n')
  } finally {
    flushing = false
  }
}

export function startLogSink(): void {
  setLogHook(onLog)
  timer = setInterval(() => { void flush() }, FLUSH_MS)
  timer.unref()
}

export async function stopLogSink(): Promise<void> {
  setLogHook(null)
  if (timer) { clearInterval(timer); timer = null }
  await flush()
}
