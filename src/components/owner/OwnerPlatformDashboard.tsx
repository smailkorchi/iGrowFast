import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import {
    Building2,
    CreditCard,
    Users,
    Receipt,
    AlertCircle,
    LayoutDashboard,
    Loader2,
    ArrowRight,
    Shield,
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
            label: format(d, 'dd MMM'),
            count: counts.get(key) || 0,
        };
    });
}

const KPI_ACCENTS = ['#3b5e5e', '#d97706', '#059669', '#9ca3af', '#9ca3af', '#9ca3af'];

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
            { name: 'Active', value: byStatus.active, fill: '#059669' },
            { name: 'Suspended', value: byStatus.suspended, fill: '#d97706' },
            { name: 'Deactivated', value: byStatus.deactivated, fill: '#ef4444' },
            ...(byStatus.other > 0 ? [{ name: 'Other', value: byStatus.other, fill: '#9ca3af' }] : []),
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
            <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 flex items-center justify-center min-h-[50vh]">
                <Loader2 className="w-5 h-5 animate-spin text-brand-navy/40" />
            </div>
        );
    }

    if (isError || !data || !stats) {
        return (
            <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 flex flex-col items-center justify-center min-h-[50vh] gap-3 text-center">
                <AlertCircle className="w-5 h-5 text-red-500" />
                <p className="text-[11px] text-gray-500 max-w-sm">
                    {(error as Error)?.message || 'Could not load platform overview.'}
                </p>
                <Button variant="outline" size="sm" className="h-8 rounded-md text-[11px] font-semibold" onClick={() => refetch()}>
                    Retry
                </Button>
            </div>
        );
    }

    const kpi = [
        {
            title: 'Businesses',
            value: stats.total,
            sub: `${stats.byStatus.active} active`,
            accent: KPI_ACCENTS[0],
            to: '/owner/businesses',
        },
        {
            title: 'Pending payments',
            value: stats.pendingPayments,
            sub: 'Proof submissions to review',
            accent: KPI_ACCENTS[1],
            to: '/owner/payments',
        },
        {
            title: 'Paid businesses',
            value: stats.paidTrue,
            sub: `${stats.total ? Math.round((stats.paidTrue / stats.total) * 100) : 0}% of total`,
            accent: KPI_ACCENTS[2],
            to: '/owner/businesses',
        },
        {
            title: 'Owner accounts',
            value: data.ownerCount,
            sub: 'Platform owner role',
            accent: KPI_ACCENTS[3],
            to: '/owner/users',
        },
        {
            title: 'Tenant users',
            value: data.tenantUserCount,
            sub: 'Linked to a business',
            accent: KPI_ACCENTS[4],
            to: '/owner/businesses',
        },
        {
            title: 'Active plans',
            value: stats.activePlans,
            sub: `${data.plans.length} total in catalog`,
            accent: KPI_ACCENTS[5],
            to: '/owner/plans',
        },
    ];

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Owner Overview</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Platform-wide businesses, billing, and access</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Button asChild variant="outline" className="h-8 rounded-md text-[11px] font-semibold gap-1.5 px-3">
                            <Link to="/owner/businesses">
                                Businesses <ArrowRight className="w-3 h-3" />
                            </Link>
                        </Button>
                        <Button asChild variant="outline" className="h-8 rounded-md text-[11px] font-semibold gap-1.5 px-3">
                            <Link to="/owner/payments">
                                Payments <ArrowRight className="w-3 h-3" />
                            </Link>
                        </Button>
                        <Button asChild className="h-8 rounded-md text-[11px] font-semibold px-3 bg-brand-navy hover:bg-brand-navy/90">
                            <Link to="/owner/plans">Plans</Link>
                        </Button>
                    </div>
                </div>
            </header>

            {/* KPI tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {kpi.map((card) => (
                    <Link key={card.title} to={card.to} className="block">
                        <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5 hover:border-gray-200 transition-colors">
                            <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: card.accent }} />
                            <div className="flex-1 min-w-0">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 leading-tight">{card.title}</p>
                                <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1 leading-none">
                                    {typeof card.value === 'number' ? card.value.toLocaleString('fr-MA') : card.value}
                                </p>
                                {card.sub && <p className="text-[9px] text-gray-400 mt-0.5 leading-tight">{card.sub}</p>}
                            </div>
                        </div>
                    </Link>
                ))}
            </div>

            {/* Charts row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="rounded-xl border border-gray-100 bg-white p-3.5">
                    <div className="mb-2">
                        <p className="text-[11px] font-semibold text-brand-navy">New businesses (30 days)</p>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em]">Registrations per day</p>
                    </div>
                    <div className="h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={stats.bizDaily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="ownerBizGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#3b5e5e" stopOpacity={0.25} />
                                        <stop offset="100%" stopColor="#3b5e5e" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" />
                                <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9ca3af' }} interval="preserveStartEnd" />
                                <YAxis tick={{ fontSize: 9, fill: '#9ca3af' }} allowDecimals={false} width={28} />
                                <Tooltip
                                    contentStyle={{ borderRadius: 8, border: '1px solid #f3f4f6', boxShadow: 'none', fontSize: 11 }}
                                    labelFormatter={(_, payload) =>
                                        payload?.[0]?.payload?.day ? String(payload[0].payload.day) : ''
                                    }
                                />
                                <Area type="monotone" dataKey="count" stroke="#3b5e5e" strokeWidth={1.5} fill="url(#ownerBizGrad)" name="New businesses" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="rounded-xl border border-gray-100 bg-white p-3.5">
                    <div className="mb-2">
                        <p className="text-[11px] font-semibold text-brand-navy">Payment submissions (90 days)</p>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em]">Proof uploads per day</p>
                    </div>
                    <div className="h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={stats.payDaily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="ownerPayGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#d97706" stopOpacity={0.25} />
                                        <stop offset="100%" stopColor="#d97706" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" />
                                <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9ca3af' }} interval="preserveStartEnd" />
                                <YAxis tick={{ fontSize: 9, fill: '#9ca3af' }} allowDecimals={false} width={28} />
                                <Tooltip
                                    contentStyle={{ borderRadius: 8, border: '1px solid #f3f4f6', boxShadow: 'none', fontSize: 11 }}
                                    labelFormatter={(_, payload) =>
                                        payload?.[0]?.payload?.day ? String(payload[0].payload.day) : ''
                                    }
                                />
                                <Area type="monotone" dataKey="count" stroke="#d97706" strokeWidth={1.5} fill="url(#ownerPayGrad)" name="Submissions" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Charts row 2 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="rounded-xl border border-gray-100 bg-white p-3.5">
                    <div className="mb-2">
                        <p className="text-[11px] font-semibold text-brand-navy">Businesses by status</p>
                    </div>
                    <div className="h-[220px]">
                        {stats.statusChart.length === 0 ? (
                            <p className="text-[11px] text-gray-400 text-center py-16">No data</p>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={stats.statusChart} layout="vertical" margin={{ left: 16 }}>
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" />
                                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 9, fill: '#9ca3af' }} />
                                    <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10, fill: '#6b7280' }} />
                                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #f3f4f6', boxShadow: 'none', fontSize: 11 }} />
                                    <Bar dataKey="value" radius={[0, 6, 6, 0]} name="Businesses">
                                        {stats.statusChart.map((entry) => (
                                            <Cell key={entry.name} fill={entry.fill} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                <div className="rounded-xl border border-gray-100 bg-white p-3.5">
                    <div className="mb-2">
                        <p className="text-[11px] font-semibold text-brand-navy">Businesses by plan</p>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em]">Top plans by assigned businesses</p>
                    </div>
                    <div className="h-[220px]">
                        {stats.planChart.length === 0 ? (
                            <p className="text-[11px] text-gray-400 text-center py-16">No businesses yet</p>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={stats.planChart} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" />
                                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#9ca3af' }} interval={0} angle={-25} textAnchor="end" height={52} />
                                    <YAxis tick={{ fontSize: 9, fill: '#9ca3af' }} allowDecimals={false} width={28} />
                                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #f3f4f6', boxShadow: 'none', fontSize: 11 }} />
                                    <Bar dataKey="value" fill="#3b5e5e" radius={[6, 6, 0, 0]} name="Businesses" />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OwnerPlatformDashboard;
