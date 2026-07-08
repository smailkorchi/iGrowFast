-- whatsapp_025_bulk_assign_stale_id_tolerant.sql
-- REGRESSION FIX for 024. The full-resolution guard
--   IF (SELECT count(*) FROM conversations WHERE id = ANY(p_conversation_ids)) <> cardinality THEN RAISE
-- was operationally hostile: the Assignment page's client view routinely holds
-- conversation ids that were since deleted/merged (@lid dedup, sync churn), so
-- ANY bulk assign/unassign carrying one stale id RAISED and rolled back the
-- WHOLE batch — nothing was (un)assigned. Symptom: an agent could not be
-- stripped of their conversations ("ghita still has them" — 1929 rows intact).
--
-- Correct posture: be tolerant, not atomic-strict.
--   * UNASSIGN: a stale id is a harmless no-op — the DELETE simply matches
--     nothing (a deleted conversation already FK-cascaded its assignment away).
--     Drop the resolution check entirely.
--   * ASSIGN: source the INSERT from conversations so phantom ids are silently
--     skipped instead of FK-aborting the statement.
--
-- KEPT (the real security wins from 024): current_user_is_business_admin()
-- precheck (non-vacuous admin gate), the 1000-id cardinality cap (DoS), and the
-- per-resolving-id is_wa_admin(instance) EXISTS check (cross-business scoping —
-- a foreign id that DOES resolve is still rejected).
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file

begin;

create or replace function whatsapp.admin_assign_conversations(p_user_id uuid, p_conversation_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE v_count integer;
BEGIN
  IF NOT public.current_user_is_business_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(p_conversation_ids), 0) > 1000 THEN
    RAISE EXCEPTION 'too_many_ids' USING ERRCODE = '22023';
  END IF;
  -- cross-business scoping over the ids that resolve
  IF EXISTS (
    SELECT 1 FROM whatsapp.conversations c
    WHERE c.id = ANY (p_conversation_ids)
      AND NOT whatsapp.is_wa_admin(c.instance_id)
  ) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('whatsapp.audit_assign_suppress', '1', true);
  WITH ins AS (
    INSERT INTO whatsapp.conversation_assignments (conversation_id, user_id, assigned_by)
    SELECT c.id, p_user_id, auth.uid()
    FROM whatsapp.conversations c
    WHERE c.id = ANY (p_conversation_ids)     -- resolve → phantom ids skipped
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;
  IF v_count > 0 THEN
    PERFORM whatsapp.audit(
      'conversations_assigned_bulk', 'user', p_user_id::text,
      jsonb_build_object('count', v_count)
    );
  END IF;
  RETURN v_count;
END;
$function$;

create or replace function whatsapp.admin_unassign_conversations(p_user_id uuid, p_conversation_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE v_count integer;
BEGIN
  IF NOT public.current_user_is_business_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(p_conversation_ids), 0) > 1000 THEN
    RAISE EXCEPTION 'too_many_ids' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM whatsapp.conversations c
    WHERE c.id = ANY(p_conversation_ids)
      AND NOT whatsapp.is_wa_admin(c.instance_id)
  ) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('whatsapp.audit_assign_suppress', '1', true);
  WITH del AS (
    DELETE FROM whatsapp.conversation_assignments
    WHERE user_id = p_user_id AND conversation_id = ANY(p_conversation_ids)  -- stale ids match nothing
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM del;
  IF v_count > 0 THEN
    PERFORM whatsapp.audit(
      'conversations_unassigned_bulk', 'user', p_user_id::text,
      jsonb_build_object('count', v_count)
    );
  END IF;
  RETURN v_count;
END;
$function$;

commit;
