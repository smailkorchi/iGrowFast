// Drives the admin-platform-logs persist mode every 60s so Supabase platform logs (api/pg/auth/
// storage/realtime/edge) accrue into system_logs. Fire-and-forget; a Logflare/PAT/Management-API
// outage degrades to a debug log and NEVER throws into the worker. timer.unref() so it can't hold
// the process open. Uses the service-role key (the fn's persist mode authenticates by it).
import { config } from './config.js'
import { log } from './logger.js'

let timer: ReturnType<typeof setInterval> | null = null
const INTERVAL_MS = 60_000

async function pullOnce(): Promise<void> {
  try {
    const url = `${config.supabaseUrl}/functions/v1/admin-platform-logs`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.supabaseServiceRoleKey}`, apikey: config.supabaseServiceRoleKey },
      body: JSON.stringify({ mode: 'persist' }),
    })
    if (!resp.ok) log.debug('platformlog.persist_non_ok', { status: resp.status })
  } catch (e) {
    log.debug('platformlog.persist_failed', { err: (e as Error).message })
  }
}

export function startPlatformLogPull(): void {
  if (timer) return
  timer = setInterval(() => { void pullOnce() }, INTERVAL_MS)
  timer.unref?.()
  void pullOnce()
}

export function stopPlatformLogPull(): void {
  if (timer) { clearInterval(timer); timer = null }
}
