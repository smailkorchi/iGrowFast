import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Truck, Building2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';

interface ShippingPipelineProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const ShippingPipeline = ({ businessId, dateFilter }: ShippingPipelineProps) => {
    const { getPkgStatusColor, isPkgCategory, returnedPkgIds } = useStatusCategories();
    const { data: orders } = useQuery({
        queryKey: ['dashboard-orders', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, date, price, shipping_cost, order_status_id, package_status_id, package_status_label, seller_id, company_id, source_name, order_statuses(code, label)')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: providers } = useQuery({
        queryKey: ['dashboard-providers', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('providers')
                .select('id, name, logo_url')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!orders || !providers) return null;

        // Types verified via MCP: orders {date,company_id,package_status_id,package_status_label nullable}; providers {id,name NOT NULL, logo_url nullable}
        type SPOrder = { date: string | null; company_id: string | null; package_status_id: string | null; package_status_label: string | null };
        type SPProvider = { id: string; name: string; logo_url: string | null };

        const isInRange = (dateStr: string | null) => {
            if (!dateStr) return true;
            if (!dateFilter.from && !dateFilter.to) return true;
            const d = new Date(dateStr);
            return isWithinInterval(d, {
                start: dateFilter.from ? startOfDay(dateFilter.from) : new Date(0),
                end: dateFilter.to ? endOfDay(dateFilter.to) : new Date(),
            });
        };

        const shipped = (orders as unknown as SPOrder[]).filter((o) => !!o.company_id && isInRange(o.date));

        const statusDist: Record<string, { count: number; statusId: string }> = {};
        shipped.forEach((o) => {
            const label = o.package_status_label;
            const statusId = o.package_status_id;
            if (!label || !statusId) return;
            if (!statusDist[label]) statusDist[label] = { count: 0, statusId };
            statusDist[label].count++;
        });

        const statusChart = Object.entries(statusDist)
            .map(([label, { count, statusId }]) => ({ label, count, color: getPkgStatusColor(statusId) }))
            .sort((a, b) => b.count - a.count);

        const providerDist: Record<string, { total: number; delivered: number; returned: number }> = {};
        shipped.forEach((o) => {
            const pid = o.company_id;
            if (!pid) return;
            if (!providerDist[pid]) providerDist[pid] = { total: 0, delivered: 0, returned: 0 };
            providerDist[pid].total++;
            if (o.package_status_id && isPkgCategory(o.package_status_id, 'delivered')) providerDist[pid].delivered++;
            if (o.package_status_id && returnedPkgIds.has(o.package_status_id)) providerDist[pid].returned++;
        });

        const providersTyped = (providers || []) as unknown as SPProvider[];
        const providerList = Object.entries(providerDist)
            .map(([id, stats]) => {
                const provider = providersTyped.find((p) => p.id === id);
                return {
                    id,
                    name: provider?.name || 'Unknown',
                    logo_url: provider?.logo_url || null,
                    ...stats,
                    deliveryRate: stats.total > 0 ? ((stats.delivered / stats.total) * 100).toFixed(1) : '0',
                };
            })
            .sort((a, b) => b.total - a.total);

        return { total: shipped.length, statusChart, providerList };
    }, [orders, providers, dateFilter, getPkgStatusColor, isPkgCategory, returnedPkgIds]);

    if (!metrics) return null;

    return (
        <Card className="border-0 shadow-sm rounded-3xl">
            <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-indigo-50 flex items-center justify-center">
                        <Truck className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                        <CardTitle className="text-sm font-bold text-brand-navy">Shipping Pipeline</CardTitle>
                        <p className="text-xs text-gray-400 mt-0.5">{metrics.total} shipped orders breakdown</p>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Status distribution */}
                    <div>
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">By Status</h4>
                        <div className="h-[240px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={metrics.statusChart} layout="vertical" margin={{ left: 0, right: 10 }}>
                                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                    <YAxis dataKey="label" type="category" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={120} />
                                    <Tooltip
                                        formatter={(value: number | string) => [`${value} orders`]}
                                        contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', fontSize: 12 }}
                                    />
                                    <Bar dataKey="count" radius={[0, 8, 8, 0]} barSize={20}>
                                        {metrics.statusChart.map((entry, i) => (
                                            <Cell key={i} fill={entry.color} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Provider breakdown */}
                    <div>
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">By Provider</h4>
                        <div className="space-y-2">
                            {metrics.providerList.map(p => (
                                <div key={p.id} className="flex items-center gap-3 p-3 rounded-2xl bg-gray-50">
                                    {p.logo_url ? (
                                        <img src={p.logo_url} alt={p.name} className="w-8 h-8 rounded-xl object-contain bg-white p-0.5" />
                                    ) : (
                                        <div className="w-8 h-8 rounded-xl bg-brand-navy/10 flex items-center justify-center">
                                            <Building2 className="w-4 h-4 text-brand-navy" />
                                        </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-bold text-brand-navy truncate">{p.name}</div>
                                        <div className="text-[10px] text-gray-400">{p.total} shipments</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-sm font-black text-brand-navy">{p.deliveryRate}%</div>
                                        <div className="text-[10px] text-gray-400">
                                            {p.delivered} delivered · {p.returned} returned
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {metrics.providerList.length === 0 && (
                                <p className="text-xs text-gray-400 text-center py-6">No shipped orders</p>
                            )}
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};
