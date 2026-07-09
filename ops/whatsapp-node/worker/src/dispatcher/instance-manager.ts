// Instance manager.
//
// Watches whatsapp.whatsapp_instances and keeps the per-number dispatcher
// loops aligned with the live state:
//
//   ┌─────────────────────────────────┬─────────────────────┐
//   │  DB state                       │  loop?              │
//   ├─────────────────────────────────┼─────────────────────┤
//   │  status='connected', !banned    │  YES (drains queue) │
//   │  status='connected', banned     │  NO (terminal)      │
//   │  status='connected', paused     │  YES (idle — RPC    │
//   │                                 │   blocks claims)    │
//   │  status='disconnected'|'error'  │  NO (would 4xx)     │
//   │  status='pending'|'connecting'  │  NO (not paired)    │
//   └─────────────────────────────────┴─────────────────────┘
//
// On Realtime DELETE we stop the dispatcher; the parent CASCADE will have
// already deleted queue rows.
//
// On Realtime UPDATE we refresh the cached InstanceConfig (worker_paused,
// lifecycle_state) without bouncing the loop.

import { pool, supabase } from '../db.js'
import { log } from '../logger.js'
import { setActiveNumbers } from '../heartbeat.js'
import { warmupPresenceChannels } from '../webhook/handlers.js'
import { config } from '../config.js'
import {
  loopCount,
  spawnDispatcher,
  stopDispatcher,
  updateInstanceConfig,
  wakeLoop,
} from './loop.js'
import { wakeMediaIngest } from './media-ingest.js'
import type { BusinessHours, InstanceConfig, InstanceLifecycleState, InstanceStatus } from './types.js'

// ── Multi-worker lease coordination ──────────────────────────────────────────
//
// Each worker process claims a subset of whatsapp_instances via expiring
// leases (60s default). Single-worker deployments behave identically — the
// lone worker claims everything. To add more workers, just scale the replica
// count: workers race to claim, leases serialize, expired leases roll over.
//
// Strategy here is "first-come" (every worker tries to claim every instance;
// whoever wins keeps it for the lease window). This is simpler than
// consistent hashing and adequate for our scale; can be tightened later if
// we want predictable instance→worker assignment.

const LEASE_DURATION_SEC = 60
const LEASE_RENEW_INTERVAL_MS = 20_000
const STATUS_RECONCILE_INTERVAL_MS = 45_000
// Orphan reaper: an Evolution instance with NO whatsapp_instances row is a
// leftover (DB row is created before the Evolution instance and deleted last,
// so "no DB row" = orphaned by a failed/partial delete — e.g. h-x3n7fobv).
// Reap it from Evolution. ORPHAN_MIN_AGE guards against deleting one that's
// mid-creation (belt-and-suspenders; the create order already prevents it).
const ORPHAN_REAP_INTERVAL_MS = 30 * 60_000
const ORPHAN_MIN_AGE_MS = 10 * 60_000
let renewTimer: NodeJS.Timeout | null = null
let reconcileTimer: NodeJS.Timeout | null = null
let reapTimer: NodeJS.Timeout | null = null
let ownedInstanceIds = new Set<string>()

// ---- Helpers ----------------------------------------------------------------

function shouldRun(status: InstanceStatus, lifecycle: InstanceLifecycleState): boolean {
  return status === 'connected' && lifecycle !== 'banned'
}

// We can't safely talk to Evolution without the per-instance token.
// reveal_instance_token is service-role only.
async function fetchToken(instanceId: string): Promise<string | null> {
  const { rows } = await pool.query<{ token: string | null }>(
    `SELECT whatsapp.reveal_instance_token($1) AS token`,
    [instanceId],
  )
  return rows[0]?.token ?? null
}

