TASK: Adversarially review supabase/migrations/20260726210000_unmatched_provider_status_queue.sql before it hits a production self-hosted Supabase (PG17). Assume broken until proven. Read-only.

DOMAIN FACTS (verified live):
- public.company_parcels: id, provider_id, order_id, status_id (FK package_statuses, SET NULL), created_at, updated_at, company_delivery_note_id, external_id, provider_response, tracking_code, "DigiCom Business". Parcel status_id updates fire sync triggers that cascade to orders (money-bearing: date_livraison, UNPAID flips, stock).
- public.package_statuses: global master book; delivery_service_statuses jsonb array of raw strings; matched by match_package_status() via containment OR lower(unaccent()) equality; semantic flags drive money logic. Owner-only writes via RLS (is_owner()).
- extensions.unaccent exists (used by match_package_status with SET search_path public, extensions).
- is_owner() exists; auth.uid() standard. postgres (table owner, not superuser) applies migrations. Roles: anon (being revoked platform-wide), authenticated, service_role, mediabuyer (deny-by-default). Edge fn calls log_unmatched_provider_status as service_role.
- Applied via psql with ON_ERROR_STOP wrapped in BEGIN/COMMIT by the operator.

REVIEW DIMENSIONS:
1. ON CONFLICT (provider_type, lower(raw_status)) — does the expression conflict target correctly match the unique index as written? Any inference failure at runtime?
2. SQL-language SECURITY DEFINER fn log_unmatched_provider_status: safety of resetting resolved_at/resolved_status_id on conflict (a previously-resolved mapping reappearing unmatched reopens the row) — any way this fights resolve_unmatched_provider_status concurrently?
3. resolve_unmatched_provider_status: FOR UPDATE row lock; double-resolve protection; the jsonb append (dedup check via lower(unaccent) vs match fn semantics — could the appended string still not match future webhooks in any case?); retro-apply UPDATE correctness (matching on lower(unaccent(raw_provider_status)); could it hit parcels of a DIFFERENT provider whose raw string collides — and is that acceptable given mappings are globally provider-agnostic anyway?); GET DIAGNOSTICS usage.
4. search_path choices: resolve fn has public, extensions, pg_temp; log fn has public, pg_temp only — does the log fn need extensions? (It doesn't call unaccent — but the unique index lower() is plain; confirm.) Any search-path injection risk.
5. RLS/grants: policy owner-only FOR ALL to authenticated; explicit grants to authenticated (RLS-gated) — is SELECT by non-owner authenticated users correctly blocked? service_role path for the edge fn INSERT via the SECDEF fn — is direct table grant to service_role needed or does SECDEF cover it? anon revocations sufficient? mediabuyer implicitly denied?
6. Idempotency/re-run safety (IF NOT EXISTS usage vs CREATE POLICY which lacks it — re-running the file fails on the policy; acceptable for one-shot migration but flag it), FK choices (resolved_status_id no ON DELETE action — status deletion blocked by other FKs anyway?), index bloat, anything else.

OUTPUT: first line VERDICT: PASS / FAIL / PASS_WITH_NOTES, numbered findings <=30 lines. No file modifications, no agents.
