-- Purchase orders / sales confirmations: same pattern as devis/factures

CREATE TABLE IF NOT EXISTS public.bons_commande (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  bc_number text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('purchase', 'sales')),
  issued_at timestamptz NOT NULL DEFAULT now(),
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
  CONSTRAINT bons_commande_business_number_unique UNIQUE (business_id, bc_number)
);

CREATE INDEX IF NOT EXISTS idx_bons_commande_business_created ON public.bons_commande(business_id, created_at DESC);

ALTER TABLE public.bons_commande ENABLE ROW LEVEL SECURITY;

CREATE POLICY bons_commande_select ON public.bons_commande FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u."DigiCom Business" = bons_commande.business_id)
  OR public.is_owner()
);

CREATE POLICY bons_commande_insert ON public.bons_commande FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u."DigiCom Business" = bons_commande.business_id)
  OR public.is_owner()
);

CREATE POLICY bons_commande_update ON public.bons_commande FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u."DigiCom Business" = bons_commande.business_id)
  OR public.is_owner()
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u."DigiCom Business" = bons_commande.business_id)
  OR public.is_owner()
);

CREATE POLICY bons_commande_delete ON public.bons_commande FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u."DigiCom Business" = bons_commande.business_id)
  OR public.is_owner()
);