interface RawInstanceRow {
  id: string
  evolution_instance_name: string
  node_id: number | null
  status: InstanceStatus
  lifecycle_state: InstanceLifecycleState
  worker_paused: boolean
  business_hours: BusinessHours
  business_hours_enabled: boolean
  send_rate_per_min: number
  minute_burst_cap: number
  typing_base_ms: number
  typing_per_char_ms: number
  typing_cap_ms: number
  typing_enabled: boolean
  read_receipts_mode: 'off' | 'on_open' | 'on_dispatch'
  manual_presence: 'auto' | 'online' | 'offline'
  quiet_hours_override_until: string | null
}

async function toConfig(row: RawInstanceRow): Promise<InstanceConfig | null> {
  const token = await fetchToken(row.id)
  if (!token) {
    log.warn('instance.no_token', { number_id: row.id, name: row.evolution_instance_name })
    return null
  }
  return {
    id: row.id,
    evolutionInstanceName: row.evolution_instance_name,
    apiToken: token,
    lifecycleState: row.lifecycle_state,
    workerPaused: row.worker_paused,
    businessHours: row.business_hours,
    businessHoursEnabled: row.business_hours_enabled,
    sendRatePerMin:         row.send_rate_per_min,
    minuteBurstCap:         row.minute_burst_cap,
    typingBaseMs:           row.typing_base_ms,
    typingPerCharMs:        row.typing_per_char_ms,
    typingCapMs:            row.typing_cap_ms,
    typingEnabled:          row.typing_enabled,
    readReceiptsMode:       row.read_receipts_mode,
    manualPresence:         row.manual_presence,
    quietHoursOverrideUntil: row.quiet_hours_override_until,
  }
}

// ---- Reconciliation --------------------------------------------------------

async function applyState(row: RawInstanceRow): Promise<void> {
  const want = shouldRun(row.status, row.lifecycle_state)
  // We don't track per-loop existence here directly — loop.ts owns the map.
  // We use updateInstanceConfig to bump cached config; spawn/stop are
  // idempotent on their side (spawn warns + no-ops if already running, stop
  // is a no-op if not running).
  if (want) {
    const cfg = await toConfig(row)
    if (!cfg) return
    spawnDispatcher(cfg)            // no-op if already running
    updateInstanceConfig(cfg.id, cfg)
  } else {
    await stopDispatcher(row.id)
  }
  setActiveNumbers(loopCount())
}

const INSTANCE_SELECT = `SELECT id, evolution_instance_name, node_id, status, lifecycle_state,
       worker_paused, business_hours, business_hours_enabled,
       send_rate_per_min, minute_burst_cap,
       typing_base_ms, typing_per_char_ms, typing_cap_ms, typing_enabled,
       read_receipts_mode, manual_presence, quiet_hours_override_until
  FROM whatsapp.whatsapp_instances`

// ---- Evolution status reconciliation ---------------------------------------
//
// Instance `status` is normally event-sourced from Evolution's
// `connection.update` webhook (handlers.ts). But Evolution only emits that on
// a *transition*. If the `open` transition is missed — webhook delivered
// during a worker restart / resubscribe gap — the row stays stuck on its last
// state (e.g. 'connecting') forever, even though the socket is live. A stuck
// row is doubly bad: shouldRun() requires 'connected', so the dispatcher loop
// never spawns and the number can't send.
//
// This backstop polls Evolution's authoritative connectionState and heals the
// row. Conservative on purpose: only 'open'→connected and 'close'→disconnected
// are written. Transient 'connecting' is ignored so a mid-reconnect poll can't
// knock a healthy instance offline (webhooks own real transitions).

