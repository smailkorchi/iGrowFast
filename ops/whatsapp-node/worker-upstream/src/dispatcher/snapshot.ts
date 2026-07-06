// dispatcher_snapshot writer. Decoupled from the per-number dispatch loops: ONE grouped UPSERT for
// all instances on a fixed cadence, isolated in try/catch so a snapshot failure can NEVER affect
// dispatch / ban-safety. Replaces the frontend's 2s 3-read poll (number_pacing_state + instance_stats
// + outbound_queue COUNT) with a single Realtime-fanned row per instance.
//
// sends_last_min uses the SAME action_type set the frontend RateMeter used (excludes send_contact),
// so the live meter value is unchanged by this migration.

import { pool } from '../db.js'
import { log } from '../logger.js'

const SNAPSHOT_SQL = `
insert into public.dispatcher_snapshot
  (instance_id, last_dispatched_at, last_completed_at, last_send_at,
   sends_last_min, queue_queued, queue_dispatching, queue_dead_24h, updated_at)
select i.id,
  p.last_dispatched_at, p.last_completed_at, p.last_send_at,
  coalesce(count(*) filter (where q.status='sent' and q.dispatched_at > now()-interval '60 seconds'
     and q.action_type in ('send_text','send_media','send_poll','react','edit_message','delete_message')),0)::int,
  coalesce(count(*) filter (where q.status='queued'),0)::int,
  coalesce(count(*) filter (where q.status='dispatching'),0)::int,
  coalesce(count(*) filter (where q.status='dead' and q.completed_at > now()-interval '24 hours'),0)::int,
  now()
from public.whatsapp_instances i
left join public.number_pacing_state p on p.number_id = i.id
left join public.outbound_queue q on q.number_id = i.id
group by i.id, p.last_dispatched_at, p.last_completed_at, p.last_send_at
on conflict (instance_id) do update set
  last_dispatched_at = excluded.last_dispatched_at,
  last_completed_at  = excluded.last_completed_at,
  last_send_at       = excluded.last_send_at,
  sends_last_min     = excluded.sends_last_min,
  queue_queued       = excluded.queue_queued,
  queue_dispatching  = excluded.queue_dispatching,
  queue_dead_24h     = excluded.queue_dead_24h,
  updated_at         = excluded.updated_at
`

let timer: ReturnType<typeof setInterval> | null = null

async function writeOnce(): Promise<void> {
  try {
    await pool.query(SNAPSHOT_SQL)
  } catch (err) {
    log.warn('dispatcher_snapshot.write_failed', { error: err instanceof Error ? err.message : String(err) })
  }
}

/** Start the periodic snapshot writer (default 3s). Idempotent. */
export function startDispatcherSnapshot(intervalMs = 3_000): void {
  if (timer) return
  void writeOnce() // prime immediately so a freshly-opened panel isn't empty
  timer = setInterval(() => { void writeOnce() }, intervalMs)
  timer.unref()
}

export function stopDispatcherSnapshot(): void {
  if (timer) { clearInterval(timer); timer = null }
}
