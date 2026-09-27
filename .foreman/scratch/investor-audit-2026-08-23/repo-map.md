# Repository Evidence Map — 2026-08-23

Status: accepted read-only scout report. Repository evidence proves implementation, not live deployment.

## Product surface
- `src/App.tsx` declares 106 route elements for a multi-tenant commerce and operations platform.
- Platform-owner surfaces cover businesses, plans, billing, users, service status, geography, email, configuration, backups, and profile.
- Media-buyer surfaces cover campaigns, product ads, orders, payouts, demands, GA4, Meta Ads, statistics, and profile.
- Courier surfaces cover dashboard, assigned orders, payments, and profile.
- Commercial/seller surfaces cover catalog, orders, notes, wallet, payouts, demands, statistics, WhatsApp, and help.
- Business administration covers orders/imports, delivery and return notes, carrier services, payments, transactions, products/accessories, webhooks, trash, analytics, sales channels, sheet review, customers/users, expenses, recurring charges, commercial documents, collaborator management, salaries, and business billing.

## Communications and integrations
- `src/whatsapp/routes/admin/Conversations.tsx` and the WhatsApp tree implement a multi-number inbox, assignments, contacts, seller-scoped inboxes, quick replies, tags, scheduled messages, media, customer-order lookup, presence, and broadcast-fed cache updates.
- `supabase/functions/provider-integration/index.ts` implements tracking, parcel creation and batches, labels, delivery notes, city/network/store discovery, parcel changes, and webhooks for named carriers including Ozon, Coliaty, Ameex, Quick Livraison, Vitex, Sendit, and Delvo.
- Concrete code exists for GA4, Meta Marketing, Google Sheets, Evolution API/WhatsApp, Cloudflare R2, SMTP/Stalwart events, Web Push/VAPID, and provider webhooks/pollers.
- `ops/whatsapp-node/worker/src/index.ts` implements Evolution webhooks, outbound dispatch, media ingest/R2, instance reconciliation, heartbeat/logging, presence, and self-healing over private broadcasts.

## Architecture
- React 18, TypeScript, Vite, React Router, TanStack Query, Supabase JS, Radix/Tailwind, Zod/forms, Recharts, mapping, PDF/DOCX/XLSX, QR/barcode, motion, and Three.js are represented in `package.json` and source.
- A separate Astro marketing/legal site exists under `site/`.
- The backend source of truth is self-hosted Supabase/PostgreSQL with edge code under `supabase/functions/` and schema history under `supabase/migrations/`.
- Ops source covers logical/PITR backups, restic, R2 heartbeats, watchdogs, archive monitoring, storage mirrors, restore drills, escrow, and backup-status reporting.
- Two GitHub workflows typecheck/build and release the application and Astro site.

## Static inventory
- 456 files under `src/`.
- 94 page files and 191 component files.
- 88 WhatsApp source files, 61 library files, and 16 hooks.
- 341 SQL migration files.
- 39 edge directories including `_shared`, representing 38 non-shared function directories.
- 275 operations files, 74 documentation files, 40 marketing-site files, and 2 workflows.
- No `*.test.*` or `*.spec.*` files were discovered despite Vitest scripts; this is a test-coverage risk, not evidence that no verification occurs.

## Primary evidence paths
- `src/App.tsx`
- `src/whatsapp/`
- `supabase/functions/`
- `supabase/migrations/`
- `ops/`
- `site/`
- `package.json`
- `.github/workflows/`
