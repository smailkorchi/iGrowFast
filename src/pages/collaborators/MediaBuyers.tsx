import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { supabase } from '@/lib/supabase';
import {
    Search,
    Megaphone,
    Loader2,
    X,
    Phone,
    Mail,
    Wallet,
    Target,
    TrendingUp,
    DollarSign,
    PackageCheck,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { fmtCur, fmtCurFull, fmtNum } from '@/lib/formatNumbers';
import { useMediaBuyerEarnings } from '@/hooks/useMediaBuyerEarnings';
import { getPlatformColor, getPlatformIcon } from '@/lib/campaignConstants';

type PayoutRow = {
    id: string;
    mediabuyer_id: string;
    payout_month: string;
    total_amount: number | string;
    status: 'pending' | 'paid';
    paid_at: string | null;
    created_at: string;
};

type CampaignRow = {
    id: string;
    created_by: string | null;
    name: string;
    platform: string;
    status: 'active' | 'draft';
};

const MediaBuyers = () => {
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const currentMonth = useMemo(() => format(new Date(), 'yyyy-MM'), []);
    const { rows: earnings, isLoading } = useMediaBuyerEarnings(currentMonth);
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // All payouts for this business (for drawer history).
    const { data: allPayouts = [] } = useQuery<PayoutRow[]>({
        queryKey: ['mb-all-payouts', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('mediabuyer_payments')
                .select('id, mediabuyer_id, payout_month, total_amount, status, paid_at, created_at')
                .eq('DigiCom Business', activeBusinessId)
                .order('payout_month', { ascending: false });
            if (error) throw error;
            return (data || []) as PayoutRow[];
        },
        enabled: !!activeBusinessId,
    });

    // All campaigns in business for drawer list.
    const { data: allCampaigns = [] } = useQuery<CampaignRow[]>({
        queryKey: ['mb-all-campaigns', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('campaigns')
                .select('id, created_by, name, platform, status')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return (data || []) as CampaignRow[];
        },
        enabled: !!activeBusinessId,
    });

    const filtered = useMemo(() => {
        const q = search.toLowerCase().trim();
        if (!q) return earnings;
        return earnings.filter(
            (r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || (r.phone || '').toLowerCase().includes(q)
        );
    }, [earnings, search]);

    const totals = useMemo(() => {
        return earnings.reduce(
            (acc, r) => {
                acc.totalSpend += r.total_spend;
                acc.totalDelivered += r.delivered_orders;
                acc.totalAmount += r.total_amount;
                acc.unpaidAmount += r.remaining_amount;
                acc.active += 1;
                return acc;
            },
            { totalSpend: 0, totalDelivered: 0, totalAmount: 0, unpaidAmount: 0, active: 0 }
        );
    }, [earnings]);

    const selected = useMemo(() => earnings.find((e) => e.mediabuyer_id === selectedId) || null, [earnings, selectedId]);
    const selectedPayouts = useMemo(
        () => (selected ? allPayouts.filter((p) => p.mediabuyer_id === selected.mediabuyer_id) : []),
        [selected, allPayouts]
    );
    const selectedCampaigns = useMemo(
        () => (selected ? allCampaigns.filter((c) => c.created_by === selected.mediabuyer_id) : []),
        [selected, allCampaigns]
    );

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Media Buyers</h1>
                            <p className="text-gray-500 font-light">
                                Performance and commission tracking · {format(startOfMonth(new Date()), 'MMM dd')} – {format(endOfMonth(new Date()), 'MMM dd yyyy')}
                            </p>
                        </div>
                        <div className="relative group sm:w-80">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <Input
                                placeholder="Search by name, email..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-11 h-12 rounded-2xl border-gray-100 bg-white"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-6">
                        <div className="rounded-3xl border border-gray-100/80 bg-white/90 p-5 shadow-sm">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Media buyers</p>
                            <p className="text-2xl font-black text-gray-900 tracking-tight">{earnings.length}</p>
                        </div>
                        <div className="rounded-3xl border border-gray-100/80 bg-white/90 p-5 shadow-sm">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Spend (month)</p>
                            <p className="text-2xl font-black text-gray-900 tracking-tight" title={fmtCurFull(totals.totalSpend)}>
                                {fmtCur(totals.totalSpend)}
                            </p>
                        </div>
                        <div className="rounded-3xl border border-gray-100/80 bg-white/90 p-5 shadow-sm">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Delivered (month)</p>
                            <p className="text-2xl font-black text-emerald-600 tracking-tight">{fmtNum(totals.totalDelivered)}</p>
                        </div>
                        <div className="rounded-3xl border border-gray-100/80 bg-white/90 p-5 shadow-sm">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Payroll (month)</p>
                            <p className="text-2xl font-black text-primary tracking-tight" title={fmtCurFull(totals.totalAmount)}>
                                {fmtCur(totals.totalAmount)}
                            </p>
                        </div>
                        <div className="rounded-3xl border border-gray-100/80 bg-white/90 p-5 shadow-sm">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Unpaid</p>
                            <p className="text-2xl font-black text-amber-600 tracking-tight" title={fmtCurFull(totals.unpaidAmount)}>
                                {fmtCur(totals.unpaidAmount)}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Listing */}
            {isLoading ? (
                <div className="flex justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-brand-navy/40" />
                </div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center py-24 gap-4 bg-white/50 rounded-[32px]">
                    <div className="w-20 h-20 bg-brand-navy/[0.04] rounded-full flex items-center justify-center">
                        <Megaphone className="w-10 h-10 text-brand-navy/20" />
                    </div>
                    <p className="text-lg font-bold text-brand-navy">No media buyers</p>
                    <p className="text-sm text-muted-foreground">Create one via Users → Add New User, role = Media Buyer.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filtered.map((r) => (
                        <Card
                            key={r.mediabuyer_id}
                            onClick={() => setSelectedId(r.mediabuyer_id)}
                            className="border-none rounded-[24px] bg-white/90 backdrop-blur-sm shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 cursor-pointer overflow-hidden"
                        >
                            <CardContent className="p-6 space-y-4">
                                <div className="flex items-center gap-4">
                                    <Avatar className="h-14 w-14 border-2 border-brand-white shadow-sm">
                                        <AvatarImage src={r.avatar_url || ''} />
                                        <AvatarFallback className="bg-brand-navy text-white font-bold">
                                            {r.name.substring(0, 2).toUpperCase()}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-brand-navy truncate">{r.name}</p>
                                        <p className="text-xs text-muted-foreground truncate">{r.email}</p>
                                    </div>
                                    <Badge
                                        className={cn(
                                            'rounded-full text-[9px] font-black uppercase px-2 py-0.5 border-none',
                                            r.payment_type === 'commission'
                                                ? 'bg-primary/10 text-primary'
                                                : r.payment_type === 'salary'
                                                ? 'bg-indigo-500/10 text-indigo-600'
                                                : 'bg-gray-300/40 text-gray-500'
                                        )}
                                    >
                                        {r.payment_type || 'n/a'}
                                    </Badge>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    <div className="p-3 rounded-2xl bg-brand-navy/[0.03]">
                                        <p className="text-[9px] font-bold uppercase text-muted-foreground">Campaigns</p>
                                        <p className="text-lg font-black text-brand-navy tabular-nums">{r.campaigns_count}</p>
                                    </div>
                                    <div className="p-3 rounded-2xl bg-red-500/[0.06]">
                                        <p className="text-[9px] font-bold uppercase text-red-700/70">Spend</p>
                                        <p className="text-lg font-black text-red-600 tabular-nums" title={fmtCurFull(r.total_spend)}>
                                            {fmtCur(r.total_spend)}
                                        </p>
                                    </div>
                                    <div className="p-3 rounded-2xl bg-emerald-500/[0.06]">
                                        <p className="text-[9px] font-bold uppercase text-emerald-700/70">Delivered</p>
                                        <p className="text-lg font-black text-emerald-600 tabular-nums">{fmtNum(r.delivered_orders)}</p>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between pt-2 border-t border-brand-navy/5">
                                    <div>
                                        <p className="text-[9px] font-bold uppercase text-muted-foreground">Payroll (month)</p>
                                        <p className="text-sm font-black text-brand-navy tabular-nums" title={fmtCurFull(r.total_amount)}>
                                            {fmtCur(r.total_amount)}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[9px] font-bold uppercase text-muted-foreground">Unpaid</p>
                                        <p className={cn('text-sm font-black tabular-nums', r.remaining_amount > 0 ? 'text-amber-600' : 'text-brand-navy/40')} title={fmtCurFull(r.remaining_amount)}>
                                            {fmtCur(r.remaining_amount)}
                                        </p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Drawer */}
            <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
                <SheetContent className="sm:max-w-xl overflow-y-auto rounded-l-[32px] border-none">
                    {selected && (
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
                                        <div className="mt-1">
                                            <Badge className={cn('rounded-full text-[9px] font-black uppercase border-none', selected.payment_type === 'commission' ? 'bg-primary/10 text-primary' : 'bg-indigo-500/10 text-indigo-600')}>
                                                {selected.payment_type === 'commission'
                                                    ? `Commission · ${fmtCur(selected.commission_price)} / delivered`
                                                    : `Salary · ${fmtCur(selected.salary_amount)} / month`}
                                            </Badge>
                                        </div>
                                    </div>
                                </div>
                                <Button variant="ghost" size="icon" onClick={() => setSelectedId(null)} className="rounded-xl shrink-0">
                                    <X className="w-4 h-4" />
                                </Button>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <Kv icon={Phone} label="Phone" value={selected.phone || '—'} />
                                <Kv icon={Mail} label="Email" value={selected.email} />
                            </div>

                            <div className="grid grid-cols-4 gap-2">
                                <Metric label="Campaigns" value={String(selected.campaigns_count)} icon={Megaphone} />
                                <Metric label="Spend" value={fmtCur(selected.total_spend)} tone="text-red-600" icon={DollarSign} />
                                <Metric label="Delivered" value={fmtNum(selected.delivered_orders)} tone="text-emerald-600" icon={PackageCheck} />
                                <Metric label="Payroll" value={fmtCur(selected.total_amount)} tone="text-primary" icon={Wallet} />
                            </div>

                            <div className="rounded-2xl p-4 bg-brand-navy/[0.03] border border-brand-navy/5 space-y-2">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Bank details</p>
                                <div className="text-xs space-y-1">
                                    <div className="flex justify-between"><span className="text-muted-foreground">Bank</span> <span className="font-bold text-brand-navy">{selected.bank_name || '—'}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Holder</span> <span className="font-bold text-brand-navy">{selected.bank_account_holder || '—'}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">RIB</span> <span className="font-mono font-bold text-brand-navy break-all text-right">{selected.bank_rib || '—'}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">CIN</span> <span className="font-bold text-brand-navy">{selected.cin_number || '—'}</span></div>
                                </div>
                            </div>

                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Active campaigns · {selectedCampaigns.length}</p>
                                {selectedCampaigns.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No campaigns yet.</p>
                                ) : (
                                    <div className="space-y-2 max-h-60 overflow-y-auto">
                                        {selectedCampaigns.map((c) => (
                                            <div key={c.id} className="flex items-center gap-3 p-3 rounded-2xl bg-brand-navy/[0.03] border border-brand-navy/5">
                                                <div
                                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white shrink-0"
                                                    style={{ backgroundColor: getPlatformColor(c.platform) }}
                                                >
                                                    {getPlatformIcon(c.platform, 'w-3 h-3')}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-xs font-bold text-brand-navy truncate">{c.name}</p>
                                                    <p className="text-[10px] text-muted-foreground">{c.platform}</p>
                                                </div>
                                                <Badge
                                                    className={cn(
                                                        'rounded-full text-[9px] font-black uppercase border-none',
                                                        c.status === 'active' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'
                                                    )}
                                                >
                                                    {c.status}
                                                </Badge>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Payout history · {selectedPayouts.length}</p>
                                {selectedPayouts.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No payouts yet.</p>
                                ) : (
                                    <div className="space-y-2 max-h-60 overflow-y-auto">
                                        {selectedPayouts.map((p) => (
                                            <div key={p.id} className="flex items-center gap-3 p-3 rounded-2xl bg-brand-navy/[0.03] border border-brand-navy/5">
                                                <Wallet className="w-4 h-4 text-brand-navy/50 shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-bold text-brand-navy">{fmtCurFull(Number(p.total_amount || 0))}</p>
                                                    <p className="text-[10px] text-muted-foreground">{p.payout_month}</p>
                                                </div>
                                                <Badge className={cn('rounded-full text-[9px] font-black uppercase border-none', p.status === 'paid' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600')}>
                                                    {p.status}
                                                </Badge>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
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

const Metric: React.FC<{ label: string; value: string; tone?: string; icon?: React.ComponentType<{ className?: string }> }> = ({
    label,
    value,
    tone = 'text-brand-navy',
    icon: Icon,
}) => (
    <div className="rounded-2xl p-3 bg-brand-navy/[0.03] border border-brand-navy/5">
        <div className="flex items-center gap-1 mb-1">
            {Icon && <Icon className="w-3 h-3 text-brand-navy/40" />}
            <p className="text-[9px] font-bold uppercase text-muted-foreground">{label}</p>
        </div>
        <p className={cn('text-base font-black tabular-nums', tone)}>{value}</p>
    </div>
);

export default MediaBuyers;
