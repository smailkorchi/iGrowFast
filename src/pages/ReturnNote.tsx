import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus, Search, Loader2, Package, DollarSign, Eye, FileText,
    CheckCircle2, Clock, Building2, AlertTriangle, Truck,
    ChevronDown, ChevronRight, Printer, ArrowRight, SearchX,
    RotateCcw, PackageCheck, User, Hash,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

// Package status "Retourné"
const RETOURNE_PACKAGE_STATUS_ID = 'c98d2ec2-94aa-4bfd-bc27-cdf93d46f3a9';
// Order status "RETURN"
const RETURN_ORDER_STATUS_ID = 'dbb3ae2c-abbf-4c96-93af-ed82319c8b68';

interface ReturnOrder {
    id: string; name: string; phone: string; price: number; shipping_cost: number;
    tracking_number: string | null; company_id: string | null; courier_id: string | null;
    master_city_id: string | null;
    current_return_note_id: string | null; current_courier_return_note_id: string | null;
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
    created_by?: string | null;
    provider: { id: string; name: string; logo_url: string | null } | null;
    courier?: { id: string; name: string; avatar_url: string | null } | null;
    creator?: { name: string; avatar_url: string | null; role: string } | null;
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

    // ─── Fetch orders with package_status = Retourné AND not already linked to a return note ───
    const { data: returnOrders, isLoading: isLoadingReturns } = useQuery({
        queryKey: ['retourne-orders', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('orders')
                .select(`*,
                    company:providers(id, name, logo_url),
                    courier:users!orders_courier_id_fkey(id, name, avatar_url),
                    items:order_items(quantity, unit_price, product:products(name)),
                    parcels:company_parcels(tracking_code, provider:providers(id, name, logo_url)),
                    courier_parcels(tracking_code)`)
                .eq('DigiCom Business', activeBusinessId)
                .eq('package_status_id', RETOURNE_PACKAGE_STATUS_ID)
                .is('current_return_note_id', null)
                .is('current_courier_return_note_id', null)
                .is('date_deleted', null)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (data || []) as ReturnOrder[];
        },
    });

    // ─── Fetch existing return notes (company + courier) ───
    const { data: returnNotes, isLoading: isLoadingNotes } = useQuery({
        queryKey: ['return-notes', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const [companyRes, courierRes] = await Promise.all([
                (supabase as any)
                    .from('company_return_notes')
                    .select(`*, provider:providers(id, name, logo_url), creator:users!company_return_notes_created_by_fkey(name, avatar_url, role), line_items:company_return_note_orders(id, order_id, tracking_code, amount, shipping_fee)`)
                    .eq('DigiCom Business', activeBusinessId)
                    .order('created_at', { ascending: false }),
                (supabase as any)
                    .from('courier_return_notes')
                    .select(`*, courier:users!courier_return_notes_courier_id_fkey(id, name, avatar_url), creator:users!courier_return_notes_created_by_fkey(name, avatar_url, role), line_items:courier_return_note_orders(id, order_id, tracking_code, amount, shipping_fee)`)
                    .eq('DigiCom Business', activeBusinessId)
                    .order('created_at', { ascending: false }),
            ]);
            if (companyRes.error) throw companyRes.error;
            if (courierRes.error) throw courierRes.error;
            const companyNotes = (companyRes.data || []).map((n: any) => ({ ...n, kind: 'company' as const }));
            const courierNotes = (courierRes.data || []).map((n: any) => ({ ...n, kind: 'courier' as const, provider: null }));
            return [...companyNotes, ...courierNotes] as ReturnNote[];
        },
    });

