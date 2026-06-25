# MASTER REMEDIATION INDEX — Status Centralization Refactor

> **Coverage: 372/372 source files read by agents (zero grep).** 86 files touched status; 62 in findings, 49 need treatment, ~330 actionable sites. Generated 2026-06-25 from a 40-agent read-sweep on the dev branch.


## 1. Executive Summary

**Counts**
- Files in findings touching status: **62**
- Files requiring actual treatment (≥1 non-`none` site): **49**
- Files confirmed clean / no-action (touches_status but every site = `none`, plus the CLEAN list): see appendix
- Total audited sites across treated files: **~330**

**Highest-leverage files (work these first; they define or fan out the contract)**
1. `src/lib/status-categories.ts` — the magic-string category contract to retire [Stage F]. Everything else depends on killing this.
2. `src/hooks/useStatusCategories.ts` — the canonical hub; already flag-driven. Confirm flag-derived id-sets are the only export path [Stage B/D].
3. `src/lib/analyticsDefinitions.ts` — central helper library (isDelivered/isPaid/isConfirmed/isReturned/isAdminPullback/isRevenueOrder); ~15 analytics consumers inherit from it [Stage C/D].
4. `src/lib/commercialCommission.ts` — delivered-for-commission gate feeding all seller/MB money math [Stage D].
5. `supabase/functions/provider-webhook/index.ts` — server-side resolver + regression guard; hardcoded TERMINAL/FORWARD category maps + delivered/cancelled/postponed side-effects [Stage C/D].
6. `supabase/functions/provider-integration/index.ts` — 8 adapter `resolveMasterStatus` duplicates + Ozon/Coliaty/Ameex/Forcelog no-mapping branches [Stage C].
7. `src/pages/admin/Orders.tsx` — largest frontend surface; locks, courier text-cache reads, local matchPkgColor, badge fallbacks [Stage C/E].
8. `src/pages/seller/Orders.tsx` — twin of admin Orders; tab engine, locks, RETURNED_PKG_CATS [Stage C/E].
9. `src/lib/orders/syncOrderTracking.ts` — duplicate matchPackageStatus + TERMINAL_PKG_CATEGORIES string set [Stage C].
10. `src/pages/owner/Status.tsx` — the master-table + flags-on-master editor; the canonical write surface (mostly keep, ensure hub invalidation preserved) [Stage A/B/F].

**Cross-cutting hazards**
- Three divergent `TERMINAL_CATEGORIES` literal lists across edge functions (`provider-webhook` omits `returning`; the 4 poll-webhooks include it). Reconcile when centralizing [Stage C].
- Four hardcoded master-status UUID constants in ReturnNote files + `orderHistoryCommentPolicy.ts` — environment-pinned, will break on dev/prod drift [Stage B/C].
- `delivery_service_statuses` label-matching is reimplemented 5+ times (hub, matchPackageStatus, syncOrderTracking, hydrate.ts, per-page matchPkgColor/matchPkgStatus) [Stage C/E].

---

## 2. Sections by Area

### STATUS CORE / HUB

### src/hooks/useStatusCategories.ts
- L11-61 — status_hook_or_resolver — OrderStatus/PackageStatus types carry master id + semantic flags (is_new/is_confirmed/is_paid/is_unpaid/is_cancelled/is_callback/pending_confirmation/recheck/excluded_from_delivery_rate; is_delivered/is_shipped/is_returned) -> keep; canonical shape [Stage B]
- L63-90 — status_hook_or_resolver — fetches order_statuses + package_statuses with flags, cached per business -> keep; core hub fetch [Stage B]
- L92-139 — category_logic — builds flag-derived id-sets (confirmedIds/paidOrderIds/unpaidOrderIds/cancelledIds/callbackIds/pendingIds/newOrderIds/adminPullback*/deliveredPkgIds/shippedPkgIds/returnedPkgIds) + orderCatMap/pkgCatMap -> keep; this IS the target [Stage D]
- L142-168 — category_logic — perf-breakdown + live-queue id-sets via flags -> keep [Stage D]
- L174-227 — category_logic — getOrderByCategory/getPkgByCategory + isOrderCategory/isPkgCategory predicates + color resolvers; category-string predicates remain a parallel contract -> long-term reduce category lookups in favor of flag id-sets; already master-id keyed [Stage F]

### src/lib/status-categories.ts
- L1-43 — category_logic — ORDER_CATEGORIES/PKG_CATEGORIES magic-string maps + types -> migrate consumers to master id + flags, then delete [Stage F]
- L45-72 — category_logic — hardcoded category-set constants (CONFIRMED/CANCELLED/CALLBACK/PENDING/UNREACHED/ADMIN_PULLBACK*/SHIPPED/DELIVERED/RETURNED); ADMIN_PULLBACK_PACKAGE_CODES has literal 'HorsZone','5684' -> replace each with hub flag-derived id-sets; fold pullback codes into excluded_from_delivery_rate flag [Stage F]
- L74-111 — status_ui_display — ORDER_CATEGORY_COLORS/PKG_CATEGORY_COLORS hardcoded hex maps keyed by category -> prefer master row .color; retire per-category hex fallback maps [Stage F]

### src/lib/matchPackageStatus.ts
- L23-60 — status_hook_or_resolver — async resolver (JSONB-contains -> RPC match_package_status -> ILIKE-on-label); returns {id,code,label,color,category} -> keep as canonical async matcher; ILIKE-on-label step 3 is drift, rely on dss+RPC [Stage C]

### src/hooks/usePackageStatusResolver.ts
- L30-42 — status_hook_or_resolver — loads package_statuses (active && show_in_courier) under shared key -> keep; core hub fetch (show_in_courier limits resolvable set) [Stage E]
- L44-71 — status_hook_or_resolver — byDss/byLabel/byCode lowercase maps + match() -> keep; canonical matcher; master id reachable via m.id but resolve() drops it [Stage E]
- L77-89 — status_hook_or_resolver — resolve() returns label/color/icon only -> RETURN master id from resolve() so consumers branch on id/flags instead of label [Stage E]

### src/components/status/PackageStatusBadge.tsx
- L32-37 — status_hook_or_resolver — usePackageStatusResolver().resolve(rawStatus, fallbackLabel, rawColor); THE shared badge renderer -> none; depends on hub resolving to master rows [Stage E]
- L24-52 — status_ui_display — renders pill; emptyLabel 'Nouveau', fallback '#94a3b8' -> none (display only) [Stage E]

---

### ORDERS PAGES

### src/pages/admin/Orders.tsx
- L5 — tracking_sync — imports matchPackageStatus -> keep (hub resolver)
- L112-113 — status_hook_or_resolver — imports usePackageStatusResolver + useStatusCategories -> none (centralization targets)
- L140 — category_logic — imports statusRequiresHistoryComment -> verify policy keys off master id/flags [Stage C]
- L231-232 — category_logic — LOCKED_ORDER_CATEGORIES=['paid','unpaid']; isOrderLocked reads order.status.category -> replace with master is_paid/is_unpaid flags [Stage C]
- L249-276 — write_status_id — orderSchema order_status_id uuid -> none (id-based)
- L500-513 — read_text_label — getCourierPackageStatus reads courier_parcels.status_label/status_color text caches -> read courier_parcels.status_id, resolve via master; caches = fallback only [Stage E]
- L548-550 — status_hook_or_resolver — REPORTED_STATUS_ID/defaultNewOrderStatusId via getOrderByCategory -> keep; ensure getOrderByCategory maps via flags [Stage C]
- L778-784 — read_status_id — view-modal company_parcels '*' fetch -> none
- L795-834 — read_text_label — courier-parcel fallback fetch; status_label||'Nouveau', status_color||'#3b82f6' -> resolve via master from status_id; literals from master 'new' [Stage E]
- L846-883 — read_text_label — handleTrackParcel internal-courier synth history w/ status_label/status_color + 'Nouveau'/'#3b82f6' -> drive label/color from status_id; drop literals [Stage E]
- L943-961 — tracking_sync — matchPackageStatus then UPDATE company_parcels status_id+status_label+status_color -> keep status_id write; stop writing label/color caches post-centralization [Stage B/C]
- L1000-1001 — read_status_id — aggregate joins status:order_statuses(*) + package_status:package_statuses(*) -> none (canonical)
- L1008-1009 — read_text_label — parcel sub-selects pull status_label/status_color only (no status_id) -> ADD status_id to parcel sub-selects; keep label/color as fallback [Stage E]
- L1042-1056 — read_status_id — order-history joins status:order_statuses!status_id(*) -> none
- L1060-1093 — status_hook_or_resolver — pkgStatusesForTimeline + local matchPkgColor duplicating hub -> replace with usePackageStatusResolver/matchPackageStatus [Stage E]
- L1063 — read_text_label — delivery_service_statuses select for matchPkgColor -> centralize via resolver [Stage E]
- L1069-1080 — status_hook_or_resolver — ordStatusesForTimeline + getOrdIcon(statusId) -> none (id-keyed; could fold into hub)
- L1095 — status_hook_or_resolver — resolvePkgStatus = usePackageStatusResolver() -> none
- L1201-1238 — status_ui_display — orderStatuses dropdown (show_in_order/show_in_quick_status filters) -> none; verify show_in_* on master
- L1295-1307 — status_ui_display — packageStatuses dropdown (id/code/label/color/active/ranking) -> none
- L2044-2045 — category_logic — wantsConfirm = isOrderCategory(...,'confirmed'); two-step insert -> keep isOrderCategory; ensure is_confirmed flag-derived [Stage C]
- L2061 — write_order_status_id — insert order_status_id=insertStatusId -> none
- L2124-2154 — write_status_id — confirm UPDATE + order_status_history insert -> none
- L2180 — write_order_status_id — exchange sale-leg insert -> none
- L2210-2221 — write_status_id — exchange confirm UPDATE -> none
- L2302 — write_order_status_id — updateOrder order_status_id -> none
- L2334-2352 — category_logic — isOrderCategory(confirmed/cancelled/paid/postponed) drives date side-effect columns -> map via is_confirmed/is_cancelled/is_paid + postponed flags [Stage C]
- L2397-2420 — write_status_id — history insert; postponed prefix via isOrderCategory||REPORTED_STATUS_ID -> none for write; unify postponed detection [Stage C]
- L2468-2545 — write_status_id — bulkStatusMutation; per-order confirm loop; postponed comment prefix -> keep id writes; centralize category branching on flags [Stage C]
- L2470 & 2575 — category_logic — bulk filters out lockedOrderIds -> derives from isOrderLocked category strings [Stage C]
- L2600-2614 — category_logic — selection blocks lockedOrderIds -> migrate to master flags [Stage C]
- L2633-2642 — flag_usage — DATE_FIELD_MAP status-derived date columns -> none
- L2698-2733 — category_logic — orderMatchesAllFilters by order_status_id/package_status_id id-sets -> none (desired pattern)
- L2668-2672 — category_logic — lockedOrderIds = isOrderLocked (status.category paid/unpaid) -> migrate to is_paid/is_unpaid flags [Stage C]
- L3260-3276 — status_ui_display — active filter chips by id->label -> none
- L3401-3408 — flag_usage — date-field filter Select -> none
- L3530-3585 — status_ui_display — order/package status filter dropdowns by id -> none
- L3833-3846 — status_ui_display — exchangeRole ring + card accent order.status?.color -> none
- L3851-3891 — status_ui_display — card status pill (color/label fallback 'DRAFT'); package pill resolves rawPkgLabel from package_status?.label||package_status_label||getCourierPackageStatus; hardcoded rgba(0,31,63,*) -> resolve from package_status_id/courier status_id; replace rgba with master 'unknown' default [Stage E]
- L3892-3896 — status_ui_display — EXCH badge on order.replace -> none (exchange)
- L4039-4051 — category_logic — reported recall block via isOrderCategory(...,'postponed') -> keep hub; ensure postponed via flag [Stage C]
- L4102-4119 — category_logic — OrdersListView receives isOrderCategory + getCourierPackageStatus + onQuickStatusChange (isOrderLocked guard) -> audit OrdersListView; pass flag-backed helpers [Stage C/E]
- L4115 — category_logic — onQuickStatusChange gated by isOrderLocked -> migrate to flags [Stage C]
- L4343-4371 — category_logic — submit requires comment via statusRequiresHistoryComment; postponed via REPORTED_STATUS_ID||isOrderCategory -> consolidate postponed on single master signal [Stage C]
- L4727-4827 — status_ui_display — Pipeline Stage combobox; postponed via id===REPORTED_STATUS_ID||isOrderCategory -> keep id selection; unify postponed [Stage C/E]
- L4829-4848 — status_ui_display — reason Textarea via statusRequiresHistoryComment -> none
- L5477-5510 — status_ui_display — view-modal header badges; package resolves from label||package_status_label||courier; rgba fallbacks -> prefer package_status_id/courier status_id; drop text-cache + rgba [Stage E]
- L5522-5526 — status_ui_display — Exchange badge on replace -> none
- L5857-5891 — status_ui_display — view-modal parcel block resolvePkgStatus(status_label,...) fallback '#94a3b8'/'En attente' -> resolve from orderParcel.status_id; literals from master [Stage E]
- L5906-5963 — status_ui_display — history timeline; record.status?.color/label, getOrdIcon, isOrderCategory(...,'postponed') + '[Reporté pour:]' parse -> keep id-join; centralize postponed on flag; consider structured reported_date [Stage C]
- L6006-6027 — status_ui_display — QuickStatusChangeModal wiring -> audit modal; id/flag based [Stage C/E]
- L6066-6111 — write_status_id — Bulk Status Update modal buttons; isOrderCategory(...,'postponed') + statusRequiresHistoryComment -> none for write; hub branching [Stage C]
- L6298-6305 — status_ui_display — OrderStatusHistoryDialog isOrderInCategory wrapper -> audit dialog [Stage C/E]

