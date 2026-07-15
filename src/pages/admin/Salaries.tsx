import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';
import {
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
import { UserAvatar } from '@/components/users/UserAvatar';
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
                            The monthly ritual — commission accrues per collaborator, the ledger carries unpaid balances forward. Open a row, pay what's owed.
                        </p>
                    </div>
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
            </div>
        </div>
    );
};

// ═════════════════════════ Seller Payouts List ═════════════════════════
type PayoutStatus = 'pending' | 'partial' | 'paid';

const SellerPayoutsList: React.FC = () => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | PayoutStatus>('all');
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
    const sellerOpen = activeSeller ? (ledger.byId(activeSeller.seller_id)?.open ?? null) : null;
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
                                            <td className="px-3 py-4">
                                                <div className="flex items-center gap-3">
                                                    <UserAvatar
                                                        url={seller.avatar_url}
                                                        config={(seller as any).avatar_config}
                                                        name={seller.name}
                                                        className="h-9 w-9 shrink-0 rounded-lg border border-ant-line text-[11px] font-display font-semibold"
                                                    />
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
                                                    {!isOpen ? (
                                                        <span className="inline-flex items-center h-8 rounded-full px-3 text-[11px] font-semibold text-ant-mid bg-ant-light border border-ant-line">Clôturé</span>
                                                    ) : remaining <= 0.005 ? (
                                                        <span className="inline-flex items-center h-8 rounded-full px-3 text-[11px] font-semibold text-ant-green bg-ant-green/10 border border-ant-green/25">Réglé</span>
                                                    ) : (
                                                        <Button
                                                            size="sm"
                                                            onClick={() => openPay(seller.seller_id)}
                                                            className={cn(
                                                                'h-8 rounded-full px-3 text-[11px] font-semibold cursor-pointer text-white',
                                                                isPartial ? 'bg-ant-blue hover:bg-ant-blue/90' : 'bg-ant-ink hover:bg-ant-ink/90'
                                                            )}
                                                        >
                                                            {isPartial ? 'Continue' : 'Pay'}
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

            {activeSeller && (
                <>
                    <RecordPaymentDialog
                        open={recordOpen}
                        onOpenChange={setRecordOpen}
                        kind="seller"
                        payoutId={sellerOpen?.id || ''}
                        ticketId={sellerOpen?.id ?? null}
                        ledgerMonth={sellerOpen?.payout_month ?? null}
                        carriedIn={sellerOpen?.carried_in ?? null}
                        monthEarned={sellerOpen?.month_earned ?? null}
                        delivered={sellerOpen?.delivered_orders ?? null}
                        totalAmount={0}
                        paidAmount={sellerOpen?.paid_amount ?? 0}
                        collaboratorName={activeSeller.name}
                        collaboratorEmail={activeSeller.email}
                        collaboratorAvatarUrl={activeSeller.avatar_url}
                        collaboratorAvatarConfig={(activeSeller as any).avatar_config}
                        rate={activeSeller.commissionPrice}
                        rateUnit={activeSeller.commissionBasis === 'per_unit' ? 'unit' : 'order'}
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
    period_state?: 'open' | 'closed';
    carried_in?: number | string;
    month_earned?: number | string;
    carried_out?: number | string | null;
    created_at: string;
    paid_at: string | null;
    mediabuyer: { name: string; email: string; avatar_url: string | null; avatar_config?: unknown } | null;
};

const MediaBuyerPayoutsList: React.FC = () => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | PayoutStatus>('all');
    const [page, setPage] = useState(1);
    const PER_PAGE = 10;
    const [recordOpen, setRecordOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    // The seller half's shape, in full — it is a deliberate HYBRID and copying
    // only half of it is a trap:
    //   • a STABLE snapshot owns the mount guard + the static identity fields,
    //     so the dialog cannot vanish under the operator when a refetch is
    //     empty or in flight;
    //   • the LIVE query supplies ONLY the money figures, so invalidating
    //     ['mb-payouts'] actually moves `remaining`.
    // A frozen object alone makes the balance un-refreshable (after a payment
    // whose response was lost, the dialog would keep showing the pre-payment
    // balance and invite a duplicate — pay_mediabuyer records the amount
    // verbatim). A derived-only value alone unmounts the dialog mid-payment.
    // Both roles are needed. See the seller equivalents: activeSeller (:150,
    // guard :518) + sellerOpen (:288, figures :524-531).
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
                .select('*, mediabuyer:users!mediabuyer_payments_mediabuyer_id_fkey(name, email, avatar_url, avatar_config)')
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });
            if (error) {
                const { data: d2, error: e2 } = await (supabase as any)
                    .from('mediabuyer_payments')
                    .select('*, mediabuyer:users(name, email, avatar_url, avatar_config)')
                    .eq('DigiCom Business', activeBusinessId)
                    .order('created_at', { ascending: false });
                // THROW when the fallback also fails — never launder a failure into
                // an empty success. Returning [] told react-query "the business has
                // no payouts", replacing good cached data with nothing: the table
                // emptied and any open dialog lost its row. Throwing keeps the last
                // good data and lets retry/refetch-on-reconnect heal it.
                if (e2) throw e2;
                return (d2 || []) as MBPayout[];
            }
            return (data || []) as MBPayout[];
        },
        enabled: !!activeBusinessId,
    });

    // The live twin of `activeRow`, re-read from the query every render. Only
    // the MONEY figures ride this (see the dialog props below); the mount guard
    // stays on the snapshot. `?? null` degrades to the snapshot's own values
    // rather than blanking the dialog — the same null-tolerance the seller half
    // gets from `sellerOpen?.carried_in ?? null`.
    const activeRowLive = activeRow ? (payouts.find((p) => p.id === activeRow.id) ?? null) : null;
    // The money source for the open dialog: LIVE row when the query has it (so an
    // onSettled refetch moves "Reste à payer" and `paidAmount` — the figure that
    // makes remaining = total − paid collapse to 0 after a payment lands), else
    // the snapshot's last-known values. Never blanks, always refreshes.
    const mbMoney = activeRowLive ?? activeRow;



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
            if (p.payout_month.startsWith(thisMonthKey)) thisMonth += 1;
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
                e = { mediabuyer_id: id, name: p.mediabuyer?.name || '—', email: p.mediabuyer?.email || '', avatar_url: p.mediabuyer?.avatar_url || null, avatar_config: p.mediabuyer?.avatar_config ?? null, payouts: [], lifetimeEarned: 0, lifetimePaid: 0, owe: 0 } as MediaBuyerLedger;
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
                                            <td className="px-3 py-4">
                                                <div className="flex items-center gap-3">
                                                    <UserAvatar
                                                        url={p.mediabuyer?.avatar_url}
                                                        config={(p.mediabuyer as any)?.avatar_config}
                                                        name={p.mediabuyer?.name}
                                                        className="h-9 w-9 shrink-0 rounded-lg border border-ant-line text-[11px] font-display font-semibold"
                                                    />
                                                    <div className="min-w-0">
                                                        <p className="font-display text-[13px] font-semibold text-ant-ink leading-tight truncate">{p.mediabuyer?.name || '—'}</p>
                                                        <p className="text-[11px] text-ant-mid/80 leading-tight truncate mt-0.5">{p.mediabuyer?.email}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-4">
                                                <p className="font-display text-[12px] font-semibold text-ant-ink capitalize whitespace-nowrap">{format(new Date(p.payout_month), 'MMM yyyy')}</p>
                                                <p className="text-[10px] text-ant-mid/80 italic">{p.period_state === 'closed' ? 'clôturé' : 'mois en cours'}</p>
                                            </td>
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
                                                    {p.period_state === 'closed' ? (
                                                        <span className="inline-flex items-center h-8 rounded-full px-3 text-[11px] font-semibold text-ant-mid bg-ant-light border border-ant-line">Clôturé</span>
                                                    ) : isPaid ? (
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
                                                            {isPartial ? 'Continue' : 'Pay'}
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
                        mbLiveId={activeRow.mediabuyer_id}
                        ticketId={activeRow.id}
                        ledgerMonth={activeRow.payout_month}
                        carriedIn={Number(mbMoney.carried_in || 0)}
                        monthEarned={Number(mbMoney.month_earned || 0)}
                        delivered={Number(mbMoney.delivered_orders || 0)}
                        totalAmount={Number(mbMoney.total_amount || 0)}
                        paidAmount={Number(mbMoney.paid_amount || 0)}
                        collaboratorName={activeRow.mediabuyer?.name || 'Media buyer'}
                        collaboratorEmail={activeRow.mediabuyer?.email}
                        collaboratorAvatarUrl={activeRow.mediabuyer?.avatar_url}
                        collaboratorAvatarConfig={(activeRow.mediabuyer as any)?.avatar_config}
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
                buyerAvatarConfig={(detailPayoutRow?.mediabuyer as any)?.avatar_config ?? null}
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

export default Salaries;
