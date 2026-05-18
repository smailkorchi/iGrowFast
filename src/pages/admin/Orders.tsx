import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { matchPackageStatus } from '@/lib/matchPackageStatus';
import {
    Plus,
    Search,
    MoreVertical,
    Edit2,
    Trash2,
    Loader2,
    Package,
    Phone,
    MapPin,
    Calendar,
    ShoppingCart,
    CheckCircle2,
    XCircle,
    Clock,
    DollarSign,
    PlusCircle,
    X,
    Eye,
    Truck,
    Hash,
    MessageSquare,
    ChevronDown,
    MapPinned,
    ExternalLink,
    RefreshCcw,
    User,
    Filter,
    Building2,
    LayoutGrid,
    List,
    ShoppingBag,
    ShieldCheck,
    BarChart3,
    Puzzle,
    SearchX,
    BarChart2,
    Users,
    RefreshCw,
    CalendarClock,
    Info
} from 'lucide-react';
import {
    Card,
    CardContent
} from '@/components/ui/card';
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
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
    FormDescription
} from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn } from '@/lib/utils';
import { orderMatchesTopSearch } from '@/lib/orderSearch';
import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, subMonths, isWithinInterval } from 'date-fns';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import type { DateRange } from 'react-day-picker';
import CustomerInsights from '@/components/CustomerInsights';
import {
    OrderPhoneQuickActions,
    OrderPhoneContactDropdown,
    OrderContactSubmenu,
} from '@/components/orders/OrderPhoneQuickActions';
import { ParcelTrackingDialog } from '@/components/orders/ParcelTrackingDialog';
import { WebhookHealthIndicator } from '@/components/orders/WebhookHealthIndicator';
import { getLatestTrackableCompanyParcel } from '@/lib/orders/getLatestTrackableCompanyParcel';
import { OrderStatusHistoryDialog } from '@/components/orders/OrderStatusHistoryDialog';
import OrdersListView from '@/components/orders/OrdersListView';
import QuickStatusChangeModal from '@/components/orders/QuickStatusChangeModal';
import { DynamicIcon } from '@/lib/renderReactIcon';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Separator } from "@/components/ui/separator";
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
import { Check, ChevronsUpDown } from "lucide-react";
import { buildOrderItemRecords, type OrderLineForRecords, type ProductAccessoryRow } from '@/lib/buildOrderItemRecords';
import { statusRequiresHistoryComment } from '@/lib/orderHistoryCommentPolicy';
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
    OrderLineProductCombobox,
    OrderLineProductStockHint,
    toProductStockNumber,
    type OrderLineProductOption,
} from '@/components/orders/OrderLineProductCombobox';
import SourceIcon, { getSourceMeta } from '@/components/orders/SourceIcon';
import { ImageHoverPreview } from '@/components/catalog/ImageHoverPreview';

// --- Schemas ---
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
    delivery_type: z.string().optional(),
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

