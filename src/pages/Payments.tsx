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
    include_delivery_in_total: boolean | null;
    master_city_id: string | null;
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
    const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
    // Free-text search inside the wizard's Select-orders step. Matches against
    // every bit of info on the order — name, phone, tracking, product names,
    // price. Reset alongside the rest of the wizard state.
    const [orderSearch, setOrderSearch] = useState('');
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
                .is('date_deleted', null)
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
        mutationFn: async (group: TargetGroup & { selectedOrders: UnpaidOrder[] }) => {
            const orders = group.selectedOrders;
            const { data: { session } } = await supabase.auth.getSession();
            const isCourier = group.kind === 'courier';
            const ref = `PAY-${isCourier ? 'CR' : group.target_name.substring(0, 3).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
            const notesTable = isCourier ? 'courier_payment_notes' : 'company_payment_notes';
            const lineItemsTable = isCourier ? 'courier_payment_note_orders' : 'company_payment_note_orders';
            const orderLinkField = isCourier ? 'current_courier_payment_note_id' : 'payment_delivery_id';

            // Resolve the per-order courier fee.
            //   - Provider notes: shipping_fee = orders.shipping_cost (unchanged).
            //   - Courier notes: shipping_fee = orders.shipping_cost when the
            //     include_delivery_in_total toggle is on (per-order override),
            //     otherwise courier_fees.fee for (courier_id, master_city_id).
            //     No matching courier_fees row -> 0. Owner's responsibility.
            let courierFeeMap = new Map<string, number>();
            if (isCourier) {
                const cityIds = Array.from(new Set(orders.map(o => o.master_city_id).filter(Boolean) as string[]));
                if (cityIds.length > 0) {
                    const { data: fees, error: feesError } = await (supabase as any)
                        .from('courier_fees')
                        .select('master_city_id, fee')
                        .eq('courier_id', group.target_id)
                        .in('master_city_id', cityIds);
                    if (feesError) throw feesError;
                    for (const f of (fees || []) as Array<{ master_city_id: string; fee: number | string | null }>) {
                        courierFeeMap.set(f.master_city_id, Number(f.fee || 0));
                    }
                }
            }

            const resolveShippingFee = (o: UnpaidOrder): number => {
                if (!isCourier) return Number(o.shipping_cost || 0);
                if (o.include_delivery_in_total) return Number(o.shipping_cost || 0);
                return o.master_city_id ? (courierFeeMap.get(o.master_city_id) ?? 0) : 0;
            };

            // Recalculate totals from selected orders
            const total_amount = orders.reduce((s, o) => s + Number(o.price || 0), 0);
            const total_shipping = orders.reduce((s, o) => s + resolveShippingFee(o), 0);
            const net_amount = total_amount - total_shipping;

            const insertPayload: any = {
                reference: ref,
                status: 'unpaid',
                total_amount: +total_amount.toFixed(2),
                total_shipping_fees: +total_shipping.toFixed(2),
                net_amount: +net_amount.toFixed(2),
                order_count: orders.length,
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
            const lineItems = orders.map(o => ({
                payment_note_id: note.id,
                order_id: o.id,
                tracking_code: isCourier
                    ? (o.courier_parcels?.[0]?.tracking_code || o.tracking_number || null)
                    : (o.parcels?.[0]?.tracking_code || o.tracking_number || null),
                amount: +Number(o.price || 0).toFixed(2),
                shipping_fee: +resolveShippingFee(o).toFixed(2),
                'DigiCom Business': activeBusinessId,
            }));
            const { error: itemsError } = await (supabase as any).from(lineItemsTable).insert(lineItems);
            if (itemsError) {
                await (supabase as any).from(notesTable).delete().eq('id', note.id);
                throw itemsError;
            }

            // Step 3: stamp orders
            const orderIds = orders.map(o => o.id);
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
            toast({ title: 'Payment note generated', description: 'Selected orders have been linked to this note.' });
            setIsWizardOpen(false); setWizardStep(0); setSelectedTarget(null); setSelectedOrderIds(new Set()); setOrderSearch('');
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
                <div className={cn(sizeClasses[size], "bg-ant-line-soft border border-slate-100 p-1.5 flex items-center justify-center overflow-hidden shadow-inner")}>
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
            <div className={cn(sizeClasses[size], kind === 'courier' ? 'bg-ant-ink/10 text-ant-ink' : 'bg-ant-ink/5 text-ant-mid', 'flex items-center justify-center')}>
                <span className={cn("font-semibold", textSize[size])}>{name?.substring(0, 2).toUpperCase()}</span>
            </div>
        );
    };

    // ─── Premium print helper ───
    const handlePrint = async (note: PaymentNote) => {
        const w = window.open('', '_blank');
        if (!w) return;
        w.document.write('<!doctype html><html><head><title>' + note.reference + '</title></head><body style="font-family:Inter,system-ui;padding:40px;color:#141413;background:#faf9f5">Loading…</body></html>');
        w.document.close();

        let businessName = 'DigiCom';
        let businessLogo: string | null = null;
        if (activeBusinessId) {
            const { data } = await (supabase as any).from('businesses').select('name, logo').eq('id', activeBusinessId).single();
            if (data) { businessName = data.name || businessName; businessLogo = data.logo || null; }
        }

        const entityName = note.kind === 'courier' ? (note.courier?.name || 'Unknown courier') : (note.provider?.name || 'Unknown provider');
        const entityImage = note.kind === 'courier' ? (note.courier?.avatar_url || null) : (note.provider?.logo_url || null);
        const entityLabel = note.kind === 'courier' ? 'Courier agent' : 'Provider';
        const createdAt = format(new Date(note.created_at), "dd MMM yyyy 'at' HH:mm");
        const paidAt = note.paid_at ? format(new Date(note.paid_at), "dd MMM yyyy 'at' HH:mm") : null;

        const rows = note.line_items.map((li, i) => `
            <tr>
                <td class="num">${String(i + 1).padStart(2, '0')}</td>
                <td class="track">${li.tracking_code || '—'}</td>
                <td class="right">${Number(li.amount).toFixed(2)}</td>
                <td class="right rose">−${Number(li.shipping_fee).toFixed(2)}</td>
                <td class="right net">${(Number(li.amount) - Number(li.shipping_fee)).toFixed(2)}</td>
            </tr>`).join('');

        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>${note.reference}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@500;600;700&family=Lora:ital,wght@1,400;1,500&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  :root {
    --ink: #141413;
    --ink-soft: #2a2926;
    --light: #faf9f5;
    --paper: #ffffff;
    --line: #e8e6dc;
    --line-soft: #f1efe8;
    --mid: #b0aea5;
    --muted: #6b6a63;
    --orange: #d97757;
    --green: #788c5d;
    --rose: #c96356;
  }
  html, body { margin: 0; padding: 0; background: var(--paper); color: var(--ink); font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-feature-settings: 'ss01','cv11'; }
  .sheet { padding: 22mm 18mm; min-height: 297mm; display: flex; flex-direction: column; }

  /* ── Header ───────────────────────────────────────────────── */
  .hdr { display: flex; align-items: flex-start; justify-content: space-between; gap: 32px; padding-bottom: 24px; border-bottom: 1px solid var(--line); }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand .logo { width: 52px; height: 52px; border-radius: 14px; background: var(--light); border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .brand .logo img { max-width: 100%; max-height: 100%; object-fit: contain; padding: 6px; }
  .brand .logo.fallback { background: var(--ink); color: var(--light); font-family: 'Poppins', sans-serif; font-weight: 600; font-size: 17px; letter-spacing: -0.01em; padding: 0; }
  .brand .name { font-family: 'Poppins', sans-serif; font-size: 17px; font-weight: 600; color: var(--ink); letter-spacing: -0.02em; line-height: 1; }
  .brand .sub { font-size: 9.5px; font-weight: 500; color: var(--mid); text-transform: uppercase; letter-spacing: 0.22em; margin-top: 6px; }
  .meta { text-align: right; }
  .meta .kicker { display: inline-flex; align-items: center; gap: 6px; font-size: 9.5px; font-weight: 500; color: var(--mid); text-transform: uppercase; letter-spacing: 0.22em; margin-bottom: 6px; }
  .meta .kicker::before { content: ''; display: inline-block; width: 4px; height: 4px; border-radius: 999px; background: var(--orange); }
  .meta h1 { margin: 0; font-family: 'Poppins', sans-serif; font-size: 28px; font-weight: 600; color: var(--ink); letter-spacing: -0.03em; line-height: 1; }
  .meta .date { font-family: 'Lora', Georgia, serif; font-style: italic; font-size: 12px; color: var(--muted); margin-top: 8px; }

  /* ── Entity strip ─────────────────────────────────────────── */
  .entity { margin-top: 24px; display: flex; align-items: center; gap: 14px; padding: 16px 18px; background: var(--light); border: 1px solid var(--line); border-radius: 16px; }
  .entity .ava { width: 52px; height: 52px; border-radius: 14px; overflow: hidden; background: var(--paper); border: 1px solid var(--line); flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .entity .ava img { width: 100%; height: 100%; object-fit: ${note.kind === 'courier' ? 'cover' : 'contain'}; padding: ${note.kind === 'courier' ? '0' : '6px'}; }
  .entity .ava.fallback { background: var(--ink); color: var(--light); font-family: 'Poppins', sans-serif; font-weight: 600; font-size: 15px; }
  .entity .info { flex: 1; min-width: 0; }
  .entity .info .label { font-size: 9.5px; font-weight: 500; color: var(--mid); text-transform: uppercase; letter-spacing: 0.22em; margin-bottom: 4px; }
  .entity .info .val { font-family: 'Poppins', sans-serif; font-size: 17px; font-weight: 600; color: var(--ink); letter-spacing: -0.02em; }
  .entity .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 9.5px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.22em; border: 1px solid; }
  .entity .badge::before { content: ''; display: inline-block; width: 4px; height: 4px; border-radius: 999px; }
  .entity .badge.unpaid { background: rgba(217, 119, 87, 0.10); color: var(--orange); border-color: rgba(217, 119, 87, 0.30); }
  .entity .badge.unpaid::before { background: var(--orange); }
  .entity .badge.paid { background: rgba(120, 140, 93, 0.10); color: var(--green); border-color: rgba(120, 140, 93, 0.25); }
  .entity .badge.paid::before { background: var(--green); }

  /* ── KPI strip ────────────────────────────────────────────── */
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; margin-top: 16px; background: var(--line); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .stat { padding: 14px 16px; background: var(--paper); }
  .stat .k { display: inline-flex; align-items: center; gap: 6px; font-size: 9.5px; font-weight: 500; color: var(--mid); text-transform: uppercase; letter-spacing: 0.22em; margin-bottom: 6px; }
  .stat .k::before { content: ''; display: inline-block; width: 4px; height: 4px; border-radius: 999px; background: var(--ink); }
  .stat.rose .k::before { background: var(--rose); }
  .stat.green .k::before { background: var(--green); }
  .stat .v { font-family: 'Poppins', sans-serif; font-size: 20px; font-weight: 600; color: var(--ink); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .stat .v .suffix { font-family: 'Inter', sans-serif; font-size: 10px; font-weight: 500; color: var(--mid); margin-left: 4px; letter-spacing: 0; }
  .stat .v.rose { color: var(--rose); }
  .stat .v.green { color: var(--green); }

  /* ── Line items table ────────────────────────────────────── */
  table { width: 100%; border-collapse: collapse; margin-top: 22px; font-variant-numeric: tabular-nums; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  thead th { text-align: left; padding: 10px 14px; font-size: 9.5px; font-weight: 500; color: var(--mid); text-transform: uppercase; letter-spacing: 0.22em; background: var(--line-soft); border-bottom: 1px solid var(--line); }
  thead th.right { text-align: right; }
  tbody td { padding: 11px 14px; font-size: 12px; border-top: 1px solid var(--line); color: var(--ink); }
  tbody tr:first-child td { border-top: none; }
  td.num { font-family: 'SF Mono', Menlo, monospace; font-size: 10.5px; color: var(--mid); width: 44px; }
  td.track { font-family: 'SF Mono', Menlo, monospace; font-size: 11px; color: var(--ink); letter-spacing: -0.01em; }
  td.right { text-align: right; font-weight: 500; }
  td.rose { color: var(--rose); }
  td.net { font-family: 'Poppins', sans-serif; font-weight: 600; color: var(--ink); letter-spacing: -0.01em; }

  /* ── Summary totals (ink panel) ──────────────────────────── */
  .totals { margin-top: 20px; padding: 4px; background: var(--ink); border-radius: 18px; }
  .totals .inner { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: rgba(250, 249, 245, 0.08); border-radius: 14px; overflow: hidden; }
  .totals .col { padding: 14px 18px; background: var(--ink); }
  .totals .col .lbl { font-size: 9.5px; font-weight: 500; color: rgba(250, 249, 245, 0.5); text-transform: uppercase; letter-spacing: 0.22em; margin-bottom: 6px; }
  .totals .col .val { font-family: 'Poppins', sans-serif; font-size: 22px; font-weight: 600; color: var(--light); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .totals .col .val .suffix { font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 500; color: rgba(250, 249, 245, 0.5); margin-left: 4px; letter-spacing: 0; }
  .totals .col.rose .val { color: var(--rose); }
  .totals .col.net .val { color: var(--green); }

  /* ── Footer ───────────────────────────────────────────────── */
  .foot { margin-top: auto; padding-top: 22px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: var(--mid); font-weight: 500; text-transform: uppercase; letter-spacing: 0.22em; }
  .foot .paid { font-family: 'Lora', Georgia, serif; font-style: italic; font-weight: 500; color: var(--green); text-transform: none; letter-spacing: 0; font-size: 11.5px; }
</style></head><body>
<div class="sheet">
  <div class="hdr">
    <div class="brand">
      ${businessLogo ? `<div class="logo"><img src="${businessLogo}" alt=""/></div>` : `<div class="logo fallback">${businessName.substring(0, 2).toUpperCase()}</div>`}
      <div>
        <div class="name">${businessName}</div>
        <div class="sub">Payment note</div>
      </div>
    </div>
    <div class="meta">
      <div class="kicker">Document</div>
      <h1>${note.reference}</h1>
      <div class="date">Issued on ${createdAt}</div>
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
    <span class="badge ${note.status}">${note.status === 'paid' ? 'Paid' : 'Unpaid'}</span>
  </div>

  <div class="stats">
    <div class="stat"><div class="k">Orders</div><div class="v">${note.order_count}</div></div>
    <div class="stat"><div class="k">Gross collected</div><div class="v">${Number(note.total_amount).toFixed(2)}<span class="suffix">MAD</span></div></div>
    <div class="stat rose"><div class="k">Shipping fees</div><div class="v rose">−${Number(note.total_shipping_fees).toFixed(2)}<span class="suffix">MAD</span></div></div>
  </div>

  <table>
    <thead><tr><th>#</th><th>Tracking</th><th class="right">Amount</th><th class="right">Fee</th><th class="right">Net</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div class="inner">
      <div class="col"><div class="lbl">Gross</div><div class="val">${Number(note.total_amount).toFixed(2)}<span class="suffix">MAD</span></div></div>
      <div class="col rose"><div class="lbl">Shipping fees</div><div class="val">−${Number(note.total_shipping_fees).toFixed(2)}<span class="suffix">MAD</span></div></div>
      <div class="col net"><div class="lbl">Net payable</div><div class="val">${Number(note.net_amount).toFixed(2)}<span class="suffix">MAD</span></div></div>
    </div>
  </div>

  <div class="foot">
    <span>${businessName} · Payment note</span>
    ${paidAt ? `<span class="paid">Settled on ${paidAt}</span>` : `<span>Reference · ${note.reference}</span>`}
  </div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},300);};</script>
</body></html>`;

        w.document.open();
        w.document.write(html);
        w.document.close();
    };

    const companyCount = (paymentNotes || []).filter((n: PaymentNote) => n.kind === 'company').length;
    const courierCount = (paymentNotes || []).filter((n: PaymentNote) => n.kind === 'courier').length;

    return (
        <div className="ant-surface mx-auto max-w-[1440px] px-2 md:px-3 py-2 space-y-4">
            {/* Editorial header */}
            <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pt-1">
                <div className="space-y-1.5">
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                        <span className="w-1 h-1 rounded-full bg-ant-orange" />
                        Shipping · Payouts
                    </span>
                    <h1 className="font-display text-[30px] md:text-[34px] font-semibold text-ant-ink leading-[1.05] tracking-[-0.02em]">
                        Delivery payments
                    </h1>
                    <p className="font-serif-display text-[13px] text-ant-muted italic">
                        Reconcile payouts — net out shipping fees against delivered revenue for every provider and courier.
                    </p>
                </div>
                <Button
                    onClick={() => { setIsWizardOpen(true); setWizardStep(0); setSelectedTarget(null); }}
                    disabled={!activeGroups.length}
                    className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light text-[12px] font-medium shadow-none gap-2 shrink-0 disabled:opacity-50"
                >
                    <Plus className="w-3.5 h-3.5" />
                    {activeTab === 'courier' ? 'New courier payment' : 'New payment note'}
                </Button>
            </header>

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-xl overflow-hidden border border-ant-line">
                {[
                    { label: 'Unpaid orders', value: String(stats.totalUnpaidOrders), accent: '#c96356', icon: Package },
                    { label: 'Pending notes', value: String(stats.pendingNotes), accent: '#d97757', icon: Clock },
                    { label: 'Paid notes', value: String(stats.paidNotes), accent: '#788c5d', icon: CheckCircle2 },
                    { label: 'Pending amount', value: stats.pendingAmount.toFixed(2), suffix: 'MAD', accent: '#141413', icon: DollarSign },
                ].map((s) => (
                    <div key={s.label} className="bg-ant-paper px-4 py-3">
                        <div className="flex items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                                <span className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: s.accent }} aria-hidden />
                                <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid truncate">{s.label}</span>
                            </div>
                            <span
                                className="flex items-center justify-center w-5 h-5 rounded-md shrink-0"
                                style={{ backgroundColor: `${s.accent}14`, color: s.accent }}
                            >
                                <s.icon className="w-3 h-3" strokeWidth={1.75} />
                            </span>
                        </div>
                        <div className="font-display text-[22px] font-semibold text-ant-ink tabular-nums tracking-[-0.02em] leading-none mt-2 truncate">
                            {s.value}
                            {s.suffix && <span className="text-[11px] font-medium text-ant-mid ml-1">{s.suffix}</span>}
                        </div>
                    </div>
                ))}
            </div>

            {/* Tabs + filters toolbar */}
            <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as 'company' | 'courier'); setSelectedTarget(null); }}>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                        <TabsList className="h-9 p-0.5 rounded-full bg-ant-paper border border-ant-line gap-0">
                            <TabsTrigger
                                value="company"
                                className="rounded-full px-4 h-8 text-[11.5px] font-medium data-[state=active]:bg-ant-ink data-[state=active]:text-ant-light data-[state=inactive]:text-ant-muted gap-1.5"
                            >
                                <Building2 className="w-3 h-3" /> Companies
                                <span className="text-[10px] tabular-nums opacity-70">{companyCount}</span>
                            </TabsTrigger>
                            <TabsTrigger
                                value="courier"
                                className="rounded-full px-4 h-8 text-[11.5px] font-medium data-[state=active]:bg-ant-ink data-[state=active]:text-ant-light data-[state=inactive]:text-ant-muted gap-1.5"
                            >
                                <Truck className="w-3 h-3" /> Couriers
                                <span className="text-[10px] tabular-nums opacity-70">{courierCount}</span>
                            </TabsTrigger>
                        </TabsList>

                        <div className="flex gap-1 items-center rounded-full border border-ant-line bg-ant-paper p-0.5">
                            {(['all', 'unpaid', 'paid'] as const).map((s) => (
                                <button
                                    key={s}
                                    onClick={() => setFilterStatus(s)}
                                    className={cn(
                                        'px-3.5 h-8 rounded-full text-[11px] font-medium transition',
                                        filterStatus === s
                                            ? s === 'paid'
                                                ? 'bg-ant-green text-white'
                                                : s === 'unpaid'
                                                    ? 'bg-ant-orange text-white'
                                                    : 'bg-ant-ink text-ant-light'
                                            : 'text-ant-muted hover:text-ant-ink',
                                    )}
                                >
                                    {s === 'all' ? 'All' : s === 'unpaid' ? 'Unpaid' : 'Paid'}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="relative w-full sm:w-[280px]">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                        <Input
                            placeholder={activeTab === 'courier' ? 'Search reference or courier…' : 'Search reference or provider…'}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-ant-orange focus-visible:ring-offset-0 focus-visible:border-ant-ink/25"
                        />
                    </div>
                </div>
            </Tabs>

            {/* Payment Notes List */}
            {isLoading ? (
                <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl bg-ant-line-soft" />)}</div>
            ) : filteredNotes.length === 0 ? (
                <div className="rounded-2xl border border-ant-line bg-ant-paper px-6 py-14 text-center">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-ant-orange/10 ring-1 ring-ant-orange/20 mb-4">
                        <DollarSign className="w-5 h-5 text-ant-orange" strokeWidth={1.5} />
                    </div>
                    <h3 className="font-display text-[18px] font-semibold text-ant-ink tracking-tight">No payment notes</h3>
                    <p className="font-serif-display text-[12.5px] text-ant-muted italic mt-1 mb-5 max-w-md mx-auto">
                        Bundle unpaid delivered orders into a reconciled payment note for your {activeTab === 'courier' ? 'courier' : 'provider'}.
                    </p>
                    <Button
                        disabled={!activeGroups.length}
                        onClick={() => { setIsWizardOpen(true); setWizardStep(0); setSelectedTarget(null); }}
                        className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light text-[12px] font-medium gap-2 disabled:opacity-50"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Generate the first note
                    </Button>
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredNotes.map((note: PaymentNote) => {
                        const isExpanded = expandedCards.has(note.id);
                        const isPaid = note.status === 'paid';
                        const targetName = note.kind === 'courier' ? (note.courier?.name || '??') : (note.provider?.name || '??');
                        const stripe = isPaid ? '#788c5d' : '#d97757';
                        return (
                            <Card
                                key={note.id}
                                className="group relative overflow-hidden border border-ant-line bg-ant-paper shadow-none hover:border-ant-ink/20 transition-all duration-300 rounded-2xl"
                            >
                                <div className="h-[3px]" style={{ backgroundColor: stripe }} />

                                <CardContent className="p-0">
                                    <div className="p-5 md:px-6 md:py-5 flex flex-col md:flex-row md:items-center justify-between gap-5">
                                        <div className="flex items-start gap-4 flex-1 min-w-0">
                                            <EntityLogo kind={note.kind} logoUrl={note.provider?.logo_url || null} avatarUrl={note.courier?.avatar_url || null} name={targetName} size="md" />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <h3 className="font-display text-[16px] font-semibold text-ant-ink tracking-[-0.01em] truncate">
                                                        {note.reference}
                                                    </h3>
                                                    <span
                                                        className={cn(
                                                            'inline-flex items-center gap-1 text-[9.5px] font-medium uppercase tracking-[0.22em] px-2 py-0.5 rounded-full border',
                                                            isPaid
                                                                ? 'bg-ant-green/10 text-ant-green border-ant-green/25'
                                                                : 'bg-ant-orange/10 text-ant-orange border-ant-orange/30',
                                                        )}
                                                    >
                                                        <span className={cn('w-1 h-1 rounded-full', isPaid ? 'bg-ant-green' : 'bg-ant-orange')} />
                                                        {isPaid ? 'Paid' : 'Unpaid'}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-3 flex-wrap text-[11px] text-ant-muted mt-1">
                                                    <span className="flex items-center gap-1 truncate max-w-[200px]">
                                                        {note.kind === 'courier' ? <Truck className="w-3 h-3 text-ant-mid" /> : <Building2 className="w-3 h-3 text-ant-mid" />}
                                                        <span className="truncate">{targetName}</span>
                                                    </span>
                                                    <span className="flex items-center gap-1 tabular-nums">
                                                        <Package className="w-3 h-3 text-ant-mid" />
                                                        {note.order_count} orders
                                                    </span>
                                                    <span className="flex items-center gap-1 tabular-nums">
                                                        <Clock className="w-3 h-3 text-ant-mid" />
                                                        {format(new Date(note.created_at), 'dd MMM yyyy')}
                                                    </span>
                                                    {isPaid && note.paid_at && (
                                                        <span className="inline-flex items-center gap-1 text-ant-green tabular-nums">
                                                            <CheckCircle2 className="w-3 h-3" />
                                                            Paid {format(new Date(note.paid_at), 'dd MMM')}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4 shrink-0">
                                            <div className="text-right">
                                                <span className="text-[9.5px] font-medium text-ant-mid uppercase tracking-[0.22em]">Net amount</span>
                                                <p
                                                    className={cn(
                                                        'font-display text-[22px] font-semibold tabular-nums tracking-[-0.02em] leading-none mt-0.5',
                                                        isPaid ? 'text-ant-green' : 'text-ant-orange',
                                                    )}
                                                >
                                                    {Number(note.net_amount).toFixed(2)}
                                                    <span className="text-[11px] font-medium text-ant-mid ml-1">MAD</span>
                                                </p>
                                            </div>
                                            <Separator orientation="vertical" className="h-10 bg-ant-line" />
                                            <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    onClick={() => toggleExpand(note.id)}
                                                    className="rounded-full h-9 w-9 text-ant-mid hover:text-ant-ink hover:bg-ant-line-soft"
                                                    title={isExpanded ? 'Collapse' : 'Expand'}
                                                >
                                                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                                </Button>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    onClick={() => handlePrint(note)}
                                                    className="rounded-full h-9 w-9 text-ant-mid hover:text-ant-ink hover:bg-ant-line-soft"
                                                    title="Print"
                                                >
                                                    <Printer className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    onClick={() => { setSelectedNote(note); setIsViewNoteOpen(true); }}
                                                    className="rounded-full h-9 w-9 text-ant-mid hover:text-ant-ink hover:bg-ant-line-soft"
                                                    title="Preview"
                                                >
                                                    <Eye className="w-4 h-4" />
                                                </Button>
                                                {!isPaid && (
                                                    <Button
                                                        size="sm"
                                                        onClick={() => markPaidMutation.mutate(note)}
                                                        disabled={markPaidMutation.isPending}
                                                        className="h-9 px-3.5 rounded-full bg-ant-green hover:bg-ant-green/90 text-white text-[11.5px] font-medium gap-1.5"
                                                    >
                                                        {markPaidMutation.isPending ? (
                                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                        ) : (
                                                            <>
                                                                <CreditCard className="w-3.5 h-3.5" />
                                                                Mark paid
                                                            </>
                                                        )}
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {isExpanded && (
                                        <div className="border-t border-ant-line bg-ant-light px-5 md:px-6 py-4">
                                            <table className="w-full text-[12.5px]">
                                                <thead>
                                                    <tr className="text-[9.5px] font-medium text-ant-mid uppercase tracking-[0.22em] border-b border-ant-line">
                                                        <th className="pb-2 text-left w-8">#</th>
                                                        <th className="pb-2 text-left">Tracking code</th>
                                                        <th className="pb-2 text-right">Amount</th>
                                                        <th className="pb-2 text-right">Shipping</th>
                                                        <th className="pb-2 text-right">Net</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {note.line_items.map((li, i) => (
                                                        <tr key={li.id} className="border-b border-ant-line/60 last:border-0">
                                                            <td className="py-2 text-ant-mid font-medium tabular-nums">{i + 1}</td>
                                                            <td className="py-2 font-mono text-[11.5px] font-medium text-ant-ink">{li.tracking_code || 'N/A'}</td>
                                                            <td className="py-2 text-right font-medium tabular-nums">{Number(li.amount).toFixed(2)}</td>
                                                            <td className="py-2 text-right text-ant-rose font-medium tabular-nums">
                                                                -{Number(li.shipping_fee).toFixed(2)}
                                                            </td>
                                                            <td className="py-2 text-right font-display font-semibold text-ant-ink tabular-nums">
                                                                {(Number(li.amount) - Number(li.shipping_fee)).toFixed(2)}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
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
            <Dialog open={isWizardOpen} onOpenChange={v => { if (!v) { setIsWizardOpen(false); setWizardStep(0); setSelectedTarget(null); setSelectedOrderIds(new Set()); setOrderSearch(''); } }}>
                <DialogContent className="ant-surface max-w-3xl p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden max-h-[90vh] overflow-y-auto custom-scrollbar">
                    <DialogHeader className="px-6 pt-6 pb-3 border-b border-ant-line">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="w-1 h-1 rounded-full bg-ant-orange" />
                            <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                Payment note wizard
                            </span>
                        </div>
                        <DialogTitle className="font-display text-[22px] font-semibold text-ant-ink tracking-[-0.02em]">
                            {wizardStep === 0
                                ? (activeTab === 'courier' ? 'Pick a courier' : 'Pick a provider')
                                : wizardStep === 1
                                    ? 'Pick orders'
                                    : 'Review & generate'}
                        </DialogTitle>
                        <DialogDescription className="font-serif-display text-[12.5px] text-ant-muted italic mt-0.5">
                            {wizardStep === 0
                                ? `Choose a ${activeTab === 'courier' ? 'courier agent' : 'delivery provider'} to pay out.`
                                : wizardStep === 1
                                    ? 'Pick the orders to include in this payment note.'
                                    : 'Check the numbers, then generate a reconciled payment note.'}
                        </DialogDescription>
                    </DialogHeader>

                    {/* Chapter-style step indicator */}
                    <div className="px-6 pt-5 flex items-center gap-3">
                        {[
                            { i: 0, label: activeTab === 'courier' ? 'Courier' : 'Provider' },
                            { i: 1, label: 'Orders' },
                            { i: 2, label: 'Review' },
                        ].map((s, idx, arr) => {
                            const active = wizardStep >= s.i;
                            const current = wizardStep === s.i;
                            return (
                                <React.Fragment key={s.i}>
                                    <div className="flex items-center gap-2">
                                        <div
                                            className={cn(
                                                'font-display w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold tabular-nums border transition-all',
                                                current
                                                    ? 'bg-ant-ink text-ant-light border-ant-ink'
                                                    : active
                                                        ? 'bg-ant-orange/10 text-ant-orange border-ant-orange/30'
                                                        : 'bg-ant-paper text-ant-mid border-ant-line',
                                            )}
                                        >
                                            {String(s.i + 1).padStart(2, '0')}
                                        </div>
                                        <span className={cn('text-[11px] font-medium uppercase tracking-[0.22em]', current ? 'text-ant-ink' : 'text-ant-mid')}>
                                            {s.label}
                                        </span>
                                    </div>
                                    {idx < arr.length - 1 && (
                                        <div className={cn('flex-1 h-px', active && wizardStep > s.i ? 'bg-ant-orange' : 'bg-ant-line')} />
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </div>

                    <div className="p-6">
                        {wizardStep === 0 && (
                            <div className="space-y-3">
                                {activeGroups.length === 0 ? (
                                    <div className="rounded-xl border border-ant-line bg-ant-light py-12 text-center">
                                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-ant-orange/10 ring-1 ring-ant-orange/20 mb-3">
                                            <AlertTriangle className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                                        </div>
                                        <p className="font-display text-[15px] font-semibold text-ant-ink tracking-tight">
                                            No unpaid delivered orders
                                        </p>
                                        <p className="font-serif-display text-[12px] text-ant-muted italic mt-1">
                                            Every delivered order is already paid out.
                                        </p>
                                    </div>
                                ) : activeGroups.map((g) => (
                                    <button
                                        key={g.target_id}
                                        type="button"
                                        onClick={() => setSelectedTarget(g.target_id)}
                                        className={cn(
                                            'w-full p-4 rounded-xl flex items-center justify-between gap-4 cursor-pointer transition-all duration-200 border text-left',
                                            selectedTarget === g.target_id
                                                ? 'bg-ant-ink/[0.04] border-ant-ink/35 ring-2 ring-ant-orange/20'
                                                : 'bg-ant-paper border-ant-line hover:border-ant-ink/25',
                                        )}
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <EntityLogo kind={g.kind} logoUrl={g.logo_url} avatarUrl={g.avatar_url} name={g.target_name} size="md" />
                                            <div className="min-w-0">
                                                <h4 className="font-display text-[15px] font-semibold text-ant-ink truncate tracking-[-0.01em]">
                                                    {g.target_name}
                                                </h4>
                                                <p className="text-[11px] text-ant-muted mt-0.5 tabular-nums">
                                                    {g.orders.length} orders · {g.total_amount.toFixed(2)} MAD revenue
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="font-display text-[18px] font-semibold text-ant-green tabular-nums leading-none tracking-[-0.02em]">
                                                {g.net_amount.toFixed(2)}
                                                <span className="text-[10px] font-medium text-ant-mid ml-1">MAD</span>
                                            </p>
                                            <p className="text-[9.5px] font-medium text-ant-mid uppercase tracking-[0.22em] mt-1">
                                                Net payable
                                            </p>
                                        </div>
                                    </button>
                                ))}
                                <div className="flex justify-end gap-2 pt-3">
                                    <Button
                                        variant="outline"
                                        onClick={() => setIsWizardOpen(false)}
                                        className="h-10 px-4 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-line-soft font-medium text-[12px]"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        disabled={!selectedTarget}
                                        onClick={() => {
                                            const group = activeGroups.find(g => g.target_id === selectedTarget);
                                            if (group) setSelectedOrderIds(new Set(group.orders.map(o => o.id)));
                                            setWizardStep(1);
                                        }}
                                        className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light font-medium text-[12px] gap-1.5 disabled:opacity-50"
                                    >
                                        Next <ArrowRight className="w-3.5 h-3.5" />
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* Step 1: Select Orders */}
                        {wizardStep === 1 && selectedGroup && (() => {
                            const allOrders = selectedGroup.orders;
                            const allSelected = allOrders.length > 0 && allOrders.every(o => selectedOrderIds.has(o.id));
                            // Free-text search across every bit of order info.
                            const q = orderSearch.trim().toLowerCase();
                            const matches = (o: typeof allOrders[number]) => {
                                if (!q) return true;
                                const trackingCodes = [
                                    ...(o.parcels || []).map(p => p.tracking_code).filter(Boolean),
                                    ...(o.courier_parcels || []).map(p => p.tracking_code).filter(Boolean),
                                    (o as { tracking_number?: string | null }).tracking_number,
                                ].filter(Boolean) as string[];
                                const items = (o.items || []).map(i => i.product?.name || '').filter(Boolean);
                                const hay = [
                                    (o as { name?: string }).name,
                                    (o as { phone?: string }).phone,
                                    ...trackingCodes,
                                    ...items,
                                    String(o.price ?? ''),
                                ].filter(Boolean).join(' ').toLowerCase();
                                return hay.includes(q);
                            };
                            const visibleOrders = allOrders.filter(matches);
                            return (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-3 p-3 bg-ant-light border border-ant-line rounded-xl flex-1 min-w-0">
                                            <EntityLogo kind={selectedGroup.kind} logoUrl={selectedGroup.logo_url} avatarUrl={selectedGroup.avatar_url} name={selectedGroup.target_name} size="md" />
                                            <div className="min-w-0">
                                                <p className="font-display text-[14px] font-semibold text-ant-ink truncate tracking-[-0.01em]">
                                                    {selectedGroup.target_name}
                                                </p>
                                                <p className="text-[11px] text-ant-muted mt-0.5 tabular-nums">
                                                    {selectedOrderIds.size} / {allOrders.length} orders selected
                                                </p>
                                            </div>
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                if (allSelected) setSelectedOrderIds(new Set());
                                                else setSelectedOrderIds(new Set(allOrders.map((o) => o.id)));
                                            }}
                                            className="rounded-full h-9 px-3.5 text-[11px] font-medium border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-line-soft shrink-0"
                                        >
                                            {allSelected ? 'Deselect all' : `Select all · ${allOrders.length}`}
                                        </Button>
                                    </div>

                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                                        <Input
                                            value={orderSearch}
                                            onChange={(e) => setOrderSearch(e.target.value)}
                                            placeholder="Search by name, phone, tracking, product..."
                                            className="h-9 pl-9 pr-8 rounded-xl border-ant-line bg-ant-paper text-[12px]"
                                        />
                                        {orderSearch && (
                                            <button
                                                type="button"
                                                onClick={() => setOrderSearch('')}
                                                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-md hover:bg-ant-line-soft flex items-center justify-center text-ant-mid"
                                                aria-label="Clear search"
                                            >
                                                <SearchX className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>

                                    <div className="space-y-1.5 max-h-[400px] overflow-y-auto custom-scrollbar pr-1">
                                        {visibleOrders.length === 0 && (
                                            <div className="font-serif-display text-[12px] text-ant-muted italic py-6 text-center">
                                                No orders match "{orderSearch}"
                                            </div>
                                        )}
                                        {visibleOrders.map((order) => {
                                            const isChecked = selectedOrderIds.has(order.id);
                                            const trackingCode = selectedGroup.kind === 'courier'
                                                ? (order.courier_parcels?.[0]?.tracking_code || order.tracking_number || '')
                                                : (order.parcels?.[0]?.tracking_code || order.tracking_number || '');
                                            return (
                                                <div
                                                    key={order.id}
                                                    onClick={() => {
                                                        setSelectedOrderIds((prev) => {
                                                            const next = new Set(prev);
                                                            if (next.has(order.id)) next.delete(order.id);
                                                            else next.add(order.id);
                                                            return next;
                                                        });
                                                    }}
                                                    className={cn(
                                                        'flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200 border',
                                                        isChecked
                                                            ? 'bg-ant-ink/[0.03] border-ant-ink/25'
                                                            : 'bg-ant-paper border-ant-line hover:border-ant-ink/15',
                                                    )}
                                                >
                                                    <div
                                                        className={cn(
                                                            'w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-all',
                                                            isChecked ? 'bg-ant-ink border-ant-ink' : 'border-ant-line bg-ant-paper',
                                                        )}
                                                    >
                                                        {isChecked && <CheckCircle2 className="w-3.5 h-3.5 text-ant-light" strokeWidth={2.5} />}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-[13px] font-semibold text-ant-ink truncate">{order.name}</p>
                                                        <p className="text-[10.5px] text-ant-muted tabular-nums">
                                                            {order.phone}
                                                            {trackingCode ? ` · ${trackingCode}` : ''}
                                                        </p>
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <p className="font-display text-[13px] font-semibold text-ant-ink tabular-nums tracking-[-0.01em]">
                                                            {Number(order.price || 0).toFixed(2)}
                                                            <span className="text-[10px] font-medium text-ant-mid ml-1">MAD</span>
                                                        </p>
                                                        <p className="text-[10px] text-ant-rose tabular-nums">
                                                            −{Number(order.shipping_cost || 0).toFixed(2)} ship
                                                        </p>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <div className="flex justify-end gap-2">
                                        <Button
                                            variant="outline"
                                            onClick={() => setWizardStep(0)}
                                            className="h-10 px-4 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-line-soft font-medium text-[12px]"
                                        >
                                            Back
                                        </Button>
                                        <Button
                                            disabled={selectedOrderIds.size === 0}
                                            onClick={() => setWizardStep(2)}
                                            className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light font-medium text-[12px] gap-1.5 disabled:opacity-50"
                                        >
                                            Next · {selectedOrderIds.size} <ArrowRight className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* Step 2: Review & Generate */}
                        {wizardStep === 2 && selectedGroup && (() => {
                            const filteredOrders = selectedGroup.orders.filter(o => selectedOrderIds.has(o.id));
                            const totalAmount = filteredOrders.reduce((s, o) => s + Number(o.price || 0), 0);
                            const totalShipping = filteredOrders.reduce((s, o) => s + Number(o.shipping_cost || 0), 0);
                            const netAmount = totalAmount - totalShipping;
                            return (
                                <div className="space-y-4">
                                    <div className="flex items-center gap-3 p-4 bg-ant-light border border-ant-line rounded-xl">
                                        <EntityLogo kind={selectedGroup.kind} logoUrl={selectedGroup.logo_url} avatarUrl={selectedGroup.avatar_url} name={selectedGroup.target_name} size="md" />
                                        <div className="min-w-0">
                                            <p className="font-display text-[15px] font-semibold text-ant-ink tracking-[-0.01em] truncate">
                                                {selectedGroup.target_name}
                                            </p>
                                            <p className="text-[11px] text-ant-muted mt-0.5 tabular-nums">
                                                {filteredOrders.length} orders to include
                                            </p>
                                        </div>
                                    </div>

                                    <div className="overflow-x-auto border border-ant-line rounded-xl">
                                        <table className="w-full text-[12.5px]">
                                            <thead>
                                                <tr className="bg-ant-line-soft text-[9.5px] font-medium text-ant-mid uppercase tracking-[0.22em]">
                                                    <th className="px-3 py-2.5 text-left w-8">#</th>
                                                    <th className="px-3 py-2.5 text-left">Customer</th>
                                                    <th className="px-3 py-2.5 text-left">Tracking</th>
                                                    <th className="px-3 py-2.5 text-right">Amount</th>
                                                    <th className="px-3 py-2.5 text-right">Shipping</th>
                                                    <th className="px-3 py-2.5 text-right">Net</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredOrders.map((o, i) => {
                                                    const trackingCode = selectedGroup.kind === 'courier'
                                                        ? (o.courier_parcels?.[0]?.tracking_code || o.tracking_number || 'N/A')
                                                        : (o.parcels?.[0]?.tracking_code || o.tracking_number || 'N/A');
                                                    return (
                                                        <tr key={o.id} className="border-t border-ant-line hover:bg-ant-line-soft transition-colors">
                                                            <td className="px-3 py-2 text-ant-mid tabular-nums">{i + 1}</td>
                                                            <td className="px-3 py-2 font-medium text-ant-ink truncate">{o.name}</td>
                                                            <td className="px-3 py-2 font-mono text-[11.5px] text-ant-ink">{trackingCode}</td>
                                                            <td className="px-3 py-2 text-right font-medium tabular-nums">{Number(o.price || 0).toFixed(2)}</td>
                                                            <td className="px-3 py-2 text-right text-ant-rose font-medium tabular-nums">−{Number(o.shipping_cost || 0).toFixed(2)}</td>
                                                            <td className="px-3 py-2 text-right font-display font-semibold text-ant-ink tabular-nums">
                                                                {(Number(o.price || 0) - Number(o.shipping_cost || 0)).toFixed(2)}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="bg-ant-ink rounded-2xl p-5 text-ant-light">
                                        <div className="grid grid-cols-3 gap-px bg-white/10 rounded-xl overflow-hidden">
                                            <div className="bg-ant-ink px-4 py-3 text-left">
                                                <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-light/50 block mb-1">Total amount</span>
                                                <span className="font-display text-[20px] font-semibold tabular-nums tracking-[-0.02em]">
                                                    {totalAmount.toFixed(2)}
                                                </span>
                                            </div>
                                            <div className="bg-ant-ink px-4 py-3 text-left">
                                                <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-light/50 block mb-1">Shipping fees</span>
                                                <span className="font-display text-[20px] font-semibold tabular-nums tracking-[-0.02em] text-ant-rose">
                                                    −{totalShipping.toFixed(2)}
                                                </span>
                                            </div>
                                            <div className="bg-ant-ink px-4 py-3 text-left">
                                                <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-light/50 block mb-1">Net payable</span>
                                                <span className="font-display text-[20px] font-semibold tabular-nums tracking-[-0.02em] text-ant-green">
                                                    {netAmount.toFixed(2)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex justify-end gap-2">
                                        <Button
                                            variant="outline"
                                            onClick={() => setWizardStep(1)}
                                            className="h-10 px-4 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-line-soft font-medium text-[12px]"
                                        >
                                            Back
                                        </Button>
                                        <Button
                                            onClick={() => generateNoteMutation.mutate({ ...selectedGroup, selectedOrders: filteredOrders })}
                                            disabled={generateNoteMutation.isPending}
                                            className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light font-medium text-[12px] gap-1.5"
                                        >
                                            {generateNoteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5 text-ant-orange" />}
                                            Generate note
                                        </Button>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                </DialogContent>
            </Dialog>

            {/* ─── VIEW NOTE MODAL ─── */}
            <Dialog open={isViewNoteOpen} onOpenChange={v => { if (!v) { setIsViewNoteOpen(false); setSelectedNote(null); } }}>
                <DialogContent className="ant-surface max-w-2xl p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden max-h-[90vh] overflow-y-auto custom-scrollbar">
                    {selectedNote && (
                        <>
                            <DialogHeader className="p-6 pb-4 border-b border-ant-line">
                                <div className="flex items-center gap-4">
                                    <EntityLogo
                                        kind={selectedNote.kind}
                                        logoUrl={selectedNote.provider?.logo_url || null}
                                        avatarUrl={selectedNote.courier?.avatar_url || null}
                                        name={(selectedNote.kind === 'courier' ? selectedNote.courier?.name : selectedNote.provider?.name) || '??'}
                                        size="lg"
                                    />
                                    <div className="min-w-0">
                                        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                            <span className="w-1 h-1 rounded-full bg-ant-orange" />
                                            Payment note
                                        </span>
                                        <DialogTitle className="font-display text-[20px] font-semibold text-ant-ink tracking-[-0.02em] mt-0.5">
                                            {selectedNote.reference}
                                        </DialogTitle>
                                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                            <span
                                                className={cn(
                                                    'inline-flex items-center gap-1 text-[9.5px] font-medium uppercase tracking-[0.22em] px-2 py-0.5 rounded-full border',
                                                    selectedNote.status === 'paid'
                                                        ? 'bg-ant-green/10 text-ant-green border-ant-green/25'
                                                        : 'bg-ant-orange/10 text-ant-orange border-ant-orange/30',
                                                )}
                                            >
                                                <span className={cn('w-1 h-1 rounded-full', selectedNote.status === 'paid' ? 'bg-ant-green' : 'bg-ant-orange')} />
                                                {selectedNote.status === 'paid' ? 'Paid' : 'Unpaid'}
                                            </span>
                                            <span className="text-[11.5px] text-ant-muted truncate max-w-[240px]">
                                                {selectedNote.kind === 'courier' ? selectedNote.courier?.name : selectedNote.provider?.name}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </DialogHeader>

                            <div className="px-6 py-5 space-y-4">
                                <div className="grid grid-cols-2 gap-px bg-ant-line rounded-xl overflow-hidden border border-ant-line">
                                    <div className="bg-ant-paper px-4 py-3">
                                        <span className="text-[9.5px] font-medium text-ant-mid uppercase tracking-[0.22em]">Created</span>
                                        <p className="font-display text-[13px] font-semibold text-ant-ink tabular-nums tracking-[-0.01em] mt-1">
                                            {format(new Date(selectedNote.created_at), 'dd MMM yyyy, HH:mm')}
                                        </p>
                                    </div>
                                    {selectedNote.paid_at ? (
                                        <div className="bg-ant-green/10 px-4 py-3">
                                            <span className="text-[9.5px] font-medium text-ant-green uppercase tracking-[0.22em]">Paid</span>
                                            <p className="font-display text-[13px] font-semibold text-ant-green tabular-nums tracking-[-0.01em] mt-1">
                                                {format(new Date(selectedNote.paid_at), 'dd MMM yyyy, HH:mm')}
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="bg-ant-paper px-4 py-3">
                                            <span className="text-[9.5px] font-medium text-ant-mid uppercase tracking-[0.22em]">Status</span>
                                            <p className="font-display text-[13px] font-semibold text-ant-orange tabular-nums tracking-[-0.01em] mt-1">
                                                Awaiting payout
                                            </p>
                                        </div>
                                    )}
                                </div>

                                <div className="overflow-x-auto border border-ant-line rounded-xl">
                                    <table className="w-full text-[12.5px]">
                                        <thead>
                                            <tr className="bg-ant-line-soft text-[9.5px] font-medium text-ant-mid uppercase tracking-[0.22em]">
                                                <th className="px-3 py-2.5 text-left w-8">#</th>
                                                <th className="px-3 py-2.5 text-left">Tracking</th>
                                                <th className="px-3 py-2.5 text-right">Amount</th>
                                                <th className="px-3 py-2.5 text-right">Shipping</th>
                                                <th className="px-3 py-2.5 text-right">Net</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {selectedNote.line_items.map((li, i) => (
                                                <tr key={li.id} className="border-t border-ant-line hover:bg-ant-line-soft transition-colors">
                                                    <td className="px-3 py-2 text-ant-mid tabular-nums">{i + 1}</td>
                                                    <td className="px-3 py-2 font-mono text-[11.5px] text-ant-ink">{li.tracking_code || 'N/A'}</td>
                                                    <td className="px-3 py-2 text-right font-medium tabular-nums">{Number(li.amount).toFixed(2)}</td>
                                                    <td className="px-3 py-2 text-right text-ant-rose font-medium tabular-nums">−{Number(li.shipping_fee).toFixed(2)}</td>
                                                    <td className="px-3 py-2 text-right font-display font-semibold text-ant-ink tabular-nums">
                                                        {(Number(li.amount) - Number(li.shipping_fee)).toFixed(2)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="bg-ant-ink rounded-2xl p-5 text-ant-light">
                                    <div className="grid grid-cols-3 gap-px bg-white/10 rounded-xl overflow-hidden">
                                        <div className="bg-ant-ink px-4 py-3 text-left">
                                            <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-light/50 block mb-1">Total</span>
                                            <span className="font-display text-[20px] font-semibold tabular-nums tracking-[-0.02em]">
                                                {Number(selectedNote.total_amount).toFixed(2)}
                                            </span>
                                        </div>
                                        <div className="bg-ant-ink px-4 py-3 text-left">
                                            <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-light/50 block mb-1">Shipping</span>
                                            <span className="font-display text-[20px] font-semibold tabular-nums tracking-[-0.02em] text-ant-rose">
                                                −{Number(selectedNote.total_shipping_fees).toFixed(2)}
                                            </span>
                                        </div>
                                        <div className="bg-ant-ink px-4 py-3 text-left">
                                            <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-light/50 block mb-1">Net</span>
                                            <span className="font-display text-[20px] font-semibold tabular-nums tracking-[-0.02em] text-ant-green">
                                                {Number(selectedNote.net_amount).toFixed(2)}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex justify-end gap-2">
                                    <Button
                                        variant="outline"
                                        onClick={() => handlePrint(selectedNote)}
                                        className="h-10 px-4 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-line-soft font-medium text-[12px] gap-1.5"
                                    >
                                        <Printer className="w-3.5 h-3.5" />
                                        Print
                                    </Button>
                                    {selectedNote.status === 'unpaid' && (
                                        <Button
                                            onClick={() => markPaidMutation.mutate(selectedNote)}
                                            disabled={markPaidMutation.isPending}
                                            className="h-10 px-5 rounded-full bg-ant-green hover:bg-ant-green/90 text-white font-medium text-[12px] gap-1.5"
                                        >
                                            {markPaidMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />}
                                            Mark as paid
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
