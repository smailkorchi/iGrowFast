-- Drop 3 vestigial columns on courier_return_notes (twin of company_return_notes, 20260627070000).
-- All 0/1 on prod (0/1 on dev):
--   status_id  — dead FK -> package_statuses; return notes track lifecycle via the `status` text
--                column ('pending'/'received'), never the master id. Owned index idx_courier_rn_status_id.
--   note       — free-text never written (the return-note generation insert omits it). Unlike the
--                company twin it WAS named in an explicit .select() in courier/Payments.tsx (+ that
--                page's ReturnNote type) but its value was never read; both removed and DEPLOYED
--                before this migration (two-phase).
--   courier_delivery_note_id — speculative FK -> courier_delivery_notes, never wired (no writer/reader;
--                code refs to that column name target courier_parcels). Owned index idx_courier_rn_cdn_id.
-- Only delete_business references the table (by tenant). No trigger/RLS/view dep. status_id/cdn were
-- read-safe (only via select('*')); note required the two-phase deploy above. Each column's single
-- index + FK drops with it (no CASCADE). Rollback = re-add nullable cols + FKs + indexes (all NULL).
ALTER TABLE public.courier_return_notes DROP COLUMN IF EXISTS status_id;
ALTER TABLE public.courier_return_notes DROP COLUMN IF EXISTS note;
ALTER TABLE public.courier_return_notes DROP COLUMN IF EXISTS courier_delivery_note_id;
