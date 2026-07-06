# WhatsApp edge functions (box .102)

21 of WA Mancer's 26 edge fns ported (workflow wf_a95ed429-d0b + manual verification pass; the
adversarial-verify agents hit the session limit, so verification = mechanical chain-aware scan of all
21 (0 unqualified WA sites, 0 is_admin remnants, 0 bucket remnants) + full manual read of the 3
classifier-flagged fns (check-whatsapp, og-fetch, conversation-cleanup) + live smoke tests).

DROPPED (identity layer — iGrowFast has its own): consume-invitation, create-invitations,
check-invitation, admin-delete-user. DEFERRED: admin-platform-logs (Supabase cloud Management API —
needs a self-host log-source redesign).

Transforms: WA-domain .rpc()/.from() → .schema('whatsapp'); _shared/admin.ts requireAdmin = L1
(active business admin on public.users, returns businessId); bucket 'wamancer-media'→'whatsapp-media'
(R2 direct via aws4fetch — R2_MEDIA_* env); instance-create adapted to stamp business_id (caller) +
node_id (least-loaded active wa_nodes with headroom).

DEPLOY: rsync functions/ → igf:/opt/supabase-project/volumes/functions/ (merge; keeps iGrowFast fns +
_shared/emailVerify.ts). Main router picks new dirs up per-request — no restart needed.

ENV still to set on the edge-functions container (when node .67 exists):
EVOLUTION_API_URL (tailnet addr), EVOLUTION_GLOBAL_API_KEY, WORKER_WEBHOOK_URL_BASE,
R2_MEDIA_ENDPOINT, R2_MEDIA_ACCESS_KEY_ID, R2_MEDIA_SECRET_ACCESS_KEY, R2_MEDIA_BUCKET=whatsapp-media.

SMOKE (2026-07-06, public path): unauth→401; authed og-fetch → real preview + whatsapp.og_cache row
(full chain proven incl. PostgREST whatsapp exposure); instance-status → requireAdmin L1 passed;
instance-create → no_node_available (clean; fleet empty until .67 registers). Caught + fixed:
wa_nodes was deny-all → whatsapp_015_wa_nodes_grants.sql.
