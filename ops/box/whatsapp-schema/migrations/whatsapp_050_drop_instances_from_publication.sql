-- whatsapp_050_drop_instances_from_publication.sql
-- Enterprise-scale plan PHASE 2b — whatsapp_instances retirement, FINAL step.
-- Both postgres_changes consumers are re-homed onto broadcast:
--   • worker control plane → wa:node:<node_id> (mig 048, cut 'worker-instances'
--     channel, deployed + verified end-to-end);
--   • admin Numbers list → wa:biz:<business_id> (mig 049, FE cut postgres_changes,
--     commit 77911a8).
-- Verified live: `grep table:'whatsapp_instances' + postgres_changes` returns ZERO
-- bindings across src/ and the worker. So whatsapp_instances no longer needs to be
-- in the supabase_realtime publication — dropping it stops wal2json from decoding
-- its changes to OUTPUT (the keystone's realized scale win). The trigger-based
-- wa:node/wa:biz broadcasts are independent of publication membership (they use
-- realtime.send → the pgoutput messages slot), so they are UNAFFECTED.
--
-- Reversible: alter publication supabase_realtime add table whatsapp.whatsapp_instances;
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

alter publication supabase_realtime drop table whatsapp.whatsapp_instances;

commit;
