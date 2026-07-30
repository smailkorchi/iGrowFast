CREATE OR REPLACE FUNCTION public.update_business_profile_fields(p_business_id uuid, p_name text, p_logo text, p_ice text, p_rc text, p_identifiant_fiscal text, p_patente text, p_cnss text, p_legal_form text, p_capital_social text, p_legal_address text, p_legal_city text, p_postal_code text, p_business_phone text, p_business_email text, p_website text, p_cachet_url text, p_signature_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ok boolean;
BEGIN
  -- AUTHZ: super-admin of THIS business only. NOT owner, NOT non-admin members.
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role::text IN ('super admin','admin')
      AND u."DigiCom Business" = p_business_id
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
    RAISE EXCEPTION 'invalid name' USING ERRCODE = '23514';
  END IF;

  UPDATE public.businesses SET
    name = trim(p_name),
    logo = NULLIF(btrim(COALESCE(p_logo, '')), ''),
    ice = NULLIF(btrim(COALESCE(p_ice, '')), ''),
    rc = NULLIF(btrim(COALESCE(p_rc, '')), ''),
    identifiant_fiscal = NULLIF(btrim(COALESCE(p_identifiant_fiscal, '')), ''),
    patente = NULLIF(btrim(COALESCE(p_patente, '')), ''),
    cnss = NULLIF(btrim(COALESCE(p_cnss, '')), ''),
    legal_form = NULLIF(btrim(COALESCE(p_legal_form, '')), ''),
    capital_social = NULLIF(btrim(COALESCE(p_capital_social, '')), ''),
    legal_address = NULLIF(btrim(COALESCE(p_legal_address, '')), ''),
    legal_city = NULLIF(btrim(COALESCE(p_legal_city, '')), ''),
    postal_code = NULLIF(btrim(COALESCE(p_postal_code, '')), ''),
    business_phone = NULLIF(btrim(COALESCE(p_business_phone, '')), ''),
    business_email = NULLIF(btrim(COALESCE(p_business_email, '')), ''),
    website = NULLIF(btrim(COALESCE(p_website, '')), ''),
    cachet_url = NULLIF(btrim(COALESCE(p_cachet_url, '')), ''),
    signature_url = NULLIF(btrim(COALESCE(p_signature_url, '')), ''),
    updated_at = now()
  WHERE id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'business not found' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$

