/**
 * MIRROR of src/pages/admin/Orders.tsx create flow (schemas L224-345, queries
 * L1086-1296, form L1327-1354, fee/provider logic L1512-1672, renderOrderLine
 * L1677-1936, createOrderMutation L1939-2192, create dialog JSX L3950-5199,
 * reported sub-dialog L5941-6011) — extracted for the WhatsApp chat cart.
 * If the Orders page create flow changes, update this file too.
 *
 * Behavior deltas vs the page (intentional):
 *  - closing does NOT reset the form (draft survives across open/close);
 *  - explicit "Annuler" footer button discards the draft (reset to blank defaults);
 *  - onSuccess keeps the page's invalidations/toast, then resets, reports
 *    draft=false, fires onSaved, closes;
 *  - prefill (name/phone) is applied on open ONLY when the form is pristine.
 */
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import {
    Plus,
    Trash2,
    Loader2,
    DollarSign,
    Clock,
    MessageSquare,
    RefreshCcw,
    User,
    Truck,
    ShoppingBag,
    BarChart3,
    Puzzle,
    Check,
    ChevronsUpDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn } from '@/lib/utils';
import { resolveProviderLogo } from '@/lib/providerLogos';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import CustomerInsights from '@/components/CustomerInsights';
import { OrderPhoneQuickActions } from '@/components/orders/OrderPhoneQuickActions';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { buildOrderItemRecords, type OrderLineForRecords, type ProductAccessoryRow } from '@/lib/buildOrderItemRecords';
import { statusRequiresHistoryComment } from '@/lib/orderHistoryCommentPolicy';
import { format } from 'date-fns';
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/users/UserAvatar";
import {
    OrderLineProductCombobox,
    OrderLineProductStockHint,
    toProductStockNumber,
    type OrderLineProductOption,
} from '@/components/orders/OrderLineProductCombobox';
import SourceIcon, { getSourceMeta } from '@/components/orders/SourceIcon';

// --- Stock error helper --- (Orders.tsx L145-151)
const friendlyStockError = (error: any): string => {
    const m = String(error?.message || error || '');
    if (m.includes('insufficient_stock')) return "Not enough stock to confirm this order. Restock the product or reduce the quantity.";
    if (m.includes('confirm_via_update')) return "Could not create a confirmed order directly. Please try again.";
    return m || 'Something went wrong.';
};

// --- Schemas --- (Orders.tsx L224-267)
const orderItemSchema = z.object({
    product_id: z.string().optional().nullable(),
    quantity: z.coerce.number().min(0, "Quantity must be at least 0"),
    unit_price: z.coerce.number().min(0, "Price must be positive"),
    accessories: z.array(z.object({
        accessory_id: z.string().optional().nullable(),
        accessory_quantity: z.coerce.number().min(0).default(0),
        accessory_unit_price: z.coerce.number().min(0).default(0),
    })).default([]),
}).refine(data => data.product_id || (data.accessories && data.accessories.length > 0 && data.accessories.some(a => a.accessory_id && a.accessory_id !== 'none')), {
    message: "Must select at least one product or accessory",
    path: ["product_id"]
});

const orderSchema = z.object({
    name: z.string().min(2, "Full Name is required"),
    phone: z.string().min(8, "Phone number is required"),
    city_id: z.string().uuid("Please select a city"),
    address: z.string().min(5, "Address is required"),
    source_name: z.string().min(1, "Source is required"),
    shipping_cost: z.coerce.number().min(0),
    include_delivery_in_total: z.boolean().default(true),
    replace: z.boolean().default(false), // "extchange" in request
    note: z.string().optional(),
    delivery_note: z.string().optional(),
    order_status_id: z.string().uuid("Please select a status"),
    items: z.array(orderItemSchema).min(1, "At least one product is required"),
    // Exchange "additional sale": when an exchange (replace) also sells an extra product,
    // these lines become a SEPARATE normal order (replace=false) on the paid/unpaid pipeline.
    additional_items: z.array(orderItemSchema).optional().default([]),
    courier_id: z.string().uuid().optional().nullable(),
    company_id: z.string().uuid().optional().nullable(),
    history_comment: z.string().optional(),
    _reportedDate: z.string().optional(),
    coliaty_old_tracking: z.string().optional(),
    ameex_old_tracking: z.string().optional(),
    quicklivraison_old_tracking: z.string().optional(),
    forcelog_old_tracking: z.string().optional(),
    sendit_old_tracking: z.string().optional(),
    delvoexpress_old_tracking: z.string().optional(),
});

type OrderFormValues = z.infer<typeof orderSchema>;
/** Draft snapshot type for the per-conversation cart map kept by the host page. */
export type AdminCartOrderDraft = OrderFormValues;

// --- Provider-type helpers --- (Orders.tsx L269-336)
function orderCompanyIsColiaty(
    companies: { id: string; provider_type?: string | null }[] | undefined,
    companyId: string | null | undefined
) {
    if (!companyId || !companies?.length) return false;
    const row = companies.find((c) => c.id === companyId);
    return !!row?.provider_type && String(row.provider_type).toLowerCase().includes('coliaty');
}

function orderCompanyIsAmeex(
    companies: { id: string; provider_type?: string | null }[] | undefined,
    companyId: string | null | undefined
) {
    if (!companyId || !companies?.length) return false;
    const row = companies.find((c) => c.id === companyId);
    const t = String(row?.provider_type || '').toLowerCase();
    return t === 'ameex' || t.includes('ameex');
}

function orderCompanyIsQuickLivraison(
    companies: { id: string; provider_type?: string | null }[] | undefined,
    companyId: string | null | undefined
) {
    if (!companyId || !companies?.length) return false;
    const row = companies.find((c) => c.id === companyId);
    const t = String(row?.provider_type || '').toLowerCase();
    return t === 'quicklivraison' || t.includes('quicklivraison');
}

function orderCompanyIsForcelog(
    companies: { id: string; provider_type?: string | null }[] | undefined,
    companyId: string | null | undefined
) {
    if (!companyId || !companies?.length) return false;
    const row = companies.find((c) => c.id === companyId);
    const t = String(row?.provider_type || '').toLowerCase();
    return t === 'forcelog' || t.includes('forcelog');
}

function orderCompanyIsSendit(
    companies: { id: string; provider_type?: string | null }[] | undefined,
    companyId: string | null | undefined
) {
    if (!companyId || !companies?.length) return false;
    const row = companies.find((c) => c.id === companyId);
    const t = String(row?.provider_type || '').toLowerCase();
    return t === 'sendit' || t.includes('sendit');
}

function orderCompanyIsDelvoExpress(
    companies: { id: string; provider_type?: string | null }[] | undefined,
    companyId: string | null | undefined
) {
    if (!companyId || !companies?.length) return false;
    const row = companies.find((c) => c.id === companyId);
    const t = String(row?.provider_type || '').toLowerCase();
    return t === 'delvoexpress' || t.includes('delvo') || t.includes('delevo');
}

// (Orders.tsx L338-345)
function toOrderLineForRecords(item: OrderFormValues['items'][number]): OrderLineForRecords {
    return {
        product_id: item.product_id ?? null,
        quantity: item.quantity ?? 0,
        unit_price: item.unit_price ?? 0,
        accessories: item.accessories ?? [],
    };
}

// EDIT MODE: build the form-reset payload from an existing order row — 1:1 with
// the admin Orders page handleEdit (src/pages/admin/Orders.tsx L2435-2495),
// including the flat-order_items → grouped-lines regrouping IIFE. `additional_items`
// is forced empty (the exchange "additional sale" split is CREATE-only).
function buildEditResetValues(order: any): OrderFormValues {
    return {
        name: order.name,
        phone: order.phone,
        city_id: order.master_city_id || '',
        address: order.address,
        source_name: order.source_name,
        shipping_cost: Number(order.shipping_cost),
        include_delivery_in_total: order.include_delivery_in_total !== false,
        replace: order.replace,
        note: order.note || '',
        delivery_note: order.delivery_note || '',
        order_status_id: order.order_status_id,
        courier_id: order.courier_id,
        company_id: order.company_id,
        coliaty_old_tracking: order.coliaty_old_tracking || '',
        ameex_old_tracking: order.ameex_old_tracking || '',
        quicklivraison_old_tracking: order.quicklivraison_old_tracking || '',
        forcelog_old_tracking: order.forcelog_old_tracking || '',
        sendit_old_tracking: order.sendit_old_tracking || '',
        delvoexpress_old_tracking: order.delvoexpress_old_tracking || '',
        items: (() => {
            const groupedItems: any[] = [];
            order.items?.forEach((item: any) => {
                if (item.product_id && Number(item.quantity) > 0) {
                    groupedItems.push({
                        product_id: item.product_id || '',
                        quantity: Number(item.quantity) || 0,
                        unit_price: Number(item.unit_price) || 0,
                        accessories: item.accessory_id ? [{
                            accessory_id: item.accessory_id,
                            accessory_quantity: Number(item.accessory_quantity) || 0,
                            accessory_unit_price: Number(item.accessory_unit_price) || 0
                        }] : []
                    });
                } else if (item.product_id && Number(item.quantity) === 0) {
                    const parent = groupedItems.find(g => g.product_id === item.product_id);
                    if (parent && item.accessory_id) {
                        parent.accessories.push({
                            accessory_id: item.accessory_id,
                            accessory_quantity: Number(item.accessory_quantity) || 0,
                            accessory_unit_price: Number(item.accessory_unit_price) || 0
                        });
                    }
                } else if (!item.product_id) {
                    groupedItems.push({
                        product_id: '',
                        quantity: 0,
                        unit_price: 0,
                        accessories: item.accessory_id ? [{
                            accessory_id: item.accessory_id,
                            accessory_quantity: Number(item.accessory_quantity) || 0,
                            accessory_unit_price: Number(item.accessory_unit_price) || 0
                        }] : []
                    });
                }
            });
            return groupedItems.length > 0 ? groupedItems : [{ product_id: '', quantity: 1, unit_price: 0, accessories: [] }];
        })(),
        additional_items: [],
        history_comment: '',
        _reportedDate: '',
    } as OrderFormValues;
}

// (Orders.tsx L366-376)
const SALES_SOURCES = [
    "whatsapp",
    "facebook",
    "instagram",
    "tiktok",
    "phone call",
    "connaissance",
    "reorder",
    "website",
    "other"
];

