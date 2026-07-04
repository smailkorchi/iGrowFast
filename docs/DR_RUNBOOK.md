# iGrowFast — Disaster Recovery Runbook

Written 2026-07-04 (backup build Phases 0–11). **No secrets in this file** — every secret is
named in `docs/SECRETS_REGISTER.md` and lives in the Mac Keychain, the hosts' root-600 files,
or the offline DR escrow card. Start here, pick your scenario, follow it top to bottom.

**Root of trust:** the DR escrow card (offline copy + Mac copy). It alone decrypts every backup.
Account access (Cloudflare / Contabo / Hostinger / Google / GitHub) lives in the owner's iCloud
Keychain; Apple ID recovery is the root dependency for accounts.

## The estate

| What | Where (primary) | Copies |
|---|---|---|
| Postgres (PITR, any minute) | R2 `igf-db-backups/pgbackrest/` (aes-256-cbc) | toolbox `/srv/db-pulls/pgbackrest/` (weekly) |
| Postgres (logical dumps, nightly) | R2 `igf-db-backups/logical/` (age) — 30d lifecycle | toolbox keeps 4 newest (weekly); Mac monthly pull |
| User uploads (igf-storage) | live R2 bucket | R2 `igf-db-backups/storage-mirror/current` + dated `archive/` (45d) |
| Server config/state (3 boxes) | R2 `igf-config-backups/restic/{box,toolbox,whatsapp}` | — (R2 is the copy; sources are the boxes) |
| CF dashboard state (tunnels/DNS/rules) | inside box restic set (`/root/config-exports/`) | re-exportable any time via `igf-cf-export.sh` |
| Vault key chain + `.env` + `functions.env` | R2 `igf-config-backups/escrow/` (age) | plaintext on escrow card (C1/C2) |
| Decryption keys | Mac Keychain (see register) | DR escrow card (Desktop + offline copy) |

## Health signals (before anything else, know what still works)

- Dashboard: `/owner/backups` (owner account with `backup_admin`).
- Agent direct: `https://backup-api.igrowfast.com/api/status` (bearer = owner session JWT).
  The agent runs OUTSIDE the compose stack (own cloudflared) — it survives a stack outage.
- Heartbeats raw: `igf-db-backups/heartbeat/vmi3390870/`, `igf-config-backups/heartbeat/{vmi3414204,vmi3418398}/`.
- Watchdogs: toolbox watches box; box watches toolbox + whatsapp. Alerts email
  the addresses in each box's `smtp.env` (protonmail first, gmail backstop).

## S1 — Someone deleted/broke rows or a table (DB still healthy)

Best tool: a **drill clone at the moment before the mistake**, then copy the data out.
```
ssh igf
igf-restore-drill.sh --target "YYYY-MM-DD HH:MM:SS+00" --keep
docker exec -u postgres igf-restore-drill psql -U supabase_admin -d postgres   # inspect / COPY out
# when done:
docker rm -f igf-restore-drill && rm -rf /srv/restore-drill
```
The clone is fully isolated (no TCP, no network, cron/pg_net inert). Extract what you need
(`COPY (…) TO STDOUT`), apply to live with normal SQL. Nothing live is touched by the drill.

## S2 — A deleted user upload

