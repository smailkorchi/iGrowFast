CREATE OR REPLACE FUNCTION public.chat_customer_orders_count(p_phone text)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when exists (
      select 1 from public.users u
      where u.id = (select auth.uid())
        and u.role in ('super admin', 'admin', 'commercial')
    )
    then (
      select count(*)::int
      from public.orders o
      where o."DigiCom Business" = public.current_user_digicom_business_id()
        and public.normalize_phone_for_customer(o.phone)
              = public.normalize_phone_for_customer(p_phone)
        and o.date_deleted is null
    )
    else 0
  end;
$function$

