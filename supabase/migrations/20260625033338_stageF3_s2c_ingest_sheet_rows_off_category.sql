-- F3-S2c: ingest_sheet_rows entry-status pick category='new' -> is_new (only change).
CREATE OR REPLACE FUNCTION public.ingest_sheet_rows(p_channel_id uuid, p_rows jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_biz uuid; v_map jsonb;
  v_row jsonb; v_raw jsonb; v_rn int;
  v_ext text; v_hash text; v_rowid text;
  v_name text; v_phone text; v_addr text; v_city_txt text; v_src text; v_sku text; v_price_txt text; v_qty_txt text;
  v_city_id uuid; v_prod_id uuid; v_status uuid;
  v_price numeric; v_qty int;
  v_staging_id uuid; v_order_id uuid;
  v_status_label text;
  v_inserted int := 0; v_skipped int := 0; v_review int := 0;
BEGIN
  SELECT "DigiCom Business", coalesce(column_map, public._sheet_default_map())
    INTO v_biz, v_map
    FROM public.sales_channels WHERE id = p_channel_id;
  IF v_biz IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'channel not found'); END IF;

  SELECT id INTO v_status FROM public.order_statuses WHERE is_new LIMIT 1;

  FOR v_row IN SELECT jsonb_array_elements(p_rows) LOOP
    v_raw := v_row->'raw';
    v_rn  := nullif(v_row->>'rn','')::int;
    IF v_raw IS NULL OR v_raw = '{}'::jsonb THEN CONTINUE; END IF;

    v_ext       := public._sheet_pick(v_raw, v_map->'external_id');
    v_name      := public._sheet_pick(v_raw, v_map->'name');
    v_phone     := public._sheet_pick(v_raw, v_map->'phone');
    v_addr      := public._sheet_pick(v_raw, v_map->'address');
    v_city_txt  := public._sheet_pick(v_raw, v_map->'city');
    v_src       := public._sheet_pick(v_raw, v_map->'source');
    v_sku       := public._sheet_pick(v_raw, v_map->'sku');
    v_price_txt := public._sheet_pick(v_raw, v_map->'price');
    v_qty_txt   := public._sheet_pick(v_raw, v_map->'quantity');

    v_hash  := md5(coalesce(v_raw::text, ''));
    v_rowid := coalesce(v_ext, v_hash);

    INSERT INTO public.sheet_ingest_rows
      (channel_id, "DigiCom Business", external_row_id, content_hash, sheet_row_number, raw, status)
    VALUES (p_channel_id, v_biz, v_rowid, v_hash, v_rn, v_raw, 'pending')
    ON CONFLICT (channel_id, external_row_id) DO NOTHING
    RETURNING id INTO v_staging_id;

    IF v_staging_id IS NULL THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    v_city_id := NULL;
    IF v_city_txt IS NOT NULL THEN
      SELECT canonical_id INTO v_city_id FROM public.channel_aliases
       WHERE "DigiCom Business"=v_biz AND alias_type='city' AND lower(btrim(alias_key))=lower(btrim(v_city_txt)) LIMIT 1;
      IF v_city_id IS NULL THEN
        SELECT id INTO v_city_id FROM public.master_cities WHERE lower(btrim(name))=lower(btrim(v_city_txt)) LIMIT 1;
      END IF;
    END IF;
    IF v_city_id IS NULL THEN
      SELECT mc.id INTO v_city_id FROM public.master_cities mc
      WHERE length(mc.name) >= 3
        AND lower(coalesce(v_city_txt,'') || ' ' || coalesce(v_addr,'')) LIKE '%' || lower(mc.name) || '%'
      ORDER BY length(mc.name) DESC LIMIT 1;
    END IF;

    v_prod_id := NULL;
    IF v_sku IS NOT NULL THEN
      SELECT canonical_id INTO v_prod_id FROM public.channel_aliases
       WHERE "DigiCom Business"=v_biz AND alias_type='product' AND lower(btrim(alias_key))=lower(btrim(v_sku)) LIMIT 1;
      IF v_prod_id IS NULL THEN
        SELECT id INTO v_prod_id FROM public.products
         WHERE "DigiCom Business"=v_biz AND active=true
           AND (lower(btrim(code))=lower(btrim(v_sku)) OR lower(btrim(name))=lower(btrim(v_sku))) LIMIT 1;
      END IF;
    END IF;

    v_price := nullif(regexp_replace(coalesce(v_price_txt,''), '[^0-9.]', '', 'g'), '')::numeric;
    v_qty   := coalesce(nullif(regexp_replace(coalesce(v_qty_txt,''), '[^0-9]', '', 'g'), '')::int, 1);

    INSERT INTO public.orders
      ("DigiCom Business", name, phone, address, master_city_id, source_name,
       source_review_status, order_status_id, price, raw_price, date,
       include_delivery_in_total, external_source_key, external_row_id, source_id)
    VALUES
      (v_biz, v_name, v_phone, v_addr, v_city_id, nullif(lower(btrim(coalesce(v_src,''))),''),
       'pending', v_status, v_price, v_price, now(),
       false, p_channel_id::text, v_rowid, p_channel_id)
    RETURNING id INTO v_order_id;

    IF v_prod_id IS NOT NULL THEN
      INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, "DigiCom Business")
      VALUES (v_order_id, v_prod_id, v_qty, coalesce(v_price,0) / greatest(v_qty,1), v_biz);
    END IF;

    v_status_label := CASE
      WHEN v_name IS NULL OR length(regexp_replace(coalesce(v_phone,''),'\D','','g')) < 9 THEN 'needs_review'
      WHEN v_city_id IS NULL THEN 'needs_review'
      WHEN v_sku IS NOT NULL AND v_prod_id IS NULL THEN 'needs_review'
      ELSE 'ready'
    END;
    IF v_status_label = 'needs_review' THEN v_review := v_review + 1; END IF;

    UPDATE public.sheet_ingest_rows
       SET order_id = v_order_id,
           status   = v_status_label,
           mapped   = jsonb_build_object('name',v_name,'phone',v_phone,'address',v_addr,'city',v_city_txt,
                                         'source',v_src,'sku',v_sku,'price',v_price,'quantity',v_qty),
           resolved = jsonb_build_object('master_city_id',v_city_id,'product_id',v_prod_id,'order_id',v_order_id),
           updated_at = now()
     WHERE id = v_staging_id;

    v_inserted := v_inserted + 1;
  END LOOP;

  UPDATE public.sales_channels
     SET last_synced_at = now(), sync_status = 'ok', sync_error = NULL
   WHERE id = p_channel_id;

  RETURN jsonb_build_object('ok', true, 'inserted', v_inserted, 'skipped', v_skipped, 'needs_review', v_review);
END;
$function$;
