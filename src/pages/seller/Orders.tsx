import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
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
    BadgeCheck,
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
    Undo2,
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
    AlertTriangle,
    CalendarClock,
    Info,
    FileSpreadsheet,
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
import { resolveProviderLogo } from '@/lib/providerLogos';
import { statusRequiresHistoryComment } from '@/lib/orderHistoryCommentPolicy';
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
import { OrderStatusHistoryDialog } from '@/components/orders/OrderStatusHistoryDialog';
import SellerOrdersListView from '@/components/orders/SellerOrdersListView';
import { StockShortageModal, type StockShortageGroup } from '@/components/orders/StockShortageModal';
import QuickStatusChangeModal from '@/components/orders/QuickStatusChangeModal';
import { DynamicIcon } from '@/lib/renderReactIcon';
import { usePackageStatusResolver } from '@/hooks/usePackageStatusResolver';
import { getLatestTrackableCompanyParcel } from '@/lib/orders/getLatestTrackableCompanyParcel';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { RETURNED_PKG_CATS } from '@/lib/status-categories';
import { computeUnpaidCommission, normalizeCommissionBasis, isDeliveredForCommission, type CommissionBasis } from '@/lib/commercialCommission';
import { isAdminPullback } from '@/lib/analyticsDefinitions';
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserAvatar } from '@/components/users/UserAvatar';
import { Textarea } from "@/components/ui/textarea";
import {
    OrderLineProductCombobox,
    OrderLineProductStockHint,
    toProductStockNumber,
    type OrderLineProductOption,
} from '@/components/orders/OrderLineProductCombobox';
import SourceIcon, { getSourceMeta } from '@/components/orders/SourceIcon';
import { ImageHoverPreview } from '@/components/catalog/ImageHoverPreview';

// --- Stock error helper ---
const friendlyStockError = (error: any): string => {
    const m = String(error?.message || error || '');
    if (m.includes('insufficient_stock')) return "Not enough stock to confirm this order. Restock the product or reduce the quantity.";
    if (m.includes('confirm_via_update')) return "Could not create a confirmed order directly. Please try again.";
    return m || 'Something went wrong.';
};

