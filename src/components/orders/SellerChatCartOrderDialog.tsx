/**
 * MIRROR of src/pages/seller/Orders.tsx create flow (schemas L216-334, queries
 * L1189-1408, form L1411-1437, fee/provider logic L1586-1779, createOrderMutation
 * L1782-1951, create dialog JSX L3719-4921, reported sub-dialog L5427-5497) —
 * extracted for the WhatsApp chat cart. If the Orders page create flow changes,
 * update this file too.
 *
 * Behavior deltas vs the page (intentional):
 *  - closing does NOT reset the form (draft survives across open/close);
 *  - explicit "Annuler" footer button discards the draft (reset to blank defaults);
 *  - onSuccess resets, reports draft=false, fires onSaved, closes;
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
} from '@/components/ui/dialog';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
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
} from '@/components/ui/select';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { UserAvatar } from '@/components/users/UserAvatar';
import { Textarea } from '@/components/ui/textarea';
import {
    OrderLineProductCombobox,
    OrderLineProductStockHint,
    toProductStockNumber,
    type OrderLineProductOption,
} from '@/components/orders/OrderLineProductCombobox';
import SourceIcon, { getSourceMeta } from '@/components/orders/SourceIcon';
import { statusRequiresHistoryComment } from '@/lib/orderHistoryCommentPolicy';
import { format } from 'date-fns';

// --- Stock error helper --- (Orders.tsx L138-143)
const friendlyStockError = (error: any): string => {
    const m = String(error?.message || error || '');
    if (m.includes('insufficient_stock')) return "Not enough stock to confirm this order. Restock the product or reduce the quantity.";
    if (m.includes('confirm_via_update')) return "Could not create a confirmed order directly. Please try again.";
    return m || 'Something went wrong.';
};

// --- Schemas --- (Orders.tsx L216-253)
const orderItemSchema = z.object({
    product_id: z.string().uuid("Please select a product"),
    quantity: z.coerce.number().min(1, "Quantity must be at least 1"),
    unit_price: z.coerce.number().min(0, "Price must be positive"),
    accessories: z.array(z.object({
        accessory_id: z.string().optional(),
        accessory_quantity: z.coerce.number().min(0).optional(),
        accessory_unit_price: z.coerce.number().min(0).optional(),
    })).optional().default([]),
});

const orderSchema = z.object({
    name: z.string().min(2, "Full Name is required"),
    phone: z.string().min(8, "Phone number is required"),
    city_id: z.string().uuid("Please select a city"),
    address: z.string().min(5, "Address is required"),
    source_name: z.string().min(1, "Source is required"),
    shipping_cost: z.coerce.number().min(0),
    include_delivery_in_total: z.boolean().default(false),
    replace: z.boolean().default(false), // "extchange" in request
    note: z.string().optional(),
    delivery_note: z.string().optional(),
    order_status_id: z.string().uuid("Please select a status"),
    items: z.array(orderItemSchema).min(1, "At least one product is required"),
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
export type SellerCartOrderDraft = OrderFormValues;

// --- Provider-type helpers --- (Orders.tsx L255-322)
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

// EDIT MODE: build the form-reset payload from an existing order row — 1:1 with
// the seller Orders page handleEdit (src/pages/seller/Orders.tsx L2393-2453),
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

// (Orders.tsx L437-443)
function productNameLabel(p: { name?: unknown; code?: string | null; id?: string } | null | undefined): string {
    if (!p) return 'Product';
    const n = p.name as any;
    if (typeof n === 'string') return n;
    if (n && typeof n === 'object') return String(n.en || n.fr || n.ar || p.code || p.id || 'Product');
    return String(p.code || p.id || 'Product');
}

export function SellerChatCartOrderDialog(props: {
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
     *  order and submits an UPDATE (mirror of the seller Orders page edit path)
     *  instead of a create. `editOrder` carries the fully-enriched order row
     *  (from SellerOrderViewDialog). When null/absent the dialog behaves exactly
     *  as before (CREATE mode). */
    editOrderId?: string | null;
    editOrder?: any | null;
    /** Fired when an edit session closes (saved, Annuler, or overlay close) so
     *  the host clears its editOrder state. Draft snapshots are NOT taken in
     *  edit mode — edits are one-off, not per-conversation drafts. */
    onEditClose?: () => void;
}) {
    // Reported Modal States (Orders.tsx L653-657)
    const [isReportedModalOpen, setIsReportedModalOpen] = useState(false);
    const [reportedData, setReportedData] = useState<{ date: Date | undefined, time: string, comment: string }>({ date: undefined, time: "12:00", comment: "" });
    const [pendingReportedAction, setPendingReportedAction] = useState<((date: Date, time: string, comment: string) => void) | null>(null);
    /** When opening the reported date modal from the status picker, revert pipeline stage if user cancels. */
    const reportedStatusRevertRef = useRef<string | null>(null);

    const statusCats = useStatusCategories();
    const REPORTED_STATUS_ID = statusCats.getOrderByCategory('postponed')?.id;
    const defaultNewOrderStatusId = statusCats.getOrderByCategory('new')?.id ?? '';

    // Dropdown search states (Orders.tsx L665-668)
    const [citySearchOpen, setCitySearchOpen] = useState(false);
    const cityListRef = useRef<HTMLDivElement>(null);
    const [statusSearchOpen, setStatusSearchOpen] = useState(false);
    const [showCustomerInsights, setShowCustomerInsights] = useState(false);

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const [userId, setUserId] = useState<string | null>(null);

    // EDIT MODE: derived flag + a ref pinning the order being edited for the
    // open session (the host may clear editOrder during the Radix close cycle).
    const isEdit = !!props.editOrderId;
    const editOrderRef = useRef<any>(null);

    React.useEffect(() => {
        const getUserId = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            setUserId(user?.id || null);
        };
        getUserId();
    }, []);

    // Custom scrollbar styles the dialog JSX relies on (Orders.tsx L751-777).
    // Injected here too so the dialog is self-contained outside the Orders page.
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
                background: rgba(0, 31, 63, 0.1);
                border-radius: 10px;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                background: rgba(0, 31, 63, 0.2);
            }
        `;
        document.head.appendChild(style);
        return () => { document.head.removeChild(style); };
    }, []);

    // --- Datasets the create dialog closes over (Orders.tsx L1189-1408) ---
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
            return await fetchAllRows('courier_fees', '*', {
                filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId }],
            });
        }
    });

    const { data: companyFees } = useQuery({
        queryKey: ['company-fees-all', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            return await fetchAllRows('company_fees', '*', {
                filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId }],
            });
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
                .select('id, code, label, ranking, color, icon, show_in_order, show_in_quick_status, show_in_seller_confirmation, recheck')
                .eq('active', true)
                .order('ranking', { ascending: true });
            if (error) throw error;
            return data;
        },
    });

    // Create-mode variant of Orders.tsx L1293-1310 (no selectedOrder injection).
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

    const { data: sellerProfile } = useQuery({
        queryKey: ['seller-user-products', userId, activeBusinessId],
        queryFn: async () => {
            if (!userId) return null;
            const { data, error } = await supabase
                .from('users')
                .select('products, commission_price, commission_basis')
                .eq('id', userId)
                .maybeSingle();
            if (error) throw error;
            return data as {
                products: string[] | null;
                commission_price: number | null;
                commission_basis: string | null;
            } | null;
        },
        enabled: !!userId && !!activeBusinessId,
    });

    const sellerProductIds = useMemo(() => {
        const p = sellerProfile?.products;
        if (!Array.isArray(p)) return [] as string[];
        return p.filter((id): id is string => typeof id === 'string' && id.length > 0);
    }, [sellerProfile]);

    const { data: products } = useQuery({
        queryKey: ['products-dropdown-seller', activeBusinessId, sellerProductIds],
        queryFn: async () => {
            if (!activeBusinessId || sellerProductIds.length === 0) return [];
            const { data, error } = await (supabase as any)
                .from('products')
                .select('id, name, code, selling_price, stock, image_url')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId)
                .in('id', sellerProductIds)
                .order('name');
            if (error) throw error;
            return data;
        },
        enabled: !!activeBusinessId && sellerProductIds.length > 0,
    });

    const { data: productAccessories } = useQuery({
        queryKey: ['product-accessories', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('product_accessories')
                .select('*')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        },
    });

    const { data: accessories } = useQuery({
        queryKey: ['accessories', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('accessories')
                .select('*')
                .eq('active', true)
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

    // --- Form --- (Orders.tsx L1411-1437)
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
            items: [{ product_id: '', quantity: 1, unit_price: 0 }],
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

    /** Blank defaults = what the Orders page resets to before opening the create modal (L2791-2814). */
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

    // DELTA 4: every open RE-BASELINES the form for the conversation it was
    // opened from: its saved draft when the host passes one, else a fresh
    // prefill — a draft from one client can never leak into another (the host
    // keeps drafts in a per-conv map).
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
    // once it resolves (the page does this at button-click time instead).
    useEffect(() => {
        if (isEdit) return; // edit prefills the order's own status — never patch
        if (!defaultNewOrderStatusId) return;
        // Re-capture the baseline so the patch itself never reads as a user change.
        if (JSON.stringify(form.getValues()) === baselineRef.current && !form.getValues('order_status_id')) {
            form.setValue('order_status_id', defaultNewOrderStatusId);
            captureBaseline();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [defaultNewOrderStatusId]);

    const watchedOrderItems = useWatch({ control: form.control, name: 'items' });

    // Create-mode always blocks zero-stock lines (Orders.tsx L1564-1574 minus edit branch).
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
    // Shipping fee is editable only when the "Include delivery fees" toggle is ON
    const shippingFeeReadOnly = !includeDeliveryWatched;

    // (Orders.tsx L1593-1639)
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

        // 2. Providers that have a fee for this city (even if no zone)
        const feeCouriers = couriers?.filter((c: any) =>
            courierFees?.some((f: any) => f.courier_id === c.id && (f.master_city_id === selectedCityId))
        ) || [];

        const feeCompanies = companies?.filter((c: any) =>
            companyFees?.some((f: any) => f.company_id === c.id && (f.master_city_id === selectedCityId))
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

    // Auto-select best provider and set fee when city changes (Orders.tsx L1713-1762)
    React.useEffect(() => {
        if (!selectedCityId || !availableProviders.length) return;

        // Helper to find fee for a provider + city
        const findProviderFee = (p: any): number => {
            if (p.type === 'courier') {
                const f = courierFees?.find((f: any) => f.courier_id === p.id && (f.master_city_id === selectedCityId));
                if (f) return Number(f.fee);
            } else {
                const f = companyFees?.find((f: any) => f.company_id === p.id && (f.master_city_id === selectedCityId));
                if (f) return Number(f.fee);
                // Fallback to provider_cities fees
                if (p.provider_type && providerCities?.length) {
                    const pc = providerCities.find(
                        (pc) => pc.master_city_id === selectedCityId && pc.provider_type === p.provider_type
                    );
                    if (pc?.fees?.delivered != null) return Number(pc.fees.delivered);
                }
            }
            return Infinity;
        };

        // If no provider selected, pick the best one
        if (!selectedCourierId && !selectedCompanyId) {
            const providersWithFees = availableProviders.map(p => {
                const fee = findProviderFee(p);
                return { ...p, fee };
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
            const currentProvider = availableProviders.find((p: any) =>
                (p.type === 'courier' && p.id === selectedCourierId) ||
                (p.type === 'company' && p.id === selectedCompanyId)
            );
            const foundFee = currentProvider ? findProviderFee(currentProvider) : 0;
            form.setValue('shipping_cost', foundFee === Infinity ? 0 : foundFee);
        }
    }, [selectedCityId, availableProviders, courierFees, companyFees, providerCities, selectedCourierId, selectedCompanyId, form]);

    const calculateShippingFee = () => {
        if (!selectedCityId || (!selectedCourierId && !selectedCompanyId)) return;

        let fee = 0;
        if (selectedCourierId) {
            fee = (courierFees?.find((f: any) => f.courier_id === selectedCourierId && (f.master_city_id === selectedCityId))?.fee as number) || 0;
        } else if (selectedCompanyId) {
            fee = (companyFees?.find((f: any) => f.company_id === selectedCompanyId && (f.master_city_id === selectedCityId))?.fee as number) || 0;
        }
        form.setValue('shipping_cost', Number(fee));
    };

    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: "items"
    });

    // --- Mutation --- (Orders.tsx L1782-1951; onSuccess adapted per contract)
    const createOrderMutation = useMutation({
        mutationFn: async (values: OrderFormValues) => {
            // 1. Insert order
            const totalPrice = values.items.reduce((acc, item) => acc + (item.quantity * item.unit_price), 0);
            const ship = Number(values.shipping_cost) || 0;
            const includeDelivery = values.include_delivery_in_total !== false;
            const orderPrice = includeDelivery ? totalPrice + ship : totalPrice;

            // Two-step create: if the desired status is 'confirmed', insert with
            // a non-confirmed status first (to avoid the DB forbid-on-INSERT rule),
            // then UPDATE to confirmed after items are inserted (fires stock gate).
            const wantsConfirm = !!values.order_status_id && statusCats.isOrderCategory(values.order_status_id, 'confirmed');
            const insertStatusId = wantsConfirm ? (defaultNewOrderStatusId || values.order_status_id) : values.order_status_id;

            const { data: order, error: orderError } = await (supabase as any)
                .from('orders')
                .insert({
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
                    price: orderPrice,
                    raw_price: totalPrice,
                    date: new Date().toISOString(),
                    'DigiCom Business': activeBusinessId,
                    seller_id: userId
                })
                .select()
                .single();

            if (orderError) throw orderError;

            // 2. Insert items and their accessories
            const itemRecords: any[] = [];
            values.items.forEach(item => {
                // Main product
                itemRecords.push({
                    order_id: order.id,
                    product_id: item.product_id,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    'DigiCom Business': activeBusinessId
                });
                // Accessories
                if (item.accessories && item.accessories.length > 0) {
                    item.accessories.forEach(acc => {
                        if (acc.accessory_id && acc.accessory_id !== 'none') {
                            itemRecords.push({
                                order_id: order.id,
                                product_id: item.product_id,
                                accessory_id: acc.accessory_id,
                                quantity: 0, // 0 means it's an accessory
                                unit_price: 0,
                                accessory_quantity: acc.accessory_quantity || 1,
                                accessory_unit_price: acc.accessory_unit_price || 0,
                                'DigiCom Business': activeBusinessId
                            });
                        }
                    });
                }
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
            if (statusIdForHistory && userId) {
                try {
                    await (supabase as any).from('order_status_history').insert({
                        order_id: order.id,
                        status_id: statusIdForHistory,
                        comment: (values.history_comment || '').trim(),
                        changed_by: userId,
                        'DigiCom Business': activeBusinessId
                    });
                } catch (err) {
                    console.error('Initial order status history error:', err);
                }
            }

            return order;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders-aggregate', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['business-duplicate-phones', activeBusinessId] });
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
            toast({ title: "Order Created", description: "Successfully logged new order." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: friendlyStockError(error), variant: "destructive" });
        }
    });

    // --- EDIT Mutation --- (MIRROR of seller Orders.tsx updateOrderMutation
    // L1650-1814: UPDATE order + delete-then-reinsert order_items via the INLINE
    // seller item build (NO product_accessories auto-expand, unlike admin) +
    // status-transition stamping + status-change history. seller_id is preserved.)
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
            const currentUserId = userRes.data.user?.id;

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
                if (statusCats.isOrderCategory(values.order_status_id, 'confirmed')) {
                    updatePayload.confirmed_by_id = currentUserId;
                    updatePayload.confirmation_date = new Date().toISOString();
                }
                if (statusCats.isOrderCategory(values.order_status_id, 'cancelled')) {
                    updatePayload.canceled_by_id = currentUserId;
                    updatePayload.annulation_date = new Date().toISOString();
                }
                if (statusCats.isOrderCategory(values.order_status_id, 'paid')) {
                    updatePayload.date_livraison = new Date().toISOString();
                }
                if (statusCats.isOrderCategory(values.order_status_id, 'postponed')) {
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

            const itemRecords: any[] = [];
            values.items.forEach(item => {
                // Main product
                itemRecords.push({
                    order_id: selectedOrder.id,
                    product_id: item.product_id,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    'DigiCom Business': activeBusinessId
                });
                // Accessories
                if (item.accessories && item.accessories.length > 0) {
                    item.accessories.forEach(acc => {
                        if (acc.accessory_id && acc.accessory_id !== 'none') {
                            itemRecords.push({
                                order_id: selectedOrder.id,
                                product_id: item.product_id,
                                accessory_id: acc.accessory_id,
                                quantity: 0,
                                unit_price: 0,
                                accessory_quantity: acc.accessory_quantity || 1,
                                accessory_unit_price: acc.accessory_unit_price || 0,
                                'DigiCom Business': activeBusinessId
                            });
                        }
                    });
                }
            });

            const { error: itemsError } = await (supabase as any)
                .from('order_items')
                .insert(itemRecords);

            if (itemsError) throw itemsError;

            // 3. Track history if status changed
            if (selectedOrder.order_status_id !== values.order_status_id) {
                let finalComment = values.history_comment || '';

                if (statusCats.isOrderCategory(values.order_status_id, 'postponed') || values.order_status_id === REPORTED_STATUS_ID) {
                    const rDate = (values as any)._reportedDate;
                    if (rDate) {
                        const formattedDate = format(new Date(rDate), 'dd/MM/yyyy HH:mm');
                        finalComment = `[Reporté pour: ${formattedDate}] ${finalComment}`;
                    }
                }

                const { error: historyError } = await (supabase as any)
                    .from('order_status_history')
                    .insert({
                        order_id: selectedOrder.id,
                        status_id: values.order_status_id,
                        comment: finalComment,
                        changed_by: currentUserId,
                        'DigiCom Business': activeBusinessId
                    });
                if (historyError) console.error('History Error:', historyError);
            }

            return { id: selectedOrder.id };
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders-aggregate', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['business-duplicate-phones', activeBusinessId] });
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
            {/* Create Order Modal — MIRROR of Orders.tsx L3719-4921 (create branch only) */}
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
                    className="w-[min(96vw,1180px)] max-w-[1180px] p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)] overflow-hidden flex flex-col h-[min(92dvh,820px)] max-h-[92dvh]"
                >
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit((v) => {
                            const targetStatusId = v.order_status_id;

                            if (
                                orderCompanyIsColiaty(companies, v.company_id) &&
                                v.replace &&
                                !(v.coliaty_old_tracking || '').trim()
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
                                orderCompanyIsAmeex(companies, v.company_id) &&
                                v.replace &&
                                !(v.ameex_old_tracking || '').trim()
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
                                orderCompanyIsQuickLivraison(companies, v.company_id) &&
                                v.replace &&
                                !(v.quicklivraison_old_tracking || '').trim()
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
                                orderCompanyIsForcelog(companies, v.company_id) &&
                                v.replace &&
                                !(v.forcelog_old_tracking || '').trim()
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
                                orderCompanyIsSendit(companies, v.company_id) &&
                                v.replace &&
                                !(v.sendit_old_tracking || '').trim()
                            ) {
                                form.setError('sendit_old_tracking', {
                                    type: 'manual',
                                    message: 'Required for Sendit exchange (delivery_exchange_id).',
                                });
                                toast({
                                    title: 'Missing tracking',
                                    description: 'Enter the previous parcel tracking number (DH...) for Sendit exchange.',
                                    variant: 'destructive',
                                });
                                return;
                            }

                            if (
                                orderCompanyIsDelvoExpress(companies, v.company_id) &&
                                v.replace &&
                                !(v.delvoexpress_old_tracking || '').trim()
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

                            // EDIT ONLY: status transition requires a history comment (seller Orders.tsx L3567-3577).
                            if (
                                isEdit &&
                                editOrderRef.current &&
                                targetStatusId !== editOrderRef.current.order_status_id &&
                                statusRequiresHistoryComment(targetStatusId) &&
                                !v.history_comment?.trim()
                            ) {
                                form.setError('history_comment', { type: 'manual', message: 'Comment is required for this status.' });
                                toast({ title: 'Validation Error', description: 'Please provide a reason for this status.', variant: 'destructive' });
                                return;
                            }

                            // In edit mode an order ALREADY postponed is exempt from re-picking a
                            // reported date; create is never "already postponed".
                            const targetIsPostponed =
                                !!REPORTED_STATUS_ID &&
                                (targetStatusId === REPORTED_STATUS_ID ||
                                    statusCats.isOrderCategory(targetStatusId, 'postponed'));
                            const sourceWasPostponed =
                                isEdit &&
                                !!editOrderRef.current &&
                                (editOrderRef.current.order_status_id === REPORTED_STATUS_ID ||
                                    statusCats.isOrderCategory(editOrderRef.current.order_status_id, 'postponed'));
                            if (targetIsPostponed && !sourceWasPostponed && !(v as { _reportedDate?: string })._reportedDate?.trim()) {
                                toast({
                                    title: 'Reported date required',
                                    description: 'Choose the reported status and pick date/time in the popup before saving.',
                                    variant: 'destructive',
                                });
                                return;
                            }

                            // Zero-stock block is CREATE-only — edit is exempt.
                            if (!isEdit) {
                                for (let i = 0; i < v.items.length; i++) {
                                    const item = v.items[i];
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

                            if (isEdit) updateOrderMutation.mutate(v); else createOrderMutation.mutate(v);
                        })} className="flex flex-col h-full overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange shrink-0" />
                            <DialogHeader className="px-6 pt-4 pb-3.5 pr-12 shrink-0 border-b border-ant-line bg-ant-paper text-left space-y-1">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                    {isEdit ? 'Commande · Modification' : 'Commande · Nouvelle'}
                                </div>
                                <DialogTitle className="font-display text-[18px] font-semibold text-ant-ink tracking-[-0.02em] leading-tight">
                                    {isEdit ? 'Modifier la commande' : 'Nouvelle commande'}
                                </DialogTitle>
                                <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                    Détails client à gauche · lignes produits à droite · notes en bas
                                </DialogDescription>
                            </DialogHeader>

                            <div className="flex flex-1 min-h-0 flex-col xl:flex-row overflow-hidden">
                                <div className="min-w-0 flex-1 flex flex-col gap-4 min-h-0 overflow-y-auto xl:pr-1 px-4 sm:px-5 py-3 custom-scrollbar">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 shrink-0">
                                    {/* Column 1: Customer Data */}
                                    <div className="space-y-3.5">
                                        <h4 className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid pb-2 border-b border-ant-line">
                                            <User className="w-3 h-3" /> Customer
                                        </h4>
                                        <FormField
                                            control={form.control}
                                            name="name"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Full Name</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="Client Name" {...field} className="h-10 rounded-xl border-none bg-ant-ink/[0.04] text-sm font-bold text-ant-ink placeholder:text-ant-ink/30 placeholder:font-medium shadow-inner" />
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
                                                    <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Contact Number</FormLabel>
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
                                                                className={cn("h-10 rounded-xl border-none bg-ant-ink/[0.04] text-sm font-bold text-ant-ink placeholder:text-ant-ink/30 placeholder:font-medium shadow-inner", inputPr)}
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
                                                                                ? "bg-ant-ink text-ant-light shadow-lg shadow-ant-ink/20 scale-105"
                                                                                : "bg-ant-ink/10 text-ant-ink/50 hover:bg-ant-ink/20 hover:text-ant-ink"
                                                                        )}
                                                                    >
                                                                        <BarChart3 className="w-4 h-4" />
                                                                    </button>
                                                                </PopoverTrigger>
                                                                <PopoverContent
                                                                    className="w-[420px] p-4 rounded-2xl border-none shadow-2xl bg-white/95 backdrop-blur-xl"
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
                                                    <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Target City</FormLabel>
                                                    <Popover open={citySearchOpen} onOpenChange={setCitySearchOpen}>
                                                        <PopoverTrigger asChild>
                                                            <FormControl>
                                                                <Button
                                                                    variant="outline"
                                                                    role="combobox"
                                                                    className={cn(
                                                                        "h-10 w-full justify-between rounded-xl border-none bg-ant-ink/[0.04] text-sm text-ant-ink font-bold shadow-inner text-left px-3",
                                                                        !field.value && "text-muted-foreground"
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
                                                    <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Full Address</FormLabel>
                                                    <FormControl>
                                                        <Textarea placeholder="Street, building, floor…" {...field} className="min-h-[72px] rounded-xl border-none bg-ant-ink/[0.04] text-sm font-bold text-ant-ink placeholder:text-ant-ink/30 placeholder:font-medium shadow-inner resize-y p-3 leading-relaxed" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>

                                    {/* Column 2: Logistics & Status */}
                                    <div className="space-y-3.5">
                                        <h4 className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid pb-2 border-b border-ant-line">
                                            <Truck className="w-3 h-3" /> Logistics
                                        </h4>
                                        <FormField
                                            control={form.control}
                                            name="source_name"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Sales Channel</FormLabel>
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <FormControl>
                                                            <SelectTrigger className="h-10 rounded-xl border-none bg-ant-ink/[0.04] text-sm font-bold text-ant-ink shadow-inner">
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
                                                        <SelectContent className="rounded-2xl border-none shadow-2xl">
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
                                                            <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Shipping Provider</FormLabel>
                                                            <Select
                                                                onValueChange={(val) => {
                                                                    const provider = availableProviders.find(p => p.id === val);
                                                                    if (provider?.type === 'courier') {
                                                                        form.setValue('courier_id', val);
                                                                        form.setValue('company_id', null);
                                                                        const fee = courierFees?.find((f: any) => f.courier_id === val && (f.master_city_id === selectedCityId))?.fee;
                                                                        form.setValue('shipping_cost', fee ? Number(fee) : 0);
                                                                    } else {
                                                                        form.setValue('company_id', val);
                                                                        form.setValue('courier_id', null);
                                                                        const fee = companyFees?.find((f: any) => f.company_id === val && (f.master_city_id === selectedCityId))?.fee;
                                                                        form.setValue('shipping_cost', fee ? Number(fee) : 0);
                                                                    }
                                                                }}
                                                                value={field.value || selectedCompanyId || ''}
                                                            >
                                                                <FormControl>
                                                                    <SelectTrigger className="h-10 rounded-xl border-none bg-ant-ink/[0.04] text-sm font-bold text-ant-ink shadow-inner">
                                                                        <SelectValue placeholder="Choose provider..." />
                                                                    </SelectTrigger>
                                                                </FormControl>
                                                                <SelectContent className="rounded-2xl border-none shadow-2xl">
                                                                    {availableProviders.map((p: any) => (
                                                                        <SelectItem key={p.id} value={p.id} className="rounded-xl font-bold">
                                                                            <div className="flex items-center gap-2">
                                                                                {p.type === 'courier' ? (
                                                                                    <UserAvatar url={p.avatar_url} config={(p as any).avatar_config} name={p.name} className="w-5 h-5 rounded-full text-[9px]" />
                                                                                ) : (
                                                                                    resolveProviderLogo(p) ? (
                                                                                        <img src={resolveProviderLogo(p)!} alt="" className="w-5 h-5 rounded-full object-contain bg-white border border-ant-ink/[0.06]" />
                                                                                    ) : (
                                                                                        <span className="w-5 h-5 rounded-full bg-ant-line flex items-center justify-center text-[9px] font-semibold text-ant-ink/60">
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
                                                        <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Shipping Fee</FormLabel>
                                                        <FormControl>
                                                            <div className="relative">
                                                                <Input
                                                                    type="number"
                                                                    {...field}
                                                                    readOnly={shippingFeeReadOnly}
                                                                    className={`h-10 rounded-xl border-none bg-ant-ink/[0.04] text-sm font-bold text-ant-ink shadow-inner pl-3 pr-10 ${shippingFeeReadOnly ? 'cursor-not-allowed opacity-60' : ''}`}
                                                                />
                                                                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        onClick={calculateShippingFee}
                                                                        className="h-6 w-6 text-ant-ink/30 hover:text-ant-ink"
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
                                                    <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Pipeline Stage</FormLabel>
                                                    <Popover open={statusSearchOpen} onOpenChange={setStatusSearchOpen}>
                                                        <PopoverTrigger asChild>
                                                            <FormControl>
                                                                <Button
                                                                    variant="outline"
                                                                    role="combobox"
                                                                    className={cn(
                                                                        "h-10 w-full justify-between rounded-xl border-none bg-ant-ink/[0.04] text-sm text-ant-ink font-bold shadow-inner text-left px-3",
                                                                        !field.value && "text-muted-foreground"
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
                                                                                            statusCats.isOrderCategory(status.id, 'postponed'));
                                                                                    const oldIsPostponed =
                                                                                        !!REPORTED_STATUS_ID &&
                                                                                        (previousId === REPORTED_STATUS_ID ||
                                                                                            statusCats.isOrderCategory(previousId, 'postponed'));

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
                                            <div className="p-3 rounded-xl bg-ant-ink/[0.03] border border-ant-ink/[0.06] flex items-center justify-between gap-3">
                                                <div className="space-y-0.5 min-w-0">
                                                    <FormLabel className="text-xs font-bold text-ant-ink">Exchange order</FormLabel>
                                                    <p className="text-[10px] text-muted-foreground leading-snug">Replacing a previous order?</p>
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
                                            <div className="p-3 rounded-xl bg-ant-ink/[0.03] border border-ant-ink/[0.06] flex items-center justify-between gap-3">
                                                <div className="space-y-0.5 min-w-0">
                                                    <FormLabel className="text-xs font-bold text-ant-ink">Include delivery fees</FormLabel>
                                                    <p className="text-[10px] text-muted-foreground leading-snug">Add shipping to order total</p>
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

                                        {form.watch('replace') &&
                                            orderCompanyIsColiaty(companies, form.watch('company_id')) && (
                                                <FormField
                                                    control={form.control}
                                                    name="coliaty_old_tracking"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-2 rounded-xl border border-amber-200/80 bg-ant-orange/10/40 p-3">
                                                            <FormLabel className="text-[9px] font-bold uppercase tracking-[0.18em] text-ant-ink">
                                                                Previous parcel tracking (Coliaty)
                                                            </FormLabel>
                                                            <p className="text-[10px] text-muted-foreground leading-snug">
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
                                                        <FormItem className="space-y-2 rounded-xl border border-amber-200/80 bg-ant-orange/10/40 p-3">
                                                            <FormLabel className="text-[9px] font-bold uppercase tracking-[0.18em] text-ant-ink">
                                                                Previous parcel tracking (AMEEX)
                                                            </FormLabel>
                                                            <p className="text-[10px] text-muted-foreground leading-snug">
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
                                                        <FormItem className="space-y-2 rounded-xl border border-amber-200/80 bg-ant-orange/10/40 p-3">
                                                            <FormLabel className="text-[9px] font-bold uppercase tracking-[0.18em] text-ant-ink">
                                                                Previous parcel tracking (Quick Livraison)
                                                            </FormLabel>
                                                            <p className="text-[10px] text-muted-foreground leading-snug">
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
                                                        <FormItem className="space-y-2 rounded-xl border border-amber-200/80 bg-ant-orange/10/40 p-3">
                                                            <FormLabel className="text-[9px] font-bold uppercase tracking-[0.18em] text-ant-ink">
                                                                Previous parcel tracking (Forcelog)
                                                            </FormLabel>
                                                            <p className="text-[10px] text-muted-foreground leading-snug">
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
                                                        <FormItem className="space-y-2 rounded-xl border border-amber-200/80 bg-ant-orange/10/40 p-3">
                                                            <FormLabel className="text-[9px] font-bold uppercase tracking-[0.18em] text-ant-ink">
                                                                Previous parcel tracking (Sendit)
                                                            </FormLabel>
                                                            <p className="text-[10px] text-muted-foreground leading-snug">
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
                                                        <FormItem className="space-y-2 rounded-xl border border-amber-200/80 bg-ant-orange/10/40 p-3">
                                                            <FormLabel className="text-[9px] font-bold uppercase tracking-[0.18em] text-ant-ink">
                                                                Previous parcel tracking (Delevo Express)
                                                            </FormLabel>
                                                            <p className="text-[10px] text-muted-foreground leading-snug">
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
                                    </div>
                                </div>

                                <section className="rounded-xl border border-ant-ink/[0.08] bg-ant-ink/[0.02] p-3 sm:p-4 space-y-3 shrink-0">
                                    <div className="space-y-0.5">
                                        <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid flex items-center gap-2">
                                            <MessageSquare className="w-3 h-3 text-ant-ink/45" /> Notes
                                        </h4>
                                        <p className="text-[10px] text-muted-foreground leading-snug">
                                            Internal vs courier-facing. Optional.
                                        </p>
                                    </div>
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                        <FormField
                                            control={form.control}
                                            name="note"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Order Note (Internal)</FormLabel>
                                                    <FormControl>
                                                        <Textarea placeholder="Packaging, gifts…" {...field} className="min-h-[64px] rounded-xl border-none bg-white/90 text-sm font-bold text-ant-ink placeholder:text-ant-ink/30 placeholder:font-medium shadow-inner resize-y p-3 leading-relaxed" />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="delivery_note"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Courier Note (Public)</FormLabel>
                                                    <FormControl>
                                                        <Textarea placeholder="Courier instructions…" {...field} className="min-h-[64px] rounded-xl border-none bg-white/90 text-sm font-bold text-ant-ink placeholder:text-ant-ink/30 placeholder:font-medium shadow-inner resize-y p-3 leading-relaxed" />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </section>
                                    </div>

                                    <aside className="w-full xl:w-[min(26rem,34vw)] xl:max-w-[420px] xl:shrink-0 flex flex-col min-h-0 border-t xl:border-t-0 xl:border-l border-ant-ink/[0.1] bg-ant-ink/[0.03]">
                                    <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2.5 border-b border-ant-ink/[0.08] bg-ant-ink/[0.02]">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="w-8 h-8 rounded-lg bg-ant-ink/10 flex items-center justify-center shrink-0">
                                                <ShoppingBag className="w-4 h-4 text-ant-ink" />
                                            </div>
                                            <div className="min-w-0">
                                                <h4 className="text-[9px] font-bold uppercase tracking-[0.18em] text-ant-ink leading-tight">Order lines</h4>
                                                <p className="text-[9px] text-ant-ink/45 font-medium truncate">Scroll here only</p>
                                            </div>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => append({ product_id: '', quantity: 1, unit_price: 0, accessories: [] })}
                                            className="text-[9px] font-semibold uppercase text-ant-ink border-ant-ink/15 bg-white h-8 px-2.5 gap-1 rounded-lg shrink-0"
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
                                                        <span className="text-[9px] font-semibold uppercase tracking-wider text-ant-ink/35 tabular-nums">Line {index + 1}</span>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => remove(index)}
                                                            disabled={fields.length === 1}
                                                            className="h-7 w-7 rounded-lg text-ant-rose/70 hover:text-ant-rose hover:bg-ant-rose/10 shrink-0"
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
                                                                        formatLabel={(p) => productNameLabel(p)}
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
                                                                                            // order, kept on the first line that carries it.
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
                                                                    <FormLabel className="text-[8px] uppercase font-semibold text-ant-ink/45">Unit</FormLabel>
                                                                    <Input type="number" {...field} disabled={!hasProduct} className="h-9 rounded-lg border border-ant-ink/10 bg-ant-ink/[0.03] text-sm font-bold text-ant-ink text-center px-1" />
                                                                </FormItem>
                                                            )}
                                                        />
                                                        <FormField
                                                            control={form.control}
                                                            name={`items.${index}.quantity`}
                                                            render={({ field }) => (
                                                                <FormItem className="space-y-1">
                                                                    <FormLabel className="text-[8px] uppercase font-semibold text-ant-ink/45">Qty</FormLabel>
                                                                    <Input
                                                                        type="number"
                                                                        {...field}
                                                                        disabled={!hasProduct}
                                                                        onChange={(e) => {
                                                                            field.onChange(e);
                                                                            // Only PER-ITEM accessories scale with product qty
                                                                            // (e.g. venteur default 2 → 4 when qty goes 1→2).
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
                                                        <div className="rounded-lg bg-ant-ink/[0.08] px-1.5 py-1 flex flex-col justify-center items-center text-center">
                                                            <span className="text-[7px] font-semibold uppercase text-ant-ink/50 leading-none">Total</span>
                                                            <span className="text-[12px] font-semibold text-ant-ink tabular-nums leading-tight">{productSubtotal.toFixed(2)} <span className="text-[9px] font-bold text-ant-ink/65">DH</span></span>
                                                        </div>
                                                    </div>

                                                    <div className="rounded-xl bg-ant-ink/[0.04] border border-ant-ink/[0.07] p-2.5 space-y-2">
                                                        <p className="text-[9px] font-semibold uppercase tracking-wider text-ant-ink/35">Add-ons</p>
                                                        {(form.watch(`items.${index}.accessories`) || []).map((acc: any, accIdx: number) => {
                                                            const hasAccessory = !!form.watch(`items.${index}.accessories.${accIdx}.accessory_id`) && form.watch(`items.${index}.accessories.${accIdx}.accessory_id`) !== 'none';

                                                            return (
                                                                <div key={accIdx} className="space-y-2 pb-2 border-b border-ant-ink/[0.08] last:border-0 last:pb-0">
                                                                    <div className="flex gap-2 items-end">
                                                                        <FormField
                                                                            control={form.control}
                                                                            name={`items.${index}.accessories.${accIdx}.accessory_id`}
                                                                            render={({ field }) => (
                                                                                <FormItem className="space-y-1 flex-1 min-w-0">
                                                                                    <FormLabel className="text-[8px] uppercase font-semibold text-ant-ink/45 flex items-center gap-1"><Puzzle className="w-3 h-3 opacity-60" /> Item</FormLabel>
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
                                                                                            <SelectItem value="none" className="rounded-lg font-medium text-muted-foreground text-sm">— None —</SelectItem>
                                                                                            {accessories?.map((a: any) => (
                                                                                                <SelectItem key={a.id} value={a.id} className="rounded-lg font-medium text-sm py-2">
                                                                                                    {a.name} <span className="text-muted-foreground ml-1 text-xs">({a.code})</span>
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
                                                                            className="h-9 w-9 rounded-lg text-ant-rose/70 hover:text-ant-rose hover:bg-ant-rose/10 shrink-0"
                                                                        >
                                                                            <Trash2 className="w-3.5 h-3.5" />
                                                                        </Button>
                                                                    </div>
                                                                    <FormField
                                                                        control={form.control}
                                                                        name={`items.${index}.accessories.${accIdx}.accessory_unit_price`}
                                                                        render={({ field }) => (
                                                                            <input type="hidden" {...field} />
                                                                        )}
                                                                    />
                                                                    <FormField
                                                                        control={form.control}
                                                                        name={`items.${index}.accessories.${accIdx}.accessory_quantity`}
                                                                        render={({ field }) => (
                                                                            <FormItem className="space-y-1 max-w-[140px]">
                                                                                <FormLabel className="text-[8px] uppercase font-semibold text-ant-ink/40">Qty</FormLabel>
                                                                                <Input type="number" {...field} disabled={!hasAccessory} className="h-9 rounded-lg border border-ant-ink/10 bg-white text-sm font-bold text-ant-ink text-center px-1" />
                                                                            </FormItem>
                                                                        )}
                                                                    />
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

                            <DialogFooter className="px-4 py-2.5 sm:px-5 shrink-0 bg-ant-ink/[0.02] border-t border-ant-ink/[0.08] flex flex-row flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-9 h-9 rounded-xl bg-ant-ink flex items-center justify-center text-ant-light shadow-md shrink-0">
                                        <DollarSign className="w-4 h-4" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid leading-none">Total</p>
                                        <p className="text-[15px] font-semibold text-ant-ink tabular-nums leading-tight truncate">
                                            {(form.watch('items').reduce((acc, item) => acc + (item.quantity * item.unit_price), 0) + (form.watch('include_delivery_in_total') !== false ? Number(form.watch('shipping_cost') || 0) : 0)).toFixed(2)} DH
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                    {/* DELTA 2: Annuler DISCARDS the draft (page version only closed). */}
                                    <button
                                        type="button"
                                        onClick={handleDiscard}
                                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light text-[12px] font-semibold text-ant-ink cursor-pointer transition-colors"
                                    >
                                        Annuler
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={
                                            (isEdit ? updateOrderMutation.isPending : createOrderMutation.isPending) ||
                                            newOrderHasZeroStockProduct
                                        }
                                        className="inline-flex items-center gap-2 h-9 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[12px] font-semibold cursor-pointer transition-colors active:scale-[0.99]"
                                    >
                                        {(isEdit ? updateOrderMutation.isPending : createOrderMutation.isPending) && <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.75} />}
                                        {isEdit ? 'Enregistrer les modifications' : 'Confirmer la commande'}
                                    </button>
                                </div>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* Reported Status Data Collection Modal — MIRROR of Orders.tsx L5427-5497 */}
            <Dialog
                open={isReportedModalOpen}
                onOpenChange={(v) => {
                    if (!v) dismissReportedModal(reportedStatusRevertRef.current !== null);
                }}
            >
                <DialogContent className="max-w-[min(100vw-2rem,40rem)] p-0 border border-ant-line bg-white rounded-xl overflow-hidden flex flex-col">
                    <DialogHeader className="p-6 sm:p-8 pb-4 shrink-0 border-b border-ant-ink/[0.05]">
                        <DialogTitle className="text-[15px] font-semibold text-ant-ink">Reported Action</DialogTitle>
                        <DialogDescription className="text-sm font-bold text-muted-foreground">
                            Please provide the scheduled date and time.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="p-6 sm:p-8 flex flex-col md:flex-row gap-6 md:gap-8 md:items-start">
                        <div className="space-y-2 flex flex-col shrink-0 md:max-w-[min(100%,280px)]">
                            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Date</label>
                            <CalendarComponent
                                mode="single"
                                selected={reportedData.date}
                                onSelect={(d) => setReportedData(prev => ({ ...prev, date: d }))}
                                initialFocus
                                className="rounded-xl border border-ant-line bg-ant-light w-full p-2"
                            />
                        </div>
                        <div className="flex flex-col gap-4 flex-1 min-w-0 min-h-0">
                            <div className="space-y-2">
                                <label className="text-[9px] flex font-bold uppercase tracking-[0.18em] text-ant-mid">Time</label>
                                <div className="relative">
                                    <Clock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ant-mid pointer-events-none" />
                                    <Input
                                        type="time"
                                        value={reportedData.time}
                                        onChange={(e) => setReportedData(prev => ({ ...prev, time: e.target.value }))}
                                        className="h-8 pl-9 rounded-md border-ant-line bg-ant-light text-[11px] w-full"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2 flex flex-col flex-1 min-h-[120px]">
                                <label className="text-[9px] flex font-bold uppercase tracking-[0.18em] text-ant-mid">Comment (Optional)</label>
                                <Textarea
                                    value={reportedData.comment}
                                    onChange={(e) => setReportedData(prev => ({ ...prev, comment: e.target.value }))}
                                    placeholder="Add a note why it was reported..."
                                    className="resize-none rounded-xl border-ant-line bg-ant-light text-[11px] flex-1 min-h-[120px] md:min-h-[200px]"
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter className="p-8 pt-4 border-t border-ant-ink/[0.05] bg-ant-ink/[0.01]">
                        <Button
                            variant="ghost"
                            onClick={() => dismissReportedModal(true)}
                            className="h-8 rounded-md text-[11px] font-semibold"
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
                            className="bg-ant-ink text-white hover:bg-ant-ink/90 h-8 rounded-md text-[11px] font-semibold px-4"
                        >
                            Confirm Action
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

export default SellerChatCartOrderDialog;
