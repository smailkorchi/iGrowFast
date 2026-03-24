-- Platform owners need to read provider branding (e.g. logo_url) for global admin UIs
-- without matching providers."DigiCom Business" to their user row.

CREATE POLICY "providers_select_platform_owner" ON public.providers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role = 'owner'
    )
  );
