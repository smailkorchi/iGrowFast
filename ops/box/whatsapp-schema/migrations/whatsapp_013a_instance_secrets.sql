-- whatsapp_013a_instance_secrets.sql  (Wave 13a) — instance secret get/set (Vault-backed ct on whatsapp_instances)
-- TARGET: box .102 whatsapp ONLY. reveal_* = service_role only, NO gate (worker reveals token for Evolution API;
-- business admins never see raw credentials). set_* = SECDEF is_wa_admin(p_instance_id) (business admin rotates
-- their own instance's secret). set_instance_token collapses WA Mancer's public wrapper + private.set_instance_token
-- into one SECDEF fn. encrypt_text/decrypt_text default key_id=1 (instance secrets are single-key, as in WA Mancer).

create or replace function whatsapp.reveal_instance_token(p_instance_id uuid)
returns text language plpgsql security definer set search_path to '' as $function$
declare v_ct bytea;
begin
  select evolution_api_token_ct into v_ct from whatsapp.whatsapp_instances where id = p_instance_id;
  if v_ct is null then return null; end if;
  return whatsapp.decrypt_text(v_ct);
end; $function$;
revoke all on function whatsapp.reveal_instance_token(uuid) from public;
grant  execute on function whatsapp.reveal_instance_token(uuid) to service_role;

create or replace function whatsapp.reveal_instance_webhook_secret(p_instance_id uuid)
returns text language plpgsql security definer set search_path to '' as $function$
declare v_ct bytea;
begin
  select webhook_secret_ct into v_ct from whatsapp.whatsapp_instances where id = p_instance_id;
  if v_ct is null then return null; end if;
  return whatsapp.decrypt_text(v_ct);
end; $function$;
revoke all on function whatsapp.reveal_instance_webhook_secret(uuid) from public;
grant  execute on function whatsapp.reveal_instance_webhook_secret(uuid) to service_role;

create or replace function whatsapp.set_instance_token(p_instance_id uuid, p_token text)
returns void language plpgsql security definer set search_path to '' as $function$
begin
  if not whatsapp.is_wa_admin(p_instance_id) then raise exception 'forbidden: admin required'; end if;
  update whatsapp.whatsapp_instances
    set evolution_api_token_ct = case when p_token is null then null else whatsapp.encrypt_text(p_token) end
    where id = p_instance_id;
  perform whatsapp.audit('instance_token_rotated','instance',p_instance_id::text,'{}'::jsonb);
end; $function$;
revoke all on function whatsapp.set_instance_token(uuid, text) from public;
grant  execute on function whatsapp.set_instance_token(uuid, text) to authenticated, service_role;

create or replace function whatsapp.set_instance_webhook_secret(p_instance_id uuid, p_secret text)
returns void language plpgsql security definer set search_path to '' as $function$
begin
  if not whatsapp.is_wa_admin(p_instance_id) then raise exception 'forbidden: admin required'; end if;
  update whatsapp.whatsapp_instances
    set webhook_secret_ct = case when p_secret is null then null else whatsapp.encrypt_text(p_secret) end
    where id = p_instance_id;
  perform whatsapp.audit('instance_webhook_secret_rotated','instance',p_instance_id::text,'{}'::jsonb);
end; $function$;
revoke all on function whatsapp.set_instance_webhook_secret(uuid, text) from public;
grant  execute on function whatsapp.set_instance_webhook_secret(uuid, text) to authenticated, service_role;
