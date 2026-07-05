-- POST-APPLY VERIFY (wave 9). (Lifecycle proven in rehearsal.)
\pset pager off
\echo '### media_fetch_jobs present + deny-all RESTRICTIVE + authd no select'
select (select count(*) from pg_class where relnamespace='whatsapp'::regnamespace and relname='media_fetch_jobs') as tbl,
       (select permissive from pg_policies where schemaname='whatsapp' and tablename='media_fetch_jobs') as policy_kind,
       has_table_privilege('authenticated','whatsapp.media_fetch_jobs','SELECT') as authd_select,
       has_table_privilege('service_role','whatsapp.media_fetch_jobs','SELECT') as svc_select;
\echo '### media fns svc-only'
select proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') as authd, has_function_privilege('service_role', p.oid, 'EXECUTE') as svc
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='whatsapp' and proname in ('enqueue_media_fetch','complete_media_fetch','fail_media_fetch') order by 1;
\echo '### private bucket whatsapp-media provisioned (public=f) [F6]'
select id, public from storage.buckets where id='whatsapp-media';
\echo '### pristine (expect 0 jobs)'
select count(*) as jobs from whatsapp.media_fetch_jobs;
