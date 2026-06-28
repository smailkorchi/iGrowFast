-- Add referential integrity to the two COMPANY-side note-pointer columns on public.orders,
-- mirroring their already-FK'd courier twins (current_courier_payment_note_id /
-- current_courier_return_note_id, both FOREIGN KEY ... ON DELETE SET NULL).
--
-- Verified 2026-06-28 on prod + dev:
--   * payment_delivery_id    -> company_payment_notes : 1050 populated, 0 orphans, 0 values in
--                              courier_payment_notes (company-only; the courier link is the separate
--                              current_courier_payment_note_id column). Read by admin/Payments.tsx.
--   * current_return_note_id -> company_return_notes  : 149 populated, 0 orphans, 0 values in
--                              courier_return_notes (company-only; courier link = current_courier_return_note_id).
-- These were created before the FK convention the courier columns were added with — an inconsistency,
-- not a deliberate choice (it had already let dangling pointers exist). ON DELETE SET NULL makes a
-- deleted company note auto-clear the order's pointer, exactly like the courier side.
--
-- DELIBERATELY NOT TOUCHED: current_delivery_note_id. It is POLYMORPHIC — written by BOTH
-- link_company_parcels_to_delivery_note and link_courier_parcels_to_delivery_note, so it holds a
-- company_delivery_notes id for provider deliveries and a courier_delivery_notes id for courier
-- deliveries (3 such courier rows live there today), with no discriminator and no app reader. A
-- single-table FK would reject every courier value, so it intentionally stays FK-less.
--
-- Backing indexes added to match the courier twins (idx_orders_current_courier_payment_note is plain;
-- idx_orders_current_courier_return_note is partial WHERE NOT NULL) so the ON DELETE SET NULL lookup
-- is index-driven and the unindexed_foreign_keys advisory is not tripped.
--
-- No frontend/PostgREST impact (constraints + indexes are transparent to existing selects).
--
-- Rollback:
--   ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_delivery_id_fkey;
--   ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_current_return_note_id_fkey;
--   DROP INDEX IF EXISTS public.idx_orders_payment_delivery_id;
--   DROP INDEX IF EXISTS public.idx_orders_current_return_note;

CREATE INDEX IF NOT EXISTS idx_orders_payment_delivery_id
  ON public.orders USING btree (payment_delivery_id);

CREATE INDEX IF NOT EXISTS idx_orders_current_return_note
  ON public.orders USING btree (current_return_note_id)
  WHERE current_return_note_id IS NOT NULL;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_delivery_id_fkey
  FOREIGN KEY (payment_delivery_id) REFERENCES public.company_payment_notes(id) ON DELETE SET NULL;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_current_return_note_id_fkey
  FOREIGN KEY (current_return_note_id) REFERENCES public.company_return_notes(id) ON DELETE SET NULL;
