import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
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
    Upload,
    Sparkles,
    TrendingUp,
    type LucideIcon,
} from 'lucide-react';
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
import { compressImage, validateImageFile } from '@/lib/imageCompress';
import { imageUrl } from '@/lib/imageUrl';
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
import { Skeleton } from "@/components/ui/skeleton";
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

type ProductRow = {
    id: string;
    name: string;
    code: string;
    label: string | null;
    description: string | null;
    cost_price: number;
    selling_price: number;
    stock: number | null;
    active: boolean | null;
    image_url: string | null;
    created_at: string;
};

type CatalogTotalsPayload = {
    products: {
        count: number;
        active_count: number;
        stock_sum: number;
        inventory_cost: number;
        inventory_value: number;
        low_stock_count: number;
    };
    accessories: {
        count: number;
        active_count: number;
        stock_sum: number;
        inventory_cost: number;
        low_stock_count: number;
    };
};

const PRODUCT_KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

interface ProductKpiProps {
    label: string;
    value: string;
    suffix: string;
    accent: keyof typeof PRODUCT_KPI_ACCENTS;
    icon: LucideIcon;
}

const ProductKpi: React.FC<ProductKpiProps> = ({ label, value, suffix, accent, icon: Icon }) => {
    const a = PRODUCT_KPI_ACCENTS[accent];
    return (
        <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                    <span className={cn('h-1.5 w-1.5 rounded-full', a.dot)} />
                    {label}
                </div>
                <div className={cn('h-8 w-8 rounded-lg border flex items-center justify-center', a.tile)}>
                    <Icon className="w-4 h-4" strokeWidth={1.75} />
                </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                {value}
                <span className="text-[12px] text-ant-mid font-normal ml-1.5">{suffix}</span>
            </p>
        </div>
    );
};

