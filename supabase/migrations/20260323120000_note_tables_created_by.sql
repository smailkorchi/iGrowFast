-- Who created delivery/return notes (admin vs seller UI, draft scoping).
ALTER TABLE public.company_delivery_notes
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id);

ALTER TABLE public.company_return_notes
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id);

CREATE INDEX IF NOT EXISTS idx_company_delivery_notes_created_by
  ON public.company_delivery_notes (created_by);

CREATE INDEX IF NOT EXISTS idx_company_return_notes_created_by
  ON public.company_return_notes (created_by);

COMMENT ON COLUMN public.company_delivery_notes.created_by IS 'User who created the note; sellers scope open drafts by this column.';
COMMENT ON COLUMN public.company_return_notes.created_by IS 'User who created the return note.';
