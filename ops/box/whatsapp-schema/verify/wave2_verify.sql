-- POST-APPLY VERIFY (wave 2). Envelope key pre-minted from DR escrow (Keychain igf-whatsapp-envelope-key
-- + /Users/.../IGROWFAST-DR-ESCROW.txt), so the DO-block guard skipped minting. Verified pass 2026-07-05.
\pset pager off
\echo '### round-trip as postgres (expect probe-ok)'
select whatsapp.decrypt_text(whatsapp.encrypt_text('probe-ok')) as pg_roundtrip;
\echo '### round-trip as service_role (expect running_as=service_role / svc-live)'
set role service_role;
select current_user as running_as, whatsapp.decrypt_text(whatsapp.encrypt_text('svc-live')) as svc_roundtrip;
reset role;
\echo '### grant posture (expect svc_enc=t, authd_enc=f, anon_enc=f)'
select has_function_privilege('service_role','whatsapp.encrypt_text(text,smallint)','EXECUTE')  as svc_enc,
       has_function_privilege('authenticated','whatsapp.encrypt_text(text,smallint)','EXECUTE') as authd_enc,
       has_function_privilege('anon','whatsapp.encrypt_text(text,smallint)','EXECUTE')          as anon_enc;
\echo '### encryption_keys deny-all (expect all f; rls_on=t)'
select has_table_privilege('authenticated','whatsapp.encryption_keys','SELECT') as authd_read,
       has_table_privilege('anon','whatsapp.encryption_keys','SELECT')          as anon_read,
       has_table_privilege('service_role','whatsapp.encryption_keys','SELECT')  as svc_read;
select relrowsecurity as rls_on, relforcerowsecurity as force_rls from pg_class where oid='whatsapp.encryption_keys'::regclass;
\echo '### crypto fn ACLs (expect {postgres=X, service_role=X} only)'
select proname, proacl from pg_proc where pronamespace='whatsapp'::regnamespace and proname in ('_envelope_key','encrypt_text','decrypt_text') order by 1;
\echo '### registry (expect key_id 1 -> igf_whatsapp_envelope_key, is_active t)'
select key_id, vault_secret_name, is_active from whatsapp.encryption_keys order by key_id;
\echo '### object counts (expect tbl=1, fns=3)'
select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='whatsapp' and c.relname='encryption_keys') as tbl,
       (select count(*) from pg_proc  p join pg_namespace n on n.oid=p.pronamespace where n.nspname='whatsapp' and p.proname in ('_envelope_key','encrypt_text','decrypt_text')) as fns;
