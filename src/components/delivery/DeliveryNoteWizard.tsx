/* eslint-disable react-refresh/only-export-components */
import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { matchPackageStatus } from '@/lib/matchPackageStatus';
import { syncParcelTracking, type TrackableParcel } from '@/lib/orders/syncOrderTracking';
import { resolveProviderLogo } from '@/lib/providerLogos';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from "@/components/ui/badge";
import { useToast } from '@/hooks/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Search,
    Building2,
    Package,
    Loader2,
    CheckCircle2,
    AlertCircle,
    FileText,
    Layers,
    ListChecks,
    AlertTriangle,
    RotateCw,
    X
} from 'lucide-react';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provider-integration`;

/** Matches `providers` columns used for parcel create in provider-integration edge (per carrier). */
const WIZARD_PROVIDER_SELECT_FOR_PARCEL = [
    'id',
    'name',
    'provider_type',
    'coliaty_package_no_open',
    'ameex_parcel_open',
    'ameex_parcel_try_on',
    'ameex_parcel_fragile',
    'ozon_parcel_open',
    'ozon_parcel_fragile',
    'ozon_parcel_replace',
    'quicklivraison_parcel_open',
    'quicklivraison_parcel_try_on',
    'quicklivraison_parcel_fragile',
    'vitex_parcel_fragile',
    'vitex_parcel_open',
    'forcelog_parcel_fragile',
    'forcelog_parcel_open',
    'forcelog_parcel_carton',
    'sendit_allow_try',
    'sendit_pickup_district_id',
    'digylog_network_id',
    'digylog_store_name',
    'digylog_default_port',
    'digylog_allow_open',
    'delvoexpress_allow_open',
    'logo_url',
    'color'
].join(', ');

/**
 * Maps saved provider row → `data` fields expected by `create_parcel` in provider-integration.
 * Coliaty: no_open only (exchange + old tracking come from the order). AMEEX: fragile/open/try only (exchange + old tracking come from the order). Ozon: open, fragile, replaceable.
 */
function parcelPermissionFieldsFromProvider(provider: { provider_type?: string | null } & Record<string, unknown>) {
    const raw = (provider?.provider_type ?? '').toString().toLowerCase();
    if (!raw) return {} as Record<string, unknown>;
    if (raw.includes('coliaty')) {
        return {
            no_open: !!provider.coliaty_package_no_open,
        };
    }
    if (raw.includes('ameex')) {
        return {
            fragile: provider.ameex_parcel_fragile ? '1' : '0',
            open: provider.ameex_parcel_open ? 'YES' : 'NO',
            try: provider.ameex_parcel_try_on ? 'YES' : 'NO',
        };
    }
    if (raw.includes('ozon')) {
        return {
            open: Number(provider.ozon_parcel_open) === 1 ? 'YES' : 'NO',
            fragile: Number(provider.ozon_parcel_fragile) === 1,
            replaceable: Number(provider.ozon_parcel_replace) === 1,
        };
    }
    if (raw.includes('quicklivraison')) {
        return {
            open: provider.quicklivraison_parcel_open ? 'YES' : 'NO',
            try: provider.quicklivraison_parcel_try_on ? 'YES' : 'NO',
            fragile: !!provider.quicklivraison_parcel_fragile,
        };
    }
    if (raw.includes('vitex')) {
        // Vitex: fragile + "Interdit d'ouvrir" (inverse of other providers' `open`).
        // The adapter reads `vitex_parcel_fragile` / `vitex_parcel_open` from the provider row
        // directly — no per-parcel overrides needed here.
        return {} as Record<string, unknown>;
    }
    if (raw.includes('forcelog')) {
        // Forcelog: fragile + carton + "Interdit d'ouvrir". Adapter reads flags from provider row.
        return {} as Record<string, unknown>;
    }
    if (raw.includes('sendit')) {
        // Sendit: allow_open + allow_try + pickup_district_id are on the provider row, the adapter reads them.
        return {} as Record<string, unknown>;
    }
    if (raw.includes('digylog')) {
        // Digylog: network/store/port/openproduct are on the provider row, the adapter reads them.
        return {} as Record<string, unknown>;
    }
    if (raw.includes('delvo') || raw.includes('delevo')) {
        // Delevo Express: openpackage is on the provider row, the adapter reads it.
        return {} as Record<string, unknown>;
    }
    return {} as Record<string, unknown>;
}

/** Seller: only orders where seller_id matches and every line product_id is in this set. */
export type DeliveryNoteSellerScope = { userId: string; productIds: string[] };

// Types verified against public.{providers, orders, order_items, master_cities, company_zones, company_delivery_notes, company_parcels} via MCP
type WizardProvider = {
    id: string;
    name: string;
    provider_type: string | null;
    coliaty_package_no_open: boolean;
    ameex_parcel_open: boolean;
    ameex_parcel_try_on: boolean;
    ameex_parcel_fragile: boolean;
    ozon_parcel_open: number;
    ozon_parcel_fragile: number;
    ozon_parcel_replace: number;
    quicklivraison_parcel_open: boolean;
    quicklivraison_parcel_try_on: boolean;
    quicklivraison_parcel_fragile: boolean;
    vitex_parcel_fragile: boolean;
    vitex_parcel_open: boolean;
    forcelog_parcel_fragile: boolean;
    forcelog_parcel_open: boolean;
    forcelog_parcel_carton: boolean;
    sendit_allow_try: boolean;
    sendit_pickup_district_id: number | null;
    digylog_network_id: number | null;
    digylog_store_name: string | null;
    digylog_default_port: number | null;
    digylog_allow_open: boolean;
    delvoexpress_allow_open: boolean;
    logo_url: string | null;
    color: string | null;
};

type WizardOrderItem = {
    product_id: string;
    quantity: number;
    product: { name: string; code: string | null } | null;
};

type WizardOrder = {
    id: string;
    company_id: string | null;
    master_city_id: string | null;
    seller_id: string | null;
    name: string | null;
    phone: string | null;
    address: string | null;
    price: number | null;
    note: string | null;
    delivery_note: string | null;
    replace: boolean | null;
    coliaty_old_tracking: string | null;
    ameex_old_tracking: string | null;
    quicklivraison_old_tracking: string | null;
    forcelog_old_tracking: string | null;
    sendit_old_tracking: string | null;
    delvoexpress_old_tracking: string | null;
    items: WizardOrderItem[] | null;
    city: { id: string; name: string; zone_id: string | null } | null;
    company: WizardProvider | null;
};

/** Lightweight shape used only in the first fetch (no deep join). */
type WizardOrderLight = {
    id: string;
    company_id: string | null;
    master_city_id: string | null;
    seller_id: string | null;
    items: { product_id: string }[] | null;
};

/** Minimal shape required by orderMatchesSellerProducts — broad enough for all callers. */
export type OrderForSellerProductsMatch = {
    seller_id?: string | null;
    items?: ReadonlyArray<{ product_id?: string | null | undefined }> | null;
};

type CreatedParcelEntry = {
    order: WizardOrder;
    parcel?: { id: string } | null;
    tracking_code?: string;
    error?: string;
};

type DeliveryNoteEntry = { note: { id: string; reference: string }; providerId: string; isNew: boolean };

/**
 * A Coliaty same-phone DUPLICATE error raised when adding a parcel to the pickup note.
 * Carries everything needed to either ignore it (Coliaty `error_id`) and re-add the
 * parcel, or skip it (clean up the orphan `parcelId`). Note context lets us re-add to
 * the exact same delivery note the first attempt targeted.
 */
type DuplicateEntry = {
    providerId: string;
    errorId: number;
    code: string;
    message: string;
    order: WizardOrder | null;
    parcelId: string | null;
    deliveryNoteId: string;
    deliveryNoteRef: string;
    externalId: string | null;
};

/** Per-provider result of an add-parcels attempt, surfacing Coliaty duplicates. */
type AddNoteResult = DeliveryNoteEntry & {
    deliveryNoteId: string;
    deliveryNoteRef: string;
    externalId: string | null;
    duplicates: { error_id: number; code: string; message: string }[];
    otherErrors: { code: string; message: string }[];
};

export function orderMatchesSellerProducts(order: OrderForSellerProductsMatch, userId: string, productSet: Set<string>): boolean {
    if (order.seller_id !== userId) return false;
    const items = order.items;
    if (!items?.length) return false;
    return items.every((it) => it.product_id && productSet.has(it.product_id));
}

interface DeliveryNoteWizardProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    lockProviderId?: string;
    /** When set, zones/orders/drafts are scoped to this seller and their catalog. */
    sellerScope?: DeliveryNoteSellerScope;
}

type WizardSnapshot = {
    v: number;
    step: 'provider' | 'select-orders' | 'creating' | 'review' | 'duplicates' | 'finalizing';
    selectedProviderId: string;
    createdParcels: CreatedParcelEntry[];
    deliveryNotes: DeliveryNoteEntry[];
    duplicateParcels: DuplicateEntry[];
    selectedDuplicateIds: number[];
    currentProvider: string;
    selectedOrderIds: string[];
};

// The wizard persists an IN-PROGRESS run (parcels already created on the provider) to
// localStorage, so navigating away or reloading to fix a failed order never loses it —
// provider parcels can't be cancelled, so dropping progress would orphan them. Only a
// run with at least one created parcel is restored. Cleared on explicit close (X / Cancel
// / Esc) and on successful finish; a plain navigation/reload keeps it.
function readWizardSnapshot(key: string): WizardSnapshot | null {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const s = JSON.parse(raw) as WizardSnapshot;
        if (!s || s.v !== 1 || !Array.isArray(s.createdParcels) || s.createdParcels.length === 0) return null;
        return s;
    } catch { return null; }
}
function writeWizardSnapshot(key: string, snap: WizardSnapshot) {
    try { localStorage.setItem(key, JSON.stringify(snap)); } catch { /* quota / serialize */ }
}
function clearWizardSnapshot(key: string) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export const DeliveryNoteWizard: React.FC<DeliveryNoteWizardProps> = ({ open, onOpenChange, lockProviderId, sellerScope }) => {
    const _bizId = typeof window !== 'undefined' ? localStorage.getItem('activeBusinessId') : null;
    const STORAGE_KEY = `dnw:progress:${_bizId || 'none'}`;
    // Read any persisted in-progress run ONCE on mount.
    const [persisted] = useState<WizardSnapshot | null>(() => readWizardSnapshot(STORAGE_KEY));
    // Restore to a usable step: a run interrupted mid-'creating'/'finalizing' has no
    // live mutation after a reload, so land on 'review' (shows successes/failures, retry,
    // and Generate) instead of a spinner that never resolves.
    const [step, setStep] = useState<'provider' | 'select-orders' | 'creating' | 'review' | 'duplicates' | 'finalizing'>(
        persisted
            ? (persisted.step === 'creating' || persisted.step === 'finalizing' ? 'review' : persisted.step)
            : 'provider'
    );
    const [selectedProviderId, setSelectedProviderId] = useState<string>(persisted?.selectedProviderId ?? (lockProviderId || ''));
    const [providerSearch, setProviderSearch] = useState('');
    const [createdParcels, setCreatedParcels] = useState<CreatedParcelEntry[]>(persisted?.createdParcels ?? []);
    const [deliveryNotes, setDeliveryNotes] = useState<DeliveryNoteEntry[]>(persisted?.deliveryNotes ?? []);
    // Coliaty same-phone duplicates surfaced at the add-to-pickup-note step, plus the
    // subset (by Coliaty error_id) the user chose to ignore/keep.
    const [duplicateParcels, setDuplicateParcels] = useState<DuplicateEntry[]>(persisted?.duplicateParcels ?? []);
    const [selectedDuplicateIds, setSelectedDuplicateIds] = useState<Set<number>>(new Set(persisted?.selectedDuplicateIds ?? []));
    const [currentProvider, setCurrentProvider] = useState<string>(persisted?.currentProvider ?? '');
    const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set(persisted?.selectedOrderIds ?? []));
    // Free-text search inside the Select-orders step. Matches any visible
    // order info — name, phone, tracking, product names + codes, city, price.
    const [orderSearch, setOrderSearch] = useState('');
    // A restored run does NOT auto-open the modal (that would blur/block the page). The
    // state is seeded from the snapshot and a floating "Resume" button is shown instead;
    // the user opens it when ready. restoredOpen is flipped true by that button.
    const [restoredOpen, setRestoredOpen] = useState<boolean>(false);
    const isOpen = open || restoredOpen;

    // Update selectedProviderId when lockProviderId changes
    React.useEffect(() => {
        if (lockProviderId) {
            setSelectedProviderId(lockProviderId);
        }
    }, [lockProviderId]);

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const { getOrderByCategory } = useStatusCategories();
    const confirmedStatusId = getOrderByCategory('confirmed')?.id;

    const sellerProductKey = sellerScope?.productIds?.length
        ? [...sellerScope.productIds].sort().join(',')
        : '';

    // Fetch providers that have confirmed orders — EXPLICIT company_id only.
    // Mirrors the Orders page "Delivery" filter: an order only shows up in the
    // wizard if it has been explicitly attributed to a provider via
    // orders.company_id. No zone-based fallback so unassigned confirmed orders
    // are never double-counted across the company and courier wizards.
    const { data: availableProviders } = useQuery({
        queryKey: sellerScope
            ? ['wizard-providers-seller', confirmedStatusId, activeBusinessId, sellerScope.userId, sellerProductKey]
            : ['wizard-providers', confirmedStatusId, activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId || !confirmedStatusId) return [];

            const orders = await fetchAllRows(
                'orders',
                `
                    id, company_id, master_city_id, seller_id,
                    items:order_items(product_id),
                    company:providers(${WIZARD_PROVIDER_SELECT_FOR_PARCEL})
                `,
                {
                    filters: [
                        { column: 'order_status_id', op: 'eq', value: confirmedStatusId },
                        { column: 'DigiCom Business', op: 'eq', value: activeBusinessId },
                        { column: 'date_deleted', op: 'is', value: null },
                        { column: 'source_review_status', op: 'neq', value: 'pending' },
                    ],
                    orFilter: sellerScope
                        ? `and(company_id.not.is.null,seller_id.eq.${sellerScope.userId})`
                        : 'company_id.not.is.null',
                },
            );

            const productSet = sellerScope ? new Set(sellerScope.productIds) : null;
            type OrderRow = WizardOrderLight & { company: WizardProvider | null };
            const lightOrders = (orders || []) as unknown as OrderRow[];
            const filteredOrders = lightOrders.filter((o) =>
                !sellerScope || !productSet ? true : orderMatchesSellerProducts(o, sellerScope.userId, productSet)
            );

            if (filteredOrders.length === 0) return [];

            const providerOrderCounts = new Map<string, number>();
            const providerMap = new Map<string, WizardProvider | null>();

            for (const order of filteredOrders) {
                const providerId = order.company_id;
                if (!providerId) continue;
                providerOrderCounts.set(providerId, (providerOrderCounts.get(providerId) || 0) + 1);
                if (order.company && !providerMap.has(providerId)) {
                    providerMap.set(providerId, order.company);
                }
            }

            const result: { id: string; name: string; provider_type: string; orderCount: number; logo_url?: string; color?: string }[] = [];
            for (const [pid, count] of providerOrderCounts.entries()) {
                const provider = providerMap.get(pid);
                if (!provider) continue;
                result.push({
                    id: pid,
                    name: provider.name || 'Unknown',
                    provider_type: provider.provider_type || '',
                    orderCount: count,
                    logo_url: provider.logo_url,
                    color: provider.color
                });
            }

            return result.sort((a, b) => b.orderCount - a.orderCount);
        },
        enabled: open && !!confirmedStatusId && (!sellerScope || sellerScope.productIds.length > 0)
    });

    // Fetch confirmed orders for selected provider(s) — EXPLICIT company_id only.
    const { data: ordersGrouped } = useQuery({
        queryKey: ['confirmed-orders-by-provider', selectedProviderId, sellerScope?.userId, sellerProductKey, activeBusinessId],
        queryFn: async () => {
            if (!selectedProviderId || !confirmedStatusId) return null;

            const data = await fetchAllRows(
                'orders',
                `
                    *,
                    city:master_cities!inner(id, name, zone_id),
                    company:providers(${WIZARD_PROVIDER_SELECT_FOR_PARCEL}),
                    items:order_items(
                        *,
                        product:products(name, code)
                    )
                `,
                {
                    filters: [
                        { column: 'order_status_id', op: 'eq', value: confirmedStatusId },
                        { column: 'DigiCom Business', op: 'eq', value: activeBusinessId },
                        { column: 'date_deleted', op: 'is', value: null },
                        { column: 'source_review_status', op: 'neq', value: 'pending' },
                    ],
                    orFilter: sellerScope
                        ? `and(company_id.not.is.null,seller_id.eq.${sellerScope.userId})`
                        : 'company_id.not.is.null',
                },
            );

            const productSet = sellerScope ? new Set(sellerScope.productIds) : null;
            const fullOrders = (data || []) as unknown as WizardOrder[];
            const baseOrders = fullOrders.filter((order) =>
                !sellerScope || !productSet
                    ? true
                    : orderMatchesSellerProducts(order, sellerScope.userId, productSet)
            );

            type OrderGroup = { provider: WizardProvider | null; orders: WizardOrder[] };
            const grouped = baseOrders.reduce<Record<string, OrderGroup>>((acc, order) => {
                const providerId = order.company_id;
                if (!providerId) return acc;

                if (selectedProviderId !== 'all' && providerId !== selectedProviderId) return acc;
                if (lockProviderId && providerId !== lockProviderId) return acc;

                if (!acc[providerId]) {
                    acc[providerId] = {
                        provider: order.company || null,
                        orders: []
                    };
                }
                acc[providerId].orders.push(order);
                return acc;
            }, {});

            return grouped;
        },
        enabled: !!selectedProviderId && (step === 'provider' || step === 'select-orders') && !!confirmedStatusId
    });

    // Create parcels for a provider
    const createParcelsMutation = useMutation({
        mutationFn: async ({ providerId, orders }: { providerId: string; orders: WizardOrder[] }) => {
            // Get session once at the start
            const { data: { session } } = await supabase.auth.getSession();

            if (!session?.access_token) {
                throw new Error('Not authenticated. Please log in again.');
            }

            const provider = orders[0].company;
            const results = [];

            for (const order of orders) {
                try {
                    const permFields = parcelPermissionFieldsFromProvider(provider || {});
                    const providerType = String(provider?.provider_type || '').toLowerCase();
                    const isColiaty = providerType.includes('coliaty');
                    const isAmeex = providerType.includes('ameex');
                    const isQuickLivraison = providerType.includes('quicklivraison');
                    const isVitex = providerType.includes('vitex');
                    const isForcelog = providerType.includes('forcelog');
                    const isSendit = providerType.includes('sendit');
                    const isDigylog = providerType.includes('digylog');
                    const isDelvoExpress = providerType.includes('delvo') || providerType.includes('delevo');
                    if (isColiaty && order.replace && !String(order.coliaty_old_tracking || '').trim()) {
                        throw new Error(
                            'Coliaty exchange requires the previous parcel tracking number on the order (package_old_tracking).'
                        );
                    }
                    if (isAmeex && order.replace && !String(order.ameex_old_tracking || '').trim()) {
                        throw new Error(
                            'AMEEX exchange requires the previous parcel tracking number on the order (exchange_code).'
                        );
                    }
                    if (isQuickLivraison && order.replace && !String(order.quicklivraison_old_tracking || '').trim()) {
                        throw new Error(
                            'Quick Livraison exchange requires the previous parcel tracking number on the order (echange_colis).'
                        );
                    }
                    if (isVitex && order.replace) {
                        throw new Error(
                            "Vitex n'accepte l'échange que si le colis précédent a le statut 'Livré' dans le dashboard Vitex. Désactivez l'échange sur cette commande ou créez-le manuellement côté Vitex."
                        );
                    }
                    if (isForcelog && order.replace && !String(order.forcelog_old_tracking || '').trim()) {
                        throw new Error(
                            "Forcelog exchange requires the previous parcel tracking number on the order (forcelog_old_tracking)."
                        );
                    }
                    if (isSendit && order.replace && !String(order.sendit_old_tracking || '').trim()) {
                        throw new Error(
                            "Sendit exchange requires the previous parcel tracking number on the order (sendit_old_tracking)."
                        );
                    }
                    if (isDelvoExpress && order.replace && !String(order.delvoexpress_old_tracking || '').trim()) {
                        throw new Error(
                            "Delevo Express exchange requires the previous parcel code on the order (delvoexpress_old_tracking)."
                        );
                    }
                    // Prepare parcel data
                    const parcelData = {
                        customer_name: order.name,
                        customer_phone: order.phone,
                        delivery_address: order.address,
                        cod_amount: Number(order.price),
                        master_city_id: order.master_city_id,
                        city_name: order.city?.name,
                        product_info: order.items
                            ?.filter((i) => i.quantity > 0)
                            .map((i) => `${i.product?.code || 'P'} x${i.quantity}`)
                            .join(', '),
                        note: order.note || '', // Internal note
                        delivery_note: order.delivery_note || '', // Public note for courier
                        ...permFields,
                        ...(isColiaty
                            ? {
                                  replaceable: !!order.replace,
                                  old_tracking: order.replace
                                      ? String(order.coliaty_old_tracking || '').trim()
                                      : '',
                              }
                            : isAmeex
                              ? {
                                    replaceable: !!order.replace,
                                    old_tracking: order.replace
                                        ? String(order.ameex_old_tracking || '').trim()
                                        : '',
                                }
                              : isQuickLivraison
                                ? {
                                      replaceable: !!order.replace,
                                      old_tracking: order.replace
                                          ? String(order.quicklivraison_old_tracking || '').trim()
                                          : '',
                                  }
                                : isVitex
                                  ? {
                                        // Vitex: exchange is blocked upstream (throws above when order.replace=true).
                                        // Adapter reads fragile/open from provider row columns directly; no per-parcel fields here.
                                        product_qty: (order.items || [])
                                            .filter((i) => i.quantity > 0)
                                            .reduce((sum, i) => sum + Number(i.quantity || 0), 0) || 1,
                                    }
                                  : isForcelog
                                    ? {
                                          // Forcelog: exchange supported. Adapter reads fragile/open/carton from provider row.
                                          order_num: order.id,
                                          district: '',
                                          replace_parcel_code: order.replace
                                              ? String(order.forcelog_old_tracking || '').trim()
                                              : '',
                                      }
                                    : isSendit
                                      ? {
                                            // Sendit: exchange supported via option_exchange + delivery_exchange_id (adapter reads replace_parcel_code).
                                            order_num: order.id,
                                            reference: String(order.id).substring(0, 50),
                                            replace_parcel_code: order.replace
                                                ? String(order.sendit_old_tracking || '').trim()
                                                : '',
                                        }
                                      : isDigylog
                                        ? {
                                              // Digylog: type=2 for exchange (adapter reads `replaceable`/`replace_parcel_code` flag).
                                              // network/store/port/openproduct come from provider row.
                                              order_num: order.id,
                                              reference: String(order.id).substring(0, 50),
                                              items: (order.items || []).map((i) => ({
                                                  product_id: i.product_id,
                                                  quantity: i.quantity,
                                                  name: i.product?.name,
                                                  code: i.product?.code,
                                              })),
                                              replaceable: !!order.replace,
                                          }
                                        : isDelvoExpress
                                          ? {
                                                // Delevo Express: change=1 + coli_exchange={old_code}.
                                                order_num: order.id,
                                                reference: String(order.id).substring(0, 50),
                                                items: (order.items || []).map((i) => ({
                                                    product_id: i.product_id,
                                                    quantity: i.quantity,
                                                    name: i.product?.name,
                                                    code: i.product?.code,
                                                })),
                                                replace_parcel_code: order.replace
                                                    ? String(order.delvoexpress_old_tracking || '').trim()
                                                    : '',
                                            }
                                          : Object.keys(permFields).length === 0
                                            ? { replaceable: order.replace || false }
                                            : {}),
                    };

                    // Call Edge Function
                    const response = await fetch(EDGE_FUNCTION_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${session.access_token}`
                        },
                        body: JSON.stringify({
                            action: 'create_parcel',
                            provider_id: providerId,
                            data: parcelData
                        })
                    });

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        throw new Error(errorData.error || `API returned ${response.status}`);
                    }

                    const result = await response.json();

                    // Map provider status to our internal package_statuses (containment → RPC → ilike fallback)
                    const providerStatus = result.data?.status || result.data?.label || result.data?.statusLabel || 'Nouveau';
                    const matched = await matchPackageStatus(supabase, providerStatus);
                    const mappedStatusId = matched?.id ?? null;

                    // Sweep prior orphan parcels for this (provider, order) pair before inserting.
                    // An orphan = no company_delivery_note_id. Left behind by a previous attempt
                    // whose linking step never completed (failed call, page reload, retry).
                    await supabase
                        .from('company_parcels')
                        .delete()
                        .eq('provider_id', providerId)
                        .eq('order_id', order.id)
                        .is('company_delivery_note_id', null);

                    // Save to database with mapped status_id and native color
                    const { data: parcel, error: parcelError } = await supabase
                        .from('company_parcels')
                        .insert({
                            provider_id: providerId,
                            order_id: order.id,
                            tracking_code: result.data?.tracking_code || result.data?.reference || result.data?.bar_code,
                            external_id: result.data?.id || String(result.data?.external_id || ''),
                            provider_response: result.data,
                            status_id: mappedStatusId,
                            'DigiCom Business': activeBusinessId
                        })
                        .select()
                        .single();

                    if (parcelError) throw parcelError;

                    console.log(`✅ Parcel created for ${order.name}:`, result.data?.tracking_code);
                    results.push({
                        order,
                        parcel,
                        tracking_code: result.data?.tracking_code || result.data?.reference || 'N/A'
                    });
                } catch (error) {
                    console.error(`❌ Parcel creation failed for ${order.name}:`, error);
                    results.push({
                        order,
                        error: error.message
                    });
                }
            }

            console.log('🏁 Batch creation finished. Results:', results);
            return results;
        },
        onSuccess: (results) => {
            // Merge by order id: the initial batch appends; a single-order RETRY replaces
            // that order's entry IN PLACE (failed -> success) without touching the others.
            setCreatedParcels(prev => {
                const byId = new Map(prev.map(p => [p.order.id, p]));
                for (const r of results) byId.set(r.order.id, r);
                return Array.from(byId.values());
            });
        }
    });

    // Per-order retry for parcels that failed at creation (connection/timeout, etc.).
    // Re-runs the exact same creation path (which sweeps any prior null-note row first,
    // so no duplicate), then merges the result in place. Keeps all other entries intact.
    const [retryingOrderId, setRetryingOrderId] = useState<string | null>(null);
    const [retryingAll, setRetryingAll] = useState(false);

    // Re-pull an order's CURRENT data from the DB before retrying, so a fix made
    // elsewhere (wrong city, phone, address, exchange tracking, even a changed provider)
    // is picked up instead of re-sending the stale in-memory copy that already failed.
    // Fresh DB data wins; any transient UI-only field on the existing object is preserved.
    const refetchOrderForRetry = async (order: WizardOrder): Promise<WizardOrder> => {
        const { data: fresh } = await supabase
            .from('orders')
            .select(`*, city:master_cities!inner(id, name, zone_id), company:providers(${WIZARD_PROVIDER_SELECT_FOR_PARCEL}), items:order_items(*, product:products(name, code))`)
            .eq('id', order.id)
            .maybeSingle();
        return (fresh ? { ...order, ...(fresh as object) } : order) as WizardOrder;
    };

    // After parcels are linked into a note, the carrier/package status is NOT in the
    // create/add-parcels response — the rows still read "Nouveau" until something fetches
    // live status (the Track button, the note-page sync loop, or a webhook). Pull it now,
    // for every freshly-linked parcel, via the same proven path the Track button uses.
    // Fire-and-forget + bounded concurrency: a tracking failure must never affect the
    // already-succeeded note creation.
    const syncLinkedParcelStatuses = async (parcels: TrackableParcel[]) => {
        const targets = parcels.filter(p => p.id && p.tracking_code && p.provider_id);
        if (targets.length === 0) return;
        let cursor = 0;
        const worker = async () => {
            while (cursor < targets.length) {
                const i = cursor++;
                try { await syncParcelTracking(targets[i]); } catch { /* non-blocking */ }
            }
        };
        await Promise.all(Array.from({ length: Math.min(4, targets.length) }, () => worker()));
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        queryClient.invalidateQueries({ queryKey: ['orders-aggregate'] });
    };

    const retryParcel = async (order: WizardOrder) => {
        if (!order.company_id) return;
        setRetryingOrderId(order.id);
        try {
            const refreshed = await refetchOrderForRetry(order);
            const providerId = refreshed.company_id || order.company_id;
            await createParcelsMutation.mutateAsync({ providerId, orders: [refreshed] });
        } catch (e) {
            // mutateAsync only throws on a hard failure (e.g. no session); per-parcel
            // failures come back as entries, not throws.
            console.error('Retry failed:', e);
        } finally {
            setRetryingOrderId(null);
        }
    };

    const retryAllFailed = async () => {
        setRetryingAll(true);
        try {
            // Snapshot the current failures and retry sequentially (avoid provider rate limits).
            const failed = createdParcels.filter(p => p.error && p.order.company_id);
            for (const entry of failed) {
                setRetryingOrderId(entry.order.id);
                try {
                    const refreshed = await refetchOrderForRetry(entry.order);
                    const providerId = refreshed.company_id || entry.order.company_id!;
                    await createParcelsMutation.mutateAsync({ providerId, orders: [refreshed] });
                } catch (e) {
                    console.error('Retry-all item failed:', e);
                }
            }
        } finally {
            setRetryingOrderId(null);
            setRetryingAll(false);
        }
    };

    // Create delivery note for provider — consolidates across all zones
    const createDeliveryNoteMutation = useMutation({
        mutationFn: async ({ providerId, parcelCodes }: { providerId: string; parcelCodes: string[] }) => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('Not authenticated');

            // Determine a zone_id from the parcels' orders for backward compat
            const relatedParcels = createdParcels.filter(p => parcelCodes.includes(p.tracking_code) && !p.error);
            const firstZoneId = relatedParcels[0]?.order?.city?.zone_id || null;

            // 1. Check if there is an existing OPEN delivery note for this Provider (across all zones)
            console.log('🔍 Checking for existing note:', { providerId, businessId: activeBusinessId });

            let draftQuery = supabase
                .from('company_delivery_notes')
                .select('*')
                .eq('provider_id', providerId)
                .eq('is_finalized', false)
                .eq('DigiCom Business', activeBusinessId);

            if (sellerScope) {
                draftQuery = draftQuery.eq('created_by', sellerScope.userId);
            } else if (session.user?.id) {
                draftQuery = draftQuery.or(
                    `created_by.eq.${session.user.id},created_by.is.null`
                );
            }

            const { data: draftRows, error: searchError } = await draftQuery
                .order('created_at', { ascending: false })
                .limit(1);

            if (searchError) {
                console.error('❌ Error searching for existing note:', searchError);
            }

            const existingNote = draftRows?.[0] ?? null;

            console.log('📝 Search result:', existingNote);

            let deliveryNoteRef;
            let deliveryNoteId;
            let externalId;

            if (existingNote) {
                deliveryNoteRef = existingNote.reference;
                deliveryNoteId = existingNote.id;
                externalId = existingNote.external_id;
                if (session.user?.id && !existingNote.created_by) {
                    await supabase
                        .from('company_delivery_notes')
                        .update({ created_by: session.user.id })
                        .eq('id', existingNote.id);
                }
            } else {
                // Create NEW delivery note via Edge Function
                const response = await fetch(EDGE_FUNCTION_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.access_token}`
                    },
                    body: JSON.stringify({
                        action: 'create_delivery_note',
                        provider_id: providerId
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || 'Failed to create delivery note');
                }

                const result = await response.json();
                deliveryNoteRef = result.data.reference;
                externalId = result.data?.id || String(result.data?.external_id || '');

                // Save new note to database — use first zone for backward compat
                const { data: note, error: noteError } = await supabase
                    .from('company_delivery_notes')
                    .insert({
                        provider_id: providerId,
                        zone_id: firstZoneId,
                        reference: deliveryNoteRef,
                        external_id: externalId,
                        parcel_count: 0,
                        is_finalized: false,
                        'DigiCom Business': activeBusinessId,
                        created_by: session.user?.id ?? null,
                    })
                    .select()
                    .single();

                if (noteError) throw noteError;
                deliveryNoteId = note.id;
            }

            // 2. Add parcels to the delivery note (new or existing)
            const addResponse = await fetch(EDGE_FUNCTION_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({
                    action: 'add_parcels_to_delivery_note',
                    provider_id: providerId,
                    data: {
                        delivery_note_ref: deliveryNoteRef,
                        delivery_note_id: deliveryNoteId,
                        external_id: externalId,
                        parcel_codes: parcelCodes
                    }
                })
            });

            if (!addResponse.ok) {
                const errorData = await addResponse.json().catch(() => ({}));
                console.error('❌ Edge Function add_parcels failed:', errorData);
                throw new Error(errorData.error || 'Failed to add parcels to delivery note');
            }

            console.log('✅ Edge Function Success. Updating local DB...');

            const addJson = await addResponse.json().catch(() => ({} as Record<string, unknown>));

            // Sendit-specific: on first add, the adapter upgrades the draft reference
            // (SENDIT-DRAFT-...) to the real pickup code (PXXXXXXX). Sync our local record.
            const sendit = (addJson as { data?: Record<string, unknown> })?.data as Record<string, unknown> | undefined;
            const newRef = sendit?.reference as string | undefined;
            const prevRef = sendit?.previous_reference as string | undefined;
            if (sendit?.changed_reference && newRef && prevRef && newRef !== prevRef) {
                console.log(`🔄 Sendit reference upgraded: ${prevRef} → ${newRef}`);
                await supabase
                    .from('company_delivery_notes')
                    .update({ reference: newRef, external_id: newRef })
                    .eq('id', deliveryNoteId);
                deliveryNoteRef = newRef;
                externalId = newRef;
            }

            // Coliaty duplicate detection. The edge wraps the adapter result as
            // { data: { data: { success_parcels, error_parcels } } }. Only Coliaty
            // returns this shape; every other provider falls through to the legacy
            // "link everything we asked for" behaviour (acceptedCodes = all codes).
            const addData = (sendit?.data as Record<string, unknown>) || {};
            const okParcels = addData.success_parcels;
            const errParcels = addData.error_parcels;
            const isColiatyShape = okParcels !== undefined || errParcels !== undefined;

            const acceptedCodes = new Set<string>();
            const duplicates: { error_id: number; code: string; message: string }[] = [];
            const otherErrors: { code: string; message: string }[] = [];

            if (!isColiatyShape) {
                // Legacy / non-Coliaty providers: behave exactly as before.
                for (const code of parcelCodes) acceptedCodes.add(code);
            } else {
                if (okParcels && !Array.isArray(okParcels)) {
                    for (const code of Object.keys(okParcels as Record<string, unknown>)) acceptedCodes.add(code);
                } else if (Array.isArray(okParcels)) {
                    for (const code of okParcels as string[]) acceptedCodes.add(code);
                }
                if (errParcels && !Array.isArray(errParcels)) {
                    for (const [code, raw] of Object.entries(errParcels as Record<string, Record<string, unknown>>)) {
                        const info = raw || {};
                        const errorId = Number(info.error_id);
                        const canIgnore = info.error_can_ignore === true && Number.isFinite(errorId) && errorId > 0;
                        const msg = String(info.error_message || info.message || '');
                        if (canIgnore) {
                            duplicates.push({ error_id: errorId, code, message: msg || 'Colis en double' });
                        } else if (
                            // "Le colis est déjà dans un bon de ramassage" for THIS note → already added.
                            /d[ée]j[àa] dans un bon/i.test(msg) &&
                            String(info.pickup_note_reference || '') === String(deliveryNoteRef)
                        ) {
                            acceptedCodes.add(code);
                        } else {
                            otherErrors.push({ code, message: msg || 'Erreur' });
                        }
                    }
                }
            }

            // 3. Link only the parcels Coliaty actually accepted into the note.
            const acceptedEntries = createdParcels
                .filter(p => p.tracking_code && acceptedCodes.has(p.tracking_code) && p.parcel?.id);
            const parcelIds = acceptedEntries.map(p => p.parcel!.id) as string[];

            console.log('🆔 Accepted parcel IDs to link:', parcelIds, '| duplicates:', duplicates.length, '| otherErrors:', otherErrors.length);

            if (parcelIds.length > 0) {
                // Atomic: link accepted parcels, recount the note, and flip their
                // orders CONFIRMED -> PROCESSED (guarded; never demotes UNPAID/PAID/
                // RETURN). Stock trigger deducts once. Replaces the old bare update +
                // separate recount.
                const { error: linkError } = await (supabase as any).rpc('link_company_parcels_to_delivery_note', {
                    p_delivery_note_id: deliveryNoteId,
                    p_parcel_ids: parcelIds,
                });

                if (linkError) {
                    console.error('❌ Error linking parcels to note:', linkError);
                    throw linkError;
                }

                // Pull live carrier status for the just-linked parcels so they show
                // "En attente de ramassage" immediately instead of staying "Nouveau"
                // until the user clicks Track. Fire-and-forget — never blocks the run.
                void syncLinkedParcelStatuses(acceptedEntries.map(p => ({
                    id: p.parcel!.id,
                    provider_id: providerId,
                    tracking_code: p.tracking_code as string,
                    external_id: (p.parcel as { external_id?: string | null })?.external_id ?? null,
                })));
            } else {
                // Nothing accepted this round (all duplicates/errors) — keep count honest.
                const { count } = await supabase
                    .from('company_parcels')
                    .select('*', { count: 'exact', head: true })
                    .eq('company_delivery_note_id', deliveryNoteId);

                await supabase
                    .from('company_delivery_notes')
                    .update({ parcel_count: count || 0 })
                    .eq('id', deliveryNoteId);
            }

            return {
                note: { id: deliveryNoteId, reference: deliveryNoteRef },
                providerId,
                isNew: !existingNote,
                deliveryNoteId,
                deliveryNoteRef,
                externalId,
                duplicates,
                otherErrors,
            } as AddNoteResult;
        },
        onSuccess: (result) => {
            setDeliveryNotes(prev => [...prev, result]);
            toast({
                title: result.isNew ? "Delivery Note Created" : "Parcels Added to Note",
                description: `Reference: ${result.note.reference}`
            });
        }
    });

    const handleProviderSelect = () => {
        if (!selectedProviderId) {
            toast({
                title: "Error",
                description: "Please select a provider",
                variant: "destructive"
            });
            return;
        }
        // Initialize selectedOrderIds with all orders from ordersGrouped
        if (ordersGrouped) {
            type OrderGroup = { provider: WizardProvider | null; orders: WizardOrder[] };
            const allIds = new Set<string>();
            for (const group of Object.values(ordersGrouped as Record<string, OrderGroup>)) {
                for (const order of group.orders) {
                    allIds.add(order.id);
                }
            }
            setSelectedOrderIds(allIds);
        }
        setStep('select-orders');
    };

    const handleOrderSelectionConfirm = () => {
        if (selectedOrderIds.size === 0) {
            toast({ title: "Error", description: "Please select at least one order", variant: "destructive" });
            return;
        }
        setStep('creating');
        handleCreateParcels();
    };

    const handleCreateParcels = async () => {
        if (!ordersGrouped) return;

        setCreatedParcels([]);

        type OrderGroup = { provider: WizardProvider | null; orders: WizardOrder[] };
        for (const [providerId, group] of Object.entries(ordersGrouped as Record<string, OrderGroup>)) {
            const { provider, orders } = group;
            const filteredOrders = orders.filter(o => selectedOrderIds.has(o.id));
            if (filteredOrders.length === 0) continue;
            setCurrentProvider(provider?.name || '');
            await createParcelsMutation.mutateAsync({ providerId, orders: filteredOrders });
        }

        setStep('review');
    };

    const finalizeAndClose = (noteCount: number, extra?: string) => {
        queryClient.invalidateQueries({ queryKey: ['company-delivery-notes'] });
        queryClient.invalidateQueries({ queryKey: ['seller-company-delivery-notes'] });
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        queryClient.invalidateQueries({ queryKey: ['orders-aggregate'] });
        queryClient.invalidateQueries({ queryKey: ['confirmed-orders-by-provider'] });

        toast({
            title: "Success!",
            description: `Created ${noteCount} delivery note(s) and updated order statuses${extra ? ` · ${extra}` : ''}`
        });

        onOpenChange(false);
        resetWizard();
    };

    const handleConfirmDeliveryNotes = async () => {
        setStep('finalizing');

        // Group parcels by provider
        const parcelsByProvider = createdParcels.reduce<Record<string, string[]>>((acc, p) => {
            if (!p.error && p.tracking_code) {
                const providerId = p.order.company_id;
                if (!providerId) return acc;
                if (!acc[providerId]) acc[providerId] = [];
                acc[providerId].push(p.tracking_code);
            }
            return acc;
        }, {});

        if (Object.keys(parcelsByProvider).length === 0) {
            toast({
                title: "No Parcels to Add",
                description: "There are no successful parcels to include in a delivery note.",
                variant: "destructive"
            });
            setStep('review');
            return;
        }

        console.log('📦 Starting delivery note confirmation for:', parcelsByProvider);

        const collectedDuplicates: DuplicateEntry[] = [];
        const failedProviders: string[] = [];

        for (const [pId, codes] of Object.entries(parcelsByProvider)) {
            const providerId = pId as string;
            const parcelCodes = codes as string[];

            if (!parcelCodes || parcelCodes.length === 0) continue;

            console.log(`🚀 Finalizing note for provider ${providerId} with ${parcelCodes.length} parcels`);
            try {
                const res = (await createDeliveryNoteMutation.mutateAsync({ providerId, parcelCodes })) as AddNoteResult;

                for (const d of res.duplicates || []) {
                    const entry = createdParcels.find(p => p.tracking_code === d.code);
                    collectedDuplicates.push({
                        providerId,
                        errorId: d.error_id,
                        code: d.code,
                        message: d.message,
                        order: entry?.order ?? null,
                        parcelId: entry?.parcel?.id ?? null,
                        deliveryNoteId: res.deliveryNoteId,
                        deliveryNoteRef: res.deliveryNoteRef,
                        externalId: res.externalId,
                    });
                }

                if (res.otherErrors?.length) {
                    toast({
                        title: "Some parcels were rejected",
                        description: `${res.otherErrors.length} parcel(s) could not be added: ${res.otherErrors.map(e => e.message).slice(0, 2).join('; ')}`,
                        variant: "destructive"
                    });
                }
            } catch (err) {
                console.error(`❌ Confirmation failed for provider ${providerId}:`, err);
                failedProviders.push(providerId);
                toast({
                    title: "Échec — réessayez",
                    description: `Le bon n'a pas pu être finalisé pour un transporteur. Les colis existent déjà chez le transporteur : cliquez de nouveau sur « Generate Delivery Notes » pour les relier au bon et éviter de les laisser orphelins.`,
                    variant: "destructive"
                });
            }
        }

        // Coliaty surfaced same-phone duplicates → let the user decide before closing.
        if (collectedDuplicates.length > 0) {
            setDuplicateParcels(collectedDuplicates);
            setSelectedDuplicateIds(new Set(collectedDuplicates.map(d => d.errorId)));
            setStep('duplicates');
            return;
        }

        // BLOCK the auto-close if any provider's note step failed. Those parcels exist
        // on the provider but are not yet in a note (orphan risk, and no cancel endpoint
        // to undo them). Keep the modal on the review screen so the user can retry —
        // retrying reuses the open draft and re-links the already-created parcels
        // idempotently instead of abandoning them.
        if (failedProviders.length > 0) {
            setStep('review');
            return;
        }

        finalizeAndClose(Object.keys(parcelsByProvider).length);
    };

    // Apply the user's duplicate decision: ignore (keep) the selected parcels via
    // Coliaty's error-ignore endpoint then re-add them to their note; skip the rest
    // and clean up their orphan company_parcels rows so our DB never claims a parcel
    // is in a note when Coliaty rejected it.
    const handleApplyDuplicateDecision = async () => {
        setStep('finalizing');

        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
            toast({ title: "Not authenticated", description: "Please log in again.", variant: "destructive" });
            setStep('duplicates');
            return;
        }

        const postEdge = (action: string, providerId: string, payload: Record<string, unknown>) =>
            fetch(EDGE_FUNCTION_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                body: JSON.stringify({ action, provider_id: providerId, data: payload })
            });

        const toIgnore = duplicateParcels.filter(d => selectedDuplicateIds.has(d.errorId));
        const toSkip = duplicateParcels.filter(d => !selectedDuplicateIds.has(d.errorId));

        // Group the ignore set by provider (note context is identical within a provider).
        const byProvider = new Map<string, DuplicateEntry[]>();
        for (const d of toIgnore) {
            if (!byProvider.has(d.providerId)) byProvider.set(d.providerId, []);
            byProvider.get(d.providerId)!.push(d);
        }

        let ignoredCount = 0;
        for (const [providerId, items] of byProvider.entries()) {
            const ctx = items[0];
            try {
                // 1. Acknowledge the duplicate errors on Coliaty's side.
                const ignoreRes = await postEdge('ignore_parcel_errors', providerId, {
                    error_ids: items.map(i => i.errorId),
                });
                if (!ignoreRes.ok) {
                    const e = await ignoreRes.json().catch(() => ({}));
                    throw new Error(e.error || 'ignore_parcel_errors failed');
                }

                // 2. Re-add the now-accepted parcels to the same delivery note.
                const addRes = await postEdge('add_parcels_to_delivery_note', providerId, {
                    delivery_note_ref: ctx.deliveryNoteRef,
                    delivery_note_id: ctx.deliveryNoteId,
                    external_id: ctx.externalId,
                    parcel_codes: items.map(i => i.code),
                });
                const addJson = await addRes.json().catch(() => ({}));
                const addData = (addJson?.data?.data as Record<string, unknown>) || {};
                const stillErr = addData.error_parcels;
                const stillErrCodes = stillErr && !Array.isArray(stillErr)
                    ? new Set(Object.keys(stillErr as Record<string, unknown>))
                    : new Set<string>();

                // 3. Link the parcels that made it in this time — atomic link + recount
                //    + guarded CONFIRMED -> PROCESSED flip via the same RPC.
                const linkIds = items
                    .filter(i => !stillErrCodes.has(i.code) && i.parcelId)
                    .map(i => i.parcelId) as string[];
                if (linkIds.length > 0) {
                    await (supabase as any).rpc('link_company_parcels_to_delivery_note', {
                        p_delivery_note_id: ctx.deliveryNoteId,
                        p_parcel_ids: linkIds,
                    });
                    // Same live-status pull as the primary path so kept duplicates also
                    // leave "Nouveau" without needing the Track button.
                    void syncLinkedParcelStatuses(items
                        .filter(i => !stillErrCodes.has(i.code) && i.parcelId)
                        .map(i => ({
                            id: i.parcelId as string,
                            provider_id: providerId,
                            tracking_code: i.code,
                            external_id: null,
                        })));
                }
                ignoredCount += linkIds.length;

                if (stillErrCodes.size > 0) {
                    toast({
                        title: "Still rejected after ignore",
                        description: `${stillErrCodes.size} parcel(s) were not accepted even after ignoring.`,
                        variant: "destructive"
                    });
                }
            } catch (err) {
                console.error(`❌ Ignore/re-add failed for provider ${providerId}:`, err);
                toast({
                    title: "Could not keep duplicates",
                    description: (err as Error).message,
                    variant: "destructive"
                });
            }
        }

        // Skipped duplicates: drop the orphan parcel rows (they are not in any note).
        const skipIds = toSkip.map(d => d.parcelId).filter(Boolean) as string[];
        if (skipIds.length > 0) {
            await supabase
                .from('company_parcels')
                .delete()
                .in('id', skipIds)
                .is('company_delivery_note_id', null);
        }

        const notesTouched = new Set(duplicateParcels.map(d => d.deliveryNoteId)).size;
        const extra = [
            ignoredCount ? `${ignoredCount} duplicate(s) kept` : '',
            toSkip.length ? `${toSkip.length} skipped` : '',
        ].filter(Boolean).join(', ');
        finalizeAndClose(Math.max(notesTouched, deliveryNotes.length), extra);
    };

    const resetWizard = () => {
        setStep('provider');
        setSelectedProviderId('');
        setCreatedParcels([]);
        setDeliveryNotes([]);
        setDuplicateParcels([]);
        setSelectedDuplicateIds(new Set());
        setCurrentProvider('');
        setSelectedOrderIds(new Set());
        setOrderSearch('');
        // A reset means the run is finished or abandoned — drop any persisted progress.
        clearWizardSnapshot(STORAGE_KEY);
        setRestoredOpen(false);
    };

    // Close handler: X / Cancel / Esc just HIDES the wizard and KEEPS the progress (the
    // snapshot + in-memory state survive) so the user can fix an order elsewhere and
    // resume. Provider parcels can't be cancelled, so closing must never silently drop
    // them. Clearing is explicit, via discardProgress() / Start Over, or on success.
    const handleOpenChange = (next: boolean) => {
        if (!next) setRestoredOpen(false);
        onOpenChange(next);
    };

    // Explicit abandon: wipe the run (state + snapshot). The already-created parcels stay
    // on the provider as orphans — there is no cancel endpoint — so this is intentional.
    const discardProgress = () => {
        resetWizard();
        onOpenChange(false);
    };

    // Persist an in-progress run on every meaningful change.
    React.useEffect(() => {
        const inProgress = (open || restoredOpen)
            && createdParcels.length > 0
            && (step === 'creating' || step === 'review' || step === 'duplicates' || step === 'finalizing');
        if (!inProgress) return;
        writeWizardSnapshot(STORAGE_KEY, {
            v: 1,
            step,
            selectedProviderId,
            createdParcels,
            deliveryNotes,
            duplicateParcels,
            selectedDuplicateIds: [...selectedDuplicateIds],
            currentProvider,
            selectedOrderIds: [...selectedOrderIds],
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, restoredOpen, step, selectedProviderId, createdParcels, deliveryNotes, duplicateParcels, selectedDuplicateIds, currentProvider, selectedOrderIds]);

    // The wizard stays MOUNTED across opens (the parent always renders it), and it only
    // resets state on a clean finish — not when the user closes via X / Escape / outside
    // click, nor on the duplicates "Back". Without this, an abandoned run leaves stale
    // `step`, `createdParcels`, `duplicateParcels` behind; the next open then re-submits
    // already-noted parcels, which Coliaty answers with the benign "déjà dans un bon de
    // ramassage" instead of a same-phone DUPLICATE — so the ignore step silently never
    // shows again ("works once, then stops"). Reset on every open to guarantee a clean run.
    React.useEffect(() => {
        if (open) {
            // Resume an in-progress / restored run instead of wiping it. A fresh open
            // (no created parcels) resets to a clean wizard as before.
            if (createdParcels.length > 0) {
                if (lockProviderId) setSelectedProviderId(lockProviderId);
                return;
            }
            resetWizard();
            if (lockProviderId) setSelectedProviderId(lockProviderId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Reload / tab-close guard. Once a parcel is created it already exists on the
    // provider; reloading before the delivery note is generated leaves it ORPHANED in
    // the provider's dashboard. Warn before unload while any successful parcel is still
    // unsaved. (Browsers render their own generic confirmation text — the message string
    // is best-effort and not shown verbatim by Chrome/Firefox.)
    const hasUnsavedParcels = isOpen && createdParcels.some(p => !p.error);
    React.useEffect(() => {
        if (!hasUnsavedParcels) return;
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = 'Des colis ont été créés mais le bon de livraison n’est pas encore généré. Si vous quittez maintenant, ils resteront orphelins dans le tableau de bord du transporteur.';
            return e.returnValue;
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [hasUnsavedParcels]);

    const filteredProviders = useMemo(() => {
        if (!availableProviders) return [];
        return availableProviders.filter(p =>
            p.name.toLowerCase().includes(providerSearch.toLowerCase())
        );
    }, [availableProviders, providerSearch]);

    const totalOrderCount = useMemo(() => {
        if (!ordersGrouped) return 0;
        type OrderGroup = { provider: WizardProvider | null; orders: WizardOrder[] };
        return Object.values(ordersGrouped as Record<string, OrderGroup>).reduce((sum: number, g) => sum + g.orders.length, 0);
    }, [ordersGrouped]);

    const successfulParcels = createdParcels.filter(p => !p.error);
    const failedParcels = createdParcels.filter(p => p.error);

    return (
        <>
            {/* Resume affordance: when an in-progress run exists but the wizard is closed,
                a floating pill lets the user reopen it (after navigating away to fix an
                order). Keeps the page fully interactive — no modal blur while parked. */}
            {createdParcels.length > 0 && !isOpen && (
                <button
                    type="button"
                    onClick={() => setRestoredOpen(true)}
                    className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-2xl bg-ant-ink px-4 py-3 text-white shadow-xl ring-1 ring-white/10 hover:bg-ant-ink/90 transition-colors"
                >
                    <span className="relative flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ant-orange/70" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ant-orange" />
                    </span>
                    <span className="text-left leading-tight">
                        <span className="block text-[13px] font-semibold">Reprendre la création</span>
                        <span className="block text-[11px] text-white/60">
                            {createdParcels.length} colis non finalisé{createdParcels.length > 1 ? 's' : ''}
                        </span>
                    </span>
                    <RotateCw className="w-4 h-4 ml-1 text-white/80" />
                </button>
            )}
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent
                className="sm:max-w-[700px] grid-cols-[minmax(0,1fr)] rounded-2xl border-none p-0 overflow-hidden [&>button]:text-white [&>button]:opacity-80 [&>button]:hover:opacity-100 [&>button]:z-50"
                onInteractOutside={(e) => e.preventDefault()}
            >
                {step === 'provider' && (
                    <>
                        <div className="bg-ant-ink p-8 text-white relative">
                            <DialogTitle className="text-2xl font-semibold">Select Provider</DialogTitle>
                            <DialogDescription className="text-white/60 font-medium">
                                Choose a shipping provider to generate delivery notes for all confirmed orders.
                            </DialogDescription>
                        </div>

                        <div className="p-8 space-y-6">
                            <div className="relative">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ant-muted" />
                                <Input
                                    placeholder="Search providers..."
                                    value={providerSearch}
                                    onChange={(e) => setProviderSearch(e.target.value)}
                                    className="pl-11 h-12 bg-ant-light border-none rounded-2xl"
                                />
                            </div>

                            <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                {lockProviderId ? (
                                    <div className="p-4 rounded-2xl border-2 border-ant-ink bg-ant-ink/5">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <div className="font-bold text-ant-ink">
                                                    {availableProviders?.find(p => p.id === lockProviderId)?.name || 'Selected Provider'}
                                                </div>
                                                <div className="text-xs text-ant-muted mt-1">
                                                    Adding orders to existing delivery note
                                                </div>
                                            </div>
                                            <Badge className="bg-ant-ink text-white">LOCKED</Badge>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {/* All Providers option */}
                                        {filteredProviders.length > 1 && (
                                            <button
                                                onClick={() => setSelectedProviderId('all')}
                                                className={`w-full p-4 rounded-2xl border-2 transition-all text-left ${selectedProviderId === 'all'
                                                    ? 'border-ant-ink bg-ant-ink/5'
                                                    : 'border-slate-200 hover:border-ant-ink/30'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-xl bg-ant-ink/10 flex items-center justify-center">
                                                        <Layers className="w-5 h-5 text-ant-ink" />
                                                    </div>
                                                    <div className="flex-1">
                                                        <div className="font-bold text-ant-ink">All Providers</div>
                                                        <div className="text-xs text-ant-muted mt-1">
                                                            {availableProviders?.reduce((s, p) => s + p.orderCount, 0) || 0} orders across {availableProviders?.length || 0} providers
                                                        </div>
                                                    </div>
                                                </div>
                                            </button>
                                        )}

                                        {/* Individual providers */}
                                        {filteredProviders.map((provider) => {
                                            const providerLogo = resolveProviderLogo(provider);
                                            return (
                                            <button
                                                key={provider.id}
                                                onClick={() => setSelectedProviderId(provider.id)}
                                                className={`w-full p-4 rounded-2xl border-2 transition-all text-left ${selectedProviderId === provider.id
                                                    ? 'border-ant-ink bg-ant-ink/5'
                                                    : 'border-slate-200 hover:border-ant-ink/30'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div
                                                        className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden"
                                                        style={{ backgroundColor: providerLogo ? 'transparent' : (provider.color ? `${provider.color}15` : 'rgba(59, 130, 246, 0.1)') }}
                                                    >
                                                        {providerLogo ? (
                                                            <img src={providerLogo} alt={provider.name} className="w-full h-full object-contain bg-white mix-blend-multiply" />
                                                        ) : (
                                                            <Building2 className="w-5 h-5" style={{ color: provider.color || '#3b82f6' }} />
                                                        )}
                                                    </div>
                                                    <div className="flex-1">
                                                        <div className="font-bold text-ant-ink">{provider.name}</div>
                                                        <div className="text-xs text-ant-muted mt-1">
                                                            {provider.orderCount} confirmed orders • {provider.provider_type?.toUpperCase() || 'N/A'}
                                                        </div>
                                                    </div>
                                                    <Badge variant="outline" className="text-[10px] font-semibold text-ant-ink/60 border-ant-ink/10">
                                                        {provider.orderCount}
                                                    </Badge>
                                                </div>
                                            </button>
                                            );
                                        })}

                                        {filteredProviders.length === 0 && (
                                            <div className="text-center py-8 text-ant-muted text-sm">
                                                No providers with confirmed orders found.
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            {selectedProviderId && ordersGrouped && (
                                <div className="space-y-3 pt-4 border-t">
                                    <div className="text-sm font-bold text-ant-ink/60">Orders to Process:</div>
                                    <div className="flex gap-3 flex-wrap">
                                        {Object.values(ordersGrouped as Record<string, { provider: WizardProvider | null; orders: WizardOrder[] }>).map(({ provider, orders }) => {
                                            const providerLogo = resolveProviderLogo(provider);
                                            return (
                                            <div key={provider?.id || 'unknown'} className="flex items-center gap-3 p-3 bg-ant-light rounded-xl flex-1 min-w-[200px]">
                                                <div
                                                    className="w-10 h-10 rounded-xl flex flex-shrink-0 items-center justify-center overflow-hidden"
                                                    style={{ backgroundColor: providerLogo ? 'transparent' : (provider.color ? `${provider.color}15` : 'rgba(59, 130, 246, 0.1)') }}
                                                >
                                                    {providerLogo ? (
                                                        <img src={providerLogo} alt={provider.name} className="w-full h-full object-contain bg-white mix-blend-multiply" />
                                                    ) : (
                                                        <Building2 className="w-5 h-5" style={{ color: provider.color || '#3b82f6' }} />
                                                    )}
                                                </div>
                                                <div className="flex-1">
                                                    <div className="font-bold text-sm">{provider.name}</div>
                                                    <div className="text-xs text-ant-muted">{orders.length} orders (all zones)</div>
                                                </div>
                                            </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            <DialogFooter>
                                <Button variant="ghost" onClick={() => handleOpenChange(false)}>Cancel</Button>
                                <Button
                                    onClick={handleProviderSelect}
                                    disabled={!selectedProviderId}
                                    className="bg-ant-ink hover:bg-ant-ink/90 text-white rounded-2xl"
                                >
                                    Next: Select Orders
                                </Button>
                            </DialogFooter>
                        </div>
                    </>
                )}

                {step === 'select-orders' && ordersGrouped && (() => {
                    type OrderGroup = { provider: WizardProvider | null; orders: WizardOrder[] };
                    const allOrders = Object.values(ordersGrouped as Record<string, OrderGroup>).flatMap(g => g.orders);
                    const allSelected = allOrders.length > 0 && allOrders.every(o => selectedOrderIds.has(o.id));
                    // Free-text match against every piece of order info.
                    const q = orderSearch.trim().toLowerCase();
                    const matches = (order: WizardOrder) => {
                        if (!q) return true;
                        const itemLabels = (order.items || [])
                            .map(i => [i.product?.name, i.product?.code].filter(Boolean).join(' '))
                            .join(' ');
                        const hay = [
                            order.name,
                            order.phone,
                            order.address,
                            order.city?.name,
                            order.coliaty_old_tracking,
                            order.ameex_old_tracking,
                            order.quicklivraison_old_tracking,
                            order.forcelog_old_tracking,
                            order.sendit_old_tracking,
                            order.delvoexpress_old_tracking,
                            String(order.price ?? ''),
                            itemLabels,
                        ].filter(Boolean).join(' ').toLowerCase();
                        return hay.includes(q);
                    };
                    const filteredEntries = Object.entries(ordersGrouped as Record<string, OrderGroup>)
                        .map(([providerId, g]) => [providerId, { ...g, orders: g.orders.filter(matches) }] as [string, OrderGroup])
                        .filter(([, g]) => g.orders.length > 0);
                    const visibleCount = filteredEntries.reduce((s, [, g]) => s + g.orders.length, 0);
                    return (
                        <>
                            <div className="bg-ant-ink p-8 text-white relative">
                                <DialogHeader>
                                    <DialogTitle className="text-2xl font-semibold text-white flex items-center gap-3">
                                        <ListChecks className="w-7 h-7" />
                                        Select Orders
                                    </DialogTitle>
                                    <DialogDescription className="text-white/60 font-medium">
                                        {allOrders.length} orders available — {selectedOrderIds.size} selected
                                    </DialogDescription>
                                </DialogHeader>
                            </div>

                            <div className="p-8 space-y-4">
                                <div className="flex items-center gap-3">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                        <Input
                                            value={orderSearch}
                                            onChange={(e) => setOrderSearch(e.target.value)}
                                            placeholder="Search by name, phone, tracking, product, city..."
                                            className="h-10 pl-9 pr-9 rounded-xl border-slate-200 text-sm"
                                        />
                                        {orderSearch && (
                                            <button
                                                type="button"
                                                onClick={() => setOrderSearch('')}
                                                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md hover:bg-slate-100 flex items-center justify-center text-slate-400"
                                                aria-label="Clear search"
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (allSelected) {
                                                setSelectedOrderIds(new Set());
                                            } else {
                                                setSelectedOrderIds(new Set(allOrders.map(o => o.id)));
                                            }
                                        }}
                                        className="flex items-center gap-2 text-sm font-bold text-ant-ink hover:text-ant-ink/70 transition-colors shrink-0 px-3 h-10 rounded-xl border border-slate-200"
                                    >
                                        <Checkbox checked={allSelected} />
                                        {allSelected ? 'Deselect all' : `Select all · ${allOrders.length}`}
                                    </button>
                                </div>
                                {orderSearch && (
                                    <div className="text-xs text-ant-muted">
                                        {visibleCount} of {allOrders.length} orders match
                                    </div>
                                )}

                                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                    {filteredEntries.length === 0 && (
                                        <div className="text-center py-8 text-sm text-ant-muted italic">
                                            No orders match "{orderSearch}"
                                        </div>
                                    )}
                                    {filteredEntries.map(([providerId, { provider, orders }]) => {
                                        const providerLogo = resolveProviderLogo(provider);
                                        return (
                                        <div key={providerId}>
                                            {selectedProviderId === 'all' && (
                                                <div className="flex items-center gap-2 py-2 px-1">
                                                    <div
                                                        className="w-6 h-6 rounded-lg flex items-center justify-center overflow-hidden"
                                                        style={{ backgroundColor: providerLogo ? 'transparent' : (provider?.color ? `${provider.color}15` : 'rgba(59, 130, 246, 0.1)') }}
                                                    >
                                                        {providerLogo ? (
                                                            <img src={providerLogo} alt={provider?.name || ''} className="w-full h-full object-contain" />
                                                        ) : (
                                                            <Building2 className="w-3.5 h-3.5" style={{ color: provider?.color || '#3b82f6' }} />
                                                        )}
                                                    </div>
                                                    <span className="text-xs font-bold text-ant-ink/60 uppercase tracking-wide">{provider?.name}</span>
                                                </div>
                                            )}
                                            {orders.map((order) => (
                                                <button
                                                    key={order.id}
                                                    onClick={() => {
                                                        setSelectedOrderIds(prev => {
                                                            const next = new Set(prev);
                                                            if (next.has(order.id)) next.delete(order.id);
                                                            else next.add(order.id);
                                                            return next;
                                                        });
                                                    }}
                                                    className={`w-full p-3 rounded-xl border transition-all text-left flex items-center gap-3 ${
                                                        selectedOrderIds.has(order.id)
                                                            ? 'border-ant-ink/30 bg-ant-ink/5'
                                                            : 'border-slate-200 hover:border-slate-300'
                                                    }`}
                                                >
                                                    <Checkbox checked={selectedOrderIds.has(order.id)} className="pointer-events-none" />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-bold text-sm text-ant-ink truncate">{order.name || 'No name'}</div>
                                                        <div className="text-xs text-ant-muted mt-0.5">
                                                            {order.phone || '—'}
                                                            {order.city?.name ? ` · ${order.city.name}` : ''}
                                                            {order.price != null ? ` · ${order.price} MAD` : ''}
                                                        </div>
                                                        {order.items && order.items.length > 0 && (() => {
                                                            const activeItems = order.items.filter(i => i.quantity > 0);
                                                            const totalUnits = activeItems.reduce((s, i) => s + i.quantity, 0);
                                                            return (
                                                                <div className="text-[10px] text-ant-mid mt-0.5 line-clamp-2 break-words">
                                                                    <span className="font-semibold text-ant-ink/60 mr-1">{activeItems.length} item{activeItems.length > 1 ? 's' : ''} · {totalUnits} unit{totalUnits > 1 ? 's' : ''}:</span>
                                                                    {activeItems.map(i => `${i.product?.code || i.product?.name || 'P'} x${i.quantity}`).join(', ')}
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                        );
                                    })}
                                </div>

                                <DialogFooter>
                                    <Button variant="ghost" onClick={() => setStep('provider')}>
                                        Back
                                    </Button>
                                    <Button
                                        onClick={handleOrderSelectionConfirm}
                                        disabled={selectedOrderIds.size === 0}
                                        className="bg-ant-ink hover:bg-ant-ink/90 text-white rounded-2xl"
                                    >
                                        <Package className="w-4 h-4 mr-2" />
                                        Create Parcels ({selectedOrderIds.size})
                                    </Button>
                                </DialogFooter>
                            </div>
                        </>
                    );
                })()}

                {step === 'creating' && (
                    <div className="p-16 text-center space-y-6">
                        <Loader2 className="w-16 h-16 animate-spin mx-auto text-ant-ink" />
                        <div>
                            <div className="text-xl font-semibold text-ant-ink">Creating Parcels...</div>
                            <div className="text-sm text-ant-muted mt-2">Provider: {currentProvider}</div>
                        </div>
                    </div>
                )}

                {step === 'review' && (
                    <>
                        <div className="bg-ant-ink p-8 text-white">
                            <DialogTitle className="text-2xl font-semibold">Review Parcels</DialogTitle>
                            <DialogDescription className="text-white/60 font-medium">
                                {successfulParcels.length} parcels created successfully
                            </DialogDescription>
                        </div>

                        <div className="p-8 space-y-4 max-h-[500px] overflow-y-auto">
                            {successfulParcels.map((item, idx) => (
                                <div key={idx} className="p-4 bg-ant-green/10 rounded-2xl border border-emerald-200">
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="font-bold text-ant-ink">{item.order.name}</div>
                                            <div className="text-xs text-ant-muted">{item.order.phone}</div>
                                        </div>
                                        <Badge className="bg-ant-green text-white border-none">
                                            {item.tracking_code}
                                        </Badge>
                                    </div>
                                </div>
                            ))}

                            {failedParcels.length > 0 && (
                                <div className="space-y-4 pt-4 border-t">
                                    <div className="text-sm font-bold text-ant-rose flex items-center gap-2">
                                        <AlertCircle className="w-4 h-4" />
                                        Failed to create ({failedParcels.length})
                                    </div>
                                    {failedParcels.map((item, idx) => (
                                        <div key={idx} className="p-4 bg-ant-rose/10 rounded-2xl border border-red-200 flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="font-bold text-red-900">{item.order.name}</div>
                                                <div className="text-xs text-ant-rose mt-1 break-words">{item.error}</div>
                                            </div>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => retryParcel(item.order)}
                                                disabled={retryingOrderId === item.order.id || retryingAll}
                                                className="shrink-0 rounded-xl border-ant-rose/30 text-ant-rose hover:bg-ant-rose/10"
                                            >
                                                {retryingOrderId === item.order.id
                                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                    : <><RotateCw className="w-3.5 h-3.5 mr-1.5" />Réessayer</>}
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="p-8 pt-0 space-y-3">
                            <p className="text-[11px] text-ant-muted">
                                Fermer (✕) garde la progression — un bouton « Reprendre » apparaîtra pour y revenir.
                                « Annuler la progression » abandonne les colis (ils resteront chez le transporteur).
                            </p>
                            <DialogFooter className="sm:justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    {/* All failed → Start Over (nothing on the provider to keep).
                                        Some succeeded → explicit Discard (orphans the created parcels). */}
                                    {successfulParcels.length === 0 ? (
                                        <Button variant="ghost" onClick={resetWizard} disabled={retryingAll || retryingOrderId !== null}>Start Over</Button>
                                    ) : (
                                        <Button variant="ghost" onClick={discardProgress} disabled={retryingAll || retryingOrderId !== null} className="text-ant-rose hover:bg-ant-rose/10">
                                            Annuler la progression
                                        </Button>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    {failedParcels.length > 1 && (
                                        <Button
                                            variant="outline"
                                            onClick={retryAllFailed}
                                            disabled={retryingAll || retryingOrderId !== null}
                                            className="rounded-2xl border-ant-rose/30 text-ant-rose hover:bg-ant-rose/10"
                                        >
                                            {retryingAll ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RotateCw className="w-4 h-4 mr-2" />}
                                            Réessayer tout ({failedParcels.length})
                                        </Button>
                                    )}
                                    <Button
                                        onClick={handleConfirmDeliveryNotes}
                                        disabled={successfulParcels.length === 0 || retryingAll || retryingOrderId !== null}
                                        className="bg-ant-ink hover:bg-ant-ink/90 text-white rounded-2xl"
                                    >
                                        <FileText className="w-4 h-4 mr-2" />
                                        Generate Delivery Notes
                                    </Button>
                                </div>
                            </DialogFooter>
                        </div>
                    </>
                )}

                {step === 'duplicates' && (() => {
                    const total = duplicateParcels.length;
                    const selectedCount = duplicateParcels.filter(d => selectedDuplicateIds.has(d.errorId)).length;
                    const allSelected = total > 0 && selectedCount === total;
                    const toggle = (id: number) => setSelectedDuplicateIds(prev => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id); else next.add(id);
                        return next;
                    });
                    const primaryLabel = selectedCount === 0
                        ? 'Skip all & finish'
                        : selectedCount === total
                            ? `Keep all ${total} & finish`
                            : `Keep ${selectedCount} & finish`;
                    return (
                        <>
                            <div className="bg-ant-ink p-8 text-white relative">
                                <DialogHeader>
                                    <DialogTitle className="text-2xl font-semibold text-white flex items-center gap-3">
                                        <AlertTriangle className="w-7 h-7 text-ant-orange" />
                                        Duplicate Parcels
                                    </DialogTitle>
                                    <DialogDescription className="text-white/60 font-medium">
                                        Coliaty flagged {total} parcel{total > 1 ? 's' : ''} as duplicate{total > 1 ? 's' : ''} (a parcel with the same phone already exists). Choose which to keep — kept parcels are added to the delivery note; the rest are skipped.
                                    </DialogDescription>
                                </DialogHeader>
                            </div>

                            <div className="p-8 space-y-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="text-sm text-ant-muted">
                                        {selectedCount} of {total} selected to keep
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedDuplicateIds(allSelected ? new Set() : new Set(duplicateParcels.map(d => d.errorId)))}
                                        className="flex items-center gap-2 text-sm font-bold text-ant-ink hover:text-ant-ink/70 transition-colors shrink-0 px-3 h-10 rounded-xl border border-slate-200 cursor-pointer"
                                    >
                                        <Checkbox checked={allSelected} className="pointer-events-none" />
                                        {allSelected ? 'Deselect all' : `Select all · ${total}`}
                                    </button>
                                </div>

                                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                    {duplicateParcels.map((d) => {
                                        const checked = selectedDuplicateIds.has(d.errorId);
                                        return (
                                            <button
                                                key={d.errorId}
                                                type="button"
                                                onClick={() => toggle(d.errorId)}
                                                className={`w-full p-3 rounded-xl border transition-colors duration-200 text-left flex items-center gap-3 cursor-pointer ${
                                                    checked ? 'border-ant-orange/40 bg-ant-orange/5' : 'border-slate-200 hover:border-slate-300'
                                                }`}
                                            >
                                                <Checkbox checked={checked} className="pointer-events-none" />
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-bold text-sm text-ant-ink truncate">{d.order?.name || d.code}</div>
                                                    <div className="text-xs text-ant-muted mt-0.5 truncate">
                                                        {d.order?.phone || '—'}
                                                        {d.order?.city?.name ? ` · ${d.order.city.name}` : ''}
                                                        {` · ${d.code}`}
                                                    </div>
                                                    <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-ant-orange/10 px-2 py-1 text-[11px] font-medium text-ant-orange max-w-full">
                                                        <AlertTriangle className="w-3 h-3 shrink-0" />
                                                        <span className="truncate">{d.message}</span>
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>

                                <DialogFooter>
                                    <Button variant="ghost" onClick={() => setStep('review')} className="cursor-pointer">
                                        Back
                                    </Button>
                                    <Button
                                        onClick={handleApplyDuplicateDecision}
                                        className="bg-ant-ink hover:bg-ant-ink/90 text-white rounded-2xl cursor-pointer"
                                    >
                                        {selectedCount > 0 && <CheckCircle2 className="w-4 h-4 mr-2" />}
                                        {primaryLabel}
                                    </Button>
                                </DialogFooter>
                            </div>
                        </>
                    );
                })()}

                {step === 'finalizing' && (
                    <div className="p-16 text-center space-y-6">
                        <Loader2 className="w-16 h-16 animate-spin mx-auto text-ant-ink" />
                        <div>
                            <div className="text-xl font-semibold text-ant-ink">Generating Delivery Notes...</div>
                            <div className="text-sm text-ant-muted mt-2">Please wait</div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
        </>
    );
};
