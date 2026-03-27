-- Tool PDF delivery notes (bons de livraison), same persistence pattern as devis / bons_commande

CREATE TABLE IF NOT EXISTS public.bons_livraison (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  bl_number text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'issued',
  pdf_storage_path text,
  snapshot_json jsonb NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bons_livraison_business_number_unique UNIQUE (business_id, bl_number)
);

CREATE INDEX IF NOT EXISTS idx_bons_livraison_business_created ON public.bons_livraison(business_id, created_at DESC);

ALTER TABLE public.bons_livraison ENABLE ROW LEVEL SECURITY;

CREATE POLICY bons_livraison_select ON public.bons_livraison FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u."DigiCom Business" = bons_livraison.business_id)
  OR public.is_owner()
);

CREATE POLICY bons_livraison_insert ON public.bons_livraison FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u."DigiCom Business" = bons_livraison.business_id)
  OR public.is_owner()
);

CREATE POLICY bons_livraison_update ON public.bons_livraison FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u."DigiCom Business" = bons_livraison.business_id)
  OR public.is_owner()
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u."DigiCom Business" = bons_livraison.business_id)
  OR public.is_owner()
);

CREATE POLICY bons_livraison_delete ON public.bons_livraison FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u."DigiCom Business" = bons_livraison.business_id)
  OR public.is_owner()
);
