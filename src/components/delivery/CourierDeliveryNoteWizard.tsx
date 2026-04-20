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
import { useToast } from '@/hooks/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Search,
    Truck,
    Loader2,
    AlertCircle,
    FileText,
    Layers,
    Package,
    ListChecks,
    User as UserIcon,
} from 'lucide-react';
import type { DeliveryNoteSellerScope } from './DeliveryNoteWizard';
import { orderMatchesSellerProducts } from './DeliveryNoteWizard';

// ─────────────────────────────────────────────────────────────────────────────
// CourierDeliveryNoteWizard
// Internal replica of DeliveryNoteWizard with NO external API calls.
// Parcels, delivery notes, references and tracking codes are all generated
// directly in Postgres. Couriers replace "providers", courier_zones replaces
// company_zones, courier_parcels/courier_delivery_notes replace the company
// equivalents.
// ─────────────────────────────────────────────────────────────────────────────

type WizardCourier = {
    id: string;
    name: string;
    avatar_url: string | null;
    phone: string | null;
};

type WizardOrderItem = {
    product_id: string;
    quantity: number;
    product: { name: string; code: string | null } | null;
};

type WizardOrder = {
    id: string;
    courier_id: string | null;
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
    items: WizardOrderItem[] | null;
    city: { id: string; name: string; zone_id: string | null } | null;
    courier: WizardCourier | null;
};

type WizardOrderLight = {
    id: string;
    courier_id: string | null;
    company_id: string | null;
    master_city_id: string | null;
    seller_id: string | null;
    assign_id: string | null;
    items: { product_id: string }[] | null;
};

type CreatedParcelEntry = {
    order: WizardOrder;
    parcel?: { id: string } | null;
    tracking_code?: string;
    error?: string;
};

type DeliveryNoteEntry = { note: { id: string; reference: string }; courierId: string; isNew: boolean };

interface CourierDeliveryNoteWizardProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    lockCourierId?: string;
    /** When set, zones/orders/drafts are scoped to this seller and their catalog. */
    sellerScope?: DeliveryNoteSellerScope;
}

// ── Reference / tracking generators (fully local, no external API) ─────────
function shortId(len = 8): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < len; i++) {
        out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
}

function buildTrackingCode(): string {
    // Example: CR-7J4K2M8P
    return `CR-${shortId(8)}`;
}

function buildDeliveryNoteReference(): string {
    // Example: CDN-20260408-7J4K
    const d = new Date();
    const yyyymmdd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    return `CDN-${yyyymmdd}-${shortId(4)}`;
}

