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
    Download
} from 'lucide-react';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provider-integration`;

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
    lockZoneId?: string;
    lockProviderId?: string;
    /** When set, zones/orders/drafts are scoped to this seller and their catalog. */
    sellerScope?: DeliveryNoteSellerScope;
}

export const DeliveryNoteWizard: React.FC<DeliveryNoteWizardProps> = ({ open, onOpenChange, lockZoneId, lockProviderId, sellerScope }) => {
    const [step, setStep] = useState<'zone' | 'creating' | 'review' | 'finalizing'>('zone');
    const [selectedZoneId, setSelectedZoneId] = useState<string>(lockZoneId || '');
    const [zoneSearch, setZoneSearch] = useState('');
    const [createdParcels, setCreatedParcels] = useState<any[]>([]);
    const [deliveryNotes, setDeliveryNotes] = useState<any[]>([]);
    const [currentProvider, setCurrentProvider] = useState<string>('');

    // Update selectedZoneId when lockZoneId changes
    React.useEffect(() => {
        if (lockZoneId) {
            setSelectedZoneId(lockZoneId);
        }
    }, [lockZoneId]);

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const { getOrderByCategory } = useStatusCategories();
    const confirmedStatusId = getOrderByCategory('confirmed')?.id;

    const sellerProductKey = sellerScope?.productIds?.length
        ? [...sellerScope.productIds].sort().join(',')
        : '';

    // Fetch zones that have confirmed orders (all business orders, or seller-eligible only)
    const { data: zones } = useQuery({
        queryKey: sellerScope
            ? ['zones-with-confirmed-orders-seller', confirmedStatusId, activeBusinessId, sellerScope.userId, sellerProductKey]
            : ['zones-with-confirmed-orders', confirmedStatusId, activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId || !confirmedStatusId) return [];

            if (sellerScope) {
                const productSet = new Set(sellerScope.productIds);
                if (productSet.size === 0) return [];

                const { data: orders, error } = await supabase
                    .from('orders')
                    .select('master_city_id, seller_id, assign_id, items:order_items(product_id)')
                    .eq('order_status_id', confirmedStatusId)
                    .eq('DigiCom Business', activeBusinessId)
                    .or(`seller_id.eq.${sellerScope.userId},assign_id.eq.${sellerScope.userId}`);

                if (error) throw error;

                const cityIds = new Set<string>();
                for (const o of orders || []) {
                    if (!orderMatchesSellerProducts(o, sellerScope.userId, productSet)) continue;
                    if (o.master_city_id) cityIds.add(o.master_city_id as string);
                }
                if (cityIds.size === 0) return [];

                const { data: cities, error: cErr } = await supabase
                    .from('master_cities')
                    .select('id, zone_id')
                    .in('id', [...cityIds]);
                if (cErr) throw cErr;

                const zoneToCityIds = new Map<string, string[]>();
                for (const c of cities || []) {
                    if (!c.zone_id) continue;
                    if (!zoneToCityIds.has(c.zone_id)) zoneToCityIds.set(c.zone_id, []);
                    zoneToCityIds.get(c.zone_id)!.push(c.id);
                }
                const zoneIds = [...zoneToCityIds.keys()];
                if (zoneIds.length === 0) return [];

                const { data: zoneRows, error: zErr } = await supabase
                    .from('zones')
                    .select('id, name')
                    .in('id', zoneIds);
                if (zErr) throw zErr;

                return (zoneRows || []).map((z) => ({
                    id: z.id,
                    name: z.name,
                    master_cities: (zoneToCityIds.get(z.id) || []).map((cid) => ({
                        id: cid,
                        orders: [{ id: 'seller-eligible' }],
                    })),
                }));
            }

            const { data, error } = await supabase
                .from('zones')
                .select(`
                    id,
                    name,
                    master_cities!inner(
                        id,
                        orders!inner(
                            id,
                            company_id,
                            "DigiCom Business"
                        )
                    )
                `)
                .eq('master_cities.orders.order_status_id', confirmedStatusId)
                .eq('master_cities.orders.DigiCom Business', activeBusinessId);

            if (error) throw error;

            return data?.filter((zone) =>
                zone.master_cities.some((city: any) => city.orders.length > 0)
            ) || [];
        },
        enabled: open && !!confirmedStatusId && (!sellerScope || sellerScope.productIds.length > 0)
    });

    // Fetch company_zones for provider resolution
    const { data: companyZonesData } = useQuery({
        queryKey: ['company-zones-all', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('company_zones')
                .select('*, provider:providers(id, name, provider_type)')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data || [];
        },
        enabled: open
    });

    // Fetch confirmed orders for selected zone grouped by provider
    const { data: ordersGrouped } = useQuery({
        queryKey: ['confirmed-orders-by-zone', selectedZoneId, sellerScope?.userId, sellerProductKey],
        queryFn: async () => {
            if (!selectedZoneId || !confirmedStatusId) return null;

            let q = supabase
                .from('orders')
                .select(`
                    *,
                    city:master_cities!inner(id, name, zone_id),
                    company:providers(id, name, provider_type),
                    items:order_items(
                        *,
                        product:products(name, code)
                    )
                `)
                .eq('order_status_id', confirmedStatusId)
                .eq('city.zone_id', selectedZoneId)
                .eq('DigiCom Business', activeBusinessId);

            if (sellerScope) {
                q = q.or(`seller_id.eq.${sellerScope.userId},assign_id.eq.${sellerScope.userId}`);
            }

            const { data, error } = await q;

            if (error) throw error;

            const productSet = sellerScope ? new Set(sellerScope.productIds) : null;
            const baseOrders = (data || []).filter((order: any) =>
                !sellerScope || !productSet
                    ? true
                    : orderMatchesSellerProducts(order, sellerScope.userId, productSet)
            );

            // For orders without company_id, resolve provider from company_zones
            const zoneProviders = companyZonesData?.filter(cz => cz.zone_id === selectedZoneId) || [];

            // Group by provider
            const grouped = baseOrders.reduce((acc: any, order: any) => {
                let providerId = order.company_id;
                let provider = order.company;

                // If no company assigned, resolve from zone mapping
                if (!providerId && zoneProviders.length > 0) {
                    const zoneProvider = zoneProviders[0]; // Pick the first provider for this zone
                    providerId = zoneProvider.company_id;
                    provider = zoneProvider.provider;
                    // Mark that this order needs company_id update
                    order._resolvedCompanyId = providerId;
                }

                if (!providerId) return acc; // Skip if still no provider

                // If a provider is locked, only include that provider
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
        enabled: !!selectedZoneId && step === 'zone' && !!companyZonesData && !!confirmedStatusId
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
                        replaceable: order.replace || false,
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

    // Create delivery note for provider
    const createDeliveryNoteMutation = useMutation({
        mutationFn: async ({ providerId, parcelCodes }: { providerId: string; parcelCodes: string[] }) => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('Not authenticated');

            // 1. Check if there is an existing OPEN delivery note for this Provider + Zone
            console.log('🔍 Checking for existing note:', { providerId, zoneId: selectedZoneId, businessId: activeBusinessId });

            let draftQuery = supabase
                .from('company_delivery_notes')
                .select('*')
                .eq('provider_id', providerId)
                .eq('zone_id', selectedZoneId)
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

                // Save new note to database
                const { data: note, error: noteError } = await supabase
                    .from('company_delivery_notes')
                    .insert({
                        provider_id: providerId,
                        zone_id: selectedZoneId,
                        reference: deliveryNoteRef,
                        external_id: externalId,
                        parcel_count: 0, // Will update after adding parcels
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
            const { data: updatedNote } = await supabase
                .from('company_delivery_notes')
                .select('id')
                .eq('id', deliveryNoteId)
                .single();

            // Fetch current total count for this note
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

    const handleZoneSelect = () => {
        if (!selectedZoneId) {
            toast({
                title: "Error",
                description: "Please select a zone",
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
                // Continue with other providers if any
            }
        }

        // Update order statuses to 'PROCESSED'
        try {
            const { data: processedStatus } = await supabase
                .from('order_statuses')
                .select('id')
                .eq('label', 'PROCESSED')
                .single();

            if (processedStatus) {
                const successfulOrderIds = createdParcels
                    .filter(p => !p.error && p.order?.id)
                    .map(p => p.order.id);

                if (successfulOrderIds.length > 0) {
                    await supabase
                        .from('orders')
                        .update({ order_status_id: processedStatus.id })
                        .in('id', successfulOrderIds);
                }
            }
        } catch (error) {
            console.error('Error updating order statuses:', error);
        }

        queryClient.invalidateQueries({ queryKey: ['company-delivery-notes'] });
        queryClient.invalidateQueries({ queryKey: ['seller-company-delivery-notes'] });
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        queryClient.invalidateQueries({ queryKey: ['confirmed-orders-by-zone'] });

        toast({
            title: "Success!",
            description: `Created ${Object.keys(parcelsByProvider).length} delivery note(s) and updated order statuses`
        });

        onOpenChange(false);
        resetWizard();
    };

    const resetWizard = () => {
        setStep('zone');
        setSelectedZoneId('');
        setCreatedParcels([]);
        setDeliveryNotes([]);
        setCurrentProvider('');
    };

    const filteredZones = useMemo(() => {
        if (!zones) return [];
        return zones.filter(z =>
            z.name.toLowerCase().includes(zoneSearch.toLowerCase())
        );
    }, [zones, zoneSearch]);

    const successfulParcels = createdParcels.filter(p => !p.error);
    const failedParcels = createdParcels.filter(p => p.error);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[700px] rounded-[32px] border-none p-0 overflow-hidden">
                {step === 'zone' && (
                    <>
                        <div className="bg-brand-navy p-8 text-white relative">
                            <DialogTitle className="text-2xl font-black">Select Delivery Zone</DialogTitle>
                            <DialogDescription className="text-white/60 font-medium">
                                Choose a zone with confirmed orders ready for shipment.
                            </DialogDescription>
                        </div>

                        <div className="p-8 space-y-6">
                            <div className="relative">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search zones..."
                                    value={zoneSearch}
                                    onChange={(e) => setZoneSearch(e.target.value)}
                                    className="pl-11 h-12 bg-slate-50 border-none rounded-2xl"
                                />
                            </div>

                            <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                {lockZoneId ? (
                                    <div className="p-4 rounded-2xl border-2 border-brand-navy bg-brand-navy/5">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <div className="font-bold text-brand-navy">
                                                    {zones?.find(z => z.id === lockZoneId)?.name || 'Direct Addition'}
                                                </div>
                                                <div className="text-xs text-muted-foreground mt-1">
                                                    Adding orders to existing delivery note
                                                </div>
                                            </div>
                                            <Badge className="bg-brand-navy text-white">LOCKED</Badge>
                                        </div>
                                    </div>
                                ) : (
                                    filteredZones.map((zone) => (
                                        <button
                                            key={zone.id}
                                            onClick={() => setSelectedZoneId(zone.id)}
                                            className={`w-full p-4 rounded-2xl border-2 transition-all text-left ${selectedZoneId === zone.id
                                                ? 'border-brand-navy bg-brand-navy/5'
                                                : 'border-slate-200 hover:border-brand-navy/30'
                                                }`}
                                        >
                                            <div className="font-bold text-brand-navy">{zone.name}</div>
                                            <div className="text-xs text-muted-foreground mt-1">
                                                {zone.master_cities.length} cities with orders
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>

                            {selectedZoneId && ordersGrouped && (
                                <div className="space-y-3 pt-4 border-t">
                                    <div className="text-sm font-bold text-brand-navy/60">Detected Providers:</div>
                                    <div className="flex gap-3">
                                        {Object.values(ordersGrouped as any).map(({ provider, orders }: any) => (
                                            <div key={provider.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl flex-1">
                                                <Building2 className="w-5 h-5 text-blue-500" />
                                                <div className="flex-1">
                                                    <div className="font-bold text-sm">{provider.name}</div>
                                                    <div className="text-xs text-muted-foreground">{orders.length} orders</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <DialogFooter>
                                <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                                <Button
                                    onClick={handleZoneSelect}
                                    disabled={!selectedZoneId}
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
