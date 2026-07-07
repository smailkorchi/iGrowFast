-- One-time index-bloat reclaim, 2026-07-08 (sweep wave 0.4).
-- Cause: 10 instance pair→history-sync→delete test cycles cascaded ~89k message
-- deletes + 4.1k conversation deletes; heaps are tiny but indexes kept the dead
-- space (messages: 12MB idx on 328kB heap). REINDEX CONCURRENTLY = no write lock;
-- cannot run inside a transaction (each statement autocommits).
-- Run: ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file

\timing on

reindex table concurrently whatsapp.messages;
reindex table concurrently whatsapp.conversations;
reindex table concurrently whatsapp.contacts;
reindex table concurrently whatsapp.contact_identifiers;
reindex table concurrently whatsapp.contact_profiles;
reindex table concurrently whatsapp.media_fetch_jobs;
reindex table concurrently whatsapp.group_participants;
reindex table concurrently whatsapp.jid_mapping;
reindex table concurrently whatsapp.conversation_assignments;
reindex table concurrently whatsapp.whatsapp_instances;
reindex table concurrently whatsapp.outbound_queue;
reindex table concurrently whatsapp.app_cache;
reindex table concurrently whatsapp.agent_assign_cursor;
reindex table concurrently whatsapp.worker_health;
reindex table concurrently whatsapp.worker_instance_leases;
reindex table concurrently whatsapp.dispatcher_snapshot;
reindex table concurrently whatsapp.number_pacing_state;
reindex table concurrently whatsapp.scheduled_messages;

vacuum analyze whatsapp.messages, whatsapp.conversations, whatsapp.contacts,
  whatsapp.contact_identifiers, whatsapp.contact_profiles, whatsapp.media_fetch_jobs,
  whatsapp.group_participants, whatsapp.jid_mapping, whatsapp.conversation_assignments,
  whatsapp.whatsapp_instances, whatsapp.outbound_queue, whatsapp.app_cache;

-- After: re-check sizes
select c.relname, pg_size_pretty(pg_total_relation_size(c.oid)) as total,
       pg_size_pretty(pg_indexes_size(c.oid)) as idx
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='whatsapp' and c.relkind='r'
order by pg_total_relation_size(c.oid) desc limit 12;
