# Orders, logistics, and fulfillment

## Investor significance

Orders are the platform's operational spine. iGrowFast connects intake, review, confirmation, parcel creation, tracking, delivery, returns, inventory consequences, and settlement records instead of treating fulfillment as a disconnected carrier handoff. This creates a defensible workflow asset: every improvement to order quality, provider mapping, status integrity, and exception handling benefits sales teams, operations teams, finance, and customer support at once.

The product is designed for the realities of cash-on-delivery operations, where an order can be confirmed, postponed, refused, returned, paid, unpaid, or corrected across multiple actors and external providers. The engineering value lies in retaining those state transitions and attribution boundaries without letting a late webhook, bulk edit, or role mismatch silently rewrite the commercial record.

## What exists

The administrative workspace contains order lists and detail views, bulk and quick status changes, order export, order imports, sales-channel sheet review, trash/recovery, delivery services, webhooks, company delivery notes, courier delivery notes, company return notes, and courier return notes.

Commercial agents have a scoped order workspace plus delivery and return-note views. Couriers have assigned-order and payment workspaces. The WhatsApp inbox can show a customer's order history and open the role-appropriate order view; conversation-linked order creation is also represented in source.

Carrier integration code supports tracking, parcel creation, batch creation, labels, delivery-note operations, city/network/store discovery, parcel changes, and webhook ingestion. Adapter branches exist for Ozon, Coliaty, Ameex, Quick Livraison, Vitex, Sendit, and Delvo. This is evidence of integration breadth, not a claim that every carrier endpoint was live-tested during this audit.

## How it works

The core workflow is:

1. **Intake:** an administrator or commercial user creates an order, imports a file, reviews sheet-ingested rows, or creates an order from a customer conversation.
2. **Quality and confirmation:** order lists expose duplicate signals, search, filters, attribution, comments, postponement dates, and status history. Review flows validate required customer and city fields before a pending imported row becomes an operational order.
3. **Fulfillment selection:** orders can be assigned to an internal courier or sent to a configured carrier. Provider integrations create individual or batched parcels and retrieve labels or related delivery documents.
4. **Tracking and exceptions:** provider webhooks reconcile external statuses to internal package and order statuses. Unmatched provider statuses are retained for mapping rather than discarded. Late or lower-rank updates are guarded from regressing a terminal workflow.
5. **Delivery and returns:** company and courier delivery notes group eligible parcels. Return notes group returned orders, apply configured return fees, link line items, and move the related records through receipt and stock-restoration workflows.
6. **Commercial consequence:** delivery and payment classifications feed revenue, commissions, courier settlements, inventory, and analytics.

The order page and supporting migrations use server-side pagination, search, counts, and targeted realtime broadcasts. This avoids relying on a browser to load the full order history before it can calculate a list, badge, or operational decision.

## Controls/reliability

Tenant identity is carried through order, parcel, note, fee, provider, and history records and reinforced by database policies and guarded functions. Administrative and collaborator workspaces are separate, and seller/courier queries are scoped to the relevant user or assignment.

`orders_bulk_guarded` validates supported actions, caps a request at 1,000 identifiers, checks status requirements, and differentiates business administrators from sellers. Administrators can correct delivered paid/unpaid orders through the guarded path; seller restrictions remain in force. Cost snapshots and delivery dates are preserved so a later product-cost or status change does not silently rewrite the historical commercial basis.

Provider webhooks authenticate against configured provider records, bind updates to the owning business, skip soft-deleted orders, log processing, prevent selected regressions, and record unmapped raw statuses for later reconciliation. Import code supports per-row isolation so one malformed row does not require pretending an entire file succeeded. Soft-delete and trash flows retain a recovery boundary before permanent cleanup.

## Current evidence status

- **Live verified on 2026-08-24:** the database and Realtime services were healthy; application schemas contained the tables, functions, triggers, and scheduled jobs on which these workflows depend. The live audit intentionally did not read customer orders or mutate workflow state.
- **Repository verified:** role-specific order pages, imports, sheet review, guarded bulk mutation, provider adapters, webhook reconciliation, delivery and return notes, tracking history, server-side list/search work, and order broadcasts exist in source.
- **Historical record:** prior records describe live negative checks for tenant/role boundaries, provider-attribution fixes, server-aggregate and keyset work, and guarded editing of paid/unpaid delivered orders. These records are dated and are not presented as a fresh end-to-end fulfillment test.
- **Unverified:** no new order, import, parcel, label, webhook, delivery note, return, or provider API call was executed during this audit. Current carrier credentials, contract permissions, provider uptime, mapping completeness, and operational throughput were not inspected.

## Risks/limitations

Carrier integrations are exposed to external API changes, inconsistent status vocabularies, webhook delays, and credential or account-policy changes. The code retains unmapped statuses and blocks known regression classes, but no audit can guarantee semantic parity with every provider without controlled live fixtures.

Order behavior spans frontend pages, database triggers, RPCs, edge functions, and external webhooks. Changes to status definitions or delivered/paid semantics must be tested across all of those layers. No conventional automated test files were found in the repository inventory. Runtime deployment parity for every edge function and carrier adapter was not checked, and no throughput or recovery benchmark was run.

## Evidence trail

- Order routes and role workspaces: [src/App.tsx](../../src/App.tsx)
- Administrative order workflow: [src/pages/admin/Orders.tsx](../../src/pages/admin/Orders.tsx)
- Order list and quick-status interactions: [src/components/orders/OrdersListView.tsx](../../src/components/orders/OrdersListView.tsx) and [src/components/orders/QuickStatusChangeModal.tsx](../../src/components/orders/QuickStatusChangeModal.tsx)
- Import and review: [src/pages/admin/ImportOrders.tsx](../../src/pages/admin/ImportOrders.tsx) and [src/pages/admin/SheetReview.tsx](../../src/pages/admin/SheetReview.tsx)
- Delivery and return operations: [src/pages/admin/DeliveryNote.tsx](../../src/pages/admin/DeliveryNote.tsx) and [src/pages/admin/ReturnNote.tsx](../../src/pages/admin/ReturnNote.tsx)
- Carrier adapter implementation: [supabase/functions/provider-integration/index.ts](../../supabase/functions/provider-integration/index.ts)
- Provider status reconciliation: [supabase/functions/provider-webhook/index.ts](../../supabase/functions/provider-webhook/index.ts)
- Guarded bulk order mutations: [supabase/migrations/20260723100000_admin_unlock_delivered_orders_bulk.sql](../../supabase/migrations/20260723100000_admin_unlock_delivered_orders_bulk.sql)
- Current evidence boundary: [docs/investor-dossier/17-current-evidence-snapshot-2026-08-24.md](17-current-evidence-snapshot-2026-08-24.md)
