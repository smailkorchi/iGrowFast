-- ════════════════════════════════════════════════════════════════════════════
-- Partial payouts — sellers + mediabuyers
--
-- Pre-state: `seller_payments` and `mediabuyer_payments` are 1 row per
-- (collaborator, payout_month) with a binary `status='pending'|'paid'` and a
-- monolithic `total_amount`.
--
-- Post-state:
--   - A new audit-grade txn table per role (`*_payment_txns`) holds every
--     actual cash disbursement (amount, paid_at, note, created_by).
--   - The parent row keeps `total_amount` (what was earned) and gains
--     `paid_amount` (running sum of txns) maintained by triggers.
--   - `status` becomes a derived field still stored on the row for fast
--     filtering: 'pending' (0 paid), 'partial' (0 < paid < total), 'paid'
--     (paid >= total).
--   - Existing `status='paid'` rows are backfilled with a single synthetic txn
--     at their `total_amount`, preserving their `paid_at`. Anything reading
--     `status='paid'` keeps working — partial is a new value.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.seller_payments DROP CONSTRAINT IF EXISTS seller_payments_status_check;
ALTER TABLE public.seller_payments
    ADD CONSTRAINT seller_payments_status_check CHECK (status IN ('pending','partial','paid'));

ALTER TABLE public.mediabuyer_payments DROP CONSTRAINT IF EXISTS mediabuyer_payments_status_check;
ALTER TABLE public.mediabuyer_payments
    ADD CONSTRAINT mediabuyer_payments_status_check CHECK (status IN ('pending','partial','paid'));

ALTER TABLE public.seller_payments
    ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE public.mediabuyer_payments
    ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.seller_payment_txns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_payment_id uuid NOT NULL REFERENCES public.seller_payments(id) ON DELETE CASCADE,
    amount numeric NOT NULL CHECK (amount > 0),
    paid_at timestamptz NOT NULL DEFAULT now(),
    note text,
    created_by uuid,
    "DigiCom Business" uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seller_payment_txns_payment ON public.seller_payment_txns(seller_payment_id);
CREATE INDEX IF NOT EXISTS idx_seller_payment_txns_business ON public.seller_payment_txns("DigiCom Business");

CREATE TABLE IF NOT EXISTS public.mediabuyer_payment_txns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mediabuyer_payment_id uuid NOT NULL REFERENCES public.mediabuyer_payments(id) ON DELETE CASCADE,
    amount numeric NOT NULL CHECK (amount > 0),
    paid_at timestamptz NOT NULL DEFAULT now(),
    note text,
    created_by uuid,
    "DigiCom Business" uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mediabuyer_payment_txns_payment ON public.mediabuyer_payment_txns(mediabuyer_payment_id);
CREATE INDEX IF NOT EXISTS idx_mediabuyer_payment_txns_business ON public.mediabuyer_payment_txns("DigiCom Business");

