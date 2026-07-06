# Evolution patch 002 — preserve the @lid in the messages.upsert webhook key

**Applied:** 2026-07-06 · **Image:** `igf-wa/evolution-api:2.3.7-igf2` · **Box:** igf-wa (.67)
**Source checkout:** `/opt/igf-wa/stack/evolution-src` (patched in-tree, on top of patch 001)
**Site:** `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` ~line 1478 (messages.upsert, right before `sendDataWebhook`)

## The bug (proven on the live wire, 2026-07-06)

Stock 2.3.7 normalizes lid-addressed inbound keys for the webhook:

```ts
if (messageRaw.key.remoteJid?.includes('@lid') && messageRaw.key.remoteJidAlt) {
  messageRaw.key.remoteJid = messageRaw.key.remoteJidAlt;
}
```

Evolution's own DB stores the TRUE key (`remoteJid=@lid, remoteJidAlt=phone`), but on
the wire this overwrite makes `remoteJid === remoteJidAlt === phone` — the @lid half
is destroyed. Verified by tcpdump on the docker bridge vs `public."Message".key`.

Consequences:
- The worker's LID↔phone capture (jid_mapping + contact bible via same-envelope Alt)
  can never learn a pair from a **lid-addressed** peer's live messages.
- Their presence (typing/recording, which always arrives keyed @lid) then never
  resolves to the phone-keyed conversation → **no typing indicator in the inbox**,
  and their @lid thread never consolidates.
- WA Mancer prod has the SAME latent gap: its live learning only ever worked for
  pn-addressed (address-book) contacts, which skip this normalization. Its mapping
  density comes from history-sync bursts (`messages.set` forwards raw keys) + group
  rosters, which masked the hole.

## The patch (additive — zero stock consumers touched)

Keep the normalization (thread routing correctly keys on the phone JID) but park the
lid under a NEW field the worker reads. `remoteJidAlt` stays phone, so downstream
stock code (`chatbotController.emit`, `saveOnWhatsappCache`) sees exactly what it saw
before. (A naive swap into `remoteJidAlt` would poison `saveOnWhatsappCache`.)

```diff
           if (messageRaw.key.remoteJid?.includes('@lid') && messageRaw.key.remoteJidAlt) {
+            // IGF PATCH 002 (2026-07-06): … park the lid under a NEW additive field …
+            (messageRaw.key as any).remoteJidLid = messageRaw.key.remoteJid;
             messageRaw.key.remoteJid = messageRaw.key.remoteJidAlt;
           }
```

## Worker counterpart (committed in the repo, same date)

`ops/whatsapp-node/worker/src/webhook/handlers.ts`:
1. Capture is **shape-keyed**, not `addressingMode`-keyed (the donor's mode-keyed
   branches can never match the post-normalization envelope), and additionally reads
   `key.remoteJidLid` — the only wire carrier of the pair for lid-addressed peers.
2. `captureJidMapping` now invalidates the presence resolver's negative cache on
   learn (`lidResolveCache.delete`) — pre-fix, a fresh contact's typing stayed dark
   for up to `LID_RESOLVE_TTL_MS` (10 min) AFTER their first message taught the
   mapping. Donor has the same latent blackout.

## Rebuild / upgrade procedure

```
ssh igf-wa
cd /opt/igf-wa/stack
# (on Evolution version bump: re-clone the tag into evolution-src, re-apply patch 001
#  AND this patch — grep 'remoteJidLid' MUST hit the messages.upsert emit site —
#  bump the -igfN image suffix in docker-compose.yml)
docker compose build evolution-api && docker compose up -d evolution-api
```

## Verification (E2E, 2026-07-06)

Fresh lid-addressed peer: first live message → `jid_mapping` row learned
(`95065510813754@lid → 212708763423@s.whatsapp.net`), presence broadcasts flipped
from raw `@lid` to resolved phone JID (`raw_remote_jid` retained in the log line),
typing + recording indicators rendered live in the inbox. Owner-confirmed.
