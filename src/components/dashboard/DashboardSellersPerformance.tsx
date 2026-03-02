import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Users, ChevronDown } from 'lucide-react';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';

interface DashboardSellersPerformanceProps {
    businessId: string;
    dateFilter: DateFilter;
}

const EXCLUDED_FROM_CONFIRMATION = new Set([
    '2ab2ec36-3514-4082-bc98-4c0c70fc704b',
    '6e630c78-e048-4406-8aa7-cf1bc2a71fde',
    'b3772ee3-9910-4c5a-85dd-13dfc9f9ff73',
    '9ceb7b82-a081-4362-9820-f1d9fa70d2c9',
    '5c514555-0728-40c7-b6c5-2a006ed21d37',
    '171119c0-5999-4e4b-adb9-3a1a32a7cecd',
    '964ffaa1-8ca0-4a1f-b3a7-466a66fa046d',
    '6b1d31d9-051a-4cf1-8a44-9d5ec4614412',
    'd1e28bff-36d9-46e5-a2d9-9d9405159364',
    'dbb3ae2c-abbf-4c96-93af-ed82319c8b68',
    'b5b9f007-dee5-4873-9424-70cfd9231368',
    'ac63ac02-04e9-4b9e-a917-737107d7fb60',
    '5561c4b1-aed4-4988-816b-4e18fe5e775f',
    '4d622f19-cf11-4d31-b908-5829ce0c57c7',
    '31428d13-bf1f-4b23-b297-b3c112a549e7',
    'deb5c74e-95f3-41a8-8446-c9b831792cca',
]);

const CONFIRMED_CODES = new Set(['CONFIRMED', 'PAID', 'UNPAID', 'PROCESSED']);

const SOURCE_COLORS: Record<string, string> = {
    facebook: 'bg-blue-50 text-blue-700',
    instagram: 'bg-pink-50 text-pink-700',
    tiktok: 'bg-slate-100 text-slate-800',
    whatsapp: 'bg-emerald-50 text-emerald-700',
    'phone call': 'bg-sky-50 text-sky-700',
    connaissance: 'bg-amber-50 text-amber-700',
    reorder: 'bg-teal-50 text-teal-700',
    other: 'bg-gray-100 text-gray-600',
};

