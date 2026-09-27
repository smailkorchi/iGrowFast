# Historical Evidence Map — 2026-08-23

Status: accepted read-only scout report. Historical records are secondary to current live evidence.

## Timeline and major themes
- `AGENTS.md` records the self-hosted Supabase cutover on 2026-07-03; older managed-Supabase statements are stale.
- `docs/SECURITY_AUDIT_2026-07-03.md` opened the formal self-host/security audit.
- Git and project records show backup/DR work on July 4–5, WhatsApp build and hardening on July 5–13, scale/data rebuilds on July 14–17, and lifecycle/storage/mail work from July 26 through August 5.
- `docs/MASTER_TODO.md` records shipped keyset lists, server aggregates, gated analytics and role dashboards, customer pagination, atomic fee updates, honest imports, and removal of 1,000-row money-calculation limits.
- The Foreman ledger records atomic checked deletion, user archive/soft-delete, archived-session rejection, and cross-tenant denial with live negative batteries.

## Security and controls
- `docs/SECURITY_REMEDIATION_2026-07-03.md` covers caller authorization, privileged-column immutability, payout/order attribution, narrow anonymous lookup, tenant-bound RPCs, rate limits, host hardening, grants, retention, and idle timeouts.
- Later records cover admin-gated aggregate RPCs, closure of a cross-account React Query cache leak, WhatsApp QR/secret column revocation, and private typing-channel controls.

## Operations and resilience
- `docs/DR_RUNBOOK.md` documents encrypted PITR, independent logical dumps, upload mirror/archive, three-host restic coverage, configuration exports, escrow, watchdogs, and backup health reporting.
- Documented cadence includes nightly dumps, full/incremental backups, storage/config mirrors, weekly verification, second-location pulls, monthly restore drills, archiver monitoring, and mutual watchdogs.
- WhatsApp scale work covers private broadcasts, empty legacy publication, bounded fan-outs, node sharding, transaction-mode dispatch, indexed hot paths, server-side filtering/counts/search, queue self-healing, private presence, and R2 media handling.

## Evidence boundaries and residuals
- Current deployment/health claims require the 2026-08-23 live capture.
- Historical records preserve deferred low-value pages, a parked non-idempotent bulk payout path, conditional future horizontal Realtime scaling, unapproved retention-gap proposals, and stale WhatsApp queue/re-pair decisions.
- These residuals must be presented honestly and not merged with current live defects unless corroborated.

## Primary evidence paths
- `docs/MASTER_TODO.md`
- `docs/SECURITY_AUDIT_2026-07-03.md`
- `docs/SECURITY_REMEDIATION_2026-07-03.md`
- `docs/DR_RUNBOOK.md`
- `docs/WA_ENTERPRISE_SCALE_PLAN.md`
- `.foreman/ledger.md`
- `supabase/migrations/`
- Git history through `790f84e315614ccb065969b9004ce6dffbc8ad21`
