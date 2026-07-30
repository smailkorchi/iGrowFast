CREATE OR REPLACE FUNCTION public.sync_imported_orders(p_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_accessories_synced int := 0;
  v_providers_synced int := 0;
  v_rec record;
  v_best_provider_id uuid;
  v_best_provider_type text;
  v_best_fee numeric;
  v_zone_id uuid;
  v_fee_rec record;
  v_pa record;
  v_first_done boolean;
BEGIN
  -- AUTHZ: caller must operate on their OWN business. NOT owner (per-business op, owner is /owner/*-confined).
  IF NOT (public.check_user_role(auth.uid(), ARRAY['super admin','admin'])
          AND public.current_user_digicom_business_id() IS NOT NULL
          AND p_business_id = public.current_user_digicom_business_id()) THEN
    RAISE EXCEPTION 'forbidden: admin only' USING ERRCODE = '42501';
  END IF;

  FOR v_rec IN
    SELECT oi.id AS item_id, oi.order_id, oi.product_id, oi."DigiCom Business"
    FROM order_items oi
    WHERE oi."DigiCom Business" = p_business_id
      AND oi.product_id IS NOT NULL
      AND oi.accessory_id IS NULL
      AND EXISTS (
        SELECT 1 FROM orders o
        WHERE o.id = oi.order_id
          AND o.source_review_status IS DISTINCT FROM 'pending'
      )
      AND EXISTS (
        SELECT 1 FROM product_accessories pa
        WHERE pa.product_id = oi.product_id
          AND pa."DigiCom Business" = p_business_id
      )
  LOOP
    v_first_done := false;
    FOR v_pa IN
      SELECT pa.accessory_id, pa.default_quantity,
             COALESCE(a.cost_price, 0) AS cost_price
      FROM product_accessories pa
      JOIN accessories a ON a.id = pa.accessory_id
      WHERE pa.product_id = v_rec.product_id
        AND pa."DigiCom Business" = p_business_id
      ORDER BY pa.created_at
    LOOP
      IF NOT v_first_done THEN
        UPDATE order_items
        SET accessory_id = v_pa.accessory_id,
            accessory_quantity = v_pa.default_quantity,
            accessory_unit_price = v_pa.cost_price,
            updated_at = now()
        WHERE id = v_rec.item_id;
        v_first_done := true;
        v_accessories_synced := v_accessories_synced + 1;
      ELSE
        INSERT INTO order_items (
          order_id, product_id, quantity, unit_price,
          accessory_id, accessory_quantity, accessory_unit_price,
          "DigiCom Business"
        ) VALUES (
          v_rec.order_id, v_rec.product_id, 0, 0,
          v_pa.accessory_id, v_pa.default_quantity, v_pa.cost_price,
          p_business_id
        );
        v_accessories_synced := v_accessories_synced + 1;
      END IF;
    END LOOP;
  END LOOP;

  FOR v_rec IN
    SELECT o.id, o.master_city_id, o.shipping_cost
    FROM orders o
    WHERE o."DigiCom Business" = p_business_id
      AND o.master_city_id IS NOT NULL
      AND o.company_id IS NULL
      AND o.courier_id IS NULL
      AND o.source_review_status IS DISTINCT FROM 'pending'
  LOOP
    v_best_provider_id := NULL;
    v_best_provider_type := NULL;
    v_best_fee := NULL;

    SELECT mc.zone_id INTO v_zone_id
    FROM master_cities mc
    WHERE mc.id = v_rec.master_city_id;

    FOR v_fee_rec IN
      SELECT cf.company_id AS provider_id, 'company' AS provider_type, cf.fee
      FROM company_fees cf
      WHERE cf."DigiCom Business" = p_business_id
        AND (cf.master_city_id = v_rec.master_city_id
             OR (v_zone_id IS NOT NULL AND cf.master_city_id IN (
               SELECT mc2.id FROM master_cities mc2
               WHERE mc2.zone_id = v_zone_id
             )))
        AND EXISTS (
          SELECT 1 FROM providers p
          WHERE p.id = cf.company_id AND p.active = true
        )
      UNION ALL
      SELECT crf.courier_id AS provider_id, 'courier' AS provider_type, crf.fee
      FROM courier_fees crf
      WHERE crf."DigiCom Business" = p_business_id
        AND (crf.master_city_id = v_rec.master_city_id
             OR (v_zone_id IS NOT NULL AND crf.master_city_id IN (
               SELECT mc3.id FROM master_cities mc3
               WHERE mc3.zone_id = v_zone_id
             )))
        AND EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = crf.courier_id AND u.active = true AND u.role = 'courier'
        )
      ORDER BY fee ASC
      LIMIT 1
    LOOP
      v_best_provider_id := v_fee_rec.provider_id;
      v_best_provider_type := v_fee_rec.provider_type;
      v_best_fee := v_fee_rec.fee;
    END LOOP;

    IF v_best_provider_id IS NOT NULL THEN
      UPDATE orders
      SET company_id = CASE WHEN v_best_provider_type = 'company' THEN v_best_provider_id ELSE NULL END,
          courier_id = CASE WHEN v_best_provider_type = 'courier' THEN v_best_provider_id ELSE NULL END,
          shipping_cost = CASE WHEN COALESCE(shipping_cost, 0) = 0 THEN v_best_fee ELSE shipping_cost END,
          price = CASE WHEN COALESCE(shipping_cost, 0) = 0 THEN COALESCE(raw_price, 0) + v_best_fee ELSE price END,
          updated_at = now()
      WHERE id = v_rec.id;
      v_providers_synced := v_providers_synced + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'accessories_synced', v_accessories_synced,
    'providers_synced', v_providers_synced
  );
END;
$function$

