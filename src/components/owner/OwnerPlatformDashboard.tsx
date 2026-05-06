import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    AlertCircle,
    Loader2,
    ArrowRight,
    ChevronRight,
} from 'lucide-react';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import {
    eachDayOfInterval,
    endOfDay,
    format,
    startOfDay,
    subDays,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';

type BusinessRow = {
    id: string;
    status: string | null;
    active: boolean | null;
    paid: boolean | null;
    plan_id: string | null;
    created_at: string | null;
    plan: { name: string } | null;
};

type PaymentRow = {
    status: string;
    created_at: string;
};

const ANT = {
    ink: '#141413',
    orange: '#D97706',
    green: '#2D7A3E',
    rose: '#c93942',
    mid: '#6b6a63',
    line: '#e8e6dc',
};

async function fetchOwnerPlatformData() {
    const since = subDays(new Date(), 89).toISOString();

    const [bizRes, payRes, plansRes, ownersRes] = await Promise.all([
        supabase
            .from('businesses')
            .select('id, status, active, paid, plan_id, created_at, plan:plans(name)')
            .order('created_at', { ascending: false }),
        supabase
            .from('business_payments')
            .select('status, created_at')
            .not('proof_url', 'is', null)
            .gte('created_at', since)
            .order('created_at', { ascending: true }),
        supabase.from('plans').select('id, name, active').order('sort_order', { ascending: true }),
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'owner'),
    ]);

    const err = bizRes.error || payRes.error || plansRes.error || ownersRes.error;
    if (err) throw err;

    let tenantUserCount = 0;
    const tenantRes = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .not('DigiCom Business', 'is', null);
    if (!tenantRes.error) tenantUserCount = tenantRes.count ?? 0;

    return {
        businesses: (bizRes.data || []) as BusinessRow[],
        payments: (payRes.data || []) as PaymentRow[],
        plans: plansRes.data || [],
        ownerCount: ownersRes.count ?? 0,
        tenantUserCount,
    };
}

