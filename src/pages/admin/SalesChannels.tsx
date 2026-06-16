import React, { useMemo, useState } from 'react';
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
    Lock,
    Key,
    LayoutGrid,
    CheckCircle2,
    Sparkles,
    Link2,
    Copy,
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

const salesChannelSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    type: z.enum(['Google Sheets']).default('Google Sheets'),
    spreadsheet_id: z.string().optional().or(z.literal('')),
    spreadsheet_name: z.string().optional().or(z.literal('')),
    start_row: z.coerce.number().min(1, "Row must be at least 1").default(1),
    sync_cadence: z.enum(['manual', '15min', 'hourly']).default('manual'),
});

type SalesChannelFormValues = z.infer<typeof salesChannelSchema>;

// Accepts a full Google Sheets URL (.../spreadsheets/d/<ID>/edit...) or a bare ID; returns just the ID.
const extractSheetId = (input: string): string => {
    const m = (input || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : (input || '').trim();
};

// The service-account email each business must share its sheet with (Viewer access).
const SHEETS_SA_EMAIL = 'sheets@igrowfast.iam.gserviceaccount.com';

const SaEmailShare: React.FC = () => {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(SHEETS_SA_EMAIL);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        } catch { /* clipboard unavailable */ }
    };
    return (
        <div className="flex items-center gap-2.5 rounded-xl border border-ant-orange/25 bg-ant-orange/[0.06] px-3 py-2.5">
            <Database className="w-4 h-4 text-ant-orange shrink-0" />
            <span className="text-[11px] text-ant-mid shrink-0 hidden sm:inline">Share your sheet (Viewer) with</span>
            <code className="text-[11px] md:text-[12px] font-mono text-ant-ink truncate flex-1 min-w-0">{SHEETS_SA_EMAIL}</code>
            <button
                type="button"
                onClick={copy}
                className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-paper px-3 py-1 text-[11px] font-semibold text-ant-ink hover:bg-ant-light cursor-pointer shrink-0 transition-colors"
            >
                {copied ? <><CheckCircle2 className="w-3.5 h-3.5 text-ant-green" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
            </button>
        </div>
    );
};

const LOGOS: Record<string, string> = {
    "Google Sheets": "https://cdn.pixabay.com/photo/2017/03/08/21/21/spreadsheet-2127832_1280.png"
};

const KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
} as const;

const ChannelKpi: React.FC<{
    label: string;
    value: number | string;
    suffix?: string;
    accent: keyof typeof KPI_ACCENTS;
    icon: LucideIcon;
}> = ({ label, value, suffix, accent, icon: Icon }) => {
    const a = KPI_ACCENTS[accent];
    return (
        <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                    <span className={cn('h-1.5 w-1.5 rounded-full', a.dot)} />
                    {label}
                </div>
                <div className={cn('h-8 w-8 rounded-lg border flex items-center justify-center', a.tile)}>
                    <Icon className="w-4 h-4" strokeWidth={1.75} />
                </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                {value}
                {suffix ? <span className="text-[12px] text-ant-mid font-normal ml-1.5">{suffix}</span> : null}
            </p>
        </div>
    );
};