const computeShortLines = (order: any, productMap: Map<string, number>, accessoryMap: Map<string, number>) => {
    const lines: { name: string; needed: number; have: number }[] = [];
    (order?.items || []).forEach((it: any) => {
        if (it.product_id && Number(it.quantity) > 0) {
            const have = productMap.get(it.product_id) ?? 0;
            if (Number(it.quantity) > have) lines.push({ name: it.product?.name || 'Produit', needed: Number(it.quantity), have });
        }
        if (it.accessory_id && Number(it.accessory_quantity) > 0) {
            const have = accessoryMap.get(it.accessory_id) ?? 0;
            if (Number(it.accessory_quantity) > have) lines.push({ name: it.accessory?.name ? `${it.accessory.name} (accessoire)` : 'Accessoire', needed: Number(it.accessory_quantity), have });
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

const LOCKED_ORDER_CATEGORIES = ['paid', 'unpaid'];
const isOrderLocked = (order: any): boolean => LOCKED_ORDER_CATEGORIES.includes(order?.status?.category);

// --- Schemas ---
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
 * Compact searchable dropdown used across the seller filter bar. Mirrors the
 * admin Orders page helper: Popover + cmdk Command + caller-supplied row
 * renderer. Triggers are sized for the seller-view density (h-8, text-[11px]).
 */
type SearchableFilterProps<T> = {
    value: string;
    onChange: (v: string) => void;
    allLabel: string;
    placeholder: string;
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
    items,
    getKey,
    getSearchText,
    getTriggerLabel,
    renderItem,
}: SearchableFilterProps<T>) {
    const [open, setOpen] = useState(false);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="h-8 w-full rounded-md border border-ant-line bg-ant-paper text-[11px] text-ant-ink flex items-center justify-between gap-2 px-2.5 hover:border-ant-ink/25 transition"
                >
                    <span className="flex-1 text-left truncate">{getTriggerLabel()}</span>
                    <ChevronsUpDown className="w-3 h-3 text-ant-mid shrink-0" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[220px] rounded-xl border-ant-line bg-ant-paper shadow-[0_12px_40px_-20px_rgba(20,20,19,0.3)]"
            >
                <Command
                    filter={(itemValue, search) => {
                        const t = itemValue.toLowerCase();
                        return t.includes(search.toLowerCase()) ? 1 : 0;
                    }}
                >
                    <CommandInput placeholder={placeholder} className="h-8" />
                    <CommandList className="max-h-[260px]">
                        <CommandEmpty className="py-3 text-[11px] text-ant-mid text-center">No matches</CommandEmpty>
                        <CommandGroup>
                            <CommandItem
                                value="__all__"
                                onSelect={() => {
                                    onChange('all');
                                    setOpen(false);
                                }}
                                className="text-[11px] rounded-md cursor-pointer"
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
                                        className="text-[11px] rounded-md cursor-pointer"
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

const DATE_FIELD_MAP: Record<string, string> = {
    date: 'date',
    created_at: 'created_at',
    updated_at: 'updated_at',
    assignment_date: 'assignment_date',
    confirmation_date: 'confirmation_date',
    annulation_date: 'annulation_date',
    date_livraison: 'date_livraison',
    reported_date: 'reported_date',
};

function productNameLabel(p: { name?: unknown; code?: string | null; id?: string } | null | undefined): string {
    if (!p) return 'Product';
    const n = p.name as any;
    if (typeof n === 'string') return n;
    if (n && typeof n === 'object') return String(n.en || n.fr || n.ar || p.code || p.id || 'Product');
    return String(p.code || p.id || 'Product');
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

/** True if the order has any tracking identifier (column or parcel/courier codes). */
function orderHasTrackingNumber(order: any): boolean {
    if (order?.tracking_number && String(order.tracking_number).trim()) return true;
    for (const p of order?.parcels || []) {
        if (p?.tracking_code && String(p.tracking_code).trim()) return true;
    }
    for (const p of order?.courier_parcels || []) {
        if (p?.tracking_code && String(p.tracking_code).trim()) return true;
    }
    return false;
}

type StatusBucket = { id: string; label: string; color: string; icon: string | null; count: number; ranking: number };

function StatusPillsRibbon({
    buckets,
    selectedSet,
    setSelectedSet,
}: {
    buckets: StatusBucket[];
    selectedSet: Set<string>;
    setSelectedSet: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
    const [expanded, setExpanded] = useState(false);
    const [hasOverflow, setHasOverflow] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const SINGLE_ROW_MAX = 44; // pill is h-9 (36px) + container padding tolerance
        const measure = () => {
            setHasOverflow(el.scrollHeight > SINGLE_ROW_MAX);
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [buckets.length]);

    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    const allActive = selectedSet.size === 0;
    const togglePill = (id: string) => {
        setSelectedSet((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <div className="bg-white border border-ant-line rounded-xl p-2.5">
            <div className="flex items-start gap-2">
                <div
                    ref={containerRef}
                    className={cn(
                        "flex flex-wrap items-center gap-1.5 flex-1 min-w-0 transition-[max-height] duration-300 ease-in-out",
                        !expanded && "max-h-[36px] overflow-hidden"
                    )}
                >
                    <button
                        type="button"
                        onClick={() => setSelectedSet(new Set())}
                        className={cn(
                            "shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-semibold transition-all",
                            allActive
                                ? "bg-ant-ink text-white"
                                : "bg-ant-line text-ant-mid hover:bg-ant-line/60 hover:text-ant-ink"
                        )}
                    >
                        All
                        <span
                            className={cn(
                                "min-w-[18px] h-4 flex items-center justify-center px-1 rounded text-[9px] font-bold",
                                allActive ? "bg-white/25 text-white" : "bg-ant-ink/10 text-ant-ink/70"
                            )}
                        >
                            {total}
                        </span>
                    </button>
                    {buckets.map((bucket) => {
                        const isActive = selectedSet.has(bucket.id);
                        return (
                            <button
                                key={bucket.id}
                                type="button"
                                onClick={() => togglePill(bucket.id)}
                                className={cn(
                                    "shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-semibold transition-all",
                                    isActive ? "text-white" : "hover:brightness-95"
                                )}
                                style={
                                    isActive
                                        ? { backgroundColor: bucket.color }
                                        : { backgroundColor: `${bucket.color}14`, color: bucket.color }
                                }
                            >
                                {bucket.icon ? (
                                    <DynamicIcon name={bucket.icon} className="w-3 h-3 shrink-0" style={{ color: isActive ? '#ffffff' : bucket.color }} />
                                ) : (
                                    <span
                                        className="w-1.5 h-1.5 rounded-full shrink-0"
                                        style={{ backgroundColor: isActive ? '#ffffff' : bucket.color }}
                                    />
                                )}
                                <span className="truncate max-w-[160px]">{bucket.label}</span>
                                <span
                                    className={cn(
                                        "min-w-[18px] h-4 flex items-center justify-center px-1 rounded text-[9px] font-bold",
                                        isActive ? "bg-white/25 text-white" : ""
                                    )}
                                    style={!isActive ? { backgroundColor: '#ffffff', color: bucket.color } : undefined}
                                >
                                    {bucket.count}
                                </span>
                            </button>
                        );
                    })}
                </div>
                {hasOverflow && (
                    <button
                        type="button"
                        onClick={() => setExpanded((v) => !v)}
                        aria-label={expanded ? 'Collapse' : 'Expand'}
                        className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md bg-ant-line text-ant-mid hover:bg-ant-line/60 hover:text-ant-ink transition-all"
                    >
                        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-300", expanded && "rotate-180")} />
                    </button>
                )}
            </div>
        </div>
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
    const [searchParams, setSearchParams] = useSearchParams();
    const prefillProductHandledRef = useRef<string | null>(null);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
    const [activeTab, setActiveTab] = useState<'all' | 'confirmed' | 'new' | 'confirmation' | 'suivi' | 'reported' | 'delivered' | 'returned'>('new');
    const [quickStatusOrder, setQuickStatusOrder] = useState<any>(null);
    const [isQuickStatusOpen, setIsQuickStatusOpen] = useState(false);

    // Stock Shortage Modal State
    const [stockAlert, setStockAlert] = useState<StockShortageGroup[] | null>(null);

    useEffect(() => {
        const tab = searchParams.get('tab');
        if (
            tab === 'all'
            || tab === 'confirmed'
            || tab === 'new'
            || tab === 'confirmation'
            || tab === 'suivi'
            || tab === 'reported'
            || tab === 'delivered'
            || tab === 'returned'
        ) {
            setActiveTab(tab);
        }
    }, [searchParams]);
    // sellerStats is derived (useMemo) from `aggregateOrders` further down so
    // KPI cards always reflect the seller's FULL order history, not the page.

    // Reported Modal States
    const [isReportedModalOpen, setIsReportedModalOpen] = useState(false);
    const [reportedData, setReportedData] = useState<{ date: Date | undefined, time: string, comment: string }>({ date: undefined, time: "12:00", comment: "" });
    const [pendingReportedAction, setPendingReportedAction] = useState<((date: Date, time: string, comment: string) => void) | null>(null);
    /** When opening the reported date modal from the status picker, revert pipeline stage if user cancels. */
    const reportedStatusRevertRef = useRef<string | null>(null);

    const statusCats = useStatusCategories();
    const REPORTED_STATUS_ID = statusCats.getOrderByCategory('postponed')?.id;
    const defaultNewOrderStatusId = statusCats.getOrderByCategory('new')?.id ?? '';
    const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provider-integration`;

    // Dropdown search states
    const [citySearchOpen, setCitySearchOpen] = useState(false);
    const cityListRef = useRef<HTMLDivElement>(null);
    const [statusSearchOpen, setStatusSearchOpen] = useState(false);
    const [showCustomerInsights, setShowCustomerInsights] = useState(false);

    // Parcel Tracking States
    const [orderParcel, setOrderParcel] = useState<any>(null);
    const [trackingHistory, setTrackingHistory] = useState<any>(null);
    const [isTrackingLoading, setIsTrackingLoading] = useState(false);
    const [isParcelLoading, setIsParcelLoading] = useState(false);

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const [userId, setUserId] = useState<string | null>(null);

    React.useEffect(() => {
        const getUserId = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            setUserId(user?.id || null);
        };
        getUserId();
    }, []);

    // Filter states
    const [filterStatus, setFilterStatus] = useState<string>("all");
    // Multi-select pill state for confirmation/suivi tabs (empty Set = "all")
    const [pillStatusIds, setPillStatusIds] = useState<Set<string>>(new Set());
    const [pillPackageStatusIds, setPillPackageStatusIds] = useState<Set<string>>(new Set());
    const [filterCity, setFilterCity] = useState<string>("all");
    const [filterSource, setFilterSource] = useState<string>("all");
    const [filterProvider, setFilterProvider] = useState<string>("all");
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
    const [filterPackageStatus, setFilterPackageStatus] = useState<string>('all');
    const [filterExchange, setFilterExchange] = useState<string>('all');
    // Server-side pagination — fetch only the visible page; bump pageSize to
    // search across more history without exhausting the database on every mount.
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState<100 | 500 | 1000>(100);
    const [showAllFilters, setShowAllFilters] = useState(false);
    const [parcelTrackingOpen, setParcelTrackingOpen] = useState(false);
    const [historyDialogOrder, setHistoryDialogOrder] = useState<any>(null);
    const [parcelTrackingOrderId, setParcelTrackingOrderId] = useState<string | null>(null);

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
                background: rgba(0, 31, 63, 0.1);
                border-radius: 10px;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                background: rgba(0, 31, 63, 0.2);
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
    // (mounted in SellerLayout) so it fires regardless of which page is open.
    useEffect(() => {
        if (!activeBusinessId) return;

        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        const debouncedInvalidate = () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ['orders-aggregate', activeBusinessId, userId] });
            }, 500);
        };

        // Stock changes from other users → refresh product/accessory stock FAST so the
        // shortage highlight + stock badges flip in near-realtime.
        let stockTimer: ReturnType<typeof setTimeout> | null = null;
        const debouncedStockInvalidate = () => {
            if (stockTimer) clearTimeout(stockTimer);
            stockTimer = setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ['products-dropdown-seller'] });
                queryClient.invalidateQueries({ queryKey: ['accessories', activeBusinessId] });
            }, 150);
        };

        const channel = supabase
            .channel(`orders-cache-invalidate-seller-${activeBusinessId}`)
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
            .on(
                'postgres_changes' as any,
                { event: 'DELETE', schema: 'public', table: 'orders' },
                () => { debouncedInvalidate(); }
            )
            // Parcel rows carry the carrier/package status the list joins. Their changes
            // (post-link sync, webhooks, note-page sync loop, links/unlinks) must refresh
            // the list too — RLS scopes the stream to this tenant automatically.
            .on(
                'postgres_changes' as any,
                { event: '*', schema: 'public', table: 'company_parcels' },
                () => { debouncedInvalidate(); }
            )
            .on(
                'postgres_changes' as any,
                { event: '*', schema: 'public', table: 'courier_parcels' },
                () => { debouncedInvalidate(); }
            )
            // Stock streams: products/accessories edits → refresh stock so the shortage
            // highlight + badges update in realtime for every concurrent user.
            .on(
                'postgres_changes' as any,
                { event: '*', schema: 'public', table: 'products' },
                () => { debouncedStockInvalidate(); }
            )
            .on(
                'postgres_changes' as any,
                { event: '*', schema: 'public', table: 'accessories' },
                () => { debouncedStockInvalidate(); }
            )
            .subscribe();

        return () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            if (stockTimer) clearTimeout(stockTimer);
            supabase.removeChannel(channel);
        };
    }, [activeBusinessId, userId, queryClient]);

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
                    .select('*, courier:users!courier_parcels_courier_id_fkey(id, name, phone, avatar_url, avatar_config)')
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


    // Single source of truth: ONE query pulls every order this seller can see
    // (assigned OR owned). Pagination is a pure client-side slice further
    // down. `history` is the only heavy join skipped — it's lazy-fetched
    // per-order when the detail modal opens.
    const { data: aggregateOrders = [], isLoading: aggregateLoading } = useQuery<any[]>({
        queryKey: ['orders-aggregate', activeBusinessId, userId],
        queryFn: async () => {
            if (!activeBusinessId || !userId) return [];
            // Paginated (fetchAllRows) so a seller with >1000 orders is never
            // truncated at the 1000-row cap. Paginate by stable 'id', then restore
            // created_at-desc display order client-side (the list is newest-first).
            const rows = await fetchAllRows<any>(
                'orders',
                `
                    *,
                    status:order_statuses(*),
                    package_status:package_statuses(*),
                    city:master_cities(id, name),
                    courier:users!orders_courier_id_fkey(id, name, avatar_url, avatar_config),
                    assignee:users!orders_assign_id_fkey(id, name, avatar_url, avatar_config),
                    company:providers(id, name, provider_type, logo_url),
                    channel:sales_channels!orders_source_id_fkey(id, name, type),
                    items:order_items(*, product:products(name, code, image_url), accessory:accessories(name, code, image_url)),
                    parcels:company_parcels(id, tracking_code, external_id, provider_id, status_label, status_color, created_at, company_delivery_note_id, provider:providers(id, name, logo_url)),
                    courier_parcels(id, tracking_code, status_label, status_color, created_at, courier_delivery_note_id)
                `,
                {
                    orderBy: 'id',
                    orFilter: `seller_id.eq.${userId},assign_id.eq.${userId}`,
                    filters: [
                        { column: 'DigiCom Business', op: 'eq', value: activeBusinessId },
                        { column: 'date_deleted', op: 'is', value: null },
                        { column: 'source_review_status', op: 'neq', value: 'pending' },
                    ],
                },
            );
            return rows.sort((a, b) =>
                new Date((b as any).created_at).getTime() - new Date((a as any).created_at).getTime()
            );
        },
        enabled: !!activeBusinessId && !!userId,
        staleTime: 60 * 1000,
        // Realtime only covers changes made WHILE this page is mounted. Anything that
        // happened on another page (e.g. deleting a delivery note reverts the order) is
        // missed by the subscription, so always refetch on mount / tab refocus instead of
        // serving the 60s-stale cache until a hard refresh.
        refetchOnMount: 'always',
        refetchOnWindowFocus: true,
    });

    // Back-compat aliases — every existing reader of `orders` / `isLoading`
    // keeps working, but now sees the seller's full set. `isLoading` also
    // covers the pre-auth window: until `userId` / `activeBusinessId` exist,
    // the React Query is `enabled: false` so `aggregateLoading` reads
    // `false` even though we don't have data yet — without this guard, the
    // page would flash an empty-state card on every cold mount.
    const orders = aggregateOrders;
    const isLoading = aggregateLoading || !activeBusinessId || !userId;

    // History is lazy-fetched per-order when the detail modal opens (kept off
    // the main aggregate so the page-level fetch stays affordable).
    const { data: selectedOrderHistory = [] } = useQuery<any[]>({
        queryKey: ['order-history', selectedOrder?.id],
        queryFn: async () => {
            if (!selectedOrder?.id) return [];
            const { data, error } = await (supabase as any)
                .from('order_status_history')
                .select('*, user:users!changed_by(name, avatar_url, avatar_config), status:order_statuses!status_id(*)')
                .eq('order_id', selectedOrder.id)
                .order('created_at', { ascending: true });
            if (error) throw error;
            return data || [];
        },
        enabled: !!selectedOrder?.id && isViewModalOpen,
        staleTime: 30 * 1000,
    });


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

    const { data: pkgStatusesForTimeline } = useQuery({
        queryKey: ['package-statuses-timeline'],
        queryFn: async () => {
            const { data } = await supabase.from('package_statuses').select('id, code, label, color, icon, delivery_service_statuses').eq('active', true);
            return data || [];
        },
        staleTime: 5 * 60 * 1000,
    });
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
    // Shared resolver — master status label+color+icon, raw only as fallback.
    const { resolve: resolvePkgStatus } = usePackageStatusResolver();

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

    const { data: packageStatuses } = useQuery({
        queryKey: ['package-statuses-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('package_statuses')
                .select('id, code, label, color, icon, ranking, recheck, show_in_seller_suivi')
                .eq('active', true)
                .order('ranking', { ascending: true });
            if (error) throw error;
            return data;
        },
    });

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

    // ?view=<orderId> — opens the order preview modal. Used by the global
    // OrderStatusNotifications toast (clicked from any seller page) to deep-link
    // into the order it just announced. Same fallback as the admin page: if the
    // order isn't in the cached list, fetch it directly (RLS still enforces that
    // the seller can only see their own orders).
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
            (async () => {
                const { data } = await (supabase as any)
                    .from('orders')
                    .select(`
                        *,
                        status:order_statuses(*),
                        package_status:package_statuses(*),
                        city:master_cities(id, name),
                        courier:users!orders_courier_id_fkey(id, name, avatar_url, avatar_config),
                        assignee:users!orders_assign_id_fkey(id, name, avatar_url, avatar_config),
                        company:providers(id, name, provider_type, logo_url),
                    channel:sales_channels!orders_source_id_fkey(id, name, type),
                        items:order_items(*, product:products(name, code, image_url), accessory:accessories(name, code, image_url)),
                        history:order_status_history(*, user:users!changed_by(name, avatar_url, avatar_config), status:order_statuses!status_id(*)),
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
    useEffect(() => {
        const requestedId = searchParams.get('addProductId');
        if (!requestedId) return;
        if (prefillProductHandledRef.current === requestedId) return;
        if (!products?.length) return;

        const prod = (products as any[]).find((p) => p.id === requestedId);
        if (!prod) {
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
            delvoexpress_old_tracking: '',
        });
        setIsAddModalOpen(true);

        prefillProductHandledRef.current = requestedId;
        const next = new URLSearchParams(searchParams);
        next.delete('addProductId');
        setSearchParams(next, { replace: true });
    }, [searchParams, products, productAccessoriesForOrders, accessories, defaultNewOrderStatusId, form, setSearchParams]);

    const watchedOrderItems = useWatch({ control: form.control, name: 'items' });

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
    const includeDeliveryWatched = form.watch('include_delivery_in_total');
    // Shipping fee is editable only when the "Include delivery fees" toggle is ON
    const shippingFeeReadOnly = !includeDeliveryWatched;

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
            courierFees?.some((f: any) => f.courier_id === c.id && (f.master_city_id === selectedCityId || f.city_id === selectedCityId))
        ) || [];

        const feeCompanies = companies?.filter((c: any) =>
            companyFees?.some((f: any) => f.company_id === c.id && (f.master_city_id === selectedCityId || f.city_id === selectedCityId))
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

    const allProviders = useMemo(() => {
        const c = couriers?.map((p: any) => ({ ...p, type: 'courier' })) || [];
        const comp = companies?.map((p: any) => ({ ...p, type: 'company' })) || [];
        return [...c, ...comp];
    }, [couriers, companies]);

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

    /** Cities that appear on this seller's orders (filter dropdown only; form still uses full `cities`). */
    const sellerFilterCities = useMemo(() => {
        // Source the dropdown from the FULL aggregate so options exist for
        // every city in the seller's history, not just the visible page.
        if (!aggregateOrders?.length) return [] as { id: string; name: string }[];
        const byId = new Map<string, { id: string; name: string }>();
        for (const o of aggregateOrders as any[]) {
            const cid = o.master_city_id || o.city_id;
            if (!cid) continue;
            const embedded = o.city as { id?: string; name?: string } | null | undefined;
            const name = embedded?.name || (cities as any[])?.find((c: any) => c.id === cid)?.name;
            if (name) byId.set(cid, { id: cid, name });
        }
        return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [aggregateOrders, cities]);

    /** Couriers / companies that appear on this seller's orders (filter dropdown only). */
    type SellerFilterProvider = {
        id: string;
        name: string;
        type: 'courier' | 'company';
        imageUrl: string | null;
    };
    const sellerFilterProviders = useMemo<SellerFilterProvider[]>(() => {
        // Dropdown spans the seller's full history, not just the current page.
        // Avatars come from the couriers/companies lookup queries (aggregate's
        // joined courier/company rows only carry id/name to stay light).
        if (!aggregateOrders?.length) return [];
        const list: SellerFilterProvider[] = [];
        const seen = new Set<string>();
        for (const o of aggregateOrders as any[]) {
            if (o.courier_id && !seen.has(`c-${o.courier_id}`)) {
                seen.add(`c-${o.courier_id}`);
                const emb = o.courier as { name?: string } | null | undefined;
                const row = (couriers as any[])?.find((c: any) => c.id === o.courier_id);
                const name = emb?.name || row?.name || 'Courier';
                const imageUrl = row?.avatar_url ?? null;
                list.push({ id: o.courier_id, name, type: 'courier', imageUrl });
            }
            if (o.company_id && !seen.has(`co-${o.company_id}`)) {
                seen.add(`co-${o.company_id}`);
                const emb = o.company as { name?: string } | null | undefined;
                const row = (companies as any[])?.find((c: any) => c.id === o.company_id);
                const name = emb?.name || row?.name || 'Company';
                const imageUrl = resolveProviderLogo(row ?? (o.company as any) ?? { name });
                list.push({ id: o.company_id, name, type: 'company', imageUrl });
            }
        }
        return list.sort((a, b) => a.name.localeCompare(b.name));
    }, [aggregateOrders, couriers, companies]);

    // Auto-select best provider and set fee when city changes
    React.useEffect(() => {
        if (!selectedCityId || !availableProviders.length) return;

        // Helper to find fee for a provider + city
        const findProviderFee = (p: any): number => {
            if (p.type === 'courier') {
                const f = courierFees?.find((f: any) => f.courier_id === p.id && (f.master_city_id === selectedCityId || f.city_id === selectedCityId));
                if (f) return Number(f.fee);
            } else {
                const f = companyFees?.find((f: any) => f.company_id === p.id && (f.master_city_id === selectedCityId || f.city_id === selectedCityId));
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
            fee = (courierFees?.find((f: any) => f.courier_id === selectedCourierId && (f.master_city_id === selectedCityId || f.city_id === selectedCityId))?.fee as number) || 0;
        } else if (selectedCompanyId) {
            fee = (companyFees?.find((f: any) => f.company_id === selectedCompanyId && (f.master_city_id === selectedCityId || f.city_id === selectedCityId))?.fee as number) || 0;
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
                    delivery_type: values.delivery_type,
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
                    seller_id: userId,
                    assign_id: userId
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

            // 3. Track History if status changed
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
            setIsEditModalOpen(false);
            setSelectedOrder(null);
            toast({ title: "Order Updated", description: "Changes saved successfully." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: friendlyStockError(error), variant: "destructive" });
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

    const quickStatusMutation = useMutation<void, any, { orderId: string; statusId: string; reportedDate?: string; comment?: string }>({
        mutationFn: async ({ orderId, statusId, reportedDate, comment }: { orderId: string; statusId: string; reportedDate?: string; comment?: string }) => {
            const userRes = await (supabase as any).auth.getUser();
            const userId = userRes.data.user?.id;

            const updatePayload: any = {
                order_status_id: statusId,
                updated_at: new Date().toISOString(),
            };

            if (statusCats.isOrderCategory(statusId, 'confirmed')) {
                updatePayload.confirmed_by_id = userId;
                updatePayload.confirmation_date = new Date().toISOString();
            }
            if (statusCats.isOrderCategory(statusId, 'cancelled')) {
                updatePayload.canceled_by_id = userId;
                updatePayload.annulation_date = new Date().toISOString();
            }
            if (statusCats.isOrderCategory(statusId, 'paid')) {
                updatePayload.date_livraison = new Date().toISOString();
            }
            if (statusCats.isOrderCategory(statusId, 'postponed')) {
                updatePayload.reported_date = reportedDate || new Date().toISOString();
            }

            // Insert history BEFORE the update so the DB trigger's 5-second
            // dedup check finds it and skips its own "Changement automatique" row.
            await (supabase as any).from('order_status_history').insert({
                order_id: orderId,
                status_id: statusId,
                comment: comment || 'Quick status update',
                changed_by: userId,
                'DigiCom Business': activeBusinessId,
            });

            const { error } = await (supabase as any)
                .from('orders')
                .update(updatePayload)
                .eq('id', orderId)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders-aggregate', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['business-duplicate-phones', activeBusinessId] });
            toast({ title: "Status Updated" });
        },
        onError: (error: any, variables) => {
            if (String(error?.message || '').includes('insufficient_stock')) {
                const o = (orders as any[]).find((x) => x.id === variables.orderId);
                setStockAlert([{ orderName: o?.name || 'Commande', lines: o ? computeShortLines(o, productStockById, accessoryStockById) : [] }]);
            } else {
                toast({ title: "Error", description: friendlyStockError(error), variant: "destructive" });
            }
        },
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
            queryClient.invalidateQueries({ queryKey: ['business-duplicate-phones', activeBusinessId] });
            toast({ title: "Order Moved to Trash", description: "Order moved to trash. You can restore it within 14 days." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    // --- Helpers ---
    // Mirrors public.normalize_phone_for_customer in the DB: digits-only, and
    // if the result is a 10-digit Moroccan local number it's rewritten with 212.
    const normalizeClientPhone = (raw: string | null | undefined): string => {
        if (!raw) return '';
        const digits = raw.toString().replace(/\D/g, '');
        if (!digits) return '';
        if (digits.length === 10 && digits.startsWith('0')) return '212' + digits.slice(1);
        return digits;
    };

    // Business-wide set of phones with more than one order, sourced from the
    // `customers` cache table. This makes the "double client" badge honest
    // across the full business, not just orders attributed to this seller.
    const { data: businessDuplicatePhones } = useQuery({
        queryKey: ['business-duplicate-phones', activeBusinessId],
        enabled: !!activeBusinessId,
        queryFn: async () => {
            const PAGE = 1000;
            let from = 0;
            const set = new Set<string>();
            while (true) {
                const { data, error } = await (supabase as any)
                    .from('customers')
                    .select('phone_normalized')
                    .eq('DigiCom Business', activeBusinessId)
                    .gt('total_orders', 1)
                    .range(from, from + PAGE - 1);
                if (error) throw error;
                if (!data || data.length === 0) break;
                (data as Array<{ phone_normalized: string | null }>).forEach((r) => {
                    if (r.phone_normalized) set.add(r.phone_normalized);
                });
                if (data.length < PAGE) break;
                from += PAGE;
            }
            return set;
        },
    });

    const shortOrderIds = useMemo(() => {
        const s = new Set<string>();
        ((orders as any[]) || []).forEach((o) => {
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
    }, [orders, productStockById, accessoryStockById]);

    const lockedOrderIds = useMemo(() => {
        const s = new Set<string>();
        ((orders as any[]) || []).forEach((o) => { if (isOrderLocked(o)) s.add(o.id); });
        return s;
    }, [orders]);

    const duplicatePhones = useMemo(() => {
        const duplicates = new Set<string>();
        if (!orders || !businessDuplicatePhones || businessDuplicatePhones.size === 0) {
            return duplicates;
        }
        orders.forEach((o: any) => {
            if (!o.phone) return;
            const norm = normalizeClientPhone(o.phone);
            if (norm && businessDuplicatePhones.has(norm)) {
                duplicates.add(o.phone);
            }
        });
        return duplicates;
    }, [orders, businessDuplicatePhones]);

    const isOrderInTab = (o: any, tab: string) => {
        const newStatusId = statusCats.getOrderByCategory('new')?.id;
        const isReported = !!(REPORTED_STATUS_ID && o.order_status_id === REPORTED_STATUS_ID);
        const isNew = !!(newStatusId && o.order_status_id === newStatusId);

        // Confirmation tab: both order_status AND package_status must allow it
        const orderStatusAllowsConfirmation = o.status?.show_in_seller_confirmation !== false;
        const packageStatusAllowsConfirmation = o.package_status?.show_in_seller_confirmation !== false;
        const orderStatusRecheckActive =
            o.status?.recheck === true &&
            o.status?.active !== false &&
            orderStatusAllowsConfirmation &&
            packageStatusAllowsConfirmation;

        // Suivi tab: both order_status AND package_status must allow it
        const orderStatusAllowsSuivi = o.status?.show_in_seller_suivi !== false;
        const packageStatusAllowsSuivi = o.package_status?.show_in_seller_suivi !== false;
        // DB: package_statuses.recheck + active (see Supabase); category 'recheck' counts when flag not set.
        const packageRecheckActive =
            !!o.package_status_id &&
            (o.package_status?.active !== false) &&
            orderStatusAllowsSuivi &&
            packageStatusAllowsSuivi &&
            (o.package_status?.recheck === true ||
                statusCats.isPkgCategory(o.package_status_id, 'recheck'));

        switch (tab) {
            case 'all':
                return true;
            case 'confirmed':
                // Order status category is exactly 'confirmed' (same rule used to
                // stamp confirmed_by_id / confirmation_date on save).
                return !!o.order_status_id
                    && statusCats.isOrderCategory(o.order_status_id, 'confirmed');
            case 'new':
                return isNew;
            case 'confirmation':
                if (isReported || isNew) return false;
                if (orderHasTrackingNumber(o)) return false;
                return orderStatusRecheckActive;
            case 'suivi':
                if (isReported) return false;
                if (!orderHasTrackingNumber(o)) return false;
                return packageRecheckActive;
            case 'reported':
                return isReported;
            case 'delivered':
                // Terminal success: package_status category is 'delivered'.
                // Category-strict (no label match) to match the P&L / Coliaty
                // rule used everywhere else in the app.
                return !!o.package_status_id
                    && statusCats.isPkgCategory(o.package_status_id, 'delivered');
            case 'returned':
                // Returned family: package_status category in returned / returning / refused.
                return !!o.package_status_id
                    && statusCats.isPkgInCategories(o.package_status_id, RETURNED_PKG_CATS);
            default:
                return false;
        }
    };

    // Reusable predicate — applied to both the paginated `orders` and the
    // full `aggregateOrders` so the KPI strip stays stable across page-size
    // changes but still reacts to active filters.
    const orderMatchesAllFilters = useMemo(() => (o: any) => {
        const matchesSearch = orderMatchesTopSearch(o, searchQuery);
        const matchesStatus = (filterStatus === "all" || o.order_status_id === filterStatus)
            && (pillStatusIds.size === 0 || pillStatusIds.has(o.order_status_id));
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
        const matchesPackageStatus = (filterPackageStatus === 'all' || o.package_status_id === filterPackageStatus)
            && (pillPackageStatusIds.size === 0 || pillPackageStatusIds.has(o.package_status_id));
        const matchesExchange = filterExchange === 'all' || (filterExchange === 'yes' && o.replace) || (filterExchange === 'no' && !o.replace);
        return matchesSearch && matchesStatus && matchesCity && matchesSource && matchesProvider
            && matchesDate && matchesCustomerName && matchesPhone && matchesTracking && matchesProduct && matchesPackageStatus && matchesExchange;
    }, [searchQuery, filterStatus, filterCity, filterSource, filterProvider, getDateRange, filterDateField, filterCustomerName, filterPhone, filterTracking, filterProduct, filterPackageStatus, filterExchange, pillStatusIds, pillPackageStatusIds]);

    // `baseFilteredOrders` is kept as an alias of `baseFilteredAggregate`
    // because `orders === aggregateOrders` now — every consumer reading either
    // gets the same full filtered set.
    const baseFilteredAggregate = useMemo(() => aggregateOrders.filter(orderMatchesAllFilters), [aggregateOrders, orderMatchesAllFilters]);
    const baseFilteredOrders = baseFilteredAggregate;

    const activeFilterCount = useMemo(() => {
        let count = 0;
        if (filterStatus !== 'all') count++;
        if (pillStatusIds.size > 0) count++;
        if (pillPackageStatusIds.size > 0) count++;
        if (filterCity !== 'all') count++;
        if (filterSource !== 'all') count++;
        if (filterProvider !== 'all') count++;
        if (filterTimeRange !== 'all') count++;
        if (filterCustomerName) count++;
        if (filterPhone) count++;
        if (filterTracking.trim()) count++;
        if (filterProduct !== 'all') count++;
        if (filterPackageStatus !== 'all') count++;
        if (filterExchange !== 'all') count++;
        return count;
    }, [filterStatus, filterCity, filterSource, filterProvider, filterTimeRange, filterCustomerName, filterPhone, filterTracking, filterProduct, filterPackageStatus, filterExchange, pillStatusIds, pillPackageStatusIds]);

    const clearAllFilters = () => {
        setFilterStatus('all');
        setPillStatusIds(new Set());
        setPillPackageStatusIds(new Set());
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
        setFilterExchange('all');
        setShowCalendar(false);
    };

    // Snap back to page 1 whenever the active filter set, tab, or search bar
    // changes. Without this, applying a filter while on page 6 would land the
    // user on an empty page even though matches exist earlier in the list.
    useEffect(() => {
        setPage(1);
    }, [searchQuery, activeTab, filterStatus, pillStatusIds, pillPackageStatusIds, filterCity, filterSource, filterProvider, filterTimeRange, filterCustomRange, filterDateField, filterCustomerName, filterPhone, filterTracking, filterProduct, filterPackageStatus, filterExchange]);

    const tabCounts = useMemo(() => {
        const counts = { all: 0, confirmed: 0, new: 0, confirmation: 0, suivi: 0, reported: 0, delivered: 0, returned: 0, reportedToday: false, reportedNow: false };
        const now = new Date();
        const todayStr = format(now, 'yyyy-MM-dd');
        const currentHour = now.getHours();

        // Tab badges must count the FULL filtered aggregate (every order this
        // seller can see that passes active filters), not just the current page.
        baseFilteredAggregate.forEach((o: any) => {
            counts.all++;
            if (isOrderInTab(o, 'confirmed')) counts.confirmed++;
            if (isOrderInTab(o, 'new')) counts.new++;
            if (isOrderInTab(o, 'confirmation')) counts.confirmation++;
            if (isOrderInTab(o, 'suivi')) counts.suivi++;
            if (isOrderInTab(o, 'delivered')) counts.delivered++;
            if (isOrderInTab(o, 'returned')) counts.returned++;
            if (isOrderInTab(o, 'reported')) {
                counts.reported++;
                if (o.reported_date) {
                    const rDate = new Date(o.reported_date);
                    const rDateStr = format(rDate, 'yyyy-MM-dd');
                    if (rDateStr === todayStr) {
                        counts.reportedToday = true;
                        if (rDate.getHours() === currentHour) {
                            counts.reportedNow = true;
                        }
                    }
                }
            }
        });
        return counts;
    }, [baseFilteredAggregate]);

    // KPI/pill totals — over the FULL filtered aggregate, not the visible page.
    const filteredAggregate = useMemo(
        () => baseFilteredAggregate.filter((o: any) => isOrderInTab(o, activeTab)),
        [baseFilteredAggregate, activeTab],
    );
    const filteredAggregateCount = filteredAggregate.length;

    // Pagination is a pure client-side slice of the FILTERED aggregate. KPIs,
    // tab counts, recheck pills and dropdowns all see the full set above; only
    // the rendered rows shrink to one page. Filter / tab changes auto-reset
    // page below so the user can never strand themselves on an empty page.
    const totalOrdersCount = filteredAggregateCount;
    const totalPages = Math.max(1, Math.ceil(totalOrdersCount / pageSize));
    const filteredOrders = useMemo(() => {
        const from = (page - 1) * pageSize;
        return filteredAggregate.slice(from, from + pageSize);
    }, [filteredAggregate, page, pageSize]);

    // Clamp `page` when filteredAggregate shrinks past it (e.g. realtime delete
    // removes the row that was the last one on the current page).
    useEffect(() => {
        if (page > totalPages) setPage(totalPages);
    }, [page, totalPages]);

    // Recheck status pill buckets for Confirmation/Suivi tabs.
    // Apply all base filters EXCEPT the one the pill itself controls.
    const orderPassesNonStatusFilters = (o: any) => {
        if (!orderMatchesTopSearch(o, searchQuery)) return false;
        if (filterCity !== 'all' && o.master_city_id !== filterCity && o.city_id !== filterCity) return false;
        if (filterSource !== 'all' && o.source_name !== filterSource) return false;
        if (filterProvider !== 'all' && o.courier_id !== filterProvider && o.company_id !== filterProvider) return false;
        if (getDateRange) {
            const fieldKey = DATE_FIELD_MAP[filterDateField] || 'date';
            const dateVal = o[fieldKey];
            if (!dateVal) return false;
            if (!isWithinInterval(new Date(dateVal), { start: getDateRange.from, end: getDateRange.to })) return false;
        }
        if (filterCustomerName && !o.name?.toLowerCase().includes(filterCustomerName.toLowerCase())) return false;
        if (filterPhone && !o.phone?.includes(filterPhone)) return false;
        if (!orderMatchesTrackingFilter(o, filterTracking)) return false;
        if (filterProduct !== 'all' && !o.items?.some((item: any) => item.product_id === filterProduct)) return false;
        if (filterExchange !== 'all') {
            if (filterExchange === 'yes' && !o.replace) return false;
            if (filterExchange === 'no' && o.replace) return false;
        }
        return true;
    };

    const recheckOrderStatusBuckets = useMemo(() => {
        if (activeTab !== 'confirmation') return [] as StatusBucket[];
        const seed = (orderStatuses as any[] | undefined)?.filter((s) => s.recheck === true && s.show_in_seller_confirmation !== false) ?? [];
        const buckets = new Map<string, StatusBucket>();
        for (const s of seed) {
            buckets.set(s.id, {
                id: s.id,
                label: s.label || 'Status',
                color: s.color || '#94a3b8',
                icon: s.icon || null,
                ranking: s.ranking ?? 9999,
                count: 0,
            });
        }
        // Count over the FULL aggregate so pill numbers match what the seller
        // would see across every page, not just the current one.
        for (const o of (aggregateOrders as any[] | undefined) ?? []) {
            if (!orderPassesNonStatusFilters(o)) continue;
            if (filterPackageStatus !== 'all' && o.package_status_id !== filterPackageStatus) continue;
            if (pillPackageStatusIds.size > 0 && !pillPackageStatusIds.has(o.package_status_id)) continue;
            if (!isOrderInTab(o, 'confirmation')) continue;
            const sid = o.status?.id;
            if (!sid) continue;
            const existing = buckets.get(sid);
            if (existing) {
                existing.count++;
            } else if (o.status?.recheck === true) {
                buckets.set(sid, {
                    id: sid,
                    label: o.status.label || 'Status',
                    color: o.status.color || '#94a3b8',
                    icon: o.status.icon || null,
                    ranking: o.status.ranking ?? 9999,
                    count: 1,
                });
            }
        }
        return Array.from(buckets.values()).sort((a, b) => a.ranking - b.ranking);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [aggregateOrders, orderStatuses, activeTab, searchQuery, filterCity, filterSource, filterProvider, getDateRange, filterDateField, filterCustomerName, filterPhone, filterTracking, filterProduct, filterPackageStatus, filterExchange, pillPackageStatusIds]);

    const recheckPackageStatusBuckets = useMemo(() => {
        if (activeTab !== 'suivi') return [] as StatusBucket[];
        const seedFromMaster = (packageStatuses as any[] | undefined)?.filter((s) => s.recheck === true && s.show_in_seller_suivi !== false) ?? [];
        const buckets = new Map<string, StatusBucket>();
        for (const s of seedFromMaster) {
            buckets.set(s.id, {
                id: s.id,
                label: s.label || 'Status',
                color: s.color || '#94a3b8',
                icon: s.icon || null,
                ranking: s.ranking ?? 9999,
                count: 0,
            });
        }
        // Also seed any package status flagged as the 'recheck' category even if recheck flag missing.
        for (const s of (packageStatuses as any[] | undefined) ?? []) {
            if (buckets.has(s.id)) continue;
            if (statusCats.isPkgCategory(s.id, 'recheck')) {
                buckets.set(s.id, {
                    id: s.id,
                    label: s.label || 'Status',
                    color: s.color || '#94a3b8',
                    icon: s.icon || null,
                    ranking: s.ranking ?? 9999,
                    count: 0,
                });
            }
        }
        // Count over the FULL aggregate so pill numbers match what the seller
        // would see across every page, not just the current one.
        for (const o of (aggregateOrders as any[] | undefined) ?? []) {
            if (!orderPassesNonStatusFilters(o)) continue;
            if (filterStatus !== 'all' && o.order_status_id !== filterStatus) continue;
            if (pillStatusIds.size > 0 && !pillStatusIds.has(o.order_status_id)) continue;
            if (!isOrderInTab(o, 'suivi')) continue;
            const sid = o.package_status?.id;
            if (!sid) continue;
            const existing = buckets.get(sid);
            if (existing) existing.count++;
        }
        return Array.from(buckets.values()).sort((a, b) => a.ranking - b.ranking);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [aggregateOrders, packageStatuses, activeTab, searchQuery, filterStatus, filterCity, filterSource, filterProvider, getDateRange, filterDateField, filterCustomerName, filterPhone, filterTracking, filterProduct, filterExchange, pillStatusIds]);

    // Lifetime paid-out cash for this seller. Cached separately so it doesn't
    // refetch on page changes. Drives the "Commission due" KPI.
    const { data: sellerPaidAmount = 0 } = useQuery<number>({
        queryKey: ['seller-payments-paid-sum', userId],
        queryFn: async () => {
            if (!userId) return 0;
            const { data, error } = await supabase
                .from('seller_payments')
                .select('paid_amount')
                .eq('seller_id', userId);
            if (error) throw error;
            return (data || []).reduce(
                (sum: number, p: any) => sum + (Number(p.paid_amount) || 0),
                0,
            );
        },
        enabled: !!userId,
        staleTime: 60 * 1000,
    });

    // Seller KPI cards — derived from the FULL aggregate (every order this
    // seller can see), never the paginated page. Cards stay consistent across
    // page-size / page-number changes.
    const sellerStats = useMemo(() => {
        const basis = normalizeCommissionBasis(sellerProfile?.commission_basis);
        const commissionRate = Number(sellerProfile?.commission_price) || 0;
        const empty = {
            confirmRate: 0,
            deliveryRate: 0,
            unpaidCommission: 0,
            totalDelivered: 0,
            commissionRate,
            commissionBasis: basis,
        };
        if (!aggregateOrders?.length || !userId) return empty;

        const allOrders = aggregateOrders;

        const delivered = allOrders.filter((o: any) =>
            isDeliveredForCommission(o, statusCats.deliveredPkgIds),
        ).length;

        const trackedSet = new Set<string>();
        allOrders.forEach((o: any) => {
            if (!o?.id) return;
            const parcels: Array<{ tracking_code?: string | null }> = Array.isArray(o.parcels) ? o.parcels : [];
            const courierParcels: Array<{ tracking_code?: string | null }> = Array.isArray(o.courier_parcels) ? o.courier_parcels : [];
            const hasCompanyTracking = parcels.some((p) => !!p?.tracking_code && String(p.tracking_code).trim().length > 0);
            const hasCourierTracking = courierParcels.some((p) => !!p?.tracking_code && String(p.tracking_code).trim().length > 0);
            if (hasCompanyTracking || hasCourierTracking) trackedSet.add(o.id);
        });

        const statusMapsReady = statusCats.pendingIds.size > 0;
        const rateConfirmedCount = allOrders.filter((o: any) => {
            const hasTracking = !!o.id && trackedSet.has(o.id);
            if (hasTracking) return true;
            return statusMapsReady
                && !!o.order_status_id
                && !statusCats.pendingIds.has(o.order_status_id);
        }).length;
        const confirmRate = allOrders.length > 0 ? (rateConfirmedCount / allOrders.length) * 100 : 0;
        const trackedCount = allOrders.filter((o: any) => !!o.id && trackedSet.has(o.id)).length;
        const pullbackCount = allOrders.filter((o: any) =>
            !!o.id && trackedSet.has(o.id) && isAdminPullback(o, true, statusCats.adminPullbackOrderIds, statusCats.adminPullbackPackageIds),
        ).length;
        const deliveryDenom = trackedCount - pullbackCount;
        const deliveryRate = deliveryDenom > 0 ? (delivered / deliveryDenom) * 100 : 0;

        const commissionOrders = allOrders.filter((o: any) => o.seller_id === userId);
        const isDelivered = (o: any) =>
            isDeliveredForCommission(o, statusCats.deliveredPkgIds);
        const { unpaidCommission } = computeUnpaidCommission({
            basis,
            commissionPrice: commissionRate,
            orders: commissionOrders,
            isDelivered,
            sellerProductIds,
            paidAmount: sellerPaidAmount,
        });

        return {
            confirmRate,
            deliveryRate,
            unpaidCommission,
            totalDelivered: delivered,
            commissionRate,
            commissionBasis: basis,
        };
    }, [aggregateOrders, userId, sellerProfile, sellerProductIds, sellerPaidAmount, statusCats.deliveredPkgIds, statusCats.pendingIds, statusCats.adminPullbackOrderIds, statusCats.adminPullbackPackageIds]);

    const handleEdit = (order: any) => {
        if (isOrderLocked(order)) { toast({ title: "Commande verrouillée", description: "Commande livrée et clôturée — modification impossible.", variant: "destructive" }); return; }
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

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Commercial · Pipeline
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Commandes
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Votre flux de ventes — confirmation, suivi, livraison, signalement. Tout, en un seul tableau.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <WebhookHealthIndicator activeBusinessId={activeBusinessId} />
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                            <Input
                                placeholder="Rechercher commandes…"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 h-9 w-60 rounded-full border-ant-line bg-ant-paper text-[12px] focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => {
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
                            }}
                            className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold cursor-pointer transition-colors"
                        >
                            <PlusCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
                            Nouvelle commande
                        </button>
                    </div>
                </header>

                {/* Seller Performance KPIs */}
                <section className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                    {[
                        { label: 'Taux de livraison', value: `${sellerStats.deliveryRate.toFixed(1)}%`, sub: `${sellerStats.totalDelivered} livrées`, dot: 'bg-ant-green', text: 'text-ant-green' },
                        { label: 'Taux de confirmation', value: `${sellerStats.confirmRate.toFixed(1)}%`, sub: 'taux de succès', dot: 'bg-ant-ink', text: 'text-ant-ink' },
                        { label: 'Commission due', value: `${new Intl.NumberFormat('fr-FR').format(Math.round(sellerStats.unpaidCommission))}`, unit: 'MAD', sub: `${sellerStats.commissionRate} MAD / ${sellerStats.commissionBasis === 'per_unit' ? 'unité' : 'commande'}`, dot: 'bg-ant-orange', text: 'text-ant-orange' },
                        { label: 'Mes commandes', value: new Intl.NumberFormat('fr-FR').format(filteredAggregateCount), sub: 'vue actuelle', dot: 'bg-ant-mid', text: 'text-ant-ink' },
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
                            <p className="font-serif italic text-[11px] text-ant-mid mt-0.5 truncate">{s.sub}</p>
                        </div>
                    ))}
                </section>

                {/* Pipeline Tabs */}
                <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper w-full overflow-x-auto ant-scroll">
                    {[
                        { id: 'all', label: 'Toutes', count: tabCounts.all, icon: LayoutGrid },
                        { id: 'new', label: 'Nouveau', count: tabCounts.new, icon: Package },
                        { id: 'confirmed', label: 'Confirmée', count: tabCounts.confirmed, icon: BadgeCheck },
                        { id: 'delivered', label: 'Livré', count: tabCounts.delivered, icon: CheckCircle2 },
                        { id: 'returned', label: 'Retourné', count: tabCounts.returned, icon: Undo2 },
                        { id: 'confirmation', label: 'Confirmation', count: tabCounts.confirmation, icon: Phone },
                        { id: 'suivi', label: 'Suivi', count: tabCounts.suivi, icon: Truck },
                        { id: 'reported', label: 'Signalées', count: tabCounts.reported, icon: AlertTriangle },
                    ].map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        const isReportedNow = tab.id === 'reported' && (tabCounts as any).reportedNow;
                        const isReportedToday = tab.id === 'reported' && (tabCounts as any).reportedToday;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={cn(
                                    'inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer',
                                    isActive
                                        ? 'bg-ant-ink text-white'
                                        : isReportedNow
                                            ? 'bg-ant-rose text-white animate-pulse'
                                            : isReportedToday
                                                ? 'bg-ant-orange text-white'
                                                : 'text-ant-mid hover:text-ant-ink',
                                )}
                            >
                                <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
                                <span>{tab.label}</span>
                                <span
                                    className={cn(
                                        'inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full text-[10px] font-bold tabular-nums',
                                        isActive
                                            ? 'bg-white/20 text-white'
                                            : isReportedNow || isReportedToday
                                                ? 'bg-white/20 text-white'
                                                : 'bg-ant-light text-ant-mid',
                                    )}
                                >
                                    {tab.count}
                                </span>
                            </button>
                        );
                    })}
                </div>

            {/* Recheck status pills (Confirmation = order_statuses.recheck, Suivi = package_statuses.recheck) */}
            {(activeTab === 'confirmation' || activeTab === 'suivi') && (() => {
                const allBuckets = activeTab === 'confirmation' ? recheckOrderStatusBuckets : recheckPackageStatusBuckets;
                const selectedSet = activeTab === 'confirmation' ? pillStatusIds : pillPackageStatusIds;
                const setSelectedSet = activeTab === 'confirmation' ? setPillStatusIds : setPillPackageStatusIds;
                // Show only buckets with data, or buckets currently selected (so the user can deselect them).
                const buckets = allBuckets.filter((b) => b.count > 0 || selectedSet.has(b.id));
                if (!buckets.length) return null;
                return (
                    <StatusPillsRibbon
                        buckets={buckets}
                        selectedSet={selectedSet}
                        setSelectedSet={setSelectedSet}
                    />
                );
            })()}

                {/* Filters Toolbar */}
                <div className="space-y-2">
                    <div className="flex flex-col xl:flex-row gap-2 items-start xl:items-center justify-between">
                        <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
                            <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper shrink-0">
                                <button
                                    onClick={() => setViewMode('grid')}
                                    aria-label="Vue grille"
                                    className={cn(
                                        'inline-flex items-center justify-center h-8 w-8 rounded-full transition-colors cursor-pointer',
                                        viewMode === 'grid' ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink',
                                    )}
                                >
                                    <LayoutGrid className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    onClick={() => setViewMode('list')}
                                    aria-label="Vue liste"
                                    className={cn(
                                        'inline-flex items-center justify-center h-8 w-8 rounded-full transition-colors cursor-pointer',
                                        viewMode === 'list' ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink',
                                    )}
                                >
                                    <List className="w-3.5 h-3.5" />
                                </button>
                            </div>

                            <button
                                type="button"
                                onClick={() => setShowAllFilters(!showAllFilters)}
                                className={cn(
                                    'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[11px] font-semibold transition-colors cursor-pointer',
                                    showAllFilters
                                        ? 'bg-ant-ink text-white border-ant-ink'
                                        : 'bg-ant-paper text-ant-ink border-ant-line hover:bg-ant-light',
                                )}
                            >
                                <Filter className="w-3 h-3" strokeWidth={1.75} />
                                Filtres
                                {activeFilterCount > 0 && (
                                    <span className={cn(
                                        'inline-flex items-center justify-center min-w-[16px] h-4 rounded-full text-[9px] font-bold leading-none px-1 tabular-nums',
                                        showAllFilters ? 'bg-white/25 text-white' : 'bg-ant-orange text-white',
                                    )}>
                                        {activeFilterCount}
                                    </span>
                                )}
                            </button>

                        {activeFilterCount > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                                {filterTimeRange !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-ant-line bg-ant-light text-ant-ink text-[10px] font-semibold">
                                        <Clock className="w-3 h-3" />
                                        {filterTimeRange === 'custom' && filterCustomRange?.from
                                            ? `${format(filterCustomRange.from, 'dd/MM')}–${filterCustomRange.to ? format(filterCustomRange.to, 'dd/MM') : '...'}`
                                            : filterTimeRange.replace(/([A-Z])/g, ' $1').trim()}
                                        <button type="button" onClick={() => { setFilterTimeRange('all'); setFilterCustomRange(undefined); setShowCalendar(false); }} className="ml-0.5 hover:text-ant-rose transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterStatus !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-ant-line bg-ant-light text-ant-ink text-[10px] font-semibold">
                                        <ShieldCheck className="w-3 h-3" />
                                        {orderStatuses?.find((s: any) => s.id === filterStatus)?.label || 'Status'}
                                        <button type="button" onClick={() => setFilterStatus('all')} className="ml-0.5 hover:text-ant-rose transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterPackageStatus !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-ant-line bg-ant-light text-ant-ink text-[10px] font-semibold">
                                        <Package className="w-3 h-3" />
                                        {packageStatuses?.find((s: any) => s.id === filterPackageStatus)?.label || 'Package'}
                                        <button type="button" onClick={() => setFilterPackageStatus('all')} className="ml-0.5 hover:text-ant-rose transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterCity !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-ant-line bg-ant-light text-ant-ink text-[10px] font-semibold">
                                        <MapPin className="w-3 h-3" />
                                        {sellerFilterCities.find((c) => c.id === filterCity)?.name || cities?.find((c: any) => c.id === filterCity)?.name || 'City'}
                                        <button type="button" onClick={() => setFilterCity('all')} className="ml-0.5 hover:text-ant-rose transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterProduct !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-ant-line bg-ant-light text-ant-ink text-[10px] font-semibold max-w-[200px]">
                                        <ShoppingBag className="w-3 h-3 shrink-0" />
                                        <span className="truncate">{productNameLabel((products as any[])?.find((p: any) => p.id === filterProduct))}</span>
                                        <button type="button" onClick={() => setFilterProduct('all')} className="ml-0.5 hover:text-ant-rose transition-colors shrink-0"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterCustomerName && (
                                    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-ant-line bg-ant-light text-ant-ink text-[10px] font-semibold max-w-[180px]">
                                        <User className="w-3 h-3 shrink-0" />
                                        <span className="truncate">&quot;{filterCustomerName}&quot;</span>
                                        <button type="button" onClick={() => setFilterCustomerName('')} className="ml-0.5 hover:text-ant-rose transition-colors shrink-0"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterPhone && (
                                    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-ant-line bg-ant-light text-ant-ink text-[10px] font-semibold">
                                        <Phone className="w-3 h-3" />
                                        {filterPhone}
                                        <button type="button" onClick={() => setFilterPhone('')} className="ml-0.5 hover:text-ant-rose transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterTracking.trim() && (
                                    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-ant-line bg-ant-light text-ant-ink text-[10px] font-semibold max-w-[220px]">
                                        <Hash className="w-3 h-3 shrink-0" />
                                        <span className="truncate">{filterTracking.trim()}</span>
                                        <button type="button" onClick={() => setFilterTracking('')} className="ml-0.5 hover:text-ant-rose transition-colors shrink-0"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterSource !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-ant-line bg-ant-light text-ant-ink text-[10px] font-semibold capitalize">
                                        <ExternalLink className="w-3 h-3" />
                                        {filterSource}
                                        <button type="button" onClick={() => setFilterSource('all')} className="ml-0.5 hover:text-ant-rose transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterProvider !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-ant-line bg-ant-light text-ant-ink text-[10px] font-semibold max-w-[200px]">
                                        <Truck className="w-3 h-3 shrink-0" />
                                        <span className="truncate">{sellerFilterProviders.find((p) => p.id === filterProvider)?.name || allProviders.find((p: any) => p.id === filterProvider)?.name || 'Service'}</span>
                                        <button type="button" onClick={() => setFilterProvider('all')} className="ml-0.5 hover:text-ant-rose transition-colors shrink-0"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterExchange !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-ant-line bg-ant-light text-ant-ink text-[10px] font-semibold">
                                        <RefreshCcw className="w-3 h-3" />
                                        {filterExchange === 'yes' ? 'Exchange: Yes' : 'Exchange: No'}
                                        <button type="button" onClick={() => setFilterExchange('all')} className="ml-0.5 hover:text-ant-rose transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                <button type="button" onClick={clearAllFilters} className="h-6 px-2 rounded-md text-[10px] font-semibold text-ant-rose/70 hover:text-ant-rose hover:bg-ant-rose/10 transition-colors">
                                    Clear all
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <div className="inline-flex items-stretch h-8 rounded-full bg-ant-paper border border-ant-line overflow-hidden">
                            <div className="inline-flex items-baseline gap-1 px-3 tabular-nums self-center">
                                <span className="font-display text-[13px] font-semibold text-ant-ink tracking-[-0.01em]">
                                    {filteredOrders.length.toLocaleString('fr-FR')}
                                </span>
                                <span className="text-[10px] font-medium text-ant-mid">of</span>
                                <span className="font-display text-[13px] font-semibold text-ant-ink tracking-[-0.01em]" title={`Total ${filteredAggregateCount.toLocaleString('fr-FR')}`}>
                                    {filteredAggregateCount.toLocaleString('fr-FR')}
                                </span>
                                <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-ant-mid ml-0.5">records</span>
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

                {showAllFilters && (
                    <div className="bg-white border border-ant-line rounded-xl overflow-hidden">
                        <div className="p-3.5 border-b border-ant-line">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid mb-2.5">Date &amp; Time</p>
                            <div className="flex flex-wrap items-end gap-3">
                                <div className="space-y-1 min-w-[140px]">
                                    <span className="text-[9px] font-bold text-ant-mid uppercase tracking-[0.12em]">Filter By</span>
                                    <Select value={filterDateField} onValueChange={setFilterDateField}>
                                        <SelectTrigger className="h-8 rounded-md border-ant-line text-[11px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="date" className="text-[11px]">Order Date</SelectItem>
                                            <SelectItem value="created_at" className="text-[11px]">Created Date</SelectItem>
                                            <SelectItem value="updated_at" className="text-[11px]">Updated Date</SelectItem>
                                            <SelectItem value="assignment_date" className="text-[11px]">Assigned Date</SelectItem>
                                            <SelectItem value="confirmation_date" className="text-[11px]">Confirmed Date</SelectItem>
                                            <SelectItem value="annulation_date" className="text-[11px]">Cancelled Date</SelectItem>
                                            <SelectItem value="date_livraison" className="text-[11px]">Delivered Date</SelectItem>
                                            <SelectItem value="reported_date" className="text-[11px]">Reported Date</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <span className="text-[9px] font-bold text-ant-mid uppercase tracking-[0.12em]">Range</span>
                                    <div className="flex flex-wrap gap-1">
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
                                                type="button"
                                                onClick={() => { setFilterTimeRange(opt.v); if (opt.v !== 'custom') setShowCalendar(false); else setShowCalendar(true); }}
                                                className={cn(
                                                    "h-8 px-2.5 rounded-md text-[11px] font-semibold transition-all border",
                                                    filterTimeRange === opt.v
                                                        ? "bg-ant-ink text-white border-ant-ink"
                                                        : "bg-white text-ant-mid border-ant-line hover:border-gray-300 hover:text-ant-ink"
                                                )}
                                            >
                                                {opt.l}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                {filterTimeRange === 'custom' && (
                                    <div className="space-y-1">
                                        <span className="text-[9px] font-bold text-ant-mid uppercase tracking-[0.12em]">Pick Dates</span>
                                        <Popover open={showCalendar} onOpenChange={setShowCalendar}>
                                            <PopoverTrigger asChild>
                                                <Button variant="outline" className="h-8 rounded-md border-ant-line text-[11px] font-semibold text-ant-ink gap-1.5 px-3">
                                                    <Calendar className="w-3 h-3" />
                                                    {filterCustomRange?.from ? (
                                                        filterCustomRange.to ? (
                                                            <>{format(filterCustomRange.from, 'MMM dd')} — {format(filterCustomRange.to, 'MMM dd, yyyy')}</>
                                                        ) : format(filterCustomRange.from, 'MMM dd, yyyy')
                                                    ) : 'Select range...'}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0 rounded-xl border border-ant-line shadow-none" align="start">
                                                <CalendarComponent
                                                    mode="range"
                                                    selected={calendarRange}
                                                    onSelect={handleCustomRangeSelect}
                                                    onDayMouseEnter={(day) => setHoveredCalendarDate(day)}
                                                    onDayMouseLeave={() => setHoveredCalendarDate(undefined)}
                                                    modifiers={calendarPreviewRange ? { preview: calendarPreviewRange } : undefined}
                                                    modifiersClassNames={{ preview: 'bg-accent text-accent-foreground' }}
                                                    numberOfMonths={2}
                                                    className="rounded-xl p-3"
                                                />
                                            </PopoverContent>
                                        </Popover>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="p-3.5 border-b border-ant-line">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid mb-2.5">Customer Search</p>
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="relative">
                                    <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-ant-mid" />
                                    <Input
                                        placeholder="Customer name..."
                                        value={filterCustomerName}
                                        onChange={(e) => setFilterCustomerName(e.target.value)}
                                        className="h-8 w-[180px] pl-7 rounded-md border-ant-line text-[11px]"
                                    />
                                </div>
                                <div className="relative">
                                    <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-ant-mid" />
                                    <Input
                                        placeholder="Phone number..."
                                        value={filterPhone}
                                        onChange={(e) => setFilterPhone(e.target.value)}
                                        className="h-8 w-[160px] pl-7 rounded-md border-ant-line text-[11px]"
                                    />
                                </div>
                                <div className="relative">
                                    <Hash className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-ant-mid" />
                                    <Input
                                        placeholder="Tracking number..."
                                        value={filterTracking}
                                        onChange={(e) => setFilterTracking(e.target.value)}
                                        className="h-8 w-[180px] pl-7 rounded-md border-ant-line text-[11px]"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="p-3.5">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid mb-2.5">Filters</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                                <div className="space-y-1">
                                    <span className="text-[9px] font-bold text-ant-mid uppercase tracking-[0.12em] flex items-center gap-1">
                                        <ShieldCheck className="w-2.5 h-2.5" /> Status
                                    </span>
                                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                                        <SelectTrigger className="h-8 rounded-md border-ant-line text-[11px]">
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-[300px]">
                                            <SelectItem value="all" className="text-[11px]">All Statuses</SelectItem>
                                            {orderStatuses?.map((s: any) => (
                                                <SelectItem key={s.id} value={s.id} className="text-[11px]">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                                                        {s.label}
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-1">
                                    <span className="text-[9px] font-bold text-ant-mid uppercase tracking-[0.12em] flex items-center gap-1">
                                        <Package className="w-2.5 h-2.5" /> Package
                                    </span>
                                    <Select value={filterPackageStatus} onValueChange={setFilterPackageStatus}>
                                        <SelectTrigger className="h-8 rounded-md border-ant-line text-[11px]">
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-[300px]">
                                            <SelectItem value="all" className="text-[11px]">All Packages</SelectItem>
                                            {packageStatuses?.map((s: any) => (
                                                <SelectItem key={s.id} value={s.id} className="text-[11px]">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                                                        {s.label}
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-1">
                                    <span className="text-[9px] font-bold text-ant-mid uppercase tracking-[0.12em] flex items-center gap-1">
                                        <MapPin className="w-2.5 h-2.5" /> City
                                    </span>
                                    <SearchableFilter
                                        value={filterCity}
                                        onChange={setFilterCity}
                                        allLabel="All Cities"
                                        placeholder="Search cities..."
                                        items={sellerFilterCities}
                                        getKey={(c) => c.id}
                                        getSearchText={(c) => c.name || ''}
                                        getTriggerLabel={() =>
                                            sellerFilterCities.find((c) => c.id === filterCity)?.name
                                            ?? (cities as any[])?.find((c: any) => c.id === filterCity)?.name
                                            ?? 'All'
                                        }
                                        renderItem={(c) => <span className="truncate">{c.name}</span>}
                                    />
                                </div>

                                <div className="space-y-1">
                                    <span className="text-[9px] font-bold text-ant-mid uppercase tracking-[0.12em] flex items-center gap-1">
                                        <ShoppingBag className="w-2.5 h-2.5" /> Product
                                    </span>
                                    <SearchableFilter
                                        value={filterProduct}
                                        onChange={setFilterProduct}
                                        allLabel="All Products"
                                        placeholder="Search products..."
                                        items={products as any[]}
                                        getKey={(p: any) => p.id}
                                        getSearchText={(p: any) => `${productNameLabel(p)} ${p.code || ''}`}
                                        getTriggerLabel={() => {
                                            const p = (products as any[])?.find((x: any) => x.id === filterProduct);
                                            return p ? productNameLabel(p) : 'All';
                                        }}
                                        renderItem={(p: any) => (
                                            <span className="flex items-center gap-2 min-w-0">
                                                {p.image_url ? (
                                                    <img
                                                        src={p.image_url}
                                                        alt=""
                                                        className="w-5 h-5 rounded object-cover border border-ant-ink/5 shrink-0"
                                                    />
                                                ) : (
                                                    <span className="w-5 h-5 rounded bg-ant-ink/5 flex items-center justify-center shrink-0">
                                                        <Package className="w-2.5 h-2.5 text-ant-mid" />
                                                    </span>
                                                )}
                                                <span className="truncate">{productNameLabel(p)}</span>
                                            </span>
                                        )}
                                    />
                                </div>

                                <div className="space-y-1">
                                    <span className="text-[9px] font-bold text-ant-mid uppercase tracking-[0.12em] flex items-center gap-1">
                                        <ExternalLink className="w-2.5 h-2.5" /> Source
                                    </span>
                                    <SearchableFilter
                                        value={filterSource}
                                        onChange={setFilterSource}
                                        allLabel="All Sources"
                                        placeholder="Search sources..."
                                        items={SALES_SOURCES.map((s) => ({ id: s, name: s }))}
                                        getKey={(s) => s.id}
                                        getSearchText={(s) => s.name}
                                        getTriggerLabel={() => filterSource !== 'all' ? (
                                            <span className="inline-flex items-center gap-1.5 capitalize">
                                                <SourceIcon source={filterSource} />
                                                {filterSource}
                                            </span>
                                        ) : 'All'}
                                        renderItem={(s) => (
                                            <span className="flex items-center gap-2 capitalize">
                                                <SourceIcon source={s.id} />
                                                <span className="truncate">{s.name}</span>
                                            </span>
                                        )}
                                    />
                                </div>

                                <div className="space-y-1">
                                    <span className="text-[9px] font-bold text-ant-mid uppercase tracking-[0.12em] flex items-center gap-1">
                                        <Truck className="w-2.5 h-2.5" /> Delivery
                                    </span>
                                    <SearchableFilter
                                        value={filterProvider}
                                        onChange={setFilterProvider}
                                        allLabel="All Services"
                                        placeholder="Search providers..."
                                        items={sellerFilterProviders}
                                        getKey={(p) => p.id}
                                        getSearchText={(p) => p.name || ''}
                                        getTriggerLabel={() => sellerFilterProviders.find((p) => p.id === filterProvider)?.name ?? 'All'}
                                        renderItem={(p) => (
                                            <span className="flex items-center gap-2 min-w-0">
                                                {p.imageUrl ? (
                                                    <img
                                                        src={p.imageUrl}
                                                        alt=""
                                                        className="w-5 h-5 rounded object-cover bg-white border border-ant-ink/5 shrink-0"
                                                    />
                                                ) : (
                                                    <span className="w-5 h-5 rounded bg-ant-ink/5 flex items-center justify-center shrink-0">
                                                        {p.type === 'courier'
                                                            ? <Truck className="w-2.5 h-2.5 text-ant-mid" />
                                                            : <Building2 className="w-2.5 h-2.5 text-ant-mid" />}
                                                    </span>
                                                )}
                                                <span className="truncate">{p.name}</span>
                                            </span>
                                        )}
                                    />
                                </div>

                                <div className="space-y-1">
                                    <span className="text-[9px] font-bold text-ant-mid uppercase tracking-[0.12em] flex items-center gap-1">
                                        <RefreshCcw className="w-2.5 h-2.5" /> Exchange
                                    </span>
                                    <Select value={filterExchange} onValueChange={setFilterExchange}>
                                        <SelectTrigger className="h-8 rounded-md border-ant-line text-[11px]">
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all" className="text-[11px]">All Orders</SelectItem>
                                            <SelectItem value="yes" className="text-[11px]">Yes (Exchange)</SelectItem>
                                            <SelectItem value="no" className="text-[11px]">No (Normal)</SelectItem>
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-48 w-full rounded-xl" />
                    ))}
                </div>
            ) : filteredOrders.length === 0 ? (
                <Card className="border border-ant-line shadow-none rounded-xl">
                    <CardContent className="p-8 text-center">
                        <ShoppingCart className="w-8 h-8 text-ant-mid mx-auto mb-2.5" />
                        <h3 className="text-[13px] font-semibold text-ant-ink">No orders found</h3>
                        <p className="text-[11px] text-ant-mid mt-0.5">Start by adding your first customer order.</p>
                    </CardContent>
                </Card>
            ) : (
                viewMode === 'grid' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {arrangeExchangePairs(filteredOrders).map((order) => {
                            const allParcels = [...(order.parcels || []), ...(order.courier_parcels || [])].filter((p: any) => p.tracking_code);
                            const latestParcel = allParcels.sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())?.[0];
                            const trackingCode = latestParcel?.tracking_code;
                            const isDuplicateClient = duplicatePhones.has(order.phone);
                            const isShortCard = shortOrderIds.has(order.id);
                            const cardLocked = isOrderLocked(order);
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
                            const exchangeRole = order._exchangeRole as ('exchange' | 'sale' | 'original' | undefined);
                            return (
                                <div
                                    key={order.id}
                                    className={cn("group relative bg-white rounded-xl border border-ant-line overflow-hidden transition-colors hover:bg-ant-light/50 cursor-default", isDuplicateClient && !isShortCard && 'border-yellow-400/50 bg-yellow-400/[0.10]', isShortCard && 'ring-1 ring-red-500/50 border-red-300 bg-red-500/[0.06]', exchangeRole === 'exchange' && 'ring-1 ring-purple-500/40 bg-purple-500/[0.05]', exchangeRole === 'sale' && 'ring-1 ring-emerald-500/35 bg-emerald-500/[0.04]', exchangeRole === 'original' && 'ring-1 ring-purple-500/30 bg-purple-500/[0.04]')}
                                >
                                    {/* Top accent line */}
                                    <div className="h-[3px] w-full" style={{ backgroundColor: order.status?.color || '#cbd5e1' }} />

                                    <div className="p-4 space-y-3">
                                        {/* Row 1: Status + Package */}
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
                                                <span
                                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide"
                                                    style={{ backgroundColor: `${order.status?.color}12`, color: order.status?.color }}
                                                >
                                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: order.status?.color }} />
                                                    {order.status?.label || 'DRAFT'}
                                                </span>
                                                {(() => {
                                                    const courierPkg = getCourierPackageStatus(order);
                                                    const rawPkgLabel = order.package_status?.label || order.package_status_label || courierPkg?.label;
                                                    const rawPkgColor = order.package_status?.color || courierPkg?.color || null;
                                                    const rPkg = rawPkgLabel ? resolvePkgStatus(rawPkgLabel, order.package_status?.label, rawPkgColor) : null;
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
                                                <DropdownMenuContent align="end" className="rounded-xl border border-ant-line shadow-none p-1.5 min-w-[160px]">
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
                                                    <DropdownMenuItem onClick={() => handleEdit(order)} disabled={cardLocked} className="rounded-lg px-3 py-2 cursor-pointer gap-2.5 text-xs font-bold">
                                                        <Edit2 className="w-3.5 h-3.5" /> Edit Order
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>

                                        {/* Row 2: Customer */}
                                        <div className="flex items-center gap-2.5 min-w-0">
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
                                                    {exchangeRole === 'sale' && (
                                                        <span className="ml-1 shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 text-[9px] font-bold uppercase tracking-wide" title="Produit ajouté — vente liée à l'échange">+ VENTE</span>
                                                    )}
                                                    {exchangeRole === 'original' && (
                                                        <span className="ml-1 shrink-0 inline-flex items-center gap-1 text-[9px] font-semibold text-purple-700/70" title="Colis d'origine (retour de l'échange)">↳ origine</span>
                                                    )}
                                                </div>
                                                <p className="text-[11px] text-ant-ink/40 font-medium tracking-wide truncate">{order.phone}</p>
                                            </div>
                                        </div>

                                        {/* Row 3: Metadata chips */}
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            {order.city?.name && (
                                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-ant-ink/[0.03] text-[10px] font-bold text-ant-ink/60">
                                                    <MapPin className="w-3 h-3 text-ant-ink/30" />{order.city.name}
                                                </span>
                                            )}
                                            {(order as any).channel?.name ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-ant-ink/[0.03] text-[10px] font-bold text-ant-ink/60">
                                                    <FileSpreadsheet className="w-3 h-3 text-[#0F9D58]" />{(order as any).channel.name}
                                                </span>
                                            ) : order.source_name ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-ant-ink/[0.03] text-[10px] font-bold text-ant-ink/60 capitalize">
                                                    <Hash className="w-3 h-3 text-ant-ink/30" />{order.source_name}
                                                </span>
                                            ) : null}
                                            {(order.company?.name || order.courier?.name) && (
                                                <span className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-lg bg-ant-ink/[0.03] text-[10px] font-bold text-ant-ink/60">
                                                    {resolveProviderLogo(order.company) ? (
                                                        <img src={resolveProviderLogo(order.company)!} alt="" className="w-4 h-4 rounded-full object-contain bg-white" />
                                                    ) : order.courier ? (
                                                        <UserAvatar url={order.courier.avatar_url} config={(order.courier as any).avatar_config} name={order.courier.name} className="w-4 h-4 rounded-full text-[8px]" />
                                                    ) : (
                                                        <span className="w-4 h-4 rounded-full bg-ant-ink/10 flex items-center justify-center text-[8px] font-semibold text-ant-ink/60">
                                                            {(order.company?.name || '?').slice(0, 1).toUpperCase()}
                                                        </span>
                                                    )}
                                                    {order.company?.name || order.courier?.name}
                                                </span>
                                            )}
                                        </div>

                                        {/* Row 4: Tracking code */}
                                        {trackingCode && (
                                            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-ant-light border border-ant-line">
                                                <Package className="w-3.5 h-3.5 text-ant-mid shrink-0" />
                                                <span className="text-[11px] font-mono font-semibold text-ant-ink/70 truncate">{trackingCode}</span>
                                            </div>
                                        )}

                                        {/* Row 5: Reported recall */}
                                        {(REPORTED_STATUS_ID && (statusCats.isOrderCategory(order.order_status_id, 'postponed') || order.order_status_id === REPORTED_STATUS_ID)) && order.reported_date && (
                                            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-ant-orange/10 border border-ant-orange/20">
                                                <div className="flex items-center gap-2">
                                                    <Calendar className="w-3.5 h-3.5 text-ant-orange" />
                                                    <span className="text-[11px] font-bold text-ant-orange">
                                                        {format(new Date(order.reported_date), 'dd MMM yyyy')}
                                                    </span>
                                                </div>
                                                <span className="text-[10px] font-bold bg-ant-orange/100 text-white px-1.5 py-0.5 rounded">
                                                    {format(new Date(order.reported_date), 'HH:mm')}
                                                </span>
                                            </div>
                                        )}

                                        {/* Row 6: Footer — Price + View */}
                                        <div className="flex items-center justify-between pt-2 border-t border-ant-line gap-2">
                                            <div className="flex items-baseline gap-1 min-w-0">
                                                <span className="text-[15px] font-semibold text-ant-ink tabular-nums">
                                                    {new Intl.NumberFormat('fr-FR').format(order.price || 0)}
                                                </span>
                                                <span className="text-[10px] font-semibold text-ant-mid uppercase">DH</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                                                <button
                                                    type="button"
                                                    onClick={() => { setSelectedOrder(order); setIsViewModalOpen(true); }}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ant-ink/[0.05] hover:bg-ant-ink text-ant-ink/50 hover:text-white text-[11px] font-bold transition-all duration-200"
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
                                                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ant-ink/[0.05] hover:bg-ant-ink text-ant-ink/50 hover:text-white text-[11px] font-bold transition-all duration-200',
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
                                                    className="w-7 h-7 rounded-lg flex items-center justify-center bg-ant-ink/[0.05] hover:bg-ant-ink text-ant-ink/50 hover:text-white transition-all duration-200"
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
                    <SellerOrdersListView
                        orders={arrangeExchangePairs(filteredOrders)}
                        duplicatePhones={duplicatePhones}
                        shortOrderIds={shortOrderIds}
                        lockedOrderIds={lockedOrderIds}
                        onView={(order) => { setSelectedOrder(order); setIsViewModalOpen(true); }}
                        onEdit={handleEdit}
                        onTrackParcel={(id) => { setParcelTrackingOrderId(id); setParcelTrackingOpen(true); }}
                        onStatusHistory={setHistoryDialogOrder}
                        onQuickStatusChange={(order) => { if (isOrderLocked(order)) { toast({ title: "Commande verrouillée", description: "Commande livrée et clôturée — changement de statut impossible.", variant: "destructive" }); return; } setQuickStatusOrder(order); setIsQuickStatusOpen(true); }}
                        onStockAlert={(o) => setStockAlert([{ orderName: o.name || 'Commande', lines: computeShortLines(o, productStockById, accessoryStockById) }])}
                        isOrderCategory={statusCats.isOrderCategory}
                        getCourierPackageStatus={getCourierPackageStatus}
                        reportedStatusId={REPORTED_STATUS_ID}
                    />
                )
            )
            }

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

                            if (
                                isEditModalOpen &&
                                selectedOrder &&
                                v.order_status_id !== selectedOrder.order_status_id &&
                                statusRequiresHistoryComment(v.order_status_id) &&
                                !v.history_comment?.trim()
                            ) {
                                form.setError('history_comment', { type: 'manual', message: 'Comment is required for this status.' });
                                toast({ title: "Validation Error", description: "Please provide a reason for this status.", variant: "destructive" });
                                return;
                            }

                            const targetIsPostponed =
                                !!REPORTED_STATUS_ID &&
                                (targetStatusId === REPORTED_STATUS_ID ||
                                    statusCats.isOrderCategory(targetStatusId, 'postponed'));
                            const sourceWasPostponed =
                                isEditModalOpen &&
                                selectedOrder &&
                                (selectedOrder.order_status_id === REPORTED_STATUS_ID ||
                                    statusCats.isOrderCategory(selectedOrder.order_status_id, 'postponed'));
                            if (targetIsPostponed && !sourceWasPostponed && !(v as { _reportedDate?: string })._reportedDate?.trim()) {
                                toast({
                                    title: 'Reported date required',
                                    description: 'Choose the reported status and pick date/time in the popup before saving.',
                                    variant: 'destructive',
                                });
                                return;
                            }

                            if (!isEditModalOpen) {
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

                            if (isEditModalOpen) updateOrderMutation.mutate(v); else createOrderMutation.mutate(v);
                        })} className="flex flex-col h-full overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange shrink-0" />
                            <DialogHeader className="px-6 pt-4 pb-3.5 pr-12 shrink-0 border-b border-ant-line bg-ant-paper text-left space-y-1">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                    {isEditModalOpen ? 'Commande · Modification' : 'Commande · Nouvelle'}
                                </div>
                                <DialogTitle className="font-display text-[18px] font-semibold text-ant-ink tracking-[-0.02em] leading-tight">
                                    {isEditModalOpen ? 'Mettre à jour la commande' : 'Nouvelle commande'}
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
                                                    {(selectedOrder as any)?.channel?.name ? (
                                                        <div className="h-10 rounded-xl bg-ant-ink/[0.04] shadow-inner px-3 flex items-center gap-2 text-sm font-bold text-ant-ink">
                                                            <FileSpreadsheet className="w-4 h-4 text-[#0F9D58] shrink-0" />
                                                            <span className="truncate">{(selectedOrder as any).channel.name}</span>
                                                        </div>
                                                    ) : (
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
                                                            <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Shipping Provider</FormLabel>
                                                            <Select
                                                                onValueChange={(val) => {
                                                                    const provider = availableProviders.find(p => p.id === val);
                                                                    if (provider?.type === 'courier') {
                                                                        form.setValue('courier_id', val);
                                                                        form.setValue('company_id', null);
                                                                        const fee = courierFees?.find((f: any) => f.courier_id === val && (f.master_city_id === selectedCityId || f.city_id === selectedCityId))?.fee;
                                                                        form.setValue('shipping_cost', fee ? Number(fee) : 0);
                                                                    } else {
                                                                        form.setValue('company_id', val);
                                                                        form.setValue('courier_id', null);
                                                                        const fee = companyFees?.find((f: any) => f.company_id === val && (f.master_city_id === selectedCityId || f.city_id === selectedCityId))?.fee;
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

                                        {isEditModalOpen &&
                                            selectedOrder &&
                                            form.watch('order_status_id') !== selectedOrder.order_status_id &&
                                            statusRequiresHistoryComment(form.watch('order_status_id')) && (
                                            <FormField
                                                control={form.control}
                                                name="history_comment"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                                                        <FormLabel className="text-[9px] font-bold uppercase tracking-[0.18em] text-ant-ink/60 flex items-center gap-1">
                                                            <MessageSquare className="w-3 h-3 text-ant-ink/40" /> Status change reason (required)
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Textarea placeholder="Explain why you are moving to this status…" {...field} className="min-h-[56px] resize-y rounded-xl border-none bg-ant-ink/[0.03] text-sm font-bold text-ant-ink placeholder:text-ant-ink/30 placeholder:font-medium shadow-inner focus-visible:ring-ant-orange/40" />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        )}

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
                                                                        blockZeroStock={!isEditModalOpen}
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
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsAddModalOpen(false);
                                            setIsEditModalOpen(false);
                                        }}
                                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light text-[12px] font-semibold text-ant-ink cursor-pointer transition-colors"
                                    >
                                        Annuler
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={
                                            createOrderMutation.isPending ||
                                            updateOrderMutation.isPending ||
                                            (!isEditModalOpen && newOrderHasZeroStockProduct)
                                        }
                                        className="inline-flex items-center gap-2 h-9 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[12px] font-semibold cursor-pointer transition-colors active:scale-[0.99]"
                                    >
                                        {(createOrderMutation.isPending || updateOrderMutation.isPending) && <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.75} />}
                                        {isEditModalOpen ? 'Enregistrer' : 'Confirmer la commande'}
                                    </button>
                                </div>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* View Modal */}
            <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
                <DialogContent className="max-w-4xl p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)] overflow-hidden flex flex-col h-[90vh] md:h-auto md:max-h-[90vh]">
                    {selectedOrder && (
                        <div className="flex flex-col h-full overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange shrink-0" />
                            <div className="px-6 pt-5 pb-4 flex flex-col md:flex-row justify-between items-start gap-4 shrink-0 border-b border-ant-line">
                                <div className="space-y-2">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                        Commande · Aperçu
                                    </div>
                                    <div>
                                        <h2 className="font-display text-[22px] font-semibold text-ant-ink tracking-[-0.02em] leading-tight">{selectedOrder.name}</h2>
                                        <div className="flex items-center gap-3 mt-1.5 font-serif italic text-[12px] text-ant-mid">
                                            <span className="inline-flex items-center gap-1.5">
                                                <Calendar className="w-3 h-3" strokeWidth={1.75} />
                                                {format(new Date(selectedOrder.date || selectedOrder.created_at), 'd MMMM yyyy')}
                                            </span>
                                            <span className="inline-flex items-center gap-1.5 text-ant-ink not-italic font-display font-semibold tabular-nums text-[12px]">
                                                {selectedOrder.phone}
                                                <OrderPhoneQuickActions phone={selectedOrder.phone} className="h-7 w-7" />
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                        <span
                                            className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                                            style={{
                                                backgroundColor: `${selectedOrder.status?.color || '#141413'}15`,
                                                borderColor: `${selectedOrder.status?.color || '#141413'}40`,
                                                color: selectedOrder.status?.color || '#141413',
                                            }}
                                        >
                                            {selectedOrder.status?.icon ? (
                                                <DynamicIcon name={selectedOrder.status.icon} className="w-3 h-3" style={{ color: selectedOrder.status?.color }} />
                                            ) : (
                                                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: selectedOrder.status?.color || '#141413' }} />
                                            )}
                                            {selectedOrder.status?.label || 'Brouillon'}
                                        </span>
                                        {(() => {
                                            const courierPkg = getCourierPackageStatus(selectedOrder);
                                            const rawPkgLabel = selectedOrder.package_status?.label || selectedOrder.package_status_label || courierPkg?.label;
                                            const rawPkgColor = selectedOrder.package_status?.color || courierPkg?.color || null;
                                            const rPkg = rawPkgLabel ? resolvePkgStatus(rawPkgLabel, selectedOrder.package_status?.label, rawPkgColor) : null;
                                            const pkgLabel = rPkg?.label ?? rawPkgLabel;
                                            const pkgColor = rPkg?.color ?? rawPkgColor;
                                            const pkgIcon = rPkg?.icon ?? selectedOrder.package_status?.icon ?? null;
                                            if (!pkgLabel) return null;
                                            const color = pkgColor || '#6B6760';
                                            return (
                                                <span
                                                    className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                                                    style={{
                                                        backgroundColor: `${color}15`,
                                                        borderColor: `${color}40`,
                                                        color,
                                                    }}
                                                >
                                                    {pkgIcon ? (
                                                        <DynamicIcon name={pkgIcon} className="w-3 h-3" style={{ color }} />
                                                    ) : pkgColor ? (
                                                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                                                    ) : (
                                                        <Truck className="w-3 h-3" style={{ color }} />
                                                    )}
                                                    {pkgLabel}
                                                </span>
                                            );
                                        })()}
                                        <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-ink/15 bg-ant-ink/6 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ant-ink">
                                            <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                                            {selectedOrder.source_name || '—'}
                                        </span>
                                        {selectedOrder.replace && (
                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-rose/25 bg-ant-rose/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ant-rose">
                                                <RefreshCcw className="w-3 h-3" strokeWidth={1.75} />
                                                Échange
                                            </span>
                                        )}
                                        {orderParcel?.tracking_code && (
                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ant-ink">
                                                <Package className="w-3 h-3" strokeWidth={1.75} />
                                                {orderParcel.tracking_code}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="rounded-xl border border-ant-line bg-ant-ink px-4 py-3 min-w-[180px]">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">Valeur commande</p>
                                    <p className="font-display text-[22px] font-semibold text-white tabular-nums mt-1 leading-none">
                                        {selectedOrder.price || 0}
                                        <span className="text-[11px] text-white/50 font-normal ml-1">MAD</span>
                                    </p>
                                </div>
                            </div>

                            <div className="overflow-y-auto ant-scroll p-5 space-y-4 flex-1">
                                {/* Customer Insights in Preview */}
                                <CustomerInsights phone={selectedOrder.phone || ''} />

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {/* Logistics Info */}
                                    <div className="rounded-xl border border-ant-line bg-ant-paper p-4 space-y-3">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <Truck className="w-3 h-3" strokeWidth={1.75} />
                                            Détails de livraison
                                        </div>
                                        <div className="space-y-3">
                                            <div className="flex items-start gap-3">
                                                <MapPinned className="w-3.5 h-3.5 text-ant-mid shrink-0 mt-0.5" />
                                                <div className="space-y-0.5">
                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid leading-none">Destination</p>
                                                    <p className="text-[12px] font-semibold text-ant-ink leading-tight">{selectedOrder.city?.name}</p>
                                                    <p className="text-[11px] text-ant-mid italic">"{selectedOrder.address}"</p>
                                                </div>
                                            </div>
                                            <div className="flex items-start gap-3">
                                                <ShoppingCart className="w-3.5 h-3.5 text-ant-mid shrink-0 mt-0.5" />
                                                <div className="space-y-0.5">
                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid leading-none">Shipping Configuration</p>
                                                    <p className="text-[12px] font-semibold text-ant-ink leading-tight">{selectedOrder.delivery_type || 'Standard Delivery'}</p>
                                                    <p className="text-[10px] font-semibold text-ant-green uppercase tracking-wider">{selectedOrder.shipping_cost === 0 ? 'Free Shipping' : `Paid: ${selectedOrder.shipping_cost} DH`}</p>
                                                </div>
                                            </div>
                                            {(selectedOrder.courier || selectedOrder.company) && (
                                                <div className="flex items-start gap-3">
                                                    {resolveProviderLogo(selectedOrder.company) ? (
                                                        <div className="w-7 h-7 rounded-lg bg-ant-light border border-ant-line flex items-center justify-center shrink-0 overflow-hidden">
                                                            <img src={resolveProviderLogo(selectedOrder.company)!} alt={selectedOrder.company.name} className="w-full h-full object-contain" />
                                                        </div>
                                                    ) : selectedOrder.courier ? (
                                                        <UserAvatar url={selectedOrder.courier.avatar_url} config={(selectedOrder.courier as any).avatar_config} name={selectedOrder.courier.name} className="w-7 h-7 rounded-lg border border-ant-line text-[10px]" />
                                                    ) : (
                                                        <div className="w-7 h-7 rounded-lg bg-ant-light border border-ant-line flex items-center justify-center shrink-0 overflow-hidden">
                                                            <Building2 className="w-3.5 h-3.5 text-ant-mid" />
                                                        </div>
                                                    )}
                                                    <div className="space-y-0.5">
                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid leading-none">Assigned Provider</p>
                                                        <p className="text-[12px] font-semibold text-ant-ink leading-tight">
                                                            {selectedOrder.courier?.name || selectedOrder.company?.name}
                                                        </p>
                                                        <span className="text-[9px] font-semibold text-ant-mid uppercase tracking-wider">
                                                            {selectedOrder.courier ? 'Independent Courier' : 'Delivery Company'}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                            {String(selectedOrder.coliaty_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-3">
                                                    <RefreshCcw className="w-3.5 h-3.5 text-ant-orange shrink-0 mt-0.5" />
                                                    <div className="space-y-0.5 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid leading-none">
                                                            Previous parcel tracking (Coliaty)
                                                        </p>
                                                        <p className="text-[11px] font-mono font-semibold text-ant-ink break-all">
                                                            {String(selectedOrder.coliaty_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(selectedOrder.ameex_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-3">
                                                    <RefreshCcw className="w-3.5 h-3.5 text-ant-orange shrink-0 mt-0.5" />
                                                    <div className="space-y-0.5 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid leading-none">
                                                            Previous parcel tracking (AMEEX)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(selectedOrder.ameex_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(selectedOrder.quicklivraison_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-3">
                                                    <RefreshCcw className="w-3.5 h-3.5 text-ant-orange shrink-0 mt-0.5" />
                                                    <div className="space-y-0.5 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid leading-none">
                                                            Previous parcel tracking (Quick Livraison)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(selectedOrder.quicklivraison_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(selectedOrder.forcelog_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-3">
                                                    <RefreshCcw className="w-3.5 h-3.5 text-ant-orange shrink-0 mt-0.5" />
                                                    <div className="space-y-0.5 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid leading-none">
                                                            Previous parcel tracking (Forcelog)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(selectedOrder.forcelog_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(selectedOrder.sendit_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-3">
                                                    <RefreshCcw className="w-3.5 h-3.5 text-ant-orange shrink-0 mt-0.5" />
                                                    <div className="space-y-0.5 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid leading-none">
                                                            Previous parcel tracking (Sendit)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-ant-ink break-all">
                                                            {String(selectedOrder.sendit_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(selectedOrder.delvoexpress_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-3">
                                                    <RefreshCcw className="w-3.5 h-3.5 text-ant-orange shrink-0 mt-0.5" />
                                                    <div className="space-y-0.5 min-w-0">
                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid leading-none">
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
                                    <div className="rounded-xl border border-ant-line bg-ant-paper p-4 space-y-3">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <MessageSquare className="w-3 h-3" strokeWidth={1.75} />
                                            Notes &amp; instructions
                                        </div>
                                        <div className="space-y-2">
                                            <div className="p-3 rounded-xl bg-ant-light border border-ant-line space-y-1">
                                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Note interne</p>
                                                <p className="text-[12px] text-ant-ink leading-relaxed">{selectedOrder.note || <span className="font-serif italic text-ant-mid">Aucune note interne.</span>}</p>
                                            </div>
                                            <div className="p-3 rounded-xl bg-ant-light border border-ant-line space-y-1">
                                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Note livraison publique</p>
                                                <p className="font-serif italic text-[12px] text-ant-ink leading-relaxed">« {selectedOrder.delivery_note || 'Aucune consigne spéciale.'} »</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <Separator className="bg-ant-line" />

                                {/* Order Items Table */}
                                <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                    <div className="h-[3px] w-full bg-ant-green" />
                                    <div className="px-4 py-3 border-b border-ant-line flex items-center justify-between">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <Package className="w-3 h-3" strokeWidth={1.75} />
                                            Panier
                                        </div>
                                        <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-ink/15 bg-ant-ink/6 px-2 py-0.5 text-[10px] font-semibold text-ant-ink tabular-nums">
                                            <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                                            {selectedOrder.items?.length || 0} référence(s)
                                        </span>
                                    </div>
                                    <div className="p-4 grid grid-cols-1 gap-3">
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
                                                        className="group p-3 rounded-xl border border-ant-line flex flex-col gap-3"
                                                    >
                                                        {/* Product Info */}
                                                        {item.product && (
                                                            <div className="flex flex-col md:flex-row justify-between items-center gap-3">
                                                                <div className="flex items-center gap-3 flex-1 w-full md:w-auto">
                                                                    <div className="w-10 h-10 rounded-lg bg-ant-light border border-ant-line flex items-center justify-center overflow-hidden shrink-0">
                                                                        {item.product?.image_url ? (
                                                                            <img src={item.product?.image_url} alt="" className="w-full h-full object-cover" />
                                                                        ) : (
                                                                            <Package className="w-4 h-4 text-ant-mid" />
                                                                        )}
                                                                    </div>
                                                                    <div>
                                                                        <h5 className="text-[12px] font-semibold text-ant-ink leading-none mb-0.5">{item.product?.name}</h5>
                                                                        <span className="text-[9px] font-semibold text-ant-mid tracking-wider bg-ant-line px-1.5 py-0.5 rounded">{item.product?.code}</span>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center justify-end w-full md:w-auto gap-5 text-right">
                                                                    <div>
                                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid mb-0.5">Unit Price</p>
                                                                        <p className="text-[12px] font-semibold text-ant-ink tabular-nums">{item.unit_price} DH</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid mb-0.5">Qty</p>
                                                                        <p className="text-[12px] font-semibold text-ant-ink tabular-nums">x{item.quantity}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid mb-0.5">Subtotal</p>
                                                                        <p className="text-[12px] font-semibold text-ant-ink tabular-nums">{prodTotal} DH</p>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Accessory Info List */}
                                                        {item.accessoriesList && item.accessoriesList.length > 0 && item.accessoriesList.map((accItem: any, idx: number) => (
                                                                <div key={accItem.id || idx} className="flex flex-col md:flex-row justify-between items-center gap-3 pt-2 border-t border-ant-line">
                                                                    <div className="flex items-center gap-3 flex-1 w-full md:w-auto">
                                                                        <div className="w-8 h-8 rounded-lg bg-ant-light border border-ant-line flex items-center justify-center overflow-hidden shrink-0 md:ml-3">
                                                                            {accItem.accessory?.image_url ? (
                                                                                <img src={accItem.accessory?.image_url} alt="" className="w-full h-full object-cover" />
                                                                            ) : (
                                                                                <Puzzle className="w-3.5 h-3.5 text-ant-mid" />
                                                                            )}
                                                                        </div>
                                                                        <div>
                                                                            <h5 className="text-[11px] font-semibold text-ant-ink/70 leading-none mb-0.5 flex items-center gap-1.5">
                                                                                <Puzzle className="w-2.5 h-2.5" /> {accItem.accessory?.name}
                                                                            </h5>
                                                                            <span className="text-[9px] font-semibold text-ant-mid tracking-wider bg-ant-line px-1.5 py-0.5 rounded">{accItem.accessory?.code}</span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center justify-end w-full md:w-auto text-right">
                                                                        <div>
                                                                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid mb-0.5">Qty</p>
                                                                            <p className="text-[11px] font-semibold text-ant-ink/80 tabular-nums">x{accItem.accessory_quantity}</p>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}

                                                        {item.product && (
                                                            <div className="pt-2 border-t border-ant-line flex justify-end">
                                                                <div className="bg-ant-green/10 text-ant-green px-3 py-1.5 rounded-lg flex items-center gap-3">
                                                                    <span className="text-[9px] font-bold uppercase tracking-[0.18em] opacity-60">Row Subtotal</span>
                                                                    <span className="text-[13px] font-semibold tabular-nums">{prodTotal} DH</span>
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
                                <div className="space-y-3 pb-3">
                                    <div className="flex items-center gap-2">
                                        <Truck className="w-3.5 h-3.5 text-ant-ink/30" />
                                        <h4 className="text-[11px] font-semibold text-ant-ink uppercase tracking-wider">Suivi du Colis</h4>
                                    </div>

                                    {isParcelLoading ? (
                                        <div className="flex items-center justify-center py-4">
                                            <Loader2 className="w-4 h-4 text-ant-ink animate-spin" />
                                        </div>
                                    ) : !orderParcel ? (
                                        <div className="text-center p-4 bg-ant-light rounded-xl border border-ant-line">
                                            <p className="text-[11px] text-ant-mid">Aucun colis créé pour cette commande.</p>
                                        </div>
                                    ) : (() => {
                                        // Master status label + color + icon; raw only as fallback.
                                        const rPkg = resolvePkgStatus(orderParcel.status_label, orderParcel.status_label, orderParcel.status_color);
                                        const pColor = rPkg?.color || '#94a3b8';
                                        const pIcon = rPkg?.icon || null;
                                        const pLabel = rPkg?.label || orderParcel.status_label || 'En attente';
                                        return (
                                        <div className="flex items-center justify-between p-4 bg-ant-ink/[0.02] rounded-2xl border border-ant-ink/[0.05]">
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-white" style={{ backgroundColor: pColor }}>
                                                    {pIcon ? <DynamicIcon name={pIcon} className="w-3.5 h-3.5" /> : <div className="w-2 h-2 rounded-full bg-white" />}
                                                </div>
                                                <div className="min-w-0">
                                                    <span className="text-[9px] font-bold uppercase tracking-[0.18em] px-1.5 py-0.5 rounded" style={{ color: pColor, backgroundColor: `${pColor}15` }}>
                                                        {pLabel}
                                                    </span>
                                                    {orderParcel.tracking_code && (
                                                        <p className="text-[10px] font-mono text-ant-mid truncate mt-0.5">{orderParcel.tracking_code}</p>
                                                    )}
                                                </div>
                                            </div>
                                            {orderParcel.tracking_code && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => { setParcelTrackingOrderId(selectedOrder.id); setParcelTrackingOpen(true); }}
                                                    className="text-[11px] font-semibold text-ant-ink hover:bg-ant-light gap-1.5 rounded-md h-8 px-3 shrink-0"
                                                >
                                                    <Truck className="w-3 h-3" />
                                                    Suivre
                                                </Button>
                                            )}
                                        </div>
                                        );
                                    })()}
                                </div>

                                <Separator className="bg-ant-line" />

                                {/* Status History Timeline */}
                                <div className="space-y-3 pb-3">
                                    <div className="flex items-center gap-2">
                                        <ShieldCheck className="w-3.5 h-3.5 text-ant-ink/30" />
                                        <h4 className="text-[11px] font-semibold text-ant-ink uppercase tracking-wider">Status History</h4>
                                    </div>

                                    <div className="px-2">
                                        {(() => { const hist = (selectedOrder.history && selectedOrder.history.length > 0) ? selectedOrder.history : selectedOrderHistory; return hist && hist.length > 0; })() ? (
                                            <div className="relative pl-8">
                                                <div className="absolute left-[11px] top-4 bottom-4 w-0.5 bg-ant-line" />
                                                <div className="space-y-0">
                                                {[...((selectedOrder.history && selectedOrder.history.length > 0) ? selectedOrder.history : selectedOrderHistory)].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map((record: any, idx: number, arr: any[]) => {
                                                    const color = record.status?.color || '#94a3b8';
                                                    const isLast = idx === arr.length - 1;
                                                    const ordIcon = getOrdIcon(record.status_id);
                                                    const postponed = REPORTED_STATUS_ID && (statusCats.isOrderCategory(record.status_id, 'postponed') || record.status_id === REPORTED_STATUS_ID);
                                                    const reportedMatch = postponed && record.comment?.match(/\[Reporté pour: (.*?)\]/);
                                                    const reportedText = reportedMatch?.[1] || (postponed && selectedOrder.reported_date ? format(new Date(selectedOrder.reported_date), 'dd/MM/yyyy HH:mm') : null);
                                                    const cleanedComment = postponed ? (record.comment || '').replace(/\[Reporté pour:.*?\]/, '').trim() : record.comment || '';
                                                    return (
                                                        <div key={record.id} className="relative pb-4 last:pb-0 group">
                                                            <div className={`absolute -left-8 top-0 w-6 h-6 rounded-full border-2 border-white flex items-center justify-center z-10 ${isLast ? 'ring-1 ring-offset-1' : ''}`} style={{ backgroundColor: isLast ? color : '#f3f4f6', color: isLast ? '#ffffff' : color, ['--tw-ring-color' as any]: isLast ? `${color}40` : undefined }}>
                                                                {ordIcon ? <DynamicIcon name={ordIcon} className="w-2.5 h-2.5" /> : <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: isLast ? '#ffffff' : color }} />}
                                                            </div>
                                                            <div className="space-y-1">
                                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                                    <span className="text-[9px] font-bold uppercase tracking-[0.18em] px-1.5 py-0.5 rounded" style={{ color, backgroundColor: `${color}15` }}>{record.status?.label || 'Inconnu'}</span>
                                                                </div>
                                                                {record.created_at && <p className="text-[10px] text-ant-mid">{format(new Date(record.created_at), 'dd/MM/yyyy HH:mm')}</p>}
                                                                <div className="flex items-center gap-1.5">
                                                                    {record.user ? (
                                                                        <UserAvatar url={record.user.avatar_url} config={(record.user as any).avatar_config} name={record.user.name} className="w-4 h-4 rounded-full border bg-white text-[8px]" />
                                                                    ) : (
                                                                        <div className="w-4 h-4 rounded-full bg-ant-line flex items-center justify-center">
                                                                            <DynamicIcon name="TbRobot" className="w-2.5 h-2.5 text-ant-ink/60" />
                                                                        </div>
                                                                    )}
                                                                    <span className="text-[10px] font-semibold text-ant-ink/60 truncate max-w-[200px]">{record.user?.name || 'Système'}</span>
                                                                </div>
                                                                {postponed && reportedText && (
                                                                    <div className="flex flex-col gap-1 p-2.5 bg-ant-orange/10 rounded-lg border border-ant-orange/20">
                                                                        <div className="flex items-center gap-1.5"><Calendar className="w-2.5 h-2.5 text-ant-orange" /><span className="text-[9px] font-bold uppercase tracking-[0.18em] text-ant-orange">Rappel programmé</span></div>
                                                                        <p className="text-[10px] font-semibold text-ant-orange">{reportedText}</p>
                                                                        {cleanedComment && <p className="text-[10px] text-ant-orange italic mt-1 border-t border-amber-500/10 pt-1">"{cleanedComment}"</p>}
                                                                    </div>
                                                                )}
                                                                {!postponed && record.comment && <p className="text-[10px] text-ant-mid leading-relaxed italic">"{record.comment}"</p>}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-center p-4 bg-ant-light rounded-xl border border-ant-line">
                                                <p className="text-[11px] text-ant-mid">No tracking history available yet.</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <DialogFooter className="px-6 py-3 flex flex-row gap-2 bg-ant-paper border-t border-ant-line shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setIsViewModalOpen(false)}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light text-[12px] font-semibold text-ant-ink cursor-pointer transition-colors"
                                >
                                    Fermer
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleEdit(selectedOrder)}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold cursor-pointer transition-colors"
                                >
                                    <Edit2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                                    Modifier la commande
                                </button>
                            </DialogFooter>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Reported Status Data Collection Modal */}
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

            {/* Stock Shortage Modal */}
            <StockShortageModal
                open={!!stockAlert}
                onClose={() => setStockAlert(null)}
                groups={stockAlert || []}
            />

            <QuickStatusChangeModal
                open={isQuickStatusOpen}
                onOpenChange={(v) => {
                    setIsQuickStatusOpen(v);
                    if (!v) setQuickStatusOrder(null);
                }}
                order={quickStatusOrder}
                orderStatuses={orderStatusesForQuickStatus}
                isOrderCategory={statusCats.isOrderCategory}
                onStatusChange={({ orderId, statusId, comment, reportedDate }) => {
                    quickStatusMutation.mutate({ orderId, statusId, comment, reportedDate });
                    setIsQuickStatusOpen(false);
                    setQuickStatusOrder(null);
                }}
                isPending={quickStatusMutation.isPending}
            />

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
                isOrderInCategory={(statusId, cat) => statusCats.isOrderCategory(statusId || '', cat as any)}
            />
            </div>
        </div>
    );
};

export default Orders;
