# TKT-9 — Package status history (design, LEAD, 2026-07-29)

## Goal
Own the package-status timeline: if the provider API is down (or purges old history), tracking still renders from OUR data. Clean, scalable to thousands of users, frugal on the box (PostgREST pool ≈10, no realtime amplification).

## Two layers

### L1 — `package_status_history` (append-only transition log; canonical)
One row per status transition of a parcel, captured by a DB TRIGGER on `company_parcels` + `courier_parcels` (`AFTER INSERT OR UPDATE OF status_id`). Trigger = catches EVERY writer (webhook, pollers via webhook, TKT-6 retro-apply, batch ops, manual SQL) with zero app-code dependence. Mirrors the `auto_log_order_status_change` house pattern (SECDEF fn, IS DISTINCT FROM guard) minus the UI-dedup window (no UI writes here — trigger is the only writer).
- Columns: id, "DigiCom Business" (CASCADE), order_id (CASCADE), company_parcel_id (SET NULL), courier_parcel_id (SET NULL), tracking_code text (denormalized — history survives parcel deletion), old_status_id (SET NULL), new_status_id (RESTRICT), created_at.
- Parcel FKs SET NULL deliberately: parcels get deleted (delivery-note flows); history must survive. order_id CASCADE: hard-deleted order → its history is meaningless.
- Indexes (3): (tracking_code, created_at), (order_id, created_at), ("DigiCom Business", created_at DESC). No status_id indexes — never queried by status.
- RLS: tenant SELECT only (authenticated); no INSERT/UPDATE/DELETE policies — SECDEF trigger + service role write.
- NO realtime publication, NO broadcast triggers.
- Retention: FOREVER — history is the point. Row ≈ 120 B. Scale math: today ~120 webhook transitions/day (826/7d, 1,988 parcels); at ×100 growth ≈ 12k rows/day ≈ 4.4M/yr ≈ 0.5 GB/yr. Unpartitioned is fine for years; partition by created_at range ONLY if volume observed >10M/yr (noted in migration comment; schema is partition-friendly: no inbound FKs, time-clustered writes).
- Backfill: one seed row per existing parcel at its current status (created_at = parcel.updated_at, old=NULL) — every parcel has a baseline; forward history grows from deploy.

### L2 — `parcel_tracking_snapshots` (rich provider-history cache)
The provider timeline carries data we can never reconstruct (comments « Facture … CRBT: 165 », livreur name/phone). Persist the last successful fetch:
- PK (provider_id, tracking_code); columns: "DigiCom Business" (CASCADE), order_id (CASCADE), status, status_label, history jsonb (the adapter's normalized array), fetched_at.
- Written by provider-integration `track_parcel` success path (service role, FAIL-OPEN, one reverse lookup of company_parcels by provider_id+tracking_code for biz/order). Write rate = user-driven tracking opens, dampened by the existing 10-min client cache — trivially low.
- One row per parcel ever tracked (upsert). Size ≈ #parcels × ~4 KB.
- RLS: tenant SELECT only.

### Read/fallback path (ParcelTrackingDialog)
Provider fetch fails (today: toast + close) → NEW: (1) query snapshot by tracking_code → render FULL history + quiet banner « Historique fournisseur indisponible — données du {fetched_at} » ; (2) else query L1 by tracking_code → slim timeline (label/color/icon via resolveById(new_status_id), date) + same banner; (3) else current behavior. Fallback feeds the SAME normalized trackingHistory state, so the TKT-8b demand cards and all downstream rendering work unchanged.

## Deliberately OUT (documented)
- No trigger on orders.package_status_id: it mirrors parcel status (sync triggers) → would double-log; orders without parcels get no provider webhooks (webhook resolves order THROUGH the parcel), so nothing is missed. Manual admin edits of the order mirror are not provider history.
- No pruning cron. No partitioning yet. No MB policies (no parcel UI for MBs).

## Execution stages
1. Migration authored → **Codex review BEFORE applying** → apply → BEGIN/ROLLBACK trigger simulations on box (zero side effects) → backfill verify counts.
2. Edge worker (snapshot upsert) ∥ frontend worker (fallback UI) → blind verifiers → Codex diff review.
3. Deploy edge + frontend; live checks: track a real parcel → snapshot row exists; synthetic-history render verified by code review (no logged-in browser available).
