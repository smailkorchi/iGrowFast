-- Drop 2 redundant plain indexes on provider_webhooks (per-provider inbound-webhook config, 4 rows).
--
-- Verified 2026-06-28 (db-column-cleanup-progress #52): each plain index is a single-column btree
-- that exactly duplicates a UNIQUE constraint index on the same column:
--   * idx_provider_webhooks_secret(webhook_secret)      ⊂  provider_webhooks_webhook_secret_key UNIQUE(webhook_secret)
--   * idx_provider_webhooks_provider_id(provider_id)    ⊂  provider_webhooks_provider_id_key      UNIQUE(provider_id)
--
-- The planner currently picks the PLAIN indexes (tie-broken by oid): secret 3531 scans / provider_id 60,
-- while the UNIQUE twins show 0 scans. Dropping the plain ones transparently shifts those equality lookups
-- (the inbound provider-webhook auth `.eq('webhook_secret',x)` and provider-id joins) onto the UNIQUE
-- indexes — identical Index Scan plans, EXPLAIN-confirmed — with the uniqueness constraints intact.
-- The UNIQUE indexes MUST stay (one webhook per provider; webhook_secret integrity) and also keep the
-- provider_id FK index-covered (no unindexed_fk regression). idx_provider_webhooks_digicom_business
-- (1893 scans, backs the tenant FK, no UNIQUE twin) is KEPT. No columns/types/frontend touched.
--
-- Rollback:
--   CREATE INDEX idx_provider_webhooks_secret ON public.provider_webhooks USING btree (webhook_secret);
--   CREATE INDEX idx_provider_webhooks_provider_id ON public.provider_webhooks USING btree (provider_id);

DROP INDEX IF EXISTS public.idx_provider_webhooks_secret;
DROP INDEX IF EXISTS public.idx_provider_webhooks_provider_id;
