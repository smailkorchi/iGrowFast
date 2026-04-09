import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus, Search, Loader2, Package, DollarSign, Eye, FileText,
    CheckCircle2, Clock, Building2, CreditCard, AlertTriangle,
    ChevronDown, ChevronRight, Printer, ArrowRight, SearchX, Truck
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';

interface UnpaidOrder {
    id: string; name: string; phone: string; price: number; shipping_cost: number;
    tracking_number: string | null;
    company_id: string | null; courier_id: string | null;
    payment_delivery_id: string | null;
    current_courier_payment_note_id: string | null;
    parcels: { tracking_code: string | null; provider: { id: string; name: string; logo_url: string | null } | null }[];
    courier_parcels: { tracking_code: string | null }[];
    company: { id: string; name: string; logo_url: string | null } | null;
    courier: { id: string; name: string; avatar_url: string | null } | null;
    items: { quantity: number; unit_price: number; product: { name: string } | null }[];
}

interface TargetGroup {
    kind: 'company' | 'courier';
    target_id: string;
    target_name: string;
    logo_url: string | null;
    avatar_url: string | null;
    orders: UnpaidOrder[];
    total_amount: number;
    total_shipping: number;
    net_amount: number;
}

interface PaymentNote {
    kind: 'company' | 'courier';
    id: string; reference: string; status: string; total_amount: number;
    total_shipping_fees: number; net_amount: number; order_count: number;
    paid_at: string | null; note: string | null; created_at: string;
    provider: { id: string; name: string; logo_url: string | null } | null;
    courier?: { id: string; name: string; avatar_url: string | null } | null;
    line_items: { id: string; order_id: string; tracking_code: string | null; amount: number; shipping_fee: number }[];
}

