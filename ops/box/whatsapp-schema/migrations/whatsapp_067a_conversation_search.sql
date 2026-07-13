-- whatsapp_067a_conversation_search  (Wave 67a) — robust, scalable inbox search (transactional part)
-- TARGET: LIVE box .102 self-host Postgres ONLY (ssh igf -> docker exec -i supabase-db psql -U postgres -d postgres).
--
-- PAIR: apply 067a (this, transactional) FIRST, then 067b (CONCURRENT indexes,
-- which MUST run outside any transaction — see that file's header).
--
-- WHY: the conversations-panel search was a CLIENT-side .includes() over only the
-- already-loaded pages (~first 50 rows). It could not find a not-yet-scrolled
-- contact, could not match a phone typed local/+CC/spaced against the stored
-- 212...@s.whatsapp.net JID, and never searched message history. The server-side
-- search_conversations RPC existed but was DEAD CODE (never called).
--
-- THREE search axes over ALL of an instance's conversations (RLS-equivalent
-- scope), fast + scalable, WITHOUT weakening the at-rest encryption of bodies:
--   1) NAME    — peer_display_name + contacts.book_name/push_name, case+accent
--                folded and index-backed (067b functional trgm GINs).
--   2) NUMBER  — query digits normalised (strip non-digits + one leading local
--                trunk 0) matched as a substring of the JID digits (remote_jid is
--                GIN-trgm indexed, wave 6). The JID *is* the number, so the
--                contacts phone columns add nothing and are not scanned.
--   3) KEYWORD — message-body search via a BLIND INDEX: per-message keyed-HMAC
--                word tokens (secret in Vault, kept OUT of backups like the
--                envelope key), GIN-indexed. Tokens are SALTED WITH instance_id,
--                so a token's posting list is naturally per-instance (a common
--                word never fans out across tenants). A stolen dump yields only
--                keyed hashes. Exact word match (case+accent folded); no
--                substring/fuzzy WITHIN a word.
--
-- QUERY SHAPE (perf): each axis is an independent SINGLE-TABLE, index-driven
-- subquery producing a conversation-id set; the sets are UNION ALL'd into `cand`
-- and the display row is built by ONE join over that small set. A single
-- cross-table OR would have defeated every GIN and seq-scanned the instance.
--
-- SECURITY: search_conversations is SECURITY DEFINER + MANUAL scope (v_admin :=
-- is_wa_admin(instance); final WHERE (v_admin OR EXISTS assigned)). The HMAC
-- helpers are NEVER granted to authenticated -> no client HMAC oracle. The
-- keyword candidate set is computed owner-side but the final scope filter still
-- gates visibility -> no cross-agent leak.
--   NEW Vault secret 'igf_whatsapp_search_hmac_key' MUST be kept OUT of backups
--   alongside 'igf_whatsapp_envelope_key' (docs/BACKUP_PREFLIGHT).
--
-- ROLLOUT: 1) apply 067a  2) apply 067b (concurrent indexes)  3) OFF-PEAK drain
--   via a SHELL loop so EACH batch COMMITS (releases FOR UPDATE locks, lets vacuum
--   run) — do NOT wrap in one DO/txn:
--     while :; do n=$(docker exec -i supabase-db psql -U postgres -d postgres -tAc \
--       "select whatsapp._backfill_body_search(2000)"); echo "backfilled $n"; \
--       [ "$n" = 0 ] && break; done
--   (decrypts each existing text message ONCE to tokenise; skip-locked, batched;
--    monotonic — a blank/undecryptable body is stored as an EMPTY tsvector so it
--    leaves the candidate set and the loop terminates.)
--   4) drop the transient backfill index (see 067b footer)  5) deploy frontend.
-- DRY-RUN: BEGIN; \i 067a ; ROLLBACK  -> catalog checks.

begin;

-- ============================================================ 1) blind-index Vault secret
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'igf_whatsapp_search_hmac_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'igf_whatsapp_search_hmac_key',
      'iGrowFast WhatsApp message-search blind-index HMAC key (keep OUT of backups)');
  end if;
end $$;

-- ============================================================ 2) normalise + crypto helpers
-- Granted to service_role ONLY: SECDEF callers run as owner and execute them
-- regardless, so authenticated is NEVER granted EXECUTE -> no client HMAC oracle.

