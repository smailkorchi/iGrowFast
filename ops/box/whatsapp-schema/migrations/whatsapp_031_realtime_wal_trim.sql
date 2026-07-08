-- whatsapp_031_realtime_wal_trim.sql — enterprise-audit Stage 0 (realtime WAL).
-- The Supabase Realtime wal2json poll is the #1 DB statement (63.8% of all DB
-- exec time at 2 tenants); its cost is linear in the WAL byte-volume of the
-- supabase_realtime publication. Two zero-risk WAL reductions:
--
-- 1. DROP three tables with ZERO frontend subscribers from the publication —
--    every WAL change to them was decoded + RLS-matched + delivered to no one:
--      worker_health      (5s heartbeat UPSERT, ~2 writes/s/instance)
--      audit_log          (append-only, the old NumberDetail timeline sub was
--                          removed in the config redesign — 0 live subs verified)
--      conversation_notes (dormant feature, no sub in either repo)
--    Verified live: realtime.subscription has NONE of these; grep of src/whatsapp
--    finds no postgres_changes subscription to them. Owner Log/Monitor pages (if
--    ever built) read these via REST/RPC polling, not realtime.
--
-- 2. whatsapp_instances REPLICA IDENTITY FULL → DEFAULT. FULL writes the ENTIRE
--    old-row image (59 cols incl. multi-KB qr_code text + 2 bytea + 5 jsonb) into
--    WAL on every UPDATE. No subscription filters on a non-PK column (only
--    id=eq.<id> and unfiltered new-image reads), so FULL buys nothing here while
--    ~doubling per-update WAL. DEFAULT (PK) still carries id in DELETE payloads.
--
-- Reversible: ADD TABLE / REPLICA IDENTITY FULL.
-- Run: ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file

begin;

alter publication supabase_realtime drop table whatsapp.worker_health;
alter publication supabase_realtime drop table whatsapp.audit_log;
alter publication supabase_realtime drop table whatsapp.conversation_notes;

alter table whatsapp.whatsapp_instances replica identity default;

commit;

-- Verify:
--   select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='whatsapp';
--     (expect worker_health/audit_log/conversation_notes ABSENT)
--   select relreplident from pg_class where oid='whatsapp.whatsapp_instances'::regclass;  -- expect 'd'
