import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { format, startOfMonth, subMonths, eachMonthOfInterval } from 'date-fns';
import {
    Plus,
    Search,
    CheckCircle2,
    Clock,
    DollarSign,
    Wallet,
    Loader2,
    Sparkles,
    Info,
    AlertTriangle,
    Check,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useSellerEarnings, type SellerEarnings } from '@/hooks/useSellerEarnings';
import { useMediaBuyerEarnings, type MediaBuyerEarnings } from '@/hooks/useMediaBuyerEarnings';
import { fmtCur, fmtCurFull, fmtNum } from '@/lib/formatNumbers';

type Role = 'seller' | 'mediabuyer';

// ═════════════════════════ Main Page ═════════════════════════
const Salaries = () => {
    const [tab, setTab] = useState<Role>('seller');
    const [bulkOpen, setBulkOpen] = useState(false);

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                    <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Salaries</h1>
                    <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Bulk payouts for sellers and media buyers</p>
                </div>
                <Button
                    onClick={() => setBulkOpen(true)}
                    className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 px-3 rounded-md text-[11px] font-semibold gap-1.5 shrink-0"
                >
                    <Plus className="w-3.5 h-3.5" />
                    Generate Payouts
                </Button>
            </header>

            <Tabs value={tab} onValueChange={(v) => setTab(v as Role)}>
                <TabsList className="h-8">
                    <TabsTrigger value="seller" className="text-[11px] h-6 px-3 gap-1.5">
                        Sellers
                    </TabsTrigger>
                    <TabsTrigger value="mediabuyer" className="text-[11px] h-6 px-3 gap-1.5">
                        Media Buyers
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="seller" className="mt-3 outline-none">
                    <SellerPayoutsList />
                </TabsContent>
                <TabsContent value="mediabuyer" className="mt-3 outline-none">
                    <MediaBuyerPayoutsList />
                </TabsContent>
            </Tabs>

            <BulkGenerateDialog open={bulkOpen} onOpenChange={setBulkOpen} initialRole={tab} />
        </div>
    );
};

// ═════════════════════════ Seller Payouts List ═════════════════════════
type SellerPayout = {
    id: string;
    seller_id: string;
    payout_month: string;
    salary_earned: number | string;
    commission_earned: number | string;
    total_amount: number | string;
    days_present: number;
    delivered_orders: number;
    bank_snapshot: any;
    status: 'pending' | 'paid';
    created_at: string;
    paid_at: string | null;
    seller: { name: string; email: string; avatar_url: string | null } | null;
};

