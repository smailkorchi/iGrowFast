# WhatsApp node 1 (box .67 / igf-wa) — deployment plan + harvested gotchas

Blueprint decisions (docs/wa-mancer-recon/10-integration-blueprint.md §13): Tailscale mesh (tagged nodes,
tailnet lock, containers ride the host), Evolution TAILNET-PRIVATE (no public port, no caddy, no cert),
worker → box .102 Postgres :5432 SESSION mode over tailnet, docker compose per node, no k8s.

## Stack on .67 (from WA Mancer's proven compose, minus caddy)
- `evolution-api` — build from source `github.com/evolution-foundation/evolution-api.git#2.3.7`
  (Docker Hub stopped at 2.2.3; 2.3.3+ carries the path-traversal CVE fix). Bind tailnet+localhost only.
- `postgres:17-alpine` — Evolution's own session store (NOT the app DB). 6-hourly session dumps
  (evolution-session-*.sql.gz pattern from the WA VPS).
- `redis:7-alpine` — AOF on, requirepass.
- `worker` — node dispatcher + webhook receiver :8090 (internal only). Built from ops/whatsapp-node/worker/.

## Harvested gotchas (verbatim from the WA Mancer VPS — do not relearn these)
1. **Evolution env**: doesn't honor `*_FILE` secret convention → single env_file 0600. `DEL_INSTANCE=false`
   + `DEL_TEMP_INSTANCES=true` (never auto-delete paired instances on disconnect; sweep only never-paired).
   `DATABASE_SAVE_DATA_INSTANCE=true` (+ all SAVE flags) so Baileys creds/session survive restarts in Postgres.
2. **Redis compose trap**: a folded `command: >` block newline-terminates `exec redis-server` BEFORE its flags —
   redis silently starts with defaults (no password!). Use single-line `sh -c` command.
3. **Evolution webhook enum**: v2.3.7 subscription enum is `GROUP_UPDATE` (singular) — `GROUPS_UPDATE` is
   rejected 400. Delivered envelopes are still `groups.update`/`group-participants.update`.
4. **Webhook events list** must include CONTACTS_/CHATS_/PRESENCE_/GROUP_* or conversations show
   "Anonymous · #1234…" forever and group events silently drop (must mirror instance-webhook-resync).
5. **Worker DATABASE_URL must be SESSION mode** (LISTEN/NOTIFY + pg_advisory_lock) — the dispatcher dies
   SILENTLY on transaction-mode pooling. Across boxes: tailnet → .102 :5432.
6. **Worker webhook :8090 is never published** — Evolution reaches it over the docker network / localhost.
7. Journald logging driver with container-name tags feeds the log shipper.
8. Host telemetry = 2 systemd units (wa-log-shipper journald→ingest_system_logs, wa-metrics-collector→
   ingest_host_metrics), hardened (MemoryMax, ProtectSystem=strict), EnvironmentFile 0600.

## Worker adaptations owed (upstream 1:1 in worker-upstream/, adapted copy goes to worker/)
- All SQL → `whatsapp.` schema; realtime `postgres_changes` subscriptions → schema 'whatsapp';
  supabase-js `.rpc()` → `.schema('whatsapp').rpc()`.
- R2 direct (@aws-sdk/client-s3) → Supabase Storage client on bucket `whatsapp-media`
  (ListObjectsV2 enumeration paths need redesign) — OR keep S3 SDK pointed at the box storage-api S3
  endpoint; decide at port time.
- Drop `platformLogPull.ts` (Supabase cloud Management API — no self-host equivalent).
- Guard the orphan reaper in `instance-manager.ts` (deletes Evolution instances with no DB row).
- Add `unhandledRejection` handler (known upstream gap).
- Fleet seams from day 1 (§13.2): tailnet addressing (no hardcoded localhost), bounded data-driven claiming,
  business→node assignment-as-data, fleet-safe webhooks.
- Env: EVOLUTION_API_URL=http://localhost:8080 (co-located), DATABASE_URL=session via tailnet,
  SUPABASE_URL=https://api.igrowfast.com.

## Sequence
1. Tailscale on .102 + .67 (tagged, tailnet lock) — OWNER: create tailnet + auth keys.
2. Base: docker + ufw (SSH + tailnet only) + fail2ban on .67.
3. Compose stack (evolution+postgres+redis) up; pair nothing yet.
4. Worker port (workflow) → build → up.
5. Edge fns already on .102 point EVOLUTION_API_URL at the .67 tailnet address.
6. Shipper units on .67.
7. E2E: instance-create → pair a test number → inbound → inbox; send → delivered.
