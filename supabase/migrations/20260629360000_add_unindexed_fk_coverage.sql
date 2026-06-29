-- OPTIMIZATION (index sweep 2026-06-29): add btree indexes covering the 23 foreign keys that had
-- NO backing index. Rationale (ADD-only, conservative — nothing is dropped):
--   1) Correctness/perf NOW: an unindexed FK forces a sequential scan of the CHILD table every time a
--      referenced PARENT row is updated/deleted (RI enforcement). These indexes remove that.
--   2) Future-proofing: these are the indexes the JOIN/filter paths will need as the tables grow.
-- Cost is negligible — all are low-write tables (config / notes / connections / invitations / docs),
-- plus orders.exchange_of_order_id and customers.master_city_id (the two sized tables, 1755 / 1677 rows).
--
-- NOTE: the empirically-hot app queries (orders list, seller_daily_earnings) are NOT index-limited
-- (orders scan = 0.3ms; the latency is RLS re-eval + per-row commission function) so no index is added
-- for them here — those are separate RLS / query-rewrite optimizations.
--
-- Rollback: DROP each index by name.

-- created_by (-> users.id): "my records" filters + user-delete RI scans
CREATE INDEX IF NOT EXISTS idx_factures_created_by                  ON public.factures (created_by);
CREATE INDEX IF NOT EXISTS idx_devis_created_by                     ON public.devis (created_by);
CREATE INDEX IF NOT EXISTS idx_bons_commande_created_by            ON public.bons_commande (created_by);
CREATE INDEX IF NOT EXISTS idx_bons_livraison_created_by           ON public.bons_livraison (created_by);
CREATE INDEX IF NOT EXISTS idx_courier_payment_notes_created_by    ON public.courier_payment_notes (created_by);
CREATE INDEX IF NOT EXISTS idx_courier_return_notes_created_by     ON public.courier_return_notes (created_by);
CREATE INDEX IF NOT EXISTS idx_ga_connections_created_by           ON public.google_analytics_connections (created_by);
CREATE INDEX IF NOT EXISTS idx_meta_ads_connections_created_by     ON public.meta_ads_connections (created_by);
CREATE INDEX IF NOT EXISTS idx_email_templates_created_by          ON public.email_templates (created_by);
CREATE INDEX IF NOT EXISTS idx_email_accounts_created_by           ON public.email_accounts (created_by);
CREATE INDEX IF NOT EXISTS idx_credential_change_requests_requested_by ON public.credential_change_requests (requested_by);

-- user_invitations lifecycle actors (-> users.id)
CREATE INDEX IF NOT EXISTS idx_user_invitations_revoked_by         ON public.user_invitations (revoked_by);
CREATE INDEX IF NOT EXISTS idx_user_invitations_consumed_by        ON public.user_invitations (consumed_by);

-- tenant / business scoping FKs
CREATE INDEX IF NOT EXISTS idx_courier_payment_note_orders_digicom_business ON public.courier_payment_note_orders ("DigiCom Business");
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_digicom_business ON public.push_subscriptions ("DigiCom Business");
CREATE INDEX IF NOT EXISTS idx_mediabuyer_ga_access_business_id    ON public.mediabuyer_ga_access (business_id);
CREATE INDEX IF NOT EXISTS idx_mediabuyer_meta_access_business_id  ON public.mediabuyer_meta_access (business_id);

-- entity-reference FKs
CREATE INDEX IF NOT EXISTS idx_orders_exchange_of_order_id         ON public.orders (exchange_of_order_id);
CREATE INDEX IF NOT EXISTS idx_customers_master_city_id            ON public.customers (master_city_id);
CREATE INDEX IF NOT EXISTS idx_courier_delivery_notes_zone_id      ON public.courier_delivery_notes (zone_id);
CREATE INDEX IF NOT EXISTS idx_email_log_account_id                ON public.email_log (account_id);
CREATE INDEX IF NOT EXISTS idx_recurring_charges_type_id           ON public.recurring_charges (type_id);
CREATE INDEX IF NOT EXISTS idx_campaign_source_locks_mediabuyer_id ON public.campaign_source_locks (mediabuyer_id);
