-- Restrict providers to the authenticated user's DigiCom Business (row-level).

DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.providers;

CREATE POLICY "providers_select_own_business" ON public.providers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users me
      WHERE me.id = (SELECT auth.uid())
        AND me."DigiCom Business" = providers."DigiCom Business"
    )
  );

CREATE POLICY "providers_insert_own_business" ON public.providers
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users me
      WHERE me.id = (SELECT auth.uid())
        AND me."DigiCom Business" = providers."DigiCom Business"
    )
  );

CREATE POLICY "providers_update_own_business" ON public.providers
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users me
      WHERE me.id = (SELECT auth.uid())
        AND me."DigiCom Business" = providers."DigiCom Business"
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users me
      WHERE me.id = (SELECT auth.uid())
        AND me."DigiCom Business" = providers."DigiCom Business"
    )
  );

CREATE POLICY "providers_delete_own_business" ON public.providers
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users me
      WHERE me.id = (SELECT auth.uid())
        AND me."DigiCom Business" = providers."DigiCom Business"
    )
  );