### src/pages/seller/Orders.tsx
- L5 — status_hook_or_resolver — imports matchPackageStatus -> keep (writes status_id L1054-1062)
- L86 — status_hook_or_resolver — imports statusRequiresHistoryComment -> verify policy on master id/flags [Stage C]
- L103,1197 — status_hook_or_resolver — usePackageStatusResolver -> keep; badges rely on package_status_id [Stage E]
- L105,672 — status_hook_or_resolver — useStatusCategories hub (pervasive) -> keep [Stage B/D]
- L106 — category_logic — imports RETURNED_PKG_CATS -> replace with is_returned/is_refused flags [Stage F]
- L107 — status_hook_or_resolver — imports computeUnpaidCommission/isDeliveredForCommission -> ensure deliveredPkgIds from is_delivered flag [Stage D]
- L108 — category_logic — imports isAdminPullback -> pullback id-sets from flags [Stage D]
- L222-223 — category_logic — LOCKED_ORDER_CATEGORIES=['paid','unpaid']; isOrderLocked -> replace with is_paid/is_unpaid flags [Stage C]
- L249 — write_status_id — orderSchema order_status_id -> none
- L616-629 — read_text_label — getCourierPackageStatus reads status_label/status_color -> switch to courier_parcels.status_id join master [Stage E]
- L673-674 — status_hook_or_resolver — REPORTED_STATUS_ID/defaultNewOrderStatusId via getOrderByCategory -> back with flags [Stage C]
- L882-947 — read_status_id — view-modal parcel fetch; synth history w/ 'Nouveau'/'#3b82f6' -> resolve from status_id; drop literals [Stage E]
- L950-987 — read_status_id — handleTrackParcel internal-courier; same fallback -> resolve from master; remove literals [Stage E]
- L1047-1065 — tracking_sync — matchPackageStatus then UPDATE company_parcels status_id+label+color -> keep status_id; drop cache writes [Stage B/C]
- L1098-1108 — read_status_id — aggregate joins status/package_status(*) + parcels status_label/status_color -> prefer joins; retire label/color cache selects [Stage E]
- L1145-1159 — status_hook_or_resolver — order-history join status!status_id(*) -> none
- L1162-1173 — status_hook_or_resolver — timeline icon getOrdIcon -> none
- L1175-1195 — read_text_label — matchPkgColor local resolver duplicating hub -> replace with usePackageStatusResolver/matchPackageStatus [Stage E]
- L1289-1340 — status_ui_display — dropdown queries (show_in_order/show_in_quick_status/show_in_seller_confirmation/show_in_seller_suivi/recheck) -> none; keep as master flags
- L1303-1326 — status_ui_display — orderStatusesForModal/ForQuickStatus filters -> none
- L1805-1806 — category_logic — wantsConfirm = isOrderCategory(...,'confirmed') -> replace with is_confirmed flag [Stage C]
- L1822,1904 — write_status_id — order_status_id interim+UPDATE -> none
- L1912-1921 — write_status_id — order_status_history insert -> none
- L1994,2027-2042 — category_logic — updateOrder confirmed/cancelled/paid/postponed stamps via isOrderCategory -> replace with flags [Stage C]
- L2098-2118 — write_status_id — history insert; postponed prefix -> derive postponed via flag [Stage C]
- L2147-2188 — write_status_id — quickStatusMutation; category stamps -> replace with flags [Stage C]
- L2289 — category_logic — lockedOrderIds via isOrderLocked -> flags [Stage C]
- L2308-2367 — category_logic — isOrderInTab core engine; show_in_*/recheck/active + 'confirmed'/'delivered'/'returned'/'recheck' literals -> replace literals with is_confirmed/is_delivered/is_returned/recheck flags [Stage C]
- L2374-2398 — category_logic — orderMatchesAllFilters by id -> none
- L2509-2529 — category_logic — orderPassesNonStatusFilters -> none
- L2531-2570 — category_logic — recheckOrderStatusBuckets via recheck flag -> none
- L2572-2614 — category_logic — recheckPackageStatusBuckets; isPkgCategory(...,'recheck') seeding -> replace with recheck flag only [Stage C]
- L2654-2704 — category_logic — sellerStats via deliveredPkgIds/pendingIds/isAdminPullback -> none structurally; ensure sets from flags [Stage D]
- L2706-2707 — category_logic — handleEdit blocks isOrderLocked -> flags [Stage C]
- L2992,2999 — status_ui_display — active filter chips by id->label -> none
- L3236-3273 — status_ui_display — Status/Package filter Selects -> none
- L3460-3494 — status_ui_display — card pill; package_status_label fallback + 'DRAFT' -> read from package_status_id/parcel status_id; drop denorm fallback + literal [Stage E]
- L3627-3639 — category_logic — reported recall via isOrderCategory||REPORTED_STATUS_ID -> derive via flag [Stage C]
- L3690-3704 — status_ui_display — SellerOrdersListView props (isOrderCategory/getCourierPackageStatus/reportedStatusId) -> audit consumer [Stage C/E]
- L3699 — category_logic — onQuickStatusChange guard isOrderLocked -> flags [Stage C]
- L3781,3897-3905 — category_logic — submit postponed via REPORTED_STATUS_ID||isOrderCategory -> replace with flag [Stage C]
- L3885-3895 — category_logic — submit comment via statusRequiresHistoryComment -> policy on master id/flags [Stage C]
- L4282-4357 — status_ui_display — pipeline combobox; postponed detection -> replace with flag [Stage C/E]
- L4369-4388 — status_ui_display — conditional comment field -> policy on id/flags [Stage C]
- L4964-5026 — status_ui_display — view header pills; package_status_label fallback + 'Brouillon' -> read from master; drop denorm + literal [Stage E]
- L5319-5353 — status_ui_display — view parcel resolvePkgStatus(status_label) fallback 'En attente'/'#94a3b8' -> resolve from status_id; drop literals [Stage E]
- L5366-5409 — status_hook_or_resolver — history timeline; postponed via REPORTED_STATUS_ID/isOrderCategory + '[Reporté pour:]' regex -> derive via flag; consider structured reported_date [Stage C]
- L5522-5537 — status_hook_or_resolver — QuickStatusChangeModal wiring -> audit modal [Stage C/E]
- L5548-5555 — status_hook_or_resolver — OrderStatusHistoryDialog isOrderInCategory -> audit dialog [Stage C/E]

### src/pages/mediabuyer/Orders.tsx
- L18 — status_hook_or_resolver — imports useStatusCategories -> keep [Stage B]
- L20 — category_logic — imports DELIVERED_PKG_CATS/CANCELLED_ORDER_CATS/RETURNED_PKG_CATS -> replace with is_delivered/is_cancelled/is_returned flag id-sets [Stage F]
- L30-31 — status_ui_display — imports ParcelTrackingDialog/OrderStatusHistoryDialog -> none (delegated)
- L46-49 — read_status_id — OrderRow declares order_status_id/package_status_id + joined status/package_status -> keep ids; category/label/color via hub [Stage E]
- L66 — status_hook_or_resolver — isOrderCategory destructure -> keep [Stage C]
- L126-133 — read_status_id — fetchAllRows joins order_statuses/package_statuses(id,label,color,category,icon) -> none structurally [Stage F]
- L168 — read_text_label — search haystack includes status?.label/package_status?.label -> none; label from master [Stage E]
- L181-187 — category_logic — orderTab() via package_status.category/status.category vs DELIVERED/CANCELLED/RETURNED cats -> replace with is_delivered/is_cancelled/is_returned flags [Stage C]
- L189-198 — category_logic — tabCounts/tabbedOrders group by orderTab() -> none beyond orderTab() fix [Stage C]
- L200-214 — category_logic — summaryStats compares category==='delivered'/'confirmed' literals -> replace with is_delivered/is_confirmed flags [Stage C]
- L382,391-401 — status_ui_display — mobile card package pill color/icon/label -> source from master via resolver [Stage E]
- L459-470 — status_ui_display — desktop Statut column badge -> render from master-derived label/color/icon [Stage E]
- L523-530 — status_hook_or_resolver — OrderStatusHistoryDialog isOrderInCategory -> keep; master id/flags [Stage C]

---

### ORDER COMPONENTS

