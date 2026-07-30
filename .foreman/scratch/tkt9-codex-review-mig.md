Adversarial review of ONE UNAPPLIED migration before it goes to a live self-hosted Postgres (Supabase-style: roles authenticated/service_role, RLS-centric). Read the file `supabase/migrations/20260729120000_package_status_history.sql` in this repo, plus the design doc `.foreman/scratch/tkt9-design.md` for intent, and try to REFUTE its safety and correctness.

CONTEXT you must weigh (all verified live):
- company_parcels: 1,988 rows; courier_parcels: 20; ~120 status transitions/day arrive via a provider-webhook edge fn (service role). Existing AFTER triggers on both parcel tables: sync-status-to-order (row), set_order_unpaid_on_delivery (row), statement-level realtime broadcast triggers, clear-order-logistics on DELETE. The new history trigger ADDS one more AFTER ROW trigger on status_id.
- The DB previously suffered from wal2json/realtime write amplification (since retired) — new tables must NOT enter any publication (the migration doesn't touch publications; confirm nothing implicit).
- helper fn current_user_digicom_business_id() exists and is the house RLS pattern; house exemplar table order_status_history uses SECDEF trigger fn auto_log_order_status_change.
- The webhook edge fn writes parcels with service_role (bypasses RLS). Courier statuses are ALSO updated from the frontend by authenticated courier users (their UPDATE on courier_parcels fires the trigger — the trigger fn is SECURITY DEFINER so the history INSERT must succeed for them; verify that reasoning holds with the migration as written, including function ownership semantics when applied via psql as postgres).
- Parcels are deleted in delivery-note flows; orders are mostly soft-deleted but can be hard-deleted; package_statuses masters are deletable by the owner UI today (orders FK already RESTRICTs when referenced).

ATTACK ANGLES:
1. Trigger correctness: INSERT vs UPDATE paths, NULL handling, IS NOT DISTINCT FROM logic, TG_TABLE_NAME dispatch, recursion risk (does inserting into history fire anything?), interaction/order with the existing AFTER triggers (alphabetical firing — any hazard?).
2. Backfill: run-once semantics inside the transaction (triggers are already created BEFORE the backfill INSERTs run — do the backfill INSERTs themselves fire the new trigger?? The INSERT is into package_status_history, not the parcel tables — verify no path double-logs; also verify column lists match).
3. RLS/grants: can authenticated write anything? Can a tenant read another tenant's rows through any join? Is SELECT grant + policy sufficient for PostgREST embeds (users/statuses joins from the frontend)?
4. FK topology: SET NULL vs CASCADE vs RESTRICT choices — any deletion path that now FAILS that previously succeeded (package_statuses deletion via Status.tsx now RESTRICTed by history — acceptable? orders hard-delete cascade cost)? Any cascade that silently destroys history it shouldn't?
5. Performance: index choice (3 btrees) vs write rate; trigger cost per webhook; backfill lock duration on 2k rows; anything that could bloat or hold locks at scale.
6. Idempotency/replay: what happens if this migration file is accidentally applied twice?
7. parcel_tracking_snapshots: PK choice (provider_id, tracking_code), jsonb unbounded growth risk, missing constraints.

OUTPUT: first line PASS / FAIL / PASS_WITH_NOTES. Findings ranked, each with the exact SQL location, concrete failure scenario, one-line fix. State explicitly what you could NOT verify statically.