export const DashboardSellersPerformance = ({ businessId, dateFilter }: DashboardSellersPerformanceProps) => {
    const [expandedSellers, setExpandedSellers] = useState<Set<string>>(new Set());

    const toggleSeller = (id: string) => {
        setExpandedSellers(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const { data: sellers } = useQuery({
        queryKey: ['dashboard-sellers', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('users')
                .select('id, name, avatar_url, active')
                .eq('role', 'commercial')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

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

    const { data: packageStatuses } = useQuery({
        queryKey: ['dashboard-package-statuses', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('package_statuses')
                .select('id, label, recheck')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!sellers || !orders) return null;

        const recheckPackageIds = new Set(
            (packageStatuses || [])
                .filter((ps: any) => ps.recheck === true)
                .map((ps: any) => ps.id)
        );

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
        const totalOrders = filtered.length;

        const sellerData = sellers.map((seller: any) => {
            const sellerOrders = filtered.filter((o: any) => o.seller_id === seller.id);
            const assignedCount = sellerOrders.length;
            const assignedPercent = totalOrders > 0 ? (assignedCount / totalOrders) * 100 : 0;

            const sourceBreakdown: Record<string, number> = {};
            sellerOrders.forEach((o: any) => {
                const src = (o.source_name || 'other').toLowerCase();
                sourceBreakdown[src] = (sourceBreakdown[src] || 0) + 1;
            });

            const preConfOrders = sellerOrders.filter(
                (o: any) => !EXCLUDED_FROM_CONFIRMATION.has(o.order_status_id)
            );
            const preConfirmationBreakdown: Record<string, number> = {};
            preConfOrders.forEach((o: any) => {
                const label = (o.order_statuses as any)?.label || 'Unknown';
                preConfirmationBreakdown[label] = (preConfirmationBreakdown[label] || 0) + 1;
            });

            const confirmedCount = sellerOrders.filter((o: any) => {
                const code = ((o.order_statuses as any)?.code || '').toUpperCase();
                return CONFIRMED_CODES.has(code);
            }).length;
            const confirmedPercent = assignedCount > 0 ? (confirmedCount / assignedCount) * 100 : 0;

            const postConfOrders = sellerOrders.filter(
                (o: any) => recheckPackageIds.has(o.package_status_id)
            );
            const postConfirmationBreakdown: Record<string, number> = {};
            postConfOrders.forEach((o: any) => {
                const label = o.package_status_label || 'Unknown';
                postConfirmationBreakdown[label] = (postConfirmationBreakdown[label] || 0) + 1;
            });

            const delivered = sellerOrders.filter(
                (o: any) => (o.package_status_label || '').toLowerCase() === 'livré'
            );
            const deliveredCount = delivered.length;
            const deliveredPercent = confirmedCount > 0 ? (deliveredCount / confirmedCount) * 100 : 0;

            const revenue = delivered.reduce((s: number, o: any) => s + Number(o.price || 0), 0);

            return {
                id: seller.id,
                name: seller.name,
                avatar_url: seller.avatar_url,
                active: seller.active,
                assignedCount,
                assignedPercent,
                sourceBreakdown,
                preConfirmationBreakdown,
                confirmedCount,
                confirmedPercent,
                postConfirmationBreakdown,
                deliveredCount,
                deliveredPercent,
                revenue,
            };
        }).sort((a, b) => b.deliveredCount - a.deliveredCount);

        return { sellerData, totalOrders };
    }, [sellers, orders, packageStatuses, dateFilter]);

    if (!metrics) return null;

    return (
        <Card className="border-0 shadow-sm rounded-3xl">
            <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-orange-50 flex items-center justify-center">
                        <Users className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                        <CardTitle className="text-sm font-bold text-brand-navy">Sellers Performance</CardTitle>
                        <p className="text-xs text-gray-400 mt-0.5">
                            {metrics.sellerData.length} sellers &middot; {metrics.totalOrders.toLocaleString('fr-MA')} total orders
                        </p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-1.5">
                {metrics.sellerData.map((s) => {
                    const isExpanded = expandedSellers.has(s.id);
                    return (
                        <div
                            key={s.id}
                            className={cn(
                                'border rounded-2xl overflow-hidden transition-all',
                                isExpanded ? 'border-gray-200 shadow-sm' : 'border-gray-100'
                            )}
                        >
                            <button
                                onClick={() => toggleSeller(s.id)}
                                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50/60 transition-colors text-left"
                            >
                                <div className="flex items-center gap-2.5 min-w-[130px] shrink-0">
                                    {s.avatar_url ? (
                                        <img src={s.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                                    ) : (
                                        <div className="w-8 h-8 rounded-full bg-brand-navy/10 flex items-center justify-center text-[11px] font-bold text-brand-navy shrink-0">
                                            {s.name?.[0]}
                                        </div>
                                    )}
                                    <div className="min-w-0">
                                        <span className="font-bold text-brand-navy text-xs block truncate">{s.name}</span>
                                        {!s.active && <Badge variant="outline" className="text-[8px] px-1 py-0 mt-0.5">Inactive</Badge>}
                                    </div>
                                </div>

                                <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
                                    <MetricCell
                                        label="Assigned"
                                        value={s.assignedCount}
                                        sub={`${s.assignedPercent.toFixed(1)}% of total`}
                                    />
                                    <MetricCell
                                        label="Confirmed"
                                        value={s.confirmedCount}
                                        percent={s.confirmedPercent}
                                    />
                                    <MetricCell
                                        label="Delivered"
                                        value={s.deliveredCount}
                                        percent={s.deliveredPercent}
                                    />
                                    <div className="text-center">
                                        <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Revenue</p>
                                        <p className="text-sm font-bold text-emerald-600 leading-tight mt-0.5">
                                            {s.revenue.toLocaleString('fr-MA')}
                                        </p>
                                        <p className="text-[10px] text-gray-400">MAD</p>
                                    </div>
                                </div>

                                <ChevronDown className={cn(
                                    'w-4 h-4 text-gray-400 transition-transform shrink-0',
                                    isExpanded && 'rotate-180'
                                )} />
                            </button>

                            {isExpanded && (
                                <div className="px-4 pb-4 pt-2 border-t border-gray-100 bg-gray-50/30 space-y-3">
                                    <BreakdownSection title="Sources">
                                        {Object.entries(s.sourceBreakdown).length > 0 ? (
                                            Object.entries(s.sourceBreakdown)
                                                .sort(([, a], [, b]) => b - a)
                                                .map(([source, count]) => (
                                                    <PillBadge
                                                        key={source}
                                                        label={source}
                                                        count={count}
                                                        className={SOURCE_COLORS[source] || SOURCE_COLORS.other}
                                                    />
                                                ))
                                        ) : (
                                            <EmptyLabel text="No source data" />
                                        )}
                                    </BreakdownSection>

                                    <BreakdownSection title="Status Before Confirmation">
                                        {Object.entries(s.preConfirmationBreakdown).length > 0 ? (
                                            Object.entries(s.preConfirmationBreakdown)
                                                .sort(([, a], [, b]) => b - a)
                                                .map(([label, count]) => (
                                                    <PillBadge
                                                        key={label}
                                                        label={label}
                                                        count={count}
                                                        className="bg-orange-50 text-orange-700"
                                                    />
                                                ))
                                        ) : (
                                            <EmptyLabel text="None pending" />
                                        )}
                                    </BreakdownSection>

                                    <BreakdownSection title="Status After Confirmation">
                                        {Object.entries(s.postConfirmationBreakdown).length > 0 ? (
                                            Object.entries(s.postConfirmationBreakdown)
                                                .sort(([, a], [, b]) => b - a)
                                                .map(([label, count]) => (
                                                    <PillBadge
                                                        key={label}
                                                        label={label}
                                                        count={count}
                                                        className="bg-violet-50 text-violet-700"
                                                    />
                                                ))
                                        ) : (
                                            <EmptyLabel text="None in suivi" />
                                        )}
                                    </BreakdownSection>
                                </div>
                            )}
                        </div>
                    );
                })}
                {metrics.sellerData.length === 0 && (
                    <p className="text-center py-8 text-gray-400 text-xs">No sellers found</p>
                )}
            </CardContent>
        </Card>
    );
};

function MetricCell({ label, value, sub, percent }: {
    label: string;
    value: number;
    sub?: string;
    percent?: number;
}) {
    return (
        <div className="text-center">
            <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">{label}</p>
            <p className="text-sm font-bold text-brand-navy leading-tight mt-0.5">{value}</p>
            {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
            {percent !== undefined && (
                <Badge className={cn(
                    'text-[9px] px-1.5 py-0 font-bold',
                    percent >= 50 ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-50' :
                    percent >= 25 ? 'bg-amber-50 text-amber-600 hover:bg-amber-50' :
                    'bg-red-50 text-red-600 hover:bg-red-50'
                )}>
                    {percent.toFixed(1)}%
                </Badge>
            )}
        </div>
    );
}

function BreakdownSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">{title}</h5>
            <div className="flex flex-wrap gap-1.5">{children}</div>
        </div>
    );
}

function PillBadge({ label, count, className }: { label: string; count: number; className: string }) {
    return (
        <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full', className)}>
            {label}: {count}
        </span>
    );
}

function EmptyLabel({ text }: { text: string }) {
    return <span className="text-[10px] text-gray-400 italic">{text}</span>;
}
