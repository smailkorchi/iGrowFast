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
import { Card, CardContent } from '@/components/ui/card';
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
                .in('courier_id', courierIds);
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
        if (!q) return couriers;
        return couriers.filter(
            (c) =>
                c.name.toLowerCase().includes(q) ||
                c.email.toLowerCase().includes(q) ||
                (c.phone || '').toLowerCase().includes(q)
        );
    }, [couriers, search]);

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
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Couriers</h1>
                            <p className="text-gray-500 font-light">Manage couriers, deliveries, and shipping fees.</p>
                        </div>
                        <div className="relative group sm:w-80">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <Input
                                placeholder="Search by name, email, phone..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-11 h-12 rounded-2xl border-gray-100 bg-white"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6">
                        <div className="rounded-3xl border border-gray-100/80 bg-white/90 p-5 shadow-sm">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Couriers</p>
                            <p className="text-2xl font-black text-gray-900 tracking-tight">{couriers.length}</p>
                        </div>
                        <div className="rounded-3xl border border-gray-100/80 bg-white/90 p-5 shadow-sm">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Total orders</p>
                            <p className="text-2xl font-black text-gray-900 tracking-tight">{fmtNum(totals.totalOrders)}</p>
                        </div>
                        <div className="rounded-3xl border border-gray-100/80 bg-white/90 p-5 shadow-sm">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Delivered</p>
                            <p className="text-2xl font-black text-emerald-600 tracking-tight">{fmtNum(totals.totalDelivered)}</p>
                        </div>
                        <div className="rounded-3xl border border-gray-100/80 bg-white/90 p-5 shadow-sm">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Unpaid notes</p>
                            <p className="text-2xl font-black text-amber-600 tracking-tight" title={fmtCurFull(totals.totalUnpaid)}>
                                {fmtCur(totals.totalUnpaid)}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Listing */}
            {loadingCouriers ? (
                <div className="flex justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-brand-navy/40" />
                </div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center py-24 gap-4 bg-white/50 rounded-[32px]">
                    <div className="w-20 h-20 bg-brand-navy/[0.04] rounded-full flex items-center justify-center">
                        <Truck className="w-10 h-10 text-brand-navy/20" />
                    </div>
                    <p className="text-lg font-bold text-brand-navy">No couriers found</p>
                    <p className="text-sm text-muted-foreground">Create a courier via Users → Add New User.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filtered.map((c) => {
                        const s = stats.get(c.id);
                        return (
                            <Card
                                key={c.id}
                                onClick={() => setSelected(c)}
                                className="border-none rounded-[24px] bg-white/90 backdrop-blur-sm shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 cursor-pointer overflow-hidden"
                            >
                                <CardContent className="p-6 space-y-4">
                                    <div className="flex items-center gap-4">
                                        <Avatar className="h-14 w-14 border-2 border-brand-white shadow-sm">
                                            <AvatarImage src={c.avatar_url || ''} />
                                            <AvatarFallback className="bg-brand-navy text-white font-bold">
                                                {c.name.substring(0, 2).toUpperCase()}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-brand-navy truncate">{c.name}</p>
                                            <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                                        </div>
                                        <Badge
                                            className={cn(
                                                'rounded-full text-[9px] font-black uppercase px-2 py-0.5 border-none',
                                                c.active !== false ? 'bg-emerald-500/10 text-emerald-600' : 'bg-gray-300/40 text-gray-500'
                                            )}
                                        >
                                            {c.active !== false ? 'Active' : 'Inactive'}
                                        </Badge>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2">
                                        <div className="p-3 rounded-2xl bg-brand-navy/[0.03]">
                                            <p className="text-[9px] font-bold uppercase text-muted-foreground">Orders</p>
                                            <p className="text-lg font-black text-brand-navy tabular-nums">{fmtNum(s?.totalOrders || 0)}</p>
                                        </div>
                                        <div className="p-3 rounded-2xl bg-emerald-500/[0.06]">
                                            <p className="text-[9px] font-bold uppercase text-emerald-700/70">Delivered</p>
                                            <p className="text-lg font-black text-emerald-600 tabular-nums">{fmtNum(s?.delivered || 0)}</p>
                                        </div>
                                        <div className="p-3 rounded-2xl bg-blue-500/[0.06]">
                                            <p className="text-[9px] font-bold uppercase text-blue-700/70">In-transit</p>
                                            <p className="text-lg font-black text-blue-600 tabular-nums">{fmtNum(s?.inTransit || 0)}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between pt-2 border-t border-brand-navy/5">
                                        <div>
                                            <p className="text-[9px] font-bold uppercase text-muted-foreground">Shipping fees earned</p>
                                            <p className="text-sm font-black text-brand-navy tabular-nums" title={fmtCurFull(s?.totalShippingFees || 0)}>
                                                {fmtCur(s?.totalShippingFees || 0)}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[9px] font-bold uppercase text-muted-foreground">Unpaid</p>
                                            <p className={cn('text-sm font-black tabular-nums', (s?.totalUnpaid || 0) > 0 ? 'text-amber-600' : 'text-brand-navy/40')} title={fmtCurFull(s?.totalUnpaid || 0)}>
                                                {fmtCur(s?.totalUnpaid || 0)}
                                            </p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Detail drawer */}
            <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
                <SheetContent className="sm:max-w-xl overflow-y-auto rounded-l-[32px] border-none">
                    {selected && (() => {
                        const s = stats.get(selected.id);
                        const notes = paymentNotes.filter((n) => n.courier_id === selected.id);
                        return (
                            <div className="space-y-6">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex items-center gap-4 min-w-0">
                                        <Avatar className="h-16 w-16 border-2 border-brand-white shadow-lg shrink-0">
                                            <AvatarImage src={selected.avatar_url || ''} />
                                            <AvatarFallback className="bg-brand-navy text-white font-bold text-lg">
                                                {selected.name.substring(0, 2).toUpperCase()}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0">
                                            <h2 className="text-xl font-bold text-brand-navy truncate">{selected.name}</h2>
                                            <p className="text-xs text-muted-foreground truncate">{selected.email}</p>
                                        </div>
                                    </div>
                                    <Button variant="ghost" size="icon" onClick={() => setSelected(null)} className="rounded-xl shrink-0">
                                        <X className="w-4 h-4" />
                                    </Button>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <Kv icon={Phone} label="Phone" value={selected.phone || '—'} />
                                    <Kv icon={Mail} label="Email" value={selected.email} />
                                </div>

                                <div className="grid grid-cols-4 gap-2">
                                    <Metric label="Orders" value={fmtNum(s?.totalOrders || 0)} />
                                    <Metric label="Delivered" value={fmtNum(s?.delivered || 0)} tone="text-emerald-600" icon={PackageCheck} />
                                    <Metric label="In-transit" value={fmtNum(s?.inTransit || 0)} tone="text-blue-600" icon={Truck} />
                                    <Metric label="Returned" value={fmtNum(s?.returned || 0)} tone="text-red-600" icon={RotateCcw} />
                                </div>

                                {/* ── Profit summary ──
                                    The courier's profit is the shipping fees earned from delivered orders.
                                    These fees are deducted from the cash the courier collected on COD orders
                                    (net_amount on each payment note = collected cash - shipping fees the courier
                                    keeps). So lifetime profit = Σ shipping fees on delivered orders. */}
                                {(() => {
                                    const totalFees = s?.totalShippingFees || 0;
                                    const paidFees = s?.totalPaid || 0; // net cash already settled — the fees portion is what's left in courier's pocket after COD split
                                    const pendingFees = s?.totalUnpaid || 0;
                                    return (
                                        <div className="rounded-2xl p-5 bg-gradient-to-br from-emerald-500/10 via-emerald-50 to-white border border-emerald-100/60 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700/70">Profit (delivery fees)</p>
                                                <TrendingUp className="w-4 h-4 text-emerald-600" />
                                            </div>
                                            <p className="text-3xl font-black text-emerald-800 tabular-nums leading-none break-words" title={fmtCurFull(totalFees)}>
                                                {fmtCur(totalFees)}
                                            </p>
                                            <p className="text-[11px] text-emerald-800/70 font-medium">
                                                Sum of shipping fees from every delivered order. Deducted from the company's COD collection; this is what the courier keeps.
                                            </p>
                                            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-emerald-200/40">
                                                <div>
                                                    <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-700/50">Paid out</p>
                                                    <p className="text-sm font-black text-emerald-700 tabular-nums" title={fmtCurFull(paidFees)}>
                                                        {fmtCur(paidFees)}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-[9px] font-bold uppercase tracking-widest text-amber-700/60">Pending</p>
                                                    <p className={cn('text-sm font-black tabular-nums', pendingFees > 0 ? 'text-amber-700' : 'text-emerald-700/40')} title={fmtCurFull(pendingFees)}>
                                                        {fmtCur(pendingFees)}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}

                                <div>
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Payment notes · {notes.length}</p>
                                    {notes.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">No payment notes yet.</p>
                                    ) : (
                                        <div className="space-y-2">
                                            {notes.slice(0, 10).map((n) => (
                                                <div key={n.id} className="flex items-center gap-3 p-3 rounded-2xl bg-brand-navy/[0.03] border border-brand-navy/5">
                                                    <CreditCard className="w-4 h-4 text-brand-navy/50 shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-xs font-bold text-brand-navy">{fmtCurFull(Number(n.net_amount || 0))}</p>
                                                        <p className="text-[10px] text-muted-foreground">{n.order_count} orders · {new Date(n.created_at).toLocaleDateString()}</p>
                                                    </div>
                                                    <Badge
                                                        className={cn(
                                                            'rounded-full text-[9px] font-black uppercase border-none',
                                                            n.status === 'paid' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'
                                                        )}
                                                    >
                                                        {n.status}
                                                    </Badge>
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

const Kv: React.FC<{ icon: React.ComponentType<{ className?: string }>; label: string; value: string }> = ({ icon: Icon, label, value }) => (
    <div className="rounded-2xl p-3 bg-brand-navy/[0.03] border border-brand-navy/5 flex items-center gap-3">
        <Icon className="w-4 h-4 text-brand-navy/40 shrink-0" />
        <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
            <p className="text-xs font-bold text-brand-navy truncate">{value}</p>
        </div>
    </div>
);

const Metric: React.FC<{ label: string; value: string; tone?: string; icon?: React.ComponentType<{ className?: string }> }> = ({ label, value, tone = 'text-brand-navy', icon: Icon }) => (
    <div className="rounded-2xl p-3 bg-brand-navy/[0.03] border border-brand-navy/5">
        <div className="flex items-center gap-1 mb-1">
            {Icon && <Icon className="w-3 h-3 text-brand-navy/40" />}
            <p className="text-[9px] font-bold uppercase text-muted-foreground">{label}</p>
        </div>
        <p className={cn('text-lg font-black tabular-nums', tone)}>{value}</p>
    </div>
);

export default Couriers;
