import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus,
    Search,
    MoreVertical,
    Edit2,
    Trash2,
    Loader2,
    X,
    Calendar,
    Megaphone,
    ArrowUpRight,
    TrendingUp,
    Target,
    BarChart3,
    Package,
    Layout
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

// --- Schema ---
const adsHistorySchema = z.object({
    product_id: z.string().uuid("Please select a product"),
    method: z.string().min(1, "Please select a platform"),
    amount: z.coerce.number().min(0.01, "Amount must be greater than 0"),
    results: z.coerce.number().min(0, "Results cannot be negative"),
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

const AdsHistory = () => {
    const [isUpsertOpen, setIsUpsertOpen] = useState(false);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);
    const [selectedHistory, setSelectedHistory] = useState<any>(null);
    const [editingHistory, setEditingHistory] = useState<any>(null);
    const [historyToDelete, setHistoryToDelete] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");

    const { toast } = useToast();
    const queryClient = useQueryClient();

    // --- Queries ---
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const { data: adsHistory, isLoading } = useQuery({
        queryKey: ['ads_history', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];

            const { data, error } = await (supabase
                .from('ads_history' as any)
                .select('*, products(id, name, code)')
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
                .select('id, name, code')
                .eq('DigiCom Business', activeBusinessId)
                .order('name');
            if (error) throw error;
            return data;
        }
    });

    // --- Form Setup ---
    const form = useForm<AdsHistoryValues>({
        resolver: zodResolver(adsHistorySchema),
        defaultValues: {
            product_id: '',
            method: '',
            amount: 0,
            results: 0,
            start_date: new Date(),
            end_date: new Date(),
        }
    });

    // --- Mutations ---
    const upsertMutation = useMutation({
        mutationFn: async (values: AdsHistoryValues) => {
            const payload = {
                ...values,
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
                title: editingHistory ? "History updated" : "History created",
                description: "The ads performance data has been synchronized."
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
                results: history.results,
                start_date: new Date(history.start_date),
                end_date: new Date(history.end_date),
            });
        } else {
            setEditingHistory(null);
            form.reset({
                product_id: '',
                method: '',
                amount: 0,
                results: 0,
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

    // --- Calculations for metrics ---
    const getMetrics = (h: any) => {
        if (!h) return null;
        const days = differenceInDays(new Date(h.end_date), new Date(h.start_date)) + 1;
        const totalSpend = Number(h.amount);
        const totalResults = Number(h.results);

        return {
            days,
            costPerDay: totalSpend / days,
            costPerResult: totalResults > 0 ? totalSpend / totalResults : 0,
            resultsPerDay: totalResults / days,
            totalSpend,
            totalResults
        };
    };

    return (
        <div className="min-h-screen bg-brand-white p-4 md:p-8 space-y-8 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-2">
                    <h1 className="text-4xl font-black tracking-tight text-brand-navy uppercase flex items-center gap-3">
                        <Megaphone className="w-10 h-10 text-brand-navy" />
                        Ads Performance
                    </h1>
                    <p className="text-brand-navy/60 text-lg font-medium">Analyze your marketing spend and campaign efficiency.</p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 items-center">
                    <div className="relative group sm:w-80">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-navy/40 transition-colors group-focus-within:text-brand-navy" />
                        <Input
                            placeholder="Search campaigns..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-11 h-12 bg-white/50 border-none shadow-sm rounded-2xl focus-visible:ring-1 focus-visible:ring-brand-navy/20 transition-all font-bold text-brand-navy"
                        />
                    </div>
                    <Button
                        onClick={() => openUpsert()}
                        className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-12 px-6 font-bold shadow-lg shadow-brand-navy/10 transition-all active:scale-95 flex items-center gap-2 w-full sm:w-auto"
                    >
                        <Plus className="w-5 h-5" />
                        Log Campaign
                    </Button>
                </div>
            </div>

            {/* Grid Display */}
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-[200px] rounded-[32px] bg-brand-navy/5" />
                    ))}
                </div>
            ) : filteredHistory?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-6 bg-white/50 backdrop-blur-sm rounded-[40px] shadow-sm border border-brand-navy/[0.03]">
                    <div className="w-24 h-24 bg-brand-navy/[0.04] rounded-full flex items-center justify-center text-brand-navy/20">
                        <Megaphone className="w-12 h-12" />
                    </div>
                    <div className="text-center">
                        <h3 className="text-2xl font-bold text-brand-navy text-center">No campaigns logged</h3>
                        <p className="text-muted-foreground max-w-xs mx-auto">Start tracking your ads performances to optimize your marketing spend.</p>
                    </div>
                    <Button variant="outline" onClick={() => openUpsert()} className="rounded-xl font-bold hover:bg-brand-navy hover:text-brand-white transition-all">
                        Log Your First Campaign
                    </Button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {filteredHistory?.map((h: any) => {
                        const metrics = getMetrics(h);
                        return (
                            <Card
                                key={h.id}
                                className="group relative overflow-hidden border-none bg-white/50 backdrop-blur-sm shadow-sm hover:shadow-2xl transition-all duration-300 rounded-[32px] cursor-pointer"
                                onClick={() => openDetails(h)}
                            >
                                <CardContent className="p-8 space-y-6">
                                    <div className="flex justify-between items-start">
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40">{h.method}</p>
                                            <h3 className="text-2xl font-bold text-brand-navy truncate max-w-[200px]">{h.products?.name}</h3>
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
                                                    <span className="font-bold">Edit Details</span>
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setHistoryToDelete(h); }} className="rounded-xl p-3 cursor-pointer text-red-500 focus:bg-red-50 focus:text-red-600 gap-3">
                                                    <Trash2 className="w-4 h-4" />
                                                    <span className="font-bold">Delete Record</span>
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>

                                    <div className="grid grid-cols-2 gap-6">
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Total Amount</p>
                                            <p className="text-2xl font-black text-brand-navy">{Number(h.amount).toLocaleString()} DH</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Results</p>
                                            <p className="text-2xl font-black text-brand-navy">{Number(h.results).toLocaleString()}</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between pt-4 border-t border-brand-navy/5">
                                        <div className="flex items-center gap-2 text-brand-navy/60">
                                            <Calendar className="w-3.5 h-3.5" />
                                            <span className="text-xs font-bold">{format(new Date(h.start_date), 'MMM d')} - {format(new Date(h.end_date), 'MMM d')}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5 px-3 py-1 bg-brand-navy/5 rounded-full">
                                            <Target className="w-3 h-3 text-brand-navy" />
                                            <span className="text-[10px] font-black text-brand-navy uppercase">{metrics?.costPerResult.toFixed(2)} DH / Re</span>
                                        </div>
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
                                    Enter your advertising performance data.
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

                                <div className="grid grid-cols-2 gap-6">
                                    <FormField
                                        control={form.control}
                                        name="amount"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Total Spend (DH)</FormLabel>
                                                <FormControl>
                                                    <Input type="number" step="0.01" placeholder="0" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-lg font-black text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="results"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Total Results</FormLabel>
                                                <FormControl>
                                                    <Input type="number" placeholder="0" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-lg font-black text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

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
                                                        <CalendarComponent
                                                            mode="single"
                                                            selected={field.value}
                                                            onSelect={field.onChange}
                                                            initialFocus
                                                        />
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
                                                        <CalendarComponent
                                                            mode="single"
                                                            selected={field.value}
                                                            onSelect={field.onChange}
                                                            initialFocus
                                                        />
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
                                    {editingHistory ? 'Update Record' : 'Save Campaign Performance'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* Details Breakdown Modal */}
            <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
                <DialogContent className="max-w-3xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden">
                    {selectedHistory && (
                        <div className="flex flex-col">
                            <DialogHeader className="p-10 pb-4 bg-brand-navy text-brand-white relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -mr-32 -mt-32" />
                                <div className="absolute bottom-0 left-0 w-48 h-48 bg-brand-blue/10 rounded-full blur-3xl -ml-24 -mb-24" />

                                <div className="relative z-10 space-y-2">
                                    <div className="flex items-center gap-2">
                                        <span className="px-3 py-1 bg-white/10 rounded-full text-[10px] font-black uppercase tracking-[0.2em]">{selectedHistory.method}</span>
                                        <span className="px-3 py-1 bg-brand-white text-brand-navy rounded-full text-[10px] font-black uppercase tracking-[0.2em]">{selectedHistory.products?.code}</span>
                                    </div>
                                    <DialogTitle className="text-4xl font-black">{selectedHistory.products?.name}</DialogTitle>
                                    <p className="text-brand-white/60 font-medium">Performance Analysis: {format(new Date(selectedHistory.start_date), 'MMM d')} - {format(new Date(selectedHistory.end_date), 'MMM d, yyyy')}</p>
                                </div>
                            </DialogHeader>

                            <div className="p-10 space-y-12 bg-brand-white">
                                {/* Top Metrics Row */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-brand-navy/40">
                                            <TrendingUp className="w-4 h-4" />
                                            <span className="text-xs font-black uppercase tracking-widest">Total Investment</span>
                                        </div>
                                        <p className="text-4xl font-black text-brand-navy">{Number(selectedHistory.amount).toLocaleString()} <span className="text-sm">DH</span></p>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-brand-navy/40">
                                            <Target className="w-4 h-4" />
                                            <span className="text-xs font-black uppercase tracking-widest">Acquisitions</span>
                                        </div>
                                        <p className="text-4xl font-black text-brand-navy">{Number(selectedHistory.results).toLocaleString()}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-brand-navy/40">
                                            <ArrowUpRight className="w-4 h-4" />
                                            <span className="text-xs font-black uppercase tracking-widest">CPA (Cost per Res)</span>
                                        </div>
                                        <p className="text-4xl font-black text-emerald-600">{(Number(selectedHistory.amount) / (Number(selectedHistory.results) || 1)).toFixed(2)} <span className="text-sm">DH</span></p>
                                    </div>
                                </div>

                                {/* Detailed Breakdown Section */}
                                <div className="space-y-6">
                                    <div className="flex items-center gap-3">
                                        <BarChart3 className="w-5 h-5 text-brand-navy" />
                                        <h4 className="text-xl font-black text-brand-navy tracking-tight uppercase">Daily Dynamics</h4>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                                        {(() => {
                                            const m = getMetrics(selectedHistory);
                                            return (
                                                <>
                                                    <div className="p-6 rounded-[32px] bg-brand-navy/[0.02] border border-brand-navy/5 space-y-2 shadow-inner">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Campaign Duration</p>
                                                        <p className="text-2xl font-black text-brand-navy">{m?.days} Days</p>
                                                    </div>
                                                    <div className="p-6 rounded-[32px] bg-brand-navy/[0.02] border border-brand-navy/5 space-y-2 shadow-inner">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Spend Velocity</p>
                                                        <p className="text-2xl font-black text-brand-navy">{m?.costPerDay.toFixed(2)} DH / Day</p>
                                                    </div>
                                                    <div className="p-6 rounded-[32px] bg-brand-navy/[0.02] border border-brand-navy/5 space-y-2 shadow-inner">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Result Velocity</p>
                                                        <p className="text-2xl font-black text-brand-navy">{m?.resultsPerDay.toFixed(2)} Res / Day</p>
                                                    </div>
                                                </>
                                            );
                                        })()}
                                    </div>
                                </div>

                                {/* Footer Action */}
                                <div className="pt-6 border-t border-brand-navy/5 flex items-center justify-between font-bold">
                                    <div className="flex items-center gap-4 text-brand-navy/60">
                                        <div className="flex items-center gap-2">
                                            <Layout className="w-4 h-4" />
                                            <span>SKU: {selectedHistory.products?.code}</span>
                                        </div>
                                    </div>
                                    <Button onClick={() => setIsDetailsOpen(false)} variant="secondary" className="rounded-2xl px-8 h-12 bg-brand-navy text-brand-white font-bold hover:bg-brand-navy/90">
                                        Analyze Next Campaign
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
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
                                You are about to remove this campaign record. This action cannot be reversed.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="w-full flex flex-col sm:flex-row gap-3 mt-4">
                            <AlertDialogCancel className="w-full rounded-2xl h-14 font-bold border-none bg-brand-navy/[0.04] hover:bg-brand-navy/[0.08] text-brand-navy m-0">
                                Back to Safety
                            </AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => deleteMutation.mutate(historyToDelete.id)}
                                className="w-full rounded-2xl h-14 font-bold bg-red-500 hover:bg-red-600 text-brand-white shadow-xl shadow-red-500/20 m-0"
                            >
                                {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                Confirm Removal
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </div>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default AdsHistory;
