import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Search,
    Truck,
    Phone,
    Mail,
    PackageCheck,
    RotateCcw,
    CreditCard,
    Loader2,
    X,
    TrendingUp,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { fmtCur, fmtCurFull, fmtNum } from '@/lib/formatNumbers';

type Courier = {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    avatar_url: string | null;
    address: string | null;
    active: boolean | null;
    created_at: string;
};

type OrderRow = {
    id: string;
    courier_id: string | null;
    package_status_id: string | null;
    shipping_cost: number | string | null;
};

type PaymentNote = {
    id: string;
    courier_id: string;
    status: string;
    total_amount: number | string;
    net_amount: number | string;
    order_count: number;
    paid_at: string | null;
    created_at: string;
};

const Couriers = () => {
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const { deliveredPkgIds, shippedPkgIds, returnedPkgIds } = useStatusCategories();
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<Courier | null>(null);

    const { data: couriers = [], isLoading: loadingCouriers } = useQuery<Courier[]>({
        queryKey: ['couriers', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, email, phone, avatar_url, address, active, created_at')
                .eq('DigiCom Business', activeBusinessId)
                .eq('role', 'courier')
                .order('name');
            if (error) throw error;
            return (data || []) as Courier[];
        },
        enabled: !!activeBusinessId,
    });

    const courierIds = useMemo(() => couriers.map((c) => c.id), [couriers]);

    const { data: orders = [] } = useQuery<OrderRow[]>({
        queryKey: ['couriers-orders', activeBusinessId, courierIds.sort().join(',')],
        queryFn: async () => {
            if (!activeBusinessId || courierIds.length === 0) return [];
            const { data, error } = await (supabase as any)
                .from('orders')
                .select('id, courier_id, package_status_id, shipping_cost')
                .eq('DigiCom Business', activeBusinessId)
                .in('courier_id', courierIds)
                .is('date_deleted', null);
            if (error) throw error;
            return (data || []) as OrderRow[];
        },
        enabled: !!activeBusinessId && courierIds.length > 0,
    });

    const { data: paymentNotes = [] } = useQuery<PaymentNote[]>({
        queryKey: ['couriers-payment-notes', activeBusinessId, courierIds.sort().join(',')],
        queryFn: async () => {
            if (!activeBusinessId || courierIds.length === 0) return [];
            const { data, error } = await (supabase as any)
                .from('courier_payment_notes')
                .select('id, courier_id, status, total_amount, net_amount, order_count, paid_at, created_at')
                .eq('DigiCom Business', activeBusinessId)
                .in('courier_id', courierIds)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (data || []) as PaymentNote[];
        },
        enabled: !!activeBusinessId && courierIds.length > 0,
    });

    // Per-courier aggregates
    const stats = useMemo(() => {
        const m = new Map<
            string,
            {
                totalOrders: number;
                inTransit: number;
                delivered: number;
                returned: number;
                totalShippingFees: number;
                totalPaid: number;
                totalUnpaid: number;
                notesCount: number;
            }
        >();
        for (const c of couriers) {
            m.set(c.id, { totalOrders: 0, inTransit: 0, delivered: 0, returned: 0, totalShippingFees: 0, totalPaid: 0, totalUnpaid: 0, notesCount: 0 });
        }
        for (const o of orders) {
            if (!o.courier_id) continue;
            const row = m.get(o.courier_id);
            if (!row) continue;
            row.totalOrders += 1;
            if (o.package_status_id && deliveredPkgIds.has(o.package_status_id)) {
                row.delivered += 1;
                row.totalShippingFees += Number(o.shipping_cost || 0);
            } else if (o.package_status_id && shippedPkgIds.has(o.package_status_id)) {
                row.inTransit += 1;
            } else if (o.package_status_id && returnedPkgIds.has(o.package_status_id)) {
                row.returned += 1;
            }
        }
        for (const n of paymentNotes) {
            const row = m.get(n.courier_id);
            if (!row) continue;
            row.notesCount += 1;
            if (n.status === 'paid') row.totalPaid += Number(n.net_amount || 0);
            else row.totalUnpaid += Number(n.net_amount || 0);
        }
        return m;
    }, [couriers, orders, paymentNotes, deliveredPkgIds, shippedPkgIds, returnedPkgIds]);

    const filtered = useMemo(() => {
        const q = search.toLowerCase().trim();
        const list = q
            ? couriers.filter(
                (c) =>
                    c.name.toLowerCase().includes(q) ||
                    c.email.toLowerCase().includes(q) ||
                    (c.phone || '').toLowerCase().includes(q)
            )
            : [...couriers];
        // Sort by delivery rate descending
        return list.sort((a, b) => {
            const sa = stats.get(a.id);
            const sb = stats.get(b.id);
            const ra = sa && sa.totalOrders > 0 ? sa.delivered / sa.totalOrders : 0;
            const rb = sb && sb.totalOrders > 0 ? sb.delivered / sb.totalOrders : 0;
            return rb - ra;
        });
    }, [couriers, search, stats]);

    const totals = useMemo(() => {
        let totalOrders = 0;
        let totalDelivered = 0;
        let totalShipping = 0;
        let totalUnpaid = 0;
        stats.forEach((s) => {
            totalOrders += s.totalOrders;
            totalDelivered += s.delivered;
            totalShipping += s.totalShippingFees;
            totalUnpaid += s.totalUnpaid;
        });
        return { totalOrders, totalDelivered, totalShipping, totalUnpaid };
    }, [stats]);

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Couriers</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Deliveries, shipments & shipping fees</p>
                    </div>
                    <div className="relative sm:w-64">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                        <Input
                            placeholder="Search name, email, phone..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-8 h-8 rounded-md border-gray-200 text-[11px]"
                        />
                    </div>
                </div>
            </header>

            {/* KPI tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                    { label: 'Couriers', value: couriers.length, accent: '#3b5e5e' },
                    { label: 'Total Orders', value: fmtNum(totals.totalOrders), accent: '#3b5e5e' },
                    { label: 'Delivered', value: fmtNum(totals.totalDelivered), accent: '#059669' },
                    { label: 'Unpaid Notes', value: fmtCur(totals.totalUnpaid), accent: '#d97706' },
                ].map((stat, i) => (
                    <div key={i} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                        <span className="w-[3px] self-stretch rounded-full" style={{ background: stat.accent }} />
                        <div className="flex-1 min-w-0">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{stat.label}</p>
                            <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{stat.value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Listing */}
            {loadingCouriers ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="w-5 h-5 animate-spin text-brand-navy/40" />
                </div>
            ) : filtered.length === 0 ? (
                <div className="rounded-xl border border-gray-100 bg-white p-12 text-center">
                    <Truck className="w-8 h-8 text-gray-200 mx-auto mb-3" />
                    <p className="text-[11px] text-gray-400">No couriers found. Create a courier via Users → Add New User.</p>
                </div>
            ) : (
                <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                    <table className="w-full">
                        <thead className="border-b border-gray-100">
                            <tr>
                                {['Courier', 'Status', 'Orders', 'Delivered', 'In-Transit', 'Del. Rate', 'Shipping Fees', 'Unpaid'].map(h => (
                                    <th key={h} className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold whitespace-nowrap">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((c) => {
                                const s = stats.get(c.id);
                                const deliveryRate = s && s.totalOrders > 0 ? (s.delivered / s.totalOrders) * 100 : 0;
                                const rateColor = deliveryRate > 70 ? '#059669' : deliveryRate > 40 ? '#d97706' : '#ef4444';
                                return (
                                    <tr
                                        key={c.id}
                                        onClick={() => setSelected(c)}
                                        className="border-b border-gray-100 hover:bg-gray-50/50 cursor-pointer transition-colors"
                                    >
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-2.5">
                                                <Avatar className="h-7 w-7 shrink-0">
                                                    <AvatarImage src={c.avatar_url || ''} />
                                                    <AvatarFallback className="bg-gray-100 text-brand-navy/60 text-[9px] font-semibold">
                                                        {c.name.substring(0, 2).toUpperCase()}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <div className="min-w-0">
                                                    <p className="text-[12px] font-semibold text-brand-navy truncate leading-none">{c.name}</p>
                                                    <p className="text-[10px] text-gray-500 truncate mt-0.5">{c.email}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className={cn(
                                                'h-5 px-1.5 inline-flex items-center rounded text-[9px] font-semibold',
                                                c.active !== false ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                                            )}>
                                                {c.active !== false ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{fmtNum(s?.totalOrders || 0)}</td>
                                        <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{fmtNum(s?.delivered || 0)}</td>
                                        <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{fmtNum(s?.inTransit || 0)}</td>
                                        <td className="px-3 py-2 text-[11px] font-semibold tabular-nums" style={{ color: rateColor }}>
                                            {deliveryRate.toFixed(1)}%
                                        </td>
                                        <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums" title={fmtCurFull(s?.totalShippingFees || 0)}>
                                            {fmtCur(s?.totalShippingFees || 0)}
                                        </td>
                                        <td className="px-3 py-2 text-[11px] tabular-nums" style={{ color: (s?.totalUnpaid || 0) > 0 ? '#d97706' : undefined }}>
                                            {fmtCur(s?.totalUnpaid || 0)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Detail drawer */}
            <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
                <SheetContent className="sm:max-w-md overflow-y-auto border-l border-gray-100 shadow-none bg-white">
                    {selected && (() => {
                        const s = stats.get(selected.id);
                        const notes = paymentNotes.filter((n) => n.courier_id === selected.id);
                        const totalFees = s?.totalShippingFees || 0;
                        const paidFees = s?.totalPaid || 0;
                        const pendingFees = s?.totalUnpaid || 0;
                        return (
                            <div className="space-y-4 pt-2">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <Avatar className="h-7 w-7 shrink-0">
                                            <AvatarImage src={selected.avatar_url || ''} />
                                            <AvatarFallback className="bg-gray-100 text-brand-navy/60 text-[9px] font-semibold">
                                                {selected.name.substring(0, 2).toUpperCase()}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0">
                                            <p className="text-[12px] font-semibold text-brand-navy truncate leading-none">{selected.name}</p>
                                            <p className="text-[10px] text-gray-500 truncate mt-0.5">{selected.email}</p>
                                        </div>
                                    </div>
                                    <Button variant="ghost" size="icon" onClick={() => setSelected(null)} className="h-7 w-7 rounded-md shrink-0">
                                        <X className="w-3.5 h-3.5" />
                                    </Button>
                                </div>

                                <div className="border-b border-gray-100 pb-4 space-y-2">
                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Contact</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {[
                                            { icon: Phone, label: 'Phone', value: selected.phone || '—' },
                                            { icon: Mail, label: 'Email', value: selected.email },
                                        ].map(({ icon: Icon, label, value }) => (
                                            <div key={label} className="rounded-xl border border-gray-100 p-2.5 flex items-center gap-2">
                                                <Icon className="w-3 h-3 text-gray-400 shrink-0" />
                                                <div className="min-w-0">
                                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{label}</p>
                                                    <p className="text-[10px] font-semibold text-brand-navy truncate">{value}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="border-b border-gray-100 pb-4 space-y-2">
                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Performance</p>
                                    <div className="grid grid-cols-4 gap-2">
                                        {[
                                            { label: 'Orders', value: fmtNum(s?.totalOrders || 0), accent: '#3b5e5e' },
                                            { label: 'Delivered', value: fmtNum(s?.delivered || 0), accent: '#059669' },
                                            { label: 'In-Transit', value: fmtNum(s?.inTransit || 0), accent: '#3b82f6' },
                                            { label: 'Returned', value: fmtNum(s?.returned || 0), accent: '#ef4444' },
                                        ].map(t => (
                                            <div key={t.label} className="rounded-xl border border-gray-100 p-2.5 flex items-start gap-1.5">
                                                <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: t.accent }} />
                                                <div>
                                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{t.label}</p>
                                                    <p className="text-[15px] font-semibold tabular-nums text-brand-navy mt-0.5 leading-none">{t.value}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="border-b border-gray-100 pb-4 space-y-2">
                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 flex items-center gap-1">
                                        <TrendingUp className="w-3 h-3" /> Profit (delivery fees)
                                    </p>
                                    <div className="rounded-xl border border-gray-100 p-3 flex items-start gap-2.5">
                                        <span className="w-[3px] self-stretch rounded-full" style={{ background: '#059669' }} />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Total fees earned</p>
                                            <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1" title={fmtCurFull(totalFees)}>{fmtCur(totalFees)}</p>
                                            <p className="text-[9px] text-gray-400 mt-1">Shipping fees from delivered orders deducted from COD collection.</p>
                                            <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-gray-100">
                                                <div>
                                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Paid out</p>
                                                    <p className="text-[12px] font-semibold text-brand-navy tabular-nums" title={fmtCurFull(paidFees)}>{fmtCur(paidFees)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Pending</p>
                                                    <p className={cn('text-[12px] font-semibold tabular-nums', pendingFees > 0 ? 'text-amber-600' : 'text-brand-navy/40')} title={fmtCurFull(pendingFees)}>{fmtCur(pendingFees)}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Payment notes · {notes.length}</p>
                                    {notes.length === 0 ? (
                                        <p className="text-[10px] text-gray-400">No payment notes yet.</p>
                                    ) : (
                                        <div className="space-y-1.5">
                                            {notes.slice(0, 10).map((n) => (
                                                <div key={n.id} className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-gray-100">
                                                    <CreditCard className="w-3 h-3 text-gray-400 shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-[11px] font-semibold text-brand-navy">{fmtCurFull(Number(n.net_amount || 0))}</p>
                                                        <p className="text-[9px] text-gray-400">{n.order_count} orders · {new Date(n.created_at).toLocaleDateString()}</p>
                                                    </div>
                                                    <span className={cn(
                                                        'h-5 px-1.5 inline-flex items-center rounded text-[9px] font-semibold',
                                                        n.status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                                                    )}>
                                                        {n.status}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })()}
                </SheetContent>
            </Sheet>
        </div>
    );
};

export default Couriers;