function buildDailySeries(
    rows: { created_at: string }[],
    daysBack: number,
): { day: string; label: string; count: number }[] {
    const end = endOfDay(new Date());
    const start = startOfDay(subDays(end, daysBack - 1));
    const interval = eachDayOfInterval({ start, end });
    const counts = new Map<string, number>();
    interval.forEach((d) => {
        counts.set(format(d, 'yyyy-MM-dd'), 0);
    });
    rows.forEach((r) => {
        if (!r.created_at) return;
        const key = format(startOfDay(new Date(r.created_at)), 'yyyy-MM-dd');
        if (counts.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
    });
    return interval.map((d) => {
        const key = format(d, 'yyyy-MM-dd');
        return {
            day: key,
            label: format(d, 'dd MMM', { locale: fr }),
            count: counts.get(key) || 0,
        };
    });
}

const OwnerPlatformDashboard = () => {
    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ['owner-platform-overview'],
        queryFn: fetchOwnerPlatformData,
    });

    const stats = useMemo(() => {
        if (!data?.businesses) return null;
        const { businesses, payments } = data;
        const total = businesses.length;
        const byStatus = businesses.reduce(
            (acc, b) => {
                const s = (b.status || 'active').toLowerCase();
                if (s === 'active') acc.active += 1;
                else if (s === 'suspended') acc.suspended += 1;
                else if (s === 'deactivated') acc.deactivated += 1;
                else acc.other += 1;
                return acc;
            },
            { active: 0, suspended: 0, deactivated: 0, other: 0 },
        );
        const paidTrue = businesses.filter((b) => b.paid).length;
        const pendingPayments = payments.filter((p) => p.status === 'pending').length;

        const planCounts = businesses.reduce<Record<string, number>>((acc, b) => {
            const name = b.plan?.name || 'No plan';
            acc[name] = (acc[name] || 0) + 1;
            return acc;
        }, {});
        const planChart = Object.entries(planCounts)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 10);

        const statusChart = [
            { name: 'Active', value: byStatus.active, fill: ANT.green },
            { name: 'Suspended', value: byStatus.suspended, fill: ANT.orange },
            { name: 'Deactivated', value: byStatus.deactivated, fill: ANT.rose },
            ...(byStatus.other > 0 ? [{ name: 'Other', value: byStatus.other, fill: ANT.mid }] : []),
        ].filter((d) => d.value > 0);

        const bizDaily = buildDailySeries(
            businesses.map((b) => ({ created_at: b.created_at || '' })).filter((b) => b.created_at),
            30,
        );
        const payDaily = buildDailySeries(payments, 30);

        const activePlans = data.plans.filter((p: { active?: boolean }) => p.active).length;

        return {
            total,
            byStatus,
            paidTrue,
            pendingPayments,
            planChart,
            statusChart,
            bizDaily,
            payDaily,
            activePlans,
        };
    }, [data]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="w-5 h-5 animate-spin text-ant-mid" />
            </div>
        );
    }

    if (isError || !data || !stats) {
        return (
            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                <div className="h-[3px] w-full bg-ant-rose" />
                <div className="p-10 flex flex-col items-center gap-3 text-center">
                    <AlertCircle className="w-6 h-6 text-ant-rose" />
                    <div className="space-y-1">
                        <p className="font-display text-[14px] text-ant-ink">Impossible de charger l'aperçu</p>
                        <p className="font-serif italic text-[12px] text-ant-mid max-w-sm mx-auto">
                            {(error as Error)?.message || 'Une erreur est survenue lors du chargement des données.'}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => refetch()}
                        className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium hover:bg-ant-ink/95 transition-colors"
                    >
                        Réessayer
                    </button>
                </div>
            </section>
        );
    }

    const kpi: Array<{
        title: string;
        value: number;
        sub: string;
        accent: string;
        to: string;
    }> = [
        {
            title: 'Businesses',
            value: stats.total,
            sub: `${stats.byStatus.active} actifs`,
            accent: 'bg-ant-ink',
            to: '/owner/businesses',
        },
        {
            title: 'Paiements en attente',
            value: stats.pendingPayments,
            sub: 'Justificatifs à valider',
            accent: 'bg-ant-orange',
            to: '/owner/payments',
        },
        {
            title: 'Businesses payés',
            value: stats.paidTrue,
            sub: `${stats.total ? Math.round((stats.paidTrue / stats.total) * 100) : 0}% du total`,
            accent: 'bg-ant-green',
            to: '/owner/businesses',
        },
        {
            title: 'Comptes owner',
            value: data.ownerCount,
            sub: 'Rôle plateforme',
            accent: 'bg-ant-ink',
            to: '/owner/users',
        },
        {
            title: 'Utilisateurs tenants',
            value: data.tenantUserCount,
            sub: 'Liés à un business',
            accent: 'bg-ant-ink',
            to: '/owner/businesses',
        },
        {
            title: 'Plans actifs',
            value: stats.activePlans,
            sub: `${data.plans.length} au catalogue`,
            accent: 'bg-ant-green',
            to: '/owner/plans',
        },
    ];

    return (
        <div className="space-y-5 md:space-y-6">
            {/* Editorial header */}
            <header className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        Platform · Owner
                    </span>
                </div>
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                    <div className="space-y-1.5">
                        <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Vue d'ensemble
                        </h1>
                        <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                            Businesses, facturation et accès — état de la plateforme en temps réel.
                        </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <Link
                            to="/owner/businesses"
                            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[11px] font-medium hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors"
                        >
                            Businesses <ArrowRight className="w-3 h-3" />
                        </Link>
                        <Link
                            to="/owner/payments"
                            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[11px] font-medium hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors"
                        >
                            Paiements <ArrowRight className="w-3 h-3" />
                        </Link>
                        <Link
                            to="/owner/plans"
                            className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-full bg-ant-ink text-ant-light text-[11px] font-medium hover:bg-ant-ink/95 transition-colors shadow-[0_8px_20px_-8px_rgba(20,20,19,0.45)]"
                        >
                            Plans
                        </Link>
                    </div>
                </div>
            </header>

            {/* KPI hairline strip — 6 tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                {kpi.map((card) => (
                    <Link
                        key={card.title}
                        to={card.to}
                        className="group bg-ant-paper p-4 flex flex-col gap-2 hover:bg-ant-light/40 transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <span className={cn('w-1 h-4 rounded-full', card.accent)} />
                            <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid truncate flex-1">
                                {card.title}
                            </span>
                            <ChevronRight className="w-3 h-3 text-ant-mid opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <p className="font-display text-[22px] leading-none tabular-nums text-ant-ink">
                            {card.value.toLocaleString('fr-MA')}
                        </p>
                        <p className="font-serif italic text-[11px] text-ant-mid leading-tight">
                            {card.sub}
                        </p>
                    </Link>
                ))}
            </div>

            {/* Charts row 1 — growth */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5">
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-ink" />
                    <div className="px-4 md:px-6 py-4 md:py-5 border-b border-ant-line">
                        <div className="flex items-center gap-2">
                            <span className="font-display text-[11px] text-ant-orange">01</span>
                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                Nouveaux businesses
                            </span>
                        </div>
                        <p className="font-serif italic text-[12px] text-ant-mid mt-1">
                            30 derniers jours · inscriptions par jour
                        </p>
                    </div>
                    <div className="p-3 md:p-5">
                        <ResponsiveContainer width="100%" height={220}>
                            <AreaChart data={stats.bizDaily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="ownerBizGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={ANT.ink} stopOpacity={0.2} />
                                        <stop offset="100%" stopColor={ANT.ink} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke={ANT.line} vertical={false} />
                                <XAxis dataKey="label" tick={{ fontSize: 10, fill: ANT.mid }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                                <YAxis tick={{ fontSize: 10, fill: ANT.mid }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
                                <Tooltip
                                    contentStyle={{
                                        borderRadius: 10,
                                        border: `1px solid ${ANT.line}`,
                                        background: '#ffffff',
                                        boxShadow: '0 8px 24px rgba(20,20,19,0.08)',
                                        fontSize: 11,
                                    }}
                                    labelFormatter={(_, payload) => payload?.[0]?.payload?.day ? String(payload[0].payload.day) : ''}
                                />
                                <Area type="monotone" dataKey="count" stroke={ANT.ink} strokeWidth={1.75} fill="url(#ownerBizGrad)" name="Inscriptions" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </section>

                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="px-4 md:px-6 py-4 md:py-5 border-b border-ant-line">
                        <div className="flex items-center gap-2">
                            <span className="font-display text-[11px] text-ant-orange">02</span>
                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                Justificatifs de paiement
                            </span>
                        </div>
                        <p className="font-serif italic text-[12px] text-ant-mid mt-1">
                            90 derniers jours · uploads par jour
                        </p>
                    </div>
                    <div className="p-3 md:p-5">
                        <ResponsiveContainer width="100%" height={220}>
                            <AreaChart data={stats.payDaily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="ownerPayGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={ANT.orange} stopOpacity={0.25} />
                                        <stop offset="100%" stopColor={ANT.orange} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke={ANT.line} vertical={false} />
                                <XAxis dataKey="label" tick={{ fontSize: 10, fill: ANT.mid }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                                <YAxis tick={{ fontSize: 10, fill: ANT.mid }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
                                <Tooltip
                                    contentStyle={{
                                        borderRadius: 10,
                                        border: `1px solid ${ANT.line}`,
                                        background: '#ffffff',
                                        boxShadow: '0 8px 24px rgba(20,20,19,0.08)',
                                        fontSize: 11,
                                    }}
                                    labelFormatter={(_, payload) => payload?.[0]?.payload?.day ? String(payload[0].payload.day) : ''}
                                />
                                <Area type="monotone" dataKey="count" stroke={ANT.orange} strokeWidth={1.75} fill="url(#ownerPayGrad)" name="Soumissions" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </section>
            </div>

            {/* Charts row 2 — status + plans */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5">
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-green" />
                    <div className="px-4 md:px-6 py-4 md:py-5 border-b border-ant-line">
                        <div className="flex items-center gap-2">
                            <span className="font-display text-[11px] text-ant-orange">03</span>
                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                Businesses par statut
                            </span>
                        </div>
                        <p className="font-serif italic text-[12px] text-ant-mid mt-1">
                            Active · suspended · deactivated
                        </p>
                    </div>
                    <div className="p-3 md:p-5">
                        {stats.statusChart.length === 0 ? (
                            <p className="font-serif italic text-[12px] text-ant-mid text-center py-16">Aucune donnée</p>
                        ) : (
                            <ResponsiveContainer width="100%" height={220}>
                                <BarChart data={stats.statusChart} layout="vertical" margin={{ left: 16 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={ANT.line} horizontal={false} />
                                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: ANT.mid }} axisLine={false} tickLine={false} />
                                    <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: ANT.ink }} axisLine={false} tickLine={false} />
                                    <Tooltip
                                        contentStyle={{
                                            borderRadius: 10,
                                            border: `1px solid ${ANT.line}`,
                                            background: '#ffffff',
                                            boxShadow: '0 8px 24px rgba(20,20,19,0.08)',
                                            fontSize: 11,
                                        }}
                                        cursor={{ fill: 'rgba(20,20,19,0.04)' }}
                                    />
                                    <Bar dataKey="value" radius={[0, 6, 6, 0]} name="Businesses">
                                        {stats.statusChart.map((entry) => (
                                            <Cell key={entry.name} fill={entry.fill} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </section>

                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-ink" />
                    <div className="px-4 md:px-6 py-4 md:py-5 border-b border-ant-line">
                        <div className="flex items-center gap-2">
                            <span className="font-display text-[11px] text-ant-orange">04</span>
                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                Businesses par plan
                            </span>
                        </div>
                        <p className="font-serif italic text-[12px] text-ant-mid mt-1">
                            Top 10 · plans avec le plus d'assignations
                        </p>
                    </div>
                    <div className="p-3 md:p-5">
                        {stats.planChart.length === 0 ? (
                            <p className="font-serif italic text-[12px] text-ant-mid text-center py-16">Aucun business</p>
                        ) : (
                            <ResponsiveContainer width="100%" height={220}>
                                <BarChart data={stats.planChart} margin={{ top: 8, right: 8, left: 0, bottom: 52 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={ANT.line} vertical={false} />
                                    <XAxis
                                        dataKey="name"
                                        tick={{ fontSize: 10, fill: ANT.mid }}
                                        axisLine={false}
                                        tickLine={false}
                                        interval={0}
                                        angle={-25}
                                        textAnchor="end"
                                        height={60}
                                    />
                                    <YAxis tick={{ fontSize: 10, fill: ANT.mid }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
                                    <Tooltip
                                        contentStyle={{
                                            borderRadius: 10,
                                            border: `1px solid ${ANT.line}`,
                                            background: '#ffffff',
                                            boxShadow: '0 8px 24px rgba(20,20,19,0.08)',
                                            fontSize: 11,
                                        }}
                                        cursor={{ fill: 'rgba(20,20,19,0.04)' }}
                                    />
                                    <Bar dataKey="value" fill={ANT.ink} radius={[6, 6, 0, 0]} name="Businesses" />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
};

export default OwnerPlatformDashboard;
