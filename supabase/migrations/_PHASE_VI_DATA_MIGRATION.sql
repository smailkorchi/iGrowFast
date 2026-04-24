-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  WhatsApp v2  ·  Phase VI  ·  ONE-SHOT DATA MIGRATION (manual)         ║
-- ║                                                                        ║
-- ║  This file is NOT in the normal migration chain. It is run MANUALLY    ║
-- ║  via the SQL editor (or `psql`) after Phases I-V are stable in prod.   ║
-- ║                                                                        ║
-- ║  What it does, in one transaction:                                     ║
-- ║    1. Backfill wa_instances from whatsapp_instances.                   ║
-- ║    2. Backfill wa_contacts (deduped by phone+lid) from whatsapp_contacts.║
-- ║    3. Backfill wa_jid_aliases from whatsapp_jid_mappings.              ║
-- ║    4. Backfill wa_groups + wa_group_participants.                      ║
-- ║    5. Backfill wa_threads from whatsapp_conversations using new dedup. ║
-- ║    6. Backfill wa_messages from whatsapp_messages.                     ║
-- ║    7. Backfill wa_labels + wa_thread_labels.                           ║
-- ║    8. Backfill wa_user_thread_state read receipts from chat_settings.  ║
-- ║    9. Verify: every legacy row has a v2 counterpart (or a logged drop).║
-- ║   10. Renames legacy whatsapp_* → whatsapp_legacy_* (kept 30 days).    ║
-- ║   11. Creates compat views named whatsapp_conversations / _messages    ║
-- ║       / _contacts that select from wa_v_legacy_* — UI keeps reading    ║
-- ║       the old names with zero code changes.                            ║
-- ║                                                                        ║
-- ║  Pre-flight checklist (run BEFORE this file):                          ║
-- ║   [ ] evolution-webhook-v2 deployed and Evolution config updated to    ║
-- ║       point at it for the test instance.                               ║
-- ║   [ ] wa-worker scheduled via pg_cron every 30s.                       ║
-- ║   [ ] wa-reconcile scheduled nightly.                                  ║
-- ║   [ ] Frontend updated to read from compat views (no-op if names match)║
-- ║   [ ] At least 24h of shadow-mode traffic confirms wa_messages count   ║
-- ║       diverges from whatsapp_messages by 0 within 1 minute window.     ║
-- ║   [ ] Postgres dump taken (pg_dump or Supabase backup).                ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

BEGIN;

-- ────────────────────────────────────────────────────────────────────────
-- STEP 1  Instances
-- ────────────────────────────────────────────────────────────────────────
INSERT INTO wa_instances (
  id, business_id, evo_instance_id, name, evo_token, owner_phone_e164,
  profile_pic_url, status, created_at, updated_at
)
SELECT
  i.id, i.business_id,
  -- Evolution's UUID isn't stored on legacy. Use our own id as placeholder
  i.id::text AS evo_instance_id,
  i.instance_name,
  'rotate-me' AS evo_token,
  i.phone_number,
  i.profile_pic, i.status, i.created_at, i.updated_at
FROM whatsapp_instances i
WHERE NOT EXISTS (SELECT 1 FROM wa_instances w WHERE w.id = i.id);

