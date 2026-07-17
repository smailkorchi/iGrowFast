import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus,
    Search,
    MoreVertical,
    Edit2,
    Trash2,
    Loader2,
    Eye,
    X,
    RefreshCcw,
    Truck,
    ClipboardCheck,
    LayoutGrid,
    List,
    EyeOff,
    AlertTriangle,
    SlidersHorizontal,
    Check,
} from 'lucide-react';
import { IconPicker } from '@/components/ui/IconPicker';
import { DynamicIcon } from '@/lib/renderReactIcon';
import {
    Dialog,
    DialogContent,
    DialogDescription,
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
    FormDescription,
} from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { useForm, useFieldArray } from 'react-hook-form';
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
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";

// --- Schemas ---
const statusSchema = z.object({
    code: z.string().min(2, "Code must be at least 2 characters"),
    label: z.string().min(2, "Label must be at least 2 characters"),
    ranking: z.coerce.number().default(0),
    color: z.string().default("#D97706"),
    icon: z.string().optional().default(''),
    recheck: z.boolean().default(false),
    active: z.boolean().default(true),
    show_in_order: z.boolean().default(true),
    show_in_quick_status: z.boolean().default(true),
    show_in_seller_confirmation: z.boolean().default(true),
    show_in_courier: z.boolean().default(true),
    show_in_seller_suivi: z.boolean().default(true),
    perf_breakdown: z.boolean().default(false),
    perf_breakdown_phase: z.enum(['before_confirmation', 'after_confirmation']).nullable().default(null),
    delivery_service_statuses: z.array(z.object({
        value: z.string().min(1, "Status code is required")
    })).optional().default([]),
});

type StatusFormValues = z.infer<typeof statusSchema>;

type StatusRow = {
    id: string;
    code: string;
    label: string;
    ranking: number | null;
    color: string | null;
    icon: string | null;
    recheck: boolean | null;
    active: boolean | null;
    created_at: string | null;
    updated_at: string | null;
    show_in_order?: boolean;
    show_in_quick_status?: boolean;
    show_in_seller_confirmation?: boolean;
    show_in_courier?: boolean;
    show_in_seller_suivi?: boolean;
    delivery_service_statuses?: string[] | null;
    perf_breakdown?: boolean;
    perf_breakdown_phase?: string | null;
};

const errorMessage = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);

function HiddenInOrdersBadge({ className }: { className?: string }) {
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]',
                'bg-ant-rose/10 text-ant-rose',
                className,
            )}
        >
            <EyeOff className="w-2.5 h-2.5 shrink-0" />
            Hidden in orders
        </span>
    );
}

