// Structured JSON logger. Single line per event so journald + log aggregators
// can parse cleanly. No external dependency. Level filter from config.

import { config } from './config.js'

export type Level = 'debug' | 'info' | 'warn' | 'error'
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const threshold = ORDER[config.logLevel] ?? ORDER.info

export interface LogEntry {
  t: string
  level: Level
  msg: string
  extra?: Record<string, unknown>
}

// Optional sink hook (set by logSink at boot). Decoupled via registration so
// logger.ts never imports db/supabase (which import logger → would cycle).
// Always runtime-guarded: a sink failure must never break a log call.
let hook: ((entry: LogEntry) => void) | null = null
export function setLogHook(fn: ((entry: LogEntry) => void) | null): void { hook = fn }

function emit(level: Level, msg: string, extra?: Record<string, unknown>): void {
  if (ORDER[level] < threshold) return
  const t = new Date().toISOString()
  const line = {
    t,
    lvl: level,
    msg,
    worker: config.workerId,
    ...(extra ?? {}),
  }
  // stdout for info/debug, stderr for warn/error (systemd routes both into journal).
  const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout
  stream.write(JSON.stringify(line) + '\n')
  if (hook) {
    try { hook({ t, level, msg, ...(extra ? { extra } : {}) }) } catch { /* sink must never break logging */ }
  }
}

export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) => emit('debug', msg, extra),
  info:  (msg: string, extra?: Record<string, unknown>) => emit('info',  msg, extra),
  warn:  (msg: string, extra?: Record<string, unknown>) => emit('warn',  msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => emit('error', msg, extra),
}