-- Case + accent fold. IMMUTABLE (lower/translate) so it backs the 067b functional
-- trigram GINs. lower() runs first so only lowercase accented chars reach
-- translate; the from/to strings are 22 chars each (1:1 — an UNBALANCED translate
-- would DELETE accents instead of folding, so keep them equal length). Arabic
-- passes through unchanged.
create or replace function whatsapp._search_fold(p_text text)
returns text language sql immutable set search_path to '' as $function$
  select translate(
    lower(coalesce(p_text, '')),
    'àâäáçèéêëìîïíñòôöóùûüú',   -- 22 chars
    'aaaaceeeeiiiinoooouuuu'    -- 22 chars (à â ä á→a, ç→c, è é ê ë→e, ì î ï í→i, ñ→n, ò ô ö ó→o, ù û ü ú→u)
  );
$function$;

-- Read the blind-index HMAC key once (SECDEF; reads Vault). Kept as a tiny helper
-- so the key-fetch is one place; STABLE so a single query memoises it.
create or replace function whatsapp._search_key()
returns text language sql stable security definer set search_path to '' as $function$
  select decrypted_secret from vault.decrypted_secrets
   where name = 'igf_whatsapp_search_hmac_key' limit 1;
$function$;

-- Keyed, instance-SALTED HMAC of one token -> 16 hex (64-bit). Salting with the
-- instance means the same word in two instances yields different tokens, so a
-- token's GIN posting list stays per-instance (no cross-tenant fan-out). Used by
-- the RPC to hash the few query words; the per-message path (_search_tokens)
-- inlines the same formula with the key fetched once.
create or replace function whatsapp._search_hmac(p_instance_id uuid, p_token text)
returns text language sql stable security definer set search_path to '' as $function$
  -- hex -> letters a..p so the token is a PURE-ALPHABETIC 'asciiword': the text-
  -- search parser (used by to_tsvector/to_tsquery) must never split it. A hex
  -- token can look like a scientific float (e.g. '1e0695') and get lexed into
  -- pieces, silently breaking @@ matching. Letters are one indivisible lexeme.
  select translate(
    left(encode(extensions.hmac(p_instance_id::text || ':' || p_token,
                                whatsapp._search_key(), 'sha256'), 'hex'), 16),
    '0123456789abcdef', 'abcdefghijklmnop');
$function$;

-- Plaintext body -> tsvector of instance-salted HMAC'd, folded, distinct words
-- (len >= 2). Fetches the Vault key ONCE per call (not once per word). Returns an
-- EMPTY (non-null) tsvector for a null/blank/wordless body so the backfill
-- candidate set is monotonic (see _backfill). STABLE (reads Vault).
create or replace function whatsapp._search_tokens(p_instance_id uuid, p_body text)
returns tsvector language plpgsql stable security definer set search_path to '' as $function$
declare v tsvector;
begin
  if p_body is null or length(trim(p_body)) = 0 then
    return ''::tsvector;
  end if;
  -- Call _search_hmac per word (SINGLE source of the token formula — storage and
  -- query tokens can never drift). The per-word Vault read is immaterial at
  -- message scale (short, human-paced writes); revisit only if volume explodes.
  select to_tsvector('pg_catalog.simple',
           coalesce(string_agg(whatsapp._search_hmac(p_instance_id, w), ' '), ''))
    into v
  from (
    select distinct w
    from unnest(regexp_split_to_array(whatsapp._search_fold(p_body), '[^[:alnum:]]+')) as t(w)
    where length(w) >= 2
  ) d;
  return coalesce(v, ''::tsvector);
end
$function$;

revoke all on function whatsapp._search_fold(text)          from public;
revoke all on function whatsapp._search_key()               from public;
revoke all on function whatsapp._search_hmac(uuid, text)     from public;
revoke all on function whatsapp._search_tokens(uuid, text)   from public;
grant execute on function whatsapp._search_fold(text)        to service_role;
grant execute on function whatsapp._search_key()             to service_role;
grant execute on function whatsapp._search_hmac(uuid, text)   to service_role;
grant execute on function whatsapp._search_tokens(uuid, text) to service_role;

-- ============================================================ 3) blind-index column + trigger
-- NULLable column, no default -> metadata-only change (no rewrite). GIN built
-- CONCURRENTLY in 067b (avoids a write-blocking full-table scan).
alter table whatsapp.messages add column if not exists body_search tsvector;

