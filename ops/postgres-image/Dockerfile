# igf/supabase-postgres — supabase/postgres + pgBackRest for PITR (WAL archiving to R2).
#
# WHY: the stock image ships no usable backup tooling (wal-g present but the Supabase-cloud
# wrapper pattern is unusable self-hosted). pgBackRest is baked in so archive_command works
# natively inside the db container.
#
# UPGRADE RULE (do not skip): every supabase/postgres tag bump requires rebuilding THIS image
# and bumping the tag suffix — never `docker compose pull` the db service directly, the overlay
# docker-compose.backup.yml pins the derived image. After any rebuild+swap, re-verify:
#   docker exec supabase-db psql -U supabase_admin -c "select count(*) from vault.decrypted_secrets"
# (vault/pgsodium getkey script is image-baked; an upstream change can silently break vault).
#
# Build (on the box):
#   docker build -t igf/supabase-postgres:17.6.1.136-pgbackrest.1 /opt/backup-infra/postgres-image
FROM supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00

RUN apk add --no-cache pgbackrest \
 && mkdir -p /var/log/pgbackrest /var/spool/pgbackrest /var/lib/pgbackrest \
 && chown -R postgres:postgres /var/log/pgbackrest /var/spool/pgbackrest /var/lib/pgbackrest \
 && pgbackrest version \
 && su postgres -s /bin/sh -c 'pgbackrest version'
