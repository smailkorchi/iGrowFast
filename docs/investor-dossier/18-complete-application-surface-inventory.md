# 18. Complete Application Surface Inventory

> Classification: **Confidential — investor diligence material.** This chapter enumerates the delivered application surface exhaustively. It names screens, routes, and modules — never tenant names, customer records, or configured data values.

## Investor significance

Chapters 1 through 17 explain how the platform works and what the evidence supports. This chapter answers a narrower question that summary narrative tends to obscure: **exactly how much has actually been built.**

Every item below is repository-verified against head `790f84e` — the screen exists, is routed, and is wired into the application. The count is not an aspiration list. Seven distinct role workspaces, 106 declared route elements, 94 page files, 191 component files, and a dedicated communications module with its own sub-surface represent several years of accumulated product decisions, not a dashboard template.

## The seven roles

The platform's authority model is an enumerated database type, not a UI convention. Seven roles exist, each with its own route tree and page entitlements:

| Role | Scope | Workspace |
| --- | --- | --- |
| `owner` | Platform governance across all tenants | `/owner/*` — confined; cannot enter tenant operational routes |
| `business owner` | Full authority within one tenant | Tenant admin tree, with owner-parity inside the business |
| `super` | Senior tenant administration | Tenant admin tree |
| `admin` | Tenant administration, page-permission gated | Tenant admin tree |
| `commercial` | Sales execution (seller) | `/seller/*` |
| `mediabuyer` | Acquisition and campaign execution | `/mediabuyer/*` |
| `courier` | Delivery execution | `/courier/*` |

Authority is enforced in seven layers — session, account-state, role route tree, page permission, invitation-time integration scope, tenant-bound row policy, and guarded database function — as detailed in chapters 2 and 11.

## Platform governance workspace — `/owner/*`

Twelve screens governing the whole estate.

| Route | Screen | Function |
| --- | --- | --- |
| `dashboard` | Owner dashboard | Platform-wide posture and activity overview |
| `businesses` | Businesses | Create, configure, suspend, reactivate, and delete tenant businesses |
| `plans` | Plans | Commercial plan definitions and entitlements |
| `payments` | Platform payments | Billing and payment records against businesses |
| `users` | Platform users | Cross-tenant identity administration |
| `status` | Service status | Operational status surface |
| `cities` | Master cities | Canonical geography shared by all tenants |
| `zones` | Zones | Delivery-zone definitions underpinning carrier eligibility |
| `email-templates` | Email templates | 29 managed transactional templates |
| `config` | Platform configuration | Global settings |
| `backups` | Backups | Backup and recovery visibility, entitlement-gated |
| `profile` | Profile | Owner self-service account and security |

## Tenant administration workspace

The largest surface. The 45 routes below, plus the five communications-module routes listed further down, total 50.

### Orders and intake

| Route | Function |
| --- | --- |
| `/` | Tenant dashboard |
| `/orders` | Master order workspace: search, filters, duplicate signals, history, bulk actions |
| `/import-orders` | Bulk order import |
| `/import-products` | Bulk product import |
| `/import-accessories` | Bulk accessory import |
| `/import-customers` | Bulk customer import |
| `/sheet-review` | Review queue for spreadsheet-ingested rows before commitment |
| `/sales-channels` | Sales-channel definitions and aliases |
| `/trash` | Soft-deleted order recovery |

### Catalogue and customers

| Route | Function |
| --- | --- |
| `/products` | Product catalogue with stock control |
| `/accessories` | Accessories catalogue |
| `/customers` | Customer records |

### Logistics and fulfilment

| Route | Function |
| --- | --- |
| `/delivery-services` | Carrier and internal-courier configuration |
| `/delivery-note` | Delivery notes |
| `/return-note` | Return notes |
| `/webhooks` | Provider webhook inspection and the unmatched-status queue |

### Finance

| Route | Function |
| --- | --- |
| `/payments` | Collaborator payouts |
| `/transactions` | Transaction ledger |
| `/expenses-details` | Expense records |
| `/expenses-types` | Expense taxonomy |
| `/recurring-charges` | Occurrence-based fixed costs feeding expenses |
| `/salaries` | Salary management |
| `/business` | Business overview |
| `/business/payments` | Business billing |
| `/calculator` | Commercial calculator |

### Acquisition and analytics

| Route | Function |
| --- | --- |
| `/analytics` | Consolidated operating analytics |
| `/google-analytics` | GA4 property reporting |
| `/meta-ads` | Meta advertising reporting |
| `/campaigns`, `/campaigns/new`, `/campaigns/:id`, `/campaigns/:id/edit`, `/campaigns/:id/manage` | Full campaign lifecycle |
| `/ads-history` | Advertising spend history |

