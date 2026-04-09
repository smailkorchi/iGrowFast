import { format } from 'date-fns';
import { Package, Calendar, SearchX } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';

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
    /**
     * Optional category resolver for tagging postponed records the same way the
     * preview modal does. Defaults to checking the embedded status.category.
     */
    isOrderInCategory?: (statusId: string | null | undefined, category: string) => boolean;
};

export function OrderStatusHistoryDialog({
    open,
    onOpenChange,
    order,
    isOrderInCategory,
}: OrderStatusHistoryDialogProps) {
    const records = (order?.history || []).slice().sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
    });

    const isPostponed = (record: HistoryRecord): boolean => {
        if (isOrderInCategory) return isOrderInCategory(record.status_id, 'postponed');
        return (record.status?.category || '').toLowerCase() === 'postponed';
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[560px] rounded-[32px] border-none p-0 overflow-hidden bg-white">
                <DialogHeader className="p-8 pb-0">
                    <DialogTitle className="text-2xl font-black text-brand-navy flex items-center gap-3">
                        <div className="p-2 bg-brand-navy/5 rounded-xl">
                            <Package className="w-5 h-5 text-brand-navy" />
                        </div>
                        Historique des Statuts
                    </DialogTitle>
                    <DialogDescription className="font-bold text-muted-foreground">
                        {order?.name ? <>Commande de <span className="text-brand-navy">{order.name}</span></> : 'Commande sélectionnée'}
                    </DialogDescription>
                </DialogHeader>

                <div className="p-8 max-h-[65vh] overflow-y-auto">
                    {records.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                            <div className="p-4 bg-slate-50 rounded-full">
                                <SearchX className="w-8 h-8 text-muted-foreground/40" />
                            </div>
                            <p className="font-bold text-muted-foreground">Aucun historique disponible pour cette commande.</p>
                        </div>
                    ) : (
                        <div className="space-y-6 relative before:absolute before:left-[17px] before:top-2 before:bottom-2 before:w-0.5 before:bg-brand-navy/5">
                            {records.map((record, idx) => {
                                const color = record.status?.color || '#94a3b8';
                                const label = record.status?.label || 'Inconnu';
                                const postponed = isPostponed(record);
                                const reportedMatch = postponed && record.comment?.match(/\[Reporté pour: (.*?)\]/);
                                const reportedText = reportedMatch?.[1] || (postponed ? format(new Date(order?.reported_date || record.created_at || Date.now()), 'dd/MM/yyyy HH:mm') : null);
                                const cleanedComment = postponed
                                    ? (record.comment || '').replace(/\[Reporté pour:.*?\]/, '').trim()
                                    : record.comment || '';

                                return (
                                    <div key={record.id} className="relative pl-12 group">
                                        {/* Timeline dot */}
                                        <div
                                            className="absolute left-0 top-1 w-9 h-9 rounded-full border-4 border-white shadow-sm flex items-center justify-center transition-all group-hover:scale-110 z-10"
                                            style={{ backgroundColor: idx === 0 ? color : '#f1f5f9' }}
                                        >
                                            <div
                                                className="w-2 h-2 rounded-full"
                                                style={{ backgroundColor: idx === 0 ? '#ffffff' : color }}
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            {/* Status + date row */}
                                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                                <span
                                                    className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md"
                                                    style={{ color, backgroundColor: `${color}15` }}
                                                >
                                                    {label}
                                                </span>
                                                <span className="text-[10px] font-bold text-muted-foreground opacity-60 shrink-0">
                                                    {record.created_at ? format(new Date(record.created_at), 'dd/MM/yyyy HH:mm') : ''}
                                                </span>
                                            </div>

                                            {/* Author */}
                                            <div className="flex items-center gap-2">
                                                <Avatar className="w-5 h-5 border bg-white">
                                                    <AvatarImage src={record.user?.avatar_url || undefined} />
                                                    <AvatarFallback className="text-[9px] font-bold bg-brand-navy/5 text-brand-navy">
                                                        {record.user?.name?.[0] || '?'}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <span className="text-[11px] font-bold text-brand-navy/70 truncate max-w-[200px]">
                                                    {record.user?.name || 'Système'}
                                                </span>
                                            </div>

                                            {/* Comment / postponed schedule */}
                                            {postponed && reportedText && (
                                                <div className="flex flex-col gap-1 p-3 bg-amber-50 rounded-xl border border-amber-100">
                                                    <div className="flex items-center gap-2">
                                                        <Calendar className="w-3 h-3 text-amber-600" />
                                                        <span className="text-[10px] font-black uppercase text-amber-700">Rappel programmé</span>
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
                                                <p className="text-[11px] font-medium text-muted-foreground leading-relaxed italic">
                                                    "{record.comment}"
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
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
