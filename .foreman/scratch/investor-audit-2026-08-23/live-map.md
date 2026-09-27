# Live Systems Evidence Map — 2026-08-23

Status: accepted read-only live scout report. Capture window: 2026-08-23 12:02–12:03 UTC. No writes, restarts, deploys, scans, secret reads, customer-row reads, or configuration dumps were performed.

## Compute and services
- Primary application/database host: Linux 6.8, 12 vCPU, 47 GiB RAM, 242 GiB disk with 7% used, uptime 3 days 18 hours.
- Communications/tools host: 12 vCPU, 47 GiB RAM, disk at 79% used, uptime 49 days 21 hours.
- Primary host runs 13 healthy/running Supabase, Kong, Cloudflare Tunnel, connection-pooler, and proxy containers.
- Verified component versions include PostgreSQL 17.6.1, Realtime 2.102.3, Auth 2.192.0, and PostgREST 14.12.

## Database inventory
- PostgreSQL 17.6; database size approximately 718 MB.
- 17 schemas; 77 public tables and 25 WhatsApp tables.
- 263 public functions and 148 WhatsApp functions.
- 84 public triggers and 35 WhatsApp triggers.
- 30 named pg_cron jobs.
- 12 extensions including pg_cron, pg_net, pg_stat_statements, pgcrypto, and pg_trgm.

## Database security
- RLS enabled on 131 of 157 non-system relations, with zero RLS-disabled tables in the public, WhatsApp, or storage schemas.
- 280 policies.
- 109 public and 133 WhatsApp SECURITY DEFINER functions remain a large privileged code surface requiring continuous code-level review.
- Anonymous role retains 27 table grants; grant necessity must remain under review even where RLS protects rows.
- Two publications exist: the legacy `supabase_realtime` publication contains zero tables; the broadcast messages publication contains seven.

## Realtime, workers, and queues
- Realtime container was healthy at capture time.
- WhatsApp and pg_net queue tables exist.
- No WhatsApp worker runs on the primary host by design.
- Tailscale reported the separate WhatsApp node online, but direct runtime inspection was blocked by SSH alias resolution; Evolution/Redis/worker health is therefore not claimed as verified.

## Edge and host security
- Cloudflare Tunnel container healthy.
- Kong binds only to loopback-facing ports.
- UFW active with SSH and Tailscale allowances.
- fail2ban active with an SSH jail.
- Tailscale active.
- API traffic is documented as Cloudflare Tunnel to Kong; Studio is documented behind Cloudflare Access. Dashboard-side DNS and Access policy state were not directly verified.

## Mail and authentication
- Stalwart 0.16 and webmail 1.7.7 containers healthy on the communications/tools host.
- SMTP 25/465/587 and IMAPS 993 listen publicly as required for mail delivery.
- DKIM synchronization scheduling exists and certificate renewal last succeeded.
- Authentication container healthy.

## Backups, DR, and observability
- Latest pgBackRest full backup completed 2026-08-23 01:46 UTC.
- PostgreSQL archiver reported 64 successes and zero failures.
- Nightly restic and weekly/deep maintenance timers exist with successful recent unit results.
- Backup agent active.
- Restore tooling exists under `ops/scripts/igf-restore-drill.sh`.
- Docker health checks cover core services; pg_stat_statements installed; backup/archiver monitoring and SMTP alert scripts exist.
- No Grafana, Prometheus, or Loki runtime was verified.
- Recent system errors were predominantly unauthenticated SSH handshake noise.

## Unverified areas
- Separate WhatsApp node runtime health.
- Cloudflare dashboard DNS and Access policy state.
- Off-site backup object existence and an actual restore execution during this audit.
- Application-level mail delivery and external uptime monitoring.
- Secret rotation status.
