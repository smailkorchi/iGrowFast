-- Business legal profile (Morocco-oriented) + SECURITY DEFINER RPC for staff updates.
-- Applied on remote via Supabase MCP execute_sql; keep file for CLI sync / history.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS ice text,
  ADD COLUMN IF NOT EXISTS rc text,
  ADD COLUMN IF NOT EXISTS identifiant_fiscal text,
  ADD COLUMN IF NOT EXISTS patente text,
  ADD COLUMN IF NOT EXISTS cnss text,
  ADD COLUMN IF NOT EXISTS legal_form text,
  ADD COLUMN IF NOT EXISTS capital_social text,
  ADD COLUMN IF NOT EXISTS legal_address text,
  ADD COLUMN IF NOT EXISTS legal_city text,
  ADD COLUMN IF NOT EXISTS business_phone text,
  ADD COLUMN IF NOT EXISTS business_email text,
  ADD COLUMN IF NOT EXISTS cachet_url text,
  ADD COLUMN IF NOT EXISTS signature_url text;

CREATE OR REPLACE FUNCTION public.update_business_profile_fields(
  p_business_id uuid,
  p_name text,
  p_logo text,
  p_ice text,
  p_rc text,
  p_identifiant_fiscal text,
  p_patente text,
  p_cnss text,
  p_legal_form text,
  p_capital_social text,
  p_legal_address text,
  p_legal_city text,
  p_business_phone text,
  p_business_email text,
  p_cachet_url text,
  p_signature_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  SELECT (
    EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u."DigiCom Business" IS NOT DISTINCT FROM p_business_id
    )
    OR (SELECT public.is_owner())
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
    business_phone = NULLIF(btrim(COALESCE(p_business_phone, '')), ''),
    business_email = NULLIF(btrim(COALESCE(p_business_email, '')), ''),
    cachet_url = NULLIF(btrim(COALESCE(p_cachet_url, '')), ''),
    signature_url = NULLIF(btrim(COALESCE(p_signature_url, '')), ''),
    updated_at = now()
  WHERE id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'business not found' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.update_business_profile_fields(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.update_business_profile_fields(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) TO authenticated;
