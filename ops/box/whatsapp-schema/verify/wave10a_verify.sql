-- POST-APPLY VERIFY (wave 10a). (Decrypt/hole-closed/RLS proven in rehearsal.)
\pset pager off
\echo '### decrypt fns present (svc+authenticated execute, no anon)'
select proname, has_function_privilege('authenticated',p.oid,'EXECUTE') as authd, has_function_privilege('anon',p.oid,'EXECUTE') as anon
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='whatsapp' and proname in ('_decrypt_message_body','_decrypt_conv_preview') order by 1;
\echo '### 3 views security_invoker=true'
select c.relname, (select array_to_string(reloptions,',') from pg_class x where x.oid=c.oid) as opts
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='whatsapp' and c.relkind='v' and c.relname in ('messages_decrypted','conversations_decrypted','worker_health_status') order by 1;
\echo '### view grants (W2: authenticated+service_role SELECT only, NO anon/DML)'
select table_name, grantee, string_agg(privilege_type,',' order by privilege_type) as privs
from information_schema.role_table_grants where table_schema='whatsapp'
 and table_name in ('messages_decrypted','conversations_decrypted','worker_health_status') and grantee in ('anon','authenticated','service_role')
group by table_name, grantee order by table_name, grantee;
