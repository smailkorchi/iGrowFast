-- whatsapp_033_revoke_instance_secret_columns.sql — enterprise-audit Stage 0
-- security (P0), the ACTUAL close of the pairing-QR / secret-column leak.
--
-- ORDERING: apply ONLY after the frontend from commit c550a9e (explicit-column
-- select, QR via admin_get_instance_qr) is LIVE. Revoking earlier makes the old
-- select('*') fail with 'permission denied for column qr_code' → Numbers + inbox
-- 403 for everyone. The new frontend selects an explicit 56-column allow-list
-- that excludes these 3, so after deploy nothing authenticated reads them:
--   * qr_code               — plaintext pairing QR (agents could scan → takeover)
--   * evolution_api_token_ct — instance API token ciphertext (never client-read)
--   * webhook_secret_ct      — webhook HMAC secret ciphertext (never client-read)
--
-- Writers/readers that KEEP access (unaffected — service_role, not authenticated):
--   worker reveal_instance_token / reveal_instance_webhook_secret (SECDEF,
--   service_role), set_instance_token / set_instance_webhook_secret (SECDEF),
--   the worker qr writers, and admin_get_instance_qr (SECDEF, is_wa_admin) for
--   the PairDialog. Column REVOKE on `authenticated` does not touch SECDEF
--   functions (they run as owner) or service_role.
--
-- Run (only after deploy is live): ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file

begin;

revoke select (qr_code)                on whatsapp.whatsapp_instances from authenticated;
revoke select (evolution_api_token_ct) on whatsapp.whatsapp_instances from authenticated;
revoke select (webhook_secret_ct)      on whatsapp.whatsapp_instances from authenticated;

commit;

-- Verify:
--   select has_column_privilege('authenticated','whatsapp.whatsapp_instances','qr_code','select');  -- expect f
--   (impersonated commercial agent: SELECT qr_code FROM whatsapp.whatsapp_instances → permission denied;
--    SELECT id,status FROM ... still works; admin_get_instance_qr as admin still returns the QR.)
