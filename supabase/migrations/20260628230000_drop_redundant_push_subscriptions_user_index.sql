-- Drop 1 redundant index on push_subscriptions (Web Push / VAPID store, 3 rows). Index-only hygiene.
--
-- Verified 2026-06-28 (db-column-cleanup-progress #54):
--   idx_push_subscriptions_user(user_id) is left-prefix-redundant with the UNIQUE upsert arbiter
--   push_subscriptions_user_id_endpoint_key(user_id, endpoint), which serves user_id-equality
--   lookups via its leading column. The planner tie-broke onto the plain index (38 scans); those
--   lookups transparently move to the UNIQUE composite. The hot "active subs for a user" path
--   (WHERE user_id=x AND revoked_at IS NULL) uses the PARTIAL idx_push_subscriptions_active — kept.
--
-- KEPT: push_subscriptions_pkey, push_subscriptions_user_id_endpoint_key (UNIQUE),
-- idx_push_subscriptions_active (partial WHERE revoked_at IS NULL). All 11 columns are wired
-- (notifications.ts subscribe/unsubscribe + send-courier-push sender). No col/type/frontend change.
--
-- Rollback:
--   CREATE INDEX idx_push_subscriptions_user ON public.push_subscriptions USING btree (user_id);

DROP INDEX IF EXISTS public.idx_push_subscriptions_user;
