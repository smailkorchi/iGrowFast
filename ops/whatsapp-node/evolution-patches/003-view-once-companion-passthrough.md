# Evolution patch 003 — companion view-once passthrough (the "message à vue unique" indicator)

**Applied:** 2026-07-10 · **Image:** `igf-wa/evolution-api:2.3.7-igf3` · **Box:** igf-wa (.67)
**Source checkout:** `/opt/igf-wa/stack/evolution-src` (patched in-tree, on top of patches 001+002)
**Site:** `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` ~line 1166 (messages.upsert, right before the empty-message `continue`)

## The bug (proven on the live wire, 2026-07-10, both directions)

Current WhatsApp never delivers view-once CONTENT to linked devices. What a companion
session receives is a content-less stanza that explicitly declares itself
(captured at `LOG_BAILEYS=trace` from the owner's live test):

```xml
<message from='24816623026295@lid' type='media' id='ACABE9C937F812877461F0F4F88466B7'
         notify='El Qorchi Ismail' sender_pn='212762554432@s.whatsapp.net' t='1783690194'>
    <reporting><reporting_tag>…</reporting_tag></reporting>
    <unavailable type='view_once'/>
</message>
```

The bundled Baileys already recognizes the marker (`decode-wa-message.js`:
`if (tag === 'unavailable' && attrs.type === 'view_once') fullMessage.key.isViewOnce = true`)
and emits `messages.upsert` with `message: undefined` — proven by its twin
`contacts.update` side-emission reaching the webhook. Stock Evolution 2.3.7 then
silently drops it at the empty-message guard:

```ts
if ((type !== 'notify' && type !== 'append') || editedMessage || !received?.message) {
  continue;   // ← view-once placeholders died here: no store row, no webhook
}
```

Consequence: a customer sends a view-once photo → the inbox shows NOTHING — no
row, no badge, no reason to check the phone. (The follow-up receipts also die:
"Original message not found for update. Skipping".) The Evolution store's only
view-once rows ever were history-synced ones, where Baileys delivers the
UNWRAPPED media message with `viewOnce: true` instead.

## The patch (additive — zero stock consumers touched)

Right before that guard, synthesize the canonical wrapper form when Baileys
flagged the key, so the ENTIRE stock pipeline (store persist + MESSAGES_UPSERT
webhook) carries the placeholder. No media exists anywhere, so nothing
downstream can leak it:

```ts
// IGF PATCH 003 (2026-07-10): companion view-once passthrough. …
if (!received?.message && (received?.key as any)?.isViewOnce) {
  received.message = { viewOnceMessageV2: { message: {} } } as any;
}
```

## Worker counterpart (committed in the repo, same date)

`ops/whatsapp-node/worker/src/webhook/handlers.ts` `extractContent`: recognizes
BOTH view-once shapes — the raw wrappers `viewOnceMessage`/`V2`/`V2Extension`
(patch-003 synthesizes `V2` with an empty inner → media 'unknown') AND the
history-sync unwrapped form (image/video/audioMessage with `viewOnce: true`) —
and maps them to `kind='system'`, `media_meta={subtype:'view_once', media}`.
The frontend renders the WhatsApp-model placeholder bubble (dashed-①, italic
copy per direction, time + ticks, no "En savoir plus") and the ① "Message à
vue unique" list preview. Media is never downloaded.

## Rebuild / upgrade procedure

```
ssh igf-whatsapp
cd /opt/igf-wa/stack
# (on Evolution version bump: re-clone the tag into evolution-src, re-apply
#  patches 001+002+003 — grep 'isViewOnce' MUST hit the messages.upsert guard —
#  bump the -igfN image suffix in docker-compose.yml)
docker compose build evolution-api && docker compose up -d evolution-api
```

## Verification (E2E, 2026-07-10)

Owner sent view-once both directions (El Qorchi ↔ Royale): rows landed as
kind='system' subtype view_once with correct direction; the inbox rendered the
placeholder bubbles live (inbound "Vous avez reçu un message à vue unique…",
outbound "…depuis un autre appareil."), list preview ① Message à vue unique.
