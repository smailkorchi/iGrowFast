# TICKET F — Coliaty parcel-change-demand dialog: admin + seller Orders

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (path contains a space — quote it), build a shared dialog component `src/components/orders/ParcelChangeDemandDialog.tsx` and wire it into BOTH `src/pages/admin/Orders.tsx` and `src/pages/seller/Orders.tsx` as a per-order row action. This is the flagship UX of the ticket — production-grade, no shortcuts.

## EXPECTED OUTCOME — the journey
**Row action.** A new `DropdownMenuItem` in each Orders page's per-row actions menu (admin ~line 3291-3324, seller ~line 3098-3124), placed directly after the "Track" item, styled identically to siblings (`rounded-lg px-3 py-2 cursor-pointer gap-2.5 text-xs font-bold`, lucide icon `PackageOpen` w-3.5 h-3.5, label `Modify Parcel` — sibling menu labels are English; the dialog itself is French).
- **Rendered only when** the order's latest trackable company parcel (reuse `src/lib/orders/getLatestTrackableCompanyParcel.ts`) exists AND its provider is Coliaty (`provider_type === 'coliaty'`). If `provider_type` is not present in the row's parcels embed, ADD it to the `provider:providers(...)` embed in the query that feeds the rows (check `src/lib/orders/fetchOrderById.ts` `ORDER_BY_ID_SELECT` and the page's own list query — add `provider_type` wherever the row parcels are selected; never match on provider `name`).
- **Disabled (not hidden) when** the parcel's current status is terminal: `status_id` belongs to the master package-status set with `is_terminal` OR `is_returned` true. The pages already load package-status masters via existing hooks (look at `usePackageStatusResolver` / `useStatusCategories` usage in these pages — reuse the existing hub/flag mechanism; do NOT create a new query if one exists).

**Dialog — 3 steps** (state machine like `src/components/orders/OrdersExportWizard.tsx`, the house exemplar — copy its shell anatomy exactly: `DialogContent` `max-w-2xl p-0 border border-ant-line bg-ant-paper rounded-[20px] shadow-[0_32px_90px_-28px_rgba(20,20,19,0.4)] overflow-hidden max-h-[92vh] flex flex-col`, 3px gradient hairline `from-ant-orange via-ant-orange/60 to-transparent`, `DialogHeader` with `w-11 h-11 rounded-2xl bg-ant-ink` icon tile, kicker `text-[9px] font-semibold uppercase tracking-[0.28em] text-ant-mid` with orange dot, `font-display` title + `font-serif italic` description, stepper pills exactly as in the exemplar lines 526-549, scrollable body `ant-scroll flex-1 min-h-0 overflow-y-auto px-6 py-6`, bordered footer with Back/Continue buttons).

- **Step 0 — « Type de demande ».** Kicker: `Demande Coliaty`. Two large option cards (the house option-card pattern: `button` with `role="radio"` + `aria-checked`, selected = `border-ant-ink bg-ant-ink/5`, unselected = `border-ant-line hover:border-ant-ink/20`, `rounded-xl p-4 text-left transition`):
  1. **« Corriger les informations »** — description: `Téléphone, destinataire, prix ou note — sans changer la ville.`
  2. **« Changer la destination »** — description: `Nouvelle ville et adresse de livraison. Le statut de la commande passera à « Relancer vers un nouveau client ».`
  Show the parcel context above the cards in one quiet line: tracking code (tabular-nums) + current status badge. Footer: `Continuer` (disabled until a type is picked), `Fermer`.
- **Step 1 — form.** Fields prefilled from the order row (same source fields the order carries: customer phone → `Téléphone`, customer name → `Destinataire`, order price → `Prix (DH)` numeric, note empty by default → `Note` textarea optional).
  - CORRECT_INFORMATION: only those four fields. No city/address.
  - CHANGE_DESTINATION: additionally `Ville de destination` + `Adresse` (required). On entering this step (and only for this type), fetch allowed cities via the edge action `get_allowed_destination_cities` (contract below) with react-query — **`enabled: open && step===1 && type==='CHANGE_DESTINATION'`** (kept-mounted dialog trap: every query in this dialog MUST be gated on `open`; see the OR-11 comment in `src/components/orders/ParcelTrackingDialog.tsx:58-60`). While loading: skeleton rows (house skeletons, not a centered spinner). On error: inline error panel with the server message verbatim + a `Réessayer` button. City control: shadcn `Select` listing the allowed cities (value = the city's `id` when non-null, else its `name`; label = name). `Adresse`: text input. Validation gates `Continuer`: phone non-empty, receiver non-empty, price ≥ 0, and for CHANGE_DESTINATION city picked + address non-empty.
- **Step 2 — result.** Submit fires on entering (mutation, `useMutation` house pattern with `useToast`):
  1. POST edge `create_parcel_change_demand`.
  2. If success AND type === CHANGE_DESTINATION: resolve the order-status id by **code** — `supabase.from('order_statuses').select('id').eq('code','RELAUNCH_NEW').maybeSingle()` (NEVER hardcode the UUID) — then `supabase.from('orders').update({ order_status_id }).eq('id', orderId)` (user RLS applies; DB triggers handle stock hold + history logging).
  3. Invalidate the page's orders list query (find each page's exact query key — admin uses `['orders-page', activeBusinessId]`-style; use whatever key the host page actually uses, passed in as a prop or invalidated via a callback prop `onSuccess` the host provides).
  States on this step:
  - **Running**: progress copy `Envoi de la demande à Coliaty…` with the house loading treatment.
  - **Success**: green-accented panel: `Demande créée` + `Réf {ref}` (mono/tabular) + `EN ATTENTE chez Coliaty`. For CHANGE_DESTINATION add the line `Statut de la commande mis à jour : « Relancer vers un nouveau client »`.
  - **Partial success** (demand created but the status update failed): amber warning panel: `La demande a été créée (réf {ref}) mais le statut n'a pas pu être mis à jour — modifiez-le manuellement.`
  - **Error**: destructive panel with the Coliaty message verbatim (their 400 messages are already French). Special-case HTTP 403 → `La clé API Coliaty de ce fournisseur n'a pas la permission de créer des demandes de modification. Contactez Coliaty pour l'activer.` Provide `Retour` (back to the form, inputs preserved) + `Fermer`.
  Footer on success: single `Fermer`.

**Edge contract** (already being implemented in parallel — code against it):
- POST `${VITE_SUPABASE_URL}/functions/v1/provider-integration` with headers `Content-Type: application/json`, `Authorization: Bearer ${session.access_token}` (same as `postEdge` in `src/components/delivery/DeliveryNoteWizard.tsx:1357-1362`), body `{ action, provider_id, data }`.
- `get_allowed_destination_cities`: data `{ tracking_code }` → `{ cities: Array<{ id: number | null, name: string }> }`.
- `create_parcel_change_demand`: data `{ tracking_code, request_type, package_phone, package_reciever, package_price, package_note, package_city?, package_address? }` → success `{ success: true, demand: { id, ref, status, request_type, created_at }, ... }`; error JSON `{ error, status_code, errors? }` with matching HTTP status. Note: `package_reciever` is Coliaty's spelling — send exactly that key. `provider_id` = the parcel's `provider_id`.

## CONTEXT (verified facts)
- Admin row menu at `src/pages/admin/Orders.tsx:3291-3324` (View Details / OrderContactSubmenu / Track gated by `canTrackParcel` / Edit Order / Delete). Seller equivalent at `src/pages/seller/Orders.tsx:3098-3124` (no Delete).
- Dialog exemplar: `src/components/orders/OrdersExportWizard.tsx:500-972`. Single-step exemplar + `enabled: open` trap: `src/components/orders/ParcelTrackingDialog.tsx`.
- Mutations: `useMutation` + `useToast` (`@/hooks/use-toast`), destructive variant on failure (admin Orders.tsx ~1633, ~1889, ~2092). Invalidation ~1852-1853.
- Row parcels embed today: `parcels:company_parcels(id, tracking_code, external_id, provider_id, status_id, created_at, company_delivery_note_id, status:package_statuses(label, color), provider:providers(id, name, logo_url))` — note `provider_type` missing; add it where needed.
- Buttons: `src/components/ui/button.tsx` variants default/destructive/outline/secondary/ghost/link. Tokens: ant-ink/ant-paper/ant-line/ant-mid/ant-orange/ant-green/ant-rose/ant-light.
- Stock/status safety (context only, no action): `RELAUNCH_NEW` has `is_relaunch=true`; the DB stock trigger holds stock on relaunch statuses — the flip is safe by design.

## CONSTRAINTS
- Every changed line traces to this feature. No refactors, no adjacent "improvements".
- Transitions 150-250ms, `ease-out`; respect `prefers-reduced-motion` (the shell's existing `transition` classes are fine; no orchestrated entrances).
- Keyboard: dialog fully keyboard-navigable (shadcn primitives give most of it; ensure option cards are buttons with visible focus ring `focus-visible` styles consistent with the app).
- Contrast: body copy `text-ant-ink`/`text-ant-mid` per exemplar; never lighter than the exemplar's own usage.
- The dialog receives props `{ open, onOpenChange, order }` (or the minimal order slice it needs) — mirror `ParcelTrackingDialog`'s prop style. Host pages own the open state exactly like `parcelTrackingOpen`/`setParcelTrackingOrderId`.
- TypeScript strict — `npx tsc -b` must pass from the repo root (run it yourself before reporting; it is the ONLY real typecheck — a bare `tsc --noEmit` at root is vacuous).

## MUST DO
- Both pages wired (admin + seller), one shared component, no duplication.
- All react-query hooks in the dialog gated on `open`.
- Preserve form state when navigating Back from the error state.
- Report exact files touched + line ranges + the query-key(s) you invalidate.

## MUST NOT
- Touch anything under `supabase/functions/**` (a parallel worker owns that file).
- Touch `deno.lock`, migrations, or any file outside the write set below.
- Spawn subagents or other workers.
- Introduce new dependencies.

## WRITE SET
- `src/components/orders/ParcelChangeDemandDialog.tsx` (new)
- `src/pages/admin/Orders.tsx`
- `src/pages/seller/Orders.tsx`
- `src/lib/orders/fetchOrderById.ts` (only if needed to add `provider_type` to the embed)
- The page-level list query definition file if the rows' parcels embed lives elsewhere (report which).

## OUTPUT FORMAT
First line: `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`. Then: files + line ranges, tsc -b result (verbatim tail), the invalidated query keys, and any deviations from this spec with one-line justification each.
