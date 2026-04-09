import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
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
    AlertTriangle,
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
import { OrderStatusHistoryDialog } from '@/components/orders/OrderStatusHistoryDialog';
import { SyncTrackingStatus } from '@/components/orders/SyncTrackingStatus';
import { useTrackingSyncStatus } from '@/hooks/useTrackingSyncStatus';
import { getLatestTrackableCompanyParcel } from '@/lib/orders/getLatestTrackableCompanyParcel';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { computeUnpaidCommission, normalizeCommissionBasis, isDeliveredForCommission, type CommissionBasis } from '@/lib/commercialCommission';
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
import { Textarea } from "@/components/ui/textarea";
import {
    OrderLineProductCombobox,
    OrderLineProductStockHint,
    toProductStockNumber,
    type OrderLineProductOption,
} from '@/components/orders/OrderLineProductCombobox';

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
    for (const p of order?.parcels || []) {
        if (p?.tracking_code) codes.push(String(p.tracking_code));
    }
    for (const p of order?.courier_parcels || []) {
        if (p?.tracking_code) codes.push(String(p.tracking_code));
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

type StatusBucket = { id: string; label: string; color: string; count: number; ranking: number };

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
        <div className="bg-white/60 backdrop-blur-md rounded-2xl shadow-sm border border-brand-navy/5 p-3 animate-in fade-in slide-in-from-top-1 duration-300">
            <div className="flex items-start gap-2">
                <div
                    ref={containerRef}
                    className={cn(
                        "flex flex-wrap items-center gap-2 flex-1 min-w-0 transition-[max-height] duration-300 ease-in-out",
                        !expanded && "max-h-[40px] overflow-hidden"
                    )}
                >
                    <button
                        type="button"
                        onClick={() => setSelectedSet(new Set())}
                        className={cn(
                            "shrink-0 inline-flex items-center gap-2 h-9 px-4 rounded-full text-[11px] font-black uppercase tracking-widest transition-all",
                            allActive
                                ? "bg-brand-navy text-white shadow-md shadow-brand-navy/20"
                                : "bg-brand-navy/[0.04] text-brand-navy/60 hover:bg-brand-navy/[0.08] hover:text-brand-navy"
                        )}
                    >
                        All
                        <span
                            className={cn(
                                "min-w-[20px] h-[18px] flex items-center justify-center px-1.5 rounded-full text-[10px] font-black",
                                allActive ? "bg-white/25 text-white" : "bg-brand-navy/10 text-brand-navy/70"
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
                                    "shrink-0 inline-flex items-center gap-2 h-9 px-4 rounded-full text-[11px] font-black uppercase tracking-widest transition-all border border-transparent",
                                    isActive ? "text-white" : "hover:brightness-95"
                                )}
                                style={
                                    isActive
                                        ? { backgroundColor: bucket.color, boxShadow: `0 8px 20px -8px ${bucket.color}80` }
                                        : { backgroundColor: `${bucket.color}14`, color: bucket.color }
                                }
                            >
                                <span
                                    className="w-2 h-2 rounded-full shrink-0"
                                    style={{ backgroundColor: isActive ? '#ffffff' : bucket.color }}
                                />
                                <span className="truncate max-w-[160px]">{bucket.label}</span>
                                <span
                                    className={cn(
                                        "min-w-[20px] h-[18px] flex items-center justify-center px-1.5 rounded-full text-[10px] font-black",
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
                        className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full bg-brand-navy/[0.04] text-brand-navy/60 hover:bg-brand-navy/[0.08] hover:text-brand-navy transition-all"
                    >
                        <ChevronDown className={cn("w-4 h-4 transition-transform duration-300", expanded && "rotate-180")} />
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
    const [activeTab, setActiveTab] = useState<'all' | 'new' | 'confirmation' | 'suivi' | 'reported'>('new');

    useEffect(() => {
        const tab = searchParams.get('tab');
        if (tab === 'all' || tab === 'new' || tab === 'confirmation' || tab === 'suivi' || tab === 'reported') {
            setActiveTab(tab);
        }
    }, [searchParams]);
    const [sellerStats, setSellerStats] = useState({
        confirmRate: 0,
        deliveryRate: 0,
        unpaidCommission: 0,
        totalDelivered: 0,
        commissionRate: 0,
        commissionBasis: 'per_order' as CommissionBasis,
    });

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

    // --- Realtime: listen for webhook-driven order updates ---
    useEffect(() => {
        if (!activeBusinessId) return;

        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        const debouncedInvalidate = () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ['orders', activeBusinessId, userId] });
            }, 500);
        };

        const channel = supabase
            .channel(`orders-realtime-seller-${activeBusinessId}`)
            .on(
                'postgres_changes' as any,
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'orders',
                },
                (payload: any) => {
                    console.log('[Realtime] Order updated:', payload.new?.id);
                    debouncedInvalidate();
                }
            )
            .on(
                'postgres_changes' as any,
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'orders',
                },
                () => {
                    debouncedInvalidate();
                }
            )
            .subscribe((status: string) => {
                console.log('[Realtime] Seller orders channel status:', status);
            });

        return () => {
            if (debounceTimer) clearTimeout(debounceTimer);
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
                    const { data: matchedStatus } = await supabase
                        .from('package_statuses')
                        .select('id, label')
                        .ilike('label', providerStatus)
                        .maybeSingle();

                    await supabase
                        .from('company_parcels')
                        .update({
                            status_id: matchedStatus?.id || null,
                            status_label: providerStatus,
                            status_color: providerColor
                        })
                        .eq('id', parcel.id);
                }

                queryClient.invalidateQueries({ queryKey: ['orders'] });
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


    const { data: orders, isLoading } = useQuery({
        queryKey: ['orders', activeBusinessId, userId],
        queryFn: async () => {
            if (!activeBusinessId || !userId) return [];
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
                    history:order_status_history(*, user:users!changed_by(name, avatar_url), status:order_statuses!status_id(*)),
                    parcels:company_parcels(id, tracking_code, external_id, provider_id, status_label, status_color, created_at, provider:providers(id, name, logo_url)),
                    courier_parcels(id, tracking_code, status_label, status_color, created_at)
                `)
                .eq('DigiCom Business', activeBusinessId)
                .or(`seller_id.eq.${userId},assign_id.eq.${userId}`)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        },
        enabled: !!activeBusinessId && !!userId
    });

    const trackingSyncState = useTrackingSyncStatus(['orders', activeBusinessId, userId]);

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
                .select('id, code, label, ranking, color, show_in_order, recheck')
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

    const { data: packageStatuses } = useQuery({
        queryKey: ['package-statuses-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('package_statuses')
                .select('id, code, label, color, ranking, recheck')
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
            ameex_old_tracking: ''
        }
    });

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
        if (!orders?.length) return [] as { id: string; name: string }[];
        const byId = new Map<string, { id: string; name: string }>();
        for (const o of orders as any[]) {
            const cid = o.master_city_id || o.city_id;
            if (!cid) continue;
            const embedded = o.city as { id?: string; name?: string } | null | undefined;
            const name = embedded?.name || (cities as any[])?.find((c: any) => c.id === cid)?.name;
            if (name) byId.set(cid, { id: cid, name });
        }
        return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [orders, cities]);

    /** Couriers / companies that appear on this seller's orders (filter dropdown only). */
    const sellerFilterProviders = useMemo(() => {
        if (!orders?.length) return [] as { id: string; name: string; type: 'courier' | 'company' }[];
        const list: { id: string; name: string; type: 'courier' | 'company' }[] = [];
        const seen = new Set<string>();
        for (const o of orders as any[]) {
            if (o.courier_id && !seen.has(`c-${o.courier_id}`)) {
                seen.add(`c-${o.courier_id}`);
                const emb = o.courier as { name?: string } | null | undefined;
                const name = emb?.name || (couriers as any[])?.find((c: any) => c.id === o.courier_id)?.name || 'Courier';
                list.push({ id: o.courier_id, name, type: 'courier' });
            }
            if (o.company_id && !seen.has(`co-${o.company_id}`)) {
                seen.add(`co-${o.company_id}`);
                const emb = o.company as { name?: string } | null | undefined;
                const name = emb?.name || (companies as any[])?.find((c: any) => c.id === o.company_id)?.name || 'Company';
                list.push({ id: o.company_id, name, type: 'company' });
            }
        }
        return list.sort((a, b) => a.name.localeCompare(b.name));
    }, [orders, couriers, companies]);

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
            fee = courierFees?.find((f: any) => f.courier_id === selectedCourierId && (f.master_city_id === selectedCityId || f.city_id === selectedCityId))?.fee || 0;
        } else if (selectedCompanyId) {
            fee = companyFees?.find((f: any) => f.company_id === selectedCompanyId && (f.master_city_id === selectedCityId || f.city_id === selectedCityId))?.fee || 0;
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

            if (values.order_status_id && userId) {
                try {
                    await (supabase as any).from('order_status_history').insert({
                        order_id: order.id,
                        status_id: values.order_status_id,
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
            queryClient.invalidateQueries({ queryKey: ['orders', activeBusinessId] });
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
                    ameex_old_tracking: ''
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
            queryClient.invalidateQueries({ queryKey: ['orders', activeBusinessId] });
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
            const { error } = await (supabase as any)
                .from('orders')
                .delete()
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders', activeBusinessId] });
            toast({ title: "Order Deleted", description: "Order removed from history." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    // --- Helpers ---
    const duplicatePhones = useMemo(() => {
        if (!orders) return new Set();
        const phoneCounts: Record<string, number> = {};
        orders.forEach((o: any) => {
            if (o.phone) {
                const normalized = (o.phone || '').replace(/[\s-]/g, '');
                phoneCounts[normalized] = (phoneCounts[normalized] || 0) + 1;
            }
        });
        const duplicates = new Set<string>();
        orders.forEach((o: any) => {
            if (o.phone) {
                const normalized = (o.phone || '').replace(/[\s-]/g, '');
                if (phoneCounts[normalized] > 1) {
                    duplicates.add(o.phone);
                }
            }
        });
        return duplicates;
    }, [orders]);

    const isOrderInTab = (o: any, tab: string) => {
        const newStatusId = statusCats.getOrderByCategory('new')?.id;
        const isReported = !!(REPORTED_STATUS_ID && o.order_status_id === REPORTED_STATUS_ID);
        const isNew = !!(newStatusId && o.order_status_id === newStatusId);

        const orderStatusRecheckActive =
            o.status?.recheck === true && o.status?.active !== false;

        // DB: package_statuses.recheck + active (see Supabase); category 'recheck' counts when flag not set.
        const packageRecheckActive =
            !!o.package_status_id &&
            (o.package_status?.active !== false) &&
            (o.package_status?.recheck === true ||
                statusCats.isPkgCategory(o.package_status_id, 'recheck'));

        switch (tab) {
            case 'all':
                return true;
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
            default:
                return false;
        }
    };

    const baseFilteredOrders = useMemo(() => {
        if (!orders) return [];
        return orders.filter((o: any) => {
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
        });
    }, [orders, searchQuery, filterStatus, filterCity, filterSource, filterProvider, getDateRange, filterDateField, filterCustomerName, filterPhone, filterTracking, filterProduct, filterPackageStatus, filterExchange, pillStatusIds, pillPackageStatusIds]);

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

    const tabCounts = useMemo(() => {
        const counts = { all: 0, new: 0, confirmation: 0, suivi: 0, reported: 0, reportedToday: false, reportedNow: false };
        const now = new Date();
        const todayStr = format(now, 'yyyy-MM-dd');
        const currentHour = now.getHours();

        baseFilteredOrders.forEach(o => {
            counts.all++;
            if (isOrderInTab(o, 'new')) counts.new++;
            if (isOrderInTab(o, 'confirmation')) counts.confirmation++;
            if (isOrderInTab(o, 'suivi')) counts.suivi++;
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
    }, [baseFilteredOrders]);

    const filteredOrders = useMemo(() => {
        return baseFilteredOrders.filter(o => isOrderInTab(o, activeTab));
    }, [baseFilteredOrders, activeTab]);

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
        if (activeTab !== 'confirmation') return [] as Array<{ id: string; label: string; color: string; count: number; ranking: number }>;
        const seed = (orderStatuses as any[] | undefined)?.filter((s) => s.recheck === true) ?? [];
        const buckets = new Map<string, { id: string; label: string; color: string; count: number; ranking: number }>();
        for (const s of seed) {
            buckets.set(s.id, {
                id: s.id,
                label: s.label || 'Status',
                color: s.color || '#94a3b8',
                ranking: s.ranking ?? 9999,
                count: 0,
            });
        }
        for (const o of (orders as any[] | undefined) ?? []) {
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
                    ranking: o.status.ranking ?? 9999,
                    count: 1,
                });
            }
        }
        return Array.from(buckets.values()).sort((a, b) => a.ranking - b.ranking);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orders, orderStatuses, activeTab, searchQuery, filterCity, filterSource, filterProvider, getDateRange, filterDateField, filterCustomerName, filterPhone, filterTracking, filterProduct, filterPackageStatus, filterExchange, pillPackageStatusIds]);

    const recheckPackageStatusBuckets = useMemo(() => {
        if (activeTab !== 'suivi') return [] as Array<{ id: string; label: string; color: string; count: number; ranking: number }>;
        const seedFromMaster = (packageStatuses as any[] | undefined)?.filter((s) => s.recheck === true) ?? [];
        const buckets = new Map<string, { id: string; label: string; color: string; count: number; ranking: number }>();
        for (const s of seedFromMaster) {
            buckets.set(s.id, {
                id: s.id,
                label: s.label || 'Status',
                color: s.color || '#94a3b8',
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
                    ranking: s.ranking ?? 9999,
                    count: 0,
                });
            }
        }
        for (const o of (orders as any[] | undefined) ?? []) {
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
    }, [orders, packageStatuses, activeTab, searchQuery, filterStatus, filterCity, filterSource, filterProvider, getDateRange, filterDateField, filterCustomerName, filterPhone, filterTracking, filterProduct, filterExchange, pillStatusIds]);

    // Calculate seller-specific statistics
    useEffect(() => {
        const calculateSellerStats = async () => {
            if (!orders || !userId || !sellerProfile) return;

            const allOrders = orders || [];
            const total = allOrders.length;

            // Count confirmed orders (confirmed, processed, paid, unpaid)
            const confirmed = allOrders.filter(o =>
                statusCats.confirmedIds.has(o.order_status_id)
            ).length;

            // Count delivered orders (package in delivered category)
            const delivered = allOrders.filter(o =>
                isDeliveredForCommission(o, statusCats.deliveredPkgIds)
            ).length;

            // Rates
            const confirmRate = total > 0 ? (confirmed / total) * 100 : 0;
            const deliveryRate = total > 0 ? (delivered / total) * 100 : 0;

            const basis = normalizeCommissionBasis(sellerProfile.commission_basis);
            const commissionRate = Number(sellerProfile.commission_price) || 0;

            const { data: paymentsData } = await supabase
                .from('seller_payments')
                .select('delivered_orders')
                .eq('seller_id', userId)
                .eq('status', 'paid');

            const alreadyPaid = (paymentsData || []).reduce((sum, p) => sum + (Number(p.delivered_orders) || 0), 0);

            const commissionOrders = allOrders.filter((o: any) => o.seller_id === userId);
            const isDelivered = (o: any) =>
                isDeliveredForCommission(o, statusCats.deliveredPkgIds);

            const { unpaidCommission } = computeUnpaidCommission({
                basis,
                commissionPrice: commissionRate,
                orders: commissionOrders,
                isDelivered,
                sellerProductIds,
                paidTally: alreadyPaid,
            });

            setSellerStats({
                confirmRate,
                deliveryRate,
                unpaidCommission,
                totalDelivered: delivered,
                commissionRate,
                commissionBasis: basis,
            });
        };

        calculateSellerStats();
    }, [orders, userId, sellerProfile, sellerProductIds, statusCats.confirmedIds, statusCats.deliveredPkgIds]);

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
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-2">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-brand-navy rounded-2xl shadow-lg shadow-brand-navy/20">
                            <ShoppingCart className="w-6 h-6 text-brand-white" />
                        </div>
                        <h1 className="text-4xl font-black tracking-tight text-brand-navy">Order Pipeline</h1>
                    </div>
                    <p className="text-muted-foreground text-lg font-medium">Streamline your sales flow and delivery tracking.</p>
                    <SyncTrackingStatus
                        latestRun={trackingSyncState.latestRun}
                        isSyncing={trackingSyncState.isSyncing}
                        nextSyncAt={trackingSyncState.nextSyncAt}
                        triggering={trackingSyncState.triggering}
                        onRunNow={trackingSyncState.runNow}
                        className="mt-2"
                    />
                </div>

                <div className="flex flex-col sm:flex-row gap-3 items-center">
                    <div className="relative group sm:w-80">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-brand-navy" />
                        <Input
                            placeholder="Search any order detail (tracking, Coliaty, products, notes…)"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-11 h-12 bg-white/50 border-none shadow-sm rounded-2xl focus-visible:ring-1 focus-visible:ring-brand-navy/20 transition-all font-medium"
                        />
                    </div>
                    <Button
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
                                ameex_old_tracking: ''
                            });
                            setIsAddModalOpen(true);
                        }}
                        className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-12 px-6 font-bold shadow-lg shadow-brand-navy/10 transition-all active:scale-95 flex items-center gap-2 w-full sm:w-auto"
                    >
                        <PlusCircle className="w-5 h-5" />
                        New Order
                    </Button>
                </div>
            </div>

            {/* Seller Performance Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="border-none bg-emerald-50/50 rounded-[32px] p-6 relative overflow-hidden flex flex-col justify-between min-h-[140px]">
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600/60 mb-2">Delivery Rate</p>
                    <div className="flex items-baseline gap-2">
                        <h3 className="text-3xl lg:text-4xl xl:text-5xl font-black text-brand-navy tracking-tight">
                            {sellerStats.deliveryRate.toFixed(0)}
                        </h3>
                        <span className="text-2xl font-bold text-emerald-600">%</span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-2">{sellerStats.totalDelivered} delivered</p>
                </Card>
                <Card className="border-none bg-blue-50/50 rounded-[32px] p-6 relative overflow-hidden flex flex-col justify-between min-h-[140px]">
                    <p className="text-[10px] font-black uppercase tracking-widest text-blue-600/60 mb-2">Confirm Rate</p>
                    <div className="flex items-baseline gap-2">
                        <h3 className="text-3xl lg:text-4xl xl:text-5xl font-black text-brand-navy tracking-tight">
                            {sellerStats.confirmRate.toFixed(0)}
                        </h3>
                        <span className="text-2xl font-bold text-blue-600">%</span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-2">Your success rate</p>
                </Card>
                <div className="bg-brand-navy rounded-[32px] p-6 text-brand-white shadow-2xl shadow-brand-navy/30 relative overflow-hidden group flex flex-col justify-between min-h-[140px]">
                    <div className="relative z-10 flex flex-col h-full justify-between">
                        <span className="text-[10px] font-black uppercase text-brand-white/60 tracking-widest mb-2 block">Unpaid Commission</span>
                        <div className="flex items-baseline gap-1.5 w-full">
                            <span className="text-3xl lg:text-4xl xl:text-5xl font-black tracking-tight truncate">
                                {new Intl.NumberFormat('fr-FR').format(Math.round(sellerStats.unpaidCommission))}
                            </span>
                            <span className="text-lg font-bold opacity-60 shrink-0">MAD</span>
                        </div>
                        <p className="text-[10px] text-white/60 mt-2">
                            {sellerStats.commissionRate} MAD per {sellerStats.commissionBasis === 'per_unit' ? 'unit' : 'order'} (unpaid accrual)
                        </p>
                    </div>
                    <div className="absolute -right-4 -bottom-4 w-32 h-32 bg-brand-white/5 rounded-full blur-2xl group-hover:bg-brand-white/10 transition-colors duration-500" />
                </div>
                <Card className="border-none bg-purple-50/50 rounded-[32px] p-6 relative overflow-hidden flex flex-col justify-between min-h-[140px]">
                    <p className="text-[10px] font-black uppercase tracking-widest text-purple-600/60 mb-2">My Orders</p>
                    <h3 className="text-3xl lg:text-4xl xl:text-5xl font-black text-brand-navy tracking-tight truncate w-full">
                        {new Intl.NumberFormat('fr-FR').format(filteredOrders.length)}
                    </h3>
                    <p className="text-[10px] text-gray-400 mt-2">Current view</p>
                </Card>
            </div>

            {/* Tabs View */}
            <div className="flex bg-white/50 backdrop-blur-md p-1.5 rounded-2xl shadow-sm border border-brand-navy/5 w-full overflow-x-auto hide-scrollbar snap-x">
                {[
                    { id: 'all', label: 'All', count: tabCounts.all, icon: LayoutGrid },
                    { id: 'new', label: 'Nouveau', count: tabCounts.new, icon: Package },
                    { id: 'confirmation', label: 'Confirmation', count: tabCounts.confirmation, icon: Phone },
                    { id: 'suivi', label: 'Suivi', count: tabCounts.suivi, icon: Truck },
                    { id: 'reported', label: 'Reported', count: tabCounts.reported, icon: AlertTriangle }
                ].map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={cn(
                                "flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-[11px] md:text-xs font-black uppercase tracking-widest transition-all snap-start whitespace-nowrap",
                                isActive
                                    ? "bg-brand-navy text-white shadow-md shadow-brand-navy/10 transform scale-100"
                                    : (tab.id === 'reported' && (tabCounts as any).reportedNow)
                                        ? "bg-red-600 text-brand-white animate-pulse shadow-lg shadow-red-500/20"
                                        : (tab.id === 'reported' && (tabCounts as any).reportedToday)
                                            ? "bg-amber-500 text-brand-white shadow-lg shadow-amber-500/20"
                                            : "text-brand-navy/60 hover:text-brand-navy hover:bg-brand-navy/5"
                            )}
                        >
                            <Icon className={cn("w-4 h-4", isActive ? "opacity-100" : "opacity-50")} />
                            <span>{tab.label}</span>
                            <Badge
                                variant="secondary"
                                className={cn(
                                    "ml-1 font-bold",
                                    isActive ? "bg-white/20 text-white" : "bg-brand-navy/5 text-brand-navy/60"
                                )}
                            >
                                {tab.count}
                            </Badge>
                        </button>
                    )
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

            {/* Filters Toolbar (admin parity; seller-scoped city/provider/product; no Confirmed By / Assigned To) */}
            <div className="space-y-4 pb-4">
                <div className="flex flex-col xl:flex-row gap-4 items-start xl:items-center justify-between">
                    <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
                        <div className="flex bg-white p-1 rounded-xl shadow-sm border border-brand-navy/5 shrink-0">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setViewMode('grid')}
                                className={cn(
                                    "h-8 w-8 p-0 rounded-lg transition-all duration-300",
                                    viewMode === 'grid' ? "bg-brand-navy text-brand-white shadow-lg" : "text-brand-navy/30 hover:text-brand-navy hover:bg-brand-navy/5"
                                )}
                            >
                                <LayoutGrid className="w-4 h-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setViewMode('list')}
                                className={cn(
                                    "h-8 w-8 p-0 rounded-lg transition-all duration-300",
                                    viewMode === 'list' ? "bg-brand-navy text-brand-white shadow-lg" : "text-brand-navy/30 hover:text-brand-navy hover:bg-brand-navy/5"
                                )}
                            >
                                <List className="w-4 h-4" />
                            </Button>
                        </div>

                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowAllFilters(!showAllFilters)}
                            className={cn(
                                "h-9 px-4 rounded-2xl gap-2 text-xs font-bold transition-all duration-300",
                                showAllFilters
                                    ? "bg-brand-navy text-brand-white shadow-xl shadow-brand-navy/20"
                                    : "bg-white text-brand-navy/60 border border-brand-navy/[0.06] hover:border-brand-navy/10 hover:text-brand-navy shadow-sm"
                            )}
                        >
                            <Filter className="w-3.5 h-3.5" />
                            Filters
                            {activeFilterCount > 0 && (
                                <span className={cn(
                                    "ml-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-black leading-none",
                                    showAllFilters ? "bg-brand-white/25 text-brand-white" : "bg-brand-navy text-brand-white"
                                )}>
                                    {activeFilterCount}
                                </span>
                            )}
                        </Button>

                        {activeFilterCount > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 animate-in fade-in duration-300">
                                {filterTimeRange !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-100">
                                        <Clock className="w-3 h-3" />
                                        {filterTimeRange === 'custom' && filterCustomRange?.from
                                            ? `${format(filterCustomRange.from, 'dd/MM')}–${filterCustomRange.to ? format(filterCustomRange.to, 'dd/MM') : '...'}`
                                            : filterTimeRange.replace(/([A-Z])/g, ' $1').trim()}
                                        <button type="button" onClick={() => { setFilterTimeRange('all'); setFilterCustomRange(undefined); setShowCalendar(false); }} className="ml-0.5 hover:bg-blue-100 rounded-full p-0.5 transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterStatus !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-purple-50 text-purple-700 text-[10px] font-bold border border-purple-100">
                                        <ShieldCheck className="w-3 h-3" />
                                        {orderStatuses?.find((s: any) => s.id === filterStatus)?.label || 'Status'}
                                        <button type="button" onClick={() => setFilterStatus('all')} className="ml-0.5 hover:bg-purple-100 rounded-full p-0.5 transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterPackageStatus !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-orange-50 text-orange-700 text-[10px] font-bold border border-orange-100">
                                        <Package className="w-3 h-3" />
                                        {packageStatuses?.find((s: any) => s.id === filterPackageStatus)?.label || 'Package'}
                                        <button type="button" onClick={() => setFilterPackageStatus('all')} className="ml-0.5 hover:bg-orange-100 rounded-full p-0.5 transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterCity !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-100">
                                        <MapPin className="w-3 h-3" />
                                        {sellerFilterCities.find((c) => c.id === filterCity)?.name || cities?.find((c: any) => c.id === filterCity)?.name || 'City'}
                                        <button type="button" onClick={() => setFilterCity('all')} className="ml-0.5 hover:bg-emerald-100 rounded-full p-0.5 transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterProduct !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-pink-50 text-pink-700 text-[10px] font-bold border border-pink-100 max-w-[200px]">
                                        <ShoppingBag className="w-3 h-3 shrink-0" />
                                        <span className="truncate">{productNameLabel((products as any[])?.find((p: any) => p.id === filterProduct))}</span>
                                        <button type="button" onClick={() => setFilterProduct('all')} className="ml-0.5 hover:bg-pink-100 rounded-full p-0.5 transition-colors shrink-0"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterCustomerName && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold border border-slate-200 max-w-[180px]">
                                        <User className="w-3 h-3 shrink-0" />
                                        <span className="truncate">&quot;{filterCustomerName}&quot;</span>
                                        <button type="button" onClick={() => setFilterCustomerName('')} className="ml-0.5 hover:bg-slate-200 rounded-full p-0.5 transition-colors shrink-0"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterPhone && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold border border-slate-200">
                                        <Phone className="w-3 h-3" />
                                        {filterPhone}
                                        <button type="button" onClick={() => setFilterPhone('')} className="ml-0.5 hover:bg-slate-200 rounded-full p-0.5 transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterTracking.trim() && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold border border-slate-200 max-w-[220px]">
                                        <Hash className="w-3 h-3 shrink-0" />
                                        <span className="truncate">{filterTracking.trim()}</span>
                                        <button type="button" onClick={() => setFilterTracking('')} className="ml-0.5 hover:bg-slate-200 rounded-full p-0.5 transition-colors shrink-0"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterSource !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-cyan-50 text-cyan-700 text-[10px] font-bold border border-cyan-100 capitalize">
                                        <ExternalLink className="w-3 h-3" />
                                        {filterSource}
                                        <button type="button" onClick={() => setFilterSource('all')} className="ml-0.5 hover:bg-cyan-100 rounded-full p-0.5 transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterProvider !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold border border-amber-100 max-w-[200px]">
                                        <Truck className="w-3 h-3 shrink-0" />
                                        <span className="truncate">{sellerFilterProviders.find((p) => p.id === filterProvider)?.name || allProviders.find((p: any) => p.id === filterProvider)?.name || 'Service'}</span>
                                        <button type="button" onClick={() => setFilterProvider('all')} className="ml-0.5 hover:bg-amber-100 rounded-full p-0.5 transition-colors shrink-0"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterExchange !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-red-50 text-red-700 text-[10px] font-bold border border-red-100">
                                        <RefreshCcw className="w-3 h-3" />
                                        {filterExchange === 'yes' ? 'Exchange: Yes' : 'Exchange: No'}
                                        <button type="button" onClick={() => setFilterExchange('all')} className="ml-0.5 hover:bg-red-100 rounded-full p-0.5 transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                <button type="button" onClick={clearAllFilters} className="h-7 px-2 rounded-full text-[10px] font-bold text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                                    Clear all
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <div className="h-7 px-3 rounded-full bg-brand-navy/[0.04] flex items-center">
                            <span className="text-[11px] font-bold text-brand-navy/60">
                                {filteredOrders.length} <span className="text-brand-navy/30 font-medium">records</span>
                            </span>
                        </div>
                    </div>
                </div>

                {showAllFilters && (
                    <div className="bg-white/80 backdrop-blur-xl rounded-[28px] border border-brand-navy/[0.04] shadow-xl shadow-brand-navy/[0.03] overflow-hidden animate-in slide-in-from-top-2 fade-in duration-400">
                        <div className="p-5 border-b border-brand-navy/[0.04]">
                            <div className="flex items-center gap-2 mb-3.5">
                                <div className="w-6 h-6 rounded-lg bg-blue-500/10 flex items-center justify-center">
                                    <Calendar className="w-3.5 h-3.5 text-blue-500" />
                                </div>
                                <span className="text-[11px] font-black uppercase tracking-widest text-brand-navy/40">Date &amp; Time</span>
                            </div>
                            <div className="flex flex-wrap items-end gap-4">
                                <div className="space-y-1.5 min-w-[140px]">
                                    <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider">Filter By</span>
                                    <Select value={filterDateField} onValueChange={setFilterDateField}>
                                        <SelectTrigger className="h-10 rounded-xl border-brand-navy/[0.06] bg-brand-navy/[0.02] text-xs font-bold text-brand-navy hover:border-brand-navy/10 transition-colors">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-none shadow-2xl shadow-brand-navy/10">
                                            <SelectItem value="date" className="text-xs font-bold rounded-xl">Order Date</SelectItem>
                                            <SelectItem value="created_at" className="text-xs font-bold rounded-xl">Created Date</SelectItem>
                                            <SelectItem value="updated_at" className="text-xs font-bold rounded-xl">Updated Date</SelectItem>
                                            <SelectItem value="assignment_date" className="text-xs font-bold rounded-xl">Assigned Date</SelectItem>
                                            <SelectItem value="confirmation_date" className="text-xs font-bold rounded-xl">Confirmed Date</SelectItem>
                                            <SelectItem value="annulation_date" className="text-xs font-bold rounded-xl">Cancelled Date</SelectItem>
                                            <SelectItem value="date_livraison" className="text-xs font-bold rounded-xl">Delivered Date</SelectItem>
                                            <SelectItem value="reported_date" className="text-xs font-bold rounded-xl">Reported Date</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider">Range</span>
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
                                                type="button"
                                                onClick={() => { setFilterTimeRange(opt.v); if (opt.v !== 'custom') setShowCalendar(false); else setShowCalendar(true); }}
                                                className={cn(
                                                    "h-10 px-3.5 rounded-xl text-[11px] font-bold transition-all duration-200 border",
                                                    filterTimeRange === opt.v
                                                        ? "bg-brand-navy text-brand-white border-brand-navy shadow-lg shadow-brand-navy/20"
                                                        : "bg-brand-navy/[0.02] text-brand-navy/50 border-brand-navy/[0.06] hover:border-brand-navy/10 hover:text-brand-navy/70 hover:bg-brand-navy/[0.04]"
                                                )}
                                            >
                                                {opt.l}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                {filterTimeRange === 'custom' && (
                                    <div className="space-y-1.5">
                                        <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider">Pick Dates</span>
                                        <Popover open={showCalendar} onOpenChange={setShowCalendar}>
                                            <PopoverTrigger asChild>
                                                <Button variant="outline" className="h-10 rounded-xl border-brand-navy/[0.06] bg-brand-navy/[0.02] text-xs font-bold text-brand-navy gap-2 px-4 hover:border-brand-navy/10">
                                                    <Calendar className="w-3.5 h-3.5 text-blue-500" />
                                                    {filterCustomRange?.from ? (
                                                        filterCustomRange.to ? (
                                                            <>{format(filterCustomRange.from, 'MMM dd')} — {format(filterCustomRange.to, 'MMM dd, yyyy')}</>
                                                        ) : format(filterCustomRange.from, 'MMM dd, yyyy')
                                                    ) : 'Select range...'}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0 rounded-[24px] border-none shadow-2xl shadow-brand-navy/10" align="start">
                                                <CalendarComponent
                                                    mode="range"
                                                    selected={calendarRange}
                                                    onSelect={handleCustomRangeSelect}
                                                    onDayMouseEnter={(day) => setHoveredCalendarDate(day)}
                                                    onDayMouseLeave={() => setHoveredCalendarDate(undefined)}
                                                    modifiers={calendarPreviewRange ? { preview: calendarPreviewRange } : undefined}
                                                    modifiersClassNames={{ preview: 'bg-accent text-accent-foreground' }}
                                                    numberOfMonths={2}
                                                    className="rounded-[24px] p-4"
                                                />
                                            </PopoverContent>
                                        </Popover>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="p-5 border-b border-brand-navy/[0.04]">
                            <div className="flex items-center gap-2 mb-3.5">
                                <div className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                                    <Search className="w-3.5 h-3.5 text-emerald-500" />
                                </div>
                                <span className="text-[11px] font-black uppercase tracking-widest text-brand-navy/40">Customer Search</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="relative group">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-navy/20 group-focus-within:text-brand-navy/50 transition-colors" />
                                    <Input
                                        placeholder="Customer name..."
                                        value={filterCustomerName}
                                        onChange={(e) => setFilterCustomerName(e.target.value)}
                                        className="h-10 w-[200px] pl-9 rounded-xl border-brand-navy/[0.06] bg-brand-navy/[0.02] text-xs font-medium hover:border-brand-navy/10 focus-visible:ring-1 focus-visible:ring-brand-navy/10"
                                    />
                                </div>
                                <div className="relative group">
                                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-navy/20 group-focus-within:text-brand-navy/50 transition-colors" />
                                    <Input
                                        placeholder="Phone number..."
                                        value={filterPhone}
                                        onChange={(e) => setFilterPhone(e.target.value)}
                                        className="h-10 w-[180px] pl-9 rounded-xl border-brand-navy/[0.06] bg-brand-navy/[0.02] text-xs font-medium hover:border-brand-navy/10 focus-visible:ring-1 focus-visible:ring-brand-navy/10"
                                    />
                                </div>
                                <div className="relative group">
                                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-navy/20 group-focus-within:text-brand-navy/50 transition-colors" />
                                    <Input
                                        placeholder="Tracking number..."
                                        value={filterTracking}
                                        onChange={(e) => setFilterTracking(e.target.value)}
                                        className="h-10 w-[200px] pl-9 rounded-xl border-brand-navy/[0.06] bg-brand-navy/[0.02] text-xs font-medium hover:border-brand-navy/10 focus-visible:ring-1 focus-visible:ring-brand-navy/10"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="p-5">
                            <div className="flex items-center gap-2 mb-3.5">
                                <div className="w-6 h-6 rounded-lg bg-purple-500/10 flex items-center justify-center">
                                    <Filter className="w-3.5 h-3.5 text-purple-500" />
                                </div>
                                <span className="text-[11px] font-black uppercase tracking-widest text-brand-navy/40">Filters</span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider flex items-center gap-1">
                                        <ShieldCheck className="w-3 h-3" /> Status
                                    </span>
                                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                                        <SelectTrigger className={cn("h-10 rounded-xl text-xs font-bold transition-all", filterStatus !== 'all' ? "border-purple-200 bg-purple-50/50 text-purple-700" : "border-brand-navy/[0.06] bg-brand-navy/[0.02] text-brand-navy")}>
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-none shadow-2xl shadow-brand-navy/10 max-h-[300px]">
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

                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider flex items-center gap-1">
                                        <Package className="w-3 h-3" /> Package
                                    </span>
                                    <Select value={filterPackageStatus} onValueChange={setFilterPackageStatus}>
                                        <SelectTrigger className={cn("h-10 rounded-xl text-xs font-bold transition-all", filterPackageStatus !== 'all' ? "border-orange-200 bg-orange-50/50 text-orange-700" : "border-brand-navy/[0.06] bg-brand-navy/[0.02] text-brand-navy")}>
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-none shadow-2xl shadow-brand-navy/10 max-h-[300px]">
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

                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider flex items-center gap-1">
                                        <MapPin className="w-3 h-3" /> City
                                    </span>
                                    <Select value={filterCity} onValueChange={setFilterCity}>
                                        <SelectTrigger className={cn("h-10 rounded-xl text-xs font-bold transition-all", filterCity !== 'all' ? "border-emerald-200 bg-emerald-50/50 text-emerald-700" : "border-brand-navy/[0.06] bg-brand-navy/[0.02] text-brand-navy")}>
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-none shadow-2xl shadow-brand-navy/10 max-h-[300px]">
                                            <SelectItem value="all" className="font-bold text-xs rounded-xl">All Cities</SelectItem>
                                            {sellerFilterCities.map((c) => (
                                                <SelectItem key={c.id} value={c.id} className="font-bold text-xs rounded-xl">{c.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider flex items-center gap-1">
                                        <ShoppingBag className="w-3 h-3" /> Product
                                    </span>
                                    <Select value={filterProduct} onValueChange={setFilterProduct}>
                                        <SelectTrigger className={cn("h-10 rounded-xl text-xs font-bold transition-all", filterProduct !== 'all' ? "border-pink-200 bg-pink-50/50 text-pink-700" : "border-brand-navy/[0.06] bg-brand-navy/[0.02] text-brand-navy")}>
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-none shadow-2xl shadow-brand-navy/10 max-h-[300px]">
                                            <SelectItem value="all" className="font-bold text-xs rounded-xl">All Products</SelectItem>
                                            {(products as any[])?.map((p: any) => (
                                                <SelectItem key={p.id} value={p.id} className="font-bold text-xs rounded-xl">{productNameLabel(p)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider flex items-center gap-1">
                                        <ExternalLink className="w-3 h-3" /> Source
                                    </span>
                                    <Select value={filterSource} onValueChange={setFilterSource}>
                                        <SelectTrigger className={cn("h-10 rounded-xl text-xs font-bold transition-all", filterSource !== 'all' ? "border-cyan-200 bg-cyan-50/50 text-cyan-700" : "border-brand-navy/[0.06] bg-brand-navy/[0.02] text-brand-navy")}>
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-none shadow-2xl shadow-brand-navy/10">
                                            <SelectItem value="all" className="font-bold text-xs rounded-xl">All Sources</SelectItem>
                                            {SALES_SOURCES.map((s) => (
                                                <SelectItem key={s} value={s} className="font-bold text-xs capitalize rounded-xl">{s}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider flex items-center gap-1">
                                        <Truck className="w-3 h-3" /> Delivery
                                    </span>
                                    <Select value={filterProvider} onValueChange={setFilterProvider}>
                                        <SelectTrigger className={cn("h-10 rounded-xl text-xs font-bold transition-all", filterProvider !== 'all' ? "border-amber-200 bg-amber-50/50 text-amber-700" : "border-brand-navy/[0.06] bg-brand-navy/[0.02] text-brand-navy")}>
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-none shadow-2xl shadow-brand-navy/10 max-h-[300px]">
                                            <SelectItem value="all" className="font-bold text-xs rounded-xl">All Services</SelectItem>
                                            {sellerFilterProviders.map((p) => (
                                                <SelectItem key={`${p.type}-${p.id}`} value={p.id} className="font-bold text-xs rounded-xl">
                                                    <div className="flex items-center gap-2">
                                                        {p.type === 'courier' ? <Truck className="w-3 h-3 text-orange-500" /> : <Building2 className="w-3 h-3 text-blue-500" />}
                                                        {p.name}
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider flex items-center gap-1">
                                        <RefreshCcw className="w-3 h-3" /> Exchange
                                    </span>
                                    <Select value={filterExchange} onValueChange={setFilterExchange}>
                                        <SelectTrigger className={cn("h-10 rounded-xl text-xs font-bold transition-all", filterExchange !== 'all' ? "border-red-200 bg-red-50/50 text-red-700" : "border-brand-navy/[0.06] bg-brand-navy/[0.02] text-brand-navy")}>
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-none shadow-2xl shadow-brand-navy/10">
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
                        <Skeleton key={i} className="h-64 w-full rounded-[32px]" />
                    ))}
                </div>
            ) : filteredOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-6 bg-brand-white rounded-[40px] shadow-sm border border-brand-navy/[0.03]">
                    <div className="w-24 h-24 bg-brand-navy/[0.04] rounded-full flex items-center justify-center">
                        <ShoppingCart className="w-12 h-12 text-brand-navy/20" />
                    </div>
                    <div className="text-center space-y-2">
                        <h3 className="text-2xl font-bold text-brand-navy">No orders found</h3>
                        <p className="text-muted-foreground max-w-xs mx-auto">Start by adding your first customer order to track its progress.</p>
                    </div>
                </div>
            ) : (
                viewMode === 'grid' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-20">
                        {filteredOrders.map((order) => {
                            const allParcels = [...(order.parcels || []), ...(order.courier_parcels || [])].filter((p: any) => p.tracking_code);
                            const latestParcel = allParcels.sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())?.[0];
                            const trackingCode = latestParcel?.tracking_code;
                            const isDuplicateClient = duplicatePhones.has(order.phone);
                            const hasTrackableCourierParcel = (order.courier_parcels || []).some((p: any) => p?.tracking_code && String(p.tracking_code).trim());
                            const canTrackParcel = !!getLatestTrackableCompanyParcel(order) || hasTrackableCourierParcel;
                            return (
                                <div
                                    key={order.id}
                                    className={cn(
                                        "group relative bg-white rounded-2xl border transition-all duration-300 hover:shadow-lg cursor-default",
                                        "border-brand-navy/[0.06] shadow-sm hover:border-brand-navy/10"
                                    )}
                                >
                                    {/* Top accent line */}
                                    <div className="h-[3px] rounded-t-2xl" style={{ backgroundColor: order.status?.color || '#cbd5e1' }} />

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
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-50 text-red-600 text-[10px] font-bold">
                                                        <RefreshCcw className="w-2.5 h-2.5" />EXCH
                                                    </span>
                                                )}
                                            </div>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <button className="w-7 h-7 rounded-lg flex items-center justify-center text-brand-navy/25 hover:text-brand-navy hover:bg-brand-navy/5 transition-colors shrink-0">
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
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>

                                        {/* Row 2: Customer */}
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <div
                                                className={cn(
                                                    'w-9 h-9 rounded-xl flex shrink-0 items-center justify-center',
                                                    isDuplicateClient ? 'bg-[#d4c438]' : 'bg-brand-navy/[0.06]'
                                                )}
                                            >
                                                <User
                                                    className={cn(
                                                        'w-4 h-4',
                                                        isDuplicateClient ? 'text-[#9a7f00]' : 'text-brand-navy/50'
                                                    )}
                                                />
                                            </div>
                                            <div className="min-w-0">
                                                <p
                                                    className={cn(
                                                        'text-sm font-bold truncate leading-tight',
                                                        isDuplicateClient ? 'text-[#9a7f00]' : 'text-brand-navy'
                                                    )}
                                                    title={isDuplicateClient ? 'Same phone number on multiple orders' : undefined}
                                                >
                                                    {order.name}
                                                </p>
                                                <p className="text-[11px] text-brand-navy/40 font-medium tracking-wide truncate">{order.phone}</p>
                                            </div>
                                        </div>

                                        {/* Row 3: Metadata chips */}
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            {order.city?.name && (
                                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-navy/[0.03] text-[10px] font-bold text-brand-navy/60">
                                                    <MapPin className="w-3 h-3 text-brand-navy/30" />{order.city.name}
                                                </span>
                                            )}
                                            {order.source_name && (
                                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-navy/[0.03] text-[10px] font-bold text-brand-navy/60 capitalize">
                                                    <Hash className="w-3 h-3 text-brand-navy/30" />{order.source_name}
                                                </span>
                                            )}
                                            {(order.company?.name || order.courier?.name) && (
                                                <span className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-lg bg-brand-navy/[0.03] text-[10px] font-bold text-brand-navy/60">
                                                    {order.company?.logo_url ? (
                                                        <img src={order.company.logo_url} alt="" className="w-4 h-4 rounded-full object-contain bg-white" />
                                                    ) : order.courier?.avatar_url ? (
                                                        <img src={order.courier.avatar_url} alt="" className="w-4 h-4 rounded-full object-cover" />
                                                    ) : (
                                                        <span className="w-4 h-4 rounded-full bg-brand-navy/10 flex items-center justify-center text-[8px] font-black text-brand-navy/60">
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
                                        {(REPORTED_STATUS_ID && (statusCats.isOrderCategory(order.order_status_id, 'postponed') || order.order_status_id === REPORTED_STATUS_ID)) && order.reported_date && (
                                            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-amber-50 border border-amber-100">
                                                <div className="flex items-center gap-2">
                                                    <Calendar className="w-3.5 h-3.5 text-amber-600" />
                                                    <span className="text-[11px] font-bold text-amber-800">
                                                        {format(new Date(order.reported_date), 'dd MMM yyyy')}
                                                    </span>
                                                </div>
                                                <span className="text-[10px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded">
                                                    {format(new Date(order.reported_date), 'HH:mm')}
                                                </span>
                                            </div>
                                        )}

                                        {/* Row 6: Footer — Price + View */}
                                        <div className="flex items-center justify-between pt-2 border-t border-brand-navy/[0.04] gap-2">
                                            <div className="flex items-baseline gap-1 min-w-0">
                                                <span className="text-xl font-black text-brand-navy tabular-nums">
                                                    {new Intl.NumberFormat('fr-FR').format(order.raw_price || 0)}
                                                </span>
                                                <span className="text-[10px] font-bold text-brand-navy/35 uppercase">DH</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                                                <button
                                                    type="button"
                                                    onClick={() => { setSelectedOrder(order); setIsViewModalOpen(true); }}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-navy/[0.05] hover:bg-brand-navy text-brand-navy/50 hover:text-white text-[11px] font-bold transition-all duration-200"
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
                                                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-navy/[0.05] hover:bg-brand-navy text-brand-navy/50 hover:text-white text-[11px] font-bold transition-all duration-200',
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
                                                    className="w-7 h-7 rounded-lg flex items-center justify-center bg-brand-navy/[0.05] hover:bg-brand-navy text-brand-navy/50 hover:text-white transition-all duration-200"
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
                    <div className="bg-white rounded-2xl shadow-sm border border-brand-navy/[0.05] overflow-hidden mb-20 animate-in fade-in duration-300">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse min-w-[800px]">
                                <thead>
                                    <tr className="border-b border-brand-navy/[0.06]">
                                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-brand-navy/40">Customer</th>
                                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-brand-navy/40">City / Source</th>
                                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-brand-navy/40">Status</th>
                                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-brand-navy/40">Tracking</th>
                                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-brand-navy/40 text-right">Amount</th>
                                        <th className="px-4 py-3 w-28" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredOrders.map((order) => {
                                        const allParcels = [...(order.parcels || []), ...(order.courier_parcels || [])].filter((p: any) => p.tracking_code);
                                        const latestParcel = allParcels.sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())?.[0];
                                        const trackingCode = latestParcel?.tracking_code;
                                        const isDuplicateClient = duplicatePhones.has(order.phone);
                                        const hasTrackableCourierParcel = (order.courier_parcels || []).some((p: any) => p?.tracking_code && String(p.tracking_code).trim());
                            const canTrackParcel = !!getLatestTrackableCompanyParcel(order) || hasTrackableCourierParcel;
                                        return (
                                            <tr
                                                key={order.id}
                                                className="border-b border-brand-navy/[0.03] hover:bg-brand-navy/[0.01] transition-colors group"
                                            >
                                                {/* Customer */}
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2.5">
                                                        <div
                                                            className={cn(
                                                                'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                                                                isDuplicateClient ? 'bg-[#d4c438]' : 'bg-brand-navy/[0.05]'
                                                            )}
                                                        >
                                                            <User
                                                                className={cn(
                                                                    'w-4 h-4',
                                                                    isDuplicateClient ? 'text-[#9a7f00]' : 'text-brand-navy/40'
                                                                )}
                                                            />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="text-[13px] font-bold truncate leading-tight flex items-center gap-1.5">
                                                                <span
                                                                    className={cn(
                                                                        'truncate',
                                                                        isDuplicateClient ? 'text-[#9a7f00]' : 'text-brand-navy'
                                                                    )}
                                                                    title={isDuplicateClient ? 'Same phone number on multiple orders' : undefined}
                                                                >
                                                                    {order.name}
                                                                </span>
                                                                {order.replace && (
                                                                    <span className="inline-flex shrink-0" title="Exchange">
                                                                        <RefreshCcw className="w-3 h-3 text-red-500" />
                                                                    </span>
                                                                )}
                                                            </p>
                                                            <p className="text-[11px] text-brand-navy/35 font-medium truncate">{order.phone}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                {/* City / Source */}
                                                <td className="px-4 py-3">
                                                    <p className="text-[12px] font-bold text-brand-navy leading-tight">{order.city?.name || '—'}</p>
                                                    <p className="text-[10px] text-brand-navy/35 font-medium capitalize">{order.source_name}</p>
                                                </td>
                                                {/* Status */}
                                                <td className="px-4 py-3">
                                                    <div className="space-y-1">
                                                        <span
                                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide"
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
                                                                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide w-fit"
                                                                    style={{
                                                                        backgroundColor: pkgColor ? `${pkgColor}10` : 'rgba(0,31,63,0.03)',
                                                                        color: pkgColor || 'rgba(0,31,63,0.45)',
                                                                    }}
                                                                >
                                                                    <Truck className="w-3 h-3" />
                                                                    {pkgLabel}
                                                                </span>
                                                            );
                                                        })()}
                                                        {(REPORTED_STATUS_ID && (statusCats.isOrderCategory(order.order_status_id, 'postponed') || order.order_status_id === REPORTED_STATUS_ID)) && order.reported_date && (
                                                            <span className="flex items-center gap-1 text-[9px] font-bold text-amber-700">
                                                                <Calendar className="w-2.5 h-2.5" />
                                                                {format(new Date(order.reported_date), 'dd/MM HH:mm')}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                {/* Tracking */}
                                                <td className="px-4 py-3">
                                                    {trackingCode ? (
                                                        <div className="flex flex-col gap-0.5">
                                                            <span className="text-[11px] font-mono font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded w-fit">{trackingCode}</span>
                                                            {(order.company?.name || order.courier?.name) && (
                                                                <span className="text-[9px] text-brand-navy/30 font-medium">
                                                                    {order.company?.name || order.courier?.name}
                                                                </span>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-[10px] text-brand-navy/15">—</span>
                                                    )}
                                                </td>
                                                {/* Amount */}
                                                <td className="px-4 py-3 text-right">
                                                    <span className="text-sm font-black text-brand-navy tabular-nums">
                                                        {new Intl.NumberFormat('fr-FR').format(order.raw_price || 0)}
                                                    </span>
                                                    <span className="text-[10px] font-bold text-brand-navy/30 ml-1">DH</span>
                                                </td>
                                                {/* Actions */}
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => { setSelectedOrder(order); setIsViewModalOpen(true); }}
                                                            className="w-8 h-8 rounded-lg flex items-center justify-center text-brand-navy/30 hover:text-brand-navy hover:bg-brand-navy/5 transition-colors"
                                                        >
                                                            <Eye className="w-4 h-4" />
                                                        </button>
                                                        <OrderPhoneContactDropdown phone={order.phone} variant="icon" />
                                                        <button
                                                            type="button"
                                                            disabled={!canTrackParcel}
                                                            title={canTrackParcel ? 'Track parcel' : 'No provider parcel to track'}
                                                            onClick={() => {
                                                                if (!canTrackParcel) return;
                                                                setParcelTrackingOrderId(order.id);
                                                                setParcelTrackingOpen(true);
                                                            }}
                                                            className="w-8 h-8 rounded-lg flex items-center justify-center text-brand-navy/30 hover:text-brand-navy hover:bg-brand-navy/5 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                                                        >
                                                            <Truck className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            title="Status history"
                                                            onClick={() => setHistoryDialogOrder(order)}
                                                            className="w-8 h-8 rounded-lg flex items-center justify-center text-brand-navy/30 hover:text-brand-navy hover:bg-brand-navy/5 transition-colors"
                                                        >
                                                            <Package className="w-4 h-4" />
                                                        </button>
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild>
                                                                <button
                                                                    type="button"
                                                                    className="w-8 h-8 rounded-lg flex items-center justify-center text-brand-navy/20 hover:text-brand-navy hover:bg-brand-navy/5 transition-colors"
                                                                >
                                                                    <MoreVertical className="w-4 h-4" />
                                                                </button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent align="end" className="rounded-xl border-none shadow-2xl p-1.5 min-w-[150px]">
                                                                <DropdownMenuItem onClick={() => handleEdit(order)} className="rounded-lg px-3 py-2 cursor-pointer gap-2.5 text-xs font-bold">
                                                                    <Edit2 className="w-3.5 h-3.5" /> Edit
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
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
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
                                ameex_old_tracking: ''
                            });
                        }, 0);
                    }
                }}
            >
                <DialogContent className="w-[min(96vw,1180px)] max-w-[1180px] p-0 gap-0 border-none bg-brand-white rounded-[28px] shadow-2xl overflow-hidden flex flex-col h-[min(92dvh,820px)] max-h-[92dvh]">
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
                            <DialogHeader className="px-5 py-3 pr-12 shrink-0 border-b border-brand-navy/[0.08] bg-brand-navy/[0.02]">
                                <DialogTitle className="text-lg sm:text-xl font-black text-brand-navy tracking-tight leading-tight">
                                    {isEditModalOpen ? 'Update order' : 'New order'}
                                </DialogTitle>
                                <DialogDescription className="text-muted-foreground text-xs sm:text-sm mt-0.5 leading-snug">
                                    Details left · Lines scroll on the right · Notes below
                                </DialogDescription>
                            </DialogHeader>

                            <div className="flex flex-1 min-h-0 flex-col xl:flex-row overflow-hidden">
                                <div className="min-w-0 flex-1 flex flex-col gap-4 min-h-0 overflow-y-auto xl:pr-1 px-4 sm:px-5 py-3 custom-scrollbar">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 shrink-0">
                                    {/* Column 1: Customer Data */}
                                    <div className="space-y-3.5">
                                        <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-navy/45 border-b border-brand-navy/[0.08] pb-2 flex items-center gap-2">
                                            <User className="w-3 h-3" /> Customer
                                        </h4>
                                        <FormField
                                            control={form.control}
                                            name="name"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Full Name</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="Client Name" {...field} className="h-10 rounded-xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
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
                                                    <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Contact Number</FormLabel>
                                                    <div className="relative">
                                                        <FormControl>
                                                            <Input placeholder="+212..." {...field} className={cn("h-10 rounded-xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner", inputPr)} />
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
                                                                                ? "bg-brand-navy text-brand-white shadow-lg shadow-brand-navy/20 scale-105"
                                                                                : "bg-brand-navy/10 text-brand-navy/50 hover:bg-brand-navy/20 hover:text-brand-navy"
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
                                                    <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Target City</FormLabel>
                                                    <Popover open={citySearchOpen} onOpenChange={setCitySearchOpen}>
                                                        <PopoverTrigger asChild>
                                                            <FormControl>
                                                                <Button
                                                                    variant="outline"
                                                                    role="combobox"
                                                                    className={cn(
                                                                        "h-10 w-full justify-between rounded-xl border-none bg-brand-navy/[0.04] text-sm text-brand-navy font-bold shadow-inner text-left px-3",
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
                                                                                className="py-3 px-4 font-bold text-brand-navy cursor-pointer hover:bg-brand-navy hover:text-brand-white"
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
                                                    <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Full Address</FormLabel>
                                                    <FormControl>
                                                        <Textarea placeholder="Street, building, floor…" {...field} className="min-h-[72px] rounded-xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner resize-y p-3 leading-relaxed" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>

                                    {/* Column 2: Logistics & Status */}
                                    <div className="space-y-3.5">
                                        <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-navy/45 border-b border-brand-navy/[0.08] pb-2 flex items-center gap-2">
                                            <Truck className="w-3 h-3" /> Logistics
                                        </h4>
                                        <FormField
                                            control={form.control}
                                            name="source_name"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Sales Channel</FormLabel>
                                                    <Select onValueChange={field.onChange} value={field.value} disabled={isEditModalOpen}>
                                                        <FormControl>
                                                            <SelectTrigger className="h-10 rounded-xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy shadow-inner">
                                                                <SelectValue placeholder="Select channel" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent className="rounded-2xl border-none shadow-2xl">
                                                            {SALES_SOURCES.map(source => (
                                                                <SelectItem key={source} value={source} className="rounded-xl font-bold capitalize">{source}</SelectItem>
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
                                                            <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Shipping Provider</FormLabel>
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
                                                                    <SelectTrigger className="h-10 rounded-xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy shadow-inner">
                                                                        <SelectValue placeholder="Choose provider..." />
                                                                    </SelectTrigger>
                                                                </FormControl>
                                                                <SelectContent className="rounded-2xl border-none shadow-2xl">
                                                                    {availableProviders.map((p: any) => (
                                                                        <SelectItem key={p.id} value={p.id} className="rounded-xl font-bold">
                                                                            <div className="flex items-center gap-2">
                                                                                {p.type === 'courier' ? (
                                                                                    p.avatar_url ? (
                                                                                        <img src={p.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                                                                                    ) : (
                                                                                        <span className="w-5 h-5 rounded-full bg-brand-navy/10 flex items-center justify-center text-[9px] font-black text-brand-navy/60">
                                                                                            {(p.name || '?').slice(0, 1).toUpperCase()}
                                                                                        </span>
                                                                                    )
                                                                                ) : (
                                                                                    p.logo_url ? (
                                                                                        <img src={p.logo_url} alt="" className="w-5 h-5 rounded-full object-contain bg-white border border-brand-navy/[0.06]" />
                                                                                    ) : (
                                                                                        <span className="w-5 h-5 rounded-full bg-brand-navy/10 flex items-center justify-center text-[9px] font-black text-brand-navy/60">
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
                                                        <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Shipping Fee</FormLabel>
                                                        <FormControl>
                                                            <div className="relative">
                                                                <Input
                                                                    type="number"
                                                                    {...field}
                                                                    readOnly={shippingFeeReadOnly}
                                                                    className={`h-10 rounded-xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy shadow-inner pl-3 pr-10 ${shippingFeeReadOnly ? 'cursor-not-allowed opacity-60' : ''}`}
                                                                />
                                                                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        onClick={calculateShippingFee}
                                                                        className="h-6 w-6 text-brand-navy/30 hover:text-brand-navy"
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
                                                    <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Pipeline Stage</FormLabel>
                                                    <Popover open={statusSearchOpen} onOpenChange={setStatusSearchOpen}>
                                                        <PopoverTrigger asChild>
                                                            <FormControl>
                                                                <Button
                                                                    variant="outline"
                                                                    role="combobox"
                                                                    className={cn(
                                                                        "h-10 w-full justify-between rounded-xl border-none bg-brand-navy/[0.04] text-sm text-brand-navy font-bold shadow-inner text-left px-3",
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
                                                                                className="py-3 px-4 font-bold text-brand-navy cursor-pointer hover:bg-brand-navy hover:text-brand-white"
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
                                                        <FormLabel className="text-[10px] font-black uppercase tracking-wider text-brand-navy/60 flex items-center gap-1">
                                                            <MessageSquare className="w-3 h-3 text-brand-navy/40" /> Status change reason (required)
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Textarea placeholder="Explain why you are moving to this status…" {...field} className="min-h-[56px] resize-y rounded-xl border-none bg-brand-navy/[0.03] text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner focus-visible:ring-brand-navy/20" />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        )}

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div className="p-3 rounded-xl bg-brand-navy/[0.03] border border-brand-navy/[0.06] flex items-center justify-between gap-3">
                                                <div className="space-y-0.5 min-w-0">
                                                    <FormLabel className="text-xs font-bold text-brand-navy">Exchange order</FormLabel>
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
                                            <div className="p-3 rounded-xl bg-brand-navy/[0.03] border border-brand-navy/[0.06] flex items-center justify-between gap-3">
                                                <div className="space-y-0.5 min-w-0">
                                                    <FormLabel className="text-xs font-bold text-brand-navy">Include delivery fees</FormLabel>
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
                                                        <FormItem className="space-y-2 rounded-xl border border-amber-200/80 bg-amber-50/40 p-3">
                                                            <FormLabel className="text-[10px] font-black uppercase tracking-wider text-brand-navy">
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
                                                                    className="h-11 rounded-xl border border-brand-navy/10 bg-white text-sm font-bold text-brand-navy"
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
                                                        <FormItem className="space-y-2 rounded-xl border border-amber-200/80 bg-amber-50/40 p-3">
                                                            <FormLabel className="text-[10px] font-black uppercase tracking-wider text-brand-navy">
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
                                                                    className="h-11 rounded-xl border border-brand-navy/10 bg-white text-sm font-bold text-brand-navy"
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            )}
                                    </div>
                                </div>

                                <section className="rounded-xl border border-brand-navy/[0.08] bg-brand-navy/[0.02] p-3 sm:p-4 space-y-3 shrink-0">
                                    <div className="space-y-0.5">
                                        <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-navy/50 flex items-center gap-2">
                                            <MessageSquare className="w-3 h-3 text-brand-navy/45" /> Notes
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
                                                    <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Order Note (Internal)</FormLabel>
                                                    <FormControl>
                                                        <Textarea placeholder="Packaging, gifts…" {...field} className="min-h-[64px] rounded-xl border-none bg-white/90 text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner resize-y p-3 leading-relaxed" />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="delivery_note"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Courier Note (Public)</FormLabel>
                                                    <FormControl>
                                                        <Textarea placeholder="Courier instructions…" {...field} className="min-h-[64px] rounded-xl border-none bg-white/90 text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner resize-y p-3 leading-relaxed" />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </section>
                                    </div>

                                    <aside className="w-full xl:w-[min(26rem,34vw)] xl:max-w-[420px] xl:shrink-0 flex flex-col min-h-0 border-t xl:border-t-0 xl:border-l border-brand-navy/[0.1] bg-brand-navy/[0.03]">
                                    <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2.5 border-b border-brand-navy/[0.08] bg-brand-navy/[0.02]">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="w-8 h-8 rounded-lg bg-brand-navy/10 flex items-center justify-center shrink-0">
                                                <ShoppingBag className="w-4 h-4 text-brand-navy" />
                                            </div>
                                            <div className="min-w-0">
                                                <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-navy leading-tight">Order lines</h4>
                                                <p className="text-[9px] text-brand-navy/45 font-medium truncate">Scroll here only</p>
                                            </div>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => append({ product_id: '', quantity: 1, unit_price: 0, accessories: [] })}
                                            className="text-[9px] font-black uppercase text-brand-navy border-brand-navy/15 bg-white h-8 px-2.5 gap-1 rounded-lg shrink-0"
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
                                                <div key={field.id} className="rounded-2xl border border-brand-navy/10 bg-white p-3 shadow-sm space-y-3 animate-in slide-in-from-left-2 duration-200">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="text-[9px] font-black uppercase tracking-wider text-brand-navy/35 tabular-nums">Line {index + 1}</span>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => remove(index)}
                                                            disabled={fields.length === 1}
                                                            className="h-7 w-7 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 shrink-0"
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
                                                                    <FormLabel className="text-[8px] uppercase font-black text-brand-navy/45">Unit</FormLabel>
                                                                    <Input type="number" {...field} disabled={!hasProduct} className="h-9 rounded-lg border border-brand-navy/10 bg-brand-navy/[0.03] text-sm font-bold text-brand-navy text-center px-1" />
                                                                </FormItem>
                                                            )}
                                                        />
                                                        <FormField
                                                            control={form.control}
                                                            name={`items.${index}.quantity`}
                                                            render={({ field }) => (
                                                                <FormItem className="space-y-1">
                                                                    <FormLabel className="text-[8px] uppercase font-black text-brand-navy/45">Qty</FormLabel>
                                                                    <Input type="number" {...field} disabled={!hasProduct} className="h-9 rounded-lg border border-brand-navy/10 bg-brand-navy/[0.03] text-sm font-bold text-brand-navy text-center px-1" />
                                                                </FormItem>
                                                            )}
                                                        />
                                                        <div className="rounded-lg bg-brand-navy/[0.08] px-1.5 py-1 flex flex-col justify-center items-center text-center">
                                                            <span className="text-[7px] font-black uppercase text-brand-navy/50 leading-none">Total</span>
                                                            <span className="text-xs font-black text-brand-navy tabular-nums leading-tight">{productSubtotal.toFixed(2)} <span className="text-[9px] font-bold text-brand-navy/65">DH</span></span>
                                                        </div>
                                                    </div>

                                                    <div className="rounded-xl bg-brand-navy/[0.04] border border-brand-navy/[0.07] p-2.5 space-y-2">
                                                        <p className="text-[9px] font-black uppercase tracking-wider text-brand-navy/35">Add-ons</p>
                                                        {(form.watch(`items.${index}.accessories`) || []).map((acc: any, accIdx: number) => {
                                                            const hasAccessory = !!form.watch(`items.${index}.accessories.${accIdx}.accessory_id`) && form.watch(`items.${index}.accessories.${accIdx}.accessory_id`) !== 'none';

                                                            return (
                                                                <div key={accIdx} className="space-y-2 pb-2 border-b border-brand-navy/[0.08] last:border-0 last:pb-0">
                                                                    <div className="flex gap-2 items-end">
                                                                        <FormField
                                                                            control={form.control}
                                                                            name={`items.${index}.accessories.${accIdx}.accessory_id`}
                                                                            render={({ field }) => (
                                                                                <FormItem className="space-y-1 flex-1 min-w-0">
                                                                                    <FormLabel className="text-[8px] uppercase font-black text-brand-navy/45 flex items-center gap-1"><Puzzle className="w-3 h-3 opacity-60" /> Item</FormLabel>
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
                                                                                            <SelectTrigger className="h-9 rounded-lg border border-brand-navy/10 bg-white text-sm font-bold text-brand-navy shadow-none">
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
                                                                                        if (selectedAccessory && selectedAccessory.stock !== null && selectedAccessory.stock !== undefined) {
                                                                                            if (selectedAccessory.stock === 0) {
                                                                                                return (
                                                                                                    <div className="mt-1 flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-50 border border-red-200">
                                                                                                        <span className="text-[8px] font-bold text-red-600 uppercase">Out of stock</span>
                                                                                                    </div>
                                                                                                );
                                                                                            } else if (selectedAccessory.stock < 10) {
                                                                                                return (
                                                                                                    <div className="mt-1 flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-50 border border-amber-200">
                                                                                                        <span className="text-[8px] font-bold text-amber-700 uppercase">Low: {selectedAccessory.stock}</span>
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
                                                                            className="h-9 w-9 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 shrink-0"
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
                                                                                <FormLabel className="text-[8px] uppercase font-black text-brand-navy/40">Qty</FormLabel>
                                                                                <Input type="number" {...field} disabled={!hasAccessory} className="h-9 rounded-lg border border-brand-navy/10 bg-white text-sm font-bold text-brand-navy text-center px-1" />
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
                                                            className="text-[9px] font-black uppercase text-brand-navy border-brand-navy/15 h-7 rounded-lg gap-1 w-full bg-white/80"
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

                            <DialogFooter className="px-4 py-2.5 sm:px-5 shrink-0 bg-brand-navy/[0.02] border-t border-brand-navy/[0.08] flex flex-row flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-9 h-9 rounded-xl bg-brand-navy flex items-center justify-center text-brand-white shadow-md shrink-0">
                                        <DollarSign className="w-4 h-4" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/70 leading-none">Total</p>
                                        <p className="text-lg sm:text-xl font-black text-brand-navy tabular-nums leading-tight truncate">
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
                                        className="rounded-lg h-9 px-4 text-sm font-bold text-brand-navy hover:bg-brand-navy/10 m-0"
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
                                        className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-lg h-9 px-6 sm:px-8 text-sm font-bold shadow-md transition-all active:scale-[0.98] flex items-center gap-2 m-0"
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
                <DialogContent className="max-w-4xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col h-[90vh] md:h-auto md:max-h-[90vh]">
                    {selectedOrder && (
                        <div className="flex flex-col h-full overflow-hidden">
                            <div className="p-10 pb-0 flex flex-col md:flex-row justify-between items-start gap-6 shrink-0">
                                <div className="space-y-4">
                                    <div className="flex items-center gap-4">
                                        <div className="w-16 h-16 rounded-[28px] bg-brand-navy flex items-center justify-center text-brand-white shadow-2xl shadow-brand-navy/20">
                                            <ShoppingCart className="w-8 h-8" />
                                        </div>
                                        <div>
                                            <h2 className="text-4xl font-black text-brand-navy tracking-tight">{selectedOrder.name}</h2>
                                            <div className="flex items-center gap-4 text-muted-foreground font-bold text-sm tracking-wide">
                                                <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4" /> {format(new Date(selectedOrder.date || selectedOrder.created_at), 'MMMM dd, yyyy')}</span>
                                                <span className="flex items-center gap-1.5">{selectedOrder.phone}<OrderPhoneQuickActions phone={selectedOrder.phone} className="h-7 w-7" /></span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white shadow-sm border border-brand-navy/[0.03]">
                                            <ShieldCheck className="w-4 h-4" style={{ color: selectedOrder.status?.color }} />
                                            <span className="text-xs font-black uppercase tracking-widest" style={{ color: selectedOrder.status?.color }}>
                                                {selectedOrder.status?.label || 'DRAFT'}
                                            </span>
                                        </div>
                                        <Badge variant="outline" className="border-brand-navy/10 text-brand-navy font-bold uppercase tracking-widest px-4 py-2 rounded-xl text-[10px]">
                                            {selectedOrder.source_name}
                                        </Badge>
                                        {selectedOrder.replace && (
                                            <Badge className="bg-red-500 text-white font-black uppercase tracking-widest px-4 py-2 rounded-xl text-[10px]">
                                                Exchange
                                            </Badge>
                                        )}
                                        {orderParcel?.tracking_code && (
                                            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-50 border border-indigo-100">
                                                <Package className="w-4 h-4 text-indigo-500" />
                                                <span className="text-xs font-black uppercase tracking-widest text-indigo-600">
                                                    {orderParcel.tracking_code}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="p-8 pb-10 flex items-center justify-between border-b-2 border-brand-navy/5 bg-gradient-to-br from-brand-navy/[0.02] to-transparent">
                                    <div className="space-y-1">
                                        <p className="text-sm font-black text-brand-navy/40 uppercase tracking-widest">Total Order Value</p>
                                        <h3 className="text-4xl font-black text-brand-navy">{selectedOrder.raw_price || 0} <span className="text-lg">DH</span></h3>
                                    </div>
                                </div>
                            </div>

                            <div className="overflow-y-auto p-10 space-y-10 flex-1 custom-scrollbar">
                                {/* Customer Insights in Preview */}
                                <CustomerInsights phone={selectedOrder.phone || ''} />

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                    {/* Logistics Info */}
                                    <div className="space-y-6">
                                        <div className="flex items-center gap-3 border-b border-brand-navy/[0.05] pb-3">
                                            <Truck className="w-6 h-6 text-brand-navy/20" />
                                            <h4 className="text-lg font-black text-brand-navy uppercase tracking-widest">Delivery Details</h4>
                                        </div>
                                        <div className="space-y-6">
                                            <div className="flex items-start gap-4">
                                                <div className="w-10 h-10 rounded-2xl bg-orange-50 flex items-center justify-center text-orange-500 shrink-0 shadow-sm shadow-orange-500/10">
                                                    <MapPinned className="w-5 h-5" />
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest leading-none">Destination</p>
                                                    <p className="text-lg font-bold text-brand-navy leading-tight">{selectedOrder.city?.name}</p>
                                                    <p className="text-sm font-medium text-muted-foreground italic">"{selectedOrder.address}"</p>
                                                </div>
                                            </div>
                                            <div className="flex items-start gap-4">
                                                <div className="w-10 h-10 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-500 shrink-0 shadow-sm shadow-blue-500/10">
                                                    <ShoppingCart className="w-5 h-5" />
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest leading-none">Shipping Configuration</p>
                                                    <p className="text-lg font-bold text-brand-navy leading-tight">{selectedOrder.delivery_type || 'Standard Delivery'}</p>
                                                    <p className="text-sm font-bold text-emerald-600 uppercase tracking-widest">{selectedOrder.shipping_cost === 0 ? 'Free Shipping' : `Paid: ${selectedOrder.shipping_cost} DH`}</p>
                                                </div>
                                            </div>
                                            {(selectedOrder.courier || selectedOrder.company) && (
                                                <div className="flex items-start gap-4">
                                                    <div className="w-10 h-10 rounded-2xl bg-brand-navy/5 flex items-center justify-center text-brand-navy/40 shrink-0 shadow-sm overflow-hidden">
                                                        {selectedOrder.company?.logo_url ? (
                                                            <img src={selectedOrder.company.logo_url} alt={selectedOrder.company.name} className="w-full h-full object-contain" />
                                                        ) : selectedOrder.courier?.avatar_url ? (
                                                            <img src={selectedOrder.courier.avatar_url} alt={selectedOrder.courier.name} className="w-full h-full object-cover" />
                                                        ) : (
                                                            selectedOrder.courier ? <Truck className="w-5 h-5 text-orange-500" /> : <Building2 className="w-5 h-5 text-blue-500" />
                                                        )}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <p className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest leading-none">Assigned Provider</p>
                                                        <p className="text-lg font-bold text-brand-navy leading-tight">
                                                            {selectedOrder.courier?.name || selectedOrder.company?.name}
                                                        </p>
                                                        <Badge variant="outline" className="h-5 px-2 text-[8px] font-black uppercase tracking-tighter bg-brand-navy/[0.03] text-brand-navy/40 border-none">
                                                            {selectedOrder.courier ? 'Independent Courier' : 'Delivery Company'}
                                                        </Badge>
                                                    </div>
                                                </div>
                                            )}
                                            {String(selectedOrder.coliaty_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-4">
                                                    <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600 shrink-0 shadow-sm shadow-amber-500/10">
                                                        <RefreshCcw className="w-5 h-5" />
                                                    </div>
                                                    <div className="space-y-1 min-w-0">
                                                        <p className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest leading-none">
                                                            Previous parcel tracking (Coliaty)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-brand-navy break-all">
                                                            {String(selectedOrder.coliaty_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                            {String(selectedOrder.ameex_old_tracking || '').trim() && (
                                                <div className="flex items-start gap-4">
                                                    <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600 shrink-0 shadow-sm shadow-amber-500/10">
                                                        <RefreshCcw className="w-5 h-5" />
                                                    </div>
                                                    <div className="space-y-1 min-w-0">
                                                        <p className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest leading-none">
                                                            Previous parcel tracking (AMEEX)
                                                        </p>
                                                        <p className="text-sm font-mono font-bold text-brand-navy break-all">
                                                            {String(selectedOrder.ameex_old_tracking).trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Internal Notes */}
                                    <div className="space-y-6">
                                        <div className="flex items-center gap-3 border-b border-brand-navy/[0.05] pb-3">
                                            <MessageSquare className="w-6 h-6 text-brand-navy/20" />
                                            <h4 className="text-lg font-black text-brand-navy uppercase tracking-widest">Client & Note Info</h4>
                                        </div>
                                        <div className="space-y-4">
                                            <div className="p-6 rounded-[28px] bg-brand-navy/[0.02] border border-brand-navy/[0.05] space-y-2">
                                                <p className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest">Internal Instruction</p>
                                                <p className="text-sm font-medium text-brand-navy">{selectedOrder.note || 'No internal notes provided.'}</p>
                                            </div>
                                            <div className="p-6 rounded-[28px] bg-brand-navy/[0.04] border border-brand-navy/[0.05] space-y-2">
                                                <p className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest text-brand-navy/40 text-blue-600">Public Delivery Note</p>
                                                <p className="text-sm font-bold text-brand-navy italic">"{selectedOrder.delivery_note || 'No special delivery instructions.'}"</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <Separator className="bg-brand-navy/[0.05]" />

                                {/* Order Items Table */}
                                <div className="space-y-6 pb-6">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Package className="w-6 h-6 text-brand-navy/20" />
                                            <h4 className="text-xl font-black text-brand-navy uppercase tracking-[0.15em]">Cart Items</h4>
                                        </div>
                                        <Badge variant="outline" className="text-xs font-black border-brand-navy/10 tracking-widest rounded-xl px-4 py-1.5 h-auto">
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
                                                        className="group p-6 rounded-[32px] bg-brand-navy/[0.01] border border-brand-navy/[0.03] flex flex-col gap-4 animate-in slide-in-from-bottom-2 duration-300"
                                                    >
                                                        {/* Product Info */}
                                                        {item.product && (
                                                            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                                                                <div className="flex items-center gap-5 flex-1 w-full md:w-auto">
                                                                    <div className="w-16 h-16 rounded-[20px] bg-brand-navy/5 flex items-center justify-center overflow-hidden shrink-0">
                                                                        {item.product?.image_url ? (
                                                                            <img src={item.product?.image_url} alt="" className="w-full h-full object-cover" />
                                                                        ) : (
                                                                            <Package className="w-8 h-8 text-brand-navy/20" />
                                                                        )}
                                                                    </div>
                                                                    <div>
                                                                        <h5 className="text-lg font-black text-brand-navy leading-none mb-1 group-hover:text-blue-600 transition-colors uppercase">{item.product?.name}</h5>
                                                                        <div className="flex items-center gap-3">
                                                                            <p className="text-[10px] font-bold text-muted-foreground/60 tracking-widest bg-brand-navy/5 px-2 py-0.5 rounded-md inline-block">{item.product?.code}</p>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center justify-between md:justify-end w-full md:w-auto gap-8  md:gap-12 text-right">
                                                                    <div>
                                                                        <p className="text-[10px] font-black uppercase text-muted-foreground/40 tracking-widest mb-1">Unit Price</p>
                                                                        <p className="text-lg font-black text-brand-navy">{item.unit_price} DH</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-black uppercase text-muted-foreground/40 tracking-widest mb-1">Qty</p>
                                                                        <p className="text-lg font-black text-brand-navy">x{item.quantity}</p>
                                                                    </div>
                                                                    <div className="min-w-[80px] md:min-w-[100px]">
                                                                        <p className="text-[10px] font-black uppercase text-muted-foreground/40 tracking-widest mb-1">Subtotal</p>
                                                                        <p className="text-xl font-black text-brand-navy">{prodTotal} DH</p>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Accessory Info List */}
                                                        {item.accessoriesList && item.accessoriesList.length > 0 && item.accessoriesList.map((accItem: any, idx: number) => (
                                                                <div key={accItem.id || idx} className="flex flex-col md:flex-row justify-between items-center gap-4 pt-4 border-t border-brand-navy/[0.04]">
                                                                    <div className="flex items-center gap-5 flex-1 w-full md:w-auto">
                                                                        <div className="w-12 h-12 rounded-[16px] bg-brand-navy/5 flex items-center justify-center overflow-hidden shrink-0 md:ml-4">
                                                                            {accItem.accessory?.image_url ? (
                                                                                <img src={accItem.accessory?.image_url} alt="" className="w-full h-full object-cover" />
                                                                            ) : (
                                                                                <Puzzle className="w-5 h-5 text-brand-navy/20" />
                                                                            )}
                                                                        </div>
                                                                        <div>
                                                                            <h5 className="text-sm font-black text-brand-navy/70 leading-none mb-1 uppercase flex items-center gap-2">
                                                                                <Puzzle className="w-3 h-3" /> {accItem.accessory?.name}
                                                                            </h5>
                                                                            <p className="text-[10px] font-bold text-muted-foreground/60 tracking-widest bg-brand-navy/5 px-2 py-0.5 rounded-md inline-block">{accItem.accessory?.code}</p>
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center justify-end w-full md:w-auto text-right">
                                                                        <div>
                                                                            <p className="text-[10px] font-black uppercase text-muted-foreground/40 tracking-widest mb-1">Qty</p>
                                                                            <p className="text-sm font-black text-brand-navy/80">x{accItem.accessory_quantity}</p>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}

                                                        {item.product && (
                                                            <div className="pt-3 border-t border-brand-navy/[0.04] flex justify-end">
                                                                <div className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-2xl flex items-center gap-4">
                                                                    <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Row Subtotal</span>
                                                                    <span className="text-xl font-black">{prodTotal} DH</span>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            });
                                        })()}
                                    </div>
                                </div>

                                {/* Parcel Tracking History */}
                                <div className="space-y-6 pb-6">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Truck className="w-6 h-6 text-brand-navy/20" />
                                            <h4 className="text-xl font-black text-brand-navy uppercase tracking-[0.15em]">Suivi du Colis</h4>
                                        </div>
                                        {orderParcel?.tracking_code && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => orderParcel && handleTrackParcel(orderParcel)}
                                                disabled={isTrackingLoading}
                                                className="text-xs font-bold text-brand-navy hover:bg-brand-navy/5 gap-2 rounded-xl h-9 px-4"
                                            >
                                                {isTrackingLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCcw className="w-3 h-3" />}
                                                Rafraîchir
                                            </Button>
                                        )}
                                    </div>

                                    {isParcelLoading ? (
                                        <div className="flex flex-col items-center justify-center py-12 gap-4">
                                            <Loader2 className="w-10 h-10 text-brand-navy animate-spin" />
                                            <p className="font-bold text-muted-foreground animate-pulse">Chargement du colis...</p>
                                        </div>
                                    ) : !orderParcel ? (
                                        <div className="text-center p-8 bg-brand-navy/[0.02] rounded-3xl border border-brand-navy/[0.05]">
                                            <p className="text-sm font-bold text-muted-foreground">Aucun colis créé pour cette commande.</p>
                                        </div>
                                    ) : !orderParcel.tracking_code ? (
                                        <div className="text-center p-8 bg-amber-50/50 rounded-3xl border border-amber-100">
                                            <p className="text-sm font-bold text-amber-600">Colis créé mais pas encore de code de suivi.</p>
                                        </div>
                                    ) : isTrackingLoading ? (
                                        <div className="flex flex-col items-center justify-center py-12 gap-4">
                                            <Loader2 className="w-10 h-10 text-brand-navy animate-spin" />
                                            <p className="font-bold text-muted-foreground animate-pulse">Récupération des données...</p>
                                        </div>
                                    ) : trackingHistory ? (
                                        <div className="space-y-8 relative before:absolute before:left-[17px] before:top-2 before:bottom-2 before:w-0.5 before:bg-brand-navy/5">
                                            {(() => {
                                                const events = Array.isArray(trackingHistory)
                                                    ? trackingHistory
                                                    : (trackingHistory?.history || []);
                                                return events;
                                            })().map((event: any, idx: number) => {
                                                const statusMap: Record<string, string> = {
                                                    NEW_PARCEL: 'Nouveau',
                                                    WAITING_PICKUP: 'En attente de ramassage',
                                                    DISTRIBUTION: 'En cours de distribution',
                                                    DELIVERED: 'Livré',
                                                    REFUSED: 'Refusé',
                                                    REFUSE: 'Refusé',
                                                    ANNULE: 'Annulé',
                                                    CANCELLED: 'Annulé',
                                                    RETURNED: 'Retourné',
                                                    RETOUR: 'Retourné',
                                                    POSTPONED: 'Reporté',
                                                    WAITING_PREPARATION: 'En préparation',
                                                    PICKED_UP: 'Ramassé',
                                                    READY_FOR_PICKUP: 'Prêt pour ramassage',
                                                    SENT: 'Expédié',
                                                    RECEIVED: 'Reçu',
                                                    SCHEDULED: 'Programmé',
                                                    PROGRAMMER: 'Programmé',
                                                    NO_ANSWER: 'Pas de réponse',
                                                    RELAUNCH: 'Relancer',
                                                };
                                                
                                                const situationMap: Record<string, { label: string; className: string }> = {
                                                    PAID: { label: 'Payé', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                                                    NOT_PAID: { label: 'Non payé', className: 'bg-amber-50 text-amber-700 border-amber-200' },
                                                    INVOICED: { label: 'Facturé', className: 'bg-blue-50 text-blue-700 border-blue-200' },
                                                };

                                                const rawStatus = (event.status as string) || "Nouveau";
                                                const statusLabel = event.statusLabel as string | undefined;
                                                const status = statusLabel || statusMap[rawStatus] || rawStatus;
                                                const date = event.date as string | undefined;
                                                const comment = (event.comment as string) || "";
                                                const u = event.user;
                                                const user = (typeof u === 'object' && u !== null && 'name' in u
                                                                 ? (u as { name?: string }).name
                                                                 : (u as string | undefined)) || '';
                                                const phone = (event.phone as string) || '';
                                                const hub = (event.hub as string) || '';
                                                const city = (event.city as string) || '';
                                                const situation = (event.situation as string) || '';
                                                const scheduledDate = event.scheduledDate as string | undefined;
                                                const statusColor = (event.color as string) || '';
                                                const dataList = (event.data_list as any[]) || [];
                                                
                                                // Determine location string
                                                const locationParts = [hub, city].filter(Boolean);
                                                const location = locationParts.length > 0 ? locationParts.join(' — ') : '';
                                                
                                                // Filter data_list
                                                const meaningfulDataList = dataList.filter(item => {
                                                    if (!item || !item.title) return false;
                                                    if (item.title === 'Nombre de distributions') return false;
                                                    return true;
                                                });

                                                const sitInfo = situation ? situationMap[situation] : null;

                                                return (
                                                    <div key={idx} className="relative pl-12 group">
                                                        {/* Timeline dot */}
                                                        <div
                                                            className={`absolute left-0 top-1 w-9 h-9 rounded-full border-4 border-white shadow-sm flex items-center justify-center transition-all group-hover:scale-110 z-10 ${
                                                                idx === 0
                                                                    ? 'text-white shadow-brand-navy/20'
                                                                    : 'bg-slate-50 text-brand-navy/40'
                                                            }`}
                                                            style={idx === 0 && statusColor
                                                                ? { backgroundColor: statusColor }
                                                                : idx === 0
                                                                    ? { backgroundColor: 'var(--brand-navy, #1e293b)' }
                                                                    : undefined
                                                            }
                                                        >
                                                            <div className="w-2 h-2 rounded-full bg-current" />
                                                        </div>
                                                        
                                                        <div className="space-y-1.5">
                                                            {/* Status + date row */}
                                                            <div className="flex items-center justify-between gap-2">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <span
                                                                        className={`text-sm font-black tracking-tight ${
                                                                            idx === 0 ? 'text-brand-navy' : 'text-muted-foreground'
                                                                        }`}
                                                                    >
                                                                        {status}
                                                                    </span>
                                                                    {sitInfo && (
                                                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border ${sitInfo.className}`}>
                                                                            {sitInfo.label}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <span className="text-[10px] font-bold text-muted-foreground opacity-60 shrink-0">
                                                                    {date ? format(new Date(date), 'dd/MM/yyyy HH:mm') : ''}
                                                                </span>
                                                            </div>
                                                            
                                                            {/* Location (hub / city) */}
                                                            {location && (
                                                                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground/70">
                                                                    <MapPin className="w-3 h-3 shrink-0" />
                                                                    <span>{location}</span>
                                                                </div>
                                                            )}

                                                            {/* Comment */}
                                                            {comment && (
                                                                <p className="text-[11px] font-medium text-muted-foreground leading-relaxed italic">
                                                                    "{comment}"
                                                                </p>
                                                            )}
                                                            
                                                            {/* Courier info (name + phone) */}
                                                            {(user || phone) && (
                                                                <div className="flex items-center gap-3 flex-wrap">
                                                                    {user && (
                                                                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground">
                                                                            <div className="w-4 h-4 rounded-full bg-slate-100 flex items-center justify-center">
                                                                                <Hash className="w-2 h-2" />
                                                                            </div>
                                                                            Par {user}
                                                                        </div>
                                                                    )}
                                                                    {phone && (
                                                                        <a
                                                                            href={`tel:${phone}`}
                                                                            className="flex items-center gap-1 text-[10px] font-bold text-brand-navy/70 hover:text-brand-navy transition-colors"
                                                                        >
                                                                            <Phone className="w-3 h-3" />
                                                                            {phone}
                                                                        </a>
                                                                    )}
                                                                </div>
                                                            )}
                                                            
                                                            {/* Scheduled date */}
                                                            {scheduledDate && (
                                                                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-blue-600/70">
                                                                    <CalendarClock className="w-3 h-3 shrink-0" />
                                                                    <span>Programmé: {format(new Date(scheduledDate), 'dd/MM/yyyy')}</span>
                                                                </div>
                                                            )}

                                                            {/* Data list items */}
                                                            {meaningfulDataList.length > 0 && (
                                                                <div className="mt-1 space-y-0.5">
                                                                    {meaningfulDataList.map((item, i) => {
                                                                        const isPhone = /^0[5-8]\d{8}$/.test(String(item.value));
                                                                        const isDate = /^\d{4}-\d{2}-\d{2}$/.test(String(item.value));
                                                                        return (
                                                                            <div key={i} className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground/80">
                                                                                <Info className="w-2.5 h-2.5 shrink-0 opacity-50" />
                                                                                <span className="font-semibold">{item.title}:</span>
                                                                                {isPhone ? (
                                                                                    <a href={`tel:${item.value}`} className="text-brand-navy/70 hover:text-brand-navy font-bold transition-colors">
                                                                                        {item.value}
                                                                                    </a>
                                                                                ) : isDate ? (
                                                                                    <span className="text-blue-600/70 font-semibold">{item.value}</span>
                                                                                ) : (
                                                                                    <span className="font-semibold">{item.value}</span>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                                            <div className="p-4 bg-slate-50 rounded-full">
                                                <SearchX className="w-8 h-8 text-muted-foreground/40" />
                                            </div>
                                            <p className="font-bold text-muted-foreground">Aucun historique disponible pour ce colis.</p>
                                        </div>
                                    )}
                                </div>

                                <Separator className="bg-brand-navy/[0.05]" />

                                {/* Status History Timeline */}
                                <div className="space-y-6 pb-6">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <ShieldCheck className="w-6 h-6 text-brand-navy/20" />
                                            <h4 className="text-xl font-black text-brand-navy uppercase tracking-[0.15em]">Status History</h4>
                                        </div>
                                    </div>

                                    <div className="px-4">
                                        {selectedOrder.history && selectedOrder.history.length > 0 ? (
                                            <div className="space-y-6 relative before:absolute before:inset-0 before:ml-2.5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-brand-navy/10 before:to-transparent">
                                                {selectedOrder.history.map((record: any, index: number) => (
                                                    <div key={record.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                                                        <div className="flex items-center justify-center w-6 h-6 rounded-full border-4 border-white bg-brand-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10" style={{ borderColor: record.status?.color || '#eee' }}>
                                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: record.status?.color || '#ccc' }} />
                                                        </div>
                                                        <div className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] p-5 rounded-2xl bg-brand-navy/[0.02] border border-brand-navy/[0.05] shadow-sm flex flex-col gap-2">
                                                            <div className="flex items-center justify-between gap-4">
                                                                <div className="flex items-center gap-2">
                                                                    <Avatar className="w-6 h-6 border bg-white">
                                                                        <AvatarImage src={record.user?.avatar_url} />
                                                                        <AvatarFallback className="text-[10px] font-bold bg-brand-navy/5 text-brand-navy">
                                                                            {record.user?.name?.[0] || '?'}
                                                                        </AvatarFallback>
                                                                    </Avatar>
                                                                    <span className="text-xs font-bold text-brand-navy truncate max-w-[120px]">{record.user?.name || 'Unknown'}</span>
                                                                </div>
                                                                <span className="text-[10px] font-black text-brand-navy/40 uppercase tracking-widest bg-brand-navy/5 px-2 py-1 rounded-lg">
                                                                    {format(new Date(record.created_at), 'MMM d, HH:mm')}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-2 mt-1">
                                                                <span className="text-xs font-black uppercase tracking-widest px-2 py-0.5 rounded-md" style={{ color: record.status?.color, backgroundColor: `${record.status?.color}15` }}>
                                                                    {record.status?.label || 'Unknown Status'}
                                                                </span>
                                                            </div>
                                                            {record.comment && (
                                                                <div className="space-y-2">
                                                                    {(REPORTED_STATUS_ID && (statusCats.isOrderCategory(record.status_id, 'postponed') || record.status_id === REPORTED_STATUS_ID)) ? (
                                                                        <div className="flex flex-col gap-1 p-3 bg-amber-50 rounded-xl border border-amber-100">
                                                                            <div className="flex items-center gap-2">
                                                                                <Calendar className="w-3 h-3 text-amber-600" />
                                                                                <span className="text-[10px] font-black uppercase text-amber-700">Rappel Programmé</span>
                                                                            </div>
                                                                            <p className="text-xs font-bold text-amber-900">
                                                                                {record.comment.includes('[Reporté pour:')
                                                                                    ? record.comment.match(/\[Reporté pour: (.*?)\]/)?.[1]
                                                                                    : selectedOrder.reported_date ? format(new Date(selectedOrder.reported_date), 'dd/MM/yyyy HH:mm') : 'Date non spécifiée'}
                                                                            </p>
                                                                            <p className="text-sm font-medium text-amber-800 italic mt-1 border-t border-amber-500/10 pt-1">
                                                                                "{record.comment.replace(/\[Reporté pour:.*?\]/, '').trim()}"
                                                                            </p>
                                                                        </div>
                                                                    ) : (
                                                                        <p className="text-sm font-medium text-brand-navy/80 mt-2 p-3 bg-white rounded-xl border border-brand-navy/[0.03] italic">
                                                                            "{record.comment}"
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="text-center p-8 bg-brand-navy/[0.02] rounded-3xl border border-brand-navy/[0.05]">
                                                <p className="text-sm font-bold text-muted-foreground">No tracking history available yet.</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <DialogFooter className="p-8 pb-10 flex gap-4 bg-brand-white border-t border-brand-navy/[0.03]">
                                <Button
                                    onClick={() => handleEdit(selectedOrder)}
                                    className="flex-1 bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-3xl h-16 text-lg font-black shadow-2xl transition-all active:scale-95 flex items-center justify-center gap-3"
                                >
                                    <Edit2 className="w-6 h-6" /> Edit Sales Order
                                </Button>
                                <Button
                                    onClick={() => setIsViewModalOpen(false)}
                                    variant="ghost"
                                    className="rounded-3xl h-16 px-10 font-bold text-brand-navy hover:bg-muted"
                                >
                                    Done
                                </Button>
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
                <DialogContent className="max-w-[min(100vw-2rem,40rem)] p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col">
                    <DialogHeader className="p-6 sm:p-8 pb-4 shrink-0 border-b border-brand-navy/[0.05]">
                        <DialogTitle className="text-2xl font-black text-brand-navy">Reported Action</DialogTitle>
                        <DialogDescription className="text-sm font-bold text-muted-foreground">
                            Please provide the scheduled date and time.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="p-6 sm:p-8 flex flex-col md:flex-row gap-6 md:gap-8 md:items-start">
                        <div className="space-y-2 flex flex-col shrink-0 md:max-w-[min(100%,280px)]">
                            <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Date</label>
                            <CalendarComponent
                                mode="single"
                                selected={reportedData.date}
                                onSelect={(d) => setReportedData(prev => ({ ...prev, date: d }))}
                                initialFocus
                                className="rounded-2xl border-none shadow-inner bg-brand-navy/[0.02] w-full p-2"
                            />
                        </div>
                        <div className="flex flex-col gap-4 flex-1 min-w-0 min-h-0">
                            <div className="space-y-2">
                                <label className="text-[10px] flex font-black uppercase tracking-wider text-muted-foreground/70">Time</label>
                                <div className="relative">
                                    <Clock className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-brand-navy/30 pointer-events-none" />
                                    <Input
                                        type="time"
                                        value={reportedData.time}
                                        onChange={(e) => setReportedData(prev => ({ ...prev, time: e.target.value }))}
                                        className="h-14 pl-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner w-full"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2 flex flex-col flex-1 min-h-[120px]">
                                <label className="text-[10px] flex font-black uppercase tracking-wider text-muted-foreground/70">Comment (Optional)</label>
                                <Textarea
                                    value={reportedData.comment}
                                    onChange={(e) => setReportedData(prev => ({ ...prev, comment: e.target.value }))}
                                    placeholder="Add a note why it was reported..."
                                    className="resize-none rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner flex-1 min-h-[120px] md:min-h-[200px]"
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter className="p-8 pt-4 border-t border-brand-navy/[0.05] bg-brand-navy/[0.01]">
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
                            className="bg-brand-navy text-white hover:bg-brand-navy/90 h-12 rounded-2xl font-bold px-8 shadow-xl shadow-brand-navy/20"
                        >
                            Confirm Action
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

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
    );
};

export default Orders;