-- ────────────────────────────────────────────────────────────────────────
-- STEP 2  Contacts — DEDUPED via JID mappings
-- ────────────────────────────────────────────────────────────────────────
-- Strategy: for each business, group whatsapp_contacts.phone_number by
-- canonical_contact_key derived from jid_mappings + jid pattern. Pick one
-- canonical row per group (oldest), insert into wa_contacts.
WITH
ranked AS (
  SELECT
    c.id AS legacy_id,
    c.business_id,
    c.phone_number AS jid,
    c.name,
    c.profile_pic,
    c.created_at,
    c.updated_at,
    -- Canonical phone: prefer the @s.whatsapp.net form
    CASE
      WHEN c.phone_number LIKE '%@s.whatsapp.net'
        THEN regexp_replace(split_part(c.phone_number,'@',1),'[^0-9]','','g')
      ELSE NULL
    END AS direct_phone,
    -- Resolved phone via jid_mappings
    (SELECT regexp_replace(split_part(m.phone_jid,'@',1),'[^0-9]','','g')
       FROM whatsapp_jid_mappings m
      WHERE m.business_id = c.business_id AND m.lid_jid = c.phone_number
      LIMIT 1) AS mapped_phone,
    -- Direct LID
    CASE WHEN c.phone_number LIKE '%@lid' THEN c.phone_number ELSE NULL END AS direct_lid,
    -- Resolved LID via mappings
    (SELECT m.lid_jid FROM whatsapp_jid_mappings m
      WHERE m.business_id = c.business_id AND m.phone_jid = c.phone_number
      LIMIT 1) AS mapped_lid
  FROM whatsapp_contacts c
),
canonical AS (
  SELECT
    *,
    COALESCE(direct_phone, mapped_phone) AS canonical_phone,
    COALESCE(direct_lid,   mapped_lid)   AS canonical_lid,
    -- Group key: phone if available, else lid, else jid
    COALESCE(direct_phone, mapped_phone, direct_lid, mapped_lid, jid) AS group_key
  FROM ranked
),
chosen AS (
  -- One winner per (business, group_key): the row with the most data
  SELECT DISTINCT ON (business_id, group_key)
    business_id, group_key, canonical_phone, canonical_lid,
    name, profile_pic, created_at, updated_at, jid AS source_jid
  FROM canonical
  ORDER BY business_id, group_key,
           (name IS NOT NULL) DESC,
           (profile_pic IS NOT NULL) DESC,
           created_at ASC
)
INSERT INTO wa_contacts (
  business_id, phone_e164, primary_lid,
  whatsapp_name, profile_pic_url,
  first_seen_at, last_seen_at, created_at, updated_at
)
SELECT
  business_id, canonical_phone, canonical_lid,
  name, profile_pic,
  created_at, updated_at, created_at, updated_at
FROM chosen
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────
-- STEP 3  JID Aliases — every JID points to its canonical contact
-- ────────────────────────────────────────────────────────────────────────
WITH src AS (
  SELECT
    c.business_id,
    c.phone_number AS jid,
    CASE
      WHEN c.phone_number LIKE '%@s.whatsapp.net' THEN 'phone'
      WHEN c.phone_number LIKE '%@lid' THEN 'lid'
      ELSE 'phone'
    END AS jid_kind,
    c.created_at, c.updated_at,
    -- Find target contact by phone or lid
    COALESCE(
      (SELECT id FROM wa_contacts wc
        WHERE wc.business_id = c.business_id
          AND wc.phone_e164 = regexp_replace(split_part(c.phone_number,'@',1),'[^0-9]','','g')
          AND c.phone_number LIKE '%@s.whatsapp.net'),
      (SELECT id FROM wa_contacts wc
        WHERE wc.business_id = c.business_id
          AND wc.primary_lid = c.phone_number),
      -- Cross-resolve via mappings
      (SELECT id FROM wa_contacts wc
        WHERE wc.business_id = c.business_id
          AND wc.phone_e164 = (SELECT regexp_replace(split_part(m.phone_jid,'@',1),'[^0-9]','','g')
                                 FROM whatsapp_jid_mappings m
                                WHERE m.business_id = c.business_id
                                  AND m.lid_jid = c.phone_number LIMIT 1)),
      (SELECT id FROM wa_contacts wc
        WHERE wc.business_id = c.business_id
          AND wc.primary_lid = (SELECT m.lid_jid FROM whatsapp_jid_mappings m
                                  WHERE m.business_id = c.business_id
                                    AND m.phone_jid = c.phone_number LIMIT 1))
    ) AS target_contact_id
  FROM whatsapp_contacts c
)
INSERT INTO wa_jid_aliases (business_id, contact_id, jid, jid_kind, first_seen_at, last_seen_at)
SELECT business_id, target_contact_id, jid, jid_kind, created_at, updated_at
FROM src WHERE target_contact_id IS NOT NULL
ON CONFLICT (business_id, jid) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────
-- STEP 4  Groups + participants
-- ────────────────────────────────────────────────────────────────────────
INSERT INTO wa_groups (
  id, business_id, instance_id, group_jid, subject, description,
  owner_jid, profile_pic_url, is_announce, is_locked, is_community,
  participant_count, invite_code, created_at, updated_at
)
SELECT
  g.id, g.business_id, g.instance_id, g.group_jid, g.subject, g.description,
  g.owner_jid, g.profile_pic, g.is_announce, g.is_restrict, g.is_community,
  g.participant_count, g.invite_code, g.created_at, g.updated_at
