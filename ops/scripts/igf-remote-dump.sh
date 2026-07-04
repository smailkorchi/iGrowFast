#!/usr/bin/env bash
# igf-remote-dump.sh — SSH FORCED-COMMAND on the box for the toolbox failover dumper.
# Locked via authorized_keys `command="/usr/local/bin/igf-remote-dump.sh",restrict,from="…"`.
# The toolbox's requested artifact arrives in $SSH_ORIGINAL_COMMAND; this streams exactly
# ONE whitelisted artifact to stdout and can do nothing else (no shell, strict whitelist).
set -euo pipefail
CONT=supabase-db
what="${SSH_ORIGINAL_COMMAND:-}"
case "$what" in
  ping)      echo "igf-remote-dump ok $(hostname)";;
  globals)   exec docker exec "$CONT" sh -c 'pg_dumpall -U supabase_admin --globals-only';;
  postgres)  exec docker exec "$CONT" sh -c 'pg_dump -U supabase_admin -Fc -d postgres';;
  _supabase) exec docker exec "$CONT" sh -c 'pg_dump -U supabase_admin -Fc -d _supabase';;
  rowcounts) exec docker exec "$CONT" psql -U supabase_admin -d postgres -tAc \
      "select json_build_object('orders',(select count(*) from public.orders),'auth_users',(select count(*) from auth.users),'order_items',(select count(*) from public.order_items),'seller_payments',(select count(*) from public.seller_payments))";;
  *) echo "denied: '$what' not in {ping,globals,postgres,_supabase,rowcounts}" >&2; exit 2;;
esac
