/* eslint-disable react-refresh/only-export-components */
import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
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
import { Separator } from "@/components/ui/separator";
import { useToast } from '@/hooks/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Search,
    Building2,
    Package,
    Loader2,
    CheckCircle2,
    AlertCircle,
    Truck,
    FileText,
    ExternalLink,
    Download,
    Layers,
    ListChecks
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
    return {} as Record<string, unknown>;
}

/** Seller: only orders where seller_id|assign_id matches and every line product_id is in this set. */
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
    assign_id: string | null;
    name: string | null;
    phone: string | null;
    address: string | null;
    price: number | null;
    note: string | null;
    delivery_note: string | null;
    replace: boolean | null;
    coliaty_old_tracking: string | null;
    ameex_old_tracking: string | null;
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
    assign_id: string | null;
    items: { product_id: string }[] | null;
};

/** Minimal shape required by orderMatchesSellerProducts — broad enough for all callers. */
export type OrderForSellerProductsMatch = {
    seller_id?: string | null;
    assign_id?: string | null;
    items?: ReadonlyArray<{ product_id?: string | null | undefined }> | null;
};

type CreatedParcelEntry = {
    order: WizardOrder;
    parcel?: { id: string } | null;
    tracking_code?: string;
    error?: string;
};

type DeliveryNoteEntry = { note: { id: string; reference: string }; providerId: string; isNew: boolean };

