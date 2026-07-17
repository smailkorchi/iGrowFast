import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { matchPackageStatus } from '@/lib/matchPackageStatus';
import {
    Building2,
    Calendar,
    Edit2,
    Loader2,
    MapPinned,
    MessageSquare,
    Package,
    Puzzle,
    RefreshCcw,
    ShieldCheck,
    ShoppingCart,
    Truck,
    FileSpreadsheet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
    Dialog,
    DialogContent,
    DialogFooter,
} from '@/components/ui/dialog';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { UserAvatar } from '@/components/users/UserAvatar';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import CustomerInsights from '@/components/CustomerInsights';
import { OrderPhoneQuickActions } from '@/components/orders/OrderPhoneQuickActions';
import { ParcelTrackingDialog } from '@/components/orders/ParcelTrackingDialog';
import { getCachedTracking, putCachedTracking } from '@/lib/orders/syncOrderTracking';
import { DynamicIcon } from '@/lib/renderReactIcon';
import { usePackageStatusResolver } from '@/hooks/usePackageStatusResolver';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { resolveProviderLogo } from '@/lib/providerLogos';

/**
 * For courier (internal) orders the package status lives on the latest
 * courier_parcels row, not on orders.package_status_id. Picks the most recent
 * parcel that has a master status and returns it in the same shape the badge
 * renderer expects. Reads the label/color off the embedded package_statuses row.
 */
