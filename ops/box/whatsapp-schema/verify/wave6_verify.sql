-- POST-APPLY VERIFY (wave 6). Structural + seam; NO test rows on live. (Crypto/trigger/RLS proven in rehearsal.)
\pset pager off
\echo '### column + index counts (expect conv=29, msg=36, indexes=27)'
select (select count(*) from information_schema.columns where table_schema='whatsapp' and table_name='conversations') as conv_cols,
       (select count(*) from information_schema.columns where table_schema='whatsapp' and table_name='messages') as msg_cols,
       (select count(*) from pg_indexes where schemaname='whatsapp' and tablename in ('conversations','messages')) as indexes;
\echo '### authenticated grants'
select table_name, string_agg(privilege_type,',' order by privilege_type) as authd from information_schema.role_table_grants where table_schema='whatsapp' and grantee='authenticated' and table_name in ('conversations','messages') group by table_name order by 1;
\echo '### rls + policy/trigger counts (conv 4 pol/2 trg; msg 1 pol/3 trg)'
select c.relname, c.relrowsecurity as rls,
       (select count(*) from pg_policies p where p.schemaname='whatsapp' and p.tablename=c.relname) as policies,
       (select count(*) from pg_trigger tg where tg.tgrelid=c.oid and not tg.tgisinternal) as triggers
from pg_class c where c.relnamespace='whatsapp'::regnamespace and c.relname in ('conversations','messages') order by 1;
\echo '### seam FKs (expect 3)'
select conname from pg_constraint where conrelid in ('whatsapp.conversations'::regclass,'whatsapp.messages'::regclass)
 and conname in ('conversations_customer_id_fkey','conversations_key_id_fkey','messages_key_id_fkey') order by 1;
\echo '### pristine (expect 0 / 0)'
select (select count(*) from whatsapp.conversations) as convs, (select count(*) from whatsapp.messages) as msgs;