export function AdminChatCartOrderDialog(props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Per-conversation draft owned by the host page. When set, opening loads
     *  it INSTEAD of the prefill; the form is re-baselined on every open so a
     *  draft from one client can never leak into another. */
    draft?: OrderFormValues | null;
    /** Fired when the draft lifecycle changes: values = keep as this
     *  conversation's draft (plain close), null = cleared (Annuler / saved). */
    onSnapshot?: (values: OrderFormValues | null) => void;
    prefill?: { name?: string; phone?: string };
    onSaved?: () => void;
    /** EDIT MODE (order-history seam): when set, the dialog opens on an EXISTING
     *  order and submits an UPDATE (mirror of the admin Orders page edit path)
     *  instead of a create. `editOrder` carries the fully-enriched order row
     *  (from OrderViewDialog) so the form can prefill without a second fetch.
     *  When null/absent the dialog behaves exactly as before (CREATE mode). */
    editOrderId?: string | null;
    editOrder?: any | null;
    /** Fired when an edit session closes (saved, Annuler, or overlay close) so
     *  the host clears its editOrder state. Draft snapshots are NOT taken in
     *  edit mode — edits are one-off, not per-conversation drafts. */
    onEditClose?: () => void;
}) {
    // Reported Modal States (Orders.tsx L530-537)
    const [isReportedModalOpen, setIsReportedModalOpen] = useState(false);
    const [reportedData, setReportedData] = useState<{ date: Date | undefined, time: string, comment: string }>({ date: undefined, time: "12:00", comment: "" });
    const [pendingReportedAction, setPendingReportedAction] = useState<((date: Date, time: string, comment: string) => void) | null>(null);
    /** When opening the reported date modal from the status picker, revert pipeline stage if user cancels. */
    const reportedStatusRevertRef = useRef<string | null>(null);
    const { getOrderByCategory, isOrderCategory } = useStatusCategories();
    const REPORTED_STATUS_ID = getOrderByCategory('postponed')?.id;
    const defaultNewOrderStatusId = getOrderByCategory('new')?.id ?? '';

    // Dropdown search states (Orders.tsx L547-550)
    const [citySearchOpen, setCitySearchOpen] = useState(false);
    const cityListRef = useRef<HTMLDivElement>(null);
    const [statusSearchOpen, setStatusSearchOpen] = useState(false);
    const [showCustomerInsights, setShowCustomerInsights] = useState(false);

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // EDIT MODE: derived flag + a ref that pins the order being edited for the
    // lifetime of the open session (the host may clear its editOrder prop during
    // the Radix close animation; the mutation must still see the pinned row).
    const isEdit = !!props.editOrderId;
    const editOrderRef = useRef<any>(null);

    // Custom scrollbar styles the dialog JSX relies on (Orders.tsx L643-670,
    // scrollbar rules only). Injected here too so the dialog is self-contained
    // outside the Orders page.
    React.useEffect(() => {
        const style = document.createElement('style');
        style.innerHTML = `
            .custom-scrollbar::-webkit-scrollbar {
                width: 6px;
            }
            .custom-scrollbar::-webkit-scrollbar-track {
                background: transparent;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb {
                background: #e8e6dc;
                border-radius: 10px;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                background: #b0aea5;
            }
        `;
        document.head.appendChild(style);
        return () => { document.head.removeChild(style); };
    }, []);

    // --- Datasets the create dialog closes over (Orders.tsx L1086-1296) ---
    const { data: cities } = useQuery({
        queryKey: ['cities-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            return fetchAllRows<{ id: string; name: string; zone_id: string | null }>('master_cities', 'id, name, zone_id', { orderBy: 'name' });
        },
    });

    const { data: couriers } = useQuery({
        queryKey: ['couriers-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, avatar_url, avatar_config')
                .eq('role', 'courier')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: companies } = useQuery({
        queryKey: ['companies-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('providers')
                .select('id, name, provider_type, logo_url')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: courierZones } = useQuery({
        queryKey: ['courier-zones-all', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('courier_zones')
                .select('*')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: companyZones } = useQuery({
        queryKey: ['company-zones-all', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('company_zones')
                .select('*')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: courierFees } = useQuery({
        queryKey: ['courier-fees-all', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            return await fetchAllRows('courier_fees', '*', { filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId }] });
        }
    });

    const { data: companyFees } = useQuery({
        queryKey: ['company-fees-all', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            return await fetchAllRows('company_fees', '*', { filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId }] });
        }
    });

    const { data: providerCities } = useQuery({
        queryKey: ['provider-cities-all'],
        queryFn: async () => {
            return (await fetchAllRows('provider_cities', 'master_city_id, provider_type, fees')) as { master_city_id: string; provider_type: string; fees: { delivered?: number; refused?: number; returned?: number } | null }[];
        },
    });

    const { data: orderStatuses } = useQuery({
        queryKey: ['order-statuses-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('order_statuses')
                .select('id, code, label, ranking, color, show_in_order, show_in_quick_status')
                .eq('active', true)
                .order('ranking', { ascending: true });
            if (error) throw error;
            return data;
        },
    });

    // (Orders.tsx L1204-1221 minus the selectedOrder edit branch — create mode has no selectedOrder)
    const orderStatusesForModal = useMemo(() => {
        if (!orderStatuses?.length) return [];
        const list = orderStatuses as any[];
        let eligible = list.filter((s) => s.show_in_order !== false);
        if (
            defaultNewOrderStatusId &&
            !eligible.some((s) => s.id === defaultNewOrderStatusId)
        ) {
            const def = list.find((s) => s.id === defaultNewOrderStatusId);
            if (def) eligible = [def, ...eligible];
        }
        return eligible;
    }, [orderStatuses, defaultNewOrderStatusId]);

    const { data: products } = useQuery({
        queryKey: ['products-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('products')
                .select('id, name, code, selling_price, stock, image_url')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId)
                .order('name');
            if (error) throw error;
            return data;
        },
    });

    const { data: accessories } = useQuery({
        queryKey: ['accessories-dropdown-orders', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('accessories')
                .select('id, name, code, cost_price, stock')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId)
                .order('name');
            if (error) throw error;
            return data;
        },
    });

    const { data: productAccessories } = useQuery({
        queryKey: ['product-accessories', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('product_accessories')
                .select('product_id, accessory_id, default_quantity, attach_mode, created_at')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        },
    });

    const productAccessoriesForOrders = useMemo(() => {
        if (!productAccessories?.length || !products?.length || !accessories?.length) return [];
        const pid = new Set((products as { id: string }[]).map((p) => p.id));
        const aid = new Set((accessories as { id: string }[]).map((a) => a.id));
        return (productAccessories as { product_id: string; accessory_id: string }[]).filter(
            (pa) => pid.has(pa.product_id) && aid.has(pa.accessory_id)
        );
    }, [productAccessories, products, accessories]);

    // --- Form --- (Orders.tsx L1327-1354)
    const form = useForm<OrderFormValues>({
        resolver: zodResolver(orderSchema),
        defaultValues: {
            name: '',
            phone: '',
            city_id: '',
            address: '',
            source_name: '',
            shipping_cost: 0,
            include_delivery_in_total: false,
            replace: false,
            note: '',
            delivery_note: '',
            order_status_id: '',
            items: [{ product_id: '', quantity: 1, unit_price: 0, accessories: [] }],
            courier_id: null,
            company_id: null,
            history_comment: '',
            _reportedDate: '',
            coliaty_old_tracking: '',
            ameex_old_tracking: '',
            quicklivraison_old_tracking: '',
            forcelog_old_tracking: '',
            sendit_old_tracking: '',
            delvoexpress_old_tracking: ''
        }
    });

    /** Blank defaults = what the Orders page resets to on close/create-success (L3960-3983). */
    const blankDefaults = useCallback((): OrderFormValues => ({
        name: '',
        phone: '',
        city_id: '',
        address: '',
        source_name: '',
        shipping_cost: 0,
        include_delivery_in_total: false,
        replace: false,
        note: '',
        delivery_note: '',
        order_status_id: defaultNewOrderStatusId,
        items: [{ product_id: '', quantity: 1, unit_price: 0, accessories: [] }],
        courier_id: null,
        company_id: null,
        history_comment: '',
        _reportedDate: '',
        coliaty_old_tracking: '',
        ameex_old_tracking: '',
        quicklivraison_old_tracking: '',
        forcelog_old_tracking: '',
        sendit_old_tracking: '',
        delvoexpress_old_tracking: ''
    } as OrderFormValues), [defaultNewOrderStatusId]);

    // DELTA 4: on open with a PRISTINE form, apply prefill via full reset so the
    // prefill becomes the new "clean" baseline. Every open RE-BASELINES the
    // form for the conversation it was opened from: its saved draft when the
    // host passes one, else a fresh prefill — a draft from one client can
    // never leak into another (the host keeps drafts in a per-conv map).
    const prevOpenRef = useRef(false);
    const hadDraftRef = useRef(false);
    // "Has the user changed anything?" — RHF isDirty is UNRELIABLE here: the
    // dialog's pickers (city/provider/status/product) write via form.setValue
    // without shouldDirty, so picker-only edits read as pristine. Instead we
    // capture a JSON baseline at every re-baseline point and deep-compare on
    // close. Solid for both typed and picked changes.
    const baselineRef = useRef('');
    const captureBaseline = () => { baselineRef.current = JSON.stringify(form.getValues()); };
    useEffect(() => {
        if (props.open && !prevOpenRef.current) {
            if (props.editOrderId && props.editOrder) {
                // EDIT: prefill from the existing order. Pin it for the mutation,
                // never treat it as a per-conversation create draft.
                editOrderRef.current = props.editOrder;
                hadDraftRef.current = false;
                form.reset(buildEditResetValues(props.editOrder));
            } else if (props.draft) {
                hadDraftRef.current = true;
                form.reset(props.draft);
            } else {
                hadDraftRef.current = false;
                form.reset({
                    ...blankDefaults(),
                    name: props.prefill?.name ?? '',
                    phone: props.prefill?.phone ?? '',
                    // Chat-cart context: the order originates from a WhatsApp
                    // conversation — preselect the source (SALES_SOURCES value).
                    source_name: 'whatsapp',
                });
            }
            captureBaseline();
        }
        prevOpenRef.current = props.open;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.open]);

    // Status categories load async: patch the default status onto a pristine form
    // once it resolves (the page does this at button-click time instead). Re-capture
    // the baseline so the patch itself never reads as a user change.
    useEffect(() => {
        if (isEdit) return; // edit prefills the order's own status — never patch
        if (!defaultNewOrderStatusId) return;
        if (JSON.stringify(form.getValues()) === baselineRef.current && !form.getValues('order_status_id')) {
            form.setValue('order_status_id', defaultNewOrderStatusId);
            captureBaseline();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [defaultNewOrderStatusId]);

    const watchedOrderItems = useWatch({ control: form.control, name: 'items' });

    // Create-mode always blocks zero-stock lines (Orders.tsx L1490-1500 minus edit branch).
    // Edit mode is EXEMPT — an already-placed order whose product is now out of
    // stock must remain editable (page sets blockZeroStock={!isEditModalOpen}).
    const newOrderHasZeroStockProduct = useMemo(() => {
        if (isEdit) return false;
        if (!products?.length || !watchedOrderItems?.length) return false;
        return watchedOrderItems.some((item: any) => {
            const pid = item?.product_id;
            if (!pid || pid === 'none') return false;
            const p = (products as any[]).find((x) => x.id === pid);
            if (!p || p.stock === null || p.stock === undefined) return false;
            return Number(p.stock) === 0;
        });
    }, [watchedOrderItems, products, isEdit]);

    const dismissReportedModal = useCallback((revertStatus: boolean) => {
        if (revertStatus && reportedStatusRevertRef.current !== null) {
            form.setValue('order_status_id', reportedStatusRevertRef.current);
            form.setValue('_reportedDate', '');
            reportedStatusRevertRef.current = null;
        }
        setIsReportedModalOpen(false);
        setPendingReportedAction(null);
    }, [form]);

    const selectedCityId = form.watch('city_id');
    const selectedCourierId = form.watch('courier_id');
    const selectedCompanyId = form.watch('company_id');
    const includeDeliveryWatched = form.watch('include_delivery_in_total');
    // Shipping fee is editable only when the toggle is ON — provider doesn't lock it
    const shippingFeeReadOnly = !includeDeliveryWatched;

    // Helper: find fee for a provider+city, with zone fallback and provider_cities fallback.
    // 1) Exact match on master_city_id in courier_fees/company_fees
    // 2) Zone fallback: same zone fee
    // 3) provider_cities.fees.delivered fallback
    // (Orders.tsx L1524-1560)
    const findFee = React.useCallback((
        providerType: 'courier' | 'company',
        providerId: string,
        cityId: string
    ): number | null => {
        const city = cities?.find((c: any) => c.id === cityId);
        if (!city) return null;

        const fees = providerType === 'courier' ? courierFees : companyFees;
        const idField = providerType === 'courier' ? 'courier_id' : 'company_id';

        // 1. Direct match on master_city_id
        if (fees?.length) {
            const direct = fees.find((f: any) => f[idField] === providerId && f.master_city_id === cityId);
            if (direct) return Number(direct.fee);
        }

        // 2. Zone fallback: find any fee for this provider where the fee's city is in the same zone
        if (city.zone_id && fees?.length) {
            const samezone = cities?.filter((c: any) => c.zone_id === city.zone_id).map((c: any) => c.id) || [];
            const zoneFee = fees.find((f: any) => f[idField] === providerId && samezone.includes(f.master_city_id));
            if (zoneFee) return Number(zoneFee.fee);
        }

        // 3. provider_cities fallback: use fees.delivered from provider_cities mapping
        if (providerType === 'company' && providerCities?.length) {
            const provider = companies?.find((c: any) => c.id === providerId);
            if (provider?.provider_type) {
                const pcMapping = providerCities.find(
                    (pc) => pc.master_city_id === cityId && pc.provider_type === provider.provider_type
                );
                if (pcMapping?.fees?.delivered != null) return Number(pcMapping.fees.delivered);
            }
        }

        return null;
    }, [cities, courierFees, companyFees, providerCities, companies]);

    // (Orders.tsx L1562-1608)
    const availableProviders = useMemo(() => {
        if (!selectedCityId || !cities) return [];
        const city = cities.find((c: any) => c.id === selectedCityId);
        if (!city) return [];

        const zoneId = city.zone_id;

        // 1. Providers eligible via zone
        const zoneCouriers = zoneId ? couriers?.filter((c: any) =>
            courierZones?.some((cz: any) => cz.courier_id === c.id && cz.zone_id === zoneId)
        ) : [];

        const zoneCompanies = zoneId ? companies?.filter((c: any) =>
            companyZones?.some((cz: any) => cz.company_id === c.id && cz.zone_id === zoneId)
        ) : [];

        // 2. Providers that have a direct fee for this master_city_id
        const feeCouriers = couriers?.filter((c: any) =>
            courierFees?.some((f: any) => f.courier_id === c.id && f.master_city_id === selectedCityId)
        ) || [];

        const feeCompanies = companies?.filter((c: any) =>
            companyFees?.some((f: any) => f.company_id === c.id && f.master_city_id === selectedCityId)
        ) || [];

        // 3. Companies that have a provider_cities mapping for this city
        const mappedCompanies = companies?.filter((c: any) => {
            if (!c.provider_type || !providerCities?.length) return false;
            return providerCities.some(
                (pc) => pc.master_city_id === selectedCityId && pc.provider_type === c.provider_type
            );
        }) || [];

        // Combine and unique by ID
        const combinedCouriers = [...(zoneCouriers || []), ...feeCouriers];
        const combinedCompanies = [...(zoneCompanies || []), ...feeCompanies, ...mappedCompanies];

        const eligibleCouriers = combinedCouriers
            .filter((v, i, a) => a.findIndex(t => t.id === v.id) === i)
            .map((c: any) => ({ ...c, type: 'courier' }));

        const eligibleCompanies = combinedCompanies
            .filter((v, i, a) => a.findIndex(t => t.id === v.id) === i)
            .map((c: any) => ({ ...c, type: 'company' }));

        return [...eligibleCouriers, ...eligibleCompanies];
    }, [selectedCityId, cities, couriers, companies, courierZones, companyZones, courierFees, companyFees, providerCities]);

    // Auto-select best provider and set fee when city changes (Orders.tsx L1617-1649)
    React.useEffect(() => {
        if (!selectedCityId || !availableProviders.length) return;

        // If no provider selected, pick the best one
        if (!selectedCourierId && !selectedCompanyId) {
            const providersWithFees = availableProviders.map(p => {
                const fee = findFee(p.type, p.id, selectedCityId);
                return { ...p, fee: fee ?? Infinity };
            });

            const best = providersWithFees.sort((a, b) => a.fee - b.fee)[0];
            if (best) {
                if (best.type === 'courier') {
                    form.setValue('courier_id', best.id);
                    form.setValue('company_id', null);
                } else {
                    form.setValue('company_id', best.id);
                    form.setValue('courier_id', null);
                }
                form.setValue('shipping_cost', best.fee === Infinity ? 0 : best.fee);
            }
        } else {
            // Provider is already selected, just update the fee for the new city
            let foundFee = 0;
            if (selectedCourierId) {
                foundFee = findFee('courier', selectedCourierId, selectedCityId) ?? 0;
            } else if (selectedCompanyId) {
                foundFee = findFee('company', selectedCompanyId, selectedCityId) ?? 0;
            }
            form.setValue('shipping_cost', Number(foundFee));
        }
    }, [selectedCityId, availableProviders, findFee, selectedCourierId, selectedCompanyId, form]);

    const calculateShippingFee = () => {
        if (!selectedCityId || (!selectedCourierId && !selectedCompanyId)) return;

        let fee = 0;
        if (selectedCourierId) {
            fee = findFee('courier', selectedCourierId, selectedCityId) ?? 0;
        } else if (selectedCompanyId) {
            fee = findFee('company', selectedCompanyId, selectedCityId) ?? 0;
        }
        form.setValue('shipping_cost', Number(fee));
    };

    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: "items"
    });

    // Exchange "additional sale" lines → become a separate replace=false order.
    const { fields: addFields, append: addAppend, remove: addRemove } = useFieldArray({
        control: form.control,
        name: "additional_items"
    });

    // Shared product-line renderer — used identically by the main order lines and by the
    // exchange "additional sale" lines, so both have the exact same product picker, stock
    // hints, and accessory auto-attach/edit mechanics. `namePrefix` swaps the field path.
    // (Orders.tsx L1677-1936; blockZeroStock is always true here: create mode = !isEditModalOpen)
    const renderOrderLine = (
        namePrefix: 'items' | 'additional_items',
        index: number,
        fieldId: string,
        canRemove: boolean,
        onRemove: () => void,
        lineLabel: string,
    ) => {
        const hasProduct = !!form.watch(`${namePrefix}.${index}.product_id` as any) && form.watch(`${namePrefix}.${index}.product_id` as any) !== 'none';
        const productSubtotal = (form.watch(`${namePrefix}.${index}.quantity` as any) || 0) * (form.watch(`${namePrefix}.${index}.unit_price` as any) || 0);
        return (
            <div key={fieldId} className="rounded-2xl border border-ant-ink/10 bg-white p-3 shadow-sm space-y-3 animate-in slide-in-from-left-2 duration-200">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid tabular-nums">{lineLabel}</span>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={onRemove}
                        disabled={!canRemove}
                        className="h-7 w-7 rounded-lg text-red-400 hover:text-ant-rose hover:bg-ant-rose/10 shrink-0"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                </div>
                <FormField
                    control={form.control}
                    name={`${namePrefix}.${index}.product_id` as any}
                    render={({ field }) => (
                        <FormItem className="space-y-1.5">
                            <FormControl>
                                <OrderLineProductCombobox
                                    products={(products || []) as OrderLineProductOption[]}
                                    value={field.value === 'none' ? 'none' : field.value || ''}
                                    blockZeroStock={!isEdit}
                                    formatLabel={(p) => String(p.name)}
                                    onProductIdChange={(val) => {
                                        field.onChange(val === 'none' ? 'none' : val);
                                        if (val !== 'none') {
                                            const prod = products?.find((p: any) => p.id === val);
                                            if (prod) {
                                                form.setValue(`${namePrefix}.${index}.unit_price` as any, Number(prod.selling_price || 0));
                                                if (form.watch(`${namePrefix}.${index}.quantity` as any) === 0) {
                                                    form.setValue(`${namePrefix}.${index}.quantity` as any, 1);
                                                }
                                                const attachments = productAccessoriesForOrders?.filter((pa: any) => pa.product_id === val);
                                                if (attachments && attachments.length > 0) {
                                                    const prodQty = Number(form.getValues(`${namePrefix}.${index}.quantity` as any)) || 1;
                                                    const allItems = form.getValues(namePrefix as any) || [];
                                                    const currentAccessories = form.getValues(`${namePrefix}.${index}.accessories` as any) || [];
                                                    const newAccessories = [...currentAccessories];
                                                    attachments.forEach((attachment: any) => {
                                                        const mode = attachment.attach_mode || 'fixed';
                                                        const existingAttached = newAccessories.find((a: any) => a.accessory_id === attachment.accessory_id);
                                                        if (existingAttached) return;
                                                        if (mode === 'per_order') {
                                                            const elsewhere = allItems.some((it: any, i: number) =>
                                                                i !== index && (it.accessories || []).some((a: any) => a.accessory_id === attachment.accessory_id)
                                                            );
                                                            if (elsewhere) return;
                                                        }
                                                        const base = attachment.default_quantity || 1;
                                                        const qty = mode === 'per_item' ? base * prodQty : base;
                                                        const acc = accessories?.find((a: any) => a.id === attachment.accessory_id);
                                                        newAccessories.push({
                                                            accessory_id: attachment.accessory_id,
                                                            accessory_quantity: qty,
                                                            accessory_unit_price: acc ? Number(acc.cost_price || 0) : 0
                                                        });
                                                    });
                                                    form.setValue(`${namePrefix}.${index}.accessories` as any, newAccessories);
                                                }
                                            }
                                        } else {
                                            form.setValue(`${namePrefix}.${index}.unit_price` as any, 0);
                                            form.setValue(`${namePrefix}.${index}.quantity` as any, 0);
                                        }
                                    }}
                                />
                            </FormControl>
                            <FormMessage />
                            {(() => {
                                const selectedProduct = products?.find((p: any) => p.id === field.value);
                                const sn = toProductStockNumber(selectedProduct?.stock);
                                return (
                                    <OrderLineProductStockHint
                                        stock={sn}
                                        blockZeroStock={!isEdit}
                                    />
                                );
                            })()}
                        </FormItem>
                    )}
                />

                <div className="grid grid-cols-3 gap-2">
                    <FormField
                        control={form.control}
                        name={`${namePrefix}.${index}.unit_price` as any}
                        render={({ field }) => (
                            <FormItem className="space-y-1">
                                <FormLabel className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid">Unit</FormLabel>
                                <Input type="number" {...field} disabled={!hasProduct} className="h-9 rounded-lg border border-ant-ink/10 bg-ant-ink/[0.03] text-sm font-bold text-ant-ink text-center px-1" />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name={`${namePrefix}.${index}.quantity` as any}
                        render={({ field }) => (
                            <FormItem className="space-y-1">
                                <FormLabel className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid">Qty</FormLabel>
                                <Input
                                    type="number"
                                    {...field}
                                    disabled={!hasProduct}
                                    onChange={(e) => {
                                        field.onChange(e);
                                        const newQty = Number(e.target.value);
                                        if (!Number.isFinite(newQty) || newQty <= 0) return;
                                        const productId = form.getValues(`${namePrefix}.${index}.product_id` as any);
                                        const accs = form.getValues(`${namePrefix}.${index}.accessories` as any) || [];
                                        accs.forEach((acc: any, accIdx: number) => {
                                            if (!acc.accessory_id || acc.accessory_id === 'none') return;
                                            const pa = productAccessoriesForOrders?.find(
                                                (p: any) => p.product_id === productId && p.accessory_id === acc.accessory_id
                                            );
                                            if (pa && (pa as any).attach_mode === 'per_item') {
                                                form.setValue(`${namePrefix}.${index}.accessories.${accIdx}.accessory_quantity` as any, ((pa as any).default_quantity || 1) * newQty);
                                            }
                                        });
                                    }}
                                    className="h-9 rounded-lg border border-ant-ink/10 bg-ant-ink/[0.03] text-sm font-bold text-ant-ink text-center px-1"
                                />
                            </FormItem>
                        )}
                    />
                    <div className="rounded-lg bg-ant-ink/10 px-1.5 py-1 flex flex-col justify-center items-center text-center">
                        <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid leading-none">Total</span>
                        <span className="font-display text-[13px] font-semibold text-ant-ink tabular-nums leading-tight tracking-[-0.01em]">{productSubtotal.toFixed(2)} <span className="text-[10px] font-medium text-ant-mid">DH</span></span>
                    </div>
                </div>

                <div className="rounded-xl bg-ant-ink/[0.04] border border-ant-ink/[0.07] p-2.5 space-y-2">
                    <p className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid">Add-ons</p>
                    {(form.watch(`${namePrefix}.${index}.accessories` as any) || []).map((acc: any, accIdx: number) => {
                        const accSubtotal = (form.watch(`${namePrefix}.${index}.accessories.${accIdx}.accessory_quantity` as any) || 0) * (form.watch(`${namePrefix}.${index}.accessories.${accIdx}.accessory_unit_price` as any) || 0);
                        const hasAccessory = !!form.watch(`${namePrefix}.${index}.accessories.${accIdx}.accessory_id` as any) && form.watch(`${namePrefix}.${index}.accessories.${accIdx}.accessory_id` as any) !== 'none';

                        return (
                            <div key={accIdx} className="space-y-2 pb-2 border-b border-ant-line last:border-0 last:pb-0">
                                <div className="flex gap-2 items-end">
                                    <FormField
                                        control={form.control}
                                        name={`${namePrefix}.${index}.accessories.${accIdx}.accessory_id` as any}
                                        render={({ field }) => (
                                            <FormItem className="space-y-1 flex-1 min-w-0">
                                                <FormLabel className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid flex items-center gap-1"><Puzzle className="w-3 h-3 opacity-60" /> Item</FormLabel>
                                                <Select
                                                    onValueChange={(val) => {
                                                        field.onChange(val);
                                                        if (val !== 'none') {
                                                            const accessoryObj = accessories?.find((a: any) => a.id === val);
                                                            if (accessoryObj) {
                                                                form.setValue(`${namePrefix}.${index}.accessories.${accIdx}.accessory_unit_price` as any, Number(accessoryObj.cost_price || 0));
                                                                if (form.watch(`${namePrefix}.${index}.accessories.${accIdx}.accessory_quantity` as any) === 0) {
                                                                    form.setValue(`${namePrefix}.${index}.accessories.${accIdx}.accessory_quantity` as any, 1);
                                                                }
                                                            }
                                                        } else {
                                                            form.setValue(`${namePrefix}.${index}.accessories.${accIdx}.accessory_unit_price` as any, 0);
                                                            form.setValue(`${namePrefix}.${index}.accessories.${accIdx}.accessory_quantity` as any, 0);
                                                        }
                                                    }}
                                                    value={field.value || ''}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-9 rounded-lg border border-ant-ink/10 bg-white text-sm font-bold text-ant-ink shadow-none">
                                                            <SelectValue placeholder="Accessory…" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="rounded-xl border-none shadow-2xl max-h-[200px] overflow-y-auto custom-scrollbar">
                                                        <SelectItem value="none" className="rounded-lg font-medium text-ant-muted text-sm">— None —</SelectItem>
                                                        {accessories?.map((a: any) => (
                                                            <SelectItem key={a.id} value={a.id} className="rounded-lg font-medium text-sm py-2">
                                                                {a.name} <span className="text-ant-muted ml-1 text-xs">({a.code})</span>
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                                {(() => {
                                                    const selectedAccessory = accessories?.find((a: any) => a.id === field.value);
                                                    if (!selectedAccessory) return null;
                                                    const sn = toProductStockNumber(selectedAccessory?.stock);
                                                    return <OrderLineProductStockHint stock={sn} blockZeroStock={false} />;
                                                })()}
                                            </FormItem>
                                        )}
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => {
                                            const current = form.getValues(`${namePrefix}.${index}.accessories` as any) || [];
                                            current.splice(accIdx, 1);
                                            form.setValue(`${namePrefix}.${index}.accessories` as any, current);
                                        }}
                                        className="h-9 w-9 rounded-lg text-red-400 hover:text-ant-rose hover:bg-ant-rose/10 shrink-0"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    <FormField
                                        control={form.control}
                                        name={`${namePrefix}.${index}.accessories.${accIdx}.accessory_unit_price` as any}
                                        render={({ field }) => (
                                            <FormItem className="space-y-1">
                                                <FormLabel className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid">Cost</FormLabel>
                                                <Input type="number" {...field} disabled={!hasAccessory} className="h-9 rounded-lg border border-ant-ink/10 bg-white text-sm font-bold text-ant-ink text-center px-1" />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name={`${namePrefix}.${index}.accessories.${accIdx}.accessory_quantity` as any}
                                        render={({ field }) => (
                                            <FormItem className="space-y-1">
                                                <FormLabel className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid">Qty</FormLabel>
                                                <Input type="number" {...field} disabled={!hasAccessory} className="h-9 rounded-lg border border-ant-ink/10 bg-white text-sm font-bold text-ant-ink text-center px-1" />
                                            </FormItem>
                                        )}
                                    />
                                    <div className="rounded-lg bg-white/80 border border-ant-ink/10 px-1.5 py-1 flex flex-col justify-center items-center">
                                        <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid">Sum</span>
                                        <span className="font-display text-[13px] font-semibold text-ant-ink tabular-nums tracking-[-0.01em]">{accSubtotal.toFixed(2)}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            const current = form.getValues(`${namePrefix}.${index}.accessories` as any) || [];
                            current.push({ accessory_id: 'none', accessory_quantity: 0, accessory_unit_price: 0 });
                            form.setValue(`${namePrefix}.${index}.accessories` as any, current);
                        }}
                        className="text-[9px] font-semibold uppercase text-ant-ink border-ant-ink/15 h-7 rounded-lg gap-1 w-full bg-white/80"
                    >
                        <Plus className="w-3 h-3" /> Add add-on
                    </Button>
                </div>
            </div>
        );
    };

    // --- Mutation --- (Orders.tsx L1939-2192; onSuccess adapted per contract)
    const createOrderMutation = useMutation({
        mutationFn: async (values: OrderFormValues) => {
            // 1. Insert order
            const totalPrice = values.items.reduce((acc, item) => acc + (item.quantity * item.unit_price), 0);
            const ship = Number(values.shipping_cost) || 0;
            const includeDelivery = values.include_delivery_in_total !== false;
            const orderPrice = includeDelivery ? totalPrice + ship : totalPrice;

            // When this exchange also sells an extra product it SPLITS into a return leg
            // (this order, replace=true) + a sale leg (replace=false). The carrier bills
            // ONE delivery fee for the single parcel — it must ride on the SALE leg (which
            // flows through the normal payment-note pipeline); the return leg carries no
            // fee and collects no CRBT (its money, if any, is the sale leg's).
            const addItemsForSplit = (values.additional_items || []).filter(
                (it) =>
                    (it.product_id && it.product_id !== 'none') ||
                    (it.accessories || []).some((a) => a.accessory_id && a.accessory_id !== 'none')
            );
            const willSplit = values.replace && addItemsForSplit.length > 0;
            const mainShip = willSplit ? 0 : values.shipping_cost;
            const mainInclude = willSplit ? false : includeDelivery;
            const mainPrice = willSplit ? totalPrice : orderPrice;

            // Two-step create: if the desired status is 'confirmed', insert with
            // a non-confirmed status first (to avoid the DB forbid-on-INSERT rule),
            // then UPDATE to confirmed after items are inserted (fires stock gate).
            const wantsConfirm = !!values.order_status_id && isOrderCategory(values.order_status_id, 'confirmed');
            const insertStatusId = wantsConfirm ? (defaultNewOrderStatusId || values.order_status_id) : values.order_status_id;

            const { data: order, error: orderError } = await (supabase as any)
                .from('orders')
                .insert({
                    name: values.name,
                    phone: values.phone,
                    master_city_id: values.city_id,
                    address: values.address,
                    source_name: values.source_name,
                    shipping_cost: mainShip,
                    include_delivery_in_total: mainInclude,
                    replace: values.replace,
                    note: values.note,
                    delivery_note: values.delivery_note,
                    order_status_id: insertStatusId,
                    courier_id: values.courier_id,
                    company_id: values.company_id,
                    coliaty_old_tracking:
                        orderCompanyIsColiaty(companies, values.company_id) && values.replace
                            ? (values.coliaty_old_tracking || '').trim() || null
                            : null,
                    ameex_old_tracking:
                        orderCompanyIsAmeex(companies, values.company_id) && values.replace
                            ? (values.ameex_old_tracking || '').trim() || null
                            : null,
                    quicklivraison_old_tracking:
                        orderCompanyIsQuickLivraison(companies, values.company_id) && values.replace
                            ? (values.quicklivraison_old_tracking || '').trim() || null
                            : null,
                    forcelog_old_tracking:
                        orderCompanyIsForcelog(companies, values.company_id) && values.replace
                            ? (values.forcelog_old_tracking || '').trim() || null
                            : null,
                    sendit_old_tracking:
                        orderCompanyIsSendit(companies, values.company_id) && values.replace
                            ? (values.sendit_old_tracking || '').trim() || null
                            : null,
                    delvoexpress_old_tracking:
                        orderCompanyIsDelvoExpress(companies, values.company_id) && values.replace
                            ? (values.delvoexpress_old_tracking || '').trim() || null
                            : null,
                    price: mainPrice,
                    raw_price: totalPrice,
                    date: new Date().toISOString(),
                    'DigiCom Business': activeBusinessId
                })
                .select()
                .single();

            if (orderError) throw orderError;

            // 2. Insert items (expand default product_accessories when accessories[] empty — matches sync_imported_orders)
            const accessoryUnitPriceById = new Map<string, number>(
                (accessories ?? []).map((a: { id: string; cost_price?: number }) => [
                    a.id,
                    Number(a.cost_price ?? 0),
                ])
            );
            const itemRecords: any[] = [];
            values.items.forEach((item) => {
                itemRecords.push(
                    ...buildOrderItemRecords(
                        order.id,
                        toOrderLineForRecords(item),
                        activeBusinessId!,
                        (productAccessoriesForOrders ?? []) as ProductAccessoryRow[],
                        accessoryUnitPriceById
                    )
                );
            });

            const { error: itemsError } = await (supabase as any)
                .from('order_items')
                .insert(itemRecords);

            if (itemsError) throw itemsError;

            // 3. If the user wanted a confirmed status, UPDATE now to fire the stock gate.
            if (wantsConfirm) {
                const userRes = await (supabase as any).auth.getUser();
                const creatorId = userRes.data.user?.id;
                const { error: confErr } = await (supabase as any)
                    .from('orders')
                    .update({
                        order_status_id: values.order_status_id,
                        confirmed_by_id: creatorId,
                        confirmation_date: new Date().toISOString()
                    })
                    .eq('id', order.id);
                if (confErr) throw confErr;
            }

            const statusIdForHistory = values.order_status_id;
            if (statusIdForHistory) {
                const userRes = await (supabase as any).auth.getUser();
                const creatorId = userRes.data.user?.id;
                try {
                    await (supabase as any).from('order_status_history').insert({
                        order_id: order.id,
                        status_id: statusIdForHistory,
                        comment: (values.history_comment || '').trim(),
                        changed_by: creatorId,
                        'DigiCom Business': activeBusinessId
                    });
                } catch (err) {
                    console.error('Initial order status history error:', err);
                }
            }

            // ── Two-order split (exchange + additional sale) ───────────────
            // When this is an exchange (replace) AND the operator added an "Additional
            // sale", THIS order is the swap/return leg (replace=true); the sold product
            // becomes a SEPARATE normal order (replace=false) that runs the standard
            // paid/unpaid pipeline. seller_id is copied from the swap leg so the
            // sale leg keeps the same seller as the exchange.
            if (willSplit) {
                const addTotal = addItemsForSplit.reduce((acc, it) => acc + (it.quantity * it.unit_price), 0);
                const { data: saleOrder, error: saleErr } = await (supabase as any)
                    .from('orders')
                    .insert({
                        name: values.name,
                        phone: values.phone,
                        master_city_id: values.city_id,
                        address: values.address,
                        source_name: values.source_name,
                        // The single parcel's ONE delivery fee rides on the sale leg, so the
                        // payment note deducts it via the normal pipeline (the return leg has 0).
                        shipping_cost: values.shipping_cost,
                        include_delivery_in_total: includeDelivery,
                        replace: false,
                        note: values.note,
                        delivery_note: values.delivery_note,
                        order_status_id: insertStatusId,
                        courier_id: values.courier_id,
                        company_id: values.company_id,
                        price: includeDelivery ? addTotal + ship : addTotal,
                        raw_price: addTotal,
                        seller_id: order.seller_id ?? null,
                        date: new Date().toISOString(),
                        'DigiCom Business': activeBusinessId,
                    })
                    .select()
                    .single();
                if (saleErr) throw saleErr;

                const saleItemRecords: any[] = [];
                addItemsForSplit.forEach((item) => {
                    saleItemRecords.push(
                        ...buildOrderItemRecords(
                            saleOrder.id,
                            toOrderLineForRecords(item),
                            activeBusinessId!,
                            (productAccessoriesForOrders ?? []) as ProductAccessoryRow[],
                            accessoryUnitPriceById
                        )
                    );
                });
                const { error: saleItemsError } = await (supabase as any)
                    .from('order_items')
                    .insert(saleItemRecords);
                if (saleItemsError) throw saleItemsError;

                if (wantsConfirm) {
                    const userRes = await (supabase as any).auth.getUser();
                    const creatorId = userRes.data.user?.id;
                    const { error: saleConfErr } = await (supabase as any)
                        .from('orders')
                        .update({
                            order_status_id: values.order_status_id,
                            confirmed_by_id: creatorId,
                            confirmation_date: new Date().toISOString(),
                        })
                        .eq('id', saleOrder.id);
                    if (saleConfErr) throw saleConfErr;
                }

                // Link the sale leg to the SAME original as the swap leg, for burger grouping.
                // Updating only exchange_of_order_id does NOT re-fire resolve_exchange_link
                // (its trigger is UPDATE OF replace/old_tracking/raw_price), so it sticks on
                // this replace=false order.
                if (order.exchange_of_order_id) {
                    await (supabase as any)
                        .from('orders')
                        .update({ exchange_of_order_id: order.exchange_of_order_id })
                        .eq('id', saleOrder.id);
                }
            }

            return order;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders-aggregate', activeBusinessId] });
            toast({ title: "Order Created", description: "Successfully logged new order." });
            // DELTA 3: close, reset to blank defaults, clear this conv's draft, notify saved.
            props.onOpenChange(false);
            props.onSnapshot?.(null);
            hadDraftRef.current = false;
            // Defer form.reset so Radix completes its close cycle first.
            setTimeout(() => {
                form.reset(blankDefaults());
                captureBaseline();
            }, 0);
            props.onSaved?.();
        },
        onError: (error: any) => {
            toast({ title: "Error", description: friendlyStockError(error), variant: "destructive" });
        }
    });

    // --- EDIT Mutation --- (MIRROR of admin Orders.tsx updateOrderMutation
    // L1907-2061: UPDATE order + delete-then-reinsert order_items via the SAME
    // buildOrderItemRecords helper create uses + status-transition stamping +
    // status-change history row. onSuccess adapted per the chat contract.)
    const updateOrderMutation = useMutation({
        mutationFn: async (values: OrderFormValues) => {
            const selectedOrder = editOrderRef.current;
            if (!selectedOrder) return;

            const totalPrice = values.items.reduce((acc, item) => acc + (item.quantity * item.unit_price), 0);
            const ship = Number(values.shipping_cost) || 0;
            const includeDelivery = values.include_delivery_in_total !== false;
            const orderPrice = includeDelivery ? totalPrice + ship : totalPrice;

            // Get current user
            const userRes = await (supabase as any).auth.getUser();
            const userId = userRes.data.user?.id;

            // Build update payload
            const updatePayload: any = {
                name: values.name,
                phone: values.phone,
                master_city_id: values.city_id,
                address: values.address,
                source_name: values.source_name,
                shipping_cost: values.shipping_cost,
                include_delivery_in_total: includeDelivery,
                replace: values.replace,
                note: values.note,
                delivery_note: values.delivery_note,
                order_status_id: values.order_status_id,
                courier_id: values.courier_id,
                company_id: values.company_id,
                coliaty_old_tracking:
                    orderCompanyIsColiaty(companies, values.company_id) && values.replace
                        ? (values.coliaty_old_tracking || '').trim() || null
                        : null,
                ameex_old_tracking:
                    orderCompanyIsAmeex(companies, values.company_id) && values.replace
                        ? (values.ameex_old_tracking || '').trim() || null
                        : null,
                quicklivraison_old_tracking:
                    orderCompanyIsQuickLivraison(companies, values.company_id) && values.replace
                        ? (values.quicklivraison_old_tracking || '').trim() || null
                        : null,
                forcelog_old_tracking:
                    orderCompanyIsForcelog(companies, values.company_id) && values.replace
                        ? (values.forcelog_old_tracking || '').trim() || null
                        : null,
                sendit_old_tracking:
                    orderCompanyIsSendit(companies, values.company_id) && values.replace
                        ? (values.sendit_old_tracking || '').trim() || null
                        : null,
                delvoexpress_old_tracking:
                    orderCompanyIsDelvoExpress(companies, values.company_id) && values.replace
                        ? (values.delvoexpress_old_tracking || '').trim() || null
                        : null,
                price: orderPrice,
                raw_price: totalPrice,
                updated_at: new Date().toISOString()
            };

            // Status-specific field population
            if (values.order_status_id && values.order_status_id !== selectedOrder.order_status_id) {
                const statusId = values.order_status_id;
                if (isOrderCategory(statusId, 'confirmed')) {
                    updatePayload.confirmed_by_id = userId;
                    updatePayload.confirmation_date = new Date().toISOString();
                }
                if (isOrderCategory(statusId, 'cancelled')) {
                    updatePayload.canceled_by_id = userId;
                    updatePayload.annulation_date = new Date().toISOString();
                }
                if (isOrderCategory(statusId, 'paid')) {
                    updatePayload.date_livraison = new Date().toISOString();
                }
                if (isOrderCategory(statusId, 'postponed')) {
                    updatePayload.reported_date = (values as any)._reportedDate || new Date().toISOString();
                }
            }

            // 1. Update order
            const { error: orderError } = await (supabase as any)
                .from('orders')
                .update(updatePayload)
                .eq('id', selectedOrder.id)
                .eq('DigiCom Business', activeBusinessId);

            if (orderError) throw orderError;

            // 2. Refresh items (delete-all-then-reinsert, same as the page)
            const { error: deleteError } = await (supabase as any)
                .from('order_items')
                .delete()
                .eq('order_id', selectedOrder.id);

            if (deleteError) throw deleteError;

            const accessoryUnitPriceById = new Map<string, number>(
                (accessories ?? []).map((a: { id: string; cost_price?: number }) => [
                    a.id,
                    Number(a.cost_price ?? 0),
                ])
            );
            const itemRecords: any[] = [];
            values.items.forEach((item) => {
                itemRecords.push(
                    ...buildOrderItemRecords(
                        selectedOrder.id,
                        toOrderLineForRecords(item),
                        activeBusinessId!,
                        (productAccessoriesForOrders ?? []) as ProductAccessoryRow[],
                        accessoryUnitPriceById
                    )
                );
            });

            const { error: itemsError } = await (supabase as any)
                .from('order_items')
                .insert(itemRecords);

            if (itemsError) throw itemsError;

            // 3. Track history if status changed
            if (values.order_status_id && values.order_status_id !== selectedOrder.order_status_id) {
                const statusId = values.order_status_id;
                let finalComment = values.history_comment || '';

                if ((isOrderCategory(statusId, 'postponed') || statusId === REPORTED_STATUS_ID)) {
                    const rDate = (values as any)._reportedDate;
                    if (rDate) {
                        const formattedDate = format(new Date(rDate), 'dd/MM/yyyy HH:mm');
                        finalComment = `[Reporté pour: ${formattedDate}] ${finalComment}`;
                    }
                }

                try {
                    await (supabase as any).from('order_status_history').insert({
                        order_id: selectedOrder.id,
                        status_id: values.order_status_id,
                        comment: finalComment,
                        changed_by: userId,
                        'DigiCom Business': activeBusinessId
                    });
                } catch (err) {
                    console.error("History tracking error:", err);
                }
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders-aggregate', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['order-view'] });
            toast({ title: "Order Updated", description: "Changes saved successfully." });
            // Close, clear the host's edit state, reset to blank; NO draft snapshot.
            props.onOpenChange(false);
            props.onEditClose?.();
            hadDraftRef.current = false;
            editOrderRef.current = null;
            setTimeout(() => {
                form.reset(blankDefaults());
                captureBaseline();
            }, 0);
        },
        onError: (error: any) => {
            toast({ title: "Error", description: friendlyStockError(error), variant: "destructive" });
        }
    });

    // DELTA 2: explicit discard (Annuler) — clears this conv's draft, closes.
    // In EDIT mode there is no draft to clear: just close and tell the host.
    const handleDiscard = () => {
        if (isEdit) {
            props.onOpenChange(false);
            props.onEditClose?.();
            editOrderRef.current = null;
            setTimeout(() => {
                form.reset(blankDefaults());
                captureBaseline();
            }, 0);
            return;
        }
        props.onOpenChange(false);
        props.onSnapshot?.(null);
        hadDraftRef.current = false;
        // Defer form.reset so Radix completes its close cycle first.
        setTimeout(() => {
            form.reset(blankDefaults());
            captureBaseline();
        }, 0);
    };

    return (
        <>
            {/* Create Order Modal — MIRROR of Orders.tsx L3950-5199 (create branch only) */}
            <Dialog
                open={props.open}
                onOpenChange={(v) => {
                    if (!v) {
                        // EDIT MODE: overlay/esc close discards edits and clears the
                        // host's edit state — edits are never kept as a draft.
                        if (isEdit) {
                            props.onOpenChange(false);
                            props.onEditClose?.();
                            editOrderRef.current = null;
                            return;
                        }
                        // DELTA 1: close WITHOUT resetting — snapshot the values
                        // as this conversation's draft. Kept when values differ
                        // from the open baseline (deep compare — NOT RHF isDirty,
                        // which misses setValue-driven pickers) or when the cart
                        // was opened FROM a draft.
                        props.onOpenChange(false);
                        const values = form.getValues();
                        const changed = JSON.stringify(values) !== baselineRef.current;
                        props.onSnapshot?.(changed || hadDraftRef.current ? values : null);
                    }
                }}
            >
                <DialogContent
                    onPointerDownOutside={(e) => e.preventDefault()}
                    onInteractOutside={(e) => e.preventDefault()}
                    className="ant-surface w-[min(96vw,1180px)] max-w-[1180px] p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden flex flex-col h-[min(92dvh,820px)] max-h-[92dvh]"
                >
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit((values) => {
                            const targetStatusId = values.order_status_id;

                            if (
                                orderCompanyIsColiaty(companies, values.company_id) &&
                                values.replace &&
                                !(values.coliaty_old_tracking || '').trim()
                            ) {
                                form.setError('coliaty_old_tracking', {
                                    type: 'manual',
                                    message: 'Required for Coliaty exchange (package_old_tracking).',
                                });
                                toast({
                                    title: 'Missing tracking',
                                    description: 'Enter the previous parcel tracking number for Coliaty exchange.',
                                    variant: 'destructive',
                                });
                                return;
                            }

                            if (
                                orderCompanyIsAmeex(companies, values.company_id) &&
                                values.replace &&
                                !(values.ameex_old_tracking || '').trim()
                            ) {
                                form.setError('ameex_old_tracking', {
                                    type: 'manual',
                                    message: 'Required for AMEEX exchange (exchange_code).',
                                });
                                toast({
                                    title: 'Missing tracking',
                                    description: 'Enter the previous parcel tracking number for AMEEX exchange.',
                                    variant: 'destructive',
                                });
                                return;
                            }

                            if (
                                orderCompanyIsQuickLivraison(companies, values.company_id) &&
                                values.replace &&
                                !(values.quicklivraison_old_tracking || '').trim()
                            ) {
                                form.setError('quicklivraison_old_tracking', {
                                    type: 'manual',
                                    message: 'Required for Quick Livraison exchange (echange_colis).',
                                });
                                toast({
                                    title: 'Missing tracking',
                                    description: 'Enter the previous parcel tracking number for Quick Livraison exchange.',
                                    variant: 'destructive',
                                });
                                return;
                            }

                            if (
                                orderCompanyIsForcelog(companies, values.company_id) &&
                                values.replace &&
                                !(values.forcelog_old_tracking || '').trim()
                            ) {
                                form.setError('forcelog_old_tracking', {
                                    type: 'manual',
                                    message: 'Required for Forcelog exchange (parcel_replace_old).',
                                });
                                toast({
                                    title: 'Missing tracking',
                                    description: 'Enter the previous parcel tracking number (F-XXX) for Forcelog exchange.',
                                    variant: 'destructive',
                                });
                                return;
                            }

                            if (
                                orderCompanyIsSendit(companies, values.company_id) &&
                                values.replace &&
                                !(values.sendit_old_tracking || '').trim()
                            ) {
                                form.setError('sendit_old_tracking', {
                                    type: 'manual',
                                    message: 'Required for Sendit exchange (delivery_exchange_id).',
                                });
                                toast({
                                    title: 'Missing tracking',
                                    description: 'Enter the previous parcel tracking number (DH…) for Sendit exchange.',
                                    variant: 'destructive',
                                });
                                return;
                            }

                            if (
                                orderCompanyIsDelvoExpress(companies, values.company_id) &&
                                values.replace &&
                                !(values.delvoexpress_old_tracking || '').trim()
                            ) {
                                form.setError('delvoexpress_old_tracking', {
                                    type: 'manual',
                                    message: 'Required for Delevo Express exchange (coli_exchange).',
                                });
                                toast({
                                    title: 'Missing tracking',
                                    description: 'Enter the previous parcel code (PKG-…) for Delevo Express exchange.',
                                    variant: 'destructive',
                                });
                                return;
                            }

                            // EDIT ONLY: status transition requires a history comment (Orders.tsx L3820-3830).
                            if (
                                isEdit &&
                                editOrderRef.current &&
                                targetStatusId !== editOrderRef.current.order_status_id &&
                                statusRequiresHistoryComment(targetStatusId) &&
                                !values.history_comment?.trim()
                            ) {
                                form.setError('history_comment', { type: 'manual', message: 'Comment is required for this status.' });
                                toast({ title: 'Validation Error', description: 'Please provide a reason for this status.', variant: 'destructive' });
                                return;
                            }

                            // (Orders.tsx L3832-3848) In edit mode an order ALREADY postponed is
                            // exempt from re-picking a reported date; create mode is never exempt.
                            const targetIsPostponed =
                                !!REPORTED_STATUS_ID &&
                                (targetStatusId === REPORTED_STATUS_ID ||
                                    isOrderCategory(targetStatusId, 'postponed'));
                            const sourceWasPostponed =
                                isEdit &&
                                !!editOrderRef.current &&
                                (editOrderRef.current.order_status_id === REPORTED_STATUS_ID ||
                                    isOrderCategory(editOrderRef.current.order_status_id, 'postponed'));
                            if (targetIsPostponed && !sourceWasPostponed && !(values as { _reportedDate?: string })._reportedDate?.trim()) {
                                toast({
                                    title: 'Reported date required',
                                    description: 'Choose the reported status and pick date/time in the popup before saving.',
                                    variant: 'destructive',
                                });
                                return;
                            }

                            // (Orders.tsx L3850-3869; create-mode branch only — edit is exempt)
                            if (!isEdit) {
                                for (let i = 0; i < values.items.length; i++) {
                                    const item = values.items[i];
                                    const pid = item.product_id;
                                    if (!pid || pid === 'none') continue;
                                    const p = (products as any[] | undefined)?.find((x) => x.id === pid);
                                    if (p && p.stock != null && Number(p.stock) === 0) {
                                        form.setError(`items.${i}.product_id`, {
                                            type: 'manual',
                                            message: 'This product is out of stock.',
                                        });
                                        toast({
                                            title: 'Out of stock',
                                            description: 'Remove or replace lines with 0 stock before creating the order.',
                                            variant: 'destructive',
                                        });
                                        return;
                                    }
                                }
                            }

                            if (isEdit) updateOrderMutation.mutate(values); else createOrderMutation.mutate(values);
                        })} className="flex flex-col h-full overflow-hidden">
                            <DialogHeader className="px-6 py-4 pr-12 shrink-0 border-b border-ant-line bg-ant-paper">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="w-1 h-1 rounded-full bg-ant-orange" />
                                    <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                        {isEdit ? 'Edit order' : 'Create order'}
                                    </span>
                                </div>
                                <DialogTitle className="font-display text-[24px] font-semibold text-ant-ink tracking-[-0.02em] leading-tight">
                                    {isEdit ? 'Update order' : 'New order'}
                                </DialogTitle>
                                <DialogDescription className="font-serif-display text-[13px] text-ant-muted italic mt-0.5">
                                    Customer on the left, cart on the right. Add as many lines as you need.
                                </DialogDescription>
                            </DialogHeader>

                            <div className="flex flex-1 min-h-0 flex-col xl:flex-row overflow-hidden">
                                <div className="min-w-0 flex-1 flex flex-col gap-4 min-h-0 overflow-y-auto xl:pr-1 px-4 sm:px-5 py-3 custom-scrollbar">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 shrink-0">
                                    {/* Column 1: Customer Data */}
                                    <div className="space-y-3.5">
                                        <h4 className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid border-b border-ant-line pb-2 flex items-center gap-2">
                                            <User className="w-3 h-3" /> Customer
                                        </h4>
                                        <FormField
                                            control={form.control}
                                            name="name"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Full Name</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="Client Name" {...field} className="h-10 rounded-lg border border-ant-line bg-ant-paper text-[13px] font-medium text-ant-ink placeholder:text-ant-mid focus-visible:ring-ant-orange focus-visible:ring-offset-0 focus-visible:border-ant-ink/25" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="phone"
                                            render={({ field }) => {
                                                const hasInsights = (field.value?.replace(/[^0-9+]/g, '') || '').length >= 6;
                                                const hasPhoneQuick = !!field.value?.trim();
                                                const inputPr =
                                                    hasInsights && hasPhoneQuick
                                                        ? 'pr-20'
                                                        : hasInsights
                                                          ? 'pr-12'
                                                          : hasPhoneQuick
                                                            ? 'pr-10'
                                                            : '';
                                                return (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Contact Number</FormLabel>
                                                    <div className="relative">
                                                        <FormControl>
                                                            <Input
                                                                placeholder="+212..."
                                                                {...field}
                                                                onChange={(e) => field.onChange(e.target.value.replace(/^\s+/, ''))}
                                                                onPaste={(e) => {
                                                                    const text = e.clipboardData.getData('text');
                                                                    if (/^\s/.test(text)) {
                                                                        e.preventDefault();
                                                                        field.onChange(text.replace(/^\s+/, ''));
                                                                    }
                                                                }}
                                                                className={cn("h-10 rounded-lg border border-ant-line bg-ant-paper text-[13px] font-medium text-ant-ink placeholder:text-ant-mid focus-visible:ring-ant-orange focus-visible:ring-offset-0 focus-visible:border-ant-ink/25", inputPr)}
                                                            />
                                                        </FormControl>
                                                        {hasPhoneQuick && (
                                                            <div className={cn('absolute top-1/2 -translate-y-1/2 z-10', hasInsights ? 'right-12' : 'right-2')}>
                                                                <OrderPhoneQuickActions phone={field.value} />
                                                            </div>
                                                        )}
                                                        {hasInsights && (
                                                            <Popover open={showCustomerInsights} onOpenChange={setShowCustomerInsights}>
                                                                <PopoverTrigger asChild>
                                                                    <button
                                                                        type="button"
                                                                        className={cn(
                                                                            "absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200",
                                                                            showCustomerInsights
                                                                                ? "bg-ant-ink text-ant-light shadow-sm scale-105"
                                                                                : "bg-ant-ink/10 text-ant-mid hover:bg-ant-ink/20 hover:text-ant-ink"
                                                                        )}
                                                                    >
                                                                        <BarChart3 className="w-4 h-4" />
                                                                    </button>
                                                                </PopoverTrigger>
                                                                <PopoverContent
                                                                    className="w-[420px] p-4 rounded-xl border-ant-line bg-ant-paper shadow-[0_12px_40px_-20px_rgba(20,20,19,0.3)] bg-white/95 backdrop-blur-xl"
                                                                    align="end"
                                                                    side="right"
                                                                    sideOffset={12}
                                                                >
                                                                    <CustomerInsights phone={field.value || ''} />
                                                                </PopoverContent>
                                                            </Popover>
                                                        )}
                                                    </div>
                                                    <FormMessage />
                                                </FormItem>
                                                );
                                            }}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="city_id"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-col space-y-2">
                                                    <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Target City</FormLabel>
                                                    <Popover open={citySearchOpen} onOpenChange={setCitySearchOpen}>
                                                        <PopoverTrigger asChild>
                                                            <FormControl>
                                                                <Button
                                                                    variant="outline"
                                                                    role="combobox"
                                                                    className={cn(
                                                                        "h-10 w-full justify-between rounded-lg border border-ant-line bg-ant-paper text-[13px] text-ant-ink font-medium text-left px-3",
                                                                        !field.value && "text-ant-muted"
                                                                    )}
                                                                >
                                                                    {field.value
                                                                        ? cities?.find((c: any) => c.id === field.value)?.name
                                                                        : "Select city..."}
                                                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                                </Button>
                                                            </FormControl>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="w-[300px] p-0 border-none shadow-2xl rounded-2xl" align="start" onWheel={(e) => e.stopPropagation()}>
                                                            <Command className="rounded-none">
                                                                <CommandInput
                                                                    placeholder="Search city..."
                                                                    className="h-12 border-none ring-0 focus:ring-0 shrink-0"
                                                                    onValueChange={() => {
                                                                        cityListRef.current?.scrollTo({ top: 0 });
                                                                    }}
                                                                />
                                                                <CommandList ref={cityListRef} className="max-h-[250px] overflow-y-scroll custom-scrollbar overflow-x-hidden">
                                                                    <CommandEmpty>No city found.</CommandEmpty>
                                                                    <CommandGroup>
                                                                        {cities?.map((city: any) => (
                                                                            <CommandItem
                                                                                key={city.id}
                                                                                value={city.name}
                                                                                onSelect={() => {
                                                                                    form.setValue("city_id", city.id);
                                                                                    form.setValue('courier_id', null);
                                                                                    form.setValue('company_id', null);
                                                                                    form.setValue('shipping_cost', 0);
                                                                                    setCitySearchOpen(false);
                                                                                }}
                                                                                className="py-3 px-4 font-bold text-ant-ink cursor-pointer hover:bg-ant-ink hover:text-ant-light"
                                                                            >
                                                                                <Check
                                                                                    className={cn(
                                                                                        "mr-2 h-4 w-4",
                                                                                        city.id === field.value ? "opacity-100" : "opacity-0"
                                                                                    )}
                                                                                />
                                                                                {city.name}
                                                                            </CommandItem>
                                                                        ))}
                                                                    </CommandGroup>
                                                                </CommandList>
                                                            </Command>
                                                        </PopoverContent>
                                                    </Popover>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="address"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Full Address</FormLabel>
                                                    <FormControl>
                                                        <Textarea placeholder="Street, building, floor…" {...field} className="min-h-[72px] rounded-lg border border-ant-line bg-ant-paper text-[13px] font-medium text-ant-ink placeholder:text-ant-mid focus-visible:ring-ant-orange focus-visible:ring-offset-0 focus-visible:border-ant-ink/25 resize-y p-3 leading-relaxed" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>

                                    {/* Column 2: Logistics & Status */}
                                    <div className="space-y-3.5">
                                        <h4 className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid border-b border-ant-line pb-2 flex items-center gap-2">
                                            <Truck className="w-3 h-3" /> Logistics
                                        </h4>
                                        <FormField
                                            control={form.control}
                                            name="source_name"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Sales Channel</FormLabel>
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <FormControl>
                                                            <SelectTrigger className="h-10 rounded-lg border border-ant-line bg-ant-paper text-[13px] font-medium text-ant-ink">
                                                                <SelectValue placeholder="Select channel">
                                                                    {field.value && (
                                                                        <span className="inline-flex items-center gap-1.5 capitalize">
                                                                            <SourceIcon source={field.value} />
                                                                            {getSourceMeta(field.value).label}
                                                                        </span>
                                                                    )}
                                                                </SelectValue>
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent className="rounded-xl border-ant-line bg-ant-paper shadow-[0_12px_40px_-20px_rgba(20,20,19,0.3)]">
                                                            {SALES_SOURCES.map(source => (
                                                                <SelectItem key={source} value={source} className="rounded-xl font-bold capitalize">
                                                                    <span className="inline-flex items-center gap-2">
                                                                        <SourceIcon source={source} />
                                                                        {getSourceMeta(source).label}
                                                                    </span>
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                            {availableProviders.length > 0 && (
                                                <FormField
                                                    control={form.control}
                                                    name="courier_id"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-300">
                                                            <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Shipping Provider</FormLabel>
                                                            <Select
                                                                onValueChange={(val) => {
                                                                    const provider = availableProviders.find(p => p.id === val);
                                                                    if (provider?.type === 'courier') {
                                                                        form.setValue('courier_id', val);
                                                                        form.setValue('company_id', null);
                                                                        const fee = findFee('courier', val, selectedCityId);
                                                                        form.setValue('shipping_cost', fee ?? 0);
                                                                    } else {
                                                                        form.setValue('company_id', val);
                                                                        form.setValue('courier_id', null);
                                                                        const fee = findFee('company', val, selectedCityId);
                                                                        form.setValue('shipping_cost', fee ?? 0);
                                                                    }
                                                                }}
                                                                value={field.value || selectedCompanyId || ''}
                                                            >
                                                                <FormControl>
                                                                    <SelectTrigger className="h-10 rounded-lg border border-ant-line bg-ant-paper text-[13px] font-medium text-ant-ink">
                                                                        <SelectValue placeholder="Choose provider..." />
                                                                    </SelectTrigger>
                                                                </FormControl>
                                                                <SelectContent className="rounded-xl border-ant-line bg-ant-paper shadow-[0_12px_40px_-20px_rgba(20,20,19,0.3)]">
                                                                    {availableProviders.map((p: any) => (
                                                                        <SelectItem key={p.id} value={p.id} className="rounded-xl font-bold">
                                                                            <div className="flex items-center gap-2">
                                                                                {p.type === 'courier' ? (
                                                                                    <UserAvatar url={p.avatar_url} config={(p as any).avatar_config} name={p.name} className="w-5 h-5 rounded-full" />
                                                                                ) : (
                                                                                    resolveProviderLogo(p) ? (
                                                                                        <img src={resolveProviderLogo(p)!} alt="" className="w-5 h-5 rounded-full object-contain bg-white border border-ant-line" />
                                                                                    ) : (
                                                                                        <span className="w-5 h-5 rounded-full bg-ant-ink/10 flex items-center justify-center text-[9px] font-semibold text-ant-ink/60">
                                                                                            {(p.name || '?').slice(0, 1).toUpperCase()}
                                                                                        </span>
                                                                                    )
                                                                                )}
                                                                                {p.name}
                                                                            </div>
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </FormItem>
                                                    )}
                                                />
                                            )}

                                            <FormField
                                                control={form.control}
                                                name="shipping_cost"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-2">
                                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Shipping Fee</FormLabel>
                                                        <FormControl>
                                                            <div className="relative">
                                                                <Input
                                                                    type="number"
                                                                    {...field}
                                                                    readOnly={shippingFeeReadOnly}
                                                                    className={`h-10 rounded-lg border border-ant-line bg-ant-paper text-[13px] font-medium text-ant-ink pl-3 pr-10 ${shippingFeeReadOnly ? 'cursor-not-allowed opacity-60' : ''}`}
                                                                />
                                                                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        onClick={calculateShippingFee}
                                                                        className="h-6 w-6 text-ant-mid hover:text-ant-ink"
                                                                        title="Calculate Fees"
                                                                        disabled={
                                                                            !selectedCityId ||
                                                                            shippingFeeReadOnly ||
                                                                            (!selectedCourierId && !selectedCompanyId)
                                                                        }
                                                                    >
                                                                        <RefreshCcw className="w-3 h-3" />
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>

                                        <FormField
                                            control={form.control}
                                            name="order_status_id"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-col space-y-2">
                                                    <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Pipeline Stage</FormLabel>
                                                    <Popover open={statusSearchOpen} onOpenChange={setStatusSearchOpen}>
                                                        <PopoverTrigger asChild>
                                                            <FormControl>
                                                                <Button
                                                                    variant="outline"
                                                                    role="combobox"
                                                                    className={cn(
                                                                        "h-10 w-full justify-between rounded-lg border border-ant-line bg-ant-paper text-[13px] text-ant-ink font-medium text-left px-3",
                                                                        !field.value && "text-ant-muted"
                                                                    )}
                                                                >
                                                                    {field.value
                                                                        ? orderStatuses?.find((s: any) => s.id === field.value)?.label
                                                                        : "Set status..."}
                                                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                                </Button>
                                                            </FormControl>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="w-[300px] p-0 border-none shadow-2xl rounded-2xl" align="start" onWheel={(e) => e.stopPropagation()}>
                                                            <Command className="rounded-none">
                                                                <CommandInput placeholder="Search status..." className="h-12 border-none ring-0 focus:ring-0 shrink-0" />
                                                                <CommandList className="max-h-[250px] overflow-y-scroll custom-scrollbar overflow-x-hidden">
                                                                    <CommandEmpty>No status found.</CommandEmpty>
                                                                    <CommandGroup>
                                                                        {orderStatusesForModal?.map((status: any) => (
                                                                            <CommandItem
                                                                                key={status.id}
                                                                                value={status.label}
                                                                                onSelect={() => {
                                                                                    const previousId = form.getValues('order_status_id');
                                                                                    const newIsPostponed =
                                                                                        !!REPORTED_STATUS_ID &&
                                                                                        (status.id === REPORTED_STATUS_ID ||
                                                                                            isOrderCategory(status.id, 'postponed'));
                                                                                    const oldIsPostponed =
                                                                                        !!REPORTED_STATUS_ID &&
                                                                                        (previousId === REPORTED_STATUS_ID ||
                                                                                            isOrderCategory(previousId, 'postponed'));

                                                                                    form.setValue('order_status_id', status.id);
                                                                                    if (!newIsPostponed) {
                                                                                        form.setValue('_reportedDate', '');
                                                                                    }
                                                                                    setStatusSearchOpen(false);

                                                                                    if (
                                                                                        !newIsPostponed ||
                                                                                        oldIsPostponed ||
                                                                                        previousId === status.id
                                                                                    ) {
                                                                                        return;
                                                                                    }

                                                                                    reportedStatusRevertRef.current = previousId;
                                                                                    setReportedData({
                                                                                        date: undefined,
                                                                                        time: '12:00',
                                                                                        comment: form.getValues('history_comment') || '',
                                                                                    });
                                                                                    setPendingReportedAction(
                                                                                        () => (date: Date, time: string, comment: string) => {
                                                                                            const [hours, minutes] = time.split(':');
                                                                                            const dateTime = new Date(date);
                                                                                            dateTime.setHours(Number(hours), Number(minutes), 0, 0);
                                                                                            form.setValue('_reportedDate', dateTime.toISOString());
                                                                                            form.setValue('history_comment', comment);
                                                                                            reportedStatusRevertRef.current = null;
                                                                                            setIsReportedModalOpen(false);
                                                                                            setPendingReportedAction(null);
                                                                                        }
                                                                                    );
                                                                                    setIsReportedModalOpen(true);
                                                                                }}
                                                                                className="py-3 px-4 font-bold text-ant-ink cursor-pointer hover:bg-ant-ink hover:text-ant-light"
                                                                            >
                                                                                <div
                                                                                    className="w-3 h-3 rounded-full mr-3"
                                                                                    style={{ backgroundColor: status.color }}
                                                                                />
                                                                                <Check
                                                                                    className={cn(
                                                                                        "mr-2 h-4 w-4",
                                                                                        status.id === field.value ? "opacity-100" : "opacity-0"
                                                                                    )}
                                                                                />
                                                                                {status.label}
                                                                            </CommandItem>
                                                                        ))}
                                                                    </CommandGroup>
                                                                </CommandList>
                                                            </Command>
                                                        </PopoverContent>
                                                    </Popover>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div className="p-3 rounded-xl bg-ant-ink/[0.03] border border-ant-line flex items-center justify-between gap-3">
                                                <div className="space-y-0.5 min-w-0">
                                                    <FormLabel className="text-xs font-bold text-ant-ink">Exchange order</FormLabel>
                                                    <p className="text-[10px] text-ant-muted leading-snug">Replacing a previous order?</p>
                                                </div>
                                                <FormField
                                                    control={form.control}
                                                    name="replace"
                                                    render={({ field }) => (
                                                        <FormControl>
                                                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                                                        </FormControl>
                                                    )}
                                                />
                                            </div>
                                            <div className="p-3 rounded-xl bg-ant-ink/[0.03] border border-ant-line flex items-center justify-between gap-3">
                                                <div className="space-y-0.5 min-w-0">
                                                    <FormLabel className="text-xs font-bold text-ant-ink">Include delivery fees</FormLabel>
                                                    <p className="text-[10px] text-ant-muted leading-snug">Add shipping to order total</p>
                                                </div>
                                                <FormField
                                                    control={form.control}
                                                    name="include_delivery_in_total"
                                                    render={({ field }) => (
                                                        <FormControl>
                                                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                                                        </FormControl>
                                                    )}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Old-tracking spans full width (moved out of the 2-col grid) */}
                                        {form.watch('replace') &&
                                            orderCompanyIsColiaty(companies, form.watch('company_id')) && (
                                                <FormField
                                                    control={form.control}
                                                    name="coliaty_old_tracking"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-2 sm:col-span-2 rounded-xl border border-ant-orange/30/80 bg-ant-orange/10/40 p-3">
                                                            <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-ink">
                                                                Previous parcel tracking (Coliaty)
                                                            </FormLabel>
                                                            <p className="text-[10px] text-ant-muted leading-snug">
                                                                Required for exchange: maps to Coliaty{' '}
                                                                <code className="text-[10px]">package_old_tracking</code>.
                                                            </p>
                                                            <FormControl>
                                                                <Input
                                                                    placeholder="Old tracking number"
                                                                    {...field}
                                                                    className="h-11 rounded-xl border border-ant-ink/10 bg-white text-sm font-bold text-ant-ink"
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            )}
                                        {form.watch('replace') &&
                                            orderCompanyIsAmeex(companies, form.watch('company_id')) && (
                                                <FormField
                                                    control={form.control}
                                                    name="ameex_old_tracking"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-2 sm:col-span-2 rounded-xl border border-ant-orange/30/80 bg-ant-orange/10/40 p-3">
                                                            <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-ink">
                                                                Previous parcel tracking (AMEEX)
                                                            </FormLabel>
                                                            <p className="text-[10px] text-ant-muted leading-snug">
                                                                Required for exchange: sent as AMEEX{' '}
                                                                <code className="text-[10px]">exchange_code</code>.
                                                            </p>
                                                            <FormControl>
                                                                <Input
                                                                    placeholder="Old tracking number"
                                                                    {...field}
                                                                    className="h-11 rounded-xl border border-ant-ink/10 bg-white text-sm font-bold text-ant-ink"
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            )}
                                        {form.watch('replace') &&
                                            orderCompanyIsQuickLivraison(companies, form.watch('company_id')) && (
                                                <FormField
                                                    control={form.control}
                                                    name="quicklivraison_old_tracking"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-2 sm:col-span-2 rounded-xl border border-ant-orange/30/80 bg-ant-orange/10/40 p-3">
                                                            <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-ink">
                                                                Previous parcel tracking (Quick Livraison)
                                                            </FormLabel>
                                                            <p className="text-[10px] text-ant-muted leading-snug">
                                                                Required for exchange: sent as Quick Livraison{' '}
                                                                <code className="text-[10px]">echange_colis</code>.
                                                            </p>
                                                            <FormControl>
                                                                <Input
                                                                    placeholder="Old tracking number"
                                                                    {...field}
                                                                    className="h-11 rounded-xl border border-ant-ink/10 bg-white text-sm font-bold text-ant-ink"
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            )}
                                        {form.watch('replace') &&
                                            orderCompanyIsForcelog(companies, form.watch('company_id')) && (
                                                <FormField
                                                    control={form.control}
                                                    name="forcelog_old_tracking"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-2 sm:col-span-2 rounded-xl border border-ant-orange/30/80 bg-ant-orange/10/40 p-3">
                                                            <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-ink">
                                                                Previous parcel tracking (Forcelog)
                                                            </FormLabel>
                                                            <p className="text-[10px] text-ant-muted leading-snug">
                                                                Required for exchange: sent as Forcelog{' '}
                                                                <code className="text-[10px]">parcel_replace_old</code> (code F-XXX).
                                                            </p>
                                                            <FormControl>
                                                                <Input
                                                                    placeholder="F-…"
                                                                    {...field}
                                                                    className="h-11 rounded-xl border border-ant-ink/10 bg-white text-sm font-bold text-ant-ink"
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            )}
                                        {form.watch('replace') &&
                                            orderCompanyIsSendit(companies, form.watch('company_id')) && (
                                                <FormField
                                                    control={form.control}
                                                    name="sendit_old_tracking"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-2 sm:col-span-2 rounded-xl border border-ant-orange/30/80 bg-ant-orange/10/40 p-3">
                                                            <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-ink">
                                                                Previous parcel tracking (Sendit)
                                                            </FormLabel>
                                                            <p className="text-[10px] text-ant-muted leading-snug">
                                                                Required for exchange: sent as Sendit{' '}
                                                                <code className="text-[10px]">delivery_exchange_id</code> (code DH…).
                                                            </p>
                                                            <FormControl>
                                                                <Input
                                                                    placeholder="DH…"
                                                                    {...field}
                                                                    className="h-11 rounded-xl border border-ant-ink/10 bg-white text-sm font-bold text-ant-ink"
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            )}
                                        {form.watch('replace') &&
                                            orderCompanyIsDelvoExpress(companies, form.watch('company_id')) && (
                                                <FormField
                                                    control={form.control}
                                                    name="delvoexpress_old_tracking"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-2 sm:col-span-2 rounded-xl border border-ant-orange/30/80 bg-ant-orange/10/40 p-3">
                                                            <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-ink">
                                                                Previous parcel tracking (Delevo Express)
                                                            </FormLabel>
                                                            <p className="text-[10px] text-ant-muted leading-snug">
                                                                Required for exchange: sent as Delevo Express{' '}
                                                                <code className="text-[10px]">coli_exchange</code> (code PKG-XXX).
                                                            </p>
                                                            <FormControl>
                                                                <Input
                                                                    placeholder="PKG-…"
                                                                    {...field}
                                                                    className="h-11 rounded-xl border border-ant-ink/10 bg-white text-sm font-bold text-ant-ink"
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            )}

                                {form.watch('replace') && (
                                    <section className="rounded-xl border border-purple-400/40 bg-purple-500/[0.04] p-3 sm:p-4 space-y-3 shrink-0">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="space-y-0.5">
                                                <h4 className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid flex items-center gap-2">
                                                    <ShoppingBag className="w-3 h-3 text-purple-500/70" /> Additional sale (optional)
                                                </h4>
                                                <p className="text-[10px] text-ant-muted leading-snug">
                                                    Extra product sold WITH this exchange → becomes a separate normal order (paid/unpaid). Leave empty for a pure swap.
                                                </p>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => addAppend({ product_id: '', quantity: 1, unit_price: 0, accessories: [] })}
                                                className="text-[10px] font-medium text-ant-ink border-ant-line bg-ant-paper h-8 px-3 gap-1.5 rounded-full shrink-0 hover:border-ant-ink/25"
                                            >
                                                <Plus className="w-3.5 h-3.5" /> Product
                                            </Button>
                                        </div>
                                        {addFields.length > 0 && (
                                            <div className="space-y-2">
                                                {addFields.map((field, index) => renderOrderLine('additional_items', index, field.id, true, () => addRemove(index), `Sale ${index + 1}`))}
                                            </div>
                                        )}
                                    </section>
                                )}

                                <section className="rounded-xl border border-ant-line bg-ant-paper p-3 sm:p-4 space-y-3 shrink-0">
                                    <div className="space-y-0.5">
                                        <h4 className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid flex items-center gap-2">
                                            <MessageSquare className="w-3 h-3 text-ant-ink/45" /> Notes
                                        </h4>
                                        <p className="text-[10px] text-ant-muted leading-snug">
                                            Internal vs courier-facing. Optional.
                                        </p>
                                    </div>
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                        <FormField
                                            control={form.control}
                                            name="note"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Order Note (Internal)</FormLabel>
                                                    <FormControl>
                                                        <Textarea placeholder="Packaging, gifts…" {...field} className="min-h-[64px] rounded-lg border border-ant-line bg-ant-paper text-[13px] font-medium text-ant-ink placeholder:text-ant-mid focus-visible:ring-ant-orange focus-visible:ring-offset-0 focus-visible:border-ant-ink/25 resize-y p-3 leading-relaxed" />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="delivery_note"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Courier Note (Public)</FormLabel>
                                                    <FormControl>
                                                        <Textarea placeholder="Courier instructions…" {...field} className="min-h-[64px] rounded-lg border border-ant-line bg-ant-paper text-[13px] font-medium text-ant-ink placeholder:text-ant-mid focus-visible:ring-ant-orange focus-visible:ring-offset-0 focus-visible:border-ant-ink/25 resize-y p-3 leading-relaxed" />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </section>
                                    </div>

                                    <aside className="w-full xl:w-[min(26rem,34vw)] xl:max-w-[420px] xl:shrink-0 flex flex-col min-h-0 border-t xl:border-t-0 xl:border-l border-ant-ink/[0.1] bg-ant-ink/[0.03]">
                                    <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2.5 border-b border-ant-line bg-ant-paper">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="w-8 h-8 rounded-lg bg-ant-ink/10 flex items-center justify-center shrink-0">
                                                <ShoppingBag className="w-4 h-4 text-ant-ink" />
                                            </div>
                                            <div className="min-w-0">
                                                <h4 className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-ink">Order lines</h4>
                                                <p className="text-[9px] text-ant-ink/45 font-medium truncate">Scroll here only</p>
                                            </div>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => append({ product_id: '', quantity: 1, unit_price: 0, accessories: [] })}
                                            className="text-[10px] font-medium text-ant-ink border-ant-line bg-ant-paper h-8 px-3 gap-1.5 rounded-full shrink-0 hover:border-ant-ink/25"
                                        >
                                            <Plus className="w-3.5 h-3.5" /> Line
                                        </Button>
                                    </div>

                                    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar px-3 py-3">
                                    <div className="space-y-3">
                                        {fields.map((field, index) => {
                                            const hasProduct = !!form.watch(`items.${index}.product_id`) && form.watch(`items.${index}.product_id`) !== 'none';
                                            const productSubtotal = (form.watch(`items.${index}.quantity`) || 0) * (form.watch(`items.${index}.unit_price`) || 0);
                                            return (
                                                <div key={field.id} className="rounded-2xl border border-ant-ink/10 bg-white p-3 shadow-sm space-y-3 animate-in slide-in-from-left-2 duration-200">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid tabular-nums">Line {index + 1}</span>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => remove(index)}
                                                            disabled={fields.length === 1}
                                                            className="h-7 w-7 rounded-lg text-red-400 hover:text-ant-rose hover:bg-ant-rose/10 shrink-0"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </Button>
                                                    </div>
                                                    <FormField
                                                        control={form.control}
                                                        name={`items.${index}.product_id`}
                                                        render={({ field }) => (
                                                            <FormItem className="space-y-1.5">
                                                                <FormControl>
                                                                    <OrderLineProductCombobox
                                                                        products={(products || []) as OrderLineProductOption[]}
                                                                        value={field.value === 'none' ? 'none' : field.value || ''}
                                                                        blockZeroStock={!isEdit}
                                                                        formatLabel={(p) => String(p.name)}
                                                                        onProductIdChange={(val) => {
                                                                            field.onChange(val === 'none' ? 'none' : val);
                                                                            if (val !== 'none') {
                                                                                const prod = products?.find((p: any) => p.id === val);
                                                                                if (prod) {
                                                                                    form.setValue(`items.${index}.unit_price`, Number(prod.selling_price || 0));
                                                                                    if (form.watch(`items.${index}.quantity`) === 0) {
                                                                                        form.setValue(`items.${index}.quantity`, 1);
                                                                                    }
                                                                                    const attachments = productAccessoriesForOrders?.filter((pa: any) => pa.product_id === val);
                                                                                    if (attachments && attachments.length > 0) {
                                                                                        const prodQty = Number(form.getValues(`items.${index}.quantity`)) || 1;
                                                                                        const allItems = form.getValues('items') || [];
                                                                                        const currentAccessories = form.getValues(`items.${index}.accessories`) || [];
                                                                                        const newAccessories = [...currentAccessories];
                                                                                        attachments.forEach((attachment: any) => {
                                                                                            const mode = attachment.attach_mode || 'fixed';
                                                                                            const existingAttached = newAccessories.find((a: any) => a.accessory_id === attachment.accessory_id);
                                                                                            if (existingAttached) return;
                                                                                            // Per-order accessory (e.g. carton): only once for the whole
                                                                                            // order, kept on the first line that carries it. Skip if any
                                                                                            // other line already has it.
                                                                                            if (mode === 'per_order') {
                                                                                                const elsewhere = allItems.some((it: any, i: number) =>
                                                                                                    i !== index && (it.accessories || []).some((a: any) => a.accessory_id === attachment.accessory_id)
                                                                                                );
                                                                                                if (elsewhere) return;
                                                                                            }
                                                                                            const base = attachment.default_quantity || 1;
                                                                                            const qty = mode === 'per_item' ? base * prodQty : base;
                                                                                            const acc = accessories?.find((a: any) => a.id === attachment.accessory_id);
                                                                                            newAccessories.push({
                                                                                                accessory_id: attachment.accessory_id,
                                                                                                accessory_quantity: qty,
                                                                                                accessory_unit_price: acc ? Number(acc.cost_price || 0) : 0
                                                                                            });
                                                                                        });
                                                                                        form.setValue(`items.${index}.accessories`, newAccessories);
                                                                                    }
                                                                                }
                                                                            } else {
                                                                                form.setValue(`items.${index}.unit_price`, 0);
                                                                                form.setValue(`items.${index}.quantity`, 0);
                                                                            }
                                                                        }}
                                                                    />
                                                                </FormControl>
                                                                <FormMessage />
                                                                {(() => {
                                                                    const selectedProduct = products?.find((p: any) => p.id === field.value);
                                                                    const sn = toProductStockNumber(selectedProduct?.stock);
                                                                    return (
                                                                        <OrderLineProductStockHint
                                                                            stock={sn}
                                                                            blockZeroStock={!isEdit}
                                                                        />
                                                                    );
                                                                })()}
                                                            </FormItem>
                                                        )}
                                                    />

                                                    <div className="grid grid-cols-3 gap-2">
                                                        <FormField
                                                            control={form.control}
                                                            name={`items.${index}.unit_price`}
                                                            render={({ field }) => (
                                                                <FormItem className="space-y-1">
                                                                    <FormLabel className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid">Unit</FormLabel>
                                                                    <Input type="number" {...field} disabled={!hasProduct} className="h-9 rounded-lg border border-ant-ink/10 bg-ant-ink/[0.03] text-sm font-bold text-ant-ink text-center px-1" />
                                                                </FormItem>
                                                            )}
                                                        />
                                                        <FormField
                                                            control={form.control}
                                                            name={`items.${index}.quantity`}
                                                            render={({ field }) => (
                                                                <FormItem className="space-y-1">
                                                                    <FormLabel className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid">Qty</FormLabel>
                                                                    <Input
                                                                        type="number"
                                                                        {...field}
                                                                        disabled={!hasProduct}
                                                                        onChange={(e) => {
                                                                            field.onChange(e);
                                                                            // Only PER-ITEM accessories scale with product qty
                                                                            // (e.g. venteur default 2 → 4 when qty goes 1→2).
                                                                            // Fixed and per-order accessories never change here;
                                                                            // ad-hoc add-ons (no attachment) are left alone.
                                                                            const newQty = Number(e.target.value);
                                                                            if (!Number.isFinite(newQty) || newQty <= 0) return;
                                                                            const productId = form.getValues(`items.${index}.product_id`);
                                                                            const accs = form.getValues(`items.${index}.accessories`) || [];
                                                                            accs.forEach((acc: any, accIdx: number) => {
                                                                                if (!acc.accessory_id || acc.accessory_id === 'none') return;
                                                                                const pa = productAccessoriesForOrders?.find(
                                                                                    (p: any) => p.product_id === productId && p.accessory_id === acc.accessory_id
                                                                                );
                                                                                if (pa && (pa as any).attach_mode === 'per_item') {
                                                                                    form.setValue(`items.${index}.accessories.${accIdx}.accessory_quantity`, ((pa as any).default_quantity || 1) * newQty);
                                                                                }
                                                                            });
                                                                        }}
                                                                        className="h-9 rounded-lg border border-ant-ink/10 bg-ant-ink/[0.03] text-sm font-bold text-ant-ink text-center px-1"
                                                                    />
                                                                </FormItem>
                                                            )}
                                                        />
                                                        <div className="rounded-lg bg-ant-ink/10 px-1.5 py-1 flex flex-col justify-center items-center text-center">
                                                            <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid leading-none">Total</span>
                                                            <span className="font-display text-[13px] font-semibold text-ant-ink tabular-nums leading-tight tracking-[-0.01em]">{productSubtotal.toFixed(2)} <span className="text-[10px] font-medium text-ant-mid">DH</span></span>
                                                        </div>
                                                    </div>

                                                    <div className="rounded-xl bg-ant-ink/[0.04] border border-ant-ink/[0.07] p-2.5 space-y-2">
                                                        <p className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid">Add-ons</p>
                                                        {(form.watch(`items.${index}.accessories`) || []).map((acc: any, accIdx: number) => {
                                                            const accSubtotal = (form.watch(`items.${index}.accessories.${accIdx}.accessory_quantity`) || 0) * (form.watch(`items.${index}.accessories.${accIdx}.accessory_unit_price`) || 0);
                                                            const hasAccessory = !!form.watch(`items.${index}.accessories.${accIdx}.accessory_id`) && form.watch(`items.${index}.accessories.${accIdx}.accessory_id`) !== 'none';

                                                            return (
                                                                <div key={accIdx} className="space-y-2 pb-2 border-b border-ant-line last:border-0 last:pb-0">
                                                                    <div className="flex gap-2 items-end">
                                                                        <FormField
                                                                            control={form.control}
                                                                            name={`items.${index}.accessories.${accIdx}.accessory_id`}
                                                                            render={({ field }) => (
                                                                                <FormItem className="space-y-1 flex-1 min-w-0">
                                                                                    <FormLabel className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid flex items-center gap-1"><Puzzle className="w-3 h-3 opacity-60" /> Item</FormLabel>
                                                                                    <Select
                                                                                        onValueChange={(val) => {
                                                                                            field.onChange(val);
                                                                                            if (val !== 'none') {
                                                                                                const accessoryObj = accessories?.find((a: any) => a.id === val);
                                                                                                if (accessoryObj) {
                                                                                                    form.setValue(`items.${index}.accessories.${accIdx}.accessory_unit_price`, Number(accessoryObj.cost_price || 0));
                                                                                                    if (form.watch(`items.${index}.accessories.${accIdx}.accessory_quantity`) === 0) {
                                                                                                        form.setValue(`items.${index}.accessories.${accIdx}.accessory_quantity`, 1);
                                                                                                    }
                                                                                                }
                                                                                            } else {
                                                                                                form.setValue(`items.${index}.accessories.${accIdx}.accessory_unit_price`, 0);
                                                                                                form.setValue(`items.${index}.accessories.${accIdx}.accessory_quantity`, 0);
                                                                                            }
                                                                                        }}
                                                                                        value={field.value || ''}
                                                                                    >
                                                                                        <FormControl>
                                                                                            <SelectTrigger className="h-9 rounded-lg border border-ant-ink/10 bg-white text-sm font-bold text-ant-ink shadow-none">
                                                                                                <SelectValue placeholder="Accessory…" />
                                                                                            </SelectTrigger>
                                                                                        </FormControl>
                                                                                        <SelectContent className="rounded-xl border-none shadow-2xl max-h-[200px] overflow-y-auto custom-scrollbar">
                                                                                            <SelectItem value="none" className="rounded-lg font-medium text-ant-muted text-sm">— None —</SelectItem>
                                                                                            {accessories?.map((a: any) => (
                                                                                                <SelectItem key={a.id} value={a.id} className="rounded-lg font-medium text-sm py-2">
                                                                                                    {a.name} <span className="text-ant-muted ml-1 text-xs">({a.code})</span>
                                                                                                </SelectItem>
                                                                                            ))}
                                                                                        </SelectContent>
                                                                                    </Select>
                                                                                    <FormMessage />
                                                                                    {(() => {
                                                                                        const selectedAccessory = accessories?.find((a: any) => a.id === field.value);
                                                                                        if (!selectedAccessory) return null;
                                                                                        const sn = toProductStockNumber(selectedAccessory?.stock);
                                                                                        return <OrderLineProductStockHint stock={sn} blockZeroStock={false} />;
                                                                                    })()}
                                                                                </FormItem>
                                                                            )}
                                                                        />
                                                                        <Button
                                                                            type="button"
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            onClick={() => {
                                                                                const current = form.getValues(`items.${index}.accessories`) || [];
                                                                                current.splice(accIdx, 1);
                                                                                form.setValue(`items.${index}.accessories`, current);
                                                                            }}
                                                                            className="h-9 w-9 rounded-lg text-red-400 hover:text-ant-rose hover:bg-ant-rose/10 shrink-0"
                                                                        >
                                                                            <Trash2 className="w-3.5 h-3.5" />
                                                                        </Button>
                                                                    </div>
                                                                    <div className="grid grid-cols-3 gap-2">
                                                                        <FormField
                                                                            control={form.control}
                                                                            name={`items.${index}.accessories.${accIdx}.accessory_unit_price`}
                                                                            render={({ field }) => (
                                                                                <FormItem className="space-y-1">
                                                                                    <FormLabel className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid">Cost</FormLabel>
                                                                                    <Input type="number" {...field} disabled={!hasAccessory} className="h-9 rounded-lg border border-ant-ink/10 bg-white text-sm font-bold text-ant-ink text-center px-1" />
                                                                                </FormItem>
                                                                            )}
                                                                        />
                                                                        <FormField
                                                                            control={form.control}
                                                                            name={`items.${index}.accessories.${accIdx}.accessory_quantity`}
                                                                            render={({ field }) => (
                                                                                <FormItem className="space-y-1">
                                                                                    <FormLabel className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid">Qty</FormLabel>
                                                                                    <Input type="number" {...field} disabled={!hasAccessory} className="h-9 rounded-lg border border-ant-ink/10 bg-white text-sm font-bold text-ant-ink text-center px-1" />
                                                                                </FormItem>
                                                                            )}
                                                                        />
                                                                        <div className="rounded-lg bg-white/80 border border-ant-ink/10 px-1.5 py-1 flex flex-col justify-center items-center">
                                                                            <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid">Sum</span>
                                                                            <span className="font-display text-[13px] font-semibold text-ant-ink tabular-nums tracking-[-0.01em]">{accSubtotal.toFixed(2)}</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => {
                                                                const current = form.getValues(`items.${index}.accessories`) || [];
                                                                current.push({ accessory_id: 'none', accessory_quantity: 0, accessory_unit_price: 0 });
                                                                form.setValue(`items.${index}.accessories`, current);
                                                            }}
                                                            className="text-[9px] font-semibold uppercase text-ant-ink border-ant-ink/15 h-7 rounded-lg gap-1 w-full bg-white/80"
                                                        >
                                                            <Plus className="w-3 h-3" /> Add add-on
                                                        </Button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    </div>
                                    </aside>
                            </div>

                            <DialogFooter className="px-4 py-2.5 sm:px-5 shrink-0 bg-ant-line-soft border-t border-ant-line flex flex-row flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-9 h-9 rounded-xl bg-ant-ink flex items-center justify-center text-ant-light shadow-md shrink-0">
                                        <DollarSign className="w-4 h-4" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-[9px] font-semibold uppercase tracking-widest text-ant-muted/70 leading-none">Total</p>
                                        <p className="text-lg sm:text-xl font-semibold text-ant-ink tabular-nums leading-tight truncate">
                                            {(form.watch('items').reduce((acc, item) => acc + (item.quantity * item.unit_price), 0) + (form.watch('include_delivery_in_total') !== false ? Number(form.watch('shipping_cost') || 0) : 0)).toFixed(2)} DH
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                    {/* DELTA 2: Annuler DISCARDS the draft (page version only closed). */}
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleDiscard}
                                        className="rounded-lg h-9 px-4 text-sm font-bold text-ant-ink hover:bg-ant-ink/10 m-0"
                                    >
                                        Annuler
                                    </Button>
                                    <Button
                                        type="submit"
                                        size="sm"
                                        disabled={
                                            (isEdit ? updateOrderMutation.isPending : createOrderMutation.isPending) ||
                                            newOrderHasZeroStockProduct
                                        }
                                        className="bg-ant-ink hover:bg-ant-ink/90 text-ant-light rounded-lg h-9 px-6 sm:px-8 text-sm font-bold shadow-md transition-all active:scale-[0.98] flex items-center gap-2 m-0"
                                    >
                                        {(isEdit ? updateOrderMutation.isPending : createOrderMutation.isPending) && <Loader2 className="w-4 h-4 animate-spin" />}
                                        {isEdit ? 'Save changes' : 'Confirm Order'}
                                    </Button>
                                </div>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* Reported Status Data Collection Modal — MIRROR of Orders.tsx L5941-6011 */}
            <Dialog
                open={isReportedModalOpen}
                onOpenChange={(v) => {
                    if (!v) dismissReportedModal(reportedStatusRevertRef.current !== null);
                }}
            >
                <DialogContent className="max-w-[min(100vw-2rem,40rem)] p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden flex flex-col">
                    <DialogHeader className="p-6 sm:p-8 pb-4 shrink-0 border-b border-ant-line">
                        <DialogTitle className="text-2xl font-semibold text-ant-ink">Reported Action</DialogTitle>
                        <DialogDescription className="text-sm font-bold text-ant-muted">
                            Please provide the scheduled date and time.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="p-6 sm:p-8 flex flex-col md:flex-row gap-6 md:gap-8 md:items-start">
                        <div className="space-y-2 flex flex-col shrink-0 md:max-w-[min(100%,280px)]">
                            <label className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Date</label>
                            <CalendarComponent
                                mode="single"
                                selected={reportedData.date}
                                onSelect={(d) => setReportedData(prev => ({ ...prev, date: d }))}
                                initialFocus
                                className="rounded-2xl border-none shadow-inner bg-ant-line-soft w-full p-2"
                            />
                        </div>
                        <div className="flex flex-col gap-4 flex-1 min-w-0 min-h-0">
                            <div className="space-y-2">
                                <label className="text-[10px] flex font-semibold uppercase tracking-wider text-ant-muted/70">Time</label>
                                <div className="relative">
                                    <Clock className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-ant-mid pointer-events-none" />
                                    <Input
                                        type="time"
                                        value={reportedData.time}
                                        onChange={(e) => setReportedData(prev => ({ ...prev, time: e.target.value }))}
                                        className="h-14 pl-12 rounded-2xl border-none bg-ant-ink/[0.04] text-base font-bold text-ant-ink shadow-inner w-full"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2 flex flex-col flex-1 min-h-[120px]">
                                <label className="text-[10px] flex font-semibold uppercase tracking-wider text-ant-muted/70">Comment (Optional)</label>
                                <Textarea
                                    value={reportedData.comment}
                                    onChange={(e) => setReportedData(prev => ({ ...prev, comment: e.target.value }))}
                                    placeholder="Add a note why it was reported..."
                                    className="resize-none rounded-2xl border-none bg-ant-ink/[0.04] text-base font-bold text-ant-ink shadow-inner flex-1 min-h-[120px] md:min-h-[200px]"
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter className="p-8 pt-4 border-t border-ant-line bg-ant-light">
                        <Button
                            variant="ghost"
                            onClick={() => dismissReportedModal(true)}
                            className="h-12 rounded-2xl font-bold uppercase tracking-widest text-[10px]"
                        >
                            Cancel
                        </Button>
                        <Button
                            disabled={!reportedData.date}
                            onClick={() => {
                                if (reportedData.date && pendingReportedAction) {
                                    pendingReportedAction(reportedData.date, reportedData.time, reportedData.comment);
                                }
                            }}
                            className="bg-ant-ink text-white hover:bg-ant-ink/90 h-12 rounded-2xl font-bold px-8 shadow-xl shadow-brand-navy/20"
                        >
                            Confirm Action
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

export default AdminChatCartOrderDialog;
