import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus,
    Search,
    Puzzle,
    MoreVertical,
    Edit2,
    Trash2,
    Loader2,
    Image as ImageIcon,
    Upload,
    Check,
    X,
    Tag,
    Hash,
    Link2,
    Package,
    RotateCcw,
    LayoutGrid,
    List
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
import { useLocation } from 'react-router-dom';
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
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const accessorySchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    code: z.string().min(2, "Code must be at least 2 characters"),
    cost_price: z.coerce.number().min(0, "Price must be positive"),
    active: z.boolean().default(true),
    image_url: z.string().optional().nullable(),
});

type AccessoryFormValues = z.infer<typeof accessorySchema>;

const Accessories = () => {
    const location = useLocation();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingAccessory, setEditingAccessory] = useState<any>(null);
    const [accessoryToDelete, setAccessoryToDelete] = useState<any>(null);
    const [accessoryToResetStock, setAccessoryToResetStock] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [isUploading, setIsUploading] = useState(false);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setViewMode('list');
    }, [location.key]);

    // Product attachment state
    const [attachedProducts, setAttachedProducts] = useState<{ product_id: string; default_quantity: number }[]>([]);
    const [productSearch, setProductSearch] = useState("");

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // --- Queries ---
    const { data: accessories, isLoading } = useQuery({
        queryKey: ['accessories', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('accessories')
                .select('*')
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        },
    });

    // Fetch products for attachment
    const { data: products } = useQuery({
        queryKey: ['products', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('products')
                .select('id, name, code, image_url')
                .eq('DigiCom Business', activeBusinessId)
                .eq('active', true)
                .order('name');
            if (error) throw error;
            return data;
        },
    });

    // Fetch product_accessories for a specific accessory (when editing)
    const fetchAttachedProducts = async (accessoryId: string) => {
        const { data, error } = await supabase
            .from('product_accessories')
            .select('product_id, default_quantity')
            .eq('accessory_id', accessoryId);
        if (error) {
            console.error('Error fetching attachments:', error);
            return [];
        }
        return data || [];
    };

    // --- Form Setup ---
    const form = useForm<AccessoryFormValues>({
        resolver: zodResolver(accessorySchema),
        defaultValues: {
            name: '',
            code: '',
            cost_price: 0,
            active: true,
            image_url: null,
        }
    });

    // --- SKU Auto-generation ---
    const accessoryName = form.watch('name');
    useEffect(() => {
        if (!editingAccessory && accessoryName) {
            const sku = 'ACC-' + accessoryName
                .toUpperCase()
                .trim()
                .replace(/\s+/g, '-')
                .replace(/[^A-Z0-9-]/g, '');
            form.setValue('code', sku, { shouldValidate: true });
        }
    }, [accessoryName, editingAccessory, form]);

    // --- Mutations ---
    const upsertAccessoryMutation = useMutation({
        mutationFn: async (values: AccessoryFormValues) => {
            const payload = {
                name: values.name,
                code: values.code,
                cost_price: values.cost_price,
                active: values.active,
                image_url: values.image_url || null,
                'DigiCom Business': activeBusinessId
            };

            let accessoryId: string;

            if (editingAccessory) {
                const { data, error } = await supabase
                    .from('accessories')
                    .update(payload)
                    .eq('id', editingAccessory.id)
                    .select()
                    .single();
                if (error) throw error;
                accessoryId = data.id;
            } else {
                const { data, error } = await supabase
                    .from('accessories')
                    .insert(payload)
                    .select()
                    .single();
                if (error) throw error;
                accessoryId = data.id;
            }

            // Upsert product attachments
            // 1. Delete existing attachments
            await supabase
                .from('product_accessories')
                .delete()
                .eq('accessory_id', accessoryId);

            // 2. Insert new attachments
            if (attachedProducts.length > 0) {
                const inserts = attachedProducts.map(ap => ({
                    product_id: ap.product_id,
                    accessory_id: accessoryId,
                    default_quantity: ap.default_quantity,
                    'DigiCom Business': activeBusinessId,
                }));
                const { error: insertError } = await supabase
                    .from('product_accessories')
                    .insert(inserts);
                if (insertError) throw insertError;
            }

            return accessoryId;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['accessories', activeBusinessId] });
            setIsModalOpen(false);
            setEditingAccessory(null);
            setAttachedProducts([]);
            toast({
                title: editingAccessory ? "Accessory updated" : "Accessory created",
                description: `Successfully ${editingAccessory ? 'updated' : 'created'} ${form.getValues('name')}.`
            });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const deleteAccessoryMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase
                .from('accessories')
                .delete()
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId);

            if (error) {
                if (error.code === '23503') {
                    // Foreign key constraint violation (e.g., used in orders)
                    // Fall back to soft delete
                    const { error: softDeleteError } = await supabase
                        .from('accessories')
                        .update({ active: false })
                        .eq('id', id);
                    if (softDeleteError) throw softDeleteError;
                    return { softDeleted: true };
                }
                throw error;
            }
            return { softDeleted: false };
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['accessories', activeBusinessId] });
            setAccessoryToDelete(null);
            if (data?.softDeleted) {
                toast({ title: "Accessory Deactivated", description: "This accessory is used in existing orders, so it was deactivated instead of permanently deleted." });
            } else {
                toast({ title: "Accessory deleted", description: "The accessory was successfully removed." });
            }
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const updateStockMutation = useMutation({
        mutationFn: async ({ id, stock }: { id: string; stock: number }) => {
            const { error } = await supabase
                .from('accessories')
                .update({ stock })
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId);

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['accessories', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['accessories-minimal', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['accessories-dropdown-orders', activeBusinessId] });
            setAccessoryToResetStock(null);
            toast({ title: "Stock Updated", description: "Accessory stock has been modified." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `acc_${Math.random().toString(36).substring(2)}.${fileExt}`;
            const filePath = `${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('products')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('products')
                .getPublicUrl(filePath);

            form.setValue('image_url', publicUrl);
            toast({ title: "Image uploaded", description: "Accessory image has been updated." });
        } catch (error: any) {
            toast({ title: "Upload failed", description: error.message, variant: "destructive" });
        } finally {
            setIsUploading(false);
        }
    };

    const onSubmit = (values: AccessoryFormValues) => {
        upsertAccessoryMutation.mutate(values);
    };

    const filteredAccessories = accessories?.filter(a =>
        a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.code.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const openModal = async (accessory: any = null) => {
        if (accessory) {
            setEditingAccessory(accessory);
            form.reset({
                name: accessory.name,
                code: accessory.code,
                cost_price: accessory.cost_price,
                active: accessory.active ?? true,
                image_url: accessory.image_url,
            });
            // Fetch attached products
            const attached = await fetchAttachedProducts(accessory.id);
            setAttachedProducts(attached);
        } else {
            setEditingAccessory(null);
            form.reset({
                name: '',
                code: '',
                cost_price: 0,
                active: true,
                image_url: null,
            });
            setAttachedProducts([]);
        }
        setProductSearch("");
        setIsModalOpen(true);
    };

    // Product attachment helpers
    const toggleProductAttachment = (productId: string) => {
        setAttachedProducts(prev => {
            const exists = prev.find(p => p.product_id === productId);
            if (exists) {
                return prev.filter(p => p.product_id !== productId);
            }
            return [...prev, { product_id: productId, default_quantity: 1 }];
        });
    };

    const updateAttachmentQuantity = (productId: string, qty: number) => {
        setAttachedProducts(prev =>
            prev.map(p => p.product_id === productId ? { ...p, default_quantity: Math.max(1, qty) } : p)
        );
    };

    const filteredProducts = products?.filter(p =>
        p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.code.toLowerCase().includes(productSearch.toLowerCase())
    );

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Accessories</h1>
                            <p className="text-gray-500 font-light">Manage your product accessories and attachments.</p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 items-center">
                            <div className="flex bg-white/80 p-1 rounded-2xl border border-gray-100 shadow-sm">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setViewMode('list')}
                                    className={cn(
                                        "rounded-xl w-10 h-10 transition-all",
                                        viewMode === 'list' ? "bg-white shadow-xl text-primary font-bold" : "text-gray-400 hover:text-primary"
                                    )}
                                >
                                    <List className="w-5 h-5" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setViewMode('grid')}
                                    className={cn(
                                        "rounded-xl w-10 h-10 transition-all",
                                        viewMode === 'grid' ? "bg-white shadow-xl text-primary font-bold" : "text-gray-400 hover:text-primary"
                                    )}
                                >
                                    <LayoutGrid className="w-5 h-5" />
                                </Button>
                            </div>
                            <div className="relative group sm:w-80">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary transition-colors" />
                                <Input
                                    placeholder="Search name or code..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-11 h-12 rounded-2xl border-gray-100 bg-white"
                                />
                            </div>
                            <Button
                                onClick={() => openModal()}
                                className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 group flex items-center gap-2 w-full sm:w-auto"
                            >
                                <Plus className="w-5 h-5" />
                                Add Accessory
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content Section */}
            {isLoading ? (
                <div className={cn(
                    "grid gap-6",
                    viewMode === 'grid' ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1"
                )}>
                    {Array.from({ length: 8 }).map((_, i) => (
                        viewMode === 'grid' ? (
                            <Card key={i} className="border-none bg-white/50 backdrop-blur-sm rounded-[24px] overflow-hidden shadow-sm">
                                <Skeleton className="h-48 w-full" />
                                <CardContent className="p-6 space-y-4">
                                    <Skeleton className="h-6 w-3/4" />
                                    <Skeleton className="h-4 w-1/2" />
                                    <div className="flex justify-between pt-4">
                                        <Skeleton className="h-8 w-20" />
                                        <Skeleton className="h-8 w-20" />
                                    </div>
                                </CardContent>
                            </Card>
                        ) : (
                            <Card key={i} className="border-none bg-white/50 backdrop-blur-sm rounded-[24px] overflow-hidden shadow-sm flex flex-col sm:flex-row items-center p-4 gap-6">
                                <Skeleton className="h-32 w-32 rounded-[20px] shrink-0" />
                                <div className="flex-1 space-y-4 w-full">
                                    <Skeleton className="h-6 w-1/3" />
                                    <Skeleton className="h-4 w-1/4" />
                                    <Skeleton className="h-4 w-1/2" />
                                </div>
                            </Card>
                        )
                    ))}
                </div>
            ) : filteredAccessories?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-6 bg-white/50 backdrop-blur-sm rounded-[40px] shadow-sm border border-brand-navy/[0.03]">
                    <div className="w-24 h-24 bg-brand-navy/[0.04] rounded-full flex items-center justify-center">
                        <Puzzle className="w-12 h-12 text-brand-navy/20" />
                    </div>
                    <div className="text-center space-y-2">
                        <h3 className="text-2xl font-bold text-brand-navy">No accessories found</h3>
                        <p className="text-muted-foreground max-w-xs mx-auto">Start managing your accessories by adding your first one with cost price and stock tracking.</p>
                    </div>
                    <Button variant="outline" onClick={() => openModal()} className="rounded-xl border-brand-navy/10 font-bold hover:bg-brand-navy hover:text-brand-white transition-all">
                        Create First Accessory
                    </Button>
                </div>
            ) : (
                <div className={cn(
                    "grid gap-6",
                    viewMode === 'grid' ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1"
                )}>
                    {filteredAccessories?.map((accessory) => (
                        viewMode === 'grid' ? (
                            <Card
                                key={accessory.id}
                                className="group relative overflow-hidden border-none bg-white/50 backdrop-blur-sm shadow-sm hover:shadow-2xl transition-all duration-300 rounded-[32px]"
                            >
                                <div className="relative h-48 w-full overflow-hidden bg-brand-navy/[0.02]">
                                    {accessory.image_url ? (
                                        <img
                                            src={accessory.image_url}
                                            alt={accessory.name}
                                            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                                        />
                                    ) : (
                                        <div className="flex items-center justify-center h-full w-full text-brand-navy/10">
                                            <Puzzle className="w-16 h-16" />
                                        </div>
                                    )}
                                    <div className="absolute top-4 right-4 z-10">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="secondary" size="icon" className="h-10 w-10 rounded-xl bg-white/80 backdrop-blur-md border-none shadow-lg text-brand-navy hover:bg-white transition-all">
                                                    <MoreVertical className="h-5 w-5" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-2xl p-2 min-w-[160px]">
                                                <DropdownMenuItem onClick={() => openModal(accessory)} className="rounded-xl p-3 cursor-pointer focus:bg-brand-navy focus:text-brand-white gap-3">
                                                    <Edit2 className="w-4 h-4" />
                                                    <span className="font-bold">Edit Accessory</span>
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onClick={() => setAccessoryToResetStock(accessory)}
                                                    className="rounded-xl p-3 cursor-pointer focus:bg-brand-navy focus:text-brand-white gap-3"
                                                >
                                                    <RotateCcw className="w-4 h-4" />
                                                    <span className="font-bold">Clear Stock (0)</span>
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem onClick={() => setAccessoryToDelete(accessory)} className="rounded-xl p-3 cursor-pointer text-red-500 focus:bg-red-50 focus:text-red-600 gap-3">
                                                    <Trash2 className="w-4 h-4" />
                                                    <span className="font-bold">Delete</span>
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                    {!accessory.active && (
                                        <div className="absolute inset-0 bg-brand-navy/40 backdrop-blur-[2px] flex items-center justify-center">
                                            <Badge variant="secondary" className="bg-brand-white text-brand-navy font-bold text-xs px-4 py-1.5 rounded-full shadow-lg">INACTIVE</Badge>
                                        </div>
                                    )}
                                </div>

                                <CardContent className="p-6 space-y-4">
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40">{accessory.code}</p>
                                        <h3 className="text-xl font-bold text-brand-navy truncate">{accessory.name}</h3>
                                    </div>

                                    <div className="space-y-1">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Cost Price</p>
                                        <p className="text-lg font-bold text-brand-navy">{accessory.cost_price} DH</p>
                                    </div>

                                    <div className="pt-2 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className={cn(
                                                "w-2 h-2 rounded-full",
                                                (accessory.stock || 0) > 10 ? "bg-emerald-500" : (accessory.stock || 0) > 0 ? "bg-amber-500" : "bg-red-500"
                                            )} />
                                            <span className="text-[10px] font-black text-brand-navy/60 tracking-wider uppercase">
                                                {accessory.stock || 0} in stock
                                            </span>
                                        </div>
                                        <span className="text-[10px] font-black text-brand-navy/60 tracking-wider uppercase">
                                            {accessory.active ? 'Active' : 'Hidden'}
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>
                        ) : (
                            <Card key={accessory.id} className="group overflow-hidden border-none bg-white/50 backdrop-blur-sm shadow-sm hover:shadow-xl transition-all duration-300 rounded-[24px] flex flex-col sm:flex-row items-center p-4 gap-6 sm:pr-6">
                                <div className="relative h-32 w-full sm:w-32 shrink-0 rounded-[20px] overflow-hidden bg-brand-navy/[0.02] shadow-inner">
                                    {accessory.image_url ? (
                                        <img src={accessory.image_url} alt={accessory.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" />
                                    ) : (
                                        <div className="flex items-center justify-center h-full w-full text-brand-navy/10">
                                            <Puzzle className="w-10 h-10" />
                                        </div>
                                    )}
                                    {!accessory.active && (
                                        <div className="absolute inset-0 bg-brand-navy/40 backdrop-blur-[2px] flex items-center justify-center">
                                            <Badge variant="secondary" className="bg-brand-white text-brand-navy font-bold text-[10px] px-3 py-1 rounded-full shadow-sm">INACTIVE</Badge>
                                        </div>
                                    )}
                                </div>

                                <div className="flex-1 min-w-0 space-y-2 w-full">
                                    <h3 className="text-xl font-bold text-brand-navy truncate">{accessory.name}</h3>
                                    <p className="text-xs font-black uppercase tracking-widest text-brand-navy/40">{accessory.code}</p>

                                    <div className="flex flex-wrap items-center gap-4 sm:gap-6 pt-2">
                                        <div className="flex items-center gap-2">
                                            <div className={cn("w-2 h-2 rounded-full", (accessory.stock || 0) > 10 ? "bg-emerald-500" : (accessory.stock || 0) > 0 ? "bg-amber-500" : "bg-red-500")} />
                                            <span className="text-[10px] font-black text-brand-navy/60 tracking-wider uppercase">{accessory.stock || 0} in stock</span>
                                        </div>
                                        <div className="hidden sm:block h-4 w-px bg-brand-navy/10"></div>
                                        <div className="flex gap-4">
                                            <span className="text-xs font-bold text-brand-navy">
                                                <span className="text-[10px] uppercase font-black mr-1 text-brand-navy/40">Cost</span> {accessory.cost_price} DH
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="shrink-0 flex items-center gap-2 mt-4 sm:mt-0 w-full sm:w-auto justify-end border-t sm:border-t-0 border-brand-navy/5 sm:pt-0 pt-4">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setAccessoryToResetStock(accessory)}
                                        title="Clear Stock (0)"
                                        className="h-12 w-12 rounded-2xl bg-brand-navy/[0.04] text-brand-navy hover:bg-brand-navy hover:text-white transition-all"
                                    >
                                        <RotateCcw className="w-5 h-5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" onClick={() => openModal(accessory)} className="h-12 w-12 rounded-2xl bg-brand-navy/[0.04] text-brand-navy hover:bg-brand-navy hover:text-white transition-all">
                                        <Edit2 className="w-5 h-5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" onClick={() => setAccessoryToDelete(accessory)} className="h-12 w-12 rounded-2xl bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition-all">
                                        <Trash2 className="w-5 h-5" />
                                    </Button>
                                </div>
                            </Card>
                        )
                    ))}
                </div>
            )}

            {/* Upsert Modal */}
            <Dialog open={isModalOpen} onOpenChange={(open) => {
                if (!open && !upsertAccessoryMutation.isPending) {
                    setIsModalOpen(false);
                    setEditingAccessory(null);
                    setAttachedProducts([]);
                }
            }}>
                <DialogContent className="max-w-2xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
                            <DialogHeader className="p-8 pb-4 shrink-0">
                                <DialogTitle className="text-3xl font-bold text-brand-navy">
                                    {editingAccessory ? 'Edit Accessory' : 'Add New Accessory'}
                                </DialogTitle>
                                <DialogDescription className="text-muted-foreground text-lg">
                                    Fill in the details below to {editingAccessory ? 'update' : 'create'} this accessory.
                                </DialogDescription>
                            </DialogHeader>

                            <div className="overflow-y-auto p-8 pt-4 space-y-8 flex-1 min-h-0 custom-scrollbar">
                                {/* Image Upload & Basic Info Grid */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                    {/* Image Upload Area */}
                                    <div className="md:col-span-1 space-y-4">
                                        <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Accessory Image</FormLabel>
                                        <div
                                            onClick={() => !isUploading && fileInputRef.current?.click()}
                                            className={cn(
                                                "relative aspect-square rounded-[32px] border-4 border-dashed cursor-pointer transition-all flex flex-col items-center justify-center gap-3 overflow-hidden group/upload",
                                                form.watch('image_url')
                                                    ? "border-brand-navy/10 hover:border-brand-navy/30"
                                                    : "border-brand-navy/10 bg-brand-navy/[0.02] hover:bg-brand-navy/[0.04] hover:border-brand-navy/20"
                                            )}
                                        >
                                            {form.watch('image_url') ? (
                                                <>
                                                    <img src={form.getValues('image_url')!} className="w-full h-full object-cover" alt="Preview" />
                                                    <div className="absolute inset-0 bg-brand-navy/60 opacity-0 group-hover/upload:opacity-100 transition-opacity flex items-center justify-center">
                                                        <div className="bg-white/20 backdrop-blur-md px-4 py-2 rounded-xl text-white font-bold text-xs">Change Image</div>
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="w-12 h-12 rounded-2xl bg-brand-navy/5 flex items-center justify-center text-brand-navy/40">
                                                        <ImageIcon className="w-6 h-6" />
                                                    </div>
                                                    <div className="text-center">
                                                        <p className="text-xs font-bold text-brand-navy/60 italic uppercase tracking-widest">Click to upload</p>
                                                    </div>
                                                </>
                                            )}
                                            {isUploading && (
                                                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center">
                                                    <Loader2 className="w-8 h-8 animate-spin text-brand-navy" />
                                                </div>
                                            )}
                                            <input
                                                type="file"
                                                ref={fileInputRef}
                                                onChange={handleImageUpload}
                                                className="hidden"
                                                accept="image/*"
                                            />
                                        </div>
                                    </div>

                                    {/* Name & Code Fields */}
                                    <div className="md:col-span-2 space-y-6">
                                        <FormField
                                            control={form.control}
                                            name="name"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <div className="flex items-center gap-2 text-muted-foreground/70">
                                                        <Tag className="w-3.5 h-3.5" />
                                                        <FormLabel className="text-xs font-bold uppercase tracking-wider">Accessory Name</FormLabel>
                                                    </div>
                                                    <FormControl>
                                                        <Input placeholder="E.g. Gift Box" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
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
                                                    <div className="flex items-center gap-2 text-muted-foreground/70">
                                                        <Hash className="w-3.5 h-3.5" />
                                                        <FormLabel className="text-xs font-bold uppercase tracking-wider">SKU / Code</FormLabel>
                                                    </div>
                                                    <FormControl>
                                                        <Input placeholder="ACC-001" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <FormField
                                            control={form.control}
                                            name="cost_price"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Cost Price (DH)</FormLabel>
                                                    <FormControl>
                                                        <Input type="number" step="0.01" placeholder="0" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </div>

                                {/* Product Attachment Section */}
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 text-muted-foreground/70">
                                        <Link2 className="w-3.5 h-3.5" />
                                        <p className="text-xs font-bold uppercase tracking-wider">Attach to Products</p>
                                    </div>
                                    <p className="text-xs text-muted-foreground -mt-2">Select products that use this accessory by default. Set the default quantity per product.</p>

                                    {/* Product Search */}
                                    <div className="relative">
                                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                        <Input
                                            placeholder="Search products..."
                                            value={productSearch}
                                            onChange={(e) => setProductSearch(e.target.value)}
                                            className="h-11 pl-11 rounded-2xl border-none bg-white shadow-sm text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium"
                                        />
                                    </div>

                                    {/* Product List */}
                                    <div className="space-y-2 max-h-[250px] overflow-y-auto custom-scrollbar rounded-2xl border border-brand-navy/[0.04] p-3">
                                        {filteredProducts?.length === 0 ? (
                                            <p className="text-sm text-muted-foreground text-center py-6">No products found.</p>
                                        ) : (
                                            filteredProducts?.map(product => {
                                                const attachment = attachedProducts.find(ap => ap.product_id === product.id);
                                                const isAttached = !!attachment;

                                                return (
                                                    <div
                                                        key={product.id}
                                                        className={cn(
                                                            "flex items-center gap-3 p-3 rounded-2xl transition-all cursor-pointer",
                                                            isAttached
                                                                ? "bg-brand-navy/[0.06] ring-1 ring-brand-navy/10"
                                                                : "hover:bg-brand-navy/[0.02]"
                                                        )}
                                                    >
                                                        {/* Checkbox area */}
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleProductAttachment(product.id)}
                                                            className={cn(
                                                                "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all border-2",
                                                                isAttached
                                                                    ? "bg-brand-navy border-brand-navy text-white"
                                                                    : "border-brand-navy/20 text-transparent hover:border-brand-navy/40"
                                                            )}
                                                        >
                                                            <Check className="w-4 h-4" />
                                                        </button>

                                                        {/* Product Image */}
                                                        <div className="w-10 h-10 rounded-xl overflow-hidden bg-brand-navy/[0.03] shrink-0">
                                                            {product.image_url ? (
                                                                <img src={product.image_url} className="w-full h-full object-cover" alt="" />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center">
                                                                    <Package className="w-4 h-4 text-brand-navy/20" />
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Product Info */}
                                                        <div className="flex-1 min-w-0" onClick={() => toggleProductAttachment(product.id)}>
                                                            <p className="text-sm font-bold text-brand-navy truncate">{product.name}</p>
                                                            <p className="text-[10px] font-bold text-brand-navy/40 uppercase tracking-wider">{product.code}</p>
                                                        </div>

                                                        {/* Quantity Selector */}
                                                        {isAttached && (
                                                            <div className="flex items-center gap-2 shrink-0">
                                                                <span className="text-[10px] font-bold text-brand-navy/40 uppercase">Qty:</span>
                                                                <Input
                                                                    type="number"
                                                                    min={1}
                                                                    value={attachment!.default_quantity}
                                                                    onChange={(e) => updateAttachmentQuantity(product.id, parseInt(e.target.value) || 1)}
                                                                    className="w-16 h-8 rounded-xl border-none bg-white text-center text-sm font-bold text-brand-navy shadow-sm"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                />
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>

                                    {attachedProducts.length > 0 && (
                                        <Badge className="bg-brand-navy/5 text-brand-navy border-none font-bold text-xs">
                                            {attachedProducts.length} product{attachedProducts.length > 1 ? 's' : ''} attached
                                        </Badge>
                                    )}
                                </div>

                                {/* Active Status Toggle */}
                                <FormField
                                    control={form.control}
                                    name="active"
                                    render={({ field }) => (
                                        <FormItem className="flex items-center justify-between p-6 rounded-3xl bg-brand-navy/[0.02] border border-brand-navy/[0.03]">
                                            <div className="space-y-1">
                                                <FormLabel className="text-base font-bold text-brand-navy">Active Status</FormLabel>
                                                <FormDescription>Toggle off to hide this accessory.</FormDescription>
                                            </div>
                                            <FormControl>
                                                <Switch
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className="data-[state=checked]:bg-emerald-500"
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <DialogFooter className="p-8 pt-0 shrink-0 bg-brand-white">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                        setIsModalOpen(false);
                                        setEditingAccessory(null);
                                        setAttachedProducts([]);
                                    }}
                                    className="rounded-2xl h-14 px-8 font-bold text-brand-navy hover:bg-muted"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={upsertAccessoryMutation.isPending || isUploading}
                                    className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-14 px-10 font-bold shadow-2xl shadow-brand-navy/30 transition-all active:scale-95 flex items-center gap-3"
                                >
                                    {(upsertAccessoryMutation.isPending || isUploading) && <Loader2 className="w-5 h-5 animate-spin" />}
                                    {editingAccessory ? 'Update Accessory' : 'Create Accessory'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={!!accessoryToDelete} onOpenChange={() => setAccessoryToDelete(null)}>
                <AlertDialogContent className="rounded-[40px] border-none p-10 max-w-md">
                    <div className="flex flex-col items-center text-center space-y-6">
                        <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center text-red-500">
                            <Trash2 className="w-10 h-10" />
                        </div>
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-3xl font-bold text-brand-navy">Permanently Delete?</AlertDialogTitle>
                            <AlertDialogDescription className="text-lg text-muted-foreground pt-2">
                                You are about to remove <span className="font-black text-brand-navy italic">"{accessoryToDelete?.name}"</span>. This action cannot be reversed.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="w-full flex flex-col sm:flex-row gap-3 mt-4">
                            <AlertDialogCancel className="w-full rounded-2xl h-14 font-bold border-none bg-brand-navy/[0.04] hover:bg-brand-navy/[0.08] text-brand-navy m-0">
                                Back to Safety
                            </AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => deleteAccessoryMutation.mutate(accessoryToDelete.id)}
                                className="w-full rounded-2xl h-14 font-bold bg-red-500 hover:bg-red-600 text-brand-white shadow-xl shadow-red-500/20 m-0"
                            >
                                {deleteAccessoryMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                Confirm Removal
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </div>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={!!accessoryToResetStock} onOpenChange={() => setAccessoryToResetStock(null)}>
                <AlertDialogContent className="rounded-[40px] border-none p-10 max-w-md">
                    <div className="flex flex-col items-center text-center space-y-6">
                        <div className="w-20 h-20 bg-brand-navy/[0.06] rounded-full flex items-center justify-center text-brand-navy">
                            <RotateCcw className="w-10 h-10" />
                        </div>
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-3xl font-bold text-brand-navy">Clear Stock?</AlertDialogTitle>
                            <AlertDialogDescription className="text-lg text-muted-foreground pt-2">
                                This will instantly reset the stock for{' '}
                                <span className="font-black text-brand-navy italic">"{accessoryToResetStock?.name}"</span> to 0.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="w-full flex flex-col sm:flex-row gap-3 mt-4">
                            <AlertDialogCancel className="w-full rounded-2xl h-14 font-bold border-none bg-brand-navy/[0.04] hover:bg-brand-navy/[0.08] text-brand-navy m-0">
                                Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() =>
                                    accessoryToResetStock &&
                                    updateStockMutation.mutate({ id: accessoryToResetStock.id, stock: 0 })
                                }
                                className="w-full rounded-2xl h-14 font-bold bg-brand-navy hover:bg-brand-navy/90 text-brand-white shadow-xl shadow-brand-navy/20 m-0"
                            >
                                {updateStockMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                Yes, Clear Stock
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </div>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default Accessories;
