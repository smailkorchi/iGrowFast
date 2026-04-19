import React, { useState, useRef, useEffect, useMemo } from 'react';
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
    Check,
    Tag,
    Hash,
    Link2,
    Package,
    RotateCcw,
    LayoutGrid,
    List,
    AlertTriangle,
    Power,
    Eye,
    ChevronDown,
    ChevronUp,
} from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from '@/components/ui/button';
import { TruncatedText } from '@/components/ui/truncated-text';
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
import { ImageHoverPreview } from '@/components/catalog/ImageHoverPreview';
import {
    AccessoryPreviewDialog,
    formatAccessoryInventoryValueDh,
    type AccessoryPreviewRow,
} from '@/components/catalog/AccessoryPreviewDialog';

const accessorySchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    code: z.string().min(2, "Code must be at least 2 characters"),
    cost_price: z.coerce.number().min(0, "Price must be positive"),
    active: z.boolean().default(true),
    image_url: z.string().optional().nullable(),
});

type AccessoryFormValues = z.infer<typeof accessorySchema>;

function formatDhAggregate(value: number) {
    return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)} DH`;
}

const Accessories = () => {
    const location = useLocation();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingAccessory, setEditingAccessory] = useState<any>(null);
    const [accessoryToDelete, setAccessoryToDelete] = useState<any>(null);
    const [accessoryToResetStock, setAccessoryToResetStock] = useState<any>(null);
    const [previewAccessory, setPreviewAccessory] = useState<AccessoryPreviewRow | null>(null);
    const [lowStockListExpanded, setLowStockListExpanded] = useState(false);
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
    const [bulkAttachmentQty, setBulkAttachmentQty] = useState("1");

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
            queryClient.invalidateQueries({ queryKey: ['seller-view-accessories'] });
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
            queryClient.invalidateQueries({ queryKey: ['seller-view-accessories'] });
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

    const toggleAccessoryActiveMutation = useMutation({
        mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
            const { error } = await supabase
                .from('accessories')
                .update({ active })
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
        },
        onSuccess: (_, { active }) => {
            queryClient.invalidateQueries({ queryKey: ['accessories', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['accessories-minimal', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['accessories-dropdown-orders', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['accessories-import', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['seller-view-accessories'] });
            toast({
                title: active ? 'Accessory activated' : 'Accessory deactivated',
                description: active ? 'Visible in order pickers.' : 'Hidden from order pickers.',
            });
        },
        onError: (error: any) => {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        },
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
            queryClient.invalidateQueries({ queryKey: ['seller-view-accessories'] });
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
        } catch (error) {
            toast({ title: "Upload failed", description: (error as any).message, variant: "destructive" });
        } finally {
            setIsUploading(false);
        }
    };

    const onSubmit = (values: AccessoryFormValues) => {
        upsertAccessoryMutation.mutate(values);
    };

    const filteredAccessories = useMemo(() => {
        const q = searchQuery.toLowerCase();
        const list = (accessories ?? []).filter(a =>
            a.name.toLowerCase().includes(q) ||
            a.code.toLowerCase().includes(q)
        );
        return list
            .map((a, i) => ({ a, i, oos: Number(a.stock ?? 0) === 0 }))
            .sort((x, y) => {
                if (x.oos !== y.oos) return x.oos ? 1 : -1;
                return x.i - y.i;
            })
            .map((x) => x.a);
    }, [accessories, searchQuery]);

    const catalogTotals = useMemo(() => {
        const list = accessories ?? [];
        let totalQuantity = 0;
        let inventoryValue = 0;
        for (const a of list) {
            const q = Number(a.stock ?? 0);
            const c = Number(a.cost_price ?? 0);
            totalQuantity += q;
            inventoryValue += q * c;
        }
        return { totalQuantity, inventoryValue };
    }, [accessories]);

    const lowStockAccessories = useMemo(() => {
        const list = (accessories ?? []).filter((a) => (a.stock || 0) <= 10);
        return [...list].sort((a, b) => Number(a.stock ?? 0) - Number(b.stock ?? 0));
    }, [accessories]);
    const lowStockAccessoriesTotalUnits = useMemo(
        () => lowStockAccessories.reduce((sum, a) => sum + Number(a.stock ?? 0), 0),
        [lowStockAccessories]
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
        setBulkAttachmentQty("1");
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

    const filteredProducts = useMemo(
        () =>
            products?.filter(
                (p) =>
                    p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
                    p.code.toLowerCase().includes(productSearch.toLowerCase())
            ),
        [products, productSearch]
    );

    /** Attach every product in the current search results; keeps existing rows and their quantities. */
    const selectAllFilteredProducts = () => {
        const list = filteredProducts;
        if (!list?.length) return;
        setAttachedProducts((prev) => {
            const map = new Map(prev.map((ap) => [ap.product_id, ap]));
            for (const product of list) {
                if (!map.has(product.id)) {
                    map.set(product.id, { product_id: product.id, default_quantity: 1 });
                }
            }
            return Array.from(map.values());
        });
    };

    const filteredProductIds = useMemo(
        () => new Set((filteredProducts ?? []).map((p) => p.id)),
        [filteredProducts]
    );

    const filteredAttachedCount = useMemo(
        () => attachedProducts.filter((ap) => filteredProductIds.has(ap.product_id)).length,
        [attachedProducts, filteredProductIds]
    );

    /** Set default_quantity for every attachment that appears in the current filtered list. */
    const applyBulkQuantityToFiltered = () => {
        const qty = Math.max(1, parseInt(bulkAttachmentQty, 10) || 1);
        if (filteredAttachedCount === 0) return;
        setAttachedProducts((prev) =>
            prev.map((ap) =>
                filteredProductIds.has(ap.product_id) ? { ...ap, default_quantity: qty } : ap
            )
        );
    };

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Page Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Accessories</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Catalog — accessories & attachments</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v as 'grid' | 'list')} variant="outline" size="sm">
                            <ToggleGroupItem value="grid" className="h-8 w-8 p-0 rounded-r-none">
                                <LayoutGrid className="w-3.5 h-3.5" />
                            </ToggleGroupItem>
                            <ToggleGroupItem value="list" className="h-8 w-8 p-0 rounded-l-none border-l-0">
                                <List className="w-3.5 h-3.5" />
                            </ToggleGroupItem>
                        </ToggleGroup>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                            <Input
                                placeholder="Search name or code..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-8 h-8 rounded-md text-[11px] w-56 border-gray-200"
                            />
                        </div>
                        <Button
                            onClick={() => openModal()}
                            className="h-8 rounded-md text-[11px] font-semibold gap-1.5 px-3"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            Add Accessory
                        </Button>
                    </div>
                </div>
            </header>

            {/* KPI Tiles */}
            {isLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-16 rounded-xl" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                        <span className="w-[3px] self-stretch rounded-full" style={{ background: '#3b5e5e' }} />
                        <div className="flex-1 min-w-0">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Accessories</p>
                            <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{accessories?.length ?? 0}</p>
                        </div>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                        <span className="w-[3px] self-stretch rounded-full" style={{ background: '#3b5e5e' }} />
                        <div className="flex-1 min-w-0">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Units in stock</p>
                            <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{new Intl.NumberFormat('fr-FR').format(catalogTotals.totalQuantity)}</p>
                        </div>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                        <span className="w-[3px] self-stretch rounded-full" style={{ background: '#d97706' }} />
                        <div className="flex-1 min-w-0">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Inventory cost</p>
                            <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1 truncate">{formatDhAggregate(catalogTotals.inventoryValue)}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Low Stock Banner */}
            {lowStockAccessories.length > 0 && (
                <div className="bg-white border border-red-100 rounded-xl overflow-hidden">
                    <button
                        type="button"
                        onClick={() => setLowStockListExpanded((v) => !v)}
                        className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-red-50/30 transition-colors text-left"
                    >
                        <div className="flex items-center gap-2">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                            <span className="text-[11px] font-semibold text-red-600">
                                Low stock — {lowStockAccessories.length} item{lowStockAccessories.length === 1 ? '' : 's'}
                            </span>
                            <span className="text-[10px] text-gray-400 tabular-nums">
                                {lowStockAccessoriesTotalUnits} unit{lowStockAccessoriesTotalUnits === 1 ? '' : 's'} remaining
                            </span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-gray-400 uppercase tracking-[0.14em]">
                            {lowStockListExpanded ? 'Hide' : 'Show'}
                            {lowStockListExpanded ? (
                                <ChevronUp className="w-3 h-3" />
                            ) : (
                                <ChevronDown className="w-3 h-3" />
                            )}
                        </div>
                    </button>
                    {lowStockListExpanded && (
                        <div className="border-t border-red-100 overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-gray-100">
                                        <th className="text-left py-1.5 px-3 text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Accessory</th>
                                        <th className="text-left py-1.5 px-2 text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Code</th>
                                        <th className="text-right py-1.5 px-2 text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Stock</th>
                                        <th className="text-right py-1.5 px-3 text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Cost</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lowStockAccessories.map((a) => {
                                        const stock = Number(a.stock ?? 0);
                                        const cost = Number(a.cost_price ?? 0);
                                        const stockTone =
                                            stock === 0 ? 'text-red-600' : stock <= 2 ? 'text-red-500' : 'text-amber-600';
                                        return (
                                            <tr
                                                key={a.id}
                                                onClick={() => setPreviewAccessory(a)}
                                                className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
                                            >
                                                <td className="px-3 py-2 text-[11px] text-brand-navy/80">
                                                    <div className="flex items-center gap-2">
                                                        {a.image_url ? (
                                                            <img src={a.image_url} alt={a.name} className="w-5 h-5 rounded-sm object-cover border border-brand-navy/5 shrink-0" />
                                                        ) : (
                                                            <div className="w-5 h-5 rounded-sm bg-brand-navy/[0.04] flex items-center justify-center shrink-0">
                                                                <Puzzle className="w-3 h-3 text-brand-navy/20" />
                                                            </div>
                                                        )}
                                                        <TruncatedText as="span" text={a.name} className="truncate" />
                                                    </div>
                                                </td>
                                                <td className="px-2 py-2 text-[10px] text-gray-400 font-mono tabular-nums truncate">{a.code}</td>
                                                <td className={`px-2 py-2 text-right text-[11px] font-semibold tabular-nums ${stockTone}`}>
                                                    {stock} left
                                                </td>
                                                <td className="px-3 py-2 text-right text-[11px] text-brand-navy/80 tabular-nums">
                                                    {cost.toLocaleString('fr-MA')}
                                                    <span className="text-[9px] text-brand-navy/40 ml-0.5">MAD</span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* Content Section */}
            {isLoading ? (
                <div className={cn(
                    "grid gap-2.5",
                    viewMode === 'grid' ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1"
                )}>
                    {Array.from({ length: 8 }).map((_, i) => (
                        viewMode === 'grid' ? (
                            <Skeleton key={i} className="h-36 rounded-xl" />
                        ) : (
                            <div key={i} className="rounded-xl border border-gray-100 bg-white p-3 flex gap-3 items-center">
                                <Skeleton className="h-14 w-14 rounded-md shrink-0" />
                                <div className="flex-1 space-y-2">
                                    <Skeleton className="h-4 w-24" />
                                    <Skeleton className="h-3 w-16" />
                                </div>
                            </div>
                        )
                    ))}
                </div>
            ) : filteredAccessories?.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-white flex flex-col items-center justify-center py-8 gap-2">
                    <Puzzle className="w-6 h-6 text-gray-400" />
                    <p className="text-[14px] font-semibold text-brand-navy">No accessories found</p>
                    <p className="text-[11px] text-gray-500">Start managing your accessories by adding your first one.</p>
                    <Button variant="outline" onClick={() => openModal()} className="h-8 rounded-md text-[11px] font-semibold mt-2">
                        Add First Accessory
                    </Button>
                </div>
            ) : (
                <div className={cn(
                    "grid gap-2.5",
                    viewMode === 'grid' ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1"
                )}>
                    {filteredAccessories?.map((accessory) => (
                        viewMode === 'grid' ? (
                            <div
                                key={accessory.id}
                                className="rounded-xl border border-gray-100 bg-white overflow-hidden group relative"
                            >
                                <ImageHoverPreview imageUrl={accessory.image_url} name={accessory.name} code={accessory.code}>
                                <div className="relative aspect-square overflow-hidden bg-brand-navy/[0.02]">
                                    {accessory.image_url ? (
                                        <img
                                            src={accessory.image_url}
                                            alt={accessory.name}
                                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                        />
                                    ) : (
                                        <div className="flex items-center justify-center h-full w-full text-brand-navy/10">
                                            <Puzzle className="w-10 h-10" />
                                        </div>
                                    )}
                                    <div className="absolute top-2 left-2 z-20">
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="icon"
                                            title="Preview"
                                            onClick={() => setPreviewAccessory(accessory)}
                                            className="h-7 w-7 rounded-md bg-white/90 border-none shadow text-brand-navy hover:bg-white transition-all"
                                        >
                                            <Eye className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                    <div className="absolute top-2 right-2 z-20">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="secondary" size="icon" className="h-7 w-7 rounded-md bg-white/90 border-none shadow text-brand-navy hover:bg-white transition-all">
                                                    <MoreVertical className="h-3.5 w-3.5" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="min-w-[160px]">
                                                <DropdownMenuItem onClick={() => setPreviewAccessory(accessory)} className="gap-2 text-[11px]">
                                                    <Eye className="w-3.5 h-3.5" />Preview
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => openModal(accessory)} className="gap-2 text-[11px]">
                                                    <Edit2 className="w-3.5 h-3.5" />Edit Accessory
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => setAccessoryToResetStock(accessory)} className="gap-2 text-[11px]">
                                                    <RotateCcw className="w-3.5 h-3.5" />Clear Stock (0)
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onClick={() => toggleAccessoryActiveMutation.mutate({ id: accessory.id, active: !accessory.active })}
                                                    disabled={toggleAccessoryActiveMutation.isPending}
                                                    className="gap-2 text-[11px]"
                                                >
                                                    <Power className="w-3.5 h-3.5" />{accessory.active ? 'Deactivate' : 'Activate'}
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem onClick={() => setAccessoryToDelete(accessory)} className="gap-2 text-[11px] text-red-500 focus:text-red-600">
                                                    <Trash2 className="w-3.5 h-3.5" />Delete
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                    {!accessory.active && (
                                        <div className="absolute inset-0 z-[1] pointer-events-none bg-brand-navy/40 backdrop-blur-[2px] flex items-center justify-center">
                                            <Badge variant="secondary" className="text-[9px] px-2 py-0.5">INACTIVE</Badge>
                                        </div>
                                    )}
                                </div>
                                </ImageHoverPreview>

                                <div className="p-3 space-y-2">
                                    <div>
                                        <TruncatedText as="p" text={accessory.code} className="text-[9px] font-semibold uppercase tracking-widest text-brand-navy/40 truncate" />
                                        <TruncatedText as="h3" text={accessory.name} className="text-[12px] font-semibold text-brand-navy leading-snug line-clamp-2 break-words" />
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-[9px] text-gray-400 uppercase tracking-[0.14em]">Cost</p>
                                            <p className="text-[11px] font-semibold text-brand-navy tabular-nums">{accessory.cost_price} DH</p>
                                        </div>
                                        <Badge
                                            className={cn(
                                                "h-5 px-1.5 text-[9px] border-none",
                                                (accessory.stock || 0) > 10
                                                    ? "bg-emerald-50 text-emerald-700"
                                                    : (accessory.stock || 0) > 0
                                                    ? "bg-amber-50 text-amber-700"
                                                    : "bg-red-50 text-red-600"
                                            )}
                                        >
                                            {accessory.stock || 0} in stock
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div key={accessory.id} className="rounded-xl border border-gray-100 bg-white flex flex-col sm:flex-row items-center p-3 gap-3 hover:bg-gray-50 transition-colors group">
                                <ImageHoverPreview imageUrl={accessory.image_url} name={accessory.name} code={accessory.code}>
                                <div className="relative h-14 w-14 shrink-0 rounded-md overflow-hidden bg-brand-navy/[0.02]">
                                    {accessory.image_url ? (
                                        <img src={accessory.image_url} alt={accessory.name} className="h-full w-full object-cover" />
                                    ) : (
                                        <div className="flex items-center justify-center h-full w-full text-brand-navy/10">
                                            <Puzzle className="w-6 h-6" />
                                        </div>
                                    )}
                                    {!accessory.active && (
                                        <div className="absolute inset-0 bg-brand-navy/40 backdrop-blur-[2px] flex items-center justify-center">
                                            <span className="text-[8px] font-semibold text-white">OFF</span>
                                        </div>
                                    )}
                                </div>
                                </ImageHoverPreview>

                                <div className="flex-1 min-w-0 space-y-0.5 w-full">
                                    <div className="flex items-start gap-2 flex-wrap">
                                        <TruncatedText as="h3" text={accessory.name} className="text-[12px] font-semibold text-brand-navy leading-snug min-w-0 flex-1" />
                                        <Badge
                                            className={cn(
                                                "h-5 px-1.5 text-[9px] border-none shrink-0",
                                                (accessory.stock || 0) > 10
                                                    ? "bg-emerald-50 text-emerald-700"
                                                    : (accessory.stock || 0) > 0
                                                    ? "bg-amber-50 text-amber-700"
                                                    : "bg-red-50 text-red-600"
                                            )}
                                        >
                                            {accessory.stock || 0} in stock
                                        </Badge>
                                        {!accessory.active && <Badge variant="secondary" className="h-5 px-1.5 text-[9px]">Inactive</Badge>}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                                        <span className="text-[10px] text-gray-400 font-mono">{accessory.code}</span>
                                        <span className="text-[10px] text-brand-navy/80 tabular-nums">Cost {accessory.cost_price} DH</span>
                                        <span className="text-[10px] text-emerald-700 tabular-nums font-semibold">Value {formatAccessoryInventoryValueDh(accessory)}</span>
                                    </div>
                                </div>

                                <div className="shrink-0 flex items-center gap-1 mt-2 sm:mt-0 w-full sm:w-auto justify-end">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        title="Preview"
                                        onClick={() => setPreviewAccessory(accessory)}
                                        className="h-8 w-8 rounded-md text-brand-navy hover:bg-brand-navy/[0.06]"
                                    >
                                        <Eye className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setAccessoryToResetStock(accessory)}
                                        title="Clear Stock (0)"
                                        className="h-8 w-8 rounded-md text-brand-navy hover:bg-brand-navy/[0.06]">
                                        <RotateCcw className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => toggleAccessoryActiveMutation.mutate({ id: accessory.id, active: !accessory.active })}
                                        disabled={toggleAccessoryActiveMutation.isPending}
                                        title={accessory.active ? 'Deactivate' : 'Activate'}
                                        className="h-8 w-8 rounded-md text-brand-navy hover:bg-brand-navy/[0.06]"
                                    >
                                        <Power className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" onClick={() => openModal(accessory)} className="h-8 w-8 rounded-md text-brand-navy hover:bg-brand-navy/[0.06]">
                                        <Edit2 className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" onClick={() => setAccessoryToDelete(accessory)} className="h-8 w-8 rounded-md text-red-500 hover:bg-red-50">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                </div>
                            </div>
                        )
                    ))}
                </div>
            )}

            <AccessoryPreviewDialog
                open={!!previewAccessory}
                onOpenChange={(open) => !open && setPreviewAccessory(null)}
                accessory={previewAccessory}
                variant="admin"
                adminActions={
                    previewAccessory
                        ? {
                              onEdit: () => openModal(previewAccessory),
                              onClearStock: () => setAccessoryToResetStock(previewAccessory),
                              onToggleActive: () =>
                                  toggleAccessoryActiveMutation.mutate({
                                      id: previewAccessory.id,
                                      active: !previewAccessory.active,
                                  }),
                              onDelete: () => setAccessoryToDelete(previewAccessory),
                              toggleActivePending: toggleAccessoryActiveMutation.isPending,
                          }
                        : undefined
                }
            />

            {/* Upsert Modal */}
            <Dialog open={isModalOpen} onOpenChange={(open) => {
                if (!open && !upsertAccessoryMutation.isPending) {
                    setIsModalOpen(false);
                    setEditingAccessory(null);
                    setAttachedProducts([]);
                }
            }}>
                <DialogContent className="max-w-2xl p-0 overflow-hidden flex flex-col max-h-[90vh]">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
                            <DialogHeader className="p-6 pb-3 shrink-0 border-b border-gray-100">
                                <DialogTitle className="text-[15px] font-semibold text-brand-navy">
                                    {editingAccessory ? 'Edit Accessory' : 'Add New Accessory'}
                                </DialogTitle>
                                <DialogDescription className="text-[11px] text-gray-500">
                                    Fill in the details below to {editingAccessory ? 'update' : 'create'} this accessory.
                                </DialogDescription>
                            </DialogHeader>

                            <div className="overflow-y-auto p-6 space-y-5 flex-1 min-h-0 custom-scrollbar">
                                {/* Image Upload & Basic Info Grid */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                                    {/* Image Upload Area */}
                                    <div className="md:col-span-1 space-y-2">
                                        <FormLabel className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Accessory Image</FormLabel>
                                        <div
                                            onClick={() => !isUploading && fileInputRef.current?.click()}
                                            className={cn(
                                                "relative aspect-square rounded-xl border-2 border-dashed cursor-pointer transition-all flex flex-col items-center justify-center gap-2 overflow-hidden group",
                                                form.watch('image_url')
                                                    ? "border-brand-navy/10 hover:border-brand-navy/30"
                                                    : "border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-gray-300"
                                            )}
                                        >
                                            {form.watch('image_url') ? (
                                                <>
                                                    <img src={form.getValues('image_url')!} className="w-full h-full object-cover" alt="Preview" />
                                                    <div className="absolute inset-0 bg-brand-navy/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                        <span className="text-white text-[11px] font-semibold">Change Image</span>
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <ImageIcon className="w-6 h-6 text-gray-400" />
                                                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Click to upload</p>
                                                </>
                                            )}
                                            {isUploading && (
                                                <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                                                    <Loader2 className="w-5 h-5 animate-spin text-brand-navy" />
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
                                    <div className="md:col-span-2 space-y-4">
                                        <FormField
                                            control={form.control}
                                            name="name"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <div className="flex items-center gap-1.5 text-gray-400">
                                                        <Tag className="w-3 h-3" />
                                                        <FormLabel className="text-[10px] font-semibold uppercase tracking-wider">Accessory Name</FormLabel>
                                                    </div>
                                                    <FormControl>
                                                        <Input placeholder="E.g. Gift Box" {...field} className="h-9 rounded-md text-[12px]" />
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
                                                    <div className="flex items-center gap-1.5 text-gray-400">
                                                        <Hash className="w-3 h-3" />
                                                        <FormLabel className="text-[10px] font-semibold uppercase tracking-wider">SKU / Code</FormLabel>
                                                    </div>
                                                    <FormControl>
                                                        <Input placeholder="ACC-001" {...field} className="h-9 rounded-md text-[12px]" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <FormField
                                            control={form.control}
                                            name="cost_price"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Cost Price (DH)</FormLabel>
                                                    <FormControl>
                                                        <Input type="number" step="0.01" placeholder="0" {...field} className="h-9 rounded-md text-[12px]" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </div>

                                {/* Product Attachment Section */}
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-gray-400">
                                        <Link2 className="w-3 h-3" />
                                        <p className="text-[10px] font-semibold uppercase tracking-wider">Attach to Products</p>
                                    </div>
                                    <p className="text-[11px] text-gray-500 -mt-1">Select products that use this accessory by default. Set the default quantity per product.</p>

                                    {/* Product Search + bulk actions */}
                                    <div className="flex flex-col gap-2">
                                        <div className="relative w-full">
                                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                                            <Input
                                                placeholder="Search products..."
                                                value={productSearch}
                                                onChange={(e) => setProductSearch(e.target.value)}
                                                className="h-8 pl-8 rounded-md text-[11px]"
                                            />
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                disabled={!filteredProducts?.length}
                                                onClick={selectAllFilteredProducts}
                                                className="h-8 rounded-md text-[11px] font-semibold"
                                            >
                                                Select all
                                                {filteredProducts && filteredProducts.length > 0
                                                    ? ` (${filteredProducts.length})`
                                                    : ''}
                                            </Button>
                                            <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1">
                                                <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 whitespace-nowrap">
                                                    Qty
                                                </span>
                                                <Input
                                                    type="number"
                                                    min={1}
                                                    value={bulkAttachmentQty}
                                                    onChange={(e) => setBulkAttachmentQty(e.target.value)}
                                                    className="h-6 w-12 rounded-md border-none bg-gray-50 text-center text-[11px] font-semibold shadow-none px-1"
                                                />
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    size="sm"
                                                    disabled={filteredAttachedCount === 0}
                                                    onClick={applyBulkQuantityToFiltered}
                                                    className="h-6 rounded-md px-2 text-[10px] font-semibold"
                                                >
                                                    Apply
                                                </Button>
                                            </div>
                                        </div>
                                        {filteredAttachedCount > 0 && (
                                            <p className="text-[10px] text-gray-400">
                                                Applies to {filteredAttachedCount} attached product
                                                {filteredAttachedCount !== 1 ? 's' : ''} in this list
                                            </p>
                                        )}
                                    </div>

                                    {/* Product List */}
                                    <div className="space-y-1.5 max-h-[220px] overflow-y-auto custom-scrollbar rounded-xl border border-gray-100 p-2">
                                        {filteredProducts?.length === 0 ? (
                                            <p className="text-[11px] text-gray-400 text-center py-4">No products found.</p>
                                        ) : (
                                            filteredProducts?.map(product => {
                                                const attachment = attachedProducts.find(ap => ap.product_id === product.id);
                                                const isAttached = !!attachment;

                                                return (
                                                    <div
                                                        key={product.id}
                                                        className={cn(
                                                            "flex items-center gap-2.5 p-2 rounded-lg transition-all cursor-pointer",
                                                            isAttached
                                                                ? "bg-brand-navy/[0.05] ring-1 ring-brand-navy/10"
                                                                : "hover:bg-gray-50"
                                                        )}
                                                    >
                                                        {/* Checkbox area */}
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleProductAttachment(product.id)}
                                                            className={cn(
                                                                "w-5 h-5 rounded flex items-center justify-center shrink-0 transition-all border",
                                                                isAttached
                                                                    ? "bg-brand-navy border-brand-navy text-white"
                                                                    : "border-gray-300 text-transparent hover:border-brand-navy/40"
                                                            )}
                                                        >
                                                            <Check className="w-3 h-3" />
                                                        </button>

                                                        {/* Product Image */}
                                                        <div className="w-8 h-8 rounded-md overflow-hidden bg-brand-navy/[0.03] shrink-0">
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
                                                            <TruncatedText as="p" text={product.name} className="text-[11px] font-semibold text-brand-navy truncate" />
                                                            <TruncatedText as="p" text={product.code} className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider truncate" />
                                                        </div>

                                                        {/* Quantity Selector */}
                                                        {isAttached && (
                                                            <div className="flex items-center gap-1.5 shrink-0">
                                                                <span className="text-[9px] font-bold text-gray-400 uppercase">Qty:</span>
                                                                <Input
                                                                    type="number"
                                                                    min={1}
                                                                    value={attachment!.default_quantity}
                                                                    onChange={(e) => updateAttachmentQuantity(product.id, parseInt(e.target.value) || 1)}
                                                                    className="w-14 h-7 rounded-md border-gray-200 text-center text-[11px] font-semibold"
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
                                        <Badge className="bg-brand-navy/5 text-brand-navy border-none text-[10px]">
                                            {attachedProducts.length} product{attachedProducts.length > 1 ? 's' : ''} attached
                                        </Badge>
                                    )}
                                </div>

                                {/* Active Status Toggle */}
                                <FormField
                                    control={form.control}
                                    name="active"
                                    render={({ field }) => (
                                        <FormItem className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-gray-50/50">
                                            <div className="space-y-0.5">
                                                <FormLabel className="text-[12px] font-semibold text-brand-navy">Active Status</FormLabel>
                                                <FormDescription className="text-[10px]">Toggle off to hide this accessory.</FormDescription>
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

                            <DialogFooter className="p-4 shrink-0 border-t border-gray-100 gap-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                        setIsModalOpen(false);
                                        setEditingAccessory(null);
                                        setAttachedProducts([]);
                                    }}
                                    className="h-8 rounded-md text-[11px] font-semibold"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={upsertAccessoryMutation.isPending || isUploading}
                                    className="h-8 rounded-md text-[11px] font-semibold gap-1.5"
                                >
                                    {(upsertAccessoryMutation.isPending || isUploading) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                    {editingAccessory ? 'Update Accessory' : 'Create Accessory'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={!!accessoryToDelete} onOpenChange={() => setAccessoryToDelete(null)}>
                <AlertDialogContent className="max-w-sm rounded-xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[15px] font-semibold text-brand-navy">Permanently Delete?</AlertDialogTitle>
                        <AlertDialogDescription className="text-[11px] text-gray-500">
                            You are about to remove <span className="font-semibold text-brand-navy">"{accessoryToDelete?.name}"</span>. This action cannot be reversed.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="gap-2">
                        <AlertDialogCancel className="h-8 rounded-md text-[11px] font-semibold">Back to Safety</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => deleteAccessoryMutation.mutate(accessoryToDelete.id)}
                            className="h-8 rounded-md text-[11px] font-semibold bg-red-500 hover:bg-red-600 text-white gap-1.5"
                        >
                            {deleteAccessoryMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            Confirm Removal
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Reset Stock Confirmation */}
            <AlertDialog open={!!accessoryToResetStock} onOpenChange={() => setAccessoryToResetStock(null)}>
                <AlertDialogContent className="max-w-sm rounded-xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[15px] font-semibold text-brand-navy">Clear Stock?</AlertDialogTitle>
                        <AlertDialogDescription className="text-[11px] text-gray-500">
                            This will reset stock for <span className="font-semibold text-brand-navy">"{accessoryToResetStock?.name}"</span> to 0.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="gap-2">
                        <AlertDialogCancel className="h-8 rounded-md text-[11px] font-semibold">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() =>
                                accessoryToResetStock &&
                                updateStockMutation.mutate({ id: accessoryToResetStock.id, stock: 0 })
                            }
                            className="h-8 rounded-md text-[11px] font-semibold bg-amber-500 hover:bg-amber-600 text-white gap-1.5"
                        >
                            {updateStockMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            Yes, Clear Stock
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default Accessories;
