-- F3-S5: retire the free-text category contract. Rewrite match_package_status (the only DB
-- object referencing the column) to return + order by flags, then drop the columns.
-- NOTE (prod sync 2026-06-25): match_package_status is DROP+CREATE'd, which resets its EXECUTE
-- grant; after applying, re-run: GRANT EXECUTE ON FUNCTION public.match_package_status(text)
-- TO anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.match_package_status(text);
CREATE FUNCTION public.match_package_status(p_status_value text)
 RETURNS TABLE(id uuid, code text, label text, color text)
 LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $function$
    SELECT ps.id, ps.code, ps.label, ps.color
    FROM public.package_statuses ps
    WHERE ps.delivery_service_statuses @> to_jsonb(ARRAY[p_status_value])
       OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(ps.delivery_service_statuses) AS v(val)
           WHERE LOWER(extensions.unaccent(v.val)) = LOWER(extensions.unaccent(p_status_value))
       )
    ORDER BY
        CASE
            WHEN ps.is_delivered THEN 1
            WHEN ps.is_returned AND ps.is_refused THEN 4
            WHEN ps.is_returned THEN 2
            WHEN ps.is_cancelled THEN 5
            WHEN ps.flow_rank = 4 THEN 6
            WHEN ps.flow_rank = 3 THEN 7
            WHEN ps.flow_rank = 2 THEN 8
            WHEN ps.flow_rank = 1 THEN 9
            WHEN ps.is_postponed THEN 11
            WHEN ps.is_recheck THEN 13
            WHEN ps.is_new OR ps.flow_rank = 0 THEN 16
            ELSE 17
        END,
        ps.code
    LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.match_package_status(text) TO anon, authenticated, service_role;

ALTER TABLE public.order_statuses   DROP COLUMN IF EXISTS category;
ALTER TABLE public.package_statuses DROP COLUMN IF EXISTS category;