const SalesChannels = () => {
    const [isUpsertOpen, setIsUpsertOpen] = useState(false);
    const [editingChannel, setEditingChannel] = useState<any>(null);
    const [channelToDelete, setChannelToDelete] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");

    const { toast } = useToast();
    const queryClient = useQueryClient();

    const activeBusinessId = localStorage.getItem('activeBusinessId');

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

    const form = useForm<SalesChannelFormValues>({
        resolver: zodResolver(salesChannelSchema),
        defaultValues: {
            name: '',
            type: 'Google Sheets',
            spreadsheet_id: '',
            spreadsheet_name: '',
            start_row: 1,
        }
    });

    const channelType = form.watch('type');

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

    const checkNowMutation = useMutation({
        mutationFn: async (channelId: string) => {
            const { data, error } = await supabase.functions.invoke('sheets-sync', {
                body: { action: 'sync_channel', channel_id: channelId },
            });
            if (error) throw new Error(error.message);
            const res = data as { ok: boolean; error?: string; inserted?: number; skipped?: number; needs_review?: number };
            if (!res?.ok) throw new Error(res?.error || 'Sync failed');
            return res;
        },
        onSuccess: (res: any) => {
            queryClient.invalidateQueries({ queryKey: ['sales_channels'] });
            toast({
                title: 'Sync complete',
                description: `${res.inserted ?? 0} new draft(s), ${res.skipped ?? 0} already imported${res.needs_review ? `, ${res.needs_review} need attention` : ''}. Review them in Sheet Review.`,
            });
        },
        onError: (error: any) => {
            toast({ title: 'Sync failed', description: error.message, variant: 'destructive' });
        },
    });

    const handleUpsert = (values: SalesChannelFormValues) => {
        upsertMutation.mutate(values);
    };

    const openUpsert = (channel: any = null) => {
        if (channel) {
            setEditingChannel(channel);
            form.reset({
                name: channel.name,
                type: 'Google Sheets',
                spreadsheet_id: channel.spreadsheet_id || '',
                spreadsheet_name: channel.spreadsheet_name || '',
                start_row: channel.start_row || 1,
                sync_cadence: channel.sync_cadence || 'manual',
            });
        } else {
            setEditingChannel(null);
            form.reset({
                name: '',
                type: 'Google Sheets',
                spreadsheet_id: '',
                spreadsheet_name: '',
                start_row: 1,
                sync_cadence: 'manual',
            });
        }
        setIsUpsertOpen(true);
    };

    const filteredChannels = channels?.filter((c: any) =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.type.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const totals = useMemo(() => {
        const list = (channels || []) as any[];
        return {
            total: list.length,
            sheets: list.filter((c) => c.type === 'Google Sheets').length,
        };
    }, [channels]);

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Integrations · Storefronts
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Sales channels
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Connect a Google Sheet and your orders show up here, attributed to the right channel. More platforms land soon.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <div className="relative w-full md:w-[240px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                            <Input
                                placeholder="Search channels..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                            />
                        </div>
                        <Button
                            onClick={() => openUpsert()}
                            className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                        >
                            <Plus className="w-4 h-4" /> New channel
                        </Button>
                    </div>
                </header>

                <SaEmailShare />

                {/* KPI strip */}
                {isLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        {Array.from({ length: 2 }).map((_, i) => (
                            <div key={i} className="bg-ant-paper p-4"><Skeleton className="h-12 rounded-lg" /></div>
                        ))}
                    </div>
                ) : (
                    <section className="grid grid-cols-1 md:grid-cols-2 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        <ChannelKpi label="Total" value={totals.total} suffix="connected" accent="ink" icon={Link2} />
                        <ChannelKpi label="Google Sheets" value={totals.sheets} suffix="sheets" accent="green" icon={Database} />
                    </section>
                )}

                {/* Grid */}
                {isLoading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <Skeleton key={i} className="h-48 w-full rounded-2xl" />
                        ))}
                    </div>
                ) : filteredChannels?.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                        <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                            <LayoutGrid className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                        </div>
                        <h3 className="font-display text-[18px] text-ant-ink tracking-tight">
                            {channels?.length ? 'No channels match that search' : 'No channels connected yet'}
                        </h3>
                        <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                            {channels?.length
                                ? 'Loosen the search to bring integrations back into view.'
                                : 'Connect your first Google Sheet and orders will flow straight in.'}
                        </p>
                        {!channels?.length && (
                            <Button
                                onClick={() => openUpsert()}
                                className="mt-5 bg-ant-ink hover:bg-ant-ink/90 text-white h-9 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                            >
                                <Plus className="w-4 h-4" />
                                Connect your first channel
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {filteredChannels?.map((channel: any) => (
                            <ChannelCard
                                key={channel.id}
                                channel={channel}
                                onEdit={() => openUpsert(channel)}
                                onDelete={() => setChannelToDelete(channel)}
                                onCheck={() => checkNowMutation.mutate(channel.id)}
                                isChecking={checkNowMutation.isPending && checkNowMutation.variables === channel.id}
                            />
                        ))}
                    </div>
                )}

                {/* Upsert Modal */}
                <Dialog open={isUpsertOpen} onOpenChange={setIsUpsertOpen}>
                    <DialogContent className="max-w-lg p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(handleUpsert)} className="flex flex-col">
                                <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-1.5 min-w-0">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                                {editingChannel ? 'Edit · Channel' : 'New · Channel'}
                                            </div>
                                            <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">
                                                {editingChannel ? 'Update connection' : 'Connect a new channel'}
                                            </DialogTitle>
                                            <DialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                                Paste the keys once — iGrowFast handles the sync from here.
                                            </DialogDescription>
                                        </div>
                                        {LOGOS[channelType] && (
                                            <div className="w-12 h-12 bg-ant-light border border-ant-line rounded-2xl p-2 flex items-center justify-center shrink-0">
                                                <img src={LOGOS[channelType]} alt={channelType} className="w-full h-full object-contain" />
                                            </div>
                                        )}
                                    </div>
                                </DialogHeader>

                                <div className="ant-scroll p-6 space-y-4 max-h-[65vh] overflow-y-auto">
                                    <div className="grid grid-cols-2 gap-3">
                                        <FormField
                                            control={form.control}
                                            name="name"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Display name</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="e.g. Primary Store" {...field} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40" />
                                                    </FormControl>
                                                    <FormMessage className="text-ant-rose" />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="type"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Platform type</FormLabel>
                                                    <Select onValueChange={field.onChange} value={field.value} disabled>
                                                        <FormControl>
                                                            <SelectTrigger className="h-10 rounded-xl border-ant-line bg-ant-light/60 text-[12px] text-ant-ink disabled:opacity-100 disabled:cursor-not-allowed">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent className="rounded-xl border-ant-line">
                                                            <SelectItem value="Google Sheets" className="text-[12px]">Google Sheets</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                    <p className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.18em] text-ant-mid">
                                                        <Lock className="w-2.5 h-2.5" /> More platforms soon
                                                    </p>
                                                </FormItem>
                                            )}
                                        />
                                    </div>

                                    <div className="space-y-3 rounded-2xl border border-ant-line bg-ant-light/40 p-4">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <Database className="w-3 h-3" />
                                            Google Sheets credentials
                                        </div>
                                        <SaEmailShare />
                                        <div className="grid grid-cols-2 gap-3">
                                            <FormField
                                                control={form.control}
                                                name="spreadsheet_id"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Spreadsheet link or ID</FormLabel>
                                                        <FormControl>
                                                            <Input placeholder="Paste the Google Sheets link" {...field} onChange={(e) => field.onChange(extractSheetId(e.target.value))} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] font-mono text-ant-ink placeholder:text-ant-mid" />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={form.control}
                                                name="spreadsheet_name"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Tab name</FormLabel>
                                                        <FormControl>
                                                            <Input placeholder="e.g. Sheet1" {...field} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid" />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                        <FormField
                                            control={form.control}
                                            name="start_row"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Data starts at row</FormLabel>
                                                    <FormControl>
                                                        <Input type="number" placeholder="1" {...field} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink tabular-nums w-32" />
                                                    </FormControl>
                                                    <FormMessage className="text-ant-rose" />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="sync_cadence"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Auto-sync</FormLabel>
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <FormControl>
                                                            <SelectTrigger className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink w-56">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent className="rounded-xl border-ant-line">
                                                            <SelectItem value="manual" className="text-[12px]">Manual — Check now only</SelectItem>
                                                            <SelectItem value="15min" className="text-[12px]">Every 15 minutes</SelectItem>
                                                            <SelectItem value="hourly" className="text-[12px]">Hourly</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                    <p className="text-[9px] uppercase tracking-[0.18em] text-ant-mid">Synced orders always wait for your approval</p>
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
                                        {upsertMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                        {editingChannel ? 'Save changes' : 'Connect channel'}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </Form>
                    </DialogContent>
                </Dialog>

                {/* Delete Dialog */}
                <AlertDialog open={!!channelToDelete} onOpenChange={() => setChannelToDelete(null)}>
                    <AlertDialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                        <AlertDialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-rose">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                                Destructive action
                            </div>
                            <AlertDialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">Disconnect this channel?</AlertDialogTitle>
                            <AlertDialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                Disconnecting <span className="not-italic font-semibold text-ant-ink">&ldquo;{channelToDelete?.name}&rdquo;</span> stops all order sync from this storefront. Past orders remain untouched.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="px-6 py-4 gap-2">
                            <AlertDialogCancel className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer border-0">
                                Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => deleteMutation.mutate(channelToDelete.id)}
                                className="h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-rose hover:bg-ant-rose/90 text-white gap-2 cursor-pointer"
                            >
                                {deleteMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                <Trash2 className="w-3.5 h-3.5" />
                                Disconnect
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </div>
    );
};

