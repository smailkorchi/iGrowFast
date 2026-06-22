import React, { useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import {
    Search,
    Truck,
    Phone,
    Mail,
    PackageCheck,
    RotateCcw,
    CreditCard,
    X,
    Package,
    Coins,
    Bike,
    MapPin,
    Sparkles,
    ArrowUpRight,
    Crown,
    Medal,
    BarChart3,
    ShieldCheck,
    UserCheck,
    DollarSign,
    type LucideIcon,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/users/UserAvatar';
import { cn } from '@/lib/utils';
import { differenceInDays } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { useTrackedOrders } from '@/hooks/useTrackedOrders';
import { isAdminPullback } from '@/lib/analyticsDefinitions';
import { fmtCur, fmtCurFull, fmtNum } from '@/lib/formatNumbers';

// ============ TYPE DEFINITIONS ============

type Courier = {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    avatar_url: string | null;
    avatar_config?: unknown;
    address: string | null;
    active: boolean | null;
    created_at: string;
    bank_account_holder: string | null;
    bank_name: string | null;
    bank_rib: string | null;
    cin_number: string | null;
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
    reference: string | null;
    status: string;
    total_amount: number | string;
    total_shipping_fees: number | string;
    net_amount: number | string;
    order_count: number;
    paid_at: string | null;
    created_at: string;
};

type ReturnNote = {
    id: string;
    courier_id: string;
    reference: string | null;
    status: string;
    total_amount: number | string;
    total_shipping_fees: number | string;
    net_amount: number | string;
    order_count: number;
    received_at: string | null;
    created_at: string;
};

type CourierStat = {
    totalOrders: number;
    confirmed: number;
    inTransit: number;
    delivered: number;
    returned: number;
    totalShippingFees: number;
    totalPaid: number;
    totalUnpaid: number;
    notesCount: number;
    zones: number;
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

const MiniTile: React.FC<{ label: string; value: string; sub?: string; tone?: 'ink' | 'orange' | 'green' | 'rose' }> = ({ label, value, sub, tone = 'ink' }) => {
    const a = KPI_ACCENTS[tone];
    return (
        <div className="rounded-xl border border-ant-line bg-ant-paper p-3">
            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                <span className={cn('h-1.5 w-1.5 rounded-full', a.dot)} />
                {label}
            </div>
            <p className="font-display text-[16px] font-semibold text-ant-ink tabular-nums mt-1.5">{value}</p>
            {sub && <p className="font-serif italic text-[11px] text-ant-mid mt-0.5">{sub}</p>}
        </div>
    );
};

// Delivery-success-rate tier → Anthropic stripe + label tone.
// Courier success rate = delivered ÷ (delivered + returned).
const deliveryTier = (rate: number) => {
    if (rate >= 70) return { stripe: 'bg-ant-green', text: 'text-ant-green', bg: 'bg-ant-green/10', border: 'border-ant-green/25', dot: 'bg-ant-green', label: 'Strong' };
    if (rate >= 40) return { stripe: 'bg-ant-orange', text: 'text-ant-orange', bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', dot: 'bg-ant-orange', label: 'Steady' };
    return { stripe: 'bg-ant-rose', text: 'text-ant-rose', bg: 'bg-ant-rose/10', border: 'border-ant-rose/25', dot: 'bg-ant-rose', label: 'At risk' };
};

const InfoRow: React.FC<{
    icon: LucideIcon;
    label: string;
    value: string;
    mono?: boolean;
}> = ({ icon: Icon, label, value, mono }) => (
    <div className="flex items-start gap-2.5 py-2 border-b border-ant-line last:border-0">
        <div className="w-7 h-7 rounded-lg bg-ant-light border border-ant-line flex items-center justify-center shrink-0">
            <Icon className="w-3.5 h-3.5 text-ant-ink" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">{label}</p>
            <p className={cn('text-[12px] text-ant-ink mt-0.5 break-words', mono && 'font-mono tabular-nums')}>{value}</p>
        </div>
    </div>
);

// ============ MAIN COMPONENT ============

const Couriers = () => {
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const { deliveredPkgIds, shippedPkgIds, returnedPkgIds, adminPullbackOrderIds, adminPullbackPackageIds } = useStatusCategories();
    const { trackedOrderIds } = useTrackedOrders(activeBusinessId);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<Courier | null>(null);
    const [sortBy, setSortBy] = useState<'delivered' | 'orders' | 'unpaid'>('delivered');

    // ---------- DATA LAYER (preserved) ----------
    const { data: couriers = [], isLoading: loadingCouriers } = useQuery<Courier[]>({
        queryKey: ['couriers', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, email, phone, avatar_url, avatar_config, address, active, created_at, bank_account_holder, bank_name, bank_rib, cin_number')
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
        queryKey: ['couriers-orders', activeBusinessId, courierIds.slice().sort().join(',')],
        queryFn: async () => {
            if (!activeBusinessId || courierIds.length === 0) return [];
            // Paginated so we never truncate at the 1000-row default cap.
            const data = await fetchAllRows(
                'orders',
                'id, courier_id, order_status_id, package_status_id, shipping_cost, include_delivery_in_total, master_city_id',
                {
                    filters: [
                        { column: 'DigiCom Business', op: 'eq', value: activeBusinessId },
                        { column: 'courier_id', op: 'in', value: courierIds },
                        { column: 'date_deleted', op: 'is', value: null },
                        { column: 'source_review_status', op: 'neq', value: 'pending' },
                    ],
                }
            );
            return (data || []) as OrderRow[];
        },
        enabled: !!activeBusinessId && courierIds.length > 0,
    });

    const { data: courierFees = [] } = useQuery<CourierFeeRow[]>({
        queryKey: ['couriers-fees', activeBusinessId, courierIds.slice().sort().join(',')],
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

    // City names for the zones-and-fees list inside the modal.
    const cityIds = useMemo(() => [...new Set(courierFees.map((f) => f.master_city_id))], [courierFees]);
    const { data: cities = [] } = useQuery<{ id: string; name: string }[]>({
        queryKey: ['couriers-cities', cityIds.slice().sort().join(',')],
        queryFn: async () => {
            if (cityIds.length === 0) return [];
            const { data, error } = await (supabase as any)
                .from('master_cities')
                .select('id, name')
                .in('id', cityIds);
            if (error) throw error;
            return (data || []) as { id: string; name: string }[];
        },
        enabled: cityIds.length > 0,
    });
    const cityNameMap = useMemo(() => {
        const m = new Map<string, string>();
        for (const c of cities) m.set(c.id, c.name);
        return m;
    }, [cities]);

    const { data: paymentNotes = [] } = useQuery<PaymentNote[]>({
        queryKey: ['couriers-payment-notes', activeBusinessId, courierIds.slice().sort().join(',')],
        queryFn: async () => {
            if (!activeBusinessId || courierIds.length === 0) return [];
            const { data, error } = await (supabase as any)
                .from('courier_payment_notes')
                .select('id, courier_id, reference, status, total_amount, total_shipping_fees, net_amount, order_count, paid_at, created_at')
                .eq('DigiCom Business', activeBusinessId)
                .in('courier_id', courierIds)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (data || []) as PaymentNote[];
        },
        enabled: !!activeBusinessId && courierIds.length > 0,
    });

    const { data: returnNotes = [] } = useQuery<ReturnNote[]>({
        queryKey: ['couriers-return-notes', activeBusinessId, courierIds.slice().sort().join(',')],
        queryFn: async () => {
            if (!activeBusinessId || courierIds.length === 0) return [];
            const { data, error } = await (supabase as any)
                .from('courier_return_notes')
                .select('id, courier_id, reference, status, total_amount, total_shipping_fees, net_amount, order_count, received_at, created_at')
                .eq('DigiCom Business', activeBusinessId)
                .in('courier_id', courierIds)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (data || []) as ReturnNote[];
        },
        enabled: !!activeBusinessId && courierIds.length > 0,
    });

    // Per-courier zones covered (distinct cities with a configured fee).
    const zonesByCourier = useMemo(() => {
        const m = new Map<string, Set<string>>();
        for (const f of courierFees) {
            if (!m.has(f.courier_id)) m.set(f.courier_id, new Set());
            m.get(f.courier_id)!.add(f.master_city_id);
        }
        return m;
    }, [courierFees]);

    const stats = useMemo(() => {
        const m = new Map<string, CourierStat>();
        for (const c of couriers) {
            m.set(c.id, { totalOrders: 0, confirmed: 0, inTransit: 0, delivered: 0, returned: 0, totalShippingFees: 0, totalPaid: 0, totalUnpaid: 0, notesCount: 0, zones: zonesByCourier.get(c.id)?.size || 0 });
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
    }, [couriers, orders, paymentNotes, deliveredPkgIds, shippedPkgIds, returnedPkgIds, adminPullbackOrderIds, adminPullbackPackageIds, trackedOrderIds, feeLookup, zonesByCourier]);

    // Delivery success rate = delivered ÷ (delivered + returned).
    const successRate = (s?: CourierStat) => {
        if (!s) return 0;
        const denom = s.delivered + s.returned;
        return denom > 0 ? (s.delivered / denom) * 100 : 0;
    };

    // ---------- Derived: podium + rank + filtered/sorted ----------
    const rankMap = useMemo(() => {
        const sorted = [...couriers].sort((a, b) => (stats.get(b.id)?.delivered || 0) - (stats.get(a.id)?.delivered || 0));
        const map = new Map<string, number>();
        sorted.forEach((c, i) => map.set(c.id, i + 1));
        return map;
    }, [couriers, stats]);

    const podium = useMemo(() => {
        return [...couriers]
            .filter((c) => (stats.get(c.id)?.delivered || 0) > 0)
            .sort((a, b) => (stats.get(b.id)?.delivered || 0) - (stats.get(a.id)?.delivered || 0))
            .slice(0, 3);
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
            if (sortBy === 'delivered') return (sb?.delivered || 0) - (sa?.delivered || 0);
            if (sortBy === 'orders') return (sb?.totalOrders || 0) - (sa?.totalOrders || 0);
            if (sortBy === 'unpaid') return (sb?.totalUnpaid || 0) - (sa?.totalUnpaid || 0);
            return 0;
        });
    }, [couriers, search, stats, sortBy]);

    const totals = useMemo(() => {
        let totalOrders = 0;
        let totalDelivered = 0;
        let totalReturned = 0;
        let totalUnpaid = 0;
        stats.forEach((s) => {
            totalOrders += s.totalOrders;
            totalDelivered += s.delivered;
            totalReturned += s.returned;
            totalUnpaid += s.totalUnpaid;
        });
        return { totalOrders, totalDelivered, totalReturned, totalUnpaid };
    }, [stats]);

    // ========== PODIUM CARD ==========
    const PodiumCard: React.FC<{ courier: Courier; rank: 1 | 2 | 3 }> = ({ courier, rank }) => {
        const s = stats.get(courier.id);
        const rate = successRate(s);
        const tier = deliveryTier(rate);
        const isActive = courier.active !== false;

        const rankMeta = rank === 1
            ? { icon: Crown, accentBg: 'bg-ant-orange/10', accentBorder: 'border-ant-orange/30', accentText: 'text-ant-orange', label: 'Top courier · 01', avatarSize: 'h-20 w-20', nameSize: 'text-[22px]', rankBg: 'bg-ant-orange text-white' }
            : rank === 2
            ? { icon: Medal, accentBg: 'bg-ant-ink/6', accentBorder: 'border-ant-ink/20', accentText: 'text-ant-ink', label: 'Runner up · 02', avatarSize: 'h-16 w-16', nameSize: 'text-[18px]', rankBg: 'bg-ant-ink text-white' }
            : { icon: Medal, accentBg: 'bg-ant-rose/8', accentBorder: 'border-ant-rose/25', accentText: 'text-ant-rose', label: 'Third place · 03', avatarSize: 'h-16 w-16', nameSize: 'text-[18px]', rankBg: 'bg-ant-rose text-white' };
        const RankIcon = rankMeta.icon;

        return (
            <div
                onClick={() => setSelected(courier)}
                className={cn(
                    'relative overflow-hidden rounded-2xl border bg-ant-paper cursor-pointer transition-all hover:border-ant-ink/20 hover:shadow-[0_24px_60px_-24px_rgba(20,20,19,0.22)]',
                    rankMeta.accentBorder
                )}
            >
                <div className={cn('h-[3px] w-full', rank === 1 ? 'bg-ant-orange' : rank === 2 ? 'bg-ant-ink' : 'bg-ant-rose')} />
                <div className="p-5 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className={cn('inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]', rankMeta.accentBg, rankMeta.accentBorder, rankMeta.accentText)}>
                            <RankIcon className="w-3 h-3" />
                            {rankMeta.label}
                        </div>
                        <div className={cn('inline-flex items-center justify-center h-8 w-8 rounded-full font-display font-semibold text-[13px]', rankMeta.rankBg)}>
                            {rank}
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="relative shrink-0">
                            <UserAvatar url={courier.avatar_url} config={(courier as any).avatar_config} name={courier.name} className={cn('rounded-2xl border border-ant-line', rankMeta.avatarSize)} />
                            <span className={cn('absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-ant-paper', isActive ? 'bg-ant-green' : 'bg-ant-mid/50')} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <h3 className={cn('font-display font-semibold text-ant-ink leading-tight truncate', rankMeta.nameSize)}>{courier.name}</h3>
                            <p className="text-[11px] text-ant-mid truncate mt-0.5">{courier.email}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                        <div className="bg-ant-paper p-3">
                            <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Delivered</p>
                            <p className="font-display text-[18px] font-semibold text-ant-green tabular-nums mt-0.5">{fmtNum(s?.delivered || 0)}</p>
                        </div>
                        <div className="bg-ant-paper p-3">
                            <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Success</p>
                            <p className={cn('font-display text-[18px] font-semibold tabular-nums mt-0.5', tier.text)}>{rate.toFixed(0)}%</p>
                        </div>
                        <div className="bg-ant-paper p-3">
                            <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Fees</p>
                            <p className="font-display text-[15px] font-semibold text-ant-ink tabular-nums mt-0.5 truncate" title={fmtCurFull(s?.totalShippingFees || 0)}>
                                {fmtNum(s?.totalShippingFees || 0)}
                                <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-ant-line">
                        <div className="min-w-0">
                            <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Unpaid fees</p>
                            <p className="font-display text-[16px] font-semibold text-ant-ink tabular-nums truncate" title={fmtCurFull(s?.totalUnpaid || 0)}>
                                {fmtNum(s?.totalUnpaid || 0)}
                                <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                            </p>
                        </div>
                        <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-ant-mid">
                            View <ArrowUpRight className="w-3.5 h-3.5" />
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // ========== ROSTER CARD ==========
    const RosterCard: React.FC<{ courier: Courier; rank: number }> = ({ courier, rank }) => {
        const s = stats.get(courier.id);
        const rate = successRate(s);
        const tier = deliveryTier(rate);
        const isActive = courier.active !== false;

        return (
            <div
                onClick={() => setSelected(courier)}
                className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper cursor-pointer hover:border-ant-ink/20 hover:shadow-[0_16px_48px_-20px_rgba(20,20,19,0.15)] transition-all group"
            >
                <div className={cn('h-[3px] w-full', tier.stripe)} />
                <div className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                        <div className="relative shrink-0">
                            <UserAvatar url={courier.avatar_url} config={(courier as any).avatar_config} name={courier.name} className="h-12 w-12 rounded-2xl border border-ant-line" />
                            <span className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-ant-paper', isActive ? 'bg-ant-green' : 'bg-ant-mid/50')} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <h3 className="font-display text-[14px] font-semibold text-ant-ink truncate">{courier.name}</h3>
                                <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-ant-mid tabular-nums">
                                    #{rank}
                                </span>
                            </div>
                            <p className="text-[11px] text-ant-mid truncate mt-0.5">{courier.email}</p>
                        </div>
                        <ArrowUpRight className="w-4 h-4 text-ant-mid opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </div>

                    {/* Delivery success-rate progress bar */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                            <span>Success rate</span>
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
                            <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Return</p>
                            <p className="text-[13px] font-semibold text-ant-rose tabular-nums">{fmtNum(s?.returned || 0)}</p>
                        </div>
                        <div className="bg-ant-paper px-2.5 py-2">
                            <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Fees</p>
                            <p className="text-[11px] font-semibold text-ant-ink tabular-nums truncate" title={fmtCurFull(s?.totalShippingFees || 0)}>{fmtCur(s?.totalShippingFees || 0)}</p>
                        </div>
                    </div>

                    {/* Tier pill + unpaid footer */}
                    <div className="flex items-center justify-between pt-2 border-t border-ant-line">
                        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold', tier.bg, tier.border, tier.text)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', tier.dot)} />
                            {tier.label}
                        </span>
                        <div className="text-right">
                            <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Unpaid</p>
                            <p className="font-display text-[14px] font-semibold text-ant-ink tabular-nums" title={fmtCurFull(s?.totalUnpaid || 0)}>
                                {fmtNum(s?.totalUnpaid || 0)}
                                <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // ========== DETAIL MODAL ==========
    const CourierDetailModal = ({ courier, onClose }: { courier: Courier; onClose: () => void }) => {
        const s = stats.get(courier.id);
        const notes = paymentNotes.filter((n) => n.courier_id === courier.id);
        const courierReturnNotes = returnNotes.filter((n) => n.courier_id === courier.id);
        const totalFees = s?.totalShippingFees || 0;
        const paidFees = s?.totalPaid || 0;
        const pendingFees = s?.totalUnpaid || 0;
        const handled = s?.totalOrders || 0;
        const delivered = s?.delivered || 0;
        const returned = s?.returned || 0;
        const inTransit = s?.inTransit || 0;
        const rate = successRate(s);
        const tier = deliveryTier(rate);
        const isActive = courier.active !== false;
        const daysActive = differenceInDays(new Date(), new Date(courier.created_at)) + 1;
        const avgPerDay = daysActive > 0 ? delivered / daysActive : 0;
        const returnRate = (delivered + returned) > 0 ? (returned / (delivered + returned)) * 100 : 0;

        const statusDistribution = [
            { label: 'Delivered', count: delivered, color: '#2D7A3E' },
            { label: 'In-transit', count: inTransit, color: '#D97706' },
            { label: 'Returned', count: returned, color: '#B54040' },
        ].filter((d) => d.count > 0);
        const totalForBar = statusDistribution.reduce((acc, d) => acc + d.count, 0);

        // Zones & fees for this courier.
        const zoneRows = courierFees
            .filter((f) => f.courier_id === courier.id)
            .map((f) => ({
                city: cityNameMap.get(f.master_city_id) || 'Unknown',
                delivery: Number(f.fee || 0),
            }))
            .sort((a, b) => a.city.localeCompare(b.city));

        return (
            <div
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ant-ink/55 backdrop-blur-sm"
                onClick={onClose}
            >
                <div
                    className="ant-surface relative bg-ant-paper rounded-2xl border border-ant-line w-full max-w-4xl max-h-[92vh] overflow-y-auto ant-scroll shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)]"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Editorial header */}
                    <div className="sticky top-0 bg-ant-paper z-10 border-b border-ant-line px-6 py-5">
                        <div className="flex items-start gap-4">
                            <div className="relative shrink-0">
                                <UserAvatar url={courier.avatar_url} config={(courier as any).avatar_config} name={courier.name} className="h-14 w-14 rounded-2xl border border-ant-line" />
                                <span className={cn('absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-ant-paper', isActive ? 'bg-ant-green' : 'bg-ant-mid/50')} />
                            </div>
                            <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                    Courier · Profile
                                </div>
                                <h2 className="font-display text-[22px] leading-tight tracking-tight text-ant-ink truncate">{courier.name}</h2>
                                <div className="flex flex-wrap items-center gap-3 text-[12px] text-ant-mid">
                                    <span className="inline-flex items-center gap-1.5">
                                        <Mail className="w-3.5 h-3.5" /> {courier.email}
                                    </span>
                                    {courier.phone && (
                                        <>
                                            <span>·</span>
                                            <span className="inline-flex items-center gap-1.5 tabular-nums">
                                                <Phone className="w-3.5 h-3.5" /> {courier.phone}
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={onClose}
                                className="h-9 w-9 rounded-full hover:bg-ant-ink/5 text-ant-mid cursor-pointer"
                            >
                                <X className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>

                    <div className="p-6 space-y-6">
                        {/* Config KPIs */}
                        <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                            <CourierKpi label="Zones covered" value={s?.zones || 0} suffix="cities" accent="orange" icon={MapPin} />
                            <CourierKpi label="Fee model" value="Delivery" suffix="+ return" accent="ink" icon={Coins} />
                            <CourierKpi label="Days since join" value={daysActive} suffix="days" accent="ink" icon={UserCheck} />
                            <CourierKpi label="Handled" value={fmtNum(handled)} suffix="orders" accent="orange" icon={Package} />
                        </section>

                        {/* Delivery performance */}
                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange" />
                            <div className="p-5 space-y-4">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <BarChart3 className="w-3 h-3" />
                                    Delivery performance
                                </div>

                                {totalForBar > 0 && (
                                    <div className="space-y-2">
                                        <div className="flex h-2.5 rounded-full overflow-hidden gap-px bg-ant-line">
                                            {statusDistribution.map((d, i) => (
                                                <div
                                                    key={i}
                                                    className="rounded-full"
                                                    style={{ width: `${(d.count / totalForBar) * 100}%`, background: d.color }}
                                                    title={`${d.label}: ${d.count}`}
                                                />
                                            ))}
                                        </div>
                                        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                                            {statusDistribution.map((d, i) => (
                                                <div key={i} className="flex items-center gap-1.5">
                                                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: d.color }} />
                                                    <span className="text-[11px] text-ant-mid">
                                                        {d.label} <span className="font-semibold text-ant-ink tabular-nums ml-0.5">{d.count}</span>
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-ant-line">
                                    <MiniTile label="Success rate" value={`${rate.toFixed(1)}%`} tone="green" />
                                    <MiniTile label="Returns rate" value={`${returnRate.toFixed(1)}%`} tone="rose" />
                                    <MiniTile label="Avg per day" value={avgPerDay.toFixed(1)} sub="delivered" tone="ink" />
                                    <MiniTile label="Handled" value={fmtNum(handled)} tone="orange" />
                                </div>
                            </div>
                        </section>

                        {/* Financial — ink panel */}
                        <section className="rounded-2xl border border-ant-ink bg-ant-ink text-white overflow-hidden">
                            <div className="px-5 pt-4 pb-2 flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/55">
                                    <DollarSign className="w-3 h-3" />
                                    Shipping fees
                                </div>
                                <Sparkles className="w-3.5 h-3.5 text-ant-orange/70" />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/10">
                                <div className="px-5 py-4">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-white/55">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                                        Fees earned
                                    </div>
                                    <p className="font-display text-[22px] font-semibold text-ant-green tabular-nums mt-1.5" title={fmtCurFull(totalFees)}>
                                        {fmtNum(totalFees)}
                                        <span className="text-[11px] text-white/55 font-normal ml-1.5">MAD</span>
                                    </p>
                                </div>
                                <div className="px-5 py-4">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-white/55">
                                        <span className="h-1.5 w-1.5 rounded-full bg-white" />
                                        Paid out
                                    </div>
                                    <p className="font-display text-[22px] font-semibold text-white tabular-nums mt-1.5" title={fmtCurFull(paidFees)}>
                                        {fmtNum(paidFees)}
                                        <span className="text-[11px] text-white/55 font-normal ml-1.5">MAD</span>
                                    </p>
                                </div>
                                <div className="px-5 py-4">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-white/55">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                        Unpaid fees
                                    </div>
                                    <p className={cn('font-display text-[22px] font-semibold tabular-nums mt-1.5', pendingFees > 0 ? 'text-ant-orange' : 'text-white/40')} title={fmtCurFull(pendingFees)}>
                                        {fmtNum(pendingFees)}
                                        <span className="text-[11px] text-white/55 font-normal ml-1.5">MAD</span>
                                    </p>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-px bg-white/10 border-t border-white/10">
                                {[
                                    { label: 'Delivered', value: fmtNum(delivered) },
                                    { label: 'Payment notes', value: fmtNum(s?.notesCount || 0) },
                                    { label: 'Avg fee / order', value: delivered > 0 ? fmtCur(totalFees / delivered) : '0' },
                                ].map((t) => (
                                    <div key={t.label} className="bg-ant-ink px-5 py-3">
                                        <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-white/55">{t.label}</p>
                                        <p className="font-display text-[14px] font-semibold text-white mt-0.5 tabular-nums">{t.value}</p>
                                    </div>
                                ))}
                            </div>
                        </section>

                        {/* Activity + Zones & fees */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <section className="rounded-2xl border border-ant-line bg-ant-paper p-5 space-y-3">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <UserCheck className="w-3 h-3" />
                                    Activity
                                </div>
                                {[
                                    { label: 'Orders handled', value: fmtNum(handled) },
                                    { label: 'In-transit now', value: fmtNum(inTransit) },
                                    { label: 'Returned', value: fmtNum(returned) },
                                    { label: 'Status', value: isActive ? 'Active' : 'Inactive' },
                                ].map((r) => (
                                    <div key={r.label} className="flex items-center justify-between py-2 border-b border-ant-line last:border-0">
                                        <span className="text-[11px] text-ant-mid">{r.label}</span>
                                        <span className="text-[12px] font-semibold text-ant-ink tabular-nums">{r.value}</span>
                                    </div>
                                ))}
                            </section>

                            <section className="rounded-2xl border border-ant-line bg-ant-paper p-5 space-y-3 flex flex-col">
                                <div className="flex items-center justify-between shrink-0">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <MapPin className="w-3 h-3" />
                                        Zones &amp; fees
                                    </div>
                                    <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-ink tabular-nums">
                                        {zoneRows.length}
                                    </span>
                                </div>
                                {zoneRows.length === 0 ? (
                                    <p className="font-serif italic text-[12px] text-ant-mid py-4 text-center">No zone fees configured.</p>
                                ) : (
                                    <div className="ant-scroll max-h-[220px] overflow-y-auto pr-1 -mr-1 space-y-1">
                                        {zoneRows.map((z, i) => (
                                            <div key={i} className="flex items-center justify-between gap-2 py-1.5 border-b border-ant-line last:border-0">
                                                <span className="inline-flex items-center gap-2 text-[12px] text-ant-ink truncate">
                                                    <MapPin className="w-3.5 h-3.5 text-ant-mid shrink-0" />
                                                    {z.city}
                                                </span>
                                                <span className="text-[12px] font-semibold text-ant-ink tabular-nums shrink-0">
                                                    {fmtNum(z.delivery)} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>
                        </div>

                        {/* Payment notes history */}
                        {notes.length > 0 && (
                            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                <div className="px-5 py-3.5 border-b border-ant-line flex items-center justify-between">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <CreditCard className="w-3 h-3" />
                                        Payment notes
                                    </div>
                                    <span className="text-[11px] font-semibold text-ant-mid tabular-nums">{notes.length} notes</span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-ant-line">
                                                <th className="px-4 py-3.5 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Reference</th>
                                                <th className="px-4 py-3.5 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Date</th>
                                                <th className="px-4 py-3.5 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Parcels</th>
                                                <th className="px-4 py-3.5 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Amount</th>
                                                <th className="px-4 py-3.5 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {notes.map((n) => {
                                                const paid = n.status === 'paid';
                                                const statusMeta = paid
                                                    ? { bg: 'bg-ant-green/10', text: 'text-ant-green', dot: 'bg-ant-green' }
                                                    : { bg: 'bg-ant-orange/10', text: 'text-ant-orange', dot: 'bg-ant-orange' };
                                                return (
                                                    <tr key={n.id} className="border-t border-ant-line/60 hover:bg-ant-light/40 transition-colors tabular-nums">
                                                        <td className="px-4 py-3.5 text-[12px] font-semibold text-ant-ink whitespace-nowrap font-mono">{n.reference || `#${n.id.slice(0, 8)}`}</td>
                                                        <td className="px-4 py-3.5 text-[12px] text-ant-mid whitespace-nowrap">{new Date(n.created_at).toLocaleDateString()}</td>
                                                        <td className="px-4 py-3.5 text-[13px] text-ant-ink font-semibold">{n.order_count}</td>
                                                        <td className="px-4 py-3.5 text-right text-[13px] font-semibold text-ant-ink" title={fmtCurFull(Number(n.total_shipping_fees || 0))}>
                                                            {fmtNum(Number(n.total_shipping_fees || 0))} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                                        </td>
                                                        <td className="px-4 py-3.5">
                                                            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize', statusMeta.bg, statusMeta.text)}>
                                                                <span className={cn('h-1.5 w-1.5 rounded-full', statusMeta.dot)} />
                                                                {n.status}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </section>
                        )}

                        {/* Return notes history */}
                        {courierReturnNotes.length > 0 && (
                            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                <div className="px-5 py-3.5 border-b border-ant-line flex items-center justify-between">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <RotateCcw className="w-3 h-3" />
                                        Return notes
                                    </div>
                                    <span className="text-[11px] font-semibold text-ant-mid tabular-nums">{courierReturnNotes.length} notes</span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-ant-line">
                                                <th className="px-4 py-3.5 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Reference</th>
                                                <th className="px-4 py-3.5 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Date</th>
                                                <th className="px-4 py-3.5 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Parcels</th>
                                                <th className="px-4 py-3.5 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Return fees</th>
                                                <th className="px-4 py-3.5 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {courierReturnNotes.map((n) => {
                                                const done = n.status === 'received' || !!n.received_at;
                                                const statusMeta = done
                                                    ? { bg: 'bg-ant-green/10', text: 'text-ant-green', dot: 'bg-ant-green' }
                                                    : { bg: 'bg-ant-orange/10', text: 'text-ant-orange', dot: 'bg-ant-orange' };
                                                return (
                                                    <tr key={n.id} className="border-t border-ant-line/60 hover:bg-ant-light/40 transition-colors tabular-nums">
                                                        <td className="px-4 py-3.5 text-[12px] font-semibold text-ant-ink whitespace-nowrap font-mono">{n.reference || `#${n.id.slice(0, 8)}`}</td>
                                                        <td className="px-4 py-3.5 text-[12px] text-ant-mid whitespace-nowrap">{new Date(n.created_at).toLocaleDateString()}</td>
                                                        <td className="px-4 py-3.5 text-[13px] text-ant-ink font-semibold">{n.order_count}</td>
                                                        <td className="px-4 py-3.5 text-right text-[13px] font-semibold text-ant-ink" title={fmtCurFull(Number(n.total_shipping_fees || 0))}>
                                                            {fmtNum(Number(n.total_shipping_fees || 0))} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                                        </td>
                                                        <td className="px-4 py-3.5">
                                                            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize', statusMeta.bg, statusMeta.text)}>
                                                                <span className={cn('h-1.5 w-1.5 rounded-full', statusMeta.dot)} />
                                                                {n.status}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </section>
                        )}

                        {/* Personal & banking */}
                        {(courier.cin_number || courier.bank_name || courier.address || courier.phone || courier.bank_rib) && (
                            <section className="rounded-2xl border border-ant-line bg-ant-paper p-5 space-y-3">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <ShieldCheck className="w-3 h-3" />
                                    Personal &amp; banking
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {courier.cin_number && <InfoRow icon={ShieldCheck} label="CIN" value={courier.cin_number} />}
                                    {courier.address && <InfoRow icon={MapPin} label="Address" value={courier.address} />}
                                    {courier.bank_name && <InfoRow icon={CreditCard} label="Bank" value={courier.bank_name} />}
                                    {courier.bank_rib && <InfoRow icon={CreditCard} label="RIB" value={courier.bank_rib} mono />}
                                    {courier.phone && <InfoRow icon={Phone} label="Phone" value={courier.phone} />}
                                </div>
                            </section>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    // ========== RENDER ==========
    return (
        <>
            <div className="ant-surface min-h-screen">
                <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
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
                                A leaderboard, not a list — the fleet that turns a confirmed order into a delivered one. Crown the three that move the most parcels, watch the rest climb.
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
                        <CourierKpi label="Delivered" value={fmtNum(totals.totalDelivered)} suffix="to door" accent="green" icon={PackageCheck} />
                        <CourierKpi label="Returns" value={fmtNum(totals.totalReturned)} suffix="bounced" accent="orange" icon={RotateCcw} />
                        <CourierKpi label="Unpaid fees" value={fmtNum(totals.totalUnpaid)} suffix="MAD" accent="rose" icon={Coins} />
                    </section>

                    {/* Podium — top 3 by parcels delivered */}
                    {!loadingCouriers && podium.length > 0 && (
                        <section className="space-y-3">
                            <div className="flex items-end justify-between gap-3 border-b border-ant-line pb-3">
                                <div className="space-y-1">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="font-display text-ant-orange font-semibold">01</span>
                                        Podium
                                    </div>
                                    <h2 className="font-display text-[22px] tracking-tight text-ant-ink">The fleet leaders</h2>
                                    <p className="font-serif italic text-[12px] text-ant-mid max-w-xl">Ranked by parcels delivered — the three hands that reach the most doors.</p>
                                </div>
                                <div className="hidden md:flex h-12 w-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 items-center justify-center shrink-0">
                                    <Crown className="w-5 h-5 text-ant-orange" strokeWidth={1.5} />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                {podium[0] && (
                                    <div className="md:col-span-2 md:row-span-1">
                                        <PodiumCard courier={podium[0]} rank={1} />
                                    </div>
                                )}
                                {podium[1] && (
                                    <div className="md:col-span-1">
                                        <PodiumCard courier={podium[1]} rank={2} />
                                    </div>
                                )}
                                {podium[2] && (
                                    <div className="md:col-span-1">
                                        <PodiumCard courier={podium[2]} rank={3} />
                                    </div>
                                )}
                            </div>
                        </section>
                    )}

                    {/* Full roster */}
                    <section className="space-y-3">
                        <div className="flex items-end justify-between gap-3 border-b border-ant-line pb-3">
                            <div className="space-y-1">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">02</span>
                                    Roster
                                </div>
                                <h2 className="font-display text-[22px] tracking-tight text-ant-ink">
                                    Every courier
                                    <span className="ml-2 text-[13px] font-normal text-ant-mid tabular-nums">· {filtered.length}</span>
                                </h2>
                            </div>
                        </div>

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
                                {filtered.map((c) => (
                                    <RosterCard key={c.id} courier={c} rank={rankMap.get(c.id) ?? 0} />
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            </div>

            {/* Detail Modal */}
            <AnimatePresence>
                {selected && (
                    <CourierDetailModal courier={selected} onClose={() => setSelected(null)} />
                )}
            </AnimatePresence>
        </>
    );
};

export default Couriers;
