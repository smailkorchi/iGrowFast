import { useEffect, useState } from 'react';
import { format, isValid } from 'date-fns';
import { Loader2, Truck, SearchX, Hash, Phone, MapPin, CalendarClock, Info } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { matchPackageStatus } from '@/lib/matchPackageStatus';
import { trackParcelWithFallback } from '@/lib/orders/syncOrderTracking';
import { DynamicIcon } from '@/lib/renderReactIcon';

type ParcelTrackingDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    orderId: string | null;
};

type DataListItem = {
    title: string;
    value: string | number;
    open_url?: string;
};

type PkgStatus = {
    id: string;
    code: string;
    label: string;
    color: string | null;
    icon: string | null;
    delivery_service_statuses: string[] | null;
};

export function ParcelTrackingDialog({ open, onOpenChange, orderId }: ParcelTrackingDialogProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [trackingCode, setTrackingCode] = useState<string | null>(null);
    const [trackingHistory, setTrackingHistory] = useState<unknown>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Load all package_statuses for icon/color matching
    const { data: pkgStatuses } = useQuery({
        queryKey: ['package-statuses-icons'],
        queryFn: async () => {
            const { data } = await supabase
                .from('package_statuses')
                .select('id, code, label, color, icon, delivery_service_statuses')
                .eq('active', true)
                .eq('show_in_courier', true);
            return (data || []) as unknown as PkgStatus[];
        },
        staleTime: 5 * 60 * 1000,
    });

    useEffect(() => {
        if (!open || !orderId) {
            setTrackingCode(null);
            setTrackingHistory(null);
            setIsLoading(false);
            return;
        }

        let cancelled = false;

        const run = async () => {
            setIsLoading(true);
            setTrackingHistory(null);
            setTrackingCode(null);

            try {
                const { data: parcel, error } = await supabase
                    .from('company_parcels')
                    .select('id, tracking_code, external_id, provider_id, provider:providers(id, name, logo_url)')
                    .eq('order_id', orderId)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (cancelled) return;
                if (error) throw error;

                if (!parcel?.tracking_code || !String(parcel.tracking_code).trim() || !parcel.provider_id) {
                    const { data: courierParcel, error: courierErr } = await (supabase as any)
                        .from('courier_parcels')
                        .select('id, tracking_code, status_label, status_color, status_id, created_at, courier_id, courier:users!courier_parcels_courier_id_fkey(id, name, phone)')
                        .eq('order_id', orderId)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .maybeSingle();
                    if (cancelled) return;
                    if (courierErr) throw courierErr;

                    if (!courierParcel?.tracking_code || !String(courierParcel.tracking_code).trim()) {
                        toast({ title: 'Pas de suivi', description: 'Aucun colis avec code de suivi pour cette commande.', variant: 'destructive' });
                        onOpenChange(false);
                        return;
                    }

                    setTrackingCode(String(courierParcel.tracking_code).trim());
                    const courierName = courierParcel.courier?.name || 'Coursier';
                    const courierPhone = courierParcel.courier?.phone || '';
                    setTrackingHistory({
                        statusLabel: courierParcel.status_label || 'Nouveau',
                        statusColor: courierParcel.status_color || '#3b82f6',
                        history: [{
                            status: courierParcel.status_label || 'Nouveau',
                            statusLabel: courierParcel.status_label || 'Nouveau',
                            date: courierParcel.created_at || null,
                            comment: 'Colis créé en interne et confié à ' + courierName,
                            color: courierParcel.status_color || '#3b82f6',
                            user: courierName,
                            phone: courierPhone,
                        }],
                    });
                    queryClient.invalidateQueries({ queryKey: ['orders'] });
                    return;
                }

                setTrackingCode(String(parcel.tracking_code).trim());

                const data = await trackParcelWithFallback({
                    id: parcel.id,
                    provider_id: parcel.provider_id,
                    tracking_code: String(parcel.tracking_code).trim(),
                    external_id: parcel.external_id,
                });

                if (cancelled) return;
                setTrackingHistory(data);

                const providerStatus = (data.statusLabel || data.status || data.current_status) as string | undefined;
                const providerColor = (data.statusColor || data.color) as string | undefined;

                if (providerStatus) {
                    const matched = await matchPackageStatus(supabase, providerStatus);
                    await supabase
                        .from('company_parcels')
                        .update({
                            status_id: matched?.id ?? null,
                            status_label: matched?.label ?? providerStatus,
                            status_color: matched?.color ?? providerColor ?? null,
                        })
                        .eq('id', parcel.id);
                }
                queryClient.invalidateQueries({ queryKey: ['orders'] });
            } catch (e: unknown) {
                if (!cancelled) {
                    toast({ title: 'Tracking Error', description: e instanceof Error ? e.message : 'Échec du suivi', variant: 'destructive' });
                    onOpenChange(false);
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        run();
        return () => { cancelled = true; };
    }, [open, orderId]); // eslint-disable-line react-hooks/exhaustive-deps

    const statusMap: Record<string, string> = {
        NEW_PARCEL: 'Nouveau', WAITING_PICKUP: 'En attente de ramassage', DISTRIBUTION: 'En cours de distribution',
        DELIVERED: 'Livré', REFUSED: 'Refusé', REFUSE: 'Refusé', ANNULE: 'Annulé', CANCELLED: 'Annulé',
        RETURNED: 'Retourné', RETOUR: 'Retourné', POSTPONED: 'Reporté', WAITING_PREPARATION: 'En préparation',
        PICKED_UP: 'Ramassé', READY_FOR_PICKUP: 'Prêt pour ramassage', SENT: 'Expédié', RECEIVED: 'Reçu',
        SCHEDULED: 'Programmé', PROGRAMMER: 'Programmé', NO_ANSWER: 'Pas de réponse', RELAUNCH: 'Relancer',
    };

    const situationMap: Record<string, { label: string; className: string }> = {
        PAID: { label: 'Payé', className: 'bg-ant-green/10 text-ant-green border-ant-green/30' },
        NOT_PAID: { label: 'Non payé', className: 'bg-ant-orange/10 text-ant-orange border-ant-orange/30' },
        INVOICED: { label: 'Facturé', className: 'bg-ant-blue/10 text-ant-blue border-blue-200' },
    };

    /** Match an event's raw status string to a package_statuses row for icon/color */
    const matchPkgStatus = (rawStatus: string, statusLabel?: string): PkgStatus | null => {
        if (!pkgStatuses?.length) return null;
        const candidates = [statusLabel, rawStatus].filter(Boolean) as string[];
        for (const candidate of candidates) {
            const lower = candidate.toLowerCase();
            // Match by delivery_service_statuses array
            const byDss = pkgStatuses.find(ps =>
                ps.delivery_service_statuses?.some(dss => dss.toLowerCase() === lower)
            );
            if (byDss) return byDss;
            // Match by label
            const byLabel = pkgStatuses.find(ps => ps.label.toLowerCase() === lower);
            if (byLabel) return byLabel;
            // Match by code
            const byCode = pkgStatuses.find(ps => ps.code.toLowerCase() === lower);
            if (byCode) return byCode;
        }
        return null;
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[560px] rounded-[32px] border-none p-0 overflow-hidden bg-white">
                <DialogHeader className="p-8 pb-0">
                    <DialogTitle className="text-2xl font-black text-ant-ink flex items-center gap-3">
                        <div className="p-2 bg-ant-ink/5 rounded-xl">
                            <Truck className="w-5 h-5 text-ant-ink" />
                        </div>
                        Suivi du colis
                    </DialogTitle>
                    <DialogDescription className="font-bold text-ant-muted">
                        Code: <span className="text-ant-ink">{trackingCode || '—'}</span>
                    </DialogDescription>
                </DialogHeader>

                <div className="p-8 max-h-[65vh] overflow-y-auto">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-4">
                            <Loader2 className="w-10 h-10 text-ant-ink animate-spin" />
                            <p className="font-bold text-ant-muted animate-pulse">Récupération des données...</p>
                        </div>
                    ) : trackingHistory ? (
                        <div className="relative">
                            {(() => {
                                const th = trackingHistory as Record<string, unknown> | unknown[] | null;
                                let events: unknown[] = Array.isArray(th)
                                    ? th
                                    : Array.isArray((th as Record<string, unknown>)?.history)
                                      ? ((th as Record<string, unknown>).history as unknown[])
                                      : [];
                                if (events.length === 0 && th && !Array.isArray(th)) {
                                    const o = th as Record<string, unknown>;
                                    events = [{
                                        status: o.statusLabel || o.status || 'Nouveau',
                                        date: null,
                                        comment: '',
                                        statusLabel: o.statusLabel,
                                        color: o.statusColor || o.color,
                                    }];
                                }

                                // Reverse: oldest first (top) → newest last (bottom)
                                const sorted = [...events].reverse();

                                return (
                                    <div className="relative pl-10">
                                        {/* Vertical line */}
                                        <div className="absolute left-[15px] top-4 bottom-4 w-0.5 bg-gradient-to-b from-ant-line via-ant-line to-ant-ink/30" />

                                        <div className="space-y-0">
                                            {sorted.map((raw: unknown, idx: number) => {
                                                const event = raw as Record<string, unknown>;
                                                const rawStatus = (event.status as string) || 'Nouveau';
                                                const statusLabel = event.statusLabel as string | undefined;
                                                const status = statusLabel || statusMap[rawStatus] || rawStatus;
                                                const date = event.date as string | undefined;
                                                const comment = (event.comment as string) || '';
                                                const u = event.user;
                                                const user = (typeof u === 'object' && u !== null && 'name' in u ? (u as { name?: string }).name : (u as string | undefined)) || '';
                                                const phone = (event.phone as string) || '';
                                                const hub = (event.hub as string) || '';
                                                const city = (event.city as string) || '';
                                                const situation = (event.situation as string) || '';
                                                const scheduledDate = event.scheduledDate as string | undefined;
                                                const eventColor = (event.color as string) || '';
                                                const dataList = (event.data_list as DataListItem[]) || [];

                                                const location = [hub, city].filter(Boolean).join(' — ');
                                                const meaningfulDataList = dataList.filter(item => item?.title && item.title !== 'Nombre de distributions');
                                                const sitInfo = situation ? situationMap[situation] : null;

                                                // Match to DB status for icon + color
                                                const matched = matchPkgStatus(rawStatus, statusLabel);
                                                const color = matched?.color || eventColor || '#94a3b8';
                                                const iconName = matched?.icon;
                                                const isLast = idx === sorted.length - 1;

                                                return (
                                                    <div key={idx} className="relative pb-6 last:pb-0 group">
                                                        {/* Timeline circle with icon */}
                                                        <div
                                                            className={`absolute -left-10 top-0 w-8 h-8 rounded-full border-[3px] border-white shadow-sm flex items-center justify-center z-10 transition-all group-hover:scale-110 ${
                                                                isLast ? 'ring-2 ring-offset-2' : ''
                                                            }`}
                                                            style={{
                                                                backgroundColor: isLast ? color : '#f8fafc',
                                                                color: isLast ? '#ffffff' : color,
                                                                ['--tw-ring-color' as any]: isLast ? `${color}40` : undefined,
                                                            }}
                                                        >
                                                            {iconName ? (
                                                                <DynamicIcon name={iconName} className="w-3.5 h-3.5" />
                                                            ) : (
                                                                <div
                                                                    className="w-2 h-2 rounded-full"
                                                                    style={{ backgroundColor: isLast ? '#ffffff' : color }}
                                                                />
                                                            )}
                                                        </div>

                                                        {/* Content */}
                                                        <div className="space-y-1.5">
                                                            {/* Status pill */}
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span
                                                                    className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg"
                                                                    style={{ color, backgroundColor: `${color}15` }}
                                                                >
                                                                    {matched?.label || status}
                                                                </span>
                                                                {sitInfo && (
                                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border ${sitInfo.className}`}>
                                                                        {sitInfo.label}
                                                                    </span>
                                                                )}
                                                            </div>

                                                            {/* Date — guard against unparseable strings from provider audits */}
                                                            {(() => {
                                                                if (!date) return null;
                                                                const d = new Date(date);
                                                                if (!isValid(d)) return null;
                                                                return (
                                                                    <p className="text-[10px] font-bold text-ant-muted/50">
                                                                        {format(d, 'dd/MM/yyyy HH:mm')}
                                                                    </p>
                                                                );
                                                            })()}

                                                            {/* Comment */}
                                                            {comment && (
                                                                <p className="text-[11px] font-medium text-ant-muted leading-relaxed italic">
                                                                    &quot;{comment}&quot;
                                                                </p>
                                                            )}

                                                            {/* Location */}
                                                            {location && (
                                                                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-ant-muted/70">
                                                                    <MapPin className="w-3 h-3 shrink-0" />
                                                                    <span>{location}</span>
                                                                </div>
                                                            )}

                                                            {/* Courier info */}
                                                            {(user || phone) && (
                                                                <div className="flex items-center gap-3 flex-wrap">
                                                                    {user && (
                                                                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-ant-muted">
                                                                            <div className="w-4 h-4 rounded-full bg-slate-100 flex items-center justify-center">
                                                                                <Hash className="w-2 h-2" />
                                                                            </div>
                                                                            Par {user}
                                                                        </div>
                                                                    )}
                                                                    {phone && (
                                                                        <a href={`tel:${phone}`} className="flex items-center gap-1 text-[10px] font-bold text-ant-ink/70 hover:text-ant-ink transition-colors">
                                                                            <Phone className="w-3 h-3" />
                                                                            {phone}
                                                                        </a>
                                                                    )}
                                                                </div>
                                                            )}

                                                            {/* Scheduled date */}
                                                            {(() => {
                                                                if (!scheduledDate) return null;
                                                                const d = new Date(scheduledDate);
                                                                if (!isValid(d)) return null;
                                                                return (
                                                                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-ant-blue/70">
                                                                        <CalendarClock className="w-3 h-3 shrink-0" />
                                                                        <span>Programmé: {format(d, 'dd/MM/yyyy')}</span>
                                                                    </div>
                                                                );
                                                            })()}

                                                            {/* Data list items */}
                                                            {meaningfulDataList.length > 0 && (
                                                                <div className="mt-1 space-y-0.5">
                                                                    {meaningfulDataList.map((item, i) => {
                                                                        const isPhone = /^0[5-8]\d{8}$/.test(String(item.value));
                                                                        const isDate = /^\d{4}-\d{2}-\d{2}$/.test(String(item.value));
                                                                        return (
                                                                            <div key={i} className="flex items-center gap-1.5 text-[10px] font-medium text-ant-muted/80">
                                                                                <Info className="w-2.5 h-2.5 shrink-0 opacity-50" />
                                                                                <span className="font-semibold">{item.title}:</span>
                                                                                {isPhone ? (
                                                                                    <a href={`tel:${item.value}`} className="text-ant-ink/70 hover:text-ant-ink font-bold transition-colors">{item.value}</a>
                                                                                ) : isDate ? (
                                                                                    <span className="text-ant-blue/70 font-semibold">{item.value}</span>
                                                                                ) : (
                                                                                    <span className="font-semibold">{item.value}</span>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                            <div className="p-4 bg-slate-50 rounded-full">
                                <SearchX className="w-8 h-8 text-ant-muted/40" />
                            </div>
                            <p className="font-bold text-ant-muted">Aucun historique disponible pour ce colis.</p>
                        </div>
                    )}
                </div>

                <div className="p-8 pt-0">
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        className="w-full h-14 rounded-2xl font-black text-sm tracking-widest uppercase text-ant-ink hover:bg-slate-100 hover:text-ant-ink"
                    >
                        Fermer
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
