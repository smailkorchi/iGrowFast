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
    CheckCircle2,
    Package,
    ScanLine,
    Wallet,
    ArrowRight,
    Hash,
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
import { Button } from '@/components/ui/button';

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

    // ── Status proportion list ─────────────────────────────────────────
    const statusProportions = useMemo(() => {
        const map: Record<string, { name: string; value: number; color: string }> = {
            delivered: { name: 'Livré', value: 0, color: '#059669' },
            new: { name: 'Nouveau', value: 0, color: '#3b5e5e' },
            postponed: { name: 'Reporté', value: 0, color: '#b45309' },
            in_transit: { name: 'En transit', value: 0, color: '#3b5e5e' },
            out_for_delivery: { name: 'En livraison', value: 0, color: '#059669' },
            returned: { name: 'Retourné', value: 0, color: '#ef4444' },
            cancelled: { name: 'Annulé', value: 0, color: '#9ca3af' },
            refused: { name: 'Refusé', value: 0, color: '#ef4444' },
            other: { name: 'Autre', value: 0, color: '#9ca3af' },
        };
        for (const [cat, n] of stats.byCategory.entries()) {
            if (map[cat]) map[cat].value += n;
            else map.other.value += n;
        }
        return Object.values(map).filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
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

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">
                            {greeting}, {firstName}
                        </h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">
                            {todayLabel}
                        </p>
                    </div>
                    <Button
                        onClick={() => setIsScannerOpen(true)}
                        className="h-8 rounded-md text-[11px] font-semibold bg-brand-navy hover:bg-brand-navy/90 text-white gap-1.5 shrink-0"
                    >
                        <ScanLine className="w-3.5 h-3.5" />
                        Scanner un colis
                    </Button>
                </div>
            </header>

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                    { label: "Livrés aujourd'hui", value: isLoadingParcels ? '—' : String(stats.deliveredToday), accent: '#059669' },
                    { label: 'Colis actifs', value: isLoadingParcels ? '—' : String(stats.activeCount), accent: '#3b5e5e' },
                    { label: 'En attente (MAD)', value: isLoadingParcels ? '—' : fmtMAD(stats.pendingEarnings), accent: '#d97706' },
                    { label: 'Total livrés', value: isLoadingParcels ? '—' : String(stats.deliveredTotal), accent: '#3b5e5e' },
                ].map((s) => (
                    <div key={s.label} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                        <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: s.accent }} />
                        <div className="flex-1 min-w-0">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 truncate">{s.label}</p>
                            <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1 leading-none">{s.value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Monthly earnings chart */}
            <div className="rounded-xl border border-gray-100 bg-white p-3.5">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Gains mensuels</p>
                        <p className="text-[11px] text-brand-navy/60 font-medium mt-0.5">
                            {fmtMAD2(stats.lifetimePaid)} MAD total · {payouts.length} payout{payouts.length !== 1 ? 's' : ''}
                        </p>
                    </div>
                </div>
                {monthlySeries.every((m) => m.amount === 0) ? (
                    <div className="flex items-center justify-center py-8 border border-dashed border-gray-200 rounded-lg">
                        <p className="text-[11px] text-gray-400">Aucun gain enregistré pour le moment.</p>
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height={160}>
                        <AreaChart data={monthlySeries} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="courierEarnGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#059669" stopOpacity={0.25} />
                                    <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                            <XAxis
                                dataKey="label"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 10, fill: '#9ca3af' }}
                                dy={6}
                            />
                            <YAxis hide />
                            <Tooltip
                                contentStyle={{
                                    borderRadius: 8,
                                    border: '1px solid #f3f4f6',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                                    fontSize: 11,
                                }}
                                formatter={(value: number) => [`${fmtMAD2(value)} MAD`, 'Gains']}
                            />
                            <Area
                                type="monotone"
                                dataKey="amount"
                                stroke="#059669"
                                strokeWidth={1.5}
                                fill="url(#courierEarnGrad)"
                                fillOpacity={1}
                                animationDuration={900}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>

            {/* Status proportions */}
            <div className="rounded-xl border border-gray-100 bg-white p-3.5">
                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 mb-3">
                    Répartition · {parcels.length} colis
                </p>
                {statusProportions.length === 0 ? (
                    <p className="text-[11px] text-gray-400">Aucun colis pour le moment.</p>
                ) : (
                    <div className="space-y-2">
                        {statusProportions.map((s) => {
                            const pct = parcels.length > 0 ? Math.round((s.value / parcels.length) * 100) : 0;
                            return (
                                <div key={s.name} className="flex items-center gap-2.5">
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                                    <span className="text-[11px] font-semibold text-brand-navy/80 truncate flex-1">{s.name}</span>
                                    <span className="text-[11px] font-semibold tabular-nums text-brand-navy">{s.value}</span>
                                    <span className="text-[9px] text-gray-400 w-8 text-right tabular-nums">{pct}%</span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Recent activity */}
            <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                <div className="px-3.5 py-3 border-b border-gray-100 flex items-center justify-between">
                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Activité récente</p>
                    <button
                        type="button"
                        onClick={() => navigate('/courier/orders')}
                        className="flex items-center gap-1 text-[10px] font-semibold text-brand-navy/50 hover:text-brand-navy transition"
                    >
                        Voir tout <ChevronRight className="w-3 h-3" />
                    </button>
                </div>
                {recent.length === 0 ? (
                    <div className="px-3.5 py-6 flex flex-col items-center gap-2 text-center">
                        <Clock className="w-5 h-5 text-gray-300" />
                        <p className="text-[11px] text-gray-400">Aucune activité</p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-50">
                        {recent.map((p) => (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() =>
                                    navigate(`/courier/orders?tracking=${encodeURIComponent(p.tracking_code || '')}`)
                                }
                                className="w-full px-3.5 py-2 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors"
                            >
                                <span
                                    className="w-2 h-2 shrink-0 rounded-full"
                                    style={{ backgroundColor: p.status_color || '#9ca3af' }}
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1">
                                        <Hash className="w-3 h-3 text-gray-400 shrink-0" />
                                        <p className="text-[11px] font-mono font-semibold text-brand-navy truncate">
                                            {p.tracking_code || '—'}
                                        </p>
                                    </div>
                                    <p className="text-[9px] text-gray-400 truncate mt-0.5">
                                        {p.order_name || '—'} · {p.order_city || '—'}
                                    </p>
                                </div>
                                <span
                                    className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                                    style={{
                                        backgroundColor: `${p.status_color || '#9ca3af'}15`,
                                        color: p.status_color || '#9ca3af',
                                    }}
                                >
                                    {p.status_label || '—'}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Quick links */}
            <div className="grid grid-cols-2 gap-2">
                {[
                    { icon: Package, label: 'Mes commandes', sub: `${parcels.length} colis`, path: '/courier/orders' },
                    { icon: Receipt, label: 'Paiements', sub: `${payouts.length} payout${payouts.length !== 1 ? 's' : ''}`, path: '/courier/payments' },
                ].map(({ icon: Icon, label, sub, path }) => (
                    <button
                        key={path}
                        type="button"
                        onClick={() => navigate(path)}
                        className="group flex items-center gap-3 p-3.5 rounded-xl bg-white border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition-all text-left"
                    >
                        <div className="w-8 h-8 rounded-md bg-gray-100 flex items-center justify-center shrink-0 group-hover:bg-brand-navy/10 transition-colors">
                            <Icon className="w-4 h-4 text-brand-navy/70" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-semibold text-brand-navy truncate">{label}</p>
                            <p className="text-[9px] text-gray-400 truncate mt-0.5">{sub}</p>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-brand-navy/40 transition-colors shrink-0" />
                    </button>
                ))}
            </div>

            {/* QR Scanner */}
            <QrScanModal
                open={isScannerOpen}
                onClose={() => setIsScannerOpen(false)}
                onDecoded={handleScannedCode}
            />
        </div>
    );
};

export default CourierDashboard;
