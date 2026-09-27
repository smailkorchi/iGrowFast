# igrowfast.com — homepage redesign architecture
**Status:** plan, approved for build. Art direction and shot budget confirmed by owner 2026-08-26.
**Companion pack:** `~/Desktop/iGrowFast-Website-Film/` (world bible + 12 shot prompts)
**Asset pack:** `~/Desktop/iGrowFast-Brand-Assets/` (65 verified logo files)

---

## 1. The decision: one film, four rooms

The homepage stays **one continuous scroll** carrying the whole emotional arc, and feature
depth moves to **four new sub-pages**.

The arc — problem → cost → turn → mechanism → payoff — only works uninterrupted. A visitor
who leaves at "here is your problem" and lands on a feature page has been sold nothing. So
the arc is indivisible.

But feature depth, proof and objection-handling are the opposite: people arrive at those
already convinced, looking for a specific answer. Loading them into the homepage would blow
the video budget and bury the arc. They become:

```
/product/orders      intake, review queue, duplicates, channel attribution
/product/inbox       multi-number shared inbox, assignment, search, media
/product/logistics   carriers, batch parcels, webhooks, delivery notes
/product/money       commission, reconciliation, role-scoped reporting
```

Each sub-page reuses the **existing HTML demos** — `WhatsAppInbox`, `CarrierIntegration`,
`Webhooks`, `DeliveryNotes`, `RoleScope`. Those already work, cost nothing to load, and are
more persuasive than video because they are live. No sub-page gets video.

---

## 2. Section-by-section

Media treatment is deliberately mixed. Only two sections earn scrub — it is the expensive
one, and using it everywhere makes it mean nothing.

| # | Section | Beat | Media | Treatment |
|---|---|---|---|---|
| 01 | **Hero — The Fracture** | Problem | shots 01–03 | **Scrub**, sticky. Headline and lede sit over the footage, fading between shots. |
| 02 | **Ten tabs, named** | Inconvenience | none | Pure typography. The tabs enumerated by real name. Cheapest section, highest recognition. |
| 03 | **The Leak** | Loss — *the money beat* | shots 04–05 | **Scrub**. The hardest copy on the page lands here. |
| 04 | **The Spine** | **The turn** | shots 06–07 | **Scrub**, sticky. Brand promise lands on the lock. The single most important frame on the site. |
| 05 | **Integration strip** | Proof | SVG, DOM | Three labelled lanes — see §4. No video. |
| 06 | **The Loop** | Mechanism | shots 08–10 | **Scrub** behind the existing six-stage `LoopPipeline` text. |
| 07 | **Live demos** | Proof | existing HTML | Unchanged. Strongest asset on the site; zero bytes of video. |
| 08 | **Reconciled** | Gain | shot 11 | Autoplay loop, muted, no scrub. |
| 09 | **Role-scoped truth** | Benefit | none | Static. Who sees what — the governance differentiator nobody else shows. |
| 10 | **The Horizon** | Roadmap | shot 12 | Poster + slow loop. Explicitly labelled *not yet built*. |
| 11 | **Close** | CTA | none | Contact-sales. No price, per copy rules. |

**Video budget:** 12 clips ≈ 28–35 MB after re-encode, lazy-loaded per section. Only the
hero's first clip is eager. Nothing below the fold fetches until it approaches the viewport.

---

## 3. Motion rules — carried over from what already works

These are not new preferences. They are lessons already paid for in this codebase and they
extend to video unchanged.

**Sticky, never GSAP pin.** `LoopPipeline.astro` records pin stealing the hero and snapping
the scroll. Native `position: sticky` holds the frame; ScrollTrigger only *reads* progress
and sets `video.currentTime`. It never pins and never mutates layout, so it cannot desync.

**Reveals enhance an already-visible default.** `reveal.js` sets the hidden state in JS at
runtime, never in the stylesheet — so a crawler or a reduced-motion visitor never meets a
hidden section. Video obeys the same rule: **every clip has a poster frame, and the poster
is the real content.** If video never loads, the page is still a finished, illustrated page.

**Reduced motion gets stills, not faster video.** `prefers-reduced-motion` → poster only,
no fetch of the MP4 at all. That is both an accessibility requirement and a bandwidth win.

**Decide the crop before generating.** All 12 shots are 16:9, composed centre-weighted, and
the page CSS-crops on narrow screens. This is why the world bible repeats *keep the subject
centred* — regenerating a portrait set later would double the owner's work.

**Scrub needs dense keyframes.** Scrubbing sets `currentTime` every frame; the decoder walks
from the nearest keyframe each time. Delivered files get `-g 8` desktop / `-g 4` phone, which
is the difference between a smooth scrub and a stuttering slideshow on Safari.

---

## 4. The integration strip — three lanes, and why it must be three

This is the section most likely to create a false capability claim, so it is designed to
make that structurally impossible. **Every logo sits in a labelled lane. No logo floats free.**

### Lane A — "Connected today"
Repo-verified adapters, currently working.

- **Carriers (9 adapters built):** OzonExpress · Coliaty · Ameex · Quick Livraison · Vitex ·
  Forcelog · Sendit · Digylog · Delvo Express
- **Data & ads:** Google Sheets · Google Analytics · Meta Ads *(read + campaign operations)*
- **Messaging:** the words **"Works with WhatsApp"** — as text, never the mark

> Two accuracy notes carried from the live database:
> **three** carriers are configured in production today (Ameex, Coliaty, OzonExpress) — the
> other six are built and unconfigured. If the strip says "9 carriers", the honest phrasing
> is *"nine carrier integrations built"*, not *"nine carriers running"*.
> **Olivraison** has a logo in the repo but **no adapter**. Do not put it in Lane A.