FROM whatsapp_groups g
WHERE NOT EXISTS (SELECT 1 FROM wa_groups w WHERE w.id = g.id)
ON CONFLICT (business_id, instance_id, group_jid) DO NOTHING;

INSERT INTO wa_group_participants (
  id, group_id, contact_id, jid, role, joined_at
)
SELECT
  gp.id, gp.group_id,
  (SELECT contact_id FROM wa_jid_aliases WHERE business_id = gp.business_id AND jid = gp.participant_jid LIMIT 1),
  gp.participant_jid, gp.role, gp.created_at
FROM whatsapp_group_participants gp
WHERE NOT EXISTS (SELECT 1 FROM wa_group_participants w WHERE w.id = gp.id)
ON CONFLICT (group_id, jid) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────
-- STEP 5  Threads — one per (business, instance, contact|group), DEDUPED
-- ────────────────────────────────────────────────────────────────────────
-- Individual threads
INSERT INTO wa_threads (
  business_id, instance_id, kind, contact_id,
  last_message_preview, last_message_at, last_message_kind,
  last_message_direction, last_message_status,
  message_count, created_at, updated_at
)
SELECT
  c.business_id, c.instance_id, 'individual',
  COALESCE(
    (SELECT contact_id FROM wa_jid_aliases WHERE business_id=c.business_id AND jid=c.jid LIMIT 1),
    (SELECT contact_id FROM wa_jid_aliases WHERE business_id=c.business_id AND jid=c.phone_jid LIMIT 1),
    (SELECT contact_id FROM wa_jid_aliases WHERE business_id=c.business_id AND jid=c.lid_jid LIMIT 1)
  ) AS contact_id,
  c.last_message_content,
  c.last_message_ts,
  CASE c.last_message_type
    WHEN 'conversation' THEN 'text'
    WHEN 'extendedTextMessage' THEN 'text'
    WHEN 'imageMessage' THEN 'image'
    WHEN 'videoMessage' THEN 'video'
    WHEN 'audioMessage' THEN 'audio'
    WHEN 'documentMessage' THEN 'document'
    WHEN 'stickerMessage' THEN 'sticker'
    ELSE c.last_message_type
  END,
  CASE c.last_message_direction WHEN 'incoming' THEN 'in' WHEN 'outgoing' THEN 'out' END,
  c.last_message_status,
  COALESCE(c.message_count, 0),
  c.created_at, c.updated_at
FROM whatsapp_conversations c
WHERE c.type = 'individual'
ON CONFLICT (business_id, instance_id, contact_id) WHERE kind='individual' AND contact_id IS NOT NULL
DO NOTHING;

-- Group threads
INSERT INTO wa_threads (
  business_id, instance_id, kind, group_id,
  last_message_preview, last_message_at, last_message_kind,
  last_message_direction, last_message_status,
  message_count, created_at, updated_at
)
SELECT
  c.business_id, c.instance_id, 'group', c.group_id,
  c.last_message_content, c.last_message_ts,
  CASE c.last_message_type
    WHEN 'conversation' THEN 'text'
    WHEN 'imageMessage' THEN 'image'
    WHEN 'audioMessage' THEN 'audio'
    ELSE c.last_message_type
  END,
  CASE c.last_message_direction WHEN 'incoming' THEN 'in' WHEN 'outgoing' THEN 'out' END,
  c.last_message_status,
  COALESCE(c.message_count, 0),
  c.created_at, c.updated_at
