-- Drop dead sheet_ingest_rows.issues (db #63). 15→14 cols.
--
-- Verified 2026-06-28: issues (jsonb) is 0/4 populated, ingest_sheet_rows (the ONLY fn touching the
-- table) never references it, and SheetReview.tsx embeds only (raw, status, sheet_row_number) — no
-- reader/writer anywhere. Reserved-but-unwired scaffolding for the in-progress sheet-sync validation
-- step (the needs_review status exists but its detail is never stored here). User-approved drop;
-- trivially re-addable as `jsonb` when that step is built.
--
-- No CHECK/index/FK on issues; SheetReview uses an explicit col embed (not select *) → no two-phase.
-- DROP without CASCADE. Rollback: ALTER TABLE public.sheet_ingest_rows ADD COLUMN issues jsonb;

ALTER TABLE public.sheet_ingest_rows DROP COLUMN IF EXISTS issues;