Object layout mirrors storage-api: `stub/<bucket>/<key>/<version-uuid>`.
There is NO writable rclone remote for `igf-storage` on the box (the RW token is wired only
into storage-api's env, and `r2src` is read-only). To copy an object back you must first define
a temporary RW remote from the `cf-igf-r2-igf-storage` token, then copy:
```
# 1. locate it in the mirror (current, then the dated deletion archive/<date>/)
rclone lsf r2db:igf-db-backups/storage-mirror/current/stub/<bucket>/ | grep <name>
# 2. build a one-off RW remote from the igf-storage token (Keychain cf-igf-r2-igf-storage on the Mac,
#    or mint a scoped one) and copy back:
export RCLONE_CONFIG=/dev/null RCLONE_CONFIG_R2STOR_TYPE=s3 RCLONE_CONFIG_R2STOR_PROVIDER=Cloudflare \
  RCLONE_CONFIG_R2STOR_ACCESS_KEY_ID=<key> RCLONE_CONFIG_R2STOR_SECRET_ACCESS_KEY=<secret> \
  RCLONE_CONFIG_R2STOR_ENDPOINT=https://8897211ce4bdb3eff028770e3dc584be.r2.cloudflarestorage.com \
  RCLONE_CONFIG_R2STOR_REGION=auto RCLONE_CONFIG_R2STOR_NO_CHECK_BUCKET=true
rclone copy r2db:igf-db-backups/storage-mirror/current/<path> r2stor:igf-storage/<dir>/
```
If the `storage.objects` row is also gone, restore it too (see reconciliation section of
`igf-db-backups/logical/RESTORE_RUNBOOK.md`) — the object alone won't reappear in the app without its row.

## S3 — Whole-database restore onto the live box (the big red button)

Phase 9 will gate this behind the dashboard. Manual procedure (proven by the drill, same code path):
1. **Take a safety backup first**: `igf-pgbackrest-backup.sh incr` and let it finish.
2. Stop app containers, keep db: `cd /opt/supabase-project && docker compose stop` then start only db… 
   in practice follow the drill script's restore steps against the LIVE pgdata with the stack stopped.
3. `pgbackrest --stanza=igf --type=time "--target=…" --target-action=promote restore` (live conf, RW token).
4. Start the stack; **restart kong LAST** (it caches container IPs; skipping this = 502s).
5. Postflight: row counts vs expectation, `vault.decrypted_secrets` readable, archiver resumes
   (`pg_stat_archiver`), app login works. New timeline will archive fresh WAL.
6. Reconcile storage objects vs metadata (S2 section + RESTORE_RUNBOOK.md).

## S4 — The box is dead (rebuild from nothing but backups)

1. New Ubuntu 24.04 VPS. From Mac: restore SSH access (escrow card Section E has root keys).
2. Install restic + rclone (any current version).
3. Pull config: `restic -r s3:<endpoint>/igf-config-backups/restic/box restore latest --target /`
   (password = card A3, S3 creds = card B2 or CF dashboard re-mint). This brings back
   `/opt/supabase-project` (compose + .env), `/etc` hardening, all `/usr/local/bin` scripts,
   `/root/.config/igf-backup`, systemd units, CF exports.
4. `pgsodium_root.key`: restic set has it; card C1 is the fallback.
5. Rebuild the postgres image: the Dockerfile is in the git repo (`ops/postgres-image/Dockerfile`)
   AND in the restic set (`/opt/backup-infra/postgres-image/Dockerfile`, captured since 2026-07-04).
   `docker build` it from the pinned public base digest. (The built 1.74GB image is NOT stored — it is
   rebuilt from the recipe.)
6. Restore DB per S3. Point the CF tunnel at the new box (config in `/root/config-exports/`).
7. Re-arm timers (`systemctl enable --now igf-*.timer`), verify heartbeats return.

## S5 — R2 is gone (bucket wiped / account lost)

- Newest logical dumps + full PITR repo: toolbox `/srv/db-pulls/` (sentinel-gated weekly pull —
  a wipe does NOT propagate there). Mac also holds a monthly logical set.
- Rebuild buckets, re-mint tokens, re-point `*.env` files, re-init restic repos, force
  first backups. Uploads (igf-storage) are the live bucket — if THAT was wiped, restore
  from `storage-mirror` if it survived, else from the most recent toolbox/Mac state you have.

## S6 — Mac is dead

Nothing is lost: hosts keep running and backing up. Recover control:
1. New Mac → iCloud (accounts) → offline DR escrow card (all keys + root SSH keys + vps.env).
2. Recreate `~/.ssh` from card Section E; Keychain entries from card values.

## Cadence (all UTC)

| When | What | Where |
|---|---|---|
| 01:10 | logical dump | box |
| 01:45 | pgBackRest full (Sun) / incr (Mon–Sat) | box |
| 02:30 | storage mirror | box |
| 03:35 / 03:50 / 04:05 | restic config | box / toolbox / whatsapp |
| Sat 04:15–05:30 | pgBackRest verify + restic maint (deep on the 1st) | all |
| Sun 06:10 | second-location pull | toolbox |
| 1st 07:15 | **restore drill (the proof)** | box |
| every 5 min | archiver monitor | box |
| :00/:30 ±5 | mutual watchdogs | box↔toolbox(+whatsapp) |

Monthly manual (owner): confirm the drill heartbeat went green (dashboard "Restauration —
Prouvée"), and refresh the Mac monthly pull if the LaunchAgent reported failure.