### src/components/orders/OrderStatusHistoryDialog.tsx
- L17-24 — read_status_id — HistoryRecord carries status_id + embedded status{id,label,color,category} -> embedded object from master; category/flags from master [Stage E]
- L37,98-101 — category_logic — isPostponed() via injected isOrderInCategory OR fallback record.status.category==='postponed' -> replace 'postponed' literal + category fallback with flag/id-set from hub [Stage C]
- L51-65 — status_hook_or_resolver — fetch history with status:order_statuses!status_id(*) -> keep FK join; category/flags from master [Stage E]
- L81-96 — read_status_id — loads order_statuses(id,icon,active) + getIcon by status_id -> none
- L132-175 — status_ui_display — pill via status.color (#94a3b8)/status.label ('Inconnu')/getIcon -> drive from resolved master by id [Stage E]

### src/components/orders/OrderStatusNotifications.tsx
- L5,33 — status_hook_or_resolver — usePackageStatusResolver -> none
- L106-109 — category_logic — diffs package_status_id OR package_status_label -> diff on package_status_id alone; drop label compare [Stage E]
- L122 — read_text_label — dedupe key package_status_id || package_status_label -> key on package_status_id only [Stage E]
- L152-163 — status_ui_display — resolve(package_status_label,null,package_status_color) -> pass package_status_id; remove raw-column fallbacks [Stage E]
- L136-149 — tracking_sync — enriches toast w/ latest parcel (tracking_code/provider) -> none

### src/components/orders/OrderStatusToast.tsx
- L6-17 — read_text_label — payload carries pre-resolved statusLabel/color/icon + statusCategory -> none; ensure callers feed master-resolved values [Stage E]
- L24-114 — status_ui_display — renders pill (fallback #94a3b8/'Mise à jour') -> none (presentation)

### src/components/orders/ParcelTrackingDialog.tsx
- L15 — status_hook_or_resolver — imports matchPackageStatus -> none
- L31-59 — read_status_id — loads package_statuses (active && show_in_courier) -> none
- L89-120 — read_text_label — courier fallback reads status_label/status_color/status_id + synth timeline 'Nouveau'/#3b82f6 -> resolve courier_parcels.status_id via master; drop caches [Stage E]
- L137-150 — write_status_id — matchPackageStatus then UPDATE company_parcels status_id+label+color -> write status_id only post-centralization [Stage B/C]
- L166-172 — hardcoded_status_literal — statusMap provider-code->FR label literals -> replace with master delivery_service_statuses mapping [Stage C/E]
- L174-178 — hardcoded_status_literal — situationMap PAID/NOT_PAID/INVOICED -> none (payment situation; co-rendered)
- L181-199 — status_hook_or_resolver — local matchPkgStatus duplicate -> consolidate into shared resolver [Stage E]
- L251-309 — status_ui_display — timeline pill via matched color/icon + statusMap fallback -> drive from master resolver; remove statusMap fallback [Stage E]

### src/components/orders/QuickStatusChangeModal.tsx
- L9 — status_hook_or_resolver — imports statusRequiresHistoryComment -> policy on master id/flags [Stage C]
- L17-26,44 — write_order_status_id — onStatusChange writes order_status_id; reads currentStatusId -> none
- L18,45-46,64-67 — category_logic — isOrderCategory(...,'postponed') + statusRequiresHistoryComment gate extra-input -> replace 'postponed' literal with flag/id-set [Stage C]
- L61-75 — write_status_id — handleStatusClick fires onStatusChange or opens form -> none
- L77-106 — write_status_id — handleConfirm builds '[Reporté pour:]' + onStatusChange; postponed gate -> keep write; postponed via flag [Stage C]
- L123-131,229-247 — status_ui_display — current pill + status grid from orderStatuses -> none

### src/components/orders/OrdersListView.tsx
- L21,60 — status_hook_or_resolver — usePackageStatusResolver -> none
- L38-39 — category_logic — props isOrderCategory + getCourierPackageStatus -> none; getCourierPackageStatus resolve via master [Stage E]
- L96-103 — status_ui_display — rawPkgLabel from package_status.label||package_status_label||courier; resolve() -> resolve from package_status_id; drop denorm fallback [Stage E]
- L246-274 — status_ui_display — order-status pill (fallback 'DRAFT') + isOrderCategory(...,'postponed') reported sub-line -> keep pill; replace 'postponed' literal with flag/id-set [Stage C]
- L277-298 — status_ui_display — package cell pill (Truck fallback) -> none beyond resolver fix [Stage E]
- L248-266 — write_status_id — pill onClick onQuickStatusChange -> none

### src/components/orders/SellerOrdersListView.tsx
- L20,53 — status_hook_or_resolver — usePackageStatusResolver -> none
- L33-35 — category_logic — props isOrderCategory/getCourierPackageStatus/reportedStatusId -> none; getCourierPackageStatus via master [Stage E]
- L81-88 — status_ui_display — rawPkgLabel from package_status.label||package_status_label||courier -> resolve from package_status_id; drop denorm [Stage E]
- L105 — category_logic — isPostponed via isOrderCategory(...,'postponed')||order_status_id===reportedStatusId -> replace 'postponed' literal + id-equality with single flag/id-set [Stage C]
- L214-243 — status_ui_display — order-status pill (fallback 'DRAFT') + postponed sub-line -> keep pill; fix postponed [Stage C]
- L245-267 — status_ui_display — package cell pill -> none beyond resolver fix [Stage E]

---

### PARCELS / TRACKING

### supabase/functions/provider-integration/index.ts
- L86-121 — read_text_label — OzonAdapter.trackParcel: raw STATUT, NO master mapping -> route through resolveMasterStatus [Stage C]
- L248-293 — read_text_label — ColiatyAdapter.trackParcel: raw HISTORY_STATUS, no mapping -> resolve each to master [Stage C]
- L581-620 — read_text_label — ColiatyAdapter.getParcelInfo returns provider status.code/label, color null -> map via resolveMasterStatus [Stage C]
- L675-753 — read_text_label — AmeexAdapter.trackParcel raw statut/statut_name/statut_color, no mapping -> resolve event.statut codes [Stage C]
- L755-809 — read_text_label — AmeexAdapter.getParcelInfo scrapes label/color from HTML -> map parcel.statut to master; stop scraping as truth [Stage C]
- L1283-1299 — status_hook_or_resolver — QuickLivraison resolveMasterStatus (SELECT omits id) -> centralize; add id + flags [Stage C]
- L1301-1370 — category_logic — QL normalizeTrackingPayload hardcodes NEW_PARCEL/PICKED_UP/SENT/DELIVERED milestones -> replace with flag-driven milestones (is_shipped/is_delivered) [Stage C]
- L1372-1389 — tracking_sync — QL trackParcel/getParcelInfo delegate -> none
- L1830-1844 — status_hook_or_resolver — Vitex resolveMasterStatus (SELECT id,code,label,color,category) -> centralize; add flags [Stage C]
- L1846-1874 — read_status_id — Vitex normalizeTrackingPayload emits statusId/category -> none beyond centralizing resolver
- L2000-2010 — tracking_sync — Vitex track/getParcelInfo -> none
- L2057 — hardcoded_status_literal — Vitex finalizeDeliveryNote WAITING_PICKUP comment -> none (doc only)
- L2286-2300 — status_hook_or_resolver — Forcelog resolveMasterStatus -> centralize; flags [Stage C]
- L2473-2562 — read_text_label — Forcelog trackParcel scrapes badge label/color; only latest resolved, history statusId:null -> resolve every scraped event to master; stop trusting FR labels [Stage C]
- L2564-2566 — tracking_sync — Forcelog getParcelInfo delegate -> none
- L2811-2824 — status_hook_or_resolver — Sendit resolveMasterStatus -> centralize; flags [Stage C]
- L2892-2942 — read_status_id — Sendit trackParcel resolves each via resolveMasterStatus -> none beyond centralizing
- L2944-2946 — tracking_sync — Sendit getParcelInfo delegate -> none
- L3130-3143 — status_hook_or_resolver — Digylog resolveMasterStatus -> centralize; flags [Stage C]
- L3194-3217 — hardcoded_status_literal — Digylog createParcel status:0 (provider enum) -> none (excluded)
- L3233-3268 — read_status_id — Digylog trackParcel resolves via resolveMasterStatus -> none beyond centralizing
- L3270-3272 — tracking_sync — Digylog getParcelInfo delegate -> none
- L3580-3593 — status_hook_or_resolver — DelvoExpress resolveMasterStatus -> centralize; flags [Stage C]
- L3665-3730 — read_status_id — DelvoExpress trackParcel resolves; trusts provider status.color fallback -> none beyond centralizing
- L3732-3734 — tracking_sync — DelvoExpress getParcelInfo delegate -> none
- L3758 — read_text_label — DelvoExpress datatable coli_status column mapping -> none (routed through resolver)
- L4015-4022 — status_hook_or_resolver — Deno.serve dispatcher track_parcel/get_parcel_info -> none (dispatch)

### src/lib/orders/syncOrderTracking.ts
- L6-12 — hardcoded_status_literal — TERMINAL_PKG_CATEGORIES string set ('delivered','returned','returning','refused','cancelled') -> replace with master flag check on package_status_id [Stage C]
- L22-48 — read_status_id — getPackageStatuses() in-memory cache (no flags) -> add flag columns to select [Stage C]
- L56-107 — status_hook_or_resolver — local matchPackageStatus (dss->label->code->substring-label) duplicate -> consolidate with canonical resolver; substring-label is drift hazard [Stage C]
- L180-219 — tracking_sync — pickStatusFromResponse maps via matchPackageStatus -> use centralized resolver [Stage C]
- L221-263 — write_status_id — syncParcelTracking writes status_id+label+color -> stop writing label/color caches; status_id only [Stage B/C]
- L265-308 — category_logic — syncOrdersTracking reads package_status.category, skips terminal via string set -> gate on master flags [Stage C]

### src/lib/orders/getLatestTrackableCompanyParcel.ts
- L1-44 — indirect_other — pickShippedCompanyTrackingCode (delivery-note linkage) -> none
- L46-59 — indirect_other — pickShippedCourierTrackingCode -> none
- L61-85 — indirect_other — getLatestTrackableCompanyParcel (feeds status sync) -> none

### src/hooks/useTrackedOrders.ts
- L20-63 — indirect_other — set of order_ids with tracking_code (delivery-rate denom base); no status read -> none

### src/pages/admin/Webhooks.tsx
- L83,96-103 — indirect_other — dead statusMapSchema/provider_statuses constant (declared, unused) -> remove or repoint to package_statuses mapping; cleanup [Stage F]
- L311-385 — indirect_other — webhook_logs event table (processed bool, no status) -> none

---

### DELIVERY & RETURN NOTES

### src/pages/admin/DeliveryNote.tsx
- L5 — status_hook_or_resolver — imports matchPackageStatus -> keep; return master id/flags [Stage C]
- L120-131 — read_status_id — ad-hoc package-statuses-icons fetch (active && show_in_courier) -> replace with hub hook; pull flags [Stage E]
- L133-146 — status_hook_or_resolver — local matchPkgStatus resolver -> delete; use centralized resolver/hook [Stage E]
- L156-169 — status_ui_display — courier synth timeline status_label/status_color + 'Nouveau'/'#3b82f6' -> derive from parcel.status_id via master; drop literals [Stage E]
- L213-256 — tracking_sync — track_parcel result; matchPackageStatus; UPDATE company_parcels status_id+label+color+real_time_* -> keep status_id; auto-derive caches [Stage B/C]
- L278-343 — write_status_id — confirmRemoveParcelFromNote RPC (trigger reverts PROCESSED->CONFIRMED) -> verify RPC/trigger keys on master codes/flags [Stage D]
- L539-645 — write_status_id — handleFinalizeNote queries order_statuses codes PROCESSED&CONFIRMED then UPDATE -> replace inline code fetch with hub status-by-code map [Stage B]
- L647-738 — write_status_id — handleReopenNote (does NOT touch order status) -> none
- L741-830 — write_status_id — handleDeleteNote RPC reverts PROCESSED->CONFIRMED -> verify RPC keys on master codes/flags [Stage D]
- L846-884 — read_status_id — fetchNoteDetails selects parcels status_id + status_label/status_color -> prefer status_id; drop caches from select [Stage E]
- L886-959 — tracking_sync — per-parcel get_parcel_info; matchPackageStatus; UPDATE status_id+label+color; local obj exposes RAW provider label -> keep status_id; remove cache writes; note raw label feeds badge later [Stage B/C]
- L1017-1028 — status_ui_display — getStatusBadge hardcoded 'delivered'/'pending'/'picked_up' (legacy/unused) -> remove or rewrite to master flags; confirm no caller [Stage C]
- L1668-1689 — status_ui_display — preview parcel cell matchPkgStatus(real_time_status_label||status_label,...) fallback 'Nouveau'/'#10b981' -> resolve via status_id; drop literals [Stage E]
- L1693-1705 — status_ui_display — tracking button on tracking_code -> none
- L2090-2128 — status_ui_display — timeline statusMap hardcoded provider-CODE->FR labels + situationMap PAID/NOT_PAID/INVOICED -> replace statusMap with master delivery_service_statuses resolution; keep situationMap (payment) [Stage C/E]
- L2144-2146 — status_ui_display — timeline pill color matched?.color||eventColor||'#94a3b8' -> derive from master; drop fallbacks [Stage E]
- L2226-2236 — status_ui_display — delete dialog hardcoded 'confirmed' revert wording -> optional: source from master CONFIRMED row [Stage E]

### src/pages/seller/DeliveryNote.tsx
- L5 — status_hook_or_resolver — imports matchPackageStatus -> none (keep)
- L114-126 — read_status_id — ad-hoc package-statuses-icons fetch -> also select flags if badge derives delivered/returned [Stage E]
- L128-141 — status_hook_or_resolver — local matchPkgStatus duplicate -> replace with usePackageStatusResolver [Stage E]
- L177-194 — hardcoded_status_literal — courier synth history 'Nouveau'/'#3b82f6' from caches -> resolve from status_id/flags [Stage E]
- L234-279 — write_status_id — handleTrackParcel matchPackageStatus then write status_id+label+color+real_time_* -> keep status_id; stop cache writes [Stage B/C]
- L301-367 — write_status_id — confirmRemoveParcelFromNote RPC revert -> none (DB trigger); ensure CONFIRMED id/flags [Stage D]
- L613-642 — write_status_id — handleFinalizeNote queries PROCESSED+CONFIRMED codes then UPDATE -> code-based lookup is correct; optionally hub helper [Stage B]
- L727-729 — write_status_id — handleReopenNote leaves status untouched -> none
- L803-809 — write_status_id — handleDeleteNote RPC revert -> none (DB)
- L889-903 — read_status_id — fetchNoteDetails parcels status_id + status_label/status_color -> prefer master join on status_id [Stage E]
- L905-977 — tracking_sync — fetchNoteDetails get_parcel_info; matchPackageStatus; write status_id+label+color; local obj stores RAW provider label/color -> keep status_id; drop cache writes [Stage B/C]
- L1037-1048 — status_ui_display — getStatusBadge hardcoded 'delivered'/'pending'/'picked_up' (unused) -> remove or replace with PackageStatusBadge/flags [Stage C]
- L1595-1617 — status_ui_display — preview parcel matchPkgStatus fallback 'Nouveau'/'#10b981' -> drive from status_id; remove literals [Stage E]
- L2009-2025 — hardcoded_status_literal — timeline statusMap raw-code->FR label dictionary -> replace with master delivery_service_statuses mapping [Stage C/E]
- L2029-2069 — status_ui_display — timeline event render; situationMap + matchPkgStatus -> delivery portion via resolver; situationMap (payment) leave [Stage E]
- L2086-2088 — status_ui_display — timeline node label/color matched?.color||eventColor -> derive from resolver [Stage E]
- L2197-2211 — status_ui_display — delete-confirm copy 'confirmée' -> none (display copy)

### src/pages/admin/ReturnNote.tsx
- L31-36 — hardcoded_status_literal — 3 hardcoded master UUIDs (RETOURNE_PACKAGE_STATUS_ID, RETURN_ORDER_STATUS_ID, CONFIRMER_ORDER_STATUS_ID) -> resolve via is_returned/is_confirmed flags from hub; drop literal UUIDs [Stage C]
- L114-135 — read_status_id — retourne-orders filter .eq('package_status_id', RETOURNE...) -> filter on is_returned flag id-set [Stage C]
- L130 — flag_usage — .neq('source_review_status','pending') sync gate -> none
- L349-394 — write_status_id — markReceivedMutation writes order_status_id=RETURN_ORDER_STATUS_ID -> resolve returned status via is_returned flag [Stage C]
- L403-480 — write_status_id — unlockNoteMutation reverts via order_status_history vs RETURN id, fallback CONFIRMER -> resolve RETURN/CONFIRMER via flags [Stage C]
- L349-364 — status_hook_or_resolver — markReceived relies on RETURN-keyed stock trigger -> align trigger + writer on flag-derived id [Stage C/D]
- L568-585 — category_logic — filter notes by note.status ('pending'/'received') -> none (note lifecycle)
- L662-838 — status_ui_display — handlePrint badge by note.status -> none
- L976-1156 — status_ui_display — note card list isReceived -> none
- L1485-1571 — status_ui_display — wizard Review step -> none (depends on L114 flag filter centralized)
- L1576-1753 — status_ui_display — view-note modal note.status -> none

### src/pages/seller/ReturnNote.tsx
- L25-28 — hardcoded_status_literal — 2 hardcoded UUIDs (RETOURNE_PACKAGE_STATUS_ID, RETURN_ORDER_STATUS_ID) -> resolve via flags from hub [Stage C]
- L108-136 — read_status_id — returnOrders filter .eq('package_status_id', RETOURNE...) -> .in('package_status_id', returnedIds) from is_returned flag [Stage C]
- L342-365 — write_status_id — markReceivedMutation writes order_status_id=RETURN... -> resolve via is_returned flag [Stage C]
- L371-396 — category_logic — filter notes by n.status -> none (note lifecycle)
- L281-340 — write_status_id — generateNoteMutation sets note linkage; pickShipped* helpers -> if helpers branch on labels/flags, route through resolver [Stage C]
- L581,738-786,1146-1148,1211 — status_ui_display — note status pills -> none

### src/components/delivery/DeliveryNoteWizard.tsx
- L5 — status_hook_or_resolver — imports matchPackageStatus -> none (centralized)
- L8,339 — status_hook_or_resolver — useStatusCategories + getOrderByCategory -> none
- L340 — read_status_id — confirmedStatusId = getOrderByCategory('confirmed')?.id -> none
- L351-416 — category_logic — availableProviders filters order_status_id==confirmedStatusId -> none
- L419-477 — category_logic — ordersGrouped filters confirmedStatusId -> none
- L504-538 — read_text_label — exchange guard on provider_type + replace; Vitex 'Livré' info text -> none
- L656-663 — status_hook_or_resolver — maps create-parcel response via matchPackageStatus -> none; could drop cache writes [Stage C]
- L676-692 — write_status_id — insert company_parcels status_id + status_label/status_color caches -> keep status_id; drop caches on removal [Stage B]
- L734-741,768-770 — tracking_sync — refetchOrderForRetry + retryParcel -> none (inherits above)
- L749-762,1010-1015,1277-1284 — tracking_sync — syncLinkedParcelStatuses -> none
- L942-983 — category_logic — Coliaty 'déjà dans un bon' ILIKE (pickup-note) -> none (excluded)
- L992-1005,1265-1274 — write_status_id — RPC link_company_parcels_to_delivery_note (CONFIRMED->PROCESSED) -> none; audit RPC separately [Stage D]
- L657 — hardcoded_status_literal — default 'Nouveau' fed to matchPackageStatus -> replace with getPkgByCategory('new') [Stage E]
- L1043,1107,1180 — status_ui_display — toast strings -> none
- L1622-1630 — read_text_label — search haystack *_old_tracking -> none

### src/components/delivery/CourierDeliveryNoteWizard.tsx
- L5,145 — status_hook_or_resolver — useStatusCategories + getOrderByCategory/getPkgByCategory -> none
- L146 — read_status_id — confirmedStatusId -> none
- L147 — read_status_id — newPkgStatus = getPkgByCategory('new') -> none
- L158-230 — category_logic — availableCouriers filters confirmedStatusId -> none
- L233-293 — category_logic — ordersGrouped filters confirmedStatusId -> none
- L326-346 — write_status_id — insert courier_parcels status_id + status_label/status_color caches + 'Nouveau'/'#3b82f6' fallback -> keep status_id; drop caches; remove literals [Stage B/E]
- L333-335 — hardcoded_status_literal — 'Nouveau'/'#3b82f6' fallback -> rely on hub 'new'; fail loud instead of hardcoding [Stage E]
- L408-425 — write_status_id — insert courier_delivery_notes status_id -> none; remove ||null silent fallback
- L433-440 — write_status_id — RPC link_courier_parcels_to_delivery_note -> none; audit RPC [Stage D]
- L459,549 — status_ui_display — toast copy -> none

### src/pages/admin/tools/bonLivraison/BonLivraisonPdfDocument.tsx
- L169-184 — status_ui_display — parcel 'Statut' column from p.status_label (frozen snapshot) -> hydrate helper should resolve label from master via status_id; component renders resolved string [Stage E]

### src/lib/bonLivraison/hydrate.ts
- L14-40 — status_hook_or_resolver — loadPkgStatusResolver: build-time replica of usePackageStatusResolver (byDss/byLabel/byCode) -> replace with centralized resolver (non-React export); resolve to id + flags [Stage E]
- L142-157 — read_text_label — hydrateBonLivraisonFromOrder reads company_parcels.status_label -> read status_id, derive label from master [Stage E]
- L197-258 — read_text_label — hydrateBonLivraisonFromCompanyNote reads company_parcels.status_label -> read status_id, derive from master [Stage E]
- L299-360 — read_text_label — hydrateBonLivraisonFromCourierNote reads courier_parcels.status_label -> read status_id, derive from master [Stage E]

### src/lib/bonLivraison/types.ts
- L11-19 — read_text_label — BonLivraisonParcelSnapshot.status_label?:string -> carry master status ref (id/flags); derive label as resolver output [Stage E]

---

### COURIER

### src/pages/courier/Dashboard.tsx
- L24,82 — status_hook_or_resolver — usePackageStatusResolver -> resolve by id once parcels carry status_id [Stage E]
- L31-37 — read_status_id — PkgStatus type id/label/color/category/recheck -> keep id; drop category string + recheck once flags exist [Stage E]
- L39-53,107-141 — read_status_id — courier_parcels joins status:package_statuses + reads status_label/status_color; status_category fallback (s?.label||p.status_label) -> read status_id + flags; drop denorm fallback; replace category string [Stage C/E]
- L163-198 — category_logic — stats branch on status_category literals ('delivered','returned','cancelled','refused') -> replace with is_delivered/is_returned/is_cancelled/refused flags [Stage C]
- L220-247 — category_logic — statusProportions hardcoded category->{name,color} + collapse map + hex colors -> drive names/colors from master category/color; collapse on category ids/flags [Stage C/E]
- L475-519 — status_ui_display — recent-activity pill resolvePkgStatus(status_label,...) + status_color dot -> resolve by status_id; drop status_color cache [Stage E]

### src/pages/courier/Orders.tsx
- L7,96,646 — status_hook_or_resolver — usePackageStatusResolver -> resolve by status_id [Stage E]
- L40-49 — read_status_id — PackageStatus type mirrors master -> add/consume flags; reduce category reliance [Stage E]
- L76-90 — category_logic — TABS match on category literals ('new'/'postponed'/'delivered'/'returned') + recheck -> replace with is_new/pending_confirmation/is_delivered/is_returned + recheck flags [Stage C]
- L123-136 — read_status_id — loads package_statuses master list -> keep id-driven; expose flags for picker [Stage C]
- L138-188 — read_status_id — courier_parcels select status_id/status_label/status_color + join; synthesizes fake PackageStatus from caches when join missing -> read status_id + join; remove synthetic fallback [Stage E]
- L217-223 — category_logic — counts via TABS matchers -> recompute via flags [Stage C]
- L225-270 — read_text_label — searchableRows includes parcel_status?.label/code; filteredRows tab.match -> label-in-haystack low risk; tab.match move to flags [Stage C]
- L299-334 — write_status_id — updateStatusMutation writes status_id+status_label+status_color -> write status_id only; stop cache writes [Stage B/C]
- L336-341 — category_logic — kpiTiles from category-string counts -> flag-based counts [Stage C]
- L473-533,551-599 — status_ui_display — cards + table pill resolvePkgStatus fallback 'Nouveau' -> resolve by status_id; drop literals [Stage E]
- L654-660,716-746 — status_ui_display — Sheet ink status card; fallback 'Non défini' -> resolve by status_id; remove fallbacks [Stage E]
- L749-799 — status_ui_display — status picker filtered by s.label && category!=='other'; recheck->'Suivi' badge -> filter by semantic flags not category string; keep id current-detection [Stage C/E]

---

### MEDIABUYER / CAMPAIGNS

### src/pages/mediabuyer/Dashboard.tsx
- L29 — indirect_other — useMediaBuyerStats (delivered/confirmed upstream) -> none (hook)
- L30 — indirect_other — useMediaBuyerEarnings (delivered_orders upstream) -> none
- L119-123 — status_ui_display — sparkline d.delivered->'Livré' -> none
- L202-203 — status_ui_display — KPI tiles delivered/confirmed -> none (hook centralizes via flags)
- L267,323,442-450 — status_ui_display — sparkline/top-campaign/month-earnings delivered counts -> none

### src/pages/mediabuyer/Statistics.tsx
- L36 — indirect_other — useMediaBuyerStats -> none
- L188-204 — status_ui_display — chartData delivered/confirmed/rates/CPC/CPD -> none
- L328-334,341-362 — status_ui_display — KPI tiles -> none
- L447-463,476-502 — status_ui_display — charts -> none
- L574,593,643-644,711,768,773,786,789,791 — status_ui_display — leaderboards/rollup -> none

### src/pages/mediabuyer/Payments.tsx
- L30 — indirect_other — useMediaBuyerEarnings delivered_orders -> none (hook)
- L44,230,342,405,506,533 — status_ui_display — delivered_orders 'Livrées' -> none
- L46,307-337,417-441,472-476 — indirect_other — payout.status/payment_type pills -> none (payout state machine, excluded)

### src/pages/mediabuyer/CampaignManage.tsx
- L110 — indirect_other — useCampaignMetrics (confirmed/delivered/rates upstream) -> none (hook)
- L302-306 — status_ui_display — KPI strip Confirmed/Delivered -> none
- L428-486 — status_ui_display — daily table -> none
- L243-280 — status_ui_display — campaign.status==='active' pill -> none (campaign state machine)

### src/pages/mediabuyer/CampaignPreview.tsx
- L269 — indirect_other — useCampaignMetrics -> none (hook)
- L341-348 — category_logic — dayRanks by d.revenue/d.delivered -> none (downstream)
- L350-367 — status_ui_display — chartData confirmed/delivered/rates -> none
- L602-635 — status_ui_display — lifetime tiles -> none
- L557-582 — status_ui_display — commission setup delivered×price -> none
- L769-814 — status_ui_display — KPI tiles + sparklines -> none
- L944-1001 — status_ui_display — daily breakdown table -> none
- L395-397,103,431-434 — status_ui_display — campaign.status==='active' -> none (excluded)

---

### SELLER

### src/pages/seller/Dashboard.tsx
- L3 — status_hook_or_resolver — useStatusCategories -> none
- L5-10 — category_logic — commission helpers (computeUnpaidCommission/isDeliveredForCommission/isDeliveredOnLocalDay) -> ensure read delivered via is_delivered flag [Stage D]
- L11 — category_logic — isAdminPullback/isRateConfirmed -> none (lib flag-driven) [Stage D]
- L66 — status_hook_or_resolver — statusCats instance -> none
- L95 — category_logic — useEffect deps on confirmedIds/deliveredPkgIds/pendingIds sizes -> none
- L159-163 — read_status_id — orders select order_status_id/package_status_id/package_status_label + order_statuses(code)/package_statuses(label) -> drop package_status_label + code reliance [Stage E]
- L165-171 — read_text_label — status=code.toLowerCase(); packageStatus=package_status_label.toLowerCase() -> replace with master-id lookup + flags [Stage E]
- L173 — category_logic — isDelivered via isDeliveredForCommission -> none
- L202-205 — category_logic — isPending via pendingIds -> none
- L207-211 — category_logic — deliveredToday via isDeliveredOnLocalDay -> none
- L213-225 — category_logic — delivered count + delivery rate via isAdminPullback -> none
- L228-229 — category_logic — rateConfirmedCount via isRateConfirmed -> none
- L242-249 — category_logic — computeUnpaidCommission -> none
- L289-307 — category_logic — per-product trackedSet/isAdminPullback/isDelivered -> none
- L327-330 — status_ui_display — getStatusStyle via getOrderStatusColor -> none
- L586-588 — status_ui_display — recent-order pill via getStatusStyle -> none
- L612-625 — status_ui_display — pill label = order.status.replace('_',' ') (raw code) -> render label from master label via hub by id [Stage E]

### src/pages/seller/Statistics.tsx
- L3 — status_hook_or_resolver — useStatusCategories -> none
- L4-5 — category_logic — commission + isAdminPullback helpers -> none [Stage D]
- L71 — status_hook_or_resolver — statusCats -> none
- L119 — category_logic — useEffect deps -> none
- L140-144 — read_status_id — orders select package_status_label + code/label -> drop text reliance; ids + flags [Stage E]
- L146-153 — read_text_label — status=code.toLowerCase(); packageStatus=package_status_label.toLowerCase() -> derive from master id + flags [Stage E]
- L179 — category_logic — hasTracking helper -> none
- L181 — category_logic — isDelivered via isDeliveredForCommission -> none
- L186 — category_logic — isConfirmedOrBeyond via confirmedIds -> none
- L187 — category_logic — isFake via isOrderInCategories(...,['fake','double']) -> replace 'fake'/'double' magic-strings with flags/enum [Stage C/F]
- L189-200 — status_ui_display — status distribution by id -> none
- L203-210 — category_logic — regional filter by isDelivered -> none
- L219-243 — category_logic — per-product trackedSet/isAdminPullback/isDelivered -> none
- L284-310 — category_logic — counts; fakeOrders via isFake -> fix fake/double [Stage C]
- L313-320 — category_logic — rateConfirmedCount -> none
- L322-331 — category_logic — delivery rate + integrityScore -> none beyond fake fix
- L344-354 — category_logic — computeUnpaidCommission -> none
- L477-500 — status_ui_display — distribution bars -> none

### src/pages/seller/Profile.tsx
- L3 — status_hook_or_resolver — useStatusCategories -> none
- L4 — category_logic — isDeliveredForCommission -> verify deliveredPkgIds/is_delivered [Stage D]
- L5 — category_logic — isAdminPullback -> ensure flags not label ILIKE [Stage D]
- L80 — status_hook_or_resolver — statusCats -> none
- L117-119 — status_hook_or_resolver — useEffect refetch on confirmedIds/deliveredPkgIds -> none
- L153-167 — read_status_id — orders select package_status_label + code/label -> drop package_status_label [Stage E]
- L196 — category_logic — delivered via isDeliveredForCommission -> none
- L200-209 — category_logic — confirmation rate via pendingIds -> none
- L212-218 — category_logic — delivery rate via isAdminPullback -> none
- L221-224 — category_logic — performance tier (numeric) -> none
- L246-248 — read_status_id — order_items join orders select package_status_label + code/label -> drop package_status_label [Stage E]
- L319-322 — category_logic — per-product confirmed via confirmedIds -> none
- L292-304 — category_logic — per-product tracked/pullback -> none
- L325-332 — category_logic — per-product rateConfirmed -> none
- L334-337 — category_logic — per-product delivered -> none
- L72-76 — category_logic — getDeliveryRate/getConfirmRate -> none
- L713-716,886-960,985-1146 — status_ui_display — performance cards/modal (status-derived) -> none

---

### ANALYTICS

### src/lib/analyticsDefinitions.ts
- L28-34 — category_logic — imports CONFIRMED/CANCELLED/DELIVERED/RETURNED/SHIPPED category-string sets -> replace with flag-derived id-sets from hub [Stage C/F]
- L84-105 — read_status_id — AnalyticsOrder carries order_status_id/package_status_id/package_status_label + joined label/category -> drop label/category text; keep ids [Stage E]
- L124-126 — status_hook_or_resolver — isDelivered() via deliveredPkgIds -> source from is_delivered flag [Stage C]
- L133-135 — category_logic — isPaid() via paidOrderIds -> is_paid flag [Stage D]
- L141-147 — category_logic — isRevenueOrder() delivered AND paid -> is_delivered + is_paid flags [Stage D]
- L176-184 — category_logic — isConfirmed() via confirmedOrderIds OR tracking -> is_confirmed flag [Stage C]
- L206-216 — category_logic — isRateConfirmed() NOT in pendingOrderIds OR tracking -> is_new/pending_confirmation flags [Stage C]
- L233-243 — category_logic — isAdminPullback() via pullback id-sets, gated on tracking -> is_cancelled + new excluded/hors-zone flag [Stage C/D]
- L253-262 — category_logic — isInDeliveryDenominator() tracked minus pullback -> follow flag migration [Stage C]
- L284-286 — category_logic — isFailed() via cancelledOrderIds -> is_cancelled flag [Stage C]
- L288-291 — read_status_id — isShipped() via orders.tracking_number (legacy, null in prod) -> reconcile with is_shipped/tracked-parcel source [Stage C]
- L293-296 — category_logic — isReturned() via returnedPkgIds -> is_returned flag [Stage C]
- L298-306 — category_logic — isProvisional() delivered AND unpaid -> is_delivered + is_unpaid flags [Stage D]
- L443-448 — status_hook_or_resolver — deliveryTimestamp() date_livraison||updated_at -> none (date logic; coupled to delivered)
- L587-594 — category_logic — re-exports the 5 category-string sets -> re-export flag-derived id-sets [Stage F]

### src/lib/commercialCommission.ts
- L5-14 — status_hook_or_resolver — docstring delivered keyed on category='delivered' -> document/source via is_delivered flag [Stage D]
- L28-33 — category_logic — isDeliveredForCommission() via deliveredPkgIds -> source from is_delivered flag [Stage D]
- L40-45 — category_logic — isConfirmed() via confirmedIds -> is_confirmed flag [Stage D]
- L99-120 — status_hook_or_resolver — deliveryTimestampForMetrics/isDeliveredOnLocalDay -> none (date; coupled)
- L122-198 — category_logic — commissionAccrued/totalAccrued/computeUnpaidCommission over delivered-filtered -> none (inherits isDelivered flag) [Stage D]

### src/components/analytics/AdsSection.tsx
- L8 — status_hook_or_resolver — useStatusCategories -> none [Stage D]
- L38-47 — status_hook_or_resolver — analyticsDefinitions helpers -> retarget internals to flags [Stage C]
- L102-110 — read_status_id — AdsOrderForMatching carries package_status_id/order_status_id -> none
- L113 — category_logic — destructures deliveredPkgIds/pendingIds -> none
- L160 — read_status_id — select package_status_id/order_status_id only -> none
- L216-228 — category_logic — classify() isDelivered + isConfirmed via pendingIds -> replace pendingIds with pending_confirmation/is_new flag; delivered via is_delivered [Stage C]
- L239-250 — category_logic — recordOrder() -> flows from classify() [Stage C]
- L314-325,340-352,466-495 — category_logic — platform-bucket/trend via classify()/isDelivered -> inherits [Stage C]

### src/components/analytics/BusinessHealthSection.tsx
- L1-15 — status_hook_or_resolver — useStatusCategories + isAdminPullback/isDelivered/isRateConfirmed/isRevenueOrder -> retarget to flags [Stage C/D]
- L45 — category_logic — destructures confirmedIds/cancelledIds/deliveredPkgIds/paidOrderIds/pendingIds/pullback -> none
- L53 — read_status_id — select order_status_id/package_status_id/package_status_label + join(label,category) -> drop package_status_label + label/category [Stage E]
- L96-108 — category_logic — delivered/rateConfirmed/delivery-denom -> migrate helpers to flags [Stage C]
- L111-112 — category_logic — revenueOrders via isRevenueOrder -> is_paid+is_delivered [Stage D]
- L123 — category_logic — failedCount via cancelledIds -> is_cancelled flag [Stage C]
- L183-192 — category_logic — trend recompute -> inherits [Stage C]

### src/components/analytics/CouriersSection.tsx
- L1-13 — status_hook_or_resolver — useStatusCategories + isAdminPullback/isDelivered/isReturned -> retarget to flags [Stage C]
- L35-44 — read_status_id — OrderRow carries package_status_label + join(label,category) -> drop label/category [Stage E]
- L53 — category_logic — destructures deliveredPkgIds/returnedPkgIds/pullback -> none
- L74 — read_status_id — select package_status_label + join -> remove denorm + join label/category [Stage E]
- L126-134 — category_logic — delivered/returned/pullback per courier -> migrate to is_delivered/is_returned flags [Stage C]
- L152-157 — category_logic — overall window -> inherits [Stage C]

### src/components/analytics/CustomersSection.tsx
- L29-37 — status_hook_or_resolver — isRevenueOrder/pureRevenueForOrder + useStatusCategories -> retarget [Stage D]
- L47 — category_logic — destructures deliveredPkgIds/paidOrderIds -> none
- L54 — read_status_id — select order_status_id/package_status_id (no labels) -> none
- L101-103 — category_logic — revenue via isRevenueOrder -> is_paid+is_delivered flags [Stage D]

### src/components/analytics/InventorySection.tsx
- L11 — status_hook_or_resolver — useStatusCategories -> none
- L19 — category_logic — destructures deliveredPkgIds -> none
- L52-53,61 — read_status_id — order_items join orders(order_status_id/package_status_id) -> none
- L119-127 — category_logic — units/revenue/COGS only when package_status_id in deliveredPkgIds -> replace with is_delivered flag check [Stage C]

### src/components/analytics/OrdersSection.tsx
- L1-14 — status_hook_or_resolver — useStatusCategories + isAdminPullback/isDelivered/isFailed/isRateConfirmed -> retarget to flags [Stage C]
- L35-42 — category_logic — destructures cancelledIds/pendingIds/pullback/deliveredPkgIds -> none
- L49 — read_status_id — select package_status_label + join(label,category) -> drop [Stage E]
- L74-90 — category_logic — deliveredCount/failedCount/rateConfirmedCount/delivery-denom -> migrate to is_delivered/is_cancelled/pending flags [Stage C]
- L152-156 — status_ui_display — funnelData stages -> none (downstream)

### src/components/analytics/MediaBuyersSection.tsx
- L4,80 — status_hook_or_resolver — useStatusCategories destructures deliveredPkgIds -> repoint to is_delivered flag [Stage D]
- L6-7 — category_logic — commissionAccruedForDeliveredOrder/isDeliveredForCommission -> ensure consume master id-set [Stage D]
- L63-66 — read_status_id — MBOrderRow carries package_status_label + join(label,category) -> drop label cache + category join [Stage E]
- L127 — read_status_id — select package_status_label + join -> replace with package_status_id + is_delivered flag [Stage E]
- L293-299 — category_logic — isDeliveredForCommission gates delivered bucket -> keep id-set from is_delivered flag [Stage D]
- L408 — category_logic — useMemo dep deliveredPkgIds -> none

### src/components/analytics/ProfitabilitySection.tsx
- L4,55 — status_hook_or_resolver — useStatusCategories destructures deliveredPkgIds/returnedPkgIds/paidOrderIds/unpaidOrderIds -> from flags [Stage D]
- L6-20 — category_logic — isRevenueOrder/isReturned/isProvisional/timestamps -> take master id-sets/flags [Stage D]
- L64 — read_status_id — select package_status_label + order_statuses(code)/package_statuses(label,category) -> drop text reads; ids + flags [Stage E]
- L263-274 — category_logic — revenueOrders/provisionalOrders/returnedOrders -> id-sets from flags [Stage D]
- L533-535 — category_logic — convertedFromPlacedCohort -> none beyond hub [Stage D]
- L437-457,520-524 — category_logic — trend buckets -> none [Stage D]
- L565-569 — category_logic — useMemo deps -> none

### src/components/analytics/SalesChannelsSection.tsx
- L4,85 — status_hook_or_resolver — useStatusCategories destructures deliveredPkgIds/paidOrderIds -> from flags [Stage D]
- L8,141-143 — category_logic — isRevenueOrder gates converted + revenue -> id-sets from flags [Stage D]
- L92 — read_status_id — select package_status_label + join(label,category) -> drop text; ids + flags [Stage E]
- L227 — category_logic — useMemo deps -> none

### src/components/analytics/SellersSection.tsx
- L15,34 — status_hook_or_resolver — useStatusCategories destructures deliveredPkgIds/paidOrderIds/pullback -> from flags [Stage D]
- L16,35,197 — tracking_sync — useTrackedOrders -> none; ensure parcel status_id sourcing consistent
- L18-26 — category_logic — isDelivered/isRevenueOrder/isAdminPullback -> consume master id-sets [Stage C/D]
- L55 — read_status_id — select package_status_label + join(label,category) -> drop text [Stage E]
- L185-200 — category_logic — per-seller revenue/delivered/pullback -> id-sets from flags [Stage D]
- L231 — category_logic — useMemo deps -> none

### src/components/analytics/ShippingSection.tsx
- L4,46 — status_hook_or_resolver — useStatusCategories destructures deliveredPkgIds/returnedPkgIds/pullback -> from flags [Stage D]
- L5,47,104 — tracking_sync — useTrackedOrders shippedOrders -> ensure shipped consistent with is_shipped flag [Stage C]
- L6-15 — category_logic — isDelivered/isReturned/isAdminPullback/deliveryTimestamp -> consume master id-sets [Stage C]
- L54 — read_status_id — select package_status_label + join(label,category) -> drop text [Stage E]
- L107-142 — category_logic — delivered/returned/pullback/rates/shipping/avgDays/stuck -> id-sets from flags [Stage C]
- L169-175,238-246 — category_logic — per-fulfiller + trend -> none beyond hub [Stage C]
- L265 — category_logic — useMemo deps -> none

### src/components/CustomerInsights.tsx
- L3,53 — status_hook_or_resolver — useStatusCategories destructures deliveredPkgIds/cancelledIds/returnedPkgIds/pullback -> from is_delivered/is_cancelled/is_returned flags [Stage C]
- L4,5,6 — category_logic — useTrackedOrders/isDeliveredForCommission/isAdminPullback -> consume master id-sets [Stage C/D]
- L33-44 — read_status_id — OrderRecord carries status_code/status_label/status_color/package_status_code text mirrors -> replace with id + flags; drop status_color '#999' default [Stage E]
- L83-84,106-120 — read_text_label — joins order_statuses(code,label,color)/package_statuses(code,label) mapped to text mirrors -> drop label/color/code reads; display via master id/PackageStatusBadge [Stage E]
- L146-149 — category_logic — isDelivered + isFailed (cancelledIds||returnedPkgIds) -> id-sets from flags [Stage C]
- L155-161 — category_logic — delivery rate denom via isAdminPullback -> none beyond hub [Stage C]
- L163 — category_logic — useMemo deps -> none
- L194-221 — status_ui_display — risk tiles + delivery-rate bar -> none (derived)

---

### DASHBOARDS

### src/components/dashboard/ConfirmationPipeline.tsx
- L8,18 — status_hook_or_resolver — useStatusCategories destructures pendingIds + getOrderStatusColor -> none (pending_confirmation flag target)
- L26 — read_status_id — select order_status_id + join order_statuses(code,label) -> none
- L64-69 — category_logic — confirmationOrders via pendingIds + not tracked -> none
- L72-78 — status_ui_display — group by order_status_id, label from join -> none
- L80-87,113-119,129-132,161-167 — status_ui_display — segments via getOrderStatusColor(id) -> none

### src/components/dashboard/DashboardCityStats.tsx
- L9,36 — status_hook_or_resolver — useStatusCategories destructures deliveredPkgIds/pullback -> none
- L11,101,120-125,134 — category_logic — isAdminPullback + pureRevenueForOrder -> none
- L45,80-81 — read_status_id — select package_status_id/package_status_label + join(label) -> drop package_status_label cache (unused) [Stage E]
- L118-130 — category_logic — delivery-rate denom -> none
- L134-140 — category_logic — delivered via deliveredPkgIds -> none

### src/components/dashboard/DashboardKPICards.tsx
- L15,47-57 — status_hook_or_resolver — useStatusCategories (confirmedIds/cancelledIds/pendingIds/pullback/deliveredPkgIds/returnedPkgIds/getPkgsByCategories/isPkgCategory) -> none
- L17-25 — category_logic — isAdminPullback/isDelivered/isFailed/isRateConfirmed -> none (flag-driven)
- L65 — read_status_id — select package_status_label + join(label,category) -> drop cache; category via join (status-categories dep) [Stage E]
- L111-122 — flag_usage — getPkgsByCategories(['in_transit','out_for_delivery','picked_up','pickup_pending']) + ['refused'] -> map category strings to master flags/category after centralization [Stage C/F]
- L124,130,137-141,143-148 — category_logic — delivered/rateConfirmed/delivery-denom -> none
- L154-168 — category_logic — pendingConfirmation/enCoursLivraison/canceled/refused via isPkgCategory('refused') -> refused via flag; rest id-sets [Stage C]
- L201,220,236,244,253,262 — write_status_id — nav passes filterStatusIds/filterPackageStatusIds + filterStatusLabel English literal -> none for ids; filterStatusLabel display-only [Stage E]

### src/components/dashboard/DashboardProductsPerformance.tsx
- L9,117-126 — status_hook_or_resolver — useStatusCategories (deliveredPkgIds/pendingIds/pullback/orderStatuses/packageStatuses/color resolvers) -> none
- L12-16,382,468,486,507 — category_logic — isDeliveredForCommission + isAdminPullback -> none
- L46-52,183 — read_status_id — select package_status_label + join(code,label,category) -> drop cache; category via join [Stage E]
- L360-389 — category_logic — funnel confirmed/delivered via pendingIds/isDeliveredForCommission (empty-set guard) -> none
- L452-470,478-488 — category_logic — sources + dropoff -> none
- L491-538 — status_ui_display — StatusQueueEntry pills by id + master label/color -> none

### src/components/dashboard/DashboardSellersPerformance.tsx
- L9,97-106 — status_hook_or_resolver — useStatusCategories -> none
- L12-19 — category_logic — commission + isAdminPullback helpers -> none
- L46-69,137 — read_status_id — select package_status_label + joins(code,label,category) -> drop cache [Stage E]
- L249,276-293,301-306,347 — category_logic — delivered/confirmed/delivery-denom -> none
- L324-383 — status_ui_display — preConf/postConf pills by id -> none

### src/components/dashboard/PendingOrdersBreakdown.tsx
- L9,29 — status_hook_or_resolver — useStatusCategories destructures pendingIds -> none
- L37 — read_status_id — select order_status_id + tracking_number -> none
- L71-81 — category_logic — pending via pendingIds + not tracked -> none

### src/components/dashboard/SalesComparatifChart.tsx
- L33,66 — status_hook_or_resolver — useStatusCategories destructures deliveredPkgIds -> none
- L34-35,135-136 — category_logic — isRevenue via isDeliveredForCommission -> none
- L46-57,73 — read_status_id — select package_status_label + join(label) -> drop cache after centralization (logic uses package_status_id only) [Stage E]

### src/components/dashboard/SellerSelfPerformanceSection.tsx
- L7,55-64 — status_hook_or_resolver — useStatusCategories -> none
- L10-17 — category_logic — commission + isAdminPullback -> none
- L31-48,96 — read_status_id — select package_status_label + joins(code,label,category) -> drop cache [Stage E]
- L152-180,221 — category_logic — confirmed/delivered/delivery-denom -> none
- L193-256 — status_ui_display — preConf/postConf pills by id -> none

### src/components/dashboard/ShippingPipeline.tsx
- L9,25 — status_hook_or_resolver — useStatusCategories (getPkgStatusColor/shippedPkgIds/deliveredPkgIds/returnedPkgIds/pullback) -> none
- L11,161-167,234-235 — category_logic — isAdminPullback -> none
- L33,80-84,127 — read_status_id — select package_status_label; statusDist label uses package_status_label||statusId -> L127 reads denorm cache as pill label; derive label from master by id [Stage E]
- L102-117 — category_logic — isInShipLifecycle/delivered/returned/inTransit via id-sets -> none (flags)
- L123-138 — status_ui_display — statusDist color via getPkgStatusColor(id), label via package_status_label cache -> label from master row not cache [Stage E]
- L154-176 — category_logic — per-fulfiller bump -> none

---

### PAYMENTS / COMMISSION / SALARIES

### src/pages/admin/Payments.tsx
- L23,66 — status_hook_or_resolver — useStatusCategories (getOrderByCategory/getPkgByCategory/getPkgCategory) -> repoint accessors to master id/flag lookups [Stage C]
- L67-68 — category_logic — unpaidStatusId = getOrderByCategory('unpaid').id; deliveredPkgId = getPkgByCategory('delivered').id -> replace with is_unpaid/is_delivered flag queries [Stage C]
- L92-145 — read_status_id — main query order_status_id==unpaidStatusId AND package_status_id==deliveredPkgId -> filter by flag-derived ids [Stage C]
- L121-138 — category_logic — exchange leg via getPkgCategory()==='delivered'||'returned' -> derive from is_delivered/is_returned flags [Stage C]
- L376-420 — write_status_id — markPaidMutation flips note.status='paid'; DB trigger cascades order PAID + pin -> none in file; ensure cascade/pin triggers key on is_paid flag [Stage D]
- L300,352-362 — write_status_id — generateNoteMutation stamps payment_delivery_id/current_courier_payment_note_id -> none; depends on cascade trigger flags [Stage D]
- L57,84,313,378-388,428,443-444,646,819,1404-1410,1504 — hardcoded_status_literal — payment-note 'unpaid'/'paid' literals -> none (payment-note state machine, excluded)
- L24,339-341 — tracking_sync — pickShipped* helpers select parcels by shipped status -> ensure helpers select via is_shipped flag [Stage C]
- L133-135,1116-1131,1160-1168,1204-1206,1309-1311 — indirect_other — hasTracking/tracking_code only -> none

### src/pages/admin/Salaries.tsx
- L380,424,531,882,1278,1299,1321,1448-1449 — status_ui_display — 'Delivered'/delivered_orders from ledger/earnings hooks -> none in file; ensure upstream sources derive delivered via is_delivered flag [Stage D]
- L138,235-240,253-254,274-278,393-401,453-457,599,688,715-718,848-855,902-905,1166 — hardcoded_status_literal — PayoutStatus 'pending'/'partial'/'paid' -> none (payout state machine, excluded)
- L206-213,653-674,1130-1174 — indirect_other — pay_seller RPC / mediabuyer_payments inserts -> none (payout writes)

### src/lib/sendPayoutStatement.ts
- L129-140 — category_logic — queries package_statuses category='in_transit' then counts orders by package_status_id -> replace category='in_transit' literal with is_shipped/in-transit flag or hub resolver [Stage C]
- L145,254 — indirect_other — statusLabel 'Payé'/'Partiel' (payout) -> none (excluded)
- L100-127,262-275 — indirect_other — seller/mediabuyer_month_orders RPCs -> none

### src/hooks/useCampaignMetrics.ts
- L4 — status_hook_or_resolver — imports useStatusCategories -> keep [Stage B]
- L99 — status_hook_or_resolver — destructures deliveredPkgIds/pendingIds -> none if hub retains; else flag-derived sets [Stage D]
- L84-85 — read_status_id — OrderRow order_status_id/package_status_id -> none
- L162 — read_status_id — select order_status_id/package_status_id -> none
- L189,198-201 — category_logic — confirmed = NOT in pendingIds (empty-set guard) -> repoint to pending_confirmation/is_new flag [Stage D]
- L202-206 — category_logic — delivered via deliveredPkgIds + revenue -> repoint to is_delivered flag [Stage D]
- L280 — category_logic — useMemo deps -> update post-refactor [Stage D]

### src/hooks/useMediaBuyerEarnings.ts
- L4 — status_hook_or_resolver — useStatusCategories -> keep [Stage B]
- L133 — status_hook_or_resolver — destructures deliveredPkgIds -> none/else is_delivered flag set [Stage D]
- L108-113 — read_status_id — OrderRow package_status_id -> none
- L191 — read_status_id — select package_status_id -> none
- L230-235 — category_logic — buckets delivered via deliveredPkgIds -> repoint to is_delivered flag [Stage D]
- L324 — category_logic — useMemo dep -> update [Stage D]

### src/hooks/useMediaBuyerStats.ts
- L4 — status_hook_or_resolver — useStatusCategories -> keep [Stage B]
- L92 — status_hook_or_resolver — destructures deliveredPkgIds/pendingIds -> none/else flags [Stage D]
- L39-45 — read_status_id — OrderRow order_status_id/package_status_id -> none
- L150 — read_status_id — select order_status_id/package_status_id -> none
- L203,212-218 — category_logic — confirmed via pendingIds; delivered via deliveredPkgIds -> repoint to pending_confirmation/is_new + is_delivered flags [Stage D]
- L397 — category_logic — useMemo deps -> update [Stage D]

---

### OWNER / CONFIG

### src/pages/owner/Status.tsx
- L67-109 — write_status_id — statusSchema/StatusRow CRUD model (code/label/color/ranking/recheck/active/dss/perf_breakdown/show_in_*) -> none (master CRUD; canonical) [Stage B]
- L142 — write_text_label — table picker order_statuses/package_statuses -> none
- L160-172 — read_status_id — statuses query ordered by ranking -> none
- L193-253 — write_status_id — upsertMutation writes master row -> none; if new flags added to Identity form persist here too [Stage B]
- L255-268 — write_status_id — deleteMutation -> none
- L1028-1039,1213-1217,1314-1318 — status_ui_display — displays delivery_service_statuses array -> none
- L1325-1358 — category_logic — BehaviorsConfig ORDER_BEHAVIORS/PKG_BEHAVIORS map all semantic flags -> none (canonical flags-on-master editor) [Stage B]
- L1396,1413-1426 — flag_usage — BehaviorSection reads r[def.flag] -> none
- L1436-1458 — read_status_id — BehaviorsConfig queries master flags directly -> none (canonical)
- L1460-1475 — write_status_id — toggle writes single flag + invalidates hub query keys (order_statuses_cat/package_statuses_cat) -> none; PRESERVE hub-invalidation wiring [Stage B]

---

### HOOKS

(useStatusCategories, usePackageStatusResolver listed under Status core; useCampaignMetrics, useMediaBuyerEarnings, useMediaBuyerStats under Payments/Commission; useTrackedOrders under Parcels.)

### src/lib/orderHistoryCommentPolicy.ts
- L5-13 — hardcoded_status_literal — STATUSES_REQUIRING_HISTORY_COMMENT = Set of 3 env-specific UUIDs; statusRequiresHistoryComment(statusId) -> replace UUID set with master semantic-flag derivation (pending_confirmation/recheck/is_callback or dedicated requires_comment flag) via hub [Stage C]

---

### LIB (misc)

### src/lib/orderSearch.ts
- L43-61 — read_text_label — OrderForSearch includes package_status_label + parcels/courier_parcels[].status_label + history[].status.label -> if caches dropped, source labels from resolved master [Stage E]
- L112-132 — status_ui_display — pushes package_status_label/status.label/package_status.label into match bucket -> source from resolved master row if caches removed [Stage E]
- L142-151 — read_text_label — pushes parcels/courier_parcels[].status_label/history label into bucket -> resolve from status_id if denorm removed [Stage E]

---

### EDGE FUNCTIONS

### supabase/functions/provider-webhook/index.ts
- L10-17 — category_logic — FORWARD_RANKS hardcoded category->rank map -> replace with master-derived ordering/flags; ranks from package_statuses metadata [Stage C]
- L23 — category_logic — TERMINAL_CATEGORIES Set(['delivered','returned','refused','cancelled']) -> derive from is_delivered/is_returned/is_cancelled + refused flags [Stage C]
- L209-219 — flag_usage — Coliaty isSituationEvent/isPaidSituation (PAID->payed) -> none (payment side; note interleaving)
- L229-248 — status_hook_or_resolver — statusCandidates harvest; dropPaid()/skipSenditNA() literal 'PAID'/'NA' -> centralize literal exclusions into mapping metadata [Stage C]
- L291-295 — hardcoded_status_literal — Ameex skips bare 'IN_PROGRESS' -> move provider-specific exclusions into mapping metadata [Stage C]
- L297-320 — status_hook_or_resolver — RPC match_package_status + JSONB-contains fallback -> keep RPC as single source [Stage C]
- L322-343 — write_text_label — no-match writes status_label = raw provider string (no id/color) -> skip or write 'unmapped' master sentinel [Stage C]
- L347-404 — category_logic — regression guard compares newCat vs currentCat via 'new'/TERMINAL/FORWARD_RANKS + exchange delivered->returned -> replace category-string compares with is_new/is_delivered/is_returned flags + master progression rank [Stage C]
- L406-440 — category_logic — no-op guard; side-effects via newCat==='delivered'/'cancelled'/'postponed' -> derive side-effects from flags; keep status_id equality [Stage C]
- L442-450 — write_text_label — writes status_id + status_label + status_color caches -> keep status_id; eliminate/derive caches [Stage B/C]
- L452-506 — write_status_id — writes package_status_id + label/color caches; delivered/cancelled/postponed boolean+timestamp side-effects via category strings -> write package_status_id only; drop caches; derive side-effects from is_delivered/is_cancelled/postponed flags [Stage B/C/D]

### supabase/functions/sync-tracking-statuses/index.ts
- L27 — category_logic — TERMINAL_CATEGORIES includes 'returning' (drift vs provider-webhook) -> derive from flags; reconcile lists [Stage C]
- L127-155 — category_logic — selects non-terminal via join category not-in set; fallback builds terminalIds by status_id -> filter on flags; keep status_id filtering [Stage C]
- L202-213 — read_text_label — diffs provider status vs parcel.status_label string equality -> diff on resolved status_id [Stage C]
- L217-229 — tracking_sync — forwards synthetic PARCEL_STATUS_CHANGED to provider-webhook -> none (delegated) [Stage C]

### supabase/functions/ozon-poll-webhook/index.ts
- L6 — category_logic — TERMINAL_CATEGORIES (incl 'returning') -> derive from flags; centralize list [Stage C]
- L57-91 — category_logic — non-terminal selection via category not-in + fallback status_id filter -> flag filter; keep status_id [Stage C]
- L180-194 — read_text_label — diffs ozonStatus vs parcel.status_label string equality -> diff on resolved status_id [Stage C]
- L196-218 — tracking_sync — self-POST synthetic PARCEL_STATUS_CHANGED -> none (delegated) [Stage C]

### supabase/functions/quicklivraison-poll-webhook/index.ts
- L9 — category_logic — TERMINAL_CATEGORIES (incl 'returning') -> derive from flags; centralize list [Stage C]
- L58-91 — category_logic — non-terminal selection + fallback status_id filter -> flag filter; keep status_id [Stage C]
- L178-194 — read_text_label — diffs qlStatus vs parcel.status_label -> diff on resolved status_id [Stage C]
- L196-217 — tracking_sync — self-POST synthetic PARCEL_STATUS_CHANGED -> none (delegated) [Stage C]

### supabase/functions/vitex-poll-webhook/index.ts
- L9 — category_logic — TERMINAL_CATEGORIES (incl 'returning') -> derive from flags; centralize list [Stage C]
- L58-92 — category_logic — non-terminal selection + fallback status_id filter -> flag filter; keep status_id [Stage C]
- L159-167 — read_text_label — diffs vitexStatus vs parcel.status_label -> diff on resolved status_id [Stage C]
- L169-190 — tracking_sync — self-POST synthetic PARCEL_STATUS_CHANGED -> none (delegated) [Stage C]

### supabase/functions/sheets-sync/index.ts
- L126 — status_hook_or_resolver — RPC ingest_sheet_rows assigns draft order status server-side -> none in file; downstream status touchpoint in RPC [Stage B]

---

### LAYOUT (notifier mounts)

### src/components/layout/AppLayout.tsx
- L3,23 — status_ui_display — mounts OrderStatusNotifications role="admin" -> none; centralization inside notifier; verify role/targetPath contract [Stage E]

### src/components/layout/SellerLayout.tsx
- L6,68 — status_ui_display — mounts OrderStatusNotifications role="seller" -> none; verify contract [Stage E]

---

### ADMIN MISC

### src/pages/admin/Customers.tsx
- L4 — status_hook_or_resolver — useStatusCategories -> keep
- L5 — status_hook_or_resolver — isDeliveredForCommission -> verify deliveredPkgIds/is_delivered [Stage D]
- L77-84 — read_status_id — Order carries package_status_label + join(label) + status{label,color} -> drop package_status_label; derive label/color from master by id [Stage E]
- L169 — status_hook_or_resolver — statusCats instance -> none
- L182-200 — category_logic — filter groups by .category/.ranking/.active -> ensure category from master not status-categories.ts [Stage F]
- L215 — category_logic — query key on confirmedIds.size/deliveredPkgIds.size -> none
- L233-235,256-268 — read_text_label — select package_status_label + joins; builds statusLabel/statusColor + package_status_label cache -> derive via master id join; remove cache read [Stage E]
- L307-312 — category_logic — successfulOrders via confirmedIds + isDeliveredForCommission -> ensure flags [Stage D]
- L324-336 — read_text_label — packageMatchesFilter falls back to label-string equality -> eliminate label fallback; match on id [Stage E]
- L328,338-342 — category_logic — order/customer filter by id membership -> none
- L544-565,620-641 — status_ui_display — filter dropdowns master color/label -> none
- L774-790 — status_ui_display — last-status pill via orders[0].status.label/.color -> source from master by id [Stage E]
- L940-955 — status_ui_display — detail dialog status badge -> derive from master by id [Stage E]

### src/pages/admin/ImportOrders.tsx
- L41 — status_hook_or_resolver — useStatusCategories -> none
- L76-77 — category_logic — getOrderByCategory('new')?.id -> replace category lookup with is_new flag resolver [Stage C]
- L69-70 — write_status_id — MappedOrder.status validation state (not delivery) -> none
- L213,303 — write_status_id — insert order_status_id=defaultStatusId -> none; source must be flag-derived 'new'
- L315-322 — write_status_id — order_status_history insert -> none
- L691-692 — flag_usage — import button disabled unless defaultStatusId -> none

### src/pages/admin/Trash.tsx
- L33-46,62 — read_text_label — TrashedOrder carries status{label,color,icon}; join status:order_statuses(label,color,icon) -> continue selecting from master; rely on id + flags + master label/color; verify icon on master [Stage E]
- L280,300-318 — status_ui_display — Statut pill via order.status.color/.label -> drive from master id->label/color (or PackageStatusBadge) [Stage E]

### src/pages/admin/collaborators/Couriers.tsx
- L33 — status_hook_or_resolver — useStatusCategories -> keep
- L59-60 — read_status_id — OrderRow order_status_id/package_status_id -> none
- L188 — status_hook_or_resolver — destructures deliveredPkgIds/shippedPkgIds/returnedPkgIds/pullback -> ensure derived from is_delivered/is_shipped/is_returned flags [Stage D]
- L219-228 — read_status_id — select order_status_id/package_status_id -> none
- L340-353 — category_logic — delivered/inTransit/returned via id-sets -> none (desired pattern)
- L330-339 — category_logic — delivery-rate denom via isAdminPullback -> verify isAdminPullback no longer reads labels [Stage C]
- L360-361 — category_logic — payment-note n.status==='paid' -> none (excluded)
- L366-371,601-602,607-611 — category_logic — successRate/deliveryTier (numeric) -> none
- L608-613,689-712 — status_ui_display — distribution bar hardcoded labels Delivered/In-transit/Returned + hex (#2D7A3E/#D97706/#B54040) -> optionally source label/color from master rows to avoid drift [Stage E]
- L850-867,900-917 — category_logic — payment/return-note pills -> none (excluded)

### src/pages/admin/collaborators/Sellers.tsx
- L31 — status_hook_or_resolver — useStatusCategories -> keep
- L33 — status_hook_or_resolver — isDeliveredForCommission -> verify is_delivered flag [Stage D]
- L34 — status_hook_or_resolver — isAdminPullback -> verify flags [Stage C]
- L161-169 — status_hook_or_resolver — destructures confirmedIds/cancelledIds/deliveredPkgIds/pendingIds/pullback/getOrderCategory -> ensure derived from flags [Stage D]
- L186 — status_hook_or_resolver — useEffect deps -> none
- L210-220 — read_status_id — select package_status_label + joins(code,label) -> drop package_status_label + embedded label joins [Stage E]
- L272-291 — category_logic — classification via getOrderCategory + isDeliveredForCommission + confirmedIds/pendingIds -> none if flag-derived [Stage D]
- L296-303 — category_logic — confirm-rate via pendingIds -> none
- L304-310 — category_logic — delivery rate via isAdminPullback -> none
- L322,334-336,367-368 — category_logic — totalRevenue/topCity/commission via isDeliveredForCommission -> none
- L375-382,884-895 — category_logic — monthlyPayments status/period_state -> none (excluded)
- L639-646,720-743 — status_ui_display — distribution bar hardcoded labels + hex -> optionally source from master rows [Stage E]
- L151-155,474,553 — status_ui_display — deliveryTier (numeric) -> none

---

### MEDIABUYER ANALYTICS

### src/components/analytics/MediaBuyersSection.tsx
(listed under Analytics above)

---

### MISC (AdsHistory)

### src/pages/AdsHistory.tsx
- L92 — status_hook_or_resolver — useStatusCategories -> keep; confirm sets/getOrderCategory after refactor
- L94 — status_hook_or_resolver — isDeliveredForCommission -> depends on helper repointed to is_delivered [Stage D]
- L95 — status_hook_or_resolver — isAdminPullback -> depends on helper repointed to flags [Stage C]
- L385 — status_hook_or_resolver — destructures cancelledIds/deliveredPkgIds/pendingIds/pullback/getOrderCategory -> none (canonical)
- L465-481 — read_status_id — select package_status_label + order_statuses(code)/package_statuses(label) -> drop package_status_label; order_statuses(code)/package_statuses(label) appear unused, prune [Stage E]
- L507-513 — category_logic — matchedOrders filter (no status branching) -> none
- L530-567 — category_logic — per-order isDelivered/getOrderCategory/cancelledIds/'fake'/'double'/pendingIds/isAdminPullback -> none if hub repointed; verify getOrderCategory on master + 'fake'/'double' survive [Stage C]
- L570-602 — category_logic — aggregate counts -> none (downstream)
- L172-198 — category_logic — CampaignMetrics interface (type) -> none
- L924-965,1180-1320 — status_ui_display — campaign card + details modal status-derived KPIs -> none

---

## 3. NO ACTION (confirmed clean)

Files with `touches_status:true` but every site = `none` (verified flag/id-based or excluded state machines):
- src/pages/mediabuyer/Dashboard.tsx
- src/pages/mediabuyer/Statistics.tsx
- src/pages/mediabuyer/Payments.tsx
- src/pages/mediabuyer/CampaignManage.tsx
- src/pages/mediabuyer/CampaignPreview.tsx
- src/components/dashboard/ConfirmationPipeline.tsx
- src/components/dashboard/PendingOrdersBreakdown.tsx
- src/lib/orders/getLatestTrackableCompanyParcel.ts
- src/hooks/useTrackedOrders.ts
- src/components/orders/OrderStatusToast.tsx
- src/components/layout/AppLayout.tsx
- src/components/layout/SellerLayout.tsx

(Note: the above still warrant a contract-verification pass during their stage but require no code edit per current findings.)

Files from the CLEAN list (no status logic):
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/DeliveryServices.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/orders/OrderLineProductCombobox.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/orders/OrderPhoneQuickActions.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/orders/StockShortageModal.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/orders/SourceIcon.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/orders/OrderTrackingImport.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/orders/SyncTrackingStatus.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/orders/WebhookHealthIndicator.tsx
src/hooks/useTrackingSyncStatus.ts
src/hooks/useWebhookHealth.ts
src/hooks/useCourierNotifications.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/seller/Demands.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/seller/Wallet.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/courier/Profile.tsx
src/pages/mediabuyer/Profile.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/mediabuyer/CampaignForm.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/mediabuyer/Campaigns.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/mediabuyer/Demands.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/analytics/AnalyticsDateFilter.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/analytics/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/analytics/SectionStory.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/analytics/SectionWrapper.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/analytics/StatCard.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/analytics/UsersSection.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/dashboard/performance/FinancialsWaterfall.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/dashboard/performance/PerformanceFunnel.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/dashboard/performance/SourcePills.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/dashboard/performance/StackedProportionBar.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/dashboard/performance/StatusQueuePane.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/hooks/useSellerLedger.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/hooks/useSellerLiveOwed.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/hooks/useSellerCommissionTotals.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/orderTrackingImport.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/notifications.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/payoutOrderAttribution.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/buildOrderItemRecords.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/deleteOpenCompanyDeliveryNote.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/removeCompanyParcelFromDeliveryNote.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/Demands.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/SheetReview.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/SalesChannels.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/Analytics.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/Dashboard.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/collaborators/MediaBuyers.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/business/Payments.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/business/Overview.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/seller/Payments.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/owner/Payments.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/owner/OwnerPlatformDashboard.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/salaries/MediaBuyerLedgerDialogs.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/salaries/PayoutPaymentDialogs.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/salaries/SellerLedgerDialogs.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/sellerPayoutPdf.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/mediabuyerPayoutPdf.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/courierPayoutPdf.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/courierReturnPdf.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/courierLabelGenerator.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/analytics/GoogleAnalytics.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/analytics/MetaAds.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/hooks/useMetaAds.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/hooks/useGoogleAnalytics.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/metaAds.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/googleAnalytics.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/reopen-delivery-note/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/delete-business/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/accordion.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/alert-dialog.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/alert.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/aspect-ratio.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/avatar.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/badge.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/breadcrumb.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/button.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/calendar.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/card.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/carousel.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/chart.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/checkbox.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/collapsible.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/command.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/confirm-dialog.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/context-menu.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/dialog.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/drawer.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/dropdown-menu.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/EyePasswordToggle.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/form.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/fullscreen-loader.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/globe.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/hover-card.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/IconPicker.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/input-otp.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/input.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/label.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/menubar.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/navigation-menu.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/pagination.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/PasswordStrengthBar.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/popover.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/progress.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/radio-group.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/resizable.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/scroll-area.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/select.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/separator.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/sheet.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/sidebar.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/skeleton.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/slider.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/sonner.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/switch.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/table.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/tabs.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/textarea.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/toast.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/toaster.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/toggle-group.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/toggle.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/tooltip.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/truncated-text.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/ui/use-toast.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/CreateCampaignWizard.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/manager/AdSetsTable.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/manager/AdsTable.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/manager/BulkActions.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/manager/CampaignsTable.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/manager/ColumnCustomizer.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/manager/ManagerTabs.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/manager/ManagerToolbar.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/manager/MetaAdsManager.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/manager/PixelDashboard.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/manager/StatusToggle.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/manager/SummaryBar.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/sections/AccordionSection.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/sections/AdPreviewPanel.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/shared/constants.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/shared/FieldLabel.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/shared/metaTheme.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/steps/AdSetStep.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/steps/AdStep.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/steps/CampaignStep.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/meta/steps/ReviewStep.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/NavLink.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/PixelBlast.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/layout/CourierLayout.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/layout/MediaBuyerLayout.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/layout/OwnerLayout.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/layout/CourierSidebar.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/layout/MediaBuyerSidebar.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/layout/OwnerSidebar.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/layout/SellerSidebar.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/layout/Sidebar.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/layout/SuspensionOverlay.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/auth/AuthBackground.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/auth/MediaBuyerIntegrationGuard.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/auth/ProtectedRoute.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/businesses/AddEditBusinessModal.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/catalog/AccessoryPreviewDialog.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/catalog/ImageHoverPreview.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/catalog/ProductPreviewDialog.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/notifications/NotificationPermissionDialog.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/scanner/QrScanModal.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/tools/ClientSearchSelect.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/tools/OrderSearchSelect.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/tools/ProductSearchSelect.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/profile/AvatarEditDialog.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/profile/BankDetailsCard.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/profile/ProfileScaffold.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/profile/SecuritySection.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/users/AvatarStudio.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/users/InvitationsPanel.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/users/UserAvatar.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/users/InviteUserWizard.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/owner/config/ConfigSection.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/owner/config/EmailAccountCard.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/owner/config/EmailAccountModal.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/owner/config/EmailAccountsSection.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/owner/email-templates/EmailPreview.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/owner/email-templates/EmailTemplateCard.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/owner/email-templates/EmailTemplateModal.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/owner/email-templates/EmailTemplatePreviewModal.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/owner/email-templates/HtmlCodeEditor.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/owner/Businesses.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/owner/Cities.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/owner/Zones.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/owner/Users.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/owner/Plans.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/owner/EmailTemplates.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/owner/Config.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/owner/OwnerDashboard.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/owner/Profile.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/seller/Products.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/seller/Accessories.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/seller/Help.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/tools/BonDeCommande.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/tools/BonDeLivraison.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/tools/Devis.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/tools/Facture.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/tools/ToolDocumentPage.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/tools/bonCommande/BonCommandePage.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/tools/bonCommande/BonCommandePdfDocument.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/tools/bonCommande/BonCommandeWizard.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/tools/bonLivraison/BonLivraisonPage.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/tools/bonLivraison/BonLivraisonWizard.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/tools/devis/DevisPage.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/tools/devis/DevisPdfDocument.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/tools/devis/DevisWizard.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/tools/facture/FacturePage.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/tools/facture/FacturePdfDocument.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/tools/facture/FactureWizard.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/Accessories.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/Products.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/ImportProducts.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/ImportAccessories.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/ImportCustomers.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/Calculator.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/ExpensesDetails.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/ExpensesTypes.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/RecurringCharges.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/Profile.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/campaignConstants.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/providerLogos.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/renderReactIcon.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/edgeError.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/passwordStrength.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/selfSecurity.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/emailAccounts.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/emailTemplates.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/supabase.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/utils.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/credentialChange.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/invitations.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/profile.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/saveBlob.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/formatNumbers.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/dateBuckets.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/documentPdf/legalFooter.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/documentPdf/stampBlock.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/documentPdf/embedRemoteImages.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/documentPdf/registerFonts.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/documentPdf/shapeArabic.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/documentPdf/toBase64.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/bonCommande/embedImagesForPdf.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/bonCommande/types.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/bonLivraison/embedImagesForPdf.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/devis/embedImagesForPdf.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/devis/totals.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/devis/types.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/facture/types.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/hooks/useCampaignBasePath.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/hooks/useCurrentUserId.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/hooks/use-mobile.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/hooks/use-toast.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/App.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/main.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/Auth.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/Register.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/ChangeCredentials.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/NotFound.tsx
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/_shared/emailVerify.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/account-status-change/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/auth-login-alert/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/business-status-notify/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/check-credential-token/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/check-invitation/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/confirm-credential-change/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/consume-invitation/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/create-invitation/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/google-analytics-fetch/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/manage-email-accounts/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/manage-users/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/meta-ads-fetch/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/meta-ads-oauth/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/request-credential-change/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/request-credential-otp/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/request-password-reset/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/self-credential-confirm/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/self-credential-otp/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/send-courier-push/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/send-email/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/send-invitation/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/send-payout-statement/index.ts
/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/functions/signup-email/index.ts
---

## GAP-CLOSURE (audited separately after the sweep — CLEAN)

The sweep's partition agents did not report these two back (one slipped between partitions, one wasn't returned). Audited in full afterward — both confirmed clean, no delivery-status engine usage:

- `src/pages/admin/Transactions.tsx` — supplier-purchase ledger (`transactions`/`trns_purchase`/`trns_payment`). Its `paid/partial/unpaid` is the supplier-invoice payment state machine, not order/package delivery status. NO ACTION.
- `src/pages/admin/Users.tsx` — user/team management. `'delivered'` strings are commission-basis radio labels; `status` fields are account-status + GA/Meta access scope. NO ACTION.

`src/vite-env.d.ts` — single `/// <reference>` type declaration, not auditable code.

**Coverage: 372/372 source files accounted for** (369 via the sweep + 2 gap-closure + 1 trivial type-ref).
