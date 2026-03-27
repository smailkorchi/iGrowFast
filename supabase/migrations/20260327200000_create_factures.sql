-- Invoices: same persistence pattern as devis; PDFs under business-documents/{business_id}/factures/{id}.pdf

CREATE TABLE public.factures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  facture_number text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_date timestamptz,
  payment_terms text,
  devis_reference text,
  subtotal_ht numeric NOT NULL DEFAULT 0,
  tva_rate numeric NOT NULL DEFAULT 0,
  tva_amount numeric NOT NULL DEFAULT 0,
  total_ttc numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'issued',
  pdf_storage_path text,
  snapshot_json jsonb NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT factures_business_number_unique UNIQUE (business_id, facture_number)
);

CREATE INDEX idx_factures_business_created ON public.factures(business_id, created_at DESC);

ALTER TABLE public.factures ENABLE ROW LEVEL SECURITY;

CREATE POLICY factures_select ON public.factures FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u."DigiCom Business" = factures.business_id)
  OR public.is_owner()
);

CREATE POLICY factures_insert ON public.factures FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u."DigiCom Business" = factures.business_id)
  OR public.is_owner()
);

CREATE POLICY factures_update ON public.factures FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u."DigiCom Business" = factures.business_id)
  OR public.is_owner()
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u."DigiCom Business" = factures.business_id)
  OR public.is_owner()
);

CREATE POLICY factures_delete ON public.factures FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u."DigiCom Business" = factures.business_id)
  OR public.is_owner()
);
