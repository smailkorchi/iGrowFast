import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus, Search, Loader2, Package, DollarSign, Eye, FileText,
    CheckCircle2, Clock, Building2, AlertTriangle, Truck,
    ChevronDown, ChevronRight, Printer, ArrowRight, SearchX,
    RotateCcw, PackageCheck
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
import { orderMatchesSellerProducts } from '@/components/delivery/DeliveryNoteWizard';

// Package status "Retourné"
const RETOURNE_PACKAGE_STATUS_ID = 'c98d2ec2-94aa-4bfd-bc27-cdf93d46f3a9';
// Order status "RETURN"
const RETURN_ORDER_STATUS_ID = 'dbb3ae2c-abbf-4c96-93af-ed82319c8b68';

interface ReturnOrder {
    id: string; seller_id?: string | null; assign_id?: string | null;
    name: string; phone: string; price: number; shipping_cost: number;
    tracking_number: string | null; company_id: string | null; courier_id: string | null;
    master_city_id: string | null;
    current_return_note_id: string | null; current_courier_return_note_id: string | null;
    parcels: { tracking_code: string | null; provider: { id: string; name: string; logo_url: string | null } | null }[];
    courier_parcels: { tracking_code: string | null }[];
    company: { id: string; name: string; logo_url: string | null } | null;
    courier: { id: string; name: string; avatar_url: string | null } | null;
    items: { quantity: number; unit_price: number; product_id?: string; product: { name: string } | null }[];
}

interface TargetGroup {
    kind: 'company' | 'courier';
    target_id: string;
    target_name: string;
    logo_url: string | null;
    avatar_url: string | null;
    orders: ReturnOrder[];
    total_amount: number;
    total_shipping: number;
    net_amount: number;
}

interface ReturnNote {
    kind: 'company' | 'courier';
    id: string; reference: string; status: string; total_amount: number;
    total_shipping_fees: number; net_amount: number; order_count: number;
    received_at: string | null; note: string | null; created_at: string;
    provider: { id: string; name: string; logo_url: string | null } | null;
    courier?: { id: string; name: string; avatar_url: string | null } | null;
    line_items: { id: string; order_id: string; tracking_code: string | null; amount: number; shipping_fee: number }[];
}

