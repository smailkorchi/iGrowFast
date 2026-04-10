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
    Palette,
    ArrowUpNarrowWide,
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
import { Separator } from "@/components/ui/separator";

// --- Schemas ---
const statusSchema = z.object({
    code: z.string().min(2, "Code must be at least 2 characters"),
    label: z.string().min(2, "Label must be at least 2 characters"),
    ranking: z.coerce.number().default(0),
    color: z.string().default("#6366f1"),
    icon: z.string().optional().default(''),
    recheck: z.boolean().default(false),
    active: z.boolean().default(true),
    /** order_statuses only: shown in add/edit order modals */
    show_in_order: z.boolean().default(true),
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
    // package_statuses only
    delivery_service_statuses?: string[] | null;
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

            const payload = {
                code: values.code,
                label: values.label,
                ranking: values.ranking,
                color: values.color,
                icon: values.icon || null,
                recheck: values.recheck,
                active: values.active,
                delivery_service_statuses: deliveryStatuses,
                ...(activeTab === 'orders' ? { show_in_order: values.show_in_order } : {}),
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
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <Skeleton key={i} className="h-48 w-full rounded-[32px]" />
                        ))}
                    </div>
                );
            }
            return (
                <div className="rounded-[24px] border border-brand-navy/[0.06] bg-white overflow-hidden divide-y divide-brand-navy/[0.06]">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-16 w-full rounded-none" />
                    ))}
                </div>
            );
        }

        if (!filteredStatuses?.length) {
            return (
                <div className="rounded-[32px] border border-dashed border-brand-navy/[0.12] bg-brand-navy/[0.02] p-12 text-center">
                    <p className="text-sm font-bold text-brand-navy/50">
                        {searchQuery.trim()
                            ? 'No statuses match your search.'
                            : 'No statuses yet. Add one to get started.'}
                    </p>
                </div>
            );
        }

        if (viewMode === 'grid') {
            return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
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
            <div className="rounded-[24px] border border-brand-navy/[0.08] bg-white shadow-sm overflow-hidden divide-y divide-brand-navy/[0.06]">
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
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Status Management</h1>
                            <p className="text-gray-500 font-light">Define the workflow and lifecycle for orders and packages.</p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 items-center">
                            <div className="relative group sm:w-80">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary transition-colors" />
                                <Input
                                    placeholder="Search by label or code..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-11 h-12 rounded-2xl border-gray-100 bg-white"
                                />
                            </div>
                            {isOwner && (
                                <Button
                                    onClick={() => openUpsert()}
                                    className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 group flex items-center gap-2 w-full sm:w-auto"
                                >
                                    <Plus className="w-5 h-5" />
                                    Add {activeTab === "orders" ? "Order" : "Package"} Status
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'orders' | 'packages')} className="space-y-8">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <TabsList className="bg-brand-navy/[0.03] p-1.5 rounded-[24px] h-auto gap-2 w-fit">
                        <TabsTrigger
                            value="orders"
                            className="rounded-2xl px-8 py-3 font-bold data-[state=active]:bg-brand-white data-[state=active]:text-brand-navy data-[state=active]:shadow-lg transition-all gap-2"
                        >
                            <ClipboardCheck className="w-4 h-4" />
                            Order Statuses
                        </TabsTrigger>
                        <TabsTrigger
                            value="packages"
                            className="rounded-2xl px-8 py-3 font-bold data-[state=active]:bg-brand-white data-[state=active]:text-brand-navy data-[state=active]:shadow-lg transition-all gap-2"
                        >
                            <Truck className="w-4 h-4" />
                            Package Statuses
                        </TabsTrigger>
                    </TabsList>
                    <div className="flex items-center gap-1 p-1 rounded-2xl bg-brand-navy/[0.03] w-fit">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewMode('grid')}
                            className={cn(
                                'h-9 w-9 p-0 rounded-xl transition-all duration-300',
                                viewMode === 'grid'
                                    ? 'bg-brand-navy text-brand-white shadow-lg'
                                    : 'text-brand-navy/30 hover:text-brand-navy hover:bg-brand-navy/5'
                            )}
                            aria-label="Grid view"
                        >
                            <LayoutGrid className="w-4 h-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewMode('list')}
                            className={cn(
                                'h-9 w-9 p-0 rounded-xl transition-all duration-300',
                                viewMode === 'list'
                                    ? 'bg-brand-navy text-brand-white shadow-lg'
                                    : 'text-brand-navy/30 hover:text-brand-navy hover:bg-brand-navy/5'
                            )}
                            aria-label="List view"
                        >
                            <List className="w-4 h-4" />
                        </Button>
                    </div>
                </div>

                <TabsContent value="orders" className="space-y-6 mt-0">
                    {renderStatusSection()}
                </TabsContent>

                <TabsContent value="packages" className="space-y-6 mt-0">
                    {renderStatusSection()}
                </TabsContent>
            </Tabs>

            {/* Upsert Modal */}
            <Dialog open={isUpsertOpen} onOpenChange={setIsUpsertOpen}>
                <DialogContent className="max-w-lg p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleUpsert)} className="flex flex-col">
                            {/* Live preview header */}
                            <div className="p-6 pb-4 border-b border-brand-navy/[0.05]">
                                <div className="flex items-center gap-4">
                                    <div
                                        className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-lg shrink-0 transition-all"
                                        style={{ backgroundColor: form.watch('color') || '#6366f1' }}
                                    >
                                        {form.watch('icon') ? <DynamicIcon name={form.watch('icon')} className="w-7 h-7" /> : (form.watch('label') || 'S').charAt(0).toUpperCase()}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <DialogTitle className="text-2xl font-bold text-brand-navy truncate">
                                            {editingStatus ? 'Edit Status' : 'New Status'}
                                        </DialogTitle>
                                        <DialogDescription className="text-sm text-muted-foreground">
                                            {form.watch('label') || 'Untitled'} <span className="text-[10px] font-mono uppercase opacity-50">({form.watch('code') || '...'})</span>
                                        </DialogDescription>
                                    </div>
                                    {/* Live pill preview */}
                                    <span
                                        className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg shrink-0"
                                        style={{ color: form.watch('color') || '#6366f1', backgroundColor: `${form.watch('color') || '#6366f1'}15` }}
                                    >
                                        {form.watch('label') || 'Preview'}
                                    </span>
                                </div>
                            </div>

                            <div className="overflow-y-auto p-6 space-y-5 max-h-[60vh]">
                                {/* Section: Identity */}
                                <div className="space-y-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/30">Identity</p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <FormField
                                            control={form.control}
                                            name="label"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Label</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="Confirmed" {...field} className="h-11 rounded-xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 shadow-inner" />
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
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Code</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="CONFIRMED" {...field} className="h-11 rounded-xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 shadow-inner uppercase font-mono" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </div>

                                {/* Section: Appearance */}
                                <div className="space-y-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/30">Appearance</p>
                                    <div className="grid grid-cols-[1fr_auto] gap-3">
                                        <FormField
                                            control={form.control}
                                            name="icon"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Icon</FormLabel>
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
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Rank</FormLabel>
                                                    <FormControl>
                                                        <Input type="number" {...field} className="h-12 rounded-xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy shadow-inner text-center" />
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
                                                <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Color</FormLabel>
                                                <FormControl>
                                                    <div className="flex gap-2 items-center">
                                                        <Input type="color" {...field} className="h-11 w-11 p-1 rounded-xl border-none bg-brand-navy/[0.04] shadow-inner cursor-pointer shrink-0" />
                                                        <Input {...field} className="h-11 flex-1 rounded-xl border-none bg-brand-navy/[0.04] text-sm font-mono font-bold text-brand-navy shadow-inner" />
                                                    </div>
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                {/* Section: Behavior */}
                                <div className="space-y-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/30">Behavior</p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <FormField
                                            control={form.control}
                                            name="active"
                                            render={({ field }) => (
                                                <FormItem className="flex items-center justify-between p-3 rounded-xl bg-brand-navy/[0.02] border border-brand-navy/[0.03]">
                                                    <FormLabel className="text-sm font-bold text-brand-navy">Active</FormLabel>
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
                                                <FormItem className="flex items-center justify-between p-3 rounded-xl bg-brand-navy/[0.02] border border-brand-navy/[0.03]">
                                                    <FormLabel className="text-sm font-bold text-brand-navy">Recheck</FormLabel>
                                                    <FormControl>
                                                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                    {activeTab === 'orders' && (
                                        <FormField
                                            control={form.control}
                                            name="show_in_order"
                                            render={({ field }) => (
                                                <FormItem className="flex items-center justify-between p-3 rounded-xl bg-brand-navy/[0.02] border border-brand-navy/[0.03]">
                                                    <div className="min-w-0 space-y-0.5">
                                                        <FormLabel className="text-sm font-bold text-brand-navy">Show in Order Modals</FormLabel>
                                                        <FormDescription className="text-[11px] text-muted-foreground leading-snug">
                                                            When off, hidden from add/edit order modals but still works for filters and automation.
                                                        </FormDescription>
                                                    </div>
                                                    <FormControl>
                                                        <Switch checked={field.value} onCheckedChange={field.onChange} className="shrink-0" />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    )}
                                </div>

                                {activeTab === 'packages' && (
                                    <div className="space-y-4 pt-4 border-t border-brand-navy/[0.05]">
                                        <div className="flex items-center justify-between">
                                            <h4 className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Attached Service Statuses</h4>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => append({ value: '' })}
                                                className="text-[10px] font-black uppercase text-brand-navy hover:bg-brand-navy/[0.05] gap-1.5 rounded-lg h-8"
                                            >
                                                <Plus className="w-3 h-3" /> Add Status
                                            </Button>
                                        </div>

                                        {fields.length === 0 && (
                                            <div className="p-8 border-2 border-dashed border-brand-navy/[0.05] rounded-3xl flex flex-col items-center justify-center text-center opacity-40">
                                                <Truck className="w-8 h-8 mb-2 text-brand-navy" />
                                                <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy">No statuses attached</p>
                                            </div>
                                        )}

                                        <div className="space-y-3">
                                            {fields.map((field, index) => (
                                                <div key={field.id} className="flex gap-3 items-center animate-in slide-in-from-left-2 duration-300">
                                                    <FormField
                                                        control={form.control}
                                                        name={`delivery_service_statuses.${index}.value`}
                                                        render={({ field }) => (
                                                            <FormItem className="flex-1">
                                                                <FormControl>
                                                                    <Input placeholder="e.g. READY_TO_SHIP" {...field} className="h-10 rounded-xl border-none bg-brand-navy/[0.04] text-xs font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner uppercase" />
                                                                </FormControl>
                                                            </FormItem>
                                                        )}
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => remove(index)}
                                                        className="h-10 w-10 text-red-300 hover:text-red-500 hover:bg-red-50 rounded-xl"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <DialogFooter className="p-8 pt-4 bg-brand-white border-t border-brand-navy/[0.03]">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => setIsUpsertOpen(false)}
                                    className="rounded-2xl h-14 px-8 font-bold text-brand-navy hover:bg-muted"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={upsertMutation.isPending}
                                    className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-14 px-10 font-bold shadow-2xl shadow-brand-navy/30 transition-all active:scale-95 flex items-center gap-3"
                                >
                                    {upsertMutation.isPending && <Loader2 className="w-5 h-5 animate-spin" />}
                                    {editingStatus ? 'Update Status' : 'Create Status'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* View Modal */}
            <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
                <DialogContent className="max-w-md p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden">
                    {viewingStatus && (
                        <div className="flex flex-col">
                            <div className="h-32 relative" style={{ backgroundColor: viewingStatus.color }}>
                                <div className="absolute -bottom-8 left-8 p-1.5 bg-brand-white rounded-[24px] shadow-xl">
                                    <div className="w-16 h-16 rounded-[20px] flex items-center justify-center text-white font-black text-2xl" style={{ backgroundColor: viewingStatus.color }}>
                                        {viewingStatus.icon ? (
                                            <DynamicIcon name={viewingStatus.icon} className="w-7 h-7" />
                                        ) : (
                                            viewingStatus.label.charAt(0).toUpperCase()
                                        )}
                                    </div>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setIsViewOpen(false)}
                                    className="absolute top-6 right-6 h-10 w-10 rounded-full bg-black/20 text-white hover:bg-black/40 backdrop-blur-md"
                                >
                                    <X className="w-5 h-5" />
                                </Button>
                            </div>

                            <div className="p-8 pt-12 space-y-8">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-3">
                                        <h2 className="text-3xl font-black text-brand-navy">{viewingStatus.label}</h2>
                                        {!viewingStatus.active && <Badge variant="secondary" className="bg-red-50 text-red-500 font-bold uppercase text-[10px]">Inactive</Badge>}
                                    </div>
                                    <p className="text-xs font-black text-muted-foreground/40 uppercase tracking-[0.2em]">{viewingStatus.code}</p>
                                </div>

                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-3 text-brand-navy/60">
                                            <ArrowUpNarrowWide className="w-5 h-5" />
                                            <div>
                                                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Ranking</p>
                                                <p className="font-bold text-brand-navy">#{viewingStatus.ranking}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 text-brand-navy/60">
                                            <Palette className="w-5 h-5" />
                                            <div>
                                                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Style</p>
                                                <p className="font-bold text-brand-navy uppercase">{viewingStatus.color}</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-3 text-brand-navy/60">
                                            <RefreshCcw className="w-5 h-5" />
                                            <div>
                                                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Recheck</p>
                                                <p className="font-bold text-brand-navy">{viewingStatus.recheck ? 'Flagged' : 'Normal Flow'}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 text-brand-navy/60">
                                            <Layers className="w-5 h-5" />
                                            <div>
                                                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Scope</p>
                                                <p className="font-bold text-brand-navy uppercase">{activeTab === 'orders' ? 'Orders Pipeline' : 'Delivery Workflow'}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {activeTab === 'orders' && (
                                    <div className="flex items-start gap-3 text-brand-navy/60 pt-2 border-t border-brand-navy/[0.05]">
                                        <ClipboardCheck className="w-5 h-5 shrink-0 mt-0.5" />
                                        <div className="min-w-0 space-y-1">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Add / edit order modals</p>
                                            <p className="text-sm font-bold text-brand-navy leading-snug">
                                                {viewingStatus.show_in_order !== false
                                                    ? 'Shown in order modals. Turn off in edit to hide from those pickers only.'
                                                    : 'Hidden from add/edit order modals. Turn on in edit to show again.'}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'packages' && viewingStatus.delivery_service_statuses?.length > 0 && (
                                    <div className="space-y-4 pt-4 border-t border-brand-navy/[0.05]">
                                        <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Attached Service Statuses</h4>
                                        <div className="flex flex-wrap gap-2">
                                            {viewingStatus.delivery_service_statuses.map((status: string, idx: number) => (
                                                <Badge key={idx} variant="outline" className="text-[10px] font-black border-brand-navy/10 tracking-widest uppercase bg-brand-navy/[0.02] px-3 py-1.5 rounded-lg">
                                                    {status}
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <Separator className="bg-brand-navy/[0.05]" />

                                {isOwner && (
                                    <div className="flex gap-3">
                                        <Button
                                            onClick={() => { setIsViewOpen(false); openUpsert(viewingStatus); }}
                                            className="flex-1 bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-14 font-bold shadow-xl transition-all active:scale-95"
                                        >
                                            Edit Configuration
                                        </Button>
                                        <Button
                                            variant="outline"
                                            onClick={() => { setIsViewOpen(false); setStatusToDelete(viewingStatus); }}
                                            className="h-14 w-14 rounded-2xl border-red-100 text-red-500 hover:bg-red-50 hover:border-red-200 transition-all flex items-center justify-center p-0"
                                        >
                                            <Trash2 className="w-6 h-6" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={!!statusToDelete} onOpenChange={() => setStatusToDelete(null)}>
                <AlertDialogContent className="rounded-[40px] border-none p-10 max-w-md">
                    <div className="flex flex-col items-center text-center space-y-6">
                        <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center text-red-500">
                            <Trash2 className="w-10 h-10" />
                        </div>
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-3xl font-bold text-brand-navy">Remove Status?</AlertDialogTitle>
                            <AlertDialogDescription className="text-lg text-muted-foreground pt-2">
                                You are about to delete <span className="font-black text-brand-navy italic">"{statusToDelete?.label}"</span>. This will affect orders currently using this status.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="w-full flex flex-col sm:flex-row gap-3 mt-4">
                            <AlertDialogCancel className="w-full rounded-2xl h-14 font-bold border-none bg-brand-navy/[0.04] hover:bg-brand-navy/[0.08] text-brand-navy m-0">
                                Safety First
                            </AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => statusToDelete && deleteMutation.mutate(statusToDelete.id)}
                                className="w-full rounded-2xl h-14 font-bold bg-red-500 hover:bg-red-600 text-brand-white shadow-xl shadow-red-500/20 m-0"
                            >
                                {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                Confirm Delete
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </div>
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
                'flex items-center gap-3 sm:gap-4 px-3 sm:px-5 py-3 bg-white hover:bg-brand-navy/[0.02] transition-colors',
                !status.active && 'opacity-60'
            )}
        >
            <div
                className="w-1 self-stretch min-h-[44px] rounded-full shrink-0"
                style={{ backgroundColor: status.color || '#6366f1' }}
            />
            <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-sm shadow-md shrink-0"
                style={{ backgroundColor: status.color || '#6366f1' }}
            >
                {status.icon ? <DynamicIcon name={status.icon} className="w-5 h-5" /> : status.label.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-brand-navy truncate">{status.label}</h3>
                    {!status.active && (
                        <Badge variant="secondary" className="text-[9px] font-black uppercase shrink-0">
                            Inactive
                        </Badge>
                    )}
                    {activeTab === 'orders' && status.show_in_order === false && (
                        <OrderModalHiddenBadge className="shrink-0" />
                    )}
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 truncate">{status.code}</p>
            </div>
            <div className="hidden sm:flex items-center gap-3 shrink-0 text-brand-navy/80">
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/60">Rank</span>
                    <span className="font-bold text-brand-navy">#{status.ranking}</span>
                </div>
                {status.recheck && (
                    <Badge variant="outline" className="h-6 gap-1 bg-amber-50 text-amber-600 border-amber-100 font-bold px-2 rounded-lg text-[9px]">
                        <RefreshCcw className="w-3 h-3" /> RECHECK
                    </Badge>
                )}
                {activeTab === 'packages' && status.delivery_service_statuses?.length > 0 && (
                    <Badge variant="outline" className="text-[9px] font-black border-brand-navy/10 bg-brand-navy/[0.02]">
                        {status.delivery_service_statuses.length} codes
                    </Badge>
                )}
            </div>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl bg-brand-navy/[0.02] text-brand-navy hover:bg-brand-navy/5 shrink-0">
                        <MoreVertical className="w-4 h-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-2xl p-2 min-w-[160px]">
                    <DropdownMenuItem onClick={onView} className="rounded-xl p-3 cursor-pointer focus:bg-brand-navy focus:text-brand-white gap-3">
                        <Eye className="w-4 h-4" />
                        <span className="font-bold">Summary</span>
                    </DropdownMenuItem>
                    {isOwner && (
                        <>
                            <DropdownMenuItem onClick={onEdit} className="rounded-xl p-3 cursor-pointer focus:bg-brand-navy focus:text-brand-white gap-3">
                                <Edit2 className="w-4 h-4" />
                                <span className="font-bold">Edit</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={onDelete} className="rounded-xl p-3 cursor-pointer text-red-500 focus:bg-red-50 focus:text-red-600 gap-3">
                                <Trash2 className="w-4 h-4" />
                                <span className="font-bold">Delete</span>
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
        <Card
            className={cn(
                "group relative overflow-hidden border-none bg-white/50 backdrop-blur-sm shadow-sm hover:shadow-2xl transition-all duration-500 rounded-[32px]",
                !status.active && "opacity-60"
            )}
        >
            <div
                className="absolute top-0 left-0 w-full h-1.5"
                style={{ backgroundColor: status.color || '#6366f1' }}
            />

            <CardContent className="p-6 space-y-5">
                <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                        <div
                            className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-black text-lg shadow-lg rotate-3 group-hover:rotate-0 transition-transform duration-500"
                            style={{ backgroundColor: status.color || '#6366f1' }}
                        >
                            {status.icon ? <DynamicIcon name={status.icon} className="w-6 h-6" /> : status.label.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-xl font-bold text-brand-navy group-hover:text-indigo-600 transition-colors">
                                    {status.label}
                                </h3>
                                {activeTab === 'orders' && status.show_in_order === false && (
                                    <OrderModalHiddenBadge />
                                )}
                            </div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">{status.code}</p>
                        </div>
                    </div>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl bg-brand-navy/[0.02] text-brand-navy hover:bg-brand-navy/5">
                                <MoreVertical className="w-4 h-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-2xl p-2 min-w-[160px] animate-in slide-in-from-top-2">
                            <DropdownMenuItem onClick={onView} className="rounded-xl p-3 cursor-pointer focus:bg-brand-navy focus:text-brand-white gap-3">
                                <Eye className="w-4 h-4" />
                                <span className="font-bold">Summary</span>
                            </DropdownMenuItem>
                            {isOwner && (
                                <>
                                    <DropdownMenuItem onClick={onEdit} className="rounded-xl p-3 cursor-pointer focus:bg-brand-navy focus:text-brand-white gap-3">
                                        <Edit2 className="w-4 h-4" />
                                        <span className="font-bold">Edit</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={onDelete} className="rounded-xl p-3 cursor-pointer text-red-500 focus:bg-red-50 focus:text-red-600 gap-3">
                                        <Trash2 className="w-4 h-4" />
                                        <span className="font-bold">Delete</span>
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-4">
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest">Rank</span>
                            <span className="text-sm font-bold text-brand-navy">#{status.ranking}</span>
                        </div>
                        {status.recheck && (
                            <Badge variant="outline" className="h-6 gap-1 bg-amber-50 text-amber-600 border-amber-100 font-bold px-2 rounded-lg">
                                <RefreshCcw className="w-3 h-3" /> RECHECK
                            </Badge>
                        )}
                    </div>

                    <div className="flex items-center gap-1.5 opacity-40 group-hover:opacity-100 transition-opacity">
                        {activeTab === 'packages' && status.delivery_service_statuses?.length > 0 && (
                            <Badge variant="outline" className="h-5 px-1.5 text-[8px] font-black border-brand-navy/10 bg-brand-navy/[0.02]">
                                {status.delivery_service_statuses.length} CODES
                            </Badge>
                        )}
                        <CircleDot className="w-3 h-3" style={{ color: status.color }} />
                        <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Flow Step</span>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

export default Status;
