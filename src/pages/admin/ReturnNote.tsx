import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import {
    Plus, Search, Loader2, Package, DollarSign, Eye, FileText,
    CheckCircle2, Clock, Building2, AlertTriangle, Truck,
    ChevronDown, ChevronRight, Printer, ArrowRight, SearchX,
    RotateCcw, PackageCheck, User, Hash, Unlock, X, Pencil,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserAvatar } from '@/components/users/UserAvatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
    AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
    AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { OrderTrackingImport } from '@/components/orders/OrderTrackingImport';
import { format } from 'date-fns';
import { pickShippedCompanyTrackingCode, pickShippedCourierTrackingCode } from '@/lib/orders/getLatestTrackableCompanyParcel';

// Package status "Retourné"
const RETOURNE_PACKAGE_STATUS_ID = 'c98d2ec2-94aa-4bfd-bc27-cdf93d46f3a9';
// Order status "RETURN"
const RETURN_ORDER_STATUS_ID = 'dbb3ae2c-abbf-4c96-93af-ed82319c8b68';
// Order status "CONFIRMER" — fallback when no prior status is recorded
const CONFIRMER_ORDER_STATUS_ID = '5c514555-0728-40c7-b6c5-2a006ed21d37';

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
    creator?: { name: string; avatar_url: string | null; avatar_config?: unknown; role: string } | null;
    line_items: { id: string; order_id: string; tracking_code: string | null; amount: number; shipping_fee: number }[];
}

