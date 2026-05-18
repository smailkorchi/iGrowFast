import { format } from 'date-fns';
import { Package, Calendar, SearchX } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { DynamicIcon } from '@/lib/renderReactIcon';

type HistoryRecord = {
    id: string;
    created_at: string | null;
    comment: string | null;
    status_id: string | null;
    status?: { id: string; label: string | null; color: string | null; category?: string | null } | null;
    user?: { name: string | null; avatar_url: string | null } | null;
};

type OrderShape = {
    id: string;
    name?: string | null;
    reported_date?: string | null;
    history?: HistoryRecord[] | null;
};

type OrderStatusHistoryDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    order: OrderShape | null;
    isOrderInCategory?: (statusId: string | null | undefined, category: string) => boolean;
};

type OrdStatus = { id: string; icon: string | null };

export function OrderStatusHistoryDialog({
    open,
    onOpenChange,
    order,
    isOrderInCategory,
}: OrderStatusHistoryDialogProps) {
    // Lazy-fetch history when the dialog opens. The Orders pages now hand us
    // rows sourced from the lightweight aggregate (no embedded history join),
    // so we always pull it ourselves to stay correct regardless of caller.
    const { data: fetchedHistory = [] } = useQuery<HistoryRecord[]>({
        queryKey: ['order-history', order?.id],
        queryFn: async () => {
            if (!order?.id) return [];
            const { data, error } = await (supabase as any)
                .from('order_status_history')
                .select('*, user:users!changed_by(name, avatar_url), status:order_statuses!status_id(*)')
                .eq('order_id', order.id)
                .order('created_at', { ascending: true });
            if (error) throw error;
            return (data || []) as HistoryRecord[];
        },
        enabled: !!order?.id && open,
        staleTime: 30 * 1000,
    });

    // Prefer history already embedded on the order (legacy caller); fall back
    // to the lazy-fetched rows when absent or empty.
    const sourceRecords: HistoryRecord[] = (order?.history && order.history.length > 0)
        ? order.history
        : fetchedHistory;

    // Oldest first (top) → newest last (bottom)
    const records = sourceRecords.slice().sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return ta - tb;
    });

    // Load order_statuses for icon lookup
    const { data: ordStatuses } = useQuery({
        queryKey: ['order-statuses-icons'],
        queryFn: async () => {
            const { data } = await supabase
                .from('order_statuses')
                .select('id, icon')
                .eq('active', true);
            return (data || []) as unknown as OrdStatus[];
        },
        staleTime: 5 * 60 * 1000,
    });

    const getIcon = (statusId: string | null): string | null => {
        if (!statusId || !ordStatuses?.length) return null;
        return ordStatuses.find(s => s.id === statusId)?.icon || null;
    };

    const isPostponed = (record: HistoryRecord): boolean => {
        if (isOrderInCategory) return isOrderInCategory(record.status_id, 'postponed');
        return (record.status?.category || '').toLowerCase() === 'postponed';
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[560px] rounded-[32px] border-none p-0 overflow-hidden bg-white">
                <DialogHeader className="p-8 pb-0">
                    <DialogTitle className="text-2xl font-black text-ant-ink flex items-center gap-3">
                        <div className="p-2 bg-ant-ink/5 rounded-xl">
                            <Package className="w-5 h-5 text-ant-ink" />
                        </div>
                        Historique des Statuts
                    </DialogTitle>
                    <DialogDescription className="font-bold text-ant-muted">
                        {order?.name ? <>Commande de <span className="text-ant-ink">{order.name}</span></> : 'Commande sélectionnée'}
                    </DialogDescription>
                </DialogHeader>

                <div className="p-8 max-h-[65vh] overflow-y-auto">
                    {records.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                            <div className="p-4 bg-slate-50 rounded-full">
                                <SearchX className="w-8 h-8 text-ant-muted/40" />
                            </div>
                            <p className="font-bold text-ant-muted">Aucun historique disponible pour cette commande.</p>
                        </div>
                    ) : (
                        <div className="relative pl-10">
                            {/* Vertical line */}
                            <div className="absolute left-[15px] top-4 bottom-4 w-0.5 bg-gradient-to-b from-ant-line via-ant-line to-ant-ink/30" />

                            <div className="space-y-0">
                                {records.map((record, idx) => {
                                    const color = record.status?.color || '#94a3b8';
                                    const label = record.status?.label || 'Inconnu';
                                    const postponed = isPostponed(record);
                                    const reportedMatch = postponed && record.comment?.match(/\[Reporté pour: (.*?)\]/);
                                    const reportedText = reportedMatch?.[1] || (postponed ? format(new Date(order?.reported_date || record.created_at || Date.now()), 'dd/MM/yyyy HH:mm') : null);
                                    const cleanedComment = postponed
                                        ? (record.comment || '').replace(/\[Reporté pour:.*?\]/, '').trim()
                                        : record.comment || '';
                                    const iconName = getIcon(record.status_id);
                                    const isLast = idx === records.length - 1;

                                    return (
                                        <div key={record.id} className="relative pb-6 last:pb-0 group">
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

                                            <div className="space-y-1.5">
                                                {/* Status pill */}
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span
                                                        className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg"
                                                        style={{ color, backgroundColor: `${color}15` }}
                                                    >
                                                        {label}
                                                    </span>
                                                </div>

                                                {/* Date */}
                                                {record.created_at && (
                                                    <p className="text-[10px] font-bold text-ant-muted/50">
                                                        {format(new Date(record.created_at), 'dd/MM/yyyy HH:mm')}
                                                    </p>
                                                )}

                                                {/* Author */}
                                                <div className="flex items-center gap-2">
                                                    {record.user ? (
                                                        <Avatar className="w-5 h-5 border bg-white">
                                                            <AvatarImage src={record.user.avatar_url || undefined} />
                                                            <AvatarFallback className="text-[9px] font-bold bg-ant-ink/5 text-ant-ink">
                                                                {record.user.name?.[0] || '?'}
                                                            </AvatarFallback>
                                                        </Avatar>
                                                    ) : (
                                                        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-ant-ink/10 to-ant-ink/20 flex items-center justify-center">
                                                            <DynamicIcon name="TbRobot" className="w-3 h-3 text-ant-ink/60" />
                                                        </div>
                                                    )}
                                                    <span className="text-[11px] font-bold text-ant-ink/70 truncate max-w-[200px]">
                                                        {record.user?.name || 'Système'}
                                                    </span>
                                                </div>

                                                {/* Postponed schedule */}
                                                {postponed && reportedText && (
                                                    <div className="flex flex-col gap-1 p-3 bg-ant-orange/10 rounded-xl border border-ant-orange/25">
                                                        <div className="flex items-center gap-2">
                                                            <Calendar className="w-3 h-3 text-ant-orange" />
                                                            <span className="text-[10px] font-black uppercase text-ant-orange">Rappel programmé</span>
                                                        </div>
                                                        <p className="text-xs font-bold text-amber-900">{reportedText}</p>
                                                        {cleanedComment && (
                                                            <p className="text-[11px] font-medium text-amber-800 italic mt-1 border-t border-amber-500/10 pt-1">
                                                                "{cleanedComment}"
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                                {!postponed && record.comment && (
                                                    <p className="text-[11px] font-medium text-ant-muted leading-relaxed italic">
                                                        "{record.comment}"
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
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
