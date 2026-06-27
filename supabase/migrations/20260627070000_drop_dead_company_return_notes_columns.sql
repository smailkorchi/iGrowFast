-- Drop 3 vestigial columns on company_return_notes (all 0/34 prod, 0/33 dev).
--
--   status_id  — dead FK -> package_statuses. Return notes track lifecycle via the `status`
--                text column ('pending'/'received'), never via the master id. Owned the now-dead
--                index idx_crn_status_id (dropped automatically with the column).
--   note       — free-text never written (the return-note generation insert in the admin/seller
--                ReturnNote pages omits it) and never read (it surfaced in the ReturnNote type
--                only because the fetch uses select('*')).
--   company_delivery_note_id — speculative FK -> company_delivery_notes, never wired: no code
--                writer/reader (every code reference to this column name targets company_parcels,
--                a different table). Owned the now-dead index idx_crn_cdn_id.
--
-- None are referenced by any function (only delete_business touches the table, by tenant id),
-- trigger, RLS policy, or view/matview. DROP without CASCADE verified clean on dev first
-- (zero catalog dependents). Each column's single-column index + FK drop with the column.
-- The only readers use select('*'), so no frontend redeploy was required ahead of this drop.
-- Rollback = re-add the nullable columns + their FKs + indexes; no data lost (all were NULL).
ALTER TABLE public.company_return_notes DROP COLUMN IF EXISTS status_id;
ALTER TABLE public.company_return_notes DROP COLUMN IF EXISTS note;
ALTER TABLE public.company_return_notes DROP COLUMN IF EXISTS company_delivery_note_id;
