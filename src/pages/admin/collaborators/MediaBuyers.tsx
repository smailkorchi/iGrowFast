import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { supabase } from '@/lib/supabase';
import {
    Search,
    Megaphone,
    X,
    Phone,
    Mail,
    Wallet,
    PackageCheck,
    Target,
    Coins,
    TrendingUp,
    Sparkles,
    ArrowUpRight,
    CreditCard,
    ShieldCheck,
    User as UserIcon,
    Hash,
    Play,
    Pause,
    type LucideIcon,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { fmtCur, fmtCurFull, fmtNum } from '@/lib/formatNumbers';
import { useMediaBuyerEarnings } from '@/hooks/useMediaBuyerEarnings';
import { getPlatformIcon } from '@/lib/campaignConstants';

type PayoutRow = {
    id: string;
    mediabuyer_id: string;
    payout_month: string;
    total_amount: number | string;
    status: 'pending' | 'paid';
    paid_at: string | null;
    created_at: string;
};

type CampaignRow = {
    id: string;
    created_by: string | null;
    name: string;
    platform: string;
    status: 'active' | 'draft';
};

const KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

const MbKpi: React.FC<{
    label: string;
    value: number | string;
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

const MediaBuyers = () => {
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const currentMonth = useMemo(() => format(new Date(), 'yyyy-MM'), []);
    const { rows: earnings, isLoading } = useMediaBuyerEarnings(currentMonth);
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<'spend' | 'delivered' | 'payroll' | 'unpaid'>('spend');

    const { data: allPayouts = [] } = useQuery<PayoutRow[]>({
        queryKey: ['mb-all-payouts', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('mediabuyer_payments')
                .select('id, mediabuyer_id, payout_month, total_amount, status, paid_at, created_at')
                .eq('DigiCom Business', activeBusinessId)
                .order('payout_month', { ascending: false });
            if (error) throw error;
            return (data || []) as PayoutRow[];
        },
        enabled: !!activeBusinessId,
    });

    const { data: allCampaigns = [] } = useQuery<CampaignRow[]>({
        queryKey: ['mb-all-campaigns', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('campaigns')
                .select('id, created_by, name, platform, status')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return (data || []) as CampaignRow[];
        },
        enabled: !!activeBusinessId,
    });

    const filtered = useMemo(() => {
        const q = search.toLowerCase().trim();
        const list = q
            ? earnings.filter(
                  (r) =>
                      r.name.toLowerCase().includes(q) ||
                      r.email.toLowerCase().includes(q) ||
                      (r.phone || '').toLowerCase().includes(q)
              )
            : [...earnings];

        return list.sort((a, b) => {
            if (sortBy === 'spend') return b.total_spend - a.total_spend;
            if (sortBy === 'delivered') return b.delivered_orders - a.delivered_orders;
            if (sortBy === 'payroll') return b.total_amount - a.total_amount;
            if (sortBy === 'unpaid') return b.remaining_amount - a.remaining_amount;
            return 0;
        });
    }, [earnings, search, sortBy]);

    const rankMap = useMemo(() => {
        const sorted = [...earnings].sort((a, b) => b.total_spend - a.total_spend);
        const map = new Map<string, number>();
        sorted.forEach((r, i) => map.set(r.mediabuyer_id, i + 1));
        return map;
    }, [earnings]);

    const totals = useMemo(() => {
        return earnings.reduce(
            (acc, r) => {
                acc.totalSpend += r.total_spend;
                acc.totalDelivered += r.delivered_orders;
                acc.totalAmount += r.total_amount;
                acc.unpaidAmount += r.remaining_amount;
                acc.active += 1;
                return acc;
            },
            { totalSpend: 0, totalDelivered: 0, totalAmount: 0, unpaidAmount: 0, active: 0 }
        );
    }, [earnings]);

    const selected = useMemo(() => earnings.find((e) => e.mediabuyer_id === selectedId) || null, [earnings, selectedId]);
    const selectedPayouts = useMemo(
        () => (selected ? allPayouts.filter((p) => p.mediabuyer_id === selected.mediabuyer_id) : []),
        [selected, allPayouts]
    );
    const selectedCampaigns = useMemo(
        () => (selected ? allCampaigns.filter((c) => c.created_by === selected.mediabuyer_id) : []),
        [selected, allCampaigns]
    );

    const paymentPill = (type?: string | null) => {
        if (type === 'commission') return { bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', text: 'text-ant-orange', dot: 'bg-ant-orange', label: 'Commission' };
        if (type === 'salary') return { bg: 'bg-ant-green/10', border: 'border-ant-green/25', text: 'text-ant-green', dot: 'bg-ant-green', label: 'Salary' };
        return { bg: 'bg-ant-light', border: 'border-ant-line', text: 'text-ant-mid', dot: 'bg-ant-mid', label: 'N/A' };
    };

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Collaborators · Media buyers
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Media Buyers
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            The budget-holders of attention — spend watched, deliveries counted, commission tallied. This month&rsquo;s scoreboard is below.
                        </p>
                    </div>
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-paper px-3 h-9 text-[12px] font-semibold text-ant-ink shrink-0">
                        <Target className="w-3.5 h-3.5 text-ant-orange" />
                        <span className="tabular-nums">
                            {format(startOfMonth(new Date()), 'MMM dd')} – {format(endOfMonth(new Date()), 'MMM dd')}
                        </span>
                        <span className="text-ant-mid font-normal">scope</span>
                    </div>
                </header>

                {/* KPI strip */}
                <section className="grid grid-cols-2 md:grid-cols-5 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                    <MbKpi label="Media buyers" value={earnings.length} suffix="active" accent="ink" icon={UserIcon} />
                    <MbKpi label="Spend · month" value={fmtCur(totals.totalSpend)} suffix="MAD" accent="rose" icon={Coins} />
                    <MbKpi label="Delivered · month" value={fmtNum(totals.totalDelivered)} suffix="orders" accent="green" icon={PackageCheck} />
                    <MbKpi label="Payroll · month" value={fmtCur(totals.totalAmount)} suffix="MAD" accent="ink" icon={Wallet} />
                    <MbKpi label="Unpaid" value={fmtCur(totals.unpaidAmount)} suffix="MAD" accent="orange" icon={CreditCard} />
                </section>

                {/* Search + Sort toolbar */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="relative w-full md:w-[340px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                        <Input
                            placeholder="Search name, email, phone..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-9 h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                        />
                    </div>

                    <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper">
                        {([
                            { key: 'spend', label: 'Spend' },
                            { key: 'delivered', label: 'Delivered' },
                            { key: 'payroll', label: 'Payroll' },
                            { key: 'unpaid', label: 'Unpaid' },
                        ] as const).map((t) => {
                            const active = sortBy === t.key;
                            return (
                                <button
                                    key={t.key}
                                    onClick={() => setSortBy(t.key)}
                                    className={cn(
                                        'inline-flex items-center rounded-full px-3.5 h-8 text-[11px] font-semibold transition cursor-pointer whitespace-nowrap',
                                        active ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink'
                                    )}
                                >
                                    {t.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Roster grid */}
                {isLoading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="h-60 rounded-2xl bg-ant-light animate-pulse" />
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                        <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                            <Megaphone className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                        </div>
                        <h3 className="font-display text-[18px] text-ant-ink tracking-tight">
                            {earnings.length ? 'No media buyers match that search' : 'No media buyers yet'}
                        </h3>
                        <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                            {earnings.length
                                ? 'Loosen the search to bring the team back into view.'
                                : 'Create a media-buyer user from the Users page — their spend and campaigns will surface here.'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {filtered.map((r) => {
                            const rank = rankMap.get(r.mediabuyer_id) ?? 0;
                            const pp = paymentPill(r.payment_type);
                            const hasUnpaid = r.remaining_amount > 0;

                            return (
                                <div
                                    key={r.mediabuyer_id}
                                    onClick={() => setSelectedId(r.mediabuyer_id)}
                                    className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper cursor-pointer hover:border-ant-ink/20 hover:shadow-[0_16px_48px_-20px_rgba(20,20,19,0.15)] transition-all group"
                                >
                                    <div className="h-[3px] w-full bg-ant-orange" />
                                    <div className="p-4 space-y-3">
                                        <div className="flex items-start gap-3">
                                            <Avatar className="h-12 w-12 shrink-0 rounded-2xl border border-ant-line">
                                                <AvatarImage src={r.avatar_url || ''} className="object-cover" />
                                                <AvatarFallback className="rounded-2xl bg-ant-ink/5 text-ant-ink font-display font-semibold text-[14px]">
                                                    {r.name.substring(0, 2).toUpperCase()}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <h3 className="font-display text-[14px] font-semibold text-ant-ink truncate">{r.name}</h3>
                                                    <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-ant-mid tabular-nums">
                                                        #{rank}
                                                    </span>
                                                </div>
                                                <p className="text-[11px] text-ant-mid truncate mt-0.5">{r.email}</p>
                                            </div>
                                            <ArrowUpRight className="w-4 h-4 text-ant-mid opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                                        </div>

                                        {/* Payment type + campaigns count */}
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold', pp.bg, pp.border, pp.text)}>
                                                <span className={cn('h-1.5 w-1.5 rounded-full', pp.dot)} />
                                                {pp.label}
                                                {r.payment_type === 'commission' && (
                                                    <span className="text-ant-mid font-normal ml-1 tabular-nums">
                                                        {fmtCur(r.commission_price)} / deliv
                                                    </span>
                                                )}
                                                {r.payment_type === 'salary' && (
                                                    <span className="text-ant-mid font-normal ml-1 tabular-nums">
                                                        {fmtCur(r.salary_amount)} / mo
                                                    </span>
                                                )}
                                            </span>
                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-ink tabular-nums">
                                                <Hash className="w-2.5 h-2.5 text-ant-mid" />
                                                {r.campaigns_count} campaigns
                                            </span>
                                        </div>

                                        {/* 4-col hairline stats */}
                                        <div className="grid grid-cols-4 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                                            <div className="bg-ant-paper px-2.5 py-2">
                                                <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Spend</p>
                                                <p className="text-[12px] font-semibold text-ant-rose tabular-nums truncate" title={fmtCurFull(r.total_spend)}>
                                                    {fmtCur(r.total_spend)}
                                                </p>
                                            </div>
                                            <div className="bg-ant-paper px-2.5 py-2">
                                                <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Deliv</p>
                                                <p className="text-[12px] font-semibold text-ant-green tabular-nums">{fmtNum(r.delivered_orders)}</p>
                                            </div>
                                            <div className="bg-ant-paper px-2.5 py-2">
                                                <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Payroll</p>
                                                <p className="text-[12px] font-semibold text-ant-ink tabular-nums truncate" title={fmtCurFull(r.total_amount)}>
                                                    {fmtCur(r.total_amount)}
                                                </p>
                                            </div>
                                            <div className="bg-ant-paper px-2.5 py-2">
                                                <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Unpaid</p>
                                                <p className={cn('text-[12px] font-semibold tabular-nums truncate', hasUnpaid ? 'text-ant-orange' : 'text-ant-mid')} title={fmtCurFull(r.remaining_amount)}>
                                                    {fmtCur(r.remaining_amount)}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Footer: unpaid highlight */}
                                        <div className="flex items-center justify-between pt-2 border-t border-ant-line">
                                            <span className={cn(
                                                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                                                hasUnpaid ? 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' : 'bg-ant-green/10 border-ant-green/25 text-ant-green'
                                            )}>
                                                <span className={cn('h-1.5 w-1.5 rounded-full', hasUnpaid ? 'bg-ant-orange' : 'bg-ant-green')} />
                                                {hasUnpaid ? 'Pays due' : 'Settled'}
                                            </span>
                                            <div className="text-right">
                                                <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Remaining</p>
                                                <p className="font-display text-[14px] font-semibold text-ant-ink tabular-nums" title={fmtCurFull(r.remaining_amount)}>
                                                    {fmtCur(r.remaining_amount)}
                                                    <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Detail drawer */}
            <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
                <SheetContent className="ant-surface sm:max-w-md overflow-y-auto ant-scroll border-l border-ant-line bg-ant-paper p-0">
                    {selected && (() => {
                        const pp = paymentPill(selected.payment_type);
                        const hasUnpaid = selected.remaining_amount > 0;
                        return (
                            <div className="flex flex-col h-full">
                                {/* Editorial header */}
                                <div className="px-6 pt-6 pb-4 border-b border-ant-line">
                                    <div className="flex items-start gap-3">
                                        <Avatar className="h-14 w-14 shrink-0 rounded-2xl border border-ant-line">
                                            <AvatarImage src={selected.avatar_url || ''} className="object-cover" />
                                            <AvatarFallback className="rounded-2xl bg-ant-ink/5 text-ant-ink font-display font-semibold text-[18px]">
                                                {selected.name.substring(0, 2).toUpperCase()}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="flex-1 min-w-0 space-y-1.5">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                                Media buyer · Profile
                                            </div>
                                            <h2 className="font-display text-[20px] leading-tight tracking-tight text-ant-ink truncate">{selected.name}</h2>
                                            <p className="text-[12px] text-ant-mid truncate">{selected.email}</p>
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold', pp.bg, pp.border, pp.text)}>
                                                    <span className={cn('h-1.5 w-1.5 rounded-full', pp.dot)} />
                                                    {selected.payment_type === 'commission'
                                                        ? `Commission · ${fmtCur(selected.commission_price)}/deliv`
                                                        : selected.payment_type === 'salary'
                                                        ? `Salary · ${fmtCur(selected.salary_amount)}/month`
                                                        : 'N/A'}
                                                </span>
                                            </div>
                                        </div>
                                        <Button variant="ghost" size="icon" onClick={() => setSelectedId(null)} className="h-9 w-9 rounded-full hover:bg-ant-ink/5 text-ant-mid shrink-0 cursor-pointer">
                                            <X className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>

                                <div className="p-6 space-y-5 flex-1 overflow-y-auto ant-scroll">
                                    {/* Contact */}
                                    <section className="space-y-2">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <Phone className="w-3 h-3" />
                                            Contact
                                        </div>
                                        <div className="grid grid-cols-1 gap-2">
                                            <ContactRow icon={Phone} label="Phone" value={selected.phone || '—'} />
                                            <ContactRow icon={Mail} label="Email" value={selected.email} />
                                        </div>
                                    </section>

                                    {/* Performance */}
                                    <section className="space-y-3">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <Target className="w-3 h-3" />
                                            Performance · month
                                        </div>
                                        <div className="grid grid-cols-2 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                                            <MbKpi label="Campaigns" value={selected.campaigns_count} suffix="created" accent="ink" icon={Megaphone} />
                                            <MbKpi label="Spend" value={fmtCur(selected.total_spend)} suffix="MAD" accent="rose" icon={Coins} />
                                            <MbKpi label="Delivered" value={fmtNum(selected.delivered_orders)} suffix="orders" accent="green" icon={PackageCheck} />
                                            <MbKpi label="Payroll" value={fmtCur(selected.total_amount)} suffix="MAD" accent="orange" icon={Wallet} />
                                        </div>
                                    </section>

                                    {/* Ink financial panel */}
                                    <section className="rounded-2xl border border-ant-ink bg-ant-ink text-white overflow-hidden">
                                        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/55">
                                                <TrendingUp className="w-3 h-3" />
                                                Monthly payout
                                            </div>
                                            <Sparkles className="w-3.5 h-3.5 text-ant-orange/70" />
                                        </div>
                                        <div className="px-5 pb-4">
                                            <p className="font-display text-[28px] font-semibold text-white tabular-nums" title={fmtCurFull(selected.total_amount)}>
                                                {fmtCur(selected.total_amount)}
                                                <span className="text-[12px] text-white/55 font-normal ml-2">MAD owed</span>
                                            </p>
                                            <p className="font-serif italic text-[11px] text-white/55 mt-1">
                                                {selected.payment_type === 'commission'
                                                    ? `${fmtCur(selected.commission_price)} × ${fmtNum(selected.delivered_orders)} delivered orders this month.`
                                                    : selected.payment_type === 'salary'
                                                    ? 'Fixed monthly salary across all campaigns.'
                                                    : 'Payment structure not configured yet.'}
                                            </p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-px bg-white/10 border-t border-white/10">
                                            <div className="bg-ant-ink px-5 py-3">
                                                <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-white/55 inline-flex items-center gap-1.5">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                                    Unpaid
                                                </p>
                                                <p className={cn('font-display text-[16px] font-semibold mt-0.5 tabular-nums', hasUnpaid ? 'text-ant-orange' : 'text-white/40')} title={fmtCurFull(selected.remaining_amount)}>
                                                    {fmtCur(selected.remaining_amount)} <span className="text-[10px] text-white/55 font-normal">MAD</span>
                                                </p>
                                            </div>
                                            <div className="bg-ant-ink px-5 py-3">
                                                <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-white/55 inline-flex items-center gap-1.5">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                                                    Campaigns
                                                </p>
                                                <p className="font-display text-[16px] font-semibold text-white mt-0.5 tabular-nums">
                                                    {selected.campaigns_count} <span className="text-[10px] text-white/55 font-normal">running</span>
                                                </p>
                                            </div>
                                        </div>
                                    </section>

                                    {/* Bank details */}
                                    <section className="rounded-2xl border border-ant-line bg-ant-paper p-5 space-y-3">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <ShieldCheck className="w-3 h-3" />
                                            Bank details
                                        </div>
                                        <div className="divide-y divide-ant-line">
                                            {[
                                                { label: 'Bank', value: selected.bank_name || '—' },
                                                { label: 'Holder', value: selected.bank_account_holder || '—' },
                                                { label: 'RIB', value: selected.bank_rib || '—', mono: true },
                                                { label: 'CIN', value: selected.cin_number || '—' },
                                            ].map((r) => (
                                                <div key={r.label} className="flex justify-between items-center py-2.5">
                                                    <span className="text-[11px] font-semibold text-ant-mid uppercase tracking-[0.18em]">{r.label}</span>
                                                    <span className={cn('text-[12px] text-ant-ink truncate text-right', r.mono && 'font-mono tabular-nums')}>
                                                        {r.value}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </section>

                                    {/* Active campaigns */}
                                    <section className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <Megaphone className="w-3 h-3" />
                                                Campaigns
                                            </div>
                                            <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-ink tabular-nums">
                                                {selectedCampaigns.length}
                                            </span>
                                        </div>
                                        {selectedCampaigns.length === 0 ? (
                                            <p className="font-serif italic text-[12px] text-ant-mid py-6 text-center border border-dashed border-ant-line rounded-2xl">
                                                No campaigns yet.
                                            </p>
                                        ) : (
                                            <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden ant-scroll max-h-[240px] overflow-y-auto">
                                                {selectedCampaigns.map((c) => {
                                                    const isActive = c.status === 'active';
                                                    return (
                                                        <div key={c.id} className="flex items-center gap-3 px-4 py-3 border-b border-ant-line last:border-0 hover:bg-ant-light/60 transition-colors">
                                                            <div className="w-9 h-9 rounded-xl border border-ant-line bg-ant-light flex items-center justify-center shrink-0 text-ant-ink">
                                                                {getPlatformIcon(c.platform, 'w-4 h-4')}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-[12px] font-semibold text-ant-ink truncate">{c.name}</p>
                                                                <p className="text-[10px] text-ant-mid uppercase tracking-[0.18em] font-semibold">{c.platform}</p>
                                                            </div>
                                                            <span className={cn(
                                                                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize',
                                                                isActive ? 'bg-ant-green/10 border-ant-green/25 text-ant-green' : 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange'
                                                            )}>
                                                                <span className={cn('h-1.5 w-1.5 rounded-full', isActive ? 'bg-ant-green' : 'bg-ant-orange')} />
                                                                {c.status}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </section>

                                    {/* Payout history */}
                                    <section className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <Wallet className="w-3 h-3" />
                                                Payout history
                                            </div>
                                            <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-ink tabular-nums">
                                                {selectedPayouts.length}
                                            </span>
                                        </div>
                                        {selectedPayouts.length === 0 ? (
                                            <p className="font-serif italic text-[12px] text-ant-mid py-6 text-center border border-dashed border-ant-line rounded-2xl">
                                                No payouts yet.
                                            </p>
                                        ) : (
                                            <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden ant-scroll max-h-[240px] overflow-y-auto">
                                                {selectedPayouts.map((p) => {
                                                    const paid = p.status === 'paid';
                                                    return (
                                                        <div key={p.id} className="flex items-center gap-3 px-4 py-3 border-b border-ant-line last:border-0 hover:bg-ant-light/60 transition-colors">
                                                            <div className={cn('h-9 w-9 rounded-xl border flex items-center justify-center shrink-0', paid ? 'bg-ant-green/10 border-ant-green/25 text-ant-green' : 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange')}>
                                                                <Wallet className="w-4 h-4" strokeWidth={1.75} />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <p className="font-display text-[14px] font-semibold text-ant-ink tabular-nums">
                                                                    {fmtCurFull(Number(p.total_amount || 0))} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                                                </p>
                                                                <p className="text-[11px] text-ant-mid tabular-nums">{p.payout_month}</p>
                                                            </div>
                                                            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize', paid ? 'bg-ant-green/10 border-ant-green/25 text-ant-green' : 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange')}>
                                                                <span className={cn('h-1.5 w-1.5 rounded-full', paid ? 'bg-ant-green' : 'bg-ant-orange')} />
                                                                {p.status}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </section>
                                </div>
                            </div>
                        );
                    })()}
                </SheetContent>
            </Sheet>
        </div>
    );
};

const ContactRow: React.FC<{ icon: LucideIcon; label: string; value: string }> = ({ icon: Icon, label, value }) => (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-ant-line bg-ant-paper">
        <div className="h-8 w-8 rounded-lg bg-ant-light border border-ant-line flex items-center justify-center shrink-0">
            <Icon className="w-3.5 h-3.5 text-ant-ink" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-ant-mid">{label}</p>
            <p className="text-[12px] font-semibold text-ant-ink truncate">{value}</p>
        </div>
    </div>
);

export default MediaBuyers;