export const CourierDeliveryNoteWizard: React.FC<CourierDeliveryNoteWizardProps> = ({
    open,
    onOpenChange,
    lockCourierId,
    sellerScope,
}) => {
    const [step, setStep] = useState<'courier' | 'select-orders' | 'creating' | 'review' | 'finalizing'>('courier');
    const [selectedCourierId, setSelectedCourierId] = useState<string>(lockCourierId || '');
    const [courierSearch, setCourierSearch] = useState('');
    const [createdParcels, setCreatedParcels] = useState<CreatedParcelEntry[]>([]);
    const [, setDeliveryNotes] = useState<DeliveryNoteEntry[]>([]);
    const [currentCourier, setCurrentCourier] = useState<string>('');
    const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());

    React.useEffect(() => {
        if (lockCourierId) setSelectedCourierId(lockCourierId);
    }, [lockCourierId]);

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const { getOrderByCategory, getPkgByCategory } = useStatusCategories();
    const confirmedStatusId = getOrderByCategory('confirmed')?.id;
    const newPkgStatus = getPkgByCategory('new');

    const sellerProductKey = sellerScope?.productIds?.length
        ? [...sellerScope.productIds].sort().join(',')
        : '';

    // ── Step 1: couriers with confirmed orders (EXPLICIT courier_id only) ──
    // The wizard mirrors the Orders page filter: an order only shows up here if
    // it has been explicitly attributed to a courier via orders.courier_id.
    // No zone-based fallback — unassigned confirmed orders stay out until
    // someone picks a target in the order edit modal.
    const { data: availableCouriers } = useQuery({
        queryKey: sellerScope
            ? ['wizard-couriers-seller', confirmedStatusId, activeBusinessId, sellerScope.userId, sellerProductKey]
            : ['wizard-couriers', confirmedStatusId, activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId || !confirmedStatusId) return [];

            // Confirmed orders with an explicit courier.
            let ordersQuery = (supabase as any)
                .from('orders')
                .select(`
                    id, courier_id, company_id, master_city_id, seller_id, assign_id,
                    items:order_items(product_id),
                    courier:users!orders_courier_id_fkey(id, name, avatar_url, phone)
                `)
                .eq('order_status_id', confirmedStatusId)
                .eq('DigiCom Business', activeBusinessId)
                .not('courier_id', 'is', null)
                .is('company_id', null)
                .is('date_deleted', null);

            if (sellerScope) {
                ordersQuery = ordersQuery.or(
                    `seller_id.eq.${sellerScope.userId},assign_id.eq.${sellerScope.userId}`,
                );
            }

            const { data: orders, error: oErr } = await ordersQuery;
            if (oErr) throw oErr;

            const productSet = sellerScope ? new Set(sellerScope.productIds) : null;
            type OrderRow = WizardOrderLight & { courier: WizardCourier | null };
            const lightOrders = (orders || []) as unknown as OrderRow[];
            const filteredOrders = lightOrders.filter((o) =>
                !sellerScope || !productSet ? true : orderMatchesSellerProducts(o, sellerScope.userId, productSet),
            );
            if (filteredOrders.length === 0) return [];

            // Count per courier + collect courier metadata from the embed.
            const courierOrderCounts = new Map<string, number>();
            const courierMap = new Map<string, WizardCourier | null>();

            for (const order of filteredOrders) {
                const courierId = order.courier_id;
                if (!courierId) continue;
                courierOrderCounts.set(courierId, (courierOrderCounts.get(courierId) || 0) + 1);
                if (order.courier && !courierMap.has(courierId)) {
                    courierMap.set(courierId, order.courier);
                }
            }

            const result: {
                id: string;
                name: string;
                orderCount: number;
                avatar_url: string | null;
                phone: string | null;
            }[] = [];
            for (const [cid, count] of courierOrderCounts.entries()) {
                const courier = courierMap.get(cid);
                result.push({
                    id: cid,
                    name: courier?.name || 'Unknown',
                    orderCount: count,
                    avatar_url: courier?.avatar_url ?? null,
                    phone: courier?.phone ?? null,
                });
            }
            return result.sort((a, b) => b.orderCount - a.orderCount);
        },
        enabled: open && !!confirmedStatusId && (!sellerScope || sellerScope.productIds.length > 0),
    });

    // ── Step 2: confirmed orders for selected courier (explicit only) ──────
    const { data: ordersGrouped } = useQuery({
        queryKey: [
            'confirmed-orders-by-courier',
            selectedCourierId,
            sellerScope?.userId,
            sellerProductKey,
            activeBusinessId,
        ],
        queryFn: async () => {
            if (!selectedCourierId || !confirmedStatusId) return null;

            let q = (supabase as any)
                .from('orders')
                .select(`
                    *,
                    city:master_cities!inner(id, name, zone_id),
                    items:order_items(
                        *,
                        product:products(name, code)
                    ),
                    courier:users!orders_courier_id_fkey(id, name, avatar_url, phone)
                `)
                .eq('order_status_id', confirmedStatusId)
                .eq('DigiCom Business', activeBusinessId)
                .not('courier_id', 'is', null)
                .is('company_id', null)
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
                    : orderMatchesSellerProducts(order, sellerScope.userId, productSet),
            );

            type OrderGroup = { courier: WizardCourier | null; orders: WizardOrder[] };
            const grouped = baseOrders.reduce<Record<string, OrderGroup>>((acc, order) => {
                const courierId = order.courier_id;
                if (!courierId) return acc;

                if (selectedCourierId !== 'all' && courierId !== selectedCourierId) return acc;
                if (lockCourierId && courierId !== lockCourierId) return acc;

                if (!acc[courierId]) acc[courierId] = { courier: order.courier || null, orders: [] };
                acc[courierId].orders.push(order);
                return acc;
            }, {});

            return grouped;
        },
        enabled: !!selectedCourierId && (step === 'courier' || step === 'select-orders') && !!confirmedStatusId,
    });

    // ── Step 3: create parcels (pure Postgres, no API) ─────────────────────
    const createParcelsMutation = useMutation({
        mutationFn: async ({ courierId, orders }: { courierId: string; orders: WizardOrder[] }) => {
            const results: CreatedParcelEntry[] = [];

            // Snapshot the courier's current permission flags so each parcel
            // remembers the config that was active when the label was created.
            const { data: courierPerms } = await (supabase as any)
                .from('users')
                .select('courier_parcel_fragile, courier_parcel_open, courier_parcel_try_on')
                .eq('id', courierId)
                .maybeSingle();

            const isFragile = !!courierPerms?.courier_parcel_fragile;
            const isOpen = !!courierPerms?.courier_parcel_open;
            const isTryOn = !!courierPerms?.courier_parcel_try_on;

            for (const order of orders) {
                try {
                    // Safety: orders reaching this step already have courier_id set explicitly,
                    // but if anything slipped through we align it with the selected courier.
                    if (!order.courier_id) {
                        await (supabase as any)
                            .from('orders')
                            .update({ courier_id: courierId })
                            .eq('id', order.id);
                        order.courier_id = courierId;
                    }

                    const trackingCode = buildTrackingCode();

                    const { data: parcel, error: parcelError } = await (supabase as any)
                        .from('courier_parcels')
                        .insert({
                            courier_id: courierId,
                            order_id: order.id,
                            reference: trackingCode,
                            tracking_code: trackingCode,
                            status_id: newPkgStatus?.id || null,
                            status_label: newPkgStatus?.label || 'Nouveau',
                            status_color: newPkgStatus?.color || '#3b82f6',
                            external_id: null,
                            provider_response: null,
                            is_fragile: isFragile,
                            is_open: isOpen,
                            is_try_on: isTryOn,
                            'DigiCom Business': activeBusinessId,
                        })
                        .select()
                        .single();

                    if (parcelError) throw parcelError;

                    results.push({ order, parcel, tracking_code: trackingCode });
                } catch (err) {
                    const msg = (err as Error).message || String(err);
                    results.push({ order, error: msg });
                }
            }

            return results;
        },
        onSuccess: (results) => {
            setCreatedParcels((prev) => [...prev, ...results]);
        },
    });

    // ── Step 4: finalize delivery note (pure Postgres) ─────────────────────
    const createDeliveryNoteMutation = useMutation({
        mutationFn: async ({ courierId, parcelCodes }: { courierId: string; parcelCodes: string[] }) => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('Not authenticated');

            // Find existing OPEN draft for this courier + creator
            let draftQuery = (supabase as any)
                .from('courier_delivery_notes')
                .select('*')
                .eq('courier_id', courierId)
                .eq('is_finalized', false)
                .eq('DigiCom Business', activeBusinessId);

            if (sellerScope) {
                draftQuery = draftQuery.eq('created_by', sellerScope.userId);
            } else if (session.user?.id) {
                draftQuery = draftQuery.or(`created_by.eq.${session.user.id},created_by.is.null`);
            }

            const { data: draftRows, error: searchError } = await draftQuery
                .order('created_at', { ascending: false })
                .limit(1);
            if (searchError) throw searchError;

            const existingNote = draftRows?.[0] ?? null;

            let deliveryNoteRef: string;
            let deliveryNoteId: string;

            const relatedParcels = createdParcels.filter(
                (p) => parcelCodes.includes(p.tracking_code || '') && !p.error,
            );
            const firstZoneId = relatedParcels[0]?.order?.city?.zone_id || null;

            if (existingNote) {
                deliveryNoteRef = existingNote.reference;
                deliveryNoteId = existingNote.id;
                if (session.user?.id && !existingNote.created_by) {
                    await (supabase as any)
                        .from('courier_delivery_notes')
                        .update({ created_by: session.user.id })
                        .eq('id', existingNote.id);
                }
            } else {
                deliveryNoteRef = buildDeliveryNoteReference();
                const { data: note, error: noteError } = await (supabase as any)
                    .from('courier_delivery_notes')
                    .insert({
                        courier_id: courierId,
                        zone_id: firstZoneId,
                        reference: deliveryNoteRef,
                        external_id: null,
                        parcel_count: 0,
                        is_finalized: false,
                        status_id: newPkgStatus?.id || null,
                        'DigiCom Business': activeBusinessId,
                        created_by: session.user?.id ?? null,
                    })
                    .select()
                    .single();
                if (noteError) throw noteError;
                deliveryNoteId = note.id;
            }

            // Link parcels to the note
            const parcelIds = createdParcels
                .filter((p) => parcelCodes.includes(p.tracking_code || ''))
                .map((p) => p.parcel?.id)
                .filter(Boolean);

            if (parcelIds.length > 0) {
                const { error: linkError } = await (supabase as any)
                    .from('courier_parcels')
                    .update({ courier_delivery_note_id: deliveryNoteId })
                    .in('id', parcelIds);
                if (linkError) throw linkError;
            }

            // Refresh parcel_count
            const { count } = await (supabase as any)
                .from('courier_parcels')
                .select('*', { count: 'exact', head: true })
                .eq('courier_delivery_note_id', deliveryNoteId);

            await (supabase as any)
                .from('courier_delivery_notes')
                .update({ parcel_count: count || 0 })
                .eq('id', deliveryNoteId);

            return { note: { id: deliveryNoteId, reference: deliveryNoteRef }, courierId, isNew: !existingNote };
        },
        onSuccess: (result) => {
            setDeliveryNotes((prev) => [...prev, result]);
            toast({
                title: result.isNew ? 'Courier Delivery Note Created' : 'Parcels Added to Note',
                description: `Reference: ${result.note.reference}`,
            });
        },
    });

    const handleCourierSelect = () => {
        if (!selectedCourierId) {
            toast({ title: 'Error', description: 'Please select a courier', variant: 'destructive' });
            return;
        }
        // Initialize selectedOrderIds with all orders from ordersGrouped
        if (ordersGrouped) {
            type OrderGroup = { courier: WizardCourier | null; orders: WizardOrder[] };
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
            toast({ title: 'Error', description: 'Please select at least one order', variant: 'destructive' });
            return;
        }
        setStep('creating');
        handleCreateParcels();
    };

    const handleCreateParcels = async () => {
        if (!ordersGrouped) return;
        setCreatedParcels([]);

        type OrderGroup = { courier: WizardCourier | null; orders: WizardOrder[] };
        for (const [courierId, group] of Object.entries(ordersGrouped as Record<string, OrderGroup>)) {
            const { courier, orders } = group;
            const filteredOrders = orders.filter(o => selectedOrderIds.has(o.id));
            if (filteredOrders.length === 0) continue;
            setCurrentCourier(courier?.name || '');
            await createParcelsMutation.mutateAsync({ courierId, orders: filteredOrders });
        }

        setStep('review');
    };

    const handleConfirmDeliveryNotes = async () => {
        setStep('finalizing');

        const parcelsByCourier = createdParcels.reduce<Record<string, string[]>>((acc, p) => {
            if (!p.error && p.tracking_code) {
                const courierId = p.order.courier_id;
                if (!courierId) return acc;
                if (!acc[courierId]) acc[courierId] = [];
                acc[courierId].push(p.tracking_code);
            }
            return acc;
        }, {});

        if (Object.keys(parcelsByCourier).length === 0) {
            toast({
                title: 'No Parcels to Add',
                description: 'There are no successful parcels to include in a delivery note.',
                variant: 'destructive',
            });
            setStep('review');
            return;
        }

        for (const [courierId, codes] of Object.entries(parcelsByCourier)) {
            try {
                await createDeliveryNoteMutation.mutateAsync({ courierId, parcelCodes: codes as string[] });
            } catch (err) {
                toast({
                    title: 'Confirmation Failed',
                    description: `Could not finish delivery note for one of the couriers: ${(err as Error).message}`,
                    variant: 'destructive',
                });
            }
        }

        queryClient.invalidateQueries({ queryKey: ['courier-delivery-notes'] });
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        queryClient.invalidateQueries({ queryKey: ['confirmed-orders-by-courier'] });

        toast({
            title: 'Success!',
            description: `Created ${Object.keys(parcelsByCourier).length} courier delivery note(s)`,
        });

        onOpenChange(false);
        resetWizard();
    };

    const resetWizard = () => {
        setStep('courier');
        setSelectedCourierId(lockCourierId || '');
        setCreatedParcels([]);
        setDeliveryNotes([]);
        setCurrentCourier('');
        setSelectedOrderIds(new Set());
    };

    const filteredCouriers = useMemo(() => {
        if (!availableCouriers) return [];
        return availableCouriers.filter((c) => c.name.toLowerCase().includes(courierSearch.toLowerCase()));
    }, [availableCouriers, courierSearch]);

    const successfulParcels = createdParcels.filter((p) => !p.error);
    const failedParcels = createdParcels.filter((p) => p.error);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[700px] rounded-2xl border-none p-0 overflow-hidden">
                {step === 'courier' && (
                    <>
                        <div className="bg-ant-ink p-8 text-white relative">
                            <DialogHeader>
                                <DialogTitle className="text-2xl font-semibold text-white">Select Courier</DialogTitle>
                                <DialogDescription className="text-white/60 font-medium">
                                    Choose an internal courier to generate delivery notes for all confirmed orders.
                                </DialogDescription>
                            </DialogHeader>
                        </div>

                        <div className="p-8 space-y-6">
                            <div className="relative">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ant-muted" />
                                <Input
                                    placeholder="Search couriers..."
                                    value={courierSearch}
                                    onChange={(e) => setCourierSearch(e.target.value)}
                                    className="pl-11 h-12 bg-ant-light border-none rounded-2xl"
                                />
                            </div>

                            <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                {lockCourierId ? (
                                    <div className="p-4 rounded-2xl border-2 border-ant-ink bg-ant-ink/5">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <div className="font-bold text-ant-ink">
                                                    {availableCouriers?.find((c) => c.id === lockCourierId)?.name ||
                                                        'Selected Courier'}
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
                                        {filteredCouriers.length > 1 && (
                                            <button
                                                onClick={() => setSelectedCourierId('all')}
                                                className={`w-full p-4 rounded-2xl border-2 transition-all text-left ${
                                                    selectedCourierId === 'all'
                                                        ? 'border-ant-ink bg-ant-ink/5'
                                                        : 'border-slate-200 hover:border-ant-ink/30'
                                                }`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-xl bg-ant-ink/10 flex items-center justify-center">
                                                        <Layers className="w-5 h-5 text-ant-ink" />
                                                    </div>
                                                    <div className="flex-1">
                                                        <div className="font-bold text-ant-ink">All Couriers</div>
                                                        <div className="text-xs text-ant-muted mt-1">
                                                            {availableCouriers?.reduce((s, c) => s + c.orderCount, 0) || 0} orders across {availableCouriers?.length || 0} couriers
                                                        </div>
                                                    </div>
                                                </div>
                                            </button>
                                        )}

                                        {filteredCouriers.map((courier) => (
                                            <button
                                                key={courier.id}
                                                onClick={() => setSelectedCourierId(courier.id)}
                                                className={`w-full p-4 rounded-2xl border-2 transition-all text-left ${
                                                    selectedCourierId === courier.id
                                                        ? 'border-ant-ink bg-ant-ink/5'
                                                        : 'border-slate-200 hover:border-ant-ink/30'
                                                }`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-xl bg-ant-ink/10 flex items-center justify-center overflow-hidden">
                                                        {courier.avatar_url ? (
                                                            <img
                                                                src={courier.avatar_url}
                                                                alt={courier.name}
                                                                className="w-full h-full object-cover"
                                                            />
                                                        ) : (
                                                            <UserIcon className="w-5 h-5 text-ant-ink" />
                                                        )}
                                                    </div>
                                                    <div className="flex-1">
                                                        <div className="font-bold text-ant-ink">{courier.name}</div>
                                                        <div className="text-xs text-ant-muted mt-1">
                                                            {courier.orderCount} confirmed orders
                                                            {courier.phone ? ` • ${courier.phone}` : ''}
                                                        </div>
                                                    </div>
                                                    <Badge
                                                        variant="outline"
                                                        className="text-[10px] font-semibold text-ant-ink/60 border-ant-ink/10"
                                                    >
                                                        {courier.orderCount}
                                                    </Badge>
                                                </div>
                                            </button>
                                        ))}

                                        {filteredCouriers.length === 0 && (
                                            <div className="text-center py-8 text-ant-muted text-sm">
                                                No couriers with confirmed orders found.
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            {selectedCourierId && ordersGrouped && (
                                <div className="space-y-3 pt-4 border-t">
                                    <div className="text-sm font-bold text-ant-ink/60">Orders to Process:</div>
                                    <div className="flex gap-3 flex-wrap">
                                        {Object.values(
                                            ordersGrouped as Record<
                                                string,
                                                { courier: WizardCourier | null; orders: WizardOrder[] }
                                            >,
                                        ).map(({ courier, orders }) => (
                                            <div
                                                key={courier?.id || 'unknown'}
                                                className="flex items-center gap-3 p-3 bg-ant-light rounded-xl flex-1 min-w-[200px]"
                                            >
                                                <div className="w-10 h-10 rounded-xl bg-ant-ink/10 flex items-center justify-center overflow-hidden">
                                                    {courier?.avatar_url ? (
                                                        <img
                                                            src={courier.avatar_url}
                                                            alt={courier.name}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : (
                                                        <Truck className="w-5 h-5 text-ant-ink" />
                                                    )}
                                                </div>
                                                <div className="flex-1">
                                                    <div className="font-bold text-sm">{courier?.name || 'Courier'}</div>
                                                    <div className="text-xs text-ant-muted">
                                                        {orders.length} orders (all zones)
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <DialogFooter>
                                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handleCourierSelect}
                                    disabled={!selectedCourierId}
                                    className="bg-ant-ink hover:bg-ant-ink/90 text-white rounded-2xl"
                                >
                                    Next: Select Orders
                                </Button>
                            </DialogFooter>
                        </div>
                    </>
                )}

                {step === 'select-orders' && ordersGrouped && (() => {
                    type OrderGroup = { courier: WizardCourier | null; orders: WizardOrder[] };
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
                                    {Object.entries(ordersGrouped as Record<string, OrderGroup>).map(([courierId, { courier, orders }]) => (
                                        <div key={courierId}>
                                            {selectedCourierId === 'all' && (
                                                <div className="flex items-center gap-2 py-2 px-1">
                                                    <div className="w-6 h-6 rounded-lg bg-ant-ink/10 flex items-center justify-center overflow-hidden">
                                                        {courier?.avatar_url ? (
                                                            <img src={courier.avatar_url} alt={courier?.name || ''} className="w-full h-full object-cover" />
                                                        ) : (
                                                            <UserIcon className="w-3.5 h-3.5 text-ant-ink" />
                                                        )}
                                                    </div>
                                                    <span className="text-xs font-bold text-ant-ink/60 uppercase tracking-wide">{courier?.name}</span>
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
                                    <Button variant="ghost" onClick={() => setStep('courier')}>
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
                            <div className="text-sm text-ant-muted mt-2">Courier: {currentCourier}</div>
                        </div>
                    </div>
                )}

                {step === 'review' && (
                    <>
                        <div className="bg-ant-ink p-8 text-white">
                            <DialogHeader>
                                <DialogTitle className="text-2xl font-semibold text-white">Review Parcels</DialogTitle>
                                <DialogDescription className="text-white/60 font-medium">
                                    {successfulParcels.length} parcels created successfully
                                </DialogDescription>
                            </DialogHeader>
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
                                <Button variant="ghost" onClick={resetWizard}>
                                    Start Over
                                </Button>
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

export default CourierDeliveryNoteWizard;
