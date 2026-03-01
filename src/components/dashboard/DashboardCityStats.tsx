import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { MapPin } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { Globe } from '@/components/ui/globe';

interface DashboardCityStatsProps {
    businessId: string;
    dateFilter: DateFilter;
}

const COLORS = ['#3b5e5e', '#7a9385', '#F97316', '#3B82F6', '#A855F7', '#14B8A6', '#EC4899', '#c93942', '#6366f1', '#84cc16'];

export const DashboardCityStats = ({ businessId, dateFilter }: DashboardCityStatsProps) => {
    const { data: orders } = useQuery({
        queryKey: ['dashboard-orders-cities', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, date, price, package_status_label, master_city_id, company_id, master_cities(name), order_statuses(code)')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!orders) return null;

        const isInRange = (dateStr: string | null) => {
            if (!dateStr) return true;
            if (!dateFilter.from && !dateFilter.to) return true;
            const d = new Date(dateStr);
            return isWithinInterval(d, {
                start: dateFilter.from ? startOfDay(dateFilter.from) : new Date(0),
                end: dateFilter.to ? endOfDay(dateFilter.to) : new Date(),
            });
        };

        const filtered = orders.filter((o: any) => isInRange(o.date));

        const cityMap: Record<string, { name: string; total: number; delivered: number; confirmed: number; revenue: number }> = {};

        filtered.forEach((o: any) => {
            const cityName = (o.master_cities as any)?.name;
            if (!cityName) return;
            if (!cityMap[cityName]) cityMap[cityName] = { name: cityName, total: 0, delivered: 0, confirmed: 0, revenue: 0 };
            cityMap[cityName].total++;

            const code = ((o.order_statuses as any)?.code || '').toUpperCase();
            if (['CONFIRMED', 'PAID', 'UNPAID', 'PROCESSED'].includes(code)) cityMap[cityName].confirmed++;

            const label = (o.package_status_label || '').toLowerCase();
            if (label === 'livré') {
                cityMap[cityName].delivered++;
                cityMap[cityName].revenue += Number(o.price || 0);
            }
        });

        const sorted = Object.values(cityMap).sort((a, b) => b.total - a.total);

        const chartData = sorted.slice(0, 10).map(c => ({
            name: c.name.substring(0, 14),
            orders: c.total,
            delivered: c.delivered,
        }));

        return { cities: sorted, chartData, totalCities: sorted.length };
    }, [orders, dateFilter]);

    if (!metrics) return null;

    return (
        <Card className="border-0 shadow-sm rounded-3xl">
            <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-cyan-50 flex items-center justify-center">
                        <MapPin className="w-5 h-5 text-cyan-600" />
                    </div>
                    <div>
                        <CardTitle className="text-sm font-bold text-brand-navy">City Statistics</CardTitle>
                        <p className="text-xs text-gray-400 mt-0.5">{metrics.totalCities} cities with orders</p>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Globe */}
                    <div className="flex items-center justify-center">
                        <div className="w-[220px] h-[220px]">
                            <Globe className="w-full h-full" />
                        </div>
                    </div>

                    {/* Chart */}
                    <div>
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Top 10 Cities</h4>
                        <div className="h-[260px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={metrics.chartData} layout="vertical" margin={{ left: 0, right: 5 }}>
                                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={90} />
                                    <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', fontSize: 12 }} />
                                    <Bar dataKey="orders" name="Orders" radius={[0, 8, 8, 0]} barSize={18}>
                                        {metrics.chartData.map((_: any, i: number) => (
                                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* City table */}
                    <div className="max-h-[300px] overflow-y-auto pr-1">
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">All Cities</h4>
                        <div className="space-y-1">
                            {metrics.cities.map((c, i) => {
                                const deliveryRate = c.total > 0 ? ((c.delivered / c.total) * 100).toFixed(0) : '0';
                                return (
                                    <div key={c.name} className="flex items-center justify-between p-2 rounded-xl hover:bg-gray-50 transition-colors">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-gray-300 w-5 text-right">{i + 1}</span>
                                            <span className="text-xs font-medium text-brand-navy truncate max-w-[100px]">{c.name}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-black text-brand-navy">{c.total}</span>
                                            <Badge className={cn(
                                                'text-[9px] px-1 py-0 font-bold',
                                                Number(deliveryRate) >= 20 ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-50' :
                                                Number(deliveryRate) >= 10 ? 'bg-amber-50 text-amber-600 hover:bg-amber-50' :
                                                'bg-red-50 text-red-600 hover:bg-red-50'
                                            )}>
                                                {deliveryRate}%
                                            </Badge>
                                            <span className="text-[10px] text-gray-400 w-16 text-right">
                                                {c.revenue.toLocaleString('fr-MA')} <span className="text-[8px]">MAD</span>
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};
