-- whatsapp_015_wa_nodes_grants.sql — edge-fn smoke test caught: wa_nodes was deny-all (RLS on, no
-- policies, no grants), but instance-create (edge, service_role) needs node placement reads and the
-- worker/deploy path registers nodes. Grant service_role full DML (BYPASSRLS) + owner fleet SELECT
-- (consistent with worker_health/system_logs fleet surfaces). Sweep confirmed the only other
-- no-service_role tables are encryption_keys + agent_assign_cursor — both deliberately locked.
grant select, insert, update, delete on whatsapp.wa_nodes to service_role;
create policy wa_nodes_owner_select on whatsapp.wa_nodes for select to authenticated using (public.is_owner());
grant select on whatsapp.wa_nodes to authenticated;
