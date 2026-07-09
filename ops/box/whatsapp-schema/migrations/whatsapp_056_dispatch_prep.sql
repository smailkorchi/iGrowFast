-- whatsapp_056_dispatch_prep.sql
-- Enterprise-scale plan PHASE 3b (W3). Folds the worker's per-send DB round-trips
-- from 6 → 2. The dispatch loop did, per message: dispatch_gate_check → queue_claim_next
-- → number_pacing_state read → messages_decrypted deref → pacing_take_token, then the
-- Evolution API call, then queue_mark_sent. This RPC composes the FIRST FIVE into ONE
-- atomic call; the worker then does its pure-JS pacing math (crossContactGap / canned
-- burst — no DB), the Evolution call, and the single queue_mark_sent. Net: 6→2.
--
-- FAITHFUL composition of the SAME proven functions (dispatch_gate_check,
-- queue_claim_next, pacing_take_token) + the SAME inline pacing-ctx + messages_decrypted
-- deref, with the worker's EXACT action-type predicates:
--   content/token  = send_text/media/poll/react/edit_message/delete_message/send_contact
--                    (isSendType; identical to dispatch_gate_check's content array)
--   message-backed = send_text/media/poll/send_contact (isMessageBackedAction — deref)
--   sameContact    = content && last_send_conversation_id = this conversation (bypass token)
-- Being ONE transaction is strictly safer than the previous 5 separate txns (atomic
-- gate+claim+token); crash-recovery is unchanged (a claimed-but-unsent row stays
-- 'dispatching' → _cron_reclaim_stale_dispatching).
--
-- Returns jsonb: {gate:{allowed,reason,resume_at}, claimed:<outbound_queue>|null,
--   pacing:{last_send_at,last_send_conversation_id,remote_jid}, message:<messages_decrypted>|null,
--   deref_miss:bool, token_wait_ms:int}. claimed=null → nothing to dispatch. deref_miss=true
--   with a claimed row → the worker markDead's it (message vanished).
--
-- ADDITIVE: nothing calls this until the worker is rewritten (next). The 5 legacy
-- functions stay (also used by force_dispatch_now / crons / tests).
--
-- Reversible: drop function whatsapp.dispatch_prep(uuid,boolean,integer,integer).
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

create or replace function whatsapp.dispatch_prep(
  p_number_id uuid,
  p_window_open boolean,
  p_rate_per_min integer,
  p_burst_cap integer
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_allowed    boolean := true;
  v_reason     text;
  v_resume_at  timestamptz;
  v_row        whatsapp.outbound_queue;
  v_pacing     record;
  v_found      boolean := false;
  v_msg        jsonb;
  v_deref_miss boolean := false;
  v_token_wait integer := 0;
  v_msg_id     text;
  v_is_content boolean;
  v_same       boolean;
  c_content constant whatsapp.outbound_action_type[] := ARRAY[
    'send_text','send_media','send_poll','react','edit_message','delete_message','send_contact'
  ]::whatsapp.outbound_action_type[];
  c_backed  constant whatsapp.outbound_action_type[] := ARRAY[
    'send_text','send_media','send_poll','send_contact'
  ]::whatsapp.outbound_action_type[];
begin
  -- 1. Gate — only when the JS dispatch window is open; else content is gated off
  --    (the worker computes withinDispatchWindow from business-hours config, no DB).
  if p_window_open then
    select allowed, reason, resume_at into v_allowed, v_reason, v_resume_at
      from whatsapp.dispatch_gate_check(p_number_id);
  else
    v_allowed := false;
  end if;

  -- 2. Claim the next action (content gated → only passive rows eligible).
  select * into v_row from whatsapp.queue_claim_next(p_number_id, v_allowed);
  if v_row.id is null then
    return jsonb_build_object(
      'gate', jsonb_build_object('allowed', v_allowed, 'reason', v_reason, 'resume_at', v_resume_at),
      'claimed', null);
  end if;

  -- 3. Pacing + conversation context (remote_jid may also come from payload upstream).
  select p.last_send_at, p.last_send_conversation_id, c.remote_jid
    into v_pacing
    from whatsapp.number_pacing_state p
    left join whatsapp.conversations c on c.id = v_row.conversation_id
   where p.number_id = v_row.number_id;
  v_found := FOUND;
  if not v_found then
    -- number_pacing_state row missing (rare edge). The legacy path markFailed+retries
    -- here, BEFORE any deref/token. Signal it and return the claimed row so the worker
    -- markFailed's it; the row self-heals on the next attempt (pacing_take_token creates it).
    return jsonb_build_object(
      'gate', jsonb_build_object('allowed', v_allowed, 'reason', v_reason, 'resume_at', v_resume_at),
      'claimed', to_jsonb(v_row), 'pacing_missing', true);
  end if;

  -- 4. Dereference the messages row for message-backed sends (body length + status).
  if v_row.action_type = ANY(c_backed) then
    v_msg_id := v_row.payload->>'message_id';
    if v_msg_id is null then
      v_deref_miss := true;
    else
      select to_jsonb(m.*) into v_msg
        from whatsapp.messages_decrypted m where m.id = v_msg_id::uuid;
      if v_msg is null then v_deref_miss := true; end if;
    end if;
  end if;

  -- 5. Token bucket — content sends that switch contacts. sameContact (rapid-fire into
  --    ONE chat) bypasses the bucket, exactly as the loop did.
  v_is_content := (v_row.action_type = ANY(c_content));
  v_same := v_is_content
            and v_pacing.last_send_conversation_id is not null
            and v_pacing.last_send_conversation_id = v_row.conversation_id;
  if v_is_content and not v_same then
    v_token_wait := whatsapp.pacing_take_token(v_row.number_id, p_rate_per_min, p_burst_cap);
  end if;

  return jsonb_build_object(
    'gate',    jsonb_build_object('allowed', v_allowed, 'reason', v_reason, 'resume_at', v_resume_at),
    'claimed', to_jsonb(v_row),
    'pacing',  jsonb_build_object(
                 'last_send_at', v_pacing.last_send_at,
                 'last_send_conversation_id', v_pacing.last_send_conversation_id,
                 'remote_jid', v_pacing.remote_jid),
    'message', v_msg,
    'deref_miss', v_deref_miss,
    'token_wait_ms', v_token_wait);
end;
$function$;
alter function whatsapp.dispatch_prep(uuid,boolean,integer,integer) owner to postgres;

commit;