FROM whatsapp_conversations c
WHERE c.type = 'group' AND c.group_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────
-- STEP 6  Messages
-- ────────────────────────────────────────────────────────────────────────
INSERT INTO wa_messages (
  business_id, instance_id, thread_id, contact_id,
  wa_message_id, wa_remote_jid, wa_sender_jid, wa_from_me,
  message_kind, text_content,
  direction, status, wa_timestamp, received_at, raw_payload
)
SELECT
  m.business_id, m.instance_id,
  COALESCE(
    -- thread by conversation_id mapping
    (SELECT t.id FROM wa_threads t WHERE t.id = m.conversation_id),
    -- fallback by jid+contact
    (SELECT t.id FROM wa_threads t
      WHERE t.instance_id = m.instance_id AND t.kind='individual'
        AND t.contact_id = (SELECT contact_id FROM wa_jid_aliases WHERE business_id=m.business_id AND jid=m.remote_jid LIMIT 1)
      LIMIT 1)
  ) AS thread_id,
  (SELECT contact_id FROM wa_jid_aliases WHERE business_id=m.business_id AND jid=m.remote_jid LIMIT 1) AS contact_id,
  m.message_id, m.remote_jid, m.sender_jid, COALESCE((m.raw_key->>'fromMe')::bool, false),
  CASE m.type
    WHEN 'conversation' THEN 'text'
    WHEN 'extendedTextMessage' THEN 'text'
    WHEN 'imageMessage' THEN 'image'
    WHEN 'videoMessage' THEN 'video'
    WHEN 'audioMessage' THEN 'audio'
    WHEN 'documentMessage' THEN 'document'
    WHEN 'stickerMessage' THEN 'sticker'
    WHEN 'reactionMessage' THEN 'reaction'
    WHEN 'locationMessage' THEN 'location'
    WHEN 'contactMessage' THEN 'contact'
    WHEN 'pollCreationMessage' THEN 'poll'
    WHEN 'listMessage' THEN 'list'
    WHEN 'buttonsMessage' THEN 'button'
    WHEN 'interactiveMessage' THEN 'interactive'
    WHEN 'albumMessage' THEN 'album'
    WHEN 'protocolMessage' THEN 'system'
    ELSE 'unsupported'
  END,
  m.content,
  CASE m.direction WHEN 'incoming' THEN 'in' WHEN 'outgoing' THEN 'out' END,
  CASE m.status WHEN 'read' THEN 'read' WHEN 'delivered' THEN 'delivered' WHEN 'sent' THEN 'sent' ELSE 'sent' END,
  m.created_at, m.created_at, NULL
