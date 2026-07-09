// Postgres + Supabase clients.
//
// Two distinct connection paths:
//
//  1. pg.Pool against the supavisor pooler in **TRANSACTION mode** (port 6543).
//     Transaction pooling hands a backend to a client only for one transaction
//     then returns it to a shared pool, so many worker nodes multiplex over few
//     backends — this is what breaks the ~2-node session-mode cap (→ ~15-40
//     nodes). The worker has ZERO session-state dependencies, which is what makes
//     transaction mode safe:
//       - NO pg_advisory_lock (per-number coordination is lease-based:
//         whatsapp.worker_*_instance_leases)
//       - NO LISTEN/NOTIFY (dispatch + media WAKES ride the wa:node broadcast —
//         Phase 3a; the dedicated listen connection is gone)
//       - NO search_path startup option (every object fully `whatsapp.`-qualified)
//       - NO named prepared statements
//     Every pool.query / checked-out-client transaction is self-contained.
//
//  2. @supabase/supabase-js with the service role key. Realtime subscriptions
//     (wa:node control + wakes, wa:conv threads, presence) + PostgREST-shape
//     table access.

import pg from 'pg'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from './config.js'
import { log } from './logger.js'

// --------- pg Pool ----------------------------------------------------------

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  // Transaction mode: each pool connection is a supavisor CLIENT connection (not
  // a pinned Postgres backend), so keep the per-node count small — fewer client
  // connections per node ⇒ more nodes fit under the pooler budget. Dispatcher
  // loops do tiny short transactions (claim, mark sent); 5 covers the concurrency
  // with margin. (Enterprise plan Phase 3a / W2.)
  max: 5,
  idleTimeoutMillis: 30_000,
  // Passed explicitly so we can grep pg_stat_activity.
  application_name: `igf-wa-worker/${config.workerVersion}`,
  // NO search_path startup option — every object our SQL touches (tables,
  // functions, enum casts) is fully `whatsapp.`-qualified, so the worker carries
  // zero per-session startup state, which is a prerequisite for transaction mode.
})

pool.on('error', (err) => {
  // Idle clients can fail (e.g., pooler restarts). Log and let pg.Pool recycle.
  log.error('pg.pool.idle_error', { error: err.message })
})

// --------- Supabase JS (service-role) ---------------------------------------

export const supabase: SupabaseClient = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: {
      // Long-lived connection. Reconnect logic is built into the SDK.
      params: { eventsPerSecond: 10 },
    },
  },
)

// LISTEN/NOTIFY removed (Phase 3a / transaction mode). Transaction pooling can't
// hold a persistent LISTEN subscription, and it was the worker's last session-
// state dependency. Dispatch + media wakes now ride the wa:node broadcast
// (instance-manager.ts 'wake_outbound'/'wake_media'; producers dual-emit via
// mig 055), so no dedicated listen connection is checked out anymore.

// --------- Graceful close ---------------------------------------------------

export async function closeDb(): Promise<void> {
  await pool.end()
  log.info('pg.pool.closed')
}
