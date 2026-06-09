import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Trash2,
    RotateCcw,
    Loader2,
    Phone,
    Search,
    AlertTriangle,
    Inbox,
    Timer,
    CircleDollarSign,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

type TrashedOrder = {
    id: string;
    name: string | null;
    phone: string | null;
    price: number | null;
    date_deleted: string | null;
    status: {
        label: string | null;
        color: string | null;
        icon: string | null;
    } | null;
    deleted_by: {
        id: string;
        name: string | null;
        email: string | null;
        avatar_url: string | null;
    } | null;
};

const Trash = () => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const [search, setSearch] = useState('');
    const [pendingPermanentDelete, setPendingPermanentDelete] = useState<{ id: string; name: string } | null>(null);

    const { data: trashedOrders = [], isLoading } = useQuery({
        queryKey: ['trashed-orders', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('orders')
                .select('id, name, phone, price, date_deleted, status:order_statuses(label, color, icon), deleted_by:users!orders_deleted_by_id_fkey(id, name, email, avatar_url)')
                .eq('DigiCom Business', activeBusinessId)
                .not('date_deleted', 'is', null)
                .order('date_deleted', { ascending: false });
            if (error) throw error;
            return data as TrashedOrder[];
        },
        enabled: !!activeBusinessId,
    });

    const restoreMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await (supabase as any)
                .from('orders')
                .update({ date_deleted: null, deleted_by_id: null })
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['trashed-orders', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['orders', activeBusinessId] });
            toast({ title: 'Commande restaurée', description: 'La commande est revenue dans le flux actif.' });
        },
        onError: (error: any) => {
            toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
        },
    });

    const permanentDeleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error: fkError } = await (supabase as any)
                .from('company_payment_note_orders')
                .delete()
                .eq('order_id', id);
            if (fkError) throw fkError;

            const { error } = await (supabase as any)
                .from('orders')
                .delete()
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['trashed-orders', activeBusinessId] });
            setPendingPermanentDelete(null);
            toast({ title: 'Suppression définitive', description: 'La commande a été effacée pour de bon.' });
        },
        onError: (error: any) => {
            toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
        },
    });

    const getDaysRemaining = (dateDeleted: string | null) => {
        if (!dateDeleted) return 0;
        const deleted = new Date(dateDeleted);
        const now = new Date();
        const diffMs = now.getTime() - deleted.getTime();
        const daysPassed = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        return Math.max(0, 14 - daysPassed);
    };

    const getDaysTone = (days: number) => {
        if (days > 7) return { bg: 'bg-ant-green/10', border: 'border-ant-green/25', text: 'text-ant-green', dot: 'bg-ant-green' };
        if (days > 3) return { bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', text: 'text-ant-orange', dot: 'bg-ant-orange' };
        return { bg: 'bg-ant-rose/10', border: 'border-ant-rose/25', text: 'text-ant-rose', dot: 'bg-ant-rose' };
    };

    const filteredOrders = trashedOrders.filter((order) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
            order.name?.toLowerCase().includes(q) ||
            order.phone?.toLowerCase().includes(q)
        );
    });

    const expiringSoonCount = trashedOrders.filter(o => getDaysRemaining(o.date_deleted) <= 3).length;
    const totalValue = trashedOrders.reduce((sum, o) => sum + (o.price || 0), 0);

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="space-y-2">
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                        Archives · Corbeille
                    </div>
                    <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                        Trash
                    </h1>
                    <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                        Quatorze jours de sursis avant effacement définitif. Restaurez ce qui doit revivre, videz ce qui n&apos;a plus lieu d&apos;être.
                    </p>
                </header>

                {/* KPI strip */}
                <section className="grid grid-cols-1 md:grid-cols-3 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                    <div className="bg-ant-paper p-4">
                        <div className="flex items-start justify-between gap-2">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                                Commandes en corbeille
                            </div>
                            <div className="h-8 w-8 rounded-lg border bg-ant-ink/6 border-ant-ink/15 text-ant-ink flex items-center justify-center">
                                <Inbox className="w-4 h-4" strokeWidth={1.75} />
                            </div>
                        </div>
                        <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2">
                            {trashedOrders.length}
                            <span className="text-[12px] text-ant-mid font-normal ml-1.5">entrées</span>
                        </p>
                    </div>
                    <div className="bg-ant-paper p-4">
                        <div className="flex items-start justify-between gap-2">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                <span className={`h-1.5 w-1.5 rounded-full ${expiringSoonCount > 0 ? 'bg-ant-rose' : 'bg-ant-mid'}`} />
                                Expirent bientôt
                            </div>
                            <div className={`h-8 w-8 rounded-lg border flex items-center justify-center ${expiringSoonCount > 0 ? 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' : 'bg-ant-light border-ant-line text-ant-mid'}`}>
                                <Timer className="w-4 h-4" strokeWidth={1.75} />
                            </div>
                        </div>
                        <p className={`font-display text-[22px] font-semibold tabular-nums mt-2 ${expiringSoonCount > 0 ? 'text-ant-rose' : 'text-ant-ink'}`}>
                            {expiringSoonCount}
                            <span className="text-[12px] text-ant-mid font-normal ml-1.5">≤ 3 jours</span>
                        </p>
                    </div>
                    <div className="bg-ant-paper p-4">
                        <div className="flex items-start justify-between gap-2">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                                Valeur cumulée
                            </div>
                            <div className="h-8 w-8 rounded-lg border bg-ant-green/10 border-ant-green/25 text-ant-green flex items-center justify-center">
                                <CircleDollarSign className="w-4 h-4" strokeWidth={1.75} />
                            </div>
                        </div>
                        <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                            {totalValue.toLocaleString()}
                            <span className="text-[12px] text-ant-mid font-normal ml-1.5">MAD</span>
                        </p>
                    </div>
                </section>

                {/* Filter bar */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                        <span className="font-display text-ant-orange font-semibold">01</span>
                        Commandes supprimées
                        {filteredOrders.length !== trashedOrders.length && (
                            <span className="font-serif italic tracking-normal normal-case text-[11px] text-ant-mid">
                                · {filteredOrders.length} sur {trashedOrders.length}
                            </span>
                        )}
                    </div>
                    <div className="relative w-full md:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                        <Input
                            placeholder="Rechercher par nom ou téléphone…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-9 h-9 rounded-full border-ant-line bg-ant-paper text-[12px] focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                        />
                    </div>
                </div>

                {/* List */}
                {isLoading ? (
                    <section className="rounded-2xl border border-ant-line bg-ant-paper p-12 flex flex-col items-center justify-center gap-3 text-center">
                        <Loader2 className="w-8 h-8 animate-spin text-ant-mid" strokeWidth={1.5} />
                        <p className="font-serif italic text-[12px] text-ant-mid">Chargement des archives…</p>
                    </section>
                ) : filteredOrders.length === 0 ? (
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="p-12 flex flex-col items-center justify-center gap-3 text-center">
                            <div className="h-12 w-12 rounded-xl border border-ant-line bg-ant-light flex items-center justify-center">
                                <Trash2 className="w-5 h-5 text-ant-mid" strokeWidth={1.5} />
                            </div>
                            <div className="space-y-1">
                                <h3 className="font-display text-[16px] font-semibold text-ant-ink">
                                    {search ? 'Aucune correspondance' : 'Corbeille vide'}
                                </h3>
                                <p className="font-serif italic text-[12px] text-ant-mid max-w-sm">
                                    {search
                                        ? 'Affinez votre recherche ou effacez le filtre.'
                                        : 'Les commandes supprimées atterrissent ici pendant quatorze jours avant effacement automatique.'}
                                </p>
                            </div>
                        </div>
                    </section>
                ) : (
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-rose" />
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-ant-line bg-ant-light">
                                        <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Client</th>
                                        <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Téléphone</th>
                                        <th className="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Prix</th>
                                        <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Statut</th>
                                        <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Supprimé le</th>
                                        <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Supprimé par</th>
                                        <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Sursis</th>
                                        <th className="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredOrders.map((order) => {
                                        const daysLeft = getDaysRemaining(order.date_deleted);
                                        const tone = getDaysTone(daysLeft);
                                        const statusColor = order.status?.color;
                                        return (
                                            <tr key={order.id} className="border-b border-ant-line last:border-0 hover:bg-ant-light/50 transition-colors">
                                                <td className="px-5 py-3">
                                                    <span className="font-display text-[13px] font-semibold text-ant-ink">
                                                        {order.name || <span className="font-serif italic text-ant-mid font-normal">Anonyme</span>}
                                                    </span>
                                                </td>
                                                <td className="px-5 py-3">
                                                    <span className="inline-flex items-center gap-1.5 font-display text-[12px] font-medium tabular-nums text-ant-ink">
                                                        <Phone className="w-3 h-3 text-ant-mid" strokeWidth={1.75} />
                                                        {order.phone || '—'}
                                                    </span>
                                                </td>
                                                <td className="px-5 py-3 text-right">
                                                    <span className="font-display text-[13px] font-semibold tabular-nums text-ant-ink">
                                                        {order.price != null ? order.price.toLocaleString() : '—'}
                                                        {order.price != null && <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>}
                                                    </span>
                                                </td>
                                                <td className="px-5 py-3">
                                                    {order.status?.label ? (
                                                        <span
                                                            className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                                                            style={{
                                                                backgroundColor: statusColor ? `${statusColor}15` : undefined,
                                                                borderColor: statusColor ? `${statusColor}40` : undefined,
                                                                color: statusColor || undefined,
                                                            }}
                                                        >
                                                            <span
                                                                className="h-1.5 w-1.5 rounded-full"
                                                                style={{ backgroundColor: statusColor || '#6B6760' }}
                                                            />
                                                            {order.status.label}
                                                        </span>
                                                    ) : (
                                                        <span className="font-serif italic text-[11px] text-ant-mid">—</span>
                                                    )}
                                                </td>
                                                <td className="px-5 py-3 font-serif italic text-[11px] text-ant-mid tabular-nums">
                                                    {order.date_deleted
                                                        ? new Date(order.date_deleted).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
                                                        : '—'}
                                                </td>
                                                <td className="px-5 py-3">
                                                    {order.deleted_by ? (
                                                        <div className="inline-flex items-center gap-2 min-w-0">
                                                            <Avatar className="h-7 w-7 rounded-full border border-ant-line shrink-0">
                                                                <AvatarImage src={order.deleted_by.avatar_url || ''} className="object-cover" />
                                                                <AvatarFallback className="rounded-full text-[10px] bg-ant-ink/5 text-ant-ink font-display font-semibold">
                                                                    {(order.deleted_by.name || order.deleted_by.email || '?').substring(0, 2).toUpperCase()}
                                                                </AvatarFallback>
                                                            </Avatar>
                                                            <span className="font-display text-[12px] font-semibold text-ant-ink truncate max-w-[140px]" title={order.deleted_by.email || undefined}>
                                                                {order.deleted_by.name || order.deleted_by.email || '—'}
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <span className="font-serif italic text-[11px] text-ant-mid">—</span>
                                                    )}
                                                </td>
                                                <td className="px-5 py-3">
                                                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums ${tone.bg} ${tone.border} ${tone.text}`}>
                                                        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                                                        {daysLeft} j restants
                                                    </span>
                                                </td>
                                                <td className="px-5 py-3">
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        <button
                                                            type="button"
                                                            onClick={() => restoreMutation.mutate(order.id)}
                                                            disabled={restoreMutation.isPending}
                                                            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-ant-green/25 bg-ant-green/10 hover:bg-ant-green/15 text-ant-green text-[11px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                                        >
                                                            {restoreMutation.isPending ? (
                                                                <Loader2 className="w-3 h-3 animate-spin" strokeWidth={1.75} />
                                                            ) : (
                                                                <RotateCcw className="w-3 h-3" strokeWidth={1.75} />
                                                            )}
                                                            Restaurer
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setPendingPermanentDelete({ id: order.id, name: order.name || 'Anonyme' })}
                                                            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-ant-line bg-ant-paper hover:bg-ant-rose/10 hover:border-ant-rose/25 text-ant-rose text-[11px] font-semibold cursor-pointer transition-colors"
                                                        >
                                                            <Trash2 className="w-3 h-3" strokeWidth={1.75} />
                                                            Effacer
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </section>
                )}

                {/* Permanent Delete Confirmation */}
                <AlertDialog open={!!pendingPermanentDelete} onOpenChange={(open) => { if (!open) setPendingPermanentDelete(null); }}>
                    <AlertDialogContent className="rounded-2xl border border-ant-line bg-ant-paper">
                        <AlertDialogHeader>
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                                Effacement définitif
                            </div>
                            <AlertDialogTitle className="font-display text-[18px] font-semibold text-ant-ink flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5 text-ant-rose" strokeWidth={1.75} />
                                Effacer définitivement ?
                            </AlertDialogTitle>
                            <AlertDialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                {pendingPermanentDelete
                                    ? `La commande de « ${pendingPermanentDelete.name} » sera effacée pour de bon. L'action est irréversible.`
                                    : null}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel className="h-9 rounded-full border-ant-line bg-ant-paper hover:bg-ant-light text-[12px] font-semibold text-ant-ink">
                                Annuler
                            </AlertDialogCancel>
                            <button
                                type="button"
                                disabled={permanentDeleteMutation.isPending}
                                onClick={() => {
                                    if (pendingPermanentDelete) permanentDeleteMutation.mutate(pendingPermanentDelete.id);
                                }}
                                className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-full bg-ant-rose hover:bg-ant-rose/90 disabled:opacity-60 text-white text-[12px] font-semibold cursor-pointer transition-colors"
                            >
                                {permanentDeleteMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.75} />}
                                Effacer définitivement
                            </button>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </div>
    );
};

export default Trash;
