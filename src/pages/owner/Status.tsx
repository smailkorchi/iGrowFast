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
    Eye,
    X,
    Layers,
    RefreshCcw,
    CircleDot,
    Truck,
    ClipboardCheck,
    LayoutGrid,
    List,
    EyeOff,
} from 'lucide-react';
import {
    Card,
    CardContent
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IconPicker } from '@/components/ui/IconPicker';
import { DynamicIcon } from '@/lib/renderReactIcon';
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
    FormDescription
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// --- Schemas ---
const statusSchema = z.object({
    code: z.string().min(2, "Code must be at least 2 characters"),
    label: z.string().min(2, "Label must be at least 2 characters"),
    ranking: z.coerce.number().default(0),
    color: z.string().default("#6366f1"),
    icon: z.string().optional().default(''),
    recheck: z.boolean().default(false),
    active: z.boolean().default(true),
    // Order-specific display options
    show_in_order: z.boolean().default(true),
    show_in_quick_status: z.boolean().default(true),
    show_in_seller_confirmation: z.boolean().default(true),
    // Package-specific display options
    show_in_courier: z.boolean().default(true),
    show_in_seller_suivi: z.boolean().default(true),
    // Shared: performance breakdown
    perf_breakdown: z.boolean().default(false),
    perf_breakdown_phase: z.enum(['before_confirmation', 'after_confirmation']).nullable().default(null),
    delivery_service_statuses: z.array(z.object({
        value: z.string().min(1, "Status code is required")
    })).optional().default([]),
});

type StatusFormValues = z.infer<typeof statusSchema>;

// Common shape across order_statuses + package_statuses (verified via MCP).
type StatusRow = {
    id: string;
    code: string;
    label: string;
    ranking: number | null;
    color: string | null;
    icon: string | null;
    recheck: boolean | null;
    active: boolean | null;
    category: string | null;
    created_at: string | null;
    updated_at: string | null;
    // order_statuses only
    show_in_order?: boolean;
    show_in_quick_status?: boolean;
    show_in_seller_confirmation?: boolean;
    // package_statuses only
    show_in_courier?: boolean;
    show_in_seller_suivi?: boolean;
    delivery_service_statuses?: string[] | null;
    // shared
    perf_breakdown?: boolean;
    perf_breakdown_phase?: string | null;
};

const errorMessage = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);

function OrderModalHiddenBadge({ className }: { className?: string }) {
    return (
        <Badge
            variant="outline"
            className={cn(
                'gap-1.5 rounded-lg border-violet-300/80 bg-gradient-to-br from-violet-50 to-violet-100/80 text-violet-900',
                'font-bold tracking-wide uppercase shadow-sm ring-1 ring-violet-200/50',
                'text-[9px] sm:text-[10px] px-2.5 py-1',
                className
            )}
        >
            <EyeOff className="w-3 h-3 shrink-0 opacity-90" aria-hidden />
            Not in order modals
        </Badge>
    );
}