-- Maintain body_search from the (decrypted) plaintext at write time. Fires on
-- INSERT and on any UPDATE of body_ciphertext (edits re-encrypt -> re-tokenise; a
-- revoke that nulls the body clears it). One short decrypt per message write;
-- writes are ban-safe paced / human-paced, so not a hot path. Exception-safe: an
-- undecryptable row is stored as an EMPTY tsvector, never aborting the write.
create or replace function whatsapp._messages_set_body_search()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  begin
    NEW.body_search := whatsapp._search_tokens(NEW.instance_id,
      whatsapp.decrypt_text(NEW.body_ciphertext, NEW.key_id));
  exception when others then
    NEW.body_search := ''::tsvector;
  end;
  return NEW;
end
$function$;
revoke all on function whatsapp._messages_set_body_search() from public;
grant execute on function whatsapp._messages_set_body_search() to service_role;

drop trigger if exists messages_set_body_search on whatsapp.messages;
create trigger messages_set_body_search
  before insert or update of body_ciphertext on whatsapp.messages
  for each row execute function whatsapp._messages_set_body_search();

-- ============================================================ 4) one-time backfill (drainable, O(n))
-- Processes ONE batch per call (returns the count touched); the operator loops it
-- from a SHELL so each call COMMITS (see header) — that releases the per-row FOR
-- UPDATE locks and lets vacuum keep up, instead of one unbounded transaction.
-- Uses the transient partial index (067b) on `body_search IS NULL AND
-- body_ciphertext IS NOT NULL` so each batch pulls the next N targets directly and
-- the candidate set SHRINKS (no O(n^2) prefix rescan). Monotonic + exception-safe:
-- every processed row gets a NON-null tsvector (empty for a blank/undecryptable
-- body), so it leaves the candidate set and the drain terminates. media-only rows
-- (ciphertext null) are excluded.
create or replace function whatsapp._backfill_body_search(p_batch integer default 2000)
returns integer language plpgsql security definer set search_path to '' as $function$
declare r record; v_count integer := 0; v_body text;
begin
  for r in
    select id, body_ciphertext, key_id, instance_id
    from whatsapp.messages
    where body_search is null and body_ciphertext is not null
    limit greatest(p_batch, 1)
    for update skip locked
  loop
    begin
      v_body := whatsapp.decrypt_text(r.body_ciphertext, r.key_id);
    exception when others then
      v_body := null;
    end;
    update whatsapp.messages m
       set body_search = whatsapp._search_tokens(r.instance_id, v_body)   -- never null (empty for blank)
     where m.id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$function$;
revoke all on function whatsapp._backfill_body_search(integer) from public;
grant execute on function whatsapp._backfill_body_search(integer) to service_role;

-- ============================================================ 5) the unified search RPC
-- SECURITY DEFINER + manual scope. Per-axis single-table id-set CTEs (each
-- index-driven) UNION ALL'd into `cand`, then ONE display join. Returns a
-- conversations_decrypted-compatible row + match_score + match_type.
drop function if exists whatsapp.search_conversations(uuid, text, integer);
create or replace function whatsapp.search_conversations(
  p_instance_id uuid,
  p_query       text,
  p_limit       integer default 20)
