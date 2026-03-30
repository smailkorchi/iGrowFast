import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, Truck, SearchX, Hash } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
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

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provider-integration`;

type ParcelTrackingDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    orderId: string | null;
};

async function trackParcelWithFallback(parcel: {
    id: string;
    provider_id: string;
    tracking_code: string;
    external_id?: string | null;
}): Promise<Record<string, unknown>> {
    const { data: { session } } = await supabase.auth.getSession();
    let response = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
            action: 'track_parcel',
            provider_id: parcel.provider_id,
            data: {
                tracking_code: parcel.tracking_code,
                external_id: parcel.external_id,
            },
        }),
    });

    const isError = !response.ok;
    let result = isError ? null : await response.json();

    if (isError || !result?.success) {
        response = await fetch(EDGE_FUNCTION_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({
                action: 'get_parcel_info',
                provider_id: parcel.provider_id,
                data: {
                    tracking_code: parcel.tracking_code,
                },
            }),
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({ error: 'Failed to fetch tracking data' }));
            throw new Error(errData.error || `Error ${response.status}`);
        }

        result = await response.json();

        if (result.success && result.data && !result.data.history && !Array.isArray(result.data)) {
            result.data.history = [
                {
                    status: result.data.status,
                    statusLabel: result.data.statusLabel || result.data.status,
                    date: result.data.date || new Date().toISOString(),
                    comment: result.data.comment || 'Statut actuel (historique indisponible)',
                    user: 'Synchronisation Coliaty/Provider',
                },
            ];
        }
    }

    if (result && result.success) {
        return result.data as Record<string, unknown>;
    }
    throw new Error(result?.error || 'Unknown error');
}

export function ParcelTrackingDialog({ open, onOpenChange, orderId }: ParcelTrackingDialogProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [trackingCode, setTrackingCode] = useState<string | null>(null);
    const [trackingHistory, setTrackingHistory] = useState<unknown>(null);
    const [isLoading, setIsLoading] = useState(false);

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

                if (!parcel?.tracking_code || !String(parcel.tracking_code).trim()) {
                    toast({
                        title: 'Pas de suivi',
                        description: 'Aucun colis avec code de suivi pour cette commande.',
                        variant: 'destructive',
                    });
                    onOpenChange(false);
                    return;
                }

                if (!parcel.provider_id) {
                    toast({
                        title: 'Suivi indisponible',
                        description: 'Prestataire de livraison manquant pour ce colis.',
                        variant: 'destructive',
                    });
                    onOpenChange(false);
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
                    const { data: matchedStatus } = await supabase
                        .from('package_statuses')
                        .select('id, label')
                        .ilike('label', providerStatus)
                        .maybeSingle();

                    await supabase
                        .from('company_parcels')
                        .update({
                            status_id: matchedStatus?.id || null,
                            status_label: providerStatus,
                            status_color: providerColor ?? null,
                        })
                        .eq('id', parcel.id);
                }

                queryClient.invalidateQueries({ queryKey: ['orders'] });
            } catch (e: unknown) {
                if (!cancelled) {
                    toast({
                        title: 'Tracking Error',
                        description: e instanceof Error ? e.message : 'Échec du suivi',
                        variant: 'destructive',
                    });
                    onOpenChange(false);
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        run();
        return () => {
            cancelled = true;
        };
    }, [open, orderId]); // eslint-disable-line react-hooks/exhaustive-deps -- toast/queryClient/onOpenChange

    const statusMap: Record<string, string> = {
        NEW_PARCEL: 'Nouveau',
        WAITING_PICKUP: 'En attente de ramassage',
        DISTRIBUTION: 'En cours de distribution',
        DELIVERED: 'Livré',
        REFUSED: 'Refusé',
        REFUSE: 'Refusé',
        ANNULE: 'Annulé',
        CANCELLED: 'Annulé',
        RETURNED: 'Retourné',
        RETOUR: 'Retourné',
        POSTPONED: 'Reporté',
        WAITING_PREPARATION: 'En préparation',
        PICKED_UP: 'Ramassé',
        READY_FOR_PICKUP: 'Prêt pour ramassage',
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px] rounded-[32px] border-none p-0 overflow-hidden bg-white">
                <DialogHeader className="p-8 pb-0">
                    <DialogTitle className="text-2xl font-black text-brand-navy flex items-center gap-3">
                        <div className="p-2 bg-brand-navy/5 rounded-xl">
                            <Truck className="w-5 h-5 text-brand-navy" />
                        </div>
                        Suivi du colis
                    </DialogTitle>
                    <DialogDescription className="font-bold text-muted-foreground">
                        Code:{' '}
                        <span className="text-brand-navy">{trackingCode || '—'}</span>
                    </DialogDescription>
                </DialogHeader>

                <div className="p-8 max-h-[60vh] overflow-y-auto">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-4">
                            <Loader2 className="w-10 h-10 text-brand-navy animate-spin" />
                            <p className="font-bold text-muted-foreground animate-pulse">Récupération des données...</p>
                        </div>
                    ) : trackingHistory ? (
                        <div className="space-y-8 relative before:absolute before:left-[17px] before:top-2 before:bottom-2 before:w-0.5 before:bg-brand-navy/5">
                            {(() => {
                                const th = trackingHistory as Record<string, unknown> | unknown[] | null;
                                const events: unknown[] = Array.isArray(th)
                                    ? th
                                    : Array.isArray((th as Record<string, unknown>)?.history)
                                      ? ((th as Record<string, unknown>).history as unknown[])
                                      : [];
                                if (events.length === 0 && th && !Array.isArray(th)) {
                                    const o = th as Record<string, unknown>;
                                    return [
                                        {
                                            status: o.statusLabel || o.status || 'Nouveau',
                                            date: null,
                                            comment: 'Aucun historique détaillé disponible',
                                            statusLabel: o.statusLabel,
                                        },
                                    ];
                                }
                                return events;
                            })().map((raw: unknown, idx: number) => {
                                const event = raw as Record<string, unknown>;
                                const rawStatus = (event.status as string) || 'Nouveau';
                                const statusLabel = event.statusLabel as string | undefined;
                                const status = statusLabel || statusMap[rawStatus] || rawStatus;
                                const date = event.date as string | undefined;
                                const comment = (event.comment as string) || '';
                                const u = event.user;
                                const user =
                                    (typeof u === 'object' && u !== null && 'name' in u
                                        ? (u as { name?: string }).name
                                        : (u as string | undefined)) || '';

                                return (
                                    <div key={idx} className="relative pl-12 group">
                                        <div
                                            className={`absolute left-0 top-1 w-9 h-9 rounded-full border-4 border-white shadow-sm flex items-center justify-center transition-all group-hover:scale-110 z-10 ${
                                                idx === 0
                                                    ? 'bg-brand-navy text-white shadow-brand-navy/20'
                                                    : 'bg-slate-50 text-brand-navy/40'
                                            }`}
                                        >
                                            <div className="w-2 h-2 rounded-full bg-current" />
                                        </div>
                                        <div className="space-y-1">
                                            <div className="flex items-center justify-between">
                                                <span
                                                    className={`text-sm font-black tracking-tight ${
                                                        idx === 0 ? 'text-brand-navy' : 'text-muted-foreground'
                                                    }`}
                                                >
                                                    {status}
                                                </span>
                                                <span className="text-[10px] font-bold text-muted-foreground opacity-60">
                                                    {date ? format(new Date(date), 'dd/MM/yyyy HH:mm') : ''}
                                                </span>
                                            </div>
                                            {comment && (
                                                <p className="text-[11px] font-medium text-muted-foreground leading-relaxed italic">
                                                    &quot;{comment}&quot;
                                                </p>
                                            )}
                                            {user && (
                                                <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground">
                                                    <div className="w-4 h-4 rounded-full bg-slate-100 flex items-center justify-center">
                                                        <Hash className="w-2 h-2" />
                                                    </div>
                                                    Par {user}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                            <div className="p-4 bg-slate-50 rounded-full">
                                <SearchX className="w-8 h-8 text-muted-foreground/40" />
                            </div>
                            <p className="font-bold text-muted-foreground">Aucun historique disponible pour ce colis.</p>
                        </div>
                    )}
                </div>

                <div className="p-8 pt-0">
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        className="w-full h-14 rounded-2xl font-black text-sm tracking-widest uppercase hover:bg-slate-50"
                    >
                        Fermer
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