function getCourierPackageStatus(order: any): { label: string; color: string | null } | null {
    const courierParcels = (order?.courier_parcels || []) as Array<{
        status?: { label?: string | null; color?: string | null } | null;
        created_at?: string | null;
    }>;
    if (!courierParcels.length) return null;
    const sorted = [...courierParcels].sort(
        (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
    );
    const latest = sorted.find((p) => p.status?.label && String(p.status.label).trim());
    if (!latest) return null;
    return { label: String(latest.status!.label).trim(), color: latest.status!.color || null };
}

// Same join set as the admin Orders page aggregate query (minus `history`,
// which stays a lazy per-order fetch below) so the modal renders the exact
// same enriched row whichever page mounts it.
const ORDER_VIEW_SELECT = `
    *,
    status:order_statuses(*),
    package_status:package_statuses(*),
    city:master_cities(id, name),
    courier:users!orders_courier_id_fkey(id, name, avatar_url, avatar_config),
    assignee:users!orders_seller_id_fkey(id, name, avatar_url, avatar_config),
    company:providers(id, name, provider_type, logo_url),
    channel:sales_channels!orders_source_id_fkey(id, name, type),
    items:order_items(*, product:products(name, code, image_url), accessory:accessories(name, code, image_url)),
    parcels:company_parcels(id, tracking_code, external_id, provider_id, status_id, created_at, company_delivery_note_id, status:package_statuses(label, color), provider:providers(id, name, logo_url)),
    courier_parcels(id, tracking_code, status_id, created_at, courier_delivery_note_id, status:package_statuses(label, color))
`;

export interface OrderViewDialogProps {
    orderId: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * Optional — when provided, renders the "Edit Sales Order" footer button
     * and calls back with the fetched order row (the admin Orders page wires
     * this to its inline edit modal). Omitted in read-only hosts (e.g. chat).
     */
    onEdit?: (order: any) => void;
}

/**
 * Self-contained admin order view/preview dialog, extracted 1:1 from the
 * admin Orders page. Fetches its own order row (+ history, parcel, tracking
 * enrichment) by `orderId` — the host only controls open state.
 */
const OrderViewDialog: React.FC<OrderViewDialogProps> = ({ orderId, open, onOpenChange, onEdit }) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provider-integration`;

    // Parcel Tracking States
    const [orderParcel, setOrderParcel] = useState<any>(null);
    const [trackingHistory, setTrackingHistory] = useState<any>(null);
    const [isTrackingLoading, setIsTrackingLoading] = useState(false);
    const [isParcelLoading, setIsParcelLoading] = useState(false);
    const [parcelTrackingOpen, setParcelTrackingOpen] = useState(false);

    const { isOrderCategory } = useStatusCategories();
    // Shared resolver — master status label+color+icon, raw only as fallback.
    const { resolve: resolvePkgStatus, resolveById } = usePackageStatusResolver();

    // Add custom scrollbar styles to head (self-contained — the admin Orders
    // page injects the same rules, duplicates are harmless).
    React.useEffect(() => {
        const style = document.createElement('style');
        style.innerHTML = `
            .custom-scrollbar::-webkit-scrollbar {
                width: 6px;
            }
            .custom-scrollbar::-webkit-scrollbar-track {
                background: transparent;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb {
                background: #e8e6dc;
                border-radius: 10px;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                background: #b0aea5;
            }
        `;
        document.head.appendChild(style);
        return () => { document.head.removeChild(style); };
    }, []);

    // The order row itself — same joins as the Orders page aggregate so every
    // field the JSX reads is present. Seeds instantly from the page aggregate
    // cache when available (zero flash when opened from the orders list).
    const { data: selectedOrder, isLoading: isOrderLoading, isError: isOrderError } = useQuery<any>({
        queryKey: ['order-view', orderId],
        queryFn: async () => {
            if (!orderId) return null;
            const { data, error } = await (supabase as any)
                .from('orders')
                .select(ORDER_VIEW_SELECT)
                .eq('id', orderId)
                .is('date_deleted', null)
                .maybeSingle();
            if (error) throw error;
            return data;
        },
        enabled: open && !!orderId,
        staleTime: 30 * 1000,
        // D1: the old full-business 'orders-aggregate' cache is gone (keyset
        // pages carry slim rows) — the dialog's own fetch is the sole source.
    });

    // An order that resolves to nothing while the dialog is open (soft-deleted
    // under us, or a fetch error) must not linger as an empty Dialog shell —
    // the inline modal never had this state. Close, with a toast on error.
    useEffect(() => {
        if (!open || !orderId || isOrderLoading || selectedOrder) return;
        if (isOrderError) {
            toast({ title: 'Commande introuvable ou inaccessible.', variant: 'destructive' });
        }
        onOpenChange(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, orderId, isOrderLoading, selectedOrder, isOrderError]);

    // History is heavy + only needed by this modal — lazy-fetch it when open.
    const { data: selectedOrderHistory = [] } = useQuery<any[]>({
        queryKey: ['order-history', orderId],
        queryFn: async () => {
            if (!orderId) return [];
            const { data, error } = await (supabase as any)
                .from('order_status_history')
                .select('*, user:users!changed_by(name, avatar_url, avatar_config), status:order_statuses!status_id(*)')
                .eq('order_id', orderId)
                .order('created_at', { ascending: true });
            if (error) throw error;
            return data || [];
        },
        enabled: open && !!orderId,
        staleTime: 30 * 1000,
    });

    // Order statuses for icon lookup in status history. Gated on `open`: hosts
    // keep this dialog MOUNTED after close (Radix exit animation), so an
    // ungated query would focus-refetch for the rest of the session.
    const { data: ordStatusesForTimeline } = useQuery({
        queryKey: ['order-statuses-timeline'],
        queryFn: async () => {
            const { data } = await supabase.from('order_statuses').select('id, icon').eq('active', true);
            return data || [];
        },
        enabled: open,
        staleTime: 5 * 60 * 1000,
    });
    const getOrdIcon = (statusId: string | null): string | null => {
        if (!statusId || !ordStatusesForTimeline?.length) return null;
        return (ordStatusesForTimeline as any[]).find((s: any) => s.id === statusId)?.icon || null;
    };

    // Business identity — used to label history rows on whatsapp-source orders
    // (where changed_by is NULL because no user took the action; the business
    // itself, via the AI assistant, did).
    const { data: businessIdentity } = useQuery({
        queryKey: ['business-identity', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return null;
            const { data, error } = await (supabase as any)
                .from('businesses')
                .select('id, name, logo')
                .eq('id', activeBusinessId)
                .maybeSingle();
            if (error) throw error;
            return data as { id: string; name: string | null; logo: string | null } | null;
        },
        enabled: open && !!activeBusinessId,   // same kept-mounted gate as above
        staleTime: 5 * 60 * 1000,
    });

    // Fetch parcel data and tracking when the modal opens
    useEffect(() => {
        if (!open || !orderId) {
            setOrderParcel(null);
            setTrackingHistory(null);
            return;
        }

        const fetchParcelAndTrack = async () => {
            setIsParcelLoading(true);
            setOrderParcel(null);
            setTrackingHistory(null);

            try {
                const { data: parcel } = await supabase
                    .from('company_parcels')
                    .select('*, provider:providers(id, name, provider_type, logo_url)')
                    .eq('order_id', orderId)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (parcel) {
                    setOrderParcel(parcel);
                    if (parcel.tracking_code && parcel.provider_id) {
                        await handleTrackParcel(parcel);
                    }
                    return;
                }

                // Fallback: courier parcel (internal — no edge function call).
                const { data: courierParcel } = await (supabase as any)
                    .from('courier_parcels')
                    .select('*, status:package_statuses(label, color), courier:users!courier_parcels_courier_id_fkey(id, name, phone, avatar_url, avatar_config)')
                    .eq('order_id', orderId)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (courierParcel) {
                    setOrderParcel({
                        ...courierParcel,
                        provider: {
                            id: courierParcel.courier?.id,
                            name: courierParcel.courier?.name || 'Coursier',
                            provider_type: 'courier',
                            logo_url: courierParcel.courier?.avatar_url || null,
                        },
                        _isCourierParcel: true,
                    });

                    if (courierParcel.tracking_code) {
                        const courierName = courierParcel.courier?.name || 'Coursier';
                        const courierPhone = courierParcel.courier?.phone || '';
                        const cpLabel = courierParcel.status?.label || 'Nouveau';
                        const cpColor = courierParcel.status?.color || '#3b82f6';
                        setTrackingHistory({
                            statusLabel: cpLabel,
                            statusColor: cpColor,
                            history: [
                                {
                                    status: cpLabel,
                                    statusLabel: cpLabel,
                                    date: courierParcel.created_at || null,
                                    comment: 'Colis créé en interne et confié à ' + courierName,
                                    color: cpColor,
                                    user: courierName,
                                    phone: courierPhone,
                                },
                            ],
                        });
                    }
                }
            } catch (err) {
                console.error('Error fetching parcel:', err);
            } finally {
                setIsParcelLoading(false);
            }
        };

        fetchParcelAndTrack();
    }, [open, orderId]);

    // Track parcel via edge function (or synthesise for internal courier parcels)
    const handleTrackParcel = async (parcel: any) => {
        setIsTrackingLoading(true);
        setTrackingHistory(null);

        // Internal courier parcels: no edge function — just refresh from DB.
        if (parcel?._isCourierParcel || (!parcel?.provider_id && parcel?.courier_id)) {
            try {
                const { data: fresh } = await (supabase as any)
                    .from('courier_parcels')
                    .select('id, tracking_code, status_id, created_at, status:package_statuses(label, color), courier:users!courier_parcels_courier_id_fkey(id, name, phone)')
                    .eq('id', parcel.id)
                    .maybeSingle();

                const courierName = fresh?.courier?.name || parcel.courier?.name || 'Coursier';
                const courierPhone = fresh?.courier?.phone || parcel.courier?.phone || '';
                const cpLabel = fresh?.status?.label || parcel.status?.label || 'Nouveau';
                const cpColor = fresh?.status?.color || parcel.status?.color || '#3b82f6';

                setTrackingHistory({
                    statusLabel: cpLabel,
                    statusColor: cpColor,
                    history: [
                        {
                            status: cpLabel,
                            statusLabel: cpLabel,
                            date: fresh?.created_at || parcel.created_at || null,
                            comment: 'Colis créé en interne et confié à ' + courierName,
                            color: cpColor,
                            user: courierName,
                            phone: courierPhone,
                        },
                    ],
                });
            } catch (e) {
                console.error('[track] internal courier refresh failed', e);
            } finally {
                setIsTrackingLoading(false);
            }
            return;
        }

        // Throttle (same 10-min per-parcel cache as the seller dialog +
        // ParcelTrackingDialog): replay the cached result instead of re-hitting
        // the carrier API on every dialog open.
        const cachedTracking = getCachedTracking(String(parcel.tracking_code || '').trim());
        if (cachedTracking) {
            setTrackingHistory(cachedTracking);
            setIsTrackingLoading(false);
            return;
        }

        try {
            const { data: { session } } = await supabase.auth.getSession();
            let response = await fetch(EDGE_FUNCTION_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`
                },
                body: JSON.stringify({
                    action: 'track_parcel',
                    provider_id: parcel.provider_id,
                    data: {
                        tracking_code: parcel.tracking_code,
                        external_id: parcel.external_id
                    }
                })
            });

            const isError = !response.ok;
            let result = isError ? null : await response.json();

            // Fallback to get_parcel_info if track_parcel fails (e.g. Coliaty 404 for history)
            if (isError || !result?.success) {
                console.log("track_parcel failed, attempting get_parcel_info fallback...");
                response = await fetch(EDGE_FUNCTION_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session?.access_token}`
                    },
                    body: JSON.stringify({
                        action: 'get_parcel_info',
                        provider_id: parcel.provider_id,
                        data: {
                            tracking_code: parcel.tracking_code
                        }
                    })
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({ error: 'Failed to fetch tracking data' }));
                    throw new Error(errData.error || `Error ${response.status}`);
                }

                result = await response.json();

                // Process fallback result into expected history format
                if (result.success && result.data && !result.data.history && !Array.isArray(result.data)) {
                    result.data.history = [{
                        status: result.data.status,
                        statusLabel: result.data.statusLabel || result.data.status,
                        date: result.data.date || new Date().toISOString(),
                        comment: result.data.comment || 'Statut actuel (historique indisponible)',
                        user: 'Synchronisation Coliaty/Provider'
                    }];
                }
            }

            if (result && result.success) {
                setTrackingHistory(result.data);
                putCachedTracking(String(parcel.tracking_code || '').trim(), result.data);

                const providerStatus = result.data?.statusLabel || result.data?.status || result.data?.current_status;

                if (providerStatus) {
                    const matched = await matchPackageStatus(supabase, providerStatus);
                    // status_id is the only persisted parcel status; skip when unmatched
                    // rather than wiping the existing status.
                    if (matched?.id) {
                        await supabase
                            .from('company_parcels')
                            .update({ status_id: matched.id })
                            .eq('id', parcel.id);
                    }
                }

                queryClient.invalidateQueries({ queryKey: ['orders-page'] }); queryClient.invalidateQueries({ queryKey: ['orders-kpis'] });
            } else {
                throw new Error(result?.error || 'Unknown error');
            }
        } catch (error) {
            console.error('handleTrackParcel error:', error);
            toast({
                title: "Tracking Error",
                description: error.message,
                variant: "destructive"
            });
        } finally {
            setIsTrackingLoading(false);
        }
    };

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="ant-surface max-w-4xl p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden flex flex-col h-[90vh] md:h-auto md:max-h-[90vh]">
                    {selectedOrder && (
                        <div className="flex flex-col h-full overflow-hidden">
                            <div className="p-8 pb-0 flex flex-col md:flex-row justify-between items-start gap-6 shrink-0">
                                <div className="space-y-4">
                                    <div className="flex items-center gap-4">
                                        <div className="w-14 h-14 rounded-2xl bg-ant-ink flex items-center justify-center text-ant-light">
                                            <ShoppingCart className="w-6 h-6" strokeWidth={1.75} />
                                        </div>
                                        <div>
                                            <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                                <span className="w-1 h-1 rounded-full bg-ant-orange" />
                                                Order details
                                            </span>
                                            <h2 className="font-display text-[28px] font-semibold text-ant-ink tracking-[-0.02em] mt-0.5">
                                                {selectedOrder.name}
                                            </h2>
                                            <div className="flex items-center gap-4 text-ant-muted text-[12px] mt-1">
                                                <span className="flex items-center gap-1.5 tabular-nums">
                                                    <Calendar className="w-3.5 h-3.5 text-ant-mid" />
                                                    {format(new Date(selectedOrder.date || selectedOrder.created_at), 'MMMM dd, yyyy')}
                                                </span>
                                                <span className="flex items-center gap-1.5 tabular-nums">
                                                    {selectedOrder.phone}
                                                    <OrderPhoneQuickActions phone={selectedOrder.phone} className="h-7 w-7" />
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <div className="flex items-center gap-2 px-4 py-2 rounded-xl shadow-sm border border-ant-line" style={{ backgroundColor: `${selectedOrder.status?.color}12` }}>
                                            {selectedOrder.status?.icon ? (
                                                <DynamicIcon name={selectedOrder.status.icon} className="w-4 h-4" style={{ color: selectedOrder.status?.color }} />
                                            ) : (
                                                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: selectedOrder.status?.color }} />
                                            )}
                                            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: selectedOrder.status?.color }}>
                                                {selectedOrder.status?.label || 'DRAFT'}
                                            </span>
                                        </div>
                                        {(() => {
                                            const courierPkg = getCourierPackageStatus(selectedOrder);
                                            const rawPkgLabel = selectedOrder.package_status?.label || courierPkg?.label;
                                            const rawPkgColor = selectedOrder.package_status?.color || courierPkg?.color || null;
                                            const rPkg = resolveById(selectedOrder.package_status_id) ?? (rawPkgLabel ? resolvePkgStatus(rawPkgLabel, selectedOrder.package_status?.label, rawPkgColor) : null);
                                            const pkgLabel = rPkg?.label ?? rawPkgLabel;
                                            const pkgColor = rPkg?.color ?? rawPkgColor;
                                            const pkgIcon = rPkg?.icon ?? selectedOrder.package_status?.icon ?? null;
                                            if (!pkgLabel) return null;
                                            return (
                                                <div className="flex items-center gap-2 px-4 py-2 rounded-xl shadow-sm border border-ant-line" style={{ backgroundColor: pkgColor ? `${pkgColor}12` : 'rgba(0,31,63,0.04)' }}>
                                                    {pkgIcon ? (
                                                        <DynamicIcon name={pkgIcon} className="w-4 h-4" style={{ color: pkgColor || undefined }} />
                                                    ) : pkgColor ? (
                                                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: pkgColor }} />
                                                    ) : (
                                                        <Truck className="w-4 h-4" style={{ color: pkgColor || undefined }} />
                                                    )}
                                                    <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: pkgColor || 'rgba(0,31,63,0.45)' }}>
                                                        {pkgLabel}
                                                    </span>
                                                </div>
                                            );
                                        })()}
                                        {(selectedOrder as any).channel?.name && (
                                            <Badge variant="outline" className="border-ant-line bg-ant-green/[0.07] text-ant-ink font-bold uppercase tracking-widest px-4 py-2 rounded-xl text-[10px] gap-1.5" title={`Sheet channel: ${(selectedOrder as any).channel.name}`}>
                                                <FileSpreadsheet className="w-3.5 h-3.5 text-[#0F9D58]" />
                                                {(selectedOrder as any).channel.name}
                                            </Badge>
                                        )}
                                        {!(selectedOrder as any).channel?.name && selectedOrder.source_name && (
                                            <Badge variant="outline" className="border-ant-ink/10 text-ant-ink font-bold uppercase tracking-widest px-4 py-2 rounded-xl text-[10px]">
                                                {selectedOrder.source_name}
                                            </Badge>
                                        )}
                                        {selectedOrder.replace && (
                                            <Badge className="bg-ant-rose text-white font-semibold uppercase tracking-widest px-4 py-2 rounded-xl text-[10px]">
                                                Exchange
                                            </Badge>
                                        )}
                                        {orderParcel?.tracking_code && (
                                            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-50 border border-indigo-100">
                                                <Package className="w-4 h-4 text-indigo-500" />
                                                <span className="text-xs font-semibold uppercase tracking-widest text-indigo-600">
                                                    {orderParcel.tracking_code}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="p-8 pb-10 flex items-center justify-between border-b-2 border-ant-ink/5 bg-gradient-to-br from-ant-ink/[0.02] to-transparent">
                                    <div className="space-y-1">
                                        <p className="text-sm font-semibold text-ant-mid uppercase tracking-widest">Total Order Value</p>
                                        <h3 className="text-4xl font-semibold text-ant-ink">{selectedOrder.price || 0} <span className="text-lg">DH</span></h3>
                                    </div>
                                    {selectedOrder.include_delivery_in_total && selectedOrder.shipping_cost > 0 && (
                                        <div className="text-[10px] font-bold text-ant-mid uppercase tracking-tighter">
                                            Products + {selectedOrder.shipping_cost} DH delivery
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="overflow-y-auto p-10 space-y-10 flex-1 custom-scrollbar">
                                {/* Customer Insights in Preview */}
                                <CustomerInsights phone={selectedOrder.phone || ''} />

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                    {/* Logistics Info */}
                                    <div className="space-y-6">
                                        <div className="flex items-center gap-3 border-b border-ant-line pb-3">
                                            <Truck className="w-6 h-6 text-ant-mid" />
                                            <h4 className="text-lg font-semibold text-ant-ink uppercase tracking-widest">Delivery Details</h4>
                                        </div>
                                        <div className="space-y-6">
                                            <div className="flex items-start gap-4">
                                                <div className="w-10 h-10 rounded-2xl bg-orange-50 flex items-center justify-center text-orange-500 shrink-0 shadow-sm shadow-orange-500/10">
                                                    <MapPinned className="w-5 h-5" />
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest leading-none">Destination</p>
                                                    <p className="text-lg font-bold text-ant-ink leading-tight">{selectedOrder.city?.name}</p>
                                                    <p className="text-sm font-medium text-ant-muted italic">"{selectedOrder.address}"</p>
                                                </div>
                                            </div>
                                            <div className="flex items-start gap-4">
                                                <div className="w-10 h-10 rounded-2xl bg-ant-blue/10 flex items-center justify-center text-ant-blue shrink-0 shadow-sm shadow-blue-500/10">
                                                    <ShoppingCart className="w-5 h-5" />
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest leading-none">Shipping Configuration</p>
                                                    <p className="text-sm font-bold text-ant-green uppercase tracking-widest">{selectedOrder.shipping_cost === 0 ? 'Free Shipping' : `Paid: ${selectedOrder.shipping_cost} DH`}</p>
                                                </div>
                                            </div>
                                            {(selectedOrder.courier || selectedOrder.company) && (
                                                <div className="flex items-start gap-4">
                                                    <div className="w-10 h-10 rounded-2xl bg-ant-ink/5 flex items-center justify-center text-ant-mid shrink-0 shadow-sm overflow-hidden">
                                                        {resolveProviderLogo(selectedOrder.company) ? (
                                                            <img src={resolveProviderLogo(selectedOrder.company)!} alt={selectedOrder.company.name} className="w-full h-full object-contain" />
                                                        ) : selectedOrder.courier ? (
                                                            <UserAvatar url={selectedOrder.courier.avatar_url} config={(selectedOrder.courier as any).avatar_config} name={selectedOrder.courier.name} className="w-full h-full bg-transparent" />
                                                        ) : (
                                                            <Building2 className="w-5 h-5 text-ant-blue" />
                                                        )}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest leading-none">Assigned Provider</p>
                                                        <p className="text-lg font-bold text-ant-ink leading-tight">
                                                            {selectedOrder.courier?.name || selectedOrder.company?.name}
                                                        </p>
                                                        <Badge variant="outline" className="h-5 px-2 text-[8px] font-semibold uppercase tracking-tighter bg-ant-ink/[0.03] text-ant-mid border-none">
                                                            {selectedOrder.courier ? 'Independent Courier' : 'Delivery Company'}
                                                        </Badge>
                                                    </div>
                                                </div>
                                            )}
                                            {String(selectedOrder.coliaty_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-4">
                                                    <div className="w-10 h-10 rounded-2xl bg-ant-orange/10 flex items-center justify-center text-ant-orange shrink-0 shadow-sm shadow-amber-500/10">
                                                        <RefreshCcw className="w-5 h-5" />
                                                    </div>
                                                    <div className="space-y-1 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest leading-none">
                                                            Previous parcel tracking (Coliaty)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(selectedOrder.coliaty_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(selectedOrder.ameex_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-4">
                                                    <div className="w-10 h-10 rounded-2xl bg-ant-orange/10 flex items-center justify-center text-ant-orange shrink-0 shadow-sm shadow-amber-500/10">
                                                        <RefreshCcw className="w-5 h-5" />
                                                    </div>
                                                    <div className="space-y-1 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest leading-none">
                                                            Previous parcel tracking (AMEEX)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(selectedOrder.ameex_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(selectedOrder.quicklivraison_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-4">
                                                    <div className="w-10 h-10 rounded-2xl bg-ant-orange/10 flex items-center justify-center text-ant-orange shrink-0 shadow-sm shadow-amber-500/10">
                                                        <RefreshCcw className="w-5 h-5" />
                                                    </div>
                                                    <div className="space-y-1 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest leading-none">
                                                            Previous parcel tracking (Quick Livraison)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(selectedOrder.quicklivraison_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(selectedOrder.forcelog_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-4">
                                                    <div className="w-10 h-10 rounded-2xl bg-ant-orange/10 flex items-center justify-center text-ant-orange shrink-0 shadow-sm shadow-amber-500/10">
                                                        <RefreshCcw className="w-5 h-5" />
                                                    </div>
                                                    <div className="space-y-1 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest leading-none">
                                                            Previous parcel tracking (Forcelog)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(selectedOrder.forcelog_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(selectedOrder.sendit_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-4">
                                                    <div className="w-10 h-10 rounded-2xl bg-ant-orange/10 flex items-center justify-center text-ant-orange shrink-0 shadow-sm shadow-amber-500/10">
                                                        <RefreshCcw className="w-5 h-5" />
                                                    </div>
                                                    <div className="space-y-1 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest leading-none">
                                                            Previous parcel tracking (Sendit)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(selectedOrder.sendit_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(selectedOrder.delvoexpress_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-4">
                                                    <div className="w-10 h-10 rounded-2xl bg-ant-orange/10 flex items-center justify-center text-ant-orange shrink-0 shadow-sm shadow-amber-500/10">
                                                        <RefreshCcw className="w-5 h-5" />
                                                    </div>
                                                    <div className="space-y-1 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest leading-none">
                                                            Previous parcel tracking (Delevo Express)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(selectedOrder.delvoexpress_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Internal Notes */}
                                    <div className="space-y-6">
                                        <div className="flex items-center gap-3 border-b border-ant-line pb-3">
                                            <MessageSquare className="w-6 h-6 text-ant-mid" />
                                            <h4 className="text-lg font-semibold text-ant-ink uppercase tracking-widest">Client & Note Info</h4>
                                        </div>
                                        <div className="space-y-4">
                                            <div className="p-6 rounded-2xl bg-ant-light border border-ant-line space-y-2">
                                                <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest">Internal Instruction</p>
                                                <p className="text-sm font-medium text-ant-ink">{selectedOrder.note || 'No internal notes provided.'}</p>
                                            </div>
                                            <div className="p-6 rounded-2xl bg-ant-light border border-ant-line space-y-2">
                                                <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest text-ant-mid text-ant-blue">Public Delivery Note</p>
                                                <p className="text-sm font-bold text-ant-ink italic">"{selectedOrder.delivery_note || 'No special delivery instructions.'}"</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <Separator className="bg-ant-ink/[0.05]" />

                                {/* Order Items Table */}
                                <div className="space-y-6 pb-6">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Package className="w-6 h-6 text-ant-mid" />
                                            <h4 className="text-xl font-semibold text-ant-ink uppercase tracking-[0.15em]">Cart Items</h4>
                                        </div>
                                        <Badge variant="outline" className="text-xs font-semibold border-ant-ink/10 tracking-widest rounded-xl px-4 py-1.5 h-auto">
                                            {selectedOrder.items?.length || 0} Unique SKU(s)
                                        </Badge>
                                    </div>
                                    <div className="grid grid-cols-1 gap-4">
                                        {(() => {
                                            const displayItems: any[] = [];
                                            selectedOrder.items?.forEach((item: any) => {
                                                if (item.product_id && Number(item.quantity) > 0) {
                                                    displayItems.push({ ...item, accessoriesList: item.accessory_id ? [item] : [] });
                                                } else if (item.product_id && Number(item.quantity) === 0) {
                                                    const parent = displayItems.find(l => l.product_id === item.product_id);
                                                    if (parent) {
                                                        parent.accessoriesList.push(item);
                                                    } else {
                                                        displayItems.push({ ...item, accessoriesList: item.accessory_id ? [item] : [] });
                                                    }
                                                } else {
                                                    displayItems.push({ ...item, accessoriesList: item.accessory_id ? [item] : [] });
                                                }
                                            });

                                            return displayItems.map((item: any) => {
                                                const prodTotal = (item.quantity || 0) * (item.unit_price || 0);
                                                return (
                                                    <div
                                                        key={item.id}
                                                        className="group p-6 rounded-2xl bg-ant-light border border-ant-line flex flex-col gap-4 animate-in slide-in-from-bottom-2 duration-300"
                                                    >
                                                        {/* Product Info */}
                                                        {item.product && (
                                                            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                                                                <div className="flex items-center gap-5 flex-1 w-full md:w-auto">
                                                                    <div className="w-16 h-16 rounded-[20px] bg-ant-ink/5 flex items-center justify-center overflow-hidden shrink-0">
                                                                        {item.product?.image_url ? (
                                                                            <img src={item.product?.image_url} alt="" className="w-full h-full object-cover" />
                                                                        ) : (
                                                                            <Package className="w-8 h-8 text-ant-mid" />
                                                                        )}
                                                                    </div>
                                                                    <div>
                                                                        <h5 className="text-lg font-semibold text-ant-ink leading-none mb-1 group-hover:text-ant-blue transition-colors uppercase">{item.product?.name}</h5>
                                                                        <div className="flex items-center gap-3">
                                                                            <p className="text-[10px] font-bold text-ant-muted/60 tracking-widest bg-ant-ink/5 px-2 py-0.5 rounded-md inline-block">{item.product?.code}</p>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center justify-between md:justify-end w-full md:w-auto gap-8  md:gap-12 text-right">
                                                                    <div>
                                                                        <p className="text-[10px] font-semibold uppercase text-ant-muted/40 tracking-widest mb-1">Unit Price</p>
                                                                        <p className="text-lg font-semibold text-ant-ink">{item.unit_price} DH</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-semibold uppercase text-ant-muted/40 tracking-widest mb-1">Qty</p>
                                                                        <p className="text-lg font-semibold text-ant-ink">x{item.quantity}</p>
                                                                    </div>
                                                                    <div className="min-w-[80px] md:min-w-[100px]">
                                                                        <p className="text-[10px] font-semibold uppercase text-ant-muted/40 tracking-widest mb-1">Subtotal</p>
                                                                        <p className="text-xl font-semibold text-ant-ink">{prodTotal} DH</p>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Accessory Info List */}
                                                        {item.accessoriesList && item.accessoriesList.length > 0 && item.accessoriesList.map((accItem: any, idx: number) => {
                                                            const accTotal = (accItem.accessory_quantity || 0) * (accItem.accessory_unit_price || 0);
                                                            return (
                                                                <div key={accItem.id || idx} className="flex flex-col md:flex-row justify-between items-center gap-4 pt-4 border-t border-ant-line">
                                                                    <div className="flex items-center gap-5 flex-1 w-full md:w-auto">
                                                                        <div className="w-12 h-12 rounded-[16px] bg-ant-ink/5 flex items-center justify-center overflow-hidden shrink-0 md:ml-4">
                                                                            {accItem.accessory?.image_url ? (
                                                                                <img src={accItem.accessory?.image_url} alt="" className="w-full h-full object-cover" />
                                                                            ) : (
                                                                                <Puzzle className="w-5 h-5 text-ant-mid" />
                                                                            )}
                                                                        </div>
                                                                        <div>
                                                                            <h5 className="text-sm font-semibold text-ant-ink/70 leading-none mb-1 uppercase flex items-center gap-2">
                                                                                <Puzzle className="w-3 h-3" /> {accItem.accessory?.name}
                                                                            </h5>
                                                                            <p className="text-[10px] font-bold text-ant-muted/60 tracking-widest bg-ant-ink/5 px-2 py-0.5 rounded-md inline-block">{accItem.accessory?.code}</p>
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center justify-between md:justify-end w-full md:w-auto gap-8 md:gap-12 text-right">
                                                                        <div>
                                                                            <p className="text-[10px] font-semibold uppercase text-ant-muted/40 tracking-widest mb-1">Unit Cost</p>
                                                                            <p className="text-sm font-semibold text-ant-ink/80">{accItem.accessory_unit_price} DH</p>
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-[10px] font-semibold uppercase text-ant-muted/40 tracking-widest mb-1">Qty</p>
                                                                            <p className="text-sm font-semibold text-ant-ink/80">x{accItem.accessory_quantity}</p>
                                                                        </div>
                                                                        <div className="min-w-[80px] md:min-w-[100px]">
                                                                            <p className="text-[10px] font-semibold uppercase text-ant-muted/40 tracking-widest mb-1">Cost Total</p>
                                                                            <p className="text-sm font-semibold text-ant-ink/80">{accTotal} DH</p>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}

                                                        {item.product && (
                                                            <div className="pt-3 border-t border-ant-line flex justify-end">
                                                                <div className="bg-ant-green/10 text-ant-green px-4 py-2 rounded-2xl flex items-center gap-4">
                                                                    <span className="text-[10px] font-semibold uppercase tracking-widest opacity-60">Row Subtotal</span>
                                                                    <span className="text-xl font-semibold">{prodTotal} DH</span>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            });
                                        })()}
                                    </div>
                                </div>

                                {/* Parcel Info (no API call — use Track Order button for full timeline) */}
                                <div className="space-y-4 pb-6">
                                    <div className="flex items-center gap-3">
                                        <Truck className="w-6 h-6 text-ant-mid" />
                                        <h4 className="text-xl font-semibold text-ant-ink uppercase tracking-[0.15em]">Suivi du Colis</h4>
                                    </div>

                                    {isParcelLoading ? (
                                        <div className="flex items-center justify-center py-6">
                                            <Loader2 className="w-6 h-6 text-ant-ink animate-spin" />
                                        </div>
                                    ) : !orderParcel ? (
                                        <div className="text-center p-6 bg-ant-line-soft rounded-2xl border border-ant-line">
                                            <p className="text-sm font-bold text-ant-muted">Aucun colis créé pour cette commande.</p>
                                        </div>
                                    ) : (() => {
                                        // Master status (by id) first; embedded master row as fallback.
                                        const rPkg = resolveById(orderParcel.status_id);
                                        const embed = orderParcel.status as { label?: string | null; color?: string | null } | undefined;
                                        const pColor = rPkg?.color || embed?.color || '#94a3b8';
                                        const pIcon = rPkg?.icon || null;
                                        const pLabel = rPkg?.label || embed?.label || 'En attente';
                                        return (
                                        <div className="flex items-center justify-between p-4 bg-ant-line-soft rounded-2xl border border-ant-line">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white" style={{ backgroundColor: pColor }}>
                                                    {pIcon ? <DynamicIcon name={pIcon} className="w-4 h-4" /> : <div className="w-2.5 h-2.5 rounded-full bg-white" />}
                                                </div>
                                                <div className="min-w-0">
                                                    <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-md" style={{ color: pColor, backgroundColor: `${pColor}15` }}>
                                                        {pLabel}
                                                    </span>
                                                    {orderParcel.tracking_code && (
                                                        <p className="text-[10px] font-mono font-bold text-ant-muted/50 truncate mt-1">{orderParcel.tracking_code}</p>
                                                    )}
                                                </div>
                                            </div>
                                            {orderParcel.tracking_code && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setParcelTrackingOpen(true)}
                                                    className="text-xs font-bold text-ant-ink hover:bg-ant-ink/5 hover:text-ant-ink gap-2 rounded-xl h-9 px-4 shrink-0"
                                                >
                                                    <Truck className="w-3.5 h-3.5" />
                                                    Suivre
                                                </Button>
                                            )}
                                        </div>
                                        );
                                    })()}
                                </div>

                                <Separator className="bg-ant-ink/[0.05]" />

                                {/* Status History Timeline */}
                                <div className="space-y-6 pb-6">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <ShieldCheck className="w-6 h-6 text-ant-mid" />
                                            <h4 className="text-xl font-semibold text-ant-ink uppercase tracking-[0.15em]">Status History</h4>
                                        </div>
                                    </div>

                                    <div className="px-4">
                                        {(() => { const hist = (selectedOrder.history && selectedOrder.history.length > 0) ? selectedOrder.history : selectedOrderHistory; return hist && hist.length > 0; })() ? (
                                            <div className="relative pl-10">
                                                <div className="absolute left-[15px] top-4 bottom-4 w-0.5 bg-gradient-to-b from-ant-line via-ant-line to-ant-ink/30" />
                                                <div className="space-y-0">
                                                {[...((selectedOrder.history && selectedOrder.history.length > 0) ? selectedOrder.history : selectedOrderHistory)].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map((record: any, idx: number, arr: any[]) => {
                                                    const color = record.status?.color || '#94a3b8';
                                                    const isLast = idx === arr.length - 1;
                                                    const ordIcon = getOrdIcon(record.status_id);
                                                    const postponed = isOrderCategory(record.status_id, 'postponed');
                                                    const reportedMatch = postponed && record.comment?.match(/\[Reporté pour: (.*?)\]/);
                                                    const reportedText = reportedMatch?.[1] || (postponed && selectedOrder.reported_date ? format(new Date(selectedOrder.reported_date), 'dd/MM/yyyy HH:mm') : null);
                                                    const cleanedComment = postponed ? (record.comment || '').replace(/\[Reporté pour:.*?\]/, '').trim() : record.comment || '';
                                                    return (
                                                        <div key={record.id} className="relative pb-6 last:pb-0 group">
                                                            <div className={`absolute -left-10 top-0 w-8 h-8 rounded-full border-[3px] border-white shadow-sm flex items-center justify-center z-10 transition-all group-hover:scale-110 ${isLast ? 'ring-2 ring-offset-2' : ''}`} style={{ backgroundColor: isLast ? color : '#f8fafc', color: isLast ? '#ffffff' : color, ['--tw-ring-color' as any]: isLast ? `${color}40` : undefined }}>
                                                                {ordIcon ? <DynamicIcon name={ordIcon} className="w-3.5 h-3.5" /> : <div className="w-2 h-2 rounded-full" style={{ backgroundColor: isLast ? '#ffffff' : color }} />}
                                                            </div>
                                                            <div className="space-y-1.5">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-lg" style={{ color, backgroundColor: `${color}15` }}>{record.status?.label || 'Inconnu'}</span>
                                                                </div>
                                                                {record.created_at && <p className="text-[10px] font-bold text-ant-muted/50">{format(new Date(record.created_at), 'dd/MM/yyyy HH:mm')}</p>}
                                                                <div className="flex items-center gap-2">
                                                                    {(() => {
                                                                        // changed_by NULL + whatsapp-source order ⇒ the AI assistant acted on
                                                                        // behalf of the business itself. Show the business name + logo
                                                                        // instead of the generic "Système" pill.
                                                                        const isAiBusinessAction = !record.user && selectedOrder?.source_name === 'whatsapp';
                                                                        const displayName = record.user?.name
                                                                            || (isAiBusinessAction ? (businessIdentity?.name || 'Business') : 'Système');
                                                                        const businessLogo = isAiBusinessAction ? businessIdentity?.logo : null;
                                                                        return (
                                                                            <>
                                                                                {record.user ? (
                                                                                    <UserAvatar url={record.user.avatar_url} config={(record.user as any).avatar_config} name={displayName} className="w-5 h-5 rounded-full border bg-white" />
                                                                                ) : businessLogo ? (
                                                                                    <Avatar className="w-5 h-5 border bg-white">
                                                                                        <AvatarImage src={businessLogo} />
                                                                                        <AvatarFallback className="text-[9px] font-bold bg-ant-ink/5 text-ant-ink">{displayName?.[0] || '?'}</AvatarFallback>
                                                                                    </Avatar>
                                                                                ) : (
                                                                                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-ant-ink/10 to-ant-ink/20 flex items-center justify-center">
                                                                                        <DynamicIcon name="TbRobot" className="w-3 h-3 text-ant-ink/60" />
                                                                                    </div>
                                                                                )}
                                                                                <span className="text-[11px] font-bold text-ant-ink/70 truncate max-w-[200px]">{displayName}</span>
                                                                            </>
                                                                        );
                                                                    })()}
                                                                </div>
                                                                {postponed && reportedText && (
                                                                    <div className="flex flex-col gap-1 p-3 bg-ant-orange/10 rounded-xl border border-ant-orange/25">
                                                                        <div className="flex items-center gap-2"><Calendar className="w-3 h-3 text-ant-orange" /><span className="text-[10px] font-semibold uppercase text-ant-orange">Rappel programmé</span></div>
                                                                        <p className="text-xs font-bold text-amber-900">{reportedText}</p>
                                                                        {cleanedComment && <p className="text-[11px] font-medium text-amber-800 italic mt-1 border-t border-amber-500/10 pt-1">"{cleanedComment}"</p>}
                                                                    </div>
                                                                )}
                                                                {!postponed && record.comment && <p className="text-[11px] font-medium text-ant-muted leading-relaxed italic">"{record.comment}"</p>}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-center p-8 bg-ant-line-soft rounded-3xl border border-ant-line">
                                                <p className="text-sm font-bold text-ant-muted">No tracking history available yet.</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <DialogFooter className="p-8 pb-10 flex gap-4 bg-ant-paper border-t border-ant-line">
                                {onEdit && (
                                    <Button
                                        onClick={() => onEdit(selectedOrder)}
                                        className="flex-1 bg-ant-ink hover:bg-ant-ink/90 text-ant-light rounded-3xl h-16 text-lg font-semibold shadow-2xl transition-all active:scale-95 flex items-center justify-center gap-3"
                                    >
                                        <Edit2 className="w-6 h-6" /> Edit Sales Order
                                    </Button>
                                )}
                                <Button
                                    onClick={() => onOpenChange(false)}
                                    variant="ghost"
                                    className="rounded-3xl h-16 px-10 font-bold text-ant-ink hover:bg-muted"
                                >
                                    Done
                                </Button>
                            </DialogFooter>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            <ParcelTrackingDialog
                open={parcelTrackingOpen}
                onOpenChange={setParcelTrackingOpen}
                orderId={orderId}
            />
        </>
    );
};

export default OrderViewDialog;
