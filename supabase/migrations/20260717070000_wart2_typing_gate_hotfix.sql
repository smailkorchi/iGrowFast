-- WA-RT-2 HOTFIX (live incident 2026-07-17): wa-typing presence channel gate was too strict.
-- mig 20260717050000 gated on whatsapp.can_use_instance() which requires an ACTIVE assigned
-- conversation; agents with inbox access but no current assignment got their private-channel
-- join REFUSED → realtime authorization-error churn on the shared socket → flaky/failed inbox
-- load for real users. Re-gate on BUSINESS MEMBERSHIP: any user whose business owns the
-- instance may use its presence channel (SECDEF to read whatsapp_instances.business_id);
-- cross-tenant stays blocked (different business_id). Verified live: same-biz agent ff626e72
-- (no assignment) → true, foreign-biz user → false. Same-business abuse remains bounded by the
-- worker's per-peer forced-open throttle (handlers.ts). Owner: supabase_admin.
CREATE OR REPLACE FUNCTION whatsapp.can_use_typing_topic(p_topic text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  select case
    when p_topic ~ '^wa-typing:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then exists (select 1 from whatsapp.whatsapp_instances wi
                   where wi.id = substring(p_topic from 11)::uuid
                     and wi.business_id = public.current_user_digicom_business_id())
    else false
  end;
$function$;
