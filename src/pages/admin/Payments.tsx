import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { NotesFilterBar, type FilterOption } from '@/components/notes/NotesFilterBar';

const NOTE_PAGE_SIZE = 50;
import { resolveProviderLogo } from '@/lib/providerLogos';
import { UserAvatar } from '@/components/users/UserAvatar';
import {
    Plus, Search, Loader2, Package, DollarSign, Eye, FileText,
    CheckCircle2, Clock, Building2, CreditCard, AlertTriangle,
    ChevronDown, ChevronRight, Printer, ArrowRight, SearchX, Truck
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { OrderTrackingImport } from '@/components/orders/OrderTrackingImport';
import { format } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { pickShippedCompanyTrackingCode, pickShippedCourierTrackingCode } from '@/lib/orders/getLatestTrackableCompanyParcel';
import { sendCourierPaymentNoteEmail } from '@/lib/sendPayoutStatement';

interface UnpaidOrder {
    id: string; name: string; phone: string; price: number; shipping_cost: number;
    company_id: string | null; courier_id: string | null;
    payment_delivery_id: string | null;
    current_courier_payment_note_id: string | null;
    include_delivery_in_total: boolean | null;
    master_city_id: string | null;
    parcels: { tracking_code: string | null; provider: { id: string; name: string; provider_type: string | null; logo_url: string | null } | null }[];
    courier_parcels: { tracking_code: string | null }[];
    company: { id: string; name: string; provider_type: string | null; logo_url: string | null } | null;
    courier: { id: string; name: string; avatar_url: string | null; avatar_config?: unknown } | null;
    items: { quantity: number; unit_price: number; product: { name: string } | null }[];
}

interface TargetGroup {
    kind: 'company' | 'courier';
    target_id: string;
    target_name: string;
    logo_url: string | null;
    avatar_url: string | null;
    avatar_config?: unknown;
    orders: UnpaidOrder[];
    total_amount: number;
    total_shipping: number;
    net_amount: number;
}

interface PaymentNote {
    kind: 'company' | 'courier';
    id: string; reference: string; status: string; total_amount: number;
    total_shipping_fees: number; net_amount: number; order_count: number;
    paid_at: string | null; created_at: string;
    provider: { id: string; name: string; provider_type: string | null; logo_url: string | null } | null;
    courier?: { id: string; name: string; avatar_url: string | null; avatar_config?: unknown } | null;
    line_items: { id: string; order_id: string; tracking_code: string | null; amount: number; shipping_fee: number }[];
}

const Payments = () => {
    const { getOrderByCategory, getPkgByCategory, isPkgInCategories } = useStatusCategories();
    const unpaidStatusId = getOrderByCategory('unpaid')?.id;
    const deliveredPkgId = getPkgByCategory('delivered')?.id;

    const [activeTab, setActiveTab] = useState<'company' | 'courier'>('company');
    const [isWizardOpen, setIsWizardOpen] = useState(false);
    const [wizardStep, setWizardStep] = useState(0);
    const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
    const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
    // Untouched import replaces the selection; once manually selected, an import adds.
    const [selectionTouched, setSelectionTouched] = useState(false);
    // Free-text search inside the wizard's Select-orders step. Matches against
    // every bit of info on the order — name, phone, tracking, product names,
    // price. Reset alongside the rest of the wizard state.
    const [orderSearch, setOrderSearch] = useState('');
    const [isViewNoteOpen, setIsViewNoteOpen] = useState(false);
    const [selectedNote, setSelectedNote] = useState<PaymentNote | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'unpaid' | 'paid'>('all');
    const [entityFilter, setEntityFilter] = useState<string>('all');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [amountMin, setAmountMin] = useState('');
    const [amountMax, setAmountMax] = useState('');
    const [page, setPage] = useState(1);
    const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // Debounce the universal search box (client name / phone / tracking / reference / provider|courier name).
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
        return () => clearTimeout(t);
    }, [searchQuery]);
    // Any view change resets pagination to the first window.
    useEffect(() => { setPage(1); }, [activeTab, debouncedSearch, filterStatus, entityFilter, dateFrom, dateTo, amountMin, amountMax]);
    // Filters are per-channel; clear them when switching Companies <-> Couriers.
    useEffect(() => {
        setFilterStatus('all'); setEntityFilter('all');
        setDateFrom(''); setDateTo(''); setAmountMin(''); setAmountMax(''); setSearchQuery('');
    }, [activeTab]);

    // ─── Fetch unpaid+livré orders (exclude those already linked to a payment note, company or courier) ───
    const { data: unpaidOrders, isLoading: isLoadingUnpaid } = useQuery({
        queryKey: ['unpaid-livre-orders', activeBusinessId, unpaidStatusId, deliveredPkgId],
        queryFn: async () => {
            if (!activeBusinessId || !unpaidStatusId || !deliveredPkgId) return [];
            const SELECT = `*,
                    company:providers(id, name, provider_type, logo_url),
                    courier:users!orders_courier_id_fkey(id, name, avatar_url, avatar_config),
                    items:order_items(quantity, unit_price, product:products(name)),
                    parcels:company_parcels(tracking_code, provider:providers(id, name, provider_type, logo_url), company_delivery_note_id, created_at),
                    courier_parcels(tracking_code, courier_delivery_note_id, created_at)`;
            // Normal payouts: unpaid + delivered, not yet noted.
            const normal = await fetchAllRows('orders', SELECT, {
                filters: [
                    { column: 'DigiCom Business', op: 'eq', value: activeBusinessId },
                    { column: 'order_status_id', op: 'eq', value: unpaidStatusId },
                    { column: 'package_status_id', op: 'eq', value: deliveredPkgId },
                    { column: 'payment_delivery_id', op: 'is', value: null },
                    { column: 'current_courier_payment_note_id', op: 'is', value: null },
                    { column: 'date_deleted', op: 'is', value: null },
                    { column: 'source_review_status', op: 'neq', value: 'pending' },
                ],
            });
            // Exchange/return legs: the carrier delivered the parcel and billed a fee, but
            // the leg settles at package=returned so it never hits "unpaid+livré". Surface
            // any fee-bearing, shipped, carrier-handled replace=true leg not yet noted so its
            // delivery fee is reconciled. It bundles at amount=price (0 for a pure swap),
            // fee resolved via resolveOrderFee (courier/company city fee), and is NEVER flipped to PAID (cascade/pin triggers exempt
            // replace=true). Split sale legs (replace=false) flow through `normal` above; the
            // matching return leg carries shipping_cost 0 here and is filtered out.
            const swapRaw = await fetchAllRows('orders', SELECT, {
                filters: [
                    { column: 'DigiCom Business', op: 'eq', value: activeBusinessId },
                    { column: 'replace', op: 'eq', value: true },
                    { column: 'payment_delivery_id', op: 'is', value: null },
                    { column: 'current_courier_payment_note_id', op: 'is', value: null },
                    { column: 'date_deleted', op: 'is', value: null },
                ],
            });
            const swap = (swapRaw as any[]).filter((o) => {
                if (Number(o.shipping_cost || 0) <= 0) return false;            // only fee-bearing legs
                if (o.source_review_status === 'pending') return false;
                const hasTracking = !!(o.parcels?.[0]?.tracking_code)
                    || (o.courier_parcels || []).some((p: any) => p?.tracking_code);
                if (!hasTracking) return false;                                  // must have shipped
                // carrier completed the trip (delivered or any return-leg)
                return isPkgInCategories(o.package_status_id, ['delivered', 'returned']);
            });
            const byId = new Map<string, any>();
            for (const o of [...(normal as any[]), ...swap]) byId.set(o.id, o);
            return Array.from(byId.values())
                .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()) as UnpaidOrder[];
        },
        enabled: !!unpaidStatusId && !!deliveredPkgId,
    });

    // ─── Courier delivery-fee map (courier_id → master_city_id → fee) ───
    // SINGLE source of truth for the per-order courier fee, shared by the preview
    // (group totals + wizard table) AND the generate mutation so they never diverge.
    const { data: courierFeeRows } = useQuery({
        queryKey: ['courier-fee-map', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data } = await (supabase as any)
                .from('courier_fees')
                .select('courier_id, master_city_id, fee')
                .eq('DigiCom Business', activeBusinessId);
            return (data || []) as Array<{ courier_id: string; master_city_id: string; fee: number | string | null }>;
        },
        enabled: !!activeBusinessId,
    });
    const courierFeeMap = useMemo(() => {
        const m = new Map<string, Map<string, number>>();
        for (const r of courierFeeRows || []) {
            if (!r.courier_id || !r.master_city_id) continue;
            if (!m.has(r.courier_id)) m.set(r.courier_id, new Map());
            m.get(r.courier_id)!.set(r.master_city_id, Number(r.fee || 0));
        }
        return m;
    }, [courierFeeRows]);
    // Same per-city fee model for delivery companies (company_fees, keyed by company_id).
    const { data: companyFeeRows } = useQuery({
        queryKey: ['company-fee-map', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data } = await (supabase as any)
                .from('company_fees')
                .select('company_id, master_city_id, fee')
                .eq('DigiCom Business', activeBusinessId);
            return (data || []) as Array<{ company_id: string; master_city_id: string; fee: number | string | null }>;
        },
        enabled: !!activeBusinessId,
    });
    const companyFeeMap = useMemo(() => {
        const m = new Map<string, Map<string, number>>();
        for (const r of companyFeeRows || []) {
            if (!r.company_id || !r.master_city_id) continue;
            if (!m.has(r.company_id)) m.set(r.company_id, new Map());
            m.get(r.company_id)!.set(r.master_city_id, Number(r.fee || 0));
        }
        return m;
    }, [companyFeeRows]);
    // BOTH couriers and delivery companies ALWAYS bill their configured city fee
    // (courier_fees.fee / company_fees.fee) regardless of the order's delivery-in-total toggle;
    // a city with no configured fee row deducts 0 (owner must configure it). Exchange/swap legs
    // are couriers/companies too, so they follow the exact same rule.
    const resolveOrderFee = useCallback((o: UnpaidOrder, kind: 'company' | 'courier', targetId?: string): number => {
        const feeMap = kind === 'courier' ? courierFeeMap : companyFeeMap;
        return o.master_city_id && targetId ? (feeMap.get(targetId)?.get(o.master_city_id) ?? 0) : 0;
    }, [courierFeeMap, companyFeeMap]);

    // ─── Option sources for the filter bar (providers + business users) ───
    const { data: providerOptions } = useQuery({
        queryKey: ['pay-provider-options', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [] as any[];
            const { data } = await supabase.from('providers').select('id, name')
                .eq('DigiCom Business', activeBusinessId).order('name');
            return data || [];
        },
        enabled: !!activeBusinessId,
    });
    const { data: businessUsers } = useQuery({
        queryKey: ['pay-user-options', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [] as any[];
            const { data } = await supabase.from('users').select('id, name, role')
                .eq('DigiCom Business', activeBusinessId).order('name');
            return data || [];
        },
        enabled: !!activeBusinessId,
    });

    // ─── Channel-total badges (unfiltered, cheap head counts) ───
    const { data: companyTotalCount = 0 } = useQuery({
        queryKey: ['payment-notes', 'count', 'company', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return 0;
            const { count } = await (supabase as any).from('company_payment_notes')
                .select('id', { count: 'exact', head: true }).eq('DigiCom Business', activeBusinessId);
            return count || 0;
        },
        enabled: !!activeBusinessId,
    });
    const { data: courierTotalCount = 0 } = useQuery({
        queryKey: ['payment-notes', 'count', 'courier', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return 0;
            const { count } = await (supabase as any).from('courier_payment_notes')
                .select('id', { count: 'exact', head: true }).eq('DigiCom Business', activeBusinessId);
            return count || 0;
        },
        enabled: !!activeBusinessId,
    });

    // ─── Active channel: server-side filtered + searched + paginated notes (+ filtered totals & pending sum) ───
    const noteTable = activeTab === 'company' ? 'company_payment_notes' : 'courier_payment_notes';
    const entityCol = activeTab === 'company' ? 'provider_id' : 'courier_id';
    const searchRpc = activeTab === 'company' ? 'search_company_payment_note_ids' : 'search_courier_payment_note_ids';
    const selectClause = activeTab === 'company'
        ? `*, provider:providers(id, name, provider_type, logo_url), line_items:company_payment_note_orders(id, order_id, tracking_code, amount, shipping_fee)`
        : `*, courier:users!courier_payment_notes_courier_id_fkey(id, name, avatar_url, avatar_config), line_items:courier_payment_note_orders(id, order_id, tracking_code, amount, shipping_fee)`;

    const { data: activeNotesData, isLoading: isLoadingNotes } = useQuery({
        queryKey: ['payment-notes', 'list', activeTab, activeBusinessId, filterStatus, entityFilter, dateFrom, dateTo, amountMin, amountMax, debouncedSearch, page],
        queryFn: async () => {
            if (!activeBusinessId) return { rows: [] as PaymentNote[], total: 0, unpaid: 0, pendingAmount: 0 };
            const term = debouncedSearch.trim();
            let ids: string[] | null = null;
            if (term.length >= 2) {
                const { data: idRows, error: idErr } = await (supabase as any).rpc(searchRpc, { p_term: term });
                if (idErr) throw idErr;
                ids = (idRows || []).map((r: any) => (typeof r === 'string' ? r : Object.values(r)[0])) as string[];
                if (ids.length === 0) return { rows: [], total: 0, unpaid: 0, pendingAmount: 0 };
            }
            const applyFilters = (q: any) => {
                q = q.eq('DigiCom Business', activeBusinessId);
                if (filterStatus !== 'all') q = q.eq('status', filterStatus);
                if (entityFilter !== 'all') q = q.eq(entityCol, entityFilter);
                if (dateFrom) q = q.gte('created_at', dateFrom);
                if (dateTo) { const d = new Date(dateTo); d.setDate(d.getDate() + 1); q = q.lt('created_at', d.toISOString().slice(0, 10)); }
                if (amountMin) q = q.gte('total_amount', Number(amountMin));
                if (amountMax) q = q.lte('total_amount', Number(amountMax));
                if (ids) q = q.in('id', ids);
                return q;
            };
            const dataQ = applyFilters((supabase as any).from(noteTable).select(selectClause))
                .order('created_at', { ascending: false }).range(0, page * NOTE_PAGE_SIZE - 1);
            const totalQ = applyFilters((supabase as any).from(noteTable).select('id', { count: 'exact', head: true }));
            const unpaidQ = applyFilters((supabase as any).from(noteTable).select('id', { count: 'exact', head: true })).eq('status', 'unpaid');
            // Server-side aggregate: a bare select('net_amount') silently caps at 1000 rows
            // (PGRST_DB_MAX_ROWS), so the client-side reduce showed wrong money past 1000
            // notes. The RPC mirrors applyFilters exactly and sums under the caller's RLS.
            const pendingSumQ = (supabase as any).rpc('payment_notes_unpaid_total', {
                p_business: activeBusinessId,
                p_kind: activeTab,
                p_status: filterStatus === 'all' ? null : filterStatus,
                p_entity: entityFilter === 'all' ? null : entityFilter,
                p_date_from: dateFrom || null,
                p_date_to: dateTo || null,
                p_amount_min: amountMin ? Number(amountMin) : null,
                p_amount_max: amountMax ? Number(amountMax) : null,
                p_ids: ids,
            });
            const [dataRes, totalRes, unpaidRes, sumRes] = await Promise.all([dataQ, totalQ, unpaidQ, pendingSumQ]);
            if (dataRes.error) throw dataRes.error;
            if (sumRes.error) throw sumRes.error;
            const rows = (dataRes.data || []).map((n: any) => ({
                ...n,
                kind: activeTab,
                ...(activeTab === 'courier' ? { provider: null } : {}),
            })) as PaymentNote[];
            const pendingAmount = Number(sumRes.data || 0);
            return { rows, total: totalRes.count || 0, unpaid: unpaidRes.count || 0, pendingAmount };
        },
        enabled: !!activeBusinessId,
    });
    const activeNotes = (activeNotesData?.rows || []) as PaymentNote[];
    const activeTotalFiltered = activeNotesData?.total || 0;
    const activeUnpaidFiltered = activeNotesData?.unpaid || 0;
    const activePendingAmount = activeNotesData?.pendingAmount || 0;
    const hasMore = activeNotes.length < activeTotalFiltered;

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
                        avatar_config: (order.courier as any)?.avatar_config ?? null,
                        orders: [],
                        total_amount: 0,
                        total_shipping: 0,
                        net_amount: 0,
                    });
                }
                const group = courierMap.get(id)!;
                group.orders.push(order);
                const amount = Number(order.price || 0);
                const shipping = resolveOrderFee(order, 'courier', id);
                group.total_amount = +(group.total_amount + amount).toFixed(2);
                group.total_shipping = +(group.total_shipping + shipping).toFixed(2);
                group.net_amount = +(group.total_amount - group.total_shipping).toFixed(2);
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
                const amount = Number(order.price || 0);
                const shipping = resolveOrderFee(order, 'company', providerId);
                group.total_amount = +(group.total_amount + amount).toFixed(2);
                group.total_shipping = +(group.total_shipping + shipping).toFixed(2);
                group.net_amount = +(group.total_amount - group.total_shipping).toFixed(2);
            }
        }
        return {
            companyGroups: Array.from(companyMap.values()),
            courierGroups: Array.from(courierMap.values()),
        };
    }, [unpaidOrders, resolveOrderFee]);

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

            // Per-order fee uses the shared component-level `resolveOrderFee` (providers →
            // shipping_cost; couriers → courier_fees.fee for the city, 0 if none) — the SAME
            // source as the preview, so the saved note can never diverge from what was shown.

            // Recalculate totals from selected orders
            const total_amount = orders.reduce((s, o) => s + Number(o.price || 0), 0);
            const total_shipping = orders.reduce((s, o) => s + resolveOrderFee(o, group.kind, group.target_id), 0);
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
                    ? pickShippedCourierTrackingCode(o)
                    : pickShippedCompanyTrackingCode(o),
                amount: +Number(o.price || 0).toFixed(2),
                shipping_fee: +resolveOrderFee(o, group.kind, group.target_id).toFixed(2),
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
            // Flip the note to paid. A DB trigger (payment_note_cascade_paid) then sets
            // every linked order to PAID + payed=true, deriving the order set from the
            // link table — not from this client's (possibly stale) note.line_items — so
            // no order is ever skipped. The pin trigger (orders_keep_paid_when_noted)
            // keeps them PAID afterwards: a delivered-status webhook can no longer demote
            // an order that belongs to a paid note.
            const { error: noteErr } = await (supabase as any)
                .from(notesTable)
                .update({ status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                .eq('id', note.id);
            if (noteErr) throw noteErr;
        },
        onSuccess: (_data, note: PaymentNote) => {
            queryClient.invalidateQueries({ queryKey: ['payment-notes'] });
            queryClient.invalidateQueries({ queryKey: ['unpaid-livre-orders'] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            toast({ title: 'Marked as paid', description: 'All linked orders changed to PAID.' });
            setIsViewNoteOpen(false); setSelectedNote(null);

            // Fire-and-forget: courier notes email the livreur a branded payout statement
            // (the same PDF) with the business's super admins in CC. Provider notes don't
            // map to a platform user, so no email there. Never blocks the mark-as-paid.
            if (note?.kind === 'courier' && note.courier?.id && activeBusinessId) {
                sendCourierPaymentNoteEmail({
                    note: {
                        id: note.id,
                        reference: note.reference,
                        total_amount: note.total_amount,
                        total_shipping_fees: note.total_shipping_fees,
                        net_amount: note.net_amount,
                        order_count: note.order_count,
                        created_at: note.created_at,
                        line_items: note.line_items || [],
                        courier: note.courier ?? null,
                    },
                    businessId: activeBusinessId,
                    paidAtIso: new Date().toISOString(),
                }).catch((e) => console.error('[payout-statement] courier email failed', e));
            }
        },
        onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });

    const stats = useMemo(() => {
        const activeUnpaidCount = activeTab === 'courier'
            ? courierGroups.reduce((s, g) => s + g.orders.length, 0)
            : companyGroups.reduce((s, g) => s + g.orders.length, 0);
        return {
            totalUnpaidOrders: activeUnpaidCount,
            pendingNotes: activeUnpaidFiltered,
            paidNotes: Math.max(0, activeTotalFiltered - activeUnpaidFiltered),
            pendingAmount: activePendingAmount,
        };
    }, [companyGroups, courierGroups, activeTab, activeUnpaidFiltered, activeTotalFiltered, activePendingAmount]);

    // ─── Filter-bar option lists ───
    const statusOptions: FilterOption[] = [
        { value: 'all', label: 'All status' },
        { value: 'unpaid', label: 'Unpaid' },
        { value: 'paid', label: 'Paid' },
    ];
    const entityOptions: FilterOption[] = activeTab === 'company'
        ? [{ value: 'all', label: 'All providers' }, ...((providerOptions || []).map((p: any) => ({ value: p.id, label: p.name || '—' })))]
        : [{ value: 'all', label: 'All couriers' }, ...((businessUsers || []).filter((u: any) => u.role === 'courier').map((u: any) => ({ value: u.id, label: u.name || '—' })))];
    const filtersActive = debouncedSearch.trim().length >= 2 || filterStatus !== 'all' || entityFilter !== 'all' || !!dateFrom || !!dateTo || !!amountMin || !!amountMax;
    const activeFilterCount = [filterStatus !== 'all', entityFilter !== 'all', !!dateFrom || !!dateTo, !!amountMin || !!amountMax].filter(Boolean).length;
    const resetFilters = () => {
        setFilterStatus('all'); setEntityFilter('all');
        setDateFrom(''); setDateTo(''); setAmountMin(''); setAmountMax(''); setSearchQuery('');
    };

    const toggleExpand = (id: string) => setExpandedCards(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    const isLoading = isLoadingUnpaid || isLoadingNotes;

    // ─── Unified target avatar (company logo OR courier user photo) ───
    const EntityLogo = ({
        kind,
        logoUrl,
        avatarUrl,
        avatarConfig,
        name,
        size = 'md',
    }: {
        kind: 'company' | 'courier';
        logoUrl?: string | null;
        avatarUrl?: string | null;
        avatarConfig?: unknown;
        name: string;
        size?: 'sm' | 'md' | 'lg';
    }) => {
        const sizeClasses = { sm: 'w-10 h-10 rounded-xl', md: 'w-14 h-14 rounded-2xl', lg: 'w-20 h-20 rounded-3xl' };
        const textSize = { sm: 'text-xs', md: 'text-sm', lg: 'text-xl' };
        const hasAvatarConfig = !!avatarConfig && typeof avatarConfig === 'object' && Object.keys(avatarConfig as object).length > 0;
        if (kind === 'company' && logoUrl) {
            return (
                <div className={cn(sizeClasses[size], "bg-ant-line-soft border border-slate-100 p-1.5 flex items-center justify-center overflow-hidden shadow-inner")}>
                    <img src={logoUrl} alt={name} className="max-w-full max-h-full object-contain" />
                </div>
            );
        }
        if (kind === 'courier' && (avatarUrl || hasAvatarConfig)) {
            return (
                <div className={cn(sizeClasses[size], "overflow-hidden border border-slate-100 shadow-inner")}>
                    <UserAvatar url={avatarUrl} config={avatarConfig} name={name} className="w-full h-full" />
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

    const companyCount = companyTotalCount;
    const courierCount = courierTotalCount;

    return (
        <div className="ant-surface px-2 md:px-3 py-2 space-y-4">
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

            {/* Tabs + filter bar */}
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
                    </div>
                </div>
            </Tabs>

            <NotesFilterBar
                search={searchQuery}
                onSearch={setSearchQuery}
                status={{ value: filterStatus, onChange: (v) => setFilterStatus(v as any), options: statusOptions, placeholder: 'Status' }}
                entity={{ value: entityFilter, onChange: setEntityFilter, options: entityOptions, placeholder: activeTab === 'company' ? 'Provider' : 'Courier' }}
                date={{ from: dateFrom, to: dateTo, onChange: (f, t) => { setDateFrom(f); setDateTo(t); } }}
                amount={{ min: amountMin, max: amountMax, onChange: (mn, mx) => { setAmountMin(mn); setAmountMax(mx); } }}
                activeCount={activeFilterCount}
                onReset={resetFilters}
            />

            {/* Payment Notes List */}
            {isLoading ? (
                <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl bg-ant-line-soft" />)}</div>
            ) : activeNotes.length === 0 ? (
                filtersActive ? (
                    <div className="rounded-2xl border border-ant-line bg-ant-paper px-6 py-14 text-center">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-ant-paper border border-ant-line mb-4">
                            <SearchX className="w-5 h-5 text-ant-mid" strokeWidth={1.5} />
                        </div>
                        <h3 className="font-display text-[18px] font-semibold text-ant-ink tracking-tight">No matches</h3>
                        <p className="font-serif-display text-[12.5px] text-ant-muted italic mt-1 mb-5 max-w-md mx-auto">
                            Try a different name, phone, tracking, reference, status or date range.
                        </p>
                        <Button
                            variant="ghost"
                            onClick={resetFilters}
                            className="h-9 px-4 rounded-full text-[12px] text-ant-mid hover:text-ant-ink"
                        >
                            Clear filters
                        </Button>
                    </div>
                ) : (
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
                )
            ) : (
                <div className="space-y-3">
                    {activeNotes.map((note: PaymentNote) => {
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
                                            <EntityLogo kind={note.kind} logoUrl={resolveProviderLogo(note.provider)} avatarUrl={note.courier?.avatar_url || null} avatarConfig={(note.courier as any)?.avatar_config} name={targetName} size="md" />
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
                    {hasMore && (
                        <div className="flex justify-center pt-1">
                            <Button
                                variant="outline"
                                onClick={() => setPage((p) => p + 1)}
                                className="h-9 px-5 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink gap-2"
                            >
                                Load more <span className="text-ant-mid tabular-nums">({activeNotes.length}/{activeTotalFiltered})</span>
                            </Button>
                        </div>
                    )}
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
                                            <EntityLogo kind={g.kind} logoUrl={g.logo_url} avatarUrl={g.avatar_url} avatarConfig={g.avatar_config} name={g.target_name} size="md" />
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
                                            setSelectionTouched(false);
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
                                            <EntityLogo kind={selectedGroup.kind} logoUrl={selectedGroup.logo_url} avatarUrl={selectedGroup.avatar_url} avatarConfig={selectedGroup.avatar_config} name={selectedGroup.target_name} size="md" />
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
                                                setSelectionTouched(true);
                                                if (allSelected) setSelectedOrderIds(new Set());
                                                else setSelectedOrderIds(new Set(allOrders.map((o) => o.id)));
                                            }}
                                            className="rounded-full h-9 px-3.5 text-[11px] font-medium border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-line-soft shrink-0"
                                        >
                                            {allSelected ? 'Deselect all' : `Select all · ${allOrders.length}`}
                                        </Button>
                                    </div>

                                    <OrderTrackingImport
                                        orders={allOrders.map((o) => ({
                                            id: o.id,
                                            trackingCodes: [
                                                ...((o.parcels || []).map(p => p.tracking_code)),
                                                ...((o.courier_parcels || []).map(p => p.tracking_code)),
                                            ],
                                        }))}
                                        totalAvailable={allOrders.length}
                                        selectedCount={selectedOrderIds.size}
                                        onApply={(ids) => {
                                            setSelectedOrderIds(prev => selectionTouched ? new Set([...prev, ...ids]) : new Set(ids));
                                        }}
                                    />

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
                                                ? (order.courier_parcels?.[0]?.tracking_code || '')
                                                : (order.parcels?.[0]?.tracking_code || '');
                                            return (
                                                <div
                                                    key={order.id}
                                                    onClick={() => {
                                                        setSelectionTouched(true);
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
                                                            −{resolveOrderFee(order, selectedGroup.kind, selectedGroup.target_id).toFixed(2)} ship
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
                            const totalShipping = filteredOrders.reduce((s, o) => s + resolveOrderFee(o, selectedGroup.kind, selectedGroup.target_id), 0);
                            const netAmount = totalAmount - totalShipping;
                            return (
                                <div className="space-y-4">
                                    <div className="flex items-center gap-3 p-4 bg-ant-light border border-ant-line rounded-xl">
                                        <EntityLogo kind={selectedGroup.kind} logoUrl={selectedGroup.logo_url} avatarUrl={selectedGroup.avatar_url} avatarConfig={selectedGroup.avatar_config} name={selectedGroup.target_name} size="md" />
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
                                                        ? (o.courier_parcels?.[0]?.tracking_code || 'N/A')
                                                        : (o.parcels?.[0]?.tracking_code || 'N/A');
                                                    const fee = resolveOrderFee(o, selectedGroup.kind, selectedGroup.target_id);
                                                    return (
                                                        <tr key={o.id} className="border-t border-ant-line hover:bg-ant-line-soft transition-colors">
                                                            <td className="px-3 py-2 text-ant-mid tabular-nums">{i + 1}</td>
                                                            <td className="px-3 py-2 font-medium text-ant-ink truncate">{o.name}</td>
                                                            <td className="px-3 py-2 font-mono text-[11.5px] text-ant-ink">{trackingCode}</td>
                                                            <td className="px-3 py-2 text-right font-medium tabular-nums">{Number(o.price || 0).toFixed(2)}</td>
                                                            <td className="px-3 py-2 text-right text-ant-rose font-medium tabular-nums">−{fee.toFixed(2)}</td>
                                                            <td className="px-3 py-2 text-right font-display font-semibold text-ant-ink tabular-nums">
                                                                {(Number(o.price || 0) - fee).toFixed(2)}
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
                                        logoUrl={resolveProviderLogo(selectedNote.provider)}
                                        avatarUrl={selectedNote.courier?.avatar_url || null}
                                        avatarConfig={(selectedNote.courier as any)?.avatar_config}
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
