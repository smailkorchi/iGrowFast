# 20. Product Roadmap and Next Build

> Classification: **Confidential — investor diligence material.**
>
> **Every initiative in this chapter carries a single evidence class: _Planned — owner-stated 2026-08-24, scope revised 2026-08-26, not yet built._** Supporting facts about already-delivered components carry their own classes, stated at the end of the chapter. Nothing here is implemented, deployed, or claimed as a capability. The chapter exists so that committed direction is legible alongside delivered work, with the boundary between the two stated explicitly rather than blurred.

## Investor significance

The delivered platform (chapters 18 and 19) is a single-tenant-per-business commerce operating system with one messaging channel, manual advertising-spend entry, and a single interface language. The five initiatives below change two things about that shape:

1. **Channel breadth** — three additional customer-messaging surfaces and three additional order-intake sources.
2. **Automation depth** — advertising spend and post-sale messaging become event-driven instead of hand-entered.

Each initiative is architecturally continuous with what already exists. None requires abandoning the current data model, and each is described below in terms of the delivered components it extends.

---

## 1. E-commerce platform order intake — Shopify, YouCan, WooCommerce

Order import from three e-commerce platforms, alongside the existing Google Sheets ingestion.

The delivered platform already has the harder half of this: a sales-channel model with alias resolution, a spreadsheet ingestion path, a **review queue that holds ingested rows before they become live orders**, duplicate detection, and channel attribution feeding analytics. These integrations become additional producers into an ingestion and review pipeline that already exists and is in daily use.

**Note on YouCan specifically:** a YouCan-sourced sales channel is already configured and operating in production via sheet ingestion. This initiative formalizes a direct integration for a channel already carrying orders, rather than opening a new one.

---

## 2. Full interface translation — Arabic, French, English

The application is presently French-facing. This initiative delivers all three languages across every page.

Two aspects are worth separating for planning honesty. Translation of strings across 94 pages and 191 components is substantial but mechanical. **Arabic additionally requires right-to-left layout support**, which affects component layout, document generation, and the communications inbox — a structural change rather than a string swap. The platform already generates PDF, DOCX, and XLSX documents and already carries Arabic-capable fonts on the delivery path, which reduces part of that surface.

---

## 3. Instagram and Messenger inboxes via the Meta Graph API

Two additional customer-messaging inboxes, built as siblings of the delivered WhatsApp inbox.

This is the initiative with the highest reuse of existing work. The communications module (chapter 18) already provides multi-number inbox mechanics, conversation assignment and routing, contact identity resolution with merge review, tags with server-side aggregate counts, quick replies, scheduled messages, presence, ghost mode, blind-indexed search, media handling with lifecycle cleanup, durable outbound queues, and private per-tenant realtime broadcast. Twenty-five database tables and a dedicated worker already model this domain.

Adding Instagram and Messenger means new channel adapters and identity mapping into that existing model — not a second inbox built from nothing.

---

## 4. Official WhatsApp Cloud API — templates and event-driven automation

Support for Meta's official WhatsApp Cloud API as a channel users can connect their own numbers to, adding three capabilities the current path does not offer:

- **Template management** — creating and managing approved message templates.
- **Automations** — rule-driven sending.
- **Event-synchronized messaging** — automatic messages tied to operating events the platform already emits, such as order confirmed and order delivered.

The third point is the one that matters architecturally, and it is where the delivered system is already strongest. The platform has a semantic order and parcel status model with explicit flags, a transition-logging trigger, and a scheduled reconciliation loop. **The events these automations would fire on already exist and are already trustworthy** — the new work is binding them to an outbound template channel.

This is additive to, not a replacement for, the existing messaging path. Running an official channel alongside the current one also has a risk-management dimension, since the two channels carry different account-policy exposure.

---

## 5. Live Meta advertising spend via the Graph API

Replacing manual advertising-spend entry with automatic ingestion.

Today, campaign spend is entered by hand into `campaign_daily_entries`, and that spend drives attribution, profitability, and media-buyer commission. Automating it removes a recurring manual step and a category of data-entry error from figures the business makes decisions on.

Much of the required plumbing is delivered: a Meta Marketing Graph API proxy, an OAuth authorization flow, stored advertising-account connections, per-media-buyer account allow-lists, campaign and daily-entry models, spend attribution keyed to the creating media buyer, and advertising history. The initiative connects a live feed into a model that already exists and is already reconciled against orders.

---

## Roadmap summary

| # | Initiative | Nature | Principal reuse of delivered work |
| ---: | --- | --- | --- |
| 1 | Shopify / YouCan / WooCommerce intake | Channel breadth | Sales channels, ingestion review queue, duplicate detection |
| 2 | Arabic / French / English translation | Reach | Existing document and font pipeline; RTL is new structural work |
| 3 | Instagram and Messenger inboxes | Channel breadth | The entire communications module and worker |
| 4 | Official WhatsApp Cloud API | Automation depth | Semantic status model and transition events |
| 5 | Live Meta ad-spend ingestion | Automation depth | Graph proxy, OAuth, connections, campaign model |

Further initiatives are anticipated but were not specified at the time of writing and are deliberately not represented here.

## Evidence status

- **Planned — owner-stated 2026-08-24, scope revised 2026-08-26, not yet built:** every initiative in this chapter. Scope is as stated by the platform owner, current as of the revision date.
- **Repository-verified:** the delivered components each initiative is described as extending. Those exist today and are inventoried in chapters 18 and 19.
- **Live-verified:** the YouCan-sourced sales channel is present and configured in the production database.
- **Deliberately not claimed:** delivery dates, sequencing commitments, effort estimates, cost, and any revenue or adoption projection. None were stated, and none are inferred.

## Evidence trail

- Delivered surface these initiatives extend: `docs/investor-dossier/18-complete-application-surface-inventory.md`, `docs/investor-dossier/19-backend-service-and-data-catalog.md`
- Permissions and tenancy model: `docs/investor-dossier/02-users-roles-and-governance.md`, `docs/investor-dossier/11-security-privacy-and-access-control.md`
- Communications module: `docs/investor-dossier/05-customer-communications-and-whatsapp.md`
- Integration surface: `docs/investor-dossier/06-integrations-and-external-systems.md`
