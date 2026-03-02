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

const SUPABASE_PROJECT_ID = 'zjkqprrfbibjoslvlmxf';
const WEBHOOK_BASE_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/provider-webhook`;

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
        }
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
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-5 duration-700">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Webhook Gateway</h1>
                            <p className="text-gray-500 font-light">Manage real-time data ingestion from your delivery partners.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button
                                onClick={() => {
                                    setEditingItem(null);
                                    setIsHookModalOpen(true);
                                }}
                                className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 group"
                            >
                                <Plus className="w-5 h-5 mr-3 group-hover:rotate-90 transition-transform duration-500" /> New Gateway
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="bg-brand-navy/5 p-1.5 rounded-[24px] mb-8 h-auto flex flex-wrap gap-1">
                    <TabsTrigger value="endpoints" className="rounded-2xl px-8 py-3.5 data-[state=active]:bg-white data-[state=active]:shadow-lg font-bold text-brand-navy transition-all flex items-center gap-2">
                        <Zap className="w-4 h-4" /> Provider Gateways
                    </TabsTrigger>
                    <TabsTrigger value="logs" className="rounded-2xl px-8 py-3.5 data-[state=active]:bg-white data-[state=active]:shadow-lg font-bold text-brand-navy transition-all flex items-center gap-2">
                        <History className="w-4 h-4" /> Live Event Log
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="endpoints" className="m-0 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {hooksLoading ? (
                            [1, 2, 3].map(i => <div key={i} className="h-64 rounded-[32px] bg-white animate-pulse" />)
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
                            <EmptyState icon={<Webhook className="w-12 h-12" />} title="No Gateways Found" description="Connect your first delivery partner to start receiving automated updates." />
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="logs" className="m-0">
                    <div className="bg-white rounded-[32px] overflow-hidden shadow-sm border border-slate-100 font-bold">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50/50">
                                    <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Timestamp</th>
                                    <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Provider</th>
                                    <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Object / tracking</th>
                                    <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Result</th>
                                    <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Raw Data</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logsLoading ? (
                                    <tr><td colSpan={5} className="p-8 text-center text-slate-400">Accessing logs...</td></tr>
                                ) : logs?.length ? (
                                    logs.map(log => (
                                        <tr key={log.id} className="border-t border-slate-50 hover:bg-slate-50/30 transition-colors">
                                            <td className="px-8 py-6 text-xs font-bold text-slate-400">{format(new Date(log.created_at), 'MMM dd, HH:mm:ss')}</td>
                                            <td className="px-8 py-6 font-bold text-brand-navy">{log.providers?.name || 'Unknown'}</td>
                                            <td className="px-8 py-6 font-mono text-xs text-brand-navy/60">{log.tracking_code || '---'}</td>
                                            <td className="px-8 py-6">
                                                <Badge className={cn(
                                                    "border-none font-bold uppercase tracking-widest px-2.5",
                                                    log.processed ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"
                                                )}>
                                                    {log.processed ? 'Processed' : 'Failed'}
                                                </Badge>
                                                {log.error_message && <p className="text-[10px] text-red-400 mt-1 font-bold">{log.error_message}</p>}
                                            </td>
                                            <td className="px-8 py-6 text-right">
                                                <Button
                                                    onClick={() => { console.log(log.payload); toast({ title: "Payload Logged", description: "The full JSON payload is visible in the browser console." }); }}
                                                    variant="ghost"
                                                    className="rounded-xl h-10 px-4 font-bold text-brand-navy hover:bg-slate-100"
                                                >
                                                    Debug JSON
                                                </Button>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr><td colSpan={5} className="p-20 text-center text-slate-300 font-bold">Waiting for incoming triggers...</td></tr>
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
        <Card className="group relative overflow-hidden border-none bg-white hover:shadow-[0_40px_80px_-15px_rgba(0,0,0,0.1)] transition-all duration-500 rounded-[32px] border border-slate-100 flex flex-col h-full ring-1 ring-slate-100">
            <div className={cn(
                "absolute top-0 left-0 w-full h-1.5 transition-all duration-500",
                hook.is_active ? "bg-emerald-500 shadow-[0_4px_12px_rgba(16,185,129,0.3)]" : "bg-slate-200"
            )} />

            <CardHeader className="flex flex-row items-start justify-between p-6">
                <div className="flex flex-col gap-4">
                    <div className="h-14 w-14 rounded-2xl bg-slate-50 border border-slate-100 p-2 flex items-center justify-center overflow-hidden shadow-inner group-hover:scale-110 transition-transform">
                        {hook.providers?.logo_url ? (
                            <img src={hook.providers.logo_url} alt="" className="max-w-full max-h-full object-contain" />
                        ) : (
                            <Building2 className="w-6 h-6 text-brand-navy/10" />
                        )}
                    </div>
                    <div>
                        <CardTitle className="text-xl font-black text-brand-navy tracking-tight leading-none mb-1">{hook.providers?.name}</CardTitle>
                        <div className="flex items-center gap-2">
                            <div className={cn("w-2 h-2 rounded-full", hook.is_active ? "bg-emerald-500 animate-pulse" : "bg-slate-300")} />
                            <span className={cn("text-[10px] font-black uppercase tracking-widest", hook.is_active ? "text-emerald-500" : "text-slate-400")}>
                                {hook.is_active ? 'Live Listener' : 'Ignored'}
                            </span>
                        </div>
                    </div>
                </div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 hover:bg-slate-50 shadow-none">
                            <MoreVertical className="w-5 h-5 text-slate-300" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-2xl p-2 min-w-[180px]">
                        <DropdownMenuItem onClick={onEdit} className="rounded-xl p-3 cursor-pointer font-bold text-brand-navy focus:bg-slate-50">
                            <Edit2 className="w-4 h-4 mr-3 text-slate-400" /> Gateway Configuration
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={onDelete} className="rounded-xl p-3 cursor-pointer font-bold text-red-500 hover:bg-red-50 focus:bg-red-50">
                            <Trash2 className="w-4 h-4 mr-3 text-red-400" /> Delete Gateway
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardHeader>

            <CardContent className="px-6 pb-6 space-y-5">
                <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Callback Gateway</label>
                    <div className="p-3.5 rounded-2xl bg-slate-50/80 border border-slate-100 flex items-center justify-between gap-3 group/link">
                        <span className="text-[11px] font-bold text-brand-navy/50 truncate italic select-all">
                            {fullUrl}
                        </span>
                        <Button
                            onClick={handleCopy}
                            variant="ghost"
                            size="icon"
                            className="shrink-0 h-8 w-8 rounded-lg hover:bg-white hover:shadow-sm"
                        >
                            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-brand-navy/30" />}
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 rounded-2xl bg-brand-navy/5 border border-brand-navy/[0.03]">
                        <p className="text-[9px] font-black text-brand-navy/20 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                            <Key className="w-2.5 h-2.5" /> Secret
                        </p>
                        <p className="text-xs font-black text-brand-navy tracking-widest opacity-50">••••••••</p>
                    </div>
                    <div className="p-4 rounded-2xl bg-brand-navy/5 border border-brand-navy/[0.03]">
                        <p className="text-[9px] font-black text-brand-navy/20 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                            <Clock className="w-2.5 h-2.5" /> Last Beat
                        </p>
                        <p className="text-xs font-black text-brand-navy">
                            {hook.last_received_at ? format(new Date(hook.last_received_at), 'HH:mm:ss') : 'Waiting for Data...'}
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
    <div className="col-span-full py-20 bg-white/50 backdrop-blur-sm rounded-[44px] border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-center">
        <div className="bg-white p-5 rounded-3xl shadow-sm mb-5 text-slate-300">{icon}</div>
        <h3 className="text-2xl font-black text-brand-navy">{title}</h3>
        <p className="text-slate-500 mt-2 max-w-xs">{description}</p>
    </div>
);

export default Webhooks;