const SellerPayoutsList: React.FC = () => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'paid'>('all');
    const [selected, setSelected] = useState<string[]>([]);
    const [page, setPage] = useState(1);
    const PER_PAGE = 10;

    const { data: payouts = [], isLoading } = useQuery<SellerPayout[]>({
        queryKey: ['seller-payouts', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('seller_payments')
                .select('*, seller:users!seller_payments_seller_id_fkey(name, email, avatar_url)')
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });
            if (error) {
                const { data: d2 } = await (supabase as any)
                    .from('seller_payments')
                    .select('*, seller:users(name, email, avatar_url)')
                    .eq('DigiCom Business', activeBusinessId)
                    .order('created_at', { ascending: false });
                return (d2 || []) as SellerPayout[];
            }
            return (data || []) as SellerPayout[];
        },
        enabled: !!activeBusinessId,
    });

    const markMutation = useMutation({
        mutationFn: async ({ ids, status }: { ids: string[]; status: 'paid' | 'pending' }) => {
            const payload = status === 'paid' ? { status, paid_at: new Date().toISOString() } : { status, paid_at: null };
            const { error } = await (supabase as any).from('seller_payments').update(payload).in('id', ids);
            if (error) throw error;
        },
        onSuccess: (_, vars) => {
            queryClient.invalidateQueries({ queryKey: ['seller-payouts'] });
            toast({ title: 'Updated', description: `${vars.ids.length} payout(s) marked as ${vars.status}.` });
            setSelected([]);
        },
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
    });

    const filtered = useMemo(() => {
        let out = payouts;
        if (statusFilter !== 'all') out = out.filter((p) => p.status === statusFilter);
        const q = search.toLowerCase().trim();
        if (q) out = out.filter((p) => (p.seller?.name || '').toLowerCase().includes(q) || (p.seller?.email || '').toLowerCase().includes(q));
        return out;
    }, [payouts, statusFilter, search]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

    const stats = useMemo(() => {
        let totalPaid = 0;
        let totalPending = 0;
        let thisMonth = 0;
        const startOfThisMonth = startOfMonth(new Date());
        for (const p of payouts) {
            const amt = Number(p.total_amount || 0);
            if (p.status === 'paid') totalPaid += amt;
            else totalPending += amt;
            if (new Date(p.created_at) >= startOfThisMonth) thisMonth += 1;
        }
        return { totalPaid, totalPending, thisMonth };
    }, [payouts]);

    return (
        <div className="space-y-3">
            {/* KPI tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                    { label: 'Total paid', value: fmtCur(stats.totalPaid), accent: '#059669' },
                    { label: 'Total pending', value: fmtCur(stats.totalPending), accent: '#d97706' },
                    { label: 'This month', value: String(stats.thisMonth), accent: '#3b5e5e' },
                    { label: 'Payouts total', value: String(payouts.length), accent: '#9ca3af' },
                ].map((s) => (
                    <div key={s.label} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                        <span className="w-[3px] self-stretch rounded-full" style={{ background: s.accent }} />
                        <div className="flex-1 min-w-0">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{s.label}</p>
                            <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1 truncate">{s.value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <div className="relative flex-1 min-w-0 max-w-sm">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                    <Input
                        placeholder="Search seller..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-7 h-8 rounded-md border-gray-200 bg-white text-[11px]"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex gap-0.5 bg-white p-0.5 rounded-md border border-gray-200 shrink-0">
                        {(['all', 'pending', 'paid'] as const).map(s => (
                            <button
                                key={s}
                                onClick={() => setStatusFilter(s)}
                                className={cn(
                                    "px-2.5 h-7 rounded-[4px] text-[10px] font-semibold transition capitalize",
                                    statusFilter === s ? "bg-brand-navy text-white" : "text-gray-500 hover:text-brand-navy hover:bg-gray-50"
                                )}
                            >
                                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                            </button>
                        ))}
                    </div>
                    {selected.length > 0 && (
                        <Button
                            onClick={() => markMutation.mutate({ ids: selected, status: 'paid' })}
                            disabled={markMutation.isPending}
                            className="h-8 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold gap-1.5"
                        >
                            {markMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                            <Check className="w-3 h-3" />
                            Mark {selected.length} paid
                        </Button>
                    )}
                </div>
            </div>

            {/* Table */}
            {isLoading ? (
                <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-10 rounded-lg bg-gray-100 animate-pulse" />)}</div>
            ) : paginated.length === 0 ? (
                <div className="border border-dashed border-gray-200 rounded-xl py-8 text-center">
                    <p className="text-[14px] font-semibold text-brand-navy">No payouts yet</p>
                    <p className="text-[11px] text-gray-400 mt-1">Click "Generate Payouts" to create.</p>
                </div>
            ) : (
                <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    <th className="px-3 py-2 w-8">
                                        <Checkbox
                                            checked={paginated.length > 0 && paginated.every((p) => selected.includes(p.id))}
                                            onCheckedChange={(v) => {
                                                if (v) setSelected(Array.from(new Set([...selected, ...paginated.map((p) => p.id)])));
                                                else setSelected(selected.filter((id) => !paginated.some((p) => p.id === id)));
                                            }}
                                        />
                                    </th>
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Seller</th>
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Month</th>
                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Delivered</th>
                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Days</th>
                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Commission</th>
                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Total</th>
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Status</th>
                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginated.map((p) => (
                                    <tr key={p.id} className="hover:bg-gray-50 transition-colors border-b border-gray-50 tabular-nums">
                                        <td className="px-3 py-2">
                                            <Checkbox checked={selected.includes(p.id)} onCheckedChange={(v) => setSelected(v ? [...selected, p.id] : selected.filter((id) => id !== p.id))} />
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-2">
                                                <Avatar className="h-6 w-6 shrink-0">
                                                    <AvatarImage src={p.seller?.avatar_url || ''} />
                                                    <AvatarFallback className="text-[9px] bg-brand-navy/10 text-brand-navy">{(p.seller?.name || '??').substring(0, 2).toUpperCase()}</AvatarFallback>
                                                </Avatar>
                                                <div className="min-w-0">
                                                    <p className="text-[11px] font-semibold text-brand-navy truncate">{p.seller?.name || '—'}</p>
                                                    <p className="text-[9px] text-gray-400 truncate">{p.seller?.email}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-[11px] text-brand-navy/80">{format(new Date(p.payout_month), 'MMM yyyy')}</td>
                                        <td className="px-3 py-2 text-right text-[11px] font-semibold text-emerald-600 tabular-nums">{fmtNum(p.delivered_orders)}</td>
                                        <td className="px-3 py-2 text-right text-[11px] text-brand-navy/70 tabular-nums">{fmtNum(p.days_present)}</td>
                                        <td className="px-3 py-2 text-right text-[11px] font-semibold text-brand-navy tabular-nums" title={fmtCurFull(Number(p.commission_earned))}>{fmtCur(Number(p.commission_earned))}</td>
                                        <td className="px-3 py-2 text-right text-[11px] font-semibold text-brand-navy tabular-nums" title={fmtCurFull(Number(p.total_amount))}>{fmtCur(Number(p.total_amount))}</td>
                                        <td className="px-3 py-2">
                                            <span className={cn('h-5 px-1.5 text-[9px] font-semibold rounded inline-flex items-center uppercase tracking-[0.08em]', p.status === 'paid' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600')}>
                                                {p.status}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            {p.status === 'pending' ? (
                                                <Button size="sm" variant="ghost" onClick={() => markMutation.mutate({ ids: [p.id], status: 'paid' })} className="h-7 rounded-md text-[10px] font-semibold text-emerald-600 hover:bg-emerald-50">
                                                    Mark paid
                                                </Button>
                                            ) : (
                                                <Button size="sm" variant="ghost" onClick={() => markMutation.mutate({ ids: [p.id], status: 'pending' })} className="h-7 rounded-md text-[10px] font-semibold text-amber-600 hover:bg-amber-50">
                                                    Unmark
                                                </Button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-8 w-8 rounded-md border-gray-200">
                        <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    <span className="text-[11px] font-semibold text-brand-navy px-2">
                        {page} / {totalPages}
                    </span>
                    <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="h-8 w-8 rounded-md border-gray-200">
                        <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                </div>
            )}
        </div>
    );
};

// ═════════════════════════ Media Buyer Payouts List ═════════════════════════
type MBPayout = {
    id: string;
    mediabuyer_id: string;
    payout_month: string;
    payment_type: 'commission' | 'salary';
    salary_earned: number | string;
    commission_earned: number | string;
    total_amount: number | string;
    delivered_orders: number;
    total_spend: number | string;
    campaigns_count: number;
    bank_snapshot: any;
    status: 'pending' | 'paid';
    created_at: string;
    paid_at: string | null;
    mediabuyer: { name: string; email: string; avatar_url: string | null } | null;
};

const MediaBuyerPayoutsList: React.FC = () => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'paid'>('all');
    const [selected, setSelected] = useState<string[]>([]);
    const [page, setPage] = useState(1);
    const PER_PAGE = 10;

    const { data: payouts = [], isLoading } = useQuery<MBPayout[]>({
        queryKey: ['mb-payouts', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('mediabuyer_payments')
                .select('*, mediabuyer:users!mediabuyer_payments_mediabuyer_id_fkey(name, email, avatar_url)')
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });
            if (error) {
                const { data: d2 } = await (supabase as any)
                    .from('mediabuyer_payments')
                    .select('*, mediabuyer:users(name, email, avatar_url)')
                    .eq('DigiCom Business', activeBusinessId)
                    .order('created_at', { ascending: false });
                return (d2 || []) as MBPayout[];
            }
            return (data || []) as MBPayout[];
        },
        enabled: !!activeBusinessId,
    });

    const markMutation = useMutation({
        mutationFn: async ({ ids, status }: { ids: string[]; status: 'paid' | 'pending' }) => {
            const payload = status === 'paid' ? { status, paid_at: new Date().toISOString() } : { status, paid_at: null };
            const { error } = await (supabase as any).from('mediabuyer_payments').update(payload).in('id', ids);
            if (error) throw error;
        },
        onSuccess: (_, vars) => {
            queryClient.invalidateQueries({ queryKey: ['mb-payouts'] });
            toast({ title: 'Updated', description: `${vars.ids.length} payout(s) marked as ${vars.status}.` });
            setSelected([]);
        },
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
    });

    const filtered = useMemo(() => {
        let out = payouts;
        if (statusFilter !== 'all') out = out.filter((p) => p.status === statusFilter);
        const q = search.toLowerCase().trim();
        if (q) out = out.filter((p) => (p.mediabuyer?.name || '').toLowerCase().includes(q) || (p.mediabuyer?.email || '').toLowerCase().includes(q));
        return out;
    }, [payouts, statusFilter, search]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

    const stats = useMemo(() => {
        let totalPaid = 0;
        let totalPending = 0;
        let thisMonth = 0;
        const thisMonthKey = format(new Date(), 'yyyy-MM');
        for (const p of payouts) {
            const amt = Number(p.total_amount || 0);
            if (p.status === 'paid') totalPaid += amt;
            else totalPending += amt;
            if (p.payout_month === thisMonthKey) thisMonth += 1;
        }
        return { totalPaid, totalPending, thisMonth };
    }, [payouts]);

    return (
        <div className="space-y-3">
            {/* KPI tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                    { label: 'Total paid', value: fmtCur(stats.totalPaid), accent: '#059669' },
                    { label: 'Total pending', value: fmtCur(stats.totalPending), accent: '#d97706' },
                    { label: 'This month', value: String(stats.thisMonth), accent: '#3b5e5e' },
                    { label: 'Payouts total', value: String(payouts.length), accent: '#9ca3af' },
                ].map((s) => (
                    <div key={s.label} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                        <span className="w-[3px] self-stretch rounded-full" style={{ background: s.accent }} />
                        <div className="flex-1 min-w-0">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{s.label}</p>
                            <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1 truncate">{s.value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <div className="relative flex-1 min-w-0 max-w-sm">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                    <Input
                        placeholder="Search media buyer..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-7 h-8 rounded-md border-gray-200 bg-white text-[11px]"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex gap-0.5 bg-white p-0.5 rounded-md border border-gray-200 shrink-0">
                        {(['all', 'pending', 'paid'] as const).map(s => (
                            <button
                                key={s}
                                onClick={() => setStatusFilter(s)}
                                className={cn(
                                    "px-2.5 h-7 rounded-[4px] text-[10px] font-semibold transition capitalize",
                                    statusFilter === s ? "bg-brand-navy text-white" : "text-gray-500 hover:text-brand-navy hover:bg-gray-50"
                                )}
                            >
                                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                            </button>
                        ))}
                    </div>
                    {selected.length > 0 && (
                        <Button
                            onClick={() => markMutation.mutate({ ids: selected, status: 'paid' })}
                            disabled={markMutation.isPending}
                            className="h-8 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold gap-1.5"
                        >
                            {markMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                            <Check className="w-3 h-3" />
                            Mark {selected.length} paid
                        </Button>
                    )}
                </div>
            </div>

            {/* Table */}
            {isLoading ? (
                <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-10 rounded-lg bg-gray-100 animate-pulse" />)}</div>
            ) : paginated.length === 0 ? (
                <div className="border border-dashed border-gray-200 rounded-xl py-8 text-center">
                    <p className="text-[14px] font-semibold text-brand-navy">No payouts yet</p>
                    <p className="text-[11px] text-gray-400 mt-1">Click "Generate Payouts" to create.</p>
                </div>
            ) : (
                <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    <th className="px-3 py-2 w-8">
                                        <Checkbox
                                            checked={paginated.length > 0 && paginated.every((p) => selected.includes(p.id))}
                                            onCheckedChange={(v) => {
                                                if (v) setSelected(Array.from(new Set([...selected, ...paginated.map((p) => p.id)])));
                                                else setSelected(selected.filter((id) => !paginated.some((p) => p.id === id)));
                                            }}
                                        />
                                    </th>
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Media buyer</th>
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Month</th>
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Type</th>
                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Delivered</th>
                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Spend</th>
                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Total</th>
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Status</th>
                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginated.map((p) => (
                                    <tr key={p.id} className="hover:bg-gray-50 transition-colors border-b border-gray-50 tabular-nums">
                                        <td className="px-3 py-2">
                                            <Checkbox checked={selected.includes(p.id)} onCheckedChange={(v) => setSelected(v ? [...selected, p.id] : selected.filter((id) => id !== p.id))} />
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-2">
                                                <Avatar className="h-6 w-6 shrink-0">
                                                    <AvatarImage src={p.mediabuyer?.avatar_url || ''} />
                                                    <AvatarFallback className="text-[9px] bg-brand-navy/10 text-brand-navy">{(p.mediabuyer?.name || '??').substring(0, 2).toUpperCase()}</AvatarFallback>
                                                </Avatar>
                                                <div className="min-w-0">
                                                    <p className="text-[11px] font-semibold text-brand-navy truncate">{p.mediabuyer?.name || '—'}</p>
                                                    <p className="text-[9px] text-gray-400 truncate">{p.mediabuyer?.email}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-[11px] text-brand-navy/80">{format(new Date(p.payout_month + '-01'), 'MMM yyyy')}</td>
                                        <td className="px-3 py-2">
                                            <span className={cn('h-5 px-1.5 text-[9px] font-semibold rounded inline-flex items-center uppercase tracking-[0.08em]', p.payment_type === 'commission' ? 'bg-brand-navy/10 text-brand-navy' : 'bg-gray-100 text-gray-600')}>
                                                {p.payment_type}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-right text-[11px] font-semibold text-emerald-600 tabular-nums">{fmtNum(p.delivered_orders)}</td>
                                        <td className="px-3 py-2 text-right text-[11px] text-brand-navy/70 tabular-nums" title={fmtCurFull(Number(p.total_spend))}>{fmtCur(Number(p.total_spend))}</td>
                                        <td className="px-3 py-2 text-right text-[11px] font-semibold text-brand-navy tabular-nums" title={fmtCurFull(Number(p.total_amount))}>{fmtCur(Number(p.total_amount))}</td>
                                        <td className="px-3 py-2">
                                            <span className={cn('h-5 px-1.5 text-[9px] font-semibold rounded inline-flex items-center uppercase tracking-[0.08em]', p.status === 'paid' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600')}>
                                                {p.status}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            {p.status === 'pending' ? (
                                                <Button size="sm" variant="ghost" onClick={() => markMutation.mutate({ ids: [p.id], status: 'paid' })} className="h-7 rounded-md text-[10px] font-semibold text-emerald-600 hover:bg-emerald-50">
                                                    Mark paid
                                                </Button>
                                            ) : (
                                                <Button size="sm" variant="ghost" onClick={() => markMutation.mutate({ ids: [p.id], status: 'pending' })} className="h-7 rounded-md text-[10px] font-semibold text-amber-600 hover:bg-amber-50">
                                                    Unmark
                                                </Button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-8 w-8 rounded-md border-gray-200">
                        <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    <span className="text-[11px] font-semibold text-brand-navy px-2">
                        {page} / {totalPages}
                    </span>
                    <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="h-8 w-8 rounded-md border-gray-200">
                        <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                </div>
            )}
        </div>
    );
};

// ═════════════════════════ Bulk Generate Dialog ═════════════════════════
const BulkGenerateDialog: React.FC<{ open: boolean; onOpenChange: (v: boolean) => void; initialRole: Role }> = ({ open, onOpenChange, initialRole }) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const [role, setRole] = useState<Role>(initialRole);
    const [monthKey, setMonthKey] = useState<string>(format(new Date(), 'yyyy-MM'));
    const [selectedIds, setSelectedIds] = useState<string[]>([]);

    React.useEffect(() => {
        if (open) {
            setRole(initialRole);
            setMonthKey(format(new Date(), 'yyyy-MM'));
            setSelectedIds([]);
        }
    }, [open, initialRole]);

    const monthOptions = useMemo(
        () =>
            eachMonthOfInterval({ start: subMonths(new Date(), 12), end: new Date() })
                .reverse()
                .map((d) => ({ value: format(d, 'yyyy-MM'), label: format(d, 'MMMM yyyy') })),
        []
    );

    const sellerEarnings = useSellerEarnings(monthKey);
    const mbEarnings = useMediaBuyerEarnings(monthKey);

    const activeRows = role === 'seller' ? sellerEarnings.rows : mbEarnings.rows;
    const activeLoading = role === 'seller' ? sellerEarnings.isLoading : mbEarnings.isLoading;

    React.useEffect(() => {
        if (!open || activeLoading) return;
        if (role === 'seller') {
            setSelectedIds(sellerEarnings.rows.filter((r) => r.total_amount > 0).map((r) => r.seller_id));
        } else {
            setSelectedIds(mbEarnings.rows.filter((r) => r.remaining_amount > 0).map((r) => r.mediabuyer_id));
        }
    }, [open, activeLoading, role, monthKey, sellerEarnings.rows, mbEarnings.rows]);

    const totals = useMemo(() => {
        if (role === 'seller') {
            const rows = (sellerEarnings.rows as SellerEarnings[]).filter((r) => selectedIds.includes(r.seller_id));
            return {
                users: rows.length,
                delivered: rows.reduce((a, r) => a + r.delivered_orders, 0),
                amount: rows.reduce((a, r) => a + r.total_amount, 0),
            };
        }
        const rows = (mbEarnings.rows as MediaBuyerEarnings[]).filter((r) => selectedIds.includes(r.mediabuyer_id));
        return {
            users: rows.length,
            delivered: rows.reduce((a, r) => a + r.delivered_orders, 0),
            amount: rows.reduce((a, r) => a + r.remaining_amount, 0),
        };
    }, [role, selectedIds, sellerEarnings.rows, mbEarnings.rows]);

    const generateMutation = useMutation({
        mutationFn: async () => {
            if (!activeBusinessId) throw new Error('No active business');
            if (selectedIds.length === 0) throw new Error('Select at least one collaborator');

            if (role === 'seller') {
                const rows = (sellerEarnings.rows as SellerEarnings[]).filter((r) => selectedIds.includes(r.seller_id));
                const payload = rows
                    .filter((r) => r.total_amount > 0)
                    .map((r) => ({
                        seller_id: r.seller_id,
                        payout_month: sellerEarnings.payoutMonthKey,
                        salary_earned: 0,
                        commission_earned: r.commission_earned,
                        total_amount: r.total_amount,
                        days_present: r.days_present,
                        delivered_orders: r.delivered_orders,
                        bank_snapshot: {
                            name: r.bank_name,
                            rib: r.bank_rib,
                            holder: r.bank_account_holder,
                            cin: r.cin_number,
                        },
                        status: 'pending',
                        'DigiCom Business': activeBusinessId,
                    }));
                if (payload.length === 0) throw new Error('All selected rows have 0 remainder');
                const { error } = await (supabase as any).from('seller_payments').insert(payload);
                if (error) throw error;
                return { role: 'seller' as const, count: payload.length };
            } else {
                const rows = (mbEarnings.rows as MediaBuyerEarnings[]).filter((r) => selectedIds.includes(r.mediabuyer_id));
                const payload = rows
                    .filter((r) => r.remaining_amount > 0)
                    .map((r) => ({
                        mediabuyer_id: r.mediabuyer_id,
                        'DigiCom Business': activeBusinessId,
                        payout_month: monthKey,
                        payment_type: r.payment_type || 'commission',
                        salary_earned: r.salary_earned,
                        commission_earned: r.commission_earned,
                        total_amount: r.remaining_amount,
                        delivered_orders: r.delivered_orders,
                        total_spend: r.total_spend,
                        campaigns_count: r.campaigns_count,
                        bank_snapshot: {
                            name: r.bank_name,
                            rib: r.bank_rib,
                            holder: r.bank_account_holder,
                            cin: r.cin_number,
                        },
                        status: 'pending',
                    }));
                if (payload.length === 0) throw new Error('All selected rows have 0 remainder');
                const { error } = await (supabase as any)
                    .from('mediabuyer_payments')
                    .upsert(payload, { onConflict: 'mediabuyer_id,payout_month' });
                if (error) throw error;
                return { role: 'mediabuyer' as const, count: payload.length };
            }
        },
        onSuccess: ({ role: r, count }) => {
            queryClient.invalidateQueries({ queryKey: [r === 'seller' ? 'seller-payouts' : 'mb-payouts'] });
            queryClient.invalidateQueries({ queryKey: ['mb-earnings-prior'] });
            queryClient.invalidateQueries({ queryKey: ['seller-earnings-prior'] });
            toast({ title: 'Payouts generated', description: `${count} payout${count !== 1 ? 's' : ''} created as pending.` });
            onOpenChange(false);
        },
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
    });

    const toggleRow = (id: string) => {
        setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };
    const toggleAll = () => {
        if (activeRows.length === 0) return;
        const ids = role === 'seller' ? (sellerEarnings.rows as SellerEarnings[]).map((r) => r.seller_id) : (mbEarnings.rows as MediaBuyerEarnings[]).map((r) => r.mediabuyer_id);
        if (selectedIds.length === ids.length) setSelectedIds([]);
        else setSelectedIds(ids);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl p-4 border border-gray-100 rounded-xl shadow-none overflow-hidden max-h-[90vh] flex flex-col">
                <DialogHeader className="pb-3 border-b border-gray-100">
                    <DialogTitle className="text-[13px] font-semibold text-brand-navy">Generate payouts</DialogTitle>
                    <DialogDescription className="text-[10px] text-gray-400">Select role and month. Review the breakdown, then generate all selected payouts as pending.</DialogDescription>
                </DialogHeader>

                <div className="py-3 flex items-center gap-3 border-b border-gray-100">
                    <div className="flex gap-0.5 bg-white p-0.5 rounded-md border border-gray-200">
                        <button
                            onClick={() => setRole('seller')}
                            className={cn('px-2.5 h-7 rounded-[4px] text-[10px] font-semibold transition', role === 'seller' ? 'bg-brand-navy text-white' : 'text-gray-500 hover:text-brand-navy hover:bg-gray-50')}
                        >
                            Sellers
                        </button>
                        <button
                            onClick={() => setRole('mediabuyer')}
                            className={cn('px-2.5 h-7 rounded-[4px] text-[10px] font-semibold transition', role === 'mediabuyer' ? 'bg-brand-navy text-white' : 'text-gray-500 hover:text-brand-navy hover:bg-gray-50')}
                        >
                            Media Buyers
                        </button>
                    </div>
                    <Select value={monthKey} onValueChange={setMonthKey}>
                        <SelectTrigger className="w-[180px] h-8 rounded-md border-gray-200 text-[11px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {monthOptions.map((m) => (
                                <SelectItem key={m.value} value={m.value} className="text-[11px]">{m.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex-1 overflow-y-auto py-3">
                    {activeLoading ? (
                        <div className="flex justify-center py-10">
                            <Loader2 className="w-6 h-6 animate-spin text-brand-navy/40" />
                        </div>
                    ) : activeRows.length === 0 ? (
                        <div className="text-center py-10 text-[11px] text-gray-400">
                            No {role === 'seller' ? 'sellers' : 'media buyers'} in this business.
                        </div>
                    ) : (
                        <div className="rounded-xl border border-gray-100 overflow-hidden">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-gray-100 bg-gray-50/60">
                                        <th className="px-3 py-2 w-8">
                                            <Checkbox checked={selectedIds.length > 0 && selectedIds.length === activeRows.length} onCheckedChange={toggleAll} />
                                        </th>
                                        <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">{role === 'seller' ? 'Seller' : 'Media buyer'}</th>
                                        {role === 'mediabuyer' && <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Type</th>}
                                        <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Delivered</th>
                                        {role === 'seller' ? <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Days</th> : <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Spend</th>}
                                        {role === 'mediabuyer' && <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Already paid</th>}
                                        <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">To pay</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {role === 'seller'
                                        ? (sellerEarnings.rows as SellerEarnings[]).map((r) => {
                                              const hasRemainder = r.total_amount > 0;
                                              const sel = selectedIds.includes(r.seller_id);
                                              return (
                                                  <tr key={r.seller_id} className={cn('border-b border-gray-50 hover:bg-gray-50 transition-colors tabular-nums', sel && 'bg-brand-navy/[0.02]', !hasRemainder && 'opacity-40')}>
                                                      <td className="px-3 py-2">
                                                          <Checkbox checked={sel} disabled={!hasRemainder} onCheckedChange={() => toggleRow(r.seller_id)} />
                                                      </td>
                                                      <td className="px-3 py-2">
                                                          <div className="flex items-center gap-2 min-w-0">
                                                              <Avatar className="h-6 w-6 shrink-0">
                                                                  <AvatarImage src={r.avatar_url || ''} />
                                                                  <AvatarFallback className="text-[9px] bg-brand-navy/10 text-brand-navy">{r.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                                                              </Avatar>
                                                              <div className="min-w-0">
                                                                  <p className="text-[11px] font-semibold text-brand-navy truncate">{r.name}</p>
                                                                  <p className="text-[9px] text-gray-400 truncate">{r.email}</p>
                                                              </div>
                                                          </div>
                                                      </td>
                                                      <td className="px-3 py-2 text-right text-[11px] font-semibold text-emerald-600 tabular-nums">{fmtNum(r.delivered_orders)}</td>
                                                      <td className="px-3 py-2 text-right text-[11px] text-brand-navy/70 tabular-nums">{r.days_present}</td>
                                                      <td className="px-3 py-2 text-right text-[11px] font-semibold text-brand-navy tabular-nums" title={fmtCurFull(r.total_amount)}>
                                                          {fmtCur(r.total_amount)}
                                                      </td>
                                                  </tr>
                                              );
                                          })
                                        : (mbEarnings.rows as MediaBuyerEarnings[]).map((r) => {
                                              const hasRemainder = r.remaining_amount > 0;
                                              const sel = selectedIds.includes(r.mediabuyer_id);
                                              return (
                                                  <tr key={r.mediabuyer_id} className={cn('border-b border-gray-50 hover:bg-gray-50 transition-colors tabular-nums', sel && 'bg-brand-navy/[0.02]', !hasRemainder && 'opacity-40')}>
                                                      <td className="px-3 py-2">
                                                          <Checkbox checked={sel} disabled={!hasRemainder} onCheckedChange={() => toggleRow(r.mediabuyer_id)} />
                                                      </td>
                                                      <td className="px-3 py-2">
                                                          <div className="flex items-center gap-2 min-w-0">
                                                              <Avatar className="h-6 w-6 shrink-0">
                                                                  <AvatarImage src={r.avatar_url || ''} />
                                                                  <AvatarFallback className="text-[9px] bg-brand-navy/10 text-brand-navy">{r.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                                                              </Avatar>
                                                              <div className="min-w-0">
                                                                  <p className="text-[11px] font-semibold text-brand-navy truncate">{r.name}</p>
                                                                  <p className="text-[9px] text-gray-400 truncate">{r.email}</p>
                                                              </div>
                                                          </div>
                                                      </td>
                                                      <td className="px-3 py-2">
                                                          <span className={cn('h-5 px-1.5 text-[9px] font-semibold rounded inline-flex items-center uppercase tracking-[0.08em]', r.payment_type === 'commission' ? 'bg-brand-navy/10 text-brand-navy' : 'bg-gray-100 text-gray-600')}>
                                                              {r.payment_type || 'n/a'}
                                                          </span>
                                                      </td>
                                                      <td className="px-3 py-2 text-right text-[11px] font-semibold text-emerald-600 tabular-nums">{fmtNum(r.delivered_orders)}</td>
                                                      <td className="px-3 py-2 text-right text-[11px] text-brand-navy/70 tabular-nums" title={fmtCurFull(r.total_spend)}>
                                                          {fmtCur(r.total_spend)}
                                                      </td>
                                                      <td className="px-3 py-2 text-right text-[11px] text-brand-navy/50 tabular-nums" title={fmtCurFull(r.prior_paid_amount)}>
                                                          {r.prior_paid_amount > 0 ? fmtCur(r.prior_paid_amount) : '—'}
                                                      </td>
                                                      <td className="px-3 py-2 text-right text-[11px] font-semibold text-brand-navy tabular-nums" title={fmtCurFull(r.remaining_amount)}>
                                                          {fmtCur(r.remaining_amount)}
                                                      </td>
                                                  </tr>
                                              );
                                          })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {!activeLoading && activeRows.length > 0 && (
                        <div className="mt-3 rounded-xl bg-gray-50 border border-gray-100 p-3 flex items-start gap-2">
                            <Info className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-0.5" />
                            <div className="text-[10px] text-brand-navy/70 space-y-0.5">
                                <p>
                                    <span className="font-bold">{role === 'seller' ? 'Sellers' : 'Media buyers'}:</span>{' '}
                                    {role === 'seller'
                                        ? 'Commission accrual from delivery days, minus prior payouts for the same month.'
                                        : 'Salary type → full monthly salary. Commission type → delivered orders × commission price, minus prior payouts for the same month.'}
                                </p>
                                <p className="text-brand-navy/50">Rows with 0 remainder are disabled. Generated payouts are created as pending and must be marked paid manually.</p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="pt-3 border-t border-gray-100 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        {[
                            { label: 'Selected', value: String(totals.users), color: 'text-brand-navy' },
                            { label: 'Delivered', value: fmtNum(totals.delivered), color: 'text-emerald-600' },
                            { label: 'Total', value: fmtCur(totals.amount), color: 'text-brand-navy' },
                        ].map((s) => (
                            <div key={s.label}>
                                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">{s.label}</p>
                                <p className={cn("text-[13px] font-semibold tabular-nums", s.color)} title={s.label === 'Total' ? fmtCurFull(totals.amount) : undefined}>{s.value}</p>
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-8 rounded-md text-[11px] font-semibold">
                            Cancel
                        </Button>
                        <Button
                            onClick={() => generateMutation.mutate()}
                            disabled={generateMutation.isPending || totals.users === 0 || totals.amount === 0}
                            className="h-8 rounded-md bg-brand-navy hover:bg-brand-navy/90 text-white text-[11px] font-semibold gap-1.5"
                        >
                            {generateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                            Generate {totals.users} payout{totals.users !== 1 ? 's' : ''}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default Salaries;