function orderCompanyIsVitex(
    companies: { id: string; provider_type?: string | null }[] | undefined,
    companyId: string | null | undefined
) {
    if (!companyId || !companies?.length) return false;
    const row = companies.find((c) => c.id === companyId);
    const t = String(row?.provider_type || '').toLowerCase();
    return t === 'vitex' || t.includes('vitex');
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

function toOrderLineForRecords(item: OrderFormValues['items'][number]): OrderLineForRecords {
    return {
        product_id: item.product_id ?? null,
        quantity: item.quantity ?? 0,
        unit_price: item.unit_price ?? 0,
        accessories: item.accessories ?? [],
    };
}

function orderMatchesTrackingFilter(order: any, raw: string): boolean {
    const needle = raw.trim().toLowerCase().replace(/\s+/g, '');
    if (!needle) return true;
    const codes: string[] = [];
    if (order?.tracking_number) codes.push(String(order.tracking_number));
    if (order?.coliaty_old_tracking) codes.push(String(order.coliaty_old_tracking));
    if (order?.ameex_old_tracking) codes.push(String(order.ameex_old_tracking));
    if (order?.quicklivraison_old_tracking) codes.push(String(order.quicklivraison_old_tracking));
    if (order?.forcelog_old_tracking) codes.push(String(order.forcelog_old_tracking));
    if (order?.sendit_old_tracking) codes.push(String(order.sendit_old_tracking));
    if (order?.delvoexpress_old_tracking) codes.push(String(order.delvoexpress_old_tracking));
    for (const p of order?.parcels || []) {
        if (p?.tracking_code && p?.company_delivery_note_id) codes.push(String(p.tracking_code));
    }
    for (const p of order?.courier_parcels || []) {
        if (p?.tracking_code && p?.courier_delivery_note_id) codes.push(String(p.tracking_code));
    }
    return codes.some((c) => c.toLowerCase().replace(/\s+/g, '').includes(needle));
}

const SALES_SOURCES = [
    "whatsapp",
    "facebook",
    "instagram",
    "tiktok",
    "phone call",
    "connaissance",
    "reorder",
    "other"
];

/**
 * Compact filter-bar dropdown. Replaces the old <Select> + <SelectItem> setup
 * with a searchable Popover+Command combo so users can type to narrow long
 * lists (cities, products, users, providers) and can see per-row visuals
 * (product image, provider logo, user avatar, source icon). Trigger styling
 * matches the rest of the filter bar — pass `activeClass` for the colored
 * border/background applied when the value isn't `'all'`.
 */
type SearchableFilterProps<T> = {
    value: string;
    onChange: (v: string) => void;
    allLabel: string;
    placeholder: string;
    activeClass: string;
    items: T[] | null | undefined;
    getKey: (item: T) => string;
    getSearchText: (item: T) => string;
    getTriggerLabel: () => React.ReactNode;
    renderItem: (item: T) => React.ReactNode;
};

function SearchableFilter<T>({
    value,
    onChange,
    allLabel,
    placeholder,
    activeClass,
    items,
    getKey,
    getSearchText,
    getTriggerLabel,
    renderItem,
}: SearchableFilterProps<T>) {
    const [open, setOpen] = useState(false);
    const isActive = value !== 'all';
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        'h-10 w-full rounded-xl text-xs font-bold transition-all flex items-center justify-between gap-2 px-3 border',
                        isActive
                            ? activeClass
                            : 'border-ant-line bg-ant-paper text-ant-ink',
                    )}
                >
                    <span className="flex-1 text-left truncate">{getTriggerLabel()}</span>
                    <ChevronsUpDown className="w-3 h-3 text-ant-mid shrink-0" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[240px] rounded-2xl border-ant-line bg-ant-paper shadow-[0_12px_40px_-20px_rgba(20,20,19,0.3)]"
            >
                <Command
                    filter={(itemValue, search) => {
                        // `itemValue` is the `value` prop we set on each
                        // CommandItem — we pack the searchable text there so
                        // cmdk's fuzzy match operates on human text, not UUIDs.
                        const t = itemValue.toLowerCase();
                        return t.includes(search.toLowerCase()) ? 1 : 0;
                    }}
                >
                    <CommandInput placeholder={placeholder} className="h-9" />
                    <CommandList className="max-h-[280px]">
                        <CommandEmpty className="py-4 text-[11px] text-ant-mid text-center">No matches</CommandEmpty>
                        <CommandGroup>
                            <CommandItem
                                value="__all__"
                                onSelect={() => {
                                    onChange('all');
                                    setOpen(false);
                                }}
                                className="font-bold text-[11.5px] rounded-lg cursor-pointer"
                            >
                                <span className="flex-1">{allLabel}</span>
                                {value === 'all' && <Check className="w-3.5 h-3.5 text-ant-orange ml-2" />}
                            </CommandItem>
                            {(items ?? []).map((item) => {
                                const key = getKey(item);
                                return (
                                    <CommandItem
                                        key={key}
                                        value={`${getSearchText(item)} ${key}`}
                                        onSelect={() => {
                                            onChange(key);
                                            setOpen(false);
                                        }}
                                        className="text-[11.5px] font-semibold rounded-lg cursor-pointer"
                                    >
                                        <span className="flex-1 min-w-0">{renderItem(item)}</span>
                                        {value === key && <Check className="w-3.5 h-3.5 text-ant-orange ml-2 shrink-0" />}
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

/**
 * For courier (internal) orders the package status lives on the latest
 * courier_parcels row, not on orders.package_status_id. Picks the most recent
 * parcel that has a status_label and returns it in the same shape the badge
 * renderer expects.
 */
function getCourierPackageStatus(order: any): { label: string; color: string | null } | null {
    const courierParcels = (order?.courier_parcels || []) as Array<{
        status_label?: string | null;
        status_color?: string | null;
        created_at?: string | null;
    }>;
    if (!courierParcels.length) return null;
    const sorted = [...courierParcels].sort(
        (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
    );
    const latest = sorted.find((p) => p.status_label && String(p.status_label).trim());
    if (!latest) return null;
    return { label: String(latest.status_label).trim(), color: latest.status_color || null };
}

const Orders = () => {
    const location = useLocation();
    // navState may carry either a single status id (legacy) or an array of ids
    // (category-wide filter from dashboard KPI cards). Typed loose to keep the
    // existing string-keyed reads (filterCity, filterSource, …) intact.
    const navState = (location.state || {}) as Record<string, string | string[]>;
    const [searchParams, setSearchParams] = useSearchParams();
    const prefillProductHandledRef = useRef<string | null>(null);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
    const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
    const [isAttributionModalOpen, setIsAttributionModalOpen] = useState(false);
    const [isBulkStatusModalOpen, setIsBulkStatusModalOpen] = useState(false);
    const [bulkStatusComment, setBulkStatusComment] = useState("");
    const [bulkCommentSectionVisible, setBulkCommentSectionVisible] = useState(false);
    const [sellerSearchQuery, setSellerSearchQuery] = useState("");

    // Quick Status Change Modal States
    const [quickStatusOrder, setQuickStatusOrder] = useState<any>(null);
    const [isQuickStatusOpen, setIsQuickStatusOpen] = useState(false);

    // Reported Modal States
    const [isReportedModalOpen, setIsReportedModalOpen] = useState(false);
    const [reportedData, setReportedData] = useState<{ date: Date | undefined, time: string, comment: string }>({ date: undefined, time: "12:00", comment: "" });
    const [pendingReportedAction, setPendingReportedAction] = useState<((date: Date, time: string, comment: string) => void) | null>(null);
    const reportedStatusRevertRef = useRef<string | null>(null);
    const { getOrderByCategory, isOrderCategory } = useStatusCategories();
    const REPORTED_STATUS_ID = getOrderByCategory('postponed')?.id;
    const defaultNewOrderStatusId = getOrderByCategory('new')?.id ?? '';

    // Parcel Tracking States
    const [orderParcel, setOrderParcel] = useState<any>(null);
    const [trackingHistory, setTrackingHistory] = useState<any>(null);
    const [isTrackingLoading, setIsTrackingLoading] = useState(false);
    const [isParcelLoading, setIsParcelLoading] = useState(false);

    const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provider-integration`;

    // Dropdown search states
    const [citySearchOpen, setCitySearchOpen] = useState(false);
    const cityListRef = useRef<HTMLDivElement>(null);
    const [statusSearchOpen, setStatusSearchOpen] = useState(false);

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // Filter states (initialized from navigation state if present).
    // navState values may be string (legacy) or string[] (category-wide, from
    // dashboard KPI cards). The helpers below extract each type safely.
    const navStr = (v: string | string[] | undefined): string | undefined =>
        typeof v === 'string' ? v : undefined;
    const navArr = (v: string | string[] | undefined): string[] | null =>
        Array.isArray(v) && v.length > 0 ? v : null;

    const [filterStatus, setFilterStatus] = useState<string>(navStr(navState.filterStatus) || "all");
    // Category-wide status filter — when set, `filterStatus` must be 'all' and
    // any order whose status falls in this id list matches. Cleared whenever
    // the user picks a specific status from the dropdown.
    const [filterStatusIds, setFilterStatusIds] = useState<string[] | null>(
        navStr(navState.filterStatus) ? null : navArr(navState.filterStatusIds)
    );
    const [filterStatusLabel, setFilterStatusLabel] = useState<string | null>(
        navStr(navState.filterStatusLabel) || null
    );
    const [filterCity, setFilterCity] = useState<string>(navStr(navState.filterCity) || "all");
    const [filterSource, setFilterSource] = useState<string>(navStr(navState.filterSource) || "all");
    const [filterProvider, setFilterProvider] = useState<string>(navStr(navState.filterProvider) || "all");

    // Advanced filter states
    const [filterDateField, setFilterDateField] = useState<string>('date');
    const [filterTimeRange, setFilterTimeRange] = useState<string>('all');
    const [filterCustomRange, setFilterCustomRange] = useState<DateRange | undefined>(undefined);
    const [calendarRange, setCalendarRange] = useState<DateRange | undefined>(undefined);
    const [hoveredCalendarDate, setHoveredCalendarDate] = useState<Date | undefined>(undefined);
    const calendarPreviewRange = calendarRange?.from && !calendarRange.to && hoveredCalendarDate
        ? (hoveredCalendarDate.getTime() >= calendarRange.from.getTime()
            ? { from: calendarRange.from, to: hoveredCalendarDate }
            : { from: hoveredCalendarDate, to: calendarRange.from })
        : undefined;
    const handleCustomRangeSelect = (range: DateRange | undefined) => {
        // Click on the already-active single day -> clear filter.
        if (
            calendarRange?.from &&
            !calendarRange.to &&
            range?.from &&
            range.to &&
            range.from.getTime() === range.to.getTime() &&
            range.from.getTime() === calendarRange.from.getTime()
        ) {
            setCalendarRange(undefined);
            setFilterCustomRange(undefined);
            return;
        }
        if (range?.from && range.to) {
            setCalendarRange(range);
            setFilterCustomRange(range);
            return;
        }
        if (range?.from && !range.to) {
            setCalendarRange({ from: range.from, to: undefined });
            setFilterCustomRange({ from: range.from, to: range.from });
            return;
        }
        setCalendarRange(undefined);
        setFilterCustomRange(undefined);
    };
    const [showCalendar, setShowCalendar] = useState(false);
    const [filterCustomerName, setFilterCustomerName] = useState('');
    const [filterPhone, setFilterPhone] = useState('');
    const [filterTracking, setFilterTracking] = useState('');
    const [filterProduct, setFilterProduct] = useState<string>('all');
    const [filterPackageStatus, setFilterPackageStatus] = useState<string>(navStr(navState.filterPackageStatus) || 'all');
    const [filterPackageStatusIds, setFilterPackageStatusIds] = useState<string[] | null>(
        navStr(navState.filterPackageStatus) ? null : navArr(navState.filterPackageStatusIds)
    );
    const [filterPackageStatusLabel, setFilterPackageStatusLabel] = useState<string | null>(
        navStr(navState.filterPackageStatusLabel) || null
    );
    const [filterConfirmedBy, setFilterConfirmedBy] = useState<string>('all');
    const [filterAssignedTo, setFilterAssignedTo] = useState<string>('all');
    const [filterExchange, setFilterExchange] = useState<string>('all');
    // Server-side pagination. The query fetches only the visible page; filters
    // operate over the loaded subset, so users wanting to search across
    // history should bump pageSize up to 500 or 1000.
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState<100 | 500 | 1000>(100);
    const [showAllFilters, setShowAllFilters] = useState(false);
    const [showCustomerInsights, setShowCustomerInsights] = useState(false);
    const [isAttributionOpen, setIsAttributionOpen] = useState(false);
    const [orderPendingDelete, setOrderPendingDelete] = useState<{ id: string; name: string } | null>(null);
    const [parcelTrackingOpen, setParcelTrackingOpen] = useState(false);
    const [parcelTrackingOrderId, setParcelTrackingOrderId] = useState<string | null>(null);
    const [historyDialogOrder, setHistoryDialogOrder] = useState<any>(null);

    // Add custom scrollbar styles to head
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
            @keyframes pulse-subtle {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.8; transform: scale(1.02); }
            }
            .animate-pulse-subtle {
                animation: pulse-subtle 3s cubic-bezier(0.4, 0, 0.6, 1) infinite;
            }
        `;
        document.head.appendChild(style);
        return () => { document.head.removeChild(style); };
    }, []);

    // --- Realtime: refresh the orders query when webhooks write status updates.
    // The user-visible toast lives in the global OrderStatusNotifications component
    // (mounted in AppLayout) so it fires regardless of which page is open. This
    // subscription only handles cache invalidation for the current page.
    useEffect(() => {
        if (!activeBusinessId) return;

        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        const debouncedInvalidate = () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ['orders-aggregate', activeBusinessId] });
            }, 500);
        };

        const channel = supabase
            .channel(`orders-cache-invalidate-${activeBusinessId}`)
            .on(
                'postgres_changes' as any,
                { event: 'UPDATE', schema: 'public', table: 'orders' },
                () => { debouncedInvalidate(); }
            )
            .on(
                'postgres_changes' as any,
                { event: 'INSERT', schema: 'public', table: 'orders' },
                () => { debouncedInvalidate(); }
            )
            .subscribe();

        return () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            supabase.removeChannel(channel);
        };
    }, [activeBusinessId, queryClient]);

    // Fetch parcel data and tracking when view modal opens
    useEffect(() => {
        if (!isViewModalOpen || !selectedOrder) {
            setOrderParcel(null);
            setTrackingHistory(null);
            return;
        }

        const fetchParcelAndTrack = async () => {
            setIsParcelLoading(true);
            setOrderParcel(null);
            setTrackingHistory(null);

            try {
                const { data: parcel } = await supabase
                    .from('company_parcels')
                    .select('*, provider:providers(id, name, provider_type, logo_url)')
                    .eq('order_id', selectedOrder.id)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (parcel) {
                    setOrderParcel(parcel);
                    if (parcel.tracking_code && parcel.provider_id) {
                        await handleTrackParcel(parcel);
                    }
                    return;
                }

                // Fallback: courier parcel (internal — no edge function call).
                const { data: courierParcel } = await (supabase as any)
                    .from('courier_parcels')
                    .select('*, courier:users!courier_parcels_courier_id_fkey(id, name, phone, avatar_url)')
                    .eq('order_id', selectedOrder.id)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (courierParcel) {
                    setOrderParcel({
                        ...courierParcel,
                        provider: {
                            id: courierParcel.courier?.id,
                            name: courierParcel.courier?.name || 'Coursier',
                            provider_type: 'courier',
                            logo_url: courierParcel.courier?.avatar_url || null,
                        },
                        _isCourierParcel: true,
                    });

                    if (courierParcel.tracking_code) {
                        const courierName = courierParcel.courier?.name || 'Coursier';
                        const courierPhone = courierParcel.courier?.phone || '';
                        setTrackingHistory({
                            statusLabel: courierParcel.status_label || 'Nouveau',
                            statusColor: courierParcel.status_color || '#3b82f6',
                            history: [
                                {
                                    status: courierParcel.status_label || 'Nouveau',
                                    statusLabel: courierParcel.status_label || 'Nouveau',
                                    date: courierParcel.created_at || null,
                                    comment: 'Colis créé en interne et confié à ' + courierName,
                                    color: courierParcel.status_color || '#3b82f6',
                                    user: courierName,
                                    phone: courierPhone,
                                },
                            ],
                        });
                    }
                }
            } catch (err) {
                console.error('Error fetching parcel:', err);
            } finally {
                setIsParcelLoading(false);
            }
        };

        fetchParcelAndTrack();
    }, [isViewModalOpen, selectedOrder?.id]);

    // Track parcel via edge function (or synthesise for internal courier parcels)
    const handleTrackParcel = async (parcel: any) => {
        setIsTrackingLoading(true);
        setTrackingHistory(null);

        // Internal courier parcels: no edge function — just refresh from DB.
        if (parcel?._isCourierParcel || (!parcel?.provider_id && parcel?.courier_id)) {
            try {
                const { data: fresh } = await (supabase as any)
                    .from('courier_parcels')
                    .select('id, tracking_code, status_label, status_color, status_id, created_at, courier:users!courier_parcels_courier_id_fkey(id, name, phone)')
                    .eq('id', parcel.id)
                    .maybeSingle();

                const courierName = fresh?.courier?.name || parcel.courier?.name || 'Coursier';
                const courierPhone = fresh?.courier?.phone || parcel.courier?.phone || '';

                setTrackingHistory({
                    statusLabel: fresh?.status_label || parcel.status_label || 'Nouveau',
                    statusColor: fresh?.status_color || parcel.status_color || '#3b82f6',
                    history: [
                        {
                            status: fresh?.status_label || parcel.status_label || 'Nouveau',
                            statusLabel: fresh?.status_label || parcel.status_label || 'Nouveau',
                            date: fresh?.created_at || parcel.created_at || null,
                            comment: 'Colis créé en interne et confié à ' + courierName,
                            color: fresh?.status_color || parcel.status_color || '#3b82f6',
                            user: courierName,
                            phone: courierPhone,
                        },
                    ],
                });
            } catch (e) {
                console.error('[track] internal courier refresh failed', e);
            } finally {
                setIsTrackingLoading(false);
            }
            return;
        }

        try {
            const { data: { session } } = await supabase.auth.getSession();
            let response = await fetch(EDGE_FUNCTION_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`
                },
                body: JSON.stringify({
                    action: 'track_parcel',
                    provider_id: parcel.provider_id,
                    data: {
                        tracking_code: parcel.tracking_code,
                        external_id: parcel.external_id
                    }
                })
            });

            const isError = !response.ok;
            let result = isError ? null : await response.json();

            // Fallback to get_parcel_info if track_parcel fails (e.g. Coliaty 404 for history)
            if (isError || !result?.success) {
                console.log("track_parcel failed, attempting get_parcel_info fallback...");
                response = await fetch(EDGE_FUNCTION_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session?.access_token}`
                    },
                    body: JSON.stringify({
                        action: 'get_parcel_info',
                        provider_id: parcel.provider_id,
                        data: {
                            tracking_code: parcel.tracking_code
                        }
                    })
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({ error: 'Failed to fetch tracking data' }));
                    throw new Error(errData.error || `Error ${response.status}`);
                }

                result = await response.json();

                // Process fallback result into expected history format
                if (result.success && result.data && !result.data.history && !Array.isArray(result.data)) {
                    result.data.history = [{
                        status: result.data.status,
                        statusLabel: result.data.statusLabel || result.data.status,
                        date: result.data.date || new Date().toISOString(),
                        comment: result.data.comment || 'Statut actuel (historique indisponible)',
                        user: 'Synchronisation Coliaty/Provider'
                    }];
                }
            }

            if (result && result.success) {
                setTrackingHistory(result.data);

                const providerStatus = result.data?.statusLabel || result.data?.status || result.data?.current_status;
                const providerColor = result.data?.statusColor || result.data?.color;

                if (providerStatus) {
                    const matched = await matchPackageStatus(supabase, providerStatus);
                    await supabase
                        .from('company_parcels')
                        .update({
                            status_id: matched?.id ?? null,
                            status_label: matched?.label ?? providerStatus,
                            status_color: matched?.color ?? providerColor ?? null,
                        })
                        .eq('id', parcel.id);
                }

                queryClient.invalidateQueries({ queryKey: ['orders-aggregate'] });
            } else {
                throw new Error(result?.error || 'Unknown error');
            }
        } catch (error) {
            console.error('handleTrackParcel error:', error);
            toast({
                title: "Tracking Error",
                description: error.message,
                variant: "destructive"
            });
        } finally {
            setIsTrackingLoading(false);
        }
    };

    // --- Queries ---


    // Single source of truth: ONE query pulls every order this business owns
    // (with the joins needed for filters, KPIs and the list view). Pagination
    // is then a pure client-side slice of the filtered aggregate (see
    // `filteredOrders` below). `history` is the only heavy join we skip — it
    // gets lazy-fetched per-order when the detail modal opens.
    const { data: aggregateOrders = [], isLoading: aggregateLoading } = useQuery<any[]>({
        queryKey: ['orders-aggregate', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('orders')
                .select(`
                    *,
                    status:order_statuses(*),
                    package_status:package_statuses(*),
                    city:master_cities(id, name),
                    courier:users!orders_courier_id_fkey(id, name, avatar_url),
                    assignee:users!orders_assign_id_fkey(id, name, avatar_url),
                    company:providers(id, name, logo_url),
                    items:order_items(*, product:products(name, code, image_url), accessory:accessories(name, code, image_url)),
                    parcels:company_parcels(id, tracking_code, external_id, provider_id, status_label, status_color, created_at, company_delivery_note_id, provider:providers(id, name, logo_url)),
                    courier_parcels(id, tracking_code, status_label, status_color, created_at, courier_delivery_note_id)
                `)
                .eq('DigiCom Business', activeBusinessId)
                .is('date_deleted', null)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return data || [];
        },
        enabled: !!activeBusinessId,
        staleTime: 60 * 1000,
    });

    // Back-compat aliases — every existing reader of `orders` / `isLoading`
    // keeps working, but now sees the full business set. Treat the pre-auth
    // window (no `activeBusinessId` yet) as loading so we don't flash an
    // empty-state card before the React Query is even enabled.
    const orders = aggregateOrders;
    const isLoading = aggregateLoading || !activeBusinessId;

    // History is the only join we left out of the aggregate (heavy + only
    // needed by the detail modal). Lazy-fetch it when the modal opens.
    const { data: selectedOrderHistory = [] } = useQuery<any[]>({
        queryKey: ['order-history', selectedOrder?.id],
        queryFn: async () => {
            if (!selectedOrder?.id) return [];
            const { data, error } = await (supabase as any)
                .from('order_status_history')
                .select('*, user:users!changed_by(name, avatar_url), status:order_statuses!status_id(*)')
                .eq('order_id', selectedOrder.id)
                .order('created_at', { ascending: true });
            if (error) throw error;
            return data || [];
        },
        enabled: !!selectedOrder?.id && isViewModalOpen,
        staleTime: 30 * 1000,
    });


    // Package statuses for timeline color/icon matching
    const { data: pkgStatusesForTimeline } = useQuery({
        queryKey: ['package-statuses-timeline'],
        queryFn: async () => {
            const { data } = await supabase.from('package_statuses').select('id, code, label, color, icon, delivery_service_statuses').eq('active', true);
            return data || [];
        },
        staleTime: 5 * 60 * 1000,
    });
    // Order statuses for icon lookup in status history
    const { data: ordStatusesForTimeline } = useQuery({
        queryKey: ['order-statuses-timeline'],
        queryFn: async () => {
            const { data } = await supabase.from('order_statuses').select('id, icon').eq('active', true);
            return data || [];
        },
        staleTime: 5 * 60 * 1000,
    });
    const getOrdIcon = (statusId: string | null): string | null => {
        if (!statusId || !ordStatusesForTimeline?.length) return null;
        return (ordStatusesForTimeline as any[]).find((s: any) => s.id === statusId)?.icon || null;
    };
    const matchPkgColor = (rawStatus: string, statusLabel?: string): { color: string; icon: string | null } => {
        const fallback = { color: '#94a3b8', icon: null };
        if (!pkgStatusesForTimeline?.length) return fallback;
        const candidates = [statusLabel, rawStatus].filter(Boolean) as string[];
        for (const c of candidates) {
            const lower = c.toLowerCase();
            const m = pkgStatusesForTimeline.find((ps: any) => ps.delivery_service_statuses?.some((d: string) => d.toLowerCase() === lower)) ||
                      pkgStatusesForTimeline.find((ps: any) => ps.label?.toLowerCase() === lower) ||
                      pkgStatusesForTimeline.find((ps: any) => ps.code?.toLowerCase() === lower);
            if (m) return { color: m.color || '#94a3b8', icon: m.icon || null };
        }
        return fallback;
    };

    const { data: cities } = useQuery({
        queryKey: ['cities-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            return fetchAllRows<{ id: string; name: string; zone_id: string | null }>('master_cities', 'id, name, zone_id', { orderBy: 'name' });
        },
    });

    // Business identity — used to label history rows on whatsapp-source orders
    // (where changed_by is NULL because no user took the action; the business
    // itself, via the AI assistant, did).
    const { data: businessIdentity } = useQuery({
        queryKey: ['business-identity', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return null;
            const { data, error } = await (supabase as any)
                .from('businesses')
                .select('id, name, logo')
                .eq('id', activeBusinessId)
                .maybeSingle();
            if (error) throw error;
            return data as { id: string; name: string | null; logo: string | null } | null;
        },
        enabled: !!activeBusinessId,
    });

    const { data: couriers } = useQuery({
        queryKey: ['couriers-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, avatar_url')
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
            const { data, error } = await (supabase as any)
                .from('courier_fees')
                .select('*')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: companyFees } = useQuery({
        queryKey: ['company-fees-all', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('company_fees')
                .select('*')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: providerCities } = useQuery({
        queryKey: ['provider-cities-all'],
        queryFn: async () => {
            const { data, error } = await (supabase as any)
                .from('provider_cities')
                .select('master_city_id, provider_type, fees');
            if (error) throw error;
            return data as { master_city_id: string; provider_type: string; fees: { delivered?: number; refused?: number; returned?: number } | null }[];
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

    const orderStatusesForModal = useMemo(() => {
        if (!orderStatuses?.length) return [];
        const list = orderStatuses as any[];
        let eligible = list.filter((s) => s.show_in_order !== false);
        const sid = selectedOrder?.order_status_id;
        if (sid && !eligible.some((s) => s.id === sid)) {
            const cur = list.find((s) => s.id === sid);
            if (cur) eligible = [cur, ...eligible];
        }
        if (
            defaultNewOrderStatusId &&
            !eligible.some((s) => s.id === defaultNewOrderStatusId)
        ) {
            const def = list.find((s) => s.id === defaultNewOrderStatusId);
            if (def) eligible = [def, ...eligible];
        }
        return eligible;
    }, [orderStatuses, selectedOrder?.order_status_id, defaultNewOrderStatusId]);

    const orderStatusesForQuickStatus = useMemo(() => {
        if (!orderStatuses?.length) return [];
        const list = orderStatuses as any[];
        return list.filter((s) => s.show_in_quick_status !== false);
    }, [orderStatuses]);

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
                .select('id, name, code, cost_price')
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
                .select('product_id, accessory_id, default_quantity, created_at')
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

    // The ?addProductId=<uuid> prefill effect lives below the `form` declaration to
    // avoid a temporal-dead-zone reference when React evaluates the effect deps array.

    const { data: packageStatuses } = useQuery({
        queryKey: ['package-statuses-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('package_statuses')
                .select('id, code, label, color')
                .eq('active', true)
                .order('ranking', { ascending: true });
            if (error) throw error;
            return data;
        },
    });

    const { data: confirmers } = useQuery({
        queryKey: ['confirmers-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, avatar_url')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: sellers } = useQuery({
        // v2 key: schema expanded to include `assignment` (required by the attribution widget).
        // Bumping the key ensures any cached v1 response (without assignment) is replaced.
        queryKey: ['sellers-commercial-v2', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, avatar_url, role, assignment')
                .eq('role', 'commercial')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    // Attribution Progress — computed from the FULL business aggregate so
    // "today's assigned" reflects every order this business owns today, not
    // just the rows on the current page. (The previous RPC approach had a
    // parameter bug that silently returned []; deriving from known-good
    // in-memory data removes that whole failure mode.)
    const isAttributionFetching = false;
    const refetchAttribution = () => { /* no-op: derived state updates automatically */ };
    const attributionProgress = useMemo(() => {
        if (!sellers || sellers.length === 0) return [];
        const today = format(new Date(), 'yyyy-MM-dd');
        const ordersList = (aggregateOrders || []) as Array<{ seller_id?: string | null; assignment_date?: string | null; date?: string | null }>;
        return sellers
            .filter((s: { assignment?: number | null }) => Number(s.assignment || 0) > 0)
            .map((s: { id: string; name: string; avatar_url: string | null; assignment: number | null }) => {
                const assignment = Number(s.assignment || 0);
                const ordersToday = ordersList.filter(o => {
                    if (o.seller_id !== s.id) return false;
                    const raw = o.assignment_date || o.date;
                    if (!raw) return false;
                    return String(raw).slice(0, 10) === today;
                }).length;
                const pctComplete = assignment > 0 ? Math.min(100, Math.round((ordersToday / assignment) * 100 * 10) / 10) : 0;
                return {
                    seller_id: s.id,
                    seller_name: s.name,
                    assignment,
                    orders_today: ordersToday,
                    pct_complete: pctComplete,
                    is_full: ordersToday >= assignment,
                    credit: 0,
                };
            });
    }, [sellers, aggregateOrders]);

    // Total attribution stats — unassigned count must span every order in the
    // business, not just the current page.
    const attributionTotals = useMemo(() => {
        if (!attributionProgress?.length) return { totalQuota: 0, totalAssigned: 0, totalPct: 0, unassigned: 0 };
        const totalQuota = attributionProgress.reduce((a, s) => a + Number(s.assignment), 0);
        const totalAssigned = attributionProgress.reduce((a, s) => a + Number(s.orders_today), 0);
        const totalPct = totalQuota > 0 ? Math.round(totalAssigned / totalQuota * 100) : 0;
        const unassigned = (aggregateOrders?.filter((o: any) => !o.seller_id).length) || 0;
        return { totalQuota, totalAssigned, totalPct, unassigned };
    }, [attributionProgress, aggregateOrders]);

    // Mutation: manually trigger reattribution of unassigned orders
    const reattributeMutation = useMutation({
        mutationFn: async () => {
            if (!activeBusinessId) throw new Error('No business');
            const { data, error } = await (supabase as any)
                .rpc('reattribute_unassigned_orders', { p_business_id: activeBusinessId });
            if (error) throw error;
            return data as number;
        },
        onSuccess: (count) => {
            queryClient.invalidateQueries({ queryKey: ['orders-aggregate', activeBusinessId] });
            refetchAttribution();
            toast({ title: `${count} orders attributed`, description: 'Unassigned orders have been distributed among sellers.' });
        },
        onError: (error: any) => {
            toast({ title: 'Attribution Error', description: error.message, variant: 'destructive' });
        }
    });

    // --- Form ---
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
            delivery_type: 'Home Delivery',
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

    const watchedOrderItems = useWatch({ control: form.control, name: 'items' });

    // ?view=<orderId> — opens the order preview modal. Used by the global
    // OrderStatusNotifications toast (clicked from any page) to deep-link into
    // the order it just announced. Cleans the param after handling so a refresh
    // doesn't re-open the modal. The handled-ref is reset whenever the param is
    // absent so a second toast for the same order still opens the modal.
    // If the order isn't in the cached `orders` list (e.g. filtered out by a date
    // range, or trashed, or simply not yet loaded after a fresh navigation), we
    // fall back to a direct fetch that mirrors the main query's joins so the modal
    // can still open with everything it needs.
    const viewParamHandledRef = useRef<string | null>(null);
    useEffect(() => {
        const requestedId = searchParams.get('view');
        if (!requestedId) {
            viewParamHandledRef.current = null;
            return;
        }
        if (viewParamHandledRef.current === requestedId) return;
        if (!orders) return;

        const target = (orders as any[]).find((o) => o.id === requestedId);
        viewParamHandledRef.current = requestedId;

        const openWith = (row: any) => {
            if (!row) return;
            setSelectedOrder(row);
            setIsViewModalOpen(true);
        };

        if (target) {
            openWith(target);
        } else {
            // Direct fetch fallback when the order is outside the current view filters.
            (async () => {
                const { data } = await (supabase as any)
                    .from('orders')
                    .select(`
                        *,
                        status:order_statuses(*),
                        package_status:package_statuses(*),
                        city:master_cities(id, name),
                        courier:users!orders_courier_id_fkey(id, name, avatar_url),
                        assignee:users!orders_assign_id_fkey(id, name, avatar_url),
                        company:providers(id, name, logo_url),
                        items:order_items(*, product:products(name, code, image_url), accessory:accessories(name, code, image_url)),
                        history:order_status_history(*, user:users!changed_by(name, avatar_url), status:order_statuses!status_id(*)),
                        parcels:company_parcels(id, tracking_code, external_id, provider_id, status_label, status_color, created_at, company_delivery_note_id, provider:providers(id, name, logo_url)),
                        courier_parcels(id, tracking_code, status_label, status_color, created_at, courier_delivery_note_id)
                    `)
                    .eq('id', requestedId)
                    .is('date_deleted', null)
                    .maybeSingle();
                openWith(data);
            })();
        }

        const next = new URLSearchParams(searchParams);
        next.delete('view');
        setSearchParams(next, { replace: true });
    }, [searchParams, orders, setSearchParams]);

    // ?addProductId=<uuid> — opens the New Order modal with the product
    // already on line 1 (mirrors what OrderLineProductCombobox does on select).
    // Placed below the `form` declaration so React can evaluate the deps array
    // without hitting a temporal-dead-zone reference.
    useEffect(() => {
        const requestedId = searchParams.get('addProductId');
        if (!requestedId) return;
        if (prefillProductHandledRef.current === requestedId) return;
        if (!products?.length) return; // wait for product list to be ready

        const prod = (products as any[]).find((p) => p.id === requestedId);
        if (!prod) {
            // Product not in this business / inactive — clean param and bail.
            const next = new URLSearchParams(searchParams);
            next.delete('addProductId');
            setSearchParams(next, { replace: true });
            prefillProductHandledRef.current = requestedId;
            return;
        }

        const accessoriesForLine = (productAccessoriesForOrders ?? [])
            .filter((pa: any) => pa.product_id === requestedId)
            .map((pa: any) => {
                const acc = accessories?.find((a: any) => a.id === pa.accessory_id);
                return {
                    accessory_id: pa.accessory_id,
                    accessory_quantity: pa.default_quantity || 1,
                    accessory_unit_price: acc ? Number(acc.cost_price || 0) : 0,
                };
            });

        form.reset({
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
            delivery_type: 'Home Delivery',
            order_status_id: defaultNewOrderStatusId,
            items: [
                {
                    product_id: prod.id,
                    quantity: 1,
                    unit_price: Number(prod.selling_price || 0),
                    accessories: accessoriesForLine,
                },
            ],
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
        });
        setIsAddModalOpen(true);

        // Mark consumed and strip the param so refresh doesn't re-open.
        prefillProductHandledRef.current = requestedId;
        const next = new URLSearchParams(searchParams);
        next.delete('addProductId');
        setSearchParams(next, { replace: true });
    }, [searchParams, products, productAccessoriesForOrders, accessories, defaultNewOrderStatusId, form, setSearchParams]);

    const newOrderHasZeroStockProduct = useMemo(() => {
        if (isEditModalOpen) return false;
        if (!products?.length || !watchedOrderItems?.length) return false;
        return watchedOrderItems.some((item: any) => {
            const pid = item?.product_id;
            if (!pid || pid === 'none') return false;
            const p = (products as any[]).find((x) => x.id === pid);
            if (!p || p.stock === null || p.stock === undefined) return false;
            return Number(p.stock) === 0;
        });
    }, [isEditModalOpen, watchedOrderItems, products]);

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
    const shippingFeeLockedByProvider = !!(selectedCourierId || selectedCompanyId);
    const includeDeliveryWatched = form.watch('include_delivery_in_total');
    // Shipping fee is editable only when the toggle is ON — provider doesn't lock it
    const shippingFeeReadOnly = !includeDeliveryWatched;

    // Helper: find fee for a provider+city, with zone fallback and provider_cities fallback.
    // 1) Exact match on master_city_id in courier_fees/company_fees
    // 2) Zone fallback: same zone fee
    // 3) provider_cities.fees.delivered fallback
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

    // Derived Data for all providers (used for dropdowns where city is not a factor)
    const allProviders = useMemo(() => {
        const c = couriers?.map((p: any) => ({ ...p, type: 'courier' })) || [];
        const comp = companies?.map((p: any) => ({ ...p, type: 'company' })) || [];
        return [...c, ...comp];
    }, [couriers, companies]);

    // Auto-select best provider and set fee when city changes
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

    // --- Mutations ---
    const createOrderMutation = useMutation({
        mutationFn: async (values: OrderFormValues) => {
            // 1. Insert order
            const totalPrice = values.items.reduce((acc, item) => acc + (item.quantity * item.unit_price), 0);
            const ship = Number(values.shipping_cost) || 0;
            const includeDelivery = values.include_delivery_in_total !== false;
            const orderPrice = includeDelivery ? totalPrice + ship : totalPrice;

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
                    delivery_type: values.delivery_type,
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

            if (values.order_status_id) {
                const userRes = await (supabase as any).auth.getUser();
                const creatorId = userRes.data.user?.id;
                try {
                    await (supabase as any).from('order_status_history').insert({
                        order_id: order.id,
                        status_id: values.order_status_id,
                        comment: (values.history_comment || '').trim(),
                        changed_by: creatorId,
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
            setIsAddModalOpen(false);
            // Defer form.reset so Radix completes its close cycle first.
            setTimeout(() => {
                form.reset({
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
                    delivery_type: 'Home Delivery',
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
                });
            }, 0);
            toast({ title: "Order Created", description: "Successfully logged new order." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const updateOrderMutation = useMutation({
        mutationFn: async (values: OrderFormValues) => {
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
                delivery_type: values.delivery_type,
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
                    // Use explicitly passed reported_date, falling back to current time
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

            // 2. Refresh items (Delete & Insert for simplicity, or complex diff)
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

            // 3. Track History if Status Changed
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
            setIsEditModalOpen(false);
            setSelectedOrder(null);
            toast({ title: "Order Updated", description: "Changes saved successfully." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const deleteOrderMutation = useMutation({
        mutationFn: async (id: string) => {
            const { data: authData } = await supabase.auth.getUser();
            const { error } = await (supabase as any)
                .from('orders')
                .update({
                    date_deleted: new Date().toISOString(),
                    deleted_by_id: authData?.user?.id || null,
                })
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders-aggregate', activeBusinessId] });
            setOrderPendingDelete(null);
            toast({ title: "Order Moved to Trash", description: "Order moved to trash. You can restore it within 14 days." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const bulkStatusMutation = useMutation({
        mutationFn: async ({ orderIds, statusId, reportedDate, commentOverride }: { orderIds: string[], statusId: string, reportedDate?: string, commentOverride?: string }) => {
            const userRes = await (supabase as any).auth.getUser();
            const userId = userRes.data.user?.id;

            // Build update payload with status-specific fields
            const updatePayload: any = {
                order_status_id: statusId,
                updated_at: new Date().toISOString()
            };

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
                updatePayload.reported_date = reportedDate || new Date().toISOString();
            }

            // Insert history BEFORE the update so the DB trigger's 5-second
            // dedup check finds it and skips its own "Changement automatique" row.
            try {
                let finalCommentTemplate = commentOverride || bulkStatusComment || 'Bulk status update';

                if ((isOrderCategory(statusId, 'postponed') || statusId === REPORTED_STATUS_ID) && reportedDate) {
                    const formattedDate = format(new Date(reportedDate), 'dd/MM/yyyy HH:mm');
                    finalCommentTemplate = `[Reporté pour: ${formattedDate}] ${finalCommentTemplate}`;
                }

                const historyRecords = orderIds.map(oId => ({
                    order_id: oId,
                    status_id: statusId,
                    comment: finalCommentTemplate,
                    changed_by: userId,
                    'DigiCom Business': activeBusinessId
                }));
                await (supabase as any).from('order_status_history').insert(historyRecords);
            } catch (err) {
                console.error("Bulk history error", err);
            }

            const { error } = await (supabase as any)
                .from('orders')
                .update(updatePayload)
                .in('id', orderIds)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders-aggregate', activeBusinessId] });
            setSelectedOrders([]);
            setIsBulkStatusModalOpen(false);
            setBulkStatusComment("");
            toast({ title: "Success", description: "Orders status updated successfully." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const bulkAttributeMutation = useMutation({
        mutationFn: async ({ orderIds, sellerId }: { orderIds: string[], sellerId: string | null }) => {
            const updatePayload: any = {
                assign_id: sellerId,
                seller_id: sellerId,
                updated_at: new Date().toISOString(),
                assignment_date: sellerId ? new Date().toISOString() : null
            };
            const { error } = await (supabase as any)
                .from('orders')
                .update(updatePayload)
                .in('id', orderIds)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders-aggregate', activeBusinessId] });
            setSelectedOrders([]);
            setIsAttributionModalOpen(false);
            toast({ title: "Success", description: "Orders attributed successfully." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const toggleOrderSelection = (id: string) => {
        setSelectedOrders(prev =>
            prev.includes(id) ? prev.filter(oid => oid !== id) : [...prev, id]
        );
    };

    const toggleSelectAll = (orderIds: string[]) => {
        if (selectedOrders.length === orderIds.length) {
            setSelectedOrders([]);
        } else {
            setSelectedOrders(orderIds);
        }
    };

    // --- Date range helper ---
    const getDateRange = useMemo(() => {
        const now = new Date();
        switch (filterTimeRange) {
            case 'today': return { from: startOfDay(now), to: endOfDay(now) };
            case 'yesterday': return { from: startOfDay(subDays(now, 1)), to: endOfDay(subDays(now, 1)) };
            case 'last7': return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
            case 'last30': return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
            case 'thisMonth': return { from: startOfMonth(now), to: endOfDay(now) };
            case 'lastMonth': { const lm = subMonths(now, 1); return { from: startOfMonth(lm), to: endOfMonth(lm) }; }
            case 'custom': return filterCustomRange?.from && filterCustomRange?.to ? { from: startOfDay(filterCustomRange.from), to: endOfDay(filterCustomRange.to) } : null;
            default: return null;
        }
    }, [filterTimeRange, filterCustomRange]);

    const DATE_FIELD_MAP: Record<string, string> = {
        'date': 'date',
        'created_at': 'created_at',
        'updated_at': 'updated_at',
        'assignment_date': 'assignment_date',
        'confirmation_date': 'confirmation_date',
        'annulation_date': 'annulation_date',
        'date_livraison': 'date_livraison',
        'reported_date': 'reported_date',
    };

    // --- Helpers ---
    // Highlight rows whose phone is shared with ANOTHER order anywhere in the
    // business (not just the visible page). Built from the full aggregate so
    // the flag is stable regardless of pagination.
    const duplicatePhones = useMemo(() => {
        if (!aggregateOrders?.length) return new Set<string>();
        const phoneCounts: Record<string, number> = {};
        aggregateOrders.forEach((o: any) => {
            if (o.phone) {
                const normalized = (o.phone || '').replace(/[\s-]/g, '');
                phoneCounts[normalized] = (phoneCounts[normalized] || 0) + 1;
            }
        });
        const duplicates = new Set<string>();
        aggregateOrders.forEach((o: any) => {
            if (o.phone) {
                const normalized = (o.phone || '').replace(/[\s-]/g, '');
                if (phoneCounts[normalized] > 1) {
                    duplicates.add(o.phone);
                }
            }
        });
        return duplicates;
    }, [aggregateOrders]);

    // Reusable filter predicate — applied to both the paginated `orders`
    // (drives what the user sees) and `aggregateOrders` (drives the KPI strip),
    // so KPIs respect filters but stay stable across page-size changes.
    const orderMatchesAllFilters = useMemo(() => (o: any) => {
        const matchesSearch = orderMatchesTopSearch(o, searchQuery);
        const matchesStatus =
            filterStatus !== 'all'
                ? o.order_status_id === filterStatus
                : filterStatusIds && filterStatusIds.length > 0
                    ? !!o.order_status_id && filterStatusIds.includes(o.order_status_id)
                    : true;
        const matchesCity = filterCity === "all" || o.master_city_id === filterCity || o.city_id === filterCity;
        const matchesSource = filterSource === "all" || o.source_name === filterSource;
        const matchesProvider = filterProvider === "all" || o.courier_id === filterProvider || o.company_id === filterProvider;
        let matchesDate = true;
        if (getDateRange) {
            const fieldKey = DATE_FIELD_MAP[filterDateField] || 'date';
            const dateVal = o[fieldKey];
            if (dateVal) {
                matchesDate = isWithinInterval(new Date(dateVal), { start: getDateRange.from, end: getDateRange.to });
            } else {
                matchesDate = false;
            }
        }
        const matchesCustomerName = !filterCustomerName || o.name?.toLowerCase().includes(filterCustomerName.toLowerCase());
        const matchesPhone = !filterPhone || o.phone?.includes(filterPhone);
        const matchesTracking = orderMatchesTrackingFilter(o, filterTracking);
        const matchesProduct = filterProduct === 'all' || o.items?.some((item: any) => item.product_id === filterProduct);
        const matchesPackageStatus =
            filterPackageStatus !== 'all'
                ? o.package_status_id === filterPackageStatus
                : filterPackageStatusIds && filterPackageStatusIds.length > 0
                    ? !!o.package_status_id && filterPackageStatusIds.includes(o.package_status_id)
                    : true;
        const matchesConfirmedBy = filterConfirmedBy === 'all' || o.confirmed_by_id === filterConfirmedBy;
        const matchesAssignedTo = filterAssignedTo === 'all' || o.assign_id === filterAssignedTo;
        const matchesExchange = filterExchange === 'all' || (filterExchange === 'yes' && o.replace) || (filterExchange === 'no' && !o.replace);
        return matchesSearch && matchesStatus && matchesCity && matchesSource && matchesProvider && matchesDate && matchesCustomerName && matchesPhone && matchesTracking && matchesProduct && matchesPackageStatus && matchesConfirmedBy && matchesAssignedTo && matchesExchange;
    }, [searchQuery, filterStatus, filterStatusIds, filterCity, filterSource, filterProvider, getDateRange, filterDateField, filterCustomerName, filterPhone, filterTracking, filterProduct, filterPackageStatus, filterPackageStatusIds, filterConfirmedBy, filterAssignedTo, filterExchange]);

    const filteredAggregate = useMemo(() => aggregateOrders.filter(orderMatchesAllFilters), [aggregateOrders, orderMatchesAllFilters]);

    // Pagination is now a pure client-side slice of the FILTERED aggregate.
    // This is the only place page-size touches anything — KPIs, dropdowns,
    // counters all see the full filtered list above. Filter changes auto-reset
    // page below so the user can never strand themselves on an empty page.
    const totalOrdersCount = filteredAggregate.length;
    const totalPages = Math.max(1, Math.ceil(totalOrdersCount / pageSize));
    const filteredOrders = useMemo(() => {
        const from = (page - 1) * pageSize;
        return filteredAggregate.slice(from, from + pageSize);
    }, [filteredAggregate, page, pageSize]);

    const activeFilterCount = useMemo(() => {
        let count = 0;
        if (filterStatus !== 'all') count++;
        else if (filterStatusIds && filterStatusIds.length > 0) count++;
        if (filterCity !== 'all') count++;
        if (filterSource !== 'all') count++;
        if (filterProvider !== 'all') count++;
        if (filterTimeRange !== 'all') count++;
        if (filterCustomerName) count++;
        if (filterPhone) count++;
        if (filterTracking.trim()) count++;
        if (filterProduct !== 'all') count++;
        if (filterPackageStatus !== 'all') count++;
        else if (filterPackageStatusIds && filterPackageStatusIds.length > 0) count++;
        if (filterConfirmedBy !== 'all') count++;
        if (filterAssignedTo !== 'all') count++;
        if (filterExchange !== 'all') count++;
        return count;
    }, [filterStatus, filterStatusIds, filterCity, filterSource, filterProvider, filterTimeRange, filterCustomerName, filterPhone, filterTracking, filterProduct, filterPackageStatus, filterPackageStatusIds, filterConfirmedBy, filterAssignedTo, filterExchange]);

    const clearAllFilters = () => {
        setFilterStatus('all');
        setFilterStatusIds(null);
        setFilterStatusLabel(null);
        setFilterCity('all');
        setFilterSource('all');
        setFilterProvider('all');
        setFilterTimeRange('all');
        setFilterCustomRange(undefined);
        setFilterDateField('date');
        setFilterCustomerName('');
        setFilterPhone('');
        setFilterTracking('');
        setFilterProduct('all');
        setFilterPackageStatus('all');
        setFilterPackageStatusIds(null);
        setFilterPackageStatusLabel(null);
        setFilterConfirmedBy('all');
        setFilterAssignedTo('all');
        setFilterExchange('all');
    };

    // Snap back to page 1 whenever the active filter set changes OR the search
    // bar mutates. Without this, applying a filter while on page 6 would land
    // the user on an empty page even though matches exist earlier in the list.
    useEffect(() => {
        setPage(1);
    }, [searchQuery, filterStatus, filterStatusIds, filterCity, filterSource, filterProvider, filterTimeRange, filterCustomRange, filterDateField, filterCustomerName, filterPhone, filterTracking, filterProduct, filterPackageStatus, filterPackageStatusIds, filterConfirmedBy, filterAssignedTo, filterExchange]);

    // Also clamp the page when filteredAggregate shrinks past the current page
    // (e.g. realtime delete removes the last row on the page).
    useEffect(() => {
        if (page > totalPages) setPage(totalPages);
    }, [page, totalPages]);

    const handleEdit = (order: any) => {
        setSelectedOrder(order);
        form.reset({
            name: order.name,
            phone: order.phone,
            city_id: order.master_city_id || order.city_id,
            address: order.address,
            source_name: order.source_name,
            shipping_cost: Number(order.shipping_cost),
            include_delivery_in_total: order.include_delivery_in_total !== false,
            replace: order.replace,
            note: order.note || '',
            delivery_note: order.delivery_note || '',
            delivery_type: order.delivery_type || 'Home Delivery',
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
            history_comment: '',
            _reportedDate: ''
        });
        setIsEditModalOpen(true);
    };

    // Single-palette filter chip. Every active filter looks the same so the row
    // Active filter chip — lightweight pill matching the ant date-filter variant.
    const FilterChip: React.FC<{
        icon: React.ComponentType<{ className?: string }>;
        onClear: () => void;
        tone?: 'default' | 'warning';
        children: React.ReactNode;
    }> = ({ icon: Icon, onClear, tone = 'default', children }) => (
        <span
            className={cn(
                'inline-flex items-center gap-1.5 h-7 pl-2 pr-1 rounded-full text-[10.5px] font-medium border',
                tone === 'warning'
                    ? 'bg-ant-orange/10 text-ant-orange border-ant-orange/30'
                    : 'bg-ant-paper text-ant-ink border-ant-line',
            )}
        >
            <Icon className="w-3 h-3 text-ant-mid shrink-0" />
            <span className="truncate max-w-[140px]">{children}</span>
            <button
                onClick={onClear}
                className="rounded-full hover:bg-ant-line-soft p-0.5 transition-colors shrink-0"
                aria-label="Clear filter"
            >
                <X className="w-2.5 h-2.5" />
            </button>
        </span>
    );

    // Editorial KPI tile — matches the Dashboard strip so the Orders surface
    // feels continuous with the rest of the admin.
    const OrderKpi: React.FC<{
        label: string;
        value: string;
        suffix?: string;
        accent: string;
        icon: typeof ShoppingCart;
    }> = ({ label, value, suffix, accent, icon: Icon }) => (
        <div className="bg-ant-paper px-4 py-3">
            <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: accent }} aria-hidden />
                    <span className="text-[9.5px] uppercase tracking-[0.22em] font-medium text-ant-mid truncate">
                        {label}
                    </span>
                </div>
                <span
                    className="flex items-center justify-center w-5 h-5 rounded-md shrink-0"
                    style={{ backgroundColor: `${accent}14`, color: accent }}
                >
                    <Icon className="w-3 h-3" strokeWidth={1.75} />
                </span>
            </div>
            <div className="font-display text-[22px] font-semibold text-ant-ink tabular-nums tracking-[-0.02em] leading-none mt-2 truncate">
                {value}
                {suffix && <span className="text-[11px] font-medium text-ant-mid ml-1">{suffix}</span>}
            </div>
        </div>
    );

    const openNewOrder = () => {
        form.reset({
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
            delivery_type: 'Home Delivery',
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
        });
        setIsAddModalOpen(true);
    };

    // KPIs derive from the FULL filtered aggregate (independent of page size).
    const totalRevenue = filteredAggregate.reduce((acc, o) => acc + (Number(o.price) || 0), 0);
    const exchangeCount = filteredAggregate.filter((o) => o.replace).length;
    const avgOrderValue = filteredAggregate.length > 0 ? Math.round(totalRevenue / filteredAggregate.length) : 0;
    const filteredAggregateCount = filteredAggregate.length;

    return (
        <div className="ant-surface mx-auto max-w-[1440px] px-2 md:px-3 py-2 space-y-4">
            {/* Editorial header — orders is the seller's working tool, so the
                title gets its own row with WebhookHealthIndicator as a status
                stripe, and the search + primary CTA live in a dedicated bar
                below so they are never cramped next to the title. */}
            <header className="space-y-3 pt-1">
                <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
                    <div className="space-y-1.5">
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                            <span className="w-1 h-1 rounded-full bg-ant-orange" />
                            Operations · Pipeline
                        </span>
                        <h1 className="font-display text-[30px] md:text-[34px] font-semibold text-ant-ink leading-[1.05] tracking-[-0.02em]">
                            Orders
                        </h1>
                        <p className="font-serif-display text-[13px] text-ant-muted italic">
                            Every order, from cart to courier — in one pipeline.
                        </p>
                        <WebhookHealthIndicator activeBusinessId={activeBusinessId} className="mt-1" />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="relative w-full sm:w-[320px]">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                            <Input
                                placeholder="Search by name, phone, tracking, item…"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-ant-orange focus-visible:ring-offset-0 focus-visible:border-ant-ink/25"
                            />
                        </div>
                        <Button
                            onClick={openNewOrder}
                            className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light text-[12px] font-medium shadow-none gap-2 shrink-0"
                        >
                            <PlusCircle className="w-3.5 h-3.5" />
                            New order
                        </Button>
                    </div>
                </div>
            </header>

            {/* KPI strip — unified editorial tiles matching Dashboard */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-xl overflow-hidden border border-ant-line">
                <OrderKpi
                    label="Active orders"
                    value={new Intl.NumberFormat('fr-FR').format(filteredAggregateCount)}
                    accent="#141413"
                    icon={ShoppingCart}
                />
                <OrderKpi
                    label="Total sales"
                    value={`${new Intl.NumberFormat('fr-FR').format(Math.round(totalRevenue))}`}
                    suffix="DH"
                    accent="#788c5d"
                    icon={DollarSign}
                />
                <OrderKpi
                    label="Exchanges"
                    value={new Intl.NumberFormat('fr-FR').format(exchangeCount)}
                    accent="#d97757"
                    icon={RefreshCcw}
                />
                <OrderKpi
                    label="Avg order"
                    value={`${new Intl.NumberFormat('fr-FR').format(avgOrderValue)}`}
                    suffix="DH"
                    accent="#6a9bcc"
                    icon={BarChart3}
                />
            </div>

            {/* ── Today's Attribution — seller quota tracker ── */}
            {attributionProgress && attributionProgress.length > 0 && (
                <div className="bg-ant-paper border border-ant-line rounded-xl overflow-hidden transition-all duration-300">
                    {/* Collapsed bar */}
                    <button
                        onClick={() => setIsAttributionOpen((o) => !o)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 group hover:bg-ant-line-soft transition-colors"
                    >
                        <span className="flex items-center gap-1.5 shrink-0">
                            <span className="w-1 h-1 rounded-full bg-ant-orange" aria-hidden />
                            <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                Today&rsquo;s attribution
                            </span>
                        </span>

                        {/* Global progress bar */}
                        <div className="flex-1 h-1.5 bg-ant-line rounded-full overflow-hidden min-w-[60px]">
                            <div
                                className="h-full rounded-full bg-ant-ink transition-all duration-700"
                                style={{ width: `${Math.min(attributionTotals.totalPct, 100)}%` }}
                            />
                        </div>

                        <span className="font-display text-[13px] font-semibold text-ant-ink shrink-0 w-10 text-right tabular-nums tracking-[-0.01em]">
                            {attributionTotals.totalPct}%
                        </span>

                        {/* Seller avatar chips */}
                        <div className="flex items-center -space-x-1.5 shrink-0">
                            {attributionProgress.slice(0, 5).map((seller) => {
                                const sellerData = sellers?.find((s) => s.id === seller.seller_id);
                                return (
                                    <div
                                        key={seller.seller_id}
                                        title={`${seller.seller_name}: ${seller.orders_today}/${seller.assignment}`}
                                        className={cn(
                                            'w-6 h-6 rounded-full ring-2 ring-ant-paper flex items-center justify-center text-[9px] font-semibold overflow-hidden',
                                            seller.is_full
                                                ? 'bg-ant-green text-white'
                                                : 'bg-ant-line-soft text-ant-ink border border-ant-line',
                                        )}
                                    >
                                        {sellerData?.avatar_url ? (
                                            <img src={sellerData.avatar_url} alt={seller.seller_name} className="w-full h-full object-cover" />
                                        ) : (
                                            seller.seller_name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
                                        )}
                                    </div>
                                );
                            })}
                            {attributionProgress.length > 5 && (
                                <div className="w-6 h-6 rounded-full ring-2 ring-ant-paper bg-ant-line-soft border border-ant-line flex items-center justify-center text-[9px] font-semibold text-ant-muted">
                                    +{attributionProgress.length - 5}
                                </div>
                            )}
                        </div>

                        {/* Unassigned warning pill */}
                        {attributionTotals.unassigned > 0 && (
                            <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium text-ant-orange bg-ant-orange/10 border border-ant-orange/30 px-2 py-0.5 rounded-full">
                                <span className="w-1 h-1 rounded-full bg-ant-orange" />
                                {attributionTotals.unassigned} unassigned
                            </span>
                        )}

                        {/* Chevron */}
                        <div className={cn('shrink-0 text-ant-mid transition-transform duration-300', isAttributionOpen && 'rotate-180')}>
                            <ChevronDown className="w-3.5 h-3.5" />
                        </div>
                    </button>

                    {/* Expanded seller panel */}
                    <div
                        className={cn(
                            'transition-all duration-300 ease-in-out overflow-hidden',
                            isAttributionOpen ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0',
                        )}
                    >
                        {/* Summary + actions */}
                        <div className="flex items-center gap-3 px-4 py-2.5 border-t border-ant-line bg-ant-light">
                            <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid shrink-0">Queue</span>
                            <div className="flex-1 h-1.5 bg-ant-line rounded-full overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-ant-ink transition-all duration-700"
                                    style={{ width: `${Math.min(attributionTotals.totalPct, 100)}%` }}
                                />
                            </div>
                            <span className="font-display text-[12px] text-ant-ink tabular-nums tracking-tight shrink-0">
                                {attributionTotals.totalAssigned}
                                <span className="text-ant-mid"> / {attributionTotals.totalQuota}</span>
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                                {attributionTotals.unassigned > 0 && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={(e) => { e.stopPropagation(); reattributeMutation.mutate(); }}
                                        disabled={reattributeMutation.isPending}
                                        className="h-7 px-3 rounded-full text-[10.5px] font-medium border-ant-orange/30 bg-ant-paper text-ant-orange hover:bg-ant-orange/10 gap-1.5"
                                    >
                                        {reattributeMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                        Assign unassigned
                                    </Button>
                                )}
                                <button
                                    onClick={(e) => { e.stopPropagation(); refetchAttribution(); }}
                                    disabled={isAttributionFetching}
                                    className="w-7 h-7 flex items-center justify-center rounded-full text-ant-mid hover:text-ant-ink hover:bg-ant-paper transition-colors"
                                    title="Refresh"
                                >
                                    <RefreshCw className={cn('w-3 h-3', isAttributionFetching && 'animate-spin')} />
                                </button>
                            </div>
                        </div>

                        {/* Per-seller rows */}
                        <div className="divide-y divide-ant-line">
                            {attributionProgress.map((seller) => {
                                const pct = Math.min(Number(seller.pct_complete), 100);
                                const isFull = seller.is_full;
                                const sellerData = sellers?.find((s) => s.id === seller.seller_id);
                                return (
                                    <div
                                        key={seller.seller_id}
                                        className="flex items-center gap-3 px-4 py-2 hover:bg-ant-line-soft transition-colors"
                                    >
                                        <div
                                            className={cn(
                                                'w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 overflow-hidden',
                                                isFull ? 'bg-ant-green/15 text-ant-green ring-1 ring-ant-green/25' : 'bg-ant-line-soft text-ant-ink ring-1 ring-ant-line',
                                            )}
                                        >
                                            {sellerData?.avatar_url ? (
                                                <img src={sellerData.avatar_url} alt={seller.seller_name} className="w-full h-full object-cover" />
                                            ) : (
                                                seller.seller_name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
                                            )}
                                        </div>
                                        <div className="w-[140px] shrink-0">
                                            <p className="text-[11.5px] font-semibold text-ant-ink truncate leading-tight">{seller.seller_name}</p>
                                            <p className="text-[9.5px] text-ant-mid uppercase tracking-[0.18em] mt-0.5">Quota · {seller.assignment}/day</p>
                                        </div>
                                        <div className="flex-1 flex items-center gap-2">
                                            <div className="flex-1 h-1 bg-ant-line rounded-full overflow-hidden">
                                                <div
                                                    className={cn('h-full rounded-full transition-all duration-700', isFull ? 'bg-ant-green' : 'bg-ant-ink')}
                                                    style={{ width: `${pct}%` }}
                                                />
                                            </div>
                                            <span className="text-[10px] font-medium text-ant-mid w-8 text-right shrink-0 tabular-nums">{pct}%</span>
                                        </div>
                                        <div className="font-display text-right shrink-0 tabular-nums">
                                            <span className={cn('text-[14px] font-semibold tracking-[-0.01em]', isFull ? 'text-ant-green' : 'text-ant-ink')}>
                                                {seller.orders_today}
                                            </span>
                                            <span className="text-ant-mid text-[10px]"> / {seller.assignment}</span>
                                        </div>
                                        {isFull && (
                                            <span className="shrink-0 text-[9.5px] font-medium text-ant-green bg-ant-green/10 px-2 py-0.5 rounded-full border border-ant-green/25 uppercase tracking-[0.18em]">
                                                Full
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* Filters Toolbar */}
            <div className="space-y-3 pb-2">
                {/* Top Bar: View Switcher + Filters Toggle + Active Pills + Count */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                        {/* View Switcher — pill-group with orange active state */}
                        <ToggleGroup
                            type="single"
                            value={viewMode}
                            onValueChange={(v) => { if (v) setViewMode(v as 'grid' | 'list'); }}
                            className="gap-0 shrink-0 rounded-full border border-ant-line bg-ant-paper p-0.5"
                        >
                            <ToggleGroupItem
                                value="grid"
                                aria-label="Grid view"
                                className="h-8 w-8 p-0 rounded-full border-0 text-ant-mid data-[state=on]:bg-ant-ink data-[state=on]:text-ant-light"
                            >
                                <LayoutGrid className="w-3.5 h-3.5" />
                            </ToggleGroupItem>
                            <ToggleGroupItem
                                value="list"
                                aria-label="List view"
                                className="h-8 w-8 p-0 rounded-full border-0 text-ant-mid data-[state=on]:bg-ant-ink data-[state=on]:text-ant-light"
                            >
                                <List className="w-3.5 h-3.5" />
                            </ToggleGroupItem>
                        </ToggleGroup>

                        {/* Filter Toggle */}
                        <Button
                            variant="ghost"
                            onClick={() => setShowAllFilters(!showAllFilters)}
                            className={cn(
                                'h-9 px-4 rounded-full gap-2 text-[11.5px] font-medium transition-all border',
                                showAllFilters
                                    ? 'bg-ant-ink text-ant-light border-ant-ink hover:bg-ant-ink/90 hover:text-ant-light'
                                    : 'bg-ant-paper text-ant-ink border-ant-line hover:border-ant-ink/25 hover:text-ant-ink',
                            )}
                        >
                            <Filter className="w-3.5 h-3.5" />
                            Filters
                            {activeFilterCount > 0 && (
                                <span
                                    className={cn(
                                        'ml-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-semibold leading-none px-1 tabular-nums',
                                        showAllFilters ? 'bg-ant-orange text-ant-light' : 'bg-ant-ink text-ant-light',
                                    )}
                                >
                                    {activeFilterCount}
                                </span>
                            )}
                        </Button>

                        {/* Active Filter Chips — unified to the locked palette (navy base, amber for time, red for destructive). */}
                        {activeFilterCount > 0 && (
                            <div className="flex flex-wrap items-center gap-1 animate-in fade-in duration-300">
                                {filterTimeRange !== 'all' && (
                                    <FilterChip icon={Clock} onClear={() => { setFilterTimeRange('all'); setFilterCustomRange(undefined); }}>
                                        {filterTimeRange === 'custom' && filterCustomRange?.from ? `${format(filterCustomRange.from, 'dd/MM')}–${filterCustomRange.to ? format(filterCustomRange.to, 'dd/MM') : '...'}` : filterTimeRange.replace(/([A-Z])/g, ' $1').trim()}
                                    </FilterChip>
                                )}
                                {filterStatus !== 'all' ? (
                                    <FilterChip icon={ShieldCheck} onClear={() => setFilterStatus('all')}>
                                        {orderStatuses?.find((s: any) => s.id === filterStatus)?.label || 'Status'}
                                    </FilterChip>
                                ) : filterStatusIds && filterStatusIds.length > 0 && (
                                    <FilterChip icon={ShieldCheck} onClear={() => { setFilterStatusIds(null); setFilterStatusLabel(null); }}>
                                        {filterStatusLabel || 'Status'} ({filterStatusIds.length})
                                    </FilterChip>
                                )}
                                {filterPackageStatus !== 'all' ? (
                                    <FilterChip icon={Package} onClear={() => setFilterPackageStatus('all')}>
                                        {packageStatuses?.find((s: any) => s.id === filterPackageStatus)?.label || 'Package'}
                                    </FilterChip>
                                ) : filterPackageStatusIds && filterPackageStatusIds.length > 0 && (
                                    <FilterChip icon={Package} onClear={() => { setFilterPackageStatusIds(null); setFilterPackageStatusLabel(null); }}>
                                        {filterPackageStatusLabel || 'Package'} ({filterPackageStatusIds.length})
                                    </FilterChip>
                                )}
                                {filterCity !== 'all' && (
                                    <FilterChip icon={MapPin} onClear={() => setFilterCity('all')}>
                                        {cities?.find((c: any) => c.id === filterCity)?.name || 'City'}
                                    </FilterChip>
                                )}
                                {filterProduct !== 'all' && (
                                    <FilterChip icon={ShoppingBag} onClear={() => setFilterProduct('all')}>
                                        {products?.find((p: any) => p.id === filterProduct)?.name || 'Product'}
                                    </FilterChip>
                                )}
                                {filterCustomerName && (
                                    <FilterChip icon={User} onClear={() => setFilterCustomerName('')}>
                                        "{filterCustomerName}"
                                    </FilterChip>
                                )}
                                {filterPhone && (
                                    <FilterChip icon={Phone} onClear={() => setFilterPhone('')}>
                                        {filterPhone}
                                    </FilterChip>
                                )}
                                {filterTracking.trim() && (
                                    <FilterChip icon={Hash} onClear={() => setFilterTracking('')}>
                                        <span className="truncate max-w-[140px]">{filterTracking.trim()}</span>
                                    </FilterChip>
                                )}
                                {filterSource !== 'all' && (
                                    <FilterChip icon={ExternalLink} onClear={() => setFilterSource('all')}>
                                        <span className="capitalize">{filterSource}</span>
                                    </FilterChip>
                                )}
                                {filterConfirmedBy !== 'all' && (
                                    <FilterChip icon={CheckCircle2} onClear={() => setFilterConfirmedBy('all')}>
                                        {confirmers?.find((u: any) => u.id === filterConfirmedBy)?.name || 'Confirmer'}
                                    </FilterChip>
                                )}
                                {filterAssignedTo !== 'all' && (
                                    <FilterChip icon={User} onClear={() => setFilterAssignedTo('all')}>
                                        {sellers?.find((s: any) => s.id === filterAssignedTo)?.name || 'Seller'}
                                    </FilterChip>
                                )}
                                {filterProvider !== 'all' && (
                                    <FilterChip icon={Truck} onClear={() => setFilterProvider('all')}>
                                        {allProviders.find((p: any) => p.id === filterProvider)?.name || 'Service'}
                                    </FilterChip>
                                )}
                                {filterExchange !== 'all' && (
                                    <FilterChip icon={RefreshCcw} tone="warning" onClear={() => setFilterExchange('all')}>
                                        {filterExchange === 'yes' ? 'Exchange: yes' : 'Exchange: no'}
                                    </FilterChip>
                                )}

                                <button
                                    onClick={clearAllFilters}
                                    className="h-7 px-2.5 rounded-full text-[10.5px] font-medium text-ant-rose hover:bg-ant-rose/10 transition-colors"
                                >
                                    Clear all
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="inline-flex items-stretch h-8 rounded-full bg-ant-paper border border-ant-line overflow-hidden">
                            <div className="inline-flex items-baseline gap-1 px-3 tabular-nums self-center">
                                <span className="font-display text-[13px] font-semibold text-ant-ink tracking-[-0.01em]">
                                    {filteredOrders.length.toLocaleString('fr-FR')}
                                </span>
                                <span className="text-[10px] font-medium text-ant-mid">of</span>
                                <span className="font-display text-[13px] font-semibold text-ant-ink tracking-[-0.01em]" title={`Total ${filteredAggregateCount.toLocaleString('fr-FR')}`}>
                                    {filteredAggregateCount.toLocaleString('fr-FR')}
                                </span>
                                <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-ant-mid ml-0.5">orders</span>
                            </div>
                            <div className="w-px bg-ant-line" />
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        title="Rows per page"
                                        className="inline-flex items-center gap-1.5 px-3 bg-ant-ink/[0.025] hover:bg-ant-ink/5 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ant-ink/20"
                                    >
                                        <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid">Show</span>
                                        <span className="font-display text-[13px] font-semibold text-ant-ink tabular-nums tracking-[-0.01em]">{pageSize}</span>
                                        <ChevronDown className="w-3 h-3 text-ant-mid" strokeWidth={2} />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="min-w-[120px] rounded-xl border-ant-line shadow-xl p-1">
                                    {[100, 500, 1000].map((n) => (
                                        <DropdownMenuItem
                                            key={n}
                                            onClick={() => { setPageSize(n as 100 | 500 | 1000); setPage(1); }}
                                            className={cn(
                                                'rounded-lg px-3 py-1.5 text-[12px] font-semibold tabular-nums cursor-pointer flex items-center justify-between gap-3',
                                                pageSize === n ? 'text-ant-ink bg-ant-ink/[0.04]' : 'text-ant-mid hover:text-ant-ink',
                                            )}
                                        >
                                            <span>{n.toLocaleString('fr-FR')}</span>
                                            <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid">rows</span>
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                </div>

                {/* Expandable Filter Panel */}
                {showAllFilters && (
                    <div className="bg-ant-paper rounded-xl border border-ant-line overflow-hidden animate-in slide-in-from-top-2 fade-in duration-300">
                        {/* Time Section */}
                        <div className="px-4 py-3.5 border-b border-ant-line">
                            <div className="flex items-center gap-2 mb-3">
                                <span className="w-1 h-1 rounded-full bg-ant-orange" />
                                <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Date &amp; time</span>
                            </div>
                            <div className="flex flex-wrap items-end gap-4">
                                <div className="space-y-1.5 min-w-[150px]">
                                    <span className="text-[10px] font-medium text-ant-mid uppercase tracking-[0.22em]">Filter by</span>
                                    <Select value={filterDateField} onValueChange={setFilterDateField}>
                                        <SelectTrigger className="h-9 rounded-full border-ant-line bg-ant-paper text-[11.5px] font-medium text-ant-ink px-3.5">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl border-ant-line bg-ant-paper">
                                            <SelectItem value="date" className="text-[11.5px] font-medium rounded-md">Order date</SelectItem>
                                            <SelectItem value="created_at" className="text-[11.5px] font-medium rounded-md">Created date</SelectItem>
                                            <SelectItem value="updated_at" className="text-[11.5px] font-medium rounded-md">Updated date</SelectItem>
                                            <SelectItem value="assignment_date" className="text-[11.5px] font-medium rounded-md">Assigned date</SelectItem>
                                            <SelectItem value="confirmation_date" className="text-[11.5px] font-medium rounded-md">Confirmed date</SelectItem>
                                            <SelectItem value="annulation_date" className="text-[11.5px] font-medium rounded-md">Cancelled date</SelectItem>
                                            <SelectItem value="date_livraison" className="text-[11.5px] font-medium rounded-md">Delivered date</SelectItem>
                                            <SelectItem value="reported_date" className="text-[11.5px] font-medium rounded-md">Reported date</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-medium text-ant-mid uppercase tracking-[0.22em]">Range</span>
                                    <div className="flex flex-wrap gap-1.5">
                                        {([
                                            { v: 'all', l: 'All' },
                                            { v: 'today', l: 'Today' },
                                            { v: 'yesterday', l: 'Yesterday' },
                                            { v: 'last7', l: '7 Days' },
                                            { v: 'last30', l: '30 Days' },
                                            { v: 'thisMonth', l: 'This Month' },
                                            { v: 'lastMonth', l: 'Last Month' },
                                            { v: 'custom', l: 'Custom' },
                                        ] as const).map((opt) => (
                                            <button
                                                key={opt.v}
                                                onClick={() => { setFilterTimeRange(opt.v); if (opt.v !== 'custom') setShowCalendar(false); else setShowCalendar(true); }}
                                                className={cn(
                                                    'h-9 px-3.5 rounded-full text-[11px] font-medium transition border',
                                                    filterTimeRange === opt.v
                                                        ? 'bg-ant-ink text-ant-light border-ant-ink'
                                                        : 'bg-ant-paper text-ant-ink border-ant-line hover:border-ant-ink/25',
                                                )}
                                            >
                                                {opt.l}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {filterTimeRange === 'custom' && (
                                    <div className="space-y-1.5">
                                        <span className="text-[10px] font-medium text-ant-mid uppercase tracking-[0.22em]">Pick dates</span>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button variant="outline" className="h-9 rounded-full border-ant-line bg-ant-paper text-[11.5px] font-medium text-ant-ink gap-2 px-3.5 hover:border-ant-ink/25">
                                                    <Calendar className="w-3.5 h-3.5 text-ant-orange" />
                                                    {filterCustomRange?.from ? (
                                                        filterCustomRange.to ? (
                                                            <>{format(filterCustomRange.from, 'MMM dd')} — {format(filterCustomRange.to, 'MMM dd, yyyy')}</>
                                                        ) : format(filterCustomRange.from, 'MMM dd, yyyy')
                                                    ) : 'Select range…'}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="ant-surface ant-calendar w-auto p-0 rounded-2xl border border-ant-line bg-ant-paper" align="start">
                                                <CalendarComponent
                                                    mode="range"
                                                    selected={calendarRange}
                                                    onSelect={handleCustomRangeSelect}
                                                    onDayMouseEnter={(day) => setHoveredCalendarDate(day)}
                                                    onDayMouseLeave={() => setHoveredCalendarDate(undefined)}
                                                    modifiers={calendarPreviewRange ? { preview: calendarPreviewRange } : undefined}
                                                    modifiersClassNames={{ preview: 'bg-ant-orange/15 text-ant-ink' }}
                                                    numberOfMonths={2}
                                                    className="rounded-2xl p-3"
                                                />
                                            </PopoverContent>
                                        </Popover>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Search Section */}
                        <div className="p-5 border-b border-ant-line">
                            <div className="flex items-center gap-2 mb-3.5">
                                <div className="w-6 h-6 rounded-lg bg-ant-green/10 flex items-center justify-center">
                                    <Search className="w-3.5 h-3.5 text-ant-green" />
                                </div>
                                <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Customer Search</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="relative group">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid group-focus-within:text-ant-mid transition-colors" />
                                    <Input
                                        placeholder="Customer name..."
                                        value={filterCustomerName}
                                        onChange={(e) => setFilterCustomerName(e.target.value)}
                                        className="h-10 w-[200px] pl-9 rounded-xl border-ant-line bg-ant-paper text-xs font-medium hover:border-ant-ink/10 focus-visible:ring-1 focus-visible:ring-ant-ink/10"
                                    />
                                </div>
                                <div className="relative group">
                                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid group-focus-within:text-ant-mid transition-colors" />
                                    <Input
                                        placeholder="Phone number..."
                                        value={filterPhone}
                                        onChange={(e) => setFilterPhone(e.target.value)}
                                        className="h-10 w-[180px] pl-9 rounded-xl border-ant-line bg-ant-paper text-xs font-medium hover:border-ant-ink/10 focus-visible:ring-1 focus-visible:ring-ant-ink/10"
                                    />
                                </div>
                                <div className="relative group">
                                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid group-focus-within:text-ant-mid transition-colors" />
                                    <Input
                                        placeholder="Tracking number..."
                                        value={filterTracking}
                                        onChange={(e) => setFilterTracking(e.target.value)}
                                        className="h-10 w-[200px] pl-9 rounded-xl border-ant-line bg-ant-paper text-xs font-medium hover:border-ant-ink/10 focus-visible:ring-1 focus-visible:ring-ant-ink/10"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Dropdowns Grid */}
                        <div className="p-5">
                            <div className="flex items-center gap-2 mb-3.5">
                                <div className="w-6 h-6 rounded-lg bg-ant-orange/10 flex items-center justify-center">
                                    <Filter className="w-3.5 h-3.5 text-ant-orange" />
                                </div>
                                <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Filters</span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                                {/* Order Status */}
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-ant-mid uppercase tracking-wider flex items-center gap-1">
                                        <ShieldCheck className="w-3 h-3" /> Status
                                    </span>
                                    <Select
                                        value={filterStatus}
                                        onValueChange={(v) => {
                                            setFilterStatus(v);
                                            // Manual override wipes the category-wide preset so the
                                            // two modes can't combine and surprise the user.
                                            setFilterStatusIds(null);
                                            setFilterStatusLabel(null);
                                        }}
                                    >
                                        <SelectTrigger className={cn("h-10 rounded-xl text-xs font-bold transition-all", filterStatus !== 'all' || (filterStatusIds && filterStatusIds.length > 0) ? "border-ant-orange/30 bg-ant-orange/10 text-ant-orange" : "border-ant-line bg-ant-paper text-ant-ink")}>
                                            <SelectValue placeholder={filterStatusIds && filterStatusIds.length > 0 ? `${filterStatusLabel || 'Category'} (${filterStatusIds.length})` : 'All'} />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-none shadow-[0_12px_40px_-20px_rgba(20,20,19,0.3)] max-h-[300px]">
                                            <SelectItem value="all" className="font-bold text-xs rounded-xl">All Statuses</SelectItem>
                                            {orderStatuses?.map((s: any) => (
                                                <SelectItem key={s.id} value={s.id} className="font-bold text-xs rounded-xl">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                                                        {s.label}
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Package Status */}
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-ant-mid uppercase tracking-wider flex items-center gap-1">
                                        <Package className="w-3 h-3" /> Package
                                    </span>
                                    <Select
                                        value={filterPackageStatus}
                                        onValueChange={(v) => {
                                            setFilterPackageStatus(v);
                                            setFilterPackageStatusIds(null);
                                            setFilterPackageStatusLabel(null);
                                        }}
                                    >
                                        <SelectTrigger className={cn("h-10 rounded-xl text-xs font-bold transition-all", filterPackageStatus !== 'all' || (filterPackageStatusIds && filterPackageStatusIds.length > 0) ? "border-ant-orange/30 bg-ant-orange/10 text-ant-orange" : "border-ant-line bg-ant-paper text-ant-ink")}>
                                            <SelectValue placeholder={filterPackageStatusIds && filterPackageStatusIds.length > 0 ? `${filterPackageStatusLabel || 'Category'} (${filterPackageStatusIds.length})` : 'All'} />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-none shadow-[0_12px_40px_-20px_rgba(20,20,19,0.3)] max-h-[300px]">
                                            <SelectItem value="all" className="font-bold text-xs rounded-xl">All Packages</SelectItem>
                                            {packageStatuses?.map((s: any) => (
                                                <SelectItem key={s.id} value={s.id} className="font-bold text-xs rounded-xl">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                                                        {s.label}
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* City */}
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-ant-mid uppercase tracking-wider flex items-center gap-1">
                                        <MapPin className="w-3 h-3" /> City
                                    </span>
                                    <SearchableFilter
                                        value={filterCity}
                                        onChange={setFilterCity}
                                        allLabel="All Cities"
                                        placeholder="Search cities..."
                                        activeClass="border-ant-green/30 bg-ant-green/10/50 text-ant-green"
                                        items={cities}
                                        getKey={(c: any) => c.id}
                                        getSearchText={(c: any) => c.name || ''}
                                        getTriggerLabel={() => cities?.find((c: any) => c.id === filterCity)?.name ?? 'All'}
                                        renderItem={(c: any) => <span className="truncate">{c.name}</span>}
                                    />
                                </div>

                                {/* Product */}
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-ant-mid uppercase tracking-wider flex items-center gap-1">
                                        <ShoppingBag className="w-3 h-3" /> Product
                                    </span>
                                    <SearchableFilter
                                        value={filterProduct}
                                        onChange={setFilterProduct}
                                        allLabel="All Products"
                                        placeholder="Search products..."
                                        activeClass="border-pink-200 bg-pink-50/50 text-pink-700"
                                        items={products}
                                        getKey={(p: any) => p.id}
                                        getSearchText={(p: any) => `${p.name || ''} ${p.code || ''}`}
                                        getTriggerLabel={() => products?.find((p: any) => p.id === filterProduct)?.name ?? 'All'}
                                        renderItem={(p: any) => (
                                            <span className="flex items-center gap-2 min-w-0">
                                                {p.image_url ? (
                                                    <img
                                                        src={p.image_url}
                                                        alt=""
                                                        className="w-6 h-6 rounded-md object-cover border border-ant-ink/5 shrink-0"
                                                    />
                                                ) : (
                                                    <span className="w-6 h-6 rounded-md bg-ant-ink/5 flex items-center justify-center shrink-0">
                                                        <Package className="w-3 h-3 text-ant-mid" />
                                                    </span>
                                                )}
                                                <span className="truncate">{p.name}</span>
                                            </span>
                                        )}
                                    />
                                </div>

                                {/* Source */}
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-ant-mid uppercase tracking-wider flex items-center gap-1">
                                        <ExternalLink className="w-3 h-3" /> Source
                                    </span>
                                    <SearchableFilter
                                        value={filterSource}
                                        onChange={setFilterSource}
                                        allLabel="All Sources"
                                        placeholder="Search sources..."
                                        activeClass="border-cyan-200 bg-cyan-50/50 text-cyan-700"
                                        items={SALES_SOURCES.map((s) => ({ id: s, name: s }))}
                                        getKey={(s: any) => s.id}
                                        getSearchText={(s: any) => s.name}
                                        getTriggerLabel={() => filterSource !== 'all' ? (
                                            <span className="inline-flex items-center gap-1.5 capitalize">
                                                <SourceIcon source={filterSource} />
                                                {filterSource}
                                            </span>
                                        ) : 'All'}
                                        renderItem={(s: any) => (
                                            <span className="flex items-center gap-2 capitalize">
                                                <SourceIcon source={s.id} />
                                                <span className="truncate">{s.name}</span>
                                            </span>
                                        )}
                                    />
                                </div>

                                {/* Confirmed By */}
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-ant-mid uppercase tracking-wider flex items-center gap-1">
                                        <CheckCircle2 className="w-3 h-3" /> Confirmed By
                                    </span>
                                    <SearchableFilter
                                        value={filterConfirmedBy}
                                        onChange={setFilterConfirmedBy}
                                        allLabel="All Users"
                                        placeholder="Search users..."
                                        activeClass="border-green-200 bg-green-50/50 text-green-700"
                                        items={confirmers}
                                        getKey={(u: any) => u.id}
                                        getSearchText={(u: any) => u.name || ''}
                                        getTriggerLabel={() => confirmers?.find((u: any) => u.id === filterConfirmedBy)?.name ?? 'All'}
                                        renderItem={(u: any) => (
                                            <span className="flex items-center gap-2 min-w-0">
                                                <Avatar className="w-6 h-6 shrink-0 border border-ant-ink/5">
                                                    {u.avatar_url && <AvatarImage src={u.avatar_url} />}
                                                    <AvatarFallback className="text-[9px] font-semibold bg-ant-ink/5 text-ant-ink">
                                                        {(u.name || '?').slice(0, 2).toUpperCase()}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <span className="truncate">{u.name}</span>
                                            </span>
                                        )}
                                    />
                                </div>

                                {/* Assigned To */}
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-ant-mid uppercase tracking-wider flex items-center gap-1">
                                        <User className="w-3 h-3" /> Assigned To
                                    </span>
                                    <SearchableFilter
                                        value={filterAssignedTo}
                                        onChange={setFilterAssignedTo}
                                        allLabel="All Commercials"
                                        placeholder="Search commercials..."
                                        activeClass="border-indigo-200 bg-indigo-50/50 text-indigo-700"
                                        items={sellers}
                                        getKey={(s: any) => s.id}
                                        getSearchText={(s: any) => s.name || ''}
                                        getTriggerLabel={() => sellers?.find((s: any) => s.id === filterAssignedTo)?.name ?? 'All'}
                                        renderItem={(s: any) => (
                                            <span className="flex items-center gap-2 min-w-0">
                                                <Avatar className="w-6 h-6 shrink-0 border border-ant-ink/5">
                                                    {s.avatar_url && <AvatarImage src={s.avatar_url} />}
                                                    <AvatarFallback className="text-[9px] font-semibold bg-ant-ink/5 text-ant-ink">
                                                        {(s.name || '?').slice(0, 2).toUpperCase()}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <span className="truncate">{s.name}</span>
                                            </span>
                                        )}
                                    />
                                </div>

                                {/* Delivery Service */}
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-ant-mid uppercase tracking-wider flex items-center gap-1">
                                        <Truck className="w-3 h-3" /> Delivery
                                    </span>
                                    <SearchableFilter
                                        value={filterProvider}
                                        onChange={setFilterProvider}
                                        allLabel="All Services"
                                        placeholder="Search providers..."
                                        activeClass="border-ant-orange/30 bg-ant-orange/10/50 text-ant-orange"
                                        items={allProviders}
                                        getKey={(p: any) => p.id}
                                        getSearchText={(p: any) => p.name || ''}
                                        getTriggerLabel={() => {
                                            const p = allProviders.find((x: any) => x.id === filterProvider);
                                            return p?.name ?? 'All';
                                        }}
                                        renderItem={(p: any) => {
                                            const img = p.type === 'courier' ? p.avatar_url : p.logo_url;
                                            return (
                                                <span className="flex items-center gap-2 min-w-0">
                                                    {img ? (
                                                        <img
                                                            src={img}
                                                            alt=""
                                                            className="w-6 h-6 rounded-md object-cover bg-white border border-ant-ink/5 shrink-0"
                                                        />
                                                    ) : (
                                                        <span className="w-6 h-6 rounded-md bg-ant-ink/5 flex items-center justify-center shrink-0">
                                                            {p.type === 'courier'
                                                                ? <Truck className="w-3 h-3 text-ant-mid" />
                                                                : <Building2 className="w-3 h-3 text-ant-mid" />}
                                                        </span>
                                                    )}
                                                    <span className="truncate">{p.name}</span>
                                                </span>
                                            );
                                        }}
                                    />
                                </div>

                                {/* Exchange Filter */}
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-ant-mid uppercase tracking-wider flex items-center gap-1">
                                        <RefreshCcw className="w-3 h-3" /> Exchange
                                    </span>
                                    <Select value={filterExchange} onValueChange={setFilterExchange}>
                                        <SelectTrigger className={cn("h-10 rounded-xl text-xs font-bold transition-all", filterExchange !== 'all' ? "border-red-200 bg-ant-rose/10/50 text-ant-rose" : "border-ant-line bg-ant-paper text-ant-ink")}>
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-none shadow-[0_12px_40px_-20px_rgba(20,20,19,0.3)]">
                                            <SelectItem value="all" className="font-bold text-xs rounded-xl">All Orders</SelectItem>
                                            <SelectItem value="yes" className="font-bold text-xs rounded-xl">Yes (Exchange)</SelectItem>
                                            <SelectItem value="no" className="font-bold text-xs rounded-xl">No (Normal)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Content Section */}
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-64 w-full rounded-2xl" />
                    ))}
                </div>
            ) : filteredOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-6 bg-ant-paper rounded-2xl shadow-sm border border-ant-line">
                    <div className="w-24 h-24 bg-ant-ink/[0.04] rounded-full flex items-center justify-center">
                        <ShoppingCart className="w-12 h-12 text-ant-mid" />
                    </div>
                    <div className="text-center space-y-2">
                        <h3 className="text-2xl font-bold text-ant-ink">No orders found</h3>
                        <p className="text-ant-muted max-w-xs mx-auto">Start by adding your first customer order to track its progress.</p>
                    </div>
                </div>
            ) : (
                <>
                    {viewMode === 'grid' ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-20">
                                {filteredOrders.map((order) => {
                                            const isDuplicateClient = duplicatePhones.has(order.phone);
                                            const allParcels = [...(order.parcels || []), ...(order.courier_parcels || [])].filter((p: any) => p.tracking_code);
                                            const latestParcel = allParcels.sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())?.[0];
                                            const trackingCode = latestParcel?.tracking_code;
                                            const hasTrackableCourierParcel = (order.courier_parcels || []).some((p: any) => p?.tracking_code && String(p.tracking_code).trim());
                                            const canTrackParcel = !!getLatestTrackableCompanyParcel(order) || hasTrackableCourierParcel;
                                            const cardFirstItem = (Array.isArray(order.items) ? order.items : [])
                                                .find((it: any) => it?.product?.image_url || it?.accessory?.image_url);
                                            const cardProductThumb: string | null =
                                                cardFirstItem?.product?.image_url || cardFirstItem?.accessory?.image_url || null;
                                            const cardProductLabel: string =
                                                cardFirstItem?.product?.name
                                                || cardFirstItem?.accessory?.name
                                                || (order.items || []).find((i: any) => i?.product?.name)?.product?.name
                                                || (order.items || []).find((i: any) => i?.accessory?.name)?.accessory?.name
                                                || '';
                                            const cardProductCode: string =
                                                cardFirstItem?.product?.code || cardFirstItem?.accessory?.code || '';
                                            return (
                                                <div
                                        key={order.id}
                                        className={cn(
                                            "group relative bg-ant-paper rounded-2xl border overflow-hidden transition-all duration-300 hover:shadow-lg cursor-default",
                                            selectedOrders.includes(order.id)
                                                ? "border-ant-ink/20 shadow-md ring-1 ring-ant-ink/10"
                                                : "border-ant-line shadow-sm hover:border-ant-ink/10"
                                        )}
                                    >
                                        {/* Top accent line — `overflow-hidden` on the card keeps the
                                            stripe inside the rounded corners. */}
                                        <div className="h-[3px]" style={{ backgroundColor: order.status?.color || '#cbd5e1' }} />

                                        <div className="p-4 space-y-3">
                                            {/* Row 1: Status + Package + Checkbox */}
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
                                                    <Checkbox
                                                        checked={selectedOrders.includes(order.id)}
                                                        onCheckedChange={() => toggleOrderSelection(order.id)}
                                                        className="h-4 w-4 rounded border-ant-ink/15 data-[state=checked]:bg-ant-ink data-[state=checked]:text-ant-light shrink-0"
                                                    />
                                                    <span
                                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide"
                                                        style={{ backgroundColor: `${order.status?.color}12`, color: order.status?.color }}
                                                    >
                                                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: order.status?.color }} />
                                                        {order.status?.label || 'DRAFT'}
                                                    </span>
                                                    {(() => {
                                                        const courierPkg = getCourierPackageStatus(order);
                                                        const pkgLabel = order.package_status?.label || order.package_status_label || courierPkg?.label;
                                                        const pkgColor = order.package_status?.color || courierPkg?.color || null;
                                                        if (!pkgLabel) return null;
                                                        return (
                                                            <span
                                                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide"
                                                                style={{
                                                                    backgroundColor: pkgColor ? `${pkgColor}12` : 'rgba(0,31,63,0.04)',
                                                                    color: pkgColor || 'rgba(0,31,63,0.5)',
                                                                }}
                                                            >
                                                                <Truck className="w-3 h-3" />
                                                                {pkgLabel}
                                                            </span>
                                                        );
                                                    })()}
                                                    {order.replace && (
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-ant-rose/10 text-ant-rose text-[10px] font-bold">
                                                            <RefreshCcw className="w-2.5 h-2.5" />EXCH
                                                        </span>
                                                    )}
                                                </div>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <button className="w-7 h-7 rounded-lg flex items-center justify-center text-ant-ink/25 hover:text-ant-ink hover:bg-ant-ink/5 transition-colors shrink-0">
                                                            <MoreVertical className="w-4 h-4" />
                                                        </button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="rounded-xl border-none shadow-2xl p-1.5 min-w-[160px]">
                                                        <DropdownMenuItem onClick={() => { setSelectedOrder(order); setIsViewModalOpen(true); }} className="rounded-lg px-3 py-2 cursor-pointer gap-2.5 text-xs font-bold">
                                                            <Eye className="w-3.5 h-3.5" /> View Details
                                                        </DropdownMenuItem>
                                                        <OrderContactSubmenu phone={order.phone} />
                                                        <DropdownMenuItem
                                                            disabled={!canTrackParcel}
                                                            onClick={() => {
                                                                if (!canTrackParcel) return;
                                                                setParcelTrackingOrderId(order.id);
                                                                setParcelTrackingOpen(true);
                                                            }}
                                                            className="rounded-lg px-3 py-2 cursor-pointer gap-2.5 text-xs font-bold"
                                                        >
                                                            <Truck className="w-3.5 h-3.5" /> Track
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => handleEdit(order)} className="rounded-lg px-3 py-2 cursor-pointer gap-2.5 text-xs font-bold">
                                                            <Edit2 className="w-3.5 h-3.5" /> Edit Order
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem
                                                            onClick={() => setOrderPendingDelete({ id: order.id, name: order.name })}
                                                            className="rounded-lg px-3 py-2 cursor-pointer text-ant-rose focus:bg-ant-rose/10 focus:text-ant-rose gap-2.5 text-xs font-bold"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" /> Delete
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>

                                            {/* Row 2: Customer + Seller */}
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                                    <ImageHoverPreview imageUrl={cardProductThumb} name={cardProductLabel} code={cardProductCode}>
                                                        <div
                                                            className={cn(
                                                                'w-9 h-9 rounded-lg shrink-0 overflow-hidden flex items-center justify-center',
                                                                isDuplicateClient ? 'ring-1 ring-[#d4c438]/40' : 'bg-ant-ink/[0.04] border border-ant-line/60'
                                                            )}
                                                        >
                                                            {cardProductThumb ? (
                                                                <img
                                                                    src={cardProductThumb}
                                                                    alt={cardProductLabel}
                                                                    className="w-full h-full object-cover"
                                                                    loading="lazy"
                                                                />
                                                            ) : (
                                                                <Package className="w-4 h-4 text-ant-mid" />
                                                            )}
                                                        </div>
                                                    </ImageHoverPreview>
                                                    <div className="min-w-0">
                                                        <p
                                                            className={cn(
                                                                'text-sm font-bold truncate leading-tight',
                                                                isDuplicateClient ? 'text-[#9a7f00]' : 'text-ant-ink'
                                                            )}
                                                            title={isDuplicateClient ? 'Same phone number on multiple orders' : undefined}
                                                        >
                                                            {order.name}
                                                        </p>
                                                        <p className="text-[11px] text-ant-mid font-medium tracking-wide truncate">{order.phone}</p>
                                                    </div>
                                                </div>
                                                {order.assignee ? (
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        <Avatar className="w-6 h-6 border border-white shadow-sm">
                                                            <AvatarImage src={order.assignee.avatar_url} />
                                                            <AvatarFallback className="bg-ant-ink/10 text-ant-ink text-[9px] font-bold">
                                                                {order.assignee.name?.[0]}
                                                            </AvatarFallback>
                                                        </Avatar>
                                                        <span className="text-[10px] font-bold text-ant-mid truncate max-w-[60px]">{order.assignee.name}</span>
                                                    </div>
                                                ) : (
                                                    <span className="text-[10px] italic text-ant-mid">—</span>
                                                )}
                                            </div>

                                            {/* Row 3: Metadata chips */}
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                {order.city?.name && (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-ant-ink/[0.03] text-[10px] font-bold text-ant-ink/60">
                                                        <MapPin className="w-3 h-3 text-ant-mid" />{order.city.name}
                                                    </span>
                                                )}
                                                {order.source_name && (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-ant-ink/[0.03] text-[10px] font-bold text-ant-ink/60 capitalize">
                                                        <Hash className="w-3 h-3 text-ant-mid" />{order.source_name}
                                                    </span>
                                                )}
                                                {(order.company?.name || order.courier?.name) && (
                                                    <span className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-lg bg-ant-ink/[0.03] text-[10px] font-bold text-ant-ink/60">
                                                        {order.company?.logo_url ? (
                                                            <img src={order.company.logo_url} alt="" className="w-4 h-4 rounded-full object-contain bg-white" />
                                                        ) : order.courier?.avatar_url ? (
                                                            <img src={order.courier.avatar_url} alt="" className="w-4 h-4 rounded-full object-cover" />
                                                        ) : (
                                                            <span className="w-4 h-4 rounded-full bg-ant-ink/10 flex items-center justify-center text-[8px] font-semibold text-ant-ink/60">
                                                                {(order.company?.name || order.courier?.name || '?').slice(0, 1).toUpperCase()}
                                                            </span>
                                                        )}
                                                        {order.company?.name || order.courier?.name}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Row 4: Tracking code */}
                                            {trackingCode && (
                                                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-indigo-50/60 border border-indigo-100/60">
                                                    <Package className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                                    <span className="text-[11px] font-mono font-bold text-indigo-700 truncate">{trackingCode}</span>
                                                </div>
                                            )}

                                            {/* Row 5: Reported recall */}
                                            {isOrderCategory(order.order_status_id, 'postponed') && order.reported_date && (
                                                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-ant-orange/10 border border-ant-orange/25">
                                                    <div className="flex items-center gap-2">
                                                        <Calendar className="w-3.5 h-3.5 text-ant-orange" />
                                                        <span className="text-[11px] font-bold text-amber-800">
                                                            {format(new Date(order.reported_date), 'dd MMM yyyy')}
                                                        </span>
                                                    </div>
                                                    <span className="text-[10px] font-bold bg-ant-orange text-white px-1.5 py-0.5 rounded">
                                                        {format(new Date(order.reported_date), 'HH:mm')}
                                                    </span>
                                                </div>
                                            )}

                                            {/* Row 6: Footer — Price + View */}
                                            <div className="flex items-center justify-between pt-2 border-t border-ant-line gap-2">
                                                <div className="flex items-baseline gap-1 min-w-0">
                                                    <span className="text-xl font-semibold text-ant-ink tabular-nums">
                                                        {new Intl.NumberFormat('fr-FR').format(order.price || 0)}
                                                    </span>
                                                    <span className="text-[10px] font-bold text-ant-ink/35 uppercase">DH</span>
                                                </div>
                                                <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                                                    <button
                                                        type="button"
                                                        onClick={() => { setSelectedOrder(order); setIsViewModalOpen(true); }}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ant-ink/[0.05] hover:bg-ant-ink text-ant-mid hover:text-white text-[11px] font-bold transition-all duration-200"
                                                    >
                                                        <Eye className="w-3.5 h-3.5" />View
                                                    </button>
                                                    <OrderPhoneContactDropdown phone={order.phone} variant="contact" />
                                                    <button
                                                        type="button"
                                                        disabled={!canTrackParcel}
                                                        onClick={() => {
                                                            if (!canTrackParcel) return;
                                                            setParcelTrackingOrderId(order.id);
                                                            setParcelTrackingOpen(true);
                                                        }}
                                                        className={cn(
                                                            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ant-ink/[0.05] hover:bg-ant-ink text-ant-mid hover:text-white text-[11px] font-bold transition-all duration-200',
                                                            !canTrackParcel && 'opacity-40 pointer-events-none'
                                                        )}
                                                    >
                                                        <Truck className="w-3.5 h-3.5" />
                                                        Track
                                                    </button>
                                                    <button
                                                        type="button"
                                                        title="Status history"
                                                        onClick={() => setHistoryDialogOrder(order)}
                                                        className="w-7 h-7 rounded-lg flex items-center justify-center bg-ant-ink/[0.05] hover:bg-ant-ink text-ant-mid hover:text-white transition-all duration-200"
                                                    >
                                                        <Package className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <OrdersListView
                            orders={filteredOrders}
                            selectedOrders={selectedOrders}
                            duplicatePhones={duplicatePhones}
                            toggleOrderSelection={toggleOrderSelection}
                            toggleSelectAll={toggleSelectAll}
                            onView={(order) => { setSelectedOrder(order); setIsViewModalOpen(true); }}
                            onEdit={handleEdit}
                            onDelete={(order) => setOrderPendingDelete(order)}
                            onTrackParcel={(id) => { setParcelTrackingOrderId(id); setParcelTrackingOpen(true); }}
                            onStatusHistory={setHistoryDialogOrder}
                            onQuickStatusChange={(order) => { setQuickStatusOrder(order); setIsQuickStatusOpen(true); }}
                            isOrderCategory={isOrderCategory}
                            getCourierPackageStatus={getCourierPackageStatus}
                        />
                    )}

                    {/* Pagination (Prev/Next — page size lives in the pill above) */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 mt-4">
                            <button
                                type="button"
                                onClick={() => setPage(Math.max(1, page - 1))}
                                disabled={page <= 1 || isLoading}
                                className="h-8 px-3 rounded-full border border-ant-line bg-ant-paper text-[12px] font-semibold text-ant-ink hover:bg-ant-light disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                            >
                                Previous
                            </button>
                            <span className="text-[12px] font-semibold text-ant-ink px-2 tabular-nums">
                                {page} <span className="text-ant-mid font-normal">/ {totalPages}</span>
                            </span>
                            <button
                                type="button"
                                onClick={() => setPage(Math.min(totalPages, page + 1))}
                                disabled={page >= totalPages || isLoading}
                                className="h-8 px-3 rounded-full border border-ant-line bg-ant-paper text-[12px] font-semibold text-ant-ink hover:bg-ant-light disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                            >
                                Next
                            </button>
                        </div>
                    )}

                    {/* Bulk Edit Bar */}
                    {selectedOrders.length > 0 && (
                        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-10 duration-500">
                            <div className="bg-ant-ink text-ant-light px-6 py-4 rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] flex flex-row items-center gap-4 md:gap-6 backdrop-blur-xl bg-ant-ink/90 border border-white/10 mx-4 w-max max-w-[95vw] overflow-x-auto custom-scrollbar">
                                <div className="flex items-center gap-3 pr-4 md:pr-6 border-r border-white/10 shrink-0">
                                    <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center font-semibold text-xs shrink-0">
                                        {selectedOrders.length}
                                    </div>
                                    <span className="text-sm font-bold whitespace-nowrap shrink-0">Orders Selected</span>
                                </div>

                                <div className="flex flex-row items-center justify-center gap-2 shrink-0">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setIsBulkStatusModalOpen(true)}
                                        className="text-ant-light hover:bg-white/10 rounded-2xl gap-2 font-bold px-4 shrink-0"
                                    >
                                        <ShieldCheck className="w-4 h-4" /> Change Status
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setIsAttributionModalOpen(true)}
                                        className="text-ant-light hover:bg-white/10 rounded-2xl gap-2 font-bold px-4 shrink-0"
                                    >
                                        <User className="w-4 h-4" /> Attribute Seller
                                    </Button>
                                    <div className="w-[1px] h-4 bg-white/10 mx-1 md:mx-2 shrink-0" />
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setSelectedOrders([])}
                                        className="text-red-400 hover:bg-ant-rose/10 rounded-2xl gap-2 font-bold px-4 shrink-0"
                                    >
                                        <X className="w-4 h-4" /> Cancel
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )
            }

            {/* Add/Edit Modal */}
            <Dialog
                open={isAddModalOpen || isEditModalOpen}
                onOpenChange={(v) => {
                    if (!v) {
                        setIsAddModalOpen(false);
                        setIsEditModalOpen(false);
                        setSelectedOrder(null);
                        // Defer form.reset so Radix completes its close cycle first.
                        // Resetting synchronously here leaves the overlay mounted until next click.
                        setTimeout(() => {
                            form.reset({
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
                                delivery_type: 'Home Delivery',
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
                            });
                        }, 0);
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

                            if (
                                isEditModalOpen &&
                                selectedOrder &&
                                targetStatusId !== selectedOrder.order_status_id &&
                                statusRequiresHistoryComment(targetStatusId) &&
                                !values.history_comment?.trim()
                            ) {
                                form.setError('history_comment', { type: 'manual', message: 'Comment is required for this status.' });
                                toast({ title: "Validation Error", description: "Please provide a reason for this status.", variant: "destructive" });
                                return;
                            }

                            const targetIsPostponed =
                                !!REPORTED_STATUS_ID &&
                                (targetStatusId === REPORTED_STATUS_ID ||
                                    isOrderCategory(targetStatusId, 'postponed'));
                            const sourceWasPostponed =
                                isEditModalOpen &&
                                selectedOrder &&
                                (selectedOrder.order_status_id === REPORTED_STATUS_ID ||
                                    isOrderCategory(selectedOrder.order_status_id, 'postponed'));
                            if (targetIsPostponed && !sourceWasPostponed && !(values as { _reportedDate?: string })._reportedDate?.trim()) {
                                toast({
                                    title: 'Reported date required',
                                    description: 'Choose the reported status and pick date/time in the popup before saving.',
                                    variant: 'destructive',
                                });
                                return;
                            }

                            if (!isEditModalOpen) {
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

                            if (isEditModalOpen) updateOrderMutation.mutate(values); else createOrderMutation.mutate(values);
                        })} className="flex flex-col h-full overflow-hidden">
                            <DialogHeader className="px-6 py-4 pr-12 shrink-0 border-b border-ant-line bg-ant-paper">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="w-1 h-1 rounded-full bg-ant-orange" />
                                    <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                        {isEditModalOpen ? 'Editing order' : 'Create order'}
                                    </span>
                                </div>
                                <DialogTitle className="font-display text-[24px] font-semibold text-ant-ink tracking-[-0.02em] leading-tight">
                                    {isEditModalOpen ? 'Update order' : 'New order'}
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
                                                                                    p.avatar_url ? (
                                                                                        <img src={p.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                                                                                    ) : (
                                                                                        <span className="w-5 h-5 rounded-full bg-ant-ink/10 flex items-center justify-center text-[9px] font-semibold text-ant-ink/60">
                                                                                            {(p.name || '?').slice(0, 1).toUpperCase()}
                                                                                        </span>
                                                                                    )
                                                                                ) : (
                                                                                    p.logo_url ? (
                                                                                        <img src={p.logo_url} alt="" className="w-5 h-5 rounded-full object-contain bg-white border border-ant-line" />
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

                                        {isEditModalOpen &&
                                            selectedOrder &&
                                            form.watch('order_status_id') !== selectedOrder.order_status_id &&
                                            statusRequiresHistoryComment(form.watch('order_status_id')) && (
                                            <FormField
                                                control={form.control}
                                                name="history_comment"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid flex items-center gap-1">
                                                            <MessageSquare className="w-3 h-3 text-ant-mid" /> Status change reason (required)
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Textarea placeholder="Explain why you are moving to this status…" {...field} className="min-h-[56px] resize-y rounded-lg border border-ant-line bg-ant-paper text-[13px] font-medium text-ant-ink placeholder:text-ant-mid focus-visible:ring-ant-orange focus-visible:ring-offset-0 focus-visible:border-ant-ink/25" />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        )}

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

                                        {form.watch('replace') &&
                                            orderCompanyIsColiaty(companies, form.watch('company_id')) && (
                                                <FormField
                                                    control={form.control}
                                                    name="coliaty_old_tracking"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-2 rounded-xl border border-ant-orange/30/80 bg-ant-orange/10/40 p-3">
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
                                                        <FormItem className="space-y-2 rounded-xl border border-ant-orange/30/80 bg-ant-orange/10/40 p-3">
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
                                                        <FormItem className="space-y-2 rounded-xl border border-ant-orange/30/80 bg-ant-orange/10/40 p-3">
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
                                                        <FormItem className="space-y-2 rounded-xl border border-ant-orange/30/80 bg-ant-orange/10/40 p-3">
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
                                                        <FormItem className="space-y-2 rounded-xl border border-ant-orange/30/80 bg-ant-orange/10/40 p-3">
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
                                                        <FormItem className="space-y-2 rounded-xl border border-ant-orange/30/80 bg-ant-orange/10/40 p-3">
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
                                    </div>
                                </div>

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
                                                                        blockZeroStock={!isEditModalOpen}
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
                                                                                        const currentAccessories = form.getValues(`items.${index}.accessories`) || [];
                                                                                        const newAccessories = [...currentAccessories];
                                                                                        attachments.forEach((attachment: any) => {
                                                                                            const existingAttached = newAccessories.find((a: any) => a.accessory_id === attachment.accessory_id);
                                                                                            if (!existingAttached) {
                                                                                                const acc = accessories?.find((a: any) => a.id === attachment.accessory_id);
                                                                                                newAccessories.push({
                                                                                                    accessory_id: attachment.accessory_id,
                                                                                                    accessory_quantity: attachment.default_quantity || 1,
                                                                                                    accessory_unit_price: acc ? Number(acc.cost_price || 0) : 0
                                                                                                });
                                                                                            }
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
                                                                            blockZeroStock={!isEditModalOpen}
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
                                                                    <Input type="number" {...field} disabled={!hasProduct} className="h-9 rounded-lg border border-ant-ink/10 bg-ant-ink/[0.03] text-sm font-bold text-ant-ink text-center px-1" />
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
                                                                                        if (selectedAccessory && selectedAccessory.stock !== null && selectedAccessory.stock !== undefined) {
                                                                                            if (selectedAccessory.stock === 0) {
                                                                                                return (
                                                                                                    <div className="mt-1 flex items-center gap-1.5 px-2 py-1 rounded-md bg-ant-rose/10 border border-red-200">
                                                                                                        <span className="text-[8px] font-bold text-ant-rose uppercase">Out of stock</span>
                                                                                                    </div>
                                                                                                );
                                                                                            } else if (selectedAccessory.stock < 10) {
                                                                                                return (
                                                                                                    <div className="mt-1 flex items-center gap-1.5 px-2 py-1 rounded-md bg-ant-orange/10 border border-ant-orange/30">
                                                                                                        <span className="text-[8px] font-bold text-ant-orange uppercase">Low: {selectedAccessory.stock}</span>
                                                                                                    </div>
                                                                                                );
                                                                                            }
                                                                                        }
                                                                                        return null;
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
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            setIsAddModalOpen(false);
                                            setIsEditModalOpen(false);
                                        }}
                                        className="rounded-lg h-9 px-4 text-sm font-bold text-ant-ink hover:bg-ant-ink/10 m-0"
                                    >
                                        Discard
                                    </Button>
                                    <Button
                                        type="submit"
                                        size="sm"
                                        disabled={
                                            createOrderMutation.isPending ||
                                            updateOrderMutation.isPending ||
                                            (!isEditModalOpen && newOrderHasZeroStockProduct)
                                        }
                                        className="bg-ant-ink hover:bg-ant-ink/90 text-ant-light rounded-lg h-9 px-6 sm:px-8 text-sm font-bold shadow-md transition-all active:scale-[0.98] flex items-center gap-2 m-0"
                                    >
                                        {(createOrderMutation.isPending || updateOrderMutation.isPending) && <Loader2 className="w-4 h-4 animate-spin" />}
                                        {isEditModalOpen ? 'Save Changes' : 'Confirm Order'}
                                    </Button>
                                </div>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* View Modal */}
            <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
                <DialogContent className="ant-surface max-w-4xl p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden flex flex-col h-[90vh] md:h-auto md:max-h-[90vh]">
                    {selectedOrder && (
                        <div className="flex flex-col h-full overflow-hidden">
                            <div className="p-8 pb-0 flex flex-col md:flex-row justify-between items-start gap-6 shrink-0">
                                <div className="space-y-4">
                                    <div className="flex items-center gap-4">
                                        <div className="w-14 h-14 rounded-2xl bg-ant-ink flex items-center justify-center text-ant-light">
                                            <ShoppingCart className="w-6 h-6" strokeWidth={1.75} />
                                        </div>
                                        <div>
                                            <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                                <span className="w-1 h-1 rounded-full bg-ant-orange" />
                                                Order details
                                            </span>
                                            <h2 className="font-display text-[28px] font-semibold text-ant-ink tracking-[-0.02em] mt-0.5">
                                                {selectedOrder.name}
                                            </h2>
                                            <div className="flex items-center gap-4 text-ant-muted text-[12px] mt-1">
                                                <span className="flex items-center gap-1.5 tabular-nums">
                                                    <Calendar className="w-3.5 h-3.5 text-ant-mid" />
                                                    {format(new Date(selectedOrder.date || selectedOrder.created_at), 'MMMM dd, yyyy')}
                                                </span>
                                                <span className="flex items-center gap-1.5 tabular-nums">
                                                    {selectedOrder.phone}
                                                    <OrderPhoneQuickActions phone={selectedOrder.phone} className="h-7 w-7" />
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <div className="flex items-center gap-2 px-4 py-2 rounded-xl shadow-sm border border-ant-line" style={{ backgroundColor: `${selectedOrder.status?.color}12` }}>
                                            {selectedOrder.status?.icon ? (
                                                <DynamicIcon name={selectedOrder.status.icon} className="w-4 h-4" style={{ color: selectedOrder.status?.color }} />
                                            ) : (
                                                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: selectedOrder.status?.color }} />
                                            )}
                                            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: selectedOrder.status?.color }}>
                                                {selectedOrder.status?.label || 'DRAFT'}
                                            </span>
                                        </div>
                                        {(() => {
                                            const courierPkg = getCourierPackageStatus(selectedOrder);
                                            const pkgLabel = selectedOrder.package_status?.label || selectedOrder.package_status_label || courierPkg?.label;
                                            const pkgColor = selectedOrder.package_status?.color || courierPkg?.color || null;
                                            if (!pkgLabel) return null;
                                            return (
                                                <div className="flex items-center gap-2 px-4 py-2 rounded-xl shadow-sm border border-ant-line" style={{ backgroundColor: pkgColor ? `${pkgColor}12` : 'rgba(0,31,63,0.04)' }}>
                                                    {selectedOrder.package_status?.icon ? (
                                                        <DynamicIcon name={selectedOrder.package_status.icon} className="w-4 h-4" style={{ color: pkgColor || undefined }} />
                                                    ) : pkgColor ? (
                                                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: pkgColor }} />
                                                    ) : (
                                                        <Truck className="w-4 h-4" style={{ color: pkgColor || undefined }} />
                                                    )}
                                                    <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: pkgColor || 'rgba(0,31,63,0.45)' }}>
                                                        {pkgLabel}
                                                    </span>
                                                </div>
                                            );
                                        })()}
                                        <Badge variant="outline" className="border-ant-ink/10 text-ant-ink font-bold uppercase tracking-widest px-4 py-2 rounded-xl text-[10px]">
                                            {selectedOrder.source_name}
                                        </Badge>
                                        {selectedOrder.replace && (
                                            <Badge className="bg-ant-rose text-white font-semibold uppercase tracking-widest px-4 py-2 rounded-xl text-[10px]">
                                                Exchange
                                            </Badge>
                                        )}
                                        {orderParcel?.tracking_code && (
                                            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-50 border border-indigo-100">
                                                <Package className="w-4 h-4 text-indigo-500" />
                                                <span className="text-xs font-semibold uppercase tracking-widest text-indigo-600">
                                                    {orderParcel.tracking_code}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="p-8 pb-10 flex items-center justify-between border-b-2 border-ant-ink/5 bg-gradient-to-br from-ant-ink/[0.02] to-transparent">
                                    <div className="space-y-1">
                                        <p className="text-sm font-semibold text-ant-mid uppercase tracking-widest">Total Order Value</p>
                                        <h3 className="text-4xl font-semibold text-ant-ink">{selectedOrder.price || 0} <span className="text-lg">DH</span></h3>
                                    </div>
                                    {selectedOrder.include_delivery_in_total && selectedOrder.shipping_cost > 0 && (
                                        <div className="text-[10px] font-bold text-ant-mid uppercase tracking-tighter">
                                            Products + {selectedOrder.shipping_cost} DH delivery
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="overflow-y-auto p-10 space-y-10 flex-1 custom-scrollbar">
                                {/* Customer Insights in Preview */}
                                <CustomerInsights phone={selectedOrder.phone || ''} />

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                    {/* Logistics Info */}
                                    <div className="space-y-6">
                                        <div className="flex items-center gap-3 border-b border-ant-line pb-3">
                                            <Truck className="w-6 h-6 text-ant-mid" />
                                            <h4 className="text-lg font-semibold text-ant-ink uppercase tracking-widest">Delivery Details</h4>
                                        </div>
                                        <div className="space-y-6">
                                            <div className="flex items-start gap-4">
                                                <div className="w-10 h-10 rounded-2xl bg-orange-50 flex items-center justify-center text-orange-500 shrink-0 shadow-sm shadow-orange-500/10">
                                                    <MapPinned className="w-5 h-5" />
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest leading-none">Destination</p>
                                                    <p className="text-lg font-bold text-ant-ink leading-tight">{selectedOrder.city?.name}</p>
                                                    <p className="text-sm font-medium text-ant-muted italic">"{selectedOrder.address}"</p>
                                                </div>
                                            </div>
                                            <div className="flex items-start gap-4">
                                                <div className="w-10 h-10 rounded-2xl bg-ant-blue/10 flex items-center justify-center text-ant-blue shrink-0 shadow-sm shadow-blue-500/10">
                                                    <ShoppingCart className="w-5 h-5" />
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest leading-none">Shipping Configuration</p>
                                                    <p className="text-lg font-bold text-ant-ink leading-tight">{selectedOrder.delivery_type || 'Standard Delivery'}</p>
                                                    <p className="text-sm font-bold text-ant-green uppercase tracking-widest">{selectedOrder.shipping_cost === 0 ? 'Free Shipping' : `Paid: ${selectedOrder.shipping_cost} DH`}</p>
                                                </div>
                                            </div>
                                            {(selectedOrder.courier || selectedOrder.company) && (
                                                <div className="flex items-start gap-4">
                                                    <div className="w-10 h-10 rounded-2xl bg-ant-ink/5 flex items-center justify-center text-ant-mid shrink-0 shadow-sm overflow-hidden">
                                                        {selectedOrder.company?.logo_url ? (
                                                            <img src={selectedOrder.company.logo_url} alt={selectedOrder.company.name} className="w-full h-full object-contain" />
                                                        ) : selectedOrder.courier?.avatar_url ? (
                                                            <img src={selectedOrder.courier.avatar_url} alt={selectedOrder.courier.name} className="w-full h-full object-cover" />
                                                        ) : (
                                                            selectedOrder.courier ? <Truck className="w-5 h-5 text-orange-500" /> : <Building2 className="w-5 h-5 text-ant-blue" />
                                                        )}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest leading-none">Assigned Provider</p>
                                                        <p className="text-lg font-bold text-ant-ink leading-tight">
                                                            {selectedOrder.courier?.name || selectedOrder.company?.name}
                                                        </p>
                                                        <Badge variant="outline" className="h-5 px-2 text-[8px] font-semibold uppercase tracking-tighter bg-ant-ink/[0.03] text-ant-mid border-none">
                                                            {selectedOrder.courier ? 'Independent Courier' : 'Delivery Company'}
                                                        </Badge>
                                                    </div>
                                                </div>
                                            )}
                                            {String(selectedOrder.coliaty_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-4">
                                                    <div className="w-10 h-10 rounded-2xl bg-ant-orange/10 flex items-center justify-center text-ant-orange shrink-0 shadow-sm shadow-amber-500/10">
                                                        <RefreshCcw className="w-5 h-5" />
                                                    </div>
                                                    <div className="space-y-1 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest leading-none">
                                                            Previous parcel tracking (Coliaty)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(selectedOrder.coliaty_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(selectedOrder.ameex_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-4">
                                                    <div className="w-10 h-10 rounded-2xl bg-ant-orange/10 flex items-center justify-center text-ant-orange shrink-0 shadow-sm shadow-amber-500/10">
                                                        <RefreshCcw className="w-5 h-5" />
                                                    </div>
                                                    <div className="space-y-1 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest leading-none">
                                                            Previous parcel tracking (AMEEX)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(selectedOrder.ameex_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(selectedOrder.quicklivraison_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-4">
                                                    <div className="w-10 h-10 rounded-2xl bg-ant-orange/10 flex items-center justify-center text-ant-orange shrink-0 shadow-sm shadow-amber-500/10">
                                                        <RefreshCcw className="w-5 h-5" />
                                                    </div>
                                                    <div className="space-y-1 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest leading-none">
                                                            Previous parcel tracking (Quick Livraison)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(selectedOrder.quicklivraison_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(selectedOrder.forcelog_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-4">
                                                    <div className="w-10 h-10 rounded-2xl bg-ant-orange/10 flex items-center justify-center text-ant-orange shrink-0 shadow-sm shadow-amber-500/10">
                                                        <RefreshCcw className="w-5 h-5" />
                                                    </div>
                                                    <div className="space-y-1 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest leading-none">
                                                            Previous parcel tracking (Forcelog)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(selectedOrder.forcelog_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(selectedOrder.sendit_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-4">
                                                    <div className="w-10 h-10 rounded-2xl bg-ant-orange/10 flex items-center justify-center text-ant-orange shrink-0 shadow-sm shadow-amber-500/10">
                                                        <RefreshCcw className="w-5 h-5" />
                                                    </div>
                                                    <div className="space-y-1 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest leading-none">
                                                            Previous parcel tracking (Sendit)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(selectedOrder.sendit_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(selectedOrder.delvoexpress_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-4">
                                                    <div className="w-10 h-10 rounded-2xl bg-ant-orange/10 flex items-center justify-center text-ant-orange shrink-0 shadow-sm shadow-amber-500/10">
                                                        <RefreshCcw className="w-5 h-5" />
                                                    </div>
                                                    <div className="space-y-1 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest leading-none">
                                                            Previous parcel tracking (Delevo Express)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(selectedOrder.delvoexpress_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Internal Notes */}
                                    <div className="space-y-6">
                                        <div className="flex items-center gap-3 border-b border-ant-line pb-3">
                                            <MessageSquare className="w-6 h-6 text-ant-mid" />
                                            <h4 className="text-lg font-semibold text-ant-ink uppercase tracking-widest">Client & Note Info</h4>
                                        </div>
                                        <div className="space-y-4">
                                            <div className="p-6 rounded-2xl bg-ant-light border border-ant-line space-y-2">
                                                <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest">Internal Instruction</p>
                                                <p className="text-sm font-medium text-ant-ink">{selectedOrder.note || 'No internal notes provided.'}</p>
                                            </div>
                                            <div className="p-6 rounded-2xl bg-ant-light border border-ant-line space-y-2">
                                                <p className="text-[10px] font-semibold uppercase text-ant-muted/60 tracking-widest text-ant-mid text-ant-blue">Public Delivery Note</p>
                                                <p className="text-sm font-bold text-ant-ink italic">"{selectedOrder.delivery_note || 'No special delivery instructions.'}"</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <Separator className="bg-ant-ink/[0.05]" />

                                {/* Order Items Table */}
                                <div className="space-y-6 pb-6">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Package className="w-6 h-6 text-ant-mid" />
                                            <h4 className="text-xl font-semibold text-ant-ink uppercase tracking-[0.15em]">Cart Items</h4>
                                        </div>
                                        <Badge variant="outline" className="text-xs font-semibold border-ant-ink/10 tracking-widest rounded-xl px-4 py-1.5 h-auto">
                                            {selectedOrder.items?.length || 0} Unique SKU(s)
                                        </Badge>
                                    </div>
                                    <div className="grid grid-cols-1 gap-4">
                                        {(() => {
                                            const displayItems: any[] = [];
                                            selectedOrder.items?.forEach((item: any) => {
                                                if (item.product_id && Number(item.quantity) > 0) {
                                                    displayItems.push({ ...item, accessoriesList: item.accessory_id ? [item] : [] });
                                                } else if (item.product_id && Number(item.quantity) === 0) {
                                                    const parent = displayItems.find(l => l.product_id === item.product_id);
                                                    if (parent) {
                                                        parent.accessoriesList.push(item);
                                                    } else {
                                                        displayItems.push({ ...item, accessoriesList: item.accessory_id ? [item] : [] });
                                                    }
                                                } else {
                                                    displayItems.push({ ...item, accessoriesList: item.accessory_id ? [item] : [] });
                                                }
                                            });

                                            return displayItems.map((item: any) => {
                                                const prodTotal = (item.quantity || 0) * (item.unit_price || 0);
                                                return (
                                                    <div
                                                        key={item.id}
                                                        className="group p-6 rounded-2xl bg-ant-light border border-ant-line flex flex-col gap-4 animate-in slide-in-from-bottom-2 duration-300"
                                                    >
                                                        {/* Product Info */}
                                                        {item.product && (
                                                            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                                                                <div className="flex items-center gap-5 flex-1 w-full md:w-auto">
                                                                    <div className="w-16 h-16 rounded-[20px] bg-ant-ink/5 flex items-center justify-center overflow-hidden shrink-0">
                                                                        {item.product?.image_url ? (
                                                                            <img src={item.product?.image_url} alt="" className="w-full h-full object-cover" />
                                                                        ) : (
                                                                            <Package className="w-8 h-8 text-ant-mid" />
                                                                        )}
                                                                    </div>
                                                                    <div>
                                                                        <h5 className="text-lg font-semibold text-ant-ink leading-none mb-1 group-hover:text-ant-blue transition-colors uppercase">{item.product?.name}</h5>
                                                                        <div className="flex items-center gap-3">
                                                                            <p className="text-[10px] font-bold text-ant-muted/60 tracking-widest bg-ant-ink/5 px-2 py-0.5 rounded-md inline-block">{item.product?.code}</p>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center justify-between md:justify-end w-full md:w-auto gap-8  md:gap-12 text-right">
                                                                    <div>
                                                                        <p className="text-[10px] font-semibold uppercase text-ant-muted/40 tracking-widest mb-1">Unit Price</p>
                                                                        <p className="text-lg font-semibold text-ant-ink">{item.unit_price} DH</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-semibold uppercase text-ant-muted/40 tracking-widest mb-1">Qty</p>
                                                                        <p className="text-lg font-semibold text-ant-ink">x{item.quantity}</p>
                                                                    </div>
                                                                    <div className="min-w-[80px] md:min-w-[100px]">
                                                                        <p className="text-[10px] font-semibold uppercase text-ant-muted/40 tracking-widest mb-1">Subtotal</p>
                                                                        <p className="text-xl font-semibold text-ant-ink">{prodTotal} DH</p>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Accessory Info List */}
                                                        {item.accessoriesList && item.accessoriesList.length > 0 && item.accessoriesList.map((accItem: any, idx: number) => {
                                                            const accTotal = (accItem.accessory_quantity || 0) * (accItem.accessory_unit_price || 0);
                                                            return (
                                                                <div key={accItem.id || idx} className="flex flex-col md:flex-row justify-between items-center gap-4 pt-4 border-t border-ant-line">
                                                                    <div className="flex items-center gap-5 flex-1 w-full md:w-auto">
                                                                        <div className="w-12 h-12 rounded-[16px] bg-ant-ink/5 flex items-center justify-center overflow-hidden shrink-0 md:ml-4">
                                                                            {accItem.accessory?.image_url ? (
                                                                                <img src={accItem.accessory?.image_url} alt="" className="w-full h-full object-cover" />
                                                                            ) : (
                                                                                <Puzzle className="w-5 h-5 text-ant-mid" />
                                                                            )}
                                                                        </div>
                                                                        <div>
                                                                            <h5 className="text-sm font-semibold text-ant-ink/70 leading-none mb-1 uppercase flex items-center gap-2">
                                                                                <Puzzle className="w-3 h-3" /> {accItem.accessory?.name}
                                                                            </h5>
                                                                            <p className="text-[10px] font-bold text-ant-muted/60 tracking-widest bg-ant-ink/5 px-2 py-0.5 rounded-md inline-block">{accItem.accessory?.code}</p>
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center justify-between md:justify-end w-full md:w-auto gap-8 md:gap-12 text-right">
                                                                        <div>
                                                                            <p className="text-[10px] font-semibold uppercase text-ant-muted/40 tracking-widest mb-1">Unit Cost</p>
                                                                            <p className="text-sm font-semibold text-ant-ink/80">{accItem.accessory_unit_price} DH</p>
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-[10px] font-semibold uppercase text-ant-muted/40 tracking-widest mb-1">Qty</p>
                                                                            <p className="text-sm font-semibold text-ant-ink/80">x{accItem.accessory_quantity}</p>
                                                                        </div>
                                                                        <div className="min-w-[80px] md:min-w-[100px]">
                                                                            <p className="text-[10px] font-semibold uppercase text-ant-muted/40 tracking-widest mb-1">Cost Total</p>
                                                                            <p className="text-sm font-semibold text-ant-ink/80">{accTotal} DH</p>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}

                                                        {item.product && (
                                                            <div className="pt-3 border-t border-ant-line flex justify-end">
                                                                <div className="bg-ant-green/10 text-ant-green px-4 py-2 rounded-2xl flex items-center gap-4">
                                                                    <span className="text-[10px] font-semibold uppercase tracking-widest opacity-60">Row Subtotal</span>
                                                                    <span className="text-xl font-semibold">{prodTotal} DH</span>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            });
                                        })()}
                                    </div>
                                </div>

                                {/* Parcel Info (no API call — use Track Order button for full timeline) */}
                                <div className="space-y-4 pb-6">
                                    <div className="flex items-center gap-3">
                                        <Truck className="w-6 h-6 text-ant-mid" />
                                        <h4 className="text-xl font-semibold text-ant-ink uppercase tracking-[0.15em]">Suivi du Colis</h4>
                                    </div>

                                    {isParcelLoading ? (
                                        <div className="flex items-center justify-center py-6">
                                            <Loader2 className="w-6 h-6 text-ant-ink animate-spin" />
                                        </div>
                                    ) : !orderParcel ? (
                                        <div className="text-center p-6 bg-ant-line-soft rounded-2xl border border-ant-line">
                                            <p className="text-sm font-bold text-ant-muted">Aucun colis créé pour cette commande.</p>
                                        </div>
                                    ) : (() => {
                                        const pkgMatch = matchPkgColor(orderParcel.status_label || '', orderParcel.status_label || '');
                                        const pColor = pkgMatch.color;
                                        const pIcon = pkgMatch.icon;
                                        return (
                                        <div className="flex items-center justify-between p-4 bg-ant-line-soft rounded-2xl border border-ant-line">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white" style={{ backgroundColor: pColor }}>
                                                    {pIcon ? <DynamicIcon name={pIcon} className="w-4 h-4" /> : <div className="w-2.5 h-2.5 rounded-full bg-white" />}
                                                </div>
                                                <div className="min-w-0">
                                                    <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-md" style={{ color: pColor, backgroundColor: `${pColor}15` }}>
                                                        {orderParcel.status_label || 'En attente'}
                                                    </span>
                                                    {orderParcel.tracking_code && (
                                                        <p className="text-[10px] font-mono font-bold text-ant-muted/50 truncate mt-1">{orderParcel.tracking_code}</p>
                                                    )}
                                                </div>
                                            </div>
                                            {orderParcel.tracking_code && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => { setParcelTrackingOrderId(selectedOrder.id); setParcelTrackingOpen(true); }}
                                                    className="text-xs font-bold text-ant-ink hover:bg-ant-ink/5 hover:text-ant-ink gap-2 rounded-xl h-9 px-4 shrink-0"
                                                >
                                                    <Truck className="w-3.5 h-3.5" />
                                                    Suivre
                                                </Button>
                                            )}
                                        </div>
                                        );
                                    })()}
                                </div>

                                <Separator className="bg-ant-ink/[0.05]" />

                                {/* Status History Timeline */}
                                <div className="space-y-6 pb-6">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <ShieldCheck className="w-6 h-6 text-ant-mid" />
                                            <h4 className="text-xl font-semibold text-ant-ink uppercase tracking-[0.15em]">Status History</h4>
                                        </div>
                                    </div>

                                    <div className="px-4">
                                        {(() => { const hist = (selectedOrder.history && selectedOrder.history.length > 0) ? selectedOrder.history : selectedOrderHistory; return hist && hist.length > 0; })() ? (
                                            <div className="relative pl-10">
                                                <div className="absolute left-[15px] top-4 bottom-4 w-0.5 bg-gradient-to-b from-ant-line via-ant-line to-ant-ink/30" />
                                                <div className="space-y-0">
                                                {[...((selectedOrder.history && selectedOrder.history.length > 0) ? selectedOrder.history : selectedOrderHistory)].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map((record: any, idx: number, arr: any[]) => {
                                                    const color = record.status?.color || '#94a3b8';
                                                    const isLast = idx === arr.length - 1;
                                                    const ordIcon = getOrdIcon(record.status_id);
                                                    const postponed = isOrderCategory(record.status_id, 'postponed');
                                                    const reportedMatch = postponed && record.comment?.match(/\[Reporté pour: (.*?)\]/);
                                                    const reportedText = reportedMatch?.[1] || (postponed && selectedOrder.reported_date ? format(new Date(selectedOrder.reported_date), 'dd/MM/yyyy HH:mm') : null);
                                                    const cleanedComment = postponed ? (record.comment || '').replace(/\[Reporté pour:.*?\]/, '').trim() : record.comment || '';
                                                    return (
                                                        <div key={record.id} className="relative pb-6 last:pb-0 group">
                                                            <div className={`absolute -left-10 top-0 w-8 h-8 rounded-full border-[3px] border-white shadow-sm flex items-center justify-center z-10 transition-all group-hover:scale-110 ${isLast ? 'ring-2 ring-offset-2' : ''}`} style={{ backgroundColor: isLast ? color : '#f8fafc', color: isLast ? '#ffffff' : color, ['--tw-ring-color' as any]: isLast ? `${color}40` : undefined }}>
                                                                {ordIcon ? <DynamicIcon name={ordIcon} className="w-3.5 h-3.5" /> : <div className="w-2 h-2 rounded-full" style={{ backgroundColor: isLast ? '#ffffff' : color }} />}
                                                            </div>
                                                            <div className="space-y-1.5">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-lg" style={{ color, backgroundColor: `${color}15` }}>{record.status?.label || 'Inconnu'}</span>
                                                                </div>
                                                                {record.created_at && <p className="text-[10px] font-bold text-ant-muted/50">{format(new Date(record.created_at), 'dd/MM/yyyy HH:mm')}</p>}
                                                                <div className="flex items-center gap-2">
                                                                    {(() => {
                                                                        // changed_by NULL + whatsapp-source order ⇒ the AI assistant acted on
                                                                        // behalf of the business itself. Show the business name + logo
                                                                        // instead of the generic "Système" pill.
                                                                        const isAiBusinessAction = !record.user && selectedOrder?.source_name === 'whatsapp';
                                                                        const displayName = record.user?.name
                                                                            || (isAiBusinessAction ? (businessIdentity?.name || 'Business') : 'Système');
                                                                        const displayAvatar = record.user?.avatar_url
                                                                            || (isAiBusinessAction ? businessIdentity?.logo : null);
                                                                        return (
                                                                            <>
                                                                                {displayAvatar ? (
                                                                                    <Avatar className="w-5 h-5 border bg-white">
                                                                                        <AvatarImage src={displayAvatar} />
                                                                                        <AvatarFallback className="text-[9px] font-bold bg-ant-ink/5 text-ant-ink">{displayName?.[0] || '?'}</AvatarFallback>
                                                                                    </Avatar>
                                                                                ) : (
                                                                                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-ant-ink/10 to-ant-ink/20 flex items-center justify-center">
                                                                                        <DynamicIcon name="TbRobot" className="w-3 h-3 text-ant-ink/60" />
                                                                                    </div>
                                                                                )}
                                                                                <span className="text-[11px] font-bold text-ant-ink/70 truncate max-w-[200px]">{displayName}</span>
                                                                            </>
                                                                        );
                                                                    })()}
                                                                </div>
                                                                {postponed && reportedText && (
                                                                    <div className="flex flex-col gap-1 p-3 bg-ant-orange/10 rounded-xl border border-ant-orange/25">
                                                                        <div className="flex items-center gap-2"><Calendar className="w-3 h-3 text-ant-orange" /><span className="text-[10px] font-semibold uppercase text-ant-orange">Rappel programmé</span></div>
                                                                        <p className="text-xs font-bold text-amber-900">{reportedText}</p>
                                                                        {cleanedComment && <p className="text-[11px] font-medium text-amber-800 italic mt-1 border-t border-amber-500/10 pt-1">"{cleanedComment}"</p>}
                                                                    </div>
                                                                )}
                                                                {!postponed && record.comment && <p className="text-[11px] font-medium text-ant-muted leading-relaxed italic">"{record.comment}"</p>}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-center p-8 bg-ant-line-soft rounded-3xl border border-ant-line">
                                                <p className="text-sm font-bold text-ant-muted">No tracking history available yet.</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <DialogFooter className="p-8 pb-10 flex gap-4 bg-ant-paper border-t border-ant-line">
                                <Button
                                    onClick={() => handleEdit(selectedOrder)}
                                    className="flex-1 bg-ant-ink hover:bg-ant-ink/90 text-ant-light rounded-3xl h-16 text-lg font-semibold shadow-2xl transition-all active:scale-95 flex items-center justify-center gap-3"
                                >
                                    <Edit2 className="w-6 h-6" /> Edit Sales Order
                                </Button>
                                <Button
                                    onClick={() => setIsViewModalOpen(false)}
                                    variant="ghost"
                                    className="rounded-3xl h-16 px-10 font-bold text-ant-ink hover:bg-muted"
                                >
                                    Done
                                </Button>
                            </DialogFooter>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Quick Status Change Modal */}
            <QuickStatusChangeModal
                open={isQuickStatusOpen}
                onOpenChange={(v) => {
                    setIsQuickStatusOpen(v);
                    if (!v) setQuickStatusOrder(null);
                }}
                order={quickStatusOrder}
                orderStatuses={orderStatusesForQuickStatus}
                isOrderCategory={isOrderCategory}
                onStatusChange={({ orderId, statusId, comment, reportedDate }) => {
                    bulkStatusMutation.mutate({
                        orderIds: [orderId],
                        statusId,
                        reportedDate,
                        commentOverride: comment,
                    });
                    setIsQuickStatusOpen(false);
                    setQuickStatusOrder(null);
                }}
                isPending={bulkStatusMutation.isPending}
            />

            {/* Bulk Status Update Modal */}
            <Dialog open={isBulkStatusModalOpen} onOpenChange={(v) => {
                setIsBulkStatusModalOpen(v);
                if (!v) {
                    setBulkStatusComment("");
                    setBulkCommentSectionVisible(false);
                }
            }}>
                <DialogContent className="ant-surface max-w-4xl p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden max-h-[90vh] flex flex-col">
                    <DialogHeader className="p-6 pb-4 shrink-0 border-b border-ant-line">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="w-1 h-1 rounded-full bg-ant-orange" />
                            <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Bulk update</span>
                        </div>
                        <DialogTitle className="font-display text-[22px] font-semibold text-ant-ink tracking-[-0.02em]">
                            Update status
                        </DialogTitle>
                        <DialogDescription className="font-serif-display text-[12.5px] text-ant-muted italic mt-0.5">
                            Change status for <span className="not-italic font-medium text-ant-ink">{selectedOrders.length}</span>{' '}
                            selected {selectedOrders.length === 1 ? 'order' : 'orders'}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-5">
                        {bulkCommentSectionVisible && (
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                    Comment / reason (required for selected statuses)
                                </label>
                                <Textarea
                                    placeholder="Why are these orders changing to this status?"
                                    value={bulkStatusComment}
                                    onChange={(e) => setBulkStatusComment(e.target.value)}
                                    className="min-h-[80px] resize-none rounded-xl border border-ant-line bg-ant-paper text-[13px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-ant-orange focus-visible:ring-offset-0 focus-visible:border-ant-ink/25 p-3"
                                />
                            </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {orderStatusesForModal?.map((status: any) => (
                                <Button
                                    key={status.id}
                                    variant="outline"
                                    onClick={() => {
                                        const isPostponed = isOrderCategory(status.id, 'postponed');
                                        if (!isPostponed && statusRequiresHistoryComment(status.id) && !bulkStatusComment.trim()) {
                                            setBulkCommentSectionVisible(true);
                                            toast({ title: "Validation Error", description: "A comment is required for this status.", variant: "destructive" });
                                            return;
                                        }

                                        if (isPostponed) {
                                            setIsReportedModalOpen(true);
                                            setReportedData({ date: undefined, time: "12:00", comment: bulkStatusComment });
                                            setPendingReportedAction(() => (date: Date, time: string, comment: string) => {
                                                const [hours, minutes] = time.split(':');
                                                const dateTime = new Date(date);
                                                dateTime.setHours(Number(hours), Number(minutes), 0, 0);

                                                bulkStatusMutation.mutate({
                                                    orderIds: selectedOrders,
                                                    statusId: status.id,
                                                    reportedDate: dateTime.toISOString(),
                                                    commentOverride: comment
                                                });

                                                setIsReportedModalOpen(false);
                                                setPendingReportedAction(null);
                                            });
                                            return;
                                        }

                                        bulkStatusMutation.mutate({ orderIds: selectedOrders, statusId: status.id })
                                    }}
                                    disabled={bulkStatusMutation.isPending}
                                    className="h-12 justify-start gap-3 rounded-xl border border-ant-line bg-ant-paper hover:border-ant-ink/25 hover:bg-ant-line-soft text-ant-ink font-medium transition-all group px-4 text-[12.5px]"
                                >
                                    <div
                                        className="w-3 h-3 rounded-full group-hover:scale-110 transition-transform shrink-0"
                                        style={{ backgroundColor: status.color }}
                                    />
                                    <span className="flex-1 text-left truncate">{status.label}</span>
                                    {bulkStatusMutation.isPending && <Loader2 className="w-4 h-4 animate-spin opacity-50 shrink-0" />}
                                </Button>
                            ))}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Commercial Attribution Modal */}
            <Dialog open={isAttributionModalOpen} onOpenChange={setIsAttributionModalOpen}>
                <DialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden max-h-[90vh] flex flex-col">
                    <DialogHeader className="p-8 pb-6 shrink-0 border-b border-ant-line">
                        <DialogTitle className="text-3xl font-semibold text-ant-ink tracking-tight">Assign Commercial</DialogTitle>
                        <DialogDescription className="text-sm font-bold text-ant-muted mt-1">
                            Team attribution for {selectedOrders.length} orders
                        </DialogDescription>
                    </DialogHeader>

                    <div className="p-8 pt-6 flex-1 flex flex-col overflow-hidden space-y-6">
                        <div className="relative group shrink-0">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-ant-mid group-focus-within:text-ant-mid transition-colors" />
                            <Input
                                placeholder="Search commercial..."
                                value={sellerSearchQuery}
                                onChange={(e) => setSellerSearchQuery(e.target.value)}
                                className="h-14 pl-12 pr-4 rounded-2xl border-none bg-ant-ink/[0.04] text-base font-bold text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-ink/10 shadow-inner"
                            />
                        </div>

                        <div className="overflow-y-auto pr-2 custom-scrollbar space-y-3 flex-1 h-full min-h-0">
                            {/* Unassign Option */}
                            <Button
                                variant="ghost"
                                onClick={() => bulkAttributeMutation.mutate({ orderIds: selectedOrders, sellerId: null })}
                                disabled={bulkAttributeMutation.isPending}
                                className="w-full h-16 justify-start gap-4 rounded-[24px] hover:bg-ant-rose/10 text-ant-rose hover:text-ant-rose transition-all font-bold px-4 border border-transparent hover:border-ant-rose/25"
                            >
                                <div className="w-10 h-10 rounded-2xl bg-ant-rose/15 flex items-center justify-center text-ant-rose shadow-sm shadow-red-500/10">
                                    <X className="w-5 h-5" />
                                </div>
                                <div className="text-left">
                                    <p className="text-sm font-semibold uppercase tracking-tight">Clear Assignee</p>
                                    <p className="text-[10px] opacity-60">Set orders as unassigned</p>
                                </div>
                                {bulkAttributeMutation.isPending && <Loader2 className="w-4 h-4 ml-auto animate-spin" />}
                            </Button>

                            <Separator className="bg-ant-ink/[0.05] my-4" />

                            {sellers
                                ?.filter((s: any) => s.name?.toLowerCase().includes(sellerSearchQuery.toLowerCase()))
                                .map((seller: any) => (
                                    <Button
                                        key={seller.id}
                                        variant="ghost"
                                        onClick={() => bulkAttributeMutation.mutate({ orderIds: selectedOrders, sellerId: seller.id })}
                                        disabled={bulkAttributeMutation.isPending}
                                        className="w-full h-16 justify-start gap-4 rounded-[24px] hover:bg-ant-ink/[0.03] text-ant-ink hover:text-ant-ink transition-all font-bold px-4 border border-transparent hover:border-ant-line"
                                    >
                                        <Avatar className="w-10 h-10 border-2 border-white shadow-md">
                                            <AvatarImage src={seller.avatar_url} />
                                            <AvatarFallback className="bg-ant-ink text-ant-light text-xs">
                                                {seller.name?.[0]}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="text-left">
                                            <p className="text-sm font-semibold uppercase tracking-tight">{seller.name}</p>
                                            <p className="text-[10px] text-ant-muted uppercase font-bold tracking-widest">{seller.role}</p>
                                        </div>
                                        {bulkAttributeMutation.isPending && <Loader2 className="w-4 h-4 ml-auto animate-spin opacity-40 shrink-0" />}
                                    </Button>
                                ))}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
            {/* Reported Status Data Collection Modal */}
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

            <AlertDialog open={!!orderPendingDelete} onOpenChange={(open) => { if (!open) setOrderPendingDelete(null); }}>
                <AlertDialogContent className="rounded-2xl border-none shadow-2xl max-w-md p-8">
                    <AlertDialogHeader className="space-y-3">
                        <AlertDialogTitle className="text-2xl font-semibold text-ant-ink tracking-tight">
                            Move to trash?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-base text-ant-ink/60 font-medium leading-relaxed">
                            {orderPendingDelete
                                ? `This will move the order for "${orderPendingDelete.name}" to trash. You can restore it within 14 days.`
                                : null}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2 sm:gap-3 pt-2">
                        <AlertDialogCancel className="rounded-2xl h-12 font-bold border border-ant-ink/10 bg-ant-ink/[0.04] text-ant-ink hover:bg-ant-ink/10 m-0">
                            Cancel
                        </AlertDialogCancel>
                        <Button
                            type="button"
                            variant="destructive"
                            className="rounded-2xl h-12 font-bold shadow-lg m-0 w-full sm:w-auto"
                            disabled={deleteOrderMutation.isPending}
                            onClick={() => {
                                if (orderPendingDelete) deleteOrderMutation.mutate(orderPendingDelete.id);
                            }}
                        >
                            {deleteOrderMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            Move to trash
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <ParcelTrackingDialog
                open={parcelTrackingOpen}
                onOpenChange={(open) => {
                    setParcelTrackingOpen(open);
                    if (!open) setParcelTrackingOrderId(null);
                }}
                orderId={parcelTrackingOrderId}
            />

            <OrderStatusHistoryDialog
                open={!!historyDialogOrder}
                onOpenChange={(open) => {
                    if (!open) setHistoryDialogOrder(null);
                }}
                order={historyDialogOrder}
                isOrderInCategory={(statusId, cat) => isOrderCategory(statusId || '', cat as any)}
            />
        </div>
    );
};

export default Orders;
