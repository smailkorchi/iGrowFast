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
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Sales Channels</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Connect and manage external storefronts</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <Input
                                placeholder="Search channels..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-7 h-8 rounded-md border-gray-200 bg-white text-[11px] w-52"
                            />
                        </div>
                        <Button
                            onClick={() => openUpsert()}
                            className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 px-3 rounded-md text-[11px] font-semibold gap-1.5 shrink-0"
                        >
                            <Plus className="w-3.5 h-3.5" /> New Channel
                        </Button>
                    </div>
                </div>
            </header>

            {/* Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                {isLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-44 w-full rounded-xl" />
                    ))
                ) : filteredChannels?.length === 0 ? (
                    <div className="col-span-full border border-dashed border-gray-200 rounded-xl py-8 flex flex-col items-center justify-center text-center gap-2">
                        <LayoutGrid className="w-5 h-5 text-gray-300" />
                        <p className="text-[11px] font-semibold text-brand-navy">No channels linked</p>
                        <p className="text-[10px] text-gray-400">Connect WooCommerce or Google Sheets to get started.</p>
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
                <DialogContent className="max-w-lg p-0 border border-gray-100 rounded-xl shadow-none overflow-hidden">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleUpsert)} className="flex flex-col">
                            <DialogHeader className="px-4 pt-4 pb-3 border-b border-gray-100">
                                <div className="flex items-center justify-between">
                                    <DialogTitle className="text-[13px] font-semibold text-brand-navy">
                                        {editingChannel ? 'Update Connection' : 'New Connection'}
                                    </DialogTitle>
                                    {LOGOS[channelType] && (
                                        <div className="w-7 h-7 bg-gray-50 border border-gray-100 rounded-md p-1 flex items-center justify-center">
                                            <img src={LOGOS[channelType]} alt={channelType} className="w-full h-full object-contain" />
                                        </div>
                                    )}
                                </div>
                            </DialogHeader>

                            <div className="p-4 space-y-3 max-h-[65vh] overflow-y-auto bg-white">
                                <div className="grid grid-cols-2 gap-3">
                                    <FormField
                                        control={form.control}
                                        name="name"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[10px] font-semibold text-gray-600">Display Name</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="e.g. Primary Store" {...field} className="h-8 text-[11px] rounded-md border-gray-200" />
                                                </FormControl>
                                                <FormMessage className="text-[10px]" />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="type"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[10px] font-semibold text-gray-600">Platform Type</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger className="h-8 text-[11px] rounded-md border-gray-200">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="Woocommerce" className="text-[11px]">Woocommerce</SelectItem>
                                                        <SelectItem value="Google Sheets" className="text-[11px]">Google Sheets</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                {channelType === 'Woocommerce' && (
                                    <div className="space-y-3">
                                        <FormField
                                            control={form.control}
                                            name="url"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-[10px] font-semibold text-gray-600">Store URL</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="https://yourstore.com" {...field} className="h-8 text-[11px] rounded-md border-gray-200" />
                                                    </FormControl>
                                                    <FormMessage className="text-[10px]" />
                                                </FormItem>
                                            )}
                                        />
                                        <div className="grid grid-cols-2 gap-3">
                                            <FormField
                                                control={form.control}
                                                name="consumer_key"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-[10px] font-semibold text-gray-600">Consumer Key</FormLabel>
                                                        <FormControl>
                                                            <Input type="password" placeholder="ck_..." {...field} className="h-8 text-[11px] rounded-md border-gray-200" />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={form.control}
                                                name="consumer_secret"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-[10px] font-semibold text-gray-600">Consumer Secret</FormLabel>
                                                        <FormControl>
                                                            <Input type="password" placeholder="cs_..." {...field} className="h-8 text-[11px] rounded-md border-gray-200" />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </div>
                                )}

                                {channelType === 'Google Sheets' && (
                                    <div className="space-y-3">
                                        <div className="grid grid-cols-2 gap-3">
                                            <FormField
                                                control={form.control}
                                                name="spreadsheet_id"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-[10px] font-semibold text-gray-600">Spreadsheet ID</FormLabel>
                                                        <FormControl>
                                                            <Input placeholder="ID from URL" {...field} className="h-8 text-[11px] rounded-md border-gray-200" />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={form.control}
                                                name="spreadsheet_name"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-[10px] font-semibold text-gray-600">Sheet/Tab Name</FormLabel>
                                                        <FormControl>
                                                            <Input placeholder="e.g. Sheet1" {...field} className="h-8 text-[11px] rounded-md border-gray-200" />
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
                                                    <FormLabel className="text-[10px] font-semibold text-gray-600">Data Starts At Row</FormLabel>
                                                    <FormControl>
                                                        <Input type="number" placeholder="1" {...field} className="h-8 text-[11px] rounded-md border-gray-200 w-28" />
                                                    </FormControl>
                                                    <FormMessage className="text-[10px]" />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                )}
                            </div>

                            <DialogFooter className="px-4 py-3 border-t border-gray-100 bg-white gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setIsUpsertOpen(false)}
                                    className="h-8 px-3 rounded-md text-[11px] font-semibold border-gray-200"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={upsertMutation.isPending}
                                    className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 px-3 rounded-md text-[11px] font-semibold gap-1.5"
                                >
                                    {upsertMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                    {editingChannel ? 'Update' : 'Connect'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* Delete Dialog */}
            <AlertDialog open={!!channelToDelete} onOpenChange={() => setChannelToDelete(null)}>
                <AlertDialogContent className="max-w-sm rounded-xl border border-gray-100 p-4">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[13px] font-semibold text-brand-navy">Remove channel?</AlertDialogTitle>
                        <AlertDialogDescription className="text-[11px] text-gray-500">
                            Disconnecting <span className="font-semibold text-brand-navy">"{channelToDelete?.name}"</span> will stop all data sync.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="gap-2 mt-3">
                        <AlertDialogCancel className="h-8 px-3 rounded-md text-[11px] font-semibold border-gray-200">
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => deleteMutation.mutate(channelToDelete.id)}
                            className="h-8 px-3 rounded-md text-[11px] font-semibold bg-red-500 hover:bg-red-600 text-white"
                        >
                            {deleteMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                            Disconnect
                        </AlertDialogAction>
                    </AlertDialogFooter>
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
        <Card className="border border-gray-100 shadow-none rounded-xl overflow-hidden cursor-default">
            <CardContent className="p-3.5 space-y-3">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-gray-50 border border-gray-100 rounded-lg p-1.5 flex items-center justify-center shrink-0">
                            {LOGOS[channel.type as keyof typeof LOGOS] ? (
                                <img src={LOGOS[channel.type as keyof typeof LOGOS]!} alt={channel.type} className="w-full h-full object-contain" />
                            ) : (
                                <Globe className="w-4 h-4 text-brand-navy/40" />
                            )}
                        </div>
                        <div>
                            <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold leading-none">{channel.type}</p>
                            <h3 className="text-[12px] font-semibold text-brand-navy tracking-tight leading-tight mt-0.5 line-clamp-1">
                                {channel.name}
                            </h3>
                        </div>
                    </div>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md hover:bg-gray-100 text-gray-400">
                                <MoreVertical className="h-3.5 w-3.5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-lg border border-gray-100 shadow-sm p-1 min-w-[140px]">
                            {isSheets && (
                                <>
                                    <DropdownMenuItem className="rounded-md px-2 py-1.5 cursor-pointer text-[11px] font-medium gap-2">
                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Check Data
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator className="my-1" />
                                </>
                            )}
                            <DropdownMenuItem onClick={onEdit} className="rounded-md px-2 py-1.5 cursor-pointer text-[11px] font-medium gap-2">
                                <Edit2 className="w-3.5 h-3.5 text-gray-400" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="my-1" />
                            <DropdownMenuItem onClick={onDelete} className="rounded-md px-2 py-1.5 cursor-pointer text-[11px] font-medium gap-2 text-red-500">
                                <Trash2 className="w-3.5 h-3.5" /> Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <div className="space-y-1.5 bg-gray-50 rounded-lg p-2.5">
                    {isWoo && (
                        <>
                            <div className="flex items-center gap-1.5">
                                <Globe className="w-3 h-3 text-gray-400 shrink-0" />
                                <span className="text-[10px] text-brand-navy/70 truncate">{channel.url}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <ShieldCheck className="w-3 h-3 text-emerald-500 shrink-0" />
                                <span className="text-[10px] text-gray-400 uppercase tracking-wide">Secured API Keys</span>
                            </div>
                        </>
                    )}
                    {isSheets && (
                        <>
                            <div className="flex items-center gap-1.5">
                                <Database className="w-3 h-3 text-green-600 shrink-0" />
                                <span className="text-[10px] text-brand-navy/70 uppercase">Sheet: {channel.spreadsheet_name}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <Key className="w-3 h-3 text-amber-500 shrink-0" />
                                <span className="text-[9px] text-gray-400 truncate font-mono">{channel.spreadsheet_id}</span>
                            </div>
                        </>
                    )}
                    {!isWoo && !isSheets && (
                        <p className="text-[10px] text-gray-400 text-center py-1">External custom hook</p>
                    )}
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                        <Badge className="h-5 px-1.5 text-[9px] bg-emerald-50 text-emerald-600 border-none font-semibold">Live</Badge>
                    </div>
                    {channel.url && (
                        <a href={channel.url} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-brand-navy transition-colors">
                            <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

export default SalesChannels;
