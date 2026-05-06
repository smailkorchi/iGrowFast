import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Search,
    Truck,
    Phone,
    Mail,
    PackageCheck,
    RotateCcw,
    CreditCard,
    Loader2,
    X,
    TrendingUp,
    Package,
    Coins,
    Bike,
    MapPin,
    Sparkles,
    ArrowUpRight,
    type LucideIcon,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { useTrackedOrders } from '@/hooks/useTrackedOrders';
import { isAdminPullback } from '@/lib/analyticsDefinitions';
import { fmtCur, fmtCurFull, fmtNum } from '@/lib/formatNumbers';

type Courier = {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    avatar_url: string | null;
    address: string | null;
    active: boolean | null;
    created_at: string;
};

type OrderRow = {
    id: string;
    courier_id: string | null;
    order_status_id: string | null;
    package_status_id: string | null;
    shipping_cost: number | string | null;
    include_delivery_in_total: boolean | null;
    master_city_id: string | null;
};

type CourierFeeRow = {
    courier_id: string;
    master_city_id: string;
    fee: number | string | null;
};

type PaymentNote = {
    id: string;
    courier_id: string;
    status: string;
    total_amount: number | string;
    total_shipping_fees: number | string;
    net_amount: number | string;
    order_count: number;
    paid_at: string | null;
    created_at: string;
};

const KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

