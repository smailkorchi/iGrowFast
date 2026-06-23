import React, { useState, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { useCurrentUserId } from '@/hooks/useCurrentUserId';
import {
    Plus,
    Search,
    MoreVertical,
    Edit2,
    Trash2,
    Loader2,
    Calendar,
    Megaphone,
    ArrowUpRight,
    Target,
    BarChart3,
    Package,
    Layout,
    AlertTriangle,
    DollarSign,
    ShieldCheck,
    Lock,
    X,
    Sparkles,
    Coins,
    Check,
    ChevronsUpDown,
    ImageOff,
    type LucideIcon,
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
} from '@/components/ui/form';
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
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn } from '@/lib/utils';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { format, differenceInDays } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";

import { useStatusCategories } from '@/hooks/useStatusCategories';
import { useTrackedOrders } from '@/hooks/useTrackedOrders';
import { isDeliveredForCommission } from '@/lib/commercialCommission';
import { isAdminPullback } from '@/lib/analyticsDefinitions';
import {
    FaWhatsapp,
    FaInstagram,
    FaFacebook,
    FaGoogle,
    FaTiktok,
    FaSnapchatGhost,
    FaTwitter,
    FaPinterest,
    FaReddit,
    FaMicrosoft,
    FaBullseye
} from 'react-icons/fa';
import { SiMessenger } from 'react-icons/si';

const getPlatformIcon = (platformName: string) => {
    switch (platformName.toLowerCase()) {
        case "whatsapp ads": return <FaWhatsapp className="w-4 h-4" />;
        case "messenger ads": return <SiMessenger className="w-4 h-4" />;
        case "instagram ads": return <FaInstagram className="w-4 h-4" />;
        case "facebook ads": return <FaFacebook className="w-4 h-4" />;
        case "google ads": return <FaGoogle className="w-4 h-4" />;
        case "tiktok ads": return <FaTiktok className="w-4 h-4" />;
        case "snapchat ads": return <FaSnapchatGhost className="w-4 h-4" />;
        case "twitter ads": return <FaTwitter className="w-4 h-4" />;
        case "pinterest ads": return <FaPinterest className="w-4 h-4" />;
        case "reddit ads": return <FaReddit className="w-4 h-4" />;
        case "bing ads": return <FaMicrosoft className="w-4 h-4" />;
        case "native ads": return <FaBullseye className="w-4 h-4" />;
        default: return <Megaphone className="w-4 h-4" />;
    }
};

const PLATFORM_SOURCE_MAP: Record<string, string> = {
    "whatsapp ads": "whatsapp",
    "messenger ads": "messenger",
    "instagram ads": "instagram",
    "facebook ads": "facebook",
    "google ads": "google",
    "tiktok ads": "tiktok",
    "native ads": "native",
    "snapchat ads": "snapchat",
    "twitter ads": "twitter",
    "bing ads": "bing",
    "pinterest ads": "pinterest",
    "reddit ads": "reddit",
};

const adsHistorySchema = z.object({
    product_id: z.string().uuid("Please select a product"),
    method: z.string().min(1, "Please select a platform"),
    amount: z.coerce.number().min(0.01, "Amount must be greater than 0"),
    start_date: z.date(),
    end_date: z.date(),
}).refine(data => data.end_date >= data.start_date, {
    message: "End date must be after start date",
    path: ["end_date"],
});

type AdsHistoryValues = z.infer<typeof adsHistorySchema>;

const PLATFORMS = [
    "Whatsapp ads",
    "Messenger ads",
    "Instagram ads",
    "Facebook ads",
    "Google ads",
    "Tiktok ads",
    "Native ads",
    "Snapchat ads",
    "Twitter ads",
    "Bing ads",
    "pinterest ads",
    "Reddit ads"
];

interface CampaignMetrics {
    days: number;
    dailySpend: number;
    totalOrders: number;
    confirmedOrders: number;
    deliveredOrders: number;
    cancelledOrders: number;
    fakeOrders: number;
    confirmRate: number;
    deliveryRate: number;
    fulfillmentRate: number;
    cpa: number;
    cpc: number;
    cpd: number;
    grossRevenue: number;
    cogs: number;
    shippingCosts: number;
    netRevenue: number;
    profit: number;
    roas: number;
    trueRoas: number;
    profitMargin: number;
    cancelRate: number;
    fakeRate: number;
    wastedSpend: number;
    qualityScore: number;
}

const ADS_KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

interface AdsKpiProps {
    label: string;
    value: string;
    suffix: string;
    accent: keyof typeof ADS_KPI_ACCENTS;
    icon: LucideIcon | React.ReactNode;
}

const AdsKpi: React.FC<AdsKpiProps> = ({ label, value, suffix, accent, icon }) => {
    const a = ADS_KPI_ACCENTS[accent];
    const renderedIcon = React.isValidElement(icon)
        ? icon
        : (() => {
              const Icon = icon as LucideIcon;
              return <Icon className="w-4 h-4" strokeWidth={1.75} />;
          })();
    return (
        <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid truncate">
                    <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', a.dot)} />
                    <span className="truncate">{label}</span>
                </div>
                <div className={cn('h-8 w-8 rounded-lg border flex items-center justify-center shrink-0', a.tile)}>
                    {renderedIcon}
                </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                {value}
                <span className="text-[12px] text-ant-mid font-normal ml-1.5">{suffix}</span>
            </p>
        </div>
    );
};

type ProductOption = {
    id: string;
    name: string;
    code?: string | null;
    image_url?: string | null;
};

const ProductThumb: React.FC<{ src?: string | null; alt: string; size?: number }> = ({ src, alt, size = 24 }) => {
    const [failed, setFailed] = React.useState(false);
    return (
        <div
            className="shrink-0 overflow-hidden rounded-md bg-ant-ink/[0.06] ring-1 ring-inset ring-ant-ink/10 flex items-center justify-center text-ant-mid"
            style={{ width: size, height: size }}
        >
            {src && !failed ? (
                <img
                    src={src}
                    alt={alt}
                    loading="lazy"
                    className="h-full w-full object-cover"
                    onError={() => setFailed(true)}
                />
            ) : (
                <ImageOff className="h-3 w-3" />
            )}
        </div>
    );
};

