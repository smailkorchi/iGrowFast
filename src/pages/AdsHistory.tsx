import React, { useState, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
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
    TrendingUp,
    Target,
    BarChart3,
    Package,
    Layout,
    CheckCircle2,
    Truck,
    XCircle,
    AlertTriangle,
    DollarSign,
    ShieldCheck,
    Zap,
    Lock,
    User as UserIcon,
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
} from '@/components/ui/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
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
import { isDeliveredForCommission } from '@/lib/commercialCommission';
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

const AdsHistory = () => {
    const { confirmedIds, cancelledIds, deliveredPkgIds, getOrderCategory } = useStatusCategories();
    const location = useLocation();
    const currentUserId = useCurrentUserId();

    // The same page mounts under two roots:
    //   - /ads-history           → admin: sees everything, gates edit by ownership
    //   - /mediabuyer/product-ads → media buyer: sees only his own rows
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
            // Media buyer only sees rows they created. Admin sees everything.
            if (isMediaBuyerView && currentUserId) {
                query = query.eq('created_by', currentUserId);
            }
            const { data, error } = await query;
            if (error) throw error;
            return data;
        },
        enabled: !!activeBusinessId && (!isMediaBuyerView || !!currentUserId),
    });

    // Creators lookup (for the "Created by" badge in admin view).
    const { data: creators = [] } = useQuery({
        queryKey: ['ads_history-creators', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, avatar_url, role')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return (data || []) as Array<{ id: string; name: string | null; avatar_url: string | null; role: string | null }>;
        },
        enabled: !!activeBusinessId && !isMediaBuyerView,
    });

    const creatorById = useMemo(() => {
        const map = new Map<string, { id: string; name: string | null; avatar_url: string | null; role: string | null }>();
        for (const u of creators) map.set(u.id, u);
        return map;
    }, [creators]);

    // Ownership rule:
    //  - Legacy rows (created_by IS NULL) are treated as admin-owned and remain editable by admins.
    //  - Rows created after the migration are only editable by their author.
    const canEditRow = (row: any): boolean => {
        if (!currentUserId) return false;
        if (row.created_by == null) return !isMediaBuyerView; // legacy → admin only
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
            const { data, error } = await (supabase as any)
                .from('orders')
                .select('id, date, source_name, price, shipping_cost, package_status_id, order_status_id, package_status_label, order_statuses(code), package_statuses(label), order_items(product_id, unit_price, quantity)')
                .eq('DigiCom Business', activeBusinessId)
                .is('date_deleted', null);
            if (error) throw error;
            return data;
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
            let confirmedOrders = 0;
            let deliveredOrders = 0;
            let cancelledOrders = 0;
            let fakeOrders = 0;
            let grossRevenue = 0;
            let shippingCosts = 0;

            matchedOrders.forEach((o: any) => {
                const isDelivered = isDeliveredForCommission(o, deliveredPkgIds);
                const orderCat = getOrderCategory(o.order_status_id);

                if (isDelivered) {
                    deliveredOrders++;
                    confirmedOrders++;
                    grossRevenue += Number(o.price) || 0;
                    shippingCosts += Number(o.shipping_cost) || 0;
                } else if (o.order_status_id && confirmedIds.has(o.order_status_id)) {
                    confirmedOrders++;
                } else if (o.order_status_id && cancelledIds.has(o.order_status_id)) {
                    if (orderCat === 'fake' || orderCat === 'double') {
                        fakeOrders++;
                    } else {
                        cancelledOrders++;
                    }
                }
            });

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
                confirmRate: totalOrders > 0 ? (confirmedOrders / totalOrders) * 100 : 0,
                deliveryRate: confirmedOrders > 0 ? (deliveredOrders / confirmedOrders) * 100 : 0,
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
    }, [allOrders, productCosts, confirmedIds, cancelledIds, deliveredPkgIds, getOrderCategory]);

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
            // Gate edit at the mutation layer too — the UI hides the button, but we double check.
            if (editingHistory && !canEditRow(editingHistory)) {
                throw new Error('You can only edit campaigns you created');
            }

            const basePayload = {
                product_id: values.product_id,
                method: values.method,
                amount: values.amount,
                results: 0,
                'DigiCom Business': activeBusinessId,
                start_date: format(values.start_date, 'yyyy-MM-dd'),
                end_date: format(values.end_date, 'yyyy-MM-dd'),
            };

            if (editingHistory) {
                // Never overwrite `created_by` on update — it's set at insert time.
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

    const getHealthColor = (value: number, thresholds: { green: number; amber: number }) => {
        if (value >= thresholds.green) return 'text-emerald-600';
        if (value >= thresholds.amber) return 'text-amber-600';
        return 'text-red-500';
    };

    const getHealthBg = (value: number, thresholds: { green: number; amber: number }) => {
        if (value >= thresholds.green) return 'bg-emerald-50 border-emerald-200';
        if (value >= thresholds.amber) return 'bg-amber-50 border-amber-200';
        return 'bg-red-50 border-red-200';
    };

    // KPI totals
    const totalSpend = filteredHistory?.reduce((s: number, h: any) => s + Number(h.amount || 0), 0) || 0;
    const platformTotals = (filteredHistory || []).reduce((acc: Record<string, number>, h: any) => {
        const key = h.method || 'Other';
        acc[key] = (acc[key] || 0) + Number(h.amount || 0);
        return acc;
    }, {} as Record<string, number>);
    const topPlatforms = Object.entries(platformTotals).sort((a, b) => b[1] - a[1]).slice(0, 3);

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Ads Performance</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Auto-calculated metrics from real order data</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <Input
                                placeholder="Search campaigns..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-7 h-8 rounded-md border-gray-200 bg-white text-[11px] w-52"
                            />
                        </div>
                        <Button
                            onClick={() => openUpsert()}
                            className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 px-3 rounded-md text-[11px] font-semibold gap-1.5 shrink-0"
                        >
                            <Plus className="w-3.5 h-3.5" /> Log Campaign
                        </Button>
                    </div>
                </div>
            </header>

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                    <span className="w-[3px] self-stretch rounded-full" style={{ background: '#ef4444' }} />
                    <div className="flex-1 min-w-0">
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Total Spend</p>
                        <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{fmtNum(totalSpend)} DH</p>
                    </div>
                </div>
                {topPlatforms.map(([platform, spend], i) => {
                    const accent = i === 0 ? '#d97706' : i === 1 ? '#059669' : '#3b5e5e';
                    return (
                        <div key={platform} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                            <span className="w-[3px] self-stretch rounded-full" style={{ background: accent }} />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[9px] text-gray-400">{getPlatformIcon(platform)}</span>
                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 truncate">{platform}</p>
                                </div>
                                <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{fmtNum(spend)} DH</p>
                            </div>
                        </div>
                    );
                })}
                {topPlatforms.length < 3 && Array.from({ length: 3 - topPlatforms.length }).map((_, i) => (
                    <div key={`empty-${i}`} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5 opacity-40">
                        <span className="w-[3px] self-stretch rounded-full bg-gray-200" />
                        <div className="flex-1 min-w-0">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">—</p>
                            <p className="text-[18px] font-semibold text-gray-200 mt-1">—</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Campaign cards */}
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-44 w-full rounded-xl" />
                    ))}
                </div>
            ) : filteredHistory?.length === 0 ? (
                <div className="border border-dashed border-gray-200 rounded-xl py-8 flex flex-col items-center justify-center text-center gap-2">
                    <Megaphone className="w-5 h-5 text-gray-300" />
                    <p className="text-[11px] font-semibold text-brand-navy">No campaigns logged</p>
                    <p className="text-[10px] text-gray-400">Start tracking ads to see auto-calculated performance metrics.</p>
                    <Button variant="outline" onClick={() => openUpsert()} className="h-7 px-3 rounded-md text-[11px] font-semibold mt-1">
                        Log First Campaign
                    </Button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                    {filteredHistory?.map((h: any) => {
                        const m = getCampaignMetrics(h);
                        const canEdit = canEditRow(h);
                        const creator = h.created_by ? creatorById.get(h.created_by) : null;
                        return (
                            <Card
                                key={h.id}
                                className="border border-gray-100 shadow-none rounded-xl cursor-pointer hover:border-gray-200 transition-colors"
                                onClick={() => openDetails(h)}
                            >
                                <CardContent className="p-3.5 space-y-3">
                                    <div className="flex justify-between items-start">
                                        <div className="flex gap-2.5 items-start">
                                            {h.products?.image_url ? (
                                                <img src={h.products.image_url} alt={h.products.name || 'product'} className="w-10 h-10 rounded-lg object-cover border border-gray-100 shrink-0" />
                                            ) : (
                                                <div className="w-10 h-10 bg-gray-50 border border-gray-100 rounded-lg flex items-center justify-center shrink-0">
                                                    <Package className="w-4 h-4 text-gray-300" />
                                                </div>
                                            )}
                                            <div>
                                                <div className="flex items-center gap-1 text-brand-navy/60 mb-0.5">
                                                    {getPlatformIcon(h.method)}
                                                    <Badge className="h-5 px-1.5 text-[9px] bg-gray-100 text-gray-500 border-none font-semibold">{h.method}</Badge>
                                                </div>
                                                <h3 className="text-[12px] font-semibold text-brand-navy line-clamp-1 max-w-[160px]">{h.products?.name}</h3>
                                                {!isMediaBuyerView && (
                                                    <span className="text-[10px] text-gray-400 truncate block max-w-[160px]">
                                                        {creator?.name || (h.created_by ? 'Unknown user' : 'Admin (legacy)')}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {canEdit ? (
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md hover:bg-gray-100 text-gray-400">
                                                        <MoreVertical className="w-3.5 h-3.5" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="rounded-lg border border-gray-100 shadow-sm p-1 min-w-[130px]">
                                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openUpsert(h); }} className="rounded-md px-2 py-1.5 cursor-pointer text-[11px] font-medium gap-2">
                                                        <Edit2 className="w-3.5 h-3.5 text-gray-400" /> Edit
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator className="my-1" />
                                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setHistoryToDelete(h); }} className="rounded-md px-2 py-1.5 cursor-pointer text-[11px] font-medium gap-2 text-red-500">
                                                        <Trash2 className="w-3.5 h-3.5" /> Delete
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        ) : (
                                            <div
                                                className="flex items-center gap-1 px-1.5 h-5 rounded bg-gray-100 text-gray-400 shrink-0"
                                                title="Read only"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <Lock className="w-2.5 h-2.5" />
                                                <span className="text-[9px] font-semibold uppercase">Read only</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-4 gap-2 pt-1">
                                        {[
                                            { label: 'Spend', value: fmtNum(Number(h.amount)), color: 'text-brand-navy' },
                                            { label: 'Orders', value: m?.totalOrders ?? '—', color: 'text-brand-navy' },
                                            { label: 'Delivered', value: m?.deliveredOrders ?? '—', color: 'text-emerald-600' },
                                            { label: 'CPD', value: m && m.cpd > 0 ? fmtDec(m.cpd) : '—', color: m && m.cpd > 0 ? getHealthColor(m.roas, { green: 1, amber: 0.5 }) : 'text-gray-300' },
                                        ].map((item) => (
                                            <div key={item.label} className="space-y-0.5">
                                                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">{item.label}</p>
                                                <p className={cn("text-[13px] font-semibold tabular-nums", item.color)}>{item.value}</p>
                                            </div>
                                        ))}
                                    </div>

                                    {m && m.totalOrders > 0 && (
                                        <div className="space-y-1">
                                            <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">
                                                <span>Funnel</span>
                                                <span>{m.fulfillmentRate.toFixed(0)}% fulfilled</span>
                                            </div>
                                            <div className="h-1 bg-gray-100 rounded-full overflow-hidden flex">
                                                <div className="bg-emerald-500 rounded-full" style={{ width: `${m.fulfillmentRate}%` }} />
                                                <div className="bg-blue-300 rounded-full" style={{ width: `${Math.max(0, m.confirmRate - m.fulfillmentRate)}%` }} />
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                                        <div className="flex items-center gap-1.5 text-gray-400">
                                            <Calendar className="w-3 h-3" />
                                            <span className="text-[10px] font-medium">{format(new Date(h.start_date), 'MMM d')} – {format(new Date(h.end_date), 'MMM d')}</span>
                                        </div>
                                        {m && m.profit !== 0 && (
                                            <div className={cn("flex items-center gap-0.5 px-1.5 h-5 rounded text-[9px] font-semibold", m.profit > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500')}>
                                                {m.profit > 0 ? <ArrowUpRight className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                                                {m.profit > 0 ? '+' : ''}{fmtNum(m.profit)} DH
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Upsert Modal */}
            <Dialog open={isUpsertOpen} onOpenChange={setIsUpsertOpen}>
                <DialogContent className="max-w-md border border-gray-100 rounded-xl shadow-none p-0 overflow-hidden">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleUpsert)}>
                            <DialogHeader className="px-4 pt-4 pb-3 border-b border-gray-100">
                                <DialogTitle className="text-[13px] font-semibold text-brand-navy">
                                    {editingHistory ? 'Update Campaign' : 'Log New Campaign'}
                                </DialogTitle>
                                <DialogDescription className="text-[10px] text-gray-400">
                                    Platform, product, date range and spend. Metrics auto-calculate from orders.
                                </DialogDescription>
                            </DialogHeader>

                            <div className="px-4 py-3 space-y-3 max-h-[70vh] overflow-y-auto">
                                <div className="grid grid-cols-2 gap-3">
                                    <FormField
                                        control={form.control}
                                        name="product_id"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">Product</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger className="h-8 rounded-md border-gray-200 text-[11px] font-medium text-brand-navy">
                                                            <SelectValue placeholder="Select Product" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="rounded-lg border border-gray-100 shadow-sm">
                                                        {products?.map((p) => (
                                                            <SelectItem key={p.id} value={p.id} className="text-[11px]">
                                                                {p.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="method"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">Platform</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger className="h-8 rounded-md border-gray-200 text-[11px] font-medium text-brand-navy">
                                                            <SelectValue placeholder="Select Platform" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="rounded-lg border border-gray-100 shadow-sm">
                                                        {PLATFORMS.map((p) => (
                                                            <SelectItem key={p} value={p} className="text-[11px]">
                                                                {p}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <FormField
                                    control={form.control}
                                    name="amount"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">Total Ad Spend (DH)</FormLabel>
                                            <FormControl>
                                                <Input type="number" step="0.01" placeholder="0" {...field} className="h-8 rounded-md border-gray-200 text-[11px] font-medium text-brand-navy" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="grid grid-cols-2 gap-3">
                                    <FormField
                                        control={form.control}
                                        name="start_date"
                                        render={({ field }) => (
                                            <FormItem className="flex flex-col">
                                                <FormLabel className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400 mb-1">Start Date</FormLabel>
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <FormControl>
                                                            <Button
                                                                variant={"outline"}
                                                                className={cn(
                                                                    "h-8 rounded-md border-gray-200 text-[11px] font-medium text-brand-navy text-left justify-start",
                                                                    !field.value && "text-gray-400"
                                                                )}
                                                            >
                                                                {field.value ? format(field.value, "PP") : <span>Pick a date</span>}
                                                                <Calendar className="ml-auto h-3 w-3 opacity-50" />
                                                            </Button>
                                                        </FormControl>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0 rounded-lg overflow-hidden shadow-sm border border-gray-100" align="start">
                                                        <CalendarComponent mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                                                    </PopoverContent>
                                                </Popover>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="end_date"
                                        render={({ field }) => (
                                            <FormItem className="flex flex-col">
                                                <FormLabel className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400 mb-1">End Date</FormLabel>
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <FormControl>
                                                            <Button
                                                                variant={"outline"}
                                                                className={cn(
                                                                    "h-8 rounded-md border-gray-200 text-[11px] font-medium text-brand-navy text-left justify-start",
                                                                    !field.value && "text-gray-400"
                                                                )}
                                                            >
                                                                {field.value ? format(field.value, "PP") : <span>Pick a date</span>}
                                                                <Calendar className="ml-auto h-3 w-3 opacity-50" />
                                                            </Button>
                                                        </FormControl>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0 rounded-lg overflow-hidden shadow-sm border border-gray-100" align="start">
                                                        <CalendarComponent mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                                                    </PopoverContent>
                                                </Popover>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </div>

                            <DialogFooter className="px-4 pb-4 pt-3 border-t border-gray-100">
                                <Button type="submit" disabled={upsertMutation.isPending} className="bg-brand-navy text-brand-white rounded-md h-8 px-4 text-[11px] font-semibold w-full">
                                    {upsertMutation.isPending && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
                                    {editingHistory ? 'Update Record' : 'Save Campaign'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* Details Modal */}
            <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
                <DialogContent className="max-w-3xl border border-gray-100 rounded-xl shadow-none p-0 overflow-hidden max-h-[90vh] flex flex-col">
                    {selectedHistory && (() => {
                        const m = getCampaignMetrics(selectedHistory);
                        return (
                            <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
                                {/* Header */}
                                <DialogHeader className="px-4 pt-4 pb-3 border-b border-gray-100 shrink-0">
                                    <div className="flex items-center gap-3">
                                        {selectedHistory.products?.image_url ? (
                                            <img src={selectedHistory.products.image_url} alt={selectedHistory.products.name} className="w-10 h-10 rounded-lg object-cover border border-gray-100 shrink-0" />
                                        ) : (
                                            <div className="w-10 h-10 bg-gray-50 border border-gray-100 rounded-lg flex items-center justify-center shrink-0">
                                                <Package className="w-4 h-4 text-gray-300" />
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5 mb-0.5">
                                                <Badge className="h-5 px-1.5 text-[9px] bg-gray-100 text-gray-500 border-none font-semibold">{selectedHistory.method}</Badge>
                                                {selectedHistory.products?.code && (
                                                    <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">{selectedHistory.products.code}</span>
                                                )}
                                            </div>
                                            <DialogTitle className="text-[13px] font-semibold text-brand-navy truncate">{selectedHistory.products?.name}</DialogTitle>
                                            <p className="text-[10px] text-gray-400">{format(new Date(selectedHistory.start_date), 'MMM d')} – {format(new Date(selectedHistory.end_date), 'MMM d, yyyy')} · {m?.days} days</p>
                                        </div>
                                        <Button onClick={() => setIsDetailsOpen(false)} variant="ghost" size="icon" className="h-7 w-7 rounded-md hover:bg-gray-100 text-gray-400 shrink-0">
                                            <span className="text-[11px] font-semibold">✕</span>
                                        </Button>
                                    </div>
                                </DialogHeader>

                                <div className="p-4 space-y-4">
                                    {/* Top Row: 4 KPI tiles */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                        {[
                                            { label: 'Ad Spend', value: `${fmtNum(Number(selectedHistory.amount))} DH`, accent: 'bg-red-500' },
                                            { label: 'Orders', value: String(m?.totalOrders ?? 0), accent: 'bg-brand-navy' },
                                            { label: 'Confirmed', value: String(m?.confirmedOrders ?? 0), accent: 'bg-blue-500' },
                                            { label: 'Delivered', value: String(m?.deliveredOrders ?? 0), accent: 'bg-emerald-500' },
                                        ].map((tile) => (
                                            <Card key={tile.label} className="border border-gray-100 shadow-none rounded-xl relative overflow-hidden">
                                                <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${tile.accent} rounded-l-xl`} />
                                                <CardContent className="p-2.5 pl-4">
                                                    <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400 mb-0.5">{tile.label}</p>
                                                    <p className="text-[15px] font-semibold tabular-nums text-brand-navy">{tile.value}</p>
                                                </CardContent>
                                            </Card>
                                        ))}
                                    </div>

                                    {/* Funnel Progress */}
                                    {m && m.totalOrders > 0 && (
                                        <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                                            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400 flex items-center gap-1.5">
                                                <BarChart3 className="w-3 h-3" /> Conversion Funnel
                                            </p>
                                            <div className="flex items-center gap-3">
                                                <div className="flex-1 space-y-1">
                                                    <div className="flex justify-between text-[10px] font-semibold">
                                                        <span className="text-gray-500">Orders → Confirmed</span>
                                                        <span className={getHealthColor(m.confirmRate, { green: 60, amber: 30 })}>{m.confirmRate.toFixed(1)}%</span>
                                                    </div>
                                                    <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${m.confirmRate}%` }} />
                                                    </div>
                                                </div>
                                                <div className="text-gray-300 text-[11px] font-bold">→</div>
                                                <div className="flex-1 space-y-1">
                                                    <div className="flex justify-between text-[10px] font-semibold">
                                                        <span className="text-gray-500">Confirmed → Delivered</span>
                                                        <span className={getHealthColor(m.deliveryRate, { green: 70, amber: 40 })}>{m.deliveryRate.toFixed(1)}%</span>
                                                    </div>
                                                    <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${m.deliveryRate}%` }} />
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex justify-end">
                                                <span className={cn("px-2 h-5 rounded text-[9px] font-semibold flex items-center", getHealthBg(m.fulfillmentRate, { green: 40, amber: 20 }))}>
                                                    {m.fulfillmentRate.toFixed(1)}% fulfilled overall
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Cost Efficiency */}
                                    <div className="space-y-2">
                                        <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400 flex items-center gap-1.5">
                                            <Target className="w-3 h-3" /> Cost Efficiency
                                        </p>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                            {[
                                                { label: 'CPA', sub: 'Cost per order', value: m && m.cpa > 0 ? `${fmtDec(m.cpa)} DH` : '—', color: 'text-brand-navy' },
                                                { label: 'CPC', sub: 'Cost per confirm', value: m && m.cpc > 0 ? `${fmtDec(m.cpc)} DH` : '—', color: 'text-blue-600' },
                                                { label: 'CPD', sub: 'Cost per delivery', value: m && m.cpd > 0 ? `${fmtDec(m.cpd)} DH` : '—', color: 'text-emerald-600' },
                                                { label: 'Daily Spend', sub: 'Average per day', value: m ? `${fmtDec(m.dailySpend)} DH` : '—', color: 'text-brand-navy' },
                                            ].map((s) => (
                                                <div key={s.label} className="border border-gray-100 rounded-xl p-2.5 space-y-0.5">
                                                    <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">{s.label}</p>
                                                    <p className={cn("text-[13px] font-semibold tabular-nums", s.color)}>{s.value}</p>
                                                    <p className="text-[9px] text-gray-400">{s.sub}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Revenue & Profit */}
                                    <div className="space-y-2">
                                        <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400 flex items-center gap-1.5">
                                            <DollarSign className="w-3 h-3" /> Revenue & Profit
                                        </p>
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                            <div className="border border-gray-100 rounded-xl p-2.5 space-y-0.5">
                                                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">Gross Revenue</p>
                                                <p className="text-[13px] font-semibold tabular-nums text-brand-navy">{m ? fmtNum(m.grossRevenue) : '0'} DH</p>
                                            </div>
                                            <div className="border border-gray-100 rounded-xl p-2.5 space-y-0.5">
                                                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">COGS</p>
                                                <p className="text-[13px] font-semibold tabular-nums text-gray-500">{m ? fmtNum(m.cogs) : '0'} DH</p>
                                            </div>
                                            <div className="border border-gray-100 rounded-xl p-2.5 space-y-0.5">
                                                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">Shipping</p>
                                                <p className="text-[13px] font-semibold tabular-nums text-gray-500">{m ? fmtNum(m.shippingCosts) : '0'} DH</p>
                                            </div>
                                            <div className={cn("border rounded-xl p-2.5 space-y-0.5", m && m.profit >= 0 ? 'border-emerald-100 bg-emerald-50' : 'border-red-100 bg-red-50')}>
                                                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">Net Profit</p>
                                                <p className={cn("text-[13px] font-semibold tabular-nums", m && m.profit >= 0 ? 'text-emerald-600' : 'text-red-500')}>{m ? (m.profit >= 0 ? '+' : '') + fmtNum(m.profit) : '0'} DH</p>
                                            </div>
                                            <div className={cn("border rounded-xl p-2.5 space-y-0.5", m && m.roas >= 1 ? 'border-emerald-100 bg-emerald-50' : m && m.roas >= 0.5 ? 'border-amber-100 bg-amber-50' : 'border-red-100 bg-red-50')}>
                                                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">ROAS</p>
                                                <p className={cn("text-[13px] font-semibold tabular-nums", m ? getHealthColor(m.roas, { green: 1, amber: 0.5 }) : 'text-brand-navy')}>{m ? fmtDec(m.roas) : '0'}x</p>
                                                <p className="text-[9px] text-gray-400">Gross return</p>
                                            </div>
                                            <div className="border border-gray-100 rounded-xl p-2.5 space-y-0.5">
                                                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">Margin</p>
                                                <p className={cn("text-[13px] font-semibold tabular-nums", m && m.profitMargin > 0 ? 'text-emerald-600' : 'text-red-500')}>{m ? fmtDec(m.profitMargin) : '0'}%</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Waste & Quality */}
                                    <div className="space-y-2">
                                        <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400 flex items-center gap-1.5">
                                            <ShieldCheck className="w-3 h-3" /> Quality & Waste
                                        </p>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                            <div className="border border-gray-100 rounded-xl p-2.5 space-y-0.5">
                                                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-red-400">Cancelled</p>
                                                <p className="text-[13px] font-semibold tabular-nums text-red-500">{m?.cancelledOrders ?? 0}</p>
                                                <p className="text-[9px] text-gray-400">{m ? m.cancelRate.toFixed(1) : 0}% of orders</p>
                                            </div>
                                            <div className="border border-gray-100 rounded-xl p-2.5 space-y-0.5">
                                                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">Fake</p>
                                                <p className="text-[13px] font-semibold tabular-nums text-gray-500">{m?.fakeOrders ?? 0}</p>
                                                <p className="text-[9px] text-gray-400">{m ? m.fakeRate.toFixed(1) : 0}% of orders</p>
                                            </div>
                                            <div className="border border-gray-100 rounded-xl p-2.5 space-y-0.5">
                                                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-amber-500">Wasted Spend</p>
                                                <p className="text-[13px] font-semibold tabular-nums text-amber-600">{m ? fmtNum(m.wastedSpend) : '0'} DH</p>
                                                <p className="text-[9px] text-gray-400">Ads didn't convert</p>
                                            </div>
                                            <div className={cn("border rounded-xl p-2.5 space-y-0.5", m ? getHealthBg(m.qualityScore, { green: 40, amber: 20 }) : 'border-gray-100')}>
                                                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">Quality Score</p>
                                                <p className={cn("text-[13px] font-semibold tabular-nums", m ? getHealthColor(m.qualityScore, { green: 40, amber: 20 }) : 'text-brand-navy')}>{m ? m.qualityScore.toFixed(0) : 0}%</p>
                                                <p className="text-[9px] text-gray-400">Orders → Delivered</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Footer */}
                                    <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
                                        <div className="flex items-center gap-1.5 text-gray-400">
                                            <Layout className="w-3 h-3" />
                                            <span className="text-[10px] font-medium">SKU: {selectedHistory.products?.code}</span>
                                        </div>
                                        <Button onClick={() => setIsDetailsOpen(false)} variant="outline" className="h-8 px-4 rounded-md text-[11px] font-semibold border-gray-200">
                                            Close
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={!!historyToDelete} onOpenChange={() => setHistoryToDelete(null)}>
                <AlertDialogContent className="max-w-sm rounded-xl border border-gray-100 shadow-none p-4">
                    <AlertDialogHeader className="space-y-1">
                        <div className="flex items-center gap-2 mb-1">
                            <Trash2 className="w-4 h-4 text-red-500" />
                            <AlertDialogTitle className="text-[13px] font-semibold text-brand-navy">Permanently Delete?</AlertDialogTitle>
                        </div>
                        <AlertDialogDescription className="text-[11px] text-gray-400">
                            This campaign record will be permanently removed.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="flex flex-row gap-2 mt-3">
                        <AlertDialogCancel className="flex-1 rounded-md h-8 text-[11px] font-semibold border-gray-200 m-0">
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => deleteMutation.mutate(historyToDelete)}
                            className="flex-1 rounded-md h-8 text-[11px] font-semibold bg-red-500 hover:bg-red-600 text-white m-0"
                        >
                            {deleteMutation.isPending && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default AdsHistory;