CREATE OR REPLACE FUNCTION public.refresh_seller_payment_balance(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_paid numeric;
    v_total numeric;
    v_new_status text;
    v_paid_at timestamptz;
BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM public.seller_payment_txns WHERE seller_payment_id = p_payment_id;

    SELECT total_amount INTO v_total
    FROM public.seller_payments WHERE id = p_payment_id;

    IF v_paid <= 0 THEN
        v_new_status := 'pending';
        v_paid_at := NULL;
    ELSIF v_paid >= COALESCE(v_total, 0) AND COALESCE(v_total, 0) > 0 THEN
        v_new_status := 'paid';
        SELECT MAX(paid_at) INTO v_paid_at FROM public.seller_payment_txns WHERE seller_payment_id = p_payment_id;
    ELSE
        v_new_status := 'partial';
        v_paid_at := NULL;
    END IF;

    UPDATE public.seller_payments
    SET paid_amount = v_paid,
        status      = v_new_status,
        paid_at     = v_paid_at
    WHERE id = p_payment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_seller_payment_txns_refresh()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.refresh_seller_payment_balance(OLD.seller_payment_id);
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' AND OLD.seller_payment_id <> NEW.seller_payment_id THEN
        PERFORM public.refresh_seller_payment_balance(OLD.seller_payment_id);
        PERFORM public.refresh_seller_payment_balance(NEW.seller_payment_id);
        RETURN NEW;
    ELSE
        PERFORM public.refresh_seller_payment_balance(NEW.seller_payment_id);
        RETURN NEW;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_seller_payment_txns_aiud ON public.seller_payment_txns;
CREATE TRIGGER trg_seller_payment_txns_aiud
AFTER INSERT OR UPDATE OR DELETE ON public.seller_payment_txns
FOR EACH ROW EXECUTE FUNCTION public.trg_seller_payment_txns_refresh();

CREATE OR REPLACE FUNCTION public.refresh_mediabuyer_payment_balance(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_paid numeric;
    v_total numeric;
    v_new_status text;
    v_paid_at timestamptz;
BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM public.mediabuyer_payment_txns WHERE mediabuyer_payment_id = p_payment_id;

    SELECT total_amount INTO v_total
    FROM public.mediabuyer_payments WHERE id = p_payment_id;

    IF v_paid <= 0 THEN
        v_new_status := 'pending';
        v_paid_at := NULL;
    ELSIF v_paid >= COALESCE(v_total, 0) AND COALESCE(v_total, 0) > 0 THEN
        v_new_status := 'paid';
        SELECT MAX(paid_at) INTO v_paid_at FROM public.mediabuyer_payment_txns WHERE mediabuyer_payment_id = p_payment_id;
    ELSE
        v_new_status := 'partial';
        v_paid_at := NULL;
    END IF;

    UPDATE public.mediabuyer_payments
    SET paid_amount = v_paid,
        status      = v_new_status,
        paid_at     = v_paid_at
    WHERE id = p_payment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_mediabuyer_payment_txns_refresh()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.refresh_mediabuyer_payment_balance(OLD.mediabuyer_payment_id);
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' AND OLD.mediabuyer_payment_id <> NEW.mediabuyer_payment_id THEN
        PERFORM public.refresh_mediabuyer_payment_balance(OLD.mediabuyer_payment_id);
        PERFORM public.refresh_mediabuyer_payment_balance(NEW.mediabuyer_payment_id);
        RETURN NEW;
    ELSE
        PERFORM public.refresh_mediabuyer_payment_balance(NEW.mediabuyer_payment_id);
        RETURN NEW;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_mediabuyer_payment_txns_aiud ON public.mediabuyer_payment_txns;
CREATE TRIGGER trg_mediabuyer_payment_txns_aiud
AFTER INSERT OR UPDATE OR DELETE ON public.mediabuyer_payment_txns
FOR EACH ROW EXECUTE FUNCTION public.trg_mediabuyer_payment_txns_refresh();

INSERT INTO public.seller_payment_txns
    (seller_payment_id, amount, paid_at, note, "DigiCom Business", created_at)
SELECT id, total_amount,
       COALESCE(paid_at, created_at, now()),
       'Backfilled from legacy paid status',
       "DigiCom Business",
       COALESCE(created_at, now())
FROM public.seller_payments
WHERE status = 'paid'
  AND total_amount > 0
  AND NOT EXISTS (
      SELECT 1 FROM public.seller_payment_txns t WHERE t.seller_payment_id = seller_payments.id
  );

INSERT INTO public.mediabuyer_payment_txns
    (mediabuyer_payment_id, amount, paid_at, note, "DigiCom Business", created_at)
SELECT id, total_amount,
       COALESCE(paid_at, created_at, now()),
       'Backfilled from legacy paid status',
       "DigiCom Business",
       COALESCE(created_at, now())
FROM public.mediabuyer_payments
WHERE status = 'paid'
  AND total_amount > 0
  AND NOT EXISTS (
      SELECT 1 FROM public.mediabuyer_payment_txns t WHERE t.mediabuyer_payment_id = mediabuyer_payments.id
  );

ALTER TABLE public.seller_payment_txns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mediabuyer_payment_txns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read seller_payment_txns" ON public.seller_payment_txns;
CREATE POLICY "Allow authenticated read seller_payment_txns" ON public.seller_payment_txns FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Allow authenticated insert seller_payment_txns" ON public.seller_payment_txns;
CREATE POLICY "Allow authenticated insert seller_payment_txns" ON public.seller_payment_txns FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Allow authenticated update seller_payment_txns" ON public.seller_payment_txns;
CREATE POLICY "Allow authenticated update seller_payment_txns" ON public.seller_payment_txns FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow authenticated delete seller_payment_txns" ON public.seller_payment_txns;
CREATE POLICY "Allow authenticated delete seller_payment_txns" ON public.seller_payment_txns FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated read mediabuyer_payment_txns" ON public.mediabuyer_payment_txns;
CREATE POLICY "Allow authenticated read mediabuyer_payment_txns" ON public.mediabuyer_payment_txns FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Allow authenticated insert mediabuyer_payment_txns" ON public.mediabuyer_payment_txns;
CREATE POLICY "Allow authenticated insert mediabuyer_payment_txns" ON public.mediabuyer_payment_txns FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Allow authenticated update mediabuyer_payment_txns" ON public.mediabuyer_payment_txns;
CREATE POLICY "Allow authenticated update mediabuyer_payment_txns" ON public.mediabuyer_payment_txns FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow authenticated delete mediabuyer_payment_txns" ON public.mediabuyer_payment_txns;
CREATE POLICY "Allow authenticated delete mediabuyer_payment_txns" ON public.mediabuyer_payment_txns FOR DELETE TO authenticated USING (true);

COMMENT ON TABLE public.seller_payment_txns IS
'Per-payment cash disbursements against a seller_payments period row. Multiple txns can exist per period to support partial payments. Triggers keep seller_payments.paid_amount + status in sync.';

COMMENT ON TABLE public.mediabuyer_payment_txns IS
'Per-payment cash disbursements against a mediabuyer_payments period row. Multiple txns can exist per period to support partial payments. Triggers keep mediabuyer_payments.paid_amount + status in sync.';
