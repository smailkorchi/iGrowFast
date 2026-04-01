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
    Layers
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

export function orderMatchesSellerProducts(order: any, userId: string, productSet: Set<string>): boolean {
    if (order.seller_id !== userId && order.assign_id !== userId) return false;
    const items = order.items as { product_id?: string }[] | undefined;
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
    const [step, setStep] = useState<'provider' | 'creating' | 'review' | 'finalizing'>('provider');
    const [selectedProviderId, setSelectedProviderId] = useState<string>(lockProviderId || '');
    const [providerSearch, setProviderSearch] = useState('');
    const [createdParcels, setCreatedParcels] = useState<any[]>([]);
    const [deliveryNotes, setDeliveryNotes] = useState<any[]>([]);
    const [currentProvider, setCurrentProvider] = useState<string>('');

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

    // Fetch providers that have confirmed orders (via company_zones + orders)
    const { data: availableProviders } = useQuery({
        queryKey: sellerScope
            ? ['wizard-providers-seller', confirmedStatusId, activeBusinessId, sellerScope.userId, sellerProductKey]
            : ['wizard-providers', confirmedStatusId, activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId || !confirmedStatusId) return [];

            const { data: rawCompanyZones, error: czError } = await supabase
                .from('company_zones')
                .select(`*, provider:providers(${WIZARD_PROVIDER_SELECT_FOR_PARCEL})`)
                .eq('DigiCom Business', activeBusinessId);
            if (czError) throw czError;
            const companyZones = (rawCompanyZones || []) as any[];
            if (!companyZones.length) return [];

            // 2. Get all confirmed orders
            let ordersQuery = supabase
                .from('orders')
                .select('id, company_id, master_city_id, seller_id, assign_id, items:order_items(product_id)')
                .eq('order_status_id', confirmedStatusId)
                .eq('DigiCom Business', activeBusinessId);

            if (sellerScope) {
                ordersQuery = ordersQuery.or(`seller_id.eq.${sellerScope.userId},assign_id.eq.${sellerScope.userId}`);
            }

            const { data: orders, error: ordersError } = await ordersQuery;
            if (ordersError) throw ordersError;

            const productSet = sellerScope ? new Set(sellerScope.productIds) : null;
            const filteredOrders = (orders || []).filter((o: any) =>
                !sellerScope || !productSet ? true : orderMatchesSellerProducts(o, sellerScope.userId, productSet)
            );

            if (filteredOrders.length === 0) return [];

            // 3. Get city → zone mapping for orders without company_id
            const cityIds = new Set(filteredOrders.map((o: any) => o.master_city_id).filter(Boolean));
            const { data: cities } = await supabase
                .from('master_cities')
                .select('id, zone_id')
                .in('id', [...cityIds]);
            const cityZoneMap = new Map((cities || []).map(c => [c.id, c.zone_id]));

            // 4. Build zone→provider map from company_zones
            const zoneProviderMap = new Map<string, { providerId: string; provider: any }[]>();
            for (const cz of companyZones) {
                if (!cz.zone_id || !cz.company_id) continue;
                if (!zoneProviderMap.has(cz.zone_id)) zoneProviderMap.set(cz.zone_id, []);
                zoneProviderMap.get(cz.zone_id)!.push({ providerId: cz.company_id, provider: cz.provider });
            }

            // 5. Count confirmed orders per provider
            const providerOrderCounts = new Map<string, number>();
            const providerMap = new Map<string, any>();

            for (const order of filteredOrders) {
                let providerId = order.company_id;

                // If no company assigned, resolve from zone mapping
                if (!providerId && order.master_city_id) {
                    const zoneId = cityZoneMap.get(order.master_city_id);
                    if (zoneId) {
                        const zoneProviders = zoneProviderMap.get(zoneId);
                        if (zoneProviders?.length) {
                            providerId = zoneProviders[0].providerId;
                            if (!providerMap.has(providerId)) {
                                providerMap.set(providerId, zoneProviders[0].provider);
                            }
                        }
                    }
                }

                if (!providerId) continue;

                providerOrderCounts.set(providerId, (providerOrderCounts.get(providerId) || 0) + 1);

                // Store provider info from orders that already have company_id
                if (order.company_id && !providerMap.has(order.company_id)) {
                    // We'll fill this from the companyZones data
                    const czMatch = companyZones.find(cz => cz.company_id === order.company_id);
                    if (czMatch?.provider) {
                        providerMap.set(order.company_id, czMatch.provider);
                    }
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

    // Fetch company_zones for provider resolution (used during parcel creation)
    const { data: companyZonesData } = useQuery({
        queryKey: ['company-zones-all', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('company_zones')
                .select(`*, provider:providers(${WIZARD_PROVIDER_SELECT_FOR_PARCEL})`)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return (data || []) as any[];
        },
        enabled: open
    });

    // Fetch confirmed orders for selected provider(s) across ALL zones
    const { data: ordersGrouped } = useQuery({
        queryKey: ['confirmed-orders-by-provider', selectedProviderId, sellerScope?.userId, sellerProductKey],
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
                .eq('DigiCom Business', activeBusinessId);

            if (sellerScope) {
                q = q.or(`seller_id.eq.${sellerScope.userId},assign_id.eq.${sellerScope.userId}`);
            }

            // If a specific provider is selected (not 'all'), filter by company_id
            // But we also need orders without company_id that resolve to this provider via zones
            // So we fetch all and filter client-side
            const { data, error } = await q;

            if (error) throw error;

            const productSet = sellerScope ? new Set(sellerScope.productIds) : null;
            const baseOrders = (data || []).filter((order: any) =>
                !sellerScope || !productSet
                    ? true
                    : orderMatchesSellerProducts(order, sellerScope.userId, productSet)
            );

            // Build zone→provider map for resolving orders without company_id
            const zoneProviders = new Map<string, { providerId: string; provider: any }>();
            for (const cz of (companyZonesData || [])) {
                if (!cz.zone_id || !cz.company_id) continue;
                // First provider per zone wins (same as old logic)
                if (!zoneProviders.has(cz.zone_id)) {
                    zoneProviders.set(cz.zone_id, { providerId: cz.company_id, provider: cz.provider });
                }
            }

            // Group by provider
            const grouped = baseOrders.reduce((acc: any, order: any) => {
                let providerId = order.company_id;
                let provider = order.company;

                // If no company assigned, resolve from zone mapping
                if (!providerId && order.city?.zone_id) {
                    const zoneProvider = zoneProviders.get(order.city.zone_id);
                    if (zoneProvider) {
                        providerId = zoneProvider.providerId;
                        provider = zoneProvider.provider;
                        order._resolvedCompanyId = providerId;
                    }
                }

                if (!providerId) return acc;

                // Filter by selected provider (unless 'all')
                if (selectedProviderId !== 'all' && providerId !== selectedProviderId) {
                    return acc;
                }

                // If lockProviderId is set, only include that provider
                if (lockProviderId && providerId !== lockProviderId) {
                    return acc;
                }

                if (!acc[providerId]) {
                    acc[providerId] = {
                        provider,
                        orders: []
                    };
                }
                acc[providerId].orders.push(order);
                return acc;
            }, {});

            return grouped;
        },
        enabled: !!selectedProviderId && step === 'provider' && !!companyZonesData && !!confirmedStatusId
    });

    // Create parcels for a provider
    const createParcelsMutation = useMutation({
        mutationFn: async ({ providerId, orders }: { providerId: string; orders: any[] }) => {
            // Get session once at the start
            const { data: { session } } = await supabase.auth.getSession();

            if (!session?.access_token) {
                throw new Error('Not authenticated. Please log in again.');
            }

            const provider = orders[0].company;
            const results = [];

            for (const order of orders) {
                try {
                    // If company_id was resolved from zone, update the order first
                    if (order._resolvedCompanyId) {
                        await supabase
                            .from('orders')
                            .update({ company_id: order._resolvedCompanyId })
                            .eq('id', order.id);
                        order.company_id = order._resolvedCompanyId;
                    }
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
                            ?.filter((i: any) => i.quantity > 0)
                            .map((i: any) => `${i.product?.code || 'P'} x${i.quantity}`)
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
                } catch (error: any) {
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
        setStep('creating');
        handleCreateParcels();
    };

    const handleCreateParcels = async () => {
        if (!ordersGrouped) return;

        setCreatedParcels([]);

        for (const [providerId, group] of Object.entries(ordersGrouped)) {
            const { provider, orders } = group as { provider: any; orders: any[] };
            setCurrentProvider(provider.name);
            await createParcelsMutation.mutateAsync({ providerId, orders });
        }

        setStep('review');
    };

    const handleConfirmDeliveryNotes = async () => {
        setStep('finalizing');

        // Group parcels by provider
        const parcelsByProvider = createdParcels.reduce((acc: any, p: any) => {
            if (!p.error) {
                const providerId = p.order.company_id;
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
            } catch (err: any) {
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
    };

    const filteredProviders = useMemo(() => {
        if (!availableProviders) return [];
        return availableProviders.filter(p =>
            p.name.toLowerCase().includes(providerSearch.toLowerCase())
        );
    }, [availableProviders, providerSearch]);

    const totalOrderCount = useMemo(() => {
        if (!ordersGrouped) return 0;
        return Object.values(ordersGrouped as any).reduce((sum: number, g: any) => sum + g.orders.length, 0);
    }, [ordersGrouped]);

    const successfulParcels = createdParcels.filter(p => !p.error);
    const failedParcels = createdParcels.filter(p => p.error);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[700px] rounded-[32px] border-none p-0 overflow-hidden">
                {step === 'provider' && (
                    <>
                        <div className="bg-brand-navy p-8 text-white relative">
                            <DialogTitle className="text-2xl font-black">Select Provider</DialogTitle>
                            <DialogDescription className="text-white/60 font-medium">
                                Choose a shipping provider to generate delivery notes for all confirmed orders.
                            </DialogDescription>
                        </div>

                        <div className="p-8 space-y-6">
                            <div className="relative">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search providers..."
                                    value={providerSearch}
                                    onChange={(e) => setProviderSearch(e.target.value)}
                                    className="pl-11 h-12 bg-slate-50 border-none rounded-2xl"
                                />
                            </div>

                            <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                {lockProviderId ? (
                                    <div className="p-4 rounded-2xl border-2 border-brand-navy bg-brand-navy/5">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <div className="font-bold text-brand-navy">
                                                    {availableProviders?.find(p => p.id === lockProviderId)?.name || 'Selected Provider'}
                                                </div>
                                                <div className="text-xs text-muted-foreground mt-1">
                                                    Adding orders to existing delivery note
                                                </div>
                                            </div>
                                            <Badge className="bg-brand-navy text-white">LOCKED</Badge>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {/* All Providers option */}
                                        {filteredProviders.length > 1 && (
                                            <button
                                                onClick={() => setSelectedProviderId('all')}
                                                className={`w-full p-4 rounded-2xl border-2 transition-all text-left ${selectedProviderId === 'all'
                                                    ? 'border-brand-navy bg-brand-navy/5'
                                                    : 'border-slate-200 hover:border-brand-navy/30'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-xl bg-brand-navy/10 flex items-center justify-center">
                                                        <Layers className="w-5 h-5 text-brand-navy" />
                                                    </div>
                                                    <div className="flex-1">
                                                        <div className="font-bold text-brand-navy">All Providers</div>
                                                        <div className="text-xs text-muted-foreground mt-1">
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
                                                    ? 'border-brand-navy bg-brand-navy/5'
                                                    : 'border-slate-200 hover:border-brand-navy/30'
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
                                                        <div className="font-bold text-brand-navy">{provider.name}</div>
                                                        <div className="text-xs text-muted-foreground mt-1">
                                                            {provider.orderCount} confirmed orders • {provider.provider_type?.toUpperCase() || 'N/A'}
                                                        </div>
                                                    </div>
                                                    <Badge variant="outline" className="text-[10px] font-black text-brand-navy/60 border-brand-navy/10">
                                                        {provider.orderCount}
                                                    </Badge>
                                                </div>
                                            </button>
                                        ))}

                                        {filteredProviders.length === 0 && (
                                            <div className="text-center py-8 text-muted-foreground text-sm">
                                                No providers with confirmed orders found.
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            {selectedProviderId && ordersGrouped && (
                                <div className="space-y-3 pt-4 border-t">
                                    <div className="text-sm font-bold text-brand-navy/60">Orders to Process:</div>
                                    <div className="flex gap-3 flex-wrap">
                                        {Object.values(ordersGrouped as any).map(({ provider, orders }: any) => (
                                            <div key={provider.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl flex-1 min-w-[200px]">
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
                                                    <div className="text-xs text-muted-foreground">{orders.length} orders (all zones)</div>
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
                                    className="bg-brand-navy hover:bg-brand-navy/90 text-white rounded-2xl"
                                >
                                    Create Parcels
                                </Button>
                            </DialogFooter>
                        </div>
                    </>
                )}

                {step === 'creating' && (
                    <div className="p-16 text-center space-y-6">
                        <Loader2 className="w-16 h-16 animate-spin mx-auto text-brand-navy" />
                        <div>
                            <div className="text-xl font-black text-brand-navy">Creating Parcels...</div>
                            <div className="text-sm text-muted-foreground mt-2">Provider: {currentProvider}</div>
                        </div>
                    </div>
                )}

                {step === 'review' && (
                    <>
                        <div className="bg-brand-navy p-8 text-white">
                            <DialogTitle className="text-2xl font-black">Review Parcels</DialogTitle>
                            <DialogDescription className="text-white/60 font-medium">
                                {successfulParcels.length} parcels created successfully
                            </DialogDescription>
                        </div>

                        <div className="p-8 space-y-4 max-h-[500px] overflow-y-auto">
                            {successfulParcels.map((item, idx) => (
                                <div key={idx} className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200">
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="font-bold text-brand-navy">{item.order.name}</div>
                                            <div className="text-xs text-muted-foreground">{item.order.phone}</div>
                                        </div>
                                        <Badge className="bg-emerald-500 text-white border-none">
                                            {item.tracking_code}
                                        </Badge>
                                    </div>
                                </div>
                            ))}

                            {failedParcels.length > 0 && (
                                <div className="space-y-4 pt-4 border-t">
                                    <div className="text-sm font-bold text-red-500 flex items-center gap-2">
                                        <AlertCircle className="w-4 h-4" />
                                        Failed to create ({failedParcels.length})
                                    </div>
                                    {failedParcels.map((item, idx) => (
                                        <div key={idx} className="p-4 bg-red-50 rounded-2xl border border-red-200">
                                            <div className="font-bold text-red-900">{item.order.name}</div>
                                            <div className="text-xs text-red-600 mt-1">{item.error}</div>
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
                                    className="bg-brand-navy hover:bg-brand-navy/90 text-white rounded-2xl"
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
                        <Loader2 className="w-16 h-16 animate-spin mx-auto text-brand-navy" />
                        <div>
                            <div className="text-xl font-black text-brand-navy">Generating Delivery Notes...</div>
                            <div className="text-sm text-muted-foreground mt-2">Please wait</div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};
