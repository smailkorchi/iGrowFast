# Evolution patch 001 — remove reloadConnection() from profile-picture pushes

**Applied:** 2026-07-06 · **Image:** `igf-wa/evolution-api:2.3.7-igf1` · **Box:** igf-wa (.67)
**Source checkout:** `/opt/igf-wa/stack/evolution-src` (tag `2.3.7`, commit `cd800f29`, patched in-tree)
**Compose:** `build.context: ./evolution-src` (was the GitHub `#2.3.7` ref)

## Why

Stock Evolution 2.3.7 ends `updateProfilePicture` and `removeProfilePicture` with
`this.reloadConnection()`, whose entire implementation is:

```ts
public async reloadConnection(): Promise<WASocket> {
  return await this.createClient(this.phoneNumber)
}
```

It spawns a **second live socket without closing the first**. The two registrations
then fight — WhatsApp bounces `stream:error <conflict type="replaced"/>` between
them, each side's auto-reconnect re-registers and replaces the other, and after a
few rounds of this flapping **WhatsApp unlinks the companion device entirely**
("device disconnected due to an unknown error" on the phone). Reproduced twice on
2026-07-06 (picture push, then full-profile push) — each cost the paired session.

A "close the old socket first" variant does NOT fix it: Evolution's
`connectionUpdate` close handler treats a non-terminal close as reconnectable and
spins the war back up. The only safe change is to not spawn the second socket.

## What the reload bought (and what we lose)

Only a refresh of Evolution's in-memory `instance.profilePictureUrl` cache.
Cosmetic. Our worker refreshes the avatar through its own path
(`webhook.profile.refreshed` → fetchInstanceDetail → R2 cache), and the cache
self-heals on the next natural reconnect.

The third caller, `updatePrivacySettings` (line ~4003), keeps its reload — we do
not use that endpoint. If it is ever wired up, patch it the same way first.

## The patch (both sites, `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts`)

```diff
       await this.client.updateProfilePicture(this.instance.wuid, pic);
-
-      this.reloadConnection();
+      // IGF PATCH (2026-07-06): reloadConnection() removed — it spawns a second
+      // socket without closing the first, the two fight (conflict:replaced) and
+      // WhatsApp unlinks the device. The reload only refreshed the in-memory
+      // profilePictureUrl cache; stale until next reconnect, which is harmless.

       return { update: 'success' };
```

```diff
       await this.client.removeProfilePicture(this.instance.wuid);
-
-      this.reloadConnection();
+      // IGF PATCH (2026-07-06): reloadConnection() removed — see updateProfilePicture.

       return { update: 'success' };
```

## Rebuild / upgrade procedure

```
ssh igf-wa
cd /opt/igf-wa/stack
# (on Evolution version bump: re-clone the new tag into evolution-src, re-apply
#  this patch — grep 'this.reloadConnection()' MUST return only the
#  updatePrivacySettings site — bump the -igfN image suffix)
docker compose build evolution-api
docker compose up -d evolution-api
```

## Frontend dependency

`src/whatsapp/routes/numbers/NumberDetail.tsx` (WaProfileCard) picture push is
only safe against `2.3.7-igf1+`. Never point the stack back at a stock image
while the picture-push UI is enabled.
