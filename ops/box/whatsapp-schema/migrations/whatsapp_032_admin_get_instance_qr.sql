-- whatsapp_032_admin_get_instance_qr.sql — enterprise-audit Stage 0 security (P0).
-- The pairing QR (whatsapp_instances.qr_code, PLAINTEXT, rotates every 20-60s
-- during re-pair) is SELECT-granted to `authenticated` and row-visible to any
-- ASSIGNED AGENT via wi_select's 2nd branch — a scanned live QR = full WhatsApp
-- number takeover by a low-privilege commercial agent. Same for the two
-- ciphertext secret columns (never read by the client, pure select('*') leak).
--
-- This adds the admin-gated read path so the frontend can stop selecting qr_code
-- from the table; the column-level REVOKE follows in whatsapp_033 AFTER the
-- frontend that no longer selects these columns is deployed (revoking first
-- would break every select('*') → 'permission denied for column qr_code').
--
-- admin_get_instance_qr: SECURITY DEFINER, is_wa_admin-gated (business admin of
-- THIS instance only), returns just the qr_code. The PairDialog polls it while
-- pairing; agents cannot call it (is_wa_admin false → NULL/forbidden).
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file

begin;

create or replace function whatsapp.admin_get_instance_qr(p_instance_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_qr text;
begin
  if not whatsapp.is_wa_admin(p_instance_id) then
    raise exception 'forbidden: admin required' using errcode = '42501';
  end if;
  select qr_code into v_qr from whatsapp.whatsapp_instances where id = p_instance_id;
  return v_qr;
end;
$function$;

revoke all on function whatsapp.admin_get_instance_qr(uuid) from public, anon;
grant execute on function whatsapp.admin_get_instance_qr(uuid) to authenticated, service_role;

commit;
