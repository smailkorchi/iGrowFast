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
    recheck: z.boolean().default(false),
    active: z.boolean().default(true),
    delivery_service_statuses: z.array(z.object({
        value: z.string().min(1, "Status code is required")
    })).optional().default([]),
});

type StatusFormValues = z.infer<typeof statusSchema>;

const Status = () => {
    const [activeTab, setActiveTab] = useState<"orders" | "packages">("orders");
    const [isUpsertOpen, setIsUpsertOpen] = useState(false);
    const [isViewOpen, setIsViewOpen] = useState(false);
    const [editingStatus, setEditingStatus] = useState<any>(null);
    const [viewingStatus, setViewingStatus] = useState<any>(null);
    const [statusToDelete, setStatusToDelete] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const table = activeTab === "orders" ? "order_statuses" : "package_statuses";

    // --- Queries ---
    const { data: statuses, isLoading } = useQuery({
        queryKey: ['statuses', activeTab, activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from(table)
                .select('*')
                .eq('DigiCom Business', activeBusinessId)
                .order('ranking', { ascending: true });

            if (error) throw error;
            return data;
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
                recheck: values.recheck,
                active: values.active,
                delivery_service_statuses: deliveryStatuses,
                'DigiCom Business': activeBusinessId,
            };

            if (editingStatus) {
                const { data, error } = await (supabase
                    .from(table as any)
                    .update(payload)
                    .eq('id', editingStatus.id) as any)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            } else {
                const { data, error } = await (supabase
                    .from(table as any)
                    .insert(payload) as any)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['statuses', activeTab, activeBusinessId] });
            setIsUpsertOpen(false);
            setEditingStatus(null);
            toast({
                title: editingStatus ? "Status updated" : "Status created",
                description: `Successfully ${editingStatus ? 'updated' : 'created'} ${form.getValues('label')}.`
            });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase
                .from(table as any)
                .delete()
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['statuses', activeTab, activeBusinessId] });
            setStatusToDelete(null);
            toast({ title: "Status deleted", description: "The status was successfully removed." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const handleUpsert = (values: StatusFormValues) => {
        upsertMutation.mutate(values);
    };

    const openUpsert = (status: any = null) => {
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
                recheck: status.recheck ?? false,
                active: status.active ?? true,
                delivery_service_statuses: deliveryStatuses,
            });
        } else {
            setEditingStatus(null);
            form.reset({
                code: '',
                label: '',
                ranking: (statuses?.length || 0) + 1,
                color: '#6366f1',
                recheck: false,
                active: true,
                delivery_service_statuses: [],
            });
        }
        setIsUpsertOpen(true);
    };

    const filteredStatuses = statuses?.filter(s =>
        s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.code.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="min-h-screen bg-brand-white p-4 md:p-8 space-y-8 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-2">
                    <h1 className="text-4xl font-bold tracking-tight text-brand-navy uppercase">Status Management</h1>
                    <p className="text-muted-foreground text-lg">Define the workflow and lifecycle for orders and packages.</p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 items-center">
                    <div className="relative group sm:w-80">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-brand-navy" />
                        <Input
                            placeholder="Search by label or code..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-11 h-12 bg-white/50 border-none shadow-sm rounded-2xl focus-visible:ring-1 focus-visible:ring-brand-navy/20 transition-all font-medium"
                        />
                    </div>
                    <Button
                        onClick={() => openUpsert()}
                        className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-12 px-6 font-bold shadow-lg shadow-brand-navy/10 transition-all active:scale-95 flex items-center gap-2 w-full sm:w-auto"
                    >
                        <Plus className="w-5 h-5" />
                        Add {activeTab === "orders" ? "Order" : "Package"} Status
                    </Button>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="space-y-8">
                <TabsList className="bg-brand-navy/[0.03] p-1.5 rounded-[24px] h-auto gap-2">
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

                <TabsContent value="orders" className="space-y-6">
                    {isLoading ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <Skeleton key={i} className="h-48 w-full rounded-[32px]" />
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {filteredStatuses?.map((status) => (
                                <StatusCard
                                    key={status.id}
                                    status={status}
                                    activeTab={activeTab}
                                    onEdit={() => openUpsert(status)}
                                    onView={() => { setViewingStatus(status); setIsViewOpen(true); }}
                                    onDelete={() => setStatusToDelete(status)}
                                />
                            ))}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="packages" className="space-y-6">
                    {isLoading ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <Skeleton key={i} className="h-48 w-full rounded-[32px]" />
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {filteredStatuses?.map((status) => (
                                <StatusCard
                                    key={status.id}
                                    status={status}
                                    activeTab={activeTab}
                                    onEdit={() => openUpsert(status)}
                                    onView={() => { setViewingStatus(status); setIsViewOpen(true); }}
                                    onDelete={() => setStatusToDelete(status)}
                                />
                            ))}
                        </div>
                    )}
                </TabsContent>
            </Tabs>

            {/* Upsert Modal */}
            <Dialog open={isUpsertOpen} onOpenChange={setIsUpsertOpen}>
                <DialogContent className="max-w-md p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleUpsert)} className="flex flex-col">
                            <DialogHeader className="p-8 pb-4">
                                <DialogTitle className="text-3xl font-bold text-brand-navy uppercase tracking-tight">
                                    {editingStatus ? 'Edit Status' : 'New Status'}
                                </DialogTitle>
                                <DialogDescription className="text-muted-foreground text-lg">
                                    {activeTab === 'packages' ? 'Configure master status and attached delivery codes.' : 'Configure the details for this order status step.'}
                                </DialogDescription>
                            </DialogHeader>

                            <div className="overflow-y-auto p-8 pt-4 space-y-6 max-h-[60vh]">
                                <div className="grid grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="label"
                                        render={({ field }) => (
                                            <FormItem className="space-y-2">
                                                <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Display Label</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="Confirmed" {...field} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="code"
                                        render={({ field }) => (
                                            <FormItem className="space-y-2">
                                                <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Internal Code</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="CONFIRMED" {...field} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner uppercase" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="ranking"
                                        render={({ field }) => (
                                            <FormItem className="space-y-2">
                                                <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Sort Ranking</FormLabel>
                                                <FormControl>
                                                    <Input type="number" {...field} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner" />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="color"
                                        render={({ field }) => (
                                            <FormItem className="space-y-2">
                                                <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Theme Color</FormLabel>
                                                <FormControl>
                                                    <div className="flex gap-2 items-center">
                                                        <Input type="color" {...field} className="h-12 w-12 p-1 rounded-xl border-none bg-brand-navy/[0.04] shadow-inner cursor-pointer" />
                                                        <Input {...field} className="h-12 flex-1 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-mono font-bold text-brand-navy shadow-inner" />
                                                    </div>
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="recheck"
                                        render={({ field }) => (
                                            <FormItem className="flex items-center justify-between p-4 rounded-2xl bg-brand-navy/[0.02] border border-brand-navy/[0.03]">
                                                <div className="space-y-0.5">
                                                    <FormLabel className="text-sm font-bold text-brand-navy">Recheck</FormLabel>
                                                </div>
                                                <FormControl>
                                                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="active"
                                        render={({ field }) => (
                                            <FormItem className="flex items-center justify-between p-4 rounded-2xl bg-brand-navy/[0.02] border border-brand-navy/[0.03]">
                                                <div className="space-y-0.5">
                                                    <FormLabel className="text-sm font-bold text-brand-navy">Active</FormLabel>
                                                </div>
                                                <FormControl>
                                                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
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
                                                                    <Input placeholder="e.g. READY_TO_SHIP" {...field} className="h-10 rounded-xl border-none bg-brand-navy/[0.04] text-xs font-bold text-brand-navy shadow-inner uppercase" />
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
                                        {viewingStatus.label.charAt(0).toUpperCase()}
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
                                onClick={() => deleteMutation.mutate(statusToDelete.id)}
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

const StatusCard = ({ status, activeTab, onEdit, onView, onDelete }: any) => {
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
                            {status.label.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-brand-navy group-hover:text-indigo-600 transition-colors">{status.label}</h3>
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">{status.code}</p>
                        </div>
                    </div>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl bg-brand-navy/[0.02] text-brand-navy hover:bg-brand-navy/5">
                                <MoreVertical className="h-4 h-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-2xl p-2 min-w-[160px] animate-in slide-in-from-top-2">
                            <DropdownMenuItem onClick={onView} className="rounded-xl p-3 cursor-pointer focus:bg-brand-navy focus:text-brand-white gap-3">
                                <Eye className="w-4 h-4" />
                                <span className="font-bold">Summary</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={onEdit} className="rounded-xl p-3 cursor-pointer focus:bg-brand-navy focus:text-brand-white gap-3">
                                <Edit2 className="w-4 h-4" />
                                <span className="font-bold">Edit</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={onDelete} className="rounded-xl p-3 cursor-pointer text-red-500 focus:bg-red-50 focus:text-red-600 gap-3">
                                <Trash2 className="w-4 h-4" />
                                <span className="font-bold">Delete</span>
                            </DropdownMenuItem>
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
