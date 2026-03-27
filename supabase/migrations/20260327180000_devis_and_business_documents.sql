-- Devis persistence + private PDF storage scoped by business folder prefix

CREATE TABLE public.devis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  devis_number text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  subtotal_ht numeric NOT NULL DEFAULT 0,
  tva_rate numeric NOT NULL DEFAULT 0,
  tva_amount numeric NOT NULL DEFAULT 0,
  total_ttc numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  pdf_storage_path text,
  snapshot_json jsonb NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devis_business_number_unique UNIQUE (business_id, devis_number)
);

CREATE INDEX idx_devis_business_created ON public.devis(business_id, created_at DESC);

ALTER TABLE public.devis ENABLE ROW LEVEL SECURITY;

CREATE POLICY devis_select ON public.devis FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u."DigiCom Business" = devis.business_id)
  OR public.is_owner()
);

CREATE POLICY devis_insert ON public.devis FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u."DigiCom Business" = devis.business_id)
  OR public.is_owner()
);

CREATE POLICY devis_update ON public.devis FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u."DigiCom Business" = devis.business_id)
  OR public.is_owner()
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u."DigiCom Business" = devis.business_id)
  OR public.is_owner()
);

CREATE POLICY devis_delete ON public.devis FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u."DigiCom Business" = devis.business_id)
  OR public.is_owner()
);

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('business-documents', 'business-documents', false, 52428800)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY business_documents_select ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'business-documents'
  AND (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
      AND u."DigiCom Business"::text = split_part(name, '/', 1)
    )
    OR public.is_owner()
  )
);

CREATE POLICY business_documents_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'business-documents'
  AND (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
      AND u."DigiCom Business"::text = split_part(name, '/', 1)
    )
    OR public.is_owner()
  )
);

CREATE POLICY business_documents_update ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'business-documents'
  AND (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
      AND u."DigiCom Business"::text = split_part(name, '/', 1)
    )
    OR public.is_owner()
  )
)
WITH CHECK (
  bucket_id = 'business-documents'
  AND (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
      AND u."DigiCom Business"::text = split_part(name, '/', 1)
    )
    OR public.is_owner()
  )
);

CREATE POLICY business_documents_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'business-documents'
  AND (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
      AND u."DigiCom Business"::text = split_part(name, '/', 1)
    )
    OR public.is_owner()
  )
);
