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
        <div className="space-y-8 animate-in fade-in duration-500 pb-12">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Salaries</h1>
                            <p className="text-gray-500 font-light">Bulk payouts for sellers and media buyers.</p>
                        </div>
                        <Button
                            onClick={() => setBulkOpen(true)}
                            className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 group flex items-center gap-2"
                        >
                            <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-500" />
                            Generate Payouts
                        </Button>
                    </div>
                </div>
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as Role)}>
                <TabsList className="bg-brand-navy/[0.04] p-1 rounded-2xl h-auto inline-flex gap-1">
                    <TabsTrigger value="seller" className="rounded-xl px-5 py-2.5 text-xs font-bold uppercase tracking-wider data-[state=active]:bg-white data-[state=active]:text-brand-navy text-brand-navy/50">
                        Sellers
                    </TabsTrigger>
                    <TabsTrigger value="mediabuyer" className="rounded-xl px-5 py-2.5 text-xs font-bold uppercase tracking-wider data-[state=active]:bg-white data-[state=active]:text-brand-navy text-brand-navy/50">
                        Media Buyers
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="seller" className="mt-6 outline-none">
                    <SellerPayoutsList />
                </TabsContent>
                <TabsContent value="mediabuyer" className="mt-6 outline-none">
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
                // Fallback: join may fail if FK naming differs. Try without the explicit FK name.
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
        <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Total paid" value={fmtCur(stats.totalPaid)} valueTitle={fmtCurFull(stats.totalPaid)} icon={CheckCircle2} tone="bg-emerald-500/10 text-emerald-600" />
                <StatCard label="Total pending" value={fmtCur(stats.totalPending)} valueTitle={fmtCurFull(stats.totalPending)} icon={Clock} tone="bg-amber-500/10 text-amber-600" />
                <StatCard label="This month" value={String(stats.thisMonth)} icon={Sparkles} tone="bg-primary/10 text-primary" />
                <StatCard label="Payouts total" value={String(payouts.length)} icon={Wallet} tone="bg-brand-navy/10 text-brand-navy" />
            </div>

            {/* Filters */}
            <Card className="border-none rounded-[24px] bg-white/90 backdrop-blur-sm shadow-sm">
                <CardContent className="p-4 flex flex-col md:flex-row gap-3 md:items-center">
                    <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input placeholder="Search seller..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-11 h-11 rounded-2xl border-gray-100 bg-white" />
                    </div>
                    <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                        <SelectTrigger className="w-[160px] h-11 rounded-2xl border-gray-100 bg-white font-bold">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-2xl">
                            <SelectItem value="all">All statuses</SelectItem>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="paid">Paid</SelectItem>
                        </SelectContent>
                    </Select>
                    {selected.length > 0 && (
                        <Button onClick={() => markMutation.mutate({ ids: selected, status: 'paid' })} disabled={markMutation.isPending} className="h-11 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-2">
                            {markMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                            <Check className="w-4 h-4" />
                            Mark {selected.length} as paid
                        </Button>
                    )}
                </CardContent>
            </Card>

            {/* Table */}
            <Card className="border-none rounded-[28px] bg-white/90 backdrop-blur-sm shadow-sm overflow-hidden">
                <CardContent className="p-0">
                    {isLoading ? (
                        <div className="p-16 flex justify-center">
                            <Loader2 className="w-8 h-8 animate-spin text-brand-navy/40" />
                        </div>
                    ) : paginated.length === 0 ? (
                        <div className="p-16 text-center text-muted-foreground">No payouts yet. Click "Generate Payouts" to create.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-brand-navy/5 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">
                                        <th className="text-left px-4 py-3 w-10">
                                            <Checkbox
                                                checked={paginated.length > 0 && paginated.every((p) => selected.includes(p.id))}
                                                onCheckedChange={(v) => {
                                                    if (v) setSelected(Array.from(new Set([...selected, ...paginated.map((p) => p.id)])));
                                                    else setSelected(selected.filter((id) => !paginated.some((p) => p.id === id)));
                                                }}
                                            />
                                        </th>
                                        <th className="text-left px-4 py-3">Seller</th>
                                        <th className="text-left px-3 py-3">Month</th>
                                        <th className="text-right px-3 py-3">Delivered</th>
                                        <th className="text-right px-3 py-3">Days</th>
                                        <th className="text-right px-3 py-3">Commission</th>
                                        <th className="text-right px-3 py-3">Total</th>
                                        <th className="text-left px-3 py-3">Status</th>
                                        <th className="text-right px-4 py-3 pr-6">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginated.map((p) => (
                                        <tr key={p.id} className="border-b border-brand-navy/[0.03] hover:bg-brand-navy/[0.02] tabular-nums">
                                            <td className="px-4 py-3">
                                                <Checkbox checked={selected.includes(p.id)} onCheckedChange={(v) => setSelected(v ? [...selected, p.id] : selected.filter((id) => id !== p.id))} />
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <Avatar className="h-8 w-8">
                                                        <AvatarImage src={p.seller?.avatar_url || ''} />
                                                        <AvatarFallback className="text-[10px] bg-brand-navy text-white">{(p.seller?.name || '??').substring(0, 2).toUpperCase()}</AvatarFallback>
                                                    </Avatar>
                                                    <div className="min-w-0">
                                                        <p className="text-xs font-bold text-brand-navy truncate">{p.seller?.name || '—'}</p>
                                                        <p className="text-[10px] text-muted-foreground truncate">{p.seller?.email}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-3 text-xs text-brand-navy/70 font-medium">{format(new Date(p.payout_month), 'MMM yyyy')}</td>
                                            <td className="text-right px-3 py-3 text-xs font-bold text-emerald-600">{fmtNum(p.delivered_orders)}</td>
                                            <td className="text-right px-3 py-3 text-xs text-brand-navy/70">{fmtNum(p.days_present)}</td>
                                            <td className="text-right px-3 py-3 text-xs font-bold text-brand-navy" title={fmtCurFull(Number(p.commission_earned))}>{fmtCur(Number(p.commission_earned))}</td>
                                            <td className="text-right px-3 py-3 font-black text-brand-navy" title={fmtCurFull(Number(p.total_amount))}>{fmtCur(Number(p.total_amount))}</td>
                                            <td className="px-3 py-3">
                                                <Badge className={cn('rounded-full text-[9px] font-black uppercase border-none', p.status === 'paid' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600')}>
                                                    {p.status}
                                                </Badge>
                                            </td>
                                            <td className="text-right px-4 py-3 pr-6">
                                                {p.status === 'pending' ? (
                                                    <Button size="sm" variant="ghost" onClick={() => markMutation.mutate({ ids: [p.id], status: 'paid' })} className="h-8 rounded-xl text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700">
                                                        Mark paid
                                                    </Button>
                                                ) : (
                                                    <Button size="sm" variant="ghost" onClick={() => markMutation.mutate({ ids: [p.id], status: 'pending' })} className="h-8 rounded-xl text-amber-600 hover:bg-amber-50 hover:text-amber-700">
                                                        Unmark
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-9 w-9 rounded-xl">
                        <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-xs font-bold text-brand-navy/60 px-3">
                        Page {page} / {totalPages}
                    </span>
                    <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="h-9 w-9 rounded-xl">
                        <ChevronRight className="w-4 h-4" />
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
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Total paid" value={fmtCur(stats.totalPaid)} valueTitle={fmtCurFull(stats.totalPaid)} icon={CheckCircle2} tone="bg-emerald-500/10 text-emerald-600" />
                <StatCard label="Total pending" value={fmtCur(stats.totalPending)} valueTitle={fmtCurFull(stats.totalPending)} icon={Clock} tone="bg-amber-500/10 text-amber-600" />
                <StatCard label="This month" value={String(stats.thisMonth)} icon={Sparkles} tone="bg-primary/10 text-primary" />
                <StatCard label="Payouts total" value={String(payouts.length)} icon={Wallet} tone="bg-brand-navy/10 text-brand-navy" />
            </div>

            <Card className="border-none rounded-[24px] bg-white/90 backdrop-blur-sm shadow-sm">
                <CardContent className="p-4 flex flex-col md:flex-row gap-3 md:items-center">
                    <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input placeholder="Search media buyer..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-11 h-11 rounded-2xl border-gray-100 bg-white" />
                    </div>
                    <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                        <SelectTrigger className="w-[160px] h-11 rounded-2xl border-gray-100 bg-white font-bold">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-2xl">
                            <SelectItem value="all">All statuses</SelectItem>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="paid">Paid</SelectItem>
                        </SelectContent>
                    </Select>
                    {selected.length > 0 && (
                        <Button onClick={() => markMutation.mutate({ ids: selected, status: 'paid' })} disabled={markMutation.isPending} className="h-11 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-2">
                            {markMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                            <Check className="w-4 h-4" />
                            Mark {selected.length} as paid
                        </Button>
                    )}
                </CardContent>
            </Card>

            <Card className="border-none rounded-[28px] bg-white/90 backdrop-blur-sm shadow-sm overflow-hidden">
                <CardContent className="p-0">
                    {isLoading ? (
                        <div className="p-16 flex justify-center">
                            <Loader2 className="w-8 h-8 animate-spin text-brand-navy/40" />
                        </div>
                    ) : paginated.length === 0 ? (
                        <div className="p-16 text-center text-muted-foreground">No payouts yet. Click "Generate Payouts" to create.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-brand-navy/5 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">
                                        <th className="text-left px-4 py-3 w-10">
                                            <Checkbox
                                                checked={paginated.length > 0 && paginated.every((p) => selected.includes(p.id))}
                                                onCheckedChange={(v) => {
                                                    if (v) setSelected(Array.from(new Set([...selected, ...paginated.map((p) => p.id)])));
                                                    else setSelected(selected.filter((id) => !paginated.some((p) => p.id === id)));
                                                }}
                                            />
                                        </th>
                                        <th className="text-left px-4 py-3">Media buyer</th>
                                        <th className="text-left px-3 py-3">Month</th>
                                        <th className="text-left px-3 py-3">Type</th>
                                        <th className="text-right px-3 py-3">Delivered</th>
                                        <th className="text-right px-3 py-3">Spend</th>
                                        <th className="text-right px-3 py-3">Total</th>
                                        <th className="text-left px-3 py-3">Status</th>
                                        <th className="text-right px-4 py-3 pr-6">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginated.map((p) => (
                                        <tr key={p.id} className="border-b border-brand-navy/[0.03] hover:bg-brand-navy/[0.02] tabular-nums">
                                            <td className="px-4 py-3">
                                                <Checkbox checked={selected.includes(p.id)} onCheckedChange={(v) => setSelected(v ? [...selected, p.id] : selected.filter((id) => id !== p.id))} />
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <Avatar className="h-8 w-8">
                                                        <AvatarImage src={p.mediabuyer?.avatar_url || ''} />
                                                        <AvatarFallback className="text-[10px] bg-brand-navy text-white">{(p.mediabuyer?.name || '??').substring(0, 2).toUpperCase()}</AvatarFallback>
                                                    </Avatar>
                                                    <div className="min-w-0">
                                                        <p className="text-xs font-bold text-brand-navy truncate">{p.mediabuyer?.name || '—'}</p>
                                                        <p className="text-[10px] text-muted-foreground truncate">{p.mediabuyer?.email}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-3 text-xs text-brand-navy/70 font-medium">{format(new Date(p.payout_month + '-01'), 'MMM yyyy')}</td>
                                            <td className="px-3 py-3">
                                                <Badge className={cn('rounded-full text-[9px] font-black uppercase border-none', p.payment_type === 'commission' ? 'bg-primary/10 text-primary' : 'bg-indigo-500/10 text-indigo-600')}>
                                                    {p.payment_type}
                                                </Badge>
                                            </td>
                                            <td className="text-right px-3 py-3 text-xs font-bold text-emerald-600">{fmtNum(p.delivered_orders)}</td>
                                            <td className="text-right px-3 py-3 text-xs text-brand-navy/70" title={fmtCurFull(Number(p.total_spend))}>{fmtCur(Number(p.total_spend))}</td>
                                            <td className="text-right px-3 py-3 font-black text-brand-navy" title={fmtCurFull(Number(p.total_amount))}>{fmtCur(Number(p.total_amount))}</td>
                                            <td className="px-3 py-3">
                                                <Badge className={cn('rounded-full text-[9px] font-black uppercase border-none', p.status === 'paid' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600')}>
                                                    {p.status}
                                                </Badge>
                                            </td>
                                            <td className="text-right px-4 py-3 pr-6">
                                                {p.status === 'pending' ? (
                                                    <Button size="sm" variant="ghost" onClick={() => markMutation.mutate({ ids: [p.id], status: 'paid' })} className="h-8 rounded-xl text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700">
                                                        Mark paid
                                                    </Button>
                                                ) : (
                                                    <Button size="sm" variant="ghost" onClick={() => markMutation.mutate({ ids: [p.id], status: 'pending' })} className="h-8 rounded-xl text-amber-600 hover:bg-amber-50 hover:text-amber-700">
                                                        Unmark
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-9 w-9 rounded-xl">
                        <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-xs font-bold text-brand-navy/60 px-3">
                        Page {page} / {totalPages}
                    </span>
                    <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="h-9 w-9 rounded-xl">
                        <ChevronRight className="w-4 h-4" />
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

    // Auto-select rows with unpaid remainder > 0 when data loads.
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
                // Media buyer table has UNIQUE (mediabuyer_id, payout_month). If a row exists,
                // the insert will fail. Use upsert to replace in place.
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
            <DialogContent className="max-w-4xl p-0 border-none bg-brand-white rounded-[32px] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
                <DialogHeader className="px-8 pt-8 pb-4 border-b border-brand-navy/5">
                    <DialogTitle className="text-2xl font-bold text-brand-navy">Generate payouts</DialogTitle>
                    <DialogDescription>Select role and month. Review the breakdown, then generate all selected payouts as pending.</DialogDescription>
                </DialogHeader>

                <div className="px-8 py-4 flex items-center gap-3 border-b border-brand-navy/5">
                    <div className="flex bg-brand-navy/[0.04] p-1 rounded-2xl">
                        <button
                            onClick={() => setRole('seller')}
                            className={cn(
                                'px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all',
                                role === 'seller' ? 'bg-white text-brand-navy shadow-sm' : 'text-brand-navy/50'
                            )}
                        >
                            Sellers
                        </button>
                        <button
                            onClick={() => setRole('mediabuyer')}
                            className={cn(
                                'px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all',
                                role === 'mediabuyer' ? 'bg-white text-brand-navy shadow-sm' : 'text-brand-navy/50'
                            )}
                        >
                            Media Buyers
                        </button>
                    </div>
                    <Select value={monthKey} onValueChange={setMonthKey}>
                        <SelectTrigger className="w-[200px] h-11 rounded-2xl border-none bg-brand-navy/[0.04] font-bold">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-2xl">
                            {monthOptions.map((m) => (
                                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex-1 overflow-y-auto px-8 py-6">
                    {activeLoading ? (
                        <div className="flex justify-center py-16">
                            <Loader2 className="w-8 h-8 animate-spin text-brand-navy/40" />
                        </div>
                    ) : activeRows.length === 0 ? (
                        <div className="text-center py-16 text-muted-foreground">
                            No {role === 'seller' ? 'sellers' : 'media buyers'} in this business.
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-brand-navy/5 overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-brand-navy/[0.03] border-b border-brand-navy/5 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">
                                        <th className="text-left px-4 py-3 w-10">
                                            <Checkbox checked={selectedIds.length > 0 && selectedIds.length === activeRows.length} onCheckedChange={toggleAll} />
                                        </th>
                                        <th className="text-left px-3 py-3">{role === 'seller' ? 'Seller' : 'Media buyer'}</th>
                                        {role === 'mediabuyer' && <th className="text-left px-3 py-3">Type</th>}
                                        <th className="text-right px-3 py-3">Delivered</th>
                                        {role === 'seller' ? <th className="text-right px-3 py-3">Days</th> : <th className="text-right px-3 py-3">Spend</th>}
                                        {role === 'mediabuyer' && <th className="text-right px-3 py-3">Already paid</th>}
                                        <th className="text-right px-3 py-3 pr-4">To pay</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {role === 'seller'
                                        ? (sellerEarnings.rows as SellerEarnings[]).map((r) => {
                                              const hasRemainder = r.total_amount > 0;
                                              const sel = selectedIds.includes(r.seller_id);
                                              return (
                                                  <tr key={r.seller_id} className={cn('border-b border-brand-navy/[0.03] tabular-nums', sel && 'bg-primary/[0.04]', !hasRemainder && 'opacity-40')}>
                                                      <td className="px-4 py-3">
                                                          <Checkbox checked={sel} disabled={!hasRemainder} onCheckedChange={() => toggleRow(r.seller_id)} />
                                                      </td>
                                                      <td className="px-3 py-3">
                                                          <div className="flex items-center gap-2 min-w-0">
                                                              <Avatar className="h-8 w-8">
                                                                  <AvatarImage src={r.avatar_url || ''} />
                                                                  <AvatarFallback className="text-[10px] bg-brand-navy text-white">{r.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                                                              </Avatar>
                                                              <div className="min-w-0">
                                                                  <p className="text-xs font-bold text-brand-navy truncate">{r.name}</p>
                                                                  <p className="text-[10px] text-muted-foreground truncate">{r.email}</p>
                                                              </div>
                                                          </div>
                                                      </td>
                                                      <td className="text-right px-3 py-3 text-xs font-bold text-emerald-600">{fmtNum(r.delivered_orders)}</td>
                                                      <td className="text-right px-3 py-3 text-xs text-brand-navy/70">{r.days_present}</td>
                                                      <td className="text-right px-3 py-3 pr-4 font-black text-brand-navy" title={fmtCurFull(r.total_amount)}>
                                                          {fmtCur(r.total_amount)}
                                                      </td>
                                                  </tr>
                                              );
                                          })
                                        : (mbEarnings.rows as MediaBuyerEarnings[]).map((r) => {
                                              const hasRemainder = r.remaining_amount > 0;
                                              const sel = selectedIds.includes(r.mediabuyer_id);
                                              return (
                                                  <tr key={r.mediabuyer_id} className={cn('border-b border-brand-navy/[0.03] tabular-nums', sel && 'bg-primary/[0.04]', !hasRemainder && 'opacity-40')}>
                                                      <td className="px-4 py-3">
                                                          <Checkbox checked={sel} disabled={!hasRemainder} onCheckedChange={() => toggleRow(r.mediabuyer_id)} />
                                                      </td>
                                                      <td className="px-3 py-3">
                                                          <div className="flex items-center gap-2 min-w-0">
                                                              <Avatar className="h-8 w-8">
                                                                  <AvatarImage src={r.avatar_url || ''} />
                                                                  <AvatarFallback className="text-[10px] bg-brand-navy text-white">{r.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                                                              </Avatar>
                                                              <div className="min-w-0">
                                                                  <p className="text-xs font-bold text-brand-navy truncate">{r.name}</p>
                                                                  <p className="text-[10px] text-muted-foreground truncate">{r.email}</p>
                                                              </div>
                                                          </div>
                                                      </td>
                                                      <td className="px-3 py-3">
                                                          <Badge
                                                              className={cn(
                                                                  'rounded-full text-[9px] font-black uppercase border-none',
                                                                  r.payment_type === 'commission' ? 'bg-primary/10 text-primary' : 'bg-indigo-500/10 text-indigo-600'
                                                              )}
                                                          >
                                                              {r.payment_type || 'n/a'}
                                                          </Badge>
                                                      </td>
                                                      <td className="text-right px-3 py-3 text-xs font-bold text-emerald-600">{fmtNum(r.delivered_orders)}</td>
                                                      <td className="text-right px-3 py-3 text-xs text-brand-navy/70" title={fmtCurFull(r.total_spend)}>
                                                          {fmtCur(r.total_spend)}
                                                      </td>
                                                      <td className="text-right px-3 py-3 text-xs text-brand-navy/50" title={fmtCurFull(r.prior_paid_amount)}>
                                                          {r.prior_paid_amount > 0 ? fmtCur(r.prior_paid_amount) : '—'}
                                                      </td>
                                                      <td className="text-right px-3 py-3 pr-4 font-black text-brand-navy" title={fmtCurFull(r.remaining_amount)}>
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
                        <div className="mt-4 rounded-2xl bg-brand-navy/[0.03] border border-brand-navy/5 p-4 flex items-start gap-3">
                            <Info className="w-4 h-4 text-brand-navy/40 shrink-0 mt-0.5" />
                            <div className="text-xs text-brand-navy/70 space-y-1">
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

                <DialogFooter className="px-8 py-5 border-t border-brand-navy/5 bg-brand-navy/[0.02] flex items-center justify-between gap-4">
                    <div className="flex items-center gap-5 text-xs">
                        <div>
                            <p className="text-[9px] font-bold uppercase text-muted-foreground">Selected</p>
                            <p className="text-base font-black text-brand-navy tabular-nums">{totals.users}</p>
                        </div>
                        <div>
                            <p className="text-[9px] font-bold uppercase text-muted-foreground">Delivered</p>
                            <p className="text-base font-black text-emerald-600 tabular-nums">{fmtNum(totals.delivered)}</p>
                        </div>
                        <div>
                            <p className="text-[9px] font-bold uppercase text-muted-foreground">Total</p>
                            <p className="text-base font-black text-primary tabular-nums" title={fmtCurFull(totals.amount)}>
                                {fmtCur(totals.amount)}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-2xl font-bold">
                            Cancel
                        </Button>
                        <Button
                            onClick={() => generateMutation.mutate()}
                            disabled={generateMutation.isPending || totals.users === 0 || totals.amount === 0}
                            className="rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold gap-2 shadow-xl shadow-primary/20"
                        >
                            {generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                            Generate {totals.users} payout{totals.users !== 1 ? 's' : ''}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

// ═════════════════════════ Helpers ═════════════════════════
const StatCard: React.FC<{ label: string; value: string; valueTitle?: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = ({ label, value, valueTitle, icon: Icon, tone }) => (
    <div className="rounded-3xl border border-gray-100/80 bg-white/90 p-5 shadow-sm backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
                <p className="text-xl font-black tabular-nums text-gray-900 tracking-tight break-words" title={valueTitle || value}>
                    {value}
                </p>
            </div>
            <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl', tone)}>
                <Icon className="h-5 w-5" />
            </div>
        </div>
    </div>
);

export default Salaries;
