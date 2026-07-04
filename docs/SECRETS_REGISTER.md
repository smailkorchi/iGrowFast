# iGrowFast — Secrets Register (names & locations only — NO values)

Companion to `docs/DR_RUNBOOK.md`. Updated 2026-07-04.

## Tier 0 — irreplaceable (loss = backups unreadable). All on the DR escrow card.

| Secret | Keychain (service / account) | Card | Decrypts |
|---|---|---|---|
| age escrow private key | `igf-backup-escrow-age` / private-key | A1 | logical dumps + secrets escrow bundle |
| pgBackRest cipher passphrase | `igf-pgbackrest-repo` / cipher-passphrase | A2 | the whole PITR repo |
| restic password (box) | `igf-restic-box` / repo-password | A3 | `restic/box` |
| restic password (toolbox) | `igf-restic-toolbox` / repo-password | A4 | `restic/toolbox` |
| restic password (whatsapp) | `igf-restic-whatsapp` / repo-password | A5 | `restic/whatsapp` |
| pgsodium_root.key + VAULT_ENC_KEY | (escrow bundle / card) | C1/C2 | the 13 DB Vault secrets |

**Escrow card**: `~/Desktop/IGROWFAST-DR-ESCROW.txt` (mode 600) + owner's offline copy
(OWED — not yet made). Never uploaded anywhere.

## Tier 1 — R2 access tokens (re-mintable from the Cloudflare dashboard)

All account-owned CF API tokens; S3 access-key-id = token id, secret = SHA-256 of token value.
Fresh tokens take ~30–60 s to authenticate. Stored as Keychain `cf-igf-r2-*` with accounts
`access-key-id` / `secret-access-key`.

| Keychain service | Scope | Used by |
|---|---|---|
| `cf-igf-r2-igf-db-backups-ro` | RO igf-db-backups | escrow card B1, toolbox pull, backup agent (list/presign) |
| `cf-igf-r2-igf-config-backups-ro` | RO igf-config-backups | escrow card B2 |
| `cf-igf-r2-igf-db-backups-box-rw` | RW igf-db-backups | box: pgdump upload, pgbackrest repo, storage-mirror dest, heartbeats |
| `cf-igf-r2-igf-config-backups-box-rw` | RW igf-config-backups | box restic + toolbox/whatsapp watchdog reads |
| `cf-igf-r2-igf-config-backups-toolbox-rw` | RW igf-config-backups | toolbox restic + heartbeats |
| `cf-igf-r2-igf-config-backups-whatsapp-rw` | RW igf-config-backups | whatsapp restic + heartbeats |
| `cf-igf-r2-igf-storage-mirror-ro` | RO igf-storage | storage mirror source read |
| `cf-igf-r2-igf-storage` | RW igf-storage | live storage-api backend |
| `igf-cf-config-export-ro` | CF read-only (dashboard state) | box `igf-cf-export.sh` |
| `cf-igrowfast-api` | CF account full access | Mac only — minting/admin |

## Tier 2 — host-side files (root-600; captured by each box's restic set, except key files)

| Host | File | Contains |
|---|---|---|
| all 3 | `/root/.config/igf-backup/smtp.env` | Hostinger SMTP + alert recipients |
| box | `/root/.config/igf-backup/r2-db-backups.env` | r2db RW + r2dbro RO remotes + age recipient |
| box | `/root/.config/igf-backup/r2-storage-mirror.env` | r2src RO (igf-storage) |
| box/tb/wa | `/root/.config/igf-backup/restic.env` + `restic.pw` | repo + password (pw EXCLUDED from snapshots) |
| box/tb/wa | `/root/.config/igf-backup/r2-hb.env` | heartbeat/watchdog remotes |
| tb | `/root/.config/igf-backup/r2-ro.env` | RO db-backups (weekly pull) |
| box | `/etc/igf-backup-agent/agent.env` | agent: RO R2 creds, allowed origins (NO jwt secret — ES256/JWKS) |
| box | `/etc/igf-backup-agent/tunnel.env` | cloudflared TUNNEL_TOKEN (backup-api) |
| box | `/etc/postgresql-custom/pgbackrest.conf` | repo creds + cipher pass (uid 100, 600) |
| box | `/opt/supabase-project/.env`, `functions.env` | full stack secrets (also age-escrowed in R2) |

## Tier 3 — application-level

- DB Vault (13 secrets: Google SA, SMTP passwords, cron-invoke key, …): SQL-only, needs C1+C2 after restore.
- Edge-function env: `supabase secrets` CLI layer (functions.env escrowed).
- GoTrue signs user JWTs **ES256** (kid + JWKS at `/auth/v1/.well-known/jwks.json`); anon/service
  static keys are HS256 legacy. The backup agent disk-caches the JWKS.

## Rotation quick-notes

- R2 token: mint new via CF API → update Keychain + the host env file(s) using it → verify → revoke old.
- restic password: NOT rotatable in place (new repo + re-seed). Treat as Tier 0.
- SMTP: Hostinger panel → update `smtp.env` on all 3 boxes → test `igf-alert.sh`.
- Known debt: internal `SUPABASE_DB_URL` password printed into a Claude session transcript
  2026-07-04 (docker-network-only exposure) — rotate opportunistically.
