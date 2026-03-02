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
    ExternalLink,
    Globe,
    Database,
    ShieldCheck,
    Key,
    LayoutGrid,
    CheckCircle2
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
import { Badge } from "@/components/ui/badge";

// --- Schema ---
const salesChannelSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    type: z.enum(['Woocommerce', 'Google Sheets']),
    url: z.string().url("Please enter a valid URL").optional().or(z.literal('')),
    consumer_key: z.string().optional().or(z.literal('')),
    consumer_secret: z.string().optional().or(z.literal('')),
    spreadsheet_id: z.string().optional().or(z.literal('')),
    spreadsheet_name: z.string().optional().or(z.literal('')),
    start_row: z.coerce.number().min(1, "Row must be at least 1").default(1),
});

type SalesChannelFormValues = z.infer<typeof salesChannelSchema>;

const LOGOS: Record<string, string> = {
    "Woocommerce": "https://cdn.worldvectorlogo.com/logos/woocommerce.svg",
    "Google Sheets": "https://cdn.pixabay.com/photo/2017/03/08/21/21/spreadsheet-2127832_1280.png"
};

const SalesChannels = () => {
    const [isUpsertOpen, setIsUpsertOpen] = useState(false);
    const [editingChannel, setEditingChannel] = useState<any>(null);
    const [channelToDelete, setChannelToDelete] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");

    const { toast } = useToast();
    const queryClient = useQueryClient();

    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // --- Queries ---
    const { data: channels, isLoading } = useQuery({
        queryKey: ['sales_channels', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase
                .from('sales_channels' as any)
                .select('*')
                .eq('DigiCom Business', activeBusinessId)
                .order('name', { ascending: true }) as any);

            if (error) throw error;
            return data;
        },
    });

    // --- Form Setup ---
    const form = useForm<SalesChannelFormValues>({
        resolver: zodResolver(salesChannelSchema),
        defaultValues: {
            name: '',
            type: 'Woocommerce',
            url: '',
            consumer_key: '',
            consumer_secret: '',
            spreadsheet_id: '',
            spreadsheet_name: '',
            start_row: 1,
        }
    });

    const channelType = form.watch('type');

    // --- Mutations ---
    const upsertMutation = useMutation({
        mutationFn: async (values: SalesChannelFormValues) => {
            if (editingChannel) {
                const { data, error } = await (supabase
                    .from('sales_channels' as any)
                    .update({ ...values, 'DigiCom Business': activeBusinessId })
                    .eq('id', editingChannel.id)
                    .eq('DigiCom Business', activeBusinessId) as any)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            } else {
                const { data, error } = await (supabase
                    .from('sales_channels' as any)
                    .insert({ ...values, 'DigiCom Business': activeBusinessId }) as any)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            }
        },
        onSuccess: (data: any) => {
            queryClient.invalidateQueries({ queryKey: ['sales_channels'] });
            setIsUpsertOpen(false);
            setEditingChannel(null);
            toast({
                title: editingChannel ? "Channel updated" : "Channel connected",
                description: `${data.name} is now synchronized.`
            });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await (supabase
                .from('sales_channels' as any)
                .delete()
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId) as any);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sales_channels'] });
            setChannelToDelete(null);
            toast({ title: "Channel removed", description: "Integration disconnected successfully." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const handleUpsert = (values: SalesChannelFormValues) => {
        upsertMutation.mutate(values);
    };

    const openUpsert = (channel: any = null) => {
        if (channel) {
            setEditingChannel(channel);
            form.reset({
                name: channel.name,
                type: channel.type,
                url: channel.url || '',
                consumer_key: channel.consumer_key || '',
                consumer_secret: channel.consumer_secret || '',
                spreadsheet_id: channel.spreadsheet_id || '',
                spreadsheet_name: channel.spreadsheet_name || '',
                start_row: channel.start_row || 1,
            });
        } else {
            setEditingChannel(null);
            form.reset({
                name: '',
                type: 'Woocommerce',
                url: '',
                consumer_key: '',
                consumer_secret: '',
                spreadsheet_id: '',
                spreadsheet_name: '',
                start_row: 1,
            });
        }
        setIsUpsertOpen(true);
    };

    const filteredChannels = channels?.filter((c: any) =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.type.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Sales Channels</h1>
                            <p className="text-gray-500 font-light">Connect and manage your external storefronts and data sources.</p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 items-center">
                            <div className="relative group sm:w-80">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary transition-colors" />
                                <Input
                                    placeholder="Search channels..."
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
                                New Connection
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {isLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-64 w-full rounded-[40px] bg-brand-navy/5" />
                    ))
                ) : filteredChannels?.length === 0 ? (
                    <div className="col-span-full py-20 flex flex-col items-center justify-center text-center space-y-4">
                        <div className="w-24 h-24 bg-brand-navy/5 rounded-[32px] flex items-center justify-center text-brand-navy/20">
                            <LayoutGrid className="w-12 h-12" />
                        </div>
                        <div className="space-y-1 text-brand-navy">
                            <p className="text-xl font-bold">No channels linked</p>
                            <p className="font-medium opacity-60">Expand your business by connecting WooCommerce or Sheets.</p>
                        </div>
                    </div>
                ) : (
                    filteredChannels?.map((channel: any) => (
                        <ChannelCard
                            key={channel.id}
                            channel={channel}
                            onEdit={() => openUpsert(channel)}
                            onDelete={() => setChannelToDelete(channel)}
                        />
                    ))
                )}
            </div>

            {/* Upsert Modal */}
            <Dialog open={isUpsertOpen} onOpenChange={setIsUpsertOpen}>
                <DialogContent className="max-w-2xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleUpsert)} className="flex flex-col">
                            <div className="bg-brand-navy p-10 text-brand-white flex items-center justify-between">
                                <div className="space-y-1">
                                    <DialogTitle className="text-3xl font-black uppercase tracking-tight leading-none">
                                        {editingChannel ? 'Update Connection' : 'Register Store'}
                                    </DialogTitle>
                                    <p className="text-brand-white/40 font-bold text-sm uppercase tracking-widest">Integration Settings</p>
                                </div>
                                {LOGOS[channelType] ? (
                                    <div className="w-16 h-16 bg-white rounded-2xl p-3 shadow-2xl">
                                        <img src={LOGOS[channelType]} alt={channelType} className="w-full h-full object-contain" />
                                    </div>
                                ) : (
                                    <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center">
                                        <Globe className="w-8 h-8" />
                                    </div>
                                )}
                            </div>

                            <div className="p-10 space-y-8 max-h-[60vh] overflow-y-auto no-scrollbar bg-brand-white">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <FormField
                                        control={form.control}
                                        name="name"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs font-black uppercase tracking-wider text-brand-navy/40">Display Name</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="e.g. Primary Store" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/5 font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="type"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs font-black uppercase tracking-wider text-brand-navy/40">Platform Type</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger className="h-14 rounded-2xl border-none bg-brand-navy/5 font-bold text-brand-navy shadow-inner">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="rounded-2xl border-none shadow-2xl p-2 bg-brand-white">
                                                        <SelectItem value="Woocommerce" className="rounded-xl p-3 font-bold uppercase text-[10px] tracking-widest focus:bg-brand-navy focus:text-brand-white">Woocommerce</SelectItem>
                                                        <SelectItem value="Google Sheets" className="rounded-xl p-3 font-bold uppercase text-[10px] tracking-widest focus:bg-brand-navy focus:text-brand-white">Google Sheets</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                {channelType === 'Woocommerce' && (
                                    <div className="space-y-6 animate-in slide-in-from-top-2 duration-300">
                                        <FormField
                                            control={form.control}
                                            name="url"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-xs font-black uppercase tracking-wider text-brand-navy/40">Store URL</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="https://yourstore.com" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/5 font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <FormField
                                                control={form.control}
                                                name="consumer_key"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-xs font-black uppercase tracking-wider text-brand-navy/40">Consumer Key (ck_...)</FormLabel>
                                                        <FormControl>
                                                            <Input type="password" placeholder="ck_..." {...field} className="h-14 rounded-2xl border-none bg-brand-navy/5 font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={form.control}
                                                name="consumer_secret"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-xs font-black uppercase tracking-wider text-brand-navy/40">Consumer Secret (cs_...)</FormLabel>
                                                        <FormControl>
                                                            <Input type="password" placeholder="cs_..." {...field} className="h-14 rounded-2xl border-none bg-brand-navy/5 font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </div>
                                )}

                                {channelType === 'Google Sheets' && (
                                    <div className="space-y-6 animate-in slide-in-from-top-2 duration-300">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <FormField
                                                control={form.control}
                                                name="spreadsheet_id"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-xs font-black uppercase tracking-wider text-brand-navy/40">Spreadsheet ID</FormLabel>
                                                        <FormControl>
                                                            <Input placeholder="Enter ID from URL" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/5 font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={form.control}
                                                name="spreadsheet_name"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-xs font-black uppercase tracking-wider text-brand-navy/40">Sheet/Tab Name</FormLabel>
                                                        <FormControl>
                                                            <Input placeholder="e.g. Sheet1" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/5 font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                        <FormField
                                            control={form.control}
                                            name="start_row"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-xs font-black uppercase tracking-wider text-brand-navy/40">Data Starts At (Row Number)</FormLabel>
                                                    <FormControl>
                                                        <Input type="number" placeholder="10" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/5 font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                )}
                            </div>

                            <DialogFooter className="p-10 pt-4 bg-brand-white">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => setIsUpsertOpen(false)}
                                    className="rounded-2xl h-14 px-8 font-bold text-brand-navy hover:bg-brand-navy/5"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={upsertMutation.isPending}
                                    className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-14 px-10 font-bold shadow-2xl shadow-brand-navy/20 transition-all active:scale-95 flex items-center gap-3"
                                >
                                    {upsertMutation.isPending && <Loader2 className="w-5 h-5 animate-spin" />}
                                    {editingChannel ? 'Update Sync' : 'Initialize Connection'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* Delete Dialog */}
            <AlertDialog open={!!channelToDelete} onOpenChange={() => setChannelToDelete(null)}>
                <AlertDialogContent className="rounded-[40px] border-none p-12 max-w-md bg-brand-white">
                    <div className="flex flex-col items-center text-center space-y-6">
                        <div className="w-24 h-24 bg-red-50 rounded-[32px] flex items-center justify-center text-red-500 shadow-inner">
                            <Trash2 className="w-12 h-12" />
                        </div>
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-3xl font-black text-brand-navy uppercase">Disable Sync?</AlertDialogTitle>
                            <AlertDialogDescription className="text-lg font-medium text-brand-navy/60 pt-2">
                                Terminating <span className="font-bold text-brand-navy italic">"{channelToDelete?.name}"</span> will stop all data communication between systems.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="w-full flex flex-col sm:flex-row gap-3 mt-4">
                            <AlertDialogCancel className="w-full rounded-2xl h-14 font-bold border-none bg-brand-navy/5 hover:bg-brand-navy/10 text-brand-navy m-0">
                                Abort
                            </AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => deleteMutation.mutate(channelToDelete.id)}
                                className="w-full rounded-2xl h-14 font-bold bg-red-500 hover:bg-red-600 text-brand-white shadow-xl shadow-red-500/20 m-0"
                            >
                                {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                Terminate Connection
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </div>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

// --- Sub-components ---

const ChannelCard = ({ channel, onEdit, onDelete }: any) => {
    const isWoo = channel.type === 'Woocommerce';
    const isSheets = channel.type === 'Google Sheets';

    return (
        <Card className="group relative overflow-hidden border-none bg-white/50 backdrop-blur-sm shadow-sm hover:shadow-2xl transition-all duration-700 rounded-[40px] cursor-default p-1 pb-7">
            <div className="p-7 space-y-6">
                <div className="flex justify-between items-start">
                    <div className="w-16 h-16 bg-brand-navy/[0.04] rounded-2xl p-4 flex items-center justify-center transition-all duration-500 group-hover:scale-110">
                        {LOGOS[channel.type as keyof typeof LOGOS] ? (
                            <img src={LOGOS[channel.type as keyof typeof LOGOS]!} alt={channel.type} className="w-full h-full object-contain" />
                        ) : (
                            <Globe className="w-8 h-8 text-brand-navy" />
                        )}
                    </div>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-12 w-12 rounded-2xl hover:bg-brand-navy/5 text-brand-navy/20 hover:text-brand-navy transition-colors">
                                <MoreVertical className="h-5 w-5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-2xl p-2 bg-brand-white animate-in zoom-in-95">
                            {isSheets && (
                                <>
                                    <DropdownMenuItem className="rounded-xl p-4 cursor-pointer focus:bg-emerald-50 focus:text-emerald-600 gap-3 group/item">
                                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                                        <span className="font-bold uppercase text-[10px] tracking-widest leading-none">Check Data</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator className="bg-brand-navy/5" />
                                </>
                            )}
                            <DropdownMenuItem onClick={onEdit} className="rounded-xl p-4 cursor-pointer focus:bg-brand-navy focus:text-brand-white gap-3 group/item">
                                <Edit2 className="w-5 h-5 text-brand-navy group-focus:text-brand-white" />
                                <span className="font-bold uppercase text-[10px] tracking-widest leading-none">Modify Integration</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="bg-brand-navy/5" />
                            <DropdownMenuItem onClick={onDelete} className="rounded-xl p-4 cursor-pointer text-red-500 focus:bg-red-50 focus:text-red-600 gap-3">
                                <Trash2 className="w-5 h-5" />
                                <span className="font-bold uppercase text-[10px] tracking-widest leading-none">Delete Connection</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <div className="space-y-4">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-brand-navy/30">
                                {channel.type}
                            </p>
                            <div className="w-1 h-1 bg-brand-navy/20 rounded-full" />
                            <Badge variant="outline" className="text-[8px] font-black uppercase py-0.5 px-2 bg-emerald-50 text-emerald-600 border-none rounded-lg italic">
                                Live
                            </Badge>
                        </div>
                        <h3 className="text-2xl font-black text-brand-navy tracking-tight line-clamp-1 uppercase">
                            {channel.name}
                        </h3>
                    </div>

                    <div className="bg-brand-navy/[0.02] border border-brand-navy/[0.03] p-5 rounded-[32px] space-y-4">
                        {isWoo && (
                            <div className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-white rounded-xl shadow-sm">
                                        <Globe className="w-3.5 h-3.5 text-brand-navy/60" />
                                    </div>
                                    <span className="text-xs font-bold text-brand-navy/70 line-clamp-1">{channel.url}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-white rounded-xl shadow-sm">
                                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                                    </div>
                                    <span className="text-[10px] font-black text-brand-navy/40 uppercase tracking-widest">Secured API Keys</span>
                                </div>
                            </div>
                        )}
                        {isSheets && (
                            <div className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-white rounded-xl shadow-sm">
                                        <Database className="w-3.5 h-3.5 text-green-600" />
                                    </div>
                                    <span className="text-xs font-bold text-brand-navy/70 uppercase">Table: {channel.spreadsheet_name}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-white rounded-xl shadow-sm">
                                        <Key className="w-3.5 h-3.5 text-amber-500" />
                                    </div>
                                    <span className="text-[9px] font-bold text-brand-navy/40 truncate italic">{channel.spreadsheet_id}</span>
                                </div>
                            </div>
                        )}
                        {!isWoo && !isSheets && (
                            <div className="py-4 flex flex-col items-center justify-center text-center opacity-40">
                                <p className="text-[10px] font-black uppercase tracking-widest italic">External custom hook</p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                        <span className="text-[10px] font-black uppercase text-brand-navy/40 tracking-widest">Synchronized</span>
                    </div>
                    {channel.url && (
                        <a href={channel.url} target="_blank" rel="noreferrer" className="p-3 bg-brand-navy/5 hover:bg-brand-navy/10 text-brand-navy rounded-xl transition-all">
                            <ExternalLink className="w-4 h-4" />
                        </a>
                    )}
                </div>
            </div>
        </Card>
    );
};

export default SalesChannels;
