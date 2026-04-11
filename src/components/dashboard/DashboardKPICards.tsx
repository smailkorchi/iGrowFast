import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
    ShoppingCart, CheckCircle2, Truck, XCircle, Clock,
    Package, Ban, FileText, TrendingUp,
    type LucideIcon,
} from 'lucide-react';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { isDeliveredForCommission } from '@/lib/commercialCommission';

interface DashboardKPICardsProps {
    businessId: string;
    dateFilter: DateFilter;
}

interface KPICardData {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: LucideIcon;
    iconBg: string;
    iconColor: string;
    onClick?: () => void;
    valueColor?: string;
}

export const DashboardKPICards = ({ businessId, dateFilter }: DashboardKPICardsProps) => {
    const navigate = useNavigate();
    const {
        confirmedIds,
        cancelledIds,
        pendingIds,
        deliveredPkgIds,
        returnedPkgIds,
        getOrderByCategory,
        getPkgByCategory,
        isPkgCategory,
    } = useStatusCategories();

    const { data: orders } = useQuery({
        queryKey: ['dashboard-orders', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, date, price, shipping_cost, order_status_id, package_status_id, package_status_label, seller_id, company_id, source_name, order_statuses(code, label), package_statuses(label)')
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

        const isInRange = (dateStr: string | null) => {
            if (!dateStr) return true;
            if (!dateFilter.from && !dateFilter.to) return true;
            const d = new Date(dateStr);
            return isWithinInterval(d, {
                start: dateFilter.from ? startOfDay(dateFilter.from) : new Date(0),
                end: dateFilter.to ? endOfDay(dateFilter.to) : new Date(),
            });
        };

        type KPIOrder = Parameters<typeof isDeliveredForCommission>[0] & {
            date: string | null;
            order_status_id: string | null;
            company_id: string | null;
        };
        const filtered = orders.filter((o: KPIOrder) => isInRange(o.date));
        const total = filtered.length;

        const confirmedId = getOrderByCategory('confirmed')?.id;
        const newId = getOrderByCategory('new')?.id;
        const cancelledId = getOrderByCategory('cancelled')?.id;
        const deliveredPkgId = getPkgByCategory('delivered')?.id;
        const shippedPkgId = getPkgByCategory('in_transit')?.id;
        const refusedPkgId = getPkgByCategory('refused')?.id;

        const confirmed = filtered.filter((o: KPIOrder) =>
            o.order_status_id && confirmedIds.has(o.order_status_id)
        );
        const delivered = filtered.filter((o: KPIOrder) => isDeliveredForCommission(o, deliveredPkgIds));

        const shippedOrders = filtered.filter((o: KPIOrder) => !!o.company_id);
        const deliveryRate = shippedOrders.length > 0
            ? ((delivered.length / shippedOrders.length) * 100).toFixed(1)
            : '0';

        const pendingConfirmation = filtered.filter((o: KPIOrder) =>
            o.order_status_id && pendingIds.has(o.order_status_id)
        );

        const enCoursLivraison = filtered.filter((o: KPIOrder) =>
            !!o.company_id &&
            (!o.package_status_id ||
                (!isDeliveredForCommission(o, deliveredPkgIds) && !returnedPkgIds.has(o.package_status_id)))
        );

        const canceled = filtered.filter((o: KPIOrder) =>
            o.order_status_id && cancelledIds.has(o.order_status_id)
        );

        const refused = filtered.filter((o: KPIOrder) =>
            o.package_status_id && isPkgCategory(o.package_status_id, 'refused')
        );

        const pct = (n: number) => total > 0 ? ((n / total) * 100).toFixed(1) : '0';

        // company_payment_notes: created_at timestamptz nullable, net_amount numeric NOT NULL (verified via MCP)
        type PaymentNote = { created_at: string | null; net_amount: number };
        const filteredNotes = (paymentNotes || []).filter((n: PaymentNote) => isInRange(n.created_at));
        const notesTotal = filteredNotes.reduce((s: number, n: PaymentNote) => s + Number(n.net_amount || 0), 0);

        return [
            {
                title: 'Total Orders',
                value: total,
                icon: ShoppingCart,
                iconBg: 'bg-brand-navy/5',
                iconColor: 'text-brand-navy',
                onClick: () => navigate('/orders'),
            },
            {
                title: 'Confirmed',
                value: confirmed.length,
                subtitle: `${pct(confirmed.length)}% of total`,
                icon: CheckCircle2,
                iconBg: 'bg-emerald-50',
                iconColor: 'text-emerald-600',
                onClick: () => navigate('/orders', { state: { filterStatus: confirmedId } }),
            },
            {
                title: 'Delivered',
                value: delivered.length,
                subtitle: `${pct(delivered.length)}% of total`,
                icon: Package,
                iconBg: 'bg-green-50',
                iconColor: 'text-green-600',
                onClick: () => navigate('/orders', { state: { filterPackageStatus: deliveredPkgId } }),
            },
            {
                title: 'Delivery Rate',
                value: `${deliveryRate}%`,
                subtitle: `${delivered.length}/${shippedOrders.length} shipped`,
                icon: TrendingUp,
                iconBg: 'bg-blue-50',
                iconColor: 'text-blue-600',
            },
            {
                title: 'Pending Confirmation',
                value: pendingConfirmation.length,
                subtitle: `${pct(pendingConfirmation.length)}% of total`,
                icon: Clock,
                iconBg: 'bg-amber-50',
                iconColor: 'text-amber-600',
                onClick: () => navigate('/orders', { state: { filterStatus: newId } }),
            },
            {
                title: 'In Transit',
                value: enCoursLivraison.length,
                subtitle: `${pct(enCoursLivraison.length)}% of total`,
                icon: Truck,
                iconBg: 'bg-indigo-50',
                iconColor: 'text-indigo-600',
                onClick: () => navigate('/orders', { state: { filterPackageStatus: shippedPkgId } }),
            },
            {
                title: 'Canceled',
                value: canceled.length,
                subtitle: `${pct(canceled.length)}% of total`,
                icon: XCircle,
                iconBg: 'bg-red-50',
                iconColor: 'text-red-600',
                valueColor: canceled.length > 0 ? 'text-red-600' : undefined,
                onClick: () => navigate('/orders', { state: { filterStatus: cancelledId } }),
            },
            {
                title: 'Refused Packages',
                value: refused.length,
                subtitle: `${pct(refused.length)}% of total`,
                icon: Ban,
                iconBg: 'bg-orange-50',
                iconColor: 'text-orange-600',
                valueColor: refused.length > 0 ? 'text-orange-600' : undefined,
                onClick: () => navigate('/orders', { state: { filterPackageStatus: refusedPkgId } }),
            },
            {
                title: 'Invoices',
                value: filteredNotes.length,
                subtitle: `${notesTotal.toLocaleString('fr-MA')} MAD`,
                icon: FileText,
                iconBg: 'bg-purple-50',
                iconColor: 'text-purple-600',
                onClick: () => navigate('/payments'),
            },
        ];
    }, [orders, paymentNotes, dateFilter, navigate, confirmedIds, cancelledIds, pendingIds, deliveredPkgIds, returnedPkgIds, getOrderByCategory, getPkgByCategory, isPkgCategory]);

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 gap-3">
            {cards.map((card, i) => (
                <motion.div
                    key={card.title}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.04 }}
                >
                    <Card
                        className={cn(
                            'border-0 shadow-sm rounded-3xl h-full transition-all duration-200',
                            card.onClick && 'cursor-pointer hover:shadow-md hover:scale-[1.02] active:scale-[0.98]'
                        )}
                        onClick={card.onClick}
                    >
                        <CardContent className="p-4">
                            <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center mb-2.5', card.iconBg)}>
                                <card.icon className={cn('w-4.5 h-4.5', card.iconColor)} />
                            </div>
                            <div className={cn('text-2xl font-black text-brand-navy tracking-tight', card.valueColor)}>
                                {typeof card.value === 'number' ? card.value.toLocaleString('fr-MA') : card.value}
                            </div>
                            <div className="text-[10px] uppercase tracking-widest font-bold text-gray-400 mt-0.5">
                                {card.title}
                            </div>
                            {card.subtitle && (
                                <div className="text-[11px] text-gray-500 mt-1">
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
