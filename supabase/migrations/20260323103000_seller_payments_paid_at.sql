-- Record when a seller payout was marked paid (seller Payments "Settled date").
ALTER TABLE public.seller_payments
ADD COLUMN IF NOT EXISTS paid_at timestamptz;

COMMENT ON COLUMN public.seller_payments.paid_at IS 'Set when status becomes paid; used for seller settlement logs.';