returns table(
  id                       uuid,
  instance_id              uuid,
  remote_jid               text,
  is_group                 boolean,
  peer_display_name        text,
  peer_profile_pic         text,
  contact_book_name        text,
  last_message_at          timestamptz,
  last_message_preview     text,
  last_message_kind        whatsapp.message_kind,
  last_message_direction   whatsapp.message_direction,
  last_message_sender_name text,
  last_message_media_meta  jsonb,
  unread_count             integer,
  is_archived              boolean,
  is_pinned                boolean,
  status                   whatsapp.conversation_status,
  match_score              real,
  match_type               text)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid    uuid := (select auth.uid());
  v_admin  boolean;
  v_text   text;
  v_fold   text;
  v_like   text;
  v_phone  text;
  v_tokens tsquery;
  v_kw_ids uuid[];
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_query is null or length(trim(p_query)) = 0 then
    return;
  end if;

  v_admin := whatsapp.is_wa_admin(p_instance_id);
  v_text  := trim(p_query);
  v_fold  := whatsapp._search_fold(v_text);
  -- LIKE pattern: escape %,_,\ in the folded query so a typed wildcard matches
  -- literally (default LIKE escape is backslash). v_fold itself stays RAW — it also
  -- feeds similarity() scoring and the keyword tokenizer, which must not see the
  -- escapes.
  v_like  := '%' ||
             replace(replace(replace(v_fold, '\', '\\'), '%', '\%'), '_', '\_') ||
             '%';

  -- number: digits only, drop one leading local-trunk 0. Require >= 4 significant
  -- digits so a short numeric query does not match every JID.
  v_phone := regexp_replace(v_text, '\D', '', 'g');
  if length(v_phone) >= 1 and left(v_phone, 1) = '0' then
    v_phone := substr(v_phone, 2);
  end if;
  if length(v_phone) < 4 then
    v_phone := null;
  end if;

  -- keyword: instance-salted HMAC'd tsquery of the folded query words (ANDed).
  -- NULL when the query has no word >= 2 chars (e.g. a pure phone number).
  select to_tsquery('pg_catalog.simple',
           nullif(string_agg(whatsapp._search_hmac(p_instance_id, w), ' & '), ''))
    into v_tokens
  from (
    select distinct w
    from unnest(regexp_split_to_array(v_fold, '[^[:alnum:]]+')) as t(w)
    where length(w) >= 2
  ) d;

  -- Keyword -> conversation-id set. Tokens are instance-salted so this GIN scan
  -- is naturally confined to this instance (no cross-tenant fan-out). DETERMINISTIC
  -- cap: group by conversation, keep the 200 with the most-recent match (not an
  -- arbitrary LIMIT-before-DISTINCT slice). The outer scope filter still gates
  -- which of these the caller may see.
  if v_tokens is not null then
    select array_agg(cid) into v_kw_ids from (
      select m.conversation_id as cid
      from whatsapp.messages m
      where m.instance_id = p_instance_id
        and m.body_search @@ v_tokens
      group by m.conversation_id
      order by max(m.whatsapp_timestamp) desc
      limit 200
    ) k;
  end if;

  return query
  with cand as (
    -- NAME (peer_display_name) — conversations_peer_name_fold_trgm_idx
    select c.id
    from whatsapp.conversations c
    where c.instance_id = p_instance_id and c.merged_into is null
      and whatsapp._search_fold(c.peer_display_name) like v_like
    union all
    -- NAME (saved contact book_name / push_name) — contacts fold trgm GINs
    select c.id
    from whatsapp.contacts ct
    join whatsapp.conversations c on c.contact_id = ct.id
    where ct.instance_id = p_instance_id and c.merged_into is null
      and (whatsapp._search_fold(ct.book_name) like v_like
        or whatsapp._search_fold(ct.push_name) like v_like)
    union all
    -- NUMBER — remote_jid trgm GIN (JID digits contain the number)
    select c.id
    from whatsapp.conversations c
    where v_phone is not null and c.instance_id = p_instance_id and c.merged_into is null
      and c.remote_jid ilike '%' || v_phone || '%'
    union all
    -- KEYWORD (blind index)
    select kid from unnest(coalesce(v_kw_ids, '{}'::uuid[])) as u(kid)
  )
  select
    c.id, c.instance_id, c.remote_jid, c.is_group, c.peer_display_name, c.peer_profile_pic,
    ct.book_name as contact_book_name,
    c.last_message_at,
    whatsapp._decrypt_conv_preview(c.id) as last_message_preview,
    c.last_message_kind, c.last_message_direction, c.last_message_sender_name, c.last_message_media_meta,
    c.unread_count, c.is_archived, c.is_pinned, c.status,
    greatest(
      extensions.similarity(whatsapp._search_fold(c.peer_display_name), v_fold),
      extensions.similarity(whatsapp._search_fold(ct.book_name),        v_fold)
    )::real as match_score,
    case
      when whatsapp._search_fold(c.peer_display_name) like v_like
        or whatsapp._search_fold(ct.book_name)        like v_like
        or whatsapp._search_fold(ct.push_name)        like v_like        then 'name'
      when v_phone is not null and c.remote_jid ilike '%' || v_phone || '%' then 'number'
      else 'keyword'
    end as match_type
  from whatsapp.conversations c
  left join whatsapp.contacts ct on ct.id = c.contact_id
  where c.id in (select cand.id from cand)
    and c.remote_jid not like '%@lid'
    and c.remote_jid not like '%@broadcast'
    and c.remote_jid not like '%@newsletter'
    and (v_admin or exists (
          select 1 from whatsapp.conversation_assignments ca
          where ca.conversation_id = c.id and ca.user_id = v_uid))
  order by match_score desc nulls last, c.last_message_at desc nulls last
  limit greatest(least(p_limit, 100), 1);
end
$function$;

revoke all    on function whatsapp.search_conversations(uuid, text, integer) from public;
grant execute on function whatsapp.search_conversations(uuid, text, integer) to authenticated, service_role;

commit;