const stockPill = (stock: number) => {
    if (stock > 10) return { dot: 'bg-ant-green', text: 'text-ant-green', bg: 'bg-ant-green/10', border: 'border-ant-green/25', label: `${stock} in stock` };
    if (stock > 0) return { dot: 'bg-ant-orange', text: 'text-ant-orange', bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', label: `${stock} left` };
    return { dot: 'bg-ant-rose', text: 'text-ant-rose', bg: 'bg-ant-rose/10', border: 'border-ant-rose/25', label: 'Out of stock' };
};

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

    const { data: products, isLoading } = useQuery({
        queryKey: ['products', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            // fetchAllRows paginates past the PostgREST 1000-row cap; stable `id`
            // ordering keeps pages consistent, then sort newest-first for display.
            const rows = await fetchAllRows<ProductRow>(
                'products',
                'id, name, code, label, description, cost_price, selling_price, stock, active, image_url, created_at',
                { filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId }] }
            );
            return rows.sort((a, b) =>
                b.created_at === a.created_at
                    ? b.id.localeCompare(a.id)
                    : b.created_at.localeCompare(a.created_at)
            );
        },
        // P5: freshness rides mutations + the ecom:biz 'stock' broadcast (which
        // invalidates this key) — the old staleTime-0 default re-downloaded the
        // whole catalog on every tab focus per admin.
        staleTime: 5 * 60 * 1000,
    });

    const { data: catalogTotalsData, isLoading: isTotalsLoading } = useQuery({
        queryKey: ['catalog-totals', activeBusinessId],
        queryFn: async () => {
            const { data, error } = await (supabase as any).rpc('catalog_totals', {
                p_business: activeBusinessId,
            });
            if (error) throw error;
            return data as CatalogTotalsPayload;
        },
        enabled: !!activeBusinessId,
        // P5: same policy as the list — mutations + 'stock' broadcast invalidate.
        staleTime: 5 * 60 * 1000,
    });

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
            queryClient.invalidateQueries({ queryKey: ['catalog-totals', activeBusinessId] });
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
            queryClient.invalidateQueries({ queryKey: ['catalog-totals', activeBusinessId] });
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
            queryClient.invalidateQueries({ queryKey: ['catalog-totals', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['products-dropdown', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['products-user-modal', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['products-minimal', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['products-import-match'] }); // IW-1 matcher key
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
            queryClient.invalidateQueries({ queryKey: ['catalog-totals', activeBusinessId] });
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

        const problem = validateImageFile(file);
        if (problem) {
            toast({ title: 'Fichier refusé', description: problem, variant: 'destructive' });
            return;
        }

        if (!activeBusinessId) {
            toast({ title: 'Upload failed', description: 'No active business selected.', variant: 'destructive' });
            return;
        }

        setIsUploading(true);
        try {
            const { blob, contentType, ext } = await compressImage(file, 'product');
            const fileName = `${Math.random().toString(36).substring(2)}.${ext}`;
            // Tenant-scoped path: the storage policies key on the FIRST segment being
            // the caller's business id, so an admin of one business can no longer
            // overwrite or delete another business's product images.
            const filePath = `${activeBusinessId}/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('products')
                .upload(filePath, blob, { contentType });

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('products')
                .getPublicUrl(filePath);

            form.setValue('image_url', publicUrl);
            toast({ title: "Image uploaded", description: "Product image has been updated." });
        } catch (error: any) {
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

    // Server-side aggregates (catalog_totals RPC) — never a client reduce()
    // over a PostgREST-capped row set, so the money KPIs stay exact.
    const catalogTotals = useMemo(() => {
        const t = catalogTotalsData?.products;
        return {
            count: Number(t?.count ?? 0),
            totalQuantity: Number(t?.stock_sum ?? 0),
            totalCost: Number(t?.inventory_cost ?? 0),
            totalValue: Number(t?.inventory_value ?? 0),
            activeCount: Number(t?.active_count ?? 0),
        };
    }, [catalogTotalsData]);

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

    const watchedCost = form.watch('cost_price');
    const watchedSell = form.watch('selling_price');
    const margin = watchedSell > 0 ? ((watchedSell - watchedCost) / watchedSell) * 100 : 0;

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Catalog · Inventory
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Products
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            The heart of the shop — every item, every price, every unit. Keep the catalog honest; the rest of the business follows.
                        </p>
                    </div>
                    <Button
                        onClick={() => openModal()}
                        className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 shrink-0 cursor-pointer"
                    >
                        <Plus className="w-4 h-4" />
                        New product
                    </Button>
                </header>

                {/* KPI strip */}
                {isLoading || isTotalsLoading ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="bg-ant-paper p-4"><Skeleton className="h-12 rounded-lg" /></div>
                        ))}
                    </div>
                ) : (
                    <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        <ProductKpi
                            label="Products"
                            value={String(catalogTotals.count)}
                            suffix={`${catalogTotals.activeCount} active`}
                            accent="ink"
                            icon={Package}
                        />
                        <ProductKpi
                            label="Units in stock"
                            value={new Intl.NumberFormat('fr-FR').format(catalogTotals.totalQuantity)}
                            suffix="units"
                            accent="orange"
                            icon={Layers}
                        />
                        <ProductKpi
                            label="Inventory cost"
                            value={formatProductDhAggregate(catalogTotals.totalCost)}
                            suffix=""
                            accent="rose"
                            icon={Coins}
                        />
                        <ProductKpi
                            label="Inventory value"
                            value={formatProductDhAggregate(catalogTotals.totalValue)}
                            suffix=""
                            accent="green"
                            icon={TrendingUp}
                        />
                    </section>
                )}

                {/* Low stock banner */}
                {lowStockProducts.length > 0 && (
                    <section className="overflow-hidden rounded-2xl border border-ant-rose/25 bg-ant-paper">
                        <div className="h-[3px] w-full bg-ant-rose" />
                        <button
                            type="button"
                            onClick={() => setLowStockListExpanded((v) => !v)}
                            className="w-full flex items-center justify-between gap-4 px-5 py-4 hover:bg-ant-rose/5 transition-colors text-left cursor-pointer"
                        >
                            <div className="flex items-center gap-3">
                                <div className="h-9 w-9 rounded-xl bg-ant-rose/10 border border-ant-rose/25 flex items-center justify-center">
                                    <AlertTriangle className="w-4 h-4 text-ant-rose" strokeWidth={1.75} />
                                </div>
                                <div>
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-rose">
                                        Low stock alert
                                    </div>
                                    <p className="font-display text-[15px] text-ant-ink mt-0.5">
                                        {lowStockProducts.length} item{lowStockProducts.length === 1 ? '' : 's'} running low
                                        <span className="text-ant-mid font-normal text-[12px] ml-2 font-sans tabular-nums">· {lowStockProductsTotalUnits} unit{lowStockProductsTotalUnits === 1 ? '' : 's'} remaining</span>
                                    </p>
                                </div>
                            </div>
                            <div className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-paper px-3 h-7 text-[11px] font-semibold text-ant-mid">
                                {lowStockListExpanded ? 'Hide' : 'Review'}
                                {lowStockListExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </div>
                        </button>
                        {lowStockListExpanded && (
                            <div className="border-t border-ant-line overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-ant-line bg-ant-light/50">
                                            <th className="text-left px-5 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Product</th>
                                            <th className="text-left px-4 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Code</th>
                                            <th className="text-right px-4 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Stock</th>
                                            <th className="text-right px-4 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Unit cost</th>
                                            <th className="text-right px-5 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">At risk</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {lowStockProducts.map((p) => {
                                            const stock = Number(p.stock ?? 0);
                                            const cost = Number(p.cost_price ?? 0);
                                            const tone = stock === 0 ? 'text-ant-rose' : stock <= 2 ? 'text-ant-rose' : 'text-ant-orange';
                                            return (
                                                <tr
                                                    key={p.id}
                                                    onClick={() => setPreviewProduct(p)}
                                                    className="border-b border-ant-line last:border-0 hover:bg-ant-light/60 transition-colors cursor-pointer"
                                                >
                                                    <td className="px-5 py-3 text-[12px] text-ant-ink">
                                                        <div className="flex items-center gap-2.5">
                                                            {p.image_url ? (
                                                                <img src={imageUrl(p.image_url, 'thumb')} alt={p.name} className="w-8 h-8 rounded-lg object-cover border border-ant-line shrink-0" />
                                                            ) : (
                                                                <div className="w-8 h-8 rounded-lg bg-ant-ink/5 border border-ant-line flex items-center justify-center shrink-0">
                                                                    <Package className="w-3.5 h-3.5 text-ant-mid" />
                                                                </div>
                                                            )}
                                                            <TruncatedText as="span" text={p.name} className="font-semibold truncate" />
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-[11px] text-ant-mid tabular-nums truncate">{p.code}</td>
                                                    <td className={cn('px-4 py-3 text-right text-[12px] font-semibold tabular-nums', tone)}>
                                                        {stock} left
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-[12px] text-ant-ink tabular-nums">
                                                        {cost.toLocaleString('fr-MA')} <span className="text-[10px] text-ant-mid">DH</span>
                                                    </td>
                                                    <td className="px-5 py-3 text-right text-[12px] font-semibold text-ant-ink tabular-nums">
                                                        {(stock * cost).toLocaleString('fr-MA')} <span className="text-[10px] text-ant-mid font-normal">DH</span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>
                )}

                {/* Toolbar */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper">
                        <button
                            onClick={() => setViewMode('list')}
                            className={cn('inline-flex items-center gap-1.5 rounded-full px-3.5 h-8 text-[11px] font-semibold transition cursor-pointer', viewMode === 'list' ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink')}
                        >
                            <List className="w-3 h-3" /> List
                        </button>
                        <button
                            onClick={() => setViewMode('grid')}
                            className={cn('inline-flex items-center gap-1.5 rounded-full px-3.5 h-8 text-[11px] font-semibold transition cursor-pointer', viewMode === 'grid' ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink')}
                        >
                            <LayoutGrid className="w-3 h-3" /> Grid
                        </button>
                        <span className="ml-1 mr-2 text-[11px] text-ant-mid tabular-nums">
                            <span className="text-ant-ink font-semibold">{filteredProducts.length}</span> shown
                        </span>
                    </div>

                    <div className="relative flex-1 md:max-w-[360px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                        <Input
                            placeholder="Search name, code, label, price or stock..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 h-9 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                        />
                    </div>
                </div>

                {/* Content */}
                {isLoading ? (
                    <div className={cn(
                        'grid gap-3',
                        viewMode === 'grid' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1'
                    )}>
                        {Array.from({ length: 8 }).map((_, i) => (
                            viewMode === 'grid' ? (
                                <Skeleton key={i} className="h-56 rounded-2xl" />
                            ) : (
                                <Skeleton key={i} className="h-20 rounded-2xl" />
                            )
                        ))}
                    </div>
                ) : filteredProducts?.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                        <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                            <Package className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                        </div>
                        <h3 className="font-display text-[18px] text-ant-ink tracking-tight">
                            {products?.length ? 'Nothing matches that search' : 'Your catalog is empty'}
                        </h3>
                        <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                            {products?.length ? 'Loosen the search or clear it to bring the catalog back into view.' : 'Start with the product that moves the most — cost, price, and an image is all it takes.'}
                        </p>
                        {!products?.length && (
                            <Button
                                onClick={() => openModal()}
                                className="mt-5 bg-ant-ink hover:bg-ant-ink/90 text-white h-9 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                            >
                                <Plus className="w-4 h-4" />
                                Add your first product
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className={cn(
                        'grid gap-3',
                        viewMode === 'grid' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1'
                    )}>
                        {filteredProducts?.map((product) => {
                            const inv = productInventoryTotals(product);
                            const stock = Number(product.stock ?? 0);
                            const pill = stockPill(stock);
                            const stripeColor = !product.active ? 'bg-ant-line' : stock === 0 ? 'bg-ant-rose' : stock <= 10 ? 'bg-ant-orange' : 'bg-ant-green';

                            if (viewMode === 'grid') {
                                return (
                                    <div
                                        key={product.id}
                                        className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper group transition-all hover:border-ant-ink/20 hover:shadow-[0_16px_48px_-20px_rgba(20,20,19,0.18)]"
                                    >
                                        <div className={cn('h-[3px] w-full', stripeColor)} />
                                        <ImageHoverPreview imageUrl={product.image_url} name={product.name} code={product.code}>
                                            <div className="relative aspect-[4/3] overflow-hidden bg-ant-light">
                                                {product.image_url ? (
                                                    <img
                                                        src={imageUrl(product.image_url, 'card')}
                                                        alt={product.name}
                                                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                                                    />
                                                ) : (
                                                    <div className="flex items-center justify-center h-full w-full text-ant-mid/40">
                                                        <ImageIcon className="w-10 h-10" strokeWidth={1.25} />
                                                    </div>
                                                )}

                                                {/* top-left: preview */}
                                                <div className="absolute top-2.5 left-2.5 z-20">
                                                    <Button
                                                        type="button"
                                                        variant="secondary"
                                                        size="icon"
                                                        title="Preview"
                                                        onClick={() => setPreviewProduct(product)}
                                                        className="h-8 w-8 rounded-full bg-ant-paper border border-ant-line text-ant-ink hover:bg-white shadow-sm cursor-pointer"
                                                    >
                                                        <Eye className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>

                                                {/* top-right: menu */}
                                                <div className="absolute top-2.5 right-2.5 z-20">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="secondary" size="icon" className="h-8 w-8 rounded-full bg-ant-paper border border-ant-line text-ant-ink hover:bg-white shadow-sm cursor-pointer">
                                                                <MoreVertical className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end" className="min-w-[180px] rounded-xl border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)] p-1">
                                                            <DropdownMenuItem onClick={() => setPreviewProduct(product)} className="rounded-lg px-3 py-2 gap-2 text-[12px] font-medium text-ant-ink cursor-pointer">
                                                                <Eye className="w-3.5 h-3.5" />Preview
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => openModal(product)} className="rounded-lg px-3 py-2 gap-2 text-[12px] font-medium text-ant-ink cursor-pointer">
                                                                <Edit2 className="w-3.5 h-3.5" />Edit product
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => setProductToResetStock(product)} className="rounded-lg px-3 py-2 gap-2 text-[12px] font-medium text-ant-ink cursor-pointer">
                                                                <RotateCcw className="w-3.5 h-3.5" />Clear stock (0)
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                onClick={() => toggleProductActiveMutation.mutate({ id: product.id, active: !product.active })}
                                                                disabled={toggleProductActiveMutation.isPending}
                                                                className="rounded-lg px-3 py-2 gap-2 text-[12px] font-medium text-ant-ink cursor-pointer"
                                                            >
                                                                <Power className="w-3.5 h-3.5" />{product.active ? 'Deactivate' : 'Activate'}
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator className="bg-ant-line" />
                                                            <DropdownMenuItem onClick={() => setProductToDelete(product)} className="rounded-lg px-3 py-2 gap-2 text-[12px] font-medium text-ant-rose focus:text-ant-rose focus:bg-ant-rose/10 cursor-pointer">
                                                                <Trash2 className="w-3.5 h-3.5" />Delete
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>

                                                {!product.active && (
                                                    <div className="absolute inset-0 z-[1] pointer-events-none bg-ant-ink/40 backdrop-blur-[2px] flex items-center justify-center">
                                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-ant-paper border border-ant-line px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-ant-ink">
                                                            <span className="h-1.5 w-1.5 rounded-full bg-ant-mid" /> Inactive
                                                        </span>
                                                    </div>
                                                )}

                                                <div className="absolute bottom-2.5 right-2.5 z-20">
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        title="Create order with this product"
                                                        onClick={() => navigate(`/orders?addProductId=${product.id}`)}
                                                        className="h-8 rounded-full bg-ant-ink text-white hover:bg-ant-ink/90 px-3 gap-1.5 text-[11px] font-semibold cursor-pointer"
                                                    >
                                                        <ShoppingCart className="w-3 h-3" />
                                                        Sell
                                                    </Button>
                                                </div>
                                            </div>
                                        </ImageHoverPreview>

                                        <div className="p-4 space-y-3">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <TruncatedText as="span" text={product.code} className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid tabular-nums truncate" />
                                                    {product.label && product.label.toLowerCase() !== 'regular' && (
                                                        <TruncatedText as="span" text={product.label} className="inline-block truncate rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-ant-mid" />
                                                    )}
                                                </div>
                                                <TruncatedText as="h3" text={product.name} className="font-display text-[14px] font-semibold text-ant-ink leading-snug line-clamp-2" />
                                            </div>

                                            <div className="flex items-end justify-between pt-2 border-t border-ant-line">
                                                <div>
                                                    <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Sell</p>
                                                    <p className="font-display text-[18px] font-semibold text-ant-ink tabular-nums">
                                                        {product.selling_price}
                                                        <span className="text-[11px] text-ant-mid font-normal ml-1">DH</span>
                                                    </p>
                                                    <p className="text-[10px] text-ant-mid tabular-nums">Cost {product.cost_price} DH</p>
                                                </div>
                                                <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums', pill.bg, pill.border, pill.text)}>
                                                    <span className={cn('h-1.5 w-1.5 rounded-full', pill.dot)} />
                                                    {pill.label}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            }

                            // LIST view
                            return (
                                <div
                                    key={product.id}
                                    className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper hover:border-ant-ink/20 transition-colors"
                                >
                                    <div className={cn('h-[3px] w-full', stripeColor)} />
                                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4">
                                        <ImageHoverPreview imageUrl={product.image_url} name={product.name} code={product.code}>
                                            <div className="relative h-16 w-16 shrink-0 rounded-xl overflow-hidden bg-ant-light border border-ant-line">
                                                {product.image_url ? (
                                                    <img src={imageUrl(product.image_url, 'thumb')} alt={product.name} className="h-full w-full object-cover" />
                                                ) : (
                                                    <div className="flex items-center justify-center h-full w-full text-ant-mid/40">
                                                        <ImageIcon className="w-6 h-6" strokeWidth={1.25} />
                                                    </div>
                                                )}
                                                {!product.active && (
                                                    <div className="absolute inset-0 bg-ant-ink/45 backdrop-blur-[2px] flex items-center justify-center">
                                                        <span className="text-[8px] font-semibold text-white uppercase tracking-[0.2em]">Off</span>
                                                    </div>
                                                )}
                                            </div>
                                        </ImageHoverPreview>

                                        <div className="flex-1 min-w-0 space-y-1.5 w-full">
                                            <div className="flex items-start gap-2 flex-wrap">
                                                <TruncatedText as="h3" text={product.name} className="font-display text-[15px] font-semibold text-ant-ink leading-snug min-w-0 flex-1" />
                                                <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums shrink-0', pill.bg, pill.border, pill.text)}>
                                                    <span className={cn('h-1.5 w-1.5 rounded-full', pill.dot)} />
                                                    {pill.label}
                                                </span>
                                                {!product.active && (
                                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-mid">
                                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-mid" /> Inactive
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                                                <span className="text-ant-mid tabular-nums">{product.code}</span>
                                                <span className="text-ant-mid">Cost <span className="text-ant-ink font-semibold tabular-nums ml-0.5">{product.cost_price}</span> DH</span>
                                                <span className="text-ant-mid">Sell <span className="text-ant-ink font-semibold tabular-nums ml-0.5">{product.selling_price}</span> DH</span>
                                                <span className="text-ant-mid">Inv cost <span className="text-ant-ink tabular-nums ml-0.5">{formatProductDhAggregate(inv.totalCost)}</span></span>
                                                <span className="text-ant-mid">Inv value <span className="text-ant-green font-semibold tabular-nums ml-0.5">{formatProductDhAggregate(inv.totalValue)}</span></span>
                                            </div>
                                        </div>

                                        <div className="shrink-0 flex items-center gap-1 w-full sm:w-auto justify-end">
                                            <Button
                                                type="button"
                                                title="Create order"
                                                onClick={() => navigate(`/orders?addProductId=${product.id}`)}
                                                className="h-9 rounded-full bg-ant-ink text-white hover:bg-ant-ink/90 px-3.5 gap-1.5 text-[11px] font-semibold cursor-pointer"
                                            >
                                                <ShoppingCart className="w-3.5 h-3.5" />
                                                Sell
                                            </Button>
                                            <Button variant="ghost" size="icon" title="Preview" onClick={() => setPreviewProduct(product)} className="h-9 w-9 rounded-full hover:bg-ant-ink/5 cursor-pointer">
                                                <Eye className="w-3.5 h-3.5 text-ant-ink" />
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => openModal(product)} title="Edit" className="h-9 w-9 rounded-full hover:bg-ant-orange/10 cursor-pointer">
                                                <Edit2 className="w-3.5 h-3.5 text-ant-orange" />
                                            </Button>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-ant-ink/5 cursor-pointer">
                                                        <MoreVertical className="w-3.5 h-3.5 text-ant-mid" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="min-w-[180px] rounded-xl border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)] p-1">
                                                    <DropdownMenuItem onClick={() => setProductToResetStock(product)} className="rounded-lg px-3 py-2 gap-2 text-[12px] font-medium text-ant-ink cursor-pointer">
                                                        <RotateCcw className="w-3.5 h-3.5" />Clear stock (0)
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() => toggleProductActiveMutation.mutate({ id: product.id, active: !product.active })}
                                                        disabled={toggleProductActiveMutation.isPending}
                                                        className="rounded-lg px-3 py-2 gap-2 text-[12px] font-medium text-ant-ink cursor-pointer"
                                                    >
                                                        <Power className="w-3.5 h-3.5" />{product.active ? 'Deactivate' : 'Activate'}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator className="bg-ant-line" />
                                                    <DropdownMenuItem onClick={() => setProductToDelete(product)} className="rounded-lg px-3 py-2 gap-2 text-[12px] font-medium text-ant-rose focus:text-ant-rose focus:bg-ant-rose/10 cursor-pointer">
                                                        <Trash2 className="w-3.5 h-3.5" />Delete
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
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
                    <DialogContent className="max-w-3xl p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden flex flex-col max-h-[92vh]">
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
                                <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b border-ant-line space-y-1.5">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                        {editingProduct ? 'Edit · Catalog' : 'New · Catalog'}
                                    </div>
                                    <DialogTitle className="font-display text-[22px] leading-tight tracking-tight text-ant-ink">
                                        {editingProduct ? `Editing ${editingProduct.name}` : 'Add a new product'}
                                    </DialogTitle>
                                    <DialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                        {editingProduct
                                            ? 'Refine the details — the catalog and every seller sees the change instantly.'
                                            : 'A name, a price, an image. That is all it takes to start selling.'}
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="ant-scroll overflow-y-auto p-6 space-y-6 flex-1 min-h-0">
                                    {/* Section 01: Media + Identity */}
                                    <section className="space-y-3">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <span className="font-display text-ant-orange font-semibold">01</span>
                                            Image &amp; identity
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-[200px,1fr] gap-5">
                                            {/* Image */}
                                            <div className="space-y-1.5">
                                                <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Product image</FormLabel>
                                                <div
                                                    onClick={() => !isUploading && fileInputRef.current?.click()}
                                                    className={cn(
                                                        'relative aspect-square rounded-2xl cursor-pointer transition-all flex flex-col items-center justify-center gap-2 overflow-hidden group border',
                                                        form.watch('image_url')
                                                            ? 'border-ant-line hover:border-ant-ink/30'
                                                            : 'border-dashed border-ant-line bg-ant-light hover:bg-ant-light/60 hover:border-ant-ink/20'
                                                    )}
                                                >
                                                    {form.watch('image_url') ? (
                                                        <>
                                                            <img src={imageUrl(form.getValues('image_url'), 'card')} className="w-full h-full object-cover" alt="Preview" />
                                                            <div className="absolute inset-0 bg-ant-ink/55 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                                <span className="inline-flex items-center gap-1.5 rounded-full bg-ant-paper px-3 py-1 text-[11px] font-semibold text-ant-ink">
                                                                    <Upload className="w-3 h-3" /> Replace
                                                                </span>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <div className="h-10 w-10 rounded-xl bg-ant-paper border border-ant-line flex items-center justify-center">
                                                                <ImageIcon className="w-5 h-5 text-ant-mid" strokeWidth={1.5} />
                                                            </div>
                                                            <p className="text-[10px] font-semibold text-ant-mid uppercase tracking-[0.18em]">Click to upload</p>
                                                            <p className="font-serif italic text-[11px] text-ant-mid">JPG, PNG — square works best</p>
                                                        </>
                                                    )}
                                                    {isUploading && (
                                                        <div className="absolute inset-0 bg-ant-paper/85 flex items-center justify-center">
                                                            <Loader2 className="w-5 h-5 animate-spin text-ant-orange" />
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

                                            {/* Name / Code / Label */}
                                            <div className="space-y-3">
                                                <FormField
                                                    control={form.control}
                                                    name="name"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-1.5">
                                                            <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid flex items-center gap-1.5">
                                                                <Tag className="w-3 h-3" /> Product name
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Input placeholder="E.g. Wireless headphones" {...field} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40" />
                                                            </FormControl>
                                                            <FormMessage className="text-ant-rose" />
                                                        </FormItem>
                                                    )}
                                                />

                                                <div className="grid grid-cols-2 gap-3">
                                                    <FormField
                                                        control={form.control}
                                                        name="code"
                                                        render={({ field }) => (
                                                            <FormItem className="space-y-1.5">
                                                                <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid flex items-center gap-1.5">
                                                                    <Hash className="w-3 h-3" /> SKU code
                                                                </FormLabel>
                                                                <FormControl>
                                                                    <Input placeholder="PROD-001" {...field} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink tabular-nums placeholder:text-ant-mid" />
                                                                </FormControl>
                                                                <FormMessage className="text-ant-rose" />
                                                            </FormItem>
                                                        )}
                                                    />
                                                    <FormField
                                                        control={form.control}
                                                        name="label"
                                                        render={({ field }) => (
                                                            <FormItem className="space-y-1.5">
                                                                <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Label · optional</FormLabel>
                                                                <FormControl>
                                                                    <Input placeholder="Best seller" {...field} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid" />
                                                                </FormControl>
                                                                <FormMessage className="text-ant-rose" />
                                                            </FormItem>
                                                        )}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    {/* Section 02: Pricing */}
                                    <section className="space-y-3">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <span className="font-display text-ant-orange font-semibold">02</span>
                                            Pricing &amp; margin
                                        </div>
                                        <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                            <div className="grid grid-cols-1 md:grid-cols-[1fr,1fr,auto] divide-y md:divide-y-0 md:divide-x divide-ant-line">
                                                <div className="p-4">
                                                    <FormField
                                                        control={form.control}
                                                        name="cost_price"
                                                        render={({ field }) => (
                                                            <FormItem className="space-y-1.5">
                                                                <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Cost price · DH</FormLabel>
                                                                <FormControl>
                                                                    <Input type="number" step="0.01" {...field} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink tabular-nums" />
                                                                </FormControl>
                                                                <FormMessage className="text-ant-rose" />
                                                            </FormItem>
                                                        )}
                                                    />
                                                </div>
                                                <div className="p-4">
                                                    <FormField
                                                        control={form.control}
                                                        name="selling_price"
                                                        render={({ field }) => (
                                                            <FormItem className="space-y-1.5">
                                                                <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Selling price · DH</FormLabel>
                                                                <FormControl>
                                                                    <Input type="number" step="0.01" {...field} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink tabular-nums" />
                                                                </FormControl>
                                                                <FormMessage className="text-ant-rose" />
                                                            </FormItem>
                                                        )}
                                                    />
                                                </div>
                                                <div className="p-4 min-w-[160px] flex flex-col justify-center bg-ant-light/40">
                                                    <p className="text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Margin</p>
                                                    <p className={cn('font-display text-[24px] font-semibold tabular-nums mt-1', margin > 30 ? 'text-ant-green' : margin > 0 ? 'text-ant-orange' : 'text-ant-mid')}>
                                                        {watchedCost > 0 && watchedSell > 0 ? `${margin.toFixed(0)}%` : '—'}
                                                    </p>
                                                    {watchedCost > 0 && watchedSell > 0 && (
                                                        <p className="text-[11px] text-ant-mid tabular-nums font-serif italic">+{(watchedSell - watchedCost).toFixed(2)} DH / unit</p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    {/* Section 03: Description */}
                                    <section className="space-y-3">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <span className="font-display text-ant-orange font-semibold">03</span>
                                            Description
                                        </div>
                                        <FormField
                                            control={form.control}
                                            name="description"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormControl>
                                                        <Textarea
                                                            placeholder="Dimensions, materials, selling angles, warranty — whatever a seller or customer needs to know."
                                                            className="min-h-[96px] rounded-2xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid resize-none focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                                            {...field}
                                                        />
                                                    </FormControl>
                                                    <FormMessage className="text-ant-rose" />
                                                </FormItem>
                                            )}
                                        />
                                    </section>

                                    {/* Section 04: Status */}
                                    <section className="space-y-3">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <span className="font-display text-ant-orange font-semibold">04</span>
                                            Visibility
                                        </div>
                                        <FormField
                                            control={form.control}
                                            name="active"
                                            render={({ field }) => (
                                                <FormItem className="flex items-center justify-between gap-4 p-4 rounded-2xl border border-ant-line bg-ant-paper">
                                                    <div className="space-y-0.5">
                                                        <div className="flex items-center gap-2">
                                                            <span className={cn('h-1.5 w-1.5 rounded-full', field.value ? 'bg-ant-green' : 'bg-ant-mid')} />
                                                            <FormLabel className="text-[13px] font-semibold text-ant-ink">
                                                                {field.value ? 'Live in every sales channel' : 'Hidden from sales channels'}
                                                            </FormLabel>
                                                        </div>
                                                        <FormDescription className="font-serif italic text-[12px] text-ant-mid">
                                                            Toggle off to hide the product from order pickers and seller catalogs without deleting it.
                                                        </FormDescription>
                                                    </div>
                                                    <FormControl>
                                                        <Switch
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                            className="data-[state=checked]:bg-ant-green"
                                                        />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </section>
                                </div>

                                <DialogFooter className="px-6 py-4 shrink-0 border-t border-ant-line gap-2">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => {
                                            setIsModalOpen(false);
                                            setEditingProduct(null);
                                        }}
                                        className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        type="submit"
                                        disabled={upsertProductMutation.isPending || isUploading}
                                        className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                                    >
                                        {(upsertProductMutation.isPending || isUploading) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                        <Sparkles className="w-3.5 h-3.5" />
                                        {editingProduct ? 'Save changes' : 'Publish product'}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </Form>
                    </DialogContent>
                </Dialog>

                {/* Delete confirmation */}
                <AlertDialog open={!!productToDelete} onOpenChange={() => setProductToDelete(null)}>
                    <AlertDialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                        <AlertDialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-rose">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                                Destructive action
                            </div>
                            <AlertDialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">Delete this product?</AlertDialogTitle>
                            <AlertDialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                You are about to remove <span className="not-italic font-semibold text-ant-ink">&ldquo;{productToDelete?.name}&rdquo;</span>. If the product is already tied to orders, it will be deactivated instead.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="px-6 py-4 gap-2">
                            <AlertDialogCancel className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer border-0">Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => deleteProductMutation.mutate(productToDelete.id)}
                                className="h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-rose hover:bg-ant-rose/90 text-white gap-2 cursor-pointer"
                            >
                                {deleteProductMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                <Trash2 className="w-3.5 h-3.5" />
                                Confirm delete
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                {/* Reset stock */}
                <AlertDialog open={!!productToResetStock} onOpenChange={() => setProductToResetStock(null)}>
                    <AlertDialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                        <AlertDialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-orange">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                Stock reset
                            </div>
                            <AlertDialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">Clear stock to zero?</AlertDialogTitle>
                            <AlertDialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                This resets the counter for <span className="not-italic font-semibold text-ant-ink">&ldquo;{productToResetStock?.name}&rdquo;</span> — use after a stock audit, not as a day-to-day action.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="px-6 py-4 gap-2">
                            <AlertDialogCancel className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer border-0">Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => productToResetStock && updateStockMutation.mutate({ id: productToResetStock.id, stock: 0 })}
                                className="h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-orange hover:bg-ant-orange/90 text-white gap-2 cursor-pointer"
                            >
                                {updateStockMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                <RotateCcw className="w-3.5 h-3.5" />
                                Yes, clear stock
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </div>
    );
};

export default Products;
