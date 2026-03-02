import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
    ShoppingCart, CheckCircle2, Truck, XCircle, Clock,
    Package, PercentIcon, Ban, FileText, TrendingUp,
} from 'lucide-react';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';

interface DashboardKPICardsProps {
    businessId: string;
    dateFilter: DateFilter;
}

interface KPICardData {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: any;
    iconBg: string;
    iconColor: string;
    onClick?: () => void;
    valueColor?: string;
}

export const DashboardKPICards = ({ businessId, dateFilter }: DashboardKPICardsProps) => {
    const navigate = useNavigate();

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

    const { data: orderStatuses } = useQuery({
        queryKey: ['dashboard-order-statuses', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('order_statuses')
                .select('id, code, label')
                .eq('active', true)
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
                .select('id, code, label')
                .eq('active', true)
                .eq('DigiCom Business', businessId);
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
        if (!orders || !orderStatuses || !packageStatuses) return [];

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
        const total = filtered.length;

        const getStatusId = (code: string) => orderStatuses.find((s: any) => s.code === code)?.id;
        const getPkgStatusId = (code: string) => packageStatuses.find((s: any) => s.code === code)?.id;

        const confirmedId = getStatusId('CONFIRMED');
        const paidId = getStatusId('PAID');
        const newId = getStatusId('NEW');
        const canceledId = getStatusId('CANCELED');
        const deliveredPkgId = getPkgStatusId('P_DELIVERED');
        const shippedPkgId = getPkgStatusId('P_SHIPPED');
        const refusedPkgId = getPkgStatusId('p_refuser');

        const confirmed = filtered.filter((o: any) => {
            const code = (o.order_statuses as any)?.code?.toUpperCase();
            return code === 'CONFIRMED' || code === 'PAID' || code === 'UNPAID' || code === 'PROCESSED';
        });
        const delivered = filtered.filter((o: any) =>
            (o.package_status_label || '').toLowerCase() === 'livré'
        );

        const shippedOrders = filtered.filter((o: any) => !!o.company_id);
        const deliveryRate = shippedOrders.length > 0
            ? ((delivered.length / shippedOrders.length) * 100).toFixed(1)
            : '0';

        const pendingConfirmation = filtered.filter((o: any) => {
            const code = (o.order_statuses as any)?.code?.toUpperCase();
            return code === 'NEW' || code === 'INTERESTED';
        });

        const enCoursLivraison = filtered.filter((o: any) => {
            const label = (o.package_status_label || '').toLowerCase();
            return !!o.company_id && label !== 'livré' && label !== 'retourné' && label !== 'refusé';
        });

        const canceled = filtered.filter((o: any) =>
            (o.order_statuses as any)?.code?.toUpperCase() === 'CANCELED'
        );

        const refused = filtered.filter((o: any) =>
            (o.package_status_label || '').toLowerCase() === 'refusé'
        );

        const pct = (n: number) => total > 0 ? ((n / total) * 100).toFixed(1) : '0';

        const filteredNotes = (paymentNotes || []).filter((n: any) => isInRange(n.created_at));
        const notesTotal = filteredNotes.reduce((s: number, n: any) => s + Number(n.net_amount || 0), 0);

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
                onClick: () => navigate('/orders', { state: { filterStatus: canceledId } }),
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
    }, [orders, orderStatuses, packageStatuses, paymentNotes, dateFilter, navigate]);

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
