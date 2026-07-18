-- whatsapp_069_auto_assign_outbound.sql
--
-- FIX (TKT-3): "orphan numbers stay unassigned despite auto-assign".
--
-- SYMPTOM. On macaron voiture, 54 DMs sat in "Non assignées" with auto-assign
-- ON and a valid pool. The trigger was not broken -- every one of those rows was
-- OUTBOUND-ONLY: someone messaged the customer first (typed on the handset, or a
-- seller opened a new chat), the customer never replied, and
-- messages_auto_assign_on_inbound only fired WHEN direction='inbound'. So a
-- conversation the business STARTED never got an owner. It self-healed only if
-- the customer answered (149 such conversations had already self-healed that way;
-- 58 never got a reply and stayed orphaned).
--
-- The same gap fed a bigger pile: admin_apply_auto_assign_backlog has no inbound
-- requirement, so earlier clicks of "Appliquer aux N maintenant" had already
-- assigned 1061 never-replied threads to one agent. Routing outbound at write
-- time makes the trigger and that button agree instead of drifting.
--
-- DECISION (owner, 2026-07-18): every conversation that is VISIBLE on the
-- Affectation page should be auto-assignable, whatever direction started it --
-- sellers can open new chats too, and a half-routed console is worse than a
-- uniformly routed one. @lid conversations stay excluded (they are unresolved
-- identities, invisible in the console, and the function's own resolution gate
-- already skips them).
--
-- CHANGE. One line: the trigger's WHEN clause. whatsapp._auto_assign_on_inbound()
-- never referenced NEW.direction -- its seven gates (2-minute freshness, group,
-- @lid resolution, instance enabled, non-empty pool, already-assigned,
-- eligible-commercial-in-pool) are all direction-agnostic. Dropping the WHEN
-- predicate is therefore sufficient AND complete: message_direction has exactly
-- two labels (inbound, outbound), so no predicate == both directions.
--
-- The 2-minute freshness gate is what keeps this safe. wa_sync_full_history is
-- on for this instance; a history replay inserts outbound rows with old
-- whatsapp_timestamps, and gate 1 drops them before any assignment is made. Only
-- live sends route.
--
-- COST. ~800-900 outbound messages/day fleet-wide (~1 per 100s), so widening the
-- trigger adds no meaningful write-path load and needs no gate reordering.
--
-- NAMING DEBT (deliberate, not an oversight): the function and trigger keep
-- their "_on_inbound" names even though they now cover both directions.
-- The identifier appears in 11 files including ops/box/whatsapp-schema/verify/
-- wave7b_verify.sql; renaming would break that verify script and churn four
-- recon docs for zero behavioural gain. The COMMENT below carries the truth.
--
-- NOT INCLUDED: the 54 already-orphaned conversations. This trigger only routes
-- messages inserted from now on. Clear the existing backlog with the console's
-- "Appliquer aux N maintenant" button (admin_apply_auto_assign_backlog), which
-- is the audited path and writes an auto_assign_backlog_applied audit row.
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

drop trigger if exists messages_auto_assign_on_inbound on whatsapp.messages;

create trigger messages_auto_assign_on_inbound
  after insert on whatsapp.messages
  for each row
  execute function whatsapp._auto_assign_on_inbound();

comment on function whatsapp._auto_assign_on_inbound() is
  'Auto-assigns a DM to the least-recently-assigned eligible agent in the '
  'instance pool. Despite the legacy "_on_inbound" name it fires on BOTH '
  'directions since 069 -- a conversation the business starts (handset-typed or '
  'seller-opened) needs an owner just as much as one a customer starts. Gates: '
  '2-minute freshness, not a group, @lid resolved, instance auto_assign_enabled, '
  'non-empty pool, not already assigned, pool member is an active commercial of '
  'the same business with an auth row.';

commit;
