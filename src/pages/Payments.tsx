import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus, Search, Loader2, Package, DollarSign, Eye, Truck, FileText,
    CheckCircle2, Clock, Building2, CreditCard, AlertTriangle,
    ChevronDown, ChevronRight, Printer, ArrowRight, SearchX
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';

interface UnpaidOrder {
    id: string; name: string; phone: string; price: number; shipping_cost: number;
    tracking_number: string | null; company_id: string | null; payment_delivery_id: string | null;
    parcels: { tracking_code: string | null; provider: { id: string; name: string; logo_url: string | null } | null }[];
    company: { id: string; name: string; logo_url: string | null } | null;
    items: { quantity: number; unit_price: number; product: { name: string } | null }[];
}

interface ProviderGroup {
    provider_id: string; provider_name: string; logo_url: string | null;
    orders: UnpaidOrder[]; total_amount: number; total_shipping: number; net_amount: number;
}

interface PaymentNote {
    id: string; reference: string; status: string; total_amount: number;
    total_shipping_fees: number; net_amount: number; order_count: number;
    paid_at: string | null; note: string | null; created_at: string;
    provider: { id: string; name: string; logo_url: string | null } | null;
    line_items: { id: string; order_id: string; tracking_code: string | null; amount: number; shipping_fee: number }[];
}