const Status = () => {
    const [activeTab, setActiveTab] = useState<"orders" | "packages" | "behaviors">("orders");
    const [isUpsertOpen, setIsUpsertOpen] = useState(false);
    const [isViewOpen, setIsViewOpen] = useState(false);
    const [editingStatus, setEditingStatus] = useState<StatusRow | null>(null);
    const [viewingStatus, setViewingStatus] = useState<StatusRow | null>(null);
    const [statusToDelete, setStatusToDelete] = useState<StatusRow | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

    const { toast } = useToast();
    const queryClient = useQueryClient();

    const table = activeTab === "orders" ? "order_statuses" : "package_statuses";

    const { data: userRole } = useQuery({
        queryKey: ['currentUserRole'],
        staleTime: 5 * 60_000,
        queryFn: async () => {
            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;
            if (!user) return null;
            const { data, error } = await supabase
                .from('users')
                .select('role')
                .eq('id', user.id)
                .single();
            if (error) return null;
            return data?.role ?? null;
        },
    });
    const isOwner = userRole === 'owner';

    const { data: statuses, isLoading } = useQuery({
        queryKey: ['statuses', activeTab],
        staleTime: 60_000,
        queryFn: async () => {
            const { data, error } = await supabase
                .from(table)
                .select('*')
                .order('ranking', { ascending: true });

            if (error) throw error;
            return (data || []) as unknown as StatusRow[];
        },
        enabled: activeTab !== 'behaviors',
    });

    const form = useForm<StatusFormValues>({
        resolver: zodResolver(statusSchema),
        defaultValues: {
            code: '',
            label: '',
            ranking: 0,
            color: '#D97706',
            recheck: false,
            active: true,
            show_in_order: true,
            delivery_service_statuses: [],
        },
    });

    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: "delivery_service_statuses",
    });

    const upsertMutation = useMutation({
        mutationFn: async (values: StatusFormValues) => {
            const deliveryStatuses = activeTab === 'packages'
                ? values.delivery_service_statuses.map(s => s.value)
                : undefined;

            const perfPhase = values.perf_breakdown ? values.perf_breakdown_phase : null;

            const payload = {
                code: values.code,
                label: values.label,
                ranking: values.ranking,
                color: values.color,
                icon: values.icon || null,
                recheck: values.recheck,
                active: values.active,
                perf_breakdown: values.perf_breakdown,
                perf_breakdown_phase: perfPhase,
                delivery_service_statuses: deliveryStatuses,
                show_in_seller_confirmation: values.show_in_seller_confirmation,
                show_in_seller_suivi: values.show_in_seller_suivi,
                ...(activeTab === 'orders' ? {
                    show_in_order: values.show_in_order,
                    show_in_quick_status: values.show_in_quick_status,
                } : {
                    show_in_courier: values.show_in_courier,
                }),
            };

            if (editingStatus) {
                const { data, error } = await supabase
                    .from(table)
                    .update(payload as never)
                    .eq('id', editingStatus.id)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            } else {
                const { data, error } = await supabase
                    .from(table)
                    .insert(payload as never)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['statuses', activeTab] });
            setIsUpsertOpen(false);
            setEditingStatus(null);
            toast({
                title: editingStatus ? "Status updated" : "Status created",
                description: `Successfully ${editingStatus ? 'updated' : 'created'} ${form.getValues('label')}.`,
            });
        },
        onError: (error) => {
            toast({ title: "Error", description: errorMessage(error), variant: "destructive" });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.from(table).delete().eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['statuses', activeTab] });
            setStatusToDelete(null);
            toast({ title: "Status deleted", description: "The status was successfully removed." });
        },
        onError: (error) => {
            toast({ title: "Error", description: errorMessage(error), variant: "destructive" });
        },
    });

    const handleUpsert = (values: StatusFormValues) => {
        upsertMutation.mutate(values);
    };

    const openUpsert = (status: StatusRow | null = null) => {
        if (status) {
            setEditingStatus(status);
            const deliveryStatuses = Array.isArray(status.delivery_service_statuses)
                ? status.delivery_service_statuses.map((s: string) => ({ value: s }))
                : [];

            form.reset({
                code: status.code,
                label: status.label,
                ranking: status.ranking ?? 0,
                color: status.color || '#D97706',
                icon: status.icon || '',
                recheck: status.recheck ?? false,
                active: status.active ?? true,
                show_in_order: status.show_in_order ?? true,
                show_in_quick_status: status.show_in_quick_status ?? true,
                show_in_seller_confirmation: status.show_in_seller_confirmation ?? true,
                show_in_courier: status.show_in_courier ?? true,
                show_in_seller_suivi: status.show_in_seller_suivi ?? true,
                perf_breakdown: status.perf_breakdown ?? false,
                perf_breakdown_phase: (status.perf_breakdown_phase as 'before_confirmation' | 'after_confirmation') ?? null,
                delivery_service_statuses: deliveryStatuses,
            });
        } else {
            setEditingStatus(null);
            form.reset({
                code: '',
                label: '',
                ranking: (statuses?.length || 0) + 1,
                color: '#D97706',
                icon: '',
                recheck: false,
                active: true,
                show_in_order: true,
                show_in_quick_status: true,
                show_in_seller_confirmation: true,
                show_in_courier: true,
                show_in_seller_suivi: true,
                perf_breakdown: false,
                perf_breakdown_phase: null,
                delivery_service_statuses: [],
            });
        }
        setIsUpsertOpen(true);
    };

    const filteredStatuses = useMemo(() => {
        if (!statuses) return [];
        if (!searchQuery.trim()) return statuses;
        const q = searchQuery.toLowerCase();
        return statuses.filter(s =>
            s.label.toLowerCase().includes(q) ||
            s.code.toLowerCase().includes(q),
        );
    }, [statuses, searchQuery]);

    const stats = useMemo(() => {
        if (!statuses) return { total: 0, active: 0, inactive: 0, recheck: 0 };
        const active = statuses.filter((s) => s.active).length;
        const recheck = statuses.filter((s) => s.recheck).length;
        return { total: statuses.length, active, inactive: statuses.length - active, recheck };
    }, [statuses]);

    const inputClass = "w-full h-10 px-3.5 rounded-xl border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all";

    const renderStatusSection = () => {
        if (isLoading) {
            if (viewMode === 'grid') {
                return (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <Skeleton key={i} className="h-36 w-full rounded-2xl" />
                        ))}
                    </div>
                );
            }
            return (
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-ink" />
                    <div className="divide-y divide-ant-line">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <Skeleton key={i} className="h-14 w-full rounded-none" />
                        ))}
                    </div>
                </section>
            );
        }

        if (!filteredStatuses.length) {
            return (
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-10 flex flex-col items-center gap-3 text-center">
                        <ClipboardCheck className="w-6 h-6 text-ant-mid" />
                        <p className="font-display text-[14px] text-ant-ink">
                            {searchQuery.trim() ? 'No statuses match your search' : 'No statuses yet'}
                        </p>
                        <p className="font-serif italic text-[12px] text-ant-mid max-w-sm">
                            {searchQuery.trim() ? 'Try a different term.' : `Add the first ${activeTab === 'orders' ? 'order' : 'package'} status to define the workflow.`}
                        </p>
                    </div>
                </section>
            );
        }

        if (viewMode === 'grid') {
            return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
                    {filteredStatuses.map((status) => (
                        <StatusCard
                            key={status.id}
                            status={status}
                            activeTab={activeTab as 'orders' | 'packages'}
                            isOwner={isOwner}
                            onEdit={() => openUpsert(status)}
                            onView={() => { setViewingStatus(status); setIsViewOpen(true); }}
                            onDelete={() => setStatusToDelete(status)}
                        />
                    ))}
                </div>
            );
        }

        return (
            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                <div className="h-[3px] w-full bg-ant-ink" />
                <div className="divide-y divide-ant-line">
                    {filteredStatuses.map((status) => (
                        <StatusListRow
                            key={status.id}
                            status={status}
                            activeTab={activeTab as 'orders' | 'packages'}
                            isOwner={isOwner}
                            onEdit={() => openUpsert(status)}
                            onView={() => { setViewingStatus(status); setIsViewOpen(true); }}
                            onDelete={() => setStatusToDelete(status)}
                        />
                    ))}
                </div>
            </section>
        );
    };

    return (
        <div className="space-y-5 md:space-y-6">
            {/* Editorial header */}
            <header className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        Platform · Status workflow
                    </span>
                </div>
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                    <div className="space-y-1.5">
                        <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Status management
                        </h1>
                        <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                            Define the lifecycle for orders and packages — visibility, ranking, and recheck rules.
                        </p>
                    </div>
                    <div className={cn('flex flex-wrap items-center gap-2', activeTab === 'behaviors' && 'hidden')}>
                        <div className="relative flex-1 lg:flex-initial min-w-[200px]">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                            <input
                                type="search"
                                placeholder="Search label or code…"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full lg:w-56 h-10 pl-10 pr-10 rounded-full border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/70 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ant-mid hover:text-ant-ink"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                        {isOwner && (
                            <button
                                type="button"
                                onClick={() => openUpsert()}
                                className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium hover:bg-ant-ink/95 transition-colors shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)]"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                Add status
                            </button>
                        )}
                    </div>
                </div>
            </header>

            {/* KPI hairline strip */}
            {activeTab !== 'behaviors' && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                    <KpiTile label="Total" value={stats.total} accent="bg-ant-ink" />
                    <KpiTile label="Active" value={stats.active} accent="bg-ant-green" />
                    <KpiTile label="Inactive" value={stats.inactive} accent="bg-ant-mid" />
                    <KpiTile label="Recheck" value={stats.recheck} accent="bg-ant-orange" />
                </div>
            )}

            {/* Tabs + view switch */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <div className="inline-flex items-center gap-0.5 p-1 rounded-full border border-ant-line bg-ant-paper overflow-x-auto no-scrollbar">
                    {([
                        { key: 'orders' as const, label: 'Order statuses', icon: ClipboardCheck },
                        { key: 'packages' as const, label: 'Package statuses', icon: Truck },
                        { key: 'behaviors' as const, label: 'Comportements', icon: SlidersHorizontal },
                    ]).map((t) => {
                        const isActive = activeTab === t.key;
                        const Icon = t.icon;
                        return (
                            <button
                                key={t.key}
                                type="button"
                                onClick={() => setActiveTab(t.key)}
                                className={cn(
                                    'shrink-0 h-9 px-3.5 rounded-full flex items-center gap-1.5 text-[12px] font-medium transition-all',
                                    isActive ? 'bg-ant-ink text-ant-light shadow-[0_6px_18px_-6px_rgba(20,20,19,0.35)]' : 'text-ant-mid hover:text-ant-ink',
                                )}
                            >
                                <Icon className="w-3.5 h-3.5" />
                                {t.label}
                            </button>
                        );
                    })}
                </div>
                {activeTab !== 'behaviors' && (
                    <div className="sm:ml-auto inline-flex items-center gap-0.5 p-1 rounded-full border border-ant-line bg-ant-paper">
                        <button
                            type="button"
                            onClick={() => setViewMode('list')}
                            className={cn(
                                'h-8 w-8 rounded-full flex items-center justify-center transition-all',
                                viewMode === 'list' ? 'bg-ant-ink text-ant-light' : 'text-ant-mid hover:text-ant-ink',
                            )}
                            aria-label="List view"
                        >
                            <List className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('grid')}
                            className={cn(
                                'h-8 w-8 rounded-full flex items-center justify-center transition-all',
                                viewMode === 'grid' ? 'bg-ant-ink text-ant-light' : 'text-ant-mid hover:text-ant-ink',
                            )}
                            aria-label="Grid view"
                        >
                            <LayoutGrid className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}
            </div>

            {activeTab === 'behaviors' ? <BehaviorsConfig isOwner={isOwner} /> : renderStatusSection()}

            {/* Upsert Modal */}
            <Dialog open={isUpsertOpen} onOpenChange={setIsUpsertOpen}>
                <DialogContent className={cn(
                    'max-w-2xl p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden flex flex-col max-h-[92vh]',
                    'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]',
                    'sm:rounded-2xl',
                    'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                    'max-sm:!translate-x-0 max-sm:!translate-y-0',
                    'max-sm:!w-full max-sm:!max-w-none',
                    'max-sm:!h-[94dvh] max-sm:!max-h-[94dvh]',
                    'max-sm:!rounded-t-2xl max-sm:!rounded-b-none',
                    '[&>button.absolute]:hidden',
                )}>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleUpsert)} className="flex flex-col min-h-0 flex-1 overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange shrink-0" />
                            <DialogHeader className="px-5 pt-4 pb-4 shrink-0 border-b border-ant-line text-left space-y-1.5">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 space-y-1.5 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                                Status · {editingStatus ? 'Edit' : 'New'}
                                            </span>
                                        </div>
                                        <DialogTitle className="font-display text-[20px] leading-[1.1] tracking-[-0.01em] text-ant-ink flex items-center gap-2 flex-wrap">
                                            {form.watch('label') || (editingStatus ? 'Edit status' : 'New status')}
                                            <span
                                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]"
                                                style={{
                                                    backgroundColor: `${form.watch('color') || '#D97706'}18`,
                                                    color: form.watch('color') || '#D97706',
                                                }}
                                            >
                                                <span
                                                    className="w-1 h-1 rounded-full"
                                                    style={{ backgroundColor: form.watch('color') || '#D97706' }}
                                                />
                                                {form.watch('label') || 'Preview'}
                                            </span>
                                        </DialogTitle>
                                        <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                            <span className="font-mono uppercase not-italic">{form.watch('code') || 'CODE'}</span> · rank #{form.watch('ranking') || 0}
                                        </DialogDescription>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsUpsertOpen(false)}
                                        className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light flex items-center justify-center text-ant-ink shrink-0 transition-colors"
                                        aria-label="Close"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </DialogHeader>

                            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                                {/* Chapter 01 — Identity */}
                                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                    <div className="h-[3px] w-full bg-ant-ink" />
                                    <div className="px-4 py-3 border-b border-ant-line">
                                        <div className="flex items-center gap-2">
                                            <span className="font-display text-[10px] text-ant-orange">01</span>
                                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                                Identity
                                            </span>
                                        </div>
                                    </div>
                                    <div className="p-4 grid grid-cols-2 gap-3">
                                        <FormField
                                            control={form.control}
                                            name="label"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Label</FormLabel>
                                                    <FormControl>
                                                        <input placeholder="Confirmed" {...field} className={inputClass} />
                                                    </FormControl>
                                                    <FormMessage className="text-[10px] text-ant-rose" />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="code"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Code</FormLabel>
                                                    <FormControl>
                                                        <input placeholder="CONFIRMED" {...field} className={cn(inputClass, 'font-mono uppercase')} />
                                                    </FormControl>
                                                    <FormMessage className="text-[10px] text-ant-rose" />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </section>

                                {/* Chapter 02 — Appearance. No `overflow-hidden` here: the IconPicker
                                    dropdown is absolutely positioned and must be able to extend past
                                    this section (an overflow clip was hiding the icon grid). */}
                                <section className="rounded-2xl border border-ant-line bg-ant-paper">
                                    <div className="h-[3px] w-full bg-ant-orange rounded-t-2xl" />
                                    <div className="px-4 py-3 border-b border-ant-line">
                                        <div className="flex items-center gap-2">
                                            <span className="font-display text-[10px] text-ant-orange">02</span>
                                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                                Appearance
                                            </span>
                                        </div>
                                    </div>
                                    <div className="p-4 space-y-3">
                                        <div className="grid grid-cols-[1fr_auto] gap-3">
                                            <FormField
                                                control={form.control}
                                                name="icon"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Icon</FormLabel>
                                                        <FormControl>
                                                            <IconPicker value={field.value || ''} onChange={field.onChange} />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={form.control}
                                                name="ranking"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5 w-24">
                                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Rank</FormLabel>
                                                        <FormControl>
                                                            <input type="number" {...field} className={cn(inputClass, 'text-center')} />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                        <FormField
                                            control={form.control}
                                            name="color"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Color</FormLabel>
                                                    <FormControl>
                                                        <div className="flex gap-2 items-center">
                                                            <input type="color" {...field} className="h-10 w-12 p-1 rounded-xl border border-ant-line bg-ant-paper cursor-pointer shrink-0" />
                                                            <input {...field} className={cn(inputClass, 'font-mono')} />
                                                        </div>
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </section>

                                {/* Chapter 03 — Behavior */}
                                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                    <div className="h-[3px] w-full bg-ant-ink" />
                                    <div className="px-4 py-3 border-b border-ant-line">
                                        <div className="flex items-center gap-2">
                                            <span className="font-display text-[10px] text-ant-orange">03</span>
                                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                                Behavior
                                            </span>
                                        </div>
                                    </div>
                                    <div className="p-3 grid grid-cols-2 gap-2">
                                        <FormField
                                            control={form.control}
                                            name="active"
                                            render={({ field }) => (
                                                <FormItem className="flex items-center justify-between p-3 rounded-xl bg-ant-light border border-ant-line">
                                                    <FormLabel className="text-[12px] font-medium text-ant-ink">Active</FormLabel>
                                                    <FormControl>
                                                        <Switch checked={field.value} onCheckedChange={field.onChange} className="data-[state=checked]:bg-ant-green scale-90" />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="recheck"
                                            render={({ field }) => (
                                                <FormItem className="flex items-center justify-between p-3 rounded-xl bg-ant-light border border-ant-line">
                                                    <FormLabel className="text-[12px] font-medium text-ant-ink">Recheck</FormLabel>
                                                    <FormControl>
                                                        <Switch checked={field.value} onCheckedChange={field.onChange} className="data-[state=checked]:bg-ant-orange scale-90" />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </section>

                                {/* Chapter 04 — Display options */}
                                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                    <div className="h-[3px] w-full bg-ant-orange" />
                                    <div className="px-4 py-3 border-b border-ant-line">
                                        <div className="flex items-center gap-2">
                                            <span className="font-display text-[10px] text-ant-orange">04</span>
                                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                                Display options
                                            </span>
                                        </div>
                                    </div>
                                    <div className="p-3 space-y-2">
                                        {activeTab === 'orders' && (
                                            <>
                                                <FormField
                                                    control={form.control}
                                                    name="show_in_order"
                                                    render={({ field }) => (
                                                        <ToggleRow field={field} label="Show in order modals" desc="Visible in add/edit order status dropdown." />
                                                    )}
                                                />
                                                <FormField
                                                    control={form.control}
                                                    name="show_in_quick_status"
                                                    render={({ field }) => (
                                                        <ToggleRow field={field} label="Show in quick status change" desc="Visible in the quick status grid on orders." />
                                                    )}
                                                />
                                            </>
                                        )}

                                        {activeTab === 'packages' && (
                                            <FormField
                                                control={form.control}
                                                name="show_in_courier"
                                                render={({ field }) => (
                                                    <ToggleRow field={field} label="Show in courier statuses" desc="Visible in courier views and parcel tracking." />
                                                )}
                                            />
                                        )}

                                        <div className="mt-3 pt-3 border-t border-ant-line space-y-2">
                                            <p className="text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid px-1">
                                                Seller tabs
                                            </p>
                                            <FormField
                                                control={form.control}
                                                name="show_in_seller_confirmation"
                                                render={({ field }) => (
                                                    <ToggleRow field={field} label="Show in seller confirmation tab" desc="When off, orders with this status are hidden from the confirmation tab." />
                                                )}
                                            />
                                            <FormField
                                                control={form.control}
                                                name="show_in_seller_suivi"
                                                render={({ field }) => (
                                                    <ToggleRow field={field} label="Show in seller suivi tab" desc="When off, orders with this status are hidden from the suivi tab." />
                                                )}
                                            />
                                        </div>
                                    </div>
                                </section>

                                {/* Chapter 05 — Performance */}
                                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                    <div className="h-[3px] w-full bg-ant-green" />
                                    <div className="px-4 py-3 border-b border-ant-line">
                                        <div className="flex items-center gap-2">
                                            <span className="font-display text-[10px] text-ant-orange">05</span>
                                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                                Seller performance
                                            </span>
                                        </div>
                                    </div>
                                    <div className="p-3 space-y-2">
                                        <FormField
                                            control={form.control}
                                            name="perf_breakdown"
                                            render={({ field }) => (
                                                <ToggleRow
                                                    field={{
                                                        value: field.value,
                                                        onChange: (v: boolean) => {
                                                            field.onChange(v);
                                                            if (!v) form.setValue('perf_breakdown_phase', null);
                                                        },
                                                    }}
                                                    label="Include in performance breakdown"
                                                    desc="When active, this status appears in seller performance analytics."
                                                />
                                            )}
                                        />
                                        {form.watch('perf_breakdown') && (
                                            <FormField
                                                control={form.control}
                                                name="perf_breakdown_phase"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-2 p-3 rounded-xl bg-ant-light border border-ant-line">
                                                        <FormLabel className="text-[11px] font-medium text-ant-ink">Phase</FormLabel>
                                                        <FormDescription className="font-serif italic text-[11px] text-ant-mid">
                                                            Before = pre-confirmation statuses. After = post-confirmation statuses.
                                                        </FormDescription>
                                                        <div className="grid grid-cols-2 gap-2 pt-1">
                                                            <button
                                                                type="button"
                                                                onClick={() => field.onChange('before_confirmation')}
                                                                className={cn(
                                                                    'h-9 rounded-full text-[11px] font-medium transition-all border',
                                                                    field.value === 'before_confirmation'
                                                                        ? 'bg-ant-ink text-ant-light border-ant-ink'
                                                                        : 'bg-ant-paper text-ant-mid border-ant-line hover:text-ant-ink hover:border-ant-ink/30',
                                                                )}
                                                            >
                                                                Before
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => field.onChange('after_confirmation')}
                                                                className={cn(
                                                                    'h-9 rounded-full text-[11px] font-medium transition-all border',
                                                                    field.value === 'after_confirmation'
                                                                        ? 'bg-ant-ink text-ant-light border-ant-ink'
                                                                        : 'bg-ant-paper text-ant-mid border-ant-line hover:text-ant-ink hover:border-ant-ink/30',
                                                                )}
                                                            >
                                                                After
                                                            </button>
                                                        </div>
                                                        <FormMessage className="text-[10px] text-ant-rose" />
                                                    </FormItem>
                                                )}
                                            />
                                        )}
                                    </div>
                                </section>

                                {/* Chapter 06 — Attached service statuses (packages only) */}
                                {activeTab === 'packages' && (
                                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                        <div className="h-[3px] w-full bg-ant-ink" />
                                        <div className="px-4 py-3 border-b border-ant-line flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2">
                                                <span className="font-display text-[10px] text-ant-orange">06</span>
                                                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                                    Attached service statuses
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => append({ value: '' })}
                                                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[11px] font-medium hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors"
                                            >
                                                <Plus className="w-3 h-3" /> Add
                                            </button>
                                        </div>
                                        <div className="p-3 space-y-1.5">
                                            {fields.length === 0 ? (
                                                <div className="py-6 rounded-xl border border-dashed border-ant-line bg-ant-light flex flex-col items-center justify-center text-center gap-1.5">
                                                    <Truck className="w-5 h-5 text-ant-mid" />
                                                    <p className="font-serif italic text-[11px] text-ant-mid">No statuses attached</p>
                                                </div>
                                            ) : (
                                                fields.map((field, index) => (
                                                    <div key={field.id} className="flex gap-2 items-center">
                                                        <FormField
                                                            control={form.control}
                                                            name={`delivery_service_statuses.${index}.value`}
                                                            render={({ field }) => (
                                                                <FormItem className="flex-1">
                                                                    <FormControl>
                                                                        <input placeholder="e.g. READY_TO_SHIP" {...field} className={cn(inputClass, 'h-9 font-mono uppercase')} />
                                                                    </FormControl>
                                                                </FormItem>
                                                            )}
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => remove(index)}
                                                            className="w-9 h-9 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-mid hover:bg-ant-rose/10 hover:text-ant-rose hover:border-ant-rose/30 transition-colors shrink-0"
                                                        >
                                                            <X className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </section>
                                )}
                            </div>

                            <div className="shrink-0 px-5 py-3 flex flex-row gap-2 bg-ant-paper border-t border-ant-line pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                                <button
                                    type="button"
                                    onClick={() => setIsUpsertOpen(false)}
                                    className="flex-1 sm:flex-initial h-11 px-5 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[12px] font-medium hover:bg-ant-light transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={upsertMutation.isPending}
                                    className="flex-1 h-11 px-5 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium flex items-center justify-center gap-2 hover:bg-ant-ink/95 disabled:opacity-60 transition-all shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)]"
                                >
                                    {upsertMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                    {editingStatus ? 'Save changes' : 'Create status'}
                                </button>
                            </div>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* View Modal */}
            <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
                <DialogContent className={cn(
                    'max-w-md p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden',
                    'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]',
                    'sm:rounded-2xl',
                    'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                    'max-sm:!translate-x-0 max-sm:!translate-y-0',
                    'max-sm:!w-full max-sm:!max-w-none',
                    'max-sm:!rounded-t-2xl max-sm:!rounded-b-none',
                    '[&>button.absolute]:hidden',
                )}>
                    {viewingStatus && (
                        <>
                            <div className="h-[3px] w-full" style={{ backgroundColor: viewingStatus.color || '#D97706' }} />
                            <DialogHeader className="px-5 pt-4 pb-4 border-b border-ant-line text-left space-y-1.5">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 space-y-1.5 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: viewingStatus.color || '#D97706' }} />
                                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                                Status · Summary
                                            </span>
                                            {!viewingStatus.active && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] bg-ant-mid/10 text-ant-mid">
                                                    Inactive
                                                </span>
                                            )}
                                        </div>
                                        <DialogTitle className="font-display text-[18px] leading-tight text-ant-ink">
                                            {viewingStatus.label}
                                        </DialogTitle>
                                        <DialogDescription className="font-mono text-[11px] uppercase tracking-[0.14em] text-ant-mid">
                                            {viewingStatus.code}
                                        </DialogDescription>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsViewOpen(false)}
                                        className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light flex items-center justify-center text-ant-ink shrink-0 transition-colors"
                                        aria-label="Close"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </DialogHeader>

                            <div className="px-5 py-4 space-y-4">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="rounded-xl bg-ant-light border border-ant-line p-3 space-y-1">
                                        <p className="text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Ranking</p>
                                        <p className="font-display text-[18px] tabular-nums text-ant-ink">#{viewingStatus.ranking}</p>
                                    </div>
                                    <div className="rounded-xl bg-ant-light border border-ant-line p-3 space-y-1">
                                        <p className="text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Recheck</p>
                                        <p className={cn('font-display text-[14px]', viewingStatus.recheck ? 'text-ant-orange' : 'text-ant-mid')}>
                                            {viewingStatus.recheck ? 'Yes' : 'No'}
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <p className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">Display options</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {activeTab === 'orders' && (
                                            <>
                                                <VisibilityPill on={viewingStatus.show_in_order !== false} label="Order modals" />
                                                <VisibilityPill on={viewingStatus.show_in_quick_status !== false} label="Quick status" />
                                            </>
                                        )}
                                        {activeTab === 'packages' && (
                                            <VisibilityPill on={viewingStatus.show_in_courier !== false} label="Courier" />
                                        )}
                                        <VisibilityPill on={viewingStatus.show_in_seller_confirmation !== false} label="Confirmation" />
                                        <VisibilityPill on={viewingStatus.show_in_seller_suivi !== false} label="Suivi" />
                                        <span className={cn(
                                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]',
                                            viewingStatus.perf_breakdown ? 'bg-ant-orange/12 text-ant-orange' : 'bg-ant-mid/10 text-ant-mid',
                                        )}>
                                            Perf: {viewingStatus.perf_breakdown ? (viewingStatus.perf_breakdown_phase === 'before_confirmation' ? 'Before' : 'After') : 'Off'}
                                        </span>
                                    </div>
                                </div>

                                {activeTab === 'packages' && Array.isArray(viewingStatus.delivery_service_statuses) && viewingStatus.delivery_service_statuses.length > 0 && (
                                    <div className="space-y-2 pt-3 border-t border-ant-line">
                                        <p className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">Attached service statuses</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {viewingStatus.delivery_service_statuses.map((status: string, idx: number) => (
                                                <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-[0.1em] bg-ant-light border border-ant-line text-ant-ink">
                                                    {status}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {isOwner && (
                                <div className="px-5 py-3 border-t border-ant-line flex items-center justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => { setIsViewOpen(false); setStatusToDelete(viewingStatus); }}
                                        className="w-10 h-10 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-mid hover:bg-ant-rose/10 hover:text-ant-rose hover:border-ant-rose/30 transition-colors"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setIsViewOpen(false); openUpsert(viewingStatus); }}
                                        className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium hover:bg-ant-ink/95 transition-colors shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)]"
                                    >
                                        <Edit2 className="w-3.5 h-3.5" />
                                        Edit configuration
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={!!statusToDelete} onOpenChange={() => setStatusToDelete(null)}>
                <AlertDialogContent className={cn(
                    'max-w-md p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden',
                    'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]',
                    'sm:rounded-2xl',
                )}>
                    <div className="h-[3px] w-full bg-ant-rose" />
                    <AlertDialogHeader className="px-5 pt-4 pb-4 border-b border-ant-line text-left space-y-2">
                        <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-xl bg-ant-rose/10 border border-ant-rose/25 flex items-center justify-center text-ant-rose shrink-0">
                                <AlertTriangle className="w-4 h-4" />
                            </div>
                            <div className="min-w-0 space-y-1">
                                <div className="flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-ant-rose" />
                                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-rose">
                                        Status · Delete
                                    </span>
                                </div>
                                <AlertDialogTitle className="font-display text-[18px] leading-tight text-ant-ink">
                                    Delete status?
                                </AlertDialogTitle>
                                <AlertDialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                    Permanently delete <span className="font-display not-italic text-ant-ink">"{statusToDelete?.label}"</span>. Orders currently using it will lose this label.
                                </AlertDialogDescription>
                            </div>
                        </div>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="px-5 py-3 flex flex-row gap-2 bg-ant-paper border-t border-ant-line">
                        <AlertDialogCancel className="flex-1 h-11 px-5 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[12px] font-medium hover:bg-ant-light transition-colors mt-0">
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => statusToDelete && deleteMutation.mutate(statusToDelete.id)}
                            className="flex-1 h-11 px-5 rounded-full bg-ant-rose text-white text-[12px] font-medium flex items-center justify-center gap-2 hover:bg-ant-rose/95 transition-all shadow-[0_10px_24px_-10px_rgba(201,57,66,0.5)]"
                        >
                            {deleteMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

// ── Sub-components ──────────────────────────────────────────────────────

const KpiTile = ({ label, value, accent }: { label: string; value: number; accent: string }) => (
    <div className="bg-ant-paper p-4 md:p-5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
            <span className={cn('w-1 h-4 rounded-full', accent)} />
            <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid truncate">{label}</span>
        </div>
        <p className="font-display text-[22px] md:text-[26px] leading-none tabular-nums text-ant-ink">
            {value.toLocaleString('fr-MA')}
        </p>
    </div>
);

const ToggleRow = ({
    field,
    label,
    desc,
}: {
    field: { value: boolean; onChange: (v: boolean) => void };
    label: string;
    desc: string;
}) => (
    <FormItem className="flex items-center justify-between gap-3 p-3 rounded-xl bg-ant-light border border-ant-line">
        <div className="min-w-0 space-y-0.5 flex-1">
            <FormLabel className="text-[12px] font-medium text-ant-ink">{label}</FormLabel>
            <FormDescription className="font-serif italic text-[11px] text-ant-mid leading-snug">
                {desc}
            </FormDescription>
        </div>
        <FormControl>
            <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
                className="data-[state=checked]:bg-ant-green scale-90 shrink-0"
            />
        </FormControl>
    </FormItem>
);

const VisibilityPill = ({ on, label }: { on: boolean; label: string }) => (
    <span className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]',
        on ? 'bg-ant-green/12 text-ant-green' : 'bg-ant-rose/10 text-ant-rose',
    )}>
        <span className={cn('w-1 h-1 rounded-full', on ? 'bg-ant-green' : 'bg-ant-rose')} />
        {label}: {on ? 'On' : 'Off'}
    </span>
);

