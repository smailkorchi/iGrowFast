# 07 — Frontend Architecture and Delivery

## Investor significance

The frontend is the operating surface through which owners, business administrators, sellers, media buyers, and couriers use the same platform without sharing the same permissions or workflow complexity. Its value is breadth with role separation: iGrowFast can add capabilities to a common application shell while preserving distinct day-to-day experiences for each operator class.

The accepted repository inventory found 106 route elements across a 456-file `src/` tree, including 94 page files and 191 component files. That scale indicates a mature product surface, not a prototype screen set. It also means frontend discipline—authorization, cache isolation, bundle management, and release controls—is material to the value and risk of the platform.

## Architecture/capabilities

The application is a React 18 and TypeScript single-page application built with Vite. Routing is organized around role-specific branches:

- platform-owner routes for businesses, plans, billing, users, service status, geography, email configuration, backups, and profile;
- business-administration routes for orders and imports, delivery and return notes, providers, payments, catalog, webhooks, analytics, documents, collaborators, expenses, and business billing;
- seller routes for orders, catalog, wallet, payouts, delivery documents, statistics, WhatsApp, and help;
- media-buyer routes for campaigns, advertising assets, orders, payouts, demands, GA4, Meta Ads, and statistics;
- courier routes for assigned work, payments, and profile.

`src/App.tsx` composes React Router, TanStack Query, role guards, tenant context, shared layouts, suspension handling, and module-level navigation. The `ProtectedRoute` layer validates the authenticated user and role before rendering, redirects mismatched roles, rejects archived users, and applies page-level permissions for administrators. Database Row Level Security remains the authoritative data boundary; frontend guards are a usability and defense-in-depth layer.

Heavy or specialist surfaces are selectively lazy-loaded. The WhatsApp module, import workflows, and document-generation tools are kept behind asynchronous boundaries. Vite's build configuration also separates large dependency families such as icons, charts, motion, Three.js, the Supabase client, and spreadsheet processing. The marketing and legal website is a separate Astro project under `site/`, allowing public content to ship independently from the operations application.

The frontend includes mature data and document capabilities: typed Supabase access, Zod and React Hook Form validation, mapping, charts, PDF/DOCX/XLSX tooling, QR/barcode support, media upload, motion, and responsive component primitives. These are implemented as product capabilities rather than proof of any specific performance level.

## Operating model

The browser holds a public client configuration and a user session. Calls to PostgREST, RPCs, storage, realtime, and edge functions use that session; tenant authorization is evaluated again server-side. A selected business context drives administrative views, while user profiles and role branches determine which shell is available.

TanStack Query manages server state. The global client avoids repeated retries on deterministic authorization or validation failures, while high-cost pages set their own freshness windows. The WhatsApp module has a separate query client so its high-frequency cache policies and mutation behavior do not alter the rest of the application. Both clients are cleared on sign-out to prevent one user's cached rows from appearing in a later session.

For large data surfaces, the architecture has moved work to server-side RPCs. Current source and migrations show keyset pagination for orders and customers, server-side aggregates for dashboards and money calculations, server-side counts and search, and bounded export workflows. This avoids treating browser memory as the reporting database and removes dependence on default row limits for financial totals.

Delivery is split into two repository workflows: one for the operations app and one for the Astro site. Each installs from a lockfile, runs a type-aware gate, builds a static release, uploads into a versioned release directory, flips a `current` symlink atomically, retains a bounded rollback set, and performs an HTTP smoke check. Neither current workflow runs lint. Path filters prevent public-site changes from forcing an application release and vice versa.

## Controls/reliability

- Route-level role checks and administrator page permissions stop unsupported UI entry before rendering sensitive workflows.
- Archived accounts are rejected in the authentication guard; business suspension overlays restrict non-owner use of suspended business workspaces.
- Query caches are purged on sign-out, addressing cross-session stale-data exposure in a long-lived SPA.
- Integration-specific guards can hide GA4 or Meta surfaces from media buyers without the corresponding permission.
- Lazy boundaries isolate the communications module and large import/document dependencies from users who do not need them.
- Build workflows run TypeScript or Astro checks before the production build. Releases use an atomic pointer change rather than modifying the served tree in place.
- Application and marketing releases use separate trees and concurrency groups, limiting cross-surface deployment interference.
- Realtime consumers reconcile from server truth after a channel error or timeout, so transient sockets do not become the sole source of state correctness.

