/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
    AreaChart,
    Area,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
    CartesianGrid,
} from 'recharts';
import {
    Package,
    ScanLine,
    ChevronRight,
    Receipt,
    Clock,
    Hash,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import QrScanModal from '@/components/scanner/QrScanModal';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';

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
    delivered_at: string | null;
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

const CourierDashboard = () => {
    const navigate = useNavigate();
    const { toast } = useToast();
    const [isScannerOpen, setIsScannerOpen] = useState(false);

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

    const { data: parcels = [], isLoading: isLoadingParcels } = useQuery<CourierParcel[]>({
        queryKey: ['courier-dashboard-parcels', courierId, businessId],
        queryFn: async () => {
            if (!courierId || !businessId) return [];
            const { data, error } = await (supabase as any)
                .from('courier_parcels')
                .select(`
                    id, tracking_code, created_at, updated_at, delivered_at, status_label, status_color,
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
                        delivered_at: p.delivered_at,
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
                if (p.delivered_at && isSameDay(new Date(p.delivered_at), today)) deliveredToday++;
            } else if (cat !== 'returned' && cat !== 'cancelled' && cat !== 'refused') {
                activeCount++;
            }
        }

        const lifetimePaid = payouts.reduce((s, n) => s + Number(n.total_shipping_fees || 0), 0);
        const lifetimeDelivered = payouts.reduce((s, n) => s + Number(n.order_count || 0), 0);
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

    const statusProportions = useMemo(() => {
        const map: Record<string, { name: string; value: number; color: string }> = {
            delivered: { name: 'Livré', value: 0, color: '#2D7A3E' },
            new: { name: 'Nouveau', value: 0, color: '#141413' },
            postponed: { name: 'Reporté', value: 0, color: '#D97706' },
            in_transit: { name: 'En transit', value: 0, color: '#141413' },
            out_for_delivery: { name: 'En livraison', value: 0, color: '#2D7A3E' },
            returned: { name: 'Retourné', value: 0, color: '#c93942' },
            cancelled: { name: 'Annulé', value: 0, color: '#b0aea5' },
            refused: { name: 'Refusé', value: 0, color: '#c93942' },
            other: { name: 'Autre', value: 0, color: '#b0aea5' },
        };
        const collapse: Record<string, string> = {
            pickup_pending: 'in_transit',
            picked_up: 'in_transit',
            returning: 'returned',
            recheck: 'postponed',
            scheduled: 'postponed',
            callback: 'new',
            interested: 'new',
            relaunch: 'new',
        };
        for (const [cat, n] of stats.byCategory.entries()) {
            const target = map[cat] ? cat : (collapse[cat] && map[collapse[cat]] ? collapse[cat] : 'other');
            map[target].value += n;
        }
        return Object.values(map).filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
    }, [stats.byCategory]);

    const recent = useMemo(() => {
        return [...parcels]
            .sort((a, b) => {
                const ta = new Date(a.updated_at || a.created_at || 0).getTime();
                const tb = new Date(b.updated_at || b.created_at || 0).getTime();
                return tb - ta;
            })
            .slice(0, 5);
    }, [parcels]);

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

    const now = new Date();
    const greeting = greetingForHour(now.getHours());
    const firstName = (me?.name || '').trim().split(/\s+/)[0] || 'Livreur';
    const todayLabel = format(now, 'EEEE d MMMM', { locale: fr });

    const kpiTiles = [
        { label: "Livrés aujourd'hui", value: isLoadingParcels ? '—' : String(stats.deliveredToday), accent: 'bg-ant-green' },
        { label: 'Colis actifs', value: isLoadingParcels ? '—' : String(stats.activeCount), accent: 'bg-ant-ink' },
        { label: 'En attente (MAD)', value: isLoadingParcels ? '—' : fmtMAD(stats.pendingEarnings), accent: 'bg-ant-orange' },
        { label: 'Total livrés', value: isLoadingParcels ? '—' : String(stats.deliveredTotal), accent: 'bg-ant-ink' },
    ];

    return (
        <div className="space-y-5 md:space-y-6">
            {/* Editorial header */}
            <header className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        Tableau de bord · Livreur
                    </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                    <div className="space-y-1.5">
                        <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            {greeting}, {firstName}
                        </h1>
                        <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                            {todayLabel} — votre tournée commence ici.
                        </p>
                    </div>
                    <button
                        onClick={() => setIsScannerOpen(true)}
                        className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-ant-ink text-ant-light font-medium text-[13px] shadow-[0_12px_30px_-12px_rgba(20,20,19,0.45)] hover:bg-ant-ink/95 active:scale-[0.98] transition-all shrink-0 self-stretch sm:self-auto"
                    >
                        <ScanLine className="w-4 h-4" />
                        Scanner un colis
                    </button>
                </div>
            </header>

            {/* KPI hairline strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                {kpiTiles.map((k) => (
                    <div key={k.label} className="bg-ant-paper p-4 md:p-5 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <span className={cn('w-1 h-4 rounded-full', k.accent)} />
                            <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid truncate">
                                {k.label}
                            </span>
                        </div>
                        <p className="font-display text-[22px] md:text-[26px] leading-none tabular-nums text-ant-ink">
                            {k.value}
                        </p>
                    </div>
                ))}
            </div>

            {/* Monthly earnings chart */}
            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                <div className="h-[3px] w-full bg-ant-green" />
                <div className="px-4 md:px-6 py-4 md:py-5 border-b border-ant-line flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="font-display text-[11px] text-ant-orange">01</span>
                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                Gains mensuels
                            </span>
                        </div>
                        <p className="font-serif italic text-[12px] text-ant-mid mt-1 truncate">
                            {fmtMAD2(stats.lifetimePaid)} MAD · {payouts.length} paiement{payouts.length !== 1 ? 's' : ''}
                        </p>
                    </div>
                </div>
                <div className="p-3 md:p-5">
                    {monthlySeries.every((m) => m.amount === 0) ? (
                        <div className="flex items-center justify-center py-10 rounded-xl border border-dashed border-ant-line">
                            <p className="font-serif italic text-[12px] text-ant-mid">Aucun gain enregistré pour le moment.</p>
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height={180}>
                            <AreaChart data={monthlySeries} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="courierEarnGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#2D7A3E" stopOpacity={0.28} />
                                        <stop offset="95%" stopColor="#2D7A3E" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e8e6dc" vertical={false} />
                                <XAxis
                                    dataKey="label"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 10, fill: '#6b6a63' }}
                                    dy={6}
                                />
                                <YAxis hide />
                                <Tooltip
                                    contentStyle={{
                                        borderRadius: 10,
                                        border: '1px solid #e8e6dc',
                                        background: '#ffffff',
                                        boxShadow: '0 8px 24px rgba(20,20,19,0.08)',
                                        fontSize: 11,
                                    }}
                                    formatter={(value: number) => [`${fmtMAD2(value)} MAD`, 'Gains']}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="amount"
                                    stroke="#2D7A3E"
                                    strokeWidth={1.75}
                                    fill="url(#courierEarnGrad)"
                                    fillOpacity={1}
                                    animationDuration={900}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </section>

            {/* Status distribution */}
            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                <div className="h-[3px] w-full bg-ant-orange" />
                <div className="px-4 md:px-6 py-4 md:py-5 border-b border-ant-line">
                    <div className="flex items-center gap-2">
                        <span className="font-display text-[11px] text-ant-orange">02</span>
                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                            Répartition
                        </span>
                    </div>
                    <p className="font-serif italic text-[12px] text-ant-mid mt-1">
                        {parcels.length} colis attribué{parcels.length !== 1 ? 's' : ''} · statut actuel
                    </p>
                </div>
                <div className="p-4 md:p-6">
                    {statusProportions.length === 0 ? (
                        <p className="font-serif italic text-[12px] text-ant-mid">Aucun colis pour le moment.</p>
                    ) : (
                        <div className="space-y-3">
                            {statusProportions.map((s) => {
                                const pct = parcels.length > 0 ? Math.round((s.value / parcels.length) * 100) : 0;
                                return (
                                    <div key={s.name} className="space-y-1.5">
                                        <div className="flex items-center gap-2 text-[12px]">
                                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                                            <span className="font-medium text-ant-ink flex-1 truncate">{s.name}</span>
                                            <span className="tabular-nums text-ant-ink">{s.value}</span>
                                            <span className="tabular-nums text-ant-mid w-9 text-right">{pct}%</span>
                                        </div>
                                        <div className="h-1 rounded-full bg-ant-line overflow-hidden">
                                            <div
                                                className="h-full rounded-full transition-all duration-500"
                                                style={{ width: `${pct}%`, backgroundColor: s.color }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </section>

            {/* Recent activity */}
            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                <div className="h-[3px] w-full bg-ant-ink" />
                <div className="px-4 md:px-6 py-4 md:py-5 border-b border-ant-line flex items-center justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="font-display text-[11px] text-ant-orange">03</span>
                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                Activité récente
                            </span>
                        </div>
                        <p className="font-serif italic text-[12px] text-ant-mid mt-1">
                            Derniers mouvements sur vos colis
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => navigate('/courier/orders')}
                        className="inline-flex items-center gap-1 h-8 px-3 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[11px] font-medium hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors shrink-0"
                    >
                        Tout voir <ChevronRight className="w-3 h-3" />
                    </button>
                </div>
                {recent.length === 0 ? (
                    <div className="px-4 md:px-6 py-10 flex flex-col items-center gap-2.5 text-center">
                        <Clock className="w-5 h-5 text-ant-mid" />
                        <p className="font-serif italic text-[12px] text-ant-mid">Aucune activité</p>
                    </div>
                ) : (
                    <div className="divide-y divide-ant-line">
                        {recent.map((p) => (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() =>
                                    navigate(`/courier/orders?tracking=${encodeURIComponent(p.tracking_code || '')}`)
                                }
                                className="w-full px-4 md:px-6 py-3 flex items-center gap-3 text-left hover:bg-ant-light/60 active:bg-ant-light transition-colors"
                            >
                                <span
                                    className="w-2 h-2 shrink-0 rounded-full"
                                    style={{ backgroundColor: p.status_color || '#b0aea5' }}
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                        <Hash className="w-3 h-3 text-ant-mid shrink-0" />
                                        <p className="font-mono text-[12px] font-semibold text-ant-ink truncate">
                                            {p.tracking_code || '—'}
                                        </p>
                                    </div>
                                    <p className="text-[11px] text-ant-mid truncate mt-0.5">
                                        {p.order_name || '—'} · {p.order_city || '—'}
                                    </p>
                                </div>
                                <span
                                    className="text-[9px] font-semibold uppercase tracking-[0.15em] px-2 py-1 rounded-full shrink-0 inline-flex items-center gap-1"
                                    style={{
                                        backgroundColor: `${p.status_color || '#b0aea5'}14`,
                                        color: p.status_color || '#6b6a63',
                                    }}
                                >
                                    <span className="w-1 h-1 rounded-full" style={{ backgroundColor: p.status_color || '#b0aea5' }} />
                                    {p.status_label || '—'}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </section>

            {/* Quick links */}
            <div className="grid grid-cols-2 gap-3">
                {[
                    { icon: Package, label: 'Mes commandes', sub: `${parcels.length} colis`, path: '/courier/orders', accent: 'bg-ant-ink' },
                    { icon: Receipt, label: 'Mes paiements', sub: `${payouts.length} paiement${payouts.length !== 1 ? 's' : ''}`, path: '/courier/payments', accent: 'bg-ant-green' },
                ].map(({ icon: Icon, label, sub, path, accent }) => (
                    <button
                        key={path}
                        type="button"
                        onClick={() => navigate(path)}
                        className="group relative rounded-2xl border border-ant-line bg-ant-paper overflow-hidden text-left hover:border-ant-ink/30 transition-colors active:scale-[0.98]"
                    >
                        <div className={cn('h-[3px] w-full', accent)} />
                        <div className="p-4 md:p-5 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-ant-light flex items-center justify-center shrink-0">
                                <Icon className="w-4 h-4 text-ant-ink" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-display text-[13px] text-ant-ink truncate">{label}</p>
                                <p className="font-serif italic text-[11px] text-ant-mid truncate mt-0.5">{sub}</p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-ant-mid group-hover:text-ant-ink transition-colors shrink-0" />
                        </div>
                    </button>
                ))}
            </div>

            <QrScanModal
                open={isScannerOpen}
                onClose={() => setIsScannerOpen(false)}
                onDecoded={handleScannedCode}
            />
        </div>
    );
};

export default CourierDashboard;
