-- Drop 4 dead legacy header columns from transactions (db #65). 17→13 cols.
--
-- transactions migrated from a single-product header model to a line-item model (trns_purchase).
-- These 4 are leftovers of the old model — superseded by the trns_purchase line items
-- (which carry product_id / quantity / unit_price / sub_total):
--   product_id (0/25, has FK transactions_product_id_fkey + idx_transactions_product_id)
--   price      (0/25 null)
--   quantity   (all default 1, never set)
--   tva        (0/25, not even in the form schema)
--
-- Verified 2026-06-28: the admin Transactions insert/update sets only name/phone/email/address/note/
-- date/business (products go into trns_purchase items); InventorySection reads only
-- id/total_price/paid_price/date/status; no fn reads them (handle_transaction_financial_updates
-- computes total_price/paid_price from trns_purchase/trns_payment). The page select is `*` so it
-- adapts → no two-phase. Dropping product_id auto-drops its FK + index (depend only on the column).
--
-- Rollback:
--   ALTER TABLE public.transactions
--     ADD COLUMN product_id uuid, ADD COLUMN price numeric,
--     ADD COLUMN quantity integer DEFAULT 1, ADD COLUMN tva numeric DEFAULT 0;
--   ALTER TABLE public.transactions ADD CONSTRAINT transactions_product_id_fkey
--     FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
--   CREATE INDEX idx_transactions_product_id ON public.transactions USING btree (product_id);

ALTER TABLE public.transactions
  DROP COLUMN IF EXISTS product_id,
  DROP COLUMN IF EXISTS price,
  DROP COLUMN IF EXISTS quantity,
  DROP COLUMN IF EXISTS tva;
