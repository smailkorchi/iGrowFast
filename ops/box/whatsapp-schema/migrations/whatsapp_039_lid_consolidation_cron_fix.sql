-- whatsapp_039_lid_consolidation_cron_fix.sql
-- Fix the @lid consolidation cron (was 13.8% of DB exec time; readiness audit).
--
-- OLD behaviour: _cron_consolidate_split_conversations ran EVERY MINUTE, looped
-- over ALL @lid conversations, and called consolidate_lid_conversation() on each
-- — which does a per-row _resolve_lid_to_phone() that returns NULL for the
-- (permanently) unresolvable ones (no phone will ever come for many @lid-only
-- contacts). So it reprocessed a growing backlog of dead rows forever, and
-- SWALLOWED every error (WHEN OTHERS THEN NULL) — a hidden failure.
--
-- Root insight: consolidation is ALREADY event-driven. The worker's
-- captureJidMapping (handlers.ts) calls whatsapp.consolidate_lid the MOMENT a
-- lid->phone mapping is discovered. This cron is only a fallback for a discovery
-- that path might miss — it must NOT be the blind, per-minute, scan-everything
-- engine.
--
-- FIX:
--   1) Only process @lid convs whose phone is ACTUALLY KNOWN NOW, via a JOIN to
--      contacts (uses contacts_instance_lid_key / contact_identifiers_uq /
--      conversations_lid_unmerged_idx) — NOT a per-row resolve on every
--      unresolvable @lid. Unresolvable @lids are skipped (they wait for a real
--      discovery event), so they stop being reprocessed.
--   2) SURFACE errors (RAISE WARNING with the conv id) instead of swallowing.
--   3) Drop the cadence from every-minute to every 5 min (it is a fallback;
--      the live event-driven path handles discovery immediately).
--
-- Live-safe: touches only the cron fn + its schedule. Does NOT change the send/
-- receive/ingest path or consolidate_lid_conversation itself.
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

create or replace function whatsapp._cron_consolidate_split_conversations()
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r record;
  v_err text;
begin
  -- Only RESOLVABLE @lid convs (phone known via a contact). The unresolvable
  -- backlog is excluded entirely — no per-row _resolve_lid_to_phone scan. Written
  -- as an index-driven UNION (not an OR, which forces a contacts seq-scan =
  -- O(N^2) at scale): branch A hits contacts_instance_lid_key, branch B hits
  -- contact_identifiers_uq. Both drive off conversations_lid_unmerged_idx.
  for r in
    select c.id
    from whatsapp.conversations c
    join whatsapp.contacts ct
      on ct.instance_id = c.instance_id
     and ct.lid = c.remote_jid
     and ct.merged_into is null
     and ct.phone_jid is not null
    where c.remote_jid like '%@lid' and c.merged_into is null and c.is_group = false
    union
    select c.id
    from whatsapp.conversations c
    join whatsapp.contact_identifiers ci
      on ci.instance_id = c.instance_id
     and ci.identifier = c.remote_jid
    join whatsapp.contacts ct
      on ct.id = ci.contact_id
     and ct.merged_into is null
     and ct.phone_jid is not null
    where c.remote_jid like '%@lid' and c.merged_into is null and c.is_group = false
  loop
    begin
      perform whatsapp.consolidate_lid_conversation(r.id);
    exception when others then
      get stacked diagnostics v_err = message_text;
      raise warning 'consolidate_lid_conversation(%) failed: %', r.id, v_err;
    end;
  end loop;
end;
$function$;

-- Fallback cadence: every 5 min instead of every minute (live path is immediate).
-- Unschedule by jobid (cron.unschedule by name is unreliable), then reschedule.
do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'consolidate_split_conversations';
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end $$;
select cron.schedule('consolidate_split_conversations', '*/5 * * * *',
                     'SELECT whatsapp._cron_consolidate_split_conversations()');

commit;
