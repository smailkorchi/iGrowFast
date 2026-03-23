import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
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
    Zap
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
        queryKey: ['ads_history', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase
                .from('ads_history' as any)
                .select('*, products(id, name, code, image_url)')
                .eq('DigiCom Business', activeBusinessId)
                .order('start_date', { ascending: false }) as any);
            if (error) throw error;
            return data;
        },
    });

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
                .eq('DigiCom Business', activeBusinessId);
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
            const payload = {
                product_id: values.product_id,
                method: values.method,
                amount: values.amount,
                results: 0,
                'DigiCom Business': activeBusinessId,
                start_date: format(values.start_date, 'yyyy-MM-dd'),
                end_date: format(values.end_date, 'yyyy-MM-dd'),
            };

            if (editingHistory) {
                const { data, error } = await (supabase
                    .from('ads_history' as any)
                    .update(payload)
                    .eq('id', editingHistory.id) as any)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            } else {
                const { data, error } = await (supabase
                    .from('ads_history' as any)
                    .insert(payload) as any)
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
        mutationFn: async (id: string) => {
            const { error } = await (supabase
                .from('ads_history' as any)
                .delete()
                .eq('id', id) as any);
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

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Ads Performance</h1>
                            <p className="text-gray-500 font-light">Auto-calculated metrics from real order data.</p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 items-center">
                            <div className="relative group sm:w-80">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary transition-colors" />
                                <Input
                                    placeholder="Search campaigns..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-11 h-12 rounded-2xl border-gray-100 bg-white"
                                />
                            </div>
                            <Button
                                onClick={() => openUpsert()}
                                className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 group flex items-center gap-2 w-full sm:w-auto"
                            >
                                <Plus className="w-5 h-5" />
                                Log Campaign
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Grid */}
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-[240px] rounded-[32px] bg-brand-navy/5" />
                    ))}
                </div>
            ) : filteredHistory?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-6 bg-white/50 backdrop-blur-sm rounded-[40px] shadow-sm border border-brand-navy/[0.03]">
                    <div className="w-24 h-24 bg-brand-navy/[0.04] rounded-full flex items-center justify-center text-brand-navy/20">
                        <Megaphone className="w-12 h-12" />
                    </div>
                    <div className="text-center">
                        <h3 className="text-2xl font-bold text-brand-navy">No campaigns logged</h3>
                        <p className="text-muted-foreground max-w-xs mx-auto">Start tracking your ads to see auto-calculated performance metrics.</p>
                    </div>
                    <Button variant="outline" onClick={() => openUpsert()} className="rounded-xl font-bold hover:bg-brand-navy hover:text-brand-white transition-all">
                        Log Your First Campaign
                    </Button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {filteredHistory?.map((h: any) => {
                        const m = getCampaignMetrics(h);
                        return (
                            <Card
                                key={h.id}
                                className="group relative overflow-hidden border-none bg-white/50 backdrop-blur-sm shadow-sm hover:shadow-2xl transition-all duration-300 rounded-[32px] cursor-pointer"
                                onClick={() => openDetails(h)}
                            >
                                <CardContent className="p-8 space-y-5">
                                    <div className="flex justify-between items-start">
                                        <div className="flex gap-4 items-start">
                                            {h.products?.image_url ? (
                                                <img src={h.products.image_url} alt={h.products.name || 'product'} className="w-14 h-14 rounded-[18px] object-cover border border-brand-navy/5 shadow-sm shrink-0" />
                                            ) : (
                                                <div className="w-14 h-14 bg-brand-navy/5 border border-brand-navy/5 rounded-[18px] flex items-center justify-center shadow-sm shrink-0">
                                                    <Package className="w-5 h-5 text-brand-navy/20" />
                                                </div>
                                            )}
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-1.5 text-brand-navy/60">
                                                    {getPlatformIcon(h.method)}
                                                    <p className="text-[10px] font-black uppercase tracking-widest leading-none mt-0.5">{h.method}</p>
                                                </div>
                                                <h3 className="text-lg leading-tight font-bold text-brand-navy line-clamp-1 max-w-[180px]">{h.products?.name}</h3>
                                            </div>
                                        </div>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                                <Button variant="ghost" size="icon" className="rounded-xl hover:bg-brand-navy/5">
                                                    <MoreVertical className="w-5 h-5" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-2xl p-2 min-w-[160px]">
                                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openUpsert(h); }} className="rounded-xl p-3 cursor-pointer focus:bg-brand-navy focus:text-brand-white gap-3">
                                                    <Edit2 className="w-4 h-4" />
                                                    <span className="font-bold">Edit</span>
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setHistoryToDelete(h); }} className="rounded-xl p-3 cursor-pointer text-red-500 focus:bg-red-50 focus:text-red-600 gap-3">
                                                    <Trash2 className="w-4 h-4" />
                                                    <span className="font-bold">Delete</span>
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>

                                    <div className="grid grid-cols-4 gap-3">
                                        <div className="space-y-0.5">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-brand-navy/40">Spend</p>
                                            <p className="text-lg font-black text-brand-navy">{fmtNum(Number(h.amount))}</p>
                                        </div>
                                        <div className="space-y-0.5">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-brand-navy/40">Orders</p>
                                            <p className="text-lg font-black text-brand-navy">{m?.totalOrders ?? '—'}</p>
                                        </div>
                                        <div className="space-y-0.5">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600/60">Delivered</p>
                                            <p className="text-lg font-black text-emerald-600">{m?.deliveredOrders ?? '—'}</p>
                                        </div>
                                        <div className="space-y-0.5">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-brand-navy/40">CPD</p>
                                            <p className={cn("text-lg font-black", m && m.cpd > 0 ? getHealthColor(m.roas, { green: 1, amber: 0.5 }) : 'text-brand-navy/30')}>
                                                {m && m.cpd > 0 ? fmtDec(m.cpd) : '—'}
                                            </p>
                                        </div>
                                    </div>

                                    {m && m.totalOrders > 0 && (
                                        <div className="space-y-1.5">
                                            <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-brand-navy/40">
                                                <span>Funnel</span>
                                                <span>{m.fulfillmentRate.toFixed(0)}% fulfilled</span>
                                            </div>
                                            <div className="h-1.5 bg-brand-navy/5 rounded-full overflow-hidden flex">
                                                <div className="bg-emerald-500 rounded-full transition-all" style={{ width: `${m.fulfillmentRate}%` }} />
                                                <div className="bg-blue-400 rounded-full transition-all" style={{ width: `${Math.max(0, m.confirmRate - m.fulfillmentRate)}%` }} />
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between pt-3 border-t border-brand-navy/5">
                                        <div className="flex items-center gap-2 text-brand-navy/60">
                                            <Calendar className="w-3.5 h-3.5" />
                                            <span className="text-xs font-bold">{format(new Date(h.start_date), 'MMM d')} – {format(new Date(h.end_date), 'MMM d')}</span>
                                        </div>
                                        {m && m.profit !== 0 && (
                                            <div className={cn("flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase", m.profit > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500')}>
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
                <DialogContent className="max-w-xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleUpsert)}>
                            <DialogHeader className="p-8 pb-4">
                                <DialogTitle className="text-3xl font-bold text-brand-navy">
                                    {editingHistory ? 'Update Campaign' : 'Log New Campaign'}
                                </DialogTitle>
                                <DialogDescription className="text-muted-foreground text-lg">
                                    Enter platform, product, date range and spend. Metrics auto-calculate from orders.
                                </DialogDescription>
                            </DialogHeader>

                            <div className="p-8 pt-4 space-y-6 max-h-[70vh] overflow-y-auto">
                                <div className="grid grid-cols-2 gap-6">
                                    <FormField
                                        control={form.control}
                                        name="product_id"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Product</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner">
                                                            <SelectValue placeholder="Select Product" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="rounded-2xl border-none shadow-2xl p-2 min-w-[200px]">
                                                        {products?.map((p) => (
                                                            <SelectItem key={p.id} value={p.id} className="rounded-xl p-3 font-bold text-brand-navy focus:bg-brand-navy focus:text-brand-white">
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
                                                <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Platform</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner">
                                                            <SelectValue placeholder="Select Platform" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="rounded-2xl border-none shadow-2xl p-2 min-w-[200px]">
                                                        {PLATFORMS.map((p) => (
                                                            <SelectItem key={p} value={p} className="rounded-xl p-3 font-bold text-brand-navy focus:bg-brand-navy focus:text-brand-white">
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
                                            <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Total Ad Spend (DH)</FormLabel>
                                            <FormControl>
                                                <Input type="number" step="0.01" placeholder="0" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-lg font-black text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="grid grid-cols-2 gap-6">
                                    <FormField
                                        control={form.control}
                                        name="start_date"
                                        render={({ field }) => (
                                            <FormItem className="flex flex-col">
                                                <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70 mb-2">Start Date</FormLabel>
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <FormControl>
                                                            <Button
                                                                variant={"outline"}
                                                                className={cn(
                                                                    "h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-left font-bold text-brand-navy shadow-inner",
                                                                    !field.value && "text-muted-foreground"
                                                                )}
                                                            >
                                                                {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                                                                <Calendar className="ml-auto h-4 w-4 opacity-50" />
                                                            </Button>
                                                        </FormControl>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0 rounded-3xl overflow-hidden shadow-2xl border-none" align="start">
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
                                                <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70 mb-2">End Date</FormLabel>
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <FormControl>
                                                            <Button
                                                                variant={"outline"}
                                                                className={cn(
                                                                    "h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-left font-bold text-brand-navy shadow-inner",
                                                                    !field.value && "text-muted-foreground"
                                                                )}
                                                            >
                                                                {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                                                                <Calendar className="ml-auto h-4 w-4 opacity-50" />
                                                            </Button>
                                                        </FormControl>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0 rounded-3xl overflow-hidden shadow-2xl border-none" align="start">
                                                        <CalendarComponent mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                                                    </PopoverContent>
                                                </Popover>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </div>

                            <DialogFooter className="p-8 pt-4">
                                <Button type="submit" disabled={upsertMutation.isPending} className="bg-brand-navy text-brand-white rounded-2xl h-14 w-full font-bold text-lg shadow-xl shadow-brand-navy/30 transition-all hover:scale-[1.02]">
                                    {upsertMutation.isPending && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
                                    {editingHistory ? 'Update Record' : 'Save Campaign'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* Details Modal */}
            <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
                <DialogContent className="max-w-4xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
                    {selectedHistory && (() => {
                        const m = getCampaignMetrics(selectedHistory);
                        return (
                            <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
                                {/* Header */}
                                <DialogHeader className="p-10 pb-6 bg-brand-navy text-brand-white relative overflow-hidden shrink-0">
                                    <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -mr-32 -mt-32" />
                                    <div className="absolute bottom-0 left-0 w-48 h-48 bg-brand-blue/10 rounded-full blur-3xl -ml-24 -mb-24" />

                                    <div className="relative z-10 flex flex-col sm:flex-row items-center sm:items-start gap-6 mt-2 text-center sm:text-left">
                                        {selectedHistory.products?.image_url ? (
                                            <img src={selectedHistory.products.image_url} alt={selectedHistory.products.name} className="w-20 h-20 rounded-[24px] object-cover border-4 border-white/10 shadow-xl" />
                                        ) : (
                                            <div className="w-20 h-20 bg-white/10 border-4 border-white/5 rounded-[24px] flex items-center justify-center shadow-xl">
                                                <Package className="w-8 h-8 text-brand-white/40" />
                                            </div>
                                        )}
                                        <div className="space-y-2 flex-1 pt-1">
                                            <div className="flex items-center justify-center sm:justify-start gap-2">
                                                <span className="flex items-center gap-1.5 px-3 py-1 bg-white/10 rounded-full text-[10px] font-black uppercase tracking-[0.2em]">
                                                    {getPlatformIcon(selectedHistory.method)}
                                                    <span>{selectedHistory.method}</span>
                                                </span>
                                                <span className="px-3 py-1 bg-brand-white text-brand-navy rounded-full text-[10px] font-black uppercase tracking-[0.2em]">{selectedHistory.products?.code}</span>
                                            </div>
                                            <DialogTitle className="text-3xl font-black">{selectedHistory.products?.name}</DialogTitle>
                                            <p className="text-brand-white/60 font-medium text-sm">{format(new Date(selectedHistory.start_date), 'MMM d')} – {format(new Date(selectedHistory.end_date), 'MMM d, yyyy')} ({m?.days} days)</p>
                                        </div>
                                    </div>
                                </DialogHeader>

                                <div className="p-8 space-y-8 bg-brand-white">
                                    {/* Top Row: 4 Big Numbers */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        <div className="p-5 rounded-[24px] bg-brand-navy/[0.03] space-y-1">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Ad Spend</p>
                                            <p className="text-3xl font-black text-brand-navy">{fmtNum(Number(selectedHistory.amount))}<span className="text-sm ml-1 font-bold text-brand-navy/40">DH</span></p>
                                        </div>
                                        <div className="p-5 rounded-[24px] bg-brand-navy/[0.03] space-y-1">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Orders</p>
                                            <p className="text-3xl font-black text-brand-navy">{m?.totalOrders ?? 0}</p>
                                        </div>
                                        <div className="p-5 rounded-[24px] bg-blue-50 space-y-1">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-blue-600/60">Confirmed</p>
                                            <p className="text-3xl font-black text-blue-600">{m?.confirmedOrders ?? 0}</p>
                                        </div>
                                        <div className="p-5 rounded-[24px] bg-emerald-50 space-y-1">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600/60">Delivered</p>
                                            <p className="text-3xl font-black text-emerald-600">{m?.deliveredOrders ?? 0}</p>
                                        </div>
                                    </div>

                                    {/* Funnel Progress */}
                                    {m && m.totalOrders > 0 && (
                                        <div className="space-y-3">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40 flex items-center gap-2">
                                                <BarChart3 className="w-3.5 h-3.5" /> Conversion Funnel
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 space-y-1">
                                                    <div className="flex justify-between text-[10px] font-bold">
                                                        <span className="text-brand-navy/60">Orders → Confirmed</span>
                                                        <span className={getHealthColor(m.confirmRate, { green: 60, amber: 30 })}>{m.confirmRate.toFixed(1)}%</span>
                                                    </div>
                                                    <div className="h-2 bg-brand-navy/5 rounded-full overflow-hidden">
                                                        <div className="h-full bg-blue-500 rounded-full transition-all duration-700" style={{ width: `${m.confirmRate}%` }} />
                                                    </div>
                                                </div>
                                                <div className="text-brand-navy/20 font-black">→</div>
                                                <div className="flex-1 space-y-1">
                                                    <div className="flex justify-between text-[10px] font-bold">
                                                        <span className="text-brand-navy/60">Confirmed → Delivered</span>
                                                        <span className={getHealthColor(m.deliveryRate, { green: 70, amber: 40 })}>{m.deliveryRate.toFixed(1)}%</span>
                                                    </div>
                                                    <div className="h-2 bg-brand-navy/5 rounded-full overflow-hidden">
                                                        <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${m.deliveryRate}%` }} />
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex justify-center">
                                                <div className={cn("px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wide border", getHealthBg(m.fulfillmentRate, { green: 40, amber: 20 }))}>
                                                    Overall: {m.fulfillmentRate.toFixed(1)}% fulfilled
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Cost Efficiency */}
                                    <div className="space-y-3">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40 flex items-center gap-2">
                                            <Target className="w-3.5 h-3.5" /> Cost Efficiency
                                        </p>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                            <div className="p-4 rounded-[20px] bg-white border border-brand-navy/5 shadow-sm space-y-2">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-brand-navy/40">CPA</p>
                                                <p className="text-2xl font-black text-brand-navy">{m && m.cpa > 0 ? fmtDec(m.cpa) : '—'}<span className="text-xs ml-1 text-brand-navy/40">DH</span></p>
                                                <p className="text-[9px] text-brand-navy/40 font-bold">Cost per order</p>
                                            </div>
                                            <div className="p-4 rounded-[20px] bg-white border border-brand-navy/5 shadow-sm space-y-2">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-blue-600/60">CPC</p>
                                                <p className="text-2xl font-black text-blue-600">{m && m.cpc > 0 ? fmtDec(m.cpc) : '—'}<span className="text-xs ml-1 text-blue-600/40">DH</span></p>
                                                <p className="text-[9px] text-brand-navy/40 font-bold">Cost per confirmation</p>
                                            </div>
                                            <div className="p-4 rounded-[20px] bg-white border border-brand-navy/5 shadow-sm space-y-2">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600/60">CPD</p>
                                                <p className="text-2xl font-black text-emerald-600">{m && m.cpd > 0 ? fmtDec(m.cpd) : '—'}<span className="text-xs ml-1 text-emerald-600/40">DH</span></p>
                                                <p className="text-[9px] text-brand-navy/40 font-bold">Cost per delivery</p>
                                            </div>
                                            <div className="p-4 rounded-[20px] bg-white border border-brand-navy/5 shadow-sm space-y-2">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-brand-navy/40">Daily Spend</p>
                                                <p className="text-2xl font-black text-brand-navy">{m ? fmtDec(m.dailySpend) : '—'}<span className="text-xs ml-1 text-brand-navy/40">DH</span></p>
                                                <p className="text-[9px] text-brand-navy/40 font-bold">Average per day</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Revenue & Profit */}
                                    <div className="space-y-3">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40 flex items-center gap-2">
                                            <DollarSign className="w-3.5 h-3.5" /> Revenue & Profit
                                        </p>
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                            <div className="p-4 rounded-[20px] bg-white border border-brand-navy/5 shadow-sm space-y-2">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-brand-navy/40">Gross Revenue</p>
                                                <p className="text-2xl font-black text-brand-navy">{m ? fmtNum(m.grossRevenue) : '0'}<span className="text-xs ml-1 text-brand-navy/40">DH</span></p>
                                            </div>
                                            <div className="p-4 rounded-[20px] bg-white border border-brand-navy/5 shadow-sm space-y-2">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-brand-navy/40">COGS</p>
                                                <p className="text-2xl font-black text-brand-navy/60">{m ? fmtNum(m.cogs) : '0'}<span className="text-xs ml-1 text-brand-navy/40">DH</span></p>
                                            </div>
                                            <div className="p-4 rounded-[20px] bg-white border border-brand-navy/5 shadow-sm space-y-2">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-brand-navy/40">Shipping</p>
                                                <p className="text-2xl font-black text-brand-navy/60">{m ? fmtNum(m.shippingCosts) : '0'}<span className="text-xs ml-1 text-brand-navy/40">DH</span></p>
                                            </div>
                                            <div className={cn("p-4 rounded-[20px] border shadow-sm space-y-2", m && m.profit >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200')}>
                                                <p className="text-[9px] font-black uppercase tracking-widest text-brand-navy/40">Net Profit</p>
                                                <p className={cn("text-2xl font-black", m && m.profit >= 0 ? 'text-emerald-600' : 'text-red-500')}>{m ? (m.profit >= 0 ? '+' : '') + fmtNum(m.profit) : '0'}<span className="text-xs ml-1 opacity-60">DH</span></p>
                                            </div>
                                            <div className={cn("p-4 rounded-[20px] border shadow-sm space-y-2", m && m.roas >= 1 ? 'bg-emerald-50 border-emerald-200' : m && m.roas >= 0.5 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200')}>
                                                <p className="text-[9px] font-black uppercase tracking-widest text-brand-navy/40">ROAS</p>
                                                <p className={cn("text-2xl font-black", m ? getHealthColor(m.roas, { green: 1, amber: 0.5 }) : 'text-brand-navy')}>{m ? fmtDec(m.roas) : '0'}<span className="text-xs ml-1 opacity-60">x</span></p>
                                                <p className="text-[9px] text-brand-navy/40 font-bold">Gross return</p>
                                            </div>
                                            <div className="p-4 rounded-[20px] bg-white border border-brand-navy/5 shadow-sm space-y-2">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-brand-navy/40">Margin</p>
                                                <p className={cn("text-2xl font-black", m && m.profitMargin > 0 ? 'text-emerald-600' : 'text-red-500')}>{m ? fmtDec(m.profitMargin) : '0'}<span className="text-xs ml-1 opacity-60">%</span></p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Waste & Quality */}
                                    <div className="space-y-3">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40 flex items-center gap-2">
                                            <ShieldCheck className="w-3.5 h-3.5" /> Quality & Waste
                                        </p>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                            <div className="p-4 rounded-[20px] bg-white border border-brand-navy/5 shadow-sm space-y-2">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-red-500/60">Cancelled</p>
                                                <p className="text-2xl font-black text-red-500">{m?.cancelledOrders ?? 0}</p>
                                                <p className="text-[9px] text-brand-navy/40 font-bold">{m ? m.cancelRate.toFixed(1) : 0}% of orders</p>
                                            </div>
                                            <div className="p-4 rounded-[20px] bg-white border border-brand-navy/5 shadow-sm space-y-2">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Fake</p>
                                                <p className="text-2xl font-black text-gray-500">{m?.fakeOrders ?? 0}</p>
                                                <p className="text-[9px] text-brand-navy/40 font-bold">{m ? m.fakeRate.toFixed(1) : 0}% of orders</p>
                                            </div>
                                            <div className="p-4 rounded-[20px] bg-white border border-brand-navy/5 shadow-sm space-y-2">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-amber-600/60">Wasted Spend</p>
                                                <p className="text-2xl font-black text-amber-600">{m ? fmtNum(m.wastedSpend) : '0'}<span className="text-xs ml-1 opacity-60">DH</span></p>
                                                <p className="text-[9px] text-brand-navy/40 font-bold">Ads that didn't convert</p>
                                            </div>
                                            <div className={cn("p-4 rounded-[20px] border shadow-sm space-y-2", m ? getHealthBg(m.qualityScore, { green: 40, amber: 20 }) : 'bg-white border-brand-navy/5')}>
                                                <p className="text-[9px] font-black uppercase tracking-widest text-brand-navy/40">Quality Score</p>
                                                <p className={cn("text-2xl font-black", m ? getHealthColor(m.qualityScore, { green: 40, amber: 20 }) : 'text-brand-navy')}>{m ? m.qualityScore.toFixed(0) : 0}<span className="text-xs ml-1 opacity-60">%</span></p>
                                                <p className="text-[9px] text-brand-navy/40 font-bold">Orders → Delivered</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Footer */}
                                    <div className="pt-6 border-t border-brand-navy/5 flex items-center justify-between font-bold">
                                        <div className="flex items-center gap-4 text-brand-navy/60 text-sm">
                                            <div className="flex items-center gap-2">
                                                <Layout className="w-4 h-4" />
                                                <span>SKU: {selectedHistory.products?.code}</span>
                                            </div>
                                        </div>
                                        <Button onClick={() => setIsDetailsOpen(false)} variant="secondary" className="rounded-2xl px-8 h-12 bg-brand-navy text-brand-white font-bold hover:bg-brand-navy/90">
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
                <AlertDialogContent className="rounded-[40px] border-none p-10 max-w-md bg-brand-white">
                    <div className="flex flex-col items-center text-center space-y-6">
                        <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center text-red-500">
                            <Trash2 className="w-10 h-10" />
                        </div>
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-3xl font-bold text-brand-navy">Permanently Delete?</AlertDialogTitle>
                            <AlertDialogDescription className="text-lg text-muted-foreground pt-2">
                                This campaign record will be permanently removed.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="w-full flex flex-col sm:flex-row gap-3 mt-4">
                            <AlertDialogCancel className="w-full rounded-2xl h-14 font-bold border-none bg-brand-navy/[0.04] hover:bg-brand-navy/[0.08] text-brand-navy m-0">
                                Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => deleteMutation.mutate(historyToDelete.id)}
                                className="w-full rounded-2xl h-14 font-bold bg-red-500 hover:bg-red-600 text-brand-white shadow-xl shadow-red-500/20 m-0"
                            >
                                {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                Delete
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </div>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default AdsHistory;