    // ─── Fetch return fees maps (company + courier) for lookup by (entity, master_city_id) ───
    const { data: returnFeesMap } = useQuery({
        queryKey: ['return-fees-map', activeBusinessId],
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

    // ─── Group returned orders by kind (company / courier) ───
    const { companyGroups, courierGroups } = useMemo(() => {
        const companyMap = new Map<string, TargetGroup>();
        const courierMap = new Map<string, TargetGroup>();
        for (const order of returnOrders || []) {
            // Courier ownership wins if there's no company_id but there IS a courier.
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

            // Link orders to this return note via the appropriate pointer column.
            await (supabase as any).from('orders').update({ [orderLinkField]: note.id }).in('id', group.orders.map((o) => o.id));
            return note;
        },
        onSuccess: () => {
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
            // Update note status on the right table
            const notesTable = note.kind === 'courier' ? 'courier_return_notes' : 'company_return_notes';
            const { error: noteErr } = await (supabase as any)
                .from(notesTable)
                .update({ status: 'received', received_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                .eq('id', note.id);
            if (noteErr) throw noteErr;
            // Update all linked orders to RETURN status → triggers stock restoration via the DB trigger
            const orderIds = note.line_items.map(li => li.order_id);
            if (orderIds.length > 0) {
                const { error: ordErr } = await (supabase as any).from('orders').update({ order_status_id: RETURN_ORDER_STATUS_ID, updated_at: new Date().toISOString() }).in('id', orderIds);
                if (ordErr) throw ordErr;
            }
        },
        onSuccess: () => {
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
                <div className={cn(sizeClasses[size], "bg-ant-line-soft border border-slate-100 p-1.5 flex items-center justify-center overflow-hidden shadow-inner")}>
                    <img src={logoUrl} alt={name} className="max-w-full max-h-full object-contain" />
                </div>
            );
        }
        return (
            <div className={cn(sizeClasses[size], "bg-ant-rose/10 flex items-center justify-center")}>
                <span className={cn("font-semibold text-ant-rose", textSize[size])}>{name?.substring(0, 2).toUpperCase()}</span>
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
            <div className={cn(sizeClasses[size], kind === 'courier' ? 'bg-ant-ink/10 text-ant-ink' : 'bg-ant-rose/10 text-ant-rose', 'flex items-center justify-center')}>
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

    const companyCount = (returnNotes || []).filter((n: ReturnNote) => n.kind === 'company').length;
    const courierCount = (returnNotes || []).filter((n: ReturnNote) => n.kind === 'courier').length;

    return (
        <div className="ant-surface mx-auto max-w-[1440px] px-2 md:px-3 py-2 space-y-4">
            {/* Editorial header */}
            <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pt-1">
                <div className="space-y-1.5">
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                        <span className="w-1 h-1 rounded-full bg-ant-orange" />
                        Shipping · Returns
                    </span>
                    <h1 className="font-display text-[30px] md:text-[34px] font-semibold text-ant-ink leading-[1.05] tracking-[-0.02em]">
                        Return notes
                    </h1>
                    <p className="font-serif-display text-[13px] text-ant-muted italic">
                        Reconcile parcels coming back from couriers and providers — net out the fees, close the loop.
                    </p>
                </div>
                <Button
                    onClick={() => { setIsWizardOpen(true); setWizardStep(0); setSelectedProvider(null); }}
                    disabled={!activeGroups.length}
                    className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light text-[12px] font-medium shadow-none gap-2 shrink-0 disabled:opacity-50"
                >
                    <Plus className="w-3.5 h-3.5" />
                    {activeTab === 'courier' ? 'New courier return' : 'New return note'}
                </Button>
            </header>

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-xl overflow-hidden border border-ant-line">
                {[
                    { label: 'Returned orders', value: String(stats.totalReturnOrders), accent: '#c96356', icon: Package },
                    { label: 'Pending notes', value: String(stats.pendingNotes), accent: '#d97757', icon: Clock },
                    { label: 'Received notes', value: String(stats.receivedNotes), accent: '#788c5d', icon: CheckCircle2 },
                    { label: 'Pending value', value: `${stats.pendingAmount.toFixed(2)}`, suffix: 'MAD', accent: '#141413', icon: Hash },
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
            <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as 'company' | 'courier'); setSelectedProvider(null); }} className="space-y-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                        <TabsList className="h-9 p-0.5 rounded-full bg-ant-paper border border-ant-line gap-0">
                            <TabsTrigger
                                value="company"
                                className="rounded-full px-4 h-8 text-[11.5px] font-medium data-[state=active]:bg-ant-ink data-[state=active]:text-ant-light data-[state=inactive]:text-ant-muted gap-1.5"
                            >
                                <Building2 className="w-3 h-3" /> Company
                                <span className="text-[10px] tabular-nums opacity-70">{companyCount}</span>
                            </TabsTrigger>
                            <TabsTrigger
                                value="courier"
                                className="rounded-full px-4 h-8 text-[11.5px] font-medium data-[state=active]:bg-ant-ink data-[state=active]:text-ant-light data-[state=inactive]:text-ant-muted gap-1.5"
                            >
                                <Truck className="w-3 h-3" /> Courier
                                <span className="text-[10px] tabular-nums opacity-70">{courierCount}</span>
                            </TabsTrigger>
                        </TabsList>

                        {/* Status pills */}
                        <div className="flex gap-1 items-center rounded-full border border-ant-line bg-ant-paper p-0.5">
                            {(['all', 'pending', 'received'] as const).map((s) => (
                                <button
                                    key={s}
                                    onClick={() => setFilterStatus(s)}
                                    className={cn(
                                        'px-3.5 h-8 rounded-full text-[11px] font-medium transition',
                                        filterStatus === s
                                            ? s === 'received'
                                                ? 'bg-ant-green text-white'
                                                : s === 'pending'
                                                    ? 'bg-ant-orange text-white'
                                                    : 'bg-ant-ink text-ant-light'
                                            : 'text-ant-muted hover:text-ant-ink',
                                    )}
                                >
                                    {s === 'all' ? 'All' : s === 'pending' ? 'Pending' : 'Received'}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="relative w-full sm:w-[280px]">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                        <Input
                            placeholder="Search reference or provider…"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-ant-orange focus-visible:ring-offset-0 focus-visible:border-ant-ink/25"
                        />
                    </div>
                </div>

            {/* Return Notes List */}
            {isLoading ? (
                <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl bg-ant-line-soft" />)}</div>
            ) : filteredNotes.length === 0 ? (
                <div className="rounded-2xl border border-ant-line bg-ant-paper px-6 py-14 text-center">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-ant-rose/10 ring-1 ring-ant-rose/20 mb-4">
                        <SearchX className="w-5 h-5 text-ant-rose" strokeWidth={1.5} />
                    </div>
                    <h3 className="font-display text-[18px] font-semibold text-ant-ink tracking-tight">No return notes</h3>
                    <p className="font-serif-display text-[12.5px] text-ant-muted italic mt-1 mb-5 max-w-md mx-auto">
                        When parcels come back from {activeTab === 'courier' ? 'couriers' : 'providers'}, bundle them here and net out the fees.
                    </p>
                    <Button
                        disabled={!activeGroups.length}
                        onClick={() => { setIsWizardOpen(true); setWizardStep(0); setSelectedProvider(null); }}
                        className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light text-[12px] font-medium gap-2 disabled:opacity-50"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Generate the first note
                    </Button>
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredNotes.map((note: ReturnNote) => {
                        const isExpanded = expandedCards.has(note.id);
                        const isReceived = note.status === 'received';
                        const stripe = isReceived ? '#788c5d' : '#c96356';
                        return (
                            <Card
                                key={note.id}
                                className="group relative overflow-hidden border border-ant-line bg-ant-paper shadow-none hover:border-ant-ink/20 transition-all duration-300 rounded-2xl"
                            >
                                <div className="h-[3px]" style={{ backgroundColor: stripe }} />

                                <CardContent className="p-0">
                                    <div className="p-5 md:px-6 md:py-5 flex flex-col md:flex-row md:items-center justify-between gap-5">
                                        <div className="flex items-start gap-4 flex-1 min-w-0">
                                            <EntityLogo
                                                kind={note.kind}
                                                logoUrl={note.provider?.logo_url || null}
                                                avatarUrl={note.courier?.avatar_url || null}
                                                name={note.kind === 'courier' ? (note.courier?.name || '??') : (note.provider?.name || '??')}
                                                size="md"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <h3 className="font-display text-[16px] font-semibold text-ant-ink tracking-[-0.01em] truncate">
                                                        {note.reference}
                                                    </h3>
                                                    <span
                                                        className={cn(
                                                            'inline-flex items-center gap-1 text-[9.5px] font-medium uppercase tracking-[0.22em] px-2 py-0.5 rounded-full border',
                                                            isReceived
                                                                ? 'bg-ant-green/10 text-ant-green border-ant-green/25'
                                                                : 'bg-ant-rose/10 text-ant-rose border-ant-rose/25',
                                                        )}
                                                    >
                                                        <span className={cn('w-1 h-1 rounded-full', isReceived ? 'bg-ant-green' : 'bg-ant-rose')} />
                                                        {isReceived ? 'Received' : 'Pending'}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-3 flex-wrap text-[11px] text-ant-muted mt-1">
                                                    <span className="flex items-center gap-1">
                                                        {note.kind === 'courier' ? <Truck className="w-3 h-3 text-ant-mid" /> : <Building2 className="w-3 h-3 text-ant-mid" />}
                                                        <span className="truncate max-w-[180px]">
                                                            {note.kind === 'courier' ? (note.courier?.name || '—') : (note.provider?.name || '—')}
                                                        </span>
                                                    </span>
                                                    <span className="flex items-center gap-1 tabular-nums">
                                                        <Package className="w-3 h-3 text-ant-mid" />{note.order_count} orders
                                                    </span>
                                                    <span className="flex items-center gap-1 tabular-nums">
                                                        <Clock className="w-3 h-3 text-ant-mid" />{format(new Date(note.created_at), 'dd MMM yyyy')}
                                                    </span>
                                                    <span className="flex items-center gap-1 min-w-0">
                                                        {note.creator?.avatar_url ? (
                                                            <img src={note.creator.avatar_url} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
                                                        ) : (
                                                            <User className="w-3 h-3 text-ant-mid shrink-0" />
                                                        )}
                                                        <span className="truncate">{note.creator?.name ?? 'Unknown'}</span>
                                                    </span>
                                                    {isReceived && note.received_at && (
                                                        <span className="inline-flex items-center gap-1 text-ant-green tabular-nums">
                                                            <CheckCircle2 className="w-3 h-3" />Received {format(new Date(note.received_at), 'dd MMM')}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4 shrink-0">
                                            <div className="text-right">
                                                <span className="text-[9.5px] font-medium text-ant-mid uppercase tracking-[0.22em]">Total</span>
                                                <p
                                                    className={cn(
                                                        'font-display text-[22px] font-semibold tabular-nums tracking-[-0.02em] leading-none mt-0.5',
                                                        isReceived ? 'text-ant-green' : 'text-ant-rose',
                                                    )}
                                                >
                                                    {Number(note.total_amount).toFixed(2)}
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
                                                {!isReceived && (
                                                    <Button
                                                        size="sm"
                                                        onClick={() => markReceivedMutation.mutate(note)}
                                                        disabled={markReceivedMutation.isPending}
                                                        className="h-9 px-3.5 rounded-full bg-ant-green hover:bg-ant-green/90 text-white text-[11.5px] font-medium gap-1.5"
                                                    >
                                                        {markReceivedMutation.isPending ? (
                                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                        ) : (
                                                            <>
                                                                <PackageCheck className="w-3.5 h-3.5" />
                                                                Mark received
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

            </Tabs>

            {/* ─── WIZARD MODAL ─── */}
            <Dialog open={isWizardOpen} onOpenChange={v => { if (!v) { setIsWizardOpen(false); setWizardStep(0); setSelectedProvider(null); } }}>
                <DialogContent className="ant-surface max-w-3xl p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden max-h-[90vh] overflow-y-auto custom-scrollbar">
                    <DialogHeader className="px-6 pt-6 pb-3 border-b border-ant-line">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="w-1 h-1 rounded-full bg-ant-orange" />
                            <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                Return note wizard
                            </span>
                        </div>
                        <DialogTitle className="font-display text-[22px] font-semibold text-ant-ink tracking-[-0.02em]">
                            {wizardStep === 0 ? 'Pick a destination' : 'Review & generate'}
                        </DialogTitle>
                        <DialogDescription className="font-serif-display text-[12.5px] text-ant-muted italic mt-0.5">
                            {wizardStep === 0
                                ? `Choose the ${activeTab === 'courier' ? 'courier' : 'provider'} whose returned parcels you want to reconcile.`
                                : 'Check the lines, then generate a reconciled return note.'}
                        </DialogDescription>
                    </DialogHeader>

                    {/* Step indicator */}
                    <div className="px-6 pt-5 flex items-center gap-3">
                        {[
                            { i: 0, label: 'Destination' },
                            { i: 1, label: 'Review' },
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
                                        <p className="font-display text-[15px] font-semibold text-ant-ink tracking-tight">No returned orders available</p>
                                        <p className="font-serif-display text-[12px] text-ant-muted italic mt-1">
                                            Every returned parcel is already accounted for.
                                        </p>
                                    </div>
                                ) : activeGroups.map(g => (
                                    <button
                                        key={g.target_id}
                                        type="button"
                                        onClick={() => setSelectedProvider(g.target_id)}
                                        className={cn(
                                            'w-full p-4 rounded-xl flex items-center justify-between gap-4 cursor-pointer transition-all duration-200 border text-left',
                                            selectedProvider === g.target_id
                                                ? 'bg-ant-rose/[0.06] border-ant-rose/50 ring-2 ring-ant-rose/20'
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
                                                    {g.orders.length} returned orders
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="font-display text-[18px] font-semibold text-ant-rose tabular-nums leading-none tracking-[-0.02em]">
                                                {g.total_amount.toFixed(2)}
                                                <span className="text-[10px] font-medium text-ant-mid ml-1">MAD</span>
                                            </p>
                                            <p className="text-[9.5px] font-medium text-ant-mid uppercase tracking-[0.22em] mt-1">
                                                Total value
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
                                        disabled={!selectedProvider}
                                        onClick={() => setWizardStep(1)}
                                        className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light font-medium text-[12px] gap-1.5 disabled:opacity-50"
                                    >
                                        Next <ArrowRight className="w-3.5 h-3.5" />
                                    </Button>
                                </div>
                            </div>
                        )}

                        {wizardStep === 1 && selectedGroup && (
                            <div className="space-y-4">
                                <div className="flex items-center gap-3 p-4 bg-ant-light border border-ant-line rounded-xl">
                                    <EntityLogo kind={selectedGroup.kind} logoUrl={selectedGroup.logo_url} avatarUrl={selectedGroup.avatar_url} name={selectedGroup.target_name} size="md" />
                                    <div className="min-w-0">
                                        <p className="font-display text-[15px] font-semibold text-ant-ink tracking-[-0.01em] truncate">
                                            {selectedGroup.target_name}
                                        </p>
                                        <p className="text-[11px] text-ant-muted mt-0.5 tabular-nums">
                                            {selectedGroup.orders.length} returned orders to include
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
                                            {selectedGroup.orders.map((o, i) => (
                                                <tr key={o.id} className="border-t border-ant-line hover:bg-ant-line-soft transition-colors">
                                                    <td className="px-3 py-2 text-ant-mid tabular-nums">{i + 1}</td>
                                                    <td className="px-3 py-2 font-medium text-ant-ink truncate">{o.name}</td>
                                                    <td className="px-3 py-2 font-mono text-[11.5px] text-ant-ink">
                                                        {o.courier_parcels?.[0]?.tracking_code || o.parcels?.[0]?.tracking_code || o.tracking_number || 'N/A'}
                                                    </td>
                                                    <td className="px-3 py-2 text-right font-medium tabular-nums">{Number(o.price || 0).toFixed(2)}</td>
                                                    <td className="px-3 py-2 text-right text-ant-rose font-medium tabular-nums">-{getReturnFeeForOrder(o).toFixed(2)}</td>
                                                    <td className="px-3 py-2 text-right font-display font-semibold text-ant-ink tabular-nums">
                                                        {(Number(o.price || 0) - getReturnFeeForOrder(o)).toFixed(2)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="bg-ant-ink rounded-2xl p-5 text-ant-light">
                                    <div className="grid grid-cols-3 gap-px bg-white/10 rounded-xl overflow-hidden">
                                        <div className="bg-ant-ink px-4 py-3 text-left">
                                            <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-light/50 block mb-1">Total amount</span>
                                            <span className="font-display text-[20px] font-semibold tabular-nums tracking-[-0.02em]">
                                                {selectedGroup.total_amount.toFixed(2)}
                                            </span>
                                        </div>
                                        <div className="bg-ant-ink px-4 py-3 text-left">
                                            <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-light/50 block mb-1">Shipping fees</span>
                                            <span className="font-display text-[20px] font-semibold tabular-nums tracking-[-0.02em] text-ant-rose">
                                                −{selectedGroup.total_shipping.toFixed(2)}
                                            </span>
                                        </div>
                                        <div className="bg-ant-ink px-4 py-3 text-left">
                                            <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-light/50 block mb-1">Net value</span>
                                            <span className="font-display text-[20px] font-semibold tabular-nums tracking-[-0.02em] text-ant-orange">
                                                {selectedGroup.net_amount.toFixed(2)}
                                            </span>
                                        </div>
                                    </div>
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
                                        onClick={() => generateNoteMutation.mutate(selectedGroup)}
                                        disabled={generateNoteMutation.isPending}
                                        className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light font-medium text-[12px] gap-1.5"
                                    >
                                        {generateNoteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5 text-ant-orange" />}
                                        Generate return note
                                    </Button>
                                </div>
                            </div>
                        )}
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
                                        name={selectedNote.kind === 'courier' ? (selectedNote.courier?.name || '??') : (selectedNote.provider?.name || '??')}
                                        size="lg"
                                    />
                                    <div className="min-w-0">
                                        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                            <span className="w-1 h-1 rounded-full bg-ant-orange" />
                                            Return note
                                        </span>
                                        <DialogTitle className="font-display text-[20px] font-semibold text-ant-ink tracking-[-0.02em] mt-0.5">
                                            {selectedNote.reference}
                                        </DialogTitle>
                                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                            <span
                                                className={cn(
                                                    'inline-flex items-center gap-1 text-[9.5px] font-medium uppercase tracking-[0.22em] px-2 py-0.5 rounded-full border',
                                                    selectedNote.status === 'received'
                                                        ? 'bg-ant-green/10 text-ant-green border-ant-green/25'
                                                        : 'bg-ant-rose/10 text-ant-rose border-ant-rose/25',
                                                )}
                                            >
                                                <span className={cn('w-1 h-1 rounded-full', selectedNote.status === 'received' ? 'bg-ant-green' : 'bg-ant-rose')} />
                                                {selectedNote.status === 'received' ? 'Received' : 'Pending'}
                                            </span>
                                            <span className="text-[11.5px] text-ant-muted truncate max-w-[240px]">
                                                {selectedNote.kind === 'courier' ? (selectedNote.courier?.name || '—') : (selectedNote.provider?.name || '—')}
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
                                    <div className="bg-ant-paper px-4 py-3">
                                        <span className="text-[9.5px] font-medium text-ant-mid uppercase tracking-[0.22em]">Created by</span>
                                        <div className="flex items-center gap-2 mt-1">
                                            {selectedNote.creator?.avatar_url ? (
                                                <img src={selectedNote.creator.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover" />
                                            ) : (
                                                <User className="w-4 h-4 text-ant-mid" />
                                            )}
                                            <p className="font-medium text-[13px] text-ant-ink truncate">{selectedNote.creator?.name ?? 'Unknown'}</p>
                                        </div>
                                    </div>
                                    {selectedNote.received_at && (
                                        <div className="col-span-2 bg-ant-green/10 px-4 py-3 border-t border-ant-green/25">
                                            <span className="text-[9.5px] font-medium text-ant-green uppercase tracking-[0.22em]">Received</span>
                                            <p className="font-display text-[13px] font-semibold text-ant-green tabular-nums tracking-[-0.01em] mt-1">
                                                {format(new Date(selectedNote.received_at), 'dd MMM yyyy, HH:mm')}
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
                                                    <td className="px-3 py-2 text-right text-ant-rose font-medium tabular-nums">-{Number(li.shipping_fee).toFixed(2)}</td>
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
                                            <span className="font-display text-[20px] font-semibold tabular-nums tracking-[-0.02em] text-ant-orange">
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
                                    {selectedNote.status === 'pending' && (
                                        <Button
                                            onClick={() => markReceivedMutation.mutate(selectedNote)}
                                            disabled={markReceivedMutation.isPending}
                                            className="h-10 px-5 rounded-full bg-ant-green hover:bg-ant-green/90 text-white font-medium text-[12px] gap-1.5"
                                        >
                                            {markReceivedMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackageCheck className="w-3.5 h-3.5" />}
                                            Mark as received
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
