-- Coliaty (and other providers) send unambiguous status codes like POSTPONED, PROGRAMMER,
-- NOANSWER, ERR, UNREACHABLE, RELANCER that were duplicated across multiple package_statuses
-- rows. The matcher used `LIMIT 1` with no ORDER BY, so the chosen category was non-deterministic
-- — causing the same webhook payload to flip the order between in_transit / postponed / scheduled
-- / callback depending on which row Postgres returned first. Remove the duplicates from
-- P_SHIPPED (in_transit) so each code maps to exactly one category aligned with Coliaty's
-- documented lifecycle.

UPDATE public.package_statuses
SET delivery_service_statuses = (
    SELECT jsonb_agg(DISTINCT v)
    FROM jsonb_array_elements_text(delivery_service_statuses) AS v
    WHERE v NOT IN (
        'POSTPONED',    -- belongs to postponed (P_POSTPONED)
        'PROGRAMMER',   -- belongs to scheduled (SCHEDULED)
        'NOANSWER',     -- belongs to callback (p_pasdereponse)
        'ERR',          -- belongs to callback (ERR)
        'UNREACHABLE',  -- belongs to callback (ING)
        'RELANCER',     -- belongs to relaunch (RELENCE_NEW_CLIENT)
        'BV',           -- belongs to callback (BV)
        'DEUX',         -- belongs to callback (DEUX)
        'TROIS',        -- belongs to callback (TROIS)
        'PAS_DE_REPONSE_SMS'  -- belongs to callback (pa1+msg)
    )
)
WHERE code = 'P_SHIPPED';

UPDATE public.package_statuses
SET delivery_service_statuses = (
    SELECT jsonb_agg(DISTINCT v)
    FROM (
        SELECT v FROM jsonb_array_elements_text(delivery_service_statuses) v
        UNION
        SELECT 'PAS_DE_REPONSE_SMS'
    ) s
)
WHERE code = 'pa1+msg';

-- Deterministic matcher. Priority: terminal categories first (delivered/returned/refused/cancelled),
-- then forward progression (out_for_delivery > in_transit > picked_up > pickup_pending > new),
-- then operational categories. Alphabetical fallback on code for full determinism.
CREATE OR REPLACE FUNCTION public.match_package_status(p_status_value text)
RETURNS TABLE (
    id uuid,
    code text,
    label text,
    category text,
    color text
)
LANGUAGE sql
STABLE
AS $$
    SELECT ps.id, ps.code, ps.label, ps.category, ps.color
    FROM public.package_statuses ps
    WHERE ps.delivery_service_statuses @> to_jsonb(ARRAY[p_status_value])
       OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(ps.delivery_service_statuses) AS v(val)
           WHERE LOWER(extensions.unaccent(v.val)) = LOWER(extensions.unaccent(p_status_value))
       )
    ORDER BY
        CASE ps.category
            WHEN 'delivered' THEN 1
            WHEN 'returned' THEN 2
            WHEN 'returning' THEN 3
            WHEN 'refused' THEN 4
            WHEN 'cancelled' THEN 5
            WHEN 'out_for_delivery' THEN 6
            WHEN 'in_transit' THEN 7
            WHEN 'picked_up' THEN 8
            WHEN 'pickup_pending' THEN 9
            WHEN 'scheduled' THEN 10
            WHEN 'postponed' THEN 11
            WHEN 'callback' THEN 12
            WHEN 'recheck' THEN 13
            WHEN 'relaunch' THEN 14
            WHEN 'interested' THEN 15
            WHEN 'new' THEN 16
            WHEN 'other' THEN 17
            ELSE 99
        END,
        ps.code
    LIMIT 1;
$$;

ALTER FUNCTION public.match_package_status(text) SET search_path = public, extensions;
