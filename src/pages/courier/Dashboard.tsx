/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
    Area,
    AreaChart,
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import {
    CheckCircle2,
    Package,
    ScanLine,
    Sparkles,
    TrendingUp,
    Wallet,
    ArrowRight,
    Hash,
    Activity,
    ChevronRight,
    Receipt,
    Clock,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import QrScanModal from '@/components/scanner/QrScanModal';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';

// ─── Types ───────────────────────────────────────────────────────────────────
type PkgStatus = {
    id: string;
    label: string | null;
    color: string | null;
    category: string | null;
    recheck: boolean | null;
};

type CourierParcel = {
    id: string;
    tracking_code: string | null;
    created_at: string | null;
    updated_at: string | null;
    status_label: string | null;
    status_color: string | null;
    status_category: string | null;
    recheck: boolean | null;
    order_name: string | null;
    order_city: string | null;
    order_price: number;
    order_shipping: number;
};

type PayoutRow = {
    id: string;
    reference: string;
    total_shipping_fees: number;
    order_count: number;
    paid_at: string | null;
    created_at: string | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtMAD = (n: number) =>
    new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);

const fmtMAD2 = (n: number) =>
    new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

const greetingForHour = (h: number) => {
    if (h < 12) return 'Bonjour';
    if (h < 18) return 'Bon après-midi';
    return 'Bonsoir';
};

const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// ─── Component ───────────────────────────────────────────────────────────────
const CourierDashboard = () => {
    const navigate = useNavigate();
    const { toast } = useToast();
    const [isScannerOpen, setIsScannerOpen] = useState(false);

    // ── Me ─────────────────────────────────────────────────────────────
    const { data: me } = useQuery({
        queryKey: ['courier-me-dashboard'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;
            const { data } = await (supabase as any)
                .from('users')
                .select('id, name, avatar_url, "DigiCom Business"')
                .eq('id', user.id)
                .maybeSingle();
            return data as { id: string; name: string | null; avatar_url: string | null; ['DigiCom Business']: string } | null;
        },
        staleTime: 60_000,
    });

    const courierId = me?.id;
    const businessId = me?.['DigiCom Business'];

    // ── Parcels (finalized notes only, same scope as Orders page) ─────
    const { data: parcels = [], isLoading: isLoadingParcels } = useQuery<CourierParcel[]>({
        queryKey: ['courier-dashboard-parcels', courierId, businessId],
        queryFn: async () => {
            if (!courierId || !businessId) return [];
            const { data, error } = await (supabase as any)
                .from('courier_parcels')
                .select(`
                    id, tracking_code, created_at, updated_at, status_label, status_color,
                    note:courier_delivery_notes!inner(id, is_finalized),
                    status:package_statuses(id, label, color, category, recheck),
                    order:orders!courier_parcels_order_id_fkey(
                        id, name, price, shipping_cost,
                        city:master_cities(id, name)
                    )
                `)
                .eq('courier_id', courierId)
                .eq('DigiCom Business', businessId)
                .eq('note.is_finalized', true);
            if (error) throw error;
            return ((data || []) as any[])
                .filter((p) => p?.note && p?.order)
                .map((p) => {
                    const s: PkgStatus | null = p.status || null;
                    return {
                        id: p.id,
                        tracking_code: p.tracking_code,
                        created_at: p.created_at,
                        updated_at: p.updated_at,
                        status_label: s?.label || p.status_label,
                        status_color: s?.color || p.status_color,
                        status_category: s?.category || null,
                        recheck: s?.recheck || null,
                        order_name: p.order?.name || null,
                        order_city: p.order?.city?.name || null,
                        order_price: Number(p.order?.price || 0),
                        order_shipping: Number(p.order?.shipping_cost || 0),
                    } as CourierParcel;
                });
        },
        enabled: !!courierId && !!businessId,
    });

    // ── Paid payouts (earnings history) ───────────────────────────────
    const { data: payouts = [] } = useQuery<PayoutRow[]>({
        queryKey: ['courier-dashboard-payouts', courierId, businessId],
        queryFn: async () => {
            if (!courierId || !businessId) return [];
            const { data, error } = await (supabase as any)
                .from('courier_payment_notes')
                .select('id, reference, total_shipping_fees, order_count, paid_at, created_at')
                .eq('courier_id', courierId)
                .eq('DigiCom Business', businessId)
                .eq('status', 'paid')
                .order('paid_at', { ascending: false, nullsFirst: false });
            if (error) throw error;
            return (data || []) as PayoutRow[];
        },
        enabled: !!courierId && !!businessId,
    });

    // ── Aggregates ─────────────────────────────────────────────────────
    const stats = useMemo(() => {
        const today = new Date();
        let deliveredToday = 0;
        let activeCount = 0;
        let pendingEarningsGross = 0;
        let deliveredTotal = 0;

        const byCategory = new Map<string, number>();

        for (const p of parcels) {
            const cat = p.status_category || 'other';
            byCategory.set(cat, (byCategory.get(cat) || 0) + 1);

            if (cat === 'delivered') {
                deliveredTotal++;
                pendingEarningsGross += p.order_shipping;
                const ts = p.updated_at || p.created_at;
                if (ts && isSameDay(new Date(ts), today)) deliveredToday++;
            } else if (cat !== 'returned' && cat !== 'cancelled' && cat !== 'refused') {
                activeCount++;
            }
        }

        const lifetimePaid = payouts.reduce((s, n) => s + Number(n.total_shipping_fees || 0), 0);
        const lifetimeDelivered = payouts.reduce((s, n) => s + Number(n.order_count || 0), 0);
        // Pending = delivered shipping fees minus what's already been settled in paid payouts.
        const pendingEarnings = Math.max(0, pendingEarningsGross - lifetimePaid);

        return {
            deliveredToday,
            activeCount,
            pendingEarnings,
            deliveredTotal,
            lifetimePaid,
            lifetimeDelivered,
            byCategory,
        };
    }, [parcels, payouts]);

    // ── Monthly earnings series (last 6 months) ────────────────────────
    const monthlySeries = useMemo(() => {
        const now = new Date();
        const months: { key: string; label: string; amount: number }[] = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = format(d, 'yyyy-MM');
            const label = format(d, 'MMM', { locale: fr });
            months.push({ key, label, amount: 0 });
        }
        const idx = new Map(months.map((m, i) => [m.key, i]));
        for (const p of payouts) {
            const iso = p.paid_at || p.created_at;
            if (!iso) continue;
            const key = format(new Date(iso), 'yyyy-MM');
            const i = idx.get(key);
            if (i !== undefined) months[i].amount += Number(p.total_shipping_fees || 0);
        }
        return months;
    }, [payouts]);

    // ── Status donut data ──────────────────────────────────────────────
    const donutData = useMemo(() => {
        const map: Record<string, { name: string; value: number; color: string }> = {
            delivered: { name: 'Livré', value: 0, color: '#10b981' },
            new: { name: 'Nouveau', value: 0, color: '#3b82f6' },
            postponed: { name: 'Reporté', value: 0, color: '#b45309' },
            in_transit: { name: 'En transit', value: 0, color: '#8b5cf6' },
            out_for_delivery: { name: 'En livraison', value: 0, color: '#06b6d4' },
            returned: { name: 'Retourné', value: 0, color: '#ef4444' },
            cancelled: { name: 'Annulé', value: 0, color: '#6b7280' },
            refused: { name: 'Refusé', value: 0, color: '#f87171' },
            other: { name: 'Autre', value: 0, color: '#94a3b8' },
        };
        for (const [cat, n] of stats.byCategory.entries()) {
            if (map[cat]) map[cat].value += n;
            else map.other.value += n;
        }
        return Object.values(map).filter((s) => s.value > 0);
    }, [stats.byCategory]);

    // ── Recent activity (last 5 by updated_at) ─────────────────────────
    const recent = useMemo(() => {
        return [...parcels]
            .sort((a, b) => {
                const ta = new Date(a.updated_at || a.created_at || 0).getTime();
                const tb = new Date(b.updated_at || b.created_at || 0).getTime();
                return tb - ta;
            })
            .slice(0, 5);
    }, [parcels]);

    // ── Scan handler ──────────────────────────────────────────────────
    const handleScannedCode = (code: string) => {
        setIsScannerOpen(false);
        const normalized = code.trim().toUpperCase();

        const match = parcels.find((p) => (p.tracking_code || '').toUpperCase() === normalized);
        if (!match) {
            toast({
                title: 'Colis non attribué',
                description: `« ${normalized} » ne correspond à aucun de vos colis.`,
                variant: 'destructive',
            });
            return;
        }

        toast({
            title: 'Colis trouvé',
            description: `${match.order_name || 'Client'} · ${normalized}`,
        });
        navigate(`/courier/orders?tracking=${encodeURIComponent(normalized)}`);
    };

    // ── Greeting ──────────────────────────────────────────────────────
    const now = new Date();
    const greeting = greetingForHour(now.getHours());
    const firstName = (me?.name || '').trim().split(/\s+/)[0] || 'Courier';
    const todayLabel = format(now, 'EEEE d MMMM', { locale: fr });
    const initials = (me?.name || 'CR')
        .split(/\s+/)
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();

    // ── Animation variants ────────────────────────────────────────────
    const container = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: { staggerChildren: 0.07, delayChildren: 0.05 },
        },
    };

    const item = {
        hidden: { opacity: 0, y: 16 },
        show: {
            opacity: 1,
            y: 0,
            transition: { type: 'spring' as const, stiffness: 260, damping: 26 },
        },
    };

    return (
        <motion.div
            className="space-y-5 sm:space-y-6 pb-4"
            variants={container}
            initial="hidden"
            animate="show"
        >
            {/* ─── Hero: welcome + avatar + scan CTA ─── */}
            <motion.section variants={item}>
                <div className="relative overflow-hidden rounded-[28px] sm:rounded-[36px] bg-gradient-to-br from-brand-navy via-[#2d4747] to-[#1f3535] text-white shadow-2xl">
                    <div className="absolute -top-24 -right-24 w-[320px] h-[320px] rounded-full bg-emerald-300/15 blur-3xl" />
                    <div className="absolute -bottom-32 -left-20 w-[260px] h-[260px] rounded-full bg-brand-white/5 blur-3xl" />

                    <div className="relative p-6 sm:p-10 space-y-6">
                        {/* Avatar + greeting */}
                        <motion.div
                            className="flex items-center gap-4"
                            initial={{ opacity: 0, x: -12 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.1, type: 'spring', stiffness: 240 }}
                        >
                            <div className="relative">
                                <div className="absolute inset-0 rounded-[22px] bg-emerald-400/30 blur-xl" />
                                <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-[22px] overflow-hidden ring-2 ring-emerald-300/30 shadow-xl shadow-emerald-900/40">
                                    {me?.avatar_url ? (
                                        <img src={me.avatar_url} alt={me.name || ''} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
                                            <span className="text-2xl sm:text-3xl font-black text-white">{initials}</span>
                                        </div>
                                    )}
                                </div>
                                <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-emerald-400 ring-4 ring-[#1f3535]" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <motion.p
                                    className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-200/75"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.2 }}
                                >
                                    {greeting}
                                </motion.p>
                                <motion.h1
                                    className="text-2xl sm:text-4xl font-black tracking-tight text-white truncate"
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.25, type: 'spring', stiffness: 220 }}
                                >
                                    {firstName}
                                </motion.h1>
                                <motion.p
                                    className="text-[11px] sm:text-xs font-semibold text-white/40 capitalize mt-0.5"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.3 }}
                                >
                                    {todayLabel}
                                </motion.p>
                            </div>
                        </motion.div>

                        {/* Big scan CTA — thumb zone */}
                        <motion.button
                            type="button"
                            onClick={() => setIsScannerOpen(true)}
                            className="group w-full flex items-center gap-4 p-4 sm:p-5 rounded-[22px] bg-emerald-400/10 backdrop-blur-md border border-emerald-300/20 hover:bg-emerald-400/15 active:scale-[0.98] transition-all duration-200"
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.35, type: 'spring', stiffness: 220 }}
                        >
                            <div className="shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/30 group-active:scale-95 transition-transform">
                                <ScanLine className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
                            </div>
                            <div className="flex-1 min-w-0 text-left">
                                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-200/80">
                                    Scanner un colis
                                </p>
                                <p className="text-sm sm:text-base font-bold text-white mt-0.5 truncate">
                                    Trouver par QR code
                                </p>
                            </div>
                            <ArrowRight className="w-5 h-5 text-emerald-200/60 group-hover:translate-x-0.5 transition-transform" />
                        </motion.button>
                    </div>
                </div>
            </motion.section>

            {/* ─── Today stats ─── */}
            <motion.section variants={item}>
                <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
                    <StatCard
                        accent="emerald"
                        icon={CheckCircle2}
                        label="Livrés aujourd'hui"
                        value={String(stats.deliveredToday)}
                        isLoading={isLoadingParcels}
                    />
                    <StatCard
                        accent="navy"
                        icon={Package}
                        label="Colis actifs"
                        value={String(stats.activeCount)}
                        isLoading={isLoadingParcels}
                    />
                    <StatCard
                        accent="amber"
                        icon={Wallet}
                        label="En attente"
                        value={fmtMAD(stats.pendingEarnings)}
                        suffix="MAD"
                        isLoading={isLoadingParcels}
                    />
                </div>
            </motion.section>

            {/* ─── Monthly earnings chart ─── */}
            <motion.section variants={item}>
                <div className="bg-white rounded-[24px] sm:rounded-[28px] border border-brand-navy/[0.05] shadow-sm overflow-hidden">
                    <div className="px-5 sm:px-7 pt-5 sm:pt-7 pb-2">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="flex items-center gap-1.5 mb-1">
                                    <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                                    <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">
                                        Gains mensuels
                                    </p>
                                </div>
                                <h2 className="text-lg sm:text-2xl font-black text-brand-navy tracking-tight">
                                    {fmtMAD2(stats.lifetimePaid)}{' '}
                                    <span className="text-xs sm:text-sm font-bold text-brand-navy/30">MAD</span>
                                </h2>
                                <p className="text-[10px] sm:text-xs font-semibold text-brand-navy/40 mt-0.5">
                                    Total perçu sur {payouts.length} payout{payouts.length !== 1 ? 's' : ''}
                                </p>
                            </div>
                            <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-100">
                                <Sparkles className="w-3 h-3 text-emerald-600" />
                                <span className="text-[9px] font-black uppercase tracking-widest text-emerald-700">
                                    6 mois
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="h-[180px] sm:h-[220px] px-1 sm:px-2 pb-2">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={monthlySeries} margin={{ top: 10, right: 16, left: 16, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="courierEarnGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                                        <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis
                                    dataKey="label"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 700 }}
                                    dy={6}
                                />
                                <YAxis hide />
                                <Tooltip
                                    cursor={{ stroke: '#10b981', strokeWidth: 1, strokeDasharray: '4 4' }}
                                    contentStyle={{
                                        backgroundColor: '#1f3535',
                                        border: 'none',
                                        borderRadius: 14,
                                        padding: '8px 12px',
                                        boxShadow: '0 20px 40px -8px rgba(0,0,0,0.35)',
                                    }}
                                    itemStyle={{ color: '#a7f3d0', fontSize: 12, fontWeight: 800 }}
                                    labelStyle={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}
                                    formatter={(value: number) => [`${fmtMAD2(value)} MAD`, 'Gains']}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="amount"
                                    stroke="#10b981"
                                    strokeWidth={2.5}
                                    fill="url(#courierEarnGrad)"
                                    fillOpacity={1}
                                    animationDuration={900}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </motion.section>

            {/* ─── Donut: status distribution ─── */}
            <motion.section variants={item}>
                <div className="bg-white rounded-[24px] sm:rounded-[28px] border border-brand-navy/[0.05] shadow-sm overflow-hidden p-5 sm:p-7">
                    <div className="flex items-start justify-between gap-3 mb-4">
                        <div>
                            <div className="flex items-center gap-1.5 mb-1">
                                <Activity className="w-3.5 h-3.5 text-brand-navy/50" />
                                <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] text-brand-navy/50">
                                    Répartition
                                </p>
                            </div>
                            <h2 className="text-lg sm:text-2xl font-black text-brand-navy tracking-tight">
                                {parcels.length} colis
                            </h2>
                            <p className="text-[10px] sm:text-xs font-semibold text-brand-navy/40 mt-0.5">
                                Par statut actuel
                            </p>
                        </div>
                    </div>

                    {donutData.length === 0 ? (
                        <div className="py-8 text-center">
                            <div className="w-14 h-14 rounded-2xl bg-brand-navy/[0.04] flex items-center justify-center mx-auto mb-3">
                                <Package className="w-6 h-6 text-brand-navy/30" />
                            </div>
                            <p className="text-xs font-bold text-brand-navy/40">Aucun colis pour le moment</p>
                        </div>
                    ) : (
                        <div className="flex items-center gap-5">
                            <div className="relative w-[120px] h-[120px] sm:w-[140px] sm:h-[140px] shrink-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={donutData}
                                            innerRadius="65%"
                                            outerRadius="100%"
                                            paddingAngle={2}
                                            dataKey="value"
                                            stroke="none"
                                            animationDuration={800}
                                        >
                                            {donutData.map((entry, i) => (
                                                <Cell key={i} fill={entry.color} />
                                            ))}
                                        </Pie>
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                    <p className="text-2xl sm:text-3xl font-black text-brand-navy tabular-nums leading-none">
                                        {parcels.length}
                                    </p>
                                    <p className="text-[8px] font-black uppercase tracking-widest text-brand-navy/40 mt-1">
                                        Total
                                    </p>
                                </div>
                            </div>

                            <div className="flex-1 min-w-0 space-y-2">
                                {donutData.slice(0, 5).map((s) => {
                                    const pct = parcels.length > 0 ? Math.round((s.value / parcels.length) * 100) : 0;
                                    return (
                                        <div key={s.name} className="flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                                            <span className="text-[11px] sm:text-xs font-bold text-brand-navy/70 truncate flex-1">
                                                {s.name}
                                            </span>
                                            <span className="text-[11px] sm:text-xs font-black text-brand-navy tabular-nums">
                                                {s.value}
                                            </span>
                                            <span className="text-[9px] font-bold text-brand-navy/35 w-8 text-right tabular-nums">
                                                {pct}%
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </motion.section>

            {/* ─── Recent activity ─── */}
            <motion.section variants={item}>
                <div className="flex items-end justify-between gap-3 px-1 mb-3">
                    <div>
                        <h2 className="text-base sm:text-lg font-black text-brand-navy tracking-tight">
                            Activité récente
                        </h2>
                        <p className="text-[11px] sm:text-xs font-semibold text-brand-navy/45">
                            Derniers colis mis à jour
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => navigate('/courier/orders')}
                        className="flex items-center gap-1 text-[11px] font-black uppercase tracking-wider text-brand-navy/60 hover:text-brand-navy transition"
                    >
                        Voir tout
                        <ChevronRight className="w-3 h-3" />
                    </button>
                </div>

                {recent.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-brand-navy/[0.05] p-6 text-center">
                        <Clock className="w-5 h-5 text-brand-navy/25 mx-auto mb-2" />
                        <p className="text-xs font-bold text-brand-navy/40">Aucune activité</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {recent.map((p) => (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() =>
                                    navigate(`/courier/orders?tracking=${encodeURIComponent(p.tracking_code || '')}`)
                                }
                                className="w-full bg-white rounded-2xl border border-brand-navy/[0.05] hover:border-brand-navy/15 hover:shadow-sm transition-all p-3.5 flex items-center gap-3 text-left active:scale-[0.995]"
                            >
                                <span
                                    className="w-2.5 h-2.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: p.status_color || '#94a3b8' }}
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1">
                                        <Hash className="w-3 h-3 text-brand-navy/30 shrink-0" />
                                        <p className="text-xs font-mono font-black text-brand-navy truncate">
                                            {p.tracking_code || '—'}
                                        </p>
                                    </div>
                                    <p className="text-[10px] font-semibold text-brand-navy/45 truncate mt-0.5">
                                        {p.order_name || '—'} · {p.order_city || '—'}
                                    </p>
                                </div>
                                <span
                                    className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md shrink-0"
                                    style={{
                                        backgroundColor: `${p.status_color || '#94a3b8'}15`,
                                        color: p.status_color || '#94a3b8',
                                    }}
                                >
                                    {p.status_label || '—'}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </motion.section>

            {/* ─── Quick links ─── */}
            <motion.section variants={item}>
                <div className="grid grid-cols-2 gap-3">
                    <QuickLink
                        icon={Package}
                        label="Mes commandes"
                        sub={`${parcels.length} colis`}
                        onClick={() => navigate('/courier/orders')}
                    />
                    <QuickLink
                        icon={Receipt}
                        label="Paiements"
                        sub={`${payouts.length} payout${payouts.length !== 1 ? 's' : ''}`}
                        onClick={() => navigate('/courier/payments')}
                    />
                </div>
            </motion.section>

            {/* ─── QR Scanner ─── */}
            <QrScanModal
                open={isScannerOpen}
                onClose={() => setIsScannerOpen(false)}
                onDecoded={handleScannedCode}
            />
        </motion.div>
    );
};

export default CourierDashboard;

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
    accent,
    icon: Icon,
    label,
    value,
    suffix,
    isLoading,
}: {
    accent: 'emerald' | 'navy' | 'amber';
    icon: typeof CheckCircle2;
    label: string;
    value: string;
    suffix?: string;
    isLoading?: boolean;
}) {
    const tones = {
        emerald: {
            bg: 'bg-emerald-50/60',
            border: 'border-emerald-100/70',
            icon: 'text-emerald-600',
            iconBg: 'bg-emerald-100',
            val: 'text-emerald-700',
        },
        navy: {
            bg: 'bg-white',
            border: 'border-brand-navy/[0.06]',
            icon: 'text-brand-navy/60',
            iconBg: 'bg-brand-navy/[0.06]',
            val: 'text-brand-navy',
        },
        amber: {
            bg: 'bg-amber-50/60',
            border: 'border-amber-100/70',
            icon: 'text-amber-600',
            iconBg: 'bg-amber-100',
            val: 'text-amber-700',
        },
    }[accent];

    return (
        <div
            className={cn(
                'relative p-3 sm:p-4 rounded-2xl sm:rounded-[22px] border shadow-sm overflow-hidden',
                tones.bg,
                tones.border,
            )}
        >
            <div className={cn('w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center mb-2', tones.iconBg)}>
                <Icon className={cn('w-3.5 h-3.5 sm:w-4 sm:h-4', tones.icon)} />
            </div>
            <p className={cn('text-xl sm:text-2xl font-black tabular-nums leading-none', tones.val)}>
                {isLoading ? '—' : value}
                {suffix && <span className="text-[9px] sm:text-[10px] font-bold ml-1 opacity-60">{suffix}</span>}
            </p>
            <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.15em] text-brand-navy/40 mt-1 leading-tight truncate">
                {label}
            </p>
        </div>
    );
}

function QuickLink({
    icon: Icon,
    label,
    sub,
    onClick,
}: {
    icon: typeof Package;
    label: string;
    sub: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="group flex items-center gap-3 p-4 rounded-2xl bg-white border border-brand-navy/[0.05] hover:border-brand-navy/15 hover:shadow-md transition-all active:scale-[0.98] text-left"
        >
            <div className="w-10 h-10 rounded-xl bg-brand-navy/[0.05] flex items-center justify-center group-hover:bg-brand-navy/10 transition-colors">
                <Icon className="w-4 h-4 text-brand-navy/70" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-xs font-black text-brand-navy tracking-tight truncate">{label}</p>
                <p className="text-[9px] font-bold text-brand-navy/40 truncate mt-0.5">{sub}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-brand-navy/30 group-hover:translate-x-0.5 transition-transform" />
        </button>
    );
}