async function fetchEvolutionState(name: string): Promise<string | null> {
  const url = `${config.evolutionApiUrl.replace(/\/$/, '')}/instance/connectionState/${encodeURIComponent(name)}`
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(url, {
      headers: { apikey: config.evolutionGlobalApiKey },
      signal: controller.signal,
    })
    if (!res.ok) return null
    const body = await res.json() as { instance?: { state?: string } }
    return body?.instance?.state ?? null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

// ---- Auto-reconnect watchdog -----------------------------------------------
//
// Opt-in per instance (auto_reconnect column). When a number is genuinely down
// — Evolution 'close', or 'connecting' stuck past STUCK_CONNECTING_MS — the
// watchdog restarts it so it reconnects without a human. Guardrails keep it
// ban-safe:
//   • Exponential backoff between attempts (30s→1m→2m→5m cap).
//   • Hard attempt ceiling per down-episode; past it we give up and wait for a
//     clean 'open' (no infinite hammering).
//   • Terminal reasons (logged out / replaced / forbidden / md-mismatch) are
//     NOT restartable — restart would just spin to a QR. We stop and surface
//     'needs_repair' so an admin re-pairs.
// Episode state resets on a clean 'open'. Toggling auto_reconnect off clears it.

const WATCHDOG_BACKOFF_MS = [30_000, 60_000, 120_000, 300_000]
const WATCHDOG_MAX_ATTEMPTS = 6
const STUCK_CONNECTING_MS = 180_000 // 3 min
// Disconnect codes that GENUINELY wipe creds (re-pair required) — matched to
// Evolution's own terminal set {401 loggedOut, 403 forbidden, 402, 406}. NOT 440
// (connectionReplaced) nor 411 (md-mismatch): those KEEP creds and reconnect, so
// marking them needs_repair surfaced a false "ré-appairage requis" prompt in the
// UI (InstanceCard/NumberDetail/Dashboard). See memory reference_evolution_440_redis_war.
const TERMINAL_DISCONNECT_CODES = new Set([401, 403, 402, 406])

interface WatchdogState {
  downSince: number | null
  lastRestartAt: number | null
  attempts: number
  gaveUp: boolean
  terminal: boolean
}
const watchdog = new Map<string, WatchdogState>()

function wdState(id: string): WatchdogState {
  let s = watchdog.get(id)
  if (!s) {
    s = { downSince: null, lastRestartAt: null, attempts: 0, gaveUp: false, terminal: false }
    watchdog.set(id, s)
  }
  return s
}

async function restartEvolutionInstance(name: string): Promise<boolean> {
  const url = `${config.evolutionApiUrl.replace(/\/$/, '')}/instance/restart/${encodeURIComponent(name)}`
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(url, { method: 'POST', headers: { apikey: config.evolutionGlobalApiKey }, signal: controller.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

// ---- Orphan reaper ---------------------------------------------------------
//
// Deletes Evolution instances that have no whatsapp_instances row. This is the
// safety net for failed/partial app deletes (e.g. the historical h-x3n7fobv,
// stranded when instance-delete proceeded past an Evolution 5xx). Runs on a slow
// timer; conservative (age-gated) so it can never race a fresh pairing.

interface EvolutionInstanceRow {
  name?: string
  createdAt?: string | null
}

async function fetchAllEvolutionInstances(): Promise<EvolutionInstanceRow[]> {
  const url = `${config.evolutionApiUrl.replace(/\/$/, '')}/instance/fetchInstances`
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(url, { headers: { apikey: config.evolutionGlobalApiKey }, signal: controller.signal })
    if (!res.ok) return []
    const body = await res.json() as EvolutionInstanceRow[]
    return Array.isArray(body) ? body : []
  } catch {
    return []
  } finally {
    clearTimeout(t)
  }
}

async function deleteEvolutionInstance(name: string): Promise<boolean> {
  const url = `${config.evolutionApiUrl.replace(/\/$/, '')}/instance/delete/${encodeURIComponent(name)}`
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(url, { method: 'DELETE', headers: { apikey: config.evolutionGlobalApiKey }, signal: controller.signal })
    return res.ok || res.status === 404
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

async function reapOrphanEvolutionInstances(): Promise<void> {
  const evoInstances = await fetchAllEvolutionInstances()
  if (evoInstances.length === 0) return

  const { rows } = await pool.query<{ name: string }>(
    `SELECT evolution_instance_name AS name FROM whatsapp.whatsapp_instances`,
  )
  const known = new Set(rows.map((r) => r.name))
  const now = Date.now()

  for (const inst of evoInstances) {
    const name = inst.name
    if (!name || known.has(name)) continue
    // Age gate: only reap instances comfortably older than any in-flight create.
    const created = inst.createdAt ? Date.parse(inst.createdAt) : NaN
    if (Number.isFinite(created) && now - created < ORPHAN_MIN_AGE_MS) continue

    if (!config.reapOrphans) {
      log.warn('instance.orphan.detected', { name, created_at: inst.createdAt ?? null, action: 'observe-only (WORKER_REAP_ORPHANS!=true)' })
      continue
    }
    const ok = await deleteEvolutionInstance(name)
    log.warn('instance.orphan.reaped', { name, created_at: inst.createdAt ?? null, ok })
  }
}

async function fetchDisconnectReason(name: string): Promise<number | null> {
  const url = `${config.evolutionApiUrl.replace(/\/$/, '')}/instance/fetchInstances?instanceName=${encodeURIComponent(name)}`
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(url, { headers: { apikey: config.evolutionGlobalApiKey }, signal: controller.signal })
    if (!res.ok) return null
    const body = await res.json() as Array<{ disconnectionReasonCode?: number | null }>
    const code = Array.isArray(body) ? body[0]?.disconnectionReasonCode : null
    return typeof code === 'number' ? code : null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

// Acts on the already-fetched Evolution `state` for one instance. Called only
// when auto_reconnect=true and lifecycle <> 'banned'. `budget` is a per-cycle
// restart allowance shared across the whole reconcile fan-out.
async function runWatchdog(id: string, name: string, state: string, budget: { left: number }): Promise<void> {
  const s = wdState(id)
  const now = Date.now()

  if (state === 'open') {
    if (s.downSince !== null || s.attempts > 0 || s.gaveUp || s.terminal) {
      log.info('watchdog.recovered', { number_id: id, name, attempts: s.attempts })
    }
    s.downSince = null; s.lastRestartAt = null; s.attempts = 0; s.gaveUp = false; s.terminal = false
    return
  }

  // Down ('close' or 'connecting'). If we already stopped trying, hold.
  if (s.terminal || s.gaveUp) return
  if (s.downSince === null) s.downSince = now

  // 'connecting' is normal right after a (re)start — only treat it as a hang
  // once it's been stuck past the threshold.
  if (state === 'connecting' && (now - s.downSince) < STUCK_CONNECTING_MS) return

  // Backoff gate.
  if (s.lastRestartAt !== null) {
    const delay = WATCHDOG_BACKOFF_MS[Math.min(s.attempts - 1, WATCHDOG_BACKOFF_MS.length - 1)] ?? 30_000
    if (now - s.lastRestartAt < delay) return
  }

  // Attempt ceiling — stop hammering; wait for a clean 'open' to reset.
  if (s.attempts >= WATCHDOG_MAX_ATTEMPTS) {
    s.gaveUp = true
    log.error('watchdog.gave_up', { number_id: id, name, attempts: s.attempts, state })
    return
  }

  // Don't restart a session that only re-pairing can fix.
  const reason = await fetchDisconnectReason(name)
  if (reason !== null && TERMINAL_DISCONNECT_CODES.has(reason)) {
    s.terminal = true
    log.error('watchdog.terminal', { number_id: id, name, reason, state })
    await pool.query(
      `UPDATE whatsapp.whatsapp_instances SET status_detail = $2 WHERE id = $1`,
      [id, `needs_repair:${reason}`],
    ).catch(() => undefined)
    return
  }

  // Per-cycle restart budget — bound the mass-disconnect stampede. On the FIRST
  // tick after a mass disconnect every down instance has lastRestartAt=null and
  // would restart at once, slamming a recovering Evolution that is already
  // auto-reconnecting its persisted sessions (impedes recovery). Out of budget →
  // leave state untouched so this instance is retried next cycle (the drip).
  if (budget.left <= 0) return
  budget.left -= 1
  s.attempts += 1
  s.lastRestartAt = now
  const ok = await restartEvolutionInstance(name)
  log.warn('watchdog.restart', { number_id: id, name, attempt: s.attempts, state, reason, ok, budget_left: budget.left })
}

// Reconcile fan-out bounds (W6). Cap concurrent Evolution HTTP so a large node
// doesn't fire N connectionState/restart calls at once; env-overridable.
const RECONCILE_CONCURRENCY = (() => {
  const raw = process.env['RECONCILE_CONCURRENCY']
  const n = raw ? parseInt(raw, 10) : 8
  return Number.isFinite(n) && n > 0 ? Math.min(n, 32) : 8
})()
// Per-cycle restart budget = max(FLOOR, ceil(instances / DIVISOR)) — drips
// restarts so a mass-disconnect can't stampede a recovering Evolution.
const RESTART_BUDGET_DIVISOR = 20
const RESTART_BUDGET_FLOOR = 3

interface ReconcileRow {
  id: string
  name: string
  status: InstanceStatus
  auto_reconnect: boolean
  lifecycle_state: InstanceLifecycleState
}

// Re-entrancy guard: the 45s timer fires unconditionally, but the concurrency
// cap serializes HTTP so a mass-disconnect cycle can exceed 45s. A 2nd concurrent
// pass would double the restart budget and race the shared watchdog state.
let reconcileInflight = false

async function reconcileEvolutionStatuses(): Promise<void> {
  if (reconcileInflight) return
  reconcileInflight = true
  try {
    const { rows } = await pool.query<ReconcileRow>(
      // Node-scoped: fetchEvolutionState/watchdog talk to THIS node's local Evolution,
      // which only hosts this node's sessions — polling another node's instance here
      // would read 'close'/404 and wrongly flap it disconnected or restart it.
      `SELECT id, evolution_instance_name AS name, status, auto_reconnect, lifecycle_state
         FROM whatsapp.whatsapp_instances
        WHERE status <> 'pending' AND node_id = $1`,   // 'pending' = active QR pairing; leave it alone
      [config.nodeId],
    )
    if (rows.length === 0) return

    // Shared per-cycle restart budget across the fan-out.
    const budget = { left: Math.max(RESTART_BUDGET_FLOOR, Math.ceil(rows.length / RESTART_BUDGET_DIVISOR)) }
    let corrected = 0

    const reconcileOne = async (r: ReconcileRow): Promise<void> => {
      const state = await fetchEvolutionState(r.name)
      if (!state) return

      // Auto-reconnect watchdog (opt-in, never on a banned number). Runs on the
      // raw Evolution state — including 'connecting' for the stuck-hang case.
      if (r.auto_reconnect && r.lifecycle_state !== 'banned') {
        await runWatchdog(r.id, r.name, state, budget).catch((err) =>
          log.error('watchdog.failed', { number_id: r.id, error: err instanceof Error ? err.message : String(err) }),
        )
      } else {
        watchdog.delete(r.id) // disabled → drop episode state so re-enabling starts fresh
      }

      if (state === 'open' && r.status !== 'connected') {
        const res = await pool.query(
          `UPDATE whatsapp.whatsapp_instances
              SET status = 'connected'::whatsapp.instance_status,
                  status_detail = 'reconciled:open',
                  paired_at = COALESCE(paired_at, now()),
                  qr_code = NULL
            WHERE id = $1 AND status <> 'connected'`,
          [r.id],
        )
        if ((res.rowCount ?? 0) > 0) {
          corrected++
          log.warn('instance.status.reconciled', {
            number_id: r.id, name: r.name, from: r.status, to: 'connected', evo_state: state,
          })
        }
      } else if (state === 'close' && r.status !== 'disconnected') {
        const res = await pool.query(
          `UPDATE whatsapp.whatsapp_instances
              SET status = 'disconnected'::whatsapp.instance_status,
                  status_detail = 'reconciled:close'
            WHERE id = $1 AND status NOT IN ('disconnected', 'pending')`,
          [r.id],
        )
        if ((res.rowCount ?? 0) > 0) {
          corrected++
          log.warn('instance.status.reconciled', {
            number_id: r.id, name: r.name, from: r.status, to: 'disconnected', evo_state: state,
          })
        }
      }

      // Re-audit RANK 2 self-heal: if Evolution reports the socket CLOSED, make sure
      // no dispatcher is still draining the dead session. queue_claim_next does NOT
      // gate on status='disconnected', so a missed wa:node 'disconnect' broadcast
      // would otherwise keep the loop sending → 404s → premature dead-marking.
      // Idempotent (no-op if not running); the watchdog handles reconnection, and a
      // later 'open' respawns via wa:node / loadAllAndReconcile with the queue intact.
      if (state === 'close') {
        await stopDispatcher(r.id).catch(() => undefined)
      }
    }

    // Concurrency-capped fan-out: a fixed pool of workers drains a shared cursor,
    // so at most RECONCILE_CONCURRENCY Evolution calls are in flight at once.
    let cursor = 0
    const workerCount = Math.min(RECONCILE_CONCURRENCY, rows.length)
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (cursor < rows.length) {
        const r = rows[cursor++]!
        try {
          await reconcileOne(r)
        } catch (err) {
          log.error('reconcile.row_failed', { number_id: r.id, error: err instanceof Error ? err.message : String(err) })
        }
      }
    }))

    if (corrected > 0) {
      log.info('instance.status.reconcile_summary', { corrected, scanned: rows.length })
    }
  } finally {
    reconcileInflight = false
  }
}

async function claimLeases(instanceIds: string[]): Promise<Set<string>> {
  if (instanceIds.length === 0) return new Set()
  // Node-scoped claim: the RPC refuses any instance whose node_id <> our node,
  // so even a caller bug can never lease another node's numbers (defense behind
  // the node-filtered candidate scans below).
  const { rows } = await pool.query<{ out_instance_id: string }>(
    `SELECT out_instance_id FROM whatsapp.worker_claim_instance_leases($1, $2, $3, $4)`,
    [config.workerId, instanceIds, LEASE_DURATION_SEC, config.nodeId],
  )
  return new Set(rows.map((r) => r.out_instance_id))
}

async function renewLeases(): Promise<void> {
  try {
    // Node-scoped renewal (mig 054): only renew leases whose instance is STILL on
    // our node. A reassigned-away instance drops from stillOwned → we stopDispatcher
    // it below, and its unrenewed lease expires so the new node can claim it. This
    // is what makes the wa:node self-heal true in the reassign-away direction.
    const { rows } = await pool.query<{ out_instance_id: string }>(
      `SELECT out_instance_id FROM whatsapp.worker_renew_instance_leases($1, $2, $3)`,
      [config.workerId, LEASE_DURATION_SEC, config.nodeId],
    )
    const stillOwned = new Set(rows.map((r) => r.out_instance_id))

    // Try to claim any unowned instances ON THIS NODE (a peer worker may have died)
    const allConnected = await pool.query<{ id: string }>(
      `SELECT id FROM whatsapp.whatsapp_instances
        WHERE status = 'connected' AND lifecycle_state <> 'banned' AND node_id = $1`,
      [config.nodeId],
    )
    const candidateIds = allConnected.rows
      .map((r) => r.id)
      .filter((id) => !stillOwned.has(id))

    if (candidateIds.length > 0) {
      const newlyClaimed = await claimLeases(candidateIds)
      newlyClaimed.forEach((id) => stillOwned.add(id))
      if (newlyClaimed.size > 0) {
        log.info('instance.lease.claimed_extra', { count: newlyClaimed.size, ids: [...newlyClaimed] })
        // Reconcile the newly-claimed ones so they get a dispatcher loop
        const { rows: extraRows } = await pool.query<RawInstanceRow>(
          `${INSTANCE_SELECT} WHERE id = ANY($1)`,
          [[...newlyClaimed]],
        )
        for (const row of extraRows) await applyState(row).catch(() => undefined)
      }
    }

    // Any instances we used to own but no longer hold the lease for: stop them
    for (const id of ownedInstanceIds) {
      if (!stillOwned.has(id)) {
        log.warn('instance.lease.lost', { number_id: id })
        await stopDispatcher(id).catch(() => undefined)
      }
    }

    ownedInstanceIds = stillOwned
    setActiveNumbers(loopCount())
  } catch (err) {
    log.error('instance.lease.renew_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function loadAllAndReconcile(): Promise<void> {
  // Only instances on THIS node — a worker serves exactly its co-located Evolution.
  const { rows } = await pool.query<RawInstanceRow>(
    `${INSTANCE_SELECT} WHERE node_id = $1`, [config.nodeId],
  )
  log.info('instance.initial_load', { count: rows.length, node_id: config.nodeId })

  // Claim leases for all candidate instances (status filter applied by
  // shouldRun later; the lease layer doesn't care about runnability).
  const candidateIds = rows.map((r) => r.id)
  const claimed = await claimLeases(candidateIds)
  ownedInstanceIds = claimed
  log.info('instance.lease.initial_claim', { candidate: candidateIds.length, claimed: claimed.size })

  for (const row of rows) {
    if (!claimed.has(row.id)) {
      log.info('instance.lease.skipped', { number_id: row.id, owned_by: 'peer_worker' })
      continue
    }
    await applyState(row).catch((err) =>
      log.error('instance.initial_apply_failed', {
        number_id: row.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  }
  setActiveNumbers(loopCount())
  // Pre-warm typing-presence broadcast channels so the first inbound
  // PRESENCE_UPDATE doesn't race against channel subscription.
  await warmupPresenceChannels(rows.filter((r) => claimed.has(r.id)).map((r) => r.id))
}

// ---- Realtime subscription -------------------------------------------------

let nodeChannel: ReturnType<typeof supabase.channel> | null = null
// wa:node is at-most-once; on reconnect-after-error we do a full node-local
// reconcile to catch any control-plane change missed while the socket was down.
let wanodeHadError = false

// Shared control-plane reconcile — used by BOTH the legacy postgres_changes
// channel and the wa:node broadcast (enterprise Phase 2b). Node-gate first (a row
// on another node — or reassigned away — means stop our loop), else spawn/update.
// Idempotent, so dual-delivery from both feeds during the cutover is a safe no-op.
async function applyInstanceControl(row: RawInstanceRow): Promise<void> {
  if (!row?.id) return
  if (row.node_id !== config.nodeId) {
    await stopDispatcher(row.id).catch(() => undefined)
    setActiveNumbers(loopCount())
    return
  }
  await applyState(row)
}

export async function startInstanceManager(): Promise<void> {
  // Heal any rows stuck on a stale status BEFORE we decide which loops to run
  // — loadAllAndReconcile()/leases gate on status='connected', so a stuck
  // 'connecting' would otherwise be skipped and never get a dispatcher.
  await reconcileEvolutionStatuses().catch((err) =>
    log.error('instance.status.reconcile_failed_initial', {
      error: err instanceof Error ? err.message : String(err),
    }),
  )

  await loadAllAndReconcile()

  // Periodic lease renewal (also claims any newly-orphaned instances)
  renewTimer = setInterval(() => { void renewLeases() }, LEASE_RENEW_INTERVAL_MS)
  renewTimer.unref()

  // Periodic status backstop — catches connection.update webhooks missed
  // during steady state, not just at boot.
  reconcileTimer = setInterval(() => { void reconcileEvolutionStatuses().catch(() => undefined) }, STATUS_RECONCILE_INTERVAL_MS)
  reconcileTimer.unref()

  // Periodic orphan reaper — deletes Evolution instances with no DB row.
  reapTimer = setInterval(() => {
    void reapOrphanEvolutionInstances().catch((err) =>
      log.error('instance.orphan.reap_failed', { error: err instanceof Error ? err.message : String(err) }))
  }, ORPHAN_REAP_INTERVAL_MS)
  reapTimer.unref()

  // Enterprise Phase 2b KEYSTONE — SOLE control-plane feed. The legacy
  // 'worker-instances' postgres_changes channel on whatsapp_instances was REMOVED
  // here (verified: wa:node reconciled a forced write end-to-end); whatsapp_instances
  // left the supabase_realtime publication (mig 050). This node subscribes ONLY its
  // OWN instance changes via wa:node:<node_id> (mig 048) — no wal2json decode of
  // every other node's rows. service_role authorizes the private channel by RLS
  // bypass (no wa:node policy). A missed at-most-once broadcast self-heals within
  // the lease interval: renewLeases() rescans node_id=self connected instances,
  // claims un-owned, and applyState()s them (spawns dispatchers) — the same backstop
  // coverage the worker always had. Boot state comes from loadAllAndReconcile().
  nodeChannel = supabase
    .channel(`wa:node:${config.nodeId}`, { config: { private: true } })
    .on('broadcast', { event: 'instance' }, async ({ payload }) => {
      try {
        const p = payload as (RawInstanceRow & { deleted?: boolean }) | undefined
        if (!p) return
        if ((p as { deleted?: boolean }).deleted === true) {
          const id = (p as { id?: string }).id
          if (id) {
            await stopDispatcher(id)
            setActiveNumbers(loopCount())
            log.info('instance.deleted.wanode', { number_id: id })
          }
          return
        }
        const row = p as RawInstanceRow
        await applyInstanceControl(row)
        log.info('instance.reconciled.wanode', {
          number_id: row.id, status: row.status, lifecycle: row.lifecycle_state,
        })
      } catch (err) {
        log.error('instance.wanode_handler_failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })
    // Phase 3a additive: dispatch/media WAKES over wa:node (dual-run alongside the
    // LISTEN 'outbound_enqueued'/'media_fetch_ready' path — mig 055 dual-emits).
    // wakeLoop/wakeMediaIngest are self-filtering (no-op if this node doesn't own
    // the number / has no pending media), so a wake is always safe to receive.
    .on('broadcast', { event: 'wake_outbound' }, ({ payload }) => {
      const numberId = (payload as { number_id?: string })?.number_id
      if (numberId) { log.info('wanode.wake_outbound', { number_id: numberId }); wakeLoop(numberId) }
    })
    .on('broadcast', { event: 'wake_media' }, ({ payload }) => {
      const messageId = (payload as { message_id?: string })?.message_id
      if (messageId) { log.info('wanode.wake_media', { message_id: messageId }); wakeMediaIngest(messageId) }
    })
    .subscribe((status) => {
      log.info('instance.wanode_status', { status })
      if (status === 'SUBSCRIBED') {
        if (wanodeHadError) {
          wanodeHadError = false
          // Reconnected — a wa:node control change (assign/reassign/disconnect/rate)
          // may have fired while we were down. Full node-local reconcile catches it.
          void loadAllAndReconcile().catch((err) =>
            log.error('instance.wanode.reconcile_failed', {
              error: err instanceof Error ? err.message : String(err),
            }))
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        wanodeHadError = true
      }
    })
}

export async function stopInstanceManager(): Promise<void> {
  if (renewTimer) {
    clearInterval(renewTimer)
    renewTimer = null
  }
  if (reconcileTimer) {
    clearInterval(reconcileTimer)
    reconcileTimer = null
  }
  if (reapTimer) {
    clearInterval(reapTimer)
    reapTimer = null
  }
  // Release leases so a peer worker (or our own restart) picks up immediately
  // without waiting for the 60s expiry.
  try {
    await pool.query(`SELECT whatsapp.worker_release_instance_leases($1)`, [config.workerId])
    log.info('instance.lease.released_on_shutdown')
  } catch (err) {
    log.warn('instance.lease.release_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  if (nodeChannel) {
    await supabase.removeChannel(nodeChannel)
    nodeChannel = null
  }
}