const Payments = () => {
    const { getOrderByCategory, getPkgByCategory } = useStatusCategories();
    const unpaidStatusId = getOrderByCategory('unpaid')?.id;
    const paidStatusId = getOrderByCategory('paid')?.id;
    const deliveredPkgId = getPkgByCategory('delivered')?.id;

    const [isWizardOpen, setIsWizardOpen] = useState(false);
    const [wizardStep, setWizardStep] = useState(0);
    const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
    const [isViewNoteOpen, setIsViewNoteOpen] = useState(false);
    const [selectedNote, setSelectedNote] = useState<PaymentNote | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'unpaid' | 'paid'>('all');
    const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // ─── Fetch unpaid+livré orders (exclude those already linked to a payment note) ───
    const { data: unpaidOrders, isLoading: isLoadingUnpaid } = useQuery({
        queryKey: ['unpaid-livre-orders', activeBusinessId, unpaidStatusId, deliveredPkgId],
        queryFn: async () => {
            if (!activeBusinessId || !unpaidStatusId || !deliveredPkgId) return [];
            const { data, error } = await (supabase as any)
                .from('orders')
                .select(`*, company:providers(id, name, logo_url), items:order_items(quantity, unit_price, product:products(name)), parcels:company_parcels(tracking_code, provider:providers(id, name, logo_url))`)
                .eq('DigiCom Business', activeBusinessId)
                .eq('order_status_id', unpaidStatusId)
                .eq('package_status_id', deliveredPkgId)
                .is('payment_delivery_id', null)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (data || []) as UnpaidOrder[];
        },
        enabled: !!unpaidStatusId && !!deliveredPkgId,
    });

    // ─── Fetch existing payment notes ───
    const { data: paymentNotes, isLoading: isLoadingNotes } = useQuery({
        queryKey: ['payment-notes', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('company_payment_notes')
                .select(`*, provider:providers(id, name, logo_url), line_items:company_payment_note_orders(id, order_id, tracking_code, amount, shipping_fee)`)
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (data || []) as PaymentNote[];
        },
    });

    // ─── Group unpaid orders by provider ───
    const providerGroups = useMemo<ProviderGroup[]>(() => {
        if (!unpaidOrders?.length) return [];
        const map = new Map<string, ProviderGroup>();
        for (const order of unpaidOrders) {
            const providerId = order.company?.id || order.parcels?.[0]?.provider?.id || 'unknown';
            const providerName = order.company?.name || order.parcels?.[0]?.provider?.name || 'Unknown';
            const logoUrl = order.company?.logo_url || order.parcels?.[0]?.provider?.logo_url || null;
            if (!map.has(providerId)) {
                map.set(providerId, { provider_id: providerId, provider_name: providerName, logo_url: logoUrl, orders: [], total_amount: 0, total_shipping: 0, net_amount: 0 });
            }
            const group = map.get(providerId)!;
            group.orders.push(order);
            group.total_amount += Number(order.price || 0);
            group.total_shipping += Number(order.shipping_cost || 0);
            group.net_amount = group.total_amount - group.total_shipping;
        }
        return Array.from(map.values());
    }, [unpaidOrders]);

    const selectedGroup = providerGroups.find(g => g.provider_id === selectedProvider);

    // ─── Generate payment note ───
    const generateNoteMutation = useMutation({
        mutationFn: async (group: ProviderGroup) => {
            const ref = `PAY-${group.provider_name.substring(0, 3).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
            const { data: note, error: noteError } = await (supabase as any)
                .from('company_payment_notes')
                .insert({ provider_id: group.provider_id, reference: ref, status: 'unpaid', total_amount: group.total_amount, total_shipping_fees: group.total_shipping, net_amount: group.net_amount, order_count: group.orders.length, 'DigiCom Business': activeBusinessId })
                .select().single();
            if (noteError) throw noteError;
            const lineItems = group.orders.map(o => ({ payment_note_id: note.id, order_id: o.id, tracking_code: o.parcels?.[0]?.tracking_code || o.tracking_number || null, amount: Number(o.price || 0), shipping_fee: Number(o.shipping_cost || 0), 'DigiCom Business': activeBusinessId }));
            const { error: itemsError } = await (supabase as any).from('company_payment_note_orders').insert(lineItems);
            if (itemsError) throw itemsError;
            await (supabase as any).from('orders').update({ payment_delivery_id: note.id }).in('id', group.orders.map(o => o.id));
            return note;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['payment-notes'] });
            queryClient.invalidateQueries({ queryKey: ['unpaid-livre-orders'] });
            toast({ title: 'Payment note generated', description: 'All orders have been linked to this note.' });
            setIsWizardOpen(false); setWizardStep(0); setSelectedProvider(null);
        },
        onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });

    // ─── Mark as paid ───
    const markPaidMutation = useMutation({
        mutationFn: async (note: PaymentNote) => {
            const { error: noteErr } = await (supabase as any).from('company_payment_notes').update({ status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', note.id);
            if (noteErr) throw noteErr;
            const orderIds = note.line_items.map(li => li.order_id);
            if (orderIds.length > 0 && paidStatusId) {
                const { error: ordErr } = await (supabase as any).from('orders').update({ order_status_id: paidStatusId, payed: true, updated_at: new Date().toISOString() }).in('id', orderIds);
                if (ordErr) throw ordErr;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['payment-notes'] });
            queryClient.invalidateQueries({ queryKey: ['unpaid-livre-orders'] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            toast({ title: 'Marked as paid', description: 'All linked orders changed to PAID.' });
            setIsViewNoteOpen(false); setSelectedNote(null);
        },
        onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });

    const filteredNotes = useMemo(() => {
        if (!paymentNotes) return [];
        return paymentNotes.filter((n: PaymentNote) => {
            if (filterStatus !== 'all' && n.status !== filterStatus) return false;
            if (searchQuery) { const q = searchQuery.toLowerCase(); return n.reference.toLowerCase().includes(q) || n.provider?.name?.toLowerCase().includes(q); }
            return true;
        });
    }, [paymentNotes, filterStatus, searchQuery]);

    const stats = useMemo(() => {
        const notes = paymentNotes || [];
        const unpaidNotes = notes.filter((n: PaymentNote) => n.status === 'unpaid');
        const paidNotes = notes.filter((n: PaymentNote) => n.status === 'paid');
        return {
            totalUnpaidOrders: unpaidOrders?.length || 0,
            pendingNotes: unpaidNotes.length, paidNotes: paidNotes.length,
            pendingAmount: unpaidNotes.reduce((s: number, n: PaymentNote) => s + Number(n.net_amount), 0),
            paidAmount: paidNotes.reduce((s: number, n: PaymentNote) => s + Number(n.net_amount), 0),
        };
    }, [unpaidOrders, paymentNotes]);

    const toggleExpand = (id: string) => setExpandedCards(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

    const isLoading = isLoadingUnpaid || isLoadingNotes;

    // ─── Provider Logo Component ───
    const ProviderLogo = ({ logoUrl, name, size = 'md' }: { logoUrl: string | null; name: string; size?: 'sm' | 'md' | 'lg' }) => {
        const sizeClasses = { sm: 'w-10 h-10 rounded-xl', md: 'w-14 h-14 rounded-2xl', lg: 'w-20 h-20 rounded-3xl' };
        const textSize = { sm: 'text-xs', md: 'text-sm', lg: 'text-xl' };
        if (logoUrl) {
            return (
                <div className={cn(sizeClasses[size], "bg-slate-50 border border-slate-100 p-1.5 flex items-center justify-center overflow-hidden shadow-inner")}>
                    <img src={logoUrl} alt={name} className="max-w-full max-h-full object-contain" />
                </div>
            );
        }
        return (
            <div className={cn(sizeClasses[size], "bg-brand-navy/5 flex items-center justify-center")}>
                <span className={cn("font-black text-brand-navy/40", textSize[size])}>{name?.substring(0, 2).toUpperCase()}</span>
            </div>
        );
    };

    // ─── Print helper ───
    const handlePrint = (note: PaymentNote) => {
        const w = window.open('', '_blank');
        if (!w) return;
        w.document.write(`<html><head><title>${note.reference}</title><style>
            body{font-family:Inter,system-ui,sans-serif;padding:40px;color:#3b5e5e}
            table{width:100%;border-collapse:collapse;margin:20px 0}
            th,td{border:1px solid #e2e8f0;padding:12px;text-align:left;font-size:13px}
            th{background:#f0f4f4;font-weight:700;text-transform:uppercase;font-size:10px;letter-spacing:1px;color:#3b5e5e}
            .header{margin-bottom:40px}
            .total{margin-top:24px;text-align:right;font-size:16px}
            h1{color:#3b5e5e;font-size:24px;font-weight:900}
            .badge{display:inline-block;padding:4px 14px;border-radius:20px;font-size:11px;font-weight:700}
            .unpaid{background:#fef3c7;color:#92400e}.paid{background:#d1fae5;color:#065f46}
        </style></head><body>
        <div class="header"><h1>${note.reference}</h1>
        <p style="margin:8px 0">Provider: <strong>${note.provider?.name || 'N/A'}</strong></p>
        <p>Date: ${format(new Date(note.created_at), 'dd/MM/yyyy HH:mm')}</p>
        <p>Status: <span class="badge ${note.status}">${note.status.toUpperCase()}</span></p></div>
        <table><thead><tr><th>#</th><th>Tracking Code</th><th style="text-align:right">Amount (MAD)</th><th style="text-align:right">Shipping (MAD)</th><th style="text-align:right">Net (MAD)</th></tr></thead>
        <tbody>${note.line_items.map((li, i) => `<tr><td>${i + 1}</td><td style="font-family:monospace;font-size:12px">${li.tracking_code || 'N/A'}</td><td style="text-align:right">${Number(li.amount).toFixed(2)}</td><td style="text-align:right;color:#dc2626">-${Number(li.shipping_fee).toFixed(2)}</td><td style="text-align:right;font-weight:700">${(Number(li.amount) - Number(li.shipping_fee)).toFixed(2)}</td></tr>`).join('')}</tbody></table>
        <div class="total"><p>Total Amount: <strong>${Number(note.total_amount).toFixed(2)} MAD</strong></p>
        <p>Total Shipping: <strong style="color:#dc2626">-${Number(note.total_shipping_fees).toFixed(2)} MAD</strong></p>
        <hr style="margin:12px 0;border-color:#e2e8f0"/><p style="font-size:22px">Net Payable: <strong style="color:#059669">${Number(note.net_amount).toFixed(2)} MAD</strong></p></div>
        </body></html>`);
        w.document.close();
        w.print();
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Delivery Payments</h1>
                            <p className="text-gray-500 font-light">Track and reconcile amounts owed by delivery providers.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button onClick={() => { setIsWizardOpen(true); setWizardStep(0); setSelectedProvider(null); }}
                                disabled={!providerGroups.length}
                                className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 group flex items-center gap-2">
                                <Plus className="w-5 h-5 mr-3 group-hover:rotate-90 transition-transform duration-500" /> Generate Payment Note
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: 'Unpaid Orders', value: stats.totalUnpaidOrders, icon: Package, accent: 'amber' },
                    { label: 'Pending Notes', value: stats.pendingNotes, icon: Clock, accent: 'orange' },
                    { label: 'Paid Notes', value: stats.paidNotes, icon: CheckCircle2, accent: 'emerald' },
                    { label: 'Pending Amount', value: `${stats.pendingAmount.toFixed(2)} MAD`, icon: DollarSign, accent: 'red' },
                ].map((s, i) => (
                    <Card key={i} className="group border-none bg-white/50 backdrop-blur-sm hover:shadow-xl transition-all duration-500 rounded-[24px]">
                        <CardContent className="p-5 flex items-center gap-4">
                            <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center",
                                s.accent === 'amber' ? 'bg-amber-50 text-amber-600' : s.accent === 'orange' ? 'bg-orange-50 text-orange-600' :
                                    s.accent === 'emerald' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600')}>
                                <s.icon className="w-5 h-5" />
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest">{s.label}</p>
                                <p className={cn("text-xl font-black",
                                    s.accent === 'amber' ? 'text-amber-700' : s.accent === 'orange' ? 'text-orange-700' :
                                        s.accent === 'emerald' ? 'text-emerald-700' : 'text-red-700')}>{s.value}</p>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4 items-center">
                <div className="relative w-full sm:w-96">
                    <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground/60" />
                    <Input placeholder="Search by reference or provider..."
                        value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                        className="h-14 pl-14 pr-6 rounded-[20px] border-none bg-white shadow-sm font-bold text-brand-navy placeholder:text-muted-foreground/40 focus-visible:ring-brand-navy/10" />
                </div>
                <div className="flex gap-2 bg-white/50 backdrop-blur-md p-1.5 rounded-[18px] border border-brand-navy/5 shadow-sm">
                    {(['all', 'unpaid', 'paid'] as const).map(s => (
                        <button key={s} onClick={() => setFilterStatus(s)}
                            className={cn("px-5 py-2.5 rounded-[14px] text-sm font-bold transition-all",
                                filterStatus === s ? "bg-brand-navy text-white shadow-lg" : "text-brand-navy/60 hover:bg-brand-navy/5")}>
                            {s === 'all' ? 'All Notes' : s === 'unpaid' ? 'Unpaid' : 'Paid'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Payment Notes List */}
            {isLoading ? (
                <div className="space-y-5">{[1, 2, 3].map(i => <Skeleton key={i} className="h-36 w-full rounded-[32px]" />)}</div>
            ) : filteredNotes.length === 0 ? (
                <Card className="border-none bg-white/30 backdrop-blur-sm rounded-[32px]">
                    <CardContent className="p-16 text-center">
                        <div className="w-20 h-20 rounded-3xl bg-brand-navy/5 flex items-center justify-center mx-auto mb-6">
                            <SearchX className="w-8 h-8 text-brand-navy/20" />
                        </div>
                        <h3 className="text-xl font-black text-brand-navy/40">No payment notes</h3>
                        <p className="text-sm text-muted-foreground mt-2">Generate your first payment note from unpaid delivered orders.</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-5">
                    {filteredNotes.map((note: PaymentNote) => {
                        const isExpanded = expandedCards.has(note.id);
                        const isPaid = note.status === 'paid';
                        return (
                            <Card key={note.id} className="group relative overflow-hidden border-none bg-white/50 backdrop-blur-sm hover:shadow-2xl transition-all duration-500 rounded-[32px]">
                                {/* Top accent bar */}
                                <div className={cn("absolute top-0 left-0 w-full h-1.5 transition-colors",
                                    isPaid ? "bg-emerald-500" : "bg-amber-500")} />

                                <CardContent className="p-0">
                                    <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-5">
                                        {/* Left: Provider + Info */}
                                        <div className="flex items-center gap-5 flex-1 min-w-0">
                                            <ProviderLogo logoUrl={note.provider?.logo_url || null} name={note.provider?.name || '??'} size="md" />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-3">
                                                    <h3 className="text-xl font-black text-brand-navy tracking-tight truncate">{note.reference}</h3>
                                                    <Badge className={cn("border-none font-bold text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-lg",
                                                        isPaid ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
                                                        {isPaid ? 'Paid' : 'Unpaid'}
                                                    </Badge>
                                                </div>
                                                <div className="flex items-center gap-4 text-muted-foreground mt-1.5">
                                                    <span className="flex items-center gap-1.5 text-xs font-semibold"><Building2 className="w-3.5 h-3.5" />{note.provider?.name}</span>
                                                    <span className="flex items-center gap-1.5 text-xs font-semibold"><Package className="w-3.5 h-3.5" />{note.order_count} orders</span>
                                                    <span className="flex items-center gap-1.5 text-xs font-semibold"><Clock className="w-3.5 h-3.5" />{format(new Date(note.created_at), 'dd MMM yyyy')}</span>
                                                    {isPaid && note.paid_at && <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" />Paid {format(new Date(note.paid_at), 'dd MMM')}</span>}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Right: Amount + Actions */}
                                        <div className="flex items-center gap-5">
                                            <div className="text-right">
                                                <span className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest">Net Amount</span>
                                                <p className={cn("text-2xl font-black", isPaid ? "text-emerald-600" : "text-amber-600")}>
                                                    {Number(note.net_amount).toFixed(2)} <span className="text-sm">MAD</span>
                                                </p>
                                            </div>
                                            <Separator orientation="vertical" className="h-12 bg-brand-navy/5" />
                                            <div className="flex items-center gap-1.5">
                                                <Button size="icon" variant="ghost" onClick={() => toggleExpand(note.id)}
                                                    className="rounded-xl h-10 w-10 hover:bg-slate-50">
                                                    {isExpanded ? <ChevronDown className="w-4 h-4 text-brand-navy/40" /> : <ChevronRight className="w-4 h-4 text-brand-navy/40" />}
                                                </Button>
                                                <Button size="icon" variant="ghost" onClick={() => handlePrint(note)}
                                                    className="rounded-xl h-10 w-10 hover:bg-slate-50">
                                                    <Printer className="w-4 h-4 text-brand-navy/40" />
                                                </Button>
                                                <Button size="icon" variant="ghost" onClick={() => { setSelectedNote(note); setIsViewNoteOpen(true); }}
                                                    className="rounded-xl h-10 w-10 hover:bg-slate-50">
                                                    <Eye className="w-4 h-4 text-brand-navy/40" />
                                                </Button>
                                                {!isPaid && (
                                                    <Button size="sm" onClick={() => markPaidMutation.mutate(note)}
                                                        disabled={markPaidMutation.isPending}
                                                        className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl h-10 px-4 font-bold text-xs shadow-lg shadow-emerald-200">
                                                        {markPaidMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><CreditCard className="w-3.5 h-3.5 mr-1.5" />Mark Paid</>}
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Expandable table */}
                                    {isExpanded && (
                                        <div className="border-t border-brand-navy/5 bg-slate-50/30 p-6">
                                            <table className="w-full text-sm">
                                                <thead><tr className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest border-b border-brand-navy/5">
                                                    <th className="pb-3 text-left">#</th>
                                                    <th className="pb-3 text-left">Tracking Code</th>
                                                    <th className="pb-3 text-right">Amount</th>
                                                    <th className="pb-3 text-right">Shipping</th>
                                                    <th className="pb-3 text-right">Net</th>
                                                </tr></thead>
                                                <tbody>{note.line_items.map((li, i) => (
                                                    <tr key={li.id} className="border-b border-brand-navy/[0.03] last:border-0">
                                                        <td className="py-3 text-brand-navy/30 font-bold">{i + 1}</td>
                                                        <td className="py-3 font-mono text-xs font-bold text-brand-navy">{li.tracking_code || 'N/A'}</td>
                                                        <td className="py-3 text-right font-semibold">{Number(li.amount).toFixed(2)}</td>
                                                        <td className="py-3 text-right text-red-500 font-semibold">-{Number(li.shipping_fee).toFixed(2)}</td>
                                                        <td className="py-3 text-right font-black text-brand-navy">{(Number(li.amount) - Number(li.shipping_fee)).toFixed(2)}</td>
                                                    </tr>
                                                ))}</tbody>
                                            </table>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* ─── WIZARD MODAL ─── */}
            <Dialog open={isWizardOpen} onOpenChange={v => { if (!v) { setIsWizardOpen(false); setWizardStep(0); setSelectedProvider(null); } }}>
                <DialogContent className="max-w-3xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
                    <DialogHeader className="p-10 pb-6">
                        <DialogTitle className="text-3xl font-black text-brand-navy">
                            {wizardStep === 0 ? 'Select Provider' : 'Review & Generate'}
                        </DialogTitle>
                        <DialogDescription className="text-base font-medium">
                            {wizardStep === 0 ? 'Choose a delivery provider to generate a payment note for.' : 'Review the orders and confirm generation.'}
                        </DialogDescription>
                    </DialogHeader>

                    {/* Step indicator */}
                    <div className="px-10 flex items-center gap-3 mb-2">
                        {[0, 1].map(s => (
                            <React.Fragment key={s}>
                                <div className={cn("w-10 h-10 rounded-2xl flex items-center justify-center text-sm font-black transition-all",
                                    wizardStep >= s ? "bg-brand-navy text-white shadow-lg" : "bg-brand-navy/5 text-brand-navy/30")}>
                                    {s + 1}
                                </div>
                                {s < 1 && <div className={cn("flex-1 h-1 rounded-full transition-colors", wizardStep > s ? "bg-brand-navy" : "bg-brand-navy/10")} />}
                            </React.Fragment>
                        ))}
                    </div>

                    <div className="p-10 pt-6">
                        {wizardStep === 0 && (
                            <div className="space-y-4">
                                {providerGroups.length === 0 ? (
                                    <div className="text-center py-12">
                                        <div className="w-16 h-16 rounded-3xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
                                            <AlertTriangle className="w-7 h-7 text-amber-400" />
                                        </div>
                                        <p className="text-lg font-black text-brand-navy/40">No unpaid delivered orders</p>
                                        <p className="text-sm text-muted-foreground mt-1">All orders have been accounted for.</p>
                                    </div>
                                ) : providerGroups.map(g => (
                                    <div key={g.provider_id} onClick={() => setSelectedProvider(g.provider_id)}
                                        className={cn("p-5 rounded-[24px] flex items-center justify-between cursor-pointer transition-all duration-300",
                                            selectedProvider === g.provider_id
                                                ? "bg-brand-navy/5 ring-2 ring-brand-navy shadow-lg"
                                                : "bg-white hover:bg-slate-50 border border-slate-100 hover:border-brand-navy/20")}>
                                        <div className="flex items-center gap-4">
                                            <ProviderLogo logoUrl={g.logo_url} name={g.provider_name} size="md" />
                                            <div>
                                                <h4 className="text-lg font-black text-brand-navy">{g.provider_name}</h4>
                                                <p className="text-xs font-semibold text-muted-foreground">{g.orders.length} orders · {g.total_amount.toFixed(2)} MAD total</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-lg font-black text-emerald-600">{g.net_amount.toFixed(2)} MAD</p>
                                            <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">net payable</p>
                                        </div>
                                    </div>
                                ))}
                                <div className="flex justify-end gap-3 pt-4">
                                    <Button variant="outline" onClick={() => setIsWizardOpen(false)}
                                        className="rounded-2xl h-12 px-6 font-bold border-brand-navy/10">Cancel</Button>
                                    <Button disabled={!selectedProvider} onClick={() => setWizardStep(1)}
                                        className="bg-brand-navy hover:bg-brand-navy/90 text-white rounded-2xl h-12 px-8 font-bold shadow-xl">
                                        Next <ArrowRight className="w-4 h-4 ml-2" />
                                    </Button>
                                </div>
                            </div>
                        )}

                        {wizardStep === 1 && selectedGroup && (
                            <div className="space-y-6">
                                <div className="flex items-center gap-4 p-5 bg-brand-navy/5 rounded-[24px]">
                                    <ProviderLogo logoUrl={selectedGroup.logo_url} name={selectedGroup.provider_name} size="md" />
                                    <div>
                                        <p className="text-lg font-black text-brand-navy">{selectedGroup.provider_name}</p>
                                        <p className="text-xs font-semibold text-muted-foreground">{selectedGroup.orders.length} orders to include in this note</p>
                                    </div>
                                </div>

                                <div className="overflow-x-auto border border-brand-navy/5 rounded-[20px]">
                                    <table className="w-full text-sm">
                                        <thead><tr className="bg-slate-50/50 text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest">
                                            <th className="p-4 text-left">#</th><th className="p-4 text-left">Customer</th>
                                            <th className="p-4 text-left">Tracking</th><th className="p-4 text-right">Amount</th>
                                            <th className="p-4 text-right">Shipping</th><th className="p-4 text-right">Net</th>
                                        </tr></thead>
                                        <tbody>{selectedGroup.orders.map((o, i) => (
                                            <tr key={o.id} className="border-t border-brand-navy/[0.03] hover:bg-slate-50/30 transition-colors">
                                                <td className="p-4 text-brand-navy/30 font-bold">{i + 1}</td>
                                                <td className="p-4 font-bold text-brand-navy">{o.name}</td>
                                                <td className="p-4 font-mono text-xs font-semibold">{o.parcels?.[0]?.tracking_code || o.tracking_number || 'N/A'}</td>
                                                <td className="p-4 text-right font-semibold">{Number(o.price || 0).toFixed(2)}</td>
                                                <td className="p-4 text-right text-red-500 font-semibold">-{Number(o.shipping_cost || 0).toFixed(2)}</td>
                                                <td className="p-4 text-right font-black text-brand-navy">{(Number(o.price || 0) - Number(o.shipping_cost || 0)).toFixed(2)}</td>
                                            </tr>
                                        ))}</tbody>
                                    </table>
                                </div>

                                {/* Totals summary */}
                                <div className="bg-brand-navy rounded-[24px] p-6 text-white">
                                    <div className="grid grid-cols-3 gap-6 text-center">
                                        <div><span className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1">Total Amount</span>
                                            <span className="text-xl font-black">{selectedGroup.total_amount.toFixed(2)}</span></div>
                                        <div><span className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1">Shipping Fees</span>
                                            <span className="text-xl font-black text-red-300">-{selectedGroup.total_shipping.toFixed(2)}</span></div>
                                        <div><span className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1">Net Payable</span>
                                            <span className="text-xl font-black text-emerald-300">{selectedGroup.net_amount.toFixed(2)}</span></div>
                                    </div>
                                </div>

                                <div className="flex justify-end gap-3">
                                    <Button variant="outline" onClick={() => setWizardStep(0)}
                                        className="rounded-2xl h-12 px-6 font-bold border-brand-navy/10">Back</Button>
                                    <Button onClick={() => generateNoteMutation.mutate(selectedGroup)}
                                        disabled={generateNoteMutation.isPending}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl h-12 px-8 font-bold shadow-xl shadow-emerald-200">
                                        {generateNoteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FileText className="w-4 h-4 mr-2" />}
                                        Generate Note
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* ─── VIEW NOTE MODAL ─── */}
            <Dialog open={isViewNoteOpen} onOpenChange={v => { if (!v) { setIsViewNoteOpen(false); setSelectedNote(null); } }}>
                <DialogContent className="max-w-2xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
                    {selectedNote && (
                        <>
                            <DialogHeader className="p-10 pb-6">
                                <div className="flex items-center gap-4">
                                    <ProviderLogo logoUrl={selectedNote.provider?.logo_url || null} name={selectedNote.provider?.name || '??'} size="lg" />
                                    <div>
                                        <DialogTitle className="text-2xl font-black text-brand-navy">{selectedNote.reference}</DialogTitle>
                                        <div className="flex items-center gap-2 mt-1">
                                            <Badge className={cn("border-none font-bold text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-lg",
                                                selectedNote.status === 'paid' ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
                                                {selectedNote.status.toUpperCase()}
                                            </Badge>
                                            <span className="text-xs font-semibold text-muted-foreground">{selectedNote.provider?.name}</span>
                                        </div>
                                    </div>
                                </div>
                            </DialogHeader>

                            <div className="px-10 pb-10 space-y-6">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-4 rounded-2xl bg-brand-navy/[0.03] border border-brand-navy/5">
                                        <span className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest">Created</span>
                                        <p className="font-bold text-brand-navy mt-1">{format(new Date(selectedNote.created_at), 'dd MMM yyyy, HH:mm')}</p>
                                    </div>
                                    {selectedNote.paid_at && (
                                        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100">
                                            <span className="text-[10px] font-black text-emerald-600/60 uppercase tracking-widest">Paid</span>
                                            <p className="font-bold text-emerald-700 mt-1">{format(new Date(selectedNote.paid_at), 'dd MMM yyyy, HH:mm')}</p>
                                        </div>
                                    )}
                                </div>

                                <div className="overflow-x-auto border border-brand-navy/5 rounded-[20px]">
                                    <table className="w-full text-sm">
                                        <thead><tr className="bg-slate-50/50 text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest">
                                            <th className="p-4 text-left">#</th><th className="p-4 text-left">Tracking</th>
                                            <th className="p-4 text-right">Amount</th><th className="p-4 text-right">Shipping</th>
                                            <th className="p-4 text-right">Net</th>
                                        </tr></thead>
                                        <tbody>{selectedNote.line_items.map((li, i) => (
                                            <tr key={li.id} className="border-t border-brand-navy/[0.03]">
                                                <td className="p-4 text-brand-navy/30 font-bold">{i + 1}</td>
                                                <td className="p-4 font-mono text-xs font-semibold">{li.tracking_code || 'N/A'}</td>
                                                <td className="p-4 text-right font-semibold">{Number(li.amount).toFixed(2)}</td>
                                                <td className="p-4 text-right text-red-500 font-semibold">-{Number(li.shipping_fee).toFixed(2)}</td>
                                                <td className="p-4 text-right font-black text-brand-navy">{(Number(li.amount) - Number(li.shipping_fee)).toFixed(2)}</td>
                                            </tr>
                                        ))}</tbody>
                                    </table>
                                </div>

                                <div className="bg-brand-navy rounded-[24px] p-6 text-white grid grid-cols-3 gap-6 text-center">
                                    <div><span className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1">Total</span><span className="text-xl font-black">{Number(selectedNote.total_amount).toFixed(2)}</span></div>
                                    <div><span className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1">Shipping</span><span className="text-xl font-black text-red-300">-{Number(selectedNote.total_shipping_fees).toFixed(2)}</span></div>
                                    <div><span className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1">Net</span><span className="text-xl font-black text-emerald-300">{Number(selectedNote.net_amount).toFixed(2)}</span></div>
                                </div>

                                <div className="flex justify-end gap-3">
                                    <Button variant="outline" onClick={() => handlePrint(selectedNote)}
                                        className="rounded-2xl h-12 px-6 font-bold border-brand-navy/10">
                                        <Printer className="w-4 h-4 mr-2" />Print
                                    </Button>
                                    {selectedNote.status === 'unpaid' && (
                                        <Button onClick={() => markPaidMutation.mutate(selectedNote)}
                                            disabled={markPaidMutation.isPending}
                                            className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl h-12 px-8 font-bold shadow-xl shadow-emerald-200">
                                            {markPaidMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CreditCard className="w-4 h-4 mr-2" />}
                                            Mark as Paid
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default Payments;
