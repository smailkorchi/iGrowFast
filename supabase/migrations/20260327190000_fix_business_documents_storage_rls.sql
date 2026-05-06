-- Storage RLS on business-documents: reading public.users inside storage.objects policies
-- can be blocked by users-table RLS, so the EXISTS check fails even when the user has a business.
-- Use SECURITY DEFINER to read the caller's "DigiCom Business" safely (same value devis RLS uses).

CREATE OR REPLACE FUNCTION public.current_user_digicom_business_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u."DigiCom Business"
  FROM public.users u
  WHERE u.id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_user_digicom_business_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_digicom_business_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_digicom_business_id() TO service_role;

DROP POLICY IF EXISTS business_documents_select ON storage.objects;
DROP POLICY IF EXISTS business_documents_insert ON storage.objects;
DROP POLICY IF EXISTS business_documents_update ON storage.objects;
DROP POLICY IF EXISTS business_documents_delete ON storage.objects;

CREATE POLICY business_documents_select ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'business-documents'
  AND (
    (
      public.current_user_digicom_business_id() IS NOT NULL
      AND public.current_user_digicom_business_id() = split_part(name, '/', 1)::uuid
    )
    OR public.is_owner()
  )
);

CREATE POLICY business_documents_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'business-documents'
  AND (
    (
      public.current_user_digicom_business_id() IS NOT NULL
      AND public.current_user_digicom_business_id() = split_part(name, '/', 1)::uuid
    )
    OR public.is_owner()
  )
);

CREATE POLICY business_documents_update ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'business-documents'
  AND (
    (
      public.current_user_digicom_business_id() IS NOT NULL
      AND public.current_user_digicom_business_id() = split_part(name, '/', 1)::uuid
    )
    OR public.is_owner()
  )
)
WITH CHECK (
  bucket_id = 'business-documents'
  AND (
    (
      public.current_user_digicom_business_id() IS NOT NULL
      AND public.current_user_digicom_business_id() = split_part(name, '/', 1)::uuid
    )
    OR public.is_owner()
  )
);

CREATE POLICY business_documents_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'business-documents'
  AND (
    (
      public.current_user_digicom_business_id() IS NOT NULL
      AND public.current_user_digicom_business_id() = split_part(name, '/', 1)::uuid
    )
    OR public.is_owner()
  )
);
