-- whatsapp_010b_resolution.sql  (Wave 10b) — contact-resolution graph + merge + resolve triggers
-- TARGET: box .102 whatsapp ONLY. 13 resolution fns ported via port+adversarial-verify workflow
-- (assembled from JSON; each verified fidelity_ok+l1_complete). merge_conversations + _on_jid_mapping_resolved
-- + _conversations_resolve_identity + the 2 deferred triggers hand-ported (bodies already pulled).
-- check_function_bodies=off makes the interdependent graph order-independent (behaviour proven by rehearsal).
set check_function_bodies = off;


CREATE OR REPLACE FUNCTION whatsapp.identifier_trust(s whatsapp.identifier_source)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE s
    WHEN 'inferred' THEN 0 WHEN 'history_sync' THEN 1 WHEN 'contacts_upsert' THEN 2
    WHEN 'same_envelope_alt' THEN 3 WHEN 'group_participants' THEN 4
    WHEN 'phone_book' THEN 5 WHEN 'human' THEN 6 END
$function$;
revoke all on function whatsapp.identifier_trust(whatsapp.identifier_source) from public;
grant execute on function whatsapp.identifier_trust(whatsapp.identifier_source) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.pick_survivor(p_a uuid, p_b uuid)
 RETURNS TABLE(survivor uuid, dup uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE a_resolved boolean; a_created timestamptz; b_resolved boolean; b_created timestamptz;
BEGIN
  SELECT is_resolved, created_at INTO a_resolved, a_created FROM whatsapp.contacts WHERE id = p_a;
  SELECT is_resolved, created_at INTO b_resolved, b_created FROM whatsapp.contacts WHERE id = p_b;
  IF COALESCE(a_resolved, false) <> COALESCE(b_resolved, false) THEN
    IF COALESCE(a_resolved, false) THEN survivor := p_a; dup := p_b; RETURN NEXT; RETURN;
    ELSE survivor := p_b; dup := p_a; RETURN NEXT; RETURN; END IF;
  END IF;
  IF a_created IS DISTINCT FROM b_created THEN
    IF a_created < b_created THEN survivor := p_a; dup := p_b; RETURN NEXT; RETURN;
    ELSE survivor := p_b; dup := p_a; RETURN NEXT; RETURN; END IF;
  END IF;
  IF p_a < p_b THEN survivor := p_a; dup := p_b; ELSE survivor := p_b; dup := p_a; END IF;
  RETURN NEXT;
END $function$;
revoke all on function whatsapp.pick_survivor(uuid, uuid) from public;
grant execute on function whatsapp.pick_survivor(uuid, uuid) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.chase_merged_into(p_contact_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_cur uuid := p_contact_id; v_next uuid; v_hops int := 0;
BEGIN
  IF v_cur IS NULL THEN RETURN NULL; END IF;
  LOOP
    SELECT merged_into INTO v_next FROM whatsapp.contacts WHERE id = v_cur;
    IF v_next IS NULL OR v_next = v_cur THEN RETURN v_cur; END IF;
    v_hops := v_hops + 1;
    IF v_hops > 32 THEN RETURN v_cur; END IF;
    v_cur := v_next;
  END LOOP;
END $function$;
revoke all on function whatsapp.chase_merged_into(uuid) from public;
grant execute on function whatsapp.chase_merged_into(uuid) to service_role;

CREATE OR REPLACE FUNCTION whatsapp._resolve_lid_to_phone(p_instance_id uuid, p_lid text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT c.phone_jid
    FROM whatsapp.contacts c
   WHERE c.instance_id = p_instance_id
     AND c.merged_into IS NULL
     AND c.phone_jid IS NOT NULL
     AND (
       c.lid = p_lid
       OR EXISTS (SELECT 1 FROM whatsapp.contact_identifiers ci
                   WHERE ci.instance_id = p_instance_id
                     AND ci.contact_id = c.id
                     AND ci.identifier = p_lid)
     )
   LIMIT 1;
$function$;
revoke all on function whatsapp._resolve_lid_to_phone(uuid, text) from public;
grant execute on function whatsapp._resolve_lid_to_phone(uuid, text) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.pair_lid_to_contact(p_instance uuid, p_lid text, p_contact_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid := auth.uid(); v_cid uuid; v_primary text; v_lo text; v_hi text;
BEGIN
  IF v_uid IS NULL OR NOT whatsapp.is_wa_admin(p_instance) THEN
    RAISE EXCEPTION 'pair_lid_to_contact: not authorized';
  END IF;
  IF p_lid IS NULL OR p_lid NOT LIKE '%@lid' THEN
    RAISE EXCEPTION 'pair_lid_to_contact: p_lid must be a @lid identifier';
  END IF;
  v_cid := whatsapp.chase_merged_into(p_contact_id);
  PERFORM 1 FROM whatsapp.contacts WHERE id = v_cid AND instance_id = p_instance AND merged_into IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pair_lid_to_contact: target contact % not found for instance %', p_contact_id, p_instance;
  END IF;
  SELECT identifier INTO v_primary FROM whatsapp.contact_identifiers
    WHERE contact_id = v_cid AND instance_id = p_instance
    ORDER BY whatsapp.identifier_trust(source) DESC, identifier LIMIT 1;
  v_primary := COALESCE(v_primary, v_cid::text);
  IF p_lid < v_primary THEN v_lo := p_lid; v_hi := v_primary;
  ELSE v_lo := v_primary; v_hi := p_lid; END IF;
  INSERT INTO whatsapp.merge_decisions (instance_id, id_a, id_b, decision, decided_by)
  VALUES (p_instance, v_lo, v_hi, 'merge', v_uid)
  ON CONFLICT (instance_id, id_a, id_b) DO UPDATE
    SET decision = 'merge', decided_by = EXCLUDED.decided_by, decided_at = now();
  PERFORM whatsapp.link_alt(v_cid, p_instance, p_lid, 'lid', 'human');
  UPDATE whatsapp.merge_review SET reviewed_at = now()
    WHERE instance_id = p_instance AND kind = 'split_candidate'
      AND identifier = p_lid AND reviewed_at IS NULL;
  RETURN whatsapp.chase_merged_into(v_cid);
END $function$;
revoke all on function whatsapp.pair_lid_to_contact(uuid, text, uuid) from public;
grant execute on function whatsapp.pair_lid_to_contact(uuid, text, uuid) to service_role, authenticated;

CREATE OR REPLACE FUNCTION whatsapp.link_alt(p_cid uuid, p_instance uuid, p_alt_id text, p_alt_kind whatsapp.identifier_kind, p_src whatsapp.identifier_source)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_owner uuid; v_merge_enabled boolean; v_survivor uuid; v_dup uuid;
  v_primary_cid text; v_lo text; v_hi text;
BEGIN
  IF p_alt_id IS NULL OR p_alt_kind = 'group' OR p_alt_id LIKE '%@g.us' THEN RETURN; END IF;
  SELECT contact_id INTO v_owner FROM whatsapp.contact_identifiers
    WHERE instance_id = p_instance AND identifier = p_alt_id;
  IF v_owner IS NULL THEN
    INSERT INTO whatsapp.contact_identifiers (instance_id, contact_id, identifier, kind, source)
    VALUES (p_instance, p_cid, p_alt_id, p_alt_kind, p_src)
    ON CONFLICT (instance_id, identifier) DO NOTHING;
    RETURN;
  END IF;
  v_owner := whatsapp.chase_merged_into(v_owner);
  IF v_owner = p_cid THEN
    UPDATE whatsapp.contact_identifiers SET last_seen_at = now()
      WHERE instance_id = p_instance AND identifier = p_alt_id;
    RETURN;
  END IF;
  SELECT identity_merge_enabled INTO v_merge_enabled FROM whatsapp.whatsapp_instances WHERE id = p_instance;
  IF NOT COALESCE(v_merge_enabled, false) THEN
    INSERT INTO whatsapp.merge_review (instance_id, kind, identifier, alt_identifier, contact_id, detail)
    VALUES (p_instance, 'split_candidate', p_alt_id, NULL, p_cid,
      jsonb_build_object('owner_contact', v_owner, 'cid', p_cid, 'source', p_src::text));
    RETURN;
  END IF;
  SELECT identifier INTO v_primary_cid FROM whatsapp.contact_identifiers
    WHERE contact_id = p_cid AND instance_id = p_instance
    ORDER BY whatsapp.identifier_trust(source) DESC, identifier LIMIT 1;
  IF v_primary_cid IS NOT NULL THEN
    IF p_alt_id < v_primary_cid THEN v_lo := p_alt_id; v_hi := v_primary_cid;
    ELSE v_lo := v_primary_cid; v_hi := p_alt_id; END IF;
    IF EXISTS (SELECT 1 FROM whatsapp.merge_decisions
      WHERE instance_id = p_instance AND id_a = v_lo AND id_b = v_hi AND decision = 'reject') THEN
      RETURN;
    END IF;
  END IF;
  PERFORM 1 FROM whatsapp.contacts WHERE id IN (p_cid, v_owner) ORDER BY id FOR UPDATE;
  v_owner := whatsapp.chase_merged_into(v_owner);
  IF v_owner = p_cid THEN RETURN; END IF;
  SELECT survivor, dup INTO v_survivor, v_dup FROM whatsapp.pick_survivor(p_cid, v_owner);
  UPDATE whatsapp.contact_identifiers SET contact_id = v_survivor
    WHERE contact_id = v_dup
    AND NOT EXISTS (SELECT 1 FROM whatsapp.contact_identifiers s
      WHERE s.instance_id = whatsapp.contact_identifiers.instance_id
        AND s.identifier  = whatsapp.contact_identifiers.identifier
        AND s.contact_id  = v_survivor);
  UPDATE whatsapp.conversations SET contact_id = v_survivor WHERE contact_id = v_dup;
  UPDATE whatsapp.contacts SET merged_into = v_survivor, updated_at = now()
    WHERE id = v_dup AND merged_into IS NULL;
  IF v_survivor::text < v_dup::text THEN v_lo := v_survivor::text; v_hi := v_dup::text;
  ELSE v_lo := v_dup::text; v_hi := v_survivor::text; END IF;
  INSERT INTO whatsapp.merge_decisions (instance_id, id_a, id_b, decision, decided_by)
  VALUES (p_instance, v_lo, v_hi, 'merge', NULL)
  ON CONFLICT (instance_id, id_a, id_b) DO NOTHING;
  PERFORM whatsapp.audit('contact_merged', 'contact', v_survivor::text,
    jsonb_build_object('dup', v_dup, 'alt_id', p_alt_id, 'source', p_src::text));
END $function$;
revoke all on function whatsapp.link_alt(uuid, uuid, text, whatsapp.identifier_kind, whatsapp.identifier_source) from public;
grant execute on function whatsapp.link_alt(uuid, uuid, text, whatsapp.identifier_kind, whatsapp.identifier_source) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.consolidate_contact(p_contact_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_inst uuid; v_lid text;
BEGIN
  SELECT instance_id, lid INTO v_inst, v_lid FROM whatsapp.contacts
    WHERE id = p_contact_id AND merged_into IS NULL;
  IF v_lid IS NOT NULL THEN PERFORM whatsapp.consolidate_lid(v_inst, v_lid); END IF;
END;
$function$;
revoke all on function whatsapp.consolidate_contact(uuid) from public;
grant execute on function whatsapp.consolidate_contact(uuid) to service_role;

create or replace function whatsapp.resolve_identity(p_instance uuid, p_identifier text, p_kind whatsapp.identifier_kind, p_source whatsapp.identifier_source, p_alt_identifier text DEFAULT NULL::text, p_alt_kind whatsapp.identifier_kind DEFAULT NULL::whatsapp.identifier_kind, p_push_name text DEFAULT NULL::text, p_profile_pic text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_new_contact uuid; v_cid uuid; v_inserted boolean;
BEGIN
  IF p_kind = 'group' OR p_identifier IS NULL OR p_identifier LIKE '%@g.us' THEN RETURN NULL; END IF;
  SELECT contact_id INTO v_cid FROM whatsapp.contact_identifiers
    WHERE instance_id = p_instance AND identifier = p_identifier;
  IF v_cid IS NOT NULL THEN
    UPDATE whatsapp.contact_identifiers
      SET last_seen_at = now(),
          source = CASE WHEN whatsapp.identifier_trust(p_source) > whatsapp.identifier_trust(source)
            THEN p_source ELSE source END
      WHERE instance_id = p_instance AND identifier = p_identifier;
  ELSE
    BEGIN
      INSERT INTO whatsapp.contacts (instance_id, push_name, profile_pic, is_resolved)
      VALUES (p_instance, p_push_name, p_profile_pic, false)
      RETURNING id INTO v_new_contact;
      INSERT INTO whatsapp.contact_identifiers (instance_id, contact_id, identifier, kind, source)
      VALUES (p_instance, v_new_contact, p_identifier, p_kind, p_source)
      ON CONFLICT (instance_id, identifier) DO UPDATE
        SET last_seen_at = now(),
            source = CASE WHEN whatsapp.identifier_trust(EXCLUDED.source)
              > whatsapp.identifier_trust(whatsapp.contact_identifiers.source)
              THEN EXCLUDED.source ELSE whatsapp.contact_identifiers.source END
      RETURNING contact_id, (xmax = 0) INTO v_cid, v_inserted;
      IF NOT v_inserted AND v_cid <> v_new_contact THEN
        DELETE FROM whatsapp.contacts WHERE id = v_new_contact;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      SELECT contact_id INTO v_cid FROM whatsapp.contact_identifiers
        WHERE instance_id = p_instance AND identifier = p_identifier;
    END;
  END IF;
  v_cid := whatsapp.chase_merged_into(v_cid);
  UPDATE whatsapp.contacts SET
    phone_jid = CASE WHEN p_kind = 'phone'
       AND whatsapp.identifier_trust(p_source) >= whatsapp.identifier_trust(COALESCE(phone_source, 'inferred'))
       AND NOT EXISTS (SELECT 1 FROM whatsapp.contacts o
         WHERE o.instance_id = p_instance AND o.phone_jid = p_identifier AND o.id <> v_cid)
      THEN p_identifier ELSE phone_jid END,
    phone_number = CASE WHEN p_kind = 'phone' AND phone_number IS NULL
       AND whatsapp.identifier_trust(p_source) >= whatsapp.identifier_trust(COALESCE(phone_source, 'inferred'))
       AND NOT EXISTS (SELECT 1 FROM whatsapp.contacts o
         WHERE o.instance_id = p_instance AND o.phone_jid = p_identifier AND o.id <> v_cid)
      THEN split_part(p_identifier, '@', 1) ELSE phone_number END,
    phone_source = CASE WHEN p_kind = 'phone'
       AND whatsapp.identifier_trust(p_source) >= whatsapp.identifier_trust(COALESCE(phone_source, 'inferred'))
       AND NOT EXISTS (SELECT 1 FROM whatsapp.contacts o
         WHERE o.instance_id = p_instance AND o.phone_jid = p_identifier AND o.id <> v_cid)
      THEN p_source ELSE phone_source END,
    lid = CASE WHEN p_kind = 'lid' AND lid IS NULL
       AND NOT EXISTS (SELECT 1 FROM whatsapp.contacts o
         WHERE o.instance_id = p_instance AND o.lid = p_identifier AND o.id <> v_cid)
      THEN p_identifier ELSE lid END,
    is_resolved = CASE WHEN p_kind = 'phone' THEN true ELSE is_resolved END,
    resolved_at = CASE WHEN p_kind = 'phone' AND resolved_at IS NULL THEN now() ELSE resolved_at END,
    push_name   = COALESCE(push_name, p_push_name),
    profile_pic = COALESCE(profile_pic, p_profile_pic),
    updated_at  = now()
  WHERE id = v_cid;
  IF p_alt_identifier IS NOT NULL AND p_alt_kind IS NOT NULL
     AND p_alt_kind <> 'group' AND p_alt_identifier NOT LIKE '%@g.us' THEN
    PERFORM whatsapp.link_alt(v_cid, p_instance, p_alt_identifier, p_alt_kind, p_source);
  END IF;
  RETURN v_cid;
END $function$;
revoke all on function whatsapp.resolve_identity(uuid, text, whatsapp.identifier_kind, whatsapp.identifier_source, text, whatsapp.identifier_kind, text, text) from public;
grant execute on function whatsapp.resolve_identity(uuid, text, whatsapp.identifier_kind, whatsapp.identifier_source, text, whatsapp.identifier_kind, text, text) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.resolve_contact_from_mapping(p_instance_id uuid, p_lid text, p_phone_jid text, p_push_name text DEFAULT NULL::text, p_profile_pic text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_phone_contact_id uuid; v_lid_contact_id uuid; v_contact_id uuid; v_phone_number text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT whatsapp.is_wa_admin(p_instance_id)
     AND NOT EXISTS (SELECT 1 FROM whatsapp.conversation_assignments ca
       JOIN whatsapp.conversations c ON c.id = ca.conversation_id
       WHERE c.instance_id = p_instance_id AND ca.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden: no access to instance %', p_instance_id USING ERRCODE = '42501';
  END IF;
  v_phone_number := split_part(p_phone_jid, '@', 1);
  SELECT whatsapp.chase_merged_into(id) INTO v_phone_contact_id FROM whatsapp.contacts
    WHERE instance_id = p_instance_id AND phone_jid = p_phone_jid AND merged_into IS NULL LIMIT 1;
  SELECT whatsapp.chase_merged_into(id) INTO v_lid_contact_id FROM whatsapp.contacts
    WHERE instance_id = p_instance_id AND lid = p_lid AND merged_into IS NULL LIMIT 1;
  IF v_phone_contact_id IS NOT NULL AND v_lid_contact_id IS NOT NULL AND v_phone_contact_id <> v_lid_contact_id THEN
    PERFORM 1 FROM whatsapp.contacts WHERE id IN (v_phone_contact_id, v_lid_contact_id) ORDER BY id FOR UPDATE;
    v_contact_id := whatsapp.chase_merged_into(v_phone_contact_id);
    IF v_contact_id = v_lid_contact_id THEN
      UPDATE whatsapp.contacts SET lid = COALESCE(lid, p_lid), push_name = COALESCE(push_name, p_push_name),
        profile_pic = COALESCE(profile_pic, p_profile_pic), is_resolved = true,
        resolved_at = COALESCE(resolved_at, now()), updated_at = now() WHERE id = v_contact_id;
      PERFORM whatsapp.link_alt(v_contact_id, p_instance_id, p_phone_jid, 'phone', 'human');
      PERFORM whatsapp.link_alt(v_contact_id, p_instance_id, p_lid, 'lid', 'human');
      RETURN v_contact_id;
    END IF;
    UPDATE whatsapp.conversations SET contact_id = v_contact_id WHERE contact_id = v_lid_contact_id;
    UPDATE whatsapp.contacts SET merged_into = v_contact_id, lid = NULL, phone_jid = NULL, updated_at = now()
      WHERE id = v_lid_contact_id AND merged_into IS NULL AND v_lid_contact_id <> v_contact_id;
    UPDATE whatsapp.contacts SET lid = COALESCE(lid, p_lid), push_name = COALESCE(push_name, p_push_name),
      profile_pic = COALESCE(profile_pic, p_profile_pic), is_resolved = true,
      resolved_at = COALESCE(resolved_at, now()), updated_at = now() WHERE id = v_contact_id;
    PERFORM whatsapp.audit('contact.soft_merged', 'contact', v_contact_id::text,
      jsonb_build_object('survivor', v_contact_id, 'merged_loser', v_lid_contact_id, 'lid', p_lid,
        'phone_jid', p_phone_jid, 'via', 'resolve_contact_from_mapping'));
  ELSIF v_phone_contact_id IS NOT NULL THEN
    v_contact_id := v_phone_contact_id;
    UPDATE whatsapp.contacts SET lid = COALESCE(lid, p_lid), push_name = COALESCE(p_push_name, push_name),
      profile_pic = COALESCE(p_profile_pic, profile_pic), is_resolved = true,
      resolved_at = COALESCE(resolved_at, now()), updated_at = now() WHERE id = v_contact_id;
  ELSIF v_lid_contact_id IS NOT NULL THEN
    v_contact_id := v_lid_contact_id;
    UPDATE whatsapp.contacts SET phone_number = COALESCE(phone_number, v_phone_number),
      phone_jid = COALESCE(phone_jid, p_phone_jid), push_name = COALESCE(p_push_name, push_name),
      profile_pic = COALESCE(p_profile_pic, profile_pic), is_resolved = true,
      resolved_at = COALESCE(resolved_at, now()), updated_at = now() WHERE id = v_contact_id;
  ELSE
    INSERT INTO whatsapp.contacts (instance_id, phone_number, phone_jid, lid, push_name, profile_pic, is_resolved, resolved_at)
    VALUES (p_instance_id, v_phone_number, p_phone_jid, p_lid, p_push_name, p_profile_pic, true, now())
    RETURNING id INTO v_contact_id;
  END IF;
  -- Record both identifiers in the bible against the survivor (single-writer
  -- link_alt; non-fusing while merge disabled — the merge above already ran).
  PERFORM whatsapp.link_alt(v_contact_id, p_instance_id, p_phone_jid, 'phone', 'human');
  PERFORM whatsapp.link_alt(v_contact_id, p_instance_id, p_lid, 'lid', 'human');
  UPDATE whatsapp.conversations SET contact_id = v_contact_id
    WHERE instance_id = p_instance_id AND contact_id IS NULL AND (remote_jid = p_phone_jid OR remote_jid = p_lid);
  RETURN v_contact_id;
END;
$function$;
revoke all on function whatsapp.resolve_contact_from_mapping(uuid, text, text, text, text) from public;
grant execute on function whatsapp.resolve_contact_from_mapping(uuid, text, text, text, text) to authenticated;
grant execute on function whatsapp.resolve_contact_from_mapping(uuid, text, text, text, text) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.upsert_jid_mapping(p_instance_id uuid, p_lid text, p_phone_jid text, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT whatsapp.is_wa_admin(p_instance_id)
     AND NOT EXISTS (SELECT 1 FROM whatsapp.conversation_assignments ca
       JOIN whatsapp.conversations c ON c.id = ca.conversation_id
       WHERE c.instance_id = p_instance_id AND ca.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden: no access to instance %', p_instance_id USING ERRCODE = '42501';
  END IF;
  INSERT INTO whatsapp.jid_mapping (instance_id, lid, phone_jid, source)
  VALUES (p_instance_id, p_lid, p_phone_jid, p_source)
  ON CONFLICT (instance_id, lid) DO UPDATE SET
    phone_jid = EXCLUDED.phone_jid, source = EXCLUDED.source, discovered_at = now()
  WHERE jid_mapping.phone_jid IS DISTINCT FROM EXCLUDED.phone_jid;
END;
$function$;
revoke all on function whatsapp.upsert_jid_mapping(uuid, text, text, text) from public;
grant execute on function whatsapp.upsert_jid_mapping(uuid, text, text, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION whatsapp.upsert_contact_profile(p_instance_id uuid, p_jid text, p_push_name text, p_profile_pic text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO whatsapp.contact_profiles (instance_id, jid, push_name, profile_pic)
  VALUES (p_instance_id, p_jid, p_push_name, p_profile_pic)
  ON CONFLICT (instance_id, jid) DO UPDATE SET
    push_name   = COALESCE(NULLIF(p_push_name, ''), contact_profiles.push_name),
    profile_pic = COALESCE(NULLIF(p_profile_pic, ''), contact_profiles.profile_pic),
    updated_at  = now();
END;
$function$;
revoke all on function whatsapp.upsert_contact_profile(uuid, text, text, text) from public;
grant execute on function whatsapp.upsert_contact_profile(uuid, text, text, text) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.consolidate_lid_conversation(p_conv_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_inst uuid; v_lid text; v_is_group boolean; v_merged uuid; v_phone text; v_phone_conv uuid; v_contact uuid;
BEGIN
  SELECT instance_id, remote_jid, is_group, merged_into
    INTO v_inst, v_lid, v_is_group, v_merged
    FROM whatsapp.conversations WHERE id = p_conv_id;
  IF v_inst IS NULL OR v_merged IS NOT NULL OR v_is_group OR v_lid NOT LIKE '%@lid' THEN RETURN; END IF;

  v_phone := whatsapp._resolve_lid_to_phone(v_inst, v_lid);
  IF v_phone IS NULL THEN RETURN; END IF;                      -- unknown phone → stay @lid (no guess)

  SELECT id INTO v_contact FROM whatsapp.contacts
    WHERE instance_id = v_inst AND phone_jid = v_phone AND merged_into IS NULL LIMIT 1;

  SELECT id INTO v_phone_conv FROM whatsapp.conversations
    WHERE instance_id = v_inst AND remote_jid = v_phone AND merged_into IS NULL;

  IF v_phone_conv IS NULL THEN
    -- promote in place
    UPDATE whatsapp.outbound_queue SET payload = jsonb_set(payload, '{remote_jid}', to_jsonb(v_phone))
      WHERE conversation_id = p_conv_id AND payload ? 'remote_jid';
    UPDATE whatsapp.conversations
       SET remote_jid = v_phone, contact_id = COALESCE(contact_id, v_contact), updated_at = now()
     WHERE id = p_conv_id;
  ELSE
    PERFORM whatsapp.merge_conversation(v_phone_conv, p_conv_id);
  END IF;
END;
$function$;
revoke all on function whatsapp.consolidate_lid_conversation(uuid) from public;
grant execute on function whatsapp.consolidate_lid_conversation(uuid) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.import_phone_book_entry(p_instance_id uuid, p_phone_number text, p_book_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_phone_jid text;
  v_cid uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT whatsapp.is_wa_admin(p_instance_id)
     AND NOT EXISTS (SELECT 1 FROM whatsapp.conversation_assignments ca
       JOIN whatsapp.conversations c ON c.id = ca.conversation_id
       WHERE c.instance_id = p_instance_id AND ca.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden: no access to instance %', p_instance_id USING ERRCODE = '42501';
  END IF;

  v_phone_jid := p_phone_number || '@s.whatsapp.net';

  -- Bible-first: resolve_identity creates/finds the contact and registers the
  -- phone identifier (source 'phone_book' = high trust). This is the ONLY
  -- contact-creation path now, so no raw-INSERT race / shell duplicate.
  v_cid := whatsapp.resolve_identity(p_instance_id, v_phone_jid, 'phone', 'phone_book', NULL, NULL, NULL, NULL);

  -- Apply the human-provided phone-book name (top display trust) to that contact.
  UPDATE whatsapp.contacts SET
    book_name   = COALESCE(p_book_name, book_name),
    is_resolved = true,
    resolved_at = COALESCE(resolved_at, now()),
    updated_at  = now()
  WHERE id = v_cid;

  -- If we already know a LID for this phone (from jid_mapping), register it as an
  -- alt in the bible too (link_alt is non-fusing while merge is disabled).
  PERFORM whatsapp.link_alt(v_cid, p_instance_id, jm.lid, 'lid', 'phone_book')
  FROM whatsapp.jid_mapping jm
  WHERE jm.instance_id = p_instance_id AND jm.phone_jid = v_phone_jid AND jm.lid IS NOT NULL;

  -- Link any so-far-unlinked conversation whose remote_jid is one of this
  -- contact's identifiers (phone or lid).
  UPDATE whatsapp.conversations
  SET contact_id = v_cid
  WHERE instance_id = p_instance_id AND contact_id IS NULL
    AND remote_jid IN (
      SELECT identifier FROM whatsapp.contact_identifiers
      WHERE instance_id = p_instance_id AND contact_id = v_cid
    );
END;
$function$;
revoke all on function whatsapp.import_phone_book_entry(uuid, text, text) from public;
grant execute on function whatsapp.import_phone_book_entry(uuid, text, text) to authenticated;
grant execute on function whatsapp.import_phone_book_entry(uuid, text, text) to service_role;


-- ============================================================ hand-ported: merge + resolve triggers
-- merge_conversations references conversation_notes/conversation_tags (wave 11) -> plpgsql defers; runtime after wave 11.
create or replace function whatsapp.merge_conversations(p_source_id uuid, p_target_id uuid)
returns void language plpgsql security definer set search_path to '' as $function$
declare v_src whatsapp.conversations; v_tgt whatsapp.conversations;
begin
  if p_source_id = p_target_id then return; end if;
  if p_source_id < p_target_id then
    select * into v_src from whatsapp.conversations where id = p_source_id for update;
    select * into v_tgt from whatsapp.conversations where id = p_target_id for update;
  else
    select * into v_tgt from whatsapp.conversations where id = p_target_id for update;
    select * into v_src from whatsapp.conversations where id = p_source_id for update;
  end if;
  if v_src.id is null or v_tgt.id is null then raise exception 'merge_conversations: source % or target % missing', p_source_id, p_target_id; end if;
  if v_src.instance_id <> v_tgt.instance_id then raise exception 'merge_conversations: cross-instance merge forbidden'; end if;
  if v_src.is_group <> v_tgt.is_group then raise exception 'merge_conversations: cannot merge DM with group'; end if;
  update whatsapp.messages           set conversation_id = p_target_id where conversation_id = p_source_id;
  update whatsapp.outbound_queue     set conversation_id = p_target_id where conversation_id = p_source_id;
  update whatsapp.conversation_notes set conversation_id = p_target_id where conversation_id = p_source_id;
  insert into whatsapp.conversation_tags (conversation_id, tag_id, created_at)
    select p_target_id, tag_id, created_at from whatsapp.conversation_tags where conversation_id = p_source_id
    on conflict (conversation_id, tag_id) do nothing;
  delete from whatsapp.conversation_tags where conversation_id = p_source_id;
  if v_tgt.is_group then
    insert into whatsapp.conversation_assignments (conversation_id, user_id, assigned_by, assigned_at)
      select p_target_id, user_id, assigned_by, assigned_at from whatsapp.conversation_assignments where conversation_id = p_source_id
      on conflict (conversation_id, user_id) do nothing;
  else
    if not exists (select 1 from whatsapp.conversation_assignments where conversation_id = p_target_id) then
      insert into whatsapp.conversation_assignments (conversation_id, user_id, assigned_by, assigned_at)
        select p_target_id, user_id, assigned_by, assigned_at from whatsapp.conversation_assignments where conversation_id = p_source_id limit 1;
    end if;
  end if;
  delete from whatsapp.conversation_assignments where conversation_id = p_source_id;
  with latest as (
    select body_ciphertext, kind, direction, media_meta, whatsapp_timestamp
      from whatsapp.messages where conversation_id = p_target_id order by whatsapp_timestamp desc nulls last limit 1),
  agg as (
    select max(whatsapp_timestamp) as last_at,
           max(whatsapp_timestamp) filter (where direction = 'inbound')  as last_in,
           max(whatsapp_timestamp) filter (where direction = 'outbound') as last_out
      from whatsapp.messages where conversation_id = p_target_id)
  update whatsapp.conversations c
     set last_message_at = (select last_at from agg), last_inbound_at = (select last_in from agg),
         last_outbound_at = (select last_out from agg),
         last_message_preview_ct = (select body_ciphertext from latest),
         last_message_kind = (select kind from latest), last_message_direction = (select direction from latest),
         last_message_sender_name = (select media_meta->>'pushName' from latest),
         last_message_media_meta = (select media_meta from latest),
         unread_count = c.unread_count + coalesce(v_src.unread_count, 0),
         peer_display_name = coalesce(c.peer_display_name, v_src.peer_display_name),
         peer_profile_pic = coalesce(c.peer_profile_pic, v_src.peer_profile_pic),
         contact_id = coalesce(c.contact_id, v_src.contact_id),
         is_pinned = c.is_pinned or v_src.is_pinned, is_archived = c.is_archived and v_src.is_archived,
         updated_at = now()
   where c.id = p_target_id;
  perform whatsapp.audit('conversation_merged', 'conversation', p_target_id::text,
    jsonb_build_object('merged_from_id', p_source_id, 'merged_from_jid', v_src.remote_jid, 'target_jid', v_tgt.remote_jid));
  delete from whatsapp.conversations where id = p_source_id;
end;
$function$;
revoke all on function whatsapp.merge_conversations(uuid, uuid) from public;
grant  execute on function whatsapp.merge_conversations(uuid, uuid) to service_role;

create or replace function whatsapp._on_jid_mapping_resolved()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare v_lid_conv_id uuid; v_phone_conv_id uuid;
begin
  select id into v_lid_conv_id from whatsapp.conversations where instance_id = NEW.instance_id and remote_jid = NEW.lid;
  if v_lid_conv_id is null then return NEW; end if;
  select id into v_phone_conv_id from whatsapp.conversations where instance_id = NEW.instance_id and remote_jid = NEW.phone_jid;
  if v_phone_conv_id is null then
    update whatsapp.conversations set remote_jid = NEW.phone_jid where id = v_lid_conv_id;
  else
    perform whatsapp.merge_conversations(v_lid_conv_id, v_phone_conv_id);
  end if;
  return NEW;
end;
$function$;
revoke all on function whatsapp._on_jid_mapping_resolved() from public;
grant  execute on function whatsapp._on_jid_mapping_resolved() to service_role;

create or replace function whatsapp._conversations_resolve_identity()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare v_kind whatsapp.identifier_kind; v_cid uuid;
begin
  if NEW.contact_id is not null then return NEW; end if;
  if    NEW.remote_jid like '%@s.whatsapp.net' then v_kind := 'phone';
  elsif NEW.remote_jid like '%@lid'            then v_kind := 'lid';
  else  return NEW;
  end if;
  v_cid := whatsapp.resolve_identity(NEW.instance_id, NEW.remote_jid, v_kind, 'contacts_upsert');
  if v_cid is not null then
    update whatsapp.conversations set contact_id = v_cid where id = NEW.id and contact_id is null;
  end if;
  return NEW;
end;
$function$;
revoke all on function whatsapp._conversations_resolve_identity() from public;
grant  execute on function whatsapp._conversations_resolve_identity() to service_role;

-- deferred triggers now buildable (from waves 5 & 6):
create trigger jid_mapping_resolved after insert or update of phone_jid on whatsapp.jid_mapping
  for each row execute function whatsapp._on_jid_mapping_resolved();
create trigger conversations_resolve_identity after insert on whatsapp.conversations
  for each row execute function whatsapp._conversations_resolve_identity();
