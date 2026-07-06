-- whatsapp_012c_fix_consolidate_lid.sql — RECONCILIATION FIX (found during wave-13 discovery)
-- TARGET: box .102 whatsapp ONLY. whatsapp.consolidate_contact (wave 10b, LIVE) calls whatsapp.consolidate_lid,
-- but consolidate_lid was never ported -> latent runtime failure if that path is hit. Port the missing wrapper
-- (SECDEF; finds the @lid conversation for the instance and delegates to consolidate_lid_conversation).
create or replace function whatsapp.consolidate_lid(p_instance_id uuid, p_lid text)
returns void language plpgsql security definer set search_path to '' as $function$
declare v_conv uuid;
begin
  if p_lid is null or p_lid not like '%@lid' then return; end if;
  select id into v_conv from whatsapp.conversations
    where instance_id = p_instance_id and remote_jid = p_lid and merged_into is null;
  if v_conv is not null then perform whatsapp.consolidate_lid_conversation(v_conv); end if;
end;
$function$;
revoke all on function whatsapp.consolidate_lid(uuid, text) from public;
grant  execute on function whatsapp.consolidate_lid(uuid, text) to service_role;
