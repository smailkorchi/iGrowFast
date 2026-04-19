import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus,
    Search,
    MoreVertical,
    Edit2,
    Trash2,
    Webhook,
    Shield,
    Link as LinkIcon,
    Loader2,
    CheckCircle2,
    Building2,
    ExternalLink,
    Zap,
    Clock,
    Activity,
    Database,
    History,
    Key,
    Copy,
    Check,
    AlertCircle,
    ArrowRight
} from 'lucide-react';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription
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
    FormDescription,
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
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

// Types casting for tables not yet in generated schema
const WEBHOOKS_TABLE = 'provider_webhooks' as any;
const PROVIDERS_TABLE = 'providers' as any;
const LOGS_TABLE = 'webhook_logs' as any;
const STATUS_MAP_TABLE = 'provider_statuses' as any;

const WEBHOOK_BASE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provider-webhook`;

// --- Schemas ---

const webhookSchema = z.object({
    provider_id: z.string().uuid("Please select a provider"),
    webhook_url: z.string().url("Invalid URL format").or(z.literal('')),
    webhook_secret: z.string().min(8, "Secret must be at least 8 characters"),
    is_active: z.boolean().default(true),
});

const statusMapSchema = z.object({
    provider_id: z.string().uuid("Please select a provider"),
    status_code: z.string().min(1, "Original status code required"),
    mapped_status: z.string().min(1, "Mapped status name required"),
});

type WebhookValues = z.infer<typeof webhookSchema>;
type StatusMapValues = z.infer<typeof statusMapSchema>;

const Webhooks = () => {
    const [activeTab, setActiveTab] = useState("endpoints");
    const [isHookModalOpen, setIsHookModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // --- Queries ---
    const { data: webhooks, isLoading: hooksLoading } = useQuery({
        queryKey: ['provider_webhooks', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from(WEBHOOKS_TABLE)
                .select('*, providers(id, name, logo_url)')
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (data as any[]) || [];
        }
    });

    const { data: logs, isLoading: logsLoading } = useQuery({
        queryKey: ['webhook_logs', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from(LOGS_TABLE)
                .select('*, providers(name)')
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false })
                .limit(50);
            if (error) throw error;
            return (data as any[]) || [];
        },
        refetchInterval: 5000 // Auto-refresh logs every 5 seconds
    });

    const { data: providers } = useQuery({
        queryKey: ['providers', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from(PROVIDERS_TABLE)
                .select('id, name, logo_url')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return (data as any[]) || [];
        }
    });

    // --- Mutations ---
    const hookMutation = useMutation({
        mutationFn: async ({ values, id }: { values: WebhookValues, id?: string }) => {
            const fullGeneratedUrl = `${WEBHOOK_BASE_URL}/${values.provider_id}/${values.webhook_secret}`;
            const dataToSave = {
                ...values,
                webhook_url: fullGeneratedUrl,
                'DigiCom Business': activeBusinessId
            };

            if (id) {
                const { error } = await supabase.from(WEBHOOKS_TABLE)
                    .update(dataToSave as any)
                    .eq('id', id)
                    .eq('DigiCom Business', activeBusinessId);
                if (error) throw error;
            } else {
                const { error } = await supabase.from(WEBHOOKS_TABLE).insert([dataToSave as any]);
                if (error) throw error;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['provider_webhooks', activeBusinessId] });
            setIsHookModalOpen(false);
            setEditingItem(null);
            toast({ title: "Webhook Updated", description: "Changes saved successfully." });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async ({ table, id }: { table: any, id: string }) => {
            const { error } = await supabase.from(table)
                .delete()
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: [variables.table, activeBusinessId] });
            toast({ title: "Removed", description: "Endpoint successfully deleted." });
        }
    });

    const generateSecret = () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 32; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    };

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header — compact Analytics style */}
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                    <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">
                        Webhook Gateway
                    </h1>
                    <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">
                        Real-time ingestion from delivery partners
                    </p>
                </div>
                <Button
                    size="sm"
                    onClick={() => {
                        setEditingItem(null);
                        setIsHookModalOpen(true);
                    }}
                    className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 px-3 rounded-md text-[11px] font-semibold gap-1.5 shrink-0"
                >
                    <Plus className="w-3.5 h-3.5" /> New gateway
                </Button>
            </header>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-3">
                <TabsList className="h-8">
                    <TabsTrigger value="endpoints" className="text-[11px] h-6 px-3 gap-1.5">
                        <Zap className="w-3 h-3" /> Provider gateways
                    </TabsTrigger>
                    <TabsTrigger value="logs" className="text-[11px] h-6 px-3 gap-1.5">
                        <History className="w-3 h-3" /> Live event log
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="endpoints" className="m-0">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                        {hooksLoading ? (
                            [1, 2, 3].map(i => <div key={i} className="h-36 rounded-xl bg-white border border-gray-100 animate-pulse" />)
                        ) : webhooks?.length ? (
                            webhooks.map(hook => (
                                <WebhookCard
                                    key={hook.id}
                                    hook={hook}
                                    projectUrl={WEBHOOK_BASE_URL}
                                    onEdit={() => { setEditingItem(hook); setIsHookModalOpen(true); }}
                                    onDelete={() => { if (confirm('Terminate this gateway and stop receiving updates?')) deleteMutation.mutate({ table: WEBHOOKS_TABLE, id: hook.id }); }}
                                />
                            ))
                        ) : (
                            <EmptyState icon={<Webhook className="w-5 h-5" />} title="No gateways found" description="Connect your first delivery partner to start receiving automated updates." />
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="logs" className="m-0">
                    <div className="bg-white rounded-xl overflow-hidden border border-gray-100">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-gray-50/60">
                                    <th className="px-3 py-2 text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400">Timestamp</th>
                                    <th className="px-3 py-2 text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400">Provider</th>
                                    <th className="px-3 py-2 text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400">Object / tracking</th>
                                    <th className="px-3 py-2 text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400">Result</th>
                                    <th className="px-3 py-2 text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400 text-right">Raw data</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logsLoading ? (
                                    <tr><td colSpan={5} className="p-6 text-center text-[11px] text-gray-400">Accessing logs…</td></tr>
                                ) : logs?.length ? (
                                    logs.map(log => (
                                        <tr key={log.id} className="border-t border-gray-50 hover:bg-gray-50/40 transition-colors">
                                            <td className="px-3 py-2 text-[10px] text-gray-500 tabular-nums">{format(new Date(log.created_at), 'MMM dd, HH:mm:ss')}</td>
                                            <td className="px-3 py-2 text-[11px] font-semibold text-brand-navy">{log.providers?.name || 'Unknown'}</td>
                                            <td className="px-3 py-2 font-mono text-[10px] text-brand-navy/70">{log.tracking_code || '—'}</td>
                                            <td className="px-3 py-2">
                                                <Badge
                                                    variant="outline"
                                                    className={cn(
                                                        "text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0 h-5 border",
                                                        log.processed ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-red-50 text-red-700 border-red-100"
                                                    )}
                                                >
                                                    {log.processed ? 'Processed' : 'Failed'}
                                                </Badge>
                                                {log.error_message && <p className="text-[9px] text-red-500 mt-0.5">{log.error_message}</p>}
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                <Button
                                                    size="sm"
                                                    onClick={() => { console.log(log.payload); toast({ title: "Payload logged", description: "Full JSON is in the browser console." }); }}
                                                    variant="ghost"
                                                    className="h-6 px-2 rounded-md text-[10px] font-semibold text-brand-navy/70 hover:text-brand-navy hover:bg-gray-100"
                                                >
                                                    Debug JSON
                                                </Button>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr><td colSpan={5} className="p-10 text-center text-[11px] text-gray-400">Waiting for incoming triggers…</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </TabsContent>
            </Tabs>

            {/* Modals */}
            <WebhookModal
                isOpen={isHookModalOpen}
                onClose={() => setIsHookModalOpen(false)}
                onSubmit={(v) => hookMutation.mutate({ values: v, id: editingItem?.id })}
                initialData={editingItem}
                providers={providers || []}
                loading={hookMutation.isPending}
                onGenerateSecret={generateSecret}
            />
        </div>
    );
};

// --- Specialized Components ---

const WebhookCard = ({ hook, projectUrl, onEdit, onDelete }: any) => {
    const [copied, setCopied] = useState(false);
    const fullUrl = `${projectUrl}/${hook.provider_id}/${hook.webhook_secret}`;

    const handleCopy = () => {
        navigator.clipboard.writeText(fullUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Card className="relative overflow-hidden border border-gray-100 shadow-none bg-white rounded-xl flex flex-col h-full">
            <div className={cn(
                "absolute top-0 left-0 w-full h-[3px]",
                hook.is_active ? "bg-emerald-500" : "bg-gray-200"
            )} />

            <CardHeader className="flex flex-row items-start justify-between p-3 pb-2 space-y-0">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="h-8 w-8 rounded-md bg-gray-50 border border-gray-100 p-1 flex items-center justify-center overflow-hidden shrink-0">
                        {hook.providers?.logo_url ? (
                            <img src={hook.providers.logo_url} alt="" className="max-w-full max-h-full object-contain" />
                        ) : (
                            <Building2 className="w-4 h-4 text-brand-navy/20" />
                        )}
                    </div>
                    <div className="min-w-0">
                        <CardTitle className="text-[12px] font-semibold text-brand-navy tracking-tight leading-tight truncate">{hook.providers?.name}</CardTitle>
                        <div className="flex items-center gap-1 mt-0.5">
                            <div className={cn("w-1.5 h-1.5 rounded-full", hook.is_active ? "bg-emerald-500 animate-pulse" : "bg-gray-300")} />
                            <span className={cn("text-[9px] font-bold uppercase tracking-[0.14em]", hook.is_active ? "text-emerald-600" : "text-gray-400")}>
                                {hook.is_active ? 'Live' : 'Ignored'}
                            </span>
                        </div>
                    </div>
                </div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="rounded-md h-6 w-6 hover:bg-gray-50 shadow-none -mr-1 -mt-1">
                            <MoreVertical className="w-3.5 h-3.5 text-gray-400" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-md min-w-[160px]">
                        <DropdownMenuItem onClick={onEdit} className="text-[11px] font-medium text-brand-navy">
                            <Edit2 className="w-3 h-3 mr-2 text-gray-400" /> Configure
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={onDelete} className="text-[11px] font-medium text-red-600 hover:bg-red-50 focus:bg-red-50">
                            <Trash2 className="w-3 h-3 mr-2" /> Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardHeader>

            <CardContent className="px-3 pb-3 space-y-2">
                <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400">Callback URL</label>
                    <div className="px-2 py-1.5 rounded-md bg-gray-50 border border-gray-100 flex items-center justify-between gap-1.5">
                        <span className="text-[10px] font-mono text-brand-navy/70 truncate select-all">
                            {fullUrl}
                        </span>
                        <Button
                            onClick={handleCopy}
                            variant="ghost"
                            size="icon"
                            className="shrink-0 h-6 w-6 rounded-md hover:bg-white"
                        >
                            {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-gray-400" />}
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                    <div className="px-2 py-1.5 rounded-md bg-gray-50 border border-gray-100">
                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.14em] mb-0.5 flex items-center gap-1">
                            <Key className="w-2.5 h-2.5" /> Secret
                        </p>
                        <p className="text-[11px] font-semibold text-brand-navy/50 tracking-widest">••••••••</p>
                    </div>
                    <div className="px-2 py-1.5 rounded-md bg-gray-50 border border-gray-100">
                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.14em] mb-0.5 flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" /> Last beat
                        </p>
                        <p className="text-[11px] font-semibold text-brand-navy tabular-nums truncate">
                            {hook.last_received_at ? format(new Date(hook.last_received_at), 'MMM dd, HH:mm:ss') : '—'}
                        </p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

const WebhookModal = ({ isOpen, onClose, onSubmit, initialData, providers, loading, onGenerateSecret }: any) => {
    const form = useForm<WebhookValues>({
        resolver: zodResolver(webhookSchema),
        defaultValues: {
            provider_id: '',
            webhook_url: '',
            webhook_secret: '',
            is_active: true
        }
    });

    React.useEffect(() => {
        if (isOpen && initialData) {
            form.reset({
                provider_id: initialData.provider_id,
                webhook_url: initialData.webhook_url || '',
                webhook_secret: initialData.webhook_secret,
                is_active: initialData.is_active
            });
        } else if (isOpen) {
            form.reset({ provider_id: '', webhook_url: '', webhook_secret: onGenerateSecret(), is_active: true });
        }
    }, [isOpen, initialData, form, onGenerateSecret]);

    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)}>
                        <DialogHeader className="p-10 pb-6 bg-brand-navy/[0.02]">
                            <DialogTitle className="text-3xl font-black text-brand-navy tracking-tight">Endpoint Connectivity</DialogTitle>
                            <DialogDescription className="text-base font-semibold text-slate-500">Enable real-time data sync with your delivery partners.</DialogDescription>
                        </DialogHeader>

                        <div className="p-10 pt-6 space-y-6">
                            <FormField control={form.control} name="provider_id" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[10px] font-black uppercase tracking-widest text-brand-navy/30">Target Partner</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger className="h-14 rounded-2xl border-none bg-brand-navy/5 font-black shadow-inner px-6 text-brand-navy text-base">
                                                <SelectValue placeholder="Identify provider..." />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent className="rounded-2xl border-none shadow-2xl p-2">
                                            {providers.map((p: any) => (
                                                <SelectItem key={p.id} value={p.id} className="font-bold p-3 rounded-xl">{p.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )} />

                            <FormField control={form.control} name="webhook_secret" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[10px] font-black uppercase tracking-widest text-brand-navy/30">Verification HMAC Secret</FormLabel>
                                    <FormControl>
                                        <div className="relative group">
                                            <Shield className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-navy/20" />
                                            <Input placeholder="Generated uniquely..." {...field} className="h-14 pl-14 rounded-2xl border-none bg-brand-navy/5 text-brand-navy font-black shadow-inner" />
                                            <Button type="button" onClick={() => field.onChange(onGenerateSecret())} variant="ghost" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl text-[10px] font-black text-brand-navy hover:bg-white shadow-none uppercase">Regenerate</Button>
                                        </div>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />

                            <FormField control={form.control} name="is_active" render={({ field }) => (
                                <FormItem className="flex items-center justify-between p-5 bg-brand-navy/5 rounded-3xl border border-brand-navy/[0.03] shadow-inner">
                                    <div className="space-y-0.5">
                                        <FormLabel className="text-sm font-black text-brand-navy leading-none">Global Connectivity</FormLabel>
                                        <p className="text-[10px] font-bold text-slate-400">Disable to block all incoming events from this provider</p>
                                    </div>
                                    <Button
                                        type="button"
                                        className={cn(
                                            "rounded-xl h-10 px-5 font-black transition-all shadow-lg",
                                            field.value ? "bg-emerald-500 text-white shadow-emerald-500/20" : "bg-slate-300 text-white shadow-slate-300/20"
                                        )}
                                        onClick={() => field.onChange(!field.value)}
                                    >
                                        {field.value ? 'ONLINE' : 'OFFLINE'}
                                    </Button>
                                </FormItem>
                            )} />
                        </div>

                        <DialogFooter className="p-10 pt-0">
                            <Button type="submit" disabled={loading} className="w-full bg-brand-navy hover:bg-brand-navy/90 text-white rounded-[24px] h-16 text-lg font-black shadow-2xl transition-all active:scale-[0.98]">
                                {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Zap className="w-5 h-5 mr-3" />}
                                {initialData ? 'Update Gateway' : 'Create Gateway'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog >
    );
};

const EmptyState = ({ icon, title, description }: any) => (
    <div className="col-span-full py-8 bg-white rounded-xl border border-dashed border-gray-200 flex flex-col items-center justify-center text-center">
        <div className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400 mb-2.5">{icon}</div>
        <h3 className="text-[14px] font-semibold text-brand-navy">{title}</h3>
        <p className="text-[11px] text-gray-500 mt-0.5 max-w-xs">{description}</p>
    </div>
);

export default Webhooks;
