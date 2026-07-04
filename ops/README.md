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
| `igf-alert.sh` | all 3 | on-demand | ops email via SMTPS, independent of the Supabase stack |
| `igf-heartbeat.sh` | all 3 | (called by jobs) | write success heartbeat to R2 |
| `igf-watchdog.sh` | both | */30 min | alert if the OTHER box's heartbeats go stale |
| `igf-pgdump.sh` | box | 01:10 daily | logical dumps → `igf-db-backups/logical/` (age-encrypted) |
| `igf-pgbackrest-backup.sh` | box | full Sun / incr Mon–Sat 01:45 | PITR base + incremental → `igf-db-backups/pgbackrest/` |
| `igf-pgbackrest-verify.sh` | box | Sat 04:15 | weekly pgBackRest repo integrity |
| `igf-archive-monitor.sh` | box | */5 min | SQL-only archiver health (log_min_messages=fatal hides logs) + disk guard |
| `igf-restic-backup.sh` | all 3 | box 03:35 / tb 03:50 / wa 04:05 | config/state → `igf-config-backups/restic/{box,toolbox}` |
| `igf-restic-maint.sh` | all 3 | Sat + monthly | restic forget/prune + check (+`--deep`) |
| `igf-cf-export.sh` | box | (restic pre-hook) | export CF dashboard state (tunnel/DNS/Access/rules/lifecycle) |
| `igf-restore-drill.sh` | box | monthly (1st 07:15) + on-demand | full PITR restore drill into throwaway container; `--target` proves point-in-time |
| `igf-storage-mirror.sh` | box | 02:30 daily | igf-storage (user uploads) → `igf-db-backups/storage-mirror/` (current + dated archive of deletions, 45d) |

## agent/ (deployed on box)
`igf-backup-agent.py` (127.0.0.1:8787, user igf-agent) + `igf-agent-helper` (root, sudoers-scoped) +
systemd units. Public via host-level cloudflared `cloudflared-backup.service` -> backup-api.igrowfast.com
(tunnel 5edf36b8, independent of the compose stack). Auth: ES256-only JWT vs disk-cached GoTrue JWKS,
sub must be an active `users.backup_admin` (live DB check), `aal2` required for POST triggers.
Endpoints: /health, /api/status, /api/backups, /api/download (presigned RO, 10 min), /api/trigger/<job>.
Audit: /var/log/igf-backup/agent-audit.log. CORS pinned to https://app.igrowfast.com.

## Recovery entry points
- Logical restore (fallback): `igf-db-backups/logical/RESTORE_RUNBOOK.md`.
- PITR restore: pgBackRest stanza `igf`; proven drill = `igf-restore-drill.sh` (end-of-WAL and `--target` point-in-time both verified 2026-07-04).
- Vault key + `.env` escrow: `igf-config-backups/escrow/` (age; private key = Mac Keychain `igf-backup-escrow-age` + offline copy).

## Secrets index (values NOT here)
Keychain: `igf-backup-escrow-age` (age), `igf-pgbackrest-repo` (cipher), `igf-restic-{box,toolbox}` (repo pw),
`cf-igf-r2-*` (R2 S3 tokens, per-bucket RW/RO), `igf-cf-config-export-ro` (CF read token).
Full DR secrets register: Phase 11.
