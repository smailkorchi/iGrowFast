-- POST-APPLY VERIFY (wave 5). Structural + grant + seam; NO test rows on live.
-- (Cross-business RLS proven in rehearsal.) Resolution fns + jid_mapping_resolved trigger -> wave 6.
\pset pager off
\echo '### 7 tables + 18 indexes'
select (select count(*) from pg_class where relnamespace='whatsapp'::regnamespace and relkind='r' and relname in ('contacts','contact_identifiers','jid_mapping','merge_decisions','merge_review','contact_profiles','group_participants')) as tables,
       (select count(*) from pg_indexes where schemaname='whatsapp' and tablename in ('contacts','contact_identifiers','jid_mapping','merge_decisions','merge_review','contact_profiles','group_participants')) as indexes;
\echo '### authenticated grants per table'
select table_name, string_agg(privilege_type,',' order by privilege_type) as authd_privs
from information_schema.role_table_grants
where table_schema='whatsapp' and grantee='authenticated' and table_name in ('contacts','contact_identifiers','jid_mapping','merge_decisions','merge_review','contact_profiles','group_participants')
group by table_name order by table_name;
\echo '### RLS + policy count per table (expect rls=t, policies=1)'
select c.relname, c.relrowsecurity as rls, (select count(*) from pg_policies p where p.schemaname='whatsapp' and p.tablename=c.relname) as policies
from pg_class c where c.relnamespace='whatsapp'::regnamespace and c.relkind='r'
 and c.relname in ('contacts','contact_identifiers','jid_mapping','merge_decisions','merge_review','contact_profiles','group_participants') order by 1;
\echo '### customer_id seam FK'
select pg_get_constraintdef(oid) as def from pg_constraint where conrelid='whatsapp.contacts'::regclass and conname='contacts_customer_id_fkey';
\echo '### pristine (expect 0 rows each)'
select relname, (xpath('/row/c/text()', query_to_xml(format('select count(*) c from whatsapp.%I', relname), false, true, '')))[1]::text::int as rows
from pg_class where relnamespace='whatsapp'::regnamespace and relkind='r'
 and relname in ('contacts','contact_identifiers','jid_mapping','merge_decisions','merge_review','contact_profiles','group_participants') order by 1;
