-- whatsapp_067b_search_indexes  (Wave 67b) — search indexes, CONCURRENT
-- TARGET: LIVE box .102 self-host Postgres ONLY.
--
-- !!! RUN OUTSIDE ANY TRANSACTION !!!
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block. Do NOT wrap
-- this file in BEGIN/COMMIT or in the BEGIN…ROLLBACK dry-run harness. Apply
-- AFTER 067a via psql autocommit:
--   ssh igf -> docker exec -i supabase-db psql -U postgres -d postgres < whatsapp_067b_search_indexes.sql
-- (There is intentionally no BEGIN/COMMIT here.)
--
-- WHY CONCURRENT: messages/conversations/contacts hold live data. A plain
-- CREATE INDEX takes a SHARE lock that blocks writes for the full-table scan.
-- CONCURRENTLY builds without blocking inbound-message / conversation writes.
-- Each statement is idempotent (IF NOT EXISTS). If a concurrent build is
-- interrupted it leaves an INVALID index — drop it and re-run that one line:
--   drop index concurrently if exists whatsapp.<name>;  then re-create.
--
-- Depends on 067a (whatsapp._search_fold must exist for the functional trigram
-- GINs). extensions.gin_trgm_ops = pg_trgm (already used by
-- conversations_peer_name_trgm_idx / conversations_remote_jid_trgm_idx, wave 6).

-- 1) KEYWORD blind index. GIN over the HMAC-token tsvector. Tokens are
--    instance-SALTED (067a), so a token's posting list is confined to one
--    instance — a plain (non-composite) GIN already scopes per-tenant; no
--    btree_gin / composite key needed. body_search is NULL for existing rows
--    until the 067a backfill runs, so this build indexes ~0 entries and is cheap;
--    it then maintains incrementally as the backfill and live writes populate.
create index concurrently if not exists messages_body_search_idx
  on whatsapp.messages using gin (body_search);

-- 2) NAME (peer display name) — functional trigram GIN on the folded name; backs
--    `_search_fold(peer_display_name) LIKE '%…%'` (leading wildcard is
--    trigram-indexable at >= 3 chars).
--    NON-PARTIAL on purpose: the RPC predicate is `_search_fold(col) LIKE …` with
--    NO explicit `col IS NOT NULL`, and _search_fold is NON-STRICT (coalesces
--    NULL->''), so a `WHERE col IS NOT NULL` partial predicate can NOT be proven
--    implied by the query -> the planner would REFUSE the index and seq-scan. A
--    NULL name folds to '' (no trigrams -> not indexed anyway), so dropping the
--    partial clause costs ~nothing and keeps the index planner-usable.
create index concurrently if not exists conversations_peer_name_fold_trgm_idx
  on whatsapp.conversations using gin ((whatsapp._search_fold(peer_display_name)) extensions.gin_trgm_ops);

-- 3) NAME (saved contact book_name) — same treatment on contacts (also non-partial,
--    same planner reason as (2)).
create index concurrently if not exists contacts_book_name_fold_trgm_idx
  on whatsapp.contacts using gin ((whatsapp._search_fold(book_name)) extensions.gin_trgm_ops);

-- 4) NAME (contact push_name) — the RPC also matches _search_fold(push_name), so
--    index it too (BitmapOr with book_name's GIN on the same contacts scan).
create index concurrently if not exists contacts_push_name_fold_trgm_idx
  on whatsapp.contacts using gin ((whatsapp._search_fold(push_name)) extensions.gin_trgm_ops);

-- 5) TRANSIENT backfill index. Makes each _backfill_body_search batch pull the
--    next N un-tokenised rows directly (index scan of the SHRINKING candidate
--    set) instead of re-scanning the already-populated prefix -> O(n) drain, not
--    O(n^2). The partial predicate matches _backfill's WHERE exactly. DROP IT
--    once the drain reaches 0 (it is pure backfill scaffolding):
--       drop index concurrently if exists whatsapp.messages_body_search_backfill_idx;
create index concurrently if not exists messages_body_search_backfill_idx
  on whatsapp.messages (id)
  where body_search is null and body_ciphertext is not null;