## Current evidence status

- **Repository verified:** framework versions, route organization, lazy boundaries, query-client policies, role guards, large-list patterns, Vite chunk strategy, Astro site separation, and both release workflows are present in current source.
- **Repository verification on 2026-08-23:** `npx tsc -b`, the root production build, Astro check, and Astro build passed in isolated verification. `npm run lint` failed with 1,562 errors and 100 warnings; one concrete Rules of Hooks violation is at `src/whatsapp/routes/admin/conversations/parts.tsx:5944-5952`. `npm test` exited 1 because no test files were found.
- **Production dependency audit on 2026-08-23:** the root audit reported one high and two moderate advisories. The high advisory affects direct `pdfjs-dist` versions `>=5.6.83 <6.2.108` and permits arbitrary JavaScript execution when a malicious PDF is opened; the reported direct fix is 6.2.108, a semver-major update. Moderate React Router/React Router DOM open-redirect, XSS, and related advisories have fixes available.
- **Marketing-site production dependency audit on 2026-08-23:** `site/` reported four high, one moderate, and one low advisory. Direct Astro advisories include XSS and SSRF; transitive high advisories affect `js-yaml`, `nanoid`, and `sharp`. Astro 7.2.4 is reported as an available semver-major fix.
- **Live verified on 2026-08-24:** the platform's core backend path was healthy, but the audit was not a browser-based user-journey test and did not independently verify each route or current frontend release revision.
- **Historical evidence:** project records state that keyset lists, server aggregates, gated dashboards, customer pagination, and removal of row-limited money calculations were shipped. The relevant migrations and consumers remain in the repository.
- **Not verified live:** Core Web Vitals, browser/device compatibility, accessibility conformance, CDN cache behavior, complete role-by-role journeys, and deployed bundle identity.

## Risks/limitations

- The product surface is large, `npm test` currently exits 1 because it finds no test files, and the current lint backlog is 1,562 errors plus 100 warnings. Type checks and builds catch structural failures, not lint violations or full user-journey regressions; the release workflows currently omit lint.
- The root and marketing-site production dependency advisories remain unresolved in this evidence capture. They are current supply-chain risk, not evidence that the platform was exploited.
- Route-level code splitting is selective rather than comprehensive. `vite.config.ts` records that much of the application remains in a large eager route graph and that the icon surface is substantial.
- The SPA still carries multiple data-access styles across older and newer pages. Server-side pagination and aggregates are implemented on important high-volume surfaces, but not every route has been proven equivalent.
- Frontend permission checks cannot substitute for database and RPC enforcement. Any new surface must preserve the existing layered model.
- The audit did not run Lighthouse, visual regression, accessibility, or end-to-end browser suites; no performance or accessibility score is claimed.
- Release workflow code demonstrates an atomic deployment design, but the live audit did not correlate the served assets to a specific repository revision.

## Evidence trail

- Current repository, historical, and live evidence snapshot: `docs/investor-dossier/17-current-evidence-snapshot-2026-08-24.md`
- `package.json` — declared application framework and library versions.
- `src/App.tsx` — route graph, role branches, tenant guard, query policies, and lazy modules.
- `src/components/auth/ProtectedRoute.tsx` — session, role, archive, and page-permission checks.
- `src/whatsapp/lib/queryClient.ts` — communications-specific cache policy and sign-out clearing.
- `src/pages/admin/Customers.tsx` — keyset page consumption and server-derived customer metrics.
- `supabase/migrations/20260714220000_d1_orders_list.sql` — order keyset listing and aggregates.
- `supabase/migrations/20260715040000_d7_customers_and_fixes.sql` — customer list and keyset contract.
- `vite.config.ts` — current build splitting strategy and documented bundle limitations.
- `.github/workflows/deploy-frontend.yml` and `.github/workflows/deploy-site.yml` — release gates and atomic delivery model.
- `site/` — separately built public marketing and legal surface.
