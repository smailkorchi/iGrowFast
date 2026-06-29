-- CLEANUP (T7 trigger-sweep #7, 2026-06-29): remove the dead AFTER-INSERT courier-note
-- notification trigger + its function. They can never fire and only mislead readers.
--
-- trg_notify_courier_on_new_finalized_note ran AFTER INSERT ON courier_delivery_notes and only
-- inserted a courier_notifications row when COUNT(courier_parcels WHERE courier_delivery_note_id =
-- NEW.id) > 0. But the note id is generated (gen_random_uuid) at insert time and parcels are linked
-- by LATER statements (the FK courier_parcels.courier_delivery_note_id cannot reference a note that
-- does not yet exist). So at AFTER-INSERT time the parcel count is always 0 and the INSERT block
-- never runs. Its outer guard NEW.is_finalized IS TRUE is an additional blocker (is_finalized
-- defaults to false). Verified on prod: 18 notes, all created as drafts then finalized via UPDATE;
-- all 13 emitted notifications came from the live UPDATE twin.
--
-- The real, working path is notify_courier_on_note_finalization (AFTER UPDATE OF is_finalized),
-- which fires on the false->true finalization that every note goes through, by which point parcels
-- are linked. That trigger + function are KEPT untouched.
--
-- Rollback: recreate public.notify_courier_on_new_finalized_note() (AFTER INSERT body) and the
-- trigger trg_notify_courier_on_new_finalized_note AFTER INSERT ON public.courier_delivery_notes.

DROP TRIGGER IF EXISTS trg_notify_courier_on_new_finalized_note ON public.courier_delivery_notes;
DROP FUNCTION IF EXISTS public.notify_courier_on_new_finalized_note();
