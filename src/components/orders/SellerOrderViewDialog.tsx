/**
 * MIRROR of the src/pages/seller/Orders.tsx order view/preview modal —
 * extracted 1:1 per the shared component contract (self-contained, fetches its
 * own order row + enrichment by orderId). Source regions in the page at the
 * time of extraction: parcel fetch effect L855-936, handleTrackParcel
 * L939-1069, lazy history query L1135-1149, order-status icon lookup
 * L1152-1163, view modal JSX L4923-5425.
 *
 * Props (frozen contract):
 *   { orderId: string | null; open: boolean; onOpenChange: (open: boolean) => void }
 * plus an OPTIONAL `onEdit` used by the seller Orders page to keep its
 * "Modifier la commande" footer action (hidden when the callback is absent,
 * e.g. when embedded in the WhatsApp inbox).
 *
 * RLS applies to every query here — a seller can only fetch their own orders,
 * which is the intended behavior.
 */
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
} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import CustomerInsights from '@/components/CustomerInsights';
import { OrderPhoneQuickActions } from '@/components/orders/OrderPhoneQuickActions';
import { ParcelTrackingDialog } from '@/components/orders/ParcelTrackingDialog';
import { DynamicIcon } from '@/lib/renderReactIcon';
import { usePackageStatusResolver } from '@/hooks/usePackageStatusResolver';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { resolveProviderLogo } from '@/lib/providerLogos';
import { UserAvatar } from '@/components/users/UserAvatar';

/**
 * For courier (internal) orders the package status lives on the latest
 * courier_parcels row, not on orders.package_status_id. Picks the most recent
 * parcel that has a master status and returns it in the same shape the badge
 * renderer expects. Reads the label/color off the embedded package_statuses row.
 * (Copied from src/pages/seller/Orders.tsx.)
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

type SellerOrderViewDialogProps = {
    orderId: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Optional: seller Orders page passes its handleEdit to keep the footer edit action. */
    onEdit?: (order: any) => void;
    /** Optional belt-and-suspenders: when set, the "Modifier" button only renders
     *  for the seller's OWN orders (order.seller_id === ownSellerId). Omitted by
     *  the seller Orders page (RLS already scopes it to own orders); the chat host
     *  passes the current user id. */
    ownSellerId?: string | null;
};

