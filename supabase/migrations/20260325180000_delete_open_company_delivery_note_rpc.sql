-- Delete a non-finalized company delivery note: remove its parcels, reset each affected order
-- to CONFIRMED + clear logistics when the order has no remaining company_parcels (same idea as remove parcel).

CREATE OR REPLACE FUNCTION public.delete_open_company_delivery_note(
  p_delivery_note_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_business uuid;
  v_finalized boolean;
  v_created_by uuid;
  v_uid uuid;
  v_role text;
  v_confirmed_id uuid;
  v_order_ids uuid[];
  v_order_id uuid;
  v_remaining int;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT cdn."DigiCom Business", cdn.is_finalized, cdn.created_by
  INTO v_business, v_finalized, v_created_by
  FROM public.company_delivery_notes cdn
  WHERE cdn.id = p_delivery_note_id;

  IF v_business IS NULL THEN
    RAISE EXCEPTION 'note_not_found';
  END IF;

  IF v_finalized IS TRUE THEN
    RAISE EXCEPTION 'note_finalized';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users me
    WHERE me.id = v_uid
      AND me."DigiCom Business" = v_business
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT me.role::text INTO v_role FROM public.users me WHERE me.id = v_uid LIMIT 1;

  IF COALESCE(v_role, '') IN ('commercial', 'seller') AND v_created_by IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT id INTO v_confirmed_id
  FROM public.order_statuses
  WHERE code = 'CONFIRMED'
  LIMIT 1;

  IF v_confirmed_id IS NULL THEN
    RAISE EXCEPTION 'confirmed_status_missing';
  END IF;

  SELECT array_agg(DISTINCT cp.order_id) INTO v_order_ids
  FROM public.company_parcels cp
  WHERE cp.company_delivery_note_id = p_delivery_note_id;

  DELETE FROM public.company_parcels
  WHERE company_delivery_note_id = p_delivery_note_id;

  IF v_order_ids IS NOT NULL THEN
    FOREACH v_order_id IN ARRAY v_order_ids
    LOOP
      SELECT count(*)::int INTO v_remaining
      FROM public.company_parcels
      WHERE order_id = v_order_id;

      IF v_remaining = 0 THEN
        UPDATE public.orders
        SET
          order_status_id = v_confirmed_id,
          company_id = NULL,
          courier_id = NULL,
          tracking_number = NULL,
          package_status_id = NULL,
          package_status_label = NULL,
          package_status_color = NULL,
          current_delivery_note_id = NULL,
          processing = false
        WHERE id = v_order_id;
      END IF;
    END LOOP;
  END IF;

  DELETE FROM public.company_delivery_notes
  WHERE id = p_delivery_note_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_open_company_delivery_note(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_open_company_delivery_note(uuid) TO authenticated;
