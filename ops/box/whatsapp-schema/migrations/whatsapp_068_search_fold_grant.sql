-- whatsapp_068_search_fold_grant.sql
--
-- FIX: "permission denied for function _search_fold" -> PATCH /rest/v1/contacts
-- returns 403 whenever a client edits a saved contact name (TKT-2).
--
-- ROOT CAUSE. 067a revoked all four search helpers from public and granted them
-- to service_role only, to deny clients an HMAC oracle. 067b then embedded
-- _search_fold in three GIN *expression* indexes:
--     conversations_peer_name_fold_trgm_idx (conversations.peer_display_name)
--     contacts_book_name_fold_trgm_idx      (contacts.book_name)
--     contacts_push_name_fold_trgm_idx      (contacts.push_name)
-- Postgres evaluates an index expression AS THE INVOKING ROLE at write time, so
-- every UPDATE/INSERT on whatsapp.contacts by `authenticated` (which holds
-- INSERT/UPDATE/DELETE there) tripped the ACL check and aborted. The failure was
-- invisible on create -- import_phone_book_entry is SECURITY DEFINER and runs as
-- postgres, which has EXECUTE -- so only the *edit* paths 403'd:
--     src/whatsapp/lib/queries/contacts.ts:84   (useUpsertContact, id branch)
--     src/whatsapp/routes/admin/conversations/parts.tsx:2213 (save-contact upsert)
-- DELETE is unaffected (it removes index entries by tid, no expression eval).
--
-- WHY GRANTING _search_fold IS SAFE, AND WHY THE OTHER THREE STAY REVOKED.
-- The 067a rationale ("no client HMAC oracle") is correct for _search_hmac /
-- _search_key / _search_tokens: those are SECURITY DEFINER and derive from the
-- Vault search key. _search_fold was swept in with them by proximity, but it is
--     translate(lower(coalesce(p_text,'')), '<accented>', '<unaccented>')
-- -- IMMUTABLE, SECURITY INVOKER, no secret, no table access. Its output is
-- reproducible client-side in one line of JS, so EXECUTE grants zero
-- information. It is the only one of the four that appears in an index
-- expression, and therefore the only one a client must be able to execute.
-- DO NOT extend this grant to _search_hmac / _search_key / _search_tokens.
--
-- SCOPE. `authenticated` only. anon and mediabuyer hold no write grant on
-- whatsapp.contacts, so they need nothing. The grant is function-level, so it
-- also pre-empts the identical failure on conversations.peer_display_name should
-- `authenticated` ever be granted UPDATE there (today it holds only SELECT+DELETE).
--
-- VERIFIED on the live box before and after, in rolled-back transactions:
-- impersonating a super admin as `authenticated`, the UPDATE raised
-- "permission denied for function _search_fold" without this grant and succeeded
-- with it. A sweep of every expression index on every authenticated-writable
-- table in public+whatsapp found no other instance of this class.
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

grant execute on function whatsapp._search_fold(text) to authenticated;

commit;
