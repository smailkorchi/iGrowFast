# Finance, analytics, and commercial operations

## Investor significance

iGrowFast closes the loop between operational events and commercial decisions. Orders, delivery outcomes, product costs, shipping and return fees, advertising spend, general expenses, and collaborator compensation feed the same reporting and settlement model. This is more valuable than a generic charting layer because the definitions are tied to the workflow that created the money event.

For an investor, the important asset is not a claimed financial result; none is made here. It is the platform's ability to give a business a traceable operating picture: which orders count as revenue, what delivery performance looks like, what is owed to sellers or media buyers, what couriers collected or remitted, and how acquisition sources relate to delivered outcomes.

## What exists

The administration product includes payments, transactions, expense categories and entries, recurring charges, salaries, a calculator, business billing, and commercial-document workflows for quotations, invoices, purchase orders, and delivery slips.

The analytics workspace has 12 sections: profitability, business health, orders, advertising, shipping, inventory, sales channels, customers, sellers, couriers, media buyers, and users. It supports date-window filtering and separates fast operational sections from heavier profitability and collaborator calculations so the page can render progressively.

Commercial agents have wallet and payment views. Media buyers have payment, campaign, advertising-history, Google Analytics, and Meta Ads surfaces. Couriers have payment views built around delivery activity and cash handling. Administration can generate payout statements and maintain seller, media-buyer, and courier settlement records.

## How it works

The repository defines shared financial semantics rather than allowing each chart to invent its own meaning. Revenue requires paid and delivered classification. Delivery state comes from package-status categories. Delivery date anchors commission and revenue timing, with a defined fallback. Product cost prefers the per-order cost snapshot, protecting historical margins when the catalog cost later changes. Shipping, returns, advertising, recurring charges, salaries, and general expenses are represented as separate cost lines.

The admin analytics page calls a tenant-bound `admin_analytics_stats` database function. It requests nine lighter sections first and three heavier sections second. Server-side aggregation replaces full-history browser calculations for money and large operational datasets, while the TypeScript definitions remain as a readable contract for the meaning of revenue, delivery, confirmation, cost of goods, shipping, returns, attribution, and time windows.

Payouts use period records plus transaction rows. Seller and media-buyer ledgers support pending, partial, and paid states, with database triggers maintaining paid totals. Payment functions serialize updates for one collaborator and business, refresh the amount due before recording a payment, and reject payments above the remaining balance. Statement generation assembles the relevant period and order evidence for the recipient. Courier statements model cash collected, fees retained, and net remittance as a transaction record rather than treating every collaborator as the same compensation type.

Media-buyer integrations are resource-scoped. An administrator can assign selected Google Analytics properties and Meta ad accounts, and the media-buyer workspace guards those integration pages. Campaign and advertising records can then be compared with attributed order outcomes inside the same tenant context.

## Controls/reliability

Financial and aggregate functions are tenant-bound and administrator-gated. The analytics RPC rejects non-administrative callers. Payout functions check the caller's business, lock the collaborator/business payment stream, refresh the open ticket, and enforce an overpayment guard before inserting a transaction. Partial-payment triggers keep parent status and paid amount synchronized.

The data model preserves historical cost snapshots and separates delivered, paid, returned, replacement, and provisional states. This matters because cash-on-delivery profitability is not the same as gross order intake. The code also excludes exchange legs from revenue where they are not a new sale and retains separate delivery-rate logic rather than compressing operations into an opaque score.

Historical scale work moved capped or unbounded money calculations into set-based database aggregates and added more frequent set-based refresh for open seller tickets. These changes are visible in migrations and current page calls; their prior live benchmarks are historical evidence, not a performance guarantee.

## Current evidence status

- **Live verified on 2026-08-24:** the database engine, scheduler, and core services were healthy, and the live schema contained the relevant function and trigger surface. The audit did not read financial rows, balances, payouts, or business results.
- **Repository verified:** finance pages, the 12-section analytics product, canonical financial definitions, server-side aggregate calls, partial-payment ledgers, overpayment guards, payout-statement generation, and GA4/Meta integration scopes exist in source.
- **Historical record:** project records document removal of 1,000-row limits from money calculations, live reconciliation of payout edge cases, server-side analytics work, and payment-guard validation. Those dated results do not prove current business performance.
- **Unverified:** revenue, profitability, balances, payout accuracy on current tenant data, external analytics-data freshness, advertising-account connectivity, document delivery, accounting-system reconciliation, and tax or statutory compliance were not audited.

## Risks/limitations

Financial correctness depends on business definitions as well as code. A change to delivered, paid, replacement, fee, commission, or time-window rules can alter several reports and payout paths. Those definitions need formal owner approval and regression fixtures.

The platform provides operational finance, not evidence of a certified general ledger, tax engine, audited accounting system, or regulated payments processor. External GA4 and Meta data can be delayed or revised and should not be treated as cash records. No conventional automated test files were found, and the audit did not replay financial fixtures or independently reconcile totals against bank or accounting statements.

## Evidence trail

- Analytics orchestration and sections: [src/pages/admin/Analytics.tsx](../../src/pages/admin/Analytics.tsx)
- Shared financial and operational definitions: [src/lib/analyticsDefinitions.ts](../../src/lib/analyticsDefinitions.ts)
- Server-side aggregate implementation: [supabase/migrations/20260715010000_d3_analytics_stats.sql](../../supabase/migrations/20260715010000_d3_analytics_stats.sql)
- Partial payout transaction model: [supabase/migrations/20260516233000_partial_payouts_seller_and_mb_txn_tables.sql](../../supabase/migrations/20260516233000_partial_payouts_seller_and_mb_txn_tables.sql)
- Tenant and overpayment guards: [supabase/migrations/20260715060000_p1_overpay_guard.sql](../../supabase/migrations/20260715060000_p1_overpay_guard.sql)
- Settlement-statement orchestration: [src/lib/sendPayoutStatement.ts](../../src/lib/sendPayoutStatement.ts)
- Administrative finance surfaces: [src/pages/admin/Transactions.tsx](../../src/pages/admin/Transactions.tsx), [src/pages/admin/ExpensesDetails.tsx](../../src/pages/admin/ExpensesDetails.tsx), and [src/pages/admin/Salaries.tsx](../../src/pages/admin/Salaries.tsx)
- Analytics integrations: [src/pages/analytics/GoogleAnalytics.tsx](../../src/pages/analytics/GoogleAnalytics.tsx) and [src/pages/analytics/MetaAds.tsx](../../src/pages/analytics/MetaAds.tsx)
- Current evidence boundary: [docs/investor-dossier/17-current-evidence-snapshot-2026-08-24.md](17-current-evidence-snapshot-2026-08-24.md)
