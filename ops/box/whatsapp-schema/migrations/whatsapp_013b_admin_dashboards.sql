-- whatsapp_013b_admin_dashboards.sql  (Wave 13b) — admin/dashboard/stats/monitor RPCs (hybrid gating)
-- Ported via workflow (wf_40d15d4f-b37) + adversarial-verify. Hybrid multi-tenant: fleet=is_owner,
-- per-instance=is_wa_admin(instance), dual=(instance? is_wa_admin : is_owner), agent=auth.uid(), impl=ungated.
-- MANUAL ADAPTATION FIXES applied on top (agents flagged, forbidden to invent): profiles.full_name->users.name,
-- dropped public.invitations metric neutralized, stats_overview_impl fleet_* metrics gated to owner-scope.
set check_function_bodies = off;


CREATE OR REPLACE FUNCTION whatsapp._delivery_rank(s text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE upper(coalesce(s, ''))
    WHEN 'PENDING' THEN 1 WHEN 'PENDING_ACK' THEN 1 WHEN '1' THEN 1
    WHEN 'SERVER_ACK' THEN 2 WHEN 'SENT' THEN 2 WHEN '2' THEN 2
    WHEN 'DELIVERY_ACK' THEN 3 WHEN 'DELIVERED' THEN 3 WHEN '3' THEN 3
    WHEN 'READ' THEN 4 WHEN '4' THEN 4
    WHEN 'PLAYED' THEN 5 WHEN '5' THEN 5
    WHEN 'DELETED' THEN 90 WHEN 'CANCELLED' THEN 90
    ELSE 0
  END
$function$;
REVOKE ALL ON FUNCTION whatsapp._delivery_rank(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp._delivery_rank(text) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp._resolve_conversation(p_instance uuid, p_remote_jid text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_cid uuid := NULL; v_conv uuid; v_kind whatsapp.identifier_kind;
BEGIN
  IF p_remote_jid IS NULL THEN RETURN NULL; END IF;
  IF p_remote_jid LIKE '%@s.whatsapp.net' THEN v_kind := 'phone';
  ELSIF p_remote_jid LIKE '%@lid' THEN v_kind := 'lid';
  ELSE v_kind := NULL; END IF;
  IF v_kind IS NOT NULL THEN
    v_cid := whatsapp.resolve_identity(p_instance, p_remote_jid, v_kind, 'contacts_upsert');
  END IF;
  INSERT INTO whatsapp.conversations (instance_id, remote_jid, contact_id)
  VALUES (p_instance, p_remote_jid, v_cid)
  ON CONFLICT (instance_id, remote_jid) DO UPDATE
    SET contact_id = COALESCE(whatsapp.conversations.contact_id, EXCLUDED.contact_id)
  RETURNING id INTO v_conv;
  RETURN v_conv;
END $function$;
REVOKE ALL ON FUNCTION whatsapp._resolve_conversation(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp._resolve_conversation(uuid, text) TO service_role;


CREATE OR REPLACE FUNCTION whatsapp.admin_audit_chain_status(p_limit integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_broken bigint;
  v_limit integer := least(greatest(coalesce(p_limit, 5000), 1), 100000);
begin
  if not public.is_owner() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select broken_id into v_broken from whatsapp.validate_audit_chain(v_limit) limit 1;
  return jsonb_build_object('ok', v_broken is null, 'broken_id', v_broken, 'checked', v_limit);
end
$function$;
REVOKE ALL ON FUNCTION whatsapp.admin_audit_chain_status(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.admin_audit_chain_status(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.admin_audit_chain_status(integer) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.admin_conversation_clear(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_msg_deleted     int;
  v_queue_deleted   int;
BEGIN
  IF NOT whatsapp.is_wa_admin_conv(p_conversation_id) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM whatsapp.conversations WHERE id = p_conversation_id) THEN
    RAISE EXCEPTION 'conversation_not_found' USING ERRCODE = 'P0002';
  END IF;

  WITH d AS (
    DELETE FROM whatsapp.outbound_queue
     WHERE conversation_id = p_conversation_id
    RETURNING 1
  )
  SELECT count(*) INTO v_queue_deleted FROM d;

  WITH d AS (
    DELETE FROM whatsapp.messages
     WHERE conversation_id = p_conversation_id
    RETURNING 1
  )
  SELECT count(*) INTO v_msg_deleted FROM d;

  UPDATE whatsapp.conversations
     SET last_message_at         = NULL,
         last_message_preview_ct = NULL,
         last_message_kind       = NULL,
         last_message_direction  = NULL,
         last_message_sender_name = NULL,
         last_message_media_meta = NULL,
         last_inbound_at         = NULL,
         last_outbound_at        = NULL,
         unread_count            = 0,
         updated_at              = now()
   WHERE id = p_conversation_id;

  RETURN jsonb_build_object(
    'conversation_id',        p_conversation_id,
    'messages_deleted',       v_msg_deleted,
    'outbound_queue_deleted', v_queue_deleted
  );
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.admin_conversation_clear(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.admin_conversation_clear(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.admin_conversation_clear(uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.admin_conversation_purge_preflight(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_counts jsonb;
  v_keys   text[];
BEGIN
  IF NOT whatsapp.is_wa_admin_conv(p_conversation_id) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM whatsapp.conversations WHERE id = p_conversation_id) THEN
    RAISE EXCEPTION 'conversation_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_counts := jsonb_build_object(
    'messages',
      (SELECT count(*) FROM whatsapp.messages WHERE conversation_id = p_conversation_id),
    'conversation_assignments',
      (SELECT count(*) FROM whatsapp.conversation_assignments WHERE conversation_id = p_conversation_id),
    'conversation_notes',
      (SELECT count(*) FROM whatsapp.conversation_notes WHERE conversation_id = p_conversation_id),
    'conversation_tags',
      (SELECT count(*) FROM whatsapp.conversation_tags WHERE conversation_id = p_conversation_id),
    'outbound_queue',
      (SELECT count(*) FROM whatsapp.outbound_queue WHERE conversation_id = p_conversation_id),
    'r2_media_objects',
      (SELECT count(*) FROM whatsapp.messages
        WHERE conversation_id = p_conversation_id
          AND media_storage_key IS NOT NULL)
  );

  SELECT COALESCE(array_agg(media_storage_key), '{}'::text[])
    INTO v_keys
    FROM whatsapp.messages
   WHERE conversation_id = p_conversation_id
     AND media_storage_key IS NOT NULL;

  RETURN jsonb_build_object(
    'conversation_id', p_conversation_id,
    'counts',          v_counts,
    'r2_keys',         to_jsonb(v_keys)
  );
END;
$function$;

REVOKE ALL ON FUNCTION whatsapp.admin_conversation_purge_preflight(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.admin_conversation_purge_preflight(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.admin_conversation_purge_preflight(uuid) TO service_role;
REVOKE ALL ON FUNCTION whatsapp.admin_conversation_purge_preflight(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.admin_conversation_purge_preflight(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.admin_conversation_purge_preflight(uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.admin_instance_delete_preflight(p_instance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_counts jsonb;
  v_keys   text[];
BEGIN
  IF NOT whatsapp.is_wa_admin(p_instance_id) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM whatsapp.whatsapp_instances WHERE id = p_instance_id) THEN
    RAISE EXCEPTION 'instance_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_counts := jsonb_build_object(
    'conversations',
      (SELECT count(*) FROM whatsapp.conversations WHERE instance_id = p_instance_id),
    'messages',
      (SELECT count(*) FROM whatsapp.messages WHERE instance_id = p_instance_id),
    'conversation_assignments',
      (SELECT count(*) FROM whatsapp.conversation_assignments ca
         JOIN whatsapp.conversations c ON c.id = ca.conversation_id
        WHERE c.instance_id = p_instance_id),
    'conversation_notes',
      (SELECT count(*) FROM whatsapp.conversation_notes cn
         JOIN whatsapp.conversations c ON c.id = cn.conversation_id
        WHERE c.instance_id = p_instance_id),
    'conversation_tags',
      (SELECT count(*) FROM whatsapp.conversation_tags ct
         JOIN whatsapp.conversations c ON c.id = ct.conversation_id
        WHERE c.instance_id = p_instance_id),
    'outbound_queue',
      (SELECT count(*) FROM whatsapp.outbound_queue WHERE number_id = p_instance_id),
    'tags',
      (SELECT count(*) FROM whatsapp.tags WHERE instance_id = p_instance_id),
    'quick_replies',
      0, -- iGrowFast L1: quick_replies are BUSINESS-scoped (wave 11 ADAPT) and survive instance deletion
    'media_fetch_jobs',
      (SELECT count(*) FROM whatsapp.media_fetch_jobs WHERE instance_id = p_instance_id),
    'group_participants',
      (SELECT count(*) FROM whatsapp.group_participants WHERE instance_id = p_instance_id),
    'jid_mapping',
      (SELECT count(*) FROM whatsapp.jid_mapping WHERE instance_id = p_instance_id),
    'contact_profiles',
      (SELECT count(*) FROM whatsapp.contact_profiles WHERE instance_id = p_instance_id),
    'contacts',
      (SELECT count(*) FROM whatsapp.contacts WHERE instance_id = p_instance_id),
    'number_pacing_state',
      (SELECT count(*) FROM whatsapp.number_pacing_state WHERE number_id = p_instance_id),
    'r2_media_objects',
      (SELECT count(*) FROM whatsapp.messages
        WHERE instance_id = p_instance_id AND media_storage_key IS NOT NULL)
  );

  SELECT COALESCE(array_agg(media_storage_key), '{}'::text[])
    INTO v_keys
    FROM whatsapp.messages
   WHERE instance_id = p_instance_id
     AND media_storage_key IS NOT NULL;

  -- iGrowFast L1: quick_replies are BUSINESS-scoped (wave 11 ADAPT); their media outlives any
  -- single instance and MUST NOT be included in the instance's R2 wipe list.
  RETURN jsonb_build_object(
    'instance_id', p_instance_id,
    'counts',      v_counts,
    'r2_keys',     to_jsonb(v_keys)
  );
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.admin_instance_delete_preflight(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.admin_instance_delete_preflight(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.admin_instance_delete_preflight(uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.admin_instance_sync_metrics(p_instance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  r jsonb;
BEGIN
  IF NOT whatsapp.is_wa_admin(p_instance_id) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM whatsapp.whatsapp_instances WHERE id = p_instance_id) THEN
    RAISE EXCEPTION 'instance_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT jsonb_build_object(
    'conversations',
      (SELECT count(*) FROM whatsapp.conversations WHERE instance_id = p_instance_id),
    'conversations_dms',
      (SELECT count(*) FROM whatsapp.conversations WHERE instance_id = p_instance_id AND is_group = false),
    'conversations_groups',
      (SELECT count(*) FROM whatsapp.conversations WHERE instance_id = p_instance_id AND is_group = true),
    'messages',
      (SELECT count(*) FROM whatsapp.messages WHERE instance_id = p_instance_id),
    'messages_media_pending',
      (SELECT count(*) FROM whatsapp.messages WHERE instance_id = p_instance_id AND media_pending = true),
    'contacts',
      (SELECT count(*) FROM whatsapp.contacts WHERE instance_id = p_instance_id),
    'contacts_resolved',
      (SELECT count(*) FROM whatsapp.contacts WHERE instance_id = p_instance_id AND is_resolved = true),
    'contact_profiles',
      (SELECT count(*) FROM whatsapp.contact_profiles WHERE instance_id = p_instance_id),
    'jid_mapping',
      (SELECT count(*) FROM whatsapp.jid_mapping WHERE instance_id = p_instance_id),
    'media_pending',
      (SELECT count(*) FROM whatsapp.media_fetch_jobs
        WHERE instance_id = p_instance_id AND completed_at IS NULL),
    'media_done',
      (SELECT count(*) FROM whatsapp.media_fetch_jobs
        WHERE instance_id = p_instance_id AND completed_at IS NOT NULL),
    'media_failed',
      (SELECT count(*) FROM whatsapp.media_fetch_jobs
        WHERE instance_id = p_instance_id AND completed_at IS NULL AND attempts >= 5),
    'last_message_at',
      (SELECT max(whatsapp_timestamp) FROM whatsapp.messages WHERE instance_id = p_instance_id)
  )
  INTO r;

  RETURN r;
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.admin_instance_sync_metrics(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.admin_instance_sync_metrics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.admin_instance_sync_metrics(uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.admin_list_dead_outbound(p_instance_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(queue_id uuid, number_id uuid, instance_name text, conversation_id uuid, agent_id uuid, action_type whatsapp.outbound_action_type, message_id uuid, attempts smallint, error text, enqueued_at timestamp with time zone, completed_at timestamp with time zone, payload jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT whatsapp.is_wa_admin(p_instance_id) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT q.id,
           q.number_id,
           i.display_name,
           q.conversation_id,
           q.agent_id,
           q.action_type,
           NULLIF(q.payload->>'message_id','')::uuid,
           q.attempts,
           q.error,
           q.enqueued_at,
           q.completed_at,
           q.payload
      FROM whatsapp.outbound_queue q
      JOIN whatsapp.whatsapp_instances i ON i.id = q.number_id
     WHERE q.status = 'dead'
       AND (p_instance_id IS NULL OR q.number_id = p_instance_id)
     ORDER BY q.completed_at DESC NULLS LAST
     LIMIT GREATEST(p_limit, 1)
     OFFSET GREATEST(p_offset, 0);
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.admin_list_dead_outbound(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.admin_list_dead_outbound(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.admin_list_dead_outbound(uuid, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.admin_list_unassigned_conversations(p_instance_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, instance_id uuid, remote_jid text, is_group boolean, peer_display_name text, peer_profile_pic text, contact_id uuid, contact_book_name text, last_message_at timestamp with time zone, last_message_preview text, last_message_kind whatsapp.message_kind, last_message_direction whatsapp.message_direction, unread_count integer, status whatsapp.conversation_status)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT whatsapp.is_wa_admin(p_instance_id) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.instance_id,
    c.remote_jid,
    c.is_group,
    c.peer_display_name,
    c.peer_profile_pic,
    c.contact_id,
    ct.book_name AS contact_book_name,
    c.last_message_at,
    whatsapp._decrypt_conv_preview(c.id) AS last_message_preview,
    c.last_message_kind,
    c.last_message_direction,
    c.unread_count,
    c.status
  FROM whatsapp.conversations c
  LEFT JOIN whatsapp.contacts ct                 ON ct.id  = c.contact_id
  LEFT JOIN whatsapp.conversation_assignments ca ON ca.conversation_id = c.id
  WHERE c.instance_id      = p_instance_id
    AND c.is_archived      = false
    AND c.status IN ('open', 'pending')
    AND ca.conversation_id IS NULL
    AND c.remote_jid NOT LIKE '%@broadcast'
    AND c.remote_jid NOT LIKE '%@newsletter'
    AND (
      c.is_group
      OR c.remote_jid LIKE '%@s.whatsapp.net'
      OR ct.book_name IS NOT NULL
    )
  ORDER BY c.last_message_at DESC NULLS LAST
  LIMIT  p_limit
  OFFSET p_offset;
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.admin_list_unassigned_conversations(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.admin_list_unassigned_conversations(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.admin_list_unassigned_conversations(uuid, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.admin_log_facets(p_channels text[] DEFAULT NULL::text[], p_sources text[] DEFAULT NULL::text[], p_search text DEFAULT NULL::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
  v_from timestamptz := greatest(coalesce(p_from, now() - interval '30 days'), now() - interval '90 days');
  v_search text := case when length(coalesce(p_search, '')) >= 2 then p_search else null end;
begin
  if not public.is_owner() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with unified as (
    select a.occurred_at, 'audit'::text as channel, 'audit'::text as source,
      case when a.event_type ~* '(dead|fail|stale|error|revok|reject|forbidden|cancel)' then 'warn' else 'info' end as level,
      a.event_type as event, a.payload, a.target_id, a.actor_uid
    from whatsapp.audit_log a
    where (p_channels is null or 'audit' = any(p_channels)) and a.occurred_at >= v_from
    union all
    select s.occurred_at, 'system'::text, s.source::text, s.level::text, s.event, s.payload, s.target_id, s.actor_uid
    from whatsapp.system_logs s
    where (p_channels is null or 'system' = any(p_channels)) and s.occurred_at >= v_from
      and (p_sources is null or s.source::text = any(p_sources))
  ),
  scoped as (
    select * from unified u
    where (p_to is null or u.occurred_at <= p_to)
      and (p_actor is null or u.actor_uid = p_actor)
      and (v_search is null or u.event ilike '%'||v_search||'%' or u.payload::text ilike '%'||v_search||'%' or coalesce(u.target_id,'') ilike '%'||v_search||'%')
  )
  select jsonb_build_object(
    'total', (select count(*) from scoped),
    'by_level',   (select coalesce(jsonb_object_agg(level, c), '{}') from (select level, count(*) c from scoped group by level) x),
    'by_channel', (select coalesce(jsonb_object_agg(channel, c), '{}') from (select channel, count(*) c from scoped group by channel) x),
    'by_source',  (select coalesce(jsonb_object_agg(source, c), '{}') from (select source, count(*) c from scoped group by source) x),
    'events',     (select coalesce(jsonb_agg(jsonb_build_object('event', event, 'count', c) order by c desc), '[]')
                    from (select event, count(*) c from scoped group by event order by count(*) desc limit 200) x),
    'actors',     (select coalesce(jsonb_agg(jsonb_build_object('id', actor_uid, 'label', label, 'count', c) order by c desc), '[]')
                    from (select s.actor_uid, coalesce(pr.name, pr.email::text, 'système') as label, count(*) c
                          from scoped s left join public.users pr on pr.id = s.actor_uid
                          where s.actor_uid is not null
                          group by s.actor_uid, pr.name, pr.email order by count(*) desc limit 50) x)
  ) into v_result;
  return v_result;
end
$function$;

revoke all on function whatsapp.admin_log_facets(text[], text[], text, timestamp with time zone, timestamp with time zone, uuid) from public;
grant execute on function whatsapp.admin_log_facets(text[], text[], text, timestamp with time zone, timestamp with time zone, uuid) to authenticated;
grant execute on function whatsapp.admin_log_facets(text[], text[], text, timestamp with time zone, timestamp with time zone, uuid) to service_role;
revoke all on function whatsapp.admin_log_facets(text[], text[], text, timestamp with time zone, timestamp with time zone, uuid) from public;
grant execute on function whatsapp.admin_log_facets(text[], text[], text, timestamp with time zone, timestamp with time zone, uuid) to authenticated;
grant execute on function whatsapp.admin_log_facets(text[], text[], text, timestamp with time zone, timestamp with time zone, uuid) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.admin_query_logs(p_channels text[] DEFAULT NULL::text[], p_sources text[] DEFAULT NULL::text[], p_levels text[] DEFAULT NULL::text[], p_events text[] DEFAULT NULL::text[], p_actor uuid DEFAULT NULL::uuid, p_instance_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 100, p_before_ts timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_channel text DEFAULT NULL::text, p_before_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(occurred_at timestamp with time zone, channel text, row_id bigint, source text, level text, event text, actor_uid uuid, actor_label text, actor_avatar jsonb, instance_id uuid, conversation_id uuid, target_type text, target_id text, payload jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_from timestamptz := greatest(coalesce(p_from, now() - interval '30 days'), now() - interval '90 days');
  v_search text := case when length(coalesce(p_search, '')) >= 2 then p_search else null end;
begin
  if not ((p_instance_id is not null and whatsapp.is_wa_admin(p_instance_id)) or (p_instance_id is null and public.is_owner())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  with unified as (
    select
      a.occurred_at, 'audit'::text as channel, a.id as row_id, 'audit'::text as source,
      case when a.event_type ~* '(dead|fail|stale|error|revok|reject|forbidden|cancel)' then 'warn' else 'info' end as level,
      a.event_type as event, a.actor_uid,
      case when a.target_type = 'instance' and a.target_id ~ '^[0-9a-fA-F-]{36}$' then a.target_id::uuid
           when a.payload->>'instance_id' ~ '^[0-9a-fA-F-]{36}$' then (a.payload->>'instance_id')::uuid else null end as instance_id,
      case when a.target_type = 'conversation' and a.target_id ~ '^[0-9a-fA-F-]{36}$' then a.target_id::uuid
           when a.payload->>'conversation_id' ~ '^[0-9a-fA-F-]{36}$' then (a.payload->>'conversation_id')::uuid else null end as conversation_id,
      a.target_type, a.target_id, a.payload
    from whatsapp.audit_log a
    where (p_channels is null or 'audit' = any(p_channels)) and a.occurred_at >= v_from
    union all
    select
      s.occurred_at, 'system'::text, s.id, s.source::text, s.level::text, s.event,
      s.actor_uid, s.instance_id, s.conversation_id, s.target_type, s.target_id, s.payload
    from whatsapp.system_logs s
    where (p_channels is null or 'system' = any(p_channels)) and s.occurred_at >= v_from
      and (p_sources is null or s.source::text = any(p_sources))
  )
  select
    u.occurred_at, u.channel, u.row_id, u.source, u.level, u.event, u.actor_uid,
    coalesce(pr.name, pr.email::text, left(u.actor_uid::text, 8)) as actor_label,
    pr.avatar_config as actor_avatar,
    u.instance_id, u.conversation_id, u.target_type, u.target_id, u.payload
  from unified u
  left join public.users pr on pr.id = u.actor_uid
  where (p_levels is null or u.level = any(p_levels))
    and (p_events is null or u.event = any(p_events))
    and (p_actor is null or u.actor_uid = p_actor)
    and (p_instance_id is null or u.instance_id = p_instance_id)
    and (p_to is null or u.occurred_at <= p_to)
    and (
      v_search is null
      or u.event ilike '%' || v_search || '%'
      or u.payload::text ilike '%' || v_search || '%'
      or coalesce(u.target_id, '') ilike '%' || v_search || '%'
      or coalesce(pr.name, '') ilike '%' || v_search || '%'
      or coalesce(pr.email::text, '') ilike '%' || v_search || '%'
    )
    and (
      p_before_ts is null
      or (u.occurred_at, u.channel, u.row_id) < (p_before_ts, coalesce(p_before_channel, 'zzzzzzzz'), coalesce(p_before_id, 9223372036854775807))
    )
  order by u.occurred_at desc, u.channel desc, u.row_id desc
  limit v_limit;
end
$function$;
REVOKE ALL ON FUNCTION whatsapp.admin_query_logs(text[], text[], text[], text[], uuid, uuid, text, timestamptz, timestamptz, integer, timestamptz, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.admin_query_logs(text[], text[], text[], text[], uuid, uuid, text, timestamptz, timestamptz, integer, timestamptz, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.admin_query_logs(text[], text[], text[], text[], uuid, uuid, text, timestamptz, timestamptz, integer, timestamptz, text, bigint) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.admin_requeue_dead(p_queue_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row whatsapp.outbound_queue;
  v_msg_id text;
BEGIN
  IF NOT whatsapp.is_wa_admin((select number_id from whatsapp.outbound_queue where id = p_queue_id)) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;
  UPDATE whatsapp.outbound_queue
     SET status='queued', attempts=0, not_before=now(), error=NULL, dispatched_at=NULL, completed_at=NULL
   WHERE id = p_queue_id AND status = 'dead'
   RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'queue_row_not_dead_or_missing' USING ERRCODE = '22023';
  END IF;
  v_msg_id := v_row.payload->>'message_id';
  IF v_msg_id IS NOT NULL THEN
    BEGIN
      UPDATE whatsapp.messages SET delivery_status = 'PENDING'
       WHERE id = v_msg_id::uuid AND delivery_status = 'FAILED';
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE WARNING 'admin_requeue_dead: non-uuid message_id in payload for queue %: %', p_queue_id, v_msg_id;
    END;
  END IF;
  PERFORM pg_notify('outbound_enqueued', v_row.number_id::text);
  PERFORM whatsapp.audit('message.requeued','message', COALESCE(v_msg_id, v_row.id::text),
    jsonb_build_object('queue_id',v_row.id,'number_id',v_row.number_id,'action_type',v_row.action_type));
  RETURN jsonb_build_object('queue_id', v_row.id, 'status', 'queued');
END;
$function$;

REVOKE ALL ON FUNCTION whatsapp.admin_requeue_dead(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.admin_requeue_dead(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.admin_requeue_dead(uuid) TO service_role;
REVOKE ALL ON FUNCTION whatsapp.admin_requeue_dead(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.admin_requeue_dead(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.admin_requeue_dead(uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.admin_set_auto_assign(p_instance_id uuid, p_enabled boolean, p_strategy text, p_pool uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_invalid_count integer;
BEGIN
  IF NOT whatsapp.is_wa_admin(p_instance_id) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;

  IF p_strategy <> 'round_robin' THEN
    RAISE EXCEPTION 'invalid_strategy' USING ERRCODE = '22023';
  END IF;

  IF array_length(p_pool, 1) IS NOT NULL THEN
    SELECT count(*) INTO v_invalid_count
    FROM unnest(p_pool) AS pool_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.users
      WHERE id = pool_id
        AND active = true
        AND role = 'commercial'
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
REVOKE ALL ON FUNCTION whatsapp.admin_set_auto_assign(uuid, boolean, text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.admin_set_auto_assign(uuid, boolean, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.admin_set_auto_assign(uuid, boolean, text, uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.agent_dashboard_overview(p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid   uuid := (select auth.uid());
  v_today timestamptz := date_trunc('day', now() at time zone 'Africa/Casablanca') at time zone 'Africa/Casablanca';
  r jsonb;
begin
  if v_uid is null then raise exception 'forbidden' using errcode='42501'; end if;
  select jsonb_build_object(
    'attention', jsonb_build_object(
      'awaiting_reply', (select count(*) from whatsapp.conversations c
         join whatsapp.conversation_assignments a on a.conversation_id=c.id and a.user_id=v_uid
         where c.status='open' and c.left_at is null and c.merged_into is null
           and c.last_inbound_at is not null and c.last_inbound_at > coalesce(c.last_outbound_at,'epoch'::timestamptz)),
      'oldest_waiting', (select jsonb_build_object('id',c.id,'name',coalesce(c.peer_display_name,''),'wait_sec',extract(epoch from now()-c.last_inbound_at))
         from whatsapp.conversations c
         join whatsapp.conversation_assignments a on a.conversation_id=c.id and a.user_id=v_uid
         where c.status='open' and c.left_at is null and c.merged_into is null
           and c.last_inbound_at is not null and c.last_inbound_at > coalesce(c.last_outbound_at,'epoch'::timestamptz)
         order by c.last_inbound_at asc limit 1),
      'scheduled_overdue', (select count(*) from whatsapp.scheduled_messages where created_by=v_uid and status='pending' and scheduled_at < now()-interval '5 minutes'),
      'scheduled_failed', (select count(*) from whatsapp.scheduled_messages where created_by=v_uid and status='failed')
    ),
    'glance', jsonb_build_object(
      'assigned_total', (select count(*) from whatsapp.conversations c
         join whatsapp.conversation_assignments a on a.conversation_id=c.id and a.user_id=v_uid
         where c.left_at is null and c.merged_into is null),
      'open', (select count(*) from whatsapp.conversations c
         join whatsapp.conversation_assignments a on a.conversation_id=c.id and a.user_id=v_uid
         where c.status='open' and c.left_at is null and c.merged_into is null),
      'unread_total', (select count(*) from whatsapp.conversations c
         join whatsapp.conversation_assignments a on a.conversation_id=c.id and a.user_id=v_uid
         where c.left_at is null and c.merged_into is null and c.unread_count>0),
      'awaiting_reply', (select count(*) from whatsapp.conversations c
         join whatsapp.conversation_assignments a on a.conversation_id=c.id and a.user_id=v_uid
         where c.status='open' and c.left_at is null and c.merged_into is null
           and c.last_inbound_at is not null and c.last_inbound_at > coalesce(c.last_outbound_at,'epoch'::timestamptz)),
      'sent_today', (select count(*) from whatsapp.messages m
         where m.sent_by_agent_id=v_uid and m.direction='outbound' and m.kind<>'system' and m.whatsapp_timestamp >= v_today),
      'received_today', (select count(*) from whatsapp.messages m
         join whatsapp.conversation_assignments a on a.conversation_id=m.conversation_id and a.user_id=v_uid
         where m.direction='inbound' and m.kind<>'system' and m.whatsapp_timestamp >= v_today),
      'pending_scheduled', (select count(*) from whatsapp.scheduled_messages where created_by=v_uid and status='pending')
    ),
    'since', case when p_since is null then null else jsonb_build_object(
      'new_assigned', (select count(*) from whatsapp.conversation_assignments where user_id=v_uid and assigned_at > p_since),
      'new_inbound', (select count(*) from whatsapp.messages m
         join whatsapp.conversation_assignments a on a.conversation_id=m.conversation_id and a.user_id=v_uid
         where m.direction='inbound' and m.kind<>'system' and m.whatsapp_timestamp > p_since),
      'sent', (select count(*) from whatsapp.messages m
         where m.sent_by_agent_id=v_uid and m.direction='outbound' and m.kind<>'system' and m.whatsapp_timestamp > p_since),
      'resolved', (select count(*) from whatsapp.conversations c
         join whatsapp.conversation_assignments a on a.conversation_id=c.id and a.user_id=v_uid
         where c.status='resolved' and c.resolved_at > p_since)
    ) end,
    'recent', (select coalesce(jsonb_agg(x order by (x->>'last_message_at') desc),'[]') from (
       select jsonb_build_object('id',c.id,'remote_jid',c.remote_jid,'instance_id',c.instance_id,
         'name',coalesce(nullif(c.peer_display_name,''),split_part(c.remote_jid,'@',1)),
         'is_group',c.is_group,'unread_count',c.unread_count,'last_message_at',c.last_message_at,
         'awaiting',(c.status='open' and c.last_inbound_at is not null and c.last_inbound_at > coalesce(c.last_outbound_at,'epoch'::timestamptz))) x
       from whatsapp.conversations c
       join whatsapp.conversation_assignments a on a.conversation_id=c.id and a.user_id=v_uid
       where c.left_at is null and c.merged_into is null and c.last_message_at is not null
       order by c.last_message_at desc limit 8) y)
  ) into r;
  return r;
end $function$;
REVOKE ALL ON FUNCTION whatsapp.agent_dashboard_overview(timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.agent_dashboard_overview(timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.agent_dashboard_overview(timestamp with time zone) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.agent_performance(p_days integer DEFAULT 14)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid    uuid := (select auth.uid());
  v_days   int  := greatest(7, least(60, coalesce(p_days, 14)));
  v_tz     text := 'Africa/Casablanca';
  v_today  date := (now() at time zone v_tz)::date;
  v_winstart timestamptz := ((v_today - (v_days - 1))::timestamp) at time zone v_tz;
  v_w0 timestamptz := now() - interval '7 days';   -- rolling 168h window (current)
  v_w1 timestamptz := now() - interval '14 days';  -- prior 168h window start
  r jsonb;
begin
  if v_uid is null then raise exception 'forbidden' using errcode='42501'; end if;

  with assigned as (
    select conversation_id from whatsapp.conversation_assignments where user_id = v_uid
  ),
  cm as (
    select m.id, m.conversation_id, m.whatsapp_timestamp as ts, m.direction, m.sent_by_agent_id
    from whatsapp.messages m
    join assigned a on a.conversation_id = m.conversation_id
    where m.kind <> 'system' and m.whatsapp_timestamp >= v_winstart
  ),
  marked as (
    select cm.*,
      max(case when direction='inbound'  then ts end)
        over (partition by conversation_id order by ts, (case when direction='inbound' then 0 else 1 end), id rows between unbounded preceding and current row) as last_in,
      max(case when direction='outbound' then ts end)
        over (partition by conversation_id order by ts, (case when direction='inbound' then 0 else 1 end), id rows between unbounded preceding and 1 preceding) as last_out_before
    from cm
  ),
  replies as (
    select (ts at time zone v_tz)::date as d, extract(epoch from (ts - last_in))::numeric as resp_sec
    from marked
    where direction='outbound' and sent_by_agent_id = v_uid
      and last_in is not null and (last_out_before is null or last_in > last_out_before) and ts >= last_in
  ),
  active_days as (
    select distinct (whatsapp_timestamp at time zone v_tz)::date as d
    from whatsapp.messages
    where sent_by_agent_id = v_uid and direction='outbound' and kind<>'system'
      and whatsapp_timestamp > now() - interval '90 days'
  ),
  streak_chk as (
    select s.gs, exists(select 1 from active_days a where a.d = v_today - s.gs) as act
    from generate_series(0, 89) s(gs)
  ),
  streak_first as (select min(gs) g0 from streak_chk where act),
  team as (select id from public.users where role='commercial' and active),
  weekrank as (
    select m.sent_by_agent_id as uid, count(*) as c
    from whatsapp.messages m
    join team t on t.id = m.sent_by_agent_id
    where m.direction='outbound' and m.kind<>'system' and m.whatsapp_timestamp > v_w0
    group by m.sent_by_agent_id
  )
  select jsonb_build_object(
    'headline', jsonb_build_object(
      -- rolling 168h windows so current vs prior are equal-elapsed (no partial-day skew)
      'sent_today',     (select count(*) from whatsapp.messages where sent_by_agent_id=v_uid and direction='outbound' and kind<>'system' and (whatsapp_timestamp at time zone v_tz)::date = v_today),
      'sent_week',      (select count(*) from whatsapp.messages where sent_by_agent_id=v_uid and direction='outbound' and kind<>'system' and whatsapp_timestamp > v_w0),
      'sent_prev_week', (select count(*) from whatsapp.messages where sent_by_agent_id=v_uid and direction='outbound' and kind<>'system' and whatsapp_timestamp > v_w1 and whatsapp_timestamp <= v_w0),
      'received_week',  (select count(*) from whatsapp.messages m join assigned a on a.conversation_id=m.conversation_id where m.direction='inbound' and m.kind<>'system' and m.whatsapp_timestamp > v_w0),
      'received_prev_week', (select count(*) from whatsapp.messages m join assigned a on a.conversation_id=m.conversation_id where m.direction='inbound' and m.kind<>'system' and m.whatsapp_timestamp > v_w1 and m.whatsapp_timestamp <= v_w0)
    ),
    'streak_days', (
      select case
        when (select g0 from streak_first) is null or (select g0 from streak_first) > 1 then 0
        else (select count(*) from (
          select bool_and(act) over (order by gs rows between unbounded preceding and current row) as ok
          from streak_chk where gs >= (select g0 from streak_first)
        ) z where ok)
      end
    ),
    'response', jsonb_build_object(
      'median_week_sec',  (select round(percentile_cont(0.5) within group (order by resp_sec)) from replies where d >= v_today-6),
      'median_prev_sec',  (select round(percentile_cont(0.5) within group (order by resp_sec)) from replies where d between v_today-13 and v_today-7),
      'replies_week',     (select count(*) from replies where d >= v_today-6)
    ),
    'rank', jsonb_build_object(
      'position',  (select count(*)+1 from weekrank where c > coalesce((select c from weekrank where uid=v_uid), 0)),
      'team_size', (select greatest(count(*),1) from team),
      'sent',      (select coalesce((select c from weekrank where uid=v_uid), 0))
    ),
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'd', to_char(v_today - off, 'YYYY-MM-DD'),
        'sent',     (select count(*) from whatsapp.messages m where m.sent_by_agent_id=v_uid and m.direction='outbound' and m.kind<>'system' and (m.whatsapp_timestamp at time zone v_tz)::date = v_today - off),
        'received', (select count(*) from whatsapp.messages m join assigned a on a.conversation_id=m.conversation_id where m.direction='inbound' and m.kind<>'system' and (m.whatsapp_timestamp at time zone v_tz)::date = v_today - off),
        'resp_sec', (select round(percentile_cont(0.5) within group (order by resp_sec))::int from replies where d = v_today - off)
      ) order by (v_today - off)), '[]')
      from generate_series(0, v_days - 1) g(off)
    )
  ) into r;
  return r;
end $function$;
REVOKE ALL ON FUNCTION whatsapp.agent_performance(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.agent_performance(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.agent_performance(integer) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.dashboard_activity_impl()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'audit', (select coalesce(jsonb_agg(x),'[]') from (
       select jsonb_build_object('id',a.id,'at',a.occurred_at,'event',a.event_type,'target_type',a.target_type,
          'actor', coalesce(pr.name, pr.email::text, 'système')) x
       from whatsapp.audit_log a left join public.users pr on pr.id=a.actor_uid order by a.occurred_at desc limit 12) y),
    'system', (select coalesce(jsonb_agg(x),'[]') from (
       select jsonb_build_object('id',id,'at',occurred_at,'level',level,'source',source,'event',event) x
       from whatsapp.system_logs where level in ('warn','error') order by occurred_at desc limit 8) y)
  );
$function$;
REVOKE ALL ON FUNCTION whatsapp.dashboard_activity_impl() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.dashboard_activity_impl() TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.dashboard_overview(p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today timestamptz := date_trunc('day', now() at time zone 'Africa/Casablanca') at time zone 'Africa/Casablanca';
  v_active timestamptz := now() - interval '7 days';
  v_activity jsonb;
  r jsonb;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
  v_activity := whatsapp.cache_get_or_compute('dashboard_overview:activity', interval '15 seconds',
    interval '45 seconds', 'whatsapp._compute_dashboard_activity(jsonb)'::regprocedure, '{}'::jsonb);
  v_activity := coalesce(v_activity, jsonb_build_object('audit','[]'::jsonb,'system','[]'::jsonb));
  select jsonb_build_object(
    'attention', jsonb_build_object(
      'numbers_down', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name,'status',status,'detail',status_detail,
            'needs_repair',(status_detail ilike '%401%' or status_detail ilike 'needs_repair%'),'auto_reconnect',auto_reconnect,'last_seen_at',last_seen_at)),'[]')
         from whatsapp.whatsapp_instances where status in ('disconnected','error') or lifecycle_state='banned'),
      'numbers_silent', (select count(*) from whatsapp.whatsapp_instances where status='connected' and (last_seen_at is null or last_seen_at < now()-interval '5 minutes')),
      'numbers_paused', (select count(*) from whatsapp.whatsapp_instances where worker_paused),
      'watchdog_terminal_24h', (select count(*) from whatsapp.system_logs sl where sl.event='watchdog.terminal' and sl.occurred_at > now()-interval '24 hours'
            and exists (select 1 from whatsapp.whatsapp_instances wi where wi.id::text = sl.payload->>'number_id')),
      'dead_letters', (select count(*) from whatsapp.outbound_queue where status='dead'),
      'failed_sends', (select count(*) from whatsapp.outbound_queue where status='failed'),
      'assignment_in_use', (select exists(select 1 from whatsapp.conversation_assignments)),
      'unassigned_open', (select count(*) from whatsapp.conversations c where c.status='open' and c.left_at is null and c.merged_into is null
            and c.last_inbound_at > v_active
            and not exists (select 1 from whatsapp.conversation_assignments a where a.conversation_id=c.id)),
      'oldest_waiting', (select jsonb_build_object('id',id,'wait_sec',extract(epoch from now()-last_inbound_at)) from whatsapp.conversations
            where status='open' and left_at is null and merged_into is null and last_inbound_at is not null
              and last_inbound_at > greatest(v_active, coalesce(last_outbound_at, 'epoch'::timestamptz))
            order by last_inbound_at asc limit 1),
      'snoozed_due', (select count(*) from whatsapp.conversations where status='snoozed' and snoozed_until is not null and snoozed_until <= now()),
      'merge_pending', (select count(*) from whatsapp.merge_review where reviewed_at is null),
      'scheduled_failed', (select count(*) from whatsapp.scheduled_messages where status='failed'),
      'scheduled_overdue', (select count(*) from whatsapp.scheduled_messages where status='pending' and scheduled_at < now()-interval '5 minutes'),
      'errors_24h', (select count(*) from whatsapp.system_logs where level='error' and occurred_at > now()-interval '24 hours'),
      'latest_error', (select event from whatsapp.system_logs where level='error' order by occurred_at desc limit 1),
      'inactive_users', (select count(*) from public.users where active=false),
      'invites_expired', 0  -- neutralized: WA Mancer public.invitations dropped (IDENTITY layer); wire to iGrowFast user_invitations later
    ),
    'glance', jsonb_build_object(
      'open', (select count(*) from whatsapp.conversations where status='open' and left_at is null and merged_into is null),
      'pending', (select count(*) from whatsapp.conversations where status='pending' and left_at is null and merged_into is null),
      'unread_total', (select coalesce(sum(unread_count),0) from whatsapp.conversations where left_at is null and merged_into is null),
      'received_today', (select count(*) from whatsapp.messages where direction='inbound' and kind<>'system' and whatsapp_timestamp >= v_today),
      'replied_today', (select count(*) from whatsapp.messages where direction='outbound' and kind<>'system' and whatsapp_timestamp >= v_today),
      'resolved_today', (select count(*) from whatsapp.conversations where status='resolved' and resolved_at >= v_today)
    ),
    'since', case when p_since is null then null else jsonb_build_object(
      'new_conversations', (select count(*) from whatsapp.conversations where created_at > p_since and merged_into is null),
      'new_inbound', (select count(*) from whatsapp.messages where direction='inbound' and kind<>'system' and whatsapp_timestamp > p_since),
      'new_outbound', (select count(*) from whatsapp.messages where direction='outbound' and kind<>'system' and whatsapp_timestamp > p_since),
      'resolved', (select count(*) from whatsapp.conversations where status='resolved' and resolved_at > p_since)
    ) end,
    'live', jsonb_build_object(
      'fleet', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name,'status',status,'lifecycle',lifecycle_state,'paused',worker_paused,'last_seen_at',last_seen_at) order by display_name),'[]') from whatsapp.whatsapp_instances),
      'connected', (select count(*) from whatsapp.whatsapp_instances where status='connected'),
      'total_numbers', (select count(*) from whatsapp.whatsapp_instances),
      'worker', (select jsonb_build_object('health',health,'queue_depth',queue_depth,'drain_rate_1m',drain_rate_1m,'lag_sec',extract(epoch from now()-last_heartbeat_at))
         from whatsapp.worker_health_status order by last_heartbeat_at desc limit 1)
    ),
    -- All active agents + their live assigned load (active = not left, not merged).
    -- ordered heaviest-first so the manager sees who is overloaded at a glance.
    'team', (
      select coalesce(jsonb_agg(t order by t.assigned desc, t.name nulls last), '[]')
      from (
        select p.id as user_id, p.name, p.email, p.avatar_config,
               (select count(*) from whatsapp.conversation_assignments a
                  join whatsapp.conversations c on c.id = a.conversation_id
                 where a.user_id = p.id and c.left_at is null and c.merged_into is null) as assigned
        from public.users p
        where p.role = 'commercial' and p.active = true
      ) t
    ),
    -- Today's inbound volume by hour (0..23, Africa/Casablanca) for the card trend.
    'sparkline', jsonb_build_object(
      'inbound_by_hour', (
        select coalesce(jsonb_agg(s.cnt order by s.hr), '[]')
        from (
          select gs.hr,
                 (select count(*) from whatsapp.messages m
                    where m.direction='inbound' and m.kind<>'system'
                      and m.whatsapp_timestamp >= v_today
                      and extract(hour from (m.whatsapp_timestamp at time zone 'Africa/Casablanca'))::int = gs.hr
                 ) as cnt
          from generate_series(0,23) as gs(hr)
        ) s
      )
    ),
    'activity', v_activity
  ) into r;
  return r;
end $function$;
revoke all on function whatsapp.dashboard_overview(timestamp with time zone) from public;
grant execute on function whatsapp.dashboard_overview(timestamp with time zone) to authenticated;
grant execute on function whatsapp.dashboard_overview(timestamp with time zone) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.db_metrics_live()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
  select jsonb_build_object(
    'db_size_bytes', pg_database_size(current_database()),
    'max_connections', current_setting('max_connections')::int,
    'connections', (select jsonb_build_object(
        'total', count(*), 'active', count(*) filter (where state='active'),
        'idle', count(*) filter (where state='idle'),
        'idle_in_txn', count(*) filter (where state='idle in transaction'))
      from pg_stat_activity where datname=current_database()),
    'cache_hit_pct', (select case when sum(blks_hit+blks_read)>0
        then round((sum(blks_hit)::numeric/sum(blks_hit+blks_read))*100,2) else null end
      from pg_stat_database where datname=current_database()),
    'longest_active_sec', (select coalesce(round(max(extract(epoch from now()-query_start))),0)
      from pg_stat_activity where datname=current_database() and state='active' and query not ilike '%pg_stat_activity%'),
    'longest_idle_in_txn_sec', (select coalesce(round(max(extract(epoch from now()-state_change))),0)
      from pg_stat_activity where datname=current_database() and state='idle in transaction'),
    'top_tables', (select coalesce(jsonb_agg(t),'[]'::jsonb) from (
        select c.relname as name, pg_total_relation_size(c.oid) as bytes,
          s.n_live_tup as live, s.n_dead_tup as dead,
          case when s.n_live_tup+s.n_dead_tup>0 then round((s.n_dead_tup::numeric/(s.n_live_tup+s.n_dead_tup))*100,1) else 0 end as dead_pct
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        left join pg_stat_user_tables s on s.relid=c.oid
        where c.relkind='r' and n.nspname not in ('pg_catalog','information_schema','pg_toast')
        order by pg_total_relation_size(c.oid) desc limit 12) t),
    'slow_queries', (select coalesce(jsonb_agg(jsonb_build_object(
        'pid',pid,'sec',round(extract(epoch from now()-query_start)),'state',state)),'[]'::jsonb)
      from pg_stat_activity where datname=current_database() and state='active'
        and now()-query_start > interval '5 seconds'
        and query not ilike '%pg_stat_activity%' and backend_type='client backend')
  ) into r;
  return r;
end $function$;
revoke all on function whatsapp.db_metrics_live() from public;
grant execute on function whatsapp.db_metrics_live() to authenticated;
grant execute on function whatsapp.db_metrics_live() to service_role;

CREATE OR REPLACE FUNCTION whatsapp.db_metrics_series(p_source text DEFAULT 'supabase'::text, p_hours integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb; v_h int := least(greatest(coalesce(p_hours,6),1),168);
        v_src text := case when p_source in ('supabase','evolution') then p_source else 'supabase' end;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
  with rows as (
    select captured_at, db_size_bytes, conn_total, conn_active, conn_idle, conn_idle_in_txn, cache_hit_pct,
      (xact_commit+xact_rollback) as xacts,
      lag(xact_commit+xact_rollback) over (order by captured_at) as prev_xacts,
      extract(epoch from (captured_at - lag(captured_at) over (order by captured_at))) as dt
    from whatsapp.db_metrics_history
    where source=v_src and captured_at > now() - make_interval(hours => v_h)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    't',captured_at,'size',db_size_bytes,'conn',conn_total,'active',conn_active,
    'idle',conn_idle,'idle_in_txn',conn_idle_in_txn,'cache',cache_hit_pct,
    'tps', case when dt>0 and xacts>=prev_xacts then round((xacts-prev_xacts)/dt,2) else null end
  ) order by captured_at),'[]'::jsonb) into r from rows;
  return r;
end $function$;
REVOKE ALL ON FUNCTION whatsapp.db_metrics_series(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.db_metrics_series(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.db_metrics_series(text, integer) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.forward_message(p_message_id uuid, p_target_conv_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_src     whatsapp.messages;
  v_body    text;
  v_target  uuid;
  v_results jsonb := '[]'::jsonb;
  v_r       jsonb;
BEGIN
  SELECT * INTO v_src FROM whatsapp.messages WHERE id = p_message_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'message_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_src.evolution_message_id IS NULL THEN
    RAISE EXCEPTION 'cannot_forward_pending_message' USING ERRCODE = '22023';
  END IF;
  PERFORM whatsapp._assert_conversation_access(v_src.conversation_id);

  v_body := whatsapp.decrypt_text(v_src.body_ciphertext);

  -- Forward shares the same R2 object (no copy). Access control is via
  -- the new message's RLS, not the storage key path. If the source is
  -- ever hard-deleted, ref-counting will need to be added before the R2
  -- object can be garbage-collected.
  FOREACH v_target IN ARRAY p_target_conv_ids LOOP
    BEGIN
      v_r := whatsapp.send_message(
        p_conversation_id      := v_target,
        p_body                 := v_body,
        p_kind                 := v_src.kind,
        p_media_storage_key    := v_src.media_storage_key,
        p_media_storage_bucket := v_src.media_storage_bucket,
        p_media_mime           := v_src.media_mime,
        p_media_size_bytes     := v_src.media_size_bytes,
        p_media_meta           := v_src.media_meta,
        p_forward_from         := p_message_id
      );
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'conversation_id', v_target,
        'ok',              true,
        'message_id',      v_r->>'message_id'
      ));
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'conversation_id', v_target,
        'ok',              false,
        'error',           SQLERRM
      ));
    END;
  END LOOP;

  PERFORM whatsapp.audit('message.forwarded', 'message', p_message_id::text,
    jsonb_build_object('targets', p_target_conv_ids, 'results', v_results));

  RETURN jsonb_build_object('results', v_results);
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.forward_message(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.forward_message(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.forward_message(uuid, uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.get_recent_tag_colors(p_instance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT whatsapp.is_wa_admin(p_instance_id)
     AND NOT EXISTS (SELECT 1 FROM whatsapp.conversation_assignments ca
       JOIN whatsapp.conversations c ON c.id = ca.conversation_id
       WHERE c.instance_id = p_instance_id AND ca.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden: no access to instance %', p_instance_id USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT recent_tag_colors FROM whatsapp.whatsapp_instances WHERE id = p_instance_id);
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.get_recent_tag_colors(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.get_recent_tag_colors(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.get_recent_tag_colors(uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.instance_capacity_status(p_instance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_inst record;
  v_day_used int; v_hour_used int; v_minute_used int;
  v_oldest_day timestamptz; v_oldest_hour timestamptz; v_tz text;
BEGIN
  IF NOT (
    whatsapp.is_wa_admin(p_instance_id)
    OR EXISTS (
      SELECT 1 FROM whatsapp.conversation_assignments ca
      JOIN whatsapp.conversations c ON c.id = ca.conversation_id
      WHERE ca.user_id = auth.uid() AND c.instance_id = p_instance_id
    )
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT id, daily_send_cap, hourly_send_cap, minute_burst_cap,
         worker_paused, lifecycle_state, business_hours, business_hours_enabled,
         quiet_hours_override_until
    INTO v_inst FROM whatsapp.whatsapp_instances WHERE id = p_instance_id;
  IF v_inst.id IS NULL THEN
    RAISE EXCEPTION 'instance_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_tz := COALESCE(v_inst.business_hours->>'tz','UTC');

  SELECT
    count(*) FILTER (WHERE q.completed_at > date_trunc('day', now() AT TIME ZONE v_tz)),
    count(*) FILTER (WHERE q.completed_at > now() - interval '1 hour'),
    count(*) FILTER (WHERE q.completed_at > now() - interval '1 minute'),
    min(q.completed_at) FILTER (WHERE q.completed_at > date_trunc('day', now() AT TIME ZONE v_tz)),
    min(q.completed_at) FILTER (WHERE q.completed_at > now() - interval '1 hour')
    INTO v_day_used, v_hour_used, v_minute_used, v_oldest_day, v_oldest_hour
    FROM whatsapp.outbound_queue q
   WHERE q.number_id = p_instance_id
     AND q.status = 'sent'
     AND q.action_type IN ('send_text','send_media','send_poll','react','edit_message','delete_message','send_contact');

  RETURN jsonb_build_object(
    'instance_id', v_inst.id, 'lifecycle_state', v_inst.lifecycle_state,
    'worker_paused', v_inst.worker_paused, 'business_hours', v_inst.business_hours,
    'business_hours_enabled', v_inst.business_hours_enabled,
    'quiet_hours_override_until', v_inst.quiet_hours_override_until,
    'daily', jsonb_build_object('used', v_day_used, 'cap', v_inst.daily_send_cap,
      'pct', CASE WHEN v_inst.daily_send_cap > 0 THEN round((v_day_used::numeric * 100 / v_inst.daily_send_cap)::numeric, 1) ELSE 0 END,
      'resume_at', CASE WHEN v_day_used >= v_inst.daily_send_cap THEN date_trunc('day', now() AT TIME ZONE v_tz) + interval '1 day' ELSE NULL END),
    'hourly', jsonb_build_object('used', v_hour_used, 'cap', v_inst.hourly_send_cap,
      'pct', CASE WHEN v_inst.hourly_send_cap > 0 THEN round((v_hour_used::numeric * 100 / v_inst.hourly_send_cap)::numeric, 1) ELSE 0 END,
      'resume_at', CASE WHEN v_hour_used >= v_inst.hourly_send_cap THEN COALESCE(v_oldest_hour, now()) + interval '1 hour' ELSE NULL END),
    'minute', jsonb_build_object('used', v_minute_used, 'cap', v_inst.minute_burst_cap,
      'pct', CASE WHEN v_inst.minute_burst_cap > 0 THEN round((v_minute_used::numeric * 100 / v_inst.minute_burst_cap)::numeric, 1) ELSE 0 END),
    'as_of', now()
  );
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.instance_capacity_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.instance_capacity_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.instance_capacity_status(uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.instance_stats(p_instance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if whatsapp.is_wa_admin(p_instance_id) then
    return whatsapp.cache_get_or_compute('instance_stats:v1:'||p_instance_id::text,
      interval '15 seconds', interval '45 seconds',
      'whatsapp._compute_instance_stats(jsonb)'::regprocedure,
      jsonb_build_object('instance_id', p_instance_id));
  end if;
  if not exists (
    select 1 from whatsapp.conversation_assignments ca
    join whatsapp.conversations c on c.id = ca.conversation_id
    where c.instance_id = p_instance_id and ca.user_id = (select auth.uid())
  ) then
    raise exception 'forbidden';
  end if;
  return whatsapp.instance_stats_impl(p_instance_id); -- non-admin: LIVE
end $function$;
REVOKE ALL ON FUNCTION whatsapp.instance_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.instance_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.instance_stats(uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.instance_stats_impl(p_instance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v jsonb;
BEGIN

  SELECT jsonb_build_object(
    'conversations_total',     (SELECT count(*)::int FROM whatsapp.conversations WHERE instance_id = p_instance_id),
    'conversations_groups',    (SELECT count(*)::int FROM whatsapp.conversations WHERE instance_id = p_instance_id AND is_group = true),
    'conversations_dms',       (SELECT count(*)::int FROM whatsapp.conversations WHERE instance_id = p_instance_id AND is_group = false),
    'conversations_unread',    (SELECT count(*)::int FROM whatsapp.conversations WHERE instance_id = p_instance_id AND unread_count > 0),
    'conversations_active_24h',(SELECT count(*)::int FROM whatsapp.conversations WHERE instance_id = p_instance_id AND last_message_at > now() - interval '24 hours'),
    'contacts_total',          (SELECT count(DISTINCT remote_jid)::int FROM whatsapp.conversations WHERE instance_id = p_instance_id AND is_group = false),
    'messages_total',          (SELECT count(*)::int FROM whatsapp.messages WHERE instance_id = p_instance_id),
    'messages_inbound_24h',    (SELECT count(*)::int FROM whatsapp.messages WHERE instance_id = p_instance_id AND direction='inbound'  AND whatsapp_timestamp > now() - interval '24 hours'),
    'messages_outbound_24h',   (SELECT count(*)::int FROM whatsapp.messages WHERE instance_id = p_instance_id AND direction='outbound' AND whatsapp_timestamp > now() - interval '24 hours'),
    'messages_7d',             (SELECT count(*)::int FROM whatsapp.messages WHERE instance_id = p_instance_id AND whatsapp_timestamp > now() - interval '7 days'),
    'queue_queued',            (SELECT count(*)::int FROM whatsapp.outbound_queue WHERE number_id = p_instance_id AND status = 'queued'),
    'queue_dispatching',       (SELECT count(*)::int FROM whatsapp.outbound_queue WHERE number_id = p_instance_id AND status = 'dispatching'),
    'queue_dead_24h',          (SELECT count(*)::int FROM whatsapp.outbound_queue WHERE number_id = p_instance_id AND status = 'dead' AND completed_at > now() - interval '24 hours'),
    'reconnects_7d',           (SELECT count(*)::int FROM whatsapp.audit_log WHERE target_type='instance' AND target_id=p_instance_id::text AND event_type='instance_status_changed' AND payload->>'new'='connected' AND occurred_at > now() - interval '7 days'),
    'last_inbound_at',         (SELECT max(whatsapp_timestamp) FROM whatsapp.messages WHERE instance_id = p_instance_id AND direction='inbound'),
    'last_outbound_at',        (SELECT max(whatsapp_timestamp) FROM whatsapp.messages WHERE instance_id = p_instance_id AND direction='outbound')
  ) INTO v;

  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.instance_stats_impl(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.instance_stats_impl(uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.monitor_app(p_hours integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
  select jsonb_build_object(
    'queue', jsonb_build_object(
      'by_status', (select coalesce(jsonb_object_agg(status, c),'{}') from (select status::text, count(*) c from whatsapp.outbound_queue group by status) q),
      'depth', (select count(*) from whatsapp.outbound_queue where status in ('queued','dispatching')),
      'dead_by_action', (select coalesce(jsonb_object_agg(action_type, c),'{}') from (select action_type::text, count(*) c from whatsapp.outbound_queue where status='dead' group by action_type) d),
      'dead_24h', (select count(*) from whatsapp.outbound_queue where status='dead' and enqueued_at > now()-interval '24 hours'),
      'sent_1h', (select count(*) from whatsapp.outbound_queue where status='sent' and enqueued_at > now()-interval '1 hour'),
      'failed_1h', (select count(*) from whatsapp.outbound_queue where status in ('failed','dead') and enqueued_at > now()-interval '1 hour')
    ),
    'workers', (select coalesce(jsonb_agg(jsonb_build_object('worker_id',worker_id,'hostname',hostname,'health',health,'lag_sec',seconds_since_heartbeat,'queue_depth',queue_depth,'dispatching',dispatching_count,'drain',drain_rate_1m,'active_numbers',active_numbers,'last_dispatch_at',last_dispatch_at) order by worker_id),'[]') from whatsapp.worker_health_status),
    'instances', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',coalesce(display_name,wa_profile_name,'Numéro'),'status',status,'lifecycle',lifecycle_state,'paused',worker_paused,'last_seen_at',last_seen_at,'detail',status_detail,'stale_sec',extract(epoch from now()-last_seen_at)::int) order by display_name),'[]') from whatsapp.whatsapp_instances),
    'media', jsonb_build_object(
      'pending', (select count(*) from whatsapp.media_fetch_jobs where completed_at is null),
      'retrying', (select count(*) from whatsapp.media_fetch_jobs where completed_at is null and attempts > 0),
      'oldest_pending_sec', (select extract(epoch from now()-min(created_at))::int from whatsapp.media_fetch_jobs where completed_at is null),
      'done_1h', (select count(*) from whatsapp.media_fetch_jobs where completed_at > now()-interval '1 hour')
    ),
    'errors_by_source_1h', (select coalesce(jsonb_object_agg(source, c),'{}') from (select source::text, count(*) c from whatsapp.system_logs where level='error' and occurred_at > now()-interval '1 hour' group by source) s),
    'errors_recent', (select coalesce(jsonb_agg(jsonb_build_object('at',occurred_at,'source',source,'level',level,'event',event,'instance_id',instance_id) order by occurred_at desc),'[]')
                      from (select occurred_at,source,level,event,instance_id from whatsapp.system_logs where level in ('error','warn') order by occurred_at desc limit 25) e)
  ) into r;
  return r;
end $function$;
revoke all on function whatsapp.monitor_app(integer) from public;
grant execute on function whatsapp.monitor_app(integer) to authenticated;
grant execute on function whatsapp.monitor_app(integer) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.monitor_host_current()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
  select to_jsonb(h) into r from whatsapp.host_metrics h order by captured_at desc limit 1;
  return r;
end $function$;
REVOKE ALL ON FUNCTION whatsapp.monitor_host_current() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.monitor_host_current() TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.monitor_host_current() TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.monitor_host_series(p_minutes integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb; v_min int := least(greatest(coalesce(p_minutes,60),5),1440);
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    't',captured_at,'cpu',cpu_pct,
    'mem',case when mem_total_mb>0 then round((mem_used_mb::numeric/mem_total_mb)*100,1) else null end,
    'load1',load1,'rx',net_rx_kbps,'tx',net_tx_kbps) order by captured_at),'[]'::jsonb)
  into r from whatsapp.host_metrics where captured_at > now() - make_interval(mins => v_min);
  return r;
end $function$;
REVOKE ALL ON FUNCTION whatsapp.monitor_host_series(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.monitor_host_series(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.monitor_host_series(integer) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.monitor_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
  with latest as (
    select distinct on (name, labels) name, labels, value
    from whatsapp.metric_samples
    where source='prom' and captured_at > now() - interval '10 minutes'
      and name in ('pg_up','node_memory_MemAvailable_bytes','node_memory_MemTotal_bytes','node_filesystem_avail_bytes','node_filesystem_size_bytes')
    order by name, labels, value desc
  ),
  cpu2 as (
    select captured_at, sum(value) tot, sum(value) filter (where labels->>'mode'='idle') idle
    from whatsapp.metric_samples
    where source='prom' and name='node_cpu_seconds_total' and captured_at > now() - interval '6 minutes'
    group by captured_at order by captured_at desc limit 2
  ),
  cpu as (
    select case when count(*)=2 then greatest(0, least(100, round(((1 - (max(idle)-min(idle)) / nullif(max(tot)-min(tot),0)) * 100)::numeric, 1))) end pct from cpu2
  ),
  mem as (
    select round(((1 - (select value from latest where name='node_memory_MemAvailable_bytes')
                    / nullif((select value from latest where name='node_memory_MemTotal_bytes'),0)) * 100)::numeric, 1) pct
  ),
  disk as (
    select max(round(((1 - (l.value) / nullif(s.value,0)) * 100)::numeric, 1)) pct
    from latest l join latest s on l.labels=s.labels and l.name='node_filesystem_avail_bytes' and s.name='node_filesystem_size_bytes'
  )
  select jsonb_build_object(
    'pg_up', coalesce((select value from latest where name='pg_up'), 0),
    'instances_total', (select count(*) from whatsapp.whatsapp_instances),
    'instances_connected', (select count(*) from whatsapp.whatsapp_instances where status='connected'),
    'instances_error', (select count(*) from whatsapp.whatsapp_instances where status in ('error','disconnected') or lifecycle_state='banned'),
    'worker_lag_sec', (select max(seconds_since_heartbeat) from whatsapp.worker_health_status),
    'worker_health', (select case when bool_or(health<>'healthy') then 'degraded' else 'healthy' end from whatsapp.worker_health_status),
    'queue_depth', (select count(*) from whatsapp.outbound_queue where status in ('queued','dispatching')),
    'queue_drain', (select coalesce(sum(drain_rate_1m),0) from whatsapp.worker_health_status),
    'send_total_1h', (select count(*) from whatsapp.outbound_queue where action_type in ('send_text','send_media','send_poll','send_contact') and enqueued_at > now()-interval '1 hour'),
    'send_failed_1h', (select count(*) from whatsapp.outbound_queue where action_type in ('send_text','send_media','send_poll','send_contact') and status in ('failed','dead') and enqueued_at > now()-interval '1 hour'),
    'dead_24h', (select count(*) from whatsapp.outbound_queue where status='dead' and enqueued_at > now()-interval '24 hours'),
    'cpu_pct', (select pct from cpu),
    'mem_pct', (select pct from mem),
    'disk_pct', (select pct from disk),
    'errors_1h', (select count(*) from whatsapp.system_logs where level='error' and occurred_at > now()-interval '1 hour')
  ) into r;
  return r;
end $function$;
REVOKE ALL ON FUNCTION whatsapp.monitor_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.monitor_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.monitor_overview() TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.monitor_prom_latest(p_names text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('name',name,'labels',labels,'value',value,'captured_at',captured_at)), '[]'::jsonb)
    from (
      select distinct on (name, labels) name, labels, value, captured_at
      from whatsapp.metric_samples
      where source='prom' and name = any(p_names) and captured_at > now() - interval '10 minutes'
      order by name, labels, captured_at desc
    ) s
  );
end $function$;
REVOKE ALL ON FUNCTION whatsapp.monitor_prom_latest(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.monitor_prom_latest(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.monitor_prom_latest(text[]) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.monitor_prom_series(p_names text[], p_minutes integer DEFAULT 180)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('name',name,'labels',labels,'t',t,'value',round(v::numeric,4)) order by name, t), '[]'::jsonb)
    from (
      select name, labels, captured_at t,
        case when name ~ '_total$' then
          greatest(0, (value - lag(value) over w) / nullif(extract(epoch from (captured_at - lag(captured_at) over w)), 0))
        else value end v
      from whatsapp.metric_samples
      where source='prom' and name = any(p_names)
        and captured_at > now() - make_interval(mins => greatest(1, least(p_minutes, 10080)))
      window w as (partition by name, labels order by captured_at)
    ) x
    where v is not null
  );
end $function$;
REVOKE ALL ON FUNCTION whatsapp.monitor_prom_series(text[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.monitor_prom_series(text[], integer) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.monitor_prom_series(text[], integer) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.monitor_r2(p_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb; v_h int := least(greatest(coalesce(p_hours,24),1),720);
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
  select jsonb_build_object(
    'latest', (select coalesce(jsonb_agg(x order by x->>'bucket'),'[]'::jsonb) from (
        select distinct on (bucket) to_jsonb(m) as x from whatsapp.r2_metrics m order by bucket, sampled_at desc) y),
    'series', (select coalesce(jsonb_agg(jsonb_build_object(
        't',sampled_at,'bucket',bucket,'storage',storage_bytes,'objects',object_count,
        'class_a',class_a_ops,'class_b',class_b_ops) order by sampled_at),'[]'::jsonb)
      from whatsapp.r2_metrics where sampled_at > now() - make_interval(hours => v_h) and sample_ok),
    'app_derived', (select jsonb_build_object(
        'media_objects', count(*) filter (where media_storage_key is not null),
        'media_bytes', coalesce(sum(media_size_bytes) filter (where media_storage_key is not null),0))
      from whatsapp.messages),
    'free_caps', jsonb_build_object('storage_bytes', 10737418240::bigint, 'class_a_month', 1000000, 'class_b_month', 10000000)
  ) into r;
  return r;
end $function$;
REVOKE ALL ON FUNCTION whatsapp.monitor_r2(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.monitor_r2(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.monitor_r2(integer) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.set_instance_settings(p_instance_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_current_mode     text;
  v_effective_mode   text;
  v_row              record;
  v_locked_cols      text[] := ARRAY[
    'pacing_floor_ms','pacing_jitter_median_ms','pacing_jitter_spread',
    'pacing_per_conv_floor_ms','pacing_read_to_reply_min_ms',
    'daily_send_cap','hourly_send_cap','minute_burst_cap','send_rate_per_min'
  ];
  v_attempted_locked text[];
  v_is_preset        boolean;
  v_rate   int;
  v_burst  int;
  v_hourly int;
  v_daily  int;
BEGIN
  IF NOT whatsapp.is_wa_admin(p_instance_id) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'invalid_patch' USING ERRCODE = '22023';
  END IF;

  SELECT pacing_mode INTO v_current_mode FROM whatsapp.whatsapp_instances WHERE id = p_instance_id;
  IF v_current_mode IS NULL THEN
    RAISE EXCEPTION 'instance_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_effective_mode := COALESCE(p_patch->>'pacing_mode', v_current_mode);
  IF v_effective_mode NOT IN ('conservative','balanced','aggressive','custom') THEN
    RAISE EXCEPTION 'invalid_pacing_mode: %', v_effective_mode USING ERRCODE = '22023';
  END IF;
  v_is_preset := v_effective_mode <> 'custom';

  IF v_is_preset THEN
    SELECT array_agg(k) INTO v_attempted_locked
      FROM jsonb_object_keys(p_patch) AS k
     WHERE k = ANY(v_locked_cols);
    IF v_attempted_locked IS NOT NULL AND array_length(v_attempted_locked, 1) > 0 THEN
      RAISE EXCEPTION
        'pacing_mode_locked: cannot modify columns % while pacing_mode=%. Set pacing_mode=custom first.',
        v_attempted_locked, v_effective_mode
        USING ERRCODE = '22023';
    END IF;
    CASE v_effective_mode
      WHEN 'conservative' THEN v_rate := 6;  v_burst := 4; v_hourly := 100; v_daily := 400;
      WHEN 'aggressive'   THEN v_rate := 15; v_burst := 5; v_hourly := 400; v_daily := 2000;
      ELSE                     v_rate := 10; v_burst := 5; v_hourly := 250; v_daily := 1500;
    END CASE;
  END IF;

  UPDATE whatsapp.whatsapp_instances SET
    pacing_mode                 = v_effective_mode,
    manual_presence             = COALESCE(p_patch->>'manual_presence', manual_presence),
    worker_paused               = COALESCE((p_patch->>'worker_paused')::bool, worker_paused),
    lifecycle_state             = COALESCE((p_patch->>'lifecycle_state')::whatsapp.instance_lifecycle_state, lifecycle_state),
    pacing_floor_ms             = CASE WHEN p_patch ? 'pacing_floor_ms' THEN NULLIF(p_patch->>'pacing_floor_ms','')::int ELSE pacing_floor_ms END,
    pacing_jitter_median_ms     = CASE WHEN p_patch ? 'pacing_jitter_median_ms' THEN NULLIF(p_patch->>'pacing_jitter_median_ms','')::int ELSE pacing_jitter_median_ms END,
    pacing_jitter_spread        = CASE WHEN p_patch ? 'pacing_jitter_spread' THEN NULLIF(p_patch->>'pacing_jitter_spread','')::numeric ELSE pacing_jitter_spread END,
    pacing_per_conv_floor_ms    = CASE WHEN p_patch ? 'pacing_per_conv_floor_ms' THEN NULLIF(p_patch->>'pacing_per_conv_floor_ms','')::int ELSE pacing_per_conv_floor_ms END,
    pacing_read_to_reply_min_ms = CASE WHEN p_patch ? 'pacing_read_to_reply_min_ms' THEN NULLIF(p_patch->>'pacing_read_to_reply_min_ms','')::int ELSE pacing_read_to_reply_min_ms END,
    send_rate_per_min           = CASE WHEN v_is_preset THEN v_rate   ELSE COALESCE((p_patch->>'send_rate_per_min')::int, send_rate_per_min) END,
    minute_burst_cap            = CASE WHEN v_is_preset THEN v_burst  ELSE COALESCE((p_patch->>'minute_burst_cap')::int, minute_burst_cap) END,
    hourly_send_cap             = CASE WHEN v_is_preset THEN v_hourly ELSE COALESCE((p_patch->>'hourly_send_cap')::int, hourly_send_cap) END,
    daily_send_cap              = CASE WHEN v_is_preset THEN v_daily  ELSE COALESCE((p_patch->>'daily_send_cap')::int, daily_send_cap) END,
    typing_base_ms              = COALESCE((p_patch->>'typing_base_ms')::int, typing_base_ms),
    typing_per_char_ms          = COALESCE((p_patch->>'typing_per_char_ms')::int, typing_per_char_ms),
    typing_cap_ms               = COALESCE((p_patch->>'typing_cap_ms')::int, typing_cap_ms),
    typing_enabled              = COALESCE((p_patch->>'typing_enabled')::bool, typing_enabled),
    read_receipts_mode          = COALESCE(p_patch->>'read_receipts_mode', read_receipts_mode),
    business_hours              = COALESCE(p_patch->'business_hours', business_hours),
    business_hours_enabled      = COALESCE((p_patch->>'business_hours_enabled')::bool, business_hours_enabled),
    quiet_hours_override_until  = CASE WHEN p_patch ? 'quiet_hours_override_until' THEN NULLIF(p_patch->>'quiet_hours_override_until','')::timestamptz ELSE quiet_hours_override_until END,
    wa_reject_calls             = COALESCE((p_patch->>'wa_reject_calls')::bool, wa_reject_calls),
    wa_call_reply_text          = CASE WHEN p_patch ? 'wa_call_reply_text' THEN NULLIF(p_patch->>'wa_call_reply_text','') ELSE wa_call_reply_text END,
    wa_always_online            = COALESCE((p_patch->>'wa_always_online')::bool, wa_always_online),
    wa_auto_read_inbound        = COALESCE((p_patch->>'wa_auto_read_inbound')::bool, wa_auto_read_inbound),
    wa_read_status              = COALESCE((p_patch->>'wa_read_status')::bool, wa_read_status),
    wa_ignore_groups            = COALESCE((p_patch->>'wa_ignore_groups')::bool, wa_ignore_groups),
    wa_sync_full_history        = COALESCE((p_patch->>'wa_sync_full_history')::bool, wa_sync_full_history),
    wa_profile_status           = CASE WHEN p_patch ? 'wa_profile_status' THEN NULLIF(p_patch->>'wa_profile_status','') ELSE wa_profile_status END,
    auto_reconnect              = COALESCE((p_patch->>'auto_reconnect')::bool, auto_reconnect),
    updated_at = now()
  WHERE id = p_instance_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'instance_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN to_jsonb(v_row) - 'evolution_api_token_ct' - 'webhook_secret_ct';
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.set_instance_settings(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.set_instance_settings(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.set_instance_settings(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.stats_breakdowns(p_from timestamp with time zone, p_to timestamp with time zone, p_instance uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not ((p_instance is not null and whatsapp.is_wa_admin(p_instance)) or (p_instance is null and public.is_owner())) then raise exception 'forbidden' using errcode='42501'; end if;
  return whatsapp.stats_breakdowns_impl(p_from, p_to, p_instance);
end $function$;
REVOKE ALL ON FUNCTION whatsapp.stats_breakdowns(timestamp with time zone, timestamp with time zone, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.stats_breakdowns(timestamp with time zone, timestamp with time zone, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.stats_breakdowns(timestamp with time zone, timestamp with time zone, uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.stats_breakdowns_impl(p_from timestamp with time zone, p_to timestamp with time zone, p_instance uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb;
begin
  select jsonb_build_object(
    'kind', (select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'direction',direction,'count',c)),'[]') from (
       select kind::text, direction::text, count(*) c from whatsapp.messages where kind<>'system' and whatsapp_timestamp between p_from and p_to and (p_instance is null or instance_id=p_instance) group by 1,2) x),
    'funnel', (select coalesce(jsonb_object_agg(stage,c),'{}') from (
       select case when delivery_status in ('READ','PLAYED') then 'read' when delivery_status='DELIVERY_ACK' then 'delivered' when delivery_status='SERVER_ACK' then 'sent' else 'pending' end stage, count(*) c
       from whatsapp.messages where direction='outbound' and kind<>'system' and whatsapp_timestamp between p_from and p_to and (p_instance is null or instance_id=p_instance) group by 1) x),
    'queue_status', (select coalesce(jsonb_object_agg(status,c),'{}') from (
       select status::text, count(*) c from whatsapp.outbound_queue where enqueued_at between p_from and p_to and (p_instance is null or number_id=p_instance) group by 1) x),
    'origin', (select coalesce(jsonb_object_agg(origin,c),'{}') from (
       select origin::text, count(*) c from whatsapp.outbound_queue where enqueued_at between p_from and p_to and (p_instance is null or number_id=p_instance) group by 1) x),
    'dm_group', (select jsonb_build_object('dm',count(*) filter (where not is_group),'group',count(*) filter (where is_group))
       from whatsapp.conversations where (p_instance is null or instance_id=p_instance) and last_message_at between p_from and p_to)
  ) into r;
  return r;
end $function$;
REVOKE ALL ON FUNCTION whatsapp.stats_breakdowns_impl(timestamp with time zone, timestamp with time zone, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.stats_breakdowns_impl(timestamp with time zone, timestamp with time zone, uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.stats_by_agent(p_from timestamp with time zone, p_to timestamp with time zone, p_instance uuid DEFAULT NULL::uuid)
 RETURNS TABLE(agent_uid uuid, label text, avatar jsonb, sent bigint, delivered bigint, read_cnt bigint, convos bigint, reply_p50_sec numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not ((p_instance is not null and whatsapp.is_wa_admin(p_instance)) or (p_instance is null and public.is_owner())) then raise exception 'forbidden' using errcode='42501'; end if;
  return query select * from whatsapp.stats_by_agent_impl(p_from, p_to, p_instance);
end $function$;
revoke all on function whatsapp.stats_by_agent(timestamp with time zone, timestamp with time zone, uuid) from public;
grant execute on function whatsapp.stats_by_agent(timestamp with time zone, timestamp with time zone, uuid) to authenticated;
grant execute on function whatsapp.stats_by_agent(timestamp with time zone, timestamp with time zone, uuid) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.stats_by_agent_impl(p_from timestamp with time zone, p_to timestamp with time zone, p_instance uuid DEFAULT NULL::uuid)
 RETURNS TABLE(agent_uid uuid, label text, avatar jsonb, sent bigint, delivered bigint, read_cnt bigint, convos bigint, reply_p50_sec numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return query
  with sends as (
    select m.sent_by_agent_id as agent,
           count(*) as sent,
           count(*) filter (where m.delivery_status in ('DELIVERY_ACK','READ','PLAYED')) as delivered,
           count(*) filter (where m.delivery_status in ('READ','PLAYED')) as read_cnt,
           count(distinct m.conversation_id) as convos
    from whatsapp.messages m
    where m.direction='outbound' and m.sent_by_agent_id is not null and m.kind<>'system'
      and m.whatsapp_timestamp between p_from and p_to and (p_instance is null or m.instance_id=p_instance)
    group by m.sent_by_agent_id
  ),
  replies as (
    select x.agent, percentile_cont(0.5) within group (order by x.gap) as p50
    from (
      select resp.sent_by_agent_id as agent,
             extract(epoch from (resp.whatsapp_timestamp - i.whatsapp_timestamp)) as gap
      from whatsapp.messages i
      cross join lateral (
        select o.sent_by_agent_id, o.whatsapp_timestamp
        from whatsapp.messages o
        where o.conversation_id = i.conversation_id and o.direction='outbound' and o.kind<>'system'
          and o.whatsapp_timestamp > i.whatsapp_timestamp
        order by o.whatsapp_timestamp asc
        limit 1
      ) resp
      where i.direction='inbound' and i.kind<>'system'
        and i.whatsapp_timestamp between p_from and p_to
        and (p_instance is null or i.instance_id=p_instance)
        and resp.sent_by_agent_id is not null
    ) x
    group by x.agent
  )
  select s.agent,
         coalesce(pr.name, pr.email::text, left(s.agent::text,8)),
         pr.avatar_config,
         s.sent, s.delivered, s.read_cnt, s.convos, r.p50::numeric
  from sends s
  left join public.users pr on pr.id = s.agent
  left join replies r on r.agent = s.agent
  order by s.sent desc, s.agent;
end $function$;

REVOKE ALL ON FUNCTION whatsapp.stats_by_agent_impl(timestamp with time zone, timestamp with time zone, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.stats_by_agent_impl(timestamp with time zone, timestamp with time zone, uuid) TO service_role;
REVOKE ALL ON FUNCTION whatsapp.stats_by_agent_impl(timestamp with time zone, timestamp with time zone, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.stats_by_agent_impl(timestamp with time zone, timestamp with time zone, uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.stats_fleet()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
  return whatsapp.stats_fleet_impl();
end $function$;
REVOKE ALL ON FUNCTION whatsapp.stats_fleet() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.stats_fleet() TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.stats_fleet() TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.stats_fleet_impl()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb;
begin
  select jsonb_build_object(
    'numbers', (select coalesce(jsonb_agg(jsonb_build_object(
        'id',i.id,'name',i.display_name,'status',i.status,'lifecycle',i.lifecycle_state,
        'paused',i.worker_paused,'last_seen_at',i.last_seen_at,'paired_at',i.paired_at) order by i.display_name),'[]')
      from whatsapp.whatsapp_instances i),
    'worker', (select jsonb_build_object('health',health,'queue_depth',queue_depth,'drain_rate_1m',drain_rate_1m,
        'dispatching_count',dispatching_count,'last_heartbeat_at',last_heartbeat_at)
      from whatsapp.worker_health_status order by last_heartbeat_at desc limit 1)
  ) into r;
  return r;
end $function$;
REVOKE ALL ON FUNCTION whatsapp.stats_fleet_impl() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.stats_fleet_impl() TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.stats_heatmap(p_from timestamp with time zone, p_to timestamp with time zone, p_instance uuid DEFAULT NULL::uuid)
 RETURNS TABLE(dow integer, hour integer, inbound bigint, outbound bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not ((p_instance is not null and whatsapp.is_wa_admin(p_instance)) or (p_instance is null and public.is_owner())) then raise exception 'forbidden' using errcode='42501'; end if;
  return query select * from whatsapp.stats_heatmap_impl(p_from, p_to, p_instance);
end $function$;
revoke all on function whatsapp.stats_heatmap(timestamp with time zone, timestamp with time zone, uuid) from public;
grant execute on function whatsapp.stats_heatmap(timestamp with time zone, timestamp with time zone, uuid) to authenticated;
grant execute on function whatsapp.stats_heatmap(timestamp with time zone, timestamp with time zone, uuid) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.stats_heatmap_impl(p_from timestamp with time zone, p_to timestamp with time zone, p_instance uuid DEFAULT NULL::uuid)
 RETURNS TABLE(dow integer, hour integer, inbound bigint, outbound bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return query
  select extract(dow from m.whatsapp_timestamp at time zone 'Africa/Casablanca')::int,
         extract(hour from m.whatsapp_timestamp at time zone 'Africa/Casablanca')::int,
         count(*) filter (where m.direction='inbound'),
         count(*) filter (where m.direction='outbound')
  from whatsapp.messages m
  where m.kind<>'system' and m.direction in ('inbound','outbound') and m.whatsapp_timestamp between p_from and p_to and (p_instance is null or m.instance_id=p_instance)
  group by 1,2;
end $function$;
REVOKE ALL ON FUNCTION whatsapp.stats_heatmap_impl(timestamp with time zone, timestamp with time zone, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.stats_heatmap_impl(timestamp with time zone, timestamp with time zone, uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.stats_latency_series(p_from timestamp with time zone, p_to timestamp with time zone, p_bucket text DEFAULT 'day'::text, p_instance uuid DEFAULT NULL::uuid)
 RETURNS TABLE(bucket timestamp with time zone, wait_p50 double precision, wait_p95 double precision, e2e_p50 double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_b text := case when p_bucket in ('hour','day','week') then p_bucket else 'day' end;
  v_from timestamptz := whatsapp.cache_quantize(p_from, v_b);
  v_to timestamptz := whatsapp.cache_quantize(p_to, v_b)
    + case v_b when 'hour' then interval '1 hour' when 'week' then interval '1 week' else interval '1 day' end;
  v_key text; v_arr jsonb;
begin
  if not ((p_instance is not null and whatsapp.is_wa_admin(p_instance)) or (p_instance is null and public.is_owner())) then raise exception 'forbidden' using errcode='42501'; end if;
  v_key := format('stats_latency_series:v1:%s:%s:%s:%s', v_b, extract(epoch from v_from)::bigint,
    extract(epoch from v_to)::bigint, coalesce(p_instance::text,'*'));
  v_arr := whatsapp.cache_get_or_compute(v_key, interval '60 seconds', interval '300 seconds',
    'whatsapp._compute_stats_latency_series(jsonb)'::regprocedure,
    jsonb_build_object('from',v_from,'to',v_to,'bucket',v_b,'instance',p_instance));
  return query select (e->>'bucket')::timestamptz,(e->>'wait_p50')::double precision,
    (e->>'wait_p95')::double precision,(e->>'e2e_p50')::double precision
    from jsonb_array_elements(v_arr) e;
end $function$;
REVOKE ALL ON FUNCTION whatsapp.stats_latency_series(timestamp with time zone, timestamp with time zone, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.stats_latency_series(timestamp with time zone, timestamp with time zone, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.stats_latency_series(timestamp with time zone, timestamp with time zone, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.stats_latency_series_impl(p_from timestamp with time zone, p_to timestamp with time zone, p_bucket text DEFAULT 'day'::text, p_instance uuid DEFAULT NULL::uuid)
 RETURNS TABLE(bucket timestamp with time zone, wait_p50 double precision, wait_p95 double precision, e2e_p50 double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_b text := case when p_bucket in ('hour','day','week') then p_bucket else 'day' end;
begin
  return query
  select (date_trunc(v_b, q.enqueued_at at time zone 'Africa/Casablanca') at time zone 'Africa/Casablanca') bkt,
    percentile_cont(0.5) within group (order by extract(epoch from q.dispatched_at-q.enqueued_at)),
    percentile_cont(0.95) within group (order by extract(epoch from q.dispatched_at-q.enqueued_at)),
    percentile_cont(0.5) within group (order by extract(epoch from q.completed_at-q.enqueued_at))
  from whatsapp.outbound_queue q
  where q.dispatched_at is not null and q.enqueued_at between p_from and p_to and (p_instance is null or q.number_id=p_instance)
  group by bkt order by bkt;
end $function$;
REVOKE ALL ON FUNCTION whatsapp.stats_latency_series_impl(timestamp with time zone, timestamp with time zone, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.stats_latency_series_impl(timestamp with time zone, timestamp with time zone, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.stats_message_series(p_from timestamp with time zone, p_to timestamp with time zone, p_bucket text DEFAULT 'day'::text, p_instance uuid DEFAULT NULL::uuid)
 RETURNS TABLE(bucket timestamp with time zone, inbound bigint, outbound bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not ((p_instance is not null and whatsapp.is_wa_admin(p_instance)) or (p_instance is null and public.is_owner())) then raise exception 'forbidden' using errcode='42501'; end if;
  return query select * from whatsapp.stats_message_series_impl(p_from, p_to, p_bucket, p_instance);
end $function$;
REVOKE ALL ON FUNCTION whatsapp.stats_message_series(timestamp with time zone, timestamp with time zone, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.stats_message_series(timestamp with time zone, timestamp with time zone, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.stats_message_series(timestamp with time zone, timestamp with time zone, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.stats_message_series_impl(p_from timestamp with time zone, p_to timestamp with time zone, p_bucket text DEFAULT 'day'::text, p_instance uuid DEFAULT NULL::uuid)
 RETURNS TABLE(bucket timestamp with time zone, inbound bigint, outbound bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_b text := case when p_bucket in ('hour','day','week') then p_bucket else 'day' end;
begin
  return query
  select (date_trunc(v_b, m.whatsapp_timestamp at time zone 'Africa/Casablanca') at time zone 'Africa/Casablanca') as bkt,
         count(*) filter (where m.direction='inbound'),
         count(*) filter (where m.direction='outbound')
  from whatsapp.messages m
  where m.kind<>'system' and m.whatsapp_timestamp between p_from and p_to and (p_instance is null or m.instance_id=p_instance)
  group by bkt order by bkt;
end $function$;
revoke all on function whatsapp.stats_message_series_impl(timestamp with time zone, timestamp with time zone, text, uuid) from public;
grant execute on function whatsapp.stats_message_series_impl(timestamp with time zone, timestamp with time zone, text, uuid) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.stats_overview(p_from timestamp with time zone, p_to timestamp with time zone, p_instance uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not ((p_instance is not null and whatsapp.is_wa_admin(p_instance)) or (p_instance is null and public.is_owner())) then raise exception 'forbidden' using errcode='42501'; end if;
  return whatsapp.stats_overview_impl(p_from, p_to, p_instance);
end $function$;
REVOKE ALL ON FUNCTION whatsapp.stats_overview(timestamp with time zone, timestamp with time zone, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.stats_overview(timestamp with time zone, timestamp with time zone, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.stats_overview(timestamp with time zone, timestamp with time zone, uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.stats_overview_impl(p_from timestamp with time zone, p_to timestamp with time zone, p_instance uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_pf timestamptz := p_from - (p_to - p_from); r jsonb;
begin
  select jsonb_build_object(
    'fleet_connected', (select count(*) from whatsapp.whatsapp_instances where status='connected' and (p_instance is null or id=p_instance)),
    'fleet_total',     (select count(*) from whatsapp.whatsapp_instances where (p_instance is null or id=p_instance)),
    'inbound',      (select count(*) from whatsapp.messages where direction='inbound'  and kind<>'system' and whatsapp_timestamp between p_from and p_to and (p_instance is null or instance_id=p_instance)),
    'inbound_prev', (select count(*) from whatsapp.messages where direction='inbound'  and kind<>'system' and whatsapp_timestamp between v_pf and p_from and (p_instance is null or instance_id=p_instance)),
    'outbound',      (select count(*) from whatsapp.messages where direction='outbound' and kind<>'system' and whatsapp_timestamp between p_from and p_to and (p_instance is null or instance_id=p_instance)),
    'outbound_prev', (select count(*) from whatsapp.messages where direction='outbound' and kind<>'system' and whatsapp_timestamp between v_pf and p_from and (p_instance is null or instance_id=p_instance)),
    'delivered', (select count(*) from whatsapp.messages where direction='outbound' and kind<>'system' and delivery_status in ('DELIVERY_ACK','READ','PLAYED') and whatsapp_timestamp between p_from and p_to and (p_instance is null or instance_id=p_instance)),
    'read',      (select count(*) from whatsapp.messages where direction='outbound' and kind<>'system' and delivery_status in ('READ','PLAYED') and whatsapp_timestamp between p_from and p_to and (p_instance is null or instance_id=p_instance)),
    'send_total',(select count(*) from whatsapp.outbound_queue where action_type in ('send_text','send_media','send_poll','send_contact') and enqueued_at between p_from and p_to and (p_instance is null or number_id=p_instance)),
    'send_failed',(select count(*) from whatsapp.outbound_queue where action_type in ('send_text','send_media','send_poll','send_contact') and status in ('failed','dead') and enqueued_at between p_from and p_to and (p_instance is null or number_id=p_instance)),
    'send_total_prev',(select count(*) from whatsapp.outbound_queue where action_type in ('send_text','send_media','send_poll','send_contact') and enqueued_at between v_pf and p_from and (p_instance is null or number_id=p_instance)),
    'send_failed_prev',(select count(*) from whatsapp.outbound_queue where action_type in ('send_text','send_media','send_poll','send_contact') and status in ('failed','dead') and enqueued_at between v_pf and p_from and (p_instance is null or number_id=p_instance)),
    'active_convos', (select count(distinct conversation_id) from whatsapp.messages where kind<>'system' and whatsapp_timestamp between p_from and p_to and (p_instance is null or instance_id=p_instance)),
    'unread_total', (select coalesce(sum(unread_count),0) from whatsapp.conversations where (p_instance is null or instance_id=p_instance)),
    'awaiting_reply',(select count(*) from whatsapp.conversations where last_inbound_at is not null and (last_outbound_at is null or last_inbound_at>last_outbound_at) and (p_instance is null or instance_id=p_instance)),
    'reply_p50_sec', (select percentile_cont(0.5) within group (order by g) from (
        select extract(epoch from (select min(o.whatsapp_timestamp) from whatsapp.messages o where o.conversation_id=i.conversation_id and o.direction='outbound' and o.whatsapp_timestamp>i.whatsapp_timestamp) - i.whatsapp_timestamp) g
        from whatsapp.messages i where i.direction='inbound' and i.kind<>'system' and i.whatsapp_timestamp between p_from and p_to and (p_instance is null or i.instance_id=p_instance)) s where g is not null),
    'reply_p90_sec', (select percentile_cont(0.9) within group (order by g) from (
        select extract(epoch from (select min(o.whatsapp_timestamp) from whatsapp.messages o where o.conversation_id=i.conversation_id and o.direction='outbound' and o.whatsapp_timestamp>i.whatsapp_timestamp) - i.whatsapp_timestamp) g
        from whatsapp.messages i where i.direction='inbound' and i.kind<>'system' and i.whatsapp_timestamp between p_from and p_to and (p_instance is null or i.instance_id=p_instance)) s where g is not null)
  ) into r;
  return r;
end $function$;
revoke all on function whatsapp.stats_overview_impl(timestamp with time zone, timestamp with time zone, uuid) from public;
grant execute on function whatsapp.stats_overview_impl(timestamp with time zone, timestamp with time zone, uuid) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.stats_service(p_from timestamp with time zone, p_to timestamp with time zone, p_instance uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb;
begin
  if not ((p_instance is not null and whatsapp.is_wa_admin(p_instance)) or (p_instance is null and public.is_owner())) then raise exception 'forbidden' using errcode='42501'; end if;
  select jsonb_build_object(
    'total',      count(*),
    'answered',   count(*) filter (where gap is not null),
    'within_5m',  count(*) filter (where gap is not null and gap <= 300),
    'within_30m', count(*) filter (where gap > 300 and gap <= 1800),
    'within_2h',  count(*) filter (where gap > 1800 and gap <= 7200),
    'slower',     count(*) filter (where gap > 7200),
    'pending',    count(*) filter (where gap is null),
    'p50_sec',    percentile_cont(0.5) within group (order by gap) filter (where gap is not null)
  ) into r
  from (
    select extract(epoch from (
             (select min(o.whatsapp_timestamp) from whatsapp.messages o
                where o.conversation_id = i.conversation_id and o.direction='outbound' and o.kind<>'system'
                  and o.whatsapp_timestamp > i.whatsapp_timestamp)
             - i.whatsapp_timestamp)) as gap
    from whatsapp.messages i
    where i.direction='inbound' and i.kind<>'system'
      and i.whatsapp_timestamp between p_from and p_to
      and (p_instance is null or i.instance_id=p_instance)
  ) g;
  return coalesce(r, '{}'::jsonb);
end $function$;
revoke all on function whatsapp.stats_service(timestamp with time zone, timestamp with time zone, uuid) from public;
grant execute on function whatsapp.stats_service(timestamp with time zone, timestamp with time zone, uuid) to authenticated;
grant execute on function whatsapp.stats_service(timestamp with time zone, timestamp with time zone, uuid) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.stats_worker_series(p_from timestamp with time zone, p_to timestamp with time zone, p_bucket text DEFAULT 'hour'::text)
 RETURNS TABLE(bucket timestamp with time zone, queue_depth double precision, drain_rate double precision, dispatching double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_b text := case when p_bucket in ('hour','day','week') then p_bucket else 'hour' end;
  v_from timestamptz := whatsapp.cache_quantize(p_from, v_b);
  v_to timestamptz := whatsapp.cache_quantize(p_to, v_b)
    + case v_b when 'hour' then interval '1 hour' when 'week' then interval '1 week' else interval '1 day' end;
  v_key text; v_arr jsonb;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
  v_key := format('stats_worker_series:v1:%s:%s:%s', v_b, extract(epoch from v_from)::bigint,
    extract(epoch from v_to)::bigint);
  v_arr := whatsapp.cache_get_or_compute(v_key, interval '60 seconds', interval '300 seconds',
    'whatsapp._compute_stats_worker_series(jsonb)'::regprocedure,
    jsonb_build_object('from',v_from,'to',v_to,'bucket',v_b));
  return query select (e->>'bucket')::timestamptz,(e->>'queue_depth')::double precision,
    (e->>'drain_rate')::double precision,(e->>'dispatching')::double precision
    from jsonb_array_elements(v_arr) e;
end $function$;
revoke all on function whatsapp.stats_worker_series(timestamp with time zone, timestamp with time zone, text) from public;
grant execute on function whatsapp.stats_worker_series(timestamp with time zone, timestamp with time zone, text) to authenticated;
grant execute on function whatsapp.stats_worker_series(timestamp with time zone, timestamp with time zone, text) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.stats_worker_series_impl(p_from timestamp with time zone, p_to timestamp with time zone, p_bucket text DEFAULT 'hour'::text)
 RETURNS TABLE(bucket timestamp with time zone, queue_depth double precision, drain_rate double precision, dispatching double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_b text := case when p_bucket in ('hour','day','week') then p_bucket else 'hour' end;
begin
  return query
  select (date_trunc(v_b, h.captured_at at time zone 'Africa/Casablanca') at time zone 'Africa/Casablanca') bkt,
         avg(h.queue_depth)::double precision, avg(h.drain_rate_1m)::double precision, avg(h.dispatching_count)::double precision
  from whatsapp.worker_health_history h
  where h.captured_at between p_from and p_to
  group by bkt order by bkt;
end $function$;
REVOKE ALL ON FUNCTION whatsapp.stats_worker_series_impl(timestamp with time zone, timestamp with time zone, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.stats_worker_series_impl(timestamp with time zone, timestamp with time zone, text) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.update_recent_tag_colors(p_instance_id uuid, p_colors jsonb)
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
  UPDATE whatsapp.whatsapp_instances SET recent_tag_colors = p_colors WHERE id = p_instance_id;
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.update_recent_tag_colors(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.update_recent_tag_colors(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.update_recent_tag_colors(uuid, jsonb) TO service_role;

-- ---- cache-compute shims referenced by the wrappers via cache_get_or_compute (regprocedure); port 1:1 ----
create or replace function whatsapp._compute_dashboard_activity(p_args jsonb)
returns jsonb language sql security definer set search_path to '' as $function$ select whatsapp.dashboard_activity_impl() $function$;
create or replace function whatsapp._compute_instance_stats(p_args jsonb)
returns jsonb language sql security definer set search_path to '' as $function$ select whatsapp.instance_stats_impl((p_args->>'instance_id')::uuid) $function$;
create or replace function whatsapp._compute_stats_latency_series(p_args jsonb)
returns jsonb language sql security definer set search_path to '' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('bucket',t.bucket,'wait_p50',t.wait_p50,'wait_p95',t.wait_p95,'e2e_p50',t.e2e_p50) order by t.bucket),'[]'::jsonb)
  from whatsapp.stats_latency_series_impl((p_args->>'from')::timestamptz,(p_args->>'to')::timestamptz, coalesce(p_args->>'bucket','day'), nullif(p_args->>'instance','')::uuid) t;
$function$;
create or replace function whatsapp._compute_stats_worker_series(p_args jsonb)
returns jsonb language sql security definer set search_path to '' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('bucket',t.bucket,'queue_depth',t.queue_depth,'drain_rate',t.drain_rate,'dispatching',t.dispatching) order by t.bucket),'[]'::jsonb)
  from whatsapp.stats_worker_series_impl((p_args->>'from')::timestamptz,(p_args->>'to')::timestamptz, coalesce(p_args->>'bucket','hour')) t;
$function$;
revoke all on function whatsapp._compute_dashboard_activity(jsonb) from public;
revoke all on function whatsapp._compute_instance_stats(jsonb) from public;
revoke all on function whatsapp._compute_stats_latency_series(jsonb) from public;
revoke all on function whatsapp._compute_stats_worker_series(jsonb) from public;
