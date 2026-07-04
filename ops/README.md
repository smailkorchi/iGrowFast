# ops/ — iGrowFast backup & DR infrastructure

Source-of-truth copies of the backup system running on the two Contabo VPSes (box = main prod,
toolbox = watcher). Deployed to `/usr/local/bin/` on the hosts; also captured nightly by restic.
Secrets live only on the hosts (`/root/.config/igf-backup/*`, root-600) and in the Mac Keychain —
never in this repo.

## postgres-image/
- `Dockerfile` — `igf/supabase-postgres` = digest-pinned `supabase/postgres:17.6.1.136` + pgBackRest 2.57.0.
- `docker-compose.backup.yml` — overlay swapping the `db` service to the derived image (appended to `COMPOSE_FILE`).
- **Upgrade rule**: every `supabase/postgres` bump → rebuild this image + bump the tag suffix; never `docker compose pull db`.

## scripts/ (deployed to /usr/local/bin on hosts)
| script | host | schedule (UTC) | purpose |
|---|---|---|---|
| `igf-alert.sh` | both | on-demand | ops email via SMTPS, independent of the Supabase stack |
| `igf-heartbeat.sh` | both | (called by jobs) | write success heartbeat to R2 |
| `igf-watchdog.sh` | both | */30 min | alert if the OTHER box's heartbeats go stale |
| `igf-pgdump.sh` | box | 01:10 daily | logical dumps → `igf-db-backups/logical/` (age-encrypted) |
| `igf-pgbackrest-backup.sh` | box | full Sun / incr Mon–Sat 01:45 | PITR base + incremental → `igf-db-backups/pgbackrest/` |
| `igf-pgbackrest-verify.sh` | box | Sat 04:15 | weekly pgBackRest repo integrity |
| `igf-archive-monitor.sh` | box | */5 min | SQL-only archiver health (log_min_messages=fatal hides logs) + disk guard |
| `igf-restic-backup.sh` | both | box 03:35 / tb 03:50 | config/state → `igf-config-backups/restic/{box,toolbox}` |
| `igf-restic-maint.sh` | both | Sat + monthly | restic forget/prune + check (+`--deep`) |
| `igf-cf-export.sh` | box | (restic pre-hook) | export CF dashboard state (tunnel/DNS/Access/rules/lifecycle) |

## Recovery entry points
- Logical restore (fallback): `igf-db-backups/logical/RESTORE_RUNBOOK.md`.
- PITR restore: pgBackRest stanza `igf`; drill procedure = Phase 5 (see BACKUP_PREFLIGHT doc / progress memory).
- Vault key + `.env` escrow: `igf-config-backups/escrow/` (age; private key = Mac Keychain `igf-backup-escrow-age` + offline copy).

## Secrets index (values NOT here)
Keychain: `igf-backup-escrow-age` (age), `igf-pgbackrest-repo` (cipher), `igf-restic-{box,toolbox}` (repo pw),
`cf-igf-r2-*` (R2 S3 tokens, per-bucket RW/RO), `igf-cf-config-export-ro` (CF read token).
Full DR secrets register: Phase 11.