type StatusItemProps = {
    status: StatusRow;
    activeTab: 'orders' | 'packages';
    isOwner: boolean;
    onEdit: () => void;
    onView: () => void;
    onDelete: () => void;
};

const StatusListRow = ({ status, activeTab, isOwner, onEdit, onView, onDelete }: StatusItemProps) => (
    <div
        className={cn(
            'flex items-center gap-3 px-4 py-3 bg-ant-paper hover:bg-ant-light/40 transition-colors',
            !status.active && 'opacity-60',
        )}
    >
        {status.icon ? (
            <span
                className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center"
                style={{ backgroundColor: `${status.color || '#D97706'}1f`, color: status.color || '#D97706' }}
            >
                <DynamicIcon name={status.icon} className="w-4 h-4" />
            </span>
        ) : (
            <span
                className="w-1 h-8 rounded-full shrink-0"
                style={{ backgroundColor: status.color || '#D97706' }}
            />
        )}
        <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-display text-[13px] text-ant-ink truncate">{status.label}</span>
                {!status.active && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] bg-ant-mid/10 text-ant-mid">
                        Inactive
                    </span>
                )}
                {activeTab === 'orders' && status.show_in_order === false && (
                    <HiddenInOrdersBadge className="shrink-0" />
                )}
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ant-mid truncate mt-0.5">{status.code}</p>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
            <span className="font-display text-[10px] text-ant-mid tabular-nums">#{status.ranking}</span>
            {status.recheck && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] bg-ant-orange/12 text-ant-orange">
                    <RefreshCcw className="w-2.5 h-2.5" /> Recheck
                </span>
            )}
            {activeTab === 'packages' && Array.isArray(status.delivery_service_statuses) && status.delivery_service_statuses.length > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] bg-ant-light border border-ant-line text-ant-mid">
                    {status.delivery_service_statuses.length} codes
                </span>
            )}
        </div>
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-ink hover:bg-ant-light transition-colors shrink-0"
                >
                    <MoreVertical className="w-3.5 h-3.5" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-xl border-ant-line bg-ant-paper p-1 min-w-[140px] shadow-[0_12px_30px_-12px_rgba(20,20,19,0.25)]">
                <DropdownMenuItem onClick={onView} className="rounded-lg px-2.5 py-2 text-[12px] cursor-pointer gap-2 focus:bg-ant-light">
                    <Eye className="w-3.5 h-3.5" /> Summary
                </DropdownMenuItem>
                {isOwner && (
                    <>
                        <DropdownMenuItem onClick={onEdit} className="rounded-lg px-2.5 py-2 text-[12px] cursor-pointer gap-2 focus:bg-ant-light">
                            <Edit2 className="w-3.5 h-3.5" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-ant-line" />
                        <DropdownMenuItem onClick={onDelete} className="rounded-lg px-2.5 py-2 text-[12px] cursor-pointer gap-2 text-ant-rose focus:text-ant-rose focus:bg-ant-rose/10">
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    </div>
);

const StatusCard = ({ status, activeTab, isOwner, onEdit, onView, onDelete }: StatusItemProps) => {
    const color = status.color || '#D97706';
    return (
        <div
            className={cn(
                'group rounded-2xl border border-ant-line bg-ant-paper overflow-hidden hover:border-ant-ink/25 transition-colors',
                !status.active && 'opacity-60',
            )}
        >
            <div className="h-[3px] w-full" style={{ backgroundColor: color }} />
            <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]"
                                style={{ backgroundColor: `${color}18`, color }}
                            >
                                <span className="w-1 h-1 rounded-full" style={{ backgroundColor: color }} />
                                {status.active ? 'Active' : 'Inactive'}
                            </span>
                            {activeTab === 'orders' && status.show_in_order === false && (
                                <HiddenInOrdersBadge />
                            )}
                        </div>
                        <h3 className="font-display text-[14px] text-ant-ink leading-tight truncate">{status.label}</h3>
                        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ant-mid truncate">{status.code}</p>
                    </div>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-ink hover:bg-ant-light transition-colors shrink-0"
                            >
                                <MoreVertical className="w-3.5 h-3.5" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xl border-ant-line bg-ant-paper p-1 min-w-[140px] shadow-[0_12px_30px_-12px_rgba(20,20,19,0.25)]">
                            <DropdownMenuItem onClick={onView} className="rounded-lg px-2.5 py-2 text-[12px] cursor-pointer gap-2 focus:bg-ant-light">
                                <Eye className="w-3.5 h-3.5" /> Summary
                            </DropdownMenuItem>
                            {isOwner && (
                                <>
                                    <DropdownMenuItem onClick={onEdit} className="rounded-lg px-2.5 py-2 text-[12px] cursor-pointer gap-2 focus:bg-ant-light">
                                        <Edit2 className="w-3.5 h-3.5" /> Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator className="bg-ant-line" />
                                    <DropdownMenuItem onClick={onDelete} className="rounded-lg px-2.5 py-2 text-[12px] cursor-pointer gap-2 text-ant-rose focus:text-ant-rose focus:bg-ant-rose/10">
                                        <Trash2 className="w-3.5 h-3.5" /> Delete
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-ant-line">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-display text-[11px] text-ant-mid tabular-nums">Rank #{status.ranking}</span>
                        {status.recheck && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] bg-ant-orange/12 text-ant-orange">
                                <RefreshCcw className="w-2.5 h-2.5" /> Recheck
                            </span>
                        )}
                    </div>
                    {activeTab === 'packages' && Array.isArray(status.delivery_service_statuses) && status.delivery_service_statuses.length > 0 && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] bg-ant-light border border-ant-line text-ant-mid">
                            {status.delivery_service_statuses.length} codes
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

// ── Behaviors (semantic flags) config ───────────────────────────────────
// Owner-governable source of truth for "which status means what". Each section
// is one boolean flag on the master row; clicking a pill toggles that status'
// membership. The useStatusCategories hub reads these flags directly, so a
// toggle here re-routes every downstream rate / payout / analytics decision.

type BehaviorRow = {
    id: string;
    code: string;
    label: string;
    color: string | null;
    ranking: number | null;
    [flag: string]: string | number | boolean | null;
};

type BehaviorDef = { flag: string; title: string; desc: string; accent: string };

const ORDER_BEHAVIORS: BehaviorDef[] = [
    { flag: 'is_new', accent: 'bg-ant-mid', title: 'Nouvelle commande', desc: "Commandes neuves jamais appelées — exclues du dénominateur du taux de confirmation." },
    { flag: 'is_confirmed', accent: 'bg-ant-green', title: 'Confirmée', desc: "Compte comme confirmée (numérateur du taux de confirmation). Inclut payé / impayé / traité." },
    { flag: 'deducts_stock', accent: 'bg-ant-green', title: 'Déduit le stock', desc: "Passer une commande à ce statut valide et déduit le stock (l'ancienne catégorie « confirmée » exacte). Garde le stock réservé." },
    { flag: 'is_paid', accent: 'bg-ant-green', title: 'Payée', desc: "Commande encaissée." },
    { flag: 'is_unpaid', accent: 'bg-ant-ink', title: 'Impayée', desc: "Livrée mais non encaissée." },
    { flag: 'is_cancelled', accent: 'bg-ant-rose', title: 'Annulée', desc: "Annulée / fausse / double / blacklist — sortie du flux de livraison." },
    { flag: 'is_fake', accent: 'bg-ant-rose', title: 'Fausse commande', desc: "Classée fausse — comptée à part dans les statistiques (sous-ensemble d'annulée)." },
    { flag: 'is_double', accent: 'bg-ant-rose', title: 'Commande double', desc: "Doublon — compté à part dans les statistiques (sous-ensemble d'annulée)." },
    { flag: 'is_blacklisted', accent: 'bg-ant-rose', title: 'Blacklist', desc: "Client blacklisté — sous-ensemble d'annulée." },
    { flag: 'is_callback', accent: 'bg-ant-orange', title: 'Rappel / injoignable', desc: "Tentative d'appel sans réponse — exclue des deux côtés du taux de confirmation." },
    { flag: 'is_postponed', accent: 'bg-ant-orange', title: 'Reportée', desc: "Commande reportée — utilisée pour l'affichage et l'historique." },
    { flag: 'is_relaunch', accent: 'bg-ant-mid', title: 'Relance', desc: "Relance d'une nouvelle commande — garde le stock réservé comme une confirmée." },
    { flag: 'is_return', accent: 'bg-ant-rose', title: 'Retour produit', desc: "Demande de retour — bloque le passage auto en impayé et déclenche la réintégration du stock à réception." },
    { flag: 'excluded_from_delivery_rate', accent: 'bg-ant-rose', title: 'Exclue du taux de livraison', desc: "Annulation vendeur/admin avant livraison — retirée du dénominateur du taux de livraison." },
];

const PKG_BEHAVIORS: BehaviorDef[] = [
    { flag: 'is_new', accent: 'bg-ant-mid', title: 'Nouveau colis', desc: "Colis pas encore expédié." },
    { flag: 'is_shipped', accent: 'bg-ant-ink', title: 'Expédié / en transit', desc: "Pris en charge, en transit, ou en distribution." },
    { flag: 'is_awaiting_pickup', accent: 'bg-ant-ink', title: 'En attente de ramassage', desc: "Colis placé dans un bon de ramassage, en attente d'enlèvement par le transporteur. Le statut stampé automatiquement à la création du bon (sous-ensemble d'expédié)." },
    { flag: 'is_delivered', accent: 'bg-ant-green', title: 'Livré', desc: "Colis livré — numérateur du taux de livraison et déclencheur des paiements." },
    { flag: 'is_returned', accent: 'bg-ant-rose', title: 'Retourné', desc: "Retour, préparation retour, ou refusé." },
    { flag: 'is_refused', accent: 'bg-ant-rose', title: 'Refusé', desc: "Colis refusé par le client (sous-ensemble de retourné)." },
    { flag: 'is_cancelled', accent: 'bg-ant-rose', title: 'Annulé (colis)', desc: "Colis annulé." },
    { flag: 'is_postponed', accent: 'bg-ant-orange', title: 'Reporté (colis)', desc: "Livraison reportée." },
    { flag: 'is_recheck', accent: 'bg-ant-orange', title: 'À revérifier', desc: "Statut à revérifier." },
    { flag: 'is_terminal', accent: 'bg-ant-ink', title: 'Statut final (verrou)', desc: "Statut terminal (livré / retourné / refusé / annulé) — verrouille toute transition ultérieure poussée par le webhook fournisseur." },
    { flag: 'excluded_from_delivery_rate', accent: 'bg-ant-rose', title: 'Exclu du taux de livraison', desc: "Hors-zone / annulé côté courrier — retiré du dénominateur du taux de livraison." },
];

const StatusFlagPill = ({ row, on, disabled, onClick }: { row: BehaviorRow; on: boolean; disabled: boolean; onClick: () => void }) => {
    const color = row.color || '#D97706';
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            title={row.label}
            className={cn(
                'inline-flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-full text-[11px] font-medium border transition-all',
                disabled ? 'cursor-default' : 'hover:shadow-[0_4px_12px_-8px_rgba(20,20,19,0.45)]',
                on ? 'text-ant-ink' : 'text-ant-mid border-dashed opacity-70 hover:opacity-100',
            )}
            style={on ? { backgroundColor: `${color}18`, borderColor: `${color}66` } : { borderColor: `${color}40` }}
        >
            <span
                className="w-2 h-2 rounded-full shrink-0"
                style={on ? { backgroundColor: color } : { border: `1.5px solid ${color}` }}
            />
            <span className="truncate max-w-[150px]">{row.label}</span>
            {on && <Check className="w-3 h-3 shrink-0" style={{ color }} />}
        </button>
    );
};

const BehaviorSection = ({
    def, rows, table, index, isOwner, savingKey, onToggle,
}: {
    def: BehaviorDef;
    rows: BehaviorRow[];
    table: 'order_statuses' | 'package_statuses';
    index: number;
    isOwner: boolean;
    savingKey: string | null;
    onToggle: (v: { table: 'order_statuses' | 'package_statuses'; id: string; flag: string; value: boolean }) => void;
}) => {
    const activeCount = rows.filter((r) => !!r[def.flag]).length;
    return (
        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
            <div className={cn('h-[3px] w-full', def.accent)} />
            <div className="px-4 py-3 border-b border-ant-line flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-display text-[10px] text-ant-orange">{String(index + 1).padStart(2, '0')}</span>
                        <span className="font-display text-[13px] tracking-[-0.01em] text-ant-ink">{def.title}</span>
                        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ant-mid/70">{def.flag}</span>
                    </div>
                    <p className="font-serif italic text-[11px] text-ant-mid leading-snug">{def.desc}</p>
                </div>
                <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] bg-ant-light border border-ant-line text-ant-mid tabular-nums">
                    {activeCount} / {rows.length}
                </span>
            </div>
            <div className="p-3 flex flex-wrap gap-1.5">
                {rows.map((r) => {
                    const on = !!r[def.flag];
                    return (
                        <StatusFlagPill
                            key={r.id}
                            row={r}
                            on={on}
                            disabled={!isOwner || savingKey === `${r.id}:${def.flag}`}
                            onClick={() => onToggle({ table, id: r.id, flag: def.flag, value: !on })}
                        />
                    );
                })}
            </div>
        </section>
    );
};

