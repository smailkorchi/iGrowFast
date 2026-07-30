TASK: Adversarially review a new Postgres trigger migration before it is applied to a production Supabase (self-hosted, PG17) database. Assume it is broken until proven otherwise. Read-only.

FILE: supabase/migrations/20260726190000_order_provider_coverage_guard.sql

DOMAIN FACTS (verified live):
- public.orders: company_id uuid NULL (FK providers ON DELETE SET NULL), master_city_id uuid NULL (FK master_cities ON DELETE SET NULL). High-write table (~2k rows, COD e-commerce).
- public.master_cities.zone_id uuid NULL (FK zones).
- public.company_zones(company_id FK providers, zone_id FK zones, "DigiCom Business" FK businesses) — RLS: tenant-scoped policy TO authenticated; a dedicated deny-by-default `mediabuyer` role exists that CANNOT read company_zones; service_role and postgres also write orders (edge functions, triggers, imports).
- providers are per-business; company_zones rows for a provider belong to that provider's business.
- One legacy order intentionally violates the rule (must remain untouched by normal edits that don't SET company_id/master_city_id).
- Postgres role `postgres` owns these tables (not superuser). Migration is applied as postgres via psql.

REVIEW DIMENSIONS:
1. Correctness of the trigger semantics: BEFORE INSERT OR UPDATE OF company_id, master_city_id — does UPDATE OF fire on any UPDATE whose SET clause merely includes the column even with an unchanged value, and is that acceptable here? Any path where the legacy violating row gets bricked (e.g. an UPDATE that SETs company_id to its current uncovered value — do common ORMs/supabase-js .update() calls send full row payloads)?
2. SECURITY DEFINER: owner will be postgres (table owner). Does the SELECT on company_zones/master_cities inside bypass RLS reliably (table owner + no FORCE RLS)? Any privilege-escalation or search_path risk given `set search_path = public, pg_temp`?
3. Failure modes: NULL handling, city with NULL zone (deliberately allowed), concurrent company_zones deletion (race), ON DELETE SET NULL interactions (FK setting company_id to NULL — does that fire UPDATE OF company_id and pass?).
4. Supabase-specific: does raising an exception from a BEFORE trigger surface cleanly through PostgREST to supabase-js (error, not 500 crash-loop)? errcode 23514 choice sane?
5. Anything that would corrupt or block unrelated writes (status updates from provider webhooks, payments triggers, etc. that don't touch these two columns).

OUTPUT: first line VERDICT: PASS / FAIL / PASS_WITH_NOTES, then numbered findings <=30 lines. Do not modify files. Do not spawn agents.