const ReturnNote = () => {
    const [activeTab, setActiveTab] = useState<'company' | 'courier'>('company');
    const [isWizardOpen, setIsWizardOpen] = useState(false);
    const [wizardStep, setWizardStep] = useState(0);
    const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
    // Per-order selection for the new "Select orders" step. Initialized with
    // every order in the chosen destination group when the wizard moves from
    // step 0 → step 1; user can uncheck any line they don't want in the note.
    const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
    // True once the user manually changes the selection (click / select-all). Drives the
    // import behaviour: a fresh (untouched) import replaces the selection; once the user
    // has manually selected, an import is added on top.
    const [selectionTouched, setSelectionTouched] = useState(false);
    // Free-text search inside the Select-orders step. Matches against every
    // piece of information we can scrape off the order (name, phone, tracking,
    // product names, tracking). Reset alongside the rest of the wizard state.
    const [orderSearch, setOrderSearch] = useState('');
    const [isViewNoteOpen, setIsViewNoteOpen] = useState(false);
    const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'received'>('all');
    const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
    // Add-orders sub-dialog state. We open it from the View dialog when the
    // note is pending, scoped to the same provider/courier as the note.
    const [isAddOrdersOpen, setIsAddOrdersOpen] = useState(false);
    const [addOrdersSelection, setAddOrdersSelection] = useState<Set<string>>(new Set());
    const [addOrdersSearch, setAddOrdersSearch] = useState('');
    // Confirmation state for the unlock + remove-order destructive actions.
    // Mirrors the AlertDialog pattern used by admin/DeliveryNote.
    const [noteToUnlock, setNoteToUnlock] = useState<ReturnNote | null>(null);
    const [lineToRemove, setLineToRemove] = useState<{ note: ReturnNote; lineItem: ReturnNote['line_items'][number] } | null>(null);

    const setSelectedNote = (note: ReturnNote | null) => setSelectedNoteId(note?.id ?? null);

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
                    parcels:company_parcels(tracking_code, provider:providers(id, name, logo_url), company_delivery_note_id, created_at),
                    courier_parcels(tracking_code, courier_delivery_note_id, created_at)`)
                .eq('DigiCom Business', activeBusinessId)
                .eq('package_status_id', RETOURNE_PACKAGE_STATUS_ID)
                .is('current_return_note_id', null)
                .is('current_courier_return_note_id', null)
                .is('date_deleted', null).neq('source_review_status', 'pending')
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
                    .select(`*, provider:providers(id, name, logo_url), creator:users!company_return_notes_created_by_fkey(name, avatar_url, avatar_config, role), line_items:company_return_note_orders(id, order_id, tracking_code, amount, shipping_fee)`)
                    .eq('DigiCom Business', activeBusinessId)
                    .order('created_at', { ascending: false }),
                (supabase as any)
                    .from('courier_return_notes')
                    .select(`*, courier:users!courier_return_notes_courier_id_fkey(id, name, avatar_url), creator:users!courier_return_notes_created_by_fkey(name, avatar_url, avatar_config, role), line_items:courier_return_note_orders(id, order_id, tracking_code, amount, shipping_fee)`)
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

    const selectedNote = useMemo<ReturnNote | null>(() => {
        if (!selectedNoteId) return null;
        return (returnNotes || []).find((n: ReturnNote) => n.id === selectedNoteId) ?? null;
    }, [returnNotes, selectedNoteId]);

    // ─── Fetch return fees maps (company + courier) for lookup by (entity, master_city_id) ───
    const { data: returnFeesMap } = useQuery({
        queryKey: ['return-fees-map', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return { company: {}, courier: {} } as { company: Record<string, number>; courier: Record<string, number> };
            const [cf, kf] = await Promise.all([
                fetchAllRows('company_fees', 'company_id, master_city_id, return_fee', { filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId }] }),
                fetchAllRows('courier_fees', 'courier_id, master_city_id, return_fee', { filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId }] }),
            ]);
            const company: Record<string, number> = {};
            for (const row of (cf as any[])) {
                if (row.company_id && row.master_city_id) company[`${row.company_id}:${row.master_city_id}`] = Number(row.return_fee || 0);
            }
            const courier: Record<string, number> = {};
            for (const row of (kf as any[])) {
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

    /**
     * The group the Review step and the generate mutation operate on.
     * Derived from `selectedGroup` by filtering `orders` to only those the
     * user has checked in the Select-orders step, then recomputing totals.
     * When nothing has been explicitly selected yet (user hasn't entered
     * step 1), this mirrors `selectedGroup` so early opens stay safe.
     */
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

            // Link orders to this return note via the appropriate pointer column.
            await (supabase as any).from('orders').update({ [orderLinkField]: note.id }).in('id', group.orders.map((o) => o.id));
            return note;
        },
        onSuccess: () => {
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

    // ─── Unlock (received → pending) ───
    // Reverses markReceivedMutation: flips note status, reverts each linked
    // order back to its pre-RETURN status (read from order_status_history),
    // and re-deducts stock for items the trigger restored on receive.
    // The orders.order_status_id update doesn't fire any stock branch in the
    // trigger when the new status isn't PROCESSED/RETURN/CONFIRMED with the
    // matching stock_changed flag, so we manage stock manually here.
    const unlockNoteMutation = useMutation({
        mutationFn: async (note: ReturnNote) => {
            if (note.status !== 'received') throw new Error('Note is not received');
            const notesTable = note.kind === 'courier' ? 'courier_return_notes' : 'company_return_notes';
            const orderIds = note.line_items.map(li => li.order_id);

            // 1) Reverse stock per order: read items, add back what the
            //    receive-trigger added (i.e. deduct again), and reset
            //    stock_changed to true so the lifecycle stays consistent.
            for (const orderId of orderIds) {
                const { data: items, error: itemsErr } = await (supabase as any)
                    .from('order_items')
                    .select('product_id, quantity, accessory_id, accessory_quantity')
                    .eq('order_id', orderId);
                if (itemsErr) throw itemsErr;
                for (const it of (items || [])) {
                    if (it.product_id && Number(it.quantity) > 0) {
                        const { data: prod } = await (supabase as any)
                            .from('products').select('stock').eq('id', it.product_id).single();
                        const next = Math.max(0, Number(prod?.stock || 0) - Number(it.quantity));
                        await (supabase as any).from('products').update({ stock: next }).eq('id', it.product_id);
                    }
                    if (it.accessory_id && Number(it.accessory_quantity) > 0) {
                        const { data: acc } = await (supabase as any)
                            .from('accessories').select('stock').eq('id', it.accessory_id).single();
                        const next = Math.max(0, Number(acc?.stock || 0) - Number(it.accessory_quantity));
                        await (supabase as any).from('accessories').update({ stock: next }).eq('id', it.accessory_id);
                    }
                }
            }

            // 2) Look up each order's status RIGHT BEFORE it was set to RETURN.
            //    history rows are appended on every status change, so the
            //    one immediately preceding the latest RETURN entry is the
            //    pre-receive status. Fall back to CONFIRMER if no history.
            const priorByOrder = new Map<string, string>();
            for (const orderId of orderIds) {
                const { data: hist } = await (supabase as any)
                    .from('order_status_history')
                    .select('status_id, created_at')
                    .eq('order_id', orderId)
                    .order('created_at', { ascending: false })
                    .limit(20);
                let prior: string | null = null;
                const rows = (hist || []) as Array<{ status_id: string }>;
                const idxReturn = rows.findIndex(r => r.status_id === RETURN_ORDER_STATUS_ID);
                if (idxReturn >= 0 && rows[idxReturn + 1]) {
                    prior = rows[idxReturn + 1].status_id;
                }
                priorByOrder.set(orderId, prior || CONFIRMER_ORDER_STATUS_ID);
            }

            // 3) Set order_status_id back per order; mark stock_changed=true
            //    so future PROCESSED/RETURN cycles behave correctly.
            for (const orderId of orderIds) {
                const targetStatus = priorByOrder.get(orderId) || CONFIRMER_ORDER_STATUS_ID;
                const { error } = await (supabase as any)
                    .from('orders')
                    .update({ order_status_id: targetStatus, stock_changed: true, updated_at: new Date().toISOString() })
                    .eq('id', orderId);
                if (error) throw error;
            }

            // 4) Flip note state back to pending and clear received_at.
            const { error: noteErr } = await (supabase as any)
                .from(notesTable)
                .update({ status: 'pending', received_at: null, updated_at: new Date().toISOString() })
                .eq('id', note.id);
            if (noteErr) throw noteErr;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['return-notes'] });
            queryClient.invalidateQueries({ queryKey: ['retourne-orders'] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            toast({ title: 'Note unlocked', description: 'You can now add or remove orders. Stock was re-deducted.' });
        },
        onError: (e: any) => toast({ title: 'Unlock failed', description: e.message, variant: 'destructive' }),
    });

    // ─── Add orders to an existing pending note ───
    const addOrdersToNoteMutation = useMutation({
        mutationFn: async ({ note, orders }: { note: ReturnNote; orders: ReturnOrder[] }) => {
            if (note.status !== 'pending') throw new Error('Only pending notes can be edited');
            if (orders.length === 0) return;
            const lineItemsTable = note.kind === 'courier' ? 'courier_return_note_orders' : 'company_return_note_orders';
            const orderLinkField = note.kind === 'courier' ? 'current_courier_return_note_id' : 'current_return_note_id';
            const notesTable = note.kind === 'courier' ? 'courier_return_notes' : 'company_return_notes';

            const newLines = orders.map((o) => ({
                return_note_id: note.id,
                order_id: o.id,
                tracking_code: note.kind === 'courier'
                    ? pickShippedCourierTrackingCode(o)
                    : pickShippedCompanyTrackingCode(o),
                amount: Number(o.price || 0),
                shipping_fee: getReturnFeeForOrder(o),
                'DigiCom Business': activeBusinessId,
            }));
            const { error: insErr } = await (supabase as any).from(lineItemsTable).insert(newLines);
            if (insErr) throw insErr;

            await (supabase as any).from('orders')
                .update({ [orderLinkField]: note.id })
                .in('id', orders.map(o => o.id));

            // Recompute totals from the source of truth (line items).
            const { data: allLines } = await (supabase as any)
                .from(lineItemsTable)
                .select('amount, shipping_fee')
                .eq('return_note_id', note.id);
            const total_amount = (allLines || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
            const total_shipping_fees = (allLines || []).reduce((s: number, r: any) => s + Number(r.shipping_fee || 0), 0);
            await (supabase as any).from(notesTable).update({
                total_amount,
                total_shipping_fees,
                net_amount: total_amount - total_shipping_fees,
                order_count: (allLines || []).length,
                updated_at: new Date().toISOString(),
            }).eq('id', note.id);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['return-notes'] });
            queryClient.invalidateQueries({ queryKey: ['retourne-orders'] });
            toast({ title: 'Orders added', description: 'Note totals were recomputed.' });
        },
        onError: (e: any) => toast({ title: 'Could not add orders', description: e.message, variant: 'destructive' }),
    });

    // ─── Remove a single order from a pending note ───
    const removeOrderFromNoteMutation = useMutation({
        mutationFn: async ({ note, lineItem }: { note: ReturnNote; lineItem: ReturnNote['line_items'][number] }) => {
            if (note.status !== 'pending') throw new Error('Only pending notes can be edited');
            const lineItemsTable = note.kind === 'courier' ? 'courier_return_note_orders' : 'company_return_note_orders';
            const orderLinkField = note.kind === 'courier' ? 'current_courier_return_note_id' : 'current_return_note_id';
            const notesTable = note.kind === 'courier' ? 'courier_return_notes' : 'company_return_notes';

            const { error: delErr } = await (supabase as any).from(lineItemsTable).delete().eq('id', lineItem.id);
            if (delErr) throw delErr;

            await (supabase as any).from('orders')
                .update({ [orderLinkField]: null })
                .eq('id', lineItem.order_id);

            const { data: allLines } = await (supabase as any)
                .from(lineItemsTable)
                .select('amount, shipping_fee')
                .eq('return_note_id', note.id);
            const total_amount = (allLines || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
            const total_shipping_fees = (allLines || []).reduce((s: number, r: any) => s + Number(r.shipping_fee || 0), 0);
            await (supabase as any).from(notesTable).update({
                total_amount,
                total_shipping_fees,
                net_amount: total_amount - total_shipping_fees,
                order_count: (allLines || []).length,
                updated_at: new Date().toISOString(),
            }).eq('id', note.id);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['return-notes'] });
            queryClient.invalidateQueries({ queryKey: ['retourne-orders'] });
            toast({ title: 'Order removed' });
        },
        onError: (e: any) => toast({ title: 'Could not remove order', description: e.message, variant: 'destructive' }),
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
        w.document.write('<!doctype html><html><head><title>' + note.reference + '</title></head><body style="font-family:Inter,system-ui;padding:40px;color:#141413;background:#faf9f5">Loading…</body></html>');
        w.document.close();

        let businessName = 'iGrowFast';
        let businessLogo: string | null = null;
        if (activeBusinessId) {
            const { data } = await (supabase as any).from('businesses').select('name, logo').eq('id', activeBusinessId).single();
            if (data) { businessName = data.name || businessName; businessLogo = data.logo || null; }
        }

        const entityName = note.kind === 'courier' ? (note.courier?.name || 'Unknown courier') : (note.provider?.name || 'Unknown provider');
        const entityImage = note.kind === 'courier' ? (note.courier?.avatar_url || null) : (note.provider?.logo_url || null);
        const entityLabel = note.kind === 'courier' ? 'Courier agent' : 'Provider';
        const createdAt = format(new Date(note.created_at), "dd MMM yyyy 'at' HH:mm");
        const receivedAt = note.received_at ? format(new Date(note.received_at), "dd MMM yyyy 'at' HH:mm") : null;

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
  .meta .kicker::before { content: ''; display: inline-block; width: 4px; height: 4px; border-radius: 999px; background: var(--rose); }
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
  .entity .badge.pending { background: rgba(201, 99, 86, 0.10); color: var(--rose); border-color: rgba(201, 99, 86, 0.25); }
  .entity .badge.pending::before { background: var(--rose); }
  .entity .badge.received { background: rgba(120, 140, 93, 0.10); color: var(--green); border-color: rgba(120, 140, 93, 0.25); }
  .entity .badge.received::before { background: var(--green); }

  /* ── KPI strip ────────────────────────────────────────────── */
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; margin-top: 16px; background: var(--line); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .stat { padding: 14px 16px; background: var(--paper); }
  .stat .k { display: inline-flex; align-items: center; gap: 6px; font-size: 9.5px; font-weight: 500; color: var(--mid); text-transform: uppercase; letter-spacing: 0.22em; margin-bottom: 6px; }
  .stat .k::before { content: ''; display: inline-block; width: 4px; height: 4px; border-radius: 999px; background: var(--ink); }
  .stat.rose .k::before { background: var(--rose); }
  .stat.orange .k::before { background: var(--orange); }
  .stat .v { font-family: 'Poppins', sans-serif; font-size: 20px; font-weight: 600; color: var(--ink); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .stat .v .suffix { font-family: 'Inter', sans-serif; font-size: 10px; font-weight: 500; color: var(--mid); margin-left: 4px; letter-spacing: 0; }
  .stat .v.rose { color: var(--rose); }

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
  .totals .col.net .val { color: var(--orange); }

  /* ── Footer ───────────────────────────────────────────────── */
  .foot { margin-top: auto; padding-top: 22px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: var(--mid); font-weight: 500; text-transform: uppercase; letter-spacing: 0.22em; }
  .foot .received { font-family: 'Lora', Georgia, serif; font-style: italic; font-weight: 500; color: var(--green); text-transform: none; letter-spacing: 0; font-size: 11.5px; }
</style></head><body>
<div class="sheet">
  <div class="hdr">
    <div class="brand">
      ${businessLogo ? `<div class="logo"><img src="${businessLogo}" alt=""/></div>` : `<div class="logo fallback">${businessName.substring(0, 2).toUpperCase()}</div>`}
      <div>
        <div class="name">${businessName}</div>
        <div class="sub">Return note</div>
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
    <span class="badge ${note.status}">${note.status === 'received' ? 'Received' : 'Pending'}</span>
  </div>

  <div class="stats">
    <div class="stat"><div class="k">Orders</div><div class="v">${note.order_count}</div></div>
    <div class="stat"><div class="k">Gross amount</div><div class="v">${Number(note.total_amount).toFixed(2)}<span class="suffix">MAD</span></div></div>
    <div class="stat rose"><div class="k">Return fees</div><div class="v rose">−${Number(note.total_shipping_fees).toFixed(2)}<span class="suffix">MAD</span></div></div>
  </div>

  <table>
    <thead><tr><th>#</th><th>Tracking</th><th class="right">Amount</th><th class="right">Fee</th><th class="right">Net</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div class="inner">
      <div class="col"><div class="lbl">Gross</div><div class="val">${Number(note.total_amount).toFixed(2)}<span class="suffix">MAD</span></div></div>
      <div class="col rose"><div class="lbl">Return fees</div><div class="val">−${Number(note.total_shipping_fees).toFixed(2)}<span class="suffix">MAD</span></div></div>
      <div class="col net"><div class="lbl">Net value</div><div class="val">${Number(note.net_amount).toFixed(2)}<span class="suffix">MAD</span></div></div>
    </div>
  </div>

  <div class="foot">
    <span>${businessName} · Return note</span>
    ${receivedAt ? `<span class="received">Received on ${receivedAt}</span>` : `<span>Reference · ${note.reference}</span>`}
  </div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},300);};</script>
</body></html>`;

        w.document.open();
        w.document.write(html);
        w.document.close();
    };

    const companyCount = (returnNotes || []).filter((n: ReturnNote) => n.kind === 'company').length;
    const courierCount = (returnNotes || []).filter((n: ReturnNote) => n.kind === 'courier').length;

    return (
        <div className="ant-surface px-2 md:px-3 py-2 space-y-4">
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
                    onClick={() => { setIsWizardOpen(true); setWizardStep(0); setSelectedProvider(null); setSelectedOrderIds(new Set()); setOrderSearch(''); }}
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
                        onClick={() => { setIsWizardOpen(true); setWizardStep(0); setSelectedProvider(null); setSelectedOrderIds(new Set()); setOrderSearch(''); }}
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
                                                        <UserAvatar url={note.creator?.avatar_url} config={(note.creator as any)?.avatar_config} name={note.creator?.name} className="w-4 h-4 rounded-full shrink-0" />
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
                                                {!isReceived ? (
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
                                                ) : (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => setNoteToUnlock(note)}
                                                        disabled={unlockNoteMutation.isPending}
                                                        className="h-9 px-3.5 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-line-soft text-[11.5px] font-medium gap-1.5"
                                                    >
                                                        {unlockNoteMutation.isPending && unlockNoteMutation.variables?.id === note.id ? (
                                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                        ) : (
                                                            <>
                                                                <Unlock className="w-3.5 h-3.5" />
                                                                Unlock
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
            <Dialog open={isWizardOpen} onOpenChange={v => { if (!v) { setIsWizardOpen(false); setWizardStep(0); setSelectedProvider(null); setSelectedOrderIds(new Set()); setOrderSearch(''); } }}>
                <DialogContent className="ant-surface max-w-3xl p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden max-h-[90vh] overflow-y-auto custom-scrollbar">
                    <DialogHeader className="px-6 pt-6 pb-3 border-b border-ant-line">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="w-1 h-1 rounded-full bg-ant-orange" />
                            <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                Return note wizard
                            </span>
                        </div>
                        <DialogTitle className="font-display text-[22px] font-semibold text-ant-ink tracking-[-0.02em]">
                            {wizardStep === 0
                                ? 'Pick a destination'
                                : wizardStep === 1
                                    ? 'Select orders'
                                    : 'Review & generate'}
                        </DialogTitle>
                        <DialogDescription className="font-serif-display text-[12.5px] text-ant-muted italic mt-0.5">
                            {wizardStep === 0
                                ? `Choose the ${activeTab === 'courier' ? 'courier' : 'provider'} whose returned parcels you want to reconcile.`
                                : wizardStep === 1
                                    ? 'Pick which returned parcels to include in this note.'
                                    : 'Check the lines, then generate a reconciled return note.'}
                        </DialogDescription>
                    </DialogHeader>

                    {/* Step indicator */}
                    <div className="px-6 pt-5 flex items-center gap-3">
                        {[
                            { i: 0, label: 'Destination' },
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

                    {/* min-w-0: this is a CSS-grid item (DialogContent is `grid`); without it
                        the item's default min-width:auto can override max-w-3xl and stretch the
                        whole modal wide when long order/product names report a big min-content. */}
                    <div className="p-6 min-w-0">
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
                                        onClick={() => {
                                            // Pre-select every order in the group; the user can
                                            // uncheck lines in the next step.
                                            if (selectedGroup) {
                                                setSelectedOrderIds(new Set(selectedGroup.orders.map(o => o.id)));
                                            }
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

                        {wizardStep === 1 && selectedGroup && (() => {
                            // Substring match against every piece of data an operator
                            // might look at: name, phone, city, tracking (company or
                            // courier parcel), product names + codes, and the raw
                            // price. Case-insensitive, free-text — "type anything".
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
                                <div className="space-y-4">
                                    <div className="flex items-center gap-3 p-4 bg-ant-light border border-ant-line rounded-xl">
                                        <EntityLogo kind={selectedGroup.kind} logoUrl={selectedGroup.logo_url} avatarUrl={selectedGroup.avatar_url} name={selectedGroup.target_name} size="md" />
                                        <div className="min-w-0 flex-1">
                                            <p className="font-display text-[15px] font-semibold text-ant-ink tracking-[-0.01em] truncate">
                                                {selectedGroup.target_name}
                                            </p>
                                            <p className="text-[11px] text-ant-muted mt-0.5 tabular-nums">
                                                {selectedGroup.orders.length} returned orders available — {selectedOrderIds.size} selected
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
                                            // Untouched (default) selection → replace with the import;
                                            // a manual selection already exists → add the import on top.
                                            setSelectedOrderIds(prev => selectionTouched ? new Set([...prev, ...ids]) : new Set(ids));
                                        }}
                                    />

                                    <div className="flex items-center gap-2">
                                        <div className="relative flex-1">
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
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectionTouched(true);
                                                setSelectedOrderIds(allSelected
                                                    ? new Set()
                                                    : new Set(selectedGroup.orders.map(o => o.id)));
                                            }}
                                            className="flex items-center gap-2 text-[11.5px] font-semibold text-ant-ink hover:text-ant-ink/70 transition-colors shrink-0 px-2 h-9 rounded-xl border border-ant-line bg-ant-paper"
                                        >
                                            <span className={cn(
                                                'w-4 h-4 rounded border flex items-center justify-center transition-colors',
                                                allSelected ? 'bg-ant-ink border-ant-ink' : 'border-ant-line bg-ant-paper',
                                            )}>
                                                {allSelected && <CheckCircle2 className="w-3 h-3 text-ant-light" />}
                                            </span>
                                            {allSelected ? 'Deselect all' : `Select all (${selectedGroup.orders.length})`}
                                        </button>
                                    </div>

                                    <div className="space-y-1.5 max-h-[400px] overflow-y-auto custom-scrollbar pr-1">
                                        {visibleOrders.length === 0 && (
                                            <div className="font-serif-display text-[12px] text-ant-muted italic py-6 text-center">
                                                No orders match "{orderSearch}"
                                            </div>
                                        )}
                                        {visibleOrders.map((o) => {
                                            const checked = selectedOrderIds.has(o.id);
                                            const trackingCode =
                                                o.courier_parcels?.[0]?.tracking_code
                                                || o.parcels?.[0]?.tracking_code
                                                || o.tracking_number;
                                            const itemsLabel = (o.items || [])
                                                .filter(i => i.quantity > 0)
                                                .map(i => `${i.product?.name || 'Item'} ×${i.quantity}`)
                                                .join(', ');
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
                                                        'w-full p-3 rounded-xl border text-left flex items-center gap-3 transition-all',
                                                        checked
                                                            ? 'border-ant-ink/30 bg-ant-ink/[0.04]'
                                                            : 'border-ant-line bg-ant-paper hover:border-ant-ink/15',
                                                    )}
                                                >
                                                    <span className={cn(
                                                        'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                                                        checked ? 'bg-ant-ink border-ant-ink' : 'border-ant-line bg-ant-paper',
                                                    )}>
                                                        {checked && <CheckCircle2 className="w-3 h-3 text-ant-light" />}
                                                    </span>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-display text-[13px] font-semibold text-ant-ink truncate">{o.name || 'No name'}</span>
                                                            {trackingCode && (
                                                                <span className="font-mono text-[10px] text-ant-mid truncate">{trackingCode}</span>
                                                            )}
                                                        </div>
                                                        <div className="text-[11px] text-ant-muted mt-0.5 truncate">
                                                            {o.phone || '—'}
                                                            {itemsLabel && <> · {itemsLabel}</>}
                                                        </div>
                                                    </div>
                                                    <div className="text-right shrink-0 tabular-nums">
                                                        <div className="font-display text-[13px] font-semibold text-ant-ink">
                                                            {Number(o.price || 0).toFixed(2)}
                                                            <span className="text-[9px] text-ant-mid font-medium ml-1">MAD</span>
                                                        </div>
                                                        <div className="text-[10px] text-ant-rose">
                                                            −{getReturnFeeForOrder(o).toFixed(2)}
                                                        </div>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    <div className="flex justify-end gap-2 pt-1">
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
                                            Next ({selectedOrderIds.size}) <ArrowRight className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            );
                        })()}

                        {wizardStep === 2 && filteredGroup && (
                            <div className="space-y-4">
                                <div className="flex items-center gap-3 p-4 bg-ant-light border border-ant-line rounded-xl">
                                    <EntityLogo kind={filteredGroup.kind} logoUrl={filteredGroup.logo_url} avatarUrl={filteredGroup.avatar_url} name={filteredGroup.target_name} size="md" />
                                    <div className="min-w-0">
                                        <p className="font-display text-[15px] font-semibold text-ant-ink tracking-[-0.01em] truncate">
                                            {filteredGroup.target_name}
                                        </p>
                                        <p className="text-[11px] text-ant-muted mt-0.5 tabular-nums">
                                            {filteredGroup.orders.length} returned orders to include
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
                                            {filteredGroup.orders.map((o, i) => (
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
                                                {filteredGroup.total_amount.toFixed(2)}
                                            </span>
                                        </div>
                                        <div className="bg-ant-ink px-4 py-3 text-left">
                                            <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-light/50 block mb-1">Shipping fees</span>
                                            <span className="font-display text-[20px] font-semibold tabular-nums tracking-[-0.02em] text-ant-rose">
                                                −{filteredGroup.total_shipping.toFixed(2)}
                                            </span>
                                        </div>
                                        <div className="bg-ant-ink px-4 py-3 text-left">
                                            <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-light/50 block mb-1">Net value</span>
                                            <span className="font-display text-[20px] font-semibold tabular-nums tracking-[-0.02em] text-ant-orange">
                                                {filteredGroup.net_amount.toFixed(2)}
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
                                        onClick={() => generateNoteMutation.mutate(filteredGroup)}
                                        disabled={generateNoteMutation.isPending || filteredGroup.orders.length === 0}
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
                                            <UserAvatar url={selectedNote.creator?.avatar_url} config={(selectedNote.creator as any)?.avatar_config} name={selectedNote.creator?.name} className="w-6 h-6 rounded-full" />
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
                                                {selectedNote.status === 'pending' && <th className="px-3 py-2.5 w-10" />}
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
                                                    {selectedNote.status === 'pending' && (
                                                        <td className="px-2 py-2 text-right">
                                                            <button
                                                                type="button"
                                                                onClick={() => setLineToRemove({ note: selectedNote, lineItem: li })}
                                                                disabled={removeOrderFromNoteMutation.isPending || selectedNote.line_items.length <= 1}
                                                                title={selectedNote.line_items.length <= 1 ? 'A note must keep at least one order — delete the note instead' : 'Remove from note'}
                                                                className="inline-flex items-center justify-center w-7 h-7 rounded-full text-ant-mid hover:text-ant-rose hover:bg-ant-rose/10 transition disabled:opacity-30 disabled:cursor-not-allowed"
                                                            >
                                                                <X className="w-3.5 h-3.5" />
                                                            </button>
                                                        </td>
                                                    )}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {selectedNote.status === 'pending' && (
                                    <Button
                                        variant="outline"
                                        onClick={() => { setAddOrdersSelection(new Set()); setAddOrdersSearch(''); setIsAddOrdersOpen(true); }}
                                        className="w-full h-10 rounded-xl border-dashed border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-line-soft font-medium text-[12px] gap-1.5"
                                    >
                                        <Plus className="w-3.5 h-3.5" />
                                        Add orders to this note
                                    </Button>
                                )}

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
                                    {selectedNote.status === 'pending' ? (
                                        <Button
                                            onClick={() => markReceivedMutation.mutate(selectedNote)}
                                            disabled={markReceivedMutation.isPending}
                                            className="h-10 px-5 rounded-full bg-ant-green hover:bg-ant-green/90 text-white font-medium text-[12px] gap-1.5"
                                        >
                                            {markReceivedMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackageCheck className="w-3.5 h-3.5" />}
                                            Mark as received
                                        </Button>
                                    ) : (
                                        <Button
                                            variant="outline"
                                            onClick={() => setNoteToUnlock(selectedNote)}
                                            disabled={unlockNoteMutation.isPending}
                                            className="h-10 px-5 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-line-soft font-medium text-[12px] gap-1.5"
                                        >
                                            {unlockNoteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlock className="w-3.5 h-3.5" />}
                                            Unlock
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* ─── ADD ORDERS SUB-DIALOG ─── */}
            <Dialog open={isAddOrdersOpen} onOpenChange={v => { if (!v) { setIsAddOrdersOpen(false); setAddOrdersSelection(new Set()); setAddOrdersSearch(''); } }}>
                <DialogContent className="ant-surface max-w-2xl p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden max-h-[85vh] overflow-y-auto custom-scrollbar">
                    {selectedNote && (() => {
                        // Eligible = same target (provider for company, courier for courier),
                        // present in the pool of returned orders not yet linked to any note.
                        const eligible = (returnOrders || []).filter((o) => {
                            if (selectedNote.kind === 'company') {
                                const pid = o.company?.id || o.parcels?.[0]?.provider?.id || o.company_id;
                                return !!selectedNote.provider?.id && pid === selectedNote.provider.id;
                            }
                            const cid = o.courier?.id || o.courier_id;
                            return !!selectedNote.courier?.id && cid === selectedNote.courier.id;
                        });
                        const q = addOrdersSearch.trim().toLowerCase();
                        const visible = !q ? eligible : eligible.filter((o) => {
                            const codes = [
                                ...(o.parcels || []).map(p => p.tracking_code).filter(Boolean),
                                ...(o.courier_parcels || []).map(p => p.tracking_code).filter(Boolean),
                                o.tracking_number,
                            ].filter(Boolean) as string[];
                            const items = (o.items || []).map(i => i.product?.name || '').filter(Boolean);
                            const hay = [o.name, o.phone, ...codes, ...items, String(o.price ?? '')].join(' ').toLowerCase();
                            return hay.includes(q);
                        });
                        const allSelected = visible.length > 0 && visible.every(o => addOrdersSelection.has(o.id));
                        const selectedOrders = eligible.filter(o => addOrdersSelection.has(o.id));
                        return (
                            <>
                                <DialogHeader className="px-6 pt-6 pb-3 border-b border-ant-line">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="w-1 h-1 rounded-full bg-ant-orange" />
                                        <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Add orders</span>
                                    </div>
                                    <DialogTitle className="font-display text-[20px] font-semibold text-ant-ink tracking-[-0.02em]">
                                        Pick returned orders to attach
                                    </DialogTitle>
                                    <DialogDescription className="font-serif-display text-[12.5px] text-ant-muted italic mt-0.5">
                                        Showing returned orders for {selectedNote.kind === 'courier' ? (selectedNote.courier?.name || '—') : (selectedNote.provider?.name || '—')} not yet on any note.
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="px-6 py-5 space-y-3">
                                    {eligible.length === 0 ? (
                                        <div className="rounded-xl border border-ant-line bg-ant-light py-10 text-center">
                                            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-ant-orange/10 ring-1 ring-ant-orange/20 mb-3">
                                                <AlertTriangle className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                                            </div>
                                            <p className="font-display text-[15px] font-semibold text-ant-ink tracking-tight">No eligible orders</p>
                                            <p className="font-serif-display text-[12px] text-ant-muted italic mt-1">
                                                Every returned order for this {selectedNote.kind === 'courier' ? 'courier' : 'provider'} is already on a note.
                                            </p>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="flex items-center gap-2">
                                                <div className="relative flex-1">
                                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                                                    <Input
                                                        value={addOrdersSearch}
                                                        onChange={(e) => setAddOrdersSearch(e.target.value)}
                                                        placeholder="Search by name, phone, tracking, product..."
                                                        className="h-9 pl-9 pr-8 rounded-xl border-ant-line bg-ant-paper text-[12px]"
                                                    />
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (allSelected) setAddOrdersSelection(new Set());
                                                        else setAddOrdersSelection(new Set(visible.map(o => o.id)));
                                                    }}
                                                    className="flex items-center gap-2 text-[11.5px] font-semibold text-ant-ink hover:text-ant-ink/70 transition-colors shrink-0 px-2 h-9 rounded-xl border border-ant-line bg-ant-paper"
                                                >
                                                    <span className={cn('w-4 h-4 rounded border flex items-center justify-center transition-colors',
                                                        allSelected ? 'bg-ant-ink border-ant-ink' : 'border-ant-line bg-ant-paper')}>
                                                        {allSelected && <CheckCircle2 className="w-3 h-3 text-ant-light" />}
                                                    </span>
                                                    {allSelected ? 'Deselect all' : `Select all (${visible.length})`}
                                                </button>
                                            </div>

                                            <div className="space-y-1.5 max-h-[400px] overflow-y-auto custom-scrollbar pr-1">
                                                {visible.length === 0 && (
                                                    <div className="font-serif-display text-[12px] text-ant-muted italic py-6 text-center">
                                                        No orders match "{addOrdersSearch}"
                                                    </div>
                                                )}
                                                {visible.map((o) => {
                                                    const checked = addOrdersSelection.has(o.id);
                                                    const trackingCode = pickShippedCompanyTrackingCode(o) || pickShippedCourierTrackingCode(o) || o.tracking_number;
                                                    const itemsLabel = (o.items || [])
                                                        .filter(i => i.quantity > 0)
                                                        .map(i => `${i.product?.name || 'Item'} ×${i.quantity}`)
                                                        .join(', ');
                                                    return (
                                                        <button
                                                            key={o.id}
                                                            type="button"
                                                            onClick={() => {
                                                                setAddOrdersSelection(prev => {
                                                                    const next = new Set(prev);
                                                                    if (next.has(o.id)) next.delete(o.id);
                                                                    else next.add(o.id);
                                                                    return next;
                                                                });
                                                            }}
                                                            className={cn(
                                                                'w-full p-3 rounded-xl border text-left flex items-center gap-3 transition-all',
                                                                checked ? 'border-ant-ink/30 bg-ant-ink/[0.04]' : 'border-ant-line bg-ant-paper hover:border-ant-ink/15',
                                                            )}
                                                        >
                                                            <span className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                                                                checked ? 'bg-ant-ink border-ant-ink' : 'border-ant-line bg-ant-paper')}>
                                                                {checked && <CheckCircle2 className="w-3 h-3 text-ant-light" />}
                                                            </span>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="font-display text-[13px] font-semibold text-ant-ink truncate">{o.name || 'No name'}</span>
                                                                    {trackingCode && <span className="font-mono text-[10px] text-ant-mid truncate">{trackingCode}</span>}
                                                                </div>
                                                                <div className="text-[11px] text-ant-muted mt-0.5 truncate">
                                                                    {o.phone || '—'}
                                                                    {itemsLabel && <> · {itemsLabel}</>}
                                                                </div>
                                                            </div>
                                                            <div className="text-right shrink-0 tabular-nums">
                                                                <div className="font-display text-[13px] font-semibold text-ant-ink">
                                                                    {Number(o.price || 0).toFixed(2)}
                                                                    <span className="text-[9px] text-ant-mid font-medium ml-1">MAD</span>
                                                                </div>
                                                                <div className="text-[10px] text-ant-rose">
                                                                    −{getReturnFeeForOrder(o).toFixed(2)}
                                                                </div>
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </>
                                    )}

                                    <div className="flex justify-end gap-2 pt-2">
                                        <Button
                                            variant="outline"
                                            onClick={() => { setIsAddOrdersOpen(false); setAddOrdersSelection(new Set()); setAddOrdersSearch(''); }}
                                            className="h-10 px-4 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-line-soft font-medium text-[12px]"
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            disabled={selectedOrders.length === 0 || addOrdersToNoteMutation.isPending}
                                            onClick={async () => {
                                                await addOrdersToNoteMutation.mutateAsync({ note: selectedNote, orders: selectedOrders });
                                                setIsAddOrdersOpen(false);
                                                setAddOrdersSelection(new Set());
                                                setAddOrdersSearch('');
                                            }}
                                            className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light font-medium text-[12px] gap-1.5 disabled:opacity-50"
                                        >
                                            {addOrdersToNoteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                                            Add {selectedOrders.length || ''} order{selectedOrders.length === 1 ? '' : 's'}
                                        </Button>
                                    </div>
                                </div>
                            </>
                        );
                    })()}
                </DialogContent>
            </Dialog>

            {/* ─── UNLOCK CONFIRMATION ─── */}
            <AlertDialog open={!!noteToUnlock} onOpenChange={(open) => { if (!open) setNoteToUnlock(null); }}>
                <AlertDialogContent className="ant-surface rounded-2xl border border-ant-line bg-ant-paper shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] max-w-md p-6">
                    <AlertDialogHeader className="space-y-2">
                        <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-ant-orange/10 ring-1 ring-ant-orange/20 mb-1">
                            <Unlock className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                        </div>
                        <AlertDialogTitle className="font-display text-[18px] font-semibold text-ant-ink tracking-[-0.02em]">
                            Unlock {noteToUnlock?.reference}?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="font-serif-display text-[12.5px] text-ant-muted italic leading-relaxed">
                            Linked orders will revert to their pre-receive status and stock will be re-deducted (the receive added it back). Use this only if marking as received was a mistake.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2 pt-3">
                        <AlertDialogCancel className="rounded-full h-10 px-4 font-medium border border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-line-soft hover:text-ant-ink m-0 text-[12px]">
                            Cancel
                        </AlertDialogCancel>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={unlockNoteMutation.isPending}
                            onClick={async () => {
                                if (!noteToUnlock) return;
                                const target = noteToUnlock;
                                setNoteToUnlock(null);
                                await unlockNoteMutation.mutateAsync(target);
                            }}
                            className="rounded-full h-10 px-4 font-medium text-[12px] bg-ant-orange hover:bg-ant-orange/90 m-0 w-full sm:w-auto"
                        >
                            {unlockNoteMutation.isPending ? (
                                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                            ) : (
                                <Unlock className="w-3.5 h-3.5 mr-1.5" />
                            )}
                            Unlock
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* ─── REMOVE ORDER FROM NOTE CONFIRMATION ─── */}
            <AlertDialog open={!!lineToRemove} onOpenChange={(open) => { if (!open) setLineToRemove(null); }}>
                <AlertDialogContent className="ant-surface rounded-2xl border border-ant-line bg-ant-paper shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] max-w-md p-6">
                    <AlertDialogHeader className="space-y-2">
                        <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-ant-rose/10 ring-1 ring-ant-rose/20 mb-1">
                            <X className="w-5 h-5 text-ant-rose" strokeWidth={1.75} />
                        </div>
                        <AlertDialogTitle className="font-display text-[18px] font-semibold text-ant-ink tracking-[-0.02em]">
                            Remove this order from the note?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="font-serif-display text-[12.5px] text-ant-muted italic leading-relaxed">
                            The order returns to the pool of returned orders not yet on a note. The note totals will be recomputed. {lineToRemove?.lineItem?.tracking_code && (<><br/><span className="font-mono text-[11px] text-ant-ink not-italic">{lineToRemove.lineItem.tracking_code}</span></>)}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2 pt-3">
                        <AlertDialogCancel className="rounded-full h-10 px-4 font-medium border border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-line-soft hover:text-ant-ink m-0 text-[12px]">
                            Cancel
                        </AlertDialogCancel>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={removeOrderFromNoteMutation.isPending}
                            onClick={async () => {
                                if (!lineToRemove) return;
                                const target = lineToRemove;
                                setLineToRemove(null);
                                await removeOrderFromNoteMutation.mutateAsync(target);
                            }}
                            className="rounded-full h-10 px-4 font-medium text-[12px] bg-ant-rose hover:bg-ant-rose/90 m-0 w-full sm:w-auto"
                        >
                            {removeOrderFromNoteMutation.isPending ? (
                                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                            ) : (
                                <X className="w-3.5 h-3.5 mr-1.5" />
                            )}
                            Remove
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default ReturnNote;
