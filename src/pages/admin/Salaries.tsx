import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';
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
    Eye,
    ArrowDownRight,
    type LucideIcon,
} from 'lucide-react';
import { RecordPaymentDialog, PaymentHistoryDialog } from '@/components/salaries/PayoutPaymentDialogs';
import { SellerBreakdownDialog, GlobalLedgerDialog, SellerTicketDetailDialog } from '@/components/salaries/SellerLedgerDialogs';
import { MediaBuyerBreakdownDialog, MediaBuyerGlobalDialog, MediaBuyerPayoutDetailDialog, type MediaBuyerLedger } from '@/components/salaries/MediaBuyerLedgerDialogs';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useSellerLiveOwed, type SellerLiveOwed } from '@/hooks/useSellerLiveOwed';
import { useSellerLedger, type SellerLedger, type LedgerTicket } from '@/hooks/useSellerLedger';
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
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
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
    const [activeSeller, setActiveSeller] = useState<SellerLiveOwed | null>(null);
    // Ledger breakdown ("eye") dialogs. Per-row eye = that single month's detail;
    // the all-months view is reached from the Overview click-through.
    const [detailRow, setDetailRow] = useState<{ seller: SellerLedger; ticket: LedgerTicket } | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);
    const [breakdownOpen, setBreakdownOpen] = useState(false);
    const [breakdownSellerId, setBreakdownSellerId] = useState<string | null>(null);
    const [globalOpen, setGlobalOpen] = useState(false);

    // ONE live row per seller — accrued/paid/owed/status computed live from
    // orders + txns (same source as the seller profile), NOT the frozen monthly
    // seller_payments snapshots that made the table show stale numbers.
    const liveOwed = useSellerLiveOwed();
    const isLoading = liveOwed.isLoading;
    // Rolling-ledger tickets (open + closed months) — drives the breakdown eyes.
    const ledger = useSellerLedger();
    const breakdownSeller = breakdownSellerId ? ledger.byId(breakdownSellerId) : null;

    // Re-fetch live data when a dialog opens so amounts reflect deliveries/payments
    // that landed after the page loaded.
    React.useEffect(() => {
        if (recordOpen || historyOpen) {
            queryClient.invalidateQueries({ queryKey: ['seller-live-owed-orders'] });
            queryClient.invalidateQueries({ queryKey: ['seller-live-owed-payments'] });
        }
    }, [recordOpen, historyOpen, queryClient]);

    const monthKey = format(new Date(), 'yyyy-MM') + '-01';
    const invalidateAll = () =>
        ['seller-payouts', 'seller-payment-txns', 'seller-live-owed-users', 'seller-live-owed-orders', 'seller-live-owed-payments']
            .forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));

    // Canonical payout row a payment attaches to for a seller:
    // current-month row -> else first existing row -> else none (insert at pay time).
    const resolveCanonical = (o: SellerLiveOwed) => {
        const prows = o.paymentRows;
        const canonical = prows.find((r) => r.payout_month === monthKey) || prows[0] || null;
        const otherRowsTotal = prows
            .filter((r) => r.id !== canonical?.id)
            .reduce((s, r) => s + r.total_amount, 0);
        return { canonical, otherRowsTotal };
    };

    // Pay a seller's full LIVE remaining: top up (or insert) the canonical row so
    // its total_amount covers live accrued, then insert one txn for the remaining.
    // Order is load-bearing — only the txn insert fires the balance trigger.
    const settleMutation = useMutation({
        mutationFn: async (sellerIds: string[]) => {
            let inserted = 0;
            for (const sid of sellerIds) {
                const o = liveOwed.byId(sid);
                if (!o || o.remaining <= 0.005) continue;
                // pay_seller records the disbursement against the rolling open ticket
                // (handles carry/FIFO + balance atomically). No direct row writes.
                const { error } = await (supabase as any).rpc('pay_seller', {
                    p_seller_id: sid,
                    p_business_id: activeBusinessId,
                    p_amount: o.remaining,
                    p_paid_at: new Date().toISOString(),
                    p_note: 'Settled in full from Salaries bulk action',
                });
                if (error) throw error;
                inserted++;
            }
            return { inserted };
        },
        onSuccess: (res) => {
            invalidateAll();
            toast({ title: 'Settled', description: `${res.inserted} seller(s) paid in full.` });
            setSelected([]);
        },
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
    });


    // Sellers with real activity. One DISPLAY row per (seller, month) ticket — like
    // the media-buyer list — but money stays honest: only the OPEN month is
    // actionable; a closed month's unpaid portion is shown as "reporté" (carried),
    // never re-collectable, so owe is never double-counted across rows.
    const activeSellers = useMemo(
        () => ledger.all.filter((s) => s.lifetimeEarned > 0.005 || s.lifetimePaid > 0.005 || Math.abs(s.owe) > 0.005),
        [ledger.all],
    );
    const ticketStatusOf = (t: LedgerTicket): PayoutStatus => {
        const rem = t.total_amount - t.paid_amount;
        if (t.total_amount > 0 && rem <= 0.005) return 'paid';
        if (t.paid_amount > 0.005) return 'partial';
        return 'pending';
    };
    const allRows = useMemo<{ seller: SellerLedger; ticket: LedgerTicket }[]>(() => {
        const out: { seller: SellerLedger; ticket: LedgerTicket }[] = [];
        for (const s of activeSellers) {
            const months = [...(s.open ? [s.open] : []), ...s.closed]; // open first, then closed desc
            for (const t of months) out.push({ seller: s, ticket: t });
        }
        return out.sort((a, b) =>
            a.seller.name.localeCompare(b.seller.name) || b.ticket.payout_month.localeCompare(a.ticket.payout_month),
        );
    }, [activeSellers]);

    const filtered = useMemo(() => {
        let out = allRows;
        if (statusFilter !== 'all') out = out.filter((r) => ticketStatusOf(r.ticket) === statusFilter);
        const q = search.toLowerCase().trim();
        if (q) out = out.filter((r) => r.seller.name.toLowerCase().includes(q) || r.seller.email.toLowerCase().includes(q));
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allRows, statusFilter, search]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

    const stats = useMemo(() => {
        let totalPaid = 0, totalOwed = 0, settled = 0;
        for (const s of activeSellers) {
            totalPaid += s.lifetimePaid;        // Σ paid across all of the seller's tickets
            totalOwed += Math.max(0, s.owe);    // the single true outstanding balance (open ticket)
            if (s.owe <= 0.005) settled++;
        }
        return { totalPaid, totalOwed, settled, sellers: activeSellers.length };
    }, [activeSellers]);

    const counts = {
        all: allRows.length,
        pending: allRows.filter((r) => ticketStatusOf(r.ticket) === 'pending').length,
        partial: allRows.filter((r) => ticketStatusOf(r.ticket) === 'partial').length,
        paid: allRows.filter((r) => ticketStatusOf(r.ticket) === 'paid').length,
    };

    // Selectable (bulk-settle) = open tickets that still owe. Keyed by seller_id.
    const isSettleable = (t: LedgerTicket) => t.period_state === 'open' && (t.total_amount - t.paid_amount) > 0.005;
    const pageSelectable = paginated.filter((r) => isSettleable(r.ticket)).map((r) => r.seller.seller_id);

    // Open the seller-scoped pay/history dialogs (live-owe source) for a row.
    const openPay = (sellerId: string) => { const o = liveOwed.byId(sellerId); if (o) { setActiveSeller(o); setRecordOpen(true); } };
    const openHistory = (sellerId: string) => { const o = liveOwed.byId(sellerId); if (o) { setActiveSeller(o); setHistoryOpen(true); } };

    const activeCanonical = activeSeller ? resolveCanonical(activeSeller) : null;
    // alias so the shared empty-state copy that references `payouts.length` compiles
    const payouts = allRows;

    return (
        <div className="space-y-5">
            {/* KPI strip — live per-seller aggregates */}
            <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                <PayoutKpi label="Total paid" value={fmtCur(stats.totalPaid)} suffix="MAD" accent="green" icon={Wallet} />
                <PayoutKpi label="Total owed" value={fmtCur(stats.totalOwed)} suffix="MAD" accent="orange" icon={Coins} />
                <PayoutKpi label="Sellers" value={String(stats.sellers)} suffix="commercials" accent="ink" icon={Layers} />
                <PayoutKpi label="Fully settled" value={String(stats.settled)} suffix="sellers" accent="ink" icon={CalendarDays} />
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
                    <Button
                        variant="outline"
                        onClick={() => setGlobalOpen(true)}
                        className="h-10 px-4 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light text-[12px] font-semibold gap-2 cursor-pointer whitespace-nowrap"
                        title="Overview of all commissions"
                    >
                        <Eye className="w-3.5 h-3.5" /> Overview
                    </Button>
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
                                            checked={pageSelectable.length > 0 && pageSelectable.every((id) => selected.includes(id))}
                                            onCheckedChange={(v) => {
                                                if (v) setSelected(Array.from(new Set([...selected, ...pageSelectable])));
                                                else setSelected(selected.filter((id) => !pageSelectable.includes(id)));
                                            }}
                                            className="border-ant-line data-[state=checked]:bg-ant-ink data-[state=checked]:border-ant-ink"
                                        />
                                    </th>
                                    <th className="px-3 py-4 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Seller</th>
                                    <th className="px-3 py-4 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Month</th>
                                    <th className="px-3 py-4 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Delivered</th>
                                    <th className="px-3 py-4 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Earned</th>
                                    <th className="px-3 py-4 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Paid</th>
                                    <th className="px-3 py-4 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Owed</th>
                                    <th className="px-3 py-4 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Status</th>
                                    <th className="pl-3 pr-5 py-4 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginated.map(({ seller, ticket }) => {
                                    const isOpen = ticket.period_state === 'open';
                                    const remaining = Math.max(0, ticket.total_amount - ticket.paid_amount);
                                    const rolled = ticket.carried_out ?? remaining;
                                    const st = ticketStatusOf(ticket);
                                    const isPartial = st === 'partial';
                                    const settleable = isSettleable(ticket);
                                    const pct = ticket.total_amount > 0 ? Math.min(100, (ticket.paid_amount / ticket.total_amount) * 100) : 0;
                                    const statusMeta = st === 'paid'
                                        ? { bg: 'bg-ant-green/10', text: 'text-ant-green', dot: 'bg-ant-green' }
                                        : isPartial
                                          ? { bg: 'bg-ant-blue/10', text: 'text-ant-blue', dot: 'bg-ant-blue' }
                                          : { bg: 'bg-ant-orange/10', text: 'text-ant-orange', dot: 'bg-ant-orange' };
                                    return (
                                        <tr key={ticket.id} className="group hover:bg-ant-light/40 transition-colors border-t border-ant-line/60 tabular-nums">
                                            <td className="pl-5 pr-2 py-4">
                                                {settleable ? (
                                                    <Checkbox
                                                        checked={selected.includes(seller.seller_id)}
                                                        onCheckedChange={(v) => setSelected(v ? [...selected, seller.seller_id] : selected.filter((id) => id !== seller.seller_id))}
                                                        className="border-ant-line data-[state=checked]:bg-ant-ink data-[state=checked]:border-ant-ink"
                                                    />
                                                ) : <span className="block w-4" />}
                                            </td>
                                            <td className="px-3 py-4">
                                                <div className="flex items-center gap-3">
                                                    <Avatar className="h-9 w-9 shrink-0 rounded-lg border border-ant-line">
                                                        <AvatarImage src={seller.avatar_url || ''} className="object-cover" />
                                                        <AvatarFallback className="rounded-lg text-[11px] bg-ant-ink/5 text-ant-ink font-display font-semibold">
                                                            {(seller.name || '??').substring(0, 2).toUpperCase()}
                                                        </AvatarFallback>
                                                    </Avatar>
                                                    <div className="min-w-0">
                                                        <p className="font-display text-[13px] font-semibold text-ant-ink leading-tight truncate">{seller.name}</p>
                                                        <p className="text-[11px] text-ant-mid/80 leading-tight truncate mt-0.5">
                                                            {seller.email} · {seller.commissionPrice} MAD/{seller.commissionBasis === 'per_unit' ? 'unit' : 'order'}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-4">
                                                <p className="font-display text-[12px] font-semibold text-ant-ink capitalize whitespace-nowrap">{format(new Date(ticket.payout_month), 'MMM yyyy')}</p>
                                                <p className="text-[10px] text-ant-mid/80 italic">{isOpen ? 'mois en cours' : 'clôturé'}</p>
                                            </td>
                                            <td className="px-3 py-4 text-right text-[13px] font-semibold text-ant-green tabular-nums">{fmtNum(ticket.delivered_orders)}</td>
                                            <td className="px-3 py-4 text-right text-[13px] font-semibold text-ant-ink tabular-nums" title={fmtCurFull(ticket.month_earned)}>
                                                {fmtCur(ticket.month_earned)} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                            </td>
                                            <td className="px-3 py-4 text-right" title={`${fmtCurFull(ticket.paid_amount)} paid of ${fmtCurFull(ticket.total_amount)}`}>
                                                <div className="flex flex-col items-end gap-1.5">
                                                    <span className={cn('text-[13px] font-semibold tabular-nums leading-none', ticket.paid_amount > 0 ? 'text-ant-green' : 'text-ant-mid/60')}>
                                                        {fmtCur(ticket.paid_amount)} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                                    </span>
                                                    {isOpen && isPartial && (
                                                        <div className="h-1 w-24 rounded-full bg-ant-line/60 overflow-hidden">
                                                            <div className="h-full rounded-full bg-ant-blue transition-all" style={{ width: `${pct}%` }} />
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-3 py-4 text-right" title={isOpen ? fmtCurFull(remaining) : `${fmtCurFull(rolled)} reporté au mois suivant`}>
                                                {isOpen ? (
                                                    <span className={cn('text-[13px] font-semibold tabular-nums', remaining > 0.005 ? 'text-ant-orange' : 'text-ant-mid/50')}>
                                                        {fmtCur(remaining)} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                                    </span>
                                                ) : rolled > 0.005 ? (
                                                    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-ant-mid/70 tabular-nums">
                                                        <ArrowDownRight className="w-3 h-3" strokeWidth={1.75} />{fmtCur(rolled)}
                                                    </span>
                                                ) : (
                                                    <span className="text-[12px] text-ant-mid/50">—</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-4">
                                                <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize', statusMeta.bg, statusMeta.text)}>
                                                    <span className={cn('h-1.5 w-1.5 rounded-full', statusMeta.dot)} />
                                                    {st}
                                                </span>
                                            </td>
                                            <td className="pl-3 pr-5 py-4 text-right">
                                                <div className="inline-flex items-center gap-1.5">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => { setDetailRow({ seller, ticket }); setDetailOpen(true); }}
                                                        className="h-8 w-8 rounded-full p-0 text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                                                        title="Month detail & orders"
                                                    >
                                                        <Eye className="w-3.5 h-3.5" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => openHistory(seller.seller_id)}
                                                        className="h-8 w-8 rounded-full p-0 text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                                                        title="Payment history"
                                                    >
                                                        <History className="w-3.5 h-3.5" />
                                                    </Button>
                                                    {isOpen ? (
                                                        <Button
                                                            size="sm"
                                                            disabled={remaining <= 0.005}
                                                            onClick={() => openPay(seller.seller_id)}
                                                            className={cn(
                                                                'h-8 rounded-full px-3 text-[11px] font-semibold cursor-pointer text-white disabled:opacity-40 disabled:cursor-not-allowed',
                                                                isPartial ? 'bg-ant-blue hover:bg-ant-blue/90' : 'bg-ant-ink hover:bg-ant-ink/90'
                                                            )}
                                                        >
                                                            {remaining <= 0.005 ? 'Réglé' : isPartial ? 'Continue' : 'Pay'}
                                                        </Button>
                                                    ) : (
                                                        <span className="inline-flex items-center h-8 rounded-full px-3 text-[11px] font-semibold text-ant-mid bg-ant-light border border-ant-line">Clôturé</span>
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

            {activeSeller && (
                <>
                    <RecordPaymentDialog
                        open={recordOpen}
                        onOpenChange={setRecordOpen}
                        kind="seller"
                        payoutId={activeCanonical?.canonical?.id || ''}
                        totalAmount={0}
                        paidAmount={0}
                        collaboratorName={activeSeller.name}
                        businessId={activeBusinessId}
                        sellerAccruedTotal={activeSeller.accruedTotal}
                        sellerPaidAcrossRows={activeSeller.paidAcrossRows}
                        sellerId={activeSeller.seller_id}
                        sellerCanonicalRowTotal={activeCanonical?.canonical?.total_amount || 0}
                        sellerOtherRowsTotal={activeCanonical?.otherRowsTotal || 0}
                    />
                    <PaymentHistoryDialog
                        open={historyOpen}
                        onOpenChange={setHistoryOpen}
                        kind="seller"
                        payoutId={activeCanonical?.canonical?.id || ''}
                        totalAmount={activeSeller.accruedTotal}
                        paidAmount={activeSeller.paidAcrossRows}
                        collaboratorName={activeSeller.name}
                        businessId={activeBusinessId}
                        onAddPayment={() => { setHistoryOpen(false); setRecordOpen(true); }}
                    />
                </>
            )}

            {/* Ledger breakdown eyes */}
            <SellerTicketDetailDialog
                open={detailOpen}
                onOpenChange={setDetailOpen}
                seller={detailRow?.seller ?? null}
                ticket={detailRow?.ticket ?? null}
                businessId={activeBusinessId}
            />
            <SellerBreakdownDialog
                open={breakdownOpen}
                onOpenChange={setBreakdownOpen}
                seller={breakdownSeller}
                businessId={activeBusinessId}
            />
            <GlobalLedgerDialog
                open={globalOpen}
                onOpenChange={setGlobalOpen}
                sellers={ledger.all}
                onPick={(s) => { setBreakdownSellerId(s.seller_id); setGlobalOpen(false); setBreakdownOpen(true); }}
            />
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
    // Breakdown ("eye") dialogs. Per-row eye = that single month's detail.
    // Buyer-wide (all months) view is reached from the Overview click-through.
    const [detailPayoutRow, setDetailPayoutRow] = useState<MBPayout | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);
    const [breakdownMbId, setBreakdownMbId] = useState<string | null>(null);
    const [breakdownOpen, setBreakdownOpen] = useState(false);
    const [globalOpen, setGlobalOpen] = useState(false);

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

    // Per-media-buyer ledger aggregated from the payout rows (no carry — each
    // month is independent). Drives the breakdown eyes.
    const mbLedger = useMemo<MediaBuyerLedger[]>(() => {
        const m = new Map<string, MediaBuyerLedger>();
        for (const p of payouts) {
            const id = p.mediabuyer_id;
            let e = m.get(id);
            if (!e) {
                e = { mediabuyer_id: id, name: p.mediabuyer?.name || '—', email: p.mediabuyer?.email || '', avatar_url: p.mediabuyer?.avatar_url || null, payouts: [], lifetimeEarned: 0, lifetimePaid: 0, owe: 0 };
                m.set(id, e);
            }
            const total = Number(p.total_amount || 0);
            const paid = Number(p.paid_amount || 0);
            e.payouts.push({
                id: p.id, payout_month: p.payout_month, payment_type: p.payment_type,
                salary_earned: Number(p.salary_earned || 0), commission_earned: Number(p.commission_earned || 0),
                total_amount: total, paid_amount: paid, delivered_orders: Number(p.delivered_orders || 0),
                total_spend: Number(p.total_spend || 0), campaigns_count: Number(p.campaigns_count || 0),
                status: p.status, paid_at: p.paid_at,
            });
            e.lifetimeEarned += total; e.lifetimePaid += paid; e.owe += Math.max(0, total - paid);
        }
        const arr = Array.from(m.values());
        arr.forEach((e) => e.payouts.sort((a, b) => b.payout_month.localeCompare(a.payout_month)));
        return arr;
    }, [payouts]);
    const breakdownBuyer = breakdownMbId ? mbLedger.find((b) => b.mediabuyer_id === breakdownMbId) || null : null;

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
                    <Button
                        variant="outline"
                        onClick={() => setGlobalOpen(true)}
                        className="h-10 px-4 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light text-[12px] font-semibold gap-2 cursor-pointer whitespace-nowrap"
                        title="Overview of all media buyers"
                    >
                        <Eye className="w-3.5 h-3.5" /> Overview
                    </Button>
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
                                                        onClick={() => { setDetailPayoutRow(p); setDetailOpen(true); }}
                                                        className="h-8 w-8 rounded-full p-0 text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                                                        title="Payment detail"
                                                    >
                                                        <Eye className="w-3.5 h-3.5" />
                                                    </Button>
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
                                                        <span className="inline-flex items-center h-8 rounded-full px-3 text-[11px] font-semibold text-ant-green bg-ant-green/10 border border-ant-green/25">
                                                            Réglé
                                                        </span>
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

            {/* Breakdown eyes */}
            <MediaBuyerPayoutDetailDialog
                open={detailOpen}
                onOpenChange={setDetailOpen}
                payout={detailPayoutRow ? {
                    id: detailPayoutRow.id,
                    payout_month: detailPayoutRow.payout_month,
                    payment_type: detailPayoutRow.payment_type,
                    salary_earned: Number(detailPayoutRow.salary_earned || 0),
                    commission_earned: Number(detailPayoutRow.commission_earned || 0),
                    total_amount: Number(detailPayoutRow.total_amount || 0),
                    paid_amount: Number(detailPayoutRow.paid_amount || 0),
                    delivered_orders: Number(detailPayoutRow.delivered_orders || 0),
                    total_spend: Number(detailPayoutRow.total_spend || 0),
                    campaigns_count: Number(detailPayoutRow.campaigns_count || 0),
                    status: detailPayoutRow.status,
                    paid_at: detailPayoutRow.paid_at,
                } : null}
                buyerName={detailPayoutRow?.mediabuyer?.name || 'Media buyer'}
                buyerEmail={detailPayoutRow?.mediabuyer?.email || ''}
                buyerAvatar={detailPayoutRow?.mediabuyer?.avatar_url || null}
            />
            <MediaBuyerBreakdownDialog
                open={breakdownOpen}
                onOpenChange={setBreakdownOpen}
                buyer={breakdownBuyer}
            />
            <MediaBuyerGlobalDialog
                open={globalOpen}
                onOpenChange={setGlobalOpen}
                buyers={mbLedger}
                onPick={(b) => { setBreakdownMbId(b.mediabuyer_id); setGlobalOpen(false); setBreakdownOpen(true); }}
            />
        </div>
    );
};

// ═════════════════════════ Bulk Generate Dialog ═════════════════════════
type GenStep = 'select' | 'review' | 'amount';

const BulkGenerateDialog: React.FC<{ open: boolean; onOpenChange: (v: boolean) => void; initialRole: Role }> = ({ open, onOpenChange, initialRole }) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    // The modal is LOCKED to the tab it was opened from — no in-modal role switch.
    const role = initialRole;
    const isSeller = role === 'seller';
    // Media-buyer payouts are always generated for the CURRENT month (no picker —
    // sellers have none either; both pay/generate "now").
    const monthKey = useMemo(() => format(new Date(), 'yyyy-MM'), []);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [step, setStep] = useState<GenStep>('select');
    // Editable per-seller amounts (seller step 3 only). Media-buyer payouts are
    // generated at their full computed earning, never an arbitrary amount.
    const [amounts, setAmounts] = useState<Record<string, string>>({});

    const mbEarnings = useMediaBuyerEarnings(monthKey);
    // Sellers are paid against the rolling ledger — owe + the breakdown all come
    // from the open ticket. Media buyers stay month-based.
    const ledger = useSellerLedger();
    const owers = useMemo(
        () => [...ledger.owing].sort((a, b) => b.owe - a.owe || a.name.localeCompare(b.name)),
        [ledger.owing],
    );
    const oweFor = (sellerId: string) => Math.max(0, ledger.byId(sellerId)?.owe ?? 0);
    const mbOwers = useMemo(
        () => (mbEarnings.rows as MediaBuyerEarnings[]).filter((r) => r.remaining_amount > 0.005),
        [mbEarnings.rows],
    );

    React.useEffect(() => {
        if (open) {
            setSelectedIds([]);
            setStep('select');
            setAmounts({});
        }
    }, [open, initialRole]);

    const activeLoading = isSeller ? ledger.isLoading : mbEarnings.isLoading;
    const activeRows = isSeller ? owers : mbOwers;

    // Default selection: everyone who owes / has a remainder to generate.
    // Keyed off the *id set* (a stable string), NOT the array refs — owers churns
    // a new reference every render (ledger.owing is unmemoized), which would
    // otherwise re-fire this effect on every render and reset the wizard step.
    // Does NOT touch `step`; the open-reset effect owns step initialisation.
    const sellerOwerKey = owers.map((r) => r.seller_id).join(',');
    const mbOwerKey = mbOwers.map((r) => r.mediabuyer_id).join(',');
    React.useEffect(() => {
        if (!open || activeLoading) return;
        if (isSeller) setSelectedIds(owers.map((r) => r.seller_id));
        else setSelectedIds(mbOwers.map((r) => r.mediabuyer_id));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, activeLoading, isSeller, sellerOwerKey, mbOwerKey]);

    const seedAmounts = () => {
        const next: Record<string, string> = {};
        selectedIds.forEach((id) => { next[id] = oweFor(id).toFixed(2); });
        setAmounts(next);
    };
    const amountFor = (id: string) => {
        const raw = amounts[id];
        const v = raw === undefined ? oweFor(id) : parseFloat(raw);
        if (!isFinite(v) || v < 0) return 0;
        return Math.min(v, oweFor(id));
    };

    const selectedSellers = useMemo(() => owers.filter((r) => selectedIds.includes(r.seller_id)), [owers, selectedIds]);
    const selectedMb = useMemo(() => mbOwers.filter((r) => selectedIds.includes(r.mediabuyer_id)), [mbOwers, selectedIds]);

    const totals = useMemo(() => {
        if (isSeller) {
            const amount = step === 'amount'
                ? selectedSellers.reduce((a, r) => a + amountFor(r.seller_id), 0)
                : selectedSellers.reduce((a, r) => a + r.owe, 0);
            return { users: selectedSellers.length, delivered: selectedSellers.reduce((a, r) => a + (r.open?.delivered_orders ?? 0), 0), amount };
        }
        return {
            users: selectedMb.length,
            delivered: selectedMb.reduce((a, r) => a + r.delivered_orders, 0),
            amount: selectedMb.reduce((a, r) => a + r.remaining_amount, 0),
        };
    }, [isSeller, step, selectedSellers, selectedMb, amounts]);

    const generateMutation = useMutation({
        mutationFn: async () => {
            if (!activeBusinessId) throw new Error('No active business');
            if (selectedIds.length === 0) throw new Error('Select at least one collaborator');

            if (isSeller) {
                const targets = selectedSellers
                    .map((r) => ({ id: r.seller_id, amt: amountFor(r.seller_id) }))
                    .filter((t) => t.amt > 0.005);
                if (targets.length === 0) throw new Error('Nothing to pay on the selected sellers');
                for (const t of targets) {
                    const { error } = await (supabase as any).rpc('pay_seller', {
                        p_seller_id: t.id,
                        p_business_id: activeBusinessId,
                        p_amount: t.amt,
                        p_paid_at: new Date().toISOString(),
                        p_note: 'Paid from Salaries generate flow',
                    });
                    if (error) throw error;
                }
                return { role: 'seller' as const, count: targets.length };
            } else {
                const payload = selectedMb
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
                        bank_snapshot: { name: r.bank_name, rib: r.bank_rib, holder: r.bank_account_holder, cin: r.cin_number },
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
            if (r === 'seller') {
                ['seller-payouts', 'seller-payment-txns', 'seller-ledger-tickets', 'seller-ledger-users', 'seller-live-owed-users', 'seller-live-owed-daily', 'seller-live-owed-payments']
                    .forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
                toast({ title: 'Sellers paid', description: `${count} seller${count !== 1 ? 's' : ''} paid.` });
            } else {
                queryClient.invalidateQueries({ queryKey: ['mb-payouts'] });
                queryClient.invalidateQueries({ queryKey: ['mb-earnings-prior'] });
                toast({ title: 'Payouts generated', description: `${count} payout${count !== 1 ? 's' : ''} created as pending.` });
            }
            onOpenChange(false);
        },
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
    });

    const toggleRow = (id: string) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    const toggleAll = () => {
        const ids = isSeller ? owers.map((r) => r.seller_id) : mbOwers.map((r) => r.mediabuyer_id);
        if (ids.length === 0) return;
        if (selectedIds.length === ids.length) setSelectedIds([]);
        else setSelectedIds(ids);
    };

    const steps: { key: GenStep; label: string }[] = [
        { key: 'select', label: 'Select' },
        { key: 'review', label: 'Breakdown' },
        { key: 'amount', label: isSeller ? 'Amounts' : 'Confirm' },
    ];
    const goNext = () => {
        if (step === 'select') { setStep('review'); return; }
        if (step === 'review') { if (isSeller) seedAmounts(); setStep('amount'); return; }
    };
    const goBack = () => {
        if (step === 'amount') { setStep('review'); return; }
        if (step === 'review') { setStep('select'); return; }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden max-h-[92vh] flex flex-col">
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                        Payroll · {isSeller ? 'Sellers' : 'Media buyers'}
                    </div>
                    <DialogTitle className="font-display text-[22px] leading-tight tracking-tight text-ant-ink">Generate payouts</DialogTitle>
                    <DialogDescription className="font-serif italic text-[13px] text-ant-mid">
                        {isSeller
                            ? 'Select who owes, review the breakdown, then pay their outstanding balance.'
                            : 'Pick a month, review each earning, then generate the pending payouts.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="px-6 py-4 flex items-center gap-3 border-b border-ant-line flex-wrap">
                    {/* Stepper (both roles) */}
                    <div className="inline-flex items-center gap-1.5">
                        {steps.map((s, i) => {
                            const idx = steps.findIndex((x) => x.key === step);
                            const done = i < idx;
                            const active = i === idx;
                            return (
                                <React.Fragment key={s.key}>
                                    {i > 0 && <span className={cn('h-px w-5', i <= idx ? 'bg-ant-ink' : 'bg-ant-line')} />}
                                    <span className={cn(
                                        'inline-flex items-center gap-1.5 rounded-full px-2.5 h-7 text-[10px] font-semibold transition',
                                        active ? 'bg-ant-ink text-white' : done ? 'bg-ant-ink/10 text-ant-ink' : 'bg-ant-light text-ant-mid',
                                    )}>
                                        <span className={cn('h-4 w-4 rounded-full inline-flex items-center justify-center text-[9px] tabular-nums',
                                            active ? 'bg-white/20 text-white' : done ? 'bg-ant-ink text-white' : 'bg-ant-paper text-ant-mid border border-ant-line')}>
                                            {done ? <Check className="w-2.5 h-2.5" /> : i + 1}
                                        </span>
                                        {s.label}
                                    </span>
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto ant-scroll px-6 py-4 space-y-3">
                    {activeLoading ? (
                        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-ant-mid" /></div>
                    ) : activeRows.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-12 text-center">
                            <p className="font-serif italic text-[13px] text-ant-mid">
                                {isSeller ? 'No seller currently owes anything.' : 'No media buyer has anything to generate for this month.'}
                            </p>
                        </div>
                    ) : (
                        <>
                            {/* STEP 1 — select */}
                            {step === 'select' && (
                                <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead>
                                                <tr className="border-b border-ant-line bg-ant-light/50">
                                                    <th className="px-4 py-3 w-10">
                                                        <Checkbox checked={selectedIds.length > 0 && selectedIds.length === activeRows.length} onCheckedChange={toggleAll} className="border-ant-line data-[state=checked]:bg-ant-ink data-[state=checked]:border-ant-ink" />
                                                    </th>
                                                    <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">{isSeller ? 'Seller' : 'Media buyer'}</th>
                                                    {!isSeller && <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Type</th>}
                                                    <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">{isSeller ? 'Units' : 'Delivered'}</th>
                                                    {!isSeller && <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Already paid</th>}
                                                    <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">{isSeller ? 'Owes' : 'To pay'}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {isSeller
                                                    ? owers.map((r) => {
                                                          const sel = selectedIds.includes(r.seller_id);
                                                          return (
                                                              <tr key={r.seller_id} className={cn('border-b border-ant-line last:border-0 hover:bg-ant-light/60 transition-colors tabular-nums', sel && 'bg-ant-orange/5')}>
                                                                  <td className="px-4 py-3"><Checkbox checked={sel} onCheckedChange={() => toggleRow(r.seller_id)} className="border-ant-line data-[state=checked]:bg-ant-ink data-[state=checked]:border-ant-ink" /></td>
                                                                  <td className="px-4 py-3">
                                                                      <div className="flex items-center gap-2.5 min-w-0">
                                                                          <Avatar className="h-8 w-8 shrink-0 rounded-xl border border-ant-line"><AvatarImage src={r.avatar_url || ''} className="object-cover" /><AvatarFallback className="rounded-xl text-[10px] bg-ant-ink/5 text-ant-ink font-display font-semibold">{(r.name || '??').substring(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                                                                          <div className="min-w-0">
                                                                              <p className="font-display text-[12px] font-semibold text-ant-ink truncate">{r.name}</p>
                                                                              <p className="text-[11px] text-ant-mid truncate">{r.email} · {fmtCur(r.commissionPrice)} MAD/{r.commissionBasis === 'per_unit' ? 'unit' : 'order'}</p>
                                                                          </div>
                                                                      </div>
                                                                  </td>
                                                                  <td className="px-4 py-3 text-right text-[12px] font-semibold text-ant-green tabular-nums">{fmtNum(r.open?.delivered_orders ?? 0)}</td>
                                                                  <td className="px-4 py-3 text-right font-display text-[13px] font-semibold text-ant-orange tabular-nums" title={fmtCurFull(r.owe)}>{fmtCur(r.owe)}<span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span></td>
                                                              </tr>
                                                          );
                                                      })
                                                    : mbOwers.map((r) => {
                                                          const sel = selectedIds.includes(r.mediabuyer_id);
                                                          const isCommission = r.payment_type === 'commission';
                                                          return (
                                                              <tr key={r.mediabuyer_id} className={cn('border-b border-ant-line last:border-0 hover:bg-ant-light/60 transition-colors tabular-nums', sel && 'bg-ant-orange/5')}>
                                                                  <td className="px-4 py-3"><Checkbox checked={sel} onCheckedChange={() => toggleRow(r.mediabuyer_id)} className="border-ant-line data-[state=checked]:bg-ant-ink data-[state=checked]:border-ant-ink" /></td>
                                                                  <td className="px-4 py-3">
                                                                      <div className="flex items-center gap-2.5 min-w-0">
                                                                          <Avatar className="h-8 w-8 shrink-0 rounded-xl border border-ant-line"><AvatarImage src={r.avatar_url || ''} className="object-cover" /><AvatarFallback className="rounded-xl text-[10px] bg-ant-ink/5 text-ant-ink font-display font-semibold">{(r.name || '??').substring(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                                                                          <div className="min-w-0"><p className="font-display text-[12px] font-semibold text-ant-ink truncate">{r.name}</p><p className="text-[11px] text-ant-mid truncate">{r.email}</p></div>
                                                                      </div>
                                                                  </td>
                                                                  <td className="px-4 py-3">
                                                                      <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize', isCommission ? 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' : 'bg-ant-green/10 border-ant-green/25 text-ant-green')}>
                                                                          <span className={cn('h-1.5 w-1.5 rounded-full', isCommission ? 'bg-ant-orange' : 'bg-ant-green')} />{r.payment_type || 'n/a'}
                                                                      </span>
                                                                  </td>
                                                                  <td className="px-4 py-3 text-right text-[12px] font-semibold text-ant-green tabular-nums">{fmtNum(r.delivered_orders)}</td>
                                                                  <td className="px-4 py-3 text-right text-[11px] text-ant-mid tabular-nums" title={fmtCurFull(r.prior_paid_amount)}>{r.prior_paid_amount > 0 ? fmtCur(r.prior_paid_amount) : '—'}</td>
                                                                  <td className="px-4 py-3 text-right font-display text-[13px] font-semibold text-ant-orange tabular-nums" title={fmtCurFull(r.remaining_amount)}>{fmtCur(r.remaining_amount)}<span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span></td>
                                                              </tr>
                                                          );
                                                      })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* STEP 2 — breakdown */}
                            {step === 'review' && (
                                <div className="space-y-2.5">
                                    {(isSeller ? selectedSellers.length === 0 : selectedMb.length === 0) ? (
                                        <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-10 text-center">
                                            <p className="font-serif italic text-[13px] text-ant-mid">Select at least one {isSeller ? 'seller' : 'media buyer'} to review.</p>
                                        </div>
                                    ) : isSeller ? selectedSellers.map((r) => {
                                        const o = r.open;
                                        const carried = o?.carried_in ?? 0, earned = o?.month_earned ?? 0, paid = o?.paid_amount ?? 0, units = o?.delivered_orders ?? 0;
                                        return (
                                            <div key={r.seller_id} className="rounded-2xl border border-ant-line bg-ant-paper p-4">
                                                <div className="flex items-center gap-2.5 mb-3">
                                                    <Avatar className="h-8 w-8 shrink-0 rounded-xl border border-ant-line"><AvatarImage src={r.avatar_url || ''} className="object-cover" /><AvatarFallback className="rounded-xl text-[10px] bg-ant-ink/5 text-ant-ink font-display font-semibold">{(r.name || '??').substring(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                                                    <p className="font-display text-[13px] font-semibold text-ant-ink truncate">{r.name}</p>
                                                </div>
                                                <div className="flex items-center flex-wrap gap-x-2 gap-y-1.5 text-[12px] tabular-nums">
                                                    {carried !== 0 && (<><span className="inline-flex flex-col rounded-lg border border-ant-line bg-ant-light px-3 py-1.5"><span className="text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">Reporté</span><span className="font-display font-semibold text-ant-ink">{fmtCur(carried)}</span></span><span className="text-ant-mid font-semibold">+</span></>)}
                                                    <span className="inline-flex flex-col rounded-lg border border-ant-line bg-ant-light px-3 py-1.5"><span className="text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">Ce mois · {fmtNum(units)} u.</span><span className="font-display font-semibold text-ant-ink">{fmtCur(earned)}</span></span>
                                                    {paid > 0.005 && (<><span className="text-ant-mid font-semibold">−</span><span className="inline-flex flex-col rounded-lg border border-ant-green/25 bg-ant-green/10 px-3 py-1.5"><span className="text-[9px] uppercase tracking-[0.14em] text-ant-green font-semibold">Déjà versé</span><span className="font-display font-semibold text-ant-green">{fmtCur(paid)}</span></span></>)}
                                                    <span className="text-ant-mid font-semibold">=</span>
                                                    <span className="inline-flex flex-col rounded-lg border border-ant-orange/25 bg-ant-orange/10 px-3 py-1.5"><span className="text-[9px] uppercase tracking-[0.14em] text-ant-orange font-semibold">Doit</span><span className="font-display font-semibold text-ant-orange">{fmtCur(r.owe)} MAD</span></span>
                                                </div>
                                            </div>
                                        );
                                    }) : selectedMb.map((r) => {
                                        const isCommission = r.payment_type === 'commission';
                                        return (
                                            <div key={r.mediabuyer_id} className="rounded-2xl border border-ant-line bg-ant-paper p-4">
                                                <div className="flex items-center gap-2.5 mb-3">
                                                    <Avatar className="h-8 w-8 shrink-0 rounded-xl border border-ant-line"><AvatarImage src={r.avatar_url || ''} className="object-cover" /><AvatarFallback className="rounded-xl text-[10px] bg-ant-ink/5 text-ant-ink font-display font-semibold">{(r.name || '??').substring(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                                                    <p className="font-display text-[13px] font-semibold text-ant-ink truncate">{r.name}</p>
                                                    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold', isCommission ? 'bg-ant-orange/10 text-ant-orange' : 'bg-ant-green/10 text-ant-green')}>{r.payment_type}</span>
                                                </div>
                                                <div className="flex items-center flex-wrap gap-x-2 gap-y-1.5 text-[12px] tabular-nums">
                                                    {isCommission ? (
                                                        <span className="inline-flex flex-col rounded-lg border border-ant-line bg-ant-light px-3 py-1.5"><span className="text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">{fmtNum(r.delivered_orders)} livrées × {fmtCur(r.commission_price)}</span><span className="font-display font-semibold text-ant-ink">{fmtCur(r.commission_earned)}</span></span>
                                                    ) : (
                                                        <span className="inline-flex flex-col rounded-lg border border-ant-line bg-ant-light px-3 py-1.5"><span className="text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">Salaire fixe</span><span className="font-display font-semibold text-ant-ink">{fmtCur(r.salary_earned)}</span></span>
                                                    )}
                                                    {r.prior_paid_amount > 0.005 && (<><span className="text-ant-mid font-semibold">−</span><span className="inline-flex flex-col rounded-lg border border-ant-green/25 bg-ant-green/10 px-3 py-1.5"><span className="text-[9px] uppercase tracking-[0.14em] text-ant-green font-semibold">Déjà payé</span><span className="font-display font-semibold text-ant-green">{fmtCur(r.prior_paid_amount)}</span></span></>)}
                                                    <span className="text-ant-mid font-semibold">=</span>
                                                    <span className="inline-flex flex-col rounded-lg border border-ant-orange/25 bg-ant-orange/10 px-3 py-1.5"><span className="text-[9px] uppercase tracking-[0.14em] text-ant-orange font-semibold">À générer</span><span className="font-display font-semibold text-ant-orange">{fmtCur(r.remaining_amount)} MAD</span></span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* STEP 3 — amounts (seller editable) / confirm (media buyer) */}
                            {step === 'amount' && (
                                <div className="space-y-2.5">
                                    {isSeller ? selectedSellers.map((r) => {
                                        const owe = r.owe;
                                        const val = amounts[r.seller_id] ?? owe.toFixed(2);
                                        const over = parseFloat(val) > owe + 0.005;
                                        return (
                                            <div key={r.seller_id} className="rounded-2xl border border-ant-line bg-ant-paper p-4 flex items-center gap-3">
                                                <Avatar className="h-9 w-9 shrink-0 rounded-xl border border-ant-line"><AvatarImage src={r.avatar_url || ''} className="object-cover" /><AvatarFallback className="rounded-xl text-[10px] bg-ant-ink/5 text-ant-ink font-display font-semibold">{(r.name || '??').substring(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                                                <div className="flex-1 min-w-0"><p className="font-display text-[13px] font-semibold text-ant-ink truncate">{r.name}</p><p className="text-[11px] text-ant-mid tabular-nums">Doit <span className="font-semibold text-ant-orange">{fmtCur(owe)} MAD</span></p></div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <button type="button" onClick={() => setAmounts((p) => ({ ...p, [r.seller_id]: owe.toFixed(2) }))} className="h-9 px-2.5 rounded-lg border border-ant-line bg-ant-paper text-[10px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer" title="Full balance">Max</button>
                                                    <div className="relative">
                                                        <Input type="number" min={0} max={owe} step="0.01" value={val} onChange={(e) => setAmounts((p) => ({ ...p, [r.seller_id]: e.target.value }))} className={cn('h-9 w-32 pr-11 text-right rounded-lg border-ant-line bg-ant-paper text-[13px] font-semibold text-ant-ink tabular-nums focus-visible:ring-1 focus-visible:ring-ant-orange/40', over && 'border-ant-rose text-ant-rose')} />
                                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-ant-mid pointer-events-none">MAD</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }) : selectedMb.map((r) => (
                                        <div key={r.mediabuyer_id} className="rounded-2xl border border-ant-line bg-ant-paper p-4 flex items-center gap-3">
                                            <Avatar className="h-9 w-9 shrink-0 rounded-xl border border-ant-line"><AvatarImage src={r.avatar_url || ''} className="object-cover" /><AvatarFallback className="rounded-xl text-[10px] bg-ant-ink/5 text-ant-ink font-display font-semibold">{(r.name || '??').substring(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                                            <div className="flex-1 min-w-0"><p className="font-display text-[13px] font-semibold text-ant-ink truncate">{r.name}</p><p className="text-[11px] text-ant-mid capitalize">{r.payment_type} · {format(new Date(monthKey + '-01'), 'MMM yyyy')}</p></div>
                                            <div className="text-right shrink-0"><p className="text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">À générer</p><p className="font-display text-[15px] font-semibold text-ant-orange tabular-nums">{fmtCur(r.remaining_amount)} MAD</p></div>
                                        </div>
                                    ))}
                                    <p className="font-serif italic text-[11px] text-ant-mid px-1">
                                        {isSeller
                                            ? 'Amounts default to the full balance. Lower an amount to record a partial payment — the rest rolls into next month.'
                                            : 'Payouts are generated as pending at the full computed earning, then marked paid from the list.'}
                                    </p>
                                </div>
                            )}

                            {/* Info box */}
                            <div className="rounded-2xl border border-ant-line bg-ant-light/40 p-4 flex items-start gap-3">
                                <div className="h-8 w-8 rounded-lg bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center shrink-0"><Info className="w-3.5 h-3.5 text-ant-orange" /></div>
                                <div className="space-y-1 text-[12px] text-ant-ink leading-relaxed">
                                    <p>
                                        <span className="font-semibold">{isSeller ? 'Sellers' : 'Media buyers'}:</span>{' '}
                                        {isSeller
                                            ? 'Owe = carried-over balance + this month’s commission (units × price) − what was already paid this month.'
                                            : 'Salary type → full monthly salary. Commission type → delivered orders × commission price, minus prior payouts for the same month.'}
                                    </p>
                                    <p className="font-serif italic text-[11px] text-ant-mid">
                                        {isSeller
                                            ? 'No month to pick — sellers are always paid their current outstanding balance.'
                                            : 'Generated payouts are created as pending and must be marked paid from the list.'}
                                    </p>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Ink summary + footer actions */}
                <DialogFooter className="p-0 border-t border-ant-line">
                    <div className="w-full flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-4 bg-ant-ink text-white">
                        <div className="grid grid-cols-3 gap-6">
                            <div>
                                <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-white/55 inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-white" />Selected</p>
                                <p className="font-display text-[20px] font-semibold text-white mt-0.5 tabular-nums">{totals.users}</p>
                            </div>
                            <div>
                                <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-white/55 inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-ant-green" />{isSeller ? 'Units' : 'Delivered'}</p>
                                <p className="font-display text-[20px] font-semibold text-ant-green mt-0.5 tabular-nums">{fmtNum(totals.delivered)}</p>
                            </div>
                            <div>
                                <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-white/55 inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />{isSeller && step === 'amount' ? 'To pay' : 'Total'}</p>
                                <p className="font-display text-[20px] font-semibold text-ant-orange mt-0.5 tabular-nums" title={fmtCurFull(totals.amount)}>{fmtCur(totals.amount)}<span className="text-[11px] text-white/55 font-normal ml-1">MAD</span></p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-10 px-5 rounded-full text-[12px] font-semibold text-white/70 hover:text-white hover:bg-white/10 cursor-pointer">Cancel</Button>
                            {step !== 'select' && (
                                <Button variant="ghost" onClick={goBack} className="h-10 px-4 rounded-full text-[12px] font-semibold text-white/70 hover:text-white hover:bg-white/10 cursor-pointer gap-1.5"><ChevronLeft className="w-3.5 h-3.5" /> Back</Button>
                            )}
                            {step !== 'amount' ? (
                                <Button onClick={goNext} disabled={totals.users === 0} className="h-10 px-5 rounded-full bg-ant-orange hover:bg-ant-orange/90 text-white text-[12px] font-semibold gap-2 cursor-pointer disabled:opacity-40">
                                    {step === 'select' ? 'Review breakdown' : (isSeller ? 'Set amounts' : 'Confirm')} <ChevronRight className="w-3.5 h-3.5" />
                                </Button>
                            ) : (
                                <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending || totals.users === 0 || totals.amount < 0.005} className="h-10 px-5 rounded-full bg-ant-orange hover:bg-ant-orange/90 text-white text-[12px] font-semibold gap-2 cursor-pointer disabled:opacity-40">
                                    {generateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                    {isSeller ? `Pay ${totals.users} seller${totals.users !== 1 ? 's' : ''}` : `Generate ${totals.users} payout${totals.users !== 1 ? 's' : ''}`}
                                </Button>
                            )}
                        </div>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default Salaries;
