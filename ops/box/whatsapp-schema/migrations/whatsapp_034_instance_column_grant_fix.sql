-- whatsapp_034_instance_column_grant_fix.sql — CORRECT the 033 secret revoke.
-- 033 tried REVOKE SELECT(qr_code) etc., but `authenticated` holds a TABLE-LEVEL
-- SELECT grant on whatsapp_instances — a column-level REVOKE against a
-- table-level grant is a no-op (Postgres keeps the table grant covering ALL
-- columns; has_column_privilege(qr_code) stayed true). The correct restriction
-- is: REVOKE the table-level SELECT, then GRANT SELECT on ONLY the non-secret
-- columns (the exact 56 the frontend's explicit-column select reads).
--
-- Excluded (agents can no longer read via PostgREST): qr_code (plaintext pairing
-- QR — the takeover vector), evolution_api_token_ct, webhook_secret_ct.
-- QR reaches admins via admin_get_instance_qr (SECDEF). RLS (wi_select) still
-- applies on top. service_role / SECDEF writers keep full access (untouched).
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file

begin;

revoke select on whatsapp.whatsapp_instances from authenticated;

grant select (
  id, display_name, phone_number, evolution_instance_name, status, status_detail,
  last_seen_at, created_by, created_at, updated_at, lifecycle_state, worker_paused,
  pacing_config, business_hours, paired_at, profile_pic_url, wa_profile_name, wa_owner_jid,
  recent_tag_colors, auto_assign_enabled, auto_assign_strategy, auto_assign_user_pool,
  pacing_floor_ms, pacing_jitter_median_ms, pacing_jitter_spread, pacing_per_conv_floor_ms,
  pacing_read_to_reply_min_ms, typing_base_ms, typing_per_char_ms, typing_cap_ms, typing_enabled,
  read_receipts_mode, quiet_hours_override_until, manual_presence, wa_reject_calls, wa_call_reply_text,
  wa_always_online, wa_auto_read_inbound, wa_read_status, wa_ignore_groups, wa_sync_full_history,
  wa_profile_status, daily_send_cap, hourly_send_cap, minute_burst_cap, pacing_mode,
  business_hours_enabled, auto_reconnect, send_rate_per_min, identity_merge_enabled, last_connect_at,
  history_synced_at, sync_progress, business_id, node_id, key_id
) on whatsapp.whatsapp_instances to authenticated;

commit;

-- Verify:
--   select has_column_privilege('authenticated','whatsapp.whatsapp_instances','qr_code','select');  -- expect f
--   select has_column_privilege('authenticated','whatsapp.whatsapp_instances','status','select');   -- expect t
