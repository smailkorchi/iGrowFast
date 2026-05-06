-- Sellers/commercial: only delivery/return notes they created (same business). Other roles: all notes in business.

DROP POLICY IF EXISTS "Authenticated users can manage company delivery notes" ON public.company_delivery_notes;

CREATE POLICY "company_delivery_notes_select" ON public.company_delivery_notes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users me
      WHERE me.id = (SELECT auth.uid())
        AND me."DigiCom Business" = company_delivery_notes."DigiCom Business"
        AND (
          (me.role::text NOT IN ('commercial', 'seller'))
          OR company_delivery_notes.created_by = me.id
        )
    )
  );

CREATE POLICY "company_delivery_notes_insert" ON public.company_delivery_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users me
      WHERE me.id = (SELECT auth.uid())
        AND me."DigiCom Business" = company_delivery_notes."DigiCom Business"
    )
    AND (
      (SELECT u.role::text FROM public.users u WHERE u.id = (SELECT auth.uid())) NOT IN ('commercial', 'seller')
      OR company_delivery_notes.created_by = (SELECT auth.uid())
    )
  );

CREATE POLICY "company_delivery_notes_update" ON public.company_delivery_notes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users me
      WHERE me.id = (SELECT auth.uid())
        AND me."DigiCom Business" = company_delivery_notes."DigiCom Business"
        AND (
          (me.role::text NOT IN ('commercial', 'seller'))
          OR company_delivery_notes.created_by = me.id
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users me
      WHERE me.id = (SELECT auth.uid())
        AND me."DigiCom Business" = company_delivery_notes."DigiCom Business"
    )
  );

CREATE POLICY "company_delivery_notes_delete" ON public.company_delivery_notes
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users me
      WHERE me.id = (SELECT auth.uid())
        AND me."DigiCom Business" = company_delivery_notes."DigiCom Business"
        AND (
          (me.role::text NOT IN ('commercial', 'seller'))
          OR company_delivery_notes.created_by = me.id
        )
    )
  );

DROP POLICY IF EXISTS "Authenticated users can manage company return notes" ON public.company_return_notes;

CREATE POLICY "company_return_notes_select" ON public.company_return_notes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users me
      WHERE me.id = (SELECT auth.uid())
        AND me."DigiCom Business" = company_return_notes."DigiCom Business"
        AND (
          (me.role::text NOT IN ('commercial', 'seller'))
          OR company_return_notes.created_by = me.id
        )
    )
  );

CREATE POLICY "company_return_notes_insert" ON public.company_return_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users me
      WHERE me.id = (SELECT auth.uid())
        AND me."DigiCom Business" = company_return_notes."DigiCom Business"
    )
    AND (
      (SELECT u.role::text FROM public.users u WHERE u.id = (SELECT auth.uid())) NOT IN ('commercial', 'seller')
      OR company_return_notes.created_by = (SELECT auth.uid())
    )
  );

CREATE POLICY "company_return_notes_update" ON public.company_return_notes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users me
      WHERE me.id = (SELECT auth.uid())
        AND me."DigiCom Business" = company_return_notes."DigiCom Business"
        AND (
          (me.role::text NOT IN ('commercial', 'seller'))
          OR company_return_notes.created_by = me.id
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users me
      WHERE me.id = (SELECT auth.uid())
        AND me."DigiCom Business" = company_return_notes."DigiCom Business"
    )
  );

CREATE POLICY "company_return_notes_delete" ON public.company_return_notes
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users me
      WHERE me.id = (SELECT auth.uid())
        AND me."DigiCom Business" = company_return_notes."DigiCom Business"
        AND (
          (me.role::text NOT IN ('commercial', 'seller'))
          OR company_return_notes.created_by = me.id
        )
    )
  );

DROP POLICY IF EXISTS "Users can view return note orders" ON public.company_return_note_orders;
DROP POLICY IF EXISTS "Users can insert return note orders" ON public.company_return_note_orders;
DROP POLICY IF EXISTS "Users can update return note orders" ON public.company_return_note_orders;
DROP POLICY IF EXISTS "Users can delete return note orders" ON public.company_return_note_orders;

CREATE POLICY "company_return_note_orders_select" ON public.company_return_note_orders
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_return_notes crn
      JOIN public.users me ON me.id = (SELECT auth.uid())
      WHERE crn.id = company_return_note_orders.return_note_id
        AND me."DigiCom Business" = crn."DigiCom Business"
        AND (
          (me.role::text NOT IN ('commercial', 'seller'))
          OR crn.created_by = me.id
        )
    )
  );

CREATE POLICY "company_return_note_orders_insert" ON public.company_return_note_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_return_notes crn
      JOIN public.users me ON me.id = (SELECT auth.uid())
      WHERE crn.id = company_return_note_orders.return_note_id
        AND me."DigiCom Business" = crn."DigiCom Business"
        AND (
          (me.role::text NOT IN ('commercial', 'seller'))
          OR crn.created_by = me.id
        )
    )
  );

CREATE POLICY "company_return_note_orders_update" ON public.company_return_note_orders
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_return_notes crn
      JOIN public.users me ON me.id = (SELECT auth.uid())
      WHERE crn.id = company_return_note_orders.return_note_id
        AND me."DigiCom Business" = crn."DigiCom Business"
        AND (
          (me.role::text NOT IN ('commercial', 'seller'))
          OR crn.created_by = me.id
        )
    )
  );

CREATE POLICY "company_return_note_orders_delete" ON public.company_return_note_orders
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_return_notes crn
      JOIN public.users me ON me.id = (SELECT auth.uid())
      WHERE crn.id = company_return_note_orders.return_note_id
        AND me."DigiCom Business" = crn."DigiCom Business"
        AND (
          (me.role::text NOT IN ('commercial', 'seller'))
          OR crn.created_by = me.id
        )
    )
  );