const SellerOrderViewDialog = ({ orderId, open, onOpenChange, onEdit, ownSellerId }: SellerOrderViewDialogProps) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const statusCats = useStatusCategories();
    const REPORTED_STATUS_ID = statusCats.getOrderByCategory('postponed')?.id;
    const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provider-integration`;

    // Parcel Tracking States (same shape as the page)
    const [orderParcel, setOrderParcel] = useState<any>(null);
    const [trackingHistory, setTrackingHistory] = useState<any>(null);
    const [isTrackingLoading, setIsTrackingLoading] = useState(false);
    const [isParcelLoading, setIsParcelLoading] = useState(false);

    // Embedded parcel tracking dialog ("Suivre" button)
    const [parcelTrackingOpen, setParcelTrackingOpen] = useState(false);
    const [parcelTrackingOrderId, setParcelTrackingOrderId] = useState<string | null>(null);

    // Self-fetch: the order row + the same enrichment joins the page list carries
    // (same select as the page's ?view=<id> fallback fetch, minus history which
    // stays a separate lazy query below). RLS restricts this to the seller's
    // own orders.
    const { data: order = null, isLoading: isOrderLoading, isError: isOrderError } = useQuery<any>({
        queryKey: ['seller-order-view', orderId],
        queryFn: async () => {
            if (!orderId) return null;
            const { data } = await (supabase as any)
                .from('orders')
                .select(`
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
                `)
                .eq('id', orderId)
                .is('date_deleted', null)
                .maybeSingle();
            return data ?? null;
        },
        enabled: open && !!orderId,
        staleTime: 30 * 1000,
    });

    // Mirror of the page's deep-link behavior: if the order can't be fetched
    // (not visible under RLS / deleted), the preview never shows. A FETCH ERROR
    // is not "not visible" — surface it instead of silently vanishing.
    useEffect(() => {
        if (!open || !orderId || isOrderLoading || order) return;
        if (isOrderError) {
            toast({ title: 'Commande introuvable ou inaccessible.', variant: 'destructive' });
        }
        onOpenChange(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, orderId, isOrderLoading, order, isOrderError]);

    // History is lazy-fetched per-order when the dialog opens (kept off the
    // main fetch so it matches the page's lazy `order-history` query 1:1).
    const { data: orderHistory = [] } = useQuery<any[]>({
        queryKey: ['order-history', order?.id],
        queryFn: async () => {
            if (!order?.id) return [];
            const { data, error } = await (supabase as any)
                .from('order_status_history')
                .select('*, user:users!changed_by(name, avatar_url, avatar_config), status:order_statuses!status_id(*)')
                .eq('order_id', order.id)
                .order('created_at', { ascending: true });
            if (error) throw error;
            return data || [];
        },
        enabled: !!order?.id && open,
        staleTime: 30 * 1000,
    });

    // Gated on `open`: hosts keep this dialog MOUNTED after close (Radix exit
    // animation), so an ungated query would focus-refetch for the session.
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

    // Shared resolver — master status label+color+icon, raw only as fallback.
    const { resolve: resolvePkgStatus, resolveById } = usePackageStatusResolver();

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

                queryClient.invalidateQueries({ queryKey: ['orders-aggregate'] });
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

    // Fetch parcel data and tracking when view modal opens
    useEffect(() => {
        if (!open || !order) {
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
                    .eq('order_id', order.id)
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
                    .eq('order_id', order.id)
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, order?.id]);

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-4xl p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)] overflow-hidden flex flex-col h-[90vh] md:h-auto md:max-h-[90vh]">
                    {!order && isOrderLoading && (
                        <div className="flex items-center justify-center py-16">
                            <Loader2 className="w-5 h-5 text-ant-ink animate-spin" />
                        </div>
                    )}
                    {order && (
                        <div className="flex flex-col h-full overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange shrink-0" />
                            <div className="px-6 pt-5 pb-4 flex flex-col md:flex-row justify-between items-start gap-4 shrink-0 border-b border-ant-line">
                                <div className="space-y-2">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                        Commande · Aperçu
                                    </div>
                                    <div>
                                        <h2 className="font-display text-[22px] font-semibold text-ant-ink tracking-[-0.02em] leading-tight">{order.name}</h2>
                                        <div className="flex items-center gap-3 mt-1.5 font-serif italic text-[12px] text-ant-mid">
                                            <span className="inline-flex items-center gap-1.5">
                                                <Calendar className="w-3 h-3" strokeWidth={1.75} />
                                                {format(new Date(order.date || order.created_at), 'd MMMM yyyy')}
                                            </span>
                                            <span className="inline-flex items-center gap-1.5 text-ant-ink not-italic font-display font-semibold tabular-nums text-[12px]">
                                                {order.phone}
                                                <OrderPhoneQuickActions phone={order.phone} className="h-7 w-7" />
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                        <span
                                            className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                                            style={{
                                                backgroundColor: `${order.status?.color || '#141413'}15`,
                                                borderColor: `${order.status?.color || '#141413'}40`,
                                                color: order.status?.color || '#141413',
                                            }}
                                        >
                                            {order.status?.icon ? (
                                                <DynamicIcon name={order.status.icon} className="w-3 h-3" style={{ color: order.status?.color }} />
                                            ) : (
                                                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: order.status?.color || '#141413' }} />
                                            )}
                                            {order.status?.label || 'Brouillon'}
                                        </span>
                                        {(() => {
                                            const courierPkg = getCourierPackageStatus(order);
                                            const rawPkgLabel = order.package_status?.label || courierPkg?.label;
                                            const rawPkgColor = order.package_status?.color || courierPkg?.color || null;
                                            const rPkg = resolveById(order.package_status_id) ?? (rawPkgLabel ? resolvePkgStatus(rawPkgLabel, order.package_status?.label, rawPkgColor) : null);
                                            const pkgLabel = rPkg?.label ?? rawPkgLabel;
                                            const pkgColor = rPkg?.color ?? rawPkgColor;
                                            const pkgIcon = rPkg?.icon ?? order.package_status?.icon ?? null;
                                            if (!pkgLabel) return null;
                                            const color = pkgColor || '#6B6760';
                                            return (
                                                <span
                                                    className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                                                    style={{
                                                        backgroundColor: `${color}15`,
                                                        borderColor: `${color}40`,
                                                        color,
                                                    }}
                                                >
                                                    {pkgIcon ? (
                                                        <DynamicIcon name={pkgIcon} className="w-3 h-3" style={{ color }} />
                                                    ) : pkgColor ? (
                                                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                                                    ) : (
                                                        <Truck className="w-3 h-3" style={{ color }} />
                                                    )}
                                                    {pkgLabel}
                                                </span>
                                            );
                                        })()}
                                        <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-ink/15 bg-ant-ink/6 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ant-ink">
                                            <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                                            {order.source_name || '—'}
                                        </span>
                                        {order.replace && (
                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-rose/25 bg-ant-rose/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ant-rose">
                                                <RefreshCcw className="w-3 h-3" strokeWidth={1.75} />
                                                Échange
                                            </span>
                                        )}
                                        {orderParcel?.tracking_code && (
                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ant-ink">
                                                <Package className="w-3 h-3" strokeWidth={1.75} />
                                                {orderParcel.tracking_code}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="rounded-xl border border-ant-line bg-ant-ink px-4 py-3 min-w-[180px]">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">Valeur commande</p>
                                    <p className="font-display text-[22px] font-semibold text-white tabular-nums mt-1 leading-none">
                                        {order.price || 0}
                                        <span className="text-[11px] text-white/50 font-normal ml-1">MAD</span>
                                    </p>
                                </div>
                            </div>

                            <div className="overflow-y-auto ant-scroll p-5 space-y-4 flex-1">
                                {/* Customer Insights in Preview */}
                                <CustomerInsights phone={order.phone || ''} />

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {/* Logistics Info */}
                                    <div className="rounded-xl border border-ant-line bg-ant-paper p-4 space-y-3">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <Truck className="w-3 h-3" strokeWidth={1.75} />
                                            Détails de livraison
                                        </div>
                                        <div className="space-y-3">
                                            <div className="flex items-start gap-3">
                                                <MapPinned className="w-3.5 h-3.5 text-ant-mid shrink-0 mt-0.5" />
                                                <div className="space-y-0.5">
                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid leading-none">Destination</p>
                                                    <p className="text-[12px] font-semibold text-ant-ink leading-tight">{order.city?.name}</p>
                                                    <p className="text-[11px] text-ant-mid italic">"{order.address}"</p>
                                                </div>
                                            </div>
                                            <div className="flex items-start gap-3">
                                                <ShoppingCart className="w-3.5 h-3.5 text-ant-mid shrink-0 mt-0.5" />
                                                <div className="space-y-0.5">
                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid leading-none">Shipping Configuration</p>
                                                    <p className="text-[10px] font-semibold text-ant-green uppercase tracking-wider">{order.shipping_cost === 0 ? 'Free Shipping' : `Paid: ${order.shipping_cost} DH`}</p>
                                                </div>
                                            </div>
                                            {(order.courier || order.company) && (
                                                <div className="flex items-start gap-3">
                                                    {resolveProviderLogo(order.company) ? (
                                                        <div className="w-7 h-7 rounded-lg bg-ant-light border border-ant-line flex items-center justify-center shrink-0 overflow-hidden">
                                                            <img src={resolveProviderLogo(order.company)!} alt={order.company.name} className="w-full h-full object-contain" />
                                                        </div>
                                                    ) : order.courier ? (
                                                        <UserAvatar url={order.courier.avatar_url} config={(order.courier as any).avatar_config} name={order.courier.name} className="w-7 h-7 rounded-lg border border-ant-line text-[10px]" />
                                                    ) : (
                                                        <div className="w-7 h-7 rounded-lg bg-ant-light border border-ant-line flex items-center justify-center shrink-0 overflow-hidden">
                                                            <Building2 className="w-3.5 h-3.5 text-ant-mid" />
                                                        </div>
                                                    )}
                                                    <div className="space-y-0.5">
                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid leading-none">Assigned Provider</p>
                                                        <p className="text-[12px] font-semibold text-ant-ink leading-tight">
                                                            {order.courier?.name || order.company?.name}
                                                        </p>
                                                        <span className="text-[9px] font-semibold text-ant-mid uppercase tracking-wider">
                                                            {order.courier ? 'Independent Courier' : 'Delivery Company'}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            {String(order.coliaty_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-3">
                                                    <RefreshCcw className="w-3.5 h-3.5 text-ant-orange shrink-0 mt-0.5" />
                                                    <div className="space-y-0.5 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid leading-none">
                                                            Previous parcel tracking (Coliaty)
                                                        </p>
                                                        <p className="text-[11px] font-mono font-semibold text-ant-ink break-all">
                                                            {String(order.coliaty_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(order.ameex_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-3">
                                                    <RefreshCcw className="w-3.5 h-3.5 text-ant-orange shrink-0 mt-0.5" />
                                                    <div className="space-y-0.5 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid leading-none">
                                                            Previous parcel tracking (AMEEX)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(order.ameex_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(order.quicklivraison_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-3">
                                                    <RefreshCcw className="w-3.5 h-3.5 text-ant-orange shrink-0 mt-0.5" />
                                                    <div className="space-y-0.5 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid leading-none">
                                                            Previous parcel tracking (Quick Livraison)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(order.quicklivraison_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(order.forcelog_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-3">
                                                    <RefreshCcw className="w-3.5 h-3.5 text-ant-orange shrink-0 mt-0.5" />
                                                    <div className="space-y-0.5 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid leading-none">
                                                            Previous parcel tracking (Forcelog)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(order.forcelog_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(order.sendit_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-3">
                                                    <RefreshCcw className="w-3.5 h-3.5 text-ant-orange shrink-0 mt-0.5" />
                                                    <div className="space-y-0.5 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid leading-none">
                                                            Previous parcel tracking (Sendit)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(order.sendit_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(order.delvoexpress_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-3">
                                                    <RefreshCcw className="w-3.5 h-3.5 text-ant-orange shrink-0 mt-0.5" />
                                                    <div className="space-y-0.5 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid leading-none">
                                                            Previous parcel tracking (Delevo Express)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(order.delvoexpress_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Internal Notes */}
                                    <div className="rounded-xl border border-ant-line bg-ant-paper p-4 space-y-3">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <MessageSquare className="w-3 h-3" strokeWidth={1.75} />
                                            Notes &amp; instructions
                                        </div>
                                        <div className="space-y-2">
                                            <div className="p-3 rounded-xl bg-ant-light border border-ant-line space-y-1">
                                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Note interne</p>
                                                <p className="text-[12px] text-ant-ink leading-relaxed">{order.note || <span className="font-serif italic text-ant-mid">Aucune note interne.</span>}</p>
                                            </div>
                                            <div className="p-3 rounded-xl bg-ant-light border border-ant-line space-y-1">
                                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Note livraison publique</p>
                                                <p className="font-serif italic text-[12px] text-ant-ink leading-relaxed">« {order.delivery_note || 'Aucune consigne spéciale.'} »</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <Separator className="bg-ant-line" />

                                {/* Order Items Table */}
                                <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                    <div className="h-[3px] w-full bg-ant-green" />
                                    <div className="px-4 py-3 border-b border-ant-line flex items-center justify-between">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <Package className="w-3 h-3" strokeWidth={1.75} />
                                            Panier
                                        </div>
                                        <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-ink/15 bg-ant-ink/6 px-2 py-0.5 text-[10px] font-semibold text-ant-ink tabular-nums">
                                            <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                                            {order.items?.length || 0} référence(s)
                                        </span>
                                    </div>
                                    <div className="p-4 grid grid-cols-1 gap-3">
                                        {(() => {
                                            const displayItems: any[] = [];
                                            order.items?.forEach((item: any) => {
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
                                                        className="group p-3 rounded-xl border border-ant-line flex flex-col gap-3"
                                                    >
                                                        {/* Product Info */}
                                                        {item.product && (
                                                            <div className="flex flex-col md:flex-row justify-between items-center gap-3">
                                                                <div className="flex items-center gap-3 flex-1 w-full md:w-auto">
                                                                    <div className="w-10 h-10 rounded-lg bg-ant-light border border-ant-line flex items-center justify-center overflow-hidden shrink-0">
                                                                        {item.product?.image_url ? (
                                                                            <img src={item.product?.image_url} alt="" className="w-full h-full object-cover" />
                                                                        ) : (
                                                                            <Package className="w-4 h-4 text-ant-mid" />
                                                                        )}
                                                                    </div>
                                                                    <div>
                                                                        <h5 className="text-[12px] font-semibold text-ant-ink leading-none mb-0.5">{item.product?.name}</h5>
                                                                        <span className="text-[9px] font-semibold text-ant-mid tracking-wider bg-ant-line px-1.5 py-0.5 rounded">{item.product?.code}</span>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center justify-end w-full md:w-auto gap-5 text-right">
                                                                    <div>
                                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid mb-0.5">Unit Price</p>
                                                                        <p className="text-[12px] font-semibold text-ant-ink tabular-nums">{item.unit_price} DH</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid mb-0.5">Qty</p>
                                                                        <p className="text-[12px] font-semibold text-ant-ink tabular-nums">x{item.quantity}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid mb-0.5">Subtotal</p>
                                                                        <p className="text-[12px] font-semibold text-ant-ink tabular-nums">{prodTotal} DH</p>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Accessory Info List */}
                                                        {item.accessoriesList && item.accessoriesList.length > 0 && item.accessoriesList.map((accItem: any, idx: number) => (
                                                                <div key={accItem.id || idx} className="flex flex-col md:flex-row justify-between items-center gap-3 pt-2 border-t border-ant-line">
                                                                    <div className="flex items-center gap-3 flex-1 w-full md:w-auto">
                                                                        <div className="w-8 h-8 rounded-lg bg-ant-light border border-ant-line flex items-center justify-center overflow-hidden shrink-0 md:ml-3">
                                                                            {accItem.accessory?.image_url ? (
                                                                                <img src={accItem.accessory?.image_url} alt="" className="w-full h-full object-cover" />
                                                                            ) : (
                                                                                <Puzzle className="w-3.5 h-3.5 text-ant-mid" />
                                                                            )}
                                                                        </div>
                                                                        <div>
                                                                            <h5 className="text-[11px] font-semibold text-ant-ink/70 leading-none mb-0.5 flex items-center gap-1.5">
                                                                                <Puzzle className="w-2.5 h-2.5" /> {accItem.accessory?.name}
                                                                            </h5>
                                                                            <span className="text-[9px] font-semibold text-ant-mid tracking-wider bg-ant-line px-1.5 py-0.5 rounded">{accItem.accessory?.code}</span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center justify-end w-full md:w-auto text-right">
                                                                        <div>
                                                                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid mb-0.5">Qty</p>
                                                                            <p className="text-[11px] font-semibold text-ant-ink/80 tabular-nums">x{accItem.accessory_quantity}</p>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}

                                                        {item.product && (
                                                            <div className="pt-2 border-t border-ant-line flex justify-end">
                                                                <div className="bg-ant-green/10 text-ant-green px-3 py-1.5 rounded-lg flex items-center gap-3">
                                                                    <span className="text-[9px] font-bold uppercase tracking-[0.18em] opacity-60">Row Subtotal</span>
                                                                    <span className="text-[13px] font-semibold tabular-nums">{prodTotal} DH</span>
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
                                <div className="space-y-3 pb-3">
                                    <div className="flex items-center gap-2">
                                        <Truck className="w-3.5 h-3.5 text-ant-ink/30" />
                                        <h4 className="text-[11px] font-semibold text-ant-ink uppercase tracking-wider">Suivi du Colis</h4>
                                    </div>

                                    {isParcelLoading ? (
                                        <div className="flex items-center justify-center py-4">
                                            <Loader2 className="w-4 h-4 text-ant-ink animate-spin" />
                                        </div>
                                    ) : !orderParcel ? (
                                        <div className="text-center p-4 bg-ant-light rounded-xl border border-ant-line">
                                            <p className="text-[11px] text-ant-mid">Aucun colis créé pour cette commande.</p>
                                        </div>
                                    ) : (() => {
                                        // Master status (by id) first; embedded master row as fallback.
                                        const rPkg = resolveById(orderParcel.status_id);
                                        const embed = orderParcel.status as { label?: string | null; color?: string | null } | undefined;
                                        const pColor = rPkg?.color || embed?.color || '#94a3b8';
                                        const pIcon = rPkg?.icon || null;
                                        const pLabel = rPkg?.label || embed?.label || 'En attente';
                                        return (
                                        <div className="flex items-center justify-between p-4 bg-ant-ink/[0.02] rounded-2xl border border-ant-ink/[0.05]">
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-white" style={{ backgroundColor: pColor }}>
                                                    {pIcon ? <DynamicIcon name={pIcon} className="w-3.5 h-3.5" /> : <div className="w-2 h-2 rounded-full bg-white" />}
                                                </div>
                                                <div className="min-w-0">
                                                    <span className="text-[9px] font-bold uppercase tracking-[0.18em] px-1.5 py-0.5 rounded" style={{ color: pColor, backgroundColor: `${pColor}15` }}>
                                                        {pLabel}
                                                    </span>
                                                    {orderParcel.tracking_code && (
                                                        <p className="text-[10px] font-mono text-ant-mid truncate mt-0.5">{orderParcel.tracking_code}</p>
                                                    )}
                                                </div>
                                            </div>
                                            {orderParcel.tracking_code && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => { setParcelTrackingOrderId(order.id); setParcelTrackingOpen(true); }}
                                                    className="text-[11px] font-semibold text-ant-ink hover:bg-ant-light gap-1.5 rounded-md h-8 px-3 shrink-0"
                                                >
                                                    <Truck className="w-3 h-3" />
                                                    Suivre
                                                </Button>
                                            )}
                                        </div>
                                        );
                                    })()}
                                </div>

                                <Separator className="bg-ant-line" />

                                {/* Status History Timeline */}
                                <div className="space-y-3 pb-3">
                                    <div className="flex items-center gap-2">
                                        <ShieldCheck className="w-3.5 h-3.5 text-ant-ink/30" />
                                        <h4 className="text-[11px] font-semibold text-ant-ink uppercase tracking-wider">Status History</h4>
                                    </div>

                                    <div className="px-2">
                                        {(() => { const hist = (order.history && order.history.length > 0) ? order.history : orderHistory; return hist && hist.length > 0; })() ? (
                                            <div className="relative pl-8">
                                                <div className="absolute left-[11px] top-4 bottom-4 w-0.5 bg-ant-line" />
                                                <div className="space-y-0">
                                                {[...((order.history && order.history.length > 0) ? order.history : orderHistory)].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map((record: any, idx: number, arr: any[]) => {
                                                    const color = record.status?.color || '#94a3b8';
                                                    const isLast = idx === arr.length - 1;
                                                    const ordIcon = getOrdIcon(record.status_id);
                                                    const postponed = REPORTED_STATUS_ID && (statusCats.isOrderCategory(record.status_id, 'postponed') || record.status_id === REPORTED_STATUS_ID);
                                                    const reportedMatch = postponed && record.comment?.match(/\[Reporté pour: (.*?)\]/);
                                                    const reportedText = reportedMatch?.[1] || (postponed && order.reported_date ? format(new Date(order.reported_date), 'dd/MM/yyyy HH:mm') : null);
                                                    const cleanedComment = postponed ? (record.comment || '').replace(/\[Reporté pour:.*?\]/, '').trim() : record.comment || '';
                                                    return (
                                                        <div key={record.id} className="relative pb-4 last:pb-0 group">
                                                            <div className={`absolute -left-8 top-0 w-6 h-6 rounded-full border-2 border-white flex items-center justify-center z-10 ${isLast ? 'ring-1 ring-offset-1' : ''}`} style={{ backgroundColor: isLast ? color : '#f3f4f6', color: isLast ? '#ffffff' : color, ['--tw-ring-color' as any]: isLast ? `${color}40` : undefined }}>
                                                                {ordIcon ? <DynamicIcon name={ordIcon} className="w-2.5 h-2.5" /> : <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: isLast ? '#ffffff' : color }} />}
                                                            </div>
                                                            <div className="space-y-1">
                                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                                    <span className="text-[9px] font-bold uppercase tracking-[0.18em] px-1.5 py-0.5 rounded" style={{ color, backgroundColor: `${color}15` }}>{record.status?.label || 'Inconnu'}</span>
                                                                </div>
                                                                {record.created_at && <p className="text-[10px] text-ant-mid">{format(new Date(record.created_at), 'dd/MM/yyyy HH:mm')}</p>}
                                                                <div className="flex items-center gap-1.5">
                                                                    {record.user ? (
                                                                        <UserAvatar url={record.user.avatar_url} config={(record.user as any).avatar_config} name={record.user.name} className="w-4 h-4 rounded-full border bg-white text-[8px]" />
                                                                    ) : (
                                                                        <div className="w-4 h-4 rounded-full bg-ant-line flex items-center justify-center">
                                                                            <DynamicIcon name="TbRobot" className="w-2.5 h-2.5 text-ant-ink/60" />
                                                                        </div>
                                                                    )}
                                                                    <span className="text-[10px] font-semibold text-ant-ink/60 truncate max-w-[200px]">{record.user?.name || 'Système'}</span>
                                                                </div>
                                                                {postponed && reportedText && (
                                                                    <div className="flex flex-col gap-1 p-2.5 bg-ant-orange/10 rounded-lg border border-ant-orange/20">
                                                                        <div className="flex items-center gap-1.5"><Calendar className="w-2.5 h-2.5 text-ant-orange" /><span className="text-[9px] font-bold uppercase tracking-[0.18em] text-ant-orange">Rappel programmé</span></div>
                                                                        <p className="text-[10px] font-semibold text-ant-orange">{reportedText}</p>
                                                                        {cleanedComment && <p className="text-[10px] text-ant-orange italic mt-1 border-t border-amber-500/10 pt-1">"{cleanedComment}"</p>}
                                                                    </div>
                                                                )}
                                                                {!postponed && record.comment && <p className="text-[10px] text-ant-mid leading-relaxed italic">"{record.comment}"</p>}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-center p-4 bg-ant-light rounded-xl border border-ant-line">
                                                <p className="text-[11px] text-ant-mid">No tracking history available yet.</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <DialogFooter className="px-6 py-3 flex flex-row gap-2 bg-ant-paper border-t border-ant-line shrink-0">
                                <button
                                    type="button"
                                    onClick={() => onOpenChange(false)}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light text-[12px] font-semibold text-ant-ink cursor-pointer transition-colors"
                                >
                                    Fermer
                                </button>
                                {/* ownSellerId === undefined ⇒ no enforcement (seller Orders page).
                                    A PASSED value (chat host) enforces owner-match and FAILS CLOSED
                                    while the id is still resolving (null) — never show edit on a
                                    non-own / unknown-owner order. */}
                                {onEdit && (ownSellerId === undefined || (ownSellerId != null && order.seller_id === ownSellerId)) && (
                                    <button
                                        type="button"
                                        onClick={() => onEdit(order)}
                                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold cursor-pointer transition-colors"
                                    >
                                        <Edit2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                                        Modifier la commande
                                    </button>
                                )}
                            </DialogFooter>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            <ParcelTrackingDialog
                open={parcelTrackingOpen}
                onOpenChange={(o) => {
                    setParcelTrackingOpen(o);
                    if (!o) setParcelTrackingOrderId(null);
                }}
                orderId={parcelTrackingOrderId}
            />
        </>
    );
};

export default SellerOrderViewDialog;