### Commercial documents

Four document families, each with a wizard, a page, and a PDF renderer:

| Route | Document |
| --- | --- |
| `/devis` | Quotation |
| `/facture` | Invoice |
| `/bon-de-commande` | Purchase order |
| `/bon-de-livraison` | Delivery order |

### People and governance

| Route | Function |
| --- | --- |
| `/users` | Tenant user administration, invitations, archive/delete lifecycle |
| `/collaborators/sellers` | Seller leaderboard and management |
| `/collaborators/couriers` | Courier leaderboard and management |
| `/collaborators/mediabuyers` | Media-buyer leaderboard and management |
| `/sellers` | Seller workspace view |
| `/demands` | Collaborator demand queue |
| `/profile` | Self-service account and security |

## Sales workspace — `/seller/*`

Thirteen routes across twelve screens plus the scoped inbox. Media-buyer and seller views deliberately hide spend, totals, and ROAS, showing delivered volume and own commission only.

`dashboard` · `orders` · `products` · `accessories` · `payments` · `statistics` · `wallet` · `demands` · `delivery-note` · `return-note` · `whatsapp` · `help` · `profile`

## Acquisition workspace — `/mediabuyer/*`

Fourteen routes across ten screens, covering campaign execution and attributed performance.

`dashboard` · `statistics` · `campaigns` (list, new, preview, edit, manage) · `product-ads` · `orders` · `payments` · `demands` · `google-analytics` · `meta-ads` · `profile`

## Delivery workspace — `/courier/*`

`dashboard` · `orders` · `payments` · `profile`

## Communications module

A distinct application module with its own routing, styling, and component tree — the single largest concentration of engineering in the frontend.

| Route | Surface | Function |
| --- | --- | --- |
| `/whatsapp/numbers` | Numbers | Connected-number inventory |
| `/whatsapp/numbers/:id` | Number detail | Per-number configuration |
| `/whatsapp/conversations` | Inbox | Multi-number conversation workspace |
| `/whatsapp/assignment` | Assignment | Agent-to-number and conversation routing |
| `/whatsapp/contacts` | Contacts | Contact profiles, identifiers, and merge review |
| `/seller/whatsapp` | Seller inbox | Scoped inbox for sales staff |

The inbox itself carries a sub-surface most summaries omit entirely:

- **Quick replies** — reusable message templates
- **Scheduled messages** — future-dated sends with an unassign path
- **Tags and tag picker** — conversation classification with server-side aggregate counts
- **Node sequence builder** — multi-step message sequences
- **Customer orders panel** — order history surfaced inside the conversation
- **Creator badges** — attribution of who acted on a conversation
- **Presence** — live agent presence with composing-window protection
- **Ghost mode** — administrative invisible viewing that suppresses read receipts
- **Server-side conversation search** — blind HMAC index, so search never exposes plaintext
- **View-once and edited-message handling** — including worker-side message-secret decryption

## Authentication and account lifecycle

| Route | Function |
| --- | --- |
| `/auth` | Login |
| `/register/:token` | Token-gated self-registration |
| `/account/change/:token` | Credential-change confirmation |
| `*` | Not-found handling per role tree |

Supporting flows: OTP-gated email and password change, TOTP two-factor, password reset, invitation lifecycle (send, remind with token rotation, revoke, delete), pre-account email verification, login-alert notification, and account suspend/reactivate with reason capture.

## Repository-verified totals

| Dimension | Count |
| --- | ---: |
| Distinct roles in the database enum | 7 |
| Declared route elements | 106 |
| Page files | 94 |
| Component files | 191 |
| Tracked application source files | 456 |
| Application source lines | 193,198 |

## Evidence status

- **Repository-verified, 2026-08-23, head unchanged through 2026-08-24:** every route, page, and module named above exists in tracked source and is wired into the application router.
- **Live-verified:** the application, marketing, and administrative hostnames served successfully during the 2026-08-24 capture.
- **Not established:** this chapter does not claim a browser-based user-journey test of every screen, nor per-screen usage or adoption. Existence and routing are evidenced; exercise is not.

## Evidence trail

- Route definitions: `src/App.tsx`
- Screens: `src/pages/`
- Communications module: `src/whatsapp/routes/`
- Shared components: `src/components/`
- Current evidence snapshot: `docs/investor-dossier/17-current-evidence-snapshot-2026-08-24.md`
