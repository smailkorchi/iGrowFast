import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus,
    Search,
    Package,
    MoreVertical,
    Edit2,
    Trash2,
    Loader2,
    Image as ImageIcon,
    Tag,
    Hash,
    LayoutGrid,
    List,
    AlertTriangle,
    RotateCcw,
    Power,
    Eye,
    ChevronDown,
    ChevronUp,
    ShoppingCart,
    Coins,
    Layers,
} from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TruncatedText } from '@/components/ui/truncated-text';
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ImageHoverPreview } from '@/components/catalog/ImageHoverPreview';
import {
    ProductPreviewDialog,
    formatProductDhAggregate,
    productInventoryTotals,
} from '@/components/catalog/ProductPreviewDialog';

const productSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    code: z.string().min(2, "Code must be at least 2 characters"),
    label: z.string().optional(),
    description: z.string().optional(),
    cost_price: z.coerce.number().min(0, "Price must be positive"),
    selling_price: z.coerce.number().min(0, "Price must be positive"),
    active: z.boolean().default(true),
    image_url: z.string().optional().nullable(),
});

type ProductFormValues = z.infer<typeof productSchema>;

const Products = () => {
    const navigate = useNavigate();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<any>(null);
    const [productToDelete, setProductToDelete] = useState<any>(null);
    const [productToResetStock, setProductToResetStock] = useState<any>(null);
    const [previewProduct, setPreviewProduct] = useState<any>(null);
    const [lowStockListExpanded, setLowStockListExpanded] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [isUploading, setIsUploading] = useState(false);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // --- Queries ---
    const { data: products, isLoading } = useQuery({
        queryKey: ['products', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('products')
                .select('*')
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        },
    });

    // --- Form Setup ---
    const form = useForm<ProductFormValues>({
        resolver: zodResolver(productSchema),
        defaultValues: {
            name: '',
            code: '',
            label: '',
            description: '',
            cost_price: 0,
            selling_price: 0,
            active: true,
            image_url: null,
        }
    });

    // --- SKU Auto-generation ---
    const productName = form.watch('name');
    useEffect(() => {
        if (!editingProduct && productName) {
            const sku = productName
                .toUpperCase()
                .trim()
                .replace(/\s+/g, '-')
                .replace(/[^A-Z0-9-]/g, '');
            form.setValue('code', sku, { shouldValidate: true });
        }
    }, [productName, editingProduct, form]);

    // --- Mutations ---
    const upsertProductMutation = useMutation({
        mutationFn: async (values: ProductFormValues) => {
            const payload = {
                name: values.name,
                code: values.code,
                label: values.label || null,
                description: values.description || null,
                cost_price: values.cost_price,
                selling_price: values.selling_price,
                active: values.active,
                image_url: values.image_url || null,
                'DigiCom Business': activeBusinessId
            };

            if (editingProduct) {
                const { data, error } = await supabase
                    .from('products')
                    .update(payload)
                    .eq('id', editingProduct.id)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            } else {
                const { data, error } = await supabase
                    .from('products')
                    .insert(payload)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['products', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['seller-view-products'] });
            queryClient.invalidateQueries({ queryKey: ['seller-view-accessories'] });
            setIsModalOpen(false);
            setEditingProduct(null);
            toast({
                title: editingProduct ? "Product updated" : "Product created",
                description: `Successfully ${editingProduct ? 'updated' : 'created'} ${form.getValues('name')}.`
            });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const deleteProductMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase
                .from('products')
                .delete()
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId);

            if (error) {
                if (error.code === '23503') {
                    // Soft delete fallback since it's referenced in order_items
                    const { error: softDeleteError } = await supabase
                        .from('products')
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
            queryClient.invalidateQueries({ queryKey: ['products', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['seller-view-products'] });
            queryClient.invalidateQueries({ queryKey: ['seller-view-accessories'] });
            setProductToDelete(null);
            if (data?.softDeleted) {
                toast({ title: "Product Deactivated", description: "This product is used in existing orders, so it was deactivated instead of permanently deleted." });
            } else {
                toast({ title: "Product deleted", description: "The product was successfully removed." });
            }
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const toggleProductActiveMutation = useMutation({
        mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
            const { error } = await supabase
                .from('products')
                .update({ active })
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
        },
        onSuccess: (_, { active }) => {
            queryClient.invalidateQueries({ queryKey: ['products', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['products-dropdown', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['products-user-modal', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['products-minimal', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['seller-view-products'] });
            queryClient.invalidateQueries({ queryKey: ['seller-view-accessories'] });
            toast({
                title: active ? 'Product activated' : 'Product deactivated',
                description: active ? 'Visible in pickers and seller profile.' : 'Hidden from pickers and seller profile.',
            });
        },
        onError: (error: any) => {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        },
    });

    const updateStockMutation = useMutation({
        mutationFn: async ({ id, stock }: { id: string, stock: number }) => {
            const { error } = await supabase
                .from('products')
                .update({ stock })
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId);

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['products', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['seller-view-products'] });
            setProductToResetStock(null);
            toast({ title: "Stock Updated", description: "Product stock has been modified." });
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
            const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
            const filePath = `${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('products')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('products')
                .getPublicUrl(filePath);

            form.setValue('image_url', publicUrl);
            toast({ title: "Image uploaded", description: "Product image has been updated." });
        } catch (error) {
            toast({ title: "Upload failed", description: error.message, variant: "destructive" });
        } finally {
            setIsUploading(false);
        }
    };

    const onSubmit = (values: ProductFormValues) => {
        upsertProductMutation.mutate(values);
    };

    const filteredProducts = useMemo(() => {
        const q = searchQuery.toLowerCase();
        const list = (products ?? []).filter(p =>
            p.name.toLowerCase().includes(q) ||
            p.code.toLowerCase().includes(q) ||
            p.label?.toLowerCase().includes(q) ||
            p.description?.toLowerCase().includes(q) ||
            String(p.cost_price ?? '').includes(q) ||
            String(p.selling_price ?? '').includes(q) ||
            String(p.stock ?? '').includes(q)
        );
        return list
            .map((p, i) => ({ p, i, oos: Number(p.stock ?? 0) === 0 }))
            .sort((a, b) => {
                if (a.oos !== b.oos) return a.oos ? 1 : -1;
                return a.i - b.i;
            })
            .map((x) => x.p);
    }, [products, searchQuery]);

    const catalogTotals = useMemo(() => {
        const list = products ?? [];
        let totalQuantity = 0;
        let totalCost = 0;
        let totalValue = 0;
        for (const p of list) {
            const q = Number(p.stock ?? 0);
            const c = Number(p.cost_price ?? 0);
            const s = Number(p.selling_price ?? 0);
            totalQuantity += q;
            totalCost += q * c;
            totalValue += q * s;
        }
        return { totalQuantity, totalCost, totalValue };
    }, [products]);

    const openModal = (product: any = null) => {
        if (product) {
            setEditingProduct(product);
            form.reset({
                name: product.name,
                code: product.code,
                label: product.label || '',
                description: product.description || '',
                cost_price: product.cost_price,
                selling_price: product.selling_price,
                active: product.active ?? true,
                image_url: product.image_url,
            });
        } else {
            setEditingProduct(null);
            form.reset({
                name: '',
                code: '',
                label: '',
                description: '',
                cost_price: 0,
                selling_price: 0,
                active: true,
                image_url: null,
            });
        }
        setIsModalOpen(true);
    };

    const lowStockProducts = useMemo(() => {
        const list = (products ?? []).filter((p) => (p.stock || 0) <= 10);
        return [...list].sort((a, b) => Number(a.stock ?? 0) - Number(b.stock ?? 0));
    }, [products]);
    const lowStockProductsTotalUnits = useMemo(
        () => lowStockProducts.reduce((sum, p) => sum + Number(p.stock ?? 0), 0),
        [lowStockProducts]
    );

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Page Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Inventory & Products</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Catalog — pricing & stock</p>
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
                                placeholder="Search name, code, or label..."
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
                            Add Product
                        </Button>
                    </div>
                </div>
            </header>

            {/* KPI Tiles */}
            {isLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-16 rounded-xl" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                        <span className="w-[3px] self-stretch rounded-full" style={{ background: '#3b5e5e' }} />
                        <div className="flex-1 min-w-0">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Products</p>
                            <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{products?.length ?? 0}</p>
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
                            <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1 truncate">{formatProductDhAggregate(catalogTotals.totalCost)}</p>
                        </div>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                        <span className="w-[3px] self-stretch rounded-full" style={{ background: '#059669' }} />
                        <div className="flex-1 min-w-0">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Inventory value</p>
                            <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1 truncate">{formatProductDhAggregate(catalogTotals.totalValue)}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Low Stock Banner */}
            {lowStockProducts.length > 0 && (
                <div className="bg-white border border-red-100 rounded-xl overflow-hidden">
                    <button
                        type="button"
                        onClick={() => setLowStockListExpanded((v) => !v)}
                        className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-red-50/30 transition-colors text-left"
                    >
                        <div className="flex items-center gap-2">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                            <span className="text-[11px] font-semibold text-red-600">
                                Low stock — {lowStockProducts.length} item{lowStockProducts.length === 1 ? '' : 's'}
                            </span>
                            <span className="text-[10px] text-gray-400 tabular-nums">
                                {lowStockProductsTotalUnits} unit{lowStockProductsTotalUnits === 1 ? '' : 's'} remaining
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
                                        <th className="text-left py-1.5 px-3 text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Product</th>
                                        <th className="text-left py-1.5 px-2 text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Code</th>
                                        <th className="text-right py-1.5 px-2 text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Stock</th>
                                        <th className="text-right py-1.5 px-2 text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Cost</th>
                                        <th className="text-right py-1.5 px-3 text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">At risk</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lowStockProducts.map((p) => {
                                        const stock = Number(p.stock ?? 0);
                                        const cost = Number(p.cost_price ?? 0);
                                        const stockTone =
                                            stock === 0 ? 'text-red-600' : stock <= 2 ? 'text-red-500' : 'text-amber-600';
                                        return (
                                            <tr
                                                key={p.id}
                                                onClick={() => setPreviewProduct(p)}
                                                className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
                                            >
                                                <td className="px-3 py-2 text-[11px] text-brand-navy/80">
                                                    <div className="flex items-center gap-2">
                                                        {p.image_url ? (
                                                            <img src={p.image_url} alt={p.name} className="w-5 h-5 rounded-sm object-cover border border-brand-navy/5 shrink-0" />
                                                        ) : (
                                                            <div className="w-5 h-5 rounded-sm bg-brand-navy/[0.04] flex items-center justify-center shrink-0">
                                                                <Package className="w-3 h-3 text-brand-navy/20" />
                                                            </div>
                                                        )}
                                                        <TruncatedText as="span" text={p.name} className="truncate" />
                                                    </div>
                                                </td>
                                                <td className="px-2 py-2 text-[10px] text-gray-400 font-mono tabular-nums truncate">{p.code}</td>
                                                <td className={`px-2 py-2 text-right text-[11px] font-semibold tabular-nums ${stockTone}`}>
                                                    {stock} left
                                                </td>
                                                <td className="px-2 py-2 text-right text-[11px] text-brand-navy/80 tabular-nums">
                                                    {cost.toLocaleString('fr-MA')}
                                                    <span className="text-[9px] text-brand-navy/40 ml-0.5">MAD</span>
                                                </td>
                                                <td className="px-3 py-2 text-right text-[11px] text-brand-navy tabular-nums">
                                                    {(stock * cost).toLocaleString('fr-MA')}
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
                                <Skeleton className="h-14 w-14 rounded-lg shrink-0" />
                                <div className="flex-1 space-y-2">
                                    <Skeleton className="h-4 w-24" />
                                    <Skeleton className="h-3 w-16" />
                                </div>
                            </div>
                        )
                    ))}
                </div>
            ) : filteredProducts?.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-white flex flex-col items-center justify-center py-8 gap-2">
                    <Package className="w-6 h-6 text-gray-400" />
                    <p className="text-[14px] font-semibold text-brand-navy">No products found</p>
                    <p className="text-[11px] text-gray-500">Start building your inventory by adding your first product.</p>
                    <Button variant="outline" onClick={() => openModal()} className="h-8 rounded-md text-[11px] font-semibold mt-2">
                        Add First Product
                    </Button>
                </div>
            ) : (
                <div className={cn(
                    "grid gap-2.5",
                    viewMode === 'grid' ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1"
                )}>
                    {filteredProducts?.map((product) => {
                        const inv = productInventoryTotals(product);
                        return viewMode === 'grid' ? (
                            <div
                                key={product.id}
                                className="rounded-xl border border-gray-100 bg-white overflow-hidden group relative"
                            >
                                <ImageHoverPreview imageUrl={product.image_url} name={product.name} code={product.code}>
                                <div className="relative aspect-square overflow-hidden bg-brand-navy/[0.02]">
                                    {product.image_url ? (
                                        <img
                                            src={product.image_url}
                                            alt={product.name}
                                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                        />
                                    ) : (
                                        <div className="flex items-center justify-center h-full w-full text-brand-navy/10">
                                            <ImageIcon className="w-10 h-10" />
                                        </div>
                                    )}
                                    <div className="absolute top-2 left-2 z-20">
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="icon"
                                            title="Preview"
                                            onClick={() => setPreviewProduct(product)}
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
                                                <DropdownMenuItem onClick={() => setPreviewProduct(product)} className="gap-2 text-[11px]">
                                                    <Eye className="w-3.5 h-3.5" />Preview
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => openModal(product)} className="gap-2 text-[11px]">
                                                    <Edit2 className="w-3.5 h-3.5" />Edit Product
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => setProductToResetStock(product)} className="gap-2 text-[11px]">
                                                    <RotateCcw className="w-3.5 h-3.5" />Clear Stock (0)
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onClick={() => toggleProductActiveMutation.mutate({ id: product.id, active: !product.active })}
                                                    disabled={toggleProductActiveMutation.isPending}
                                                    className="gap-2 text-[11px]"
                                                >
                                                    <Power className="w-3.5 h-3.5" />{product.active ? 'Deactivate' : 'Activate'}
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem onClick={() => setProductToDelete(product)} className="gap-2 text-[11px] text-red-500 focus:text-red-600">
                                                    <Trash2 className="w-3.5 h-3.5" />Delete
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                    {!product.active && (
                                        <div className="absolute inset-0 z-[1] pointer-events-none bg-brand-navy/40 backdrop-blur-[2px] flex items-center justify-center">
                                            <Badge variant="secondary" className="text-[9px] px-2 py-0.5">INACTIVE</Badge>
                                        </div>
                                    )}
                                    <div className="absolute bottom-2 right-2 z-20">
                                        <Button
                                            type="button"
                                            size="sm"
                                            title="Create order with this product"
                                            onClick={() => navigate(`/orders?addProductId=${product.id}`)}
                                            className="h-7 rounded-md bg-brand-navy text-white hover:bg-brand-navy/90 px-2 gap-1 text-[10px] font-semibold"
                                        >
                                            <ShoppingCart className="w-3 h-3" />
                                            New order
                                        </Button>
                                    </div>
                                </div>
                                </ImageHoverPreview>

                                <div className="p-3 space-y-2">
                                    <div>
                                        <TruncatedText as="p" text={product.code} className="text-[9px] font-semibold uppercase tracking-widest text-brand-navy/40 truncate" />
                                        <TruncatedText as="h3" text={product.name} className="text-[12px] font-semibold text-brand-navy leading-snug line-clamp-2 break-words" />
                                        {product.label && product.label.toLowerCase() !== 'regular' && (
                                            <TruncatedText as="span" text={product.label} className="inline-block truncate rounded-full bg-brand-navy/[0.05] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-brand-navy/55 mt-0.5" />
                                        )}
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-[9px] text-gray-400 uppercase tracking-[0.14em]">Cost / Sell</p>
                                            <p className="text-[11px] font-semibold text-brand-navy tabular-nums">{product.cost_price} / {product.selling_price} DH</p>
                                        </div>
                                        <Badge
                                            className={cn(
                                                "h-5 px-1.5 text-[9px] border-none",
                                                (product.stock || 0) > 10
                                                    ? "bg-emerald-50 text-emerald-700"
                                                    : (product.stock || 0) > 0
                                                    ? "bg-amber-50 text-amber-700"
                                                    : "bg-red-50 text-red-600"
                                            )}
                                        >
                                            {product.stock || 0} in stock
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div key={product.id} className="rounded-xl border border-gray-100 bg-white flex flex-col sm:flex-row items-center p-3 gap-3 hover:bg-gray-50 transition-colors group">
                                <ImageHoverPreview imageUrl={product.image_url} name={product.name} code={product.code}>
                                <div className="relative h-14 w-14 shrink-0 rounded-lg overflow-hidden bg-brand-navy/[0.02]">
                                    {product.image_url ? (
                                        <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
                                    ) : (
                                        <div className="flex items-center justify-center h-full w-full text-brand-navy/10">
                                            <ImageIcon className="w-6 h-6" />
                                        </div>
                                    )}
                                    {!product.active && (
                                        <div className="absolute inset-0 bg-brand-navy/40 backdrop-blur-[2px] flex items-center justify-center">
                                            <span className="text-[8px] font-semibold text-white">OFF</span>
                                        </div>
                                    )}
                                </div>
                                </ImageHoverPreview>

                                <div className="flex-1 min-w-0 space-y-0.5 w-full">
                                    <div className="flex items-start gap-2 flex-wrap">
                                        <TruncatedText as="h3" text={product.name} className="text-[12px] font-semibold text-brand-navy leading-snug min-w-0 flex-1" />
                                        <Badge
                                            className={cn(
                                                "h-5 px-1.5 text-[9px] border-none shrink-0",
                                                (product.stock || 0) > 10
                                                    ? "bg-emerald-50 text-emerald-700"
                                                    : (product.stock || 0) > 0
                                                    ? "bg-amber-50 text-amber-700"
                                                    : "bg-red-50 text-red-600"
                                            )}
                                        >
                                            {product.stock || 0} in stock
                                        </Badge>
                                        {!product.active && <Badge variant="secondary" className="h-5 px-1.5 text-[9px]">Inactive</Badge>}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                                        <span className="text-[10px] text-gray-400 font-mono">{product.code}</span>
                                        <span className="text-[10px] text-brand-navy/80 tabular-nums">Cost {product.cost_price} DH</span>
                                        <span className="text-[10px] text-brand-navy tabular-nums font-semibold">Sell {product.selling_price} DH</span>
                                        <span className="text-[10px] text-brand-navy/70 tabular-nums">Inv. cost {formatProductDhAggregate(inv.totalCost)}</span>
                                        <span className="text-[10px] text-emerald-700 tabular-nums font-semibold">Value {formatProductDhAggregate(inv.totalValue)}</span>
                                    </div>
                                </div>

                                <div className="shrink-0 flex items-center gap-1 mt-2 sm:mt-0 w-full sm:w-auto justify-end">
                                    <Button
                                        type="button"
                                        size="icon"
                                        title="Create order with this product"
                                        onClick={() => navigate(`/orders?addProductId=${product.id}`)}
                                        className="h-8 w-8 rounded-md bg-brand-navy text-white hover:bg-brand-navy/90"
                                    >
                                        <ShoppingCart className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        title="Preview"
                                        onClick={() => setPreviewProduct(product)}
                                        className="h-8 w-8 rounded-md text-brand-navy hover:bg-brand-navy/[0.06]"
                                    >
                                        <Eye className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setProductToResetStock(product)}
                                        title="Clear Stock (0)"
                                        className="h-8 w-8 rounded-md text-brand-navy hover:bg-brand-navy/[0.06]">
                                        <RotateCcw className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => toggleProductActiveMutation.mutate({ id: product.id, active: !product.active })}
                                        disabled={toggleProductActiveMutation.isPending}
                                        title={product.active ? 'Deactivate' : 'Activate'}
                                        className="h-8 w-8 rounded-md text-brand-navy hover:bg-brand-navy/[0.06]"
                                    >
                                        <Power className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" onClick={() => openModal(product)} className="h-8 w-8 rounded-md text-brand-navy hover:bg-brand-navy/[0.06]">
                                        <Edit2 className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" onClick={() => setProductToDelete(product)} className="h-8 w-8 rounded-md text-red-500 hover:bg-red-50">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <ProductPreviewDialog
                open={!!previewProduct}
                onOpenChange={(open) => !open && setPreviewProduct(null)}
                product={previewProduct}
                variant="admin"
                adminActions={
                    previewProduct
                        ? {
                              onEdit: () => openModal(previewProduct),
                              onClearStock: () => setProductToResetStock(previewProduct),
                              onToggleActive: () =>
                                  toggleProductActiveMutation.mutate({
                                      id: previewProduct.id,
                                      active: !previewProduct.active,
                                  }),
                              onDelete: () => setProductToDelete(previewProduct),
                              toggleActivePending: toggleProductActiveMutation.isPending,
                          }
                        : undefined
                }
            />

            {/* Upsert Modal */}
            <Dialog open={isModalOpen} onOpenChange={(open) => {
                if (!open && !upsertProductMutation.isPending) {
                    setIsModalOpen(false);
                    setEditingProduct(null);
                }
            }}>
                <DialogContent className="max-w-2xl p-0 overflow-hidden flex flex-col max-h-[90vh]">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
                            <DialogHeader className="p-6 pb-3 shrink-0 border-b border-gray-100">
                                <DialogTitle className="text-[15px] font-semibold text-brand-navy">
                                    {editingProduct ? 'Edit Product' : 'Add New Product'}
                                </DialogTitle>
                                <DialogDescription className="text-[11px] text-gray-500">
                                    Fill in the details below to {editingProduct ? 'update' : 'publish'} this product.
                                </DialogDescription>
                            </DialogHeader>

                            <div className="overflow-y-auto p-6 space-y-5 flex-1 min-h-0 custom-scrollbar">
                                {/* Image Upload & Basic Info Grid */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                                    {/* Image Upload Area */}
                                    <div className="md:col-span-1 space-y-2">
                                        <FormLabel className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Product Image</FormLabel>
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
                                                        <FormLabel className="text-[10px] font-semibold uppercase tracking-wider">Product Name</FormLabel>
                                                    </div>
                                                    <FormControl>
                                                        <Input placeholder="E.g. Wireless Headphones" {...field} className="h-9 rounded-md text-[12px]" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <div className="grid grid-cols-2 gap-3">
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
                                                            <Input placeholder="PROD-001" {...field} className="h-9 rounded-md text-[12px]" />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={form.control}
                                                name="label"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Short Label</FormLabel>
                                                        <FormControl>
                                                            <Input placeholder="Best Seller" {...field} className="h-9 rounded-md text-[12px]" />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* pricing and description */}
                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <FormField
                                            control={form.control}
                                            name="cost_price"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Cost Price (DH)</FormLabel>
                                                    <FormControl>
                                                        <Input type="number" step="0.01" {...field} className="h-9 rounded-md text-[12px]" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="selling_price"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <div className="flex items-center justify-between">
                                                        <FormLabel className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Selling Price (DH)</FormLabel>
                                                        {form.watch('cost_price') > 0 && form.watch('selling_price') > 0 && (
                                                            <Badge className="bg-emerald-50 text-emerald-600 border-none text-[9px] h-4 px-1.5">
                                                                {((form.watch('selling_price') - form.watch('cost_price')) / form.watch('selling_price') * 100).toFixed(0)}% margin
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <FormControl>
                                                        <Input type="number" step="0.01" {...field} className="h-9 rounded-md text-[12px]" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>

                                    <FormField
                                        control={form.control}
                                        name="description"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Description</FormLabel>
                                                <FormControl>
                                                    <Textarea
                                                        placeholder="Detailed product specifications, notes, and information..."
                                                        className="min-h-[80px] rounded-md text-[12px] resize-none"
                                                        {...field}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="active"
                                        render={({ field }) => (
                                            <FormItem className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-gray-50/50">
                                                <div className="space-y-0.5">
                                                    <FormLabel className="text-[12px] font-semibold text-brand-navy">Active Status</FormLabel>
                                                    <FormDescription className="text-[10px]">Toggle off to hide this product from sales channels.</FormDescription>
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
                            </div>

                            <DialogFooter className="p-4 shrink-0 border-t border-gray-100 gap-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                        setIsModalOpen(false);
                                        setEditingProduct(null);
                                    }}
                                    className="h-8 rounded-md text-[11px] font-semibold"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={upsertProductMutation.isPending || isUploading}
                                    className="h-8 rounded-md text-[11px] font-semibold gap-1.5"
                                >
                                    {(upsertProductMutation.isPending || isUploading) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                    {editingProduct ? 'Update Product' : 'Publish Product'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={!!productToDelete} onOpenChange={() => setProductToDelete(null)}>
                <AlertDialogContent className="max-w-sm rounded-xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[15px] font-semibold text-brand-navy">Permanently Delete?</AlertDialogTitle>
                        <AlertDialogDescription className="text-[11px] text-gray-500">
                            You are about to remove <span className="font-semibold text-brand-navy">"{productToDelete?.name}"</span>. This action cannot be reversed.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="gap-2">
                        <AlertDialogCancel className="h-8 rounded-md text-[11px] font-semibold">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => deleteProductMutation.mutate(productToDelete.id)}
                            className="h-8 rounded-md text-[11px] font-semibold bg-red-500 hover:bg-red-600 text-white gap-1.5"
                        >
                            {deleteProductMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            Confirm Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Reset Stock Confirmation */}
            <AlertDialog open={!!productToResetStock} onOpenChange={() => setProductToResetStock(null)}>
                <AlertDialogContent className="max-w-sm rounded-xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[15px] font-semibold text-brand-navy">Clear Stock?</AlertDialogTitle>
                        <AlertDialogDescription className="text-[11px] text-gray-500">
                            This will reset stock for <span className="font-semibold text-brand-navy">"{productToResetStock?.name}"</span> to 0.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="gap-2">
                        <AlertDialogCancel className="h-8 rounded-md text-[11px] font-semibold">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => productToResetStock && updateStockMutation.mutate({ id: productToResetStock.id, stock: 0 })}
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

export default Products;
