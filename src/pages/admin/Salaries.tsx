import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { format, startOfMonth, subMonths, eachMonthOfInterval } from 'date-fns';
import {
    Plus,
    Search,
    Loader2,
    Sparkles,
    Info,
    Check,
    ChevronLeft,
    ChevronRight,
    Wallet,
    Coins,
    CalendarDays,
    Layers,
    Headphones,
    Target,
    DollarSign,
    History,
    type LucideIcon,
} from 'lucide-react';
import { RecordPaymentDialog, PaymentHistoryDialog } from '@/components/salaries/PayoutPaymentDialogs';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useSellerEarnings, type SellerEarnings } from '@/hooks/useSellerEarnings';
import { useMediaBuyerEarnings, type MediaBuyerEarnings } from '@/hooks/useMediaBuyerEarnings';
import { fmtCur, fmtCurFull, fmtNum } from '@/lib/formatNumbers';

type Role = 'seller' | 'mediabuyer';

const KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

const PayoutKpi: React.FC<{
    label: string;
    value: string;
    suffix?: string;
    accent: keyof typeof KPI_ACCENTS;
    icon: LucideIcon;
}> = ({ label, value, suffix, accent, icon: Icon }) => {
    const a = KPI_ACCENTS[accent];
    return (
        <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                    <span className={cn('h-1.5 w-1.5 rounded-full', a.dot)} />
                    {label}
                </div>
                <div className={cn('h-8 w-8 rounded-lg border flex items-center justify-center', a.tile)}>
                    <Icon className="w-4 h-4" strokeWidth={1.75} />
                </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                {value}
                {suffix ? <span className="text-[12px] text-ant-mid font-normal ml-1.5">{suffix}</span> : null}
            </p>
        </div>
    );
};

// ═════════════════════════ Main Page ═════════════════════════
const Salaries = () => {
    const [tab, setTab] = useState<Role>('seller');
    const [bulkOpen, setBulkOpen] = useState(false);

    return (
        <div className="ant-surface min-h-screen">
            <div className="mx-auto max-w-[1440px] px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Finance · Payroll
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Salaries
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            The monthly ritual — commission accrued, deliveries counted, bank details snapshotted. Generate payouts, mark them paid, keep the ledger honest.
                        </p>
                    </div>
                    <Button
                        onClick={() => setBulkOpen(true)}
                        className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 shrink-0 cursor-pointer"
                    >
                        <Sparkles className="w-4 h-4" />
                        Generate payouts
                    </Button>
                </header>

                {/* Role tabs */}
                <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper">
                    {([
                        { key: 'seller' as Role, label: 'Sellers', icon: Headphones },
                        { key: 'mediabuyer' as Role, label: 'Media buyers', icon: Target },
                    ]).map((t) => {
                        const active = tab === t.key;
                        const Icon = t.icon;
                        return (
                            <button
                                key={t.key}
                                onClick={() => setTab(t.key)}
                                className={cn(
                                    'inline-flex items-center gap-2 rounded-full px-4 h-8 text-[12px] font-semibold transition cursor-pointer whitespace-nowrap',
                                    active ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink'
                                )}
                            >
                                <Icon className="w-3.5 h-3.5" />
                                {t.label}
                            </button>
                        );
                    })}
                </div>

                {tab === 'seller' ? <SellerPayoutsList /> : <MediaBuyerPayoutsList />}

                <BulkGenerateDialog open={bulkOpen} onOpenChange={setBulkOpen} initialRole={tab} />
            </div>
        </div>
    );
};

// ═════════════════════════ Seller Payouts List ═════════════════════════
type SellerPayout = {
    id: string;
    seller_id: string;
    payout_month: string;
    salary_earned: number | string;
    commission_earned: number | string;
    total_amount: number | string;
    paid_amount: number | string;
    days_present: number;
    delivered_orders: number;
    bank_snapshot: any;
    status: 'pending' | 'partial' | 'paid';
    created_at: string;
    paid_at: string | null;
    seller: { name: string; email: string; avatar_url: string | null } | null;
};

type PayoutStatus = 'pending' | 'partial' | 'paid';

