import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
    ShoppingCart, CheckCircle2, Truck, XCircle, Clock,
    Package, Ban, FileText, TrendingUp, Target,
    type LucideIcon,
} from 'lucide-react';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import {
    AnalyticsOrder,
    inWindow,
    isConfirmed,
    isDelivered,
    isFailed,
    placementTimestamp,
} from '@/lib/analyticsDefinitions';

interface DashboardKPICardsProps {
    businessId: string;
    dateFilter: DateFilter;
}

interface KPICardData {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: LucideIcon;
    /** Hex accent used for the left border, icon tint, and (when rate is set) the progress bar. */
    accent: string;
    /** Progress fill 0..100; renders a thin bar under the value. */
    rate?: number;
    onClick?: () => void;
    valueColor?: string;
}

export const DashboardKPICards = ({ businessId, dateFilter }: DashboardKPICardsProps) => {
    const navigate = useNavigate();
    const {
        confirmedIds,
        cancelledIds,
        pendingIds,
        newOrderIds,
        deliveredPkgIds,
        returnedPkgIds,
        getPkgsByCategories,
        isPkgCategory,
    } = useStatusCategories();

    const { data: orders } = useQuery({
        queryKey: ['kpi-cards-orders-v2', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, date, order_status_id, package_status_id, package_status_label, tracking_number, package_statuses(label, category)')
                .eq('DigiCom Business', businessId)
                .is('date_deleted', null);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: paymentNotes } = useQuery({
        queryKey: ['dashboard-payment-notes', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('company_payment_notes')
                .select('id, total_amount, net_amount, status, created_at')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const cards = useMemo<KPICardData[]>(() => {
        if (!orders) return [];
        const ordersTyped = orders as unknown as AnalyticsOrder[];

        const windowStart = dateFilter.from ? startOfDay(dateFilter.from) : new Date(0);
        const windowEnd = dateFilter.to ? endOfDay(dateFilter.to) : new Date();
        const isInRange = (dateStr: string | null) => {
            if (!dateStr) return false;
            const d = new Date(dateStr);
            return !Number.isNaN(d.getTime()) && isWithinInterval(d, { start: windowStart, end: windowEnd });
        };

        const filtered = ordersTyped.filter(o => inWindow(placementTimestamp(o), windowStart, windowEnd));
        const total = filtered.length;

        // Each "click card → filter Orders" link must pass ALL status ids the
        // card's count aggregates, not just one. Picking a single representative
        // id (as the old code did with getOrderByCategory) made the filtered list
        // strictly smaller than the card count — e.g. "Canceled: 6" linking to a
        // view that only showed 2 because fake/double/blacklisted statuses were
        // excluded by the single-id match.
        const confirmedIdList = Array.from(confirmedIds);
        const cancelledIdList = Array.from(cancelledIds);
        const pendingIdList = Array.from(pendingIds);
        const deliveredPkgIdList = Array.from(deliveredPkgIds);
        // Shipping flow = every status the click filter will match, and nothing
        // else. The old count used "company_id set AND not delivered/returned",
        // which also swept in callback, postponed, cancelled and no-package-yet
        // orders — 32 in the count vs 11 after the click, which is the bug the
        // user flagged. Keeping count === filter guarantees no drift.
        const shippedPkgIdList = Array.from(getPkgsByCategories(['in_transit', 'out_for_delivery', 'picked_up', 'pickup_pending']).map(s => s.id));
        const shippedPkgIdsSet = new Set(shippedPkgIdList);
        const refusedPkgIdList = Array.from(getPkgsByCategories(['refused']).map(s => s.id));

        // Confirmed = category match OR tracking_number set (§2).
        const confirmed = filtered.filter(o => isConfirmed(o, confirmedIds));
        const delivered = filtered.filter(o => isDelivered(o, deliveredPkgIds));
        // Confirmation rate denominator = orders the team has touched (§5).
        const touched = filtered.filter(o => !o.order_status_id || !newOrderIds.has(o.order_status_id));

        const confirmationRateNum =
            touched.length > 0 ? Math.min(100, (confirmed.length / touched.length) * 100) : 0;
        const confirmationRate = confirmationRateNum.toFixed(1);
        const deliveryRateNum =
            confirmed.length > 0 ? Math.min(100, (delivered.length / confirmed.length) * 100) : 0;
        const deliveryRate = deliveryRateNum.toFixed(1);

        const pendingConfirmation = filtered.filter(o =>
            !!o.order_status_id && pendingIds.has(o.order_status_id),
        );

        const enCoursLivraison = filtered.filter(o =>
            !!o.package_status_id && shippedPkgIdsSet.has(o.package_status_id),
        );

        // Failed — merged bucket (§4): cancelled + fake + blacklisted + double.
        const canceled = filtered.filter(o => isFailed(o, cancelledIds));

        const refused = filtered.filter(o =>
            !!o.package_status_id && isPkgCategory(o.package_status_id, 'refused'),
        );

        const pct = (n: number) => total > 0 ? ((n / total) * 100).toFixed(1) : '0';

        type PaymentNote = { created_at: string | null; net_amount: number };
        const filteredNotes = (paymentNotes || []).filter((n: PaymentNote) => isInRange(n.created_at));
        const notesTotal = filteredNotes.reduce((s: number, n: PaymentNote) => s + Number(n.net_amount || 0), 0);
        void returnedPkgIds;

        return [
            {
                title: 'Total Orders',
                value: total,
                icon: ShoppingCart,
                accent: '#3b5e5e',
                onClick: () => navigate('/orders'),
            },
            {
                title: 'Confirmed',
                value: confirmed.length,
                subtitle: `${pct(confirmed.length)}% of total`,
                icon: CheckCircle2,
                accent: '#10b981',
                onClick: () => navigate('/orders', { state: { filterStatusIds: confirmedIdList, filterStatusLabel: 'Confirmed' } }),
            },
            {
                title: 'Confirmation Rate',
                value: `${confirmationRate}%`,
                subtitle: `${confirmed.length}/${total} of total`,
                icon: Target,
                accent: '#8b5cf6',
                rate: confirmationRateNum,
            },
            {
                title: 'Delivered',
                value: delivered.length,
                subtitle:
                    confirmed.length > 0
                        ? `${((delivered.length / confirmed.length) * 100).toFixed(1)}% of confirmed`
                        : `${pct(delivered.length)}% of total`,
                icon: Package,
                accent: '#059669',
                onClick: () => navigate('/orders', { state: { filterPackageStatusIds: deliveredPkgIdList, filterPackageStatusLabel: 'Delivered' } }),
            },
            {
                title: 'Delivery Rate',
                value: `${deliveryRate}%`,
                subtitle: `${delivered.length}/${confirmed.length} of confirmed`,
                icon: TrendingUp,
                accent: '#2563eb',
                rate: deliveryRateNum,
            },
            {
                title: 'Pending Confirmation',
                value: pendingConfirmation.length,
                subtitle: `${pct(pendingConfirmation.length)}% of total`,
                icon: Clock,
                accent: '#f59e0b',
                onClick: () => navigate('/orders', { state: { filterStatusIds: pendingIdList, filterStatusLabel: 'Pending confirmation' } }),
            },
            {
                title: 'In Transit',
                value: enCoursLivraison.length,
                subtitle: `${pct(enCoursLivraison.length)}% of total`,
                icon: Truck,
                accent: '#6366f1',
                onClick: () => navigate('/orders', { state: { filterPackageStatusIds: shippedPkgIdList, filterPackageStatusLabel: 'In transit' } }),
            },
            {
                title: 'Canceled',
                value: canceled.length,
                subtitle: `${pct(canceled.length)}% of total`,
                icon: XCircle,
                accent: '#ef4444',
                valueColor: canceled.length > 0 ? 'text-red-600' : undefined,
                onClick: () => navigate('/orders', { state: { filterStatusIds: cancelledIdList, filterStatusLabel: 'Canceled' } }),
            },
            {
                title: 'Refused Packages',
                value: refused.length,
                subtitle: `${pct(refused.length)}% of total`,
                icon: Ban,
                accent: '#f97316',
                valueColor: refused.length > 0 ? 'text-orange-600' : undefined,
                onClick: () => navigate('/orders', { state: { filterPackageStatusIds: refusedPkgIdList, filterPackageStatusLabel: 'Refused' } }),
            },
            {
                title: 'Invoices',
                value: filteredNotes.length,
                subtitle: `${notesTotal.toLocaleString('fr-MA')} MAD`,
                icon: FileText,
                accent: '#a855f7',
                onClick: () => navigate('/payments'),
            },
        ];
    }, [orders, paymentNotes, dateFilter, navigate, confirmedIds, cancelledIds, pendingIds, newOrderIds, deliveredPkgIds, returnedPkgIds, getPkgsByCategories, isPkgCategory]);

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {cards.map((card, i) => (
                <motion.div
                    key={card.title}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22, delay: i * 0.025 }}
                >
                    <Card
                        className={cn(
                            'group relative border border-gray-100 shadow-none rounded-lg h-full overflow-hidden transition-all',
                            card.onClick && 'cursor-pointer hover:border-gray-200 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
                        )}
                        onClick={card.onClick}
                    >
                        <span
                            aria-hidden
                            className="absolute inset-y-0 left-0 w-[2px]"
                            style={{ backgroundColor: card.accent }}
                        />
                        <CardContent className="p-2.5 pl-3">
                            <div className="flex items-center justify-between gap-1.5">
                                <span className="text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400 truncate">
                                    {card.title}
                                </span>
                                <span
                                    className="flex items-center justify-center w-4 h-4 rounded shrink-0"
                                    style={{ backgroundColor: `${card.accent}14`, color: card.accent }}
                                >
                                    <card.icon className="w-2.5 h-2.5" strokeWidth={2.25} />
                                </span>
                            </div>
                            <div
                                className={cn(
                                    'font-semibold text-brand-navy tabular-nums mt-1.5 leading-none',
                                    typeof card.value === 'string' && card.value.includes('%')
                                        ? 'text-[17px]'
                                        : 'text-[15px]',
                                    card.valueColor,
                                )}
                            >
                                {typeof card.value === 'number' ? card.value.toLocaleString('fr-MA') : card.value}
                            </div>
                            {card.rate !== undefined && (
                                <div
                                    className="mt-1.5 h-[3px] rounded-full overflow-hidden"
                                    style={{ backgroundColor: `${card.accent}1A` }}
                                >
                                    <div
                                        className="h-full rounded-full transition-all duration-500"
                                        style={{ width: `${Math.min(100, card.rate)}%`, backgroundColor: card.accent }}
                                    />
                                </div>
                            )}
                            {card.subtitle && (
                                <div className="text-[9px] text-gray-400 mt-1 truncate tabular-nums">
                                    {card.subtitle}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </motion.div>
            ))}
        </div>
    );
};