export function orderMatchesSellerProducts(order: OrderForSellerProductsMatch, userId: string, productSet: Set<string>): boolean {
    if (order.seller_id !== userId && order.assign_id !== userId) return false;
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

export const DeliveryNoteWizard: React.FC<DeliveryNoteWizardProps> = ({ open, onOpenChange, lockProviderId, sellerScope }) => {
    const [step, setStep] = useState<'provider' | 'select-orders' | 'creating' | 'review' | 'finalizing'>('provider');
    const [selectedProviderId, setSelectedProviderId] = useState<string>(lockProviderId || '');
    const [providerSearch, setProviderSearch] = useState('');
    const [createdParcels, setCreatedParcels] = useState<CreatedParcelEntry[]>([]);
    const [deliveryNotes, setDeliveryNotes] = useState<DeliveryNoteEntry[]>([]);
    const [currentProvider, setCurrentProvider] = useState<string>('');
    const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());

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

            let ordersQuery = supabase
                .from('orders')
                .select(`
                    id, company_id, master_city_id, seller_id, assign_id,
                    items:order_items(product_id),
                    company:providers(${WIZARD_PROVIDER_SELECT_FOR_PARCEL})
                `)
                .eq('order_status_id', confirmedStatusId)
                .eq('DigiCom Business', activeBusinessId)
                .not('company_id', 'is', null)
                .is('date_deleted', null);

            if (sellerScope) {
                ordersQuery = ordersQuery.or(`seller_id.eq.${sellerScope.userId},assign_id.eq.${sellerScope.userId}`);
            }

            const { data: orders, error: ordersError } = await ordersQuery;
            if (ordersError) throw ordersError;

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

            let q = supabase
                .from('orders')
                .select(`
                    *,
                    city:master_cities!inner(id, name, zone_id),
                    company:providers(${WIZARD_PROVIDER_SELECT_FOR_PARCEL}),
                    items:order_items(
                        *,
                        product:products(name, code)
                    )
                `)
                .eq('order_status_id', confirmedStatusId)
                .eq('DigiCom Business', activeBusinessId)
                .not('company_id', 'is', null)
                .is('date_deleted', null);

            if (sellerScope) {
                q = q.or(`seller_id.eq.${sellerScope.userId},assign_id.eq.${sellerScope.userId}`);
            }

            const { data, error } = await q;
            if (error) throw error;

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

                    // Map provider status to our internal package_statuses
                    const providerStatus = result.data?.status || result.data?.label || result.data?.statusLabel || 'Nouveau';
                    const providerColor = result.data?.statusColor || result.data?.color;
                    let mappedStatusId = null;

                    // Try to find matching status in package_statuses table (non-blocking)
                    try {
                        const { data: matchedStatus } = await supabase
                            .from('package_statuses')
                            .select('id')
                            .ilike('label', providerStatus)
                            .maybeSingle();
                        if (matchedStatus) {
                            mappedStatusId = matchedStatus.id;
                        }
                    } catch (e) {
                        console.warn('Could not map package status, continuing without:', e);
                    }

                    // Save to database with mapped status_id and native color
                    const { data: parcel, error: parcelError } = await supabase
                        .from('company_parcels')
                        .insert({
                            provider_id: providerId,
                            order_id: order.id,
                            reference: result.data?.tracking_code || result.data?.reference || result.data?.bar_code || 'N/A',
                            tracking_code: result.data?.tracking_code || result.data?.reference || result.data?.bar_code,
                            status_label: providerStatus,
                            status_color: providerColor,
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
            setCreatedParcels(prev => [...prev, ...results]);
        }
    });

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

            // 3. Update database records
            // Update parcels with delivery note ID
            const parcelIds = createdParcels
                .filter(p => parcelCodes.includes(p.tracking_code))
                .map(p => p.parcel?.id)
                .filter(Boolean);

            console.log('🆔 Parcel IDs to link:', parcelIds);

            if (parcelIds.length > 0) {
                const { error: linkError } = await supabase
                    .from('company_parcels')
                    .update({ company_delivery_note_id: deliveryNoteId })
                    .in('id', parcelIds);

                if (linkError) {
                    console.error('❌ Error linking parcels to note:', linkError);
                    throw linkError;
                }
            }

            // Update delivery note parcel count
            const { count } = await supabase
                .from('company_parcels')
                .select('*', { count: 'exact', head: true })
                .eq('company_delivery_note_id', deliveryNoteId);

            await supabase
                .from('company_delivery_notes')
                .update({ parcel_count: count || 0 })
                .eq('id', deliveryNoteId);

            return { note: { id: deliveryNoteId, reference: deliveryNoteRef }, providerId, isNew: !existingNote };
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

        for (const [pId, codes] of Object.entries(parcelsByProvider)) {
            const providerId = pId as string;
            const parcelCodes = codes as string[];

            if (!parcelCodes || parcelCodes.length === 0) continue;

            console.log(`🚀 Finalizing note for provider ${providerId} with ${parcelCodes.length} parcels`);
            try {
                await createDeliveryNoteMutation.mutateAsync({ providerId, parcelCodes });
            } catch (err) {
                console.error(`❌ Confirmation failed for provider ${providerId}:`, err);
                toast({
                    title: "Confirmation Failed",
                    description: `Could not finish delivery note for one of the providers: ${err.message}`,
                    variant: "destructive"
                });
            }
        }

        queryClient.invalidateQueries({ queryKey: ['company-delivery-notes'] });
        queryClient.invalidateQueries({ queryKey: ['seller-company-delivery-notes'] });
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        queryClient.invalidateQueries({ queryKey: ['confirmed-orders-by-provider'] });

        toast({
            title: "Success!",
            description: `Created ${Object.keys(parcelsByProvider).length} delivery note(s) and updated order statuses`
        });

        onOpenChange(false);
        resetWizard();
    };

    const resetWizard = () => {
        setStep('provider');
        setSelectedProviderId('');
        setCreatedParcels([]);
        setDeliveryNotes([]);
        setCurrentProvider('');
        setSelectedOrderIds(new Set());
    };

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
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[700px] rounded-2xl border-none p-0 overflow-hidden">
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
                                        {filteredProviders.map((provider) => (
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
                                                        style={{ backgroundColor: provider.logo_url ? 'transparent' : (provider.color ? `${provider.color}15` : 'rgba(59, 130, 246, 0.1)') }}
                                                    >
                                                        {provider.logo_url ? (
                                                            <img src={provider.logo_url} alt={provider.name} className="w-full h-full object-contain bg-white mix-blend-multiply" />
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
                                        ))}

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
                                        {Object.values(ordersGrouped as Record<string, { provider: WizardProvider | null; orders: WizardOrder[] }>).map(({ provider, orders }) => (
                                            <div key={provider?.id || 'unknown'} className="flex items-center gap-3 p-3 bg-ant-light rounded-xl flex-1 min-w-[200px]">
                                                <div 
                                                    className="w-10 h-10 rounded-xl flex flex-shrink-0 items-center justify-center overflow-hidden"
                                                    style={{ backgroundColor: provider.logo_url ? 'transparent' : (provider.color ? `${provider.color}15` : 'rgba(59, 130, 246, 0.1)') }}
                                                >
                                                    {provider.logo_url ? (
                                                        <img src={provider.logo_url} alt={provider.name} className="w-full h-full object-contain bg-white mix-blend-multiply" />
                                                    ) : (
                                                        <Building2 className="w-5 h-5" style={{ color: provider.color || '#3b82f6' }} />
                                                    )}
                                                </div>
                                                <div className="flex-1">
                                                    <div className="font-bold text-sm">{provider.name}</div>
                                                    <div className="text-xs text-ant-muted">{orders.length} orders (all zones)</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <DialogFooter>
                                <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
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
                                <button
                                    onClick={() => {
                                        if (allSelected) {
                                            setSelectedOrderIds(new Set());
                                        } else {
                                            setSelectedOrderIds(new Set(allOrders.map(o => o.id)));
                                        }
                                    }}
                                    className="flex items-center gap-2 text-sm font-bold text-ant-ink hover:text-ant-ink/70 transition-colors"
                                >
                                    <Checkbox checked={allSelected} />
                                    {allSelected ? 'Deselect All' : `Select All (${allOrders.length})`}
                                </button>

                                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                    {Object.entries(ordersGrouped as Record<string, OrderGroup>).map(([providerId, { provider, orders }]) => (
                                        <div key={providerId}>
                                            {selectedProviderId === 'all' && (
                                                <div className="flex items-center gap-2 py-2 px-1">
                                                    <div
                                                        className="w-6 h-6 rounded-lg flex items-center justify-center overflow-hidden"
                                                        style={{ backgroundColor: provider?.logo_url ? 'transparent' : (provider?.color ? `${provider.color}15` : 'rgba(59, 130, 246, 0.1)') }}
                                                    >
                                                        {provider?.logo_url ? (
                                                            <img src={provider.logo_url} alt={provider?.name || ''} className="w-full h-full object-contain" />
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
                                                        {order.items && order.items.length > 0 && (
                                                            <div className="text-[10px] text-ant-mid mt-0.5 truncate">
                                                                {order.items.filter(i => i.quantity > 0).map(i => `${i.product?.code || i.product?.name || 'P'} x${i.quantity}`).join(', ')}
                                                            </div>
                                                        )}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    ))}
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
                                        <div key={idx} className="p-4 bg-ant-rose/10 rounded-2xl border border-red-200">
                                            <div className="font-bold text-red-900">{item.order.name}</div>
                                            <div className="text-xs text-ant-rose mt-1">{item.error}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="p-8 pt-0">
                            <DialogFooter>
                                <Button variant="ghost" onClick={resetWizard}>Start Over</Button>
                                <Button
                                    onClick={handleConfirmDeliveryNotes}
                                    disabled={successfulParcels.length === 0}
                                    className="bg-ant-ink hover:bg-ant-ink/90 text-white rounded-2xl"
                                >
                                    <FileText className="w-4 h-4 mr-2" />
                                    Generate Delivery Notes
                                </Button>
                            </DialogFooter>
                        </div>
                    </>
                )}

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
    );
};