const Payments = () => {
    const { getOrderByCategory, getPkgByCategory } = useStatusCategories();
    const unpaidStatusId = getOrderByCategory('unpaid')?.id;
    const paidStatusId = getOrderByCategory('paid')?.id;
    const deliveredPkgId = getPkgByCategory('delivered')?.id;

    const [activeTab, setActiveTab] = useState<'company' | 'courier'>('company');
    const [isWizardOpen, setIsWizardOpen] = useState(false);
    const [wizardStep, setWizardStep] = useState(0);
    const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
    const [isViewNoteOpen, setIsViewNoteOpen] = useState(false);
    const [selectedNote, setSelectedNote] = useState<PaymentNote | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'unpaid' | 'paid'>('all');
    const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // ─── Fetch unpaid+livré orders (exclude those already linked to a payment note, company or courier) ───
    const { data: unpaidOrders, isLoading: isLoadingUnpaid } = useQuery({
        queryKey: ['unpaid-livre-orders', activeBusinessId, unpaidStatusId, deliveredPkgId],
        queryFn: async () => {
            if (!activeBusinessId || !unpaidStatusId || !deliveredPkgId) return [];
            const { data, error } = await (supabase as any)
                .from('orders')
                .select(`*,
                    company:providers(id, name, logo_url),
                    courier:users!orders_courier_id_fkey(id, name, avatar_url),
                    items:order_items(quantity, unit_price, product:products(name)),
                    parcels:company_parcels(tracking_code, provider:providers(id, name, logo_url)),
                    courier_parcels(tracking_code)`)
                .eq('DigiCom Business', activeBusinessId)
                .eq('order_status_id', unpaidStatusId)
                .eq('package_status_id', deliveredPkgId)
                .is('payment_delivery_id', null)
                .is('current_courier_payment_note_id', null)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (data || []) as UnpaidOrder[];
        },
        enabled: !!unpaidStatusId && !!deliveredPkgId,
    });

    // ─── Fetch payment notes (company + courier) ───
    const { data: paymentNotes, isLoading: isLoadingNotes } = useQuery({
        queryKey: ['payment-notes', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const [companyRes, courierRes] = await Promise.all([
                (supabase as any)
                    .from('company_payment_notes')
                    .select(`*, provider:providers(id, name, logo_url), line_items:company_payment_note_orders(id, order_id, tracking_code, amount, shipping_fee)`)
                    .eq('DigiCom Business', activeBusinessId)
                    .order('created_at', { ascending: false }),
                (supabase as any)
                    .from('courier_payment_notes')
                    .select(`*, courier:users!courier_payment_notes_courier_id_fkey(id, name, avatar_url), line_items:courier_payment_note_orders(id, order_id, tracking_code, amount, shipping_fee)`)
                    .eq('DigiCom Business', activeBusinessId)
                    .order('created_at', { ascending: false }),
            ]);
            if (companyRes.error) throw companyRes.error;
            if (courierRes.error) throw courierRes.error;
            const companyNotes = (companyRes.data || []).map((n: any) => ({ ...n, kind: 'company' as const }));
            const courierNotes = (courierRes.data || []).map((n: any) => ({ ...n, kind: 'courier' as const, provider: null }));
            return [...companyNotes, ...courierNotes] as PaymentNote[];
        },
    });

    // ─── Group unpaid orders by kind ───
    const { companyGroups, courierGroups } = useMemo(() => {
        const companyMap = new Map<string, TargetGroup>();
        const courierMap = new Map<string, TargetGroup>();
        for (const order of unpaidOrders || []) {
            const isCourierOrder = !order.company_id && !!order.courier_id;
            if (isCourierOrder) {
                const id = order.courier?.id || 'unknown';
                if (!courierMap.has(id)) {
                    courierMap.set(id, {
                        kind: 'courier',
                        target_id: id,
                        target_name: order.courier?.name || 'Unknown courier',
                        logo_url: null,
                        avatar_url: order.courier?.avatar_url || null,
                        orders: [],
                        total_amount: 0,
                        total_shipping: 0,
                        net_amount: 0,
                    });
                }
                const group = courierMap.get(id)!;
                group.orders.push(order);
                const amount = Number(order.price || 0);
                const shipping = Number(order.shipping_cost || 0);
                group.total_amount = +(group.total_amount + amount).toFixed(2);
                group.total_shipping = +(group.total_shipping + shipping).toFixed(2);
                group.net_amount = +(group.total_amount - group.total_shipping).toFixed(2);
            } else {
                const providerId = order.company?.id || order.parcels?.[0]?.provider?.id || 'unknown';
                const providerName = order.company?.name || order.parcels?.[0]?.provider?.name || 'Unknown';
                const logoUrl = order.company?.logo_url || order.parcels?.[0]?.provider?.logo_url || null;
                if (!companyMap.has(providerId)) {
                    companyMap.set(providerId, {
                        kind: 'company',
                        target_id: providerId,
                        target_name: providerName,
                        logo_url: logoUrl,
                        avatar_url: null,
                        orders: [],
                        total_amount: 0,
                        total_shipping: 0,
                        net_amount: 0,
                    });
                }
                const group = companyMap.get(providerId)!;
                group.orders.push(order);
                const amount = Number(order.price || 0);
                const shipping = Number(order.shipping_cost || 0);
                group.total_amount = +(group.total_amount + amount).toFixed(2);
                group.total_shipping = +(group.total_shipping + shipping).toFixed(2);
                group.net_amount = +(group.total_amount - group.total_shipping).toFixed(2);
            }
        }
        return {
            companyGroups: Array.from(companyMap.values()),
            courierGroups: Array.from(courierMap.values()),
        };
    }, [unpaidOrders]);

    const activeGroups = activeTab === 'courier' ? courierGroups : companyGroups;
    const selectedGroup = activeGroups.find(g => g.target_id === selectedTarget);

    // ─── Generate payment note (company or courier) ───
    const generateNoteMutation = useMutation({
        mutationFn: async (group: TargetGroup) => {
            const { data: { session } } = await supabase.auth.getSession();
            const isCourier = group.kind === 'courier';
            const ref = `PAY-${isCourier ? 'CR' : group.target_name.substring(0, 3).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
            const notesTable = isCourier ? 'courier_payment_notes' : 'company_payment_notes';
            const lineItemsTable = isCourier ? 'courier_payment_note_orders' : 'company_payment_note_orders';
            const orderLinkField = isCourier ? 'current_courier_payment_note_id' : 'payment_delivery_id';

            // Recalculate totals from source data (trust DB values not state)
            const total_amount = group.orders.reduce((s, o) => s + Number(o.price || 0), 0);
            const total_shipping = group.orders.reduce((s, o) => s + Number(o.shipping_cost || 0), 0);
            const net_amount = total_amount - total_shipping;

            const insertPayload: any = {
                reference: ref,
                status: 'unpaid',
                total_amount: +total_amount.toFixed(2),
                total_shipping_fees: +total_shipping.toFixed(2),
                net_amount: +net_amount.toFixed(2),
                order_count: group.orders.length,
                'DigiCom Business': activeBusinessId,
            };
            if (isCourier) {
                insertPayload.courier_id = group.target_id;
                insertPayload.created_by = session?.user?.id ?? null;
            } else {
                insertPayload.provider_id = group.target_id;
            }

            // Step 1: create header
            const { data: note, error: noteError } = await (supabase as any)
                .from(notesTable)
                .insert(insertPayload)
                .select()
                .single();
            if (noteError) throw noteError;

            // Step 2: line items (rollback on failure)
            const lineItems = group.orders.map(o => ({
                payment_note_id: note.id,
                order_id: o.id,
                tracking_code: isCourier
                    ? (o.courier_parcels?.[0]?.tracking_code || o.tracking_number || null)
                    : (o.parcels?.[0]?.tracking_code || o.tracking_number || null),
                amount: +Number(o.price || 0).toFixed(2),
                shipping_fee: +Number(o.shipping_cost || 0).toFixed(2),
                'DigiCom Business': activeBusinessId,
            }));
            const { error: itemsError } = await (supabase as any).from(lineItemsTable).insert(lineItems);
            if (itemsError) {
                await (supabase as any).from(notesTable).delete().eq('id', note.id);
                throw itemsError;
            }

            // Step 3: stamp orders
            const orderIds = group.orders.map(o => o.id);
            const { error: ordersError } = await (supabase as any)
                .from('orders')
                .update({ [orderLinkField]: note.id, updated_at: new Date().toISOString() })
                .in('id', orderIds);
            if (ordersError) {
                await (supabase as any).from(lineItemsTable).delete().eq('payment_note_id', note.id);
                await (supabase as any).from(notesTable).delete().eq('id', note.id);
                throw ordersError;
            }

            return note;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['payment-notes'] });
            queryClient.invalidateQueries({ queryKey: ['unpaid-livre-orders'] });
            toast({ title: 'Payment note generated', description: 'All orders have been linked to this note.' });
            setIsWizardOpen(false); setWizardStep(0); setSelectedTarget(null);
        },
        onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });

    // ─── Mark as paid (company or courier) ───
    const markPaidMutation = useMutation({
        mutationFn: async (note: PaymentNote) => {
            const notesTable = note.kind === 'courier' ? 'courier_payment_notes' : 'company_payment_notes';
            const { error: noteErr } = await (supabase as any)
                .from(notesTable)
                .update({ status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                .eq('id', note.id);
            if (noteErr) throw noteErr;
            const orderIds = note.line_items.map(li => li.order_id);
            if (orderIds.length > 0 && paidStatusId) {
                const { error: ordErr } = await (supabase as any)
                    .from('orders')
                    .update({ order_status_id: paidStatusId, payed: true, updated_at: new Date().toISOString() })
                    .in('id', orderIds);
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

    const notesForActiveTab = useMemo(() => {
        return (paymentNotes || []).filter((n: PaymentNote) => n.kind === activeTab);
    }, [paymentNotes, activeTab]);

    const filteredNotes = useMemo(() => {
        return notesForActiveTab.filter((n: PaymentNote) => {
            if (filterStatus !== 'all' && n.status !== filterStatus) return false;
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                return (
                    n.reference.toLowerCase().includes(q) ||
                    (n.provider?.name || '').toLowerCase().includes(q) ||
                    (n.courier?.name || '').toLowerCase().includes(q)
                );
            }
            return true;
        });
    }, [notesForActiveTab, filterStatus, searchQuery]);

    const stats = useMemo(() => {
        const notes = notesForActiveTab;
        const unpaidNotes = notes.filter((n: PaymentNote) => n.status === 'unpaid');
        const paidNotes = notes.filter((n: PaymentNote) => n.status === 'paid');
        const activeUnpaidCount = activeTab === 'courier'
            ? courierGroups.reduce((s, g) => s + g.orders.length, 0)
            : companyGroups.reduce((s, g) => s + g.orders.length, 0);
        return {
            totalUnpaidOrders: activeUnpaidCount,
            pendingNotes: unpaidNotes.length,
            paidNotes: paidNotes.length,
            pendingAmount: unpaidNotes.reduce((s: number, n: PaymentNote) => s + Number(n.net_amount), 0),
            paidAmount: paidNotes.reduce((s: number, n: PaymentNote) => s + Number(n.net_amount), 0),
        };
    }, [notesForActiveTab, companyGroups, courierGroups, activeTab]);

    const toggleExpand = (id: string) => setExpandedCards(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    const isLoading = isLoadingUnpaid || isLoadingNotes;

    // ─── Unified target avatar (company logo OR courier user photo) ───
    const EntityLogo = ({
        kind,
        logoUrl,
        avatarUrl,
        name,
        size = 'md',
    }: {
        kind: 'company' | 'courier';
        logoUrl?: string | null;
        avatarUrl?: string | null;
        name: string;
        size?: 'sm' | 'md' | 'lg';
    }) => {
        const sizeClasses = { sm: 'w-10 h-10 rounded-xl', md: 'w-14 h-14 rounded-2xl', lg: 'w-20 h-20 rounded-3xl' };
        const textSize = { sm: 'text-xs', md: 'text-sm', lg: 'text-xl' };
        if (kind === 'company' && logoUrl) {
            return (
                <div className={cn(sizeClasses[size], "bg-slate-50 border border-slate-100 p-1.5 flex items-center justify-center overflow-hidden shadow-inner")}>
                    <img src={logoUrl} alt={name} className="max-w-full max-h-full object-contain" />
                </div>
            );
        }
        if (kind === 'courier' && avatarUrl) {
            return (
                <div className={cn(sizeClasses[size], "overflow-hidden border border-slate-100 shadow-inner")}>
                    <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
                </div>
            );
        }
        return (
            <div className={cn(sizeClasses[size], kind === 'courier' ? 'bg-brand-navy/10 text-brand-navy' : 'bg-brand-navy/5 text-brand-navy/40', 'flex items-center justify-center')}>
                <span className={cn("font-black", textSize[size])}>{name?.substring(0, 2).toUpperCase()}</span>
            </div>
        );
    };

    // ─── Premium print helper ───
    const handlePrint = async (note: PaymentNote) => {
        const w = window.open('', '_blank');
        if (!w) return;
        w.document.write('<!doctype html><html><head><title>' + note.reference + '</title></head><body style="font-family:system-ui;padding:40px;color:#3b5e5e">Loading…</body></html>');
        w.document.close();

        let businessName = 'DigiCom';
        let businessLogo: string | null = null;
        if (activeBusinessId) {
            const { data } = await (supabase as any).from('businesses').select('name, logo').eq('id', activeBusinessId).single();
            if (data) { businessName = data.name || businessName; businessLogo = data.logo || null; }
        }

        const entityName = note.kind === 'courier' ? (note.courier?.name || 'Unknown courier') : (note.provider?.name || 'Unknown provider');
        const entityImage = note.kind === 'courier' ? (note.courier?.avatar_url || null) : (note.provider?.logo_url || null);
        const entityLabel = note.kind === 'courier' ? 'Courier Agent' : 'Provider';
        const createdAt = format(new Date(note.created_at), 'dd MMM yyyy • HH:mm');

        const rows = note.line_items.map((li, i) => `
            <tr>
                <td class="num">${String(i + 1).padStart(2, '0')}</td>
                <td class="track">${li.tracking_code || '—'}</td>
                <td class="right">${Number(li.amount).toFixed(2)}</td>
                <td class="right red">-${Number(li.shipping_fee).toFixed(2)}</td>
                <td class="right bold">${(Number(li.amount) - Number(li.shipping_fee)).toFixed(2)}</td>
            </tr>`).join('');

        const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${note.reference}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  html, body { margin: 0; padding: 0; background: #fff; color: #3b5e5e; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; font-feature-settings: "ss01","cv11"; }
  .sheet { padding: 22mm 18mm; min-height: 297mm; display: flex; flex-direction: column; }
  .hdr { display: flex; align-items: flex-start; justify-content: space-between; padding-bottom: 28px; border-bottom: 1px solid #eef1ee; }
  .brand { display: flex; align-items: center; gap: 16px; }
  .brand .logo { width: 56px; height: 56px; border-radius: 16px; background: #f6f7f3; border: 1px solid #eef1ee; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .brand .logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .brand .logo.fallback { background: #3b5e5e; color: #daddcc; font-weight: 900; font-size: 18px; letter-spacing: 0.5px; }
  .brand .name { font-size: 18px; font-weight: 800; color: #3b5e5e; letter-spacing: -0.3px; line-height: 1; }
  .brand .sub { font-size: 9px; font-weight: 700; color: #9aa6a0; text-transform: uppercase; letter-spacing: 2.5px; margin-top: 6px; }
  .meta { text-align: right; }
  .meta .kicker { font-size: 9px; font-weight: 800; color: #3b5e5e; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 6px; opacity: 0.55; }
  .meta h1 { margin: 0; font-size: 26px; font-weight: 900; color: #3b5e5e; font-family: "SF Mono", Menlo, monospace; letter-spacing: -0.5px; }
  .meta .date { font-size: 11px; color: #9aa6a0; margin-top: 6px; font-weight: 500; }
  .entity { margin-top: 32px; display: flex; align-items: center; gap: 18px; padding: 20px 22px; background: #f9faf7; border: 1px solid #eef1ee; border-radius: 20px; }
  .entity .ava { width: 60px; height: 60px; border-radius: 18px; overflow: hidden; background: #fff; border: 1px solid #eef1ee; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .entity .ava img { width: 100%; height: 100%; object-fit: ${note.kind === 'courier' ? 'cover' : 'contain'}; padding: ${note.kind === 'courier' ? '0' : '6px'}; }
  .entity .ava.fallback { background: ${note.kind === 'courier' ? '#3b5e5e' : '#f6f7f3'}; color: ${note.kind === 'courier' ? '#daddcc' : '#3b5e5e'}; font-weight: 900; font-size: 18px; }
  .entity .info .label { font-size: 9px; font-weight: 800; color: #9aa6a0; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 4px; }
  .entity .info .val { font-size: 20px; font-weight: 800; color: #3b5e5e; letter-spacing: -0.3px; }
  .entity .badge { margin-left: auto; padding: 8px 16px; border-radius: 999px; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; }
  .entity .badge.unpaid { background: #fef3c7; color: #92400e; }
  .entity .badge.paid { background: #d1fae5; color: #065f46; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 22px; }
  .stat { padding: 18px 20px; background: #fff; border: 1px solid #eef1ee; border-radius: 18px; }
  .stat .k { font-size: 9px; font-weight: 800; color: #9aa6a0; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 6px; }
  .stat .v { font-size: 18px; font-weight: 900; color: #3b5e5e; font-variant-numeric: tabular-nums; }
  .stat .v.red { color: #c93942; }
  .stat .v.green { color: #059669; }
  table { width: 100%; border-collapse: collapse; margin-top: 28px; font-variant-numeric: tabular-nums; }
  thead th { text-align: left; padding: 12px 14px; font-size: 9px; font-weight: 800; color: #9aa6a0; text-transform: uppercase; letter-spacing: 1.5px; border-bottom: 1px solid #eef1ee; }
  thead th.right { text-align: right; }
  tbody td { padding: 14px; font-size: 12px; border-bottom: 1px solid #f4f6f2; color: #3b5e5e; }
  tbody tr:last-child td { border-bottom: none; }
  td.num { font-family: "SF Mono", Menlo, monospace; font-size: 10px; color: #9aa6a0; font-weight: 700; width: 40px; }
  td.track { font-family: "SF Mono", Menlo, monospace; font-size: 11px; font-weight: 700; letter-spacing: -0.3px; }
  td.right { text-align: right; }
  td.red { color: #c93942; font-weight: 600; }
  td.bold { font-weight: 800; }
  .totals { margin-top: 24px; padding: 24px; background: #3b5e5e; color: #fff; border-radius: 20px; display: flex; justify-content: space-between; align-items: center; }
  .totals .col .lbl { font-size: 9px; font-weight: 800; color: rgba(255,255,255,0.55); text-transform: uppercase; letter-spacing: 2px; margin-bottom: 6px; }
  .totals .col .val { font-size: 18px; font-weight: 900; font-variant-numeric: tabular-nums; }
  .totals .col.net .lbl { color: rgba(167, 243, 208, 0.75); }
  .totals .col.net .val { font-size: 28px; color: #a7f3d0; }
  .totals .divider { width: 1px; height: 48px; background: rgba(255,255,255,0.12); }
  .foot { margin-top: auto; padding-top: 24px; border-top: 1px solid #eef1ee; display: flex; justify-content: space-between; font-size: 9px; color: #9aa6a0; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px; }
</style></head><body>
<div class="sheet">
  <div class="hdr">
    <div class="brand">
      ${businessLogo ? `<div class="logo"><img src="${businessLogo}" alt=""/></div>` : `<div class="logo fallback">${businessName.substring(0, 2).toUpperCase()}</div>`}
      <div>
        <div class="name">${businessName}</div>
        <div class="sub">Payment Note</div>
      </div>
    </div>
    <div class="meta">
      <div class="kicker">Document</div>
      <h1>${note.reference}</h1>
      <div class="date">${createdAt}</div>
    </div>
  </div>

  <div class="entity">
    ${entityImage
                ? `<div class="ava"><img src="${entityImage}" alt=""/></div>`
                : `<div class="ava fallback">${entityName.substring(0, 2).toUpperCase()}</div>`}
    <div class="info">
      <div class="label">${entityLabel}</div>
      <div class="val">${entityName}</div>
    </div>
    <span class="badge ${note.status}">${note.status}</span>
  </div>

  <div class="stats">
    <div class="stat"><div class="k">Orders</div><div class="v">${note.order_count}</div></div>
    <div class="stat"><div class="k">Gross Collected</div><div class="v">${Number(note.total_amount).toFixed(2)} MAD</div></div>
    <div class="stat"><div class="k">Shipping Fees</div><div class="v red">-${Number(note.total_shipping_fees).toFixed(2)} MAD</div></div>
  </div>

  <table>
    <thead><tr><th>#</th><th>Tracking</th><th class="right">Amount</th><th class="right">Fee</th><th class="right">Net</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div class="col"><div class="lbl">Gross</div><div class="val">${Number(note.total_amount).toFixed(2)} MAD</div></div>
    <div class="divider"></div>
    <div class="col"><div class="lbl">Shipping Fees</div><div class="val">-${Number(note.total_shipping_fees).toFixed(2)} MAD</div></div>
    <div class="divider"></div>
    <div class="col net"><div class="lbl">Net Payable</div><div class="val">${Number(note.net_amount).toFixed(2)} MAD</div></div>
  </div>

  <div class="foot">
    <span>${businessName} • Payment Note</span>
    <span>${note.reference}</span>
  </div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},120);};</script>
</body></html>`;

        w.document.open();
        w.document.write(html);
        w.document.close();
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
                            <p className="text-gray-500 font-light">Track and reconcile amounts owed by providers and courier agents.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button onClick={() => { setIsWizardOpen(true); setWizardStep(0); setSelectedTarget(null); }}
                                disabled={!activeGroups.length}
                                className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 group flex items-center gap-2">
                                <Plus className="w-5 h-5 mr-3 group-hover:rotate-90 transition-transform duration-500" /> Generate Payment Note
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as 'company' | 'courier'); setSelectedTarget(null); }}>
                <TabsList className="bg-white/50 backdrop-blur-md p-1.5 rounded-[18px] border border-brand-navy/5 shadow-sm h-auto">
                    <TabsTrigger value="company" className="rounded-[14px] px-6 py-2.5 text-sm font-bold data-[state=active]:bg-brand-navy data-[state=active]:text-white data-[state=active]:shadow-lg text-brand-navy/60">
                        <Building2 className="w-4 h-4 mr-2" /> Companies
                    </TabsTrigger>
                    <TabsTrigger value="courier" className="rounded-[14px] px-6 py-2.5 text-sm font-bold data-[state=active]:bg-brand-navy data-[state=active]:text-white data-[state=active]:shadow-lg text-brand-navy/60">
                        <Truck className="w-4 h-4 mr-2" /> Couriers
                    </TabsTrigger>
                </TabsList>
            </Tabs>

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
                    <Input placeholder={activeTab === 'courier' ? "Search by reference or courier..." : "Search by reference or provider..."}
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
                        const targetName = note.kind === 'courier' ? (note.courier?.name || '??') : (note.provider?.name || '??');
                        return (
                            <Card key={note.id} className="group relative overflow-hidden border-none bg-white/50 backdrop-blur-sm hover:shadow-2xl transition-all duration-500 rounded-[32px]">
                                <div className={cn("absolute top-0 left-0 w-full h-1.5 transition-colors", isPaid ? "bg-emerald-500" : "bg-amber-500")} />

                                <CardContent className="p-0">
                                    <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-5">
                                        <div className="flex items-center gap-5 flex-1 min-w-0">
                                            <EntityLogo kind={note.kind} logoUrl={note.provider?.logo_url || null} avatarUrl={note.courier?.avatar_url || null} name={targetName} size="md" />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-3">
                                                    <h3 className="text-xl font-black text-brand-navy tracking-tight truncate">{note.reference}</h3>
                                                    <Badge className={cn("border-none font-bold text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-lg",
                                                        isPaid ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
                                                        {isPaid ? 'Paid' : 'Unpaid'}
                                                    </Badge>
                                                </div>
                                                <div className="flex items-center gap-4 text-muted-foreground mt-1.5">
                                                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                                                        {note.kind === 'courier' ? <Truck className="w-3.5 h-3.5" /> : <Building2 className="w-3.5 h-3.5" />}
                                                        {targetName}
                                                    </span>
                                                    <span className="flex items-center gap-1.5 text-xs font-semibold"><Package className="w-3.5 h-3.5" />{note.order_count} orders</span>
                                                    <span className="flex items-center gap-1.5 text-xs font-semibold"><Clock className="w-3.5 h-3.5" />{format(new Date(note.created_at), 'dd MMM yyyy')}</span>
                                                    {isPaid && note.paid_at && <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" />Paid {format(new Date(note.paid_at), 'dd MMM')}</span>}
                                                </div>
                                            </div>
                                        </div>

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
            <Dialog open={isWizardOpen} onOpenChange={v => { if (!v) { setIsWizardOpen(false); setWizardStep(0); setSelectedTarget(null); } }}>
                <DialogContent className="max-w-3xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
                    <DialogHeader className="p-10 pb-6">
                        <DialogTitle className="text-3xl font-black text-brand-navy">
                            {wizardStep === 0 ? (activeTab === 'courier' ? 'Select Courier' : 'Select Provider') : 'Review & Generate'}
                        </DialogTitle>
                        <DialogDescription className="text-base font-medium">
                            {wizardStep === 0 ? `Choose a ${activeTab === 'courier' ? 'courier agent' : 'delivery provider'} to generate a payment note for.` : 'Review the orders and confirm generation.'}
                        </DialogDescription>
                    </DialogHeader>

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
                                {activeGroups.length === 0 ? (
                                    <div className="text-center py-12">
                                        <div className="w-16 h-16 rounded-3xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
                                            <AlertTriangle className="w-7 h-7 text-amber-400" />
                                        </div>
                                        <p className="text-lg font-black text-brand-navy/40">No unpaid delivered orders</p>
                                        <p className="text-sm text-muted-foreground mt-1">All orders have been accounted for.</p>
                                    </div>
                                ) : activeGroups.map(g => (
                                    <div key={g.target_id} onClick={() => setSelectedTarget(g.target_id)}
                                        className={cn("p-5 rounded-[24px] flex items-center justify-between cursor-pointer transition-all duration-300",
                                            selectedTarget === g.target_id
                                                ? "bg-brand-navy/5 ring-2 ring-brand-navy shadow-lg"
                                                : "bg-white hover:bg-slate-50 border border-slate-100 hover:border-brand-navy/20")}>
                                        <div className="flex items-center gap-4">
                                            <EntityLogo kind={g.kind} logoUrl={g.logo_url} avatarUrl={g.avatar_url} name={g.target_name} size="md" />
                                            <div>
                                                <h4 className="text-lg font-black text-brand-navy">{g.target_name}</h4>
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
                                    <Button disabled={!selectedTarget} onClick={() => setWizardStep(1)}
                                        className="bg-brand-navy hover:bg-brand-navy/90 text-white rounded-2xl h-12 px-8 font-bold shadow-xl">
                                        Next <ArrowRight className="w-4 h-4 ml-2" />
                                    </Button>
                                </div>
                            </div>
                        )}

                        {wizardStep === 1 && selectedGroup && (
                            <div className="space-y-6">
                                <div className="flex items-center gap-4 p-5 bg-brand-navy/5 rounded-[24px]">
                                    <EntityLogo kind={selectedGroup.kind} logoUrl={selectedGroup.logo_url} avatarUrl={selectedGroup.avatar_url} name={selectedGroup.target_name} size="md" />
                                    <div>
                                        <p className="text-lg font-black text-brand-navy">{selectedGroup.target_name}</p>
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
                                        <tbody>{selectedGroup.orders.map((o, i) => {
                                            const trackingCode = selectedGroup.kind === 'courier'
                                                ? (o.courier_parcels?.[0]?.tracking_code || o.tracking_number || 'N/A')
                                                : (o.parcels?.[0]?.tracking_code || o.tracking_number || 'N/A');
                                            return (
                                                <tr key={o.id} className="border-t border-brand-navy/[0.03] hover:bg-slate-50/30 transition-colors">
                                                    <td className="p-4 text-brand-navy/30 font-bold">{i + 1}</td>
                                                    <td className="p-4 font-bold text-brand-navy">{o.name}</td>
                                                    <td className="p-4 font-mono text-xs font-semibold">{trackingCode}</td>
                                                    <td className="p-4 text-right font-semibold">{Number(o.price || 0).toFixed(2)}</td>
                                                    <td className="p-4 text-right text-red-500 font-semibold">-{Number(o.shipping_cost || 0).toFixed(2)}</td>
                                                    <td className="p-4 text-right font-black text-brand-navy">{(Number(o.price || 0) - Number(o.shipping_cost || 0)).toFixed(2)}</td>
                                                </tr>
                                            );
                                        })}</tbody>
                                    </table>
                                </div>

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
                                    <EntityLogo
                                        kind={selectedNote.kind}
                                        logoUrl={selectedNote.provider?.logo_url || null}
                                        avatarUrl={selectedNote.courier?.avatar_url || null}
                                        name={(selectedNote.kind === 'courier' ? selectedNote.courier?.name : selectedNote.provider?.name) || '??'}
                                        size="lg"
                                    />
                                    <div>
                                        <DialogTitle className="text-2xl font-black text-brand-navy">{selectedNote.reference}</DialogTitle>
                                        <div className="flex items-center gap-2 mt-1">
                                            <Badge className={cn("border-none font-bold text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-lg",
                                                selectedNote.status === 'paid' ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
                                                {selectedNote.status.toUpperCase()}
                                            </Badge>
                                            <span className="text-xs font-semibold text-muted-foreground">
                                                {selectedNote.kind === 'courier' ? selectedNote.courier?.name : selectedNote.provider?.name}
                                            </span>
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
