import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Users } from 'lucide-react';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import {
    commissionAccruedForDeliveredOrder,
    isDeliveredForCommission,
    normalizeCommissionBasis,
    type CommissionBasis,
} from '@/lib/commercialCommission';

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

export interface SellerSelfPerformanceSectionProps {
    sellerId: string;
    businessId: string | null | undefined;
    dateFilter: DateFilter;
}

export function SellerSelfPerformanceSection({
    sellerId,
    businessId,
    dateFilter,
}: SellerSelfPerformanceSectionProps) {
    const {
        confirmedIds,
        callbackIds,
        cancelledIds,
        deliveredPkgIds,
        getPkgsByCategories,
    } = useStatusCategories();

    const { data: sellerRow, isLoading: loadingSeller } = useQuery({
        queryKey: ['seller-self-performance-profile', sellerId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('users')
                .select('id, name, avatar_url, active, commission_price, commission_basis, products')
                .eq('id', sellerId)
                .single();
            if (error) throw error;
            return data;
        },
        enabled: !!sellerId,
    });

    const { data: orders, isLoading: loadingOrders } = useQuery({
        queryKey: ['seller-self-performance-orders', businessId || 'no-biz', sellerId],
        queryFn: async () => {
            let q = supabase
                .from('orders')
                .select(
                    'id, date, price, order_status_id, package_status_id, package_status_label, seller_id, source_name, order_items(product_id, quantity), order_statuses(code, label)'
                );
            if (businessId) {
                q = q.eq('DigiCom Business', businessId);
            } else {
                q = q.eq('seller_id', sellerId);
            }
            const { data, error } = await q;
            if (error) throw error;
            return data || [];
        },
        enabled: !!sellerId,
    });

    const loading = loadingSeller || loadingOrders;
    const commissionBasis: CommissionBasis = normalizeCommissionBasis(
        sellerRow?.commission_basis as string | null | undefined
    );
    const commissionPrice = Number(sellerRow?.commission_price ?? 0) || 0;
    const attributedProducts: string[] = Array.isArray(sellerRow?.products)
        ? (sellerRow!.products as string[]).filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];

    const metrics = useMemo(() => {
        if (!orders || !sellerRow) return null;

        const recheckPackageIds = new Set(getPkgsByCategories(['recheck']).map((p) => p.id));
        const isExcludedFromConfirmation = (statusId: string) =>
            callbackIds.has(statusId) || cancelledIds.has(statusId);

        const isInRange = (dateStr: string | null) => {
            if (!dateStr) return true;
            if (!dateFilter.from && !dateFilter.to) return true;
            const d = new Date(dateStr);
            return isWithinInterval(d, {
                start: dateFilter.from ? startOfDay(dateFilter.from) : new Date(0),
                end: dateFilter.to ? endOfDay(dateFilter.to) : new Date(),
            });
        };

        const filtered = (orders as any[]).filter((o) => isInRange(o.date));
        const totalOrders = filtered.length;

        const sellerOrders = filtered.filter((o: any) => o.seller_id === sellerId);
        const assignedCount = sellerOrders.length;
        const assignedPercent = totalOrders > 0 ? (assignedCount / totalOrders) * 100 : 0;

        const sourceBreakdown: Record<string, number> = {};
        sellerOrders.forEach((o: any) => {
            const src = (o.source_name || 'other').toLowerCase();
            sourceBreakdown[src] = (sourceBreakdown[src] || 0) + 1;
        });

        const preConfOrders = sellerOrders.filter((o: any) => !isExcludedFromConfirmation(o.order_status_id));
        const preConfirmationBreakdown: Record<string, number> = {};
        preConfOrders.forEach((o: any) => {
            const label = (o.order_statuses as any)?.label || 'Unknown';
            preConfirmationBreakdown[label] = (preConfirmationBreakdown[label] || 0) + 1;
        });

        const confirmedCount = sellerOrders.filter((o: any) => confirmedIds.has(o.order_status_id)).length;
        const confirmedPercent = assignedCount > 0 ? (confirmedCount / assignedCount) * 100 : 0;

        const postConfOrders = sellerOrders.filter((o: any) => recheckPackageIds.has(o.package_status_id));
        const postConfirmationBreakdown: Record<string, number> = {};
        postConfOrders.forEach((o: any) => {
            const label = o.package_status_label || 'Unknown';
            postConfirmationBreakdown[label] = (postConfirmationBreakdown[label] || 0) + 1;
        });

        const delivered = sellerOrders.filter((o: any) => isDeliveredForCommission(o, deliveredPkgIds));
        const deliveredCount = delivered.length;
        const deliveredPercent = confirmedCount > 0 ? (deliveredCount / confirmedCount) * 100 : 0;

        const commissionEarned = delivered.reduce(
            (s: number, o: any) =>
                s +
                commissionAccruedForDeliveredOrder({
                    order: o,
                    basis: commissionBasis,
                    commissionPrice,
                    sellerProductIds: attributedProducts,
                }),
            0
        );

        return {
            name: sellerRow.name,
            avatar_url: sellerRow.avatar_url,
            active: sellerRow.active,
            assignedCount,
            assignedPercent,
            sourceBreakdown,
            preConfirmationBreakdown,
            confirmedCount,
            confirmedPercent,
            postConfirmationBreakdown,
            deliveredCount,
            deliveredPercent,
            commissionEarned,
            totalOrders,
        };
    }, [
        orders,
        sellerRow,
        sellerId,
        dateFilter,
        confirmedIds,
        callbackIds,
        cancelledIds,
        deliveredPkgIds,
        getPkgsByCategories,
        commissionBasis,
        commissionPrice,
        attributedProducts,
    ]);

    if (!sellerId) return null;

    if (loading) {
        return (
            <Card className="border-0 shadow-sm rounded-3xl">
                <CardHeader className="pb-2">
                    <div className="h-10 w-48 rounded-xl bg-gray-100 animate-pulse" />
                </CardHeader>
                <CardContent>
                    <div className="h-24 rounded-2xl bg-gray-50 animate-pulse" />
                </CardContent>
            </Card>
        );
    }

    if (!metrics) return null;

    const s = metrics;

    return (
        <Card className="border-0 shadow-sm rounded-3xl">
            <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-orange-50 flex items-center justify-center">
                        <Users className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                        <CardTitle className="text-sm font-bold text-brand-navy">Performance breakdown</CardTitle>
                        <p className="text-xs text-gray-400 mt-0.5">
                            Your stats · {s.totalOrders.toLocaleString('fr-MA')} total orders in period
                            {businessId ? ' (business-wide)' : ''}
                        </p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-1.5">
                <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                    <div className="w-full flex items-center gap-3 px-4 py-3 bg-white text-left">
                        <div className="flex items-center gap-2.5 min-w-[130px] shrink-0">
                            {s.avatar_url ? (
                                <img src={s.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                            ) : (
                                <div className="w-8 h-8 rounded-full bg-brand-navy/10 flex items-center justify-center text-[11px] font-bold text-brand-navy shrink-0">
                                    {s.name?.[0] ?? '?'}
                                </div>
                            )}
                            <div className="min-w-0">
                                <span className="font-bold text-brand-navy text-xs block truncate">{s.name || 'You'}</span>
                                {sellerRow && !sellerRow.active && (
                                    <Badge variant="outline" className="text-[8px] px-1 py-0 mt-0.5">
                                        Inactive
                                    </Badge>
                                )}
                            </div>
                        </div>

                        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
                            <MetricCell
                                label="Assigned"
                                value={s.assignedCount}
                                sub={`${s.assignedPercent.toFixed(1)}% of total`}
                            />
                            <MetricCell label="Confirmed" value={s.confirmedCount} percent={s.confirmedPercent} />
                            <MetricCell label="Delivered" value={s.deliveredCount} percent={s.deliveredPercent} />
                            <div className="text-center">
                                <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Commission</p>
                                <p className="text-sm font-bold text-emerald-600 leading-tight mt-0.5">
                                    {s.commissionEarned.toLocaleString('fr-MA')}
                                </p>
                                <p className="text-[10px] text-gray-400">MAD</p>
                            </div>
                        </div>
                    </div>

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
                </div>
            </CardContent>
        </Card>
    );
}

function MetricCell({
    label,
    value,
    sub,
    percent,
}: {
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
                <Badge
                    className={cn(
                        'text-[9px] px-1.5 py-0 font-bold',
                        percent >= 50
                            ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-50'
                            : percent >= 25
                              ? 'bg-amber-50 text-amber-600 hover:bg-amber-50'
                              : 'bg-red-50 text-red-600 hover:bg-red-50'
                    )}
                >
                    {percent.toFixed(1)}%
                </Badge>
            )}
        </div>
    );
}

function BreakdownSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div>
            <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">{title}</h5>
            <div className="flex flex-wrap gap-1.5">{children}</div>
        </div>
    );
}

function PillBadge({ label, count, className }: { label: string; count: number; className: string }) {
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full',
                className
            )}
        >
            {label}: {count}
        </span>
    );
}

function EmptyLabel({ text }: { text: string }) {
    return <span className="text-[10px] text-gray-400 italic">{text}</span>;
}
