import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
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
            { name: 'Active', value: byStatus.active, fill: '#0f766e' },
            { name: 'Suspended', value: byStatus.suspended, fill: '#f59e0b' },
            { name: 'Deactivated', value: byStatus.deactivated, fill: '#ef4444' },
            ...(byStatus.other > 0 ? [{ name: 'Other', value: byStatus.other, fill: '#94a3b8' }] : []),
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
            <div className="flex items-center justify-center min-h-[50vh]">
                <Loader2 className="w-10 h-10 animate-spin text-brand-navy" />
            </div>
        );
    }

    if (isError || !data || !stats) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 px-4 text-center">
                <AlertCircle className="w-10 h-10 text-red-500" />
                <p className="text-sm text-gray-600 max-w-md">
                    {(error as Error)?.message || 'Could not load platform overview.'}
                </p>
                <Button variant="outline" onClick={() => refetch()}>
                    Retry
                </Button>
            </div>
        );
    }

    const kpi = [
        {
            title: 'Businesses',
            value: stats.total,
            subtitle: `${stats.byStatus.active} active status`,
            icon: Building2,
            iconBg: 'bg-brand-navy/5',
            iconColor: 'text-brand-navy',
            to: '/owner/businesses',
        },
        {
            title: 'Pending payments',
            value: stats.pendingPayments,
            subtitle: 'Proof submissions to review',
            icon: Receipt,
            iconBg: 'bg-amber-50',
            iconColor: 'text-amber-600',
            to: '/owner/payments',
        },
        {
            title: 'Paid businesses',
            value: stats.paidTrue,
            subtitle: `${stats.total ? Math.round((stats.paidTrue / stats.total) * 100) : 0}% of total`,
            icon: CreditCard,
            iconBg: 'bg-emerald-50',
            iconColor: 'text-emerald-600',
            to: '/owner/businesses',
        },
        {
            title: 'Owner accounts',
            value: data.ownerCount,
            subtitle: 'Platform owner role',
            icon: Shield,
            iconBg: 'bg-violet-50',
            iconColor: 'text-violet-600',
            to: '/owner/users',
        },
        {
            title: 'Tenant users',
            value: data.tenantUserCount,
            subtitle: 'Linked to a business',
            icon: Users,
            iconBg: 'bg-blue-50',
            iconColor: 'text-blue-600',
            to: '/owner/businesses',
        },
        {
            title: 'Active plans',
            value: stats.activePlans,
            subtitle: `${data.plans.length} total in catalog`,
            icon: LayoutDashboard,
            iconBg: 'bg-slate-100',
            iconColor: 'text-slate-700',
            to: '/owner/plans',
        },
    ];

    return (
        <div className="min-h-screen">
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Owner overview</h1>
                            <p className="text-gray-500 font-light">
                                Platform-wide businesses, billing, and access — not a single-tenant operations
                                dashboard.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button asChild variant="outline" className="rounded-2xl">
                                <Link to="/owner/businesses">
                                    Businesses <ArrowRight className="w-4 h-4 ml-1" />
                                </Link>
                            </Button>
                            <Button asChild variant="outline" className="rounded-2xl">
                                <Link to="/owner/payments">
                                    Payments <ArrowRight className="w-4 h-4 ml-1" />
                                </Link>
                            </Button>
                            <Button asChild variant="default" className="rounded-2xl bg-brand-navy hover:bg-brand-navy/90">
                                <Link to="/owner/plans">Plans</Link>
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="py-6 space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {kpi.map((card, i) => (
                        <motion.div
                            key={card.title}
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.25, delay: i * 0.04 }}
                        >
                            <Link to={card.to} className="block h-full">
                                <Card className="border-0 shadow-sm rounded-3xl h-full transition-all duration-200 cursor-pointer hover:shadow-md hover:scale-[1.02] active:scale-[0.98]">
                                    <CardContent className="p-4">
                                        <div
                                            className={cn(
                                                'w-9 h-9 rounded-xl flex items-center justify-center mb-2.5',
                                                card.iconBg,
                                            )}
                                        >
                                            <card.icon className={cn('w-4.5 h-4.5', card.iconColor)} />
                                        </div>
                                        <div className="text-2xl font-black text-brand-navy tracking-tight">
                                            {typeof card.value === 'number'
                                                ? card.value.toLocaleString('fr-MA')
                                                : card.value}
                                        </div>
                                        <div className="text-[10px] uppercase tracking-widest font-bold text-gray-400 mt-0.5">
                                            {card.title}
                                        </div>
                                        {card.subtitle && (
                                            <div className="text-[11px] text-gray-500 mt-1">{card.subtitle}</div>
                                        )}
                                    </CardContent>
                                </Card>
                            </Link>
                        </motion.div>
                    ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Card className="border-0 shadow-sm rounded-3xl overflow-hidden">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-lg font-light text-gray-900">
                                New businesses (30 days)
                            </CardTitle>
                            <p className="text-xs text-gray-500">Registrations per day</p>
                        </CardHeader>
                        <CardContent className="h-[280px] pt-2">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={stats.bizDaily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="ownerBizGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#0f766e" stopOpacity={0.35} />
                                            <stop offset="100%" stopColor="#0f766e" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" />
                                    <XAxis
                                        dataKey="label"
                                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                                        interval="preserveStartEnd"
                                    />
                                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} allowDecimals={false} width={32} />
                                    <Tooltip
                                        contentStyle={{
                                            borderRadius: 12,
                                            border: 'none',
                                            boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
                                        }}
                                        labelFormatter={(_, payload) =>
                                            payload?.[0]?.payload?.day
                                                ? String(payload[0].payload.day)
                                                : ''
                                        }
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="count"
                                        stroke="#0f766e"
                                        strokeWidth={2}
                                        fill="url(#ownerBizGrad)"
                                        name="New businesses"
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    <Card className="border-0 shadow-sm rounded-3xl overflow-hidden">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-lg font-light text-gray-900">
                                Payment submissions (90 days)
                            </CardTitle>
                            <p className="text-xs text-gray-500">Proof uploads per day</p>
                        </CardHeader>
                        <CardContent className="h-[280px] pt-2">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={stats.payDaily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="ownerPayGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                                            <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" />
                                    <XAxis
                                        dataKey="label"
                                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                                        interval="preserveStartEnd"
                                    />
                                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} allowDecimals={false} width={32} />
                                    <Tooltip
                                        contentStyle={{
                                            borderRadius: 12,
                                            border: 'none',
                                            boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
                                        }}
                                        labelFormatter={(_, payload) =>
                                            payload?.[0]?.payload?.day
                                                ? String(payload[0].payload.day)
                                                : ''
                                        }
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="count"
                                        stroke="#6366f1"
                                        strokeWidth={2}
                                        fill="url(#ownerPayGrad)"
                                        name="Submissions"
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Card className="border-0 shadow-sm rounded-3xl overflow-hidden">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-lg font-light text-gray-900">Businesses by status</CardTitle>
                        </CardHeader>
                        <CardContent className="h-[280px] pt-2">
                            {stats.statusChart.length === 0 ? (
                                <p className="text-sm text-gray-400 text-center py-20">No data</p>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={stats.statusChart} layout="vertical" margin={{ left: 16 }}>
                                        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" />
                                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                                        <YAxis
                                            type="category"
                                            dataKey="name"
                                            width={88}
                                            tick={{ fontSize: 11, fill: '#64748b' }}
                                        />
                                        <Tooltip
                                            contentStyle={{
                                                borderRadius: 12,
                                                border: 'none',
                                                boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
                                            }}
                                        />
                                        <Bar dataKey="value" radius={[0, 8, 8, 0]} name="Businesses">
                                            {stats.statusChart.map((entry) => (
                                                <Cell key={entry.name} fill={entry.fill} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="border-0 shadow-sm rounded-3xl overflow-hidden">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-lg font-light text-gray-900">Businesses by plan</CardTitle>
                            <p className="text-xs text-gray-500">Top plans by assigned businesses</p>
                        </CardHeader>
                        <CardContent className="h-[280px] pt-2">
                            {stats.planChart.length === 0 ? (
                                <p className="text-sm text-gray-400 text-center py-20">No businesses yet</p>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={stats.planChart} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
                                        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" />
                                        <XAxis
                                            dataKey="name"
                                            tick={{ fontSize: 9, fill: '#94a3b8' }}
                                            interval={0}
                                            angle={-25}
                                            textAnchor="end"
                                            height={56}
                                        />
                                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} allowDecimals={false} width={32} />
                                        <Tooltip
                                            contentStyle={{
                                                borderRadius: 12,
                                                border: 'none',
                                                boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
                                            }}
                                        />
                                        <Bar dataKey="value" fill="#0f766e" radius={[8, 8, 0, 0]} name="Businesses" />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default OwnerPlatformDashboard;
