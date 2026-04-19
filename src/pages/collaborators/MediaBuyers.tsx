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
    DollarSign,
    PackageCheck,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { fmtCur, fmtCurFull, fmtNum } from '@/lib/formatNumbers';
import { useMediaBuyerEarnings } from '@/hooks/useMediaBuyerEarnings';
import { getPlatformIcon } from '@/lib/campaignConstants';

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
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Media Buyers</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">
                            Performance & commission · {format(startOfMonth(new Date()), 'MMM dd')} – {format(endOfMonth(new Date()), 'MMM dd yyyy')}
                        </p>
                    </div>
                    <div className="relative sm:w-64">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                        <Input
                            placeholder="Search name, email..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-8 h-8 rounded-md border-gray-200 text-[11px]"
                        />
                    </div>
                </div>
            </header>

            {/* KPI tiles */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {[
                    { label: 'Media Buyers', value: earnings.length, accent: '#3b5e5e' },
                    { label: 'Spend (month)', value: fmtCur(totals.totalSpend), accent: '#ef4444' },
                    { label: 'Delivered (month)', value: fmtNum(totals.totalDelivered), accent: '#059669' },
                    { label: 'Payroll (month)', value: fmtCur(totals.totalAmount), accent: '#3b5e5e' },
                    { label: 'Unpaid', value: fmtCur(totals.unpaidAmount), accent: '#d97706' },
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
            {isLoading ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="w-5 h-5 animate-spin text-brand-navy/40" />
                </div>
            ) : filtered.length === 0 ? (
                <div className="rounded-xl border border-gray-100 bg-white p-12 text-center">
                    <Megaphone className="w-8 h-8 text-gray-200 mx-auto mb-3" />
                    <p className="text-[11px] text-gray-400">No media buyers. Create one via Users → Add New User, role = Media Buyer.</p>
                </div>
            ) : (
                <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                    <table className="w-full">
                        <thead className="border-b border-gray-100">
                            <tr>
                                {['Media Buyer', 'Type', 'Campaigns', 'Spend', 'Delivered', 'Payroll', 'Unpaid'].map(h => (
                                    <th key={h} className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold whitespace-nowrap">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((r) => (
                                <tr
                                    key={r.mediabuyer_id}
                                    onClick={() => setSelectedId(r.mediabuyer_id)}
                                    className="border-b border-gray-100 hover:bg-gray-50/50 cursor-pointer transition-colors"
                                >
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-2.5">
                                            <Avatar className="h-7 w-7 shrink-0">
                                                <AvatarImage src={r.avatar_url || ''} />
                                                <AvatarFallback className="bg-gray-100 text-brand-navy/60 text-[9px] font-semibold">
                                                    {r.name.substring(0, 2).toUpperCase()}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="min-w-0">
                                                <p className="text-[12px] font-semibold text-brand-navy truncate leading-none">{r.name}</p>
                                                <p className="text-[10px] text-gray-500 truncate mt-0.5">{r.email}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-3 py-2">
                                        <span className={cn(
                                            'h-5 px-1.5 inline-flex items-center rounded text-[9px] font-semibold',
                                            r.payment_type === 'commission'
                                                ? 'bg-gray-100 text-brand-navy/70'
                                                : r.payment_type === 'salary'
                                                ? 'bg-gray-100 text-brand-navy/70'
                                                : 'bg-gray-100 text-gray-500'
                                        )}>
                                            {r.payment_type || 'n/a'}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{r.campaigns_count}</td>
                                    <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums" title={fmtCurFull(r.total_spend)}>{fmtCur(r.total_spend)}</td>
                                    <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{fmtNum(r.delivered_orders)}</td>
                                    <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums" title={fmtCurFull(r.total_amount)}>{fmtCur(r.total_amount)}</td>
                                    <td className="px-3 py-2 text-[11px] tabular-nums" style={{ color: r.remaining_amount > 0 ? '#d97706' : undefined }}>{fmtCur(r.remaining_amount)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Drawer */}
            <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
                <SheetContent className="sm:max-w-md overflow-y-auto border-l border-gray-100 shadow-none bg-white">
                    {selected && (
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
                                        <span className={cn(
                                            'h-5 px-1.5 mt-1 inline-flex items-center rounded text-[9px] font-semibold',
                                            selected.payment_type === 'commission' ? 'bg-gray-100 text-brand-navy/70' : 'bg-gray-100 text-brand-navy/70'
                                        )}>
                                            {selected.payment_type === 'commission'
                                                ? `Commission · ${fmtCur(selected.commission_price)} / delivered`
                                                : `Salary · ${fmtCur(selected.salary_amount)} / month`}
                                        </span>
                                    </div>
                                </div>
                                <Button variant="ghost" size="icon" onClick={() => setSelectedId(null)} className="h-7 w-7 rounded-md shrink-0">
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
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Performance (month)</p>
                                <div className="grid grid-cols-4 gap-2">
                                    {[
                                        { label: 'Campaigns', value: String(selected.campaigns_count), accent: '#3b5e5e' },
                                        { label: 'Spend', value: fmtCur(selected.total_spend), accent: '#ef4444' },
                                        { label: 'Delivered', value: fmtNum(selected.delivered_orders), accent: '#059669' },
                                        { label: 'Payroll', value: fmtCur(selected.total_amount), accent: '#3b5e5e' },
                                    ].map(t => (
                                        <div key={t.label} className="rounded-xl border border-gray-100 p-2.5 flex items-start gap-1.5">
                                            <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: t.accent }} />
                                            <div>
                                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{t.label}</p>
                                                <p className="text-[13px] font-semibold tabular-nums text-brand-navy mt-0.5 leading-none">{t.value}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="border-b border-gray-100 pb-4 space-y-2">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Bank details</p>
                                <div className="space-y-1">
                                    {[
                                        { label: 'Bank', value: selected.bank_name || '—' },
                                        { label: 'Holder', value: selected.bank_account_holder || '—' },
                                        { label: 'RIB', value: selected.bank_rib || '—' },
                                        { label: 'CIN', value: selected.cin_number || '—' },
                                    ].map(r => (
                                        <div key={r.label} className="flex justify-between py-1.5 border-b border-gray-50 last:border-0">
                                            <span className="text-[10px] text-gray-500">{r.label}</span>
                                            <span className="text-[10px] font-semibold text-brand-navy">{r.value}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="border-b border-gray-100 pb-4 space-y-2">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Active campaigns · {selectedCampaigns.length}</p>
                                {selectedCampaigns.length === 0 ? (
                                    <p className="text-[10px] text-gray-400">No campaigns yet.</p>
                                ) : (
                                    <div className="space-y-1.5 max-h-52 overflow-y-auto">
                                        {selectedCampaigns.map((c) => (
                                            <div key={c.id} className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-gray-100">
                                                <div className="w-5 h-5 rounded border border-gray-100 bg-gray-50 flex items-center justify-center shrink-0 text-gray-500">
                                                    {getPlatformIcon(c.platform, 'w-2.5 h-2.5')}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-[11px] font-semibold text-brand-navy truncate">{c.name}</p>
                                                    <p className="text-[9px] text-gray-400">{c.platform}</p>
                                                </div>
                                                <span className={cn(
                                                    'h-5 px-1.5 inline-flex items-center rounded text-[9px] font-semibold',
                                                    c.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                                                )}>
                                                    {c.status}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Payout history · {selectedPayouts.length}</p>
                                {selectedPayouts.length === 0 ? (
                                    <p className="text-[10px] text-gray-400">No payouts yet.</p>
                                ) : (
                                    <div className="space-y-1.5 max-h-52 overflow-y-auto">
                                        {selectedPayouts.map((p) => (
                                            <div key={p.id} className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-gray-100">
                                                <Wallet className="w-3 h-3 text-gray-400 shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[11px] font-semibold text-brand-navy">{fmtCurFull(Number(p.total_amount || 0))}</p>
                                                    <p className="text-[9px] text-gray-400">{p.payout_month}</p>
                                                </div>
                                                <span className={cn(
                                                    'h-5 px-1.5 inline-flex items-center rounded text-[9px] font-semibold',
                                                    p.status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                                                )}>
                                                    {p.status}
                                                </span>
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

export default MediaBuyers;
