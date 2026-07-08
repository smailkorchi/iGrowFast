# 13 — How conversation resolution ACTUALLY works (live)

Verified 2026-07-08 against the **donor's live production DB**
(project `xlhlezgpgrypdijynmqr`, via MCP) AND our live box. This is the
accurate current pipeline — every superseded/disabled layer stripped out.

## The two invariants that make it impossible to show a bad conversation

Everything the inbox/pool/assignment reads goes through ONE view,
`conversations_decrypted`, whose WHERE clause is (donor-identical, verified):

```sql
WHERE merged_into IS NULL          -- a merged conversation is a tombstone → hidden
  AND remote_jid NOT LIKE '%@lid'  -- an unresolved @lid shell → hidden
```

So two things can NEVER surface, no matter what the resolver does mid-flight:
1. **A merged loser** — once soft-merged, `merged_into` is set, it vanishes.
2. **Any @lid conversation** — an @lid row is either not-yet-resolved (hidden
   until it resolves) or a leftover shell (hidden forever). The inbox only ever
   shows phone-JID DMs (`@s.whatsapp.net`) and groups (`@g.us`).

The corollary: an unresolved contact costs you nothing — it simply isn't shown.
There is no "unresolved conversation" state visible to a user.

## The live resolution pipeline

### On every inbound message (worker → `ingest_message`)
- `_canonical_remote_jid` canonicalizes the jid: a known @lid is rewritten to
  its phone; an unknown @lid stays @lid.
- `ensure_conversation` finds/creates the conversation under the CANONICAL jid
  (unique on `(instance_id, remote_jid)` — one row per canonical peer).
- AFTER INSERT trigger `_conversations_resolve_identity` (ENABLED) links
  `contact_id` through the identity bible (`resolve_identity` +
  `contact_identifiers`) — never fuses two existing contacts (anti-fusion
  guards; ambiguous pairs park in `merge_review`).

### On learning a lid↔phone pair (worker `captureJidMapping`)
- `upsert_jid_mapping` records the deterministic pair (same-envelope / group
  roster — never a presence guess). `jid_mapping` is now a **read-only
  reference** consulted by `_resolve_lid_to_phone`; nothing destructive fires
  off it anymore (see "dead path removed" below).
- The worker then calls `consolidate_lid` → `consolidate_lid_conversation`.

### `consolidate_lid_conversation` — the one consolidator (SOFT only)
For an @lid DM conversation:
1. Resolve @lid → phone via `_resolve_lid_to_phone` (bible + jid_mapping).
   **Unknown phone → RETURN, stay @lid** (no guessing; the view hides it).
2. A phone conversation already exists → `merge_conversation` (SINGULAR, SOFT):
   moves messages/assignments/tags/notes to the survivor, sets the @lid row's
   `merged_into` = survivor. A **tombstone, not a delete** — reversible,
   auditable, and hidden by the view.
3. No phone conversation exists → **promote in place**: rewrite the @lid row's
   `remote_jid` to the phone jid (and patch any queued outbound). The @lid row
   BECOMES the phone conversation — no second row, no duplicate.

### Safety net (cron, every minute)
`_cron_consolidate_split_conversations` calls `consolidate_lid_conversation`
for every remaining unmerged non-group @lid conversation. So any @lid that
becomes resolvable later is consolidated within ~60s — the inbox self-heals.

### Why there are never duplicates
The **phone jid is the canonical key**. An @lid is either promoted to that key
(becomes the single row) or soft-merged into the row already holding that key.
`UNIQUE (instance_id, remote_jid)` + the `merged_into` tombstone guarantee
exactly one visible conversation per resolved contact.

## The dead path we removed (do not resurrect)

The donor's ORIGINAL design had a destructive path:
`jid_mapping_resolved` trigger → `_on_jid_mapping_resolved` →
`merge_conversations` (PLURAL) which **HARD-DELETED** a conversation off the
raw `jid_mapping` table. The donor permanently **disabled** that trigger on
2026-06-01 and routed everything through the soft path above.

Our port shipped the trigger **enabled** (drift). Fixed:
- `whatsapp_026` — disabled it (donor-faithful).
- `whatsapp_027` — **dropped it entirely** (trigger + `_on_jid_mapping_resolved`
  + plural `merge_conversations`), verified zero live callers in DB/edge/worker/
  repo. The donor keeps them disabled-but-present; per owner directive we ditch
  dead paths outright. The SINGULAR `merge_conversation` (soft) STAYS — it is
  the live consolidator.

Live/kept resolution objects (all verified present on both DBs): `ingest_message`,
`ensure_conversation`, `_canonical_remote_jid`, `_resolve_lid_to_phone`,
`resolve_identity`, `link_alt`, `pick_survivor`, `chase_merged_into`,
`consolidate_lid`, `consolidate_lid_conversation`, `merge_conversation`
(singular soft), `_conversations_resolve_identity` (trigger),
`_cron_consolidate_split_conversations` (cron), `conversations_decrypted` view.

Donor also keeps `_resolve_conversation` / `consolidate_contact` (service_role,
0 internal callers) — left in place on ours too (not confirmed dead; possible
worker fallbacks). `conversation_is_resolved` (donor private helper, dead) was
never ported to ours.
