import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
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
import { useTrackedOrders } from '@/hooks/useTrackedOrders';
import {
    AnalyticsOrder,
    inWindow,
    isAdminPullback,
    isDelivered,
    isFailed,
    isRateConfirmed,
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
        adminPullbackOrderIds,
        adminPullbackPackageIds,
        deliveredPkgIds,
        returnedPkgIds,
        getPkgsByCategories,
        isPkgCategory,
    } = useStatusCategories();
    const { trackedOrderIds } = useTrackedOrders(businessId);

    const { data: orders } = useQuery({
        queryKey: ['kpi-cards-orders-v2', businessId],
        queryFn: async () => {
            return await fetchAllRows(
                'orders',
                'id, date, order_status_id, package_status_id, package_status_label, tracking_number, package_statuses(label, category)',
                {
                    filters: [
                        { column: 'DigiCom Business', op: 'eq', value: businessId },
                        { column: 'date_deleted', op: 'is', value: null },
                        { column: 'source_review_status', op: 'neq', value: 'pending' },
                    ],
                },
            );
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

        const delivered = filtered.filter(o => isDelivered(o, deliveredPkgIds));

        // Confirmation-rate metric. Pending = `order_statuses.pending_confirmation = true`
        // (NEW + the six RAPPELE retry slots + REPORTER). Confirmed = everything else,
        // with tracking-code override (handed to courier ⇒ confirmed regardless of
        // status). Denominator = total filtered orders.
        const rateConfirmed = filtered.filter(o => isRateConfirmed(o, pendingIds, trackedOrderIds));

        // Delivery rate (Coliaty formula):
        //   delivered ÷ (tracked − admin-pullback)
        // Tracked = order has a tracking_code in company_parcels or courier_parcels.
        // Admin-pullback = tracked AND flagged fake/double/blacklisted/cancelled
        //   at order level, OR Hors-zone/Annulé at package level.
        const tracked = filtered.filter(o => !!o.id && trackedOrderIds.has(o.id));
        const adminPullback = tracked.filter(o =>
            isAdminPullback(o, true, adminPullbackOrderIds, adminPullbackPackageIds),
        );
        const deliveryDenom = tracked.length - adminPullback.length;

        const confirmationRateNum =
            total > 0 ? Math.min(100, (rateConfirmed.length / total) * 100) : 0;
        const confirmationRate = confirmationRateNum.toFixed(1);
        const deliveryRateNum =
            deliveryDenom > 0 ? Math.min(100, (delivered.length / deliveryDenom) * 100) : 0;
        const deliveryRate = deliveryRateNum.toFixed(1);

        // Pending confirmation = order_statuses with pending_confirmation=true
        // (NEW + RAPPELE 1-6 + REPORTER) AND no tracking code. Tracking code
        // (company_parcels/courier_parcels) is a hard override: if one exists,
        // the order is confirmed regardless of status.
        const pendingConfirmation = filtered.filter(o => {
            if (o.id && trackedOrderIds.has(o.id)) return false;
            return !!o.order_status_id && pendingIds.has(o.order_status_id);
        });

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

        // Anthropic-brand palette — single warm accent (orange) reserved for hero
        // metric + any "rate" progress bar. Status tones use semantic blues/greens.
        const ANT = {
            ink: '#141413',
            orange: '#d97757',
            blue: '#6a9bcc',
            green: '#788c5d',
            mid: '#b0aea5',
            rose: '#c96356',
        };
        return [
            {
                title: 'Total Orders',
                value: total,
                icon: ShoppingCart,
                accent: ANT.ink,
                onClick: () => navigate('/orders'),
            },
            {
                title: 'Confirmed',
                value: rateConfirmed.length,
                subtitle: `${pct(rateConfirmed.length)}% of total`,
                icon: CheckCircle2,
                accent: ANT.green,
                onClick: () => navigate('/orders', { state: { filterStatusIds: confirmedIdList, filterStatusLabel: 'Confirmed' } }),
            },
            {
                title: 'Confirmation Rate',
                value: `${confirmationRate}%`,
                subtitle: `${rateConfirmed.length}/${total} of total`,
                icon: Target,
                accent: ANT.orange,
                rate: confirmationRateNum,
            },
            {
                title: 'Delivered',
                value: delivered.length,
                subtitle:
                    deliveryDenom > 0
                        ? `${((delivered.length / deliveryDenom) * 100).toFixed(1)}% of shipped`
                        : `${pct(delivered.length)}% of total`,
                icon: Package,
                accent: ANT.green,
                onClick: () => navigate('/orders', { state: { filterPackageStatusIds: deliveredPkgIdList, filterPackageStatusLabel: 'Delivered' } }),
            },
            {
                title: 'Delivery Rate',
                value: `${deliveryRate}%`,
                subtitle: `${delivered.length}/${deliveryDenom} shipped`,
                icon: TrendingUp,
                accent: ANT.orange,
                rate: deliveryRateNum,
            },
            {
                title: 'Pending Confirmation',
                value: pendingConfirmation.length,
                subtitle: `${pct(pendingConfirmation.length)}% of total`,
                icon: Clock,
                accent: ANT.blue,
                onClick: () => navigate('/orders', { state: { filterStatusIds: pendingIdList, filterStatusLabel: 'Pending confirmation' } }),
            },
            {
                title: 'In Transit',
                value: enCoursLivraison.length,
                subtitle: `${pct(enCoursLivraison.length)}% of total`,
                icon: Truck,
                accent: ANT.blue,
                onClick: () => navigate('/orders', { state: { filterPackageStatusIds: shippedPkgIdList, filterPackageStatusLabel: 'In transit' } }),
            },
            {
                title: 'Canceled',
                value: canceled.length,
                subtitle: `${pct(canceled.length)}% of total`,
                icon: XCircle,
                accent: ANT.rose,
                valueColor: canceled.length > 0 ? 'text-ant-rose' : undefined,
                onClick: () => navigate('/orders', { state: { filterStatusIds: cancelledIdList, filterStatusLabel: 'Canceled' } }),
            },
            {
                title: 'Refused Packages',
                value: refused.length,
                subtitle: `${pct(refused.length)}% of total`,
                icon: Ban,
                accent: ANT.rose,
                valueColor: refused.length > 0 ? 'text-ant-rose' : undefined,
                onClick: () => navigate('/orders', { state: { filterPackageStatusIds: refusedPkgIdList, filterPackageStatusLabel: 'Refused' } }),
            },
            {
                title: 'Invoices',
                value: filteredNotes.length,
                subtitle: `${notesTotal.toLocaleString('fr-MA')} MAD`,
                icon: FileText,
                accent: ANT.mid,
                onClick: () => navigate('/payments'),
            },
        ];
    }, [orders, paymentNotes, dateFilter, navigate, confirmedIds, cancelledIds, pendingIds, adminPullbackOrderIds, adminPullbackPackageIds, trackedOrderIds, deliveredPkgIds, returnedPkgIds, getPkgsByCategories, isPkgCategory]);

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
            {cards.map((card, i) => (
                <motion.div
                    key={card.title}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22, delay: i * 0.02 }}
                >
                    <Card
                        className={cn(
                            'group relative border border-ant-line bg-ant-paper shadow-none rounded-xl h-full overflow-hidden transition-all',
                            card.onClick && 'cursor-pointer hover:border-ant-ink/20 hover:-translate-y-[1px]',
                        )}
                        onClick={card.onClick}
                    >
                        <CardContent className="p-3">
                            <div className="flex items-center justify-between gap-1.5">
                                <span className="text-[9.5px] uppercase tracking-[0.18em] font-medium text-ant-mid truncate">
                                    {card.title}
                                </span>
                                <span
                                    className="flex items-center justify-center w-5 h-5 rounded-md shrink-0"
                                    style={{ backgroundColor: `${card.accent}14`, color: card.accent }}
                                >
                                    <card.icon className="w-3 h-3" strokeWidth={2} />
                                </span>
                            </div>
                            <div
                                className={cn(
                                    'font-display font-semibold text-ant-ink tabular-nums mt-2 leading-none tracking-[-0.02em]',
                                    typeof card.value === 'string' && card.value.includes('%')
                                        ? 'text-[22px]'
                                        : 'text-[20px]',
                                    card.valueColor,
                                )}
                            >
                                {typeof card.value === 'number' ? card.value.toLocaleString('fr-MA') : card.value}
                            </div>
                            {card.rate !== undefined && (
                                <div
                                    className="mt-2 h-[3px] rounded-full overflow-hidden bg-ant-line/70"
                                >
                                    <div
                                        className="h-full rounded-full transition-all duration-500"
                                        style={{ width: `${Math.min(100, card.rate)}%`, backgroundColor: card.accent }}
                                    />
                                </div>
                            )}
                            {card.subtitle && (
                                <div className="text-[10px] text-ant-muted mt-1.5 truncate tabular-nums">
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