// --- Channel Card ---
const ChannelCard = ({ channel, onEdit, onDelete, onCheck, isChecking }: any) => {
    const sheetUrl = channel.spreadsheet_id
        ? `https://docs.google.com/spreadsheets/d/${channel.spreadsheet_id}`
        : null;

    return (
        <div className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper hover:border-ant-ink/20 hover:shadow-[0_16px_48px_-20px_rgba(20,20,19,0.15)] transition-all">
            <div className="h-[3px] w-full bg-ant-green" />
            <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 bg-ant-light border border-ant-line rounded-xl p-2 flex items-center justify-center shrink-0">
                            {LOGOS[channel.type as keyof typeof LOGOS] ? (
                                <img src={LOGOS[channel.type as keyof typeof LOGOS]!} alt={channel.type} className="w-full h-full object-contain" />
                            ) : (
                                <Globe className="w-4 h-4 text-ant-mid" />
                            )}
                        </div>
                        <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-[0.24em] text-ant-mid font-semibold">{channel.type}</p>
                            <h3 className="font-display text-[14px] font-semibold text-ant-ink tracking-tight leading-tight mt-0.5 line-clamp-1">
                                {channel.name}
                            </h3>
                        </div>
                    </div>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-ant-ink/5 text-ant-mid shrink-0 cursor-pointer">
                                <MoreVertical className="h-3.5 w-3.5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xl border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)] p-1 min-w-[160px]">
                            <DropdownMenuItem onClick={onCheck} disabled={isChecking} className="rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium gap-2 text-ant-ink">
                                {isChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 text-ant-green" />} Check now
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="my-1 bg-ant-line" />
                            <DropdownMenuItem onClick={onEdit} className="rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium gap-2 text-ant-ink">
                                <Edit2 className="w-3.5 h-3.5 text-ant-orange" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="my-1 bg-ant-line" />
                            <DropdownMenuItem onClick={onDelete} className="rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium gap-2 text-ant-rose focus:text-ant-rose focus:bg-ant-rose/10">
                                <Trash2 className="w-3.5 h-3.5" /> Disconnect
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <div className="space-y-2 rounded-xl border border-ant-line bg-ant-light/60 p-3">
                    <div className="flex items-center gap-2">
                        <Database className="w-3.5 h-3.5 text-ant-green shrink-0" />
                        <span className="text-[11px] text-ant-ink font-medium truncate">Sheet · {channel.spreadsheet_name || '—'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Key className="w-3.5 h-3.5 text-ant-orange shrink-0" />
                        <span className="text-[10px] text-ant-mid truncate font-mono tabular-nums">{channel.spreadsheet_id || '—'}</span>
                    </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-ant-line">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-green/25 bg-ant-green/10 px-2 py-0.5 text-[10px] font-semibold text-ant-green">
                        <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                        Live
                    </span>
                    {sheetUrl && (
                        <a
                            href={sheetUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-[11px] text-ant-mid hover:text-ant-ink font-semibold transition-colors"
                        >
                            Open sheet
                            <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SalesChannels;