const CourierKpi: React.FC<{
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

const deliveryTier = (rate: number) => {
    if (rate >= 70) return { stripe: 'bg-ant-green', text: 'text-ant-green', bg: 'bg-ant-green/10', border: 'border-ant-green/25', dot: 'bg-ant-green', label: 'Strong' };
    if (rate >= 40) return { stripe: 'bg-ant-orange', text: 'text-ant-orange', bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', dot: 'bg-ant-orange', label: 'Steady' };
    return { stripe: 'bg-ant-rose', text: 'text-ant-rose', bg: 'bg-ant-rose/10', border: 'border-ant-rose/25', dot: 'bg-ant-rose', label: 'At risk' };
};

const Couriers = () => {
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const { deliveredPkgIds, shippedPkgIds, returnedPkgIds, adminPullbackOrderIds, adminPullbackPackageIds } = useStatusCategories();
    const { trackedOrderIds } = useTrackedOrders(activeBusinessId);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<Courier | null>(null);
    const [sortBy, setSortBy] = useState<'rate' | 'delivered' | 'orders' | 'unpaid'>('rate');

    const { data: couriers = [], isLoading: loadingCouriers } = useQuery<Courier[]>({
        queryKey: ['couriers', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, email, phone, avatar_url, address, active, created_at')
                .eq('DigiCom Business', activeBusinessId)
                .eq('role', 'courier')
                .order('name');
            if (error) throw error;
            return (data || []) as Courier[];
        },
        enabled: !!activeBusinessId,
    });

    const courierIds = useMemo(() => couriers.map((c) => c.id), [couriers]);

    const { data: orders = [] } = useQuery<OrderRow[]>({
        queryKey: ['couriers-orders', activeBusinessId, courierIds.sort().join(',')],
        queryFn: async () => {
            if (!activeBusinessId || courierIds.length === 0) return [];
            const { data, error } = await (supabase as any)
                .from('orders')
                .select('id, courier_id, order_status_id, package_status_id, shipping_cost, include_delivery_in_total, master_city_id')
                .eq('DigiCom Business', activeBusinessId)
                .in('courier_id', courierIds)
                .is('date_deleted', null);
            if (error) throw error;
            return (data || []) as OrderRow[];
        },
        enabled: !!activeBusinessId && courierIds.length > 0,
    });

    const { data: courierFees = [] } = useQuery<CourierFeeRow[]>({
        queryKey: ['couriers-fees', activeBusinessId, courierIds.sort().join(',')],
        queryFn: async () => {
            if (!activeBusinessId || courierIds.length === 0) return [];
            const { data, error } = await (supabase as any)
                .from('courier_fees')
                .select('courier_id, master_city_id, fee')
                .in('courier_id', courierIds);
            if (error) throw error;
            return (data || []) as CourierFeeRow[];
        },
        enabled: !!activeBusinessId && courierIds.length > 0,
    });

    const feeLookup = useMemo(() => {
        const map = new Map<string, number>();
        for (const f of courierFees) {
            map.set(`${f.courier_id}:${f.master_city_id}`, Number(f.fee || 0));
        }
        return map;
    }, [courierFees]);

    const { data: paymentNotes = [] } = useQuery<PaymentNote[]>({
        queryKey: ['couriers-payment-notes', activeBusinessId, courierIds.sort().join(',')],
        queryFn: async () => {
            if (!activeBusinessId || courierIds.length === 0) return [];
            const { data, error } = await (supabase as any)
                .from('courier_payment_notes')
                .select('id, courier_id, status, total_amount, total_shipping_fees, net_amount, order_count, paid_at, created_at')
                .eq('DigiCom Business', activeBusinessId)
                .in('courier_id', courierIds)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (data || []) as PaymentNote[];
        },
        enabled: !!activeBusinessId && courierIds.length > 0,
    });

    const stats = useMemo(() => {
        const m = new Map<
            string,
            {
                totalOrders: number;
                confirmed: number;
                inTransit: number;
                delivered: number;
                returned: number;
                totalShippingFees: number;
                totalPaid: number;
                totalUnpaid: number;
                notesCount: number;
            }
        >();
        for (const c of couriers) {
            m.set(c.id, { totalOrders: 0, confirmed: 0, inTransit: 0, delivered: 0, returned: 0, totalShippingFees: 0, totalPaid: 0, totalUnpaid: 0, notesCount: 0 });
        }
        for (const o of orders) {
            if (!o.courier_id) continue;
            const row = m.get(o.courier_id);
            if (!row) continue;
            row.totalOrders += 1;
            // Delivery-rate denominator (Coliaty): tracked orders minus admin pullbacks.
            if (!!o.id && trackedOrderIds.has(o.id)) {
                const pullback = isAdminPullback(
                    o as any,
                    true,
                    adminPullbackOrderIds,
                    adminPullbackPackageIds,
                );
                if (!pullback) row.confirmed += 1;
            }
            if (o.package_status_id && deliveredPkgIds.has(o.package_status_id)) {
                row.delivered += 1;
                const override = o.include_delivery_in_total
                    ? Number(o.shipping_cost || 0)
                    : null;
                const fallback = o.master_city_id
                    ? (feeLookup.get(`${o.courier_id}:${o.master_city_id}`) ?? 0)
                    : 0;
                row.totalShippingFees += override !== null ? override : fallback;
            } else if (o.package_status_id && shippedPkgIds.has(o.package_status_id)) {
                row.inTransit += 1;
            } else if (o.package_status_id && returnedPkgIds.has(o.package_status_id)) {
                row.returned += 1;
            }
        }
        for (const n of paymentNotes) {
            const row = m.get(n.courier_id);
            if (!row) continue;
            row.notesCount += 1;
            const fees = Number(n.total_shipping_fees || 0);
            if (n.status === 'paid') row.totalPaid += fees;
            else row.totalUnpaid += fees;
        }
        return m;
    }, [couriers, orders, paymentNotes, deliveredPkgIds, shippedPkgIds, returnedPkgIds, adminPullbackOrderIds, adminPullbackPackageIds, trackedOrderIds, feeLookup]);

    const rankMap = useMemo(() => {
        const sorted = [...couriers].sort((a, b) => {
            const sa = stats.get(a.id);
            const sb = stats.get(b.id);
            return (sb?.delivered || 0) - (sa?.delivered || 0);
        });
        const map = new Map<string, number>();
        sorted.forEach((c, i) => map.set(c.id, i + 1));
        return map;
    }, [couriers, stats]);

    const filtered = useMemo(() => {
        const q = search.toLowerCase().trim();
        const list = q
            ? couriers.filter(
                  (c) =>
                      c.name.toLowerCase().includes(q) ||
                      c.email.toLowerCase().includes(q) ||
                      (c.phone || '').toLowerCase().includes(q)
              )
            : [...couriers];

        return list.sort((a, b) => {
            const sa = stats.get(a.id);
            const sb = stats.get(b.id);
            if (sortBy === 'rate') {
                const ra = sa && sa.confirmed > 0 ? sa.delivered / sa.confirmed : 0;
                const rb = sb && sb.confirmed > 0 ? sb.delivered / sb.confirmed : 0;
                return rb - ra;
            }
            if (sortBy === 'delivered') return (sb?.delivered || 0) - (sa?.delivered || 0);
            if (sortBy === 'orders') return (sb?.totalOrders || 0) - (sa?.totalOrders || 0);
            if (sortBy === 'unpaid') return (sb?.totalUnpaid || 0) - (sa?.totalUnpaid || 0);
            return 0;
        });
    }, [couriers, search, stats, sortBy]);

    const totals = useMemo(() => {
        let totalOrders = 0;
        let totalDelivered = 0;
        let totalShipping = 0;
        let totalUnpaid = 0;
        stats.forEach((s) => {
            totalOrders += s.totalOrders;
            totalDelivered += s.delivered;
            totalShipping += s.totalShippingFees;
            totalUnpaid += s.totalUnpaid;
        });
        return { totalOrders, totalDelivered, totalShipping, totalUnpaid };
    }, [stats]);

    return (
        <div className="ant-surface min-h-screen">
            <div className="mx-auto max-w-[1440px] px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Collaborators · Delivery crew
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Couriers
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Miles, doors, collections — the fleet that turns a confirmed order into a delivered one. Each profile below is a ledger of those miles.
                        </p>
                    </div>
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-paper px-3 h-9 text-[12px] font-semibold text-ant-ink shrink-0">
                        <Bike className="w-3.5 h-3.5 text-ant-orange" />
                        <span className="tabular-nums">{couriers.length}</span>
                        <span className="text-ant-mid font-normal">couriers</span>
                    </div>
                </header>

                {/* KPI strip */}
                <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                    <CourierKpi label="Couriers" value={couriers.length} suffix="active" accent="ink" icon={Bike} />
                    <CourierKpi label="Total orders" value={fmtNum(totals.totalOrders)} suffix="shipments" accent="orange" icon={Package} />
                    <CourierKpi label="Delivered" value={fmtNum(totals.totalDelivered)} suffix="to door" accent="green" icon={PackageCheck} />
                    <CourierKpi label="Unpaid notes" value={fmtCur(totals.totalUnpaid)} suffix="MAD" accent="rose" icon={Coins} />
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
                            { key: 'rate', label: 'Rate' },
                            { key: 'delivered', label: 'Delivered' },
                            { key: 'orders', label: 'Orders' },
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

                {/* Courier roster grid */}
                {loadingCouriers ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="h-56 rounded-2xl bg-ant-light animate-pulse" />
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                        <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                            <Truck className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                        </div>
                        <h3 className="font-display text-[18px] text-ant-ink tracking-tight">
                            {couriers.length ? 'No couriers match that search' : 'No couriers yet'}
                        </h3>
                        <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                            {couriers.length
                                ? 'Loosen the search to bring the fleet back into view.'
                                : 'Create a courier user from the Users page and the fleet ledger starts here.'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {filtered.map((c) => {
                            const s = stats.get(c.id);
                            const rate = s && s.confirmed > 0 ? (s.delivered / s.confirmed) * 100 : 0;
                            const tier = deliveryTier(rate);
                            const rank = rankMap.get(c.id) ?? 0;
                            const isActive = c.active !== false;

                            return (
                                <div
                                    key={c.id}
                                    onClick={() => setSelected(c)}
                                    className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper cursor-pointer hover:border-ant-ink/20 hover:shadow-[0_16px_48px_-20px_rgba(20,20,19,0.15)] transition-all group"
                                >
                                    <div className={cn('h-[3px] w-full', tier.stripe)} />
                                    <div className="p-4 space-y-3">
                                        <div className="flex items-start gap-3">
                                            <Avatar className="h-12 w-12 shrink-0 rounded-2xl border border-ant-line">
                                                <AvatarImage src={c.avatar_url || ''} className="object-cover" />
                                                <AvatarFallback className="rounded-2xl bg-ant-ink/5 text-ant-ink font-display font-semibold text-[14px]">
                                                    {c.name.substring(0, 2).toUpperCase()}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <h3 className="font-display text-[14px] font-semibold text-ant-ink truncate">{c.name}</h3>
                                                    <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-ant-mid tabular-nums">
                                                        #{rank}
                                                    </span>
                                                </div>
                                                <p className="text-[11px] text-ant-mid truncate mt-0.5">{c.email}</p>
                                            </div>
                                            <ArrowUpRight className="w-4 h-4 text-ant-mid opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                                        </div>

                                        {/* Delivery progress bar */}
                                        <div className="space-y-1.5">
                                            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                                                <span>Delivery rate</span>
                                                <span className={cn('font-display text-[14px] tracking-normal tabular-nums normal-case', tier.text)}>
                                                    {rate.toFixed(0)}%
                                                </span>
                                            </div>
                                            <div className="h-1.5 bg-ant-line rounded-full overflow-hidden">
                                                <div
                                                    className={cn('h-full rounded-full transition-all', tier.stripe)}
                                                    style={{ width: `${Math.min(100, rate)}%` }}
                                                />
                                            </div>
                                        </div>

                                        {/* 4-col hairline stats */}
                                        <div className="grid grid-cols-4 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                                            <div className="bg-ant-paper px-2.5 py-2">
                                                <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Orders</p>
                                                <p className="text-[13px] font-semibold text-ant-ink tabular-nums">{fmtNum(s?.totalOrders || 0)}</p>
                                            </div>
                                            <div className="bg-ant-paper px-2.5 py-2">
                                                <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Deliv</p>
                                                <p className="text-[13px] font-semibold text-ant-green tabular-nums">{fmtNum(s?.delivered || 0)}</p>
                                            </div>
                                            <div className="bg-ant-paper px-2.5 py-2">
                                                <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Transit</p>
                                                <p className="text-[13px] font-semibold text-ant-orange tabular-nums">{fmtNum(s?.inTransit || 0)}</p>
                                            </div>
                                            <div className="bg-ant-paper px-2.5 py-2">
                                                <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Return</p>
                                                <p className="text-[13px] font-semibold text-ant-rose tabular-nums">{fmtNum(s?.returned || 0)}</p>
                                            </div>
                                        </div>

                                        {/* Footer: active pill + unpaid */}
                                        <div className="flex items-center justify-between pt-2 border-t border-ant-line">
                                            <div className="flex items-center gap-1.5">
                                                <span className={cn(
                                                    'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                                                    isActive ? 'bg-ant-green/10 border-ant-green/25 text-ant-green' : 'bg-ant-light border-ant-line text-ant-mid'
                                                )}>
                                                    <span className={cn('h-1.5 w-1.5 rounded-full', isActive ? 'bg-ant-green' : 'bg-ant-mid')} />
                                                    {isActive ? 'Active' : 'Off'}
                                                </span>
                                                <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold', tier.bg, tier.border, tier.text)}>
                                                    <span className={cn('h-1.5 w-1.5 rounded-full', tier.dot)} />
                                                    {tier.label}
                                                </span>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Unpaid</p>
                                                <p className="font-display text-[14px] font-semibold text-ant-ink tabular-nums" title={fmtCurFull(s?.totalUnpaid || 0)}>
                                                    {fmtCur(s?.totalUnpaid || 0)}
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
            <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
                <SheetContent className="ant-surface sm:max-w-md overflow-y-auto ant-scroll border-l border-ant-line bg-ant-paper p-0">
                    {selected && (() => {
                        const s = stats.get(selected.id);
                        const notes = paymentNotes.filter((n) => n.courier_id === selected.id);
                        const totalFees = s?.totalShippingFees || 0;
                        const paidFees = s?.totalPaid || 0;
                        const pendingFees = s?.totalUnpaid || 0;
                        const rate = s && s.confirmed > 0 ? (s.delivered / s.confirmed) * 100 : 0;
                        const tier = deliveryTier(rate);
                        const isActive = selected.active !== false;

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
                                                Courier · Profile
                                            </div>
                                            <h2 className="font-display text-[20px] leading-tight tracking-tight text-ant-ink truncate">{selected.name}</h2>
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className={cn(
                                                    'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                                                    isActive ? 'bg-ant-green/10 border-ant-green/25 text-ant-green' : 'bg-ant-light border-ant-line text-ant-mid'
                                                )}>
                                                    <span className={cn('h-1.5 w-1.5 rounded-full', isActive ? 'bg-ant-green' : 'bg-ant-mid')} />
                                                    {isActive ? 'Active' : 'Inactive'}
                                                </span>
                                                <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold', tier.bg, tier.border, tier.text)}>
                                                    <span className={cn('h-1.5 w-1.5 rounded-full', tier.dot)} />
                                                    {tier.label} · {rate.toFixed(0)}%
                                                </span>
                                            </div>
                                        </div>
                                        <Button variant="ghost" size="icon" onClick={() => setSelected(null)} className="h-9 w-9 rounded-full hover:bg-ant-ink/5 text-ant-mid shrink-0 cursor-pointer">
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
                                            {selected.address && <ContactRow icon={MapPin} label="Address" value={selected.address} />}
                                        </div>
                                    </section>

                                    {/* Performance */}
                                    <section className="space-y-3">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <Package className="w-3 h-3" />
                                            Performance
                                        </div>
                                        <div className="grid grid-cols-2 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                                            <CourierKpi label="Orders" value={fmtNum(s?.totalOrders || 0)} suffix="total" accent="ink" icon={Package} />
                                            <CourierKpi label="Delivered" value={fmtNum(s?.delivered || 0)} suffix="to door" accent="green" icon={PackageCheck} />
                                            <CourierKpi label="In-transit" value={fmtNum(s?.inTransit || 0)} suffix="shipping" accent="orange" icon={Truck} />
                                            <CourierKpi label="Returned" value={fmtNum(s?.returned || 0)} suffix="bounced" accent="rose" icon={RotateCcw} />
                                        </div>
                                    </section>

                                    {/* Financial — ink panel */}
                                    <section className="rounded-2xl border border-ant-ink bg-ant-ink text-white overflow-hidden">
                                        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/55">
                                                <TrendingUp className="w-3 h-3" />
                                                Shipping fees
                                            </div>
                                            <Sparkles className="w-3.5 h-3.5 text-ant-orange/70" />
                                        </div>
                                        <div className="px-5 pb-4">
                                            <p className="font-display text-[28px] font-semibold text-white tabular-nums" title={fmtCurFull(totalFees)}>
                                                {fmtCur(totalFees)}
                                                <span className="text-[12px] text-white/55 font-normal ml-2">MAD earned</span>
                                            </p>
                                            <p className="font-serif italic text-[11px] text-white/55 mt-1">Fees from delivered orders, deducted from COD collection.</p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-px bg-white/10 border-t border-white/10">
                                            <div className="bg-ant-ink px-5 py-3">
                                                <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-white/55 inline-flex items-center gap-1.5">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                                                    Paid out
                                                </p>
                                                <p className="font-display text-[16px] font-semibold text-white mt-0.5 tabular-nums" title={fmtCurFull(paidFees)}>
                                                    {fmtCur(paidFees)} <span className="text-[10px] text-white/55 font-normal">MAD</span>
                                                </p>
                                            </div>
                                            <div className="bg-ant-ink px-5 py-3">
                                                <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-white/55 inline-flex items-center gap-1.5">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                                    Pending
                                                </p>
                                                <p className={cn('font-display text-[16px] font-semibold mt-0.5 tabular-nums', pendingFees > 0 ? 'text-ant-orange' : 'text-white/40')} title={fmtCurFull(pendingFees)}>
                                                    {fmtCur(pendingFees)} <span className="text-[10px] text-white/55 font-normal">MAD</span>
                                                </p>
                                            </div>
                                        </div>
                                    </section>

                                    {/* Payment notes */}
                                    <section className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <CreditCard className="w-3 h-3" />
                                                Payment notes
                                            </div>
                                            <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-ink tabular-nums">
                                                {notes.length}
                                            </span>
                                        </div>
                                        {notes.length === 0 ? (
                                            <p className="font-serif italic text-[12px] text-ant-mid py-6 text-center border border-dashed border-ant-line rounded-2xl">
                                                No payment notes yet.
                                            </p>
                                        ) : (
                                            <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                                {notes.slice(0, 10).map((n) => {
                                                    const paid = n.status === 'paid';
                                                    return (
                                                        <div key={n.id} className="flex items-center gap-3 px-4 py-3 border-b border-ant-line last:border-0 hover:bg-ant-light/60 transition-colors">
                                                            <div className={cn('h-9 w-9 rounded-xl border flex items-center justify-center shrink-0', paid ? 'bg-ant-green/10 border-ant-green/25 text-ant-green' : 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange')}>
                                                                <CreditCard className="w-4 h-4" strokeWidth={1.75} />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <p className="font-display text-[14px] font-semibold text-ant-ink tabular-nums">
                                                                    {fmtCurFull(Number(n.total_shipping_fees || 0))} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                                                </p>
                                                                <p className="text-[11px] text-ant-mid tabular-nums">
                                                                    {n.order_count} orders · {new Date(n.created_at).toLocaleDateString()}
                                                                </p>
                                                            </div>
                                                            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize', paid ? 'bg-ant-green/10 border-ant-green/25 text-ant-green' : 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange')}>
                                                                <span className={cn('h-1.5 w-1.5 rounded-full', paid ? 'bg-ant-green' : 'bg-ant-orange')} />
                                                                {n.status}
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

export default Couriers;
