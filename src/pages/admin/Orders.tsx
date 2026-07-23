import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
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
    AlertTriangle,
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
    FormMessage
} from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn } from '@/lib/utils';
import { resolveProviderLogo } from '@/lib/providerLogos';
import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, subMonths, startOfYear } from 'date-fns';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import type { DateRange } from 'react-day-picker';
import CustomerInsights from '@/components/CustomerInsights';
import {
    OrderPhoneQuickActions,
    OrderPhoneContactDropdown,
    OrderContactSubmenu,
} from '@/components/orders/OrderPhoneQuickActions';
import { ParcelTrackingDialog } from '@/components/orders/ParcelTrackingDialog';
import OrderViewDialog from '@/components/orders/OrderViewDialog';
import { WebhookHealthIndicator } from '@/components/orders/WebhookHealthIndicator';
import { fetchOrderById } from '@/lib/orders/fetchOrderById';
import { OrderStatusHistoryDialog } from '@/components/orders/OrderStatusHistoryDialog';
import OrdersListView from '@/components/orders/OrdersListView';
import { StockShortageModal, type StockShortageGroup } from '@/components/orders/StockShortageModal';
import QuickStatusChangeModal from '@/components/orders/QuickStatusChangeModal';
import { DynamicIcon } from '@/lib/renderReactIcon';
import { usePackageStatusResolver } from '@/hooks/usePackageStatusResolver';
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
import { Check, ChevronsUpDown, FileSpreadsheet, FileDown } from "lucide-react";
import { buildOrderItemRecords, type OrderLineForRecords, type ProductAccessoryRow } from '@/lib/buildOrderItemRecords';
import { statusRequiresHistoryComment } from '@/lib/orderHistoryCommentPolicy';
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { UserAvatar } from "@/components/users/UserAvatar";
import {
    OrderLineProductCombobox,
    OrderLineProductStockHint,
    toProductStockNumber,
    type OrderLineProductOption,
} from '@/components/orders/OrderLineProductCombobox';
import SourceIcon, { getSourceMeta } from '@/components/orders/SourceIcon';
import { ImageHoverPreview } from '@/components/catalog/ImageHoverPreview';

// Lazy-loaded so the export engine (and SheetJS, itself lazy inside it) stays
// out of the Orders page bundle until the user actually opens the wizard.
const OrdersExportWizard = React.lazy(() => import('@/components/orders/OrdersExportWizard'));

// --- Stock error helper ---
const friendlyStockError = (error: any): string => {
    const m = String(error?.message || error || '');
    if (m.includes('insufficient_stock')) return "Not enough stock to confirm this order. Restock the product or reduce the quantity.";
    if (m.includes('confirm_via_update')) return "Could not create a confirmed order directly. Please try again.";
    return m || 'Something went wrong.';
};

// D1: items are the SLIM `orders_list_page` shape — flat {product_id,
// accessory_id, quantity, accessory_quantity, name, code, image_url} where
// `name` is the PRODUCT name (accessory lines fall back to a generic label —
// documented contract deviation, the slim row doesn't carry accessory names).
const computeShortLines = (order: any, productMap: Map<string, number>, accessoryMap: Map<string, number>) => {
    const lines: { name: string; needed: number; have: number }[] = [];
    (order?.items || []).forEach((it: any) => {
        if (it.product_id && Number(it.quantity) > 0) {
            const have = productMap.get(it.product_id) ?? 0;
            if (Number(it.quantity) > have) lines.push({ name: it.name || 'Produit', needed: Number(it.quantity), have });
        }
        if (it.accessory_id && Number(it.accessory_quantity) > 0) {
            const have = accessoryMap.get(it.accessory_id) ?? 0;
            if (Number(it.accessory_quantity) > have) lines.push({ name: 'Accessoire', needed: Number(it.accessory_quantity), have });
        }
    });
    return lines;
};

// Group an exchange's related orders into ONE connected block: the returned exchange
// leg(s) (replace=true), then any additional-sale leg(s) (replace=false that point at the
// same original), then the original. Tags _exchangeRole + _exchangeFirst/_exchangeLast so
// the UI draws a single capped purple block of 2 OR 3 rows. Degrades to a normal row when
// partners aren't present in the filtered list.
function arrangeExchangePairs(list: any[]): any[] {
  const arr = Array.isArray(list) ? list : [];
  const byId = new Map(arr.map((o) => [o.id, o]));
  // legs (return + additional-sale) keyed by the original order they point at
  const legsByOriginal = new Map<string, any[]>();
  for (const o of arr) {
    if (o?.exchange_of_order_id && byId.has(o.exchange_of_order_id)) {
      const a = legsByOriginal.get(o.exchange_of_order_id) || [];
      a.push(o);
      legsByOriginal.set(o.exchange_of_order_id, a);
    }
  }
  const emitted = new Set<string>();
  const out: any[] = [];
  const emitGroup = (originalId: string) => {
    const legs = legsByOriginal.get(originalId) || [];
    const orig = byId.get(originalId);
    const ordered: { row: any; role: 'exchange' | 'sale' | 'original' }[] = [
      ...legs.filter((l) => l.replace).map((l) => ({ row: l, role: 'exchange' as const })),
      ...legs.filter((l) => !l.replace).map((l) => ({ row: l, role: 'sale' as const })),
      ...(orig ? [{ row: orig, role: 'original' as const }] : []),
    ];
    ordered.forEach(({ row, role }, i) => {
      out.push({
        ...row,
        _exchangeRole: role,
        _exchangePartnerId: originalId,
        _exchangeFirst: i === 0,
        _exchangeLast: i === ordered.length - 1,
      });
      emitted.add(row.id);
    });
  };
  for (const o of arr) {
    if (emitted.has(o.id)) continue;
    // an original that anchors a group -> emit the whole group at its slot
    if (legsByOriginal.has(o.id)) { emitGroup(o.id); continue; }
    // a leg reached before its original -> emit its group now
    if (o?.exchange_of_order_id && legsByOriginal.has(o.exchange_of_order_id) && !emitted.has(o.exchange_of_order_id)) {
      emitGroup(o.exchange_of_order_id);
      continue;
    }
    out.push(o);
    emitted.add(o.id);
  }
  return out;
}

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
 * courier_parcels row, not on orders.package_status_id. D1: the lookup runs
 * server-side inside `orders_list_page` (LATERAL over courier_parcels) and
 * ships as `courier_pkg_fallback: {label, color} | null` on each slim row.
 */
