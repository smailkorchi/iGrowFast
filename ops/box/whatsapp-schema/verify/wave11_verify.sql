-- POST-APPLY VERIFY (wave 11). (RLS scoping/isolation/agent-access proven in rehearsal.)
\pset pager off
\echo '### 6 tables, RLS enabled, policy counts'
select c.relname, c.relrowsecurity as rls, (select count(*) from pg_policies p where p.schemaname='whatsapp' and p.tablename=c.relname) as policies
from pg_class c where c.relnamespace='whatsapp'::regnamespace and c.relkind='r'
 and c.relname in ('tags','conversation_tags','conversation_notes','scheduled_messages','quick_replies','message_templates') order by 1;
\echo '### ADAPT tables keyed on business_id (not instance_id)'
select table_name, string_agg(column_name,',' order by ordinal_position) filter (where column_name in ('business_id','instance_id')) as scope_cols
from information_schema.columns where table_schema='whatsapp' and table_name in ('quick_replies','message_templates') group by 1 order by 1;
\echo '### grants: authenticated DML, NO anon'
select table_name, grantee, string_agg(privilege_type,',' order by privilege_type) privs
from information_schema.role_table_grants where table_schema='whatsapp'
 and table_name in ('tags','conversation_tags','conversation_notes','scheduled_messages','quick_replies','message_templates')
 and grantee in ('anon','authenticated') group by 1,2 order by 1,2;