const Status = () => {
    const [activeTab, setActiveTab] = useState<"orders" | "packages">("orders");
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

    // --- Owner check (only owners can write to order_statuses / package_statuses) ---
    const { data: userRole } = useQuery({
        queryKey: ['currentUserRole'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
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

    // --- Queries ---
    const { data: statuses, isLoading } = useQuery({
        queryKey: ['statuses', activeTab],
        queryFn: async () => {
            const { data, error } = await supabase
                .from(table)
                .select('*')
                .order('ranking', { ascending: true });

            if (error) throw error;
            return (data || []) as unknown as StatusRow[];
        },
    });

    // --- Form Setup ---
    const form = useForm<StatusFormValues>({
        resolver: zodResolver(statusSchema),
        defaultValues: {
            code: '',
            label: '',
            ranking: 0,
            color: '#6366f1',
            recheck: false,
            active: true,
            show_in_order: true,
            delivery_service_statuses: [],
        }
    });

    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: "delivery_service_statuses"
    });

    // --- Mutations ---
    const upsertMutation = useMutation({
        mutationFn: async (values: StatusFormValues) => {
            // Transform the array of objects back to array of strings for DB
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
                    .update(payload)
                    .eq('id', editingStatus.id)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            } else {
                const { data, error } = await supabase
                    .from(table)
                    .insert(payload)
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
                description: `Successfully ${editingStatus ? 'updated' : 'created'} ${form.getValues('label')}.`
            });
        },
        onError: (error) => {
            toast({ title: "Error", description: errorMessage(error), variant: "destructive" });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase
                .from(table)
                .delete()
                .eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['statuses', activeTab] });
            setStatusToDelete(null);
            toast({ title: "Status deleted", description: "The status was successfully removed." });
        },
        onError: (error) => {
            toast({ title: "Error", description: errorMessage(error), variant: "destructive" });
        }
    });

    const handleUpsert = (values: StatusFormValues) => {
        upsertMutation.mutate(values);
    };

    const openUpsert = (status: StatusRow | null = null) => {
        if (status) {
            setEditingStatus(status);
            // Transform array of strings from DB to array of objects for form
            const deliveryStatuses = Array.isArray(status.delivery_service_statuses)
                ? status.delivery_service_statuses.map((s: string) => ({ value: s }))
                : [];

            form.reset({
                code: status.code,
                label: status.label,
                ranking: status.ranking,
                color: status.color || '#6366f1',
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
                color: '#6366f1',
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

    const filteredStatuses = statuses?.filter(s =>
        s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.code.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const renderStatusSection = () => {
        if (isLoading) {
            if (viewMode === 'grid') {
                return (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <Skeleton key={i} className="h-36 w-full rounded-xl" />
                        ))}
                    </div>
                );
            }
            return (
                <div className="rounded-xl border border-gray-100 bg-white overflow-hidden divide-y divide-gray-50">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-14 w-full rounded-none" />
                    ))}
                </div>
            );
        }

        if (!filteredStatuses?.length) {
            return (
                <div className="flex flex-col items-center justify-center py-10 rounded-xl border border-dashed border-gray-200 bg-white">
                    <p className="text-[11px] font-medium text-gray-500">
                        {searchQuery.trim()
                            ? 'No statuses match your search.'
                            : 'No statuses yet. Add one to get started.'}
                    </p>
                </div>
            );
        }

        if (viewMode === 'grid') {
            return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {filteredStatuses.map((status) => (
                        <StatusCard
                            key={status.id}
                            status={status}
                            activeTab={activeTab}
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
            <div className="rounded-xl border border-gray-100 bg-white overflow-hidden divide-y divide-gray-50">
                {filteredStatuses.map((status) => (
                    <StatusListRow
                        key={status.id}
                        status={status}
                        activeTab={activeTab}
                        isOwner={isOwner}
                        onEdit={() => openUpsert(status)}
                        onView={() => { setViewingStatus(status); setIsViewOpen(true); }}
                        onDelete={() => setStatusToDelete(status)}
                    />
                ))}
            </div>
        );
    };

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Status Management</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Define workflow and lifecycle for orders and packages</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <Input
                                placeholder="Search by label or code..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-7 h-8 rounded-md border-gray-200 bg-white text-[11px] w-52"
                            />
                        </div>
                        {isOwner && (
                            <Button
                                onClick={() => openUpsert()}
                                className="h-8 rounded-md text-[11px] font-semibold bg-brand-navy hover:bg-brand-navy/90 text-white gap-1.5 px-3"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                Add {activeTab === "orders" ? "Order" : "Package"} Status
                            </Button>
                        )}
                    </div>
                </div>
            </header>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'orders' | 'packages')} className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <TabsList className="h-8">
                        <TabsTrigger value="orders" className="text-[11px] h-6 px-3 gap-1.5">
                            <ClipboardCheck className="w-3 h-3" />
                            Order Statuses
                        </TabsTrigger>
                        <TabsTrigger value="packages" className="text-[11px] h-6 px-3 gap-1.5">
                            <Truck className="w-3 h-3" />
                            Package Statuses
                        </TabsTrigger>
                    </TabsList>
                    <div className="flex items-center gap-0.5 bg-gray-100 p-0.5 rounded-md">
                        <button
                            type="button"
                            onClick={() => setViewMode('grid')}
                            className={cn(
                                'h-7 w-7 p-0 rounded flex items-center justify-center transition-all',
                                viewMode === 'grid'
                                    ? 'bg-white text-brand-navy shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                            )}
                            aria-label="Grid view"
                        >
                            <LayoutGrid className="w-3 h-3" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('list')}
                            className={cn(
                                'h-7 w-7 p-0 rounded flex items-center justify-center transition-all',
                                viewMode === 'list'
                                    ? 'bg-white text-brand-navy shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                            )}
                            aria-label="List view"
                        >
                            <List className="w-3 h-3" />
                        </button>
                    </div>
                </div>

                <TabsContent value="orders" className="space-y-2 mt-0">
                    {renderStatusSection()}
                </TabsContent>

                <TabsContent value="packages" className="space-y-2 mt-0">
                    {renderStatusSection()}
                </TabsContent>
            </Tabs>

            {/* Upsert Modal */}
            <Dialog open={isUpsertOpen} onOpenChange={setIsUpsertOpen}>
                <DialogContent className="max-w-2xl p-0 border border-gray-100 bg-white rounded-xl shadow-md overflow-hidden flex flex-col max-h-[90vh] gap-0">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleUpsert)} className="flex flex-col min-h-0 flex-1">
                            <DialogHeader className="px-5 pt-5 pb-3 border-b border-gray-100 shrink-0">
                                <div className="flex items-center gap-2.5">
                                    <span
                                        className="w-[3px] self-stretch rounded-full shrink-0"
                                        style={{ background: form.watch('color') || '#6366f1' }}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <DialogTitle className="text-[14px] font-semibold text-brand-navy">
                                            {editingStatus ? 'Edit Status' : 'New Status'}
                                        </DialogTitle>
                                        <DialogDescription className="text-[11px] text-gray-400 mt-0.5">
                                            {form.watch('label') || 'Untitled'} <span className="font-mono uppercase opacity-60">({form.watch('code') || '...'})</span>
                                        </DialogDescription>
                                    </div>
                                    <span
                                        className="text-[9px] font-semibold uppercase tracking-[0.14em] px-2 py-1 rounded shrink-0"
                                        style={{ color: form.watch('color') || '#6366f1', backgroundColor: `${form.watch('color') || '#6366f1'}18` }}
                                    >
                                        {form.watch('label') || 'Preview'}
                                    </span>
                                </div>
                            </DialogHeader>

                            <div className="overflow-y-auto px-5 py-4 space-y-4 flex-1">
                                {/* Identity */}
                                <div className="space-y-3">
                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Identity</p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <FormField
                                            control={form.control}
                                            name="label"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Label</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="Confirmed" {...field} className="h-9 rounded-md border-gray-200 text-[11px]" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="code"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Code</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="CONFIRMED" {...field} className="h-9 rounded-md border-gray-200 text-[11px] font-mono uppercase" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </div>

                                {/* Appearance */}
                                <div className="space-y-3">
                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Appearance</p>
                                    <div className="grid grid-cols-[1fr_auto] gap-3">
                                        <FormField
                                            control={form.control}
                                            name="icon"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Icon</FormLabel>
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
                                                <FormItem className="space-y-1.5 w-20">
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Rank</FormLabel>
                                                    <FormControl>
                                                        <Input type="number" {...field} className="h-9 rounded-md border-gray-200 text-[11px] text-center" />
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
                                                <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Color</FormLabel>
                                                <FormControl>
                                                    <div className="flex gap-2 items-center">
                                                        <Input type="color" {...field} className="h-9 w-9 p-1 rounded-md border-gray-200 cursor-pointer shrink-0" />
                                                        <Input {...field} className="h-9 flex-1 rounded-md border-gray-200 text-[11px] font-mono" />
                                                    </div>
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                {/* Behavior */}
                                <div className="space-y-3">
                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Behavior</p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <FormField
                                            control={form.control}
                                            name="active"
                                            render={({ field }) => (
                                                <FormItem className="flex items-center justify-between p-2.5 rounded-md bg-gray-50 border border-gray-100">
                                                    <FormLabel className="text-[11px] font-semibold text-brand-navy">Active</FormLabel>
                                                    <FormControl>
                                                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="recheck"
                                            render={({ field }) => (
                                                <FormItem className="flex items-center justify-between p-2.5 rounded-md bg-gray-50 border border-gray-100">
                                                    <FormLabel className="text-[11px] font-semibold text-brand-navy">Recheck</FormLabel>
                                                    <FormControl>
                                                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </div>

                                {/* Display Options */}
                                <div className="space-y-3">
                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Display Options</p>

                                    {activeTab === 'orders' && (
                                        <div className="space-y-2">
                                            <FormField
                                                control={form.control}
                                                name="show_in_order"
                                                render={({ field }) => (
                                                    <FormItem className="flex items-center justify-between p-2.5 rounded-md bg-gray-50 border border-gray-100">
                                                        <div className="min-w-0 space-y-0.5">
                                                            <FormLabel className="text-[11px] font-semibold text-brand-navy">Show in Order Modals</FormLabel>
                                                            <FormDescription className="text-[10px] text-gray-400 leading-snug">
                                                                Visible in add/edit order status dropdown.
                                                            </FormDescription>
                                                        </div>
                                                        <FormControl>
                                                            <Switch checked={field.value} onCheckedChange={field.onChange} className="shrink-0" />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={form.control}
                                                name="show_in_quick_status"
                                                render={({ field }) => (
                                                    <FormItem className="flex items-center justify-between p-2.5 rounded-md bg-gray-50 border border-gray-100">
                                                        <div className="min-w-0 space-y-0.5">
                                                            <FormLabel className="text-[11px] font-semibold text-brand-navy">Show in Quick Status Change</FormLabel>
                                                            <FormDescription className="text-[10px] text-gray-400 leading-snug">
                                                                Visible in the quick status change grid on orders.
                                                            </FormDescription>
                                                        </div>
                                                        <FormControl>
                                                            <Switch checked={field.value} onCheckedChange={field.onChange} className="shrink-0" />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    )}

                                    {activeTab === 'packages' && (
                                        <div className="space-y-2">
                                            <FormField
                                                control={form.control}
                                                name="show_in_courier"
                                                render={({ field }) => (
                                                    <FormItem className="flex items-center justify-between p-2.5 rounded-md bg-gray-50 border border-gray-100">
                                                        <div className="min-w-0 space-y-0.5">
                                                            <FormLabel className="text-[11px] font-semibold text-brand-navy">Show in Courier Statuses</FormLabel>
                                                            <FormDescription className="text-[10px] text-gray-400 leading-snug">
                                                                Visible in courier views and parcel tracking.
                                                            </FormDescription>
                                                        </div>
                                                        <FormControl>
                                                            <Switch checked={field.value} onCheckedChange={field.onChange} className="shrink-0" />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    )}

                                    <div className="space-y-2 pt-1">
                                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-300">Seller Tabs</p>
                                        <FormField
                                            control={form.control}
                                            name="show_in_seller_confirmation"
                                            render={({ field }) => (
                                                <FormItem className="flex items-center justify-between p-2.5 rounded-md bg-gray-50 border border-gray-100">
                                                    <div className="min-w-0 space-y-0.5">
                                                        <FormLabel className="text-[11px] font-semibold text-brand-navy">Show in Seller Confirmation Tab</FormLabel>
                                                        <FormDescription className="text-[10px] text-gray-400 leading-snug">
                                                            When off, orders with this status are hidden from the confirmation tab.
                                                        </FormDescription>
                                                    </div>
                                                    <FormControl>
                                                        <Switch checked={field.value} onCheckedChange={field.onChange} className="shrink-0" />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="show_in_seller_suivi"
                                            render={({ field }) => (
                                                <FormItem className="flex items-center justify-between p-2.5 rounded-md bg-gray-50 border border-gray-100">
                                                    <div className="min-w-0 space-y-0.5">
                                                        <FormLabel className="text-[11px] font-semibold text-brand-navy">Show in Seller Suivi Tab</FormLabel>
                                                        <FormDescription className="text-[10px] text-gray-400 leading-snug">
                                                            When off, orders with this status are hidden from the suivi tab.
                                                        </FormDescription>
                                                    </div>
                                                    <FormControl>
                                                        <Switch checked={field.value} onCheckedChange={field.onChange} className="shrink-0" />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </div>

                                {/* Performance Breakdown */}
                                <div className="space-y-3">
                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Seller Performance Breakdown</p>
                                    <FormField
                                        control={form.control}
                                        name="perf_breakdown"
                                        render={({ field }) => (
                                            <FormItem className="flex items-center justify-between p-2.5 rounded-md bg-gray-50 border border-gray-100">
                                                <div className="min-w-0 space-y-0.5">
                                                    <FormLabel className="text-[11px] font-semibold text-brand-navy">Include in Performance Breakdown</FormLabel>
                                                    <FormDescription className="text-[10px] text-gray-400 leading-snug">
                                                        When active, this status appears in seller performance analytics.
                                                    </FormDescription>
                                                </div>
                                                <FormControl>
                                                    <Switch checked={field.value} onCheckedChange={(v) => {
                                                        field.onChange(v);
                                                        if (!v) form.setValue('perf_breakdown_phase', null);
                                                    }} className="shrink-0" />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    {form.watch('perf_breakdown') && (
                                        <FormField
                                            control={form.control}
                                            name="perf_breakdown_phase"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2 p-2.5 rounded-md bg-gray-50 border border-gray-100">
                                                    <FormLabel className="text-[11px] font-semibold text-brand-navy">Phase</FormLabel>
                                                    <FormDescription className="text-[10px] text-gray-400 leading-snug">
                                                        Before = pre-confirmation statuses. After = post-confirmation statuses.
                                                    </FormDescription>
                                                    <div className="grid grid-cols-2 gap-2 pt-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => field.onChange('before_confirmation')}
                                                            className={cn(
                                                                'h-8 rounded-md text-[11px] font-semibold uppercase tracking-wide transition-all border',
                                                                field.value === 'before_confirmation'
                                                                    ? 'bg-brand-navy text-white border-brand-navy'
                                                                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                                                            )}
                                                        >
                                                            Before
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => field.onChange('after_confirmation')}
                                                            className={cn(
                                                                'h-8 rounded-md text-[11px] font-semibold uppercase tracking-wide transition-all border',
                                                                field.value === 'after_confirmation'
                                                                    ? 'bg-brand-navy text-white border-brand-navy'
                                                                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                                                            )}
                                                        >
                                                            After
                                                        </button>
                                                    </div>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    )}
                                </div>

                                {activeTab === 'packages' && (
                                    <div className="space-y-3 pt-3 border-t border-gray-100">
                                        <div className="flex items-center justify-between">
                                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Attached Service Statuses</p>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => append({ value: '' })}
                                                className="h-7 px-2.5 text-[10px] font-semibold text-brand-navy hover:bg-gray-100 gap-1 rounded-md"
                                            >
                                                <Plus className="w-3 h-3" /> Add
                                            </Button>
                                        </div>

                                        {fields.length === 0 && (
                                            <div className="py-6 border border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center text-center">
                                                <Truck className="w-5 h-5 mb-1.5 text-gray-300" />
                                                <p className="text-[10px] text-gray-400">No statuses attached</p>
                                            </div>
                                        )}

                                        <div className="space-y-2">
                                            {fields.map((field, index) => (
                                                <div key={field.id} className="flex gap-2 items-center">
                                                    <FormField
                                                        control={form.control}
                                                        name={`delivery_service_statuses.${index}.value`}
                                                        render={({ field }) => (
                                                            <FormItem className="flex-1">
                                                                <FormControl>
                                                                    <Input placeholder="e.g. READY_TO_SHIP" {...field} className="h-8 rounded-md border-gray-200 text-[11px] font-mono uppercase" />
                                                                </FormControl>
                                                            </FormItem>
                                                        )}
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => remove(index)}
                                                        className="h-8 w-8 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md shrink-0"
                                                    >
                                                        <X className="w-3.5 h-3.5" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <DialogFooter className="px-5 py-3 border-t border-gray-100 shrink-0 gap-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => setIsUpsertOpen(false)}
                                    className="h-8 px-3 text-[11px] font-semibold text-gray-500"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={upsertMutation.isPending}
                                    className="h-8 px-4 text-[11px] font-semibold bg-brand-navy hover:bg-brand-navy/90 text-white rounded-md gap-1.5"
                                >
                                    {upsertMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                                    {editingStatus ? 'Update Status' : 'Create Status'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* View Modal */}
            <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
                <DialogContent className="max-w-md p-0 border border-gray-100 bg-white rounded-xl shadow-md overflow-hidden gap-0">
                    {viewingStatus && (
                        <div className="flex flex-col">
                            <DialogHeader className="px-5 pt-5 pb-3 border-b border-gray-100">
                                <div className="flex items-center gap-2.5">
                                    <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: viewingStatus.color || '#6366f1' }} />
                                    <div className="min-w-0 flex-1">
                                        <DialogTitle className="text-[14px] font-semibold text-brand-navy">{viewingStatus.label}</DialogTitle>
                                        <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400 mt-0.5">{viewingStatus.code}</p>
                                    </div>
                                    {!viewingStatus.active && (
                                        <Badge variant="secondary" className="text-[9px] font-semibold uppercase bg-red-50 text-red-500 border-red-100">Inactive</Badge>
                                    )}
                                </div>
                            </DialogHeader>

                            <div className="px-5 py-4 space-y-4">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="rounded-md bg-gray-50 border border-gray-100 p-2.5 space-y-0.5">
                                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Ranking</p>
                                        <p className="text-[12px] font-semibold text-brand-navy tabular-nums">#{viewingStatus.ranking}</p>
                                    </div>
                                    <div className="rounded-md bg-gray-50 border border-gray-100 p-2.5 space-y-0.5">
                                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Recheck</p>
                                        <p className="text-[12px] font-semibold text-brand-navy">{viewingStatus.recheck ? 'Yes' : 'No'}</p>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Display Options</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {activeTab === 'orders' && (
                                            <>
                                                <Badge variant="outline" className={cn('text-[10px] font-semibold px-2 py-0.5 rounded', viewingStatus.show_in_order !== false ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-500 border-red-200')}>
                                                    Order Modals: {viewingStatus.show_in_order !== false ? 'ON' : 'OFF'}
                                                </Badge>
                                                <Badge variant="outline" className={cn('text-[10px] font-semibold px-2 py-0.5 rounded', viewingStatus.show_in_quick_status !== false ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-500 border-red-200')}>
                                                    Quick Status: {viewingStatus.show_in_quick_status !== false ? 'ON' : 'OFF'}
                                                </Badge>
                                            </>
                                        )}
                                        {activeTab === 'packages' && (
                                            <Badge variant="outline" className={cn('text-[10px] font-semibold px-2 py-0.5 rounded', viewingStatus.show_in_courier !== false ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-500 border-red-200')}>
                                                Courier: {viewingStatus.show_in_courier !== false ? 'ON' : 'OFF'}
                                            </Badge>
                                        )}
                                        <Badge variant="outline" className={cn('text-[10px] font-semibold px-2 py-0.5 rounded', viewingStatus.show_in_seller_confirmation !== false ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-500 border-red-200')}>
                                            Confirmation: {viewingStatus.show_in_seller_confirmation !== false ? 'ON' : 'OFF'}
                                        </Badge>
                                        <Badge variant="outline" className={cn('text-[10px] font-semibold px-2 py-0.5 rounded', viewingStatus.show_in_seller_suivi !== false ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-500 border-red-200')}>
                                            Suivi: {viewingStatus.show_in_seller_suivi !== false ? 'ON' : 'OFF'}
                                        </Badge>
                                        <Badge variant="outline" className={cn('text-[10px] font-semibold px-2 py-0.5 rounded', viewingStatus.perf_breakdown ? 'bg-gray-100 text-gray-600 border-gray-200' : 'bg-gray-50 text-gray-400 border-gray-100')}>
                                            Perf: {viewingStatus.perf_breakdown ? (viewingStatus.perf_breakdown_phase === 'before_confirmation' ? 'Before' : 'After') : 'OFF'}
                                        </Badge>
                                    </div>
                                </div>

                                {activeTab === 'packages' && viewingStatus.delivery_service_statuses?.length > 0 && (
                                    <div className="space-y-2 pt-3 border-t border-gray-100">
                                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Attached Service Statuses</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {viewingStatus.delivery_service_statuses.map((status: string, idx: number) => (
                                                <Badge key={idx} variant="outline" className="text-[10px] font-semibold border-gray-200 uppercase bg-gray-50 px-2 py-0.5 rounded font-mono">
                                                    {status}
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {isOwner && (
                                <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => { setIsViewOpen(false); setStatusToDelete(viewingStatus); }}
                                        className="h-8 w-8 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button
                                        onClick={() => { setIsViewOpen(false); openUpsert(viewingStatus); }}
                                        className="h-8 px-3 text-[11px] font-semibold bg-brand-navy hover:bg-brand-navy/90 text-white rounded-md"
                                    >
                                        Edit Configuration
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={!!statusToDelete} onOpenChange={() => setStatusToDelete(null)}>
                <AlertDialogContent className="rounded-xl border border-gray-100 p-5 max-w-sm">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[14px] font-semibold text-brand-navy">Delete Status?</AlertDialogTitle>
                        <AlertDialogDescription className="text-[12px] text-gray-500">
                            Permanently delete <span className="font-semibold text-brand-navy">"{statusToDelete?.label}"</span>. This will affect orders currently using this status.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="mt-3 gap-2">
                        <AlertDialogCancel className="h-8 px-3 rounded-md text-[11px] font-semibold border-gray-200 text-gray-500">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => statusToDelete && deleteMutation.mutate(statusToDelete.id)}
                            className="h-8 px-3 rounded-md text-[11px] font-semibold bg-red-600 hover:bg-red-700 text-white gap-1.5"
                        >
                            {deleteMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

// --- Sub-components ---

type StatusItemProps = {
    status: StatusRow;
    activeTab: 'orders' | 'packages';
    isOwner: boolean;
    onEdit: () => void;
    onView: () => void;
    onDelete: () => void;
};

const StatusListRow = ({ status, activeTab, isOwner, onEdit, onView, onDelete }: StatusItemProps) => {
    return (
        <div
            className={cn(
                'flex items-center gap-3 px-3 py-2 bg-white hover:bg-gray-50/50 transition-colors',
                !status.active && 'opacity-60'
            )}
        >
            <span
                className="w-[3px] self-stretch rounded-full shrink-0"
                style={{ backgroundColor: status.color || '#6366f1' }}
            />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-semibold text-brand-navy truncate">{status.label}</span>
                    {!status.active && (
                        <Badge variant="secondary" className="text-[9px] font-semibold uppercase shrink-0">
                            Inactive
                        </Badge>
                    )}
                    {activeTab === 'orders' && status.show_in_order === false && (
                        <OrderModalHiddenBadge className="shrink-0" />
                    )}
                </div>
                <p className="text-[9px] uppercase tracking-[0.14em] text-gray-400 truncate">{status.code}</p>
            </div>
            <div className="hidden sm:flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-gray-400 tabular-nums">#{status.ranking}</span>
                {status.recheck && (
                    <Badge variant="outline" className="h-5 gap-1 bg-amber-50 text-amber-600 border-amber-100 font-semibold px-1.5 rounded text-[9px]">
                        <RefreshCcw className="w-2.5 h-2.5" /> Recheck
                    </Badge>
                )}
                {activeTab === 'packages' && status.delivery_service_statuses?.length > 0 && (
                    <Badge variant="outline" className="text-[9px] font-semibold border-gray-200 bg-gray-50">
                        {status.delivery_service_statuses.length} codes
                    </Badge>
                )}
            </div>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 p-0 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 shrink-0">
                        <MoreVertical className="w-3.5 h-3.5" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-lg border border-gray-200 shadow-md p-1 min-w-[130px]">
                    <DropdownMenuItem onClick={onView} className="rounded px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer gap-2">
                        <Eye className="w-3 h-3" /> Summary
                    </DropdownMenuItem>
                    {isOwner && (
                        <>
                            <DropdownMenuItem onClick={onEdit} className="rounded px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer gap-2">
                                <Edit2 className="w-3 h-3" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={onDelete} className="rounded px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer gap-2 text-red-600 focus:text-red-600 focus:bg-red-50">
                                <Trash2 className="w-3 h-3" /> Delete
                            </DropdownMenuItem>
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
};

const StatusCard = ({ status, activeTab, isOwner, onEdit, onView, onDelete }: StatusItemProps) => {
    return (
        <div
            className={cn(
                "rounded-xl border border-gray-100 bg-white p-3.5 space-y-3 relative overflow-hidden",
                !status.active && "opacity-60"
            )}
        >
            <div
                className="absolute top-0 left-0 w-full h-[3px]"
                style={{ backgroundColor: status.color || '#6366f1' }}
            />

            <div className="flex items-start justify-between pt-0.5">
                <div className="flex items-start gap-2 min-w-0">
                    <span
                        className="w-[3px] self-stretch rounded-full shrink-0"
                        style={{ backgroundColor: status.color || '#6366f1' }}
                    />
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <h3 className="text-[12px] font-semibold text-brand-navy truncate">{status.label}</h3>
                            {activeTab === 'orders' && status.show_in_order === false && (
                                <OrderModalHiddenBadge />
                            )}
                        </div>
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400 mt-0.5">{status.code}</p>
                    </div>
                </div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 p-0 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 shrink-0">
                            <MoreVertical className="w-3.5 h-3.5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-lg border border-gray-200 shadow-md p-1 min-w-[130px]">
                        <DropdownMenuItem onClick={onView} className="rounded px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer gap-2">
                            <Eye className="w-3 h-3" /> Summary
                        </DropdownMenuItem>
                        {isOwner && (
                            <>
                                <DropdownMenuItem onClick={onEdit} className="rounded px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer gap-2">
                                    <Edit2 className="w-3 h-3" /> Edit
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={onDelete} className="rounded px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer gap-2 text-red-600 focus:text-red-600 focus:bg-red-50">
                                    <Trash2 className="w-3 h-3" /> Delete
                                </DropdownMenuItem>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-[9px] text-gray-400 uppercase tracking-[0.14em] tabular-nums">#{status.ranking}</span>
                    {status.recheck && (
                        <Badge variant="outline" className="h-5 gap-1 bg-amber-50 text-amber-600 border-amber-100 font-semibold px-1.5 rounded text-[9px]">
                            <RefreshCcw className="w-2.5 h-2.5" /> Recheck
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {activeTab === 'packages' && status.delivery_service_statuses?.length > 0 && (
                        <Badge variant="outline" className="h-5 px-1.5 text-[9px] font-semibold border-gray-200 bg-gray-50">
                            {status.delivery_service_statuses.length} codes
                        </Badge>
                    )}
                    <CircleDot className="w-3 h-3" style={{ color: status.color }} />
                </div>
            </div>
        </div>
    );
};

export default Status;