const BehaviorsConfig = ({ isOwner }: { isOwner: boolean }) => {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const [savingKey, setSavingKey] = useState<string | null>(null);

    const { data: orderRows = [], isLoading: loadingOrders } = useQuery({
        queryKey: ['behaviors', 'order_statuses'],
        staleTime: 5 * 60_000,
        queryFn: async () => {
            const { data, error } = await supabase
                .from('order_statuses')
                .select('id, code, label, color, ranking, is_new, is_confirmed, deducts_stock, is_paid, is_unpaid, is_cancelled, is_fake, is_double, is_blacklisted, is_callback, is_postponed, is_relaunch, is_return, excluded_from_delivery_rate')
                .order('ranking', { ascending: true });
            if (error) throw error;
            return (data || []) as unknown as BehaviorRow[];
        },
    });

    const { data: pkgRows = [], isLoading: loadingPkg } = useQuery({
        queryKey: ['behaviors', 'package_statuses'],
        staleTime: 5 * 60_000,
        queryFn: async () => {
            const { data, error } = await supabase
                .from('package_statuses')
                .select('id, code, label, color, ranking, is_new, is_shipped, is_awaiting_pickup, is_delivered, is_returned, is_refused, is_cancelled, is_postponed, is_recheck, is_terminal, excluded_from_delivery_rate')
                .order('ranking', { ascending: true });
            if (error) throw error;
            return (data || []) as unknown as BehaviorRow[];
        },
    });

    const toggle = useMutation({
        mutationFn: async ({ table, id, flag, value }: { table: 'order_statuses' | 'package_statuses'; id: string; flag: string; value: boolean }) => {
            const { error } = await supabase.from(table).update({ [flag]: value } as never).eq('id', id);
            if (error) throw error;
        },
        onMutate: (v) => setSavingKey(`${v.id}:${v.flag}`),
        onSettled: () => setSavingKey(null),
        onSuccess: (_d, v) => {
            queryClient.invalidateQueries({ queryKey: ['behaviors', v.table] });
            // Re-route every downstream decision: the useStatusCategories hub is
            // cached for 5min, so force it to re-read the flags now.
            queryClient.invalidateQueries({ queryKey: ['order_statuses_cat'] });
            queryClient.invalidateQueries({ queryKey: ['package_statuses_cat'] });
        },
        onError: (e) => toast({ title: 'Error', description: errorMessage(e), variant: 'destructive' }),
    });

    const Group = ({ title, icon: Icon, defs, rows, table, loading }: {
        title: string;
        icon: typeof ClipboardCheck;
        defs: BehaviorDef[];
        rows: BehaviorRow[];
        table: 'order_statuses' | 'package_statuses';
        loading: boolean;
    }) => (
        <div className="space-y-3">
            <div className="flex items-center gap-2 px-1">
                <Icon className="w-3.5 h-3.5 text-ant-ink" />
                <span className="font-display text-[11px] uppercase tracking-[0.22em] text-ant-ink">{title}</span>
                <span className="font-serif italic text-[11px] text-ant-mid">· {rows.length} statuts</span>
            </div>
            {loading ? (
                <div className="space-y-3">
                    {Array.from({ length: defs.length }).map((_, i) => (
                        <Skeleton key={i} className="h-28 w-full rounded-2xl" />
                    ))}
                </div>
            ) : (
                defs.map((def, i) => (
                    <BehaviorSection
                        key={def.flag}
                        def={def}
                        rows={rows}
                        table={table}
                        index={i}
                        isOwner={isOwner}
                        savingKey={savingKey}
                        onToggle={toggle.mutate}
                    />
                ))
            )}
        </div>
    );

    return (
        <div className="space-y-6">
            <div className="rounded-2xl border border-ant-line bg-ant-light/40 px-4 py-3 flex items-start gap-3">
                <SlidersHorizontal className="w-4 h-4 text-ant-orange shrink-0 mt-0.5" />
                <p className="font-serif italic text-[12px] text-ant-mid leading-relaxed">
                    Chaque section est une règle métier. Allumez un statut pour qu'il porte ce comportement —
                    cela pilote directement les taux de confirmation / livraison, les paiements et les analytics.
                    Un statut peut porter plusieurs comportements.
                    {!isOwner && <span className="not-italic font-medium text-ant-rose"> Lecture seule (réservé au propriétaire).</span>}
                </p>
            </div>

            <Group title="Commandes" icon={ClipboardCheck} defs={ORDER_BEHAVIORS} rows={orderRows} table="order_statuses" loading={loadingOrders} />
            <Group title="Colis" icon={Truck} defs={PKG_BEHAVIORS} rows={pkgRows} table="package_statuses" loading={loadingPkg} />
        </div>
    );
};

export default Status;
