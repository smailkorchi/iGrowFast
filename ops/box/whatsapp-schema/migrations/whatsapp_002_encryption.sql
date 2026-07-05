-- whatsapp_002_encryption  (Wave 2)
-- TARGET: LIVE box .102 self-host Postgres ONLY (ssh igf -> docker exec supabase-db psql -U postgres).
-- Ports the WA Mancer crypto chain 1:1 (pgp_sym via extensions.pgcrypto; SQL/STABLE/SECURITY DEFINER;
-- search_path=''; EXECUTE = postgres+service_role only) and ADDS the key_id rotation seam
-- (encryption_keys registry + p_key_id params) per plan §6. The envelope key is minted server-side
-- straight into Vault; its plaintext value never leaves the database.

-- 1) Vault secret: fresh 32-byte random envelope key, name 'igf_whatsapp_envelope_key' (key_id=1).
--    Guarded so a re-run never overwrites/duplicates the live key.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'igf_whatsapp_envelope_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'igf_whatsapp_envelope_key',
      'iGrowFast WhatsApp message-body envelope key (key_id=1)');
  end if;
end $$;

-- 2) Key registry (rotation seam). Deny-all: RLS on, zero policies, no client grants. Read only by
--    the SECDEF crypto fns (run as owner postgres, which bypasses RLS on its own non-forced table).
create table whatsapp.encryption_keys (
  key_id            smallint primary key,
  vault_secret_name text        not null unique,
  is_active         boolean     not null default true,
  created_at        timestamptz not null default now(),
  note              text
);
alter table whatsapp.encryption_keys enable row level security;
revoke all on table whatsapp.encryption_keys from public;

insert into whatsapp.encryption_keys (key_id, vault_secret_name, note)
values (1, 'igf_whatsapp_envelope_key', 'initial global envelope key')
on conflict (key_id) do nothing;

-- 3) Crypto chain (SECDEF, STABLE, search_path='', fully qualified). key_id seam via registry lookup.
create or replace function whatsapp._envelope_key(p_key_id smallint default 1)
returns text language sql stable security definer set search_path to '' as $function$
  select ds.decrypted_secret
  from whatsapp.encryption_keys k
  join vault.decrypted_secrets ds on ds.name = k.vault_secret_name
  where k.key_id = p_key_id and k.is_active
  limit 1;
$function$;

create or replace function whatsapp.encrypt_text(p_plain text, p_key_id smallint default 1)
returns bytea language sql stable security definer set search_path to '' as $function$
  select case when p_plain is null then null
              else extensions.pgp_sym_encrypt(p_plain, whatsapp._envelope_key(p_key_id)) end;
$function$;

create or replace function whatsapp.decrypt_text(p_ct bytea, p_key_id smallint default 1)
returns text language sql stable security definer set search_path to '' as $function$
  select case when p_ct is null then null
              else extensions.pgp_sym_decrypt(p_ct, whatsapp._envelope_key(p_key_id)) end;
$function$;

-- 4) Grants: EXECUTE to service_role only (postgres owns them, has execute inherently). Strip the
--    built-in PUBLIC execute per-function (default-priv REVOKE is inert on this box). W5 grant==policy.
revoke all on function whatsapp._envelope_key(smallint)        from public;
grant  execute on function whatsapp._envelope_key(smallint)    to service_role;
revoke all on function whatsapp.encrypt_text(text, smallint)   from public;
grant  execute on function whatsapp.encrypt_text(text, smallint) to service_role;
revoke all on function whatsapp.decrypt_text(bytea, smallint)  from public;
grant  execute on function whatsapp.decrypt_text(bytea, smallint) to service_role;
