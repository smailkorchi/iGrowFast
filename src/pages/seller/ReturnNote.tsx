import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import {
    Plus, Search, Loader2, Package, Eye, FileText,
    CheckCircle2, Clock, Building2, AlertTriangle, Truck,
    ChevronDown, ChevronRight, Printer, ArrowRight, SearchX,
    PackageCheck
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { OrderTrackingImport } from '@/components/orders/OrderTrackingImport';
import { format } from 'date-fns';
import { orderMatchesSellerProducts } from '@/components/delivery/DeliveryNoteWizard';
import { pickShippedCompanyTrackingCode, pickShippedCourierTrackingCode } from '@/lib/orders/getLatestTrackableCompanyParcel';
import { resolveProviderLogo } from '@/lib/providerLogos';

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
    parcels: { tracking_code: string | null; provider: { id: string; name: string; provider_type: string | null; logo_url: string | null } | null }[];
    courier_parcels: { tracking_code: string | null }[];
    company: { id: string; name: string; provider_type: string | null; logo_url: string | null } | null;
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
    provider: { id: string; name: string; provider_type: string | null; logo_url: string | null } | null;
    courier?: { id: string; name: string; avatar_url: string | null } | null;
    line_items: { id: string; order_id: string; tracking_code: string | null; amount: number; shipping_fee: number }[];
}

