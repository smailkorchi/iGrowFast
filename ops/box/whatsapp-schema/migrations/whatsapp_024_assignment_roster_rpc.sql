-- whatsapp_024_assignment_roster_rpc.sql
-- Assignment-page audit (2026-07-08) fixes. The DB was exonerated on timing
-- (roster page 28ms, unassign RPC 15ms, indexed, RLS fastpath in-plan); the
-- fixes are (1) a correctness bug and (2) two server-guard hardenings.
--
-- 1. KEYSTONE — admin_list_instance_assignments(p_instance_id):
--    the client did a 2-stage join — an UNPAGINATED `select id from
--    conversations where instance_id=…` then ceil(N/150) chunked .in() calls.
--    PGRST_DB_MAX_ROWS=1000 silently truncated stage 1: both live instances
--    now exceed 1000 conversations, so assignments for the excluded ~35% never
--    loaded and a change on those rows appeared to NEVER take. This RPC does
--    the join server-side (is_wa_admin-gated like every sibling), returning
--    every assignment for the instance in ONE round trip — kills the 1000-row
--    cap AND the 8-request fan-out AND the nginx-8k URL law in one move.
--
-- 2. HARDENING on the bulk RPCs (audit medium findings):
--    (a) the admin guard `IF EXISTS(... AND NOT is_wa_admin ...)` is VACUOUS
--        when the id array resolves to zero conversations — no admin check
--        runs at all. Add a non-vacuous business-admin precheck + require full
--        id resolution.
--    (b) uuid[] / p_limit were uncapped → a resource-exhaustion lever for any
--        authenticated caller. Cap arrays at 1000 and clamp the list limit.
--    (c) admin_set_auto_assign validated pool members as active commercials but
--        not same-business — add the business clause (runtime paths already
--        filter, so this closes a latent hole, no behavior change today).
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file

begin;

-- ── 1. keystone roster RPC ───────────────────────────────────────────────────
create or replace function whatsapp.admin_list_instance_assignments(p_instance_id uuid)
returns table (
  conversation_id uuid,
  user_id         uuid,
  assigned_by     uuid,
  assigned_at     timestamptz,
  is_group        boolean
)
language sql
stable
security definer
set search_path to ''
as $$
  select a.conversation_id, a.user_id, a.assigned_by, a.assigned_at, a.is_group
  from whatsapp.conversation_assignments a
  join whatsapp.conversations c on c.id = a.conversation_id
  where c.instance_id = p_instance_id
    and whatsapp.is_wa_admin(p_instance_id);
$$;

revoke all on function whatsapp.admin_list_instance_assignments(uuid) from public, anon;
grant execute on function whatsapp.admin_list_instance_assignments(uuid) to authenticated, service_role;

-- ── 2a/2b. hardened bulk assign ──────────────────────────────────────────────
create or replace function whatsapp.admin_assign_conversations(p_user_id uuid, p_conversation_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE v_count integer; v_n integer := coalesce(cardinality(p_conversation_ids), 0);
BEGIN
  IF NOT public.current_user_is_business_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF v_n > 1000 THEN
    RAISE EXCEPTION 'too_many_ids' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM whatsapp.conversations WHERE id = ANY(p_conversation_ids)) <> v_n THEN
    RAISE EXCEPTION 'unknown_conversation_id' USING ERRCODE = 'P0002';
  END IF;
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
    SELECT unnest(p_conversation_ids), p_user_id, auth.uid()
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

-- ── 2a/2b. hardened bulk unassign ────────────────────────────────────────────
create or replace function whatsapp.admin_unassign_conversations(p_user_id uuid, p_conversation_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE v_count integer; v_n integer := coalesce(cardinality(p_conversation_ids), 0);
BEGIN
  IF NOT public.current_user_is_business_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF v_n > 1000 THEN
    RAISE EXCEPTION 'too_many_ids' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM whatsapp.conversations WHERE id = ANY(p_conversation_ids)) <> v_n THEN
    RAISE EXCEPTION 'unknown_conversation_id' USING ERRCODE = 'P0002';
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
    WHERE user_id = p_user_id AND conversation_id = ANY(p_conversation_ids)
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

-- ── 2c. auto-assign pool members must be same-business ───────────────────────
create or replace function whatsapp.admin_set_auto_assign(p_instance_id uuid, p_enabled boolean, p_strategy text, p_pool uuid[])
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_invalid_count integer;
  v_business_id   uuid;
BEGIN
  IF NOT whatsapp.is_wa_admin(p_instance_id) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;

  IF p_strategy <> 'round_robin' THEN
    RAISE EXCEPTION 'invalid_strategy' USING ERRCODE = '22023';
  END IF;

  SELECT business_id INTO v_business_id FROM whatsapp.whatsapp_instances WHERE id = p_instance_id;

  IF array_length(p_pool, 1) IS NOT NULL THEN
    SELECT count(*) INTO v_invalid_count
    FROM unnest(p_pool) AS pool_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.users
      WHERE id = pool_id
        AND active = true
        AND role = 'commercial'
        AND "DigiCom Business" = v_business_id   -- 2c: same-business only
    );
    IF v_invalid_count > 0 THEN
      RAISE EXCEPTION 'pool_contains_invalid_users' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE whatsapp.whatsapp_instances
     SET auto_assign_enabled   = p_enabled,
         auto_assign_strategy  = 'round_robin',
         auto_assign_user_pool = COALESCE(p_pool, '{}'::uuid[]),
         updated_at            = now()
   WHERE id = p_instance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'instance_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM whatsapp.audit(
    'auto_assign_config_changed',
    'whatsapp_instance',
    p_instance_id::text,
    jsonb_build_object(
      'enabled',  p_enabled,
      'strategy', 'round_robin',
      'pool',     COALESCE(p_pool, '{}'::uuid[])
    )
  );

  RETURN jsonb_build_object(
    'enabled',  p_enabled,
    'strategy', 'round_robin',
    'pool',     COALESCE(p_pool, '{}'::uuid[])
  );
END;
$function$;

commit;

-- Verify:
--   impersonate admin → select count(*) from whatsapp.admin_list_instance_assignments('<instance>');
--     (must equal the true assignment count for that instance, > any 1000 cap)
--   select whatsapp.admin_assign_conversations('<uid>', array[]::uuid[]);  -- expect admin_required for non-admins