const ReturnNote = () => {
    const [activeTab, setActiveTab] = useState<'company' | 'courier'>('company');
    const [isWizardOpen, setIsWizardOpen] = useState(false);
    const [wizardStep, setWizardStep] = useState(0);
    const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
    const [isViewNoteOpen, setIsViewNoteOpen] = useState(false);
    const [selectedNote, setSelectedNote] = useState<ReturnNote | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'received'>('all');
    const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const { data: sellerShippingCtx } = useQuery({
        queryKey: ['seller-return-shipping-ctx', activeBusinessId],
        queryFn: async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.user) return null;
            const { data: row, error } = await supabase
                .from('users')
                .select('id, products')
                .eq('id', session.user.id)
                .single();
            if (error || !row) return null;
            const productIds = Array.isArray(row.products)
                ? (row.products as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 0)
                : [];
            return { userId: row.id as string, productIds };
        },
        enabled: !!activeBusinessId,
    });

    // ─── Fetch orders with package_status = Retourné AND not already linked to a return note ───
    const { data: returnOrders, isLoading: isLoadingReturns } = useQuery({
        queryKey: ['seller-retourne-orders', activeBusinessId, sellerShippingCtx?.userId, sellerShippingCtx?.productIds?.join(',')],
        queryFn: async () => {
            if (!activeBusinessId || !sellerShippingCtx?.userId) return [];
            const uid = sellerShippingCtx.userId;
            const { data, error } = await (supabase as any)
                .from('orders')
                .select(`*,
                    company:providers(id, name, logo_url),
                    courier:users!orders_courier_id_fkey(id, name, avatar_url),
                    items:order_items(quantity, unit_price, product_id, product:products(name)),
                    parcels:company_parcels(tracking_code, provider:providers(id, name, logo_url)),
                    courier_parcels(tracking_code)`)
                .eq('DigiCom Business', activeBusinessId)
                .eq('package_status_id', RETOURNE_PACKAGE_STATUS_ID)
                .is('current_return_note_id', null)
                .is('current_courier_return_note_id', null)
                .or(`seller_id.eq.${uid},assign_id.eq.${uid}`)
                .is('date_deleted', null)
                .order('created_at', { ascending: false });
            if (error) throw error;
            const productSet = new Set(sellerShippingCtx.productIds);
            if (productSet.size === 0) return [];
            return ((data || []) as ReturnOrder[]).filter((o) =>
                orderMatchesSellerProducts(o, uid, productSet)
            );
        },
        enabled: !!activeBusinessId && !!sellerShippingCtx?.userId,
    });

    // ─── Fetch existing return notes (company + courier — seller-scoped) ───
    const { data: returnNotes, isLoading: isLoadingNotes } = useQuery({
        queryKey: ['seller-return-notes', activeBusinessId, sellerShippingCtx?.userId],
        queryFn: async () => {
            if (!activeBusinessId || !sellerShippingCtx?.userId) return [];
            const [companyRes, courierRes] = await Promise.all([
                (supabase as any)
                    .from('company_return_notes')
                    .select(`*, provider:providers(id, name, logo_url), line_items:company_return_note_orders(id, order_id, tracking_code, amount, shipping_fee)`)
                    .eq('DigiCom Business', activeBusinessId)
                    .eq('created_by', sellerShippingCtx.userId)
                    .order('created_at', { ascending: false }),
                (supabase as any)
                    .from('courier_return_notes')
                    .select(`*, courier:users!courier_return_notes_courier_id_fkey(id, name, avatar_url), line_items:courier_return_note_orders(id, order_id, tracking_code, amount, shipping_fee)`)
                    .eq('DigiCom Business', activeBusinessId)
                    .eq('created_by', sellerShippingCtx.userId)
                    .order('created_at', { ascending: false }),
            ]);
            if (companyRes.error) throw companyRes.error;
            if (courierRes.error) throw courierRes.error;
            const companyNotes = (companyRes.data || []).map((n: any) => ({ ...n, kind: 'company' as const }));
            const courierNotes = (courierRes.data || []).map((n: any) => ({ ...n, kind: 'courier' as const, provider: null }));
            return [...companyNotes, ...courierNotes] as ReturnNote[];
        },
        enabled: !!activeBusinessId && !!sellerShippingCtx?.userId,
    });

    // ─── Fetch return fees maps for (entity, master_city_id) lookup ───
    const { data: returnFeesMap } = useQuery({
        queryKey: ['seller-return-fees-map', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return { company: {}, courier: {} } as { company: Record<string, number>; courier: Record<string, number> };
            const [cf, kf] = await Promise.all([
                (supabase as any).from('company_fees').select('company_id, master_city_id, return_fee').eq('DigiCom Business', activeBusinessId),
                (supabase as any).from('courier_fees').select('courier_id, master_city_id, return_fee').eq('DigiCom Business', activeBusinessId),
            ]);
            const company: Record<string, number> = {};
            for (const row of (cf.data || [])) {
                if (row.company_id && row.master_city_id) company[`${row.company_id}:${row.master_city_id}`] = Number(row.return_fee || 0);
            }
            const courier: Record<string, number> = {};
            for (const row of (kf.data || [])) {
                if (row.courier_id && row.master_city_id) courier[`${row.courier_id}:${row.master_city_id}`] = Number(row.return_fee || 0);
            }
            return { company, courier };
        },
        enabled: !!activeBusinessId,
    });

    const getReturnFeeForOrder = useCallback((order: ReturnOrder): number => {
        const map = returnFeesMap || { company: {}, courier: {} };
        const mcid = (order as any).master_city_id;
        if (!mcid) return 0;
        const isCourierOrder = !order.company_id && !!order.courier_id;
        if (isCourierOrder) {
            const cid = order.courier?.id || order.courier_id;
            return cid ? (map.courier[`${cid}:${mcid}`] ?? 0) : 0;
        }
        const pid = order.company?.id || order.parcels?.[0]?.provider?.id || order.company_id;
        return pid ? (map.company[`${pid}:${mcid}`] ?? 0) : 0;
    }, [returnFeesMap]);

    // ─── Group returned orders by kind ───
    const { companyGroups, courierGroups } = useMemo(() => {
        const companyMap = new Map<string, TargetGroup>();
        const courierMap = new Map<string, TargetGroup>();
        for (const order of returnOrders || []) {
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
                group.total_amount += Number(order.price || 0);
                group.total_shipping += getReturnFeeForOrder(order);
                group.net_amount = group.total_amount - group.total_shipping;
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
                group.total_amount += Number(order.price || 0);
                group.total_shipping += getReturnFeeForOrder(order);
                group.net_amount = group.total_amount - group.total_shipping;
            }
        }
        return {
            companyGroups: Array.from(companyMap.values()),
            courierGroups: Array.from(courierMap.values()),
        };
    }, [returnOrders, getReturnFeeForOrder]);

    const activeGroups = activeTab === 'courier' ? courierGroups : companyGroups;
    const selectedGroup = activeGroups.find(g => g.target_id === selectedProvider);

    // ─── Generate return note (company or courier) ───
    const generateNoteMutation = useMutation({
        mutationFn: async (group: TargetGroup) => {
            const { data: { session } } = await supabase.auth.getSession();
            const isCourier = group.kind === 'courier';
            const ref = `RET-${isCourier ? 'CR' : group.target_name.substring(0, 3).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
            const notesTable = isCourier ? 'courier_return_notes' : 'company_return_notes';
            const lineItemsTable = isCourier ? 'courier_return_note_orders' : 'company_return_note_orders';
            const orderLinkField = isCourier ? 'current_courier_return_note_id' : 'current_return_note_id';

            const insertPayload: any = {
                reference: ref,
                status: 'pending',
                total_amount: group.total_amount,
                total_shipping_fees: group.total_shipping,
                net_amount: group.net_amount,
                order_count: group.orders.length,
                'DigiCom Business': activeBusinessId,
                created_by: session?.user?.id ?? null,
            };
            if (isCourier) {
                insertPayload.courier_id = group.target_id;
            } else {
                insertPayload.provider_id = group.target_id;
            }

            const { data: note, error: noteError } = await (supabase as any)
                .from(notesTable)
                .insert(insertPayload)
                .select()
                .single();
            if (noteError) throw noteError;

            const lineItems = group.orders.map((o) => ({
                return_note_id: note.id,
                order_id: o.id,
                tracking_code: isCourier
                    ? (o.courier_parcels?.[0]?.tracking_code || o.tracking_number || null)
                    : (o.parcels?.[0]?.tracking_code || o.tracking_number || null),
                amount: Number(o.price || 0),
                shipping_fee: getReturnFeeForOrder(o),
                'DigiCom Business': activeBusinessId,
            }));
            const { error: itemsError } = await (supabase as any).from(lineItemsTable).insert(lineItems);
            if (itemsError) throw itemsError;

            await (supabase as any).from('orders').update({ [orderLinkField]: note.id }).in('id', group.orders.map((o) => o.id));
            return note;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['seller-return-notes'] });
            queryClient.invalidateQueries({ queryKey: ['seller-retourne-orders'] });
            queryClient.invalidateQueries({ queryKey: ['return-notes'] });
            queryClient.invalidateQueries({ queryKey: ['retourne-orders'] });
            toast({ title: 'Return note generated', description: 'All returned orders have been linked to this note.' });
            setIsWizardOpen(false); setWizardStep(0); setSelectedProvider(null);
        },
        onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });

    // ─── Mark as received → changes order status to RETURN (triggers stock restore) ───
    const markReceivedMutation = useMutation({
        mutationFn: async (note: ReturnNote) => {
            const notesTable = note.kind === 'courier' ? 'courier_return_notes' : 'company_return_notes';
            const { error: noteErr } = await (supabase as any).from(notesTable).update({ status: 'received', received_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', note.id);
            if (noteErr) throw noteErr;
            // Update all linked orders to RETURN status → triggers stock restoration via the DB trigger
            const orderIds = note.line_items.map(li => li.order_id);
            if (orderIds.length > 0) {
                const { error: ordErr } = await (supabase as any).from('orders').update({ order_status_id: RETURN_ORDER_STATUS_ID, updated_at: new Date().toISOString() }).in('id', orderIds);
                if (ordErr) throw ordErr;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['seller-return-notes'] });
            queryClient.invalidateQueries({ queryKey: ['seller-retourne-orders'] });
            queryClient.invalidateQueries({ queryKey: ['return-notes'] });
            queryClient.invalidateQueries({ queryKey: ['retourne-orders'] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            toast({ title: 'Marked as received', description: 'All linked orders changed to RETURN. Stock has been restored.' });
            setIsViewNoteOpen(false); setSelectedNote(null);
        },
        onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });

    const notesForActiveTab = useMemo(() => {
        return (returnNotes || []).filter((n: ReturnNote) => n.kind === activeTab);
    }, [returnNotes, activeTab]);

    const filteredNotes = useMemo(() => {
        return notesForActiveTab.filter((n: ReturnNote) => {
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
        const pendingNotes = notes.filter((n: ReturnNote) => n.status === 'pending');
        const receivedNotes = notes.filter((n: ReturnNote) => n.status === 'received');
        const activeReturnOrdersCount = activeTab === 'courier' ? courierGroups.reduce((s, g) => s + g.orders.length, 0) : companyGroups.reduce((s, g) => s + g.orders.length, 0);
        return {
            totalReturnOrders: activeReturnOrdersCount,
            pendingNotes: pendingNotes.length, receivedNotes: receivedNotes.length,
            pendingAmount: pendingNotes.reduce((s: number, n: ReturnNote) => s + Number(n.total_amount), 0),
        };
    }, [notesForActiveTab, companyGroups, courierGroups, activeTab]);

    const toggleExpand = (id: string) => setExpandedCards(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    const isLoading = isLoadingReturns || isLoadingNotes;

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
            <div className={cn(sizeClasses[size], "bg-red-50 flex items-center justify-center")}>
                <span className={cn("font-black text-red-400", textSize[size])}>{name?.substring(0, 2).toUpperCase()}</span>
            </div>
        );
    };

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
            <div className={cn(sizeClasses[size], kind === 'courier' ? 'bg-brand-navy/10 text-brand-navy' : 'bg-red-50 text-red-400', 'flex items-center justify-center')}>
                <span className={cn("font-black", textSize[size])}>{name?.substring(0, 2).toUpperCase()}</span>
            </div>
        );
    };

    // ─── Print helper ───
    const handlePrint = async (note: ReturnNote) => {
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
  .meta .kicker { font-size: 9px; font-weight: 800; color: #c93942; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 6px; }
  .meta h1 { margin: 0; font-size: 26px; font-weight: 900; color: #3b5e5e; font-family: "SF Mono", Menlo, monospace; letter-spacing: -0.5px; }
  .meta .date { font-size: 11px; color: #9aa6a0; margin-top: 6px; font-weight: 500; }
  .entity { margin-top: 32px; display: flex; align-items: center; gap: 18px; padding: 20px 22px; background: #f9faf7; border: 1px solid #eef1ee; border-radius: 20px; }
  .entity .ava { width: 60px; height: 60px; border-radius: 18px; overflow: hidden; background: #fff; border: 1px solid #eef1ee; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .entity .ava img { width: 100%; height: 100%; object-fit: ${note.kind === 'courier' ? 'cover' : 'contain'}; padding: ${note.kind === 'courier' ? '0' : '6px'}; }
  .entity .ava.fallback { background: ${note.kind === 'courier' ? '#3b5e5e' : '#fef2f2'}; color: ${note.kind === 'courier' ? '#daddcc' : '#c93942'}; font-weight: 900; font-size: 18px; }
  .entity .info .label { font-size: 9px; font-weight: 800; color: #9aa6a0; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 4px; }
  .entity .info .val { font-size: 20px; font-weight: 800; color: #3b5e5e; letter-spacing: -0.3px; }
  .entity .badge { margin-left: auto; padding: 8px 16px; border-radius: 999px; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; }
  .entity .badge.pending { background: #fef3c7; color: #92400e; }
  .entity .badge.received { background: #d1fae5; color: #065f46; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 22px; }
  .stat { padding: 18px 20px; background: #fff; border: 1px solid #eef1ee; border-radius: 18px; }
  .stat .k { font-size: 9px; font-weight: 800; color: #9aa6a0; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 6px; }
  .stat .v { font-size: 18px; font-weight: 900; color: #3b5e5e; font-variant-numeric: tabular-nums; }
  .stat .v.red { color: #c93942; }
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
  .totals .col { }
  .totals .col .lbl { font-size: 9px; font-weight: 800; color: rgba(255,255,255,0.55); text-transform: uppercase; letter-spacing: 2px; margin-bottom: 6px; }
  .totals .col .val { font-size: 18px; font-weight: 900; font-variant-numeric: tabular-nums; }
  .totals .col.net .lbl { color: rgba(255, 217, 102, 0.7); }
  .totals .col.net .val { font-size: 28px; color: #ffd966; }
  .totals .divider { width: 1px; height: 48px; background: rgba(255,255,255,0.12); }
  .foot { margin-top: auto; padding-top: 24px; border-top: 1px solid #eef1ee; display: flex; justify-content: space-between; font-size: 9px; color: #9aa6a0; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px; }
</style></head><body>
<div class="sheet">
  <div class="hdr">
    <div class="brand">
      ${businessLogo ? `<div class="logo"><img src="${businessLogo}" alt=""/></div>` : `<div class="logo fallback">${businessName.substring(0,2).toUpperCase()}</div>`}
      <div>
        <div class="name">${businessName}</div>
        <div class="sub">Return Note</div>
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
            : `<div class="ava fallback">${entityName.substring(0,2).toUpperCase()}</div>`}
    <div class="info">
      <div class="label">${entityLabel}</div>
      <div class="val">${entityName}</div>
    </div>
    <span class="badge ${note.status}">${note.status}</span>
  </div>

  <div class="stats">
    <div class="stat"><div class="k">Orders</div><div class="v">${note.order_count}</div></div>
    <div class="stat"><div class="k">Gross Amount</div><div class="v">${Number(note.total_amount).toFixed(2)} MAD</div></div>
    <div class="stat"><div class="k">Return Fees</div><div class="v red">-${Number(note.total_shipping_fees).toFixed(2)} MAD</div></div>
  </div>

  <table>
    <thead><tr><th>#</th><th>Tracking</th><th class="right">Amount</th><th class="right">Fee</th><th class="right">Net</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div class="col"><div class="lbl">Gross</div><div class="val">${Number(note.total_amount).toFixed(2)} MAD</div></div>
    <div class="divider"></div>
    <div class="col"><div class="lbl">Return Fees</div><div class="val">-${Number(note.total_shipping_fees).toFixed(2)} MAD</div></div>
    <div class="divider"></div>
    <div class="col net"><div class="lbl">Net Value</div><div class="val">${Number(note.net_amount).toFixed(2)} MAD</div></div>
  </div>

  <div class="foot">
    <span>${businessName} • Return Note</span>
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
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Return Notes</h1>
                            <p className="text-gray-500 font-light">Track and reconcile returned parcels from delivery providers.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button onClick={() => { setIsWizardOpen(true); setWizardStep(0); setSelectedProvider(null); }}
                                disabled={!activeGroups.length}
                                className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 group flex items-center gap-2">
                                <Plus className="w-5 h-5 mr-3 group-hover:rotate-90 transition-transform duration-500" />
                                {activeTab === 'courier' ? 'Generate Courier Return Note' : 'Generate Return Note'}
                            </Button>
                        </div>
                    </div>
                    {sellerShippingCtx && sellerShippingCtx.productIds.length === 0 && (
                        <div className="mt-6 p-4 rounded-2xl bg-amber-50 border border-amber-100 text-amber-900 text-sm font-semibold">
                            No products are assigned to your account. Assign products in your profile to generate return notes for your orders.
                        </div>
                    )}
                </div>
            </div>

            {/* Tabs (Company / Courier) */}
            <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as 'company' | 'courier'); setSelectedProvider(null); }} className="space-y-8">
                <TabsList className="bg-white/50 p-1.5 rounded-[20px] border border-brand-navy/5 h-14 backdrop-blur-sm">
                    <TabsTrigger
                        value="company"
                        className="rounded-[16px] px-8 h-full font-black text-xs tracking-widest uppercase data-[state=active]:bg-brand-navy data-[state=active]:text-white data-[state=active]:shadow-lg transition-all gap-2"
                    >
                        <Building2 className="w-4 h-4" /> Company Notes
                    </TabsTrigger>
                    <TabsTrigger
                        value="courier"
                        className="rounded-[16px] px-8 h-full font-black text-xs tracking-widest uppercase data-[state=active]:bg-brand-navy data-[state=active]:text-white data-[state=active]:shadow-lg transition-all gap-2"
                    >
                        <Truck className="w-4 h-4" /> Courier Notes
                    </TabsTrigger>
                </TabsList>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: 'Returned Orders', value: stats.totalReturnOrders, icon: RotateCcw, accent: 'red' },
                    { label: 'Pending Notes', value: stats.pendingNotes, icon: Clock, accent: 'amber' },
                    { label: 'Received Notes', value: stats.receivedNotes, icon: PackageCheck, accent: 'emerald' },
                    { label: 'Pending Value', value: `${stats.pendingAmount.toFixed(2)} MAD`, icon: DollarSign, accent: 'orange' },
                ].map((s, i) => (
                    <Card key={i} className="group border-none bg-white/50 backdrop-blur-sm hover:shadow-xl transition-all duration-500 rounded-[24px]">
                        <CardContent className="p-5 flex items-center gap-4">
                            <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center",
                                s.accent === 'red' ? 'bg-red-50 text-red-600' : s.accent === 'amber' ? 'bg-amber-50 text-amber-600' :
                                    s.accent === 'emerald' ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-orange-600')}>
                                <s.icon className="w-5 h-5" />
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest">{s.label}</p>
                                <p className={cn("text-xl font-black",
                                    s.accent === 'red' ? 'text-red-700' : s.accent === 'amber' ? 'text-amber-700' :
                                        s.accent === 'emerald' ? 'text-emerald-700' : 'text-orange-700')}>{s.value}</p>
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
                    {(['all', 'pending', 'received'] as const).map(s => (
                        <button key={s} onClick={() => setFilterStatus(s)}
                            className={cn("px-5 py-2.5 rounded-[14px] text-sm font-bold transition-all",
                                filterStatus === s ? "bg-red-600 text-white shadow-lg" : "text-brand-navy/60 hover:bg-brand-navy/5")}>
                            {s === 'all' ? 'All Notes' : s === 'pending' ? 'Pending' : 'Received'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Return Notes List */}
            {isLoading ? (
                <div className="space-y-5">{[1, 2, 3].map(i => <Skeleton key={i} className="h-36 w-full rounded-[32px]" />)}</div>
            ) : filteredNotes.length === 0 ? (
                <Card className="border-none bg-white/30 backdrop-blur-sm rounded-[32px]">
                    <CardContent className="p-16 text-center">
                        <div className="w-20 h-20 rounded-3xl bg-red-50 flex items-center justify-center mx-auto mb-6">
                            <SearchX className="w-8 h-8 text-red-300" />
                        </div>
                        <h3 className="text-xl font-black text-brand-navy/40">No return notes</h3>
                        <p className="text-sm text-muted-foreground mt-2">Generate your first return note from returned parcels.</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-5">
                    {filteredNotes.map((note: ReturnNote) => {
                        const isExpanded = expandedCards.has(note.id);
                        const isReceived = note.status === 'received';
                        return (
                            <Card key={note.id} className="group relative overflow-hidden border-none bg-white/50 backdrop-blur-sm hover:shadow-2xl transition-all duration-500 rounded-[32px]">
                                <div className={cn("absolute top-0 left-0 w-full h-1.5 transition-colors",
                                    isReceived ? "bg-emerald-500" : "bg-red-500")} />

                                <CardContent className="p-0">
                                    <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-5">
                                        <div className="flex items-center gap-5 flex-1 min-w-0">
                                            <EntityLogo
                                                kind={note.kind}
                                                logoUrl={note.provider?.logo_url || null}
                                                avatarUrl={note.courier?.avatar_url || null}
                                                name={note.kind === 'courier' ? (note.courier?.name || '??') : (note.provider?.name || '??')}
                                                size="md"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-3">
                                                    <h3 className="text-xl font-black text-brand-navy tracking-tight truncate">{note.reference}</h3>
                                                    <Badge className={cn("border-none font-bold text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-lg",
                                                        isReceived ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
                                                        {isReceived ? 'Received' : 'Pending'}
                                                    </Badge>
                                                </div>
                                                <div className="flex items-center gap-4 text-muted-foreground mt-1.5">
                                                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                                                        {note.kind === 'courier' ? <Truck className="w-3.5 h-3.5" /> : <Building2 className="w-3.5 h-3.5" />}
                                                        {note.kind === 'courier' ? (note.courier?.name || '—') : (note.provider?.name || '—')}
                                                    </span>
                                                    <span className="flex items-center gap-1.5 text-xs font-semibold"><Package className="w-3.5 h-3.5" />{note.order_count} orders</span>
                                                    <span className="flex items-center gap-1.5 text-xs font-semibold"><Clock className="w-3.5 h-3.5" />{format(new Date(note.created_at), 'dd MMM yyyy')}</span>
                                                    {isReceived && note.received_at && <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" />Received {format(new Date(note.received_at), 'dd MMM')}</span>}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-5">
                                            <div className="text-right">
                                                <span className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest">Total Value</span>
                                                <p className={cn("text-2xl font-black", isReceived ? "text-emerald-600" : "text-red-600")}>
                                                    {Number(note.total_amount).toFixed(2)} <span className="text-sm">MAD</span>
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
                                                {!isReceived && (
                                                    <Button size="sm" onClick={() => markReceivedMutation.mutate(note)}
                                                        disabled={markReceivedMutation.isPending}
                                                        className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl h-10 px-4 font-bold text-xs shadow-lg shadow-emerald-200">
                                                        {markReceivedMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><PackageCheck className="w-3.5 h-3.5 mr-1.5" />Mark Received</>}
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

            </Tabs>

            {/* ─── WIZARD MODAL ─── */}
            <Dialog open={isWizardOpen} onOpenChange={v => { if (!v) { setIsWizardOpen(false); setWizardStep(0); setSelectedProvider(null); } }}>
                <DialogContent className="max-w-3xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
                    <DialogHeader className="p-10 pb-6">
                        <DialogTitle className="text-3xl font-black text-brand-navy">
                            {wizardStep === 0 ? 'Select Provider' : 'Review & Generate'}
                        </DialogTitle>
                        <DialogDescription className="text-base font-medium">
                            {wizardStep === 0 ? 'Choose a delivery provider to generate a return note for.' : 'Review the returned orders and confirm generation.'}
                        </DialogDescription>
                    </DialogHeader>

                    {/* Step indicator */}
                    <div className="px-10 flex items-center gap-3 mb-2">
                        {[0, 1].map(s => (
                            <React.Fragment key={s}>
                                <div className={cn("w-10 h-10 rounded-2xl flex items-center justify-center text-sm font-black transition-all",
                                    wizardStep >= s ? "bg-red-600 text-white shadow-lg" : "bg-brand-navy/5 text-brand-navy/30")}>
                                    {s + 1}
                                </div>
                                {s < 1 && <div className={cn("flex-1 h-1 rounded-full transition-colors", wizardStep > s ? "bg-red-600" : "bg-brand-navy/10")} />}
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
                                        <p className="text-lg font-black text-brand-navy/40">No returned orders available</p>
                                        <p className="text-sm text-muted-foreground mt-1">All returned orders have been accounted for.</p>
                                    </div>
                                ) : activeGroups.map(g => (
                                    <div key={g.target_id} onClick={() => setSelectedProvider(g.target_id)}
                                        className={cn("p-5 rounded-[24px] flex items-center justify-between cursor-pointer transition-all duration-300",
                                            selectedProvider === g.target_id
                                                ? "bg-red-50 ring-2 ring-red-500 shadow-lg"
                                                : "bg-white hover:bg-slate-50 border border-slate-100 hover:border-red-200")}>
                                        <div className="flex items-center gap-4">
                                            <EntityLogo kind={g.kind} logoUrl={g.logo_url} avatarUrl={g.avatar_url} name={g.target_name} size="md" />
                                            <div>
                                                <h4 className="text-lg font-black text-brand-navy">{g.target_name}</h4>
                                                <p className="text-xs font-semibold text-muted-foreground">{g.orders.length} returned orders · {g.total_amount.toFixed(2)} MAD total</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-lg font-black text-red-600">{g.total_amount.toFixed(2)} MAD</p>
                                            <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">total value</p>
                                        </div>
                                    </div>
                                ))}
                                <div className="flex justify-end gap-3 pt-4">
                                    <Button variant="outline" onClick={() => setIsWizardOpen(false)}
                                        className="rounded-2xl h-12 px-6 font-bold border-brand-navy/10">Cancel</Button>
                                    <Button disabled={!selectedProvider} onClick={() => setWizardStep(1)}
                                        className="bg-red-600 hover:bg-red-700 text-white rounded-2xl h-12 px-8 font-bold shadow-xl">
                                        Next <ArrowRight className="w-4 h-4 ml-2" />
                                    </Button>
                                </div>
                            </div>
                        )}

                        {wizardStep === 1 && selectedGroup && (
                            <div className="space-y-6">
                                <div className="flex items-center gap-4 p-5 bg-red-50 rounded-[24px]">
                                    <EntityLogo kind={selectedGroup.kind} logoUrl={selectedGroup.logo_url} avatarUrl={selectedGroup.avatar_url} name={selectedGroup.target_name} size="md" />
                                    <div>
                                        <p className="text-lg font-black text-brand-navy">{selectedGroup.target_name}</p>
                                        <p className="text-xs font-semibold text-muted-foreground">{selectedGroup.orders.length} returned orders to include</p>
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
                                                <td className="p-4 font-mono text-xs font-semibold">{o.courier_parcels?.[0]?.tracking_code || o.parcels?.[0]?.tracking_code || o.tracking_number || 'N/A'}</td>
                                                <td className="p-4 text-right font-semibold">{Number(o.price || 0).toFixed(2)}</td>
                                                <td className="p-4 text-right text-red-500 font-semibold">-{getReturnFeeForOrder(o).toFixed(2)}</td>
                                                <td className="p-4 text-right font-black text-brand-navy">{(Number(o.price || 0) - getReturnFeeForOrder(o)).toFixed(2)}</td>
                                            </tr>
                                        ))}</tbody>
                                    </table>
                                </div>

                                <div className="bg-red-700 rounded-[24px] p-6 text-white">
                                    <div className="grid grid-cols-3 gap-6 text-center">
                                        <div><span className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1">Total Amount</span>
                                            <span className="text-xl font-black">{selectedGroup.total_amount.toFixed(2)}</span></div>
                                        <div><span className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1">Shipping Fees</span>
                                            <span className="text-xl font-black text-red-200">-{selectedGroup.total_shipping.toFixed(2)}</span></div>
                                        <div><span className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1">Net Value</span>
                                            <span className="text-xl font-black text-amber-200">{selectedGroup.net_amount.toFixed(2)}</span></div>
                                    </div>
                                </div>

                                <div className="flex justify-end gap-3">
                                    <Button variant="outline" onClick={() => setWizardStep(0)}
                                        className="rounded-2xl h-12 px-6 font-bold border-brand-navy/10">Back</Button>
                                    <Button onClick={() => generateNoteMutation.mutate(selectedGroup)}
                                        disabled={generateNoteMutation.isPending}
                                        className="bg-red-600 hover:bg-red-700 text-white rounded-2xl h-12 px-8 font-bold shadow-xl shadow-red-200">
                                        {generateNoteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FileText className="w-4 h-4 mr-2" />}
                                        Generate Return Note
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
                                        name={selectedNote.kind === 'courier' ? (selectedNote.courier?.name || '??') : (selectedNote.provider?.name || '??')}
                                        size="lg"
                                    />
                                    <div>
                                        <DialogTitle className="text-2xl font-black text-brand-navy">{selectedNote.reference}</DialogTitle>
                                        <div className="flex items-center gap-2 mt-1">
                                            <Badge className={cn("border-none font-bold text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-lg",
                                                selectedNote.status === 'received' ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
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
                                    {selectedNote.received_at && (
                                        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100">
                                            <span className="text-[10px] font-black text-emerald-600/60 uppercase tracking-widest">Received</span>
                                            <p className="font-bold text-emerald-700 mt-1">{format(new Date(selectedNote.received_at), 'dd MMM yyyy, HH:mm')}</p>
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

                                <div className="bg-red-700 rounded-[24px] p-6 text-white grid grid-cols-3 gap-6 text-center">
                                    <div><span className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1">Total</span><span className="text-xl font-black">{Number(selectedNote.total_amount).toFixed(2)}</span></div>
                                    <div><span className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1">Shipping</span><span className="text-xl font-black text-red-200">-{Number(selectedNote.total_shipping_fees).toFixed(2)}</span></div>
                                    <div><span className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1">Net</span><span className="text-xl font-black text-amber-200">{Number(selectedNote.net_amount).toFixed(2)}</span></div>
                                </div>

                                <div className="flex justify-end gap-3">
                                    <Button variant="outline" onClick={() => handlePrint(selectedNote)}
                                        className="rounded-2xl h-12 px-6 font-bold border-brand-navy/10">
                                        <Printer className="w-4 h-4 mr-2" />Print
                                    </Button>
                                    {selectedNote.status === 'pending' && (
                                        <Button onClick={() => markReceivedMutation.mutate(selectedNote)}
                                            disabled={markReceivedMutation.isPending}
                                            className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl h-12 px-8 font-bold shadow-xl shadow-emerald-200">
                                            {markReceivedMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <PackageCheck className="w-4 h-4 mr-2" />}
                                            Mark as Received
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

export default ReturnNote;