const ReturnNote = () => {
    const [activeTab, setActiveTab] = useState<'company' | 'courier'>('company');
    const [isWizardOpen, setIsWizardOpen] = useState(false);
    const [wizardStep, setWizardStep] = useState(0);
    const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
    // Per-order selection for the new "Select orders" step. Initialized
    // when the wizard moves from step 0 → step 1; user can uncheck lines.
    const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
    // See admin ReturnNote: untouched import replaces, post-manual-selection import adds.
    const [selectionTouched, setSelectionTouched] = useState(false);
    // Free-text search inside the select-orders step. Matches any visible
    // info — name, phone, tracking, product names, price.
    const [orderSearch, setOrderSearch] = useState('');
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
                    company:providers(id, name, provider_type, logo_url),
                    courier:users!orders_courier_id_fkey(id, name, avatar_url, avatar_config),
                    items:order_items(quantity, unit_price, product_id, product:products(name)),
                    parcels:company_parcels(tracking_code, provider:providers(id, name, provider_type, logo_url), company_delivery_note_id, created_at),
                    courier_parcels(tracking_code, courier_delivery_note_id, created_at)`)
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
                    .select(`*, provider:providers(id, name, provider_type, logo_url), line_items:company_return_note_orders(id, order_id, tracking_code, amount, shipping_fee)`)
                    .eq('DigiCom Business', activeBusinessId)
                    .eq('created_by', sellerShippingCtx.userId)
                    .order('created_at', { ascending: false }),
                (supabase as any)
                    .from('courier_return_notes')
                    .select(`*, courier:users!courier_return_notes_courier_id_fkey(id, name, avatar_url, avatar_config), line_items:courier_return_note_orders(id, order_id, tracking_code, amount, shipping_fee)`)
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
                fetchAllRows('company_fees', 'company_id, master_city_id, return_fee', { filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId }] }),
                fetchAllRows('courier_fees', 'courier_id, master_city_id, return_fee', { filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId }] }),
            ]);
            const company: Record<string, number> = {};
            for (const row of (cf || [])) {
                if (row.company_id && row.master_city_id) company[`${row.company_id}:${row.master_city_id}`] = Number(row.return_fee || 0);
            }
            const courier: Record<string, number> = {};
            for (const row of (kf || [])) {
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
                const logoUrl = resolveProviderLogo(order.company) ?? resolveProviderLogo(order.parcels?.[0]?.provider);
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

    // Group the Review step and generate mutation operate on — only the
    // lines the user has checked in the Select-orders step.
    const filteredGroup = useMemo<TargetGroup | null>(() => {
        if (!selectedGroup) return null;
        const orders = selectedOrderIds.size === 0
            ? selectedGroup.orders
            : selectedGroup.orders.filter(o => selectedOrderIds.has(o.id));
        let total_amount = 0;
        let total_shipping = 0;
        for (const o of orders) {
            total_amount += Number(o.price || 0);
            total_shipping += getReturnFeeForOrder(o);
        }
        return {
            ...selectedGroup,
            orders,
            total_amount,
            total_shipping,
            net_amount: total_amount - total_shipping,
        };
    }, [selectedGroup, selectedOrderIds, getReturnFeeForOrder]);

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
                    ? pickShippedCourierTrackingCode(o)
                    : pickShippedCompanyTrackingCode(o),
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
            setIsWizardOpen(false); setWizardStep(0); setSelectedProvider(null); setSelectedOrderIds(new Set()); setOrderSearch('');
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
        const sizeClasses = { sm: 'w-8 h-8 rounded-lg', md: 'w-10 h-10 rounded-lg', lg: 'w-10 h-10 rounded-lg' };
        const textSize = { sm: 'text-[10px]', md: 'text-[11px]', lg: 'text-[11px]' };
        if (logoUrl) {
            return (
                <div className={cn(sizeClasses[size], "bg-ant-light border border-ant-line p-1 flex items-center justify-center overflow-hidden")}>
                    <img src={logoUrl} alt={name} className="max-w-full max-h-full object-contain" />
                </div>
            );
        }
        return (
            <div className={cn(sizeClasses[size], "bg-ant-line flex items-center justify-center")}>
                <span className={cn("font-semibold text-ant-mid", textSize[size])}>{name?.substring(0, 2).toUpperCase()}</span>
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
        const sizeClasses = { sm: 'w-8 h-8 rounded-lg', md: 'w-10 h-10 rounded-lg', lg: 'w-10 h-10 rounded-lg' };
        const textSize = { sm: 'text-[10px]', md: 'text-[11px]', lg: 'text-[11px]' };
        if (kind === 'company' && logoUrl) {
            return (
                <div className={cn(sizeClasses[size], "bg-ant-light border border-ant-line p-1 flex items-center justify-center overflow-hidden")}>
                    <img src={logoUrl} alt={name} className="max-w-full max-h-full object-contain" />
                </div>
            );
        }
        if (kind === 'courier' && avatarUrl) {
            return (
                <div className={cn(sizeClasses[size], "overflow-hidden border border-ant-line")}>
                    <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
                </div>
            );
        }
        return (
            <div className={cn(sizeClasses[size], kind === 'courier' ? 'bg-ant-ink/10 text-ant-ink' : 'bg-ant-line text-ant-mid', 'flex items-center justify-center')}>
                <span className={cn("font-semibold", textSize[size])}>{name?.substring(0, 2).toUpperCase()}</span>
            </div>
        );
    };

    // ─── Print helper ───
    const handlePrint = async (note: ReturnNote) => {
        const w = window.open('', '_blank');
        if (!w) return;
        w.document.write('<!doctype html><html><head><title>' + note.reference + '</title></head><body style="font-family:system-ui;padding:40px;color:#3b5e5e">Loading…</body></html>');
        w.document.close();

        let businessName = 'iGrowFast';
        let businessLogo: string | null = null;
        if (activeBusinessId) {
            const { data } = await (supabase as any).from('businesses').select('name, logo').eq('id', activeBusinessId).single();
            if (data) { businessName = data.name || businessName; businessLogo = data.logo || null; }
        }

        const entityName = note.kind === 'courier' ? (note.courier?.name || 'Unknown courier') : (note.provider?.name || 'Unknown provider');
        const providerLogo = resolveProviderLogo(note.provider);
        const entityImage = note.kind === 'courier'
            ? (note.courier?.avatar_url || null)
            : (providerLogo ? `${window.location.origin}${providerLogo}` : null);
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
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Lora:ital,wght@1,400;1,500&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  html, body { margin: 0; padding: 0; background: #faf9f5; color: #141413; font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-feature-settings: "ss01","cv11"; }
  .sheet { padding: 20mm 16mm; min-height: 297mm; display: flex; flex-direction: column; background: #faf9f5; }
  .stripe { height: 3px; background: #D97706; margin: -20mm -16mm 22px; }
  .hdr { display: flex; align-items: flex-start; justify-content: space-between; padding-bottom: 22px; border-bottom: 1px solid #e8e6dc; }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand .logo { width: 52px; height: 52px; border-radius: 14px; background: #ffffff; border: 1px solid #e8e6dc; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 4px; }
  .brand .logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .brand .logo.fallback { background: #141413; color: #faf9f5; font-family: 'Poppins', sans-serif; font-weight: 600; font-size: 17px; letter-spacing: -0.02em; padding: 0; }
  .brand .name { font-family: 'Poppins', sans-serif; font-size: 18px; font-weight: 600; color: #141413; letter-spacing: -0.02em; line-height: 1.1; }
  .brand .sub { display: inline-flex; align-items: center; gap: 6px; font-size: 9px; font-weight: 500; color: #6B6760; text-transform: uppercase; letter-spacing: 0.28em; margin-top: 6px; }
  .brand .sub::before { content: ''; width: 5px; height: 5px; border-radius: 999px; background: #D97706; }
  .meta { text-align: right; }
  .meta .kicker { display: inline-flex; align-items: center; gap: 6px; font-size: 9px; font-weight: 500; color: #6B6760; text-transform: uppercase; letter-spacing: 0.28em; margin-bottom: 6px; }
  .meta .kicker::before { content: ''; width: 5px; height: 5px; border-radius: 999px; background: #D97706; }
  .meta h1 { margin: 0; font-family: 'Poppins', sans-serif; font-size: 26px; font-weight: 600; color: #141413; letter-spacing: -0.03em; }
  .meta .date { font-family: 'Lora', Georgia, serif; font-style: italic; font-size: 12px; color: #6B6760; margin-top: 6px; }
  .entity { margin-top: 24px; display: flex; align-items: center; gap: 16px; padding: 18px 20px; background: #ffffff; border: 1px solid #e8e6dc; border-radius: 16px; position: relative; overflow: hidden; }
  .entity::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: #141413; }
  .entity .ava { width: 52px; height: 52px; border-radius: 14px; overflow: hidden; background: #faf9f5; border: 1px solid #e8e6dc; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .entity .ava img { width: 100%; height: 100%; object-fit: ${note.kind === 'courier' ? 'cover' : 'contain'}; padding: ${note.kind === 'courier' ? '0' : '5px'}; }
  .entity .ava.fallback { background: ${note.kind === 'courier' ? '#141413' : '#f4d9c9'}; color: ${note.kind === 'courier' ? '#faf9f5' : '#D97706'}; font-family: 'Poppins', sans-serif; font-weight: 600; font-size: 18px; padding: 0; }
  .entity .info .label { display: inline-flex; align-items: center; gap: 6px; font-size: 9px; font-weight: 500; color: #6B6760; text-transform: uppercase; letter-spacing: 0.22em; margin-bottom: 5px; }
  .entity .info .label::before { content: ''; width: 5px; height: 5px; border-radius: 999px; background: #141413; }
  .entity .info .val { font-family: 'Poppins', sans-serif; font-size: 19px; font-weight: 600; color: #141413; letter-spacing: -0.02em; }
  .entity .badge { margin-left: auto; padding: 6px 12px; border-radius: 999px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.14em; display: inline-flex; align-items: center; gap: 6px; border: 1px solid; }
  .entity .badge::before { content: ''; width: 5px; height: 5px; border-radius: 999px; }
  .entity .badge.pending { background: rgba(217,119,6,0.10); color: #D97706; border-color: rgba(217,119,6,0.25); }
  .entity .badge.pending::before { background: #D97706; }
  .entity .badge.received { background: rgba(45,122,62,0.10); color: #2D7A3E; border-color: rgba(45,122,62,0.25); }
  .entity .badge.received::before { background: #2D7A3E; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; margin-top: 18px; background: #e8e6dc; border: 1px solid #e8e6dc; border-radius: 16px; overflow: hidden; }
  .stat { padding: 16px 18px; background: #ffffff; }
  .stat .k { display: inline-flex; align-items: center; gap: 6px; font-size: 9px; font-weight: 500; color: #6B6760; text-transform: uppercase; letter-spacing: 0.22em; margin-bottom: 8px; }
  .stat .k::before { content: ''; width: 5px; height: 5px; border-radius: 999px; background: #141413; }
  .stat.warn .k::before { background: #D97706; }
  .stat.danger .k::before { background: #c96356; }
  .stat .v { font-family: 'Poppins', sans-serif; font-size: 20px; font-weight: 600; color: #141413; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
  .stat .v.red { color: #c96356; }
  .stat .v .unit { font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 400; color: #6B6760; margin-left: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 22px; font-variant-numeric: tabular-nums; background: #ffffff; border: 1px solid #e8e6dc; border-radius: 16px; overflow: hidden; }
  thead th { text-align: left; padding: 11px 16px; font-size: 9px; font-weight: 500; color: #6B6760; text-transform: uppercase; letter-spacing: 0.18em; border-bottom: 1px solid #e8e6dc; background: #faf9f5; }
  thead th.right { text-align: right; }
  tbody td { padding: 12px 16px; font-size: 12px; border-bottom: 1px solid #e8e6dc; color: #141413; }
  tbody tr:last-child td { border-bottom: none; }
  td.num { font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace; font-size: 10px; color: #6B6760; font-weight: 500; width: 48px; }
  td.track { font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace; font-size: 11px; font-weight: 500; letter-spacing: -0.02em; color: #141413; }
  td.right { text-align: right; font-family: 'Poppins', sans-serif; font-weight: 600; }
  td.red { color: #c96356; }
  td.bold { font-family: 'Poppins', sans-serif; font-weight: 600; color: #141413; }
  .totals { margin-top: 20px; padding: 22px 24px; background: #141413; color: #ffffff; border-radius: 16px; display: flex; justify-content: space-between; align-items: center; position: relative; overflow: hidden; }
  .totals::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: #D97706; }
  .totals .col .lbl { display: inline-flex; align-items: center; gap: 6px; font-size: 9px; font-weight: 500; color: rgba(255,255,255,0.5); text-transform: uppercase; letter-spacing: 0.22em; margin-bottom: 8px; }
  .totals .col .lbl::before { content: ''; width: 5px; height: 5px; border-radius: 999px; background: rgba(255,255,255,0.5); }
  .totals .col .val { font-family: 'Poppins', sans-serif; font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
  .totals .col .val .unit { font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 400; color: rgba(255,255,255,0.55); margin-left: 4px; }
  .totals .col.net .lbl { color: rgba(217,119,6,0.9); }
  .totals .col.net .lbl::before { background: #D97706; }
  .totals .col.net .val { font-size: 28px; color: #D97706; }
  .totals .divider { width: 1px; height: 52px; background: rgba(255,255,255,0.12); }
  .foot { margin-top: auto; padding-top: 22px; border-top: 1px solid #e8e6dc; display: flex; justify-content: space-between; align-items: center; font-size: 9px; color: #6B6760; font-weight: 500; text-transform: uppercase; letter-spacing: 0.18em; }
  .foot .italic { font-family: 'Lora', Georgia, serif; font-style: italic; text-transform: none; letter-spacing: 0; font-size: 11px; font-weight: 400; }
</style></head><body>
<div class="sheet">
  <div class="stripe"></div>
  <div class="hdr">
    <div class="brand">
      ${businessLogo ? `<div class="logo"><img src="${businessLogo}" alt=""/></div>` : `<div class="logo fallback">${businessName.substring(0,2).toUpperCase()}</div>`}
      <div>
        <div class="name">${businessName}</div>
        <div class="sub">Bon de retour · Document</div>
      </div>
    </div>
    <div class="meta">
      <div class="kicker">Référence</div>
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
    <span class="badge ${note.status}">${note.status === 'received' ? 'Reçu' : 'En attente'}</span>
  </div>

  <div class="stats">
    <div class="stat"><div class="k">Commandes</div><div class="v">${note.order_count}</div></div>
    <div class="stat warn"><div class="k">Montant brut</div><div class="v">${Number(note.total_amount).toFixed(2)}<span class="unit">MAD</span></div></div>
    <div class="stat danger"><div class="k">Frais de retour</div><div class="v red">-${Number(note.total_shipping_fees).toFixed(2)}<span class="unit">MAD</span></div></div>
  </div>

  <table>
    <thead><tr><th>#</th><th>Tracking</th><th class="right">Montant</th><th class="right">Frais</th><th class="right">Net</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div class="col"><div class="lbl">Brut</div><div class="val">${Number(note.total_amount).toFixed(2)}<span class="unit">MAD</span></div></div>
    <div class="divider"></div>
    <div class="col"><div class="lbl">Frais de retour</div><div class="val">-${Number(note.total_shipping_fees).toFixed(2)}<span class="unit">MAD</span></div></div>
    <div class="divider"></div>
    <div class="col net"><div class="lbl">Valeur nette</div><div class="val">${Number(note.net_amount).toFixed(2)}<span class="unit">MAD</span></div></div>
  </div>

  <div class="foot">
    <span>${businessName} · Bon de retour</span>
    <span class="italic">${note.reference}</span>
  </div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},160);};</script>
</body></html>`;

        w.document.open();
        w.document.write(html);
        w.document.close();
    };

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Commercial · Retours
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Bons de retour
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Suivez et réconciliez les colis retournés — ce qui attend réception, ce qui est revenu en stock, la valeur encore en suspens.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => { setIsWizardOpen(true); setWizardStep(0); setSelectedProvider(null); setSelectedOrderIds(new Set()); setOrderSearch(''); }}
                        disabled={!activeGroups.length}
                        className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink hover:bg-ant-ink/90 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[12px] font-semibold cursor-pointer shrink-0 transition-colors"
                    >
                        <Plus className="w-3.5 h-3.5" strokeWidth={1.75} />
                        {activeTab === 'courier' ? 'Retour coursier' : 'Bon de retour'}
                    </button>
                </header>

                {sellerShippingCtx && sellerShippingCtx.productIds.length === 0 && (
                    <section className="rounded-2xl border border-ant-orange/25 bg-ant-orange/10 overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="px-4 py-3 flex items-center gap-3">
                            <div className="h-8 w-8 rounded-lg border border-ant-orange/25 bg-ant-orange/10 text-ant-orange flex items-center justify-center shrink-0">
                                <SearchX className="w-4 h-4" strokeWidth={1.75} />
                            </div>
                            <p className="font-serif italic text-[12px] text-ant-orange">
                                Aucun produit n&apos;est assigné à votre compte. Demandez à un administrateur d&apos;en rattacher pour générer des bons de retour.
                            </p>
                        </div>
                    </section>
                )}

                {/* Tabs */}
                <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as 'company' | 'courier'); setSelectedProvider(null); }} className="space-y-5">
                    <TabsList className="h-10 rounded-full p-1 bg-ant-paper border border-ant-line inline-flex w-auto">
                        <TabsTrigger value="company" className="text-[12px] h-8 px-3.5 rounded-full gap-1.5 font-semibold data-[state=active]:bg-ant-ink data-[state=active]:text-white text-ant-mid">
                            <Building2 className="w-3.5 h-3.5" />
                            Bons transporteur
                        </TabsTrigger>
                        <TabsTrigger value="courier" className="text-[12px] h-8 px-3.5 rounded-full gap-1.5 font-semibold data-[state=active]:bg-ant-ink data-[state=active]:text-white text-ant-mid">
                            <Truck className="w-3.5 h-3.5" />
                            Bons coursier
                        </TabsTrigger>
                    </TabsList>

                {/* KPI strip */}
                <section className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                    {[
                        { label: 'Commandes retournées', value: stats.totalReturnOrders, dot: 'bg-ant-rose', text: 'text-ant-rose' },
                        { label: 'Bons en attente', value: stats.pendingNotes, dot: 'bg-ant-orange', text: 'text-ant-orange' },
                        { label: 'Bons réceptionnés', value: stats.receivedNotes, dot: 'bg-ant-green', text: 'text-ant-green' },
                        { label: 'Valeur en attente', value: `${stats.pendingAmount.toFixed(2)}`, unit: 'MAD', dot: 'bg-ant-ink', text: 'text-ant-ink' },
                    ].map((s, i) => (
                        <div key={i} className="bg-ant-paper p-4">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                                {s.label}
                            </div>
                            <p className={`font-display text-[20px] font-semibold tabular-nums mt-2 truncate ${s.text}`}>
                                {s.value}
                                {s.unit && <span className="text-[11px] text-ant-mid font-normal ml-1">{s.unit}</span>}
                            </p>
                        </div>
                    ))}
                </section>

                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                    <div className="relative w-full sm:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                        <Input
                            placeholder="Rechercher par référence ou prestataire…"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 h-9 rounded-full border-ant-line bg-ant-paper text-[12px] focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                        />
                    </div>
                    <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper shrink-0">
                        {(['all', 'pending', 'received'] as const).map((s) => (
                            <button
                                key={s}
                                onClick={() => setFilterStatus(s)}
                                className={cn(
                                    'h-7 px-3 rounded-full text-[11px] font-semibold transition-colors cursor-pointer',
                                    filterStatus === s
                                        ? 'bg-ant-ink text-white'
                                        : 'text-ant-mid hover:text-ant-ink',
                                )}
                            >
                                {s === 'all' ? 'Tous' : s === 'pending' ? 'En attente' : 'Reçus'}
                            </button>
                        ))}
                    </div>
                </div>

            {/* Return Notes List */}
            {isLoading ? (
                <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
            ) : filteredNotes.length === 0 ? (
                <Card className="border border-ant-line shadow-none rounded-xl">
                    <CardContent className="p-6 text-center">
                        <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-ant-rose/10 mb-2.5">
                            <SearchX className="w-4 h-4 text-ant-rose" />
                        </div>
                        <h3 className="text-[14px] font-semibold text-ant-ink">No return notes</h3>
                        <p className="text-[11px] text-ant-mid mt-0.5">Generate your first return note from returned parcels.</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-2">
                    {filteredNotes.map((note: ReturnNote) => {
                        const isExpanded = expandedCards.has(note.id);
                        const isReceived = note.status === 'received';
                        return (
                            <Card key={note.id} className="group relative overflow-hidden border border-ant-line shadow-none rounded-xl">
                                <div className={cn("absolute top-0 left-0 w-full h-1 transition-colors",
                                    isReceived ? "bg-ant-green" : "bg-ant-rose/100")} />

                                <CardContent className="p-0">
                                    <div className="px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[12px] font-semibold text-ant-ink tracking-tight truncate">{note.reference}</span>
                                                <Badge className={cn("border-none font-bold text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded",
                                                    isReceived ? "bg-ant-green/20 text-ant-green" : "bg-ant-rose/20 text-ant-rose")}>
                                                    {isReceived ? 'Received' : 'Pending'}
                                                </Badge>
                                            </div>
                                            <div className="flex items-center gap-3 text-ant-mid mt-1 flex-wrap">
                                                <span className="flex items-center gap-1 text-[10px]">
                                                    {note.kind === 'courier' ? <Truck className="w-3 h-3" /> : <Building2 className="w-3 h-3" />}
                                                    {note.kind === 'courier' ? (note.courier?.name || '—') : (note.provider?.name || '—')}
                                                </span>
                                                <span className="flex items-center gap-1 text-[10px]"><Package className="w-3 h-3" />{note.order_count} orders</span>
                                                <span className="flex items-center gap-1 text-[10px]"><Clock className="w-3 h-3" />{format(new Date(note.created_at), 'dd MMM yyyy')}</span>
                                                {isReceived && note.received_at && <span className="flex items-center gap-1 text-[10px] text-ant-green"><CheckCircle2 className="w-3 h-3" />Received {format(new Date(note.received_at), 'dd MMM')}</span>}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <div className="text-right mr-1">
                                                <p className="text-[9px] text-ant-mid uppercase tracking-wider">Total</p>
                                                <p className={cn("text-[13px] font-semibold tabular-nums", isReceived ? "text-ant-green" : "text-ant-ink")}>
                                                    {Number(note.total_amount).toFixed(2)} MAD
                                                </p>
                                            </div>
                                            <Button size="icon" variant="ghost" onClick={() => toggleExpand(note.id)} className="h-8 w-8 rounded-md hover:bg-ant-line">
                                                {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-ant-ink/40" /> : <ChevronRight className="w-3.5 h-3.5 text-ant-ink/40" />}
                                            </Button>
                                            <Button size="icon" variant="ghost" onClick={() => handlePrint(note)} className="h-8 w-8 rounded-md hover:bg-ant-line">
                                                <Printer className="w-3.5 h-3.5 text-ant-ink/40" />
                                            </Button>
                                            <Button size="icon" variant="ghost" onClick={() => { setSelectedNote(note); setIsViewNoteOpen(true); }} className="h-8 w-8 rounded-md hover:bg-ant-line">
                                                <Eye className="w-3.5 h-3.5 text-ant-ink/40" />
                                            </Button>
                                            {!isReceived && (
                                                <Button size="sm" onClick={() => markReceivedMutation.mutate(note)}
                                                    disabled={markReceivedMutation.isPending}
                                                    className="bg-ant-green hover:bg-ant-green/90 text-white h-8 rounded-md px-2.5 text-[11px] font-semibold gap-1">
                                                    {markReceivedMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <><PackageCheck className="w-3 h-3" />Mark Received</>}
                                                </Button>
                                            )}
                                        </div>
                                    </div>

                                    {isExpanded && (
                                        <div className="border-t border-ant-line bg-ant-light/50 px-3.5 py-3">
                                            <table className="w-full">
                                                <thead><tr className="text-[9px] uppercase tracking-[0.18em] text-ant-mid border-b border-ant-line">
                                                    <th className="pb-2 text-left font-bold">#</th>
                                                    <th className="pb-2 text-left font-bold">Tracking</th>
                                                    <th className="pb-2 text-right font-bold">Amount</th>
                                                    <th className="pb-2 text-right font-bold">Shipping</th>
                                                    <th className="pb-2 text-right font-bold">Net</th>
                                                </tr></thead>
                                                <tbody>{note.line_items.map((li, i) => (
                                                    <tr key={li.id} className="hover:bg-ant-light transition-colors border-b border-ant-line last:border-0">
                                                        <td className="px-0 py-2 text-[11px] text-ant-ink/80 tabular-nums">{i + 1}</td>
                                                        <td className="py-2 font-mono text-[11px] text-ant-ink/80 tabular-nums">{li.tracking_code || 'N/A'}</td>
                                                        <td className="py-2 text-right text-[11px] text-ant-ink/80 tabular-nums">{Number(li.amount).toFixed(2)}</td>
                                                        <td className="py-2 text-right text-[11px] text-ant-rose tabular-nums">-{Number(li.shipping_fee).toFixed(2)}</td>
                                                        <td className="py-2 text-right text-[11px] font-semibold text-ant-ink tabular-nums">{(Number(li.amount) - Number(li.shipping_fee)).toFixed(2)}</td>
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
            <Dialog open={isWizardOpen} onOpenChange={v => { if (!v) { setIsWizardOpen(false); setWizardStep(0); setSelectedProvider(null); setSelectedOrderIds(new Set()); setOrderSearch(''); } }}>
                <DialogContent className="max-w-3xl p-0 border border-ant-line rounded-xl overflow-hidden max-h-[90vh] overflow-y-auto">
                    <DialogHeader className="p-5 pb-4">
                        <DialogTitle className="text-[15px] font-semibold text-ant-ink">
                            {wizardStep === 0
                                ? 'Select Provider'
                                : wizardStep === 1
                                    ? 'Select Orders'
                                    : 'Review & Generate'}
                        </DialogTitle>
                        <DialogDescription className="text-[11px] text-ant-mid">
                            {wizardStep === 0
                                ? 'Choose a delivery provider to generate a return note for.'
                                : wizardStep === 1
                                    ? 'Pick which returned parcels to include in this note.'
                                    : 'Review the returned orders and confirm generation.'}
                        </DialogDescription>
                    </DialogHeader>

                    {/* Step indicator */}
                    <div className="px-5 flex items-center gap-2 mb-2">
                        {[0, 1, 2].map(s => (
                            <React.Fragment key={s}>
                                <div className={cn("w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-semibold transition-all",
                                    wizardStep >= s ? "bg-ant-ink text-white" : "bg-ant-line text-ant-mid")}>
                                    {s + 1}
                                </div>
                                {s < 2 && <div className={cn("flex-1 h-0.5 rounded-full transition-colors", wizardStep > s ? "bg-ant-ink" : "bg-ant-line")} />}
                            </React.Fragment>
                        ))}
                    </div>

                    {/* min-w-0: grid-item guard so long order/product names can't stretch the
                        modal past its max width (DialogContent is a CSS grid). */}
                    <div className="p-5 pt-4 min-w-0">
                        {wizardStep === 0 && (
                            <div className="space-y-2">
                                {activeGroups.length === 0 ? (
                                    <div className="text-center py-8">
                                        <AlertTriangle className="w-5 h-5 text-amber-400 mx-auto mb-2" />
                                        <p className="text-[13px] font-semibold text-ant-ink/40">No returned orders available</p>
                                        <p className="text-[11px] text-ant-mid mt-1">All returned orders have been accounted for.</p>
                                    </div>
                                ) : activeGroups.map(g => (
                                    <div key={g.target_id} onClick={() => setSelectedProvider(g.target_id)}
                                        className={cn("p-3 rounded-xl flex items-center justify-between cursor-pointer transition-all",
                                            selectedProvider === g.target_id
                                                ? "bg-ant-ink/5 ring-1 ring-brand-navy"
                                                : "bg-white hover:bg-ant-light border border-ant-line")}>
                                        <div className="flex items-center gap-3">
                                            <EntityLogo kind={g.kind} logoUrl={g.logo_url} avatarUrl={g.avatar_url} name={g.target_name} size="sm" />
                                            <div>
                                                <h4 className="text-[12px] font-semibold text-ant-ink">{g.target_name}</h4>
                                                <p className="text-[10px] text-ant-mid">{g.orders.length} returned orders · {g.total_amount.toFixed(2)} MAD total</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[13px] font-semibold text-ant-ink tabular-nums">{g.total_amount.toFixed(2)} MAD</p>
                                            <p className="text-[9px] uppercase tracking-[0.18em] text-ant-mid">total value</p>
                                        </div>
                                    </div>
                                ))}
                                <div className="flex justify-end gap-2 pt-3">
                                    <Button variant="outline" onClick={() => setIsWizardOpen(false)}
                                        className="rounded-md h-8 px-3 text-[11px] font-semibold border-ant-line">Cancel</Button>
                                    <Button disabled={!selectedProvider} onClick={() => {
                                        if (selectedGroup) {
                                            setSelectedOrderIds(new Set(selectedGroup.orders.map(o => o.id)));
                                        }
                                        setSelectionTouched(false);
                                        setWizardStep(1);
                                    }}
                                        className="bg-ant-ink hover:bg-ant-ink/90 text-white rounded-md h-8 px-3 text-[11px] font-semibold">
                                        Next <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                                    </Button>
                                </div>
                            </div>
                        )}

                        {wizardStep === 1 && selectedGroup && (() => {
                            // Free-text match across every bit of order info.
                            const q = orderSearch.trim().toLowerCase();
                            const matches = (o: ReturnOrder) => {
                                if (!q) return true;
                                const trackingCodes = [
                                    ...(o.parcels || []).map(p => p.tracking_code).filter(Boolean),
                                    ...(o.courier_parcels || []).map(p => p.tracking_code).filter(Boolean),
                                    o.tracking_number,
                                ].filter(Boolean) as string[];
                                const items = (o.items || []).map(i => i.product?.name || '').filter(Boolean);
                                const hay = [
                                    o.name,
                                    o.phone,
                                    ...trackingCodes,
                                    ...items,
                                    String(o.price ?? ''),
                                ].join(' ').toLowerCase();
                                return hay.includes(q);
                            };
                            const visibleOrders = selectedGroup.orders.filter(matches);
                            const allSelected = selectedGroup.orders.length > 0
                                && selectedGroup.orders.every(o => selectedOrderIds.has(o.id));
                            return (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-3 p-3 bg-ant-light rounded-xl border border-ant-line">
                                        <EntityLogo kind={selectedGroup.kind} logoUrl={selectedGroup.logo_url} avatarUrl={selectedGroup.avatar_url} name={selectedGroup.target_name} size="sm" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[12px] font-semibold text-ant-ink">{selectedGroup.target_name}</p>
                                            <p className="text-[10px] text-ant-mid">
                                                {selectedGroup.orders.length} orders available — {selectedOrderIds.size} selected
                                            </p>
                                        </div>
                                    </div>

                                    <OrderTrackingImport
                                        orders={selectedGroup.orders.map(o => ({
                                            id: o.id,
                                            trackingCodes: [
                                                o.tracking_number,
                                                ...((o.parcels || []).map(p => p.tracking_code)),
                                                ...((o.courier_parcels || []).map(p => p.tracking_code)),
                                            ],
                                        }))}
                                        totalAvailable={selectedGroup.orders.length}
                                        selectedCount={selectedOrderIds.size}
                                        onApply={(ids) => {
                                            setSelectedOrderIds(prev => selectionTouched ? new Set([...prev, ...ids]) : new Set(ids));
                                        }}
                                    />

                                    <div className="flex items-center gap-2">
                                        <div className="relative flex-1">
                                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                                            <Input
                                                value={orderSearch}
                                                onChange={(e) => setOrderSearch(e.target.value)}
                                                placeholder="Search by name, phone, tracking, product..."
                                                className="h-8 pl-8 pr-7 rounded-md border-ant-line bg-white text-[11px]"
                                            />
                                            {orderSearch && (
                                                <button
                                                    type="button"
                                                    onClick={() => setOrderSearch('')}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded hover:bg-ant-light flex items-center justify-center text-ant-mid"
                                                    aria-label="Clear search"
                                                >
                                                    <SearchX className="w-3 h-3" />
                                                </button>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectionTouched(true);
                                                setSelectedOrderIds(allSelected
                                                    ? new Set()
                                                    : new Set(selectedGroup.orders.map(o => o.id)));
                                            }}
                                            className="flex items-center gap-2 text-[11px] font-semibold text-ant-ink hover:text-ant-ink/70 transition-colors shrink-0 px-2 h-8 rounded-md border border-ant-line bg-white"
                                        >
                                            <span className={cn(
                                                'w-4 h-4 rounded border flex items-center justify-center transition-colors',
                                                allSelected ? 'bg-ant-ink border-ant-ink' : 'border-ant-line bg-white',
                                            )}>
                                                {allSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                                            </span>
                                            {allSelected ? 'Deselect all' : `Select all (${selectedGroup.orders.length})`}
                                        </button>
                                    </div>

                                    <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
                                        {visibleOrders.length === 0 && (
                                            <div className="text-[11px] text-ant-mid italic py-4 text-center">
                                                No orders match "{orderSearch}"
                                            </div>
                                        )}
                                        {visibleOrders.map((o) => {
                                            const checked = selectedOrderIds.has(o.id);
                                            const trackingCode =
                                                o.courier_parcels?.[0]?.tracking_code
                                                || o.parcels?.[0]?.tracking_code
                                                || o.tracking_number;
                                            return (
                                                <button
                                                    key={o.id}
                                                    type="button"
                                                    onClick={() => {
                                                        setSelectionTouched(true);
                                                        setSelectedOrderIds(prev => {
                                                            const next = new Set(prev);
                                                            if (next.has(o.id)) next.delete(o.id);
                                                            else next.add(o.id);
                                                            return next;
                                                        });
                                                    }}
                                                    className={cn(
                                                        'w-full p-2.5 rounded-lg border text-left flex items-center gap-2.5 transition-all',
                                                        checked
                                                            ? 'border-ant-ink/30 bg-ant-ink/[0.04]'
                                                            : 'border-ant-line bg-white hover:border-ant-ink/15',
                                                    )}
                                                >
                                                    <span className={cn(
                                                        'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                                                        checked ? 'bg-ant-ink border-ant-ink' : 'border-ant-line bg-white',
                                                    )}>
                                                        {checked && <CheckCircle2 className="w-3 h-3 text-white" />}
                                                    </span>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[11.5px] font-semibold text-ant-ink truncate">{o.name || 'No name'}</span>
                                                            {trackingCode && (
                                                                <span className="font-mono text-[10px] text-ant-mid truncate">{trackingCode}</span>
                                                            )}
                                                        </div>
                                                        <div className="text-[10px] text-ant-mid mt-0.5 truncate">{o.phone || '—'}</div>
                                                    </div>
                                                    <div className="text-right shrink-0 tabular-nums">
                                                        <div className="text-[11.5px] font-semibold text-ant-ink">{Number(o.price || 0).toFixed(2)}</div>
                                                        <div className="text-[9.5px] text-ant-rose">−{getReturnFeeForOrder(o).toFixed(2)}</div>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    <div className="flex justify-end gap-2 pt-1">
                                        <Button variant="outline" onClick={() => setWizardStep(0)}
                                            className="rounded-md h-8 px-3 text-[11px] font-semibold border-ant-line">Back</Button>
                                        <Button
                                            disabled={selectedOrderIds.size === 0}
                                            onClick={() => setWizardStep(2)}
                                            className="bg-ant-ink hover:bg-ant-ink/90 text-white rounded-md h-8 px-3 text-[11px] font-semibold disabled:opacity-50"
                                        >
                                            Next ({selectedOrderIds.size}) <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                                        </Button>
                                    </div>
                                </div>
                            );
                        })()}

                        {wizardStep === 2 && filteredGroup && (
                            <div className="space-y-3">
                                <div className="flex items-center gap-3 p-3 bg-ant-light rounded-xl border border-ant-line">
                                    <EntityLogo kind={filteredGroup.kind} logoUrl={filteredGroup.logo_url} avatarUrl={filteredGroup.avatar_url} name={filteredGroup.target_name} size="sm" />
                                    <div>
                                        <p className="text-[12px] font-semibold text-ant-ink">{filteredGroup.target_name}</p>
                                        <p className="text-[10px] text-ant-mid">{filteredGroup.orders.length} returned orders to include</p>
                                    </div>
                                </div>

                                <div className="overflow-x-auto border border-ant-line rounded-xl">
                                    <table className="w-full">
                                        <thead><tr className="border-b border-ant-line">
                                            <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] font-bold text-ant-mid">#</th>
                                            <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] font-bold text-ant-mid">Customer</th>
                                            <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] font-bold text-ant-mid">Tracking</th>
                                            <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] font-bold text-ant-mid">Amount</th>
                                            <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] font-bold text-ant-mid">Shipping</th>
                                            <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] font-bold text-ant-mid">Net</th>
                                        </tr></thead>
                                        <tbody>{filteredGroup.orders.map((o, i) => (
                                            <tr key={o.id} className="border-b border-ant-line last:border-0 hover:bg-ant-light transition-colors">
                                                <td className="px-3 py-2 text-[11px] text-ant-mid tabular-nums">{i + 1}</td>
                                                <td className="px-3 py-2 text-[11px] font-semibold text-ant-ink">{o.name}</td>
                                                <td className="px-3 py-2 font-mono text-[11px] text-ant-ink/70">{o.courier_parcels?.[0]?.tracking_code || o.parcels?.[0]?.tracking_code || o.tracking_number || 'N/A'}</td>
                                                <td className="px-3 py-2 text-right text-[11px] tabular-nums">{Number(o.price || 0).toFixed(2)}</td>
                                                <td className="px-3 py-2 text-right text-[11px] text-ant-rose tabular-nums">-{getReturnFeeForOrder(o).toFixed(2)}</td>
                                                <td className="px-3 py-2 text-right text-[11px] font-semibold text-ant-ink tabular-nums">{(Number(o.price || 0) - getReturnFeeForOrder(o)).toFixed(2)}</td>
                                            </tr>
                                        ))}</tbody>
                                    </table>
                                </div>

                                <div className="rounded-xl border border-ant-line bg-ant-light p-3">
                                    <div className="grid grid-cols-3 gap-3 text-center">
                                        <div>
                                            <span className="text-[9px] uppercase tracking-[0.18em] font-bold text-ant-mid block mb-1">Total Amount</span>
                                            <span className="text-[15px] font-semibold text-ant-ink tabular-nums">{filteredGroup.total_amount.toFixed(2)}</span>
                                        </div>
                                        <div>
                                            <span className="text-[9px] uppercase tracking-[0.18em] font-bold text-ant-mid block mb-1">Shipping Fees</span>
                                            <span className="text-[15px] font-semibold text-ant-rose tabular-nums">-{filteredGroup.total_shipping.toFixed(2)}</span>
                                        </div>
                                        <div>
                                            <span className="text-[9px] uppercase tracking-[0.18em] font-bold text-ant-mid block mb-1">Net Value</span>
                                            <span className="text-[15px] font-semibold text-ant-green tabular-nums">{filteredGroup.net_amount.toFixed(2)}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex justify-end gap-2">
                                    <Button variant="outline" onClick={() => setWizardStep(1)}
                                        className="rounded-md h-8 px-3 text-[11px] font-semibold border-ant-line">Back</Button>
                                    <Button onClick={() => generateNoteMutation.mutate(filteredGroup)}
                                        disabled={generateNoteMutation.isPending || filteredGroup.orders.length === 0}
                                        className="bg-ant-ink hover:bg-ant-ink/90 text-white rounded-md h-8 px-3 text-[11px] font-semibold">
                                        {generateNoteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <FileText className="w-3.5 h-3.5 mr-1.5" />}
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
                <DialogContent className="max-w-2xl p-0 border border-ant-line rounded-xl overflow-hidden max-h-[90vh] overflow-y-auto">
                    {selectedNote && (
                        <>
                            <DialogHeader className="p-5 pb-4">
                                <div className="flex items-center gap-3">
                                    <EntityLogo
                                        kind={selectedNote.kind}
                                        logoUrl={resolveProviderLogo(selectedNote.provider)}
                                        avatarUrl={selectedNote.courier?.avatar_url || null}
                                        name={selectedNote.kind === 'courier' ? (selectedNote.courier?.name || '??') : (selectedNote.provider?.name || '??')}
                                        size="sm"
                                    />
                                    <div>
                                        <DialogTitle className="text-[15px] font-semibold text-ant-ink">{selectedNote.reference}</DialogTitle>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <Badge className={cn("border-none font-bold text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded",
                                                selectedNote.status === 'received' ? "bg-ant-green/20 text-ant-green" : "bg-ant-rose/20 text-ant-rose")}>
                                                {selectedNote.status.toUpperCase()}
                                            </Badge>
                                            <span className="text-[11px] text-ant-mid">{selectedNote.provider?.name}</span>
                                        </div>
                                    </div>
                                </div>
                            </DialogHeader>

                            <div className="px-5 pb-5 space-y-3">
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="p-3 rounded-xl bg-ant-light border border-ant-line">
                                        <span className="text-[9px] uppercase tracking-[0.18em] font-bold text-ant-mid">Created</span>
                                        <p className="text-[11px] font-semibold text-ant-ink mt-1">{format(new Date(selectedNote.created_at), 'dd MMM yyyy, HH:mm')}</p>
                                    </div>
                                    {selectedNote.received_at && (
                                        <div className="p-3 rounded-xl bg-ant-green/10 border border-emerald-100">
                                            <span className="text-[9px] uppercase tracking-[0.18em] font-bold text-ant-green/60">Received</span>
                                            <p className="text-[11px] font-semibold text-ant-green mt-1">{format(new Date(selectedNote.received_at), 'dd MMM yyyy, HH:mm')}</p>
                                        </div>
                                    )}
                                </div>

                                <div className="overflow-x-auto border border-ant-line rounded-xl">
                                    <table className="w-full">
                                        <thead><tr className="border-b border-ant-line">
                                            <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] font-bold text-ant-mid">#</th>
                                            <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] font-bold text-ant-mid">Tracking</th>
                                            <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] font-bold text-ant-mid">Amount</th>
                                            <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] font-bold text-ant-mid">Shipping</th>
                                            <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] font-bold text-ant-mid">Net</th>
                                        </tr></thead>
                                        <tbody>{selectedNote.line_items.map((li, i) => (
                                            <tr key={li.id} className="border-b border-ant-line last:border-0 hover:bg-ant-light">
                                                <td className="px-3 py-2 text-[11px] text-ant-mid tabular-nums">{i + 1}</td>
                                                <td className="px-3 py-2 font-mono text-[11px] text-ant-ink/70">{li.tracking_code || 'N/A'}</td>
                                                <td className="px-3 py-2 text-right text-[11px] tabular-nums">{Number(li.amount).toFixed(2)}</td>
                                                <td className="px-3 py-2 text-right text-[11px] text-ant-rose tabular-nums">-{Number(li.shipping_fee).toFixed(2)}</td>
                                                <td className="px-3 py-2 text-right text-[11px] font-semibold text-ant-ink tabular-nums">{(Number(li.amount) - Number(li.shipping_fee)).toFixed(2)}</td>
                                            </tr>
                                        ))}</tbody>
                                    </table>
                                </div>

                                <div className="rounded-xl border border-ant-line bg-ant-light p-3 grid grid-cols-3 gap-3 text-center">
                                    <div>
                                        <span className="text-[9px] uppercase tracking-[0.18em] font-bold text-ant-mid block mb-1">Total</span>
                                        <span className="text-[15px] font-semibold text-ant-ink tabular-nums">{Number(selectedNote.total_amount).toFixed(2)}</span>
                                    </div>
                                    <div>
                                        <span className="text-[9px] uppercase tracking-[0.18em] font-bold text-ant-mid block mb-1">Shipping</span>
                                        <span className="text-[15px] font-semibold text-ant-rose tabular-nums">-{Number(selectedNote.total_shipping_fees).toFixed(2)}</span>
                                    </div>
                                    <div>
                                        <span className="text-[9px] uppercase tracking-[0.18em] font-bold text-ant-mid block mb-1">Net</span>
                                        <span className="text-[15px] font-semibold text-ant-green tabular-nums">{Number(selectedNote.net_amount).toFixed(2)}</span>
                                    </div>
                                </div>

                                <div className="flex justify-end gap-2">
                                    <Button variant="outline" onClick={() => handlePrint(selectedNote)}
                                        className="rounded-md h-8 px-3 text-[11px] font-semibold border-ant-line">
                                        <Printer className="w-3.5 h-3.5 mr-1.5" />Print
                                    </Button>
                                    {selectedNote.status === 'pending' && (
                                        <Button onClick={() => markReceivedMutation.mutate(selectedNote)}
                                            disabled={markReceivedMutation.isPending}
                                            className="bg-ant-green hover:bg-ant-green/90 text-white rounded-md h-8 px-3 text-[11px] font-semibold">
                                            {markReceivedMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <PackageCheck className="w-3.5 h-3.5 mr-1.5" />}
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
        </div>
    );
};

export default ReturnNote;
