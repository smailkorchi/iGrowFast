-- realtime_tenant_caps.sql  (OPS, not a schema migration — _realtime is Realtime-owned)
-- Enterprise-scale plan PHASE 1c (W5-caps). Raises the single platform Realtime
-- tenant off stock defaults so it can carry thousands of concurrent inbox tabs.
-- Ceilings only — raising them adds NO load; effect is picked up on the Realtime
-- tenant-cache refresh (no container restart, which would drop all live sockets).
-- APPLIED to live box .102 2026-07-09.
--
-- CONSERVATIVE on joins/sec + bytes: the self-host Realtime container is a single
-- BEAM with no memory limit (MemLimit=0); a join storm at high caps is the OOM
-- risk. Pair with a container memory reservation before pushing users much past a
-- few thousand (plan Phase 4).
--
-- Stock (pre-change): 200 / 100 / 100 / 100 / 100000.
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -X' < this-file

update _realtime.tenants set
  max_concurrent_users    = 5000,
  max_channels_per_client = 1000,
  max_events_per_second   = 2000,
  max_joins_per_second    = 500,
  max_bytes_per_second    = 1000000
where external_id = 'realtime-dev';