interface ProductComboboxProps {
    products: ProductOption[] | undefined;
    value: string | undefined;
    onChange: (id: string) => void;
}

const ProductCombobox: React.FC<ProductComboboxProps> = ({ products, value, onChange }) => {
    const [open, setOpen] = React.useState(false);
    const [search, setSearch] = React.useState('');
    const list = products ?? [];
    const selected = value ? list.find((p) => p.id === value) : undefined;

    const filtered = React.useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return list;
        return list.filter((p) => {
            const name = (p.name || '').toLowerCase();
            const code = (p.code || '').toLowerCase();
            return name.includes(q) || code.includes(q);
        });
    }, [list, search]);

    return (
        <Popover
            open={open}
            onOpenChange={(o) => {
                setOpen(o);
                if (!o) setSearch('');
            }}
        >
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className={cn(
                        'h-10 w-full justify-between rounded-xl border-ant-line bg-ant-paper px-2.5 text-left text-[12px] font-medium text-ant-ink hover:bg-ant-light hover:text-ant-ink',
                        !selected && 'text-ant-mid hover:text-ant-mid'
                    )}
                >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                        {selected ? (
                            <>
                                <ProductThumb src={selected.image_url} alt={selected.name} size={24} />
                                <span className="truncate">{selected.name}</span>
                            </>
                        ) : (
                            <span>Select product</span>
                        )}
                    </span>
                    <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 text-ant-mid" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="w-[var(--radix-popover-trigger-width)] min-w-[260px] p-0 rounded-xl border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)] overflow-hidden"
                align="start"
                onWheel={(e) => e.stopPropagation()}
            >
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder="Search by name or SKU…"
                        className="h-10 text-[12px]"
                        value={search}
                        onValueChange={setSearch}
                    />
                    <CommandList className="max-h-[280px]">
                        <CommandEmpty className="py-6 text-center text-[11px] font-medium text-ant-mid">
                            No product found.
                        </CommandEmpty>
                        <CommandGroup className="p-1">
                            {filtered.map((p) => {
                                const isSelected = selected?.id === p.id;
                                return (
                                    <CommandItem
                                        key={p.id}
                                        value={`${p.name} ${p.code ?? ''} ${p.id}`}
                                        onSelect={() => {
                                            onChange(p.id);
                                            setOpen(false);
                                        }}
                                        className={cn(
                                            'cursor-pointer rounded-lg px-2 py-1.5 my-0.5 data-[selected=true]:bg-ant-ink/[0.05]',
                                            isSelected && 'bg-ant-ink/[0.05]'
                                        )}
                                    >
                                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                                            <ProductThumb src={p.image_url} alt={p.name} size={32} />
                                            <div className="flex min-w-0 flex-1 flex-col">
                                                <span className="truncate text-[12px] font-medium text-ant-ink">
                                                    {p.name}
                                                </span>
                                                {p.code && (
                                                    <span className="truncate text-[10px] font-medium uppercase tracking-wider text-ant-mid">
                                                        SKU {p.code}
                                                    </span>
                                                )}
                                            </div>
                                            {isSelected && (
                                                <Check className="h-3.5 w-3.5 shrink-0 text-ant-ink/60" />
                                            )}
                                        </div>
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
};

const AdsHistory = () => {
    const { cancelledIds, deliveredPkgIds, pendingIds, adminPullbackOrderIds, adminPullbackPackageIds, getOrderCategory } = useStatusCategories();
    const activeBusinessIdForTracking = typeof localStorage !== 'undefined' ? localStorage.getItem('activeBusinessId') : null;
    const { trackedOrderIds } = useTrackedOrders(activeBusinessIdForTracking);
    const location = useLocation();
    const currentUserId = useCurrentUserId();

    const isMediaBuyerView = location.pathname.startsWith('/mediabuyer');

    const [isUpsertOpen, setIsUpsertOpen] = useState(false);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);
    const [selectedHistory, setSelectedHistory] = useState<any>(null);
    const [editingHistory, setEditingHistory] = useState<any>(null);
    const [historyToDelete, setHistoryToDelete] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");

    const { toast } = useToast();
    const queryClient = useQueryClient();

    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const { data: adsHistory, isLoading } = useQuery({
        queryKey: ['ads_history', activeBusinessId, isMediaBuyerView, currentUserId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            let query = (supabase as any)
                .from('ads_history')
                .select('*, products(id, name, code, image_url)')
                .eq('DigiCom Business', activeBusinessId)
                .order('start_date', { ascending: false });
            if (isMediaBuyerView && currentUserId) {
                query = query.eq('created_by', currentUserId);
            }
            const { data, error } = await query;
            if (error) throw error;
            return data;
        },
        enabled: !!activeBusinessId && (!isMediaBuyerView || !!currentUserId),
    });

    const { data: creators = [] } = useQuery({
        queryKey: ['ads_history-creators', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, avatar_url, avatar_config, role')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return (data || []) as Array<{ id: string; name: string | null; avatar_url: string | null; avatar_config?: unknown; role: string | null }>;
        },
        enabled: !!activeBusinessId && !isMediaBuyerView,
    });

    const creatorById = useMemo(() => {
        const map = new Map<string, { id: string; name: string | null; avatar_url: string | null; avatar_config?: unknown; role: string | null }>();
        for (const u of creators) map.set(u.id, u);
        return map;
    }, [creators]);

    const canEditRow = (row: any): boolean => {
        if (!currentUserId) return false;
        if (row.created_by == null) return !isMediaBuyerView;
        return row.created_by === currentUserId;
    };

    const { data: products } = useQuery({
        queryKey: ['products', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('products')
                .select('id, name, code, image_url')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId)
                .order('name');
            if (error) throw error;
            return data;
        }
    });

    const { data: allOrders } = useQuery({
        queryKey: ['orders-for-ads', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            // Paginated so we never truncate at the 1000-row default cap.
            return await fetchAllRows(
                'orders',
                'id, date, source_name, price, shipping_cost, package_status_id, order_status_id, package_status_label, order_statuses(code), package_statuses(label), order_items(product_id, unit_price, quantity)',
                {
                    filters: [
                        { column: 'DigiCom Business', op: 'eq', value: activeBusinessId },
                        { column: 'date_deleted', op: 'is', value: null },
                    ],
                }
            );
        }
    });

    const { data: productCosts } = useQuery({
        queryKey: ['product-costs', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('products')
                .select('id, cost_price, selling_price')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const getCampaignMetrics = useMemo(() => {
        return (campaign: any): CampaignMetrics | null => {
            if (!campaign || !allOrders) return null;

            const adSpend = Number(campaign.amount);
            const days = differenceInDays(new Date(campaign.end_date), new Date(campaign.start_date)) + 1;
            const sourceName = PLATFORM_SOURCE_MAP[campaign.method.toLowerCase()] || '';
            const startDate = new Date(campaign.start_date);
            const endDate = new Date(campaign.end_date);
            endDate.setHours(23, 59, 59, 999);

            const matchedOrders = allOrders.filter((o: any) => {
                const orderDate = new Date(o.date);
                const inDateRange = orderDate >= startDate && orderDate <= endDate;
                const matchesSource = sourceName && (o.source_name || '').toLowerCase() === sourceName;
                const hasProduct = o.order_items?.some((item: any) => item.product_id === campaign.product_id);
                return inDateRange && matchesSource && hasProduct;
            });

            const totalOrders = matchedOrders.length;
            let deliveredOrders = 0;
            let cancelledOrders = 0;
            let fakeOrders = 0;
            let grossRevenue = 0;
            let shippingCosts = 0;
            // Confirmed = the one true definition: has tracking_number OR
            // status is anything except `new`/`callback`. Touched = cohort
            // minus orders sitting fresh at `new`.
            let confirmedOrders = 0;
            let rateTouchedOrders = 0;
            // Coliaty delivery-rate denominator: tracked minus admin-pullback.
            let trackedOrdersCount = 0;
            let pullbackOrdersCount = 0;

            matchedOrders.forEach((o: any) => {
                const isDelivered = isDeliveredForCommission(o, deliveredPkgIds);
                const orderCat = getOrderCategory(o.order_status_id);
                const sid = o.order_status_id;
                // `orders.tracking_number` is never populated; the authoritative
                // tracking source is company_parcels/courier_parcels, which
                // `trackedOrderIds` already aggregates.
                const hasTracking = !!o.id && trackedOrderIds.has(o.id);

                if (isDelivered) {
                    deliveredOrders++;
                    grossRevenue += Number(o.price) || 0;
                    shippingCosts += Number(o.shipping_cost) || 0;
                } else if (sid && cancelledIds.has(sid)) {
                    if (orderCat === 'fake' || orderCat === 'double') {
                        fakeOrders++;
                    } else {
                        cancelledOrders++;
                    }
                }

                // Confirmed = tracking OR status NOT in pending (new+postponed).
                // Denominator = total filtered orders (rate = confirmed / total).
                // Empty-set guard: see analyticsDefinitions.isRateConfirmed.
                rateTouchedOrders++;
                const statusMapsReady = pendingIds.size > 0;
                if (hasTracking || (statusMapsReady && sid && !pendingIds.has(sid))) {
                    confirmedOrders++;
                }

                // Coliaty delivery denominator = tracked − admin-pullback.
                if (!!o.id && trackedOrderIds.has(o.id)) {
                    trackedOrdersCount++;
                    if (isAdminPullback(o, true, adminPullbackOrderIds, adminPullbackPackageIds)) {
                        pullbackOrdersCount++;
                    }
                }
            });
            const deliveryDenomOrders = trackedOrdersCount - pullbackOrdersCount;

            const productCost = productCosts?.find((p: any) => p.id === campaign.product_id);
            const costPrice = Number(productCost?.cost_price || 0);
            const cogs = deliveredOrders * costPrice;
            const netRevenue = grossRevenue - cogs - shippingCosts;
            const profit = netRevenue - adSpend;

            return {
                days,
                dailySpend: days > 0 ? adSpend / days : 0,
                totalOrders,
                confirmedOrders,
                deliveredOrders,
                cancelledOrders,
                fakeOrders,
                confirmRate: rateTouchedOrders > 0 ? (confirmedOrders / rateTouchedOrders) * 100 : 0,
                deliveryRate: deliveryDenomOrders > 0 ? (deliveredOrders / deliveryDenomOrders) * 100 : 0,
                fulfillmentRate: totalOrders > 0 ? (deliveredOrders / totalOrders) * 100 : 0,
                cpa: totalOrders > 0 ? adSpend / totalOrders : 0,
                cpc: confirmedOrders > 0 ? adSpend / confirmedOrders : 0,
                cpd: deliveredOrders > 0 ? adSpend / deliveredOrders : 0,
                grossRevenue,
                cogs,
                shippingCosts,
                netRevenue,
                profit,
                roas: adSpend > 0 ? grossRevenue / adSpend : 0,
                trueRoas: adSpend > 0 ? netRevenue / adSpend : 0,
                profitMargin: grossRevenue > 0 ? (profit / grossRevenue) * 100 : 0,
                cancelRate: totalOrders > 0 ? (cancelledOrders / totalOrders) * 100 : 0,
                fakeRate: totalOrders > 0 ? (fakeOrders / totalOrders) * 100 : 0,
                wastedSpend: totalOrders > 0 ? adSpend * (1 - (deliveredOrders / totalOrders)) : adSpend,
                qualityScore: totalOrders > 0 ? (deliveredOrders / totalOrders) * 100 : 0,
            };
        };
    }, [allOrders, productCosts, cancelledIds, deliveredPkgIds, pendingIds, adminPullbackOrderIds, adminPullbackPackageIds, trackedOrderIds, getOrderCategory]);

    const form = useForm<AdsHistoryValues>({
        resolver: zodResolver(adsHistorySchema),
        defaultValues: {
            product_id: '',
            method: '',
            amount: 0,
            start_date: new Date(),
            end_date: new Date(),
        }
    });

    const upsertMutation = useMutation({
        mutationFn: async (values: AdsHistoryValues) => {
            if (editingHistory && !canEditRow(editingHistory)) {
                throw new Error('You can only edit campaigns you created');
            }

            const basePayload = {
                product_id: values.product_id,
                method: values.method,
                amount: values.amount,
                'DigiCom Business': activeBusinessId,
                start_date: format(values.start_date, 'yyyy-MM-dd'),
                end_date: format(values.end_date, 'yyyy-MM-dd'),
            };

            if (editingHistory) {
                const { data, error } = await (supabase as any)
                    .from('ads_history')
                    .update(basePayload)
                    .eq('id', editingHistory.id)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            } else {
                const payload = { ...basePayload, created_by: currentUserId };
                const { data, error } = await (supabase as any)
                    .from('ads_history')
                    .insert(payload)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['ads_history', activeBusinessId] });
            setIsUpsertOpen(false);
            setEditingHistory(null);
            toast({
                title: editingHistory ? "Campaign updated" : "Campaign logged",
                description: "Metrics will auto-calculate from your order data."
            });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (row: any) => {
            if (!canEditRow(row)) {
                throw new Error('You can only delete campaigns you created');
            }
            const { error } = await (supabase as any)
                .from('ads_history')
                .delete()
                .eq('id', row.id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['ads_history'] });
            setHistoryToDelete(null);
            toast({ title: "Record deleted", description: "The ads history record was removed." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const handleUpsert = (values: AdsHistoryValues) => {
        upsertMutation.mutate(values);
    };

    const openUpsert = (history: any = null) => {
        if (history) {
            setEditingHistory(history);
            form.reset({
                product_id: history.product_id,
                method: history.method,
                amount: history.amount,
                start_date: new Date(history.start_date),
                end_date: new Date(history.end_date),
            });
        } else {
            setEditingHistory(null);
            form.reset({
                product_id: '',
                method: '',
                amount: 0,
                start_date: new Date(),
                end_date: new Date(),
            });
        }
        setIsUpsertOpen(true);
    };

    const openDetails = (history: any) => {
        setSelectedHistory(history);
        setIsDetailsOpen(true);
    };

    const filteredHistory = adsHistory?.filter((h: any) =>
        h.products?.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        h.method.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const fmtNum = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n));
    const fmtDec = (n: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

    const getHealthTone = (value: number, thresholds: { green: number; amber: number }) => {
        if (value >= thresholds.green) return 'text-ant-green';
        if (value >= thresholds.amber) return 'text-ant-orange';
        return 'text-ant-rose';
    };

    const getHealthPill = (value: number, thresholds: { green: number; amber: number }) => {
        if (value >= thresholds.green) return 'bg-ant-green/10 border-ant-green/25 text-ant-green';
        if (value >= thresholds.amber) return 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange';
        return 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose';
    };

    const totalSpend: number = (filteredHistory || []).reduce(
        (s: number, h: any) => s + Number(h.amount || 0),
        0
    );
    const platformTotals: Record<string, number> = (filteredHistory || []).reduce(
        (acc: Record<string, number>, h: any) => {
            const key = (h.method as string) || 'Other';
            acc[key] = (acc[key] || 0) + Number(h.amount || 0);
            return acc;
        },
        {} as Record<string, number>
    );
    const topPlatforms: Array<[string, number]> = Object.entries(platformTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Marketing · Attribution
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Product Ads
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Every platform, every spend, every product — cross-referenced against orders to show which campaigns actually moved the needle.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <div className="relative w-full md:w-[240px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                            <Input
                                placeholder="Search campaigns..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                            />
                        </div>
                        <Button
                            onClick={() => openUpsert()}
                            className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                        >
                            <Plus className="w-4 h-4" />
                            Log campaign
                        </Button>
                    </div>
                </header>

                {/* KPI strip */}
                <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                    <AdsKpi
                        label="Total spend"
                        value={fmtNum(totalSpend)}
                        suffix="DH"
                        accent="rose"
                        icon={Coins}
                    />
                    {topPlatforms.map(([platform, spend], i) => {
                        const accent: keyof typeof ADS_KPI_ACCENTS = i === 0 ? 'orange' : i === 1 ? 'green' : 'ink';
                        return (
                            <AdsKpi
                                key={platform}
                                label={platform}
                                value={fmtNum(spend)}
                                suffix="DH"
                                accent={accent}
                                icon={<span className="text-ant-ink">{getPlatformIcon(platform)}</span>}
                            />
                        );
                    })}
                    {topPlatforms.length < 3 && Array.from({ length: 3 - topPlatforms.length }).map((_, i) => (
                        <div key={`empty-${i}`} className="bg-ant-paper p-4 opacity-40">
                            <div className="flex items-start justify-between gap-3">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-line" />
                                    No data
                                </div>
                                <div className="h-8 w-8 rounded-lg border border-ant-line flex items-center justify-center">
                                    <Megaphone className="w-4 h-4 text-ant-mid" strokeWidth={1.5} />
                                </div>
                            </div>
                            <p className="font-display text-[22px] font-semibold text-ant-mid/40 tabular-nums mt-2">—</p>
                        </div>
                    ))}
                </section>

                {/* Campaign cards */}
                {isLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <Skeleton key={i} className="h-48 w-full rounded-2xl" />
                        ))}
                    </div>
                ) : filteredHistory?.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                        <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                            <Megaphone className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                        </div>
                        <h3 className="font-display text-[18px] text-ant-ink tracking-tight">No campaigns logged yet</h3>
                        <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                            Log the first campaign — spend, product and dates. Metrics auto-calculate from your order data.
                        </p>
                        <Button
                            onClick={() => openUpsert()}
                            className="mt-5 bg-ant-ink hover:bg-ant-ink/90 text-white h-9 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                        >
                            <Plus className="w-4 h-4" />
                            Log first campaign
                        </Button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {filteredHistory?.map((h: any) => {
                            const m = getCampaignMetrics(h);
                            const canEdit = canEditRow(h);
                            const creator = h.created_by ? creatorById.get(h.created_by) : null;
                            const profitPositive = m && m.profit > 0;
                            const profitNegative = m && m.profit < 0;
                            const stripe = profitPositive ? 'bg-ant-green' : profitNegative ? 'bg-ant-rose' : 'bg-ant-line';
                            return (
                                <div
                                    key={h.id}
                                    onClick={() => openDetails(h)}
                                    className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper cursor-pointer hover:border-ant-ink/20 hover:shadow-[0_16px_48px_-20px_rgba(20,20,19,0.15)] transition-all"
                                >
                                    <div className={cn('h-[3px] w-full', stripe)} />
                                    <div className="p-4 space-y-3">
                                        <div className="flex justify-between items-start gap-2">
                                            <div className="flex gap-3 items-start min-w-0">
                                                {h.products?.image_url ? (
                                                    <img src={h.products.image_url} alt={h.products.name || 'product'} className="w-11 h-11 rounded-xl object-cover border border-ant-line shrink-0" />
                                                ) : (
                                                    <div className="w-11 h-11 bg-ant-light border border-ant-line rounded-xl flex items-center justify-center shrink-0">
                                                        <Package className="w-4 h-4 text-ant-mid" />
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5 text-ant-ink mb-1">
                                                        <span className="text-ant-mid">{getPlatformIcon(h.method)}</span>
                                                        <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-ink">
                                                            {h.method}
                                                        </span>
                                                    </div>
                                                    <h3 className="font-display text-[14px] font-semibold text-ant-ink line-clamp-1">{h.products?.name}</h3>
                                                    {!isMediaBuyerView && (
                                                        <span className="text-[10px] text-ant-mid truncate block mt-0.5 font-serif italic">
                                                            by {creator?.name || (h.created_by ? 'Unknown' : 'Admin · legacy')}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            {canEdit ? (
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-ant-ink/5 text-ant-mid shrink-0 cursor-pointer">
                                                            <MoreVertical className="w-3.5 h-3.5" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="rounded-xl border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)] p-1 min-w-[150px]">
                                                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openUpsert(h); }} className="rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium gap-2 text-ant-ink">
                                                            <Edit2 className="w-3.5 h-3.5 text-ant-orange" /> Edit
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator className="my-1 bg-ant-line" />
                                                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setHistoryToDelete(h); }} className="rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium gap-2 text-ant-rose focus:text-ant-rose focus:bg-ant-rose/10">
                                                            <Trash2 className="w-3.5 h-3.5" /> Delete
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            ) : (
                                                <div
                                                    className="inline-flex items-center gap-1 px-2 h-6 rounded-full border border-ant-line bg-ant-light text-ant-mid shrink-0"
                                                    title="Read only"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <Lock className="w-2.5 h-2.5" />
                                                    <span className="text-[9px] font-semibold uppercase tracking-[0.14em]">Read only</span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="grid grid-cols-4 gap-2 pt-2 border-t border-ant-line">
                                            {[
                                                { label: 'Spend', value: fmtNum(Number(h.amount)), color: 'text-ant-ink' },
                                                { label: 'Orders', value: m?.totalOrders ?? '—', color: 'text-ant-ink' },
                                                { label: 'Delivered', value: m?.deliveredOrders ?? '—', color: 'text-ant-green' },
                                                { label: 'CPD', value: m && m.cpd > 0 ? fmtDec(m.cpd) : '—', color: m && m.cpd > 0 ? getHealthTone(m.roas, { green: 1, amber: 0.5 }) : 'text-ant-mid' },
                                            ].map((item) => (
                                                <div key={item.label} className="space-y-0.5">
                                                    <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-ant-mid">{item.label}</p>
                                                    <p className={cn('font-display text-[15px] font-semibold tabular-nums', item.color)}>{item.value}</p>
                                                </div>
                                            ))}
                                        </div>

                                        {m && m.totalOrders > 0 && (
                                            <div className="space-y-1.5">
                                                <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.24em] text-ant-mid">
                                                    <span>Funnel</span>
                                                    <span className="tabular-nums">{m.fulfillmentRate.toFixed(0)}% fulfilled</span>
                                                </div>
                                                <div className="h-1.5 bg-ant-line rounded-full overflow-hidden flex">
                                                    <div className="bg-ant-green rounded-full transition-all" style={{ width: `${m.fulfillmentRate}%` }} />
                                                    <div className="bg-ant-orange/50 rounded-full transition-all" style={{ width: `${Math.max(0, m.confirmRate - m.fulfillmentRate)}%` }} />
                                                </div>
                                            </div>
                                        )}

                                        <div className="flex items-center justify-between pt-2 border-t border-ant-line">
                                            <div className="flex items-center gap-1.5 text-ant-mid">
                                                <Calendar className="w-3 h-3" />
                                                <span className="text-[11px] font-medium tabular-nums">{format(new Date(h.start_date), 'MMM d')} – {format(new Date(h.end_date), 'MMM d')}</span>
                                            </div>
                                            {m && m.profit !== 0 && (
                                                <div className={cn(
                                                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums',
                                                    m.profit > 0 ? 'bg-ant-green/10 border-ant-green/25 text-ant-green' : 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose'
                                                )}>
                                                    {m.profit > 0 ? <ArrowUpRight className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                                                    {m.profit > 0 ? '+' : ''}{fmtNum(m.profit)} DH
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Upsert Modal */}
                <Dialog open={isUpsertOpen} onOpenChange={setIsUpsertOpen}>
                    <DialogContent className="max-w-lg p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(handleUpsert)}>
                                <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                        {editingHistory ? 'Edit · Campaign' : 'New · Campaign'}
                                    </div>
                                    <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">
                                        {editingHistory ? 'Update campaign' : 'Log a new campaign'}
                                    </DialogTitle>
                                    <DialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                        Platform, product, dates and spend — metrics auto-calculate from your order data.
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto ant-scroll">
                                    <div className="grid grid-cols-2 gap-3">
                                        <FormField
                                            control={form.control}
                                            name="product_id"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Product</FormLabel>
                                                    <FormControl>
                                                        <ProductCombobox
                                                            products={products as ProductOption[] | undefined}
                                                            value={field.value}
                                                            onChange={field.onChange}
                                                        />
                                                    </FormControl>
                                                    <FormMessage className="text-ant-rose" />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="method"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Platform</FormLabel>
                                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                        <FormControl>
                                                            <SelectTrigger className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] font-medium text-ant-ink">
                                                                <SelectValue placeholder="Select platform" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent className="rounded-xl border-ant-line">
                                                            {PLATFORMS.map((p) => (
                                                                <SelectItem key={p} value={p} className="text-[12px]">
                                                                    <span className="inline-flex items-center gap-2">
                                                                        <span className="text-ant-mid">{getPlatformIcon(p)}</span>
                                                                        {p}
                                                                    </span>
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    <FormMessage className="text-ant-rose" />
                                                </FormItem>
                                            )}
                                        />
                                    </div>

                                    <FormField
                                        control={form.control}
                                        name="amount"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Total ad spend · DH</FormLabel>
                                                <FormControl>
                                                    <Input type="number" step="0.01" placeholder="0" {...field} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[13px] font-semibold text-ant-ink tabular-nums" />
                                                </FormControl>
                                                <FormMessage className="text-ant-rose" />
                                            </FormItem>
                                        )}
                                    />

                                    <div className="grid grid-cols-2 gap-3">
                                        <FormField
                                            control={form.control}
                                            name="start_date"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-col space-y-1.5">
                                                    <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Start date</FormLabel>
                                                    <Popover>
                                                        <PopoverTrigger asChild>
                                                            <FormControl>
                                                                <Button
                                                                    variant="outline"
                                                                    className={cn(
                                                                        'h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] font-medium text-ant-ink text-left justify-start hover:bg-ant-light',
                                                                        !field.value && 'text-ant-mid'
                                                                    )}
                                                                >
                                                                    {field.value ? format(field.value, 'PP') : <span>Pick a date</span>}
                                                                    <Calendar className="ml-auto h-3.5 w-3.5 text-ant-mid" />
                                                                </Button>
                                                            </FormControl>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="ant-calendar w-auto p-0 rounded-xl overflow-hidden border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)]" align="start">
                                                            <CalendarComponent mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                                                        </PopoverContent>
                                                    </Popover>
                                                    <FormMessage className="text-ant-rose" />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="end_date"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-col space-y-1.5">
                                                    <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">End date</FormLabel>
                                                    <Popover>
                                                        <PopoverTrigger asChild>
                                                            <FormControl>
                                                                <Button
                                                                    variant="outline"
                                                                    className={cn(
                                                                        'h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] font-medium text-ant-ink text-left justify-start hover:bg-ant-light',
                                                                        !field.value && 'text-ant-mid'
                                                                    )}
                                                                >
                                                                    {field.value ? format(field.value, 'PP') : <span>Pick a date</span>}
                                                                    <Calendar className="ml-auto h-3.5 w-3.5 text-ant-mid" />
                                                                </Button>
                                                            </FormControl>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="ant-calendar w-auto p-0 rounded-xl overflow-hidden border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)]" align="start">
                                                            <CalendarComponent mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                                                        </PopoverContent>
                                                    </Popover>
                                                    <FormMessage className="text-ant-rose" />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </div>

                                <DialogFooter className="px-6 py-4 border-t border-ant-line gap-2">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => setIsUpsertOpen(false)}
                                        className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        type="submit"
                                        disabled={upsertMutation.isPending}
                                        className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                                    >
                                        {upsertMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                        <Sparkles className="w-3.5 h-3.5" />
                                        {editingHistory ? 'Save changes' : 'Log campaign'}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </Form>
                    </DialogContent>
                </Dialog>

                {/* Details Modal */}
                <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
                    <DialogContent className="max-w-4xl p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden max-h-[92vh] flex flex-col">
                        {selectedHistory && (() => {
                            const m = getCampaignMetrics(selectedHistory);
                            return (
                                <div className="flex flex-col flex-1 overflow-hidden">
                                    <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line shrink-0">
                                        <div className="flex items-start gap-4">
                                            {selectedHistory.products?.image_url ? (
                                                <img src={selectedHistory.products.image_url} alt={selectedHistory.products.name} className="w-14 h-14 rounded-xl object-cover border border-ant-line shrink-0" />
                                            ) : (
                                                <div className="w-14 h-14 bg-ant-light border border-ant-line rounded-xl flex items-center justify-center shrink-0">
                                                    <Package className="w-5 h-5 text-ant-mid" />
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0 space-y-1">
                                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                                    Campaign report
                                                </div>
                                                <DialogTitle className="font-display text-[22px] leading-tight tracking-tight text-ant-ink truncate">
                                                    {selectedHistory.products?.name}
                                                </DialogTitle>
                                                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-ant-ink">
                                                        <span className="text-ant-mid">{getPlatformIcon(selectedHistory.method)}</span>
                                                        <span className="font-semibold">{selectedHistory.method}</span>
                                                    </span>
                                                    {selectedHistory.products?.code && (
                                                        <span className="text-ant-mid font-semibold uppercase tracking-[0.18em] text-[10px]">{selectedHistory.products.code}</span>
                                                    )}
                                                    <span className="text-ant-mid font-serif italic tabular-nums">{format(new Date(selectedHistory.start_date), 'MMM d')} – {format(new Date(selectedHistory.end_date), 'MMM d, yyyy')} · {m?.days} days</span>
                                                </div>
                                            </div>
                                            <Button onClick={() => setIsDetailsOpen(false)} variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-ant-ink/5 text-ant-mid shrink-0 cursor-pointer">
                                                <X className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </DialogHeader>

                                    <div className="ant-scroll p-6 space-y-6 overflow-y-auto flex-1 min-h-0">
                                        {/* Top 4 KPI tiles */}
                                        <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                                            {[
                                                { label: 'Ad spend', value: fmtNum(Number(selectedHistory.amount)), suffix: 'DH', accent: 'rose' as const, icon: Coins },
                                                { label: 'Orders', value: String(m?.totalOrders ?? 0), suffix: '', accent: 'ink' as const, icon: Megaphone },
                                                { label: 'Confirmed', value: String(m?.confirmedOrders ?? 0), suffix: '', accent: 'orange' as const, icon: Target },
                                                { label: 'Delivered', value: String(m?.deliveredOrders ?? 0), suffix: '', accent: 'green' as const, icon: ShieldCheck },
                                            ].map((tile) => (
                                                <AdsKpi
                                                    key={tile.label}
                                                    label={tile.label}
                                                    value={tile.value}
                                                    suffix={tile.suffix}
                                                    accent={tile.accent}
                                                    icon={tile.icon}
                                                />
                                            ))}
                                        </section>

                                        {/* Funnel */}
                                        {m && m.totalOrders > 0 && (
                                            <section className="rounded-2xl border border-ant-line bg-ant-paper p-5 space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                        <BarChart3 className="w-3 h-3" />
                                                        Conversion funnel
                                                    </div>
                                                    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tabular-nums', getHealthPill(m.fulfillmentRate, { green: 40, amber: 20 }))}>
                                                        {m.fulfillmentRate.toFixed(1)}% fulfilled
                                                    </span>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                                    <div className="space-y-1.5">
                                                        <div className="flex justify-between items-baseline">
                                                            <span className="text-[11px] font-semibold text-ant-mid uppercase tracking-[0.18em]">Orders → Confirmed</span>
                                                            <span className={cn('font-display text-[16px] font-semibold tabular-nums', getHealthTone(m.confirmRate, { green: 60, amber: 30 }))}>{m.confirmRate.toFixed(1)}%</span>
                                                        </div>
                                                        <div className="h-1.5 bg-ant-line rounded-full overflow-hidden">
                                                            <div className="h-full bg-ant-orange rounded-full transition-all" style={{ width: `${m.confirmRate}%` }} />
                                                        </div>
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <div className="flex justify-between items-baseline">
                                                            <span className="text-[11px] font-semibold text-ant-mid uppercase tracking-[0.18em]">Confirmed → Delivered</span>
                                                            <span className={cn('font-display text-[16px] font-semibold tabular-nums', getHealthTone(m.deliveryRate, { green: 70, amber: 40 }))}>{m.deliveryRate.toFixed(1)}%</span>
                                                        </div>
                                                        <div className="h-1.5 bg-ant-line rounded-full overflow-hidden">
                                                            <div className="h-full bg-ant-green rounded-full transition-all" style={{ width: `${m.deliveryRate}%` }} />
                                                        </div>
                                                    </div>
                                                </div>
                                            </section>
                                        )}

                                        {/* Cost efficiency */}
                                        <section className="space-y-3">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <Target className="w-3 h-3" />
                                                Cost efficiency
                                            </div>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                                {[
                                                    { label: 'CPA', sub: 'Cost per order', value: m && m.cpa > 0 ? `${fmtDec(m.cpa)} DH` : '—', color: 'text-ant-ink' },
                                                    { label: 'CPC', sub: 'Cost per confirm', value: m && m.cpc > 0 ? `${fmtDec(m.cpc)} DH` : '—', color: 'text-ant-orange' },
                                                    { label: 'CPD', sub: 'Cost per delivery', value: m && m.cpd > 0 ? `${fmtDec(m.cpd)} DH` : '—', color: 'text-ant-green' },
                                                    { label: 'Daily spend', sub: 'Average per day', value: m ? `${fmtDec(m.dailySpend)} DH` : '—', color: 'text-ant-ink' },
                                                ].map((s) => (
                                                    <div key={s.label} className="rounded-xl border border-ant-line bg-ant-paper p-3 space-y-0.5">
                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ant-mid">{s.label}</p>
                                                        <p className={cn('font-display text-[15px] font-semibold tabular-nums', s.color)}>{s.value}</p>
                                                        <p className="text-[10px] text-ant-mid font-serif italic">{s.sub}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </section>

                                        {/* Revenue & profit */}
                                        <section className="space-y-3">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <DollarSign className="w-3 h-3" />
                                                Revenue &amp; profit
                                            </div>
                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                                <div className="rounded-xl border border-ant-line bg-ant-paper p-3 space-y-0.5">
                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ant-mid">Gross revenue</p>
                                                    <p className="font-display text-[15px] font-semibold tabular-nums text-ant-ink">{m ? fmtNum(m.grossRevenue) : '0'} <span className="text-[10px] text-ant-mid font-normal">DH</span></p>
                                                </div>
                                                <div className="rounded-xl border border-ant-line bg-ant-paper p-3 space-y-0.5">
                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ant-mid">COGS</p>
                                                    <p className="font-display text-[15px] font-semibold tabular-nums text-ant-mid">{m ? fmtNum(m.cogs) : '0'} <span className="text-[10px] text-ant-mid font-normal">DH</span></p>
                                                </div>
                                                <div className="rounded-xl border border-ant-line bg-ant-paper p-3 space-y-0.5">
                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ant-mid">Shipping</p>
                                                    <p className="font-display text-[15px] font-semibold tabular-nums text-ant-mid">{m ? fmtNum(m.shippingCosts) : '0'} <span className="text-[10px] text-ant-mid font-normal">DH</span></p>
                                                </div>
                                                <div className={cn('rounded-xl border p-3 space-y-0.5', m && m.profit >= 0 ? 'border-ant-green/25 bg-ant-green/8' : 'border-ant-rose/25 bg-ant-rose/8')}>
                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ant-mid">Net profit</p>
                                                    <p className={cn('font-display text-[15px] font-semibold tabular-nums', m && m.profit >= 0 ? 'text-ant-green' : 'text-ant-rose')}>{m ? (m.profit >= 0 ? '+' : '') + fmtNum(m.profit) : '0'} <span className="text-[10px] font-normal">DH</span></p>
                                                </div>
                                                <div className={cn('rounded-xl border p-3 space-y-0.5', m && m.roas >= 1 ? 'border-ant-green/25 bg-ant-green/8' : m && m.roas >= 0.5 ? 'border-ant-orange/25 bg-ant-orange/8' : 'border-ant-rose/25 bg-ant-rose/8')}>
                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ant-mid">ROAS</p>
                                                    <p className={cn('font-display text-[15px] font-semibold tabular-nums', m ? getHealthTone(m.roas, { green: 1, amber: 0.5 }) : 'text-ant-ink')}>{m ? fmtDec(m.roas) : '0'}x</p>
                                                    <p className="text-[10px] text-ant-mid font-serif italic">Gross return</p>
                                                </div>
                                                <div className="rounded-xl border border-ant-line bg-ant-paper p-3 space-y-0.5">
                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ant-mid">Margin</p>
                                                    <p className={cn('font-display text-[15px] font-semibold tabular-nums', m && m.profitMargin > 0 ? 'text-ant-green' : 'text-ant-rose')}>{m ? fmtDec(m.profitMargin) : '0'}%</p>
                                                </div>
                                            </div>
                                        </section>

                                        {/* Quality & waste */}
                                        <section className="space-y-3">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <ShieldCheck className="w-3 h-3" />
                                                Quality &amp; waste
                                            </div>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                                <div className="rounded-xl border border-ant-line bg-ant-paper p-3 space-y-0.5">
                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ant-rose">Cancelled</p>
                                                    <p className="font-display text-[15px] font-semibold tabular-nums text-ant-rose">{m?.cancelledOrders ?? 0}</p>
                                                    <p className="text-[10px] text-ant-mid tabular-nums font-serif italic">{m ? m.cancelRate.toFixed(1) : 0}% of orders</p>
                                                </div>
                                                <div className="rounded-xl border border-ant-line bg-ant-paper p-3 space-y-0.5">
                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ant-mid">Fake</p>
                                                    <p className="font-display text-[15px] font-semibold tabular-nums text-ant-mid">{m?.fakeOrders ?? 0}</p>
                                                    <p className="text-[10px] text-ant-mid tabular-nums font-serif italic">{m ? m.fakeRate.toFixed(1) : 0}% of orders</p>
                                                </div>
                                                <div className="rounded-xl border border-ant-line bg-ant-paper p-3 space-y-0.5">
                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ant-orange">Wasted spend</p>
                                                    <p className="font-display text-[15px] font-semibold tabular-nums text-ant-orange">{m ? fmtNum(m.wastedSpend) : '0'} <span className="text-[10px] text-ant-mid font-normal">DH</span></p>
                                                    <p className="text-[10px] text-ant-mid font-serif italic">Ads that didn't convert</p>
                                                </div>
                                                <div className={cn('rounded-xl border p-3 space-y-0.5', m && m.qualityScore >= 40 ? 'border-ant-green/25 bg-ant-green/8' : m && m.qualityScore >= 20 ? 'border-ant-orange/25 bg-ant-orange/8' : 'border-ant-rose/25 bg-ant-rose/8')}>
                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ant-mid">Quality score</p>
                                                    <p className={cn('font-display text-[15px] font-semibold tabular-nums', m ? getHealthTone(m.qualityScore, { green: 40, amber: 20 }) : 'text-ant-ink')}>{m ? m.qualityScore.toFixed(0) : 0}%</p>
                                                    <p className="text-[10px] text-ant-mid font-serif italic">Orders → Delivered</p>
                                                </div>
                                            </div>
                                        </section>
                                    </div>

                                    <DialogFooter className="px-6 py-4 border-t border-ant-line flex-row items-center justify-between">
                                        <div className="inline-flex items-center gap-1.5 text-ant-mid">
                                            <Layout className="w-3.5 h-3.5" />
                                            <span className="text-[11px] font-medium tabular-nums">SKU · {selectedHistory.products?.code}</span>
                                        </div>
                                        <Button onClick={() => setIsDetailsOpen(false)} variant="outline" className="h-10 px-5 rounded-full text-[12px] font-semibold border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light cursor-pointer">
                                            Close
                                        </Button>
                                    </DialogFooter>
                                </div>
                            );
                        })()}
                    </DialogContent>
                </Dialog>

                {/* Delete confirmation */}
                <AlertDialog open={!!historyToDelete} onOpenChange={() => setHistoryToDelete(null)}>
                    <AlertDialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                        <AlertDialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-rose">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                                Destructive action
                            </div>
                            <AlertDialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">Delete this campaign?</AlertDialogTitle>
                            <AlertDialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                The record and its attribution will be permanently removed. Orders stay untouched.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="px-6 py-4 gap-2">
                            <AlertDialogCancel className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer border-0">Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => deleteMutation.mutate(historyToDelete)}
                                className="h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-rose hover:bg-ant-rose/90 text-white gap-2 cursor-pointer"
                            >
                                {deleteMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                <Trash2 className="w-3.5 h-3.5" />
                                Confirm delete
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </div>
    );
};

export default AdsHistory;