### Lane B — "Building next"
On the roadmap document, explicitly not shipped. Must be visually de-emphasised — reduced
opacity, a dashed border, and the words *"in build"* in the lane label.

Shopify · YouCan · WooCommerce · Instagram · Messenger · WhatsApp Cloud API · live Meta spend

> YouCan carries a nuance worth keeping: a YouCan-sourced sales channel is **already live via
> sheet ingestion**. The direct integration formalises an existing flow. That is a stronger
> and more truthful claim than pretending it's new.

### Lane C — "Channels you can attribute"
**This is the lane that prevents the mistake.** TikTok, Snapchat, YouTube, Pinterest, Reddit,
X, Facebook, Instagram and Shopee are *not integrations*. They are **labels in the analytics
attribution model** — you tag an order's source and the reporting slices by it. Showing them
alongside real adapters would claim connectivity that does not exist.

Lane C is styled as small monochrome marks under a clear label such as *"attribute revenue to
any of these"* — true, useful, and impossible to misread as an integration.

### Not in any lane
- **Lightfunnels** — no code, no roadmap entry, nothing in the repository. It is an
  aspiration, not a capability. It cannot appear until it is at least on the roadmap.
- **Hermes** — does not exist. Copy rules permit it only as an explicitly labelled
  "coming soon", never in a feature list.

### ⚠ This section reverses an existing, deliberate decision — owner must confirm

**The site today shows no third-party logo anywhere.** The integrations band in
`site/src/pages/index.astro` renders brand *names* as text chips, and the comment above the
footer disclaimer states the reasoning outright: *"Meta grants third parties NO general
licence to display its brand features, so no logo appears here — only nominative text
references, which this line qualifies."*

That is a coherent position: **nominative text use is defensible almost everywhere; logo
display generally is not.** A text chip reading "Shopify" needs no permission. A Shopify logo
does. The current site is quietly, deliberately on the safe side of that line.

Introducing a logo strip crosses it. Three things must be true before it ships:

| Mark | Requirement before display |
|---|---|
| Google (Ads / Analytics / Sheets) | A **granted Brand Permission Request**. Not implied, not assumed — granted. Until then, text only. |
| Meta / Facebook / Instagram / Messenger | No general licence exists. Text only unless Meta grants otherwise. |
| WhatsApp | Never, in any form. Already settled. |
| Shopify, WooCommerce, TikTok, Snap, others | Each has its own brand-usage terms. Check per mark, not as a batch. |
| **Carriers** (Ozon, Coliaty, Ameex, …) | Lowest risk — these are integration partners whose APIs are implemented, and several are commercial relationships. Still no endorsement styling. |

**Recommended path:** ship the strip with **carrier logos only** — which is also the lane
where a logo genuinely helps, because a Moroccan COD operator recognises the Coliaty mark
instantly and would not recognise a word-chip as fast. Keep **every global platform as a
text chip**, exactly as today. Revisit per-brand as permissions are actually granted.

This keeps the visual upgrade where it earns the most recognition, and leaves the legal
posture where the site already deliberately put it. If the owner wants global-platform logos
anyway, that is his call to make explicitly — but it should not happen as a side effect of a
redesign.

Also update the footer disclaimer: it currently names WhatsApp, Google, Shopify, WooCommerce,
TikTok and Snapchat. Any new mark that appears must be added to that line.

### Rendering
Inline SVG from `02_…`/`03_…`/`04_…` of the asset pack, **ink `#141413` monochrome** on cream,
sized to equal optical weight (not equal pixel width — a wordmark and a glyph at the same
width look wrong). Colour versions are held in reserve for hover or for the sub-pages.

Footer keeps the existing trademark attribution block, which already covers Shopify and
WooCommerce and will need the new marks appended.

---

## 5. Copy constraints that bind every section

Full text in `site/COPY_RULES.md`. The four that will actually bite during this build:

1. **Money flow.** Never *wallet*, *payouts*, *escrow*, *we pay your sellers*. Write *track*,
   *reconcile*, *statement*, *balance*. Under Loi 103-12 Art 182 the representation is itself
   the offence, so this is a copywriting constraint, not an engineering one. Section 08
   ("Reconciled") is where this is easiest to get wrong.
2. **WhatsApp.** No mark, no `#25D366`, no UI clone. "Works with WhatsApp" as text. Never
   "official Cloud API", "Meta Partner", or "built on the WhatsApp Business Platform".
3. **No price anywhere.** Plans stay contact-sales.
4. **No testimonials, no growth numbers, no case studies** without a substantiation file.
   The existing hero stat tile (`1 284 commandes ce mois`) is illustrative UI, not a claim —
   keep it visibly inside a demo frame so it cannot read as a customer result.

---

## 6. Build order

1. **Hero only**, on shots 01–03. Owner reviews the world on the real page before generating
   the remaining nine. This is the cheap point of failure.
2. Encode pipeline + poster extraction + the reduced-motion path — build once, reuse per section.
3. Sections 02–04 (the arc through the turn). This is the part that sells.
4. Integration strip — pure DOM, no dependency on any clip, can be built in parallel.
5. Sections 06–11.
6. Four sub-pages, reusing existing demo components.
7. Move the marketing `<link rel="canonical">` off the SPA shell (`index.html:7-35`), where it
   currently makes every app route self-canonicalise to the marketing domain.

**Deploy note:** `deploy-frontend.yml` has no `paths:` filter, so every `site/**` push also
rebuilds the 8 GB-heap app and evicts an app release from the keep-5 prune. Adding video to
the site directory makes that worse. Fix the filter before the first video lands.

**Caching note:** Cloudflare does not cache `text/html` by default at any `Cache-Control`,
but it *will* cache the MP4s. Apex HTML uptime still equals toolbox uptime; the video weight
does not add to origin load after first fetch.
