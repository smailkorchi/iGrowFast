-- Remove one company parcel from an open delivery note; reset linked order to CONFIRMED and clear logistics.
-- Allowed only when the order has exactly one company parcel (avoids inconsistent state for split shipments).

CREATE OR REPLACE FUNCTION public.remove_company_parcel_from_delivery_note(
  p_parcel_id uuid,
  p_delivery_note_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order_id uuid;
  v_business uuid;
  v_finalized boolean;
  v_created_by uuid;
  v_confirmed_id uuid;
  v_uid uuid;
  v_role text;
  v_parcel_count int;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT
    cp.order_id,
    cdn."DigiCom Business",
    cdn.is_finalized,
    cdn.created_by
  INTO v_order_id, v_business, v_finalized, v_created_by
  FROM public.company_parcels cp
  JOIN public.company_delivery_notes cdn ON cdn.id = cp.company_delivery_note_id
  WHERE cp.id = p_parcel_id
    AND cp.company_delivery_note_id = p_delivery_note_id;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'parcel_not_found';
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

  SELECT count(*)::int INTO v_parcel_count
  FROM public.company_parcels
  WHERE order_id = v_order_id;

  IF v_parcel_count <> 1 THEN
    RAISE EXCEPTION 'order_has_multiple_parcels';
  END IF;

  SELECT id INTO v_confirmed_id
  FROM public.order_statuses
  WHERE code = 'CONFIRMED'
  LIMIT 1;

  IF v_confirmed_id IS NULL THEN
    RAISE EXCEPTION 'confirmed_status_missing';
  END IF;

  DELETE FROM public.company_parcels WHERE id = p_parcel_id;

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

  UPDATE public.company_delivery_notes
  SET
    parcel_count = (
      SELECT count(*)::int
      FROM public.company_parcels
      WHERE company_delivery_note_id = p_delivery_note_id
    ),
    updated_at = now()
  WHERE id = p_delivery_note_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.remove_company_parcel_from_delivery_note(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_company_parcel_from_delivery_note(uuid, uuid) TO authenticated;