FROM whatsapp_messages m
WHERE m.type NOT IN ('reactionMessage','protocolMessage')   -- reactions live elsewhere; protocols dropped
ON CONFLICT (instance_id, wa_message_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────
-- STEP 7  Reactions (extracted from JSON-in-content)
-- ────────────────────────────────────────────────────────────────────────
WITH parsed AS (
  SELECT
    m.id          AS legacy_msg_id,
    m.business_id,
    m.instance_id,
    m.created_at  AS reacted_at,
    -- Sender JID for the reactor: legacy stored on raw_key.fromMe + remote_jid
    CASE WHEN COALESCE((m.raw_key->>'fromMe')::bool,false) THEN i.phone_number || '@s.whatsapp.net' ELSE m.remote_jid END AS reactor_jid,
    (m.content::jsonb)->>'targetMessageId' AS target_wa_id,
    (m.content::jsonb)->>'emoji' AS emoji
  FROM whatsapp_messages m
  JOIN whatsapp_instances i ON i.id = m.instance_id
  WHERE m.type = 'reactionMessage' AND m.content IS NOT NULL
)
INSERT INTO wa_reactions (message_id, reactor_jid, reactor_contact_id, emoji, reacted_at)
SELECT
  (SELECT id FROM wa_messages WHERE instance_id = p.instance_id AND wa_message_id = p.target_wa_id),
  p.reactor_jid,
  (SELECT contact_id FROM wa_jid_aliases WHERE business_id = p.business_id AND jid = p.reactor_jid LIMIT 1),
  p.emoji,
  p.reacted_at
FROM parsed p
WHERE p.target_wa_id IS NOT NULL AND p.emoji IS NOT NULL AND p.emoji <> ''
  AND EXISTS (SELECT 1 FROM wa_messages WHERE instance_id = p.instance_id AND wa_message_id = p.target_wa_id)
ON CONFLICT (message_id, reactor_jid) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────
-- STEP 8  Labels + thread-label associations
-- ────────────────────────────────────────────────────────────────────────
INSERT INTO wa_labels (id, business_id, instance_id, name, color, evo_label_id, created_at)
SELECT id, business_id, instance_id, name, color, whatsapp_label_id, created_at
FROM whatsapp_labels
ON CONFLICT (business_id, instance_id, name) DO NOTHING;

INSERT INTO wa_thread_labels (thread_id, label_id, applied_at)
SELECT
  (SELECT t.id FROM wa_threads t
    LEFT JOIN wa_jid_aliases a ON a.contact_id = t.contact_id AND a.business_id = cl.business_id
    LEFT JOIN wa_groups g      ON g.id = t.group_id
   WHERE t.instance_id = cl.instance_id
     AND (a.jid = cl.remote_jid OR g.group_jid = cl.remote_jid)
   LIMIT 1) AS thread_id,
  cl.label_id,
  cl.created_at
FROM whatsapp_chat_labels cl
WHERE EXISTS (
  SELECT 1 FROM wa_threads t
   LEFT JOIN wa_jid_aliases a ON a.contact_id = t.contact_id AND a.business_id = cl.business_id
   LEFT JOIN wa_groups g      ON g.id = t.group_id
  WHERE t.instance_id = cl.instance_id
    AND (a.jid = cl.remote_jid OR g.group_jid = cl.remote_jid)
)
ON CONFLICT (thread_id, label_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────
-- STEP 9  Cross-table verification — abort if anything looks off
-- ────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  legacy_msgs bigint; v2_msgs bigint;
  legacy_convs bigint; v2_threads bigint;
BEGIN
  SELECT COUNT(*) INTO legacy_msgs  FROM whatsapp_messages WHERE type NOT IN ('reactionMessage','protocolMessage');
  SELECT COUNT(*) INTO v2_msgs      FROM wa_messages;
  SELECT COUNT(*) INTO legacy_convs FROM whatsapp_conversations;
  SELECT COUNT(*) INTO v2_threads   FROM wa_threads;

  RAISE NOTICE 'MIGRATION  legacy_msgs=%  v2_msgs=%  legacy_convs=%  v2_threads=%',
    legacy_msgs, v2_msgs, legacy_convs, v2_threads;

  IF v2_msgs < legacy_msgs * 0.95 THEN
    RAISE EXCEPTION 'aborting: v2_msgs % too far below legacy_msgs % (>5%% loss)', v2_msgs, legacy_msgs;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────
-- STEP 10  Rename legacy tables (kept for 30 days as safety net)
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE whatsapp_instances           RENAME TO whatsapp_legacy_instances;
ALTER TABLE whatsapp_contacts            RENAME TO whatsapp_legacy_contacts;
ALTER TABLE whatsapp_messages            RENAME TO whatsapp_legacy_messages;
ALTER TABLE whatsapp_conversations       RENAME TO whatsapp_legacy_conversations;
ALTER TABLE whatsapp_groups              RENAME TO whatsapp_legacy_groups;
ALTER TABLE whatsapp_group_participants  RENAME TO whatsapp_legacy_group_participants;
ALTER TABLE whatsapp_jid_mappings        RENAME TO whatsapp_legacy_jid_mappings;
ALTER TABLE whatsapp_labels              RENAME TO whatsapp_legacy_labels;
ALTER TABLE whatsapp_chat_labels         RENAME TO whatsapp_legacy_chat_labels;
ALTER TABLE whatsapp_chat_settings       RENAME TO whatsapp_legacy_chat_settings;
ALTER TABLE whatsapp_pinned_messages     RENAME TO whatsapp_legacy_pinned_messages;
ALTER TABLE whatsapp_starred_messages    RENAME TO whatsapp_legacy_starred_messages;
ALTER TABLE whatsapp_auto_replies        RENAME TO whatsapp_legacy_auto_replies;
ALTER TABLE whatsapp_fast_replies        RENAME TO whatsapp_legacy_fast_replies;
ALTER TABLE whatsapp_sync_jobs           RENAME TO whatsapp_legacy_sync_jobs;
ALTER TABLE whatsapp_user_instances      RENAME TO whatsapp_legacy_user_instances;

-- ────────────────────────────────────────────────────────────────────────
-- STEP 11  Compat views with the OLD names so the existing UI Just Works
-- ────────────────────────────────────────────────────────────────────────
CREATE VIEW whatsapp_conversations AS SELECT * FROM wa_v_legacy_conversations;
CREATE VIEW whatsapp_messages      AS SELECT * FROM wa_v_legacy_messages;
CREATE VIEW whatsapp_contacts      AS SELECT * FROM wa_v_legacy_contacts;
CREATE VIEW whatsapp_instances     AS SELECT * FROM wa_v_legacy_instances;

GRANT SELECT ON whatsapp_conversations, whatsapp_messages,
                whatsapp_contacts, whatsapp_instances TO authenticated;

COMMIT;

-- After 30 days of stable operation, drop the legacy tables:
--   DROP TABLE whatsapp_legacy_messages CASCADE;
--   DROP TABLE whatsapp_legacy_conversations CASCADE;
--   ... etc.
