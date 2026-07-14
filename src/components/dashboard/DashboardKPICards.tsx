import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
    ShoppingCart, CheckCircle2, Truck, XCircle, Clock,
    Package, Ban, FileText, TrendingUp, Target,
    type LucideIcon,
} from 'lucide-react';
import { useStatusCategories } from '@/hooks/useStatusCategories';

/**
 * `kpi_cards` section of admin_dashboard_stats (D2). All counts/rates are
 * computed server-side with the exact old client math (window on placement
 * `date`, null dates dropped, Coliaty delivery denominator, clamped rates).
 */
export interface KpiCardsSection {
    total: number;
    rate_confirmed: number;
    confirmation_rate: number;
    delivered: number;
    tracked: number;
    pullback: number;
    delivery_denom: number;
    delivery_rate: number;
    pending_confirmation: number;
    in_transit: number;
    canceled: number;
    refused: number;
    invoices: { count: number; net_total: number };
}

interface DashboardKPICardsProps {
    stats: KpiCardsSection | undefined;
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

export const DashboardKPICards = ({ stats }: DashboardKPICardsProps) => {
    const navigate = useNavigate();
    // Status masters stay client-side ONLY for the click-through filter id
    // arrays passed to /orders — the counts themselves come from the RPC.
    const {
        confirmedIds,
        cancelledIds,
        pendingIds,
        deliveredPkgIds,
        getPkgsByCategories,
    } = useStatusCategories();

    const cards = useMemo<KPICardData[]>(() => {
        if (!stats) return [];

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
        // else, so the In-Transit count === the post-click list length.
        const shippedPkgIdList = Array.from(getPkgsByCategories(['in_transit', 'out_for_delivery', 'picked_up', 'pickup_pending']).map(s => s.id));
        const refusedPkgIdList = Array.from(getPkgsByCategories(['refused']).map(s => s.id));

        const total = stats.total;
        const pct = (n: number) => total > 0 ? ((n / total) * 100).toFixed(1) : '0';

        const confirmationRateNum = stats.confirmation_rate;
        const deliveryRateNum = stats.delivery_rate;
        const deliveryDenom = stats.delivery_denom;

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
                value: stats.rate_confirmed,
                subtitle: `${pct(stats.rate_confirmed)}% of total`,
                icon: CheckCircle2,
                accent: ANT.green,
                onClick: () => navigate('/orders', { state: { filterStatusIds: confirmedIdList, filterStatusLabel: 'Confirmed' } }),
            },
            {
                title: 'Confirmation Rate',
                value: `${confirmationRateNum.toFixed(1)}%`,
                subtitle: `${stats.rate_confirmed}/${total} of total`,
                icon: Target,
                accent: ANT.orange,
                rate: confirmationRateNum,
            },
            {
                title: 'Delivered',
                value: stats.delivered,
                subtitle:
                    deliveryDenom > 0
                        ? `${((stats.delivered / deliveryDenom) * 100).toFixed(1)}% of shipped`
                        : `${pct(stats.delivered)}% of total`,
                icon: Package,
                accent: ANT.green,
                onClick: () => navigate('/orders', { state: { filterPackageStatusIds: deliveredPkgIdList, filterPackageStatusLabel: 'Delivered' } }),
            },
            {
                title: 'Delivery Rate',
                value: `${deliveryRateNum.toFixed(1)}%`,
                subtitle: `${stats.delivered}/${deliveryDenom} shipped`,
                icon: TrendingUp,
                accent: ANT.orange,
                rate: deliveryRateNum,
            },
            {
                title: 'Pending Confirmation',
                value: stats.pending_confirmation,
                subtitle: `${pct(stats.pending_confirmation)}% of total`,
                icon: Clock,
                accent: ANT.blue,
                onClick: () => navigate('/orders', { state: { filterStatusIds: pendingIdList, filterStatusLabel: 'Pending confirmation' } }),
            },
            {
                title: 'In Transit',
                value: stats.in_transit,
                subtitle: `${pct(stats.in_transit)}% of total`,
                icon: Truck,
                accent: ANT.blue,
                onClick: () => navigate('/orders', { state: { filterPackageStatusIds: shippedPkgIdList, filterPackageStatusLabel: 'In transit' } }),
            },
            {
                title: 'Canceled',
                value: stats.canceled,
                subtitle: `${pct(stats.canceled)}% of total`,
                icon: XCircle,
                accent: ANT.rose,
                valueColor: stats.canceled > 0 ? 'text-ant-rose' : undefined,
                onClick: () => navigate('/orders', { state: { filterStatusIds: cancelledIdList, filterStatusLabel: 'Canceled' } }),
            },
            {
                title: 'Refused Packages',
                value: stats.refused,
                subtitle: `${pct(stats.refused)}% of total`,
                icon: Ban,
                accent: ANT.rose,
                valueColor: stats.refused > 0 ? 'text-ant-rose' : undefined,
                onClick: () => navigate('/orders', { state: { filterPackageStatusIds: refusedPkgIdList, filterPackageStatusLabel: 'Refused' } }),
            },
            {
                title: 'Invoices',
                value: stats.invoices.count,
                subtitle: `${stats.invoices.net_total.toLocaleString('fr-MA')} MAD`,
                icon: FileText,
                accent: ANT.mid,
                onClick: () => navigate('/payments'),
            },
        ];
    }, [stats, navigate, confirmedIds, cancelledIds, pendingIds, deliveredPkgIds, getPkgsByCategories]);

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
