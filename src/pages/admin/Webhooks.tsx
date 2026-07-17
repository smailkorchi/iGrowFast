import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { subscribeEcomBus } from '@/lib/ecomBus';
import { resolveProviderLogo } from '@/lib/providerLogos';
import {
    Plus,
    MoreVertical,
    Edit2,
    Trash2,
    Webhook,
    Shield,
    Link as LinkIcon,
    Loader2,
    CheckCircle2,
    Building2,
    Zap,
    Clock,
    Activity,
    History,
    Key,
    Copy,
    Check,
    AlertCircle
} from 'lucide-react';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
    const [hookToDelete, setHookToDelete] = useState<any>(null);
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // --- Queries ---
    const { data: webhooks, isLoading: hooksLoading } = useQuery({
        queryKey: ['provider_webhooks', activeBusinessId],
        staleTime: 60 * 1000, // WH audit: config data; webhook broadcast invalidates
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from(WEBHOOKS_TABLE)
                .select('*, providers(id, name, logo_url, provider_type)')
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
        // WH audit (OR-7 class): the live feed is now event-driven — the ecom:biz
        // 'webhook' broadcast invalidates this key (effect below). The old 5s poll
        // was 12 req/min per admin on this page for a table that only changes when
        // a carrier posts. 30s interval is a slow fallback for missed broadcasts.
        refetchInterval: 30000,
    });

    // WH audit: refresh logs (+ webhook config) on the shared 'webhook' broadcast,
    // debounced 3s so carrier-sync bursts coalesce into one refetch.
    useEffect(() => {
        if (!activeBusinessId) return;
        let t: ReturnType<typeof setTimeout> | null = null;
        const unsub = subscribeEcomBus((event) => {
            if (event.type === 'webhook') {
                if (t) clearTimeout(t);
                t = setTimeout(() => {
                    t = null;
                    queryClient.invalidateQueries({ queryKey: ['webhook_logs', activeBusinessId] });
                    queryClient.invalidateQueries({ queryKey: ['provider_webhooks', activeBusinessId] });
                }, 3000);
            }
        });
        return () => { if (t) clearTimeout(t); unsub(); };
    }, [activeBusinessId, queryClient]);

    const { data: providers } = useQuery({
        queryKey: ['providers', activeBusinessId],
        staleTime: 60 * 1000, // WH audit: config data; webhook broadcast invalidates
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

    // Derived stats for the editorial KPI strip
    const activeHooks = (webhooks || []).filter((h: any) => h.is_active).length;
    const totalHooks = webhooks?.length || 0;
    const processedLogs = (logs || []).filter((l: any) => l.processed).length;
    const failedLogs = (logs || []).filter((l: any) => !l.processed).length;

    return (
        <div className="ant-surface px-2 md:px-3 py-2 space-y-4">
            {/* Editorial header */}
            <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pt-1">
                <div className="space-y-1.5">
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                        <span className="w-1 h-1 rounded-full bg-ant-orange" />
                        Integrations · Gateways
                    </span>
                    <h1 className="font-display text-[30px] md:text-[34px] font-semibold text-ant-ink leading-[1.05] tracking-[-0.02em]">
                        Webhooks
                    </h1>
                    <p className="font-serif-display text-[13px] text-ant-muted italic">
                        Real-time ingestion from delivery partners — each endpoint signs with a shared secret and lands in the event log.
                    </p>
                </div>
                <Button
                    onClick={() => {
                        setEditingItem(null);
                        setIsHookModalOpen(true);
                    }}
                    className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light text-[12px] font-medium shadow-none gap-2 shrink-0"
                >
                    <Plus className="w-3.5 h-3.5" />
                    New gateway
                </Button>
            </header>

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-xl overflow-hidden border border-ant-line">
                <WebhookKpi label="Total gateways" value={totalHooks} accent="#141413" icon={Zap} />
                <WebhookKpi label="Active" value={activeHooks} accent="#788c5d" icon={Activity} />
                <WebhookKpi label="Processed · last 50" value={processedLogs} accent="#6a9bcc" icon={CheckCircle2} />
                <WebhookKpi label="Failed · last 50" value={failedLogs} accent="#c96356" icon={AlertCircle} />
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <TabsList className="h-9 p-0.5 rounded-full bg-ant-paper border border-ant-line gap-0">
                        <TabsTrigger
                            value="endpoints"
                            className="rounded-full px-4 h-8 text-[11.5px] font-medium data-[state=active]:bg-ant-ink data-[state=active]:text-ant-light data-[state=inactive]:text-ant-muted gap-1.5"
                        >
                            <Zap className="w-3 h-3" /> Gateways
                            <span className="text-[10px] tabular-nums opacity-70">{totalHooks}</span>
                        </TabsTrigger>
                        <TabsTrigger
                            value="logs"
                            className="rounded-full px-4 h-8 text-[11.5px] font-medium data-[state=active]:bg-ant-ink data-[state=active]:text-ant-light data-[state=inactive]:text-ant-muted gap-1.5"
                        >
                            <History className="w-3 h-3" /> Event log
                            <span className="text-[10px] tabular-nums opacity-70">{logs?.length || 0}</span>
                        </TabsTrigger>
                    </TabsList>

                    <div className="inline-flex items-center gap-2 h-9 px-3.5 rounded-full bg-ant-paper border border-ant-line">
                        <span className="relative inline-flex">
                            <span className="w-1.5 h-1.5 rounded-full bg-ant-green" />
                            <span className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-ant-green animate-ping" />
                        </span>
                        <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Live</span>
                        <span className="text-[11px] font-medium text-ant-ink">Polling every 5s</span>
                    </div>
                </div>

                <TabsContent value="endpoints" className="m-0">
                    {hooksLoading ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="h-40 rounded-2xl bg-ant-line-soft animate-pulse" />
                            ))}
                        </div>
                    ) : webhooks?.length ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                            {webhooks.map((hook) => (
                                <WebhookCard
                                    key={hook.id}
                                    hook={hook}
                                    projectUrl={WEBHOOK_BASE_URL}
                                    onEdit={() => { setEditingItem(hook); setIsHookModalOpen(true); }}
                                    onDelete={() => setHookToDelete(hook)}
                                />
                            ))}
                        </div>
                    ) : (
                        <EmptyState
                            onCreate={() => { setEditingItem(null); setIsHookModalOpen(true); }}
                        />
                    )}
                </TabsContent>

                <TabsContent value="logs" className="m-0">
                    <div className="bg-ant-paper rounded-xl overflow-hidden border border-ant-line">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-ant-line-soft">
                                    <th className="px-4 py-3 text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid">Timestamp</th>
                                    <th className="px-4 py-3 text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid">Provider</th>
                                    <th className="px-4 py-3 text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid">Tracking</th>
                                    <th className="px-4 py-3 text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid">Result</th>
                                    <th className="px-4 py-3 text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid text-right">Payload</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logsLoading ? (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-6 text-center font-serif-display text-[12px] text-ant-muted italic">
                                            Loading live events…
                                        </td>
                                    </tr>
                                ) : logs?.length ? (
                                    logs.map((log) => (
                                        <tr key={log.id} className="border-t border-ant-line hover:bg-ant-line-soft transition-colors">
                                            <td className="px-4 py-3 text-[11px] text-ant-muted tabular-nums whitespace-nowrap">
                                                {format(new Date(log.created_at), 'MMM dd · HH:mm:ss')}
                                            </td>
                                            <td className="px-4 py-3 text-[12px] font-medium text-ant-ink">
                                                {log.providers?.name || 'Unknown'}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-[11px] text-ant-ink/80 truncate max-w-[200px]">
                                                {log.tracking_code || '—'}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span
                                                    className={cn(
                                                        'inline-flex items-center gap-1 text-[9.5px] font-medium uppercase tracking-[0.22em] px-2 py-0.5 rounded-full border',
                                                        log.processed
                                                            ? 'bg-ant-green/10 text-ant-green border-ant-green/25'
                                                            : 'bg-ant-rose/10 text-ant-rose border-ant-rose/25',
                                                    )}
                                                >
                                                    <span className={cn('w-1 h-1 rounded-full', log.processed ? 'bg-ant-green' : 'bg-ant-rose')} />
                                                    {log.processed ? 'Processed' : 'Failed'}
                                                </span>
                                                {log.error_message && (
                                                    <p className="font-serif-display text-[11px] text-ant-rose italic mt-1">
                                                        {log.error_message}
                                                    </p>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <Button
                                                    size="sm"
                                                    onClick={() => { console.log(log.payload); toast({ title: 'Payload logged', description: 'Full JSON is in the browser console.' }); }}
                                                    variant="outline"
                                                    className="h-8 px-3 rounded-full text-[10.5px] font-medium border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-line-soft"
                                                >
                                                    View JSON
                                                </Button>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-12 text-center">
                                            <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-ant-line-soft border border-ant-line mb-2">
                                                <Activity className="w-4 h-4 text-ant-mid" strokeWidth={1.75} />
                                            </div>
                                            <p className="font-display text-[14px] font-semibold text-ant-ink tracking-tight">Waiting for incoming events</p>
                                            <p className="font-serif-display text-[11.5px] text-ant-muted italic mt-1">
                                                Once a partner pings a gateway, it will appear here in real time.
                                            </p>
                                        </td>
                                    </tr>
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

            <ConfirmDialog
                open={!!hookToDelete}
                onOpenChange={(o) => { if (!o) setHookToDelete(null); }}
                kicker="Gateway · Déconnexion"
                title="Couper cette passerelle ?"
                description="La passerelle sera supprimée et l'application cessera de recevoir les mises à jour. L'action est irréversible."
                confirmLabel="Terminer la passerelle"
                loading={deleteMutation.isPending}
                onConfirm={() => {
                    if (!hookToDelete) return;
                    deleteMutation.mutate(
                        { table: WEBHOOKS_TABLE, id: hookToDelete.id },
                        { onSettled: () => setHookToDelete(null) },
                    );
                }}
            />
        </div>
    );
};

// Editorial KPI tile — matches the summary strip used elsewhere.
const WebhookKpi = ({
    label,
    value,
    accent,
    icon: Icon,
}: {
    label: string;
    value: number;
    accent: string;
    icon: typeof Zap;
}) => (
    <div className="bg-ant-paper px-4 py-3">
        <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: accent }} aria-hidden />
                <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid truncate">
                    {label}
                </span>
            </div>
            <span
                className="flex items-center justify-center w-5 h-5 rounded-md shrink-0"
                style={{ backgroundColor: `${accent}14`, color: accent }}
            >
                <Icon className="w-3 h-3" strokeWidth={1.75} />
            </span>
        </div>
        <div className="font-display text-[22px] font-semibold text-ant-ink tabular-nums tracking-[-0.02em] leading-none mt-2">
            {value.toLocaleString('fr-FR')}
        </div>
    </div>
);

// --- Specialized Components ---

const WebhookCard = ({ hook, projectUrl, onEdit, onDelete }: any) => {
    const [copied, setCopied] = useState(false);
    const baseUrl = `${projectUrl}/${hook.provider_id}/${hook.webhook_secret}`;
    // Delevo Express requires URL-template placeholders so their dashboard substitutes the values
    // (no JSON body — they send GET with query params). Append them automatically.
    const providerType = String(hook.providers?.provider_type || '').toLowerCase();
    const isDelvo = providerType === 'delvoexpress' || providerType.includes('delvo') || providerType.includes('delevo');
    const fullUrl = isDelvo
        ? `${baseUrl}?code={code_parcel}&status={status_name}&date={date_reported}&internal_id={external_id}`
        : baseUrl;

    const handleCopy = () => {
        navigator.clipboard.writeText(fullUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Card className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper shadow-none hover:border-ant-ink/20 transition-all duration-300 flex flex-col h-full">
            <div className={cn('h-[3px]', hook.is_active ? 'bg-ant-green' : 'bg-ant-line')} />

            <CardHeader className="flex flex-row items-start justify-between p-4 pb-3 space-y-0">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-lg bg-ant-light border border-ant-line p-1.5 flex items-center justify-center overflow-hidden shrink-0">
                        {resolveProviderLogo(hook.providers) ? (
                            <img src={resolveProviderLogo(hook.providers)!} alt="" className="max-w-full max-h-full object-contain" />
                        ) : (
                            <Building2 className="w-4 h-4 text-ant-mid" strokeWidth={1.75} />
                        )}
                    </div>
                    <div className="min-w-0">
                        <CardTitle className="font-display text-[14px] font-semibold text-ant-ink tracking-[-0.01em] leading-tight truncate">
                            {hook.providers?.name || 'Unknown provider'}
                        </CardTitle>
                        <span
                            className={cn(
                                'inline-flex items-center gap-1 text-[9.5px] font-medium uppercase tracking-[0.22em] px-1.5 py-0.5 rounded-full border mt-1',
                                hook.is_active
                                    ? 'bg-ant-green/10 text-ant-green border-ant-green/25'
                                    : 'bg-ant-line-soft text-ant-muted border-ant-line',
                            )}
                        >
                            <span className={cn('w-1 h-1 rounded-full', hook.is_active ? 'bg-ant-green' : 'bg-ant-mid')} />
                            {hook.is_active ? 'Live' : 'Paused'}
                        </span>
                    </div>
                </div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="rounded-full h-8 w-8 text-ant-mid hover:text-ant-ink hover:bg-ant-line-soft shrink-0"
                        >
                            <MoreVertical className="w-4 h-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="end"
                        className="rounded-xl border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)] p-1 min-w-[180px]"
                    >
                        <DropdownMenuItem
                            onClick={onEdit}
                            className="rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium text-ant-ink data-[highlighted]:bg-ant-line-soft"
                        >
                            <Edit2 className="w-3.5 h-3.5 mr-2 text-ant-mid" /> Configure
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-ant-line my-1" />
                        <DropdownMenuItem
                            onClick={onDelete}
                            className="rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium text-ant-rose data-[highlighted]:bg-ant-rose/10 focus:bg-ant-rose/10"
                        >
                            <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardHeader>

            <CardContent className="px-4 pb-4 space-y-2.5 flex-grow">
                <div>
                    <div className="flex items-center gap-1 mb-1">
                        <LinkIcon className="w-2.5 h-2.5 text-ant-mid" strokeWidth={2} />
                        <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid">Callback URL</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-ant-light border border-ant-line">
                        <span className="font-mono text-[10.5px] text-ant-ink/80 truncate select-all flex-1">{fullUrl}</span>
                        <Button
                            onClick={handleCopy}
                            variant="ghost"
                            size="icon"
                            className="shrink-0 h-6 w-6 rounded-md text-ant-mid hover:text-ant-ink hover:bg-ant-paper"
                            title={copied ? 'Copied' : 'Copy URL'}
                        >
                            {copied ? <Check className="w-3 h-3 text-ant-green" /> : <Copy className="w-3 h-3" />}
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-px bg-ant-line rounded-xl overflow-hidden border border-ant-line">
                    <div className="bg-ant-paper px-3 py-2">
                        <div className="flex items-center gap-1">
                            <Key className="w-2.5 h-2.5 text-ant-mid" strokeWidth={2} />
                            <span className="text-[9.5px] font-medium text-ant-mid uppercase tracking-[0.22em]">Secret</span>
                        </div>
                        <p className="font-mono text-[12px] font-medium text-ant-muted tracking-[0.3em] mt-0.5">••••••••</p>
                    </div>
                    <div className="bg-ant-paper px-3 py-2">
                        <div className="flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5 text-ant-mid" strokeWidth={2} />
                            <span className="text-[9.5px] font-medium text-ant-mid uppercase tracking-[0.22em]">Last beat</span>
                        </div>
                        <p className="font-display text-[12px] font-semibold text-ant-ink tabular-nums truncate mt-0.5 tracking-[-0.01em]">
                            {hook.last_received_at ? format(new Date(hook.last_received_at), 'MMM dd · HH:mm:ss') : '—'}
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
            <DialogContent className="ant-surface max-w-xl p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)}>
                        <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="w-1 h-1 rounded-full bg-ant-orange" />
                                <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                    {initialData ? 'Edit gateway' : 'New gateway'}
                                </span>
                            </div>
                            <DialogTitle className="font-display text-[22px] font-semibold text-ant-ink tracking-[-0.02em]">
                                Connect a partner
                            </DialogTitle>
                            <DialogDescription className="font-serif-display text-[13px] text-ant-muted italic mt-0.5">
                                The URL below is what your provider hits on every status change. Each gateway carries its own shared secret.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="px-6 py-5 space-y-5">
                            <FormField control={form.control} name="provider_id" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                        Target partner
                                    </FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger className="h-11 rounded-lg border border-ant-line bg-ant-paper text-[13px] font-medium text-ant-ink focus:ring-ant-orange focus:ring-offset-0 px-3.5">
                                                <SelectValue placeholder="Select a provider…" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent className="rounded-xl border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)] p-1">
                                            {providers.map((p: any) => (
                                                <SelectItem key={p.id} value={p.id} className="text-[12.5px] font-medium px-3 py-2 rounded-lg">
                                                    {p.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )} />

                            <FormField control={form.control} name="webhook_secret" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                        HMAC verification secret
                                    </FormLabel>
                                    <FormControl>
                                        <div className="relative">
                                            <Shield className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-orange" strokeWidth={1.75} />
                                            <Input
                                                placeholder="Auto-generated…"
                                                {...field}
                                                className="h-11 pl-10 pr-28 rounded-lg border border-ant-line bg-ant-paper text-[13px] font-mono text-ant-ink placeholder:text-ant-mid focus-visible:ring-ant-orange focus-visible:ring-offset-0 focus-visible:border-ant-ink/25"
                                            />
                                            <Button
                                                type="button"
                                                onClick={() => field.onChange(onGenerateSecret())}
                                                variant="outline"
                                                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 px-3 rounded-full text-[10.5px] font-medium border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-line-soft"
                                            >
                                                Regenerate
                                            </Button>
                                        </div>
                                    </FormControl>
                                    <FormDescription className="font-serif-display text-[11.5px] text-ant-muted italic">
                                        Store this secret on your partner's side. They sign every payload with it.
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />

                            <FormField control={form.control} name="is_active" render={({ field }) => (
                                <FormItem className="flex items-center justify-between gap-4 p-4 bg-ant-light border border-ant-line rounded-xl">
                                    <div className="space-y-0.5 min-w-0">
                                        <FormLabel className="font-display text-[13px] font-semibold text-ant-ink tracking-tight leading-none">
                                            Gateway status
                                        </FormLabel>
                                        <p className="font-serif-display text-[11.5px] text-ant-muted italic leading-snug">
                                            Paused gateways reject incoming events. Flip back to Live to resume.
                                        </p>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => field.onChange(!field.value)}
                                        className={cn(
                                            'h-9 px-3.5 rounded-full text-[11.5px] font-medium gap-1.5 border transition-colors shrink-0',
                                            field.value
                                                ? 'bg-ant-green/10 text-ant-green border-ant-green/25 hover:bg-ant-green/15 hover:text-ant-green'
                                                : 'bg-ant-line-soft text-ant-muted border-ant-line hover:bg-ant-line',
                                        )}
                                    >
                                        <span className={cn('w-1.5 h-1.5 rounded-full', field.value ? 'bg-ant-green' : 'bg-ant-mid')} />
                                        {field.value ? 'Live' : 'Paused'}
                                    </Button>
                                </FormItem>
                            )} />
                        </div>

                        <DialogFooter className="px-6 py-4 border-t border-ant-line bg-ant-paper gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={onClose}
                                className="h-10 px-4 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-line-soft font-medium text-[12px]"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={loading}
                                className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light font-medium text-[12px] gap-1.5 disabled:opacity-50"
                            >
                                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-ant-orange" />}
                                {initialData ? 'Update gateway' : 'Create gateway'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

const EmptyState = ({ onCreate }: { onCreate: () => void }) => (
    <div className="col-span-full rounded-2xl border border-ant-line bg-ant-paper px-6 py-14 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-ant-orange/10 ring-1 ring-ant-orange/20 mb-4">
            <Webhook className="w-5 h-5 text-ant-orange" strokeWidth={1.5} />
        </div>
        <h3 className="font-display text-[18px] font-semibold text-ant-ink tracking-tight">No gateways yet</h3>
        <p className="font-serif-display text-[12.5px] text-ant-muted italic mt-1 mb-5 max-w-md mx-auto">
            Give your delivery partners a signed endpoint they can push to — status changes will land in the event log in real time.
        </p>
        <Button
            onClick={onCreate}
            className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light text-[12px] font-medium gap-2"
        >
            <Plus className="w-3.5 h-3.5" />
            Connect the first partner
        </Button>
    </div>
);

export default Webhooks;