const SellerPayoutsList: React.FC = () => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | PayoutStatus>('all');
    const [selected, setSelected] = useState<string[]>([]);
    const [page, setPage] = useState(1);
    const PER_PAGE = 10;
    // Partial-payment dialogs — the "Record payment" composer + the history list.
    const [recordOpen, setRecordOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [activeRow, setActiveRow] = useState<SellerPayout | null>(null);

    const { data: payouts = [], isLoading } = useQuery<SellerPayout[]>({
        queryKey: ['seller-payouts', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('seller_payments')
                .select('*, seller:users!seller_payments_seller_id_fkey(name, email, avatar_url)')
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });
            if (error) {
                const { data: d2 } = await (supabase as any)
                    .from('seller_payments')
                    .select('*, seller:users(name, email, avatar_url)')
                    .eq('DigiCom Business', activeBusinessId)
                    .order('created_at', { ascending: false });
                return (d2 || []) as SellerPayout[];
            }
            return (data || []) as SellerPayout[];
        },
        enabled: !!activeBusinessId,
    });

    // "Settle in full" — for each non-fully-paid row, insert one txn covering
    // the remaining balance. The trigger flips status to 'paid' automatically.
    // Replaces the old direct `status` toggle so all paid amounts are auditable.
    const settleMutation = useMutation({
        mutationFn: async (ids: string[]) => {
            const rows = payouts.filter((p) => ids.includes(p.id));
            const { data: { user } } = await supabase.auth.getUser();
            const inserts = rows
                .map((p) => {
                    const remaining = Math.max(0, Number(p.total_amount || 0) - Number(p.paid_amount || 0));
                    return { p, remaining };
                })
                .filter(({ remaining }) => remaining > 0)
                .map(({ p, remaining }) => ({
                    seller_payment_id: p.id,
                    amount: remaining,
                    paid_at: new Date().toISOString(),
                    note: 'Settled in full from Salaries bulk action',
                    created_by: user?.id || null,
                    'DigiCom Business': activeBusinessId,
                }));
            if (!inserts.length) return { inserted: 0 };
            const { error } = await (supabase as any).from('seller_payment_txns').insert(inserts);
            if (error) throw error;
            return { inserted: inserts.length };
        },
        onSuccess: (res) => {
            queryClient.invalidateQueries({ queryKey: ['seller-payouts'] });
            queryClient.invalidateQueries({ queryKey: ['seller-payment-txns'] });
            toast({ title: 'Settled', description: `${res.inserted} payout(s) marked as fully paid.` });
            setSelected([]);
        },
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
    });

    // Reverse-all on a payout: deletes every txn. Trigger drops paid_amount=0
    // and status='pending' automatically.
    const reverseAllMutation = useMutation({
        mutationFn: async (payoutId: string) => {
            const { error } = await (supabase as any)
                .from('seller_payment_txns')
                .delete()
                .eq('seller_payment_id', payoutId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['seller-payouts'] });
            queryClient.invalidateQueries({ queryKey: ['seller-payment-txns'] });
            toast({ title: 'Reversed', description: 'All payments on this payout have been reversed.' });
        },
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
    });

    const filtered = useMemo(() => {
        let out = payouts;
        if (statusFilter !== 'all') out = out.filter((p) => p.status === statusFilter);
        const q = search.toLowerCase().trim();
        if (q) out = out.filter((p) => (p.seller?.name || '').toLowerCase().includes(q) || (p.seller?.email || '').toLowerCase().includes(q));
        return out;
    }, [payouts, statusFilter, search]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

    // Stats now aggregate `paid_amount` directly (trigger-maintained running sum)
    // and use `(total_amount − paid_amount)` for the open balance. This survives
    // partials: a row halfway settled contributes its portion to both buckets.
    const stats = useMemo(() => {
        let totalPaid = 0;
        let totalPending = 0;
        let thisMonth = 0;
        const startOfThisMonth = startOfMonth(new Date());
        for (const p of payouts) {
            const total = Number(p.total_amount || 0);
            const paid = Number(p.paid_amount || 0);
            totalPaid += paid;
            totalPending += Math.max(0, total - paid);
            if (new Date(p.created_at) >= startOfThisMonth) thisMonth += 1;
        }
        return { totalPaid, totalPending, thisMonth };
    }, [payouts]);

    const counts = {
        all: payouts.length,
        pending: payouts.filter((p) => p.status === 'pending').length,
        partial: payouts.filter((p) => p.status === 'partial').length,
        paid: payouts.filter((p) => p.status === 'paid').length,
    };

    return (
        <div className="space-y-5">
            {/* KPI strip */}
            <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                <PayoutKpi label="Total paid" value={fmtCur(stats.totalPaid)} suffix="MAD" accent="green" icon={Wallet} />
                <PayoutKpi label="Total pending" value={fmtCur(stats.totalPending)} suffix="MAD" accent="orange" icon={Coins} />
                <PayoutKpi label="This month" value={String(stats.thisMonth)} suffix="payouts" accent="ink" icon={CalendarDays} />
                <PayoutKpi label="Payouts total" value={String(payouts.length)} suffix="records" accent="ink" icon={Layers} />
            </section>

            {/* Toolbar */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper">
                    {([
                        { key: 'all', label: 'All' },
                        { key: 'pending', label: 'Pending' },
                        { key: 'partial', label: 'Partial' },
                        { key: 'paid', label: 'Paid' },
                    ] as const).map((t) => {
                        const active = statusFilter === t.key;
                        return (
                            <button
                                key={t.key}
                                onClick={() => setStatusFilter(t.key)}
                                className={cn(
                                    'inline-flex items-center gap-2 rounded-full px-3.5 h-8 text-[12px] font-semibold transition cursor-pointer whitespace-nowrap',
                                    active ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink'
                                )}
                            >
                                {t.label}
                                <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums', active ? 'bg-white/20 text-white' : 'bg-ant-light text-ant-mid')}>
                                    {counts[t.key]}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className="flex items-center gap-2">
                    <div className="relative w-full md:w-[280px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                        <Input
                            placeholder="Search seller..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-9 h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                        />
                    </div>
                    {selected.length > 0 && (
                        <Button
                            onClick={() => settleMutation.mutate(selected)}
                            disabled={settleMutation.isPending}
                            className="h-10 px-5 rounded-full bg-ant-green hover:bg-ant-green/90 text-white text-[12px] font-semibold gap-2 cursor-pointer"
                        >
                            {settleMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            Settle {selected.length} in full
                        </Button>
                    )}
                </div>
            </div>

            {/* Table */}
            {isLoading ? (
                <div className="space-y-2">
                    {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-14 rounded-2xl bg-ant-light animate-pulse" />)}
                </div>
            ) : paginated.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                    <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                        <Wallet className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                    </div>
                    <h3 className="font-display text-[18px] text-ant-ink tracking-tight">
                        {payouts.length ? 'No payouts match those filters' : 'No payouts yet'}
                    </h3>
                    <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                        {payouts.length
                            ? 'Loosen the filters to bring payouts back into view.'
                            : 'Click "Generate payouts" above to create this month\u2019s batch.'}
                    </p>
                </div>
            ) : (
                <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-ant-line">
                                    <th className="pl-5 pr-2 py-4 w-10">
                                        <Checkbox
                                            checked={paginated.length > 0 && paginated.every((p) => selected.includes(p.id))}
                                            onCheckedChange={(v) => {
                                                if (v) setSelected(Array.from(new Set([...selected, ...paginated.map((p) => p.id)])));
                                                else setSelected(selected.filter((id) => !paginated.some((p) => p.id === id)));
                                            }}
                                            className="border-ant-line data-[state=checked]:bg-ant-ink data-[state=checked]:border-ant-ink"
                                        />
                                    </th>
                                    <th className="px-3 py-4 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Seller</th>
                                    <th className="px-3 py-4 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Month</th>
                                    <th className="px-3 py-4 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Delivered</th>
                                    <th className="px-3 py-4 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Days</th>
                                    <th className="px-3 py-4 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Total</th>
                                    <th className="px-3 py-4 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Paid</th>
                                    <th className="px-3 py-4 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Status</th>
                                    <th className="pl-3 pr-5 py-4 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginated.map((p) => {
                                    const totalAmount = Number(p.total_amount || 0);
                                    const paidAmount = Number(p.paid_amount || 0);
                                    const pct = totalAmount > 0 ? Math.min(100, (paidAmount / totalAmount) * 100) : 0;
                                    const isPaid = p.status === 'paid';
                                    const isPartial = p.status === 'partial';
                                    const statusMeta = isPaid
                                        ? { bg: 'bg-ant-green/10', text: 'text-ant-green', dot: 'bg-ant-green' }
                                        : isPartial
                                          ? { bg: 'bg-ant-blue/10', text: 'text-ant-blue', dot: 'bg-ant-blue' }
                                          : { bg: 'bg-ant-orange/10', text: 'text-ant-orange', dot: 'bg-ant-orange' };
                                    return (
                                        <tr key={p.id} className="group hover:bg-ant-light/40 transition-colors border-t border-ant-line/60 tabular-nums">
                                            <td className="pl-5 pr-2 py-4">
                                                <Checkbox
                                                    checked={selected.includes(p.id)}
                                                    onCheckedChange={(v) => setSelected(v ? [...selected, p.id] : selected.filter((id) => id !== p.id))}
                                                    className="border-ant-line data-[state=checked]:bg-ant-ink data-[state=checked]:border-ant-ink"
                                                />
                                            </td>
                                            <td className="px-3 py-4">
                                                <div className="flex items-center gap-3">
                                                    <Avatar className="h-9 w-9 shrink-0 rounded-lg border border-ant-line">
                                                        <AvatarImage src={p.seller?.avatar_url || ''} className="object-cover" />
                                                        <AvatarFallback className="rounded-lg text-[11px] bg-ant-ink/5 text-ant-ink font-display font-semibold">
                                                            {(p.seller?.name || '??').substring(0, 2).toUpperCase()}
                                                        </AvatarFallback>
                                                    </Avatar>
                                                    <div className="min-w-0">
                                                        <p className="font-display text-[13px] font-semibold text-ant-ink leading-tight truncate">{p.seller?.name || '—'}</p>
                                                        <p className="text-[11px] text-ant-mid/80 leading-tight truncate mt-0.5">{p.seller?.email}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-4 text-[12px] text-ant-mid whitespace-nowrap">{format(new Date(p.payout_month), 'MMM yyyy')}</td>
                                            <td className="px-3 py-4 text-right text-[13px] font-semibold text-ant-green tabular-nums">{fmtNum(p.delivered_orders)}</td>
                                            <td className="px-3 py-4 text-right text-[12px] text-ant-mid tabular-nums">{fmtNum(p.days_present)}</td>
                                            <td className="px-3 py-4 text-right text-[13px] font-semibold text-ant-ink tabular-nums" title={fmtCurFull(totalAmount)}>
                                                {fmtCur(totalAmount)} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                            </td>
                                            <td className="px-3 py-4 text-right" title={`${fmtCurFull(paidAmount)} paid of ${fmtCurFull(totalAmount)}`}>
                                                <div className="flex flex-col items-end gap-1.5">
                                                    <span className={cn('text-[13px] font-semibold tabular-nums leading-none', paidAmount > 0 ? 'text-ant-green' : 'text-ant-mid/60')}>
                                                        {fmtCur(paidAmount)} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                                    </span>
                                                    {isPartial && (
                                                        <div className="h-1 w-24 rounded-full bg-ant-line/60 overflow-hidden">
                                                            <div className="h-full rounded-full bg-ant-blue transition-all" style={{ width: `${pct}%` }} />
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-3 py-4">
                                                <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize', statusMeta.bg, statusMeta.text)}>
                                                    <span className={cn('h-1.5 w-1.5 rounded-full', statusMeta.dot)} />
                                                    {p.status}
                                                </span>
                                            </td>
                                            <td className="pl-3 pr-5 py-4 text-right">
                                                <div className="inline-flex items-center gap-1.5">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => { setActiveRow(p); setHistoryOpen(true); }}
                                                        className="h-8 w-8 rounded-full p-0 text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                                                        title="Payment history"
                                                    >
                                                        <History className="w-3.5 h-3.5" />
                                                    </Button>
                                                    {isPaid ? (
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => {
                                                                if (window.confirm('Reverse all payments on this payout?')) {
                                                                    reverseAllMutation.mutate(p.id);
                                                                }
                                                            }}
                                                            className="h-8 rounded-full px-3 text-[11px] font-semibold text-ant-mid hover:text-ant-orange hover:bg-ant-orange/10 cursor-pointer"
                                                        >
                                                            Reverse
                                                        </Button>
                                                    ) : (
                                                        <Button
                                                            size="sm"
                                                            onClick={() => { setActiveRow(p); setRecordOpen(true); }}
                                                            className={cn(
                                                                'h-8 rounded-full px-3 text-[11px] font-semibold cursor-pointer text-white',
                                                                isPartial ? 'bg-ant-blue hover:bg-ant-blue/90' : 'bg-ant-ink hover:bg-ant-ink/90'
                                                            )}
                                                        >
                                                            {isPartial ? 'Continue' : 'Record'}
                                                        </Button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-9 w-9 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light cursor-pointer">
                        <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    <span className="text-[12px] font-semibold text-ant-ink px-3 tabular-nums">
                        {page} <span className="text-ant-mid">/ {totalPages}</span>
                    </span>
                    <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="h-9 w-9 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light cursor-pointer">
                        <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                </div>
            )}

            {activeRow && (
                <>
                    <RecordPaymentDialog
                        open={recordOpen}
                        onOpenChange={setRecordOpen}
                        kind="seller"
                        payoutId={activeRow.id}
                        totalAmount={Number(activeRow.total_amount || 0)}
                        paidAmount={Number(activeRow.paid_amount || 0)}
                        collaboratorName={activeRow.seller?.name || 'Seller'}
                        businessId={activeBusinessId}
                    />
                    <PaymentHistoryDialog
                        open={historyOpen}
                        onOpenChange={setHistoryOpen}
                        kind="seller"
                        payoutId={activeRow.id}
                        totalAmount={Number(activeRow.total_amount || 0)}
                        paidAmount={Number(activeRow.paid_amount || 0)}
                        collaboratorName={activeRow.seller?.name || 'Seller'}
                        businessId={activeBusinessId}
                        onAddPayment={() => { setHistoryOpen(false); setRecordOpen(true); }}
                    />
                </>
            )}
        </div>
    );
};

// ═════════════════════════ Media Buyer Payouts List ═════════════════════════
type MBPayout = {
    id: string;
    mediabuyer_id: string;
    payout_month: string;
    payment_type: 'commission' | 'salary';
    salary_earned: number | string;
    commission_earned: number | string;
    total_amount: number | string;
    paid_amount: number | string;
    delivered_orders: number;
    total_spend: number | string;
    campaigns_count: number;
    bank_snapshot: any;
    status: PayoutStatus;
    created_at: string;
    paid_at: string | null;
    mediabuyer: { name: string; email: string; avatar_url: string | null } | null;
};

const MediaBuyerPayoutsList: React.FC = () => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | PayoutStatus>('all');
    const [selected, setSelected] = useState<string[]>([]);
    const [page, setPage] = useState(1);
    const PER_PAGE = 10;
    const [recordOpen, setRecordOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [activeRow, setActiveRow] = useState<MBPayout | null>(null);

    const { data: payouts = [], isLoading } = useQuery<MBPayout[]>({
        queryKey: ['mb-payouts', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('mediabuyer_payments')
                .select('*, mediabuyer:users!mediabuyer_payments_mediabuyer_id_fkey(name, email, avatar_url)')
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });
            if (error) {
                const { data: d2 } = await (supabase as any)
                    .from('mediabuyer_payments')
                    .select('*, mediabuyer:users(name, email, avatar_url)')
                    .eq('DigiCom Business', activeBusinessId)
                    .order('created_at', { ascending: false });
                return (d2 || []) as MBPayout[];
            }
            return (data || []) as MBPayout[];
        },
        enabled: !!activeBusinessId,
    });

    // Same partial-aware bulk action as seller list: insert a txn covering
    // the remaining balance for each selected non-paid row.
    const settleMutation = useMutation({
        mutationFn: async (ids: string[]) => {
            const rows = payouts.filter((p) => ids.includes(p.id));
            const { data: { user } } = await supabase.auth.getUser();
            const inserts = rows
                .map((p) => {
                    const remaining = Math.max(0, Number(p.total_amount || 0) - Number(p.paid_amount || 0));
                    return { p, remaining };
                })
                .filter(({ remaining }) => remaining > 0)
                .map(({ p, remaining }) => ({
                    mediabuyer_payment_id: p.id,
                    amount: remaining,
                    paid_at: new Date().toISOString(),
                    note: 'Settled in full from Salaries bulk action',
                    created_by: user?.id || null,
                    'DigiCom Business': activeBusinessId,
                }));
            if (!inserts.length) return { inserted: 0 };
            const { error } = await (supabase as any).from('mediabuyer_payment_txns').insert(inserts);
            if (error) throw error;
            return { inserted: inserts.length };
        },
        onSuccess: (res) => {
            queryClient.invalidateQueries({ queryKey: ['mb-payouts'] });
            queryClient.invalidateQueries({ queryKey: ['mediabuyer-payment-txns'] });
            toast({ title: 'Settled', description: `${res.inserted} payout(s) marked as fully paid.` });
            setSelected([]);
        },
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
    });

    const reverseAllMutation = useMutation({
        mutationFn: async (payoutId: string) => {
            const { error } = await (supabase as any)
                .from('mediabuyer_payment_txns')
                .delete()
                .eq('mediabuyer_payment_id', payoutId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['mb-payouts'] });
            queryClient.invalidateQueries({ queryKey: ['mediabuyer-payment-txns'] });
            toast({ title: 'Reversed', description: 'All payments on this payout have been reversed.' });
        },
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
    });

    const filtered = useMemo(() => {
        let out = payouts;
        if (statusFilter !== 'all') out = out.filter((p) => p.status === statusFilter);
        const q = search.toLowerCase().trim();
        if (q) out = out.filter((p) => (p.mediabuyer?.name || '').toLowerCase().includes(q) || (p.mediabuyer?.email || '').toLowerCase().includes(q));
        return out;
    }, [payouts, statusFilter, search]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

    // Partial-aware totals — same shape as seller list.
    const stats = useMemo(() => {
        let totalPaid = 0;
        let totalPending = 0;
        let thisMonth = 0;
        const thisMonthKey = format(new Date(), 'yyyy-MM');
        for (const p of payouts) {
            const total = Number(p.total_amount || 0);
            const paid = Number(p.paid_amount || 0);
            totalPaid += paid;
            totalPending += Math.max(0, total - paid);
            if (p.payout_month === thisMonthKey) thisMonth += 1;
        }
        return { totalPaid, totalPending, thisMonth };
    }, [payouts]);

    const counts = {
        all: payouts.length,
        pending: payouts.filter((p) => p.status === 'pending').length,
        partial: payouts.filter((p) => p.status === 'partial').length,
        paid: payouts.filter((p) => p.status === 'paid').length,
    };

    return (
        <div className="space-y-5">
            {/* KPI strip */}
            <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                <PayoutKpi label="Total paid" value={fmtCur(stats.totalPaid)} suffix="MAD" accent="green" icon={Wallet} />
                <PayoutKpi label="Total pending" value={fmtCur(stats.totalPending)} suffix="MAD" accent="orange" icon={Coins} />
                <PayoutKpi label="This month" value={String(stats.thisMonth)} suffix="payouts" accent="ink" icon={CalendarDays} />
                <PayoutKpi label="Payouts total" value={String(payouts.length)} suffix="records" accent="ink" icon={Layers} />
            </section>

            {/* Toolbar */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper">
                    {([
                        { key: 'all', label: 'All' },
                        { key: 'pending', label: 'Pending' },
                        { key: 'partial', label: 'Partial' },
                        { key: 'paid', label: 'Paid' },
                    ] as const).map((t) => {
                        const active = statusFilter === t.key;
                        return (
                            <button
                                key={t.key}
                                onClick={() => setStatusFilter(t.key)}
                                className={cn(
                                    'inline-flex items-center gap-2 rounded-full px-3.5 h-8 text-[12px] font-semibold transition cursor-pointer whitespace-nowrap',
                                    active ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink'
                                )}
                            >
                                {t.label}
                                <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums', active ? 'bg-white/20 text-white' : 'bg-ant-light text-ant-mid')}>
                                    {counts[t.key]}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className="flex items-center gap-2">
                    <div className="relative w-full md:w-[280px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                        <Input
                            placeholder="Search media buyer..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-9 h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                        />
                    </div>
                    {selected.length > 0 && (
                        <Button
                            onClick={() => settleMutation.mutate(selected)}
                            disabled={settleMutation.isPending}
                            className="h-10 px-5 rounded-full bg-ant-green hover:bg-ant-green/90 text-white text-[12px] font-semibold gap-2 cursor-pointer"
                        >
                            {settleMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            Settle {selected.length} in full
                        </Button>
                    )}
                </div>
            </div>

            {/* Table */}
            {isLoading ? (
                <div className="space-y-2">
                    {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-14 rounded-2xl bg-ant-light animate-pulse" />)}
                </div>
            ) : paginated.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                    <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                        <Wallet className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                    </div>
                    <h3 className="font-display text-[18px] text-ant-ink tracking-tight">
                        {payouts.length ? 'No payouts match those filters' : 'No payouts yet'}
                    </h3>
                    <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                        {payouts.length
                            ? 'Loosen the filters to bring payouts back into view.'
                            : 'Click "Generate payouts" above to create this month\u2019s batch.'}
                    </p>
                </div>
            ) : (
                <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-ant-line">
                                    <th className="pl-5 pr-2 py-4 w-10">
                                        <Checkbox
                                            checked={paginated.length > 0 && paginated.every((p) => selected.includes(p.id))}
                                            onCheckedChange={(v) => {
                                                if (v) setSelected(Array.from(new Set([...selected, ...paginated.map((p) => p.id)])));
                                                else setSelected(selected.filter((id) => !paginated.some((p) => p.id === id)));
                                            }}
                                            className="border-ant-line data-[state=checked]:bg-ant-ink data-[state=checked]:border-ant-ink"
                                        />
                                    </th>
                                    <th className="px-3 py-4 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Media buyer</th>
                                    <th className="px-3 py-4 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Month</th>
                                    <th className="px-3 py-4 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Type</th>
                                    <th className="px-3 py-4 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Delivered</th>
                                    <th className="px-3 py-4 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Spend</th>
                                    <th className="px-3 py-4 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Total</th>
                                    <th className="px-3 py-4 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Paid</th>
                                    <th className="px-3 py-4 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Status</th>
                                    <th className="pl-3 pr-5 py-4 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginated.map((p) => {
                                    const totalAmount = Number(p.total_amount || 0);
                                    const paidAmount = Number(p.paid_amount || 0);
                                    const pct = totalAmount > 0 ? Math.min(100, (paidAmount / totalAmount) * 100) : 0;
                                    const isPaid = p.status === 'paid';
                                    const isPartial = p.status === 'partial';
                                    const isCommission = p.payment_type === 'commission';
                                    const statusMeta = isPaid
                                        ? { bg: 'bg-ant-green/10', text: 'text-ant-green', dot: 'bg-ant-green' }
                                        : isPartial
                                          ? { bg: 'bg-ant-blue/10', text: 'text-ant-blue', dot: 'bg-ant-blue' }
                                          : { bg: 'bg-ant-orange/10', text: 'text-ant-orange', dot: 'bg-ant-orange' };
                                    return (
                                        <tr key={p.id} className="group hover:bg-ant-light/40 transition-colors border-t border-ant-line/60 tabular-nums">
                                            <td className="pl-5 pr-2 py-4">
                                                <Checkbox
                                                    checked={selected.includes(p.id)}
                                                    onCheckedChange={(v) => setSelected(v ? [...selected, p.id] : selected.filter((id) => id !== p.id))}
                                                    className="border-ant-line data-[state=checked]:bg-ant-ink data-[state=checked]:border-ant-ink"
                                                />
                                            </td>
                                            <td className="px-3 py-4">
                                                <div className="flex items-center gap-3">
                                                    <Avatar className="h-9 w-9 shrink-0 rounded-lg border border-ant-line">
                                                        <AvatarImage src={p.mediabuyer?.avatar_url || ''} className="object-cover" />
                                                        <AvatarFallback className="rounded-lg text-[11px] bg-ant-ink/5 text-ant-ink font-display font-semibold">
                                                            {(p.mediabuyer?.name || '??').substring(0, 2).toUpperCase()}
                                                        </AvatarFallback>
                                                    </Avatar>
                                                    <div className="min-w-0">
                                                        <p className="font-display text-[13px] font-semibold text-ant-ink leading-tight truncate">{p.mediabuyer?.name || '—'}</p>
                                                        <p className="text-[11px] text-ant-mid/80 leading-tight truncate mt-0.5">{p.mediabuyer?.email}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-4 text-[12px] text-ant-mid whitespace-nowrap">{format(new Date(p.payout_month + '-01'), 'MMM yyyy')}</td>
                                            <td className="px-3 py-4">
                                                <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize', isCommission ? 'bg-ant-orange/10 text-ant-orange' : 'bg-ant-green/10 text-ant-green')}>
                                                    <span className={cn('h-1.5 w-1.5 rounded-full', isCommission ? 'bg-ant-orange' : 'bg-ant-green')} />
                                                    {p.payment_type}
                                                </span>
                                            </td>
                                            <td className="px-3 py-4 text-right text-[13px] font-semibold text-ant-green tabular-nums">{fmtNum(p.delivered_orders)}</td>
                                            <td className="px-3 py-4 text-right text-[12px] text-ant-rose tabular-nums" title={fmtCurFull(Number(p.total_spend))}>
                                                {fmtCur(Number(p.total_spend))}
                                            </td>
                                            <td className="px-3 py-4 text-right text-[13px] font-semibold text-ant-ink tabular-nums" title={fmtCurFull(totalAmount)}>
                                                {fmtCur(totalAmount)} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                            </td>
                                            <td className="px-3 py-4 text-right" title={`${fmtCurFull(paidAmount)} paid of ${fmtCurFull(totalAmount)}`}>
                                                <div className="flex flex-col items-end gap-1.5">
                                                    <span className={cn('text-[13px] font-semibold tabular-nums leading-none', paidAmount > 0 ? 'text-ant-green' : 'text-ant-mid/60')}>
                                                        {fmtCur(paidAmount)} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                                    </span>
                                                    {isPartial && (
                                                        <div className="h-1 w-24 rounded-full bg-ant-line/60 overflow-hidden">
                                                            <div className="h-full rounded-full bg-ant-blue transition-all" style={{ width: `${pct}%` }} />
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-3 py-4">
                                                <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize', statusMeta.bg, statusMeta.text)}>
                                                    <span className={cn('h-1.5 w-1.5 rounded-full', statusMeta.dot)} />
                                                    {p.status}
                                                </span>
                                            </td>
                                            <td className="pl-3 pr-5 py-4 text-right">
                                                <div className="inline-flex items-center gap-1.5">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => { setActiveRow(p); setHistoryOpen(true); }}
                                                        className="h-8 w-8 rounded-full p-0 text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                                                        title="Payment history"
                                                    >
                                                        <History className="w-3.5 h-3.5" />
                                                    </Button>
                                                    {isPaid ? (
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => {
                                                                if (window.confirm('Reverse all payments on this payout?')) {
                                                                    reverseAllMutation.mutate(p.id);
                                                                }
                                                            }}
                                                            className="h-8 rounded-full px-3 text-[11px] font-semibold text-ant-mid hover:text-ant-orange hover:bg-ant-orange/10 cursor-pointer"
                                                        >
                                                            Reverse
                                                        </Button>
                                                    ) : (
                                                        <Button
                                                            size="sm"
                                                            onClick={() => { setActiveRow(p); setRecordOpen(true); }}
                                                            className={cn(
                                                                'h-8 rounded-full px-3 text-[11px] font-semibold cursor-pointer text-white',
                                                                isPartial ? 'bg-ant-blue hover:bg-ant-blue/90' : 'bg-ant-ink hover:bg-ant-ink/90'
                                                            )}
                                                        >
                                                            {isPartial ? 'Continue' : 'Record'}
                                                        </Button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-9 w-9 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light cursor-pointer">
                        <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    <span className="text-[12px] font-semibold text-ant-ink px-3 tabular-nums">
                        {page} <span className="text-ant-mid">/ {totalPages}</span>
                    </span>
                    <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="h-9 w-9 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light cursor-pointer">
                        <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                </div>
            )}

            {activeRow && (
                <>
                    <RecordPaymentDialog
                        open={recordOpen}
                        onOpenChange={setRecordOpen}
                        kind="mediabuyer"
                        payoutId={activeRow.id}
                        totalAmount={Number(activeRow.total_amount || 0)}
                        paidAmount={Number(activeRow.paid_amount || 0)}
                        collaboratorName={activeRow.mediabuyer?.name || 'Media buyer'}
                        businessId={activeBusinessId}
                    />
                    <PaymentHistoryDialog
                        open={historyOpen}
                        onOpenChange={setHistoryOpen}
                        kind="mediabuyer"
                        payoutId={activeRow.id}
                        totalAmount={Number(activeRow.total_amount || 0)}
                        paidAmount={Number(activeRow.paid_amount || 0)}
                        collaboratorName={activeRow.mediabuyer?.name || 'Media buyer'}
                        businessId={activeBusinessId}
                        onAddPayment={() => { setHistoryOpen(false); setRecordOpen(true); }}
                    />
                </>
            )}
        </div>
    );
};

// ═════════════════════════ Bulk Generate Dialog ═════════════════════════
const BulkGenerateDialog: React.FC<{ open: boolean; onOpenChange: (v: boolean) => void; initialRole: Role }> = ({ open, onOpenChange, initialRole }) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const [role, setRole] = useState<Role>(initialRole);
    const [monthKey, setMonthKey] = useState<string>(format(new Date(), 'yyyy-MM'));
    const [selectedIds, setSelectedIds] = useState<string[]>([]);

    React.useEffect(() => {
        if (open) {
            setRole(initialRole);
            setMonthKey(format(new Date(), 'yyyy-MM'));
            setSelectedIds([]);
        }
    }, [open, initialRole]);

    const monthOptions = useMemo(
        () =>
            eachMonthOfInterval({ start: subMonths(new Date(), 12), end: new Date() })
                .reverse()
                .map((d) => ({ value: format(d, 'yyyy-MM'), label: format(d, 'MMMM yyyy') })),
        []
    );

    const sellerEarnings = useSellerEarnings(monthKey);
    const mbEarnings = useMediaBuyerEarnings(monthKey);

    const activeRows = role === 'seller' ? sellerEarnings.rows : mbEarnings.rows;
    const activeLoading = role === 'seller' ? sellerEarnings.isLoading : mbEarnings.isLoading;

    React.useEffect(() => {
        if (!open || activeLoading) return;
        if (role === 'seller') {
            setSelectedIds(sellerEarnings.rows.filter((r) => r.total_amount > 0).map((r) => r.seller_id));
        } else {
            setSelectedIds(mbEarnings.rows.filter((r) => r.remaining_amount > 0).map((r) => r.mediabuyer_id));
        }
    }, [open, activeLoading, role, monthKey, sellerEarnings.rows, mbEarnings.rows]);

    const totals = useMemo(() => {
        if (role === 'seller') {
            const rows = (sellerEarnings.rows as SellerEarnings[]).filter((r) => selectedIds.includes(r.seller_id));
            return {
                users: rows.length,
                delivered: rows.reduce((a, r) => a + r.delivered_orders, 0),
                amount: rows.reduce((a, r) => a + r.total_amount, 0),
            };
        }
        const rows = (mbEarnings.rows as MediaBuyerEarnings[]).filter((r) => selectedIds.includes(r.mediabuyer_id));
        return {
            users: rows.length,
            delivered: rows.reduce((a, r) => a + r.delivered_orders, 0),
            amount: rows.reduce((a, r) => a + r.remaining_amount, 0),
        };
    }, [role, selectedIds, sellerEarnings.rows, mbEarnings.rows]);

    const generateMutation = useMutation({
        mutationFn: async () => {
            if (!activeBusinessId) throw new Error('No active business');
            if (selectedIds.length === 0) throw new Error('Select at least one collaborator');

            if (role === 'seller') {
                const rows = (sellerEarnings.rows as SellerEarnings[]).filter((r) => selectedIds.includes(r.seller_id));
                const payload = rows
                    .filter((r) => r.total_amount > 0)
                    .map((r) => ({
                        seller_id: r.seller_id,
                        payout_month: sellerEarnings.payoutMonthKey,
                        salary_earned: 0,
                        commission_earned: r.commission_earned,
                        total_amount: r.total_amount,
                        days_present: r.days_present,
                        delivered_orders: r.delivered_orders,
                        bank_snapshot: {
                            name: r.bank_name,
                            rib: r.bank_rib,
                            holder: r.bank_account_holder,
                            cin: r.cin_number,
                        },
                        status: 'pending',
                        'DigiCom Business': activeBusinessId,
                    }));
                if (payload.length === 0) throw new Error('All selected rows have 0 remainder');
                const { error } = await (supabase as any).from('seller_payments').insert(payload);
                if (error) throw error;
                return { role: 'seller' as const, count: payload.length };
            } else {
                const rows = (mbEarnings.rows as MediaBuyerEarnings[]).filter((r) => selectedIds.includes(r.mediabuyer_id));
                const payload = rows
                    .filter((r) => r.remaining_amount > 0)
                    .map((r) => ({
                        mediabuyer_id: r.mediabuyer_id,
                        'DigiCom Business': activeBusinessId,
                        payout_month: monthKey,
                        payment_type: r.payment_type || 'commission',
                        salary_earned: r.salary_earned,
                        commission_earned: r.commission_earned,
                        total_amount: r.remaining_amount,
                        delivered_orders: r.delivered_orders,
                        total_spend: r.total_spend,
                        campaigns_count: r.campaigns_count,
                        bank_snapshot: {
                            name: r.bank_name,
                            rib: r.bank_rib,
                            holder: r.bank_account_holder,
                            cin: r.cin_number,
                        },
                        status: 'pending',
                    }));
                if (payload.length === 0) throw new Error('All selected rows have 0 remainder');
                const { error } = await (supabase as any)
                    .from('mediabuyer_payments')
                    .upsert(payload, { onConflict: 'mediabuyer_id,payout_month' });
                if (error) throw error;
                return { role: 'mediabuyer' as const, count: payload.length };
            }
        },
        onSuccess: ({ role: r, count }) => {
            queryClient.invalidateQueries({ queryKey: [r === 'seller' ? 'seller-payouts' : 'mb-payouts'] });
            queryClient.invalidateQueries({ queryKey: ['mb-earnings-prior'] });
            queryClient.invalidateQueries({ queryKey: ['seller-earnings-prior'] });
            toast({ title: 'Payouts generated', description: `${count} payout${count !== 1 ? 's' : ''} created as pending.` });
            onOpenChange(false);
        },
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
    });

    const toggleRow = (id: string) => {
        setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };
    const toggleAll = () => {
        if (activeRows.length === 0) return;
        const ids = role === 'seller' ? (sellerEarnings.rows as SellerEarnings[]).map((r) => r.seller_id) : (mbEarnings.rows as MediaBuyerEarnings[]).map((r) => r.mediabuyer_id);
        if (selectedIds.length === ids.length) setSelectedIds([]);
        else setSelectedIds(ids);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden max-h-[92vh] flex flex-col">
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                        Payroll · Bulk generate
                    </div>
                    <DialogTitle className="font-display text-[22px] leading-tight tracking-tight text-ant-ink">Generate payouts</DialogTitle>
                    <DialogDescription className="font-serif italic text-[13px] text-ant-mid">
                        Pick a role and a month, review the breakdown, then generate every owed payout as pending.
                    </DialogDescription>
                </DialogHeader>

                <div className="px-6 py-4 flex items-center gap-3 border-b border-ant-line">
                    <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper">
                        <button
                            onClick={() => setRole('seller')}
                            className={cn(
                                'inline-flex items-center gap-1.5 rounded-full px-3.5 h-8 text-[11px] font-semibold transition cursor-pointer',
                                role === 'seller' ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink'
                            )}
                        >
                            <Headphones className="w-3 h-3" />
                            Sellers
                        </button>
                        <button
                            onClick={() => setRole('mediabuyer')}
                            className={cn(
                                'inline-flex items-center gap-1.5 rounded-full px-3.5 h-8 text-[11px] font-semibold transition cursor-pointer',
                                role === 'mediabuyer' ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink'
                            )}
                        >
                            <Target className="w-3 h-3" />
                            Media buyers
                        </button>
                    </div>
                    <Select value={monthKey} onValueChange={setMonthKey}>
                        <SelectTrigger className="w-[200px] h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-ant-line">
                            {monthOptions.map((m) => (
                                <SelectItem key={m.value} value={m.value} className="text-[12px]">
                                    {m.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex-1 overflow-y-auto ant-scroll px-6 py-4 space-y-3">
                    {activeLoading ? (
                        <div className="flex justify-center py-10">
                            <Loader2 className="w-6 h-6 animate-spin text-ant-mid" />
                        </div>
                    ) : activeRows.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-12 text-center">
                            <p className="font-serif italic text-[13px] text-ant-mid">
                                No {role === 'seller' ? 'sellers' : 'media buyers'} in this business.
                            </p>
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-ant-line bg-ant-light/50">
                                            <th className="px-4 py-3 w-10">
                                                <Checkbox
                                                    checked={selectedIds.length > 0 && selectedIds.length === activeRows.length}
                                                    onCheckedChange={toggleAll}
                                                    className="border-ant-line data-[state=checked]:bg-ant-ink data-[state=checked]:border-ant-ink"
                                                />
                                            </th>
                                            <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">
                                                {role === 'seller' ? 'Seller' : 'Media buyer'}
                                            </th>
                                            {role === 'mediabuyer' && (
                                                <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Type</th>
                                            )}
                                            <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Delivered</th>
                                            {role === 'seller' ? (
                                                <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Days</th>
                                            ) : (
                                                <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Spend</th>
                                            )}
                                            {role === 'mediabuyer' && (
                                                <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Already paid</th>
                                            )}
                                            <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">To pay</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {role === 'seller'
                                            ? (sellerEarnings.rows as SellerEarnings[]).map((r) => {
                                                  const hasRemainder = r.total_amount > 0;
                                                  const sel = selectedIds.includes(r.seller_id);
                                                  return (
                                                      <tr key={r.seller_id} className={cn('border-b border-ant-line last:border-0 hover:bg-ant-light/60 transition-colors tabular-nums', sel && 'bg-ant-orange/5', !hasRemainder && 'opacity-40')}>
                                                          <td className="px-4 py-3">
                                                              <Checkbox
                                                                  checked={sel}
                                                                  disabled={!hasRemainder}
                                                                  onCheckedChange={() => toggleRow(r.seller_id)}
                                                                  className="border-ant-line data-[state=checked]:bg-ant-ink data-[state=checked]:border-ant-ink"
                                                              />
                                                          </td>
                                                          <td className="px-4 py-3">
                                                              <div className="flex items-center gap-2.5 min-w-0">
                                                                  <Avatar className="h-8 w-8 shrink-0 rounded-xl border border-ant-line">
                                                                      <AvatarImage src={r.avatar_url || ''} className="object-cover" />
                                                                      <AvatarFallback className="rounded-xl text-[10px] bg-ant-ink/5 text-ant-ink font-display font-semibold">
                                                                          {r.name.substring(0, 2).toUpperCase()}
                                                                      </AvatarFallback>
                                                                  </Avatar>
                                                                  <div className="min-w-0">
                                                                      <p className="font-display text-[12px] font-semibold text-ant-ink truncate">{r.name}</p>
                                                                      <p className="text-[11px] text-ant-mid truncate">{r.email}</p>
                                                                  </div>
                                                              </div>
                                                          </td>
                                                          <td className="px-4 py-3 text-right text-[12px] font-semibold text-ant-green tabular-nums">{fmtNum(r.delivered_orders)}</td>
                                                          <td className="px-4 py-3 text-right text-[11px] text-ant-mid tabular-nums">{r.days_present}</td>
                                                          <td className="px-4 py-3 text-right font-display text-[13px] font-semibold text-ant-ink tabular-nums" title={fmtCurFull(r.total_amount)}>
                                                              {fmtCur(r.total_amount)}
                                                              <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                                                          </td>
                                                      </tr>
                                                  );
                                              })
                                            : (mbEarnings.rows as MediaBuyerEarnings[]).map((r) => {
                                                  const hasRemainder = r.remaining_amount > 0;
                                                  const sel = selectedIds.includes(r.mediabuyer_id);
                                                  const isCommission = r.payment_type === 'commission';
                                                  return (
                                                      <tr key={r.mediabuyer_id} className={cn('border-b border-ant-line last:border-0 hover:bg-ant-light/60 transition-colors tabular-nums', sel && 'bg-ant-orange/5', !hasRemainder && 'opacity-40')}>
                                                          <td className="px-4 py-3">
                                                              <Checkbox
                                                                  checked={sel}
                                                                  disabled={!hasRemainder}
                                                                  onCheckedChange={() => toggleRow(r.mediabuyer_id)}
                                                                  className="border-ant-line data-[state=checked]:bg-ant-ink data-[state=checked]:border-ant-ink"
                                                              />
                                                          </td>
                                                          <td className="px-4 py-3">
                                                              <div className="flex items-center gap-2.5 min-w-0">
                                                                  <Avatar className="h-8 w-8 shrink-0 rounded-xl border border-ant-line">
                                                                      <AvatarImage src={r.avatar_url || ''} className="object-cover" />
                                                                      <AvatarFallback className="rounded-xl text-[10px] bg-ant-ink/5 text-ant-ink font-display font-semibold">
                                                                          {r.name.substring(0, 2).toUpperCase()}
                                                                      </AvatarFallback>
                                                                  </Avatar>
                                                                  <div className="min-w-0">
                                                                      <p className="font-display text-[12px] font-semibold text-ant-ink truncate">{r.name}</p>
                                                                      <p className="text-[11px] text-ant-mid truncate">{r.email}</p>
                                                                  </div>
                                                              </div>
                                                          </td>
                                                          <td className="px-4 py-3">
                                                              <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize', isCommission ? 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' : 'bg-ant-green/10 border-ant-green/25 text-ant-green')}>
                                                                  <span className={cn('h-1.5 w-1.5 rounded-full', isCommission ? 'bg-ant-orange' : 'bg-ant-green')} />
                                                                  {r.payment_type || 'n/a'}
                                                              </span>
                                                          </td>
                                                          <td className="px-4 py-3 text-right text-[12px] font-semibold text-ant-green tabular-nums">{fmtNum(r.delivered_orders)}</td>
                                                          <td className="px-4 py-3 text-right text-[11px] text-ant-rose tabular-nums" title={fmtCurFull(r.total_spend)}>
                                                              {fmtCur(r.total_spend)}
                                                          </td>
                                                          <td className="px-4 py-3 text-right text-[11px] text-ant-mid tabular-nums" title={fmtCurFull(r.prior_paid_amount)}>
                                                              {r.prior_paid_amount > 0 ? fmtCur(r.prior_paid_amount) : '—'}
                                                          </td>
                                                          <td className="px-4 py-3 text-right font-display text-[13px] font-semibold text-ant-ink tabular-nums" title={fmtCurFull(r.remaining_amount)}>
                                                              {fmtCur(r.remaining_amount)}
                                                              <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                                                          </td>
                                                      </tr>
                                                  );
                                              })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {!activeLoading && activeRows.length > 0 && (
                        <div className="rounded-2xl border border-ant-line bg-ant-light/40 p-4 flex items-start gap-3">
                            <div className="h-8 w-8 rounded-lg bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center shrink-0">
                                <Info className="w-3.5 h-3.5 text-ant-orange" />
                            </div>
                            <div className="space-y-1 text-[12px] text-ant-ink leading-relaxed">
                                <p>
                                    <span className="font-semibold">{role === 'seller' ? 'Sellers' : 'Media buyers'}:</span>{' '}
                                    {role === 'seller'
                                        ? 'Commission accrual from delivery days, minus prior payouts for the same month.'
                                        : 'Salary type → full monthly salary. Commission type → delivered orders × commission price, minus prior payouts for the same month.'}
                                </p>
                                <p className="font-serif italic text-[11px] text-ant-mid">
                                    Rows with 0 remainder are disabled. Generated payouts are created as pending and must be marked paid manually.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Ink summary + footer actions */}
                <DialogFooter className="p-0 border-t border-ant-line">
                    <div className="w-full flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-4 bg-ant-ink text-white">
                        <div className="grid grid-cols-3 gap-6">
                            <div>
                                <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-white/55 inline-flex items-center gap-1.5">
                                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                                    Selected
                                </p>
                                <p className="font-display text-[20px] font-semibold text-white mt-0.5 tabular-nums">{totals.users}</p>
                            </div>
                            <div>
                                <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-white/55 inline-flex items-center gap-1.5">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                                    Delivered
                                </p>
                                <p className="font-display text-[20px] font-semibold text-ant-green mt-0.5 tabular-nums">{fmtNum(totals.delivered)}</p>
                            </div>
                            <div>
                                <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-white/55 inline-flex items-center gap-1.5">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                    Total
                                </p>
                                <p className="font-display text-[20px] font-semibold text-ant-orange mt-0.5 tabular-nums" title={fmtCurFull(totals.amount)}>
                                    {fmtCur(totals.amount)}
                                    <span className="text-[11px] text-white/55 font-normal ml-1">MAD</span>
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                onClick={() => onOpenChange(false)}
                                className="h-10 px-5 rounded-full text-[12px] font-semibold text-white/70 hover:text-white hover:bg-white/10 cursor-pointer"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={() => generateMutation.mutate()}
                                disabled={generateMutation.isPending || totals.users === 0 || totals.amount === 0}
                                className="h-10 px-5 rounded-full bg-ant-orange hover:bg-ant-orange/90 text-white text-[12px] font-semibold gap-2 cursor-pointer"
                            >
                                {generateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                Generate {totals.users} payout{totals.users !== 1 ? 's' : ''}
                            </Button>
                        </div>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default Salaries;