function getCourierPackageStatus(order: any): { label: string; color: string | null } | null {
    const fallback = order?.courier_pkg_fallback as { label?: string | null; color?: string | null } | null | undefined;
    if (!fallback?.label || !String(fallback.label).trim()) return null;
    return { label: String(fallback.label).trim(), color: fallback.color || null };
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
    const [isExportWizardOpen, setIsExportWizardOpen] = useState(false);
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

    // Stock Shortage Modal State
    const [stockAlert, setStockAlert] = useState<StockShortageGroup[] | null>(null);

    // Reported Modal States
    const [isReportedModalOpen, setIsReportedModalOpen] = useState(false);
    const [reportedData, setReportedData] = useState<{ date: Date | undefined, time: string, comment: string }>({ date: undefined, time: "12:00", comment: "" });
    const [pendingReportedAction, setPendingReportedAction] = useState<((date: Date, time: string, comment: string) => void) | null>(null);
    const reportedStatusRevertRef = useRef<string | null>(null);
    const { getOrderByCategory, isOrderCategory } = useStatusCategories();
    const REPORTED_STATUS_ID = getOrderByCategory('postponed')?.id;
    const defaultNewOrderStatusId = getOrderByCategory('new')?.id ?? '';

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
    // Server-side keyset pagination (D1): the page number lives in the cursor
    // stack declared next to the `orders_list_page` query below; only the page
    // size is plain state here.
    const [pageSize, setPageSize] = useState<100 | 500 | 1000>(100);
    const [showAllFilters, setShowAllFilters] = useState(false);
    const [showCustomerInsights, setShowCustomerInsights] = useState(false);
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

    // --- Realtime (W7 R1a): cache invalidation now rides the layout-mounted
    // <EcomBizRealtime/> (AppLayout) — ONE private ecom:biz broadcast channel per
    // session handles ['orders-page'] + ['orders-kpis'] + the stock dropdown keys
    // for every page. The user-visible toast likewise lives in
    // OrderStatusNotifications. The former 7-binding postgres_changes channel is
    // retired.

    // --- Queries ---


    // D1 (docs/d1-recon/04-design.md): the old 'orders-aggregate' full-business
    // download is gone. ONE keyset page of SLIM rows comes from the
    // `orders_list_page` RPC; the KPI strip / counter pill / totalPages come
    // from the `orders_kpis` RPC over the SAME server-side filter surface.
    // Accepted behavior deltas (documented in the contract): top-search axes
    // trimmed (no raw-uuid / raw-price / joined-label / accessory matching;
    // length guards fold>=2 / digits>=3 / raw>=2), date presets evaluate as
    // Africa/Casablanca calendar days server-side, exchange-pair grouping
    // stays page-local.

    // Text inputs are debounced together so typing doesn't fire one RPC per
    // keystroke; keepPreviousData on the queries hides the transition.
    const [debouncedText, setDebouncedText] = useState({ search: '', customer: '', phone: '', tracking: '' });
    useEffect(() => {
        const t = setTimeout(() => setDebouncedText({
            search: searchQuery.trim(),
            customer: filterCustomerName.trim(),
            phone: filterPhone.trim(),
            tracking: filterTracking.trim(),
        }), 350);
        return () => clearTimeout(t);
    }, [searchQuery, filterCustomerName, filterPhone, filterTracking]);

    // --- Date range helper (presets → calendar-day bounds for the RPC) ---
    const getDateRange = useMemo(() => {
        const now = new Date();
        switch (filterTimeRange) {
            case 'today': return { from: startOfDay(now), to: endOfDay(now) };
            case 'yesterday': return { from: startOfDay(subDays(now, 1)), to: endOfDay(subDays(now, 1)) };
            case 'last7': return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
            case 'last30': return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
            case 'last90': return { from: startOfDay(subDays(now, 89)), to: endOfDay(now) };
            case 'ytd': return { from: startOfYear(now), to: endOfDay(now) };
            case 'thisMonth': return { from: startOfMonth(now), to: endOfDay(now) };
            case 'lastMonth': { const lm = subMonths(now, 1); return { from: startOfMonth(lm), to: endOfMonth(lm) }; }
            case 'custom': return filterCustomRange?.from && filterCustomRange?.to ? { from: startOfDay(filterCustomRange.from), to: endOfDay(filterCustomRange.to) } : null;
            default: return null;
        }
    }, [filterTimeRange, filterCustomRange]);

    // The RPC takes DATE params and applies Africa/Casablanca inclusive-day
    // boundaries itself — only the calendar days travel over the wire.
    const dateBounds = useMemo(() => {
        if (!getDateRange) return { from: null as string | null, to: null as string | null };
        return {
            from: format(getDateRange.from, 'yyyy-MM-dd'),
            to: format(getDateRange.to, 'yyyy-MM-dd'),
        };
    }, [getDateRange]);

    // Filter/nav state → RPC params, 1:1 (recon 01 §1 predicates pushed down).
    // Shared verbatim by the page query and the KPI query so the counters can
    // never disagree with the visible rows.
    const listParams = useMemo(() => ({
        p_business: activeBusinessId,
        p_search: debouncedText.search || null,
        p_status: filterStatus !== 'all' ? filterStatus : null,
        p_status_ids: filterStatus === 'all' && filterStatusIds && filterStatusIds.length > 0 ? filterStatusIds : null,
        p_package: filterPackageStatus !== 'all' ? filterPackageStatus : null,
        p_package_ids: filterPackageStatus === 'all' && filterPackageStatusIds && filterPackageStatusIds.length > 0 ? filterPackageStatusIds : null,
        p_city: filterCity !== 'all' ? filterCity : null,
        p_source: filterSource !== 'all' ? filterSource : null,
        p_provider: filterProvider !== 'all' ? filterProvider : null,
        p_date_field: filterDateField,
        p_date_from: dateBounds.from,
        p_date_to: dateBounds.to,
        p_customer_name: debouncedText.customer || null,
        p_phone: debouncedText.phone || null,
        p_tracking: debouncedText.tracking || null,
        p_product: filterProduct !== 'all' ? filterProduct : null,
        p_confirmed_by: filterConfirmedBy !== 'all' ? filterConfirmedBy : null,
        p_assigned_to: filterAssignedTo !== 'all' ? filterAssignedTo : null,
        p_exchange: filterExchange !== 'all' ? filterExchange : null,
    }), [activeBusinessId, debouncedText, filterStatus, filterStatusIds, filterPackageStatus, filterPackageStatusIds, filterCity, filterSource, filterProvider, filterDateField, dateBounds, filterProduct, filterConfirmedBy, filterAssignedTo, filterExchange]);

    // Keyset cursor STACK — Prev pops, Next pushes the page's next_cursor.
    // The page number is implicit (stack depth + 1).
    const [cursorStack, setCursorStack] = useState<{ created_at: string; id: string }[]>([]);
    const cursor = cursorStack.length > 0 ? cursorStack[cursorStack.length - 1] : null;
    const page = cursorStack.length + 1;

    // Snap back to page 1 whenever the active filter set or the search text
    // mutates. Without this, filtering while deep in the stack would strand
    // the user on a cursor that no longer matches anything.
    const paramsKey = useMemo(() => JSON.stringify(listParams), [listParams]);
    useEffect(() => {
        setCursorStack((prev) => (prev.length > 0 ? [] : prev));
    }, [paramsKey]);

    const {
        data: pageData,
        isLoading: pageLoading,
        isFetching: pageFetching,
    } = useQuery<{ rows: any[]; next_cursor: { created_at: string; id: string } | null; page_count: number }>({
        queryKey: ['orders-page', activeBusinessId, listParams, cursor, pageSize],
        queryFn: async () => {
            const { data, error } = await (supabase as any).rpc('orders_list_page', {
                ...listParams,
                p_cursor_created: cursor?.created_at ?? null,
                p_cursor_id: cursor?.id ?? null,
                p_limit: pageSize,
            });
            if (error) throw error;
            return data as { rows: any[]; next_cursor: { created_at: string; id: string } | null; page_count: number };
        },
        enabled: !!activeBusinessId,
        staleTime: 60 * 1000,
        // refetchOnMount 'always' covers cross-page staleness (e.g. deleting a delivery
        // note reverts the order while this page is unmounted). Focus refetch is OFF
        // (OR-4): while mounted, freshness rides the ecom:biz broadcast seam (which also
        // full-invalidates on reconnect) — focus-refetching a full page + KPI aggregate
        // per admin per tab-switch is a fleet-scale storm, not a freshness win.
        refetchOnMount: 'always',
        refetchOnWindowFocus: false,
        // keepPreviousData: the old page stays visible while the next one loads.
        placeholderData: (prev) => prev,
    });

    const { data: orderKpis } = useQuery<any>({
        queryKey: ['orders-kpis', activeBusinessId, listParams],
        queryFn: async () => {
            const { data, error } = await (supabase as any).rpc('orders_kpis', listParams);
            if (error) throw error;
            return data;
        },
        enabled: !!activeBusinessId,
        staleTime: 60 * 1000,
        refetchOnMount: 'always',
        // OFF for the same reason as the list query (OR-4): this is a full-filtered-set
        // aggregate — focus storms multiply it by fleet size for zero freshness gain.
        refetchOnWindowFocus: false,
        placeholderData: (prev) => prev,
    });

    // The visible page rows (SLIM `orders_list_page` shape). Treat the pre-auth
    // window (no `activeBusinessId` yet) as loading so we don't flash an
    // empty-state card before the React Query is even enabled.
    const pageRows = useMemo(() => ((pageData?.rows ?? []) as any[]), [pageData]);
    const isLoading = pageLoading || !activeBusinessId;

    // If the current cursor page went empty under us (the filtered set shrank),
    // snap back to page 1 — keyset cursors can't clamp to a "last page" the way
    // the old client-side slice did.
    useEffect(() => {
        if (!pageFetching && pageData && pageData.page_count === 0 && cursorStack.length > 0) {
            setCursorStack([]);
        }
    }, [pageFetching, pageData, cursorStack.length]);

    // Shared resolver — master status label+color+icon, raw only as fallback.
    const { resolve: resolvePkgStatus, resolveById } = usePackageStatusResolver();

    const { data: cities } = useQuery({
        queryKey: ['cities-dropdown', activeBusinessId],
        staleTime: 5 * 60 * 1000, // OR-6: near-static reference data; kills the every-focus re-download
        queryFn: async () => {
            if (!activeBusinessId) return [];
            return fetchAllRows<{ id: string; name: string; zone_id: string | null }>('master_cities', 'id, name, zone_id', { orderBy: 'name' });
        },
    });

    const { data: couriers } = useQuery({
        queryKey: ['couriers-dropdown', activeBusinessId],
        staleTime: 5 * 60 * 1000, // OR-6: near-static reference data; kills the every-focus re-download
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
        staleTime: 5 * 60 * 1000, // OR-6: near-static reference data; kills the every-focus re-download
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
        staleTime: 5 * 60 * 1000, // OR-6: near-static reference data; kills the every-focus re-download
        // OR-D: fee/zone reference data feeds ONLY the add/edit form (findFee +
        // availableProviders) — fetch when the form opens, not on page load/focus.
        enabled: !!activeBusinessId && (isAddModalOpen || isEditModalOpen),
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('courier_zones')
                .select('courier_id, zone_id')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: companyZones } = useQuery({
        queryKey: ['company-zones-all', activeBusinessId],
        staleTime: 5 * 60 * 1000, // OR-6: near-static reference data; kills the every-focus re-download
        // OR-D: fee/zone reference data feeds ONLY the add/edit form (findFee +
        // availableProviders) — fetch when the form opens, not on page load/focus.
        enabled: !!activeBusinessId && (isAddModalOpen || isEditModalOpen),
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('company_zones')
                .select('company_id, zone_id')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: courierFees } = useQuery({
        queryKey: ['courier-fees-all', activeBusinessId],
        staleTime: 5 * 60 * 1000, // OR-6: near-static reference data; kills the every-focus re-download
        // OR-D: fee/zone reference data feeds ONLY the add/edit form (findFee +
        // availableProviders) — fetch when the form opens, not on page load/focus.
        enabled: !!activeBusinessId && (isAddModalOpen || isEditModalOpen),
        queryFn: async () => {
            if (!activeBusinessId) return [];
            return await fetchAllRows('courier_fees', 'courier_id, master_city_id, fee', { filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId }] });
        }
    });

    const { data: companyFees } = useQuery({
        queryKey: ['company-fees-all', activeBusinessId],
        staleTime: 5 * 60 * 1000, // OR-6: near-static reference data; kills the every-focus re-download
        // OR-D: fee/zone reference data feeds ONLY the add/edit form (findFee +
        // availableProviders) — fetch when the form opens, not on page load/focus.
        enabled: !!activeBusinessId && (isAddModalOpen || isEditModalOpen),
        queryFn: async () => {
            if (!activeBusinessId) return [];
            return await fetchAllRows('company_fees', 'company_id, master_city_id, fee', { filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId }] });
        }
    });

    const { data: providerCities } = useQuery({
        queryKey: ['provider-cities-all'],
        staleTime: 5 * 60 * 1000, // OR-6: near-static reference data; kills the every-focus re-download
        // OR-D: fee/zone reference data feeds ONLY the add/edit form (findFee +
        // availableProviders) — fetch when the form opens, not on page load/focus.
        enabled: !!activeBusinessId && (isAddModalOpen || isEditModalOpen),
        queryFn: async () => {
            return (await fetchAllRows('provider_cities', 'master_city_id, provider_type, fees')) as { master_city_id: string; provider_type: string; fees: { delivered?: number; refused?: number; returned?: number } | null }[];
        },
    });

    const { data: orderStatuses } = useQuery({
        queryKey: ['order-statuses-dropdown', activeBusinessId],
        staleTime: 5 * 60 * 1000, // OR-6: near-static reference data; kills the every-focus re-download
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
        staleTime: 5 * 60 * 1000, // OR-6: near-static reference data; kills the every-focus re-download
        queryFn: async () => {
            if (!activeBusinessId) return [];
            // OR-D: fetchAllRows — the bare select silently capped the dropdown at
            // 1000 products (PGRST_DB_MAX_ROWS), an order-creation correctness trap.
            return await fetchAllRows<any>('products', 'id, name, code, selling_price, stock, image_url', {
                filters: [
                    { column: 'active', op: 'eq', value: true },
                    { column: 'DigiCom Business', op: 'eq', value: activeBusinessId },
                ],
                orderBy: 'name',
            });
        },
    });

    const { data: accessories } = useQuery({
        queryKey: ['accessories-dropdown-orders', activeBusinessId],
        staleTime: 5 * 60 * 1000, // OR-6: near-static reference data; kills the every-focus re-download
        queryFn: async () => {
            if (!activeBusinessId) return [];
            // OR-D: fetchAllRows — same 1000-cap trap as products.
            return await fetchAllRows<any>('accessories', 'id, name, code, cost_price, stock', {
                filters: [
                    { column: 'active', op: 'eq', value: true },
                    { column: 'DigiCom Business', op: 'eq', value: activeBusinessId },
                ],
                orderBy: 'name',
            });
        },
    });

    const { data: productAccessories } = useQuery({
        queryKey: ['product-accessories', activeBusinessId],
        staleTime: 5 * 60 * 1000, // OR-6: near-static reference data; kills the every-focus re-download
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

    // The ?addProductId=<uuid> prefill effect lives below the `form` declaration to
    // avoid a temporal-dead-zone reference when React evaluates the effect deps array.

    const { data: packageStatuses } = useQuery({
        queryKey: ['package-statuses-dropdown', activeBusinessId],
        staleTime: 5 * 60 * 1000, // OR-6: near-static reference data; kills the every-focus re-download
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
        staleTime: 5 * 60 * 1000, // OR-6: near-static reference data; kills the every-focus re-download
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, avatar_url, avatar_config')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: sellers } = useQuery({
        queryKey: ['sellers-commercial-v2', activeBusinessId],
        staleTime: 5 * 60 * 1000, // OR-6: near-static reference data; kills the every-focus re-download
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, avatar_url, avatar_config, role')
                .eq('role', 'commercial')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
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
    // D1: the page only holds SLIM rows now, so this always goes through the
    // shared lazy `fetchOrderById` (full joins + history).
    const viewParamHandledRef = useRef<string | null>(null);
    useEffect(() => {
        const requestedId = searchParams.get('view');
        if (!requestedId) {
            viewParamHandledRef.current = null;
            return;
        }
        if (viewParamHandledRef.current === requestedId) return;
        viewParamHandledRef.current = requestedId;

        (async () => {
            try {
                const data = await fetchOrderById(requestedId);
                if (!data) return;
                // Seed the view dialog's own cache so it renders instantly with
                // this row (history included) instead of flashing while it
                // re-fetches what we just pulled.
                queryClient.setQueryData(['order-view', requestedId], data);
                setSelectedOrder(data);
                setIsViewModalOpen(true);
            } catch (err) {
                console.error('?view deep-link fetch error:', err);
            }
        })();

        const next = new URLSearchParams(searchParams);
        next.delete('view');
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams, queryClient]);

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

    // Exchange "additional sale" lines → become a separate replace=false order.
    const { fields: addFields, append: addAppend, remove: addRemove } = useFieldArray({
        control: form.control,
        name: "additional_items"
    });

    // Shared product-line renderer — used identically by the main order lines and by the
    // exchange "additional sale" lines, so both have the exact same product picker, stock
    // hints, and accessory auto-attach/edit mechanics. `namePrefix` swaps the field path.
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
                                    blockZeroStock={!isEditModalOpen}
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

    // --- Mutations ---
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
            queryClient.invalidateQueries({ queryKey: ['orders-page', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['orders-kpis', activeBusinessId] });
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
            toast({ title: "Error", description: friendlyStockError(error), variant: "destructive" });
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
                if (isOrderCategory(statusId, 'paid') && !selectedOrder.date_livraison) {
                    // Only stamp when missing — re-stamping now() on an already-
                    // delivered order moves its commission to the current payout
                    // month (frozen-ledger double-count).
                    updatePayload.date_livraison = new Date().toISOString();
                }
                if (isOrderCategory(statusId, 'postponed')) {
                    // Use explicitly passed reported_date, falling back to current time
                    updatePayload.reported_date = (values as any)._reportedDate || new Date().toISOString();
                }
            }

            // 1. Update order — read back the stored status: zzz_orders_keep_paid
            // silently reverts changes away from PAID while the order sits on a
            // settled payment note (mirror of the bulk RPC's kept_paid skip).
            const { data: updatedRow, error: orderError } = await (supabase as any)
                .from('orders')
                .update(updatePayload)
                .eq('id', selectedOrder.id)
                .eq('DigiCom Business', activeBusinessId)
                .select('order_status_id')
                .single();

            if (orderError) throw orderError;

            const statusChanged = !!values.order_status_id && values.order_status_id !== selectedOrder.order_status_id;
            const statusKeptPaid = statusChanged && updatedRow?.order_status_id !== values.order_status_id;
            if (statusKeptPaid) {
                // Roll back the transition stamps written for the status that
                // did not stick (the field edits themselves stay).
                const stampKeys = ['confirmed_by_id', 'confirmation_date', 'canceled_by_id', 'annulation_date', 'date_livraison', 'reported_date']
                    .filter((k) => k in updatePayload);
                if (stampKeys.length > 0) {
                    const revert: any = {};
                    stampKeys.forEach((k) => { revert[k] = selectedOrder[k] ?? null; });
                    await (supabase as any)
                        .from('orders')
                        .update(revert)
                        .eq('id', selectedOrder.id)
                        .eq('DigiCom Business', activeBusinessId);
                }
            }

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

            // Delete+reinsert must not re-price COGS: the BEFORE INSERT trigger
            // fills NULL snapshots from TODAY's products.cost_price, so carry the
            // order's original per-product cost snapshot through the reinsert.
            const snapshotByProduct = new Map<string, number>();
            (selectedOrder.items || []).forEach((it: any) => {
                if (it.product_id && it.product_unit_cost_snapshot != null && !snapshotByProduct.has(it.product_id)) {
                    snapshotByProduct.set(it.product_id, it.product_unit_cost_snapshot);
                }
            });
            itemRecords.forEach((rec: any) => {
                if (rec.product_id && snapshotByProduct.has(rec.product_id)) {
                    rec.product_unit_cost_snapshot = snapshotByProduct.get(rec.product_id);
                }
            });

            const { error: itemsError } = await (supabase as any)
                .from('order_items')
                .insert(itemRecords);

            if (itemsError) throw itemsError;

            // 3. Track History if Status Changed (and actually stuck)
            if (statusChanged && !statusKeptPaid) {
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

            return { statusKeptPaid };
        },
        onSuccess: (result: any) => {
            queryClient.invalidateQueries({ queryKey: ['orders-page', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['orders-kpis', activeBusinessId] });
            setIsEditModalOpen(false);
            setSelectedOrder(null);
            if (result?.statusKeptPaid) {
                toast({ title: "Statut maintenu PAID", description: "Commande sur une note de paiement réglée — le statut n'a pas changé, les autres modifications sont enregistrées.", variant: "destructive" });
            } else {
                toast({ title: "Order Updated", description: "Changes saved successfully." });
            }
        },
        onError: (error: any) => {
            toast({ title: "Error", description: friendlyStockError(error), variant: "destructive" });
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
            queryClient.invalidateQueries({ queryKey: ['orders-page', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['orders-kpis', activeBusinessId] });
            setOrderPendingDelete(null);
            toast({ title: "Order Moved to Trash", description: "Order moved to trash. You can restore it within 14 days." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const productStockById = useMemo(() => {
        const m = new Map<string, number>();
        ((products as any[]) || []).forEach((p) => m.set(p.id, Number(p.stock ?? 0)));
        return m;
    }, [products]);

    const accessoryStockById = useMemo(() => {
        const m = new Map<string, number>();
        ((accessories as any[]) || []).forEach((a) => m.set(a.id, Number(a.stock ?? 0)));
        return m;
    }, [accessories]);

    // D1: the locked / soft-deleted / foreign-business guards moved server-side
    // into the `orders_bulk_guarded` RPC (selection persists across pages, so a
    // page-local locked check cannot protect the write). Per-row subtransactions
    // in the RPC keep a trigger rejection (e.g. stock shortage on a confirmed
    // status) scoped to that order only — same isolation the old per-order
    // client loop had.
    const bulkStatusMutation = useMutation({
        mutationFn: async ({ orderIds, statusId, reportedDate, commentOverride }: { orderIds: string[], statusId: string, reportedDate?: string, commentOverride?: string }) => {
            // History is written INSIDE the RPC's per-row subtransaction (before
            // each update, preserving the auto-log trigger's 5s dedup ordering) —
            // skipped ids get NO history row (phantom-row fix, D1 review).
            let finalCommentTemplate = commentOverride || bulkStatusComment || 'Bulk status update';
            if ((isOrderCategory(statusId, 'postponed') || statusId === REPORTED_STATUS_ID) && reportedDate) {
                const formattedDate = format(new Date(reportedDate), 'dd/MM/yyyy HH:mm');
                finalCommentTemplate = `[Reporté pour: ${formattedDate}] ${finalCommentTemplate}`;
            }

            const { data, error } = await (supabase as any).rpc('orders_bulk_guarded', {
                p_ids: orderIds,
                p_action: 'status',
                p_status: statusId,
                p_reported_date: reportedDate ?? null,
                p_comment: finalCommentTemplate,
            });
            if (error) throw error;
            const succeeded: string[] = Array.isArray(data?.applied) ? data.applied : [];
            const failed: { id: string; reason: string }[] = Array.isArray(data?.skipped) ? data.skipped : [];
            return { succeeded, failed };
        },
        onSuccess: async (result) => {
            queryClient.invalidateQueries({ queryKey: ['orders-page', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['orders-kpis', activeBusinessId] });
            setSelectedOrders([]);
            setIsBulkStatusModalOpen(false);
            setBulkStatusComment("");
            const { succeeded = [], failed = [] } = result || {};
            if (failed.length > 0) {
                // Skip reasons come from the guarded RPC: locked / deleted /
                // not_found / not_updatable, or the raw trigger error (e.g.
                // insufficient_stock on a confirmed status).
                const reasonLabel = (reason: string) => {
                    if (reason === 'locked') return 'verrouillée';
                    if (reason === 'kept_paid') return 'maintenue PAID — note de paiement réglée';
                    if (reason === 'deleted') return 'supprimée';
                    if (reason === 'not_found') return 'introuvable';
                    if (reason === 'not_updatable') return 'non modifiable';
                    return friendlyStockError(reason);
                };
                toast({
                    title: `${succeeded.length} updated, ${failed.length} skipped`,
                    description: failed.slice(0, 3).map((f) => reasonLabel(String(f.reason || ''))).join(' · ')
                        + (failed.length > 3 ? ` · +${failed.length - 3} more` : ''),
                    variant: "destructive"
                });
                const stockFailed = failed.filter((f) => String(f.reason || '').includes('insufficient_stock'));
                if (stockFailed.length > 0) {
                    // Selection persists across keyset pages — off-page failures
                    // are lazily resolved so the modal always shows real names +
                    // shortage lines (D1 review fix).
                    const groups = await Promise.all(stockFailed.map(async (f) => {
                        let o: any = pageRows.find((x) => x.id === f.id);
                        if (!o) {
                            try {
                                const full: any = await fetchOrderById(f.id);
                                if (full) {
                                    o = {
                                        ...full,
                                        items: (full.items || []).map((it: any) => ({
                                            product_id: it.product_id,
                                            accessory_id: it.accessory_id,
                                            quantity: it.quantity,
                                            accessory_quantity: it.accessory_quantity,
                                            name: it.product?.name ?? it.accessory?.name ?? null,
                                            code: it.product?.code ?? it.accessory?.code ?? null,
                                            image_url: it.product?.image_url ?? it.accessory?.image_url ?? null,
                                        })),
                                    };
                                }
                            } catch { /* generic fallback below */ }
                        }
                        return { orderName: o?.name || 'Commande', lines: o ? computeShortLines(o, productStockById, accessoryStockById) : [] };
                    }));
                    setStockAlert(groups);
                }
            } else {
                toast({ title: "Success", description: "Orders status updated successfully." });
            }
        },
        onError: (error: any) => {
            toast({ title: "Error", description: friendlyStockError(error), variant: "destructive" });
        }
    });

    const bulkAttributeMutation = useMutation({
        mutationFn: async ({ orderIds, sellerId }: { orderIds: string[], sellerId: string | null }) => {
            // D1: locked/deleted/foreign guards run server-side in the RPC
            // (NULL p_seller = unassign, mirroring the old client payload).
            const { data, error } = await (supabase as any).rpc('orders_bulk_guarded', {
                p_ids: orderIds,
                p_action: 'attribute',
                p_seller: sellerId,
            });
            if (error) throw error;
            const succeeded: string[] = Array.isArray(data?.applied) ? data.applied : [];
            const failed: { id: string; reason: string }[] = Array.isArray(data?.skipped) ? data.skipped : [];
            return { succeeded, failed };
        },
        onSuccess: (result) => {
            queryClient.invalidateQueries({ queryKey: ['orders-page', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['orders-kpis', activeBusinessId] });
            setSelectedOrders([]);
            setIsAttributionModalOpen(false);
            const { succeeded = [], failed = [] } = result || {};
            if (failed.length > 0) {
                toast({
                    title: `${succeeded.length} attributed, ${failed.length} skipped`,
                    description: `${failed.length} order(s) skipped (locked, trashed or inaccessible).`,
                    variant: "destructive"
                });
            } else {
                toast({ title: "Success", description: "Orders attributed successfully." });
            }
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
        if (selectedOrders.length === orderIds.length && orderIds.length > 0) {
            setSelectedOrders([]);
        } else {
            setSelectedOrders(orderIds);
        }
    };

    // --- Helpers (page-row derivations — the slim RPC rows carry everything) ---
    // Short flag: computed over the VISIBLE PAGE rows only (slim items vs the
    // active-only stock maps).
    const shortOrderIds = useMemo(() => {
        const s = new Set<string>();
        pageRows.forEach((o) => {
            if (o?.stock_changed === true) return; // already reserved, not short
            const short = (o?.items || []).some((it: any) => {
                if (it?.product_id && Number(it.quantity) > 0) {
                    const have = productStockById.get(it.product_id);
                    if (have !== undefined && Number(it.quantity) > have) return true;
                }
                if (it?.accessory_id && Number(it.accessory_quantity) > 0) {
                    const have = accessoryStockById.get(it.accessory_id);
                    if (have !== undefined && Number(it.accessory_quantity) > have) return true;
                }
                return false;
            });
            if (short) s.add(o.id);
        });
        return s;
    }, [pageRows, productStockById, accessoryStockById]);

    // totalPages / counter pill ride the KPI aggregate's filtered total_count.
    const totalOrdersCount = Number(orderKpis?.total_count ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalOrdersCount / pageSize));

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

    // D1: the slim page row doesn't carry the edit-form payload (address,
    // shipping, notes, item money fields, old-tracking values) — the edit form
    // rides the shared lazy `fetchOrderById` (full joins + history).
    const handleEdit = async (orderRow: any) => {
        let order: any;
        try {
            order = await fetchOrderById(orderRow.id);
        } catch {
            order = null;
        }
        if (!order) {
            toast({ title: "Commande introuvable", description: "Impossible de charger la commande pour modification.", variant: "destructive" });
            return;
        }
        // Seed the view dialog's cache — it shows the same full row.
        queryClient.setQueryData(['order-view', order.id], order);
        setSelectedOrder(order);
        form.reset({
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

    // KPIs come from the `orders_kpis` RPC over the FULL filtered set
    // (independent of page size). MONEY excludes exchange/swap legs
    // (replace=true) — they are return+reship logistics, not sales — so
    // "Total sales" matches the dashboard/P&L revenue. COUNTS keep them
    // (Active orders stays the operational total; exchanges are also surfaced
    // separately in their own KPI). Parity math lives server-side (recon 01 §3).
    const activeOrdersCount = Number(orderKpis?.active_count ?? 0);
    const totalRevenue = Number(orderKpis?.total_sales ?? 0);
    const exchangeCount = Number(orderKpis?.exchange_count ?? 0);
    const avgOrderValue = Number(orderKpis?.avg_order ?? 0);
    const filteredAggregateCount = totalOrdersCount;

    return (
        <div className="ant-surface px-2 md:px-3 py-2 space-y-4">
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
                            variant="ghost"
                            onClick={() => setIsExportWizardOpen(true)}
                            className="h-10 px-5 rounded-full border bg-ant-paper text-ant-ink border-ant-line hover:border-ant-ink/25 hover:text-ant-ink text-[12px] font-medium shadow-none gap-2 shrink-0"
                        >
                            <FileDown className="w-3.5 h-3.5" />
                            Exporter
                        </Button>
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
                    value={new Intl.NumberFormat('fr-FR').format(activeOrdersCount)}
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
                                    {pageRows.length.toLocaleString('fr-FR')}
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
                                            onClick={() => { setPageSize(n as 100 | 500 | 1000); setCursorStack([]); }}
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
                                            { v: 'all', l: 'All Time' },
                                            { v: 'today', l: 'Today' },
                                            { v: 'yesterday', l: 'Yesterday' },
                                            { v: 'last7', l: '7 Days' },
                                            { v: 'last30', l: '30 Days' },
                                            { v: 'last90', l: '90 Days' },
                                            { v: 'thisMonth', l: 'This Month' },
                                            { v: 'lastMonth', l: 'Last Month' },
                                            { v: 'ytd', l: 'YTD' },
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
                                                <UserAvatar
                                                    url={u.avatar_url}
                                                    config={(u as any).avatar_config}
                                                    name={u.name}
                                                    className="w-6 h-6 shrink-0 rounded-full border border-ant-ink/5 text-[9px] font-semibold"
                                                />
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
                                                <UserAvatar
                                                    url={s.avatar_url}
                                                    config={(s as any).avatar_config}
                                                    name={s.name}
                                                    className="w-6 h-6 shrink-0 rounded-full border border-ant-ink/5 text-[9px] font-semibold"
                                                />
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
                                            const img = p.type === 'courier' ? p.avatar_url : resolveProviderLogo(p);
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
            ) : pageRows.length === 0 ? (
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
                                {arrangeExchangePairs(pageRows).map((order) => {
                                            // Slim RPC row: server-computed duplicate flag,
                                            // latest_tracking_code, can_track, flat items.
                                            const isDuplicateClient = !!order.is_duplicate_phone;
                                            const isShortCard = shortOrderIds.has(order.id);
                                            const trackingCode = order.latest_tracking_code;
                                            const canTrackParcel = !!order.can_track;
                                            const cardFirstItem = (Array.isArray(order.items) ? order.items : [])
                                                .find((it: any) => it?.image_url);
                                            const cardProductThumb: string | null = cardFirstItem?.image_url || null;
                                            const cardProductLabel: string =
                                                cardFirstItem?.name
                                                || (order.items || []).find((i: any) => i?.name)?.name
                                                || '';
                                            const cardProductCode: string = cardFirstItem?.code || '';
                                            const exchangeRole = order._exchangeRole as ('exchange' | 'sale' | 'original' | undefined);
                                            return (
                                                <div
                                        key={order.id}
                                        className={cn(
                                            "group relative bg-ant-paper rounded-2xl border overflow-hidden transition-all duration-300 hover:shadow-lg cursor-default",
                                            selectedOrders.includes(order.id)
                                                ? "border-ant-ink/20 shadow-md ring-1 ring-ant-ink/10"
                                                : "border-ant-line shadow-sm hover:border-ant-ink/10",
                                            isDuplicateClient && !isShortCard && 'border-yellow-400/50 bg-yellow-400/[0.10]',
                                            isShortCard && 'ring-1 ring-red-500/50 border-red-300 bg-red-500/[0.06]',
                                            exchangeRole === 'exchange' && 'ring-1 ring-purple-500/40 bg-purple-500/[0.05]',
                                            exchangeRole === 'sale' && 'ring-1 ring-emerald-500/35 bg-emerald-500/[0.04]',
                                            exchangeRole === 'original' && 'ring-1 ring-purple-500/30 bg-purple-500/[0.04]',
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
                                                        const rawPkgLabel = order.package_status?.label || courierPkg?.label;
                                                        const rawPkgColor = order.package_status?.color || courierPkg?.color || null;
                                                        const rPkg = resolveById(order.package_status_id) ?? (rawPkgLabel ? resolvePkgStatus(rawPkgLabel, order.package_status?.label, rawPkgColor) : null);
                                                        const pkgLabel = rPkg?.label ?? rawPkgLabel;
                                                        const pkgColor = rPkg?.color ?? rawPkgColor;
                                                        const pkgIcon = rPkg?.icon ?? order.package_status?.icon ?? null;
                                                        if (!pkgLabel) return null;
                                                        return (
                                                            <span
                                                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide"
                                                                style={{
                                                                    backgroundColor: pkgColor ? `${pkgColor}12` : 'rgba(0,31,63,0.04)',
                                                                    color: pkgColor || 'rgba(0,31,63,0.5)',
                                                                }}
                                                            >
                                                                {pkgIcon ? <DynamicIcon name={pkgIcon} className="w-3 h-3" /> : <Truck className="w-3 h-3" />}
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
                                                        <div className="flex items-center gap-1 min-w-0">
                                                            <p
                                                                className={cn(
                                                                    'text-sm font-bold truncate leading-tight',
                                                                    isDuplicateClient ? 'text-[#9a7f00]' : 'text-ant-ink'
                                                                )}
                                                                title={isDuplicateClient ? 'Same phone number on multiple orders' : undefined}
                                                            >
                                                                {order.name}
                                                            </p>
                                                            {isShortCard && (
                                                                <button
                                                                    type="button"
                                                                    title="Stock insuffisant — cliquer pour les détails"
                                                                    onClick={(e) => { e.stopPropagation(); setStockAlert([{ orderName: order.name || 'Commande', lines: computeShortLines(order, productStockById, accessoryStockById) }]); }}
                                                                    className="shrink-0 inline-flex items-center justify-center text-red-500 hover:text-red-600"
                                                                >
                                                                    <AlertTriangle className="w-3.5 h-3.5" />
                                                                </button>
                                                            )}
                                                            {exchangeRole === 'exchange' && (
                                                                <span className="ml-1 shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-500/10 text-purple-700 text-[9px] font-bold uppercase tracking-wide">ÉCHANGE</span>
                                                            )}
                                                            {exchangeRole === 'original' && (
                                                                <span className="ml-1 shrink-0 inline-flex items-center gap-1 text-[9px] font-semibold text-purple-700/70" title="Colis d'origine (retour de l'échange)">↳ origine</span>
                                                            )}
                                                        </div>
                                                        <p className="text-[11px] text-ant-mid font-medium tracking-wide truncate">{order.phone}</p>
                                                    </div>
                                                </div>
                                                {order.assignee ? (
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        <UserAvatar
                                                            url={order.assignee.avatar_url}
                                                            config={(order.assignee as any).avatar_config}
                                                            name={order.assignee.name}
                                                            className="w-6 h-6 rounded-full border border-white shadow-sm text-[9px] font-bold"
                                                        />
                                                        <span className="text-[10px] font-bold text-ant-mid truncate max-w-[60px]">{order.assignee.name}</span>
                                                    </div>
                                                ) : (
                                                    <span className="text-[10px] italic text-ant-mid">—</span>
                                                )}
                                            </div>

                                            {/* Row 3: Metadata chips */}
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                {order.city_name && (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-ant-ink/[0.03] text-[10px] font-bold text-ant-ink/60">
                                                        <MapPin className="w-3 h-3 text-ant-mid" />{order.city_name}
                                                    </span>
                                                )}
                                                {(order as any).channel?.name ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-ant-ink/[0.03] text-[10px] font-bold text-ant-ink/60">
                                                        <FileSpreadsheet className="w-3 h-3 text-[#0F9D58]" />{(order as any).channel.name}
                                                    </span>
                                                ) : order.source_name ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-ant-ink/[0.03] text-[10px] font-bold text-ant-ink/60 capitalize">
                                                        <Hash className="w-3 h-3 text-ant-mid" />{order.source_name}
                                                    </span>
                                                ) : null}
                                                {(order.company?.name || order.courier?.name) && (
                                                    <span className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-lg bg-ant-ink/[0.03] text-[10px] font-bold text-ant-ink/60">
                                                        {resolveProviderLogo(order.company) ? (
                                                            <img src={resolveProviderLogo(order.company)!} alt="" className="w-4 h-4 rounded-full object-contain bg-white" />
                                                        ) : (
                                                            <UserAvatar url={order.courier?.avatar_url} config={(order.courier as any)?.avatar_config} name={order.courier?.name || order.company?.name} className="w-4 h-4 rounded-full" />
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
                            orders={arrangeExchangePairs(pageRows)}
                            selectedOrders={selectedOrders}
                            shortOrderIds={shortOrderIds}
                            toggleOrderSelection={toggleOrderSelection}
                            toggleSelectAll={toggleSelectAll}
                            onView={(order) => { setSelectedOrder(order); setIsViewModalOpen(true); }}
                            onEdit={handleEdit}
                            onDelete={(order) => setOrderPendingDelete(order)}
                            onTrackParcel={(id) => { setParcelTrackingOrderId(id); setParcelTrackingOpen(true); }}
                            onStatusHistory={setHistoryDialogOrder}
                            onQuickStatusChange={(order) => { setQuickStatusOrder(order); setIsQuickStatusOpen(true); }}
                            onStockAlert={(o) => setStockAlert([{ orderName: o.name || 'Commande', lines: computeShortLines(o, productStockById, accessoryStockById) }])}
                            isOrderCategory={isOrderCategory}
                            getCourierPackageStatus={getCourierPackageStatus}
                        />
                    )}

                    {/* Pagination (Prev/Next keyset cursor stack — page size lives in the pill above) */}
                    {(totalPages > 1 || cursorStack.length > 0 || !!pageData?.next_cursor) && (
                        <div className="flex items-center justify-center gap-2 mt-4">
                            <button
                                type="button"
                                onClick={() => setCursorStack((prev) => prev.slice(0, -1))}
                                disabled={cursorStack.length === 0 || pageFetching}
                                className="h-8 px-3 rounded-full border border-ant-line bg-ant-paper text-[12px] font-semibold text-ant-ink hover:bg-ant-light disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                            >
                                Previous
                            </button>
                            <span className="text-[12px] font-semibold text-ant-ink px-2 tabular-nums">
                                {page} <span className="text-ant-mid font-normal">/ {totalPages}</span>
                            </span>
                            <button
                                type="button"
                                onClick={() => {
                                    const next = pageData?.next_cursor;
                                    if (next) setCursorStack((prev) => [...prev, next]);
                                }}
                                disabled={!pageData?.next_cursor || pageFetching}
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
                                                    {(selectedOrder as any)?.channel?.name ? (
                                                        // Sheet-sourced order: the sales channel IS the connected sheet (read-only),
                                                        // not the free-text "source" column from the sheet.
                                                        <div className="h-10 rounded-lg border border-ant-line bg-ant-light/50 px-3 flex items-center gap-2 text-[13px] font-medium text-ant-ink">
                                                            <FileSpreadsheet className="w-4 h-4 text-[#0F9D58] shrink-0" />
                                                            <span className="truncate">{(selectedOrder as any).channel.name}</span>
                                                        </div>
                                                    ) : (
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
                                                    )}
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
            <OrderViewDialog
                orderId={selectedOrder?.id ?? null}
                open={isViewModalOpen}
                onOpenChange={setIsViewModalOpen}
                onEdit={handleEdit}
            />

            {/* Stock Shortage Modal */}
            <StockShortageModal
                open={!!stockAlert}
                onClose={() => setStockAlert(null)}
                groups={stockAlert || []}
            />

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
                                        <UserAvatar
                                            url={seller.avatar_url}
                                            config={(seller as any).avatar_config}
                                            name={seller.name}
                                            className="w-10 h-10 rounded-full border-2 border-white shadow-md text-xs"
                                        />
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

            {/* Export wizard — mounted only while open (lazy chunk loads on demand). */}
            {isExportWizardOpen && (
                <React.Suspense fallback={null}>
                    <OrdersExportWizard
                        isOpen={isExportWizardOpen}
                        onClose={() => setIsExportWizardOpen(false)}
                        activeBusinessId={activeBusinessId}
                    />
                </React.Suspense>
            )}
        </div>
    );
};

export default Orders;
