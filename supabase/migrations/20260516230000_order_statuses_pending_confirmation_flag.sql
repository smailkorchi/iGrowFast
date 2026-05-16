-- "Pending confirmation" is a business concept that doesn't map cleanly to the existing
-- category column: only a SUBSET of callbacks (the RAPPEL retry queue) qualifies as
-- "still pending", while other callback variants (Boitevocale, Pas de réponse,
-- Mauvais numéro, …) are treated as resolved. Use an explicit boolean so the rule
-- lives with the data, not scattered across the frontend.
ALTER TABLE public.order_statuses
    ADD COLUMN IF NOT EXISTS pending_confirmation boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.order_statuses.pending_confirmation IS
'When true, orders in this status are counted as still pending confirmation: '
'they go in the Pending Confirmation KPI numerator and are excluded from the '
'Confirmation Rate numerator. Set explicitly per status, not derived from category.';

-- Seed the canonical pending set per the product owner: brand-new orders + the
-- six numbered RAPPEL retry slots + REPORTER (postponed). All other statuses
-- (including other callback variants) are treated as confirmed for the rate.
UPDATE public.order_statuses
SET pending_confirmation = true
WHERE code IN (
    'NEW',
    'RAPPEL 1',
    'RAPPEL2',
    'RAPPEL3',
    'RAPPEL ',   -- RAPPELE 4 — code has a trailing space, intentional
    'RAPPEL 5',
    'RAPPEL 6',
    'POSTPONED'
);

-- Helpful index for the frequent "is this id pending?" lookup on the client.
CREATE INDEX IF NOT EXISTS idx_order_statuses_pending_confirmation
    ON public.order_statuses (pending_confirmation)
    WHERE pending_confirmation = true;
