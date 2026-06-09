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
    Upload,
    Sparkles,
    Coins,
    Layers,
    type LucideIcon,
} from 'lucide-react';
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

const KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

interface KpiProps {
    label: string;
    value: string;
    suffix: string;
    accent: keyof typeof KPI_ACCENTS;
    icon: LucideIcon;
}

const AccessoryKpi: React.FC<KpiProps> = ({ label, value, suffix, accent, icon: Icon }) => {
    const a = KPI_ACCENTS[accent];
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

    type AttachMode = 'fixed' | 'per_item' | 'per_order';
    const [attachedProducts, setAttachedProducts] = useState<{ product_id: string; default_quantity: number; attach_mode: AttachMode }[]>([]);
    const [productSearch, setProductSearch] = useState("");
    const [bulkAttachmentQty, setBulkAttachmentQty] = useState("1");

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

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

    const fetchAttachedProducts = async (accessoryId: string) => {
        const { data, error } = await supabase
            .from('product_accessories')
            .select('product_id, default_quantity, attach_mode')
            .eq('accessory_id', accessoryId);
        if (error) {
            console.error('Error fetching attachments:', error);
            return [];
        }
        return (data || []).map((d: any) => ({
            product_id: d.product_id,
            default_quantity: d.default_quantity,
            attach_mode: (d.attach_mode as AttachMode) || 'fixed',
        }));
    };

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

            await supabase
                .from('product_accessories')
                .delete()
                .eq('accessory_id', accessoryId);

            if (attachedProducts.length > 0) {
                const inserts = attachedProducts.map(ap => ({
                    product_id: ap.product_id,
                    accessory_id: accessoryId,
                    default_quantity: ap.default_quantity,
                    attach_mode: ap.attach_mode || 'fixed',
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
        let activeCount = 0;
        for (const a of list) {
            const q = Number(a.stock ?? 0);
            const c = Number(a.cost_price ?? 0);
            totalQuantity += q;
            inventoryValue += q * c;
            if (a.active) activeCount += 1;
        }
        return { totalQuantity, inventoryValue, activeCount };
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

    const toggleProductAttachment = (productId: string) => {
        setAttachedProducts(prev => {
            const exists = prev.find(p => p.product_id === productId);
            if (exists) {
                return prev.filter(p => p.product_id !== productId);
            }
            return [...prev, { product_id: productId, default_quantity: 1, attach_mode: 'fixed' }];
        });
    };

    const updateAttachmentQuantity = (productId: string, qty: number) => {
        setAttachedProducts(prev =>
            prev.map(p => p.product_id === productId ? { ...p, default_quantity: Math.max(1, qty) } : p)
        );
    };

    const updateAttachmentMode = (productId: string, mode: AttachMode) => {
        setAttachedProducts(prev =>
            prev.map(p => p.product_id === productId ? { ...p, attach_mode: mode } : p)
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

    const selectAllFilteredProducts = () => {
        const list = filteredProducts;
        if (!list?.length) return;
        setAttachedProducts((prev) => {
            const map = new Map(prev.map((ap) => [ap.product_id, ap]));
            for (const product of list) {
                if (!map.has(product.id)) {
                    map.set(product.id, { product_id: product.id, default_quantity: 1, attach_mode: 'fixed' });
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
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Catalog · Accessories
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Accessories
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            The quiet additions — bubble wrap, gift boxes, branded flyers. Attach them to products once and the pickers remember for you.
                        </p>
                    </div>
                    <Button
                        onClick={() => openModal()}
                        className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 shrink-0 cursor-pointer"
                    >
                        <Plus className="w-4 h-4" />
                        New accessory
                    </Button>
                </header>

                {/* KPI strip */}
                {isLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="bg-ant-paper p-4"><Skeleton className="h-12 rounded-lg" /></div>
                        ))}
                    </div>
                ) : (
                    <section className="grid grid-cols-1 md:grid-cols-3 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        <AccessoryKpi
                            label="Accessories"
                            value={String(accessories?.length ?? 0)}
                            suffix={`${catalogTotals.activeCount} active`}
                            accent="ink"
                            icon={Puzzle}
                        />
                        <AccessoryKpi
                            label="Units in stock"
                            value={new Intl.NumberFormat('fr-FR').format(catalogTotals.totalQuantity)}
                            suffix="units"
                            accent="orange"
                            icon={Layers}
                        />
                        <AccessoryKpi
                            label="Inventory cost"
                            value={formatDhAggregate(catalogTotals.inventoryValue)}
                            suffix=""
                            accent="green"
                            icon={Coins}
                        />
                    </section>
                )}

                {/* Low stock banner */}
                {lowStockAccessories.length > 0 && (
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
                                        {lowStockAccessories.length} item{lowStockAccessories.length === 1 ? '' : 's'} running low
                                        <span className="text-ant-mid font-normal text-[12px] ml-2 font-sans tabular-nums">· {lowStockAccessoriesTotalUnits} unit{lowStockAccessoriesTotalUnits === 1 ? '' : 's'} remaining</span>
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
                                            <th className="text-left px-5 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Accessory</th>
                                            <th className="text-left px-4 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Code</th>
                                            <th className="text-right px-4 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Stock</th>
                                            <th className="text-right px-5 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Unit cost</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {lowStockAccessories.map((a) => {
                                            const stock = Number(a.stock ?? 0);
                                            const cost = Number(a.cost_price ?? 0);
                                            const tone = stock === 0 ? 'text-ant-rose' : stock <= 2 ? 'text-ant-rose' : 'text-ant-orange';
                                            return (
                                                <tr
                                                    key={a.id}
                                                    onClick={() => setPreviewAccessory(a)}
                                                    className="border-b border-ant-line last:border-0 hover:bg-ant-light/60 transition-colors cursor-pointer"
                                                >
                                                    <td className="px-5 py-3 text-[12px] text-ant-ink">
                                                        <div className="flex items-center gap-2.5">
                                                            {a.image_url ? (
                                                                <img src={a.image_url} alt={a.name} className="w-8 h-8 rounded-lg object-cover border border-ant-line shrink-0" />
                                                            ) : (
                                                                <div className="w-8 h-8 rounded-lg bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center shrink-0">
                                                                    <Puzzle className="w-3.5 h-3.5 text-ant-orange" />
                                                                </div>
                                                            )}
                                                            <TruncatedText as="span" text={a.name} className="font-semibold truncate" />
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-[11px] text-ant-mid tabular-nums truncate">{a.code}</td>
                                                    <td className={cn('px-4 py-3 text-right text-[12px] font-semibold tabular-nums', tone)}>
                                                        {stock} left
                                                    </td>
                                                    <td className="px-5 py-3 text-right text-[12px] text-ant-ink tabular-nums">
                                                        {cost.toLocaleString('fr-MA')} <span className="text-[10px] text-ant-mid">DH</span>
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
                            <span className="text-ant-ink font-semibold">{filteredAccessories.length}</span> shown
                        </span>
                    </div>

                    <div className="relative flex-1 md:max-w-[360px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                        <Input
                            placeholder="Search name or code..."
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
                ) : filteredAccessories?.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                        <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                            <Puzzle className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                        </div>
                        <h3 className="font-display text-[18px] text-ant-ink tracking-tight">
                            {accessories?.length ? 'Nothing matches that search' : 'No accessories yet'}
                        </h3>
                        <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                            {accessories?.length ? 'Loosen the search or clear it to bring the catalog back into view.' : 'Gift boxes, flyers, wrapping — add the small extras that ride with every order.'}
                        </p>
                        {!accessories?.length && (
                            <Button
                                onClick={() => openModal()}
                                className="mt-5 bg-ant-ink hover:bg-ant-ink/90 text-white h-9 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                            >
                                <Plus className="w-4 h-4" />
                                Add your first accessory
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className={cn(
                        'grid gap-3',
                        viewMode === 'grid' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1'
                    )}>
                        {filteredAccessories?.map((accessory) => {
                            const stock = Number(accessory.stock ?? 0);
                            const pill = stockPill(stock);
                            const stripeColor = !accessory.active ? 'bg-ant-line' : stock === 0 ? 'bg-ant-rose' : stock <= 10 ? 'bg-ant-orange' : 'bg-ant-green';

                            if (viewMode === 'grid') {
                                return (
                                    <div
                                        key={accessory.id}
                                        className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper group transition-all hover:border-ant-ink/20 hover:shadow-[0_16px_48px_-20px_rgba(20,20,19,0.18)]"
                                    >
                                        <div className={cn('h-[3px] w-full', stripeColor)} />
                                        <ImageHoverPreview imageUrl={accessory.image_url} name={accessory.name} code={accessory.code}>
                                            <div className="relative aspect-[4/3] overflow-hidden bg-ant-light">
                                                {accessory.image_url ? (
                                                    <img
                                                        src={accessory.image_url}
                                                        alt={accessory.name}
                                                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                                                    />
                                                ) : (
                                                    <div className="flex items-center justify-center h-full w-full text-ant-orange/40">
                                                        <Puzzle className="w-10 h-10" strokeWidth={1.25} />
                                                    </div>
                                                )}

                                                <div className="absolute top-2.5 left-2.5 z-20">
                                                    <Button
                                                        type="button"
                                                        variant="secondary"
                                                        size="icon"
                                                        title="Preview"
                                                        onClick={() => setPreviewAccessory(accessory)}
                                                        className="h-8 w-8 rounded-full bg-ant-paper border border-ant-line text-ant-ink hover:bg-white shadow-sm cursor-pointer"
                                                    >
                                                        <Eye className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>

                                                <div className="absolute top-2.5 right-2.5 z-20">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="secondary" size="icon" className="h-8 w-8 rounded-full bg-ant-paper border border-ant-line text-ant-ink hover:bg-white shadow-sm cursor-pointer">
                                                                <MoreVertical className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end" className="min-w-[180px] rounded-xl border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)] p-1">
                                                            <DropdownMenuItem onClick={() => setPreviewAccessory(accessory)} className="rounded-lg px-3 py-2 gap-2 text-[12px] font-medium text-ant-ink cursor-pointer">
                                                                <Eye className="w-3.5 h-3.5" />Preview
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => openModal(accessory)} className="rounded-lg px-3 py-2 gap-2 text-[12px] font-medium text-ant-ink cursor-pointer">
                                                                <Edit2 className="w-3.5 h-3.5" />Edit accessory
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => setAccessoryToResetStock(accessory)} className="rounded-lg px-3 py-2 gap-2 text-[12px] font-medium text-ant-ink cursor-pointer">
                                                                <RotateCcw className="w-3.5 h-3.5" />Clear stock (0)
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                onClick={() => toggleAccessoryActiveMutation.mutate({ id: accessory.id, active: !accessory.active })}
                                                                disabled={toggleAccessoryActiveMutation.isPending}
                                                                className="rounded-lg px-3 py-2 gap-2 text-[12px] font-medium text-ant-ink cursor-pointer"
                                                            >
                                                                <Power className="w-3.5 h-3.5" />{accessory.active ? 'Deactivate' : 'Activate'}
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator className="bg-ant-line" />
                                                            <DropdownMenuItem onClick={() => setAccessoryToDelete(accessory)} className="rounded-lg px-3 py-2 gap-2 text-[12px] font-medium text-ant-rose focus:text-ant-rose focus:bg-ant-rose/10 cursor-pointer">
                                                                <Trash2 className="w-3.5 h-3.5" />Delete
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>

                                                {!accessory.active && (
                                                    <div className="absolute inset-0 z-[1] pointer-events-none bg-ant-ink/40 backdrop-blur-[2px] flex items-center justify-center">
                                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-ant-paper border border-ant-line px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-ant-ink">
                                                            <span className="h-1.5 w-1.5 rounded-full bg-ant-mid" /> Inactive
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </ImageHoverPreview>

                                        <div className="p-4 space-y-3">
                                            <div className="space-y-1">
                                                <TruncatedText as="p" text={accessory.code} className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid tabular-nums truncate" />
                                                <TruncatedText as="h3" text={accessory.name} className="font-display text-[14px] font-semibold text-ant-ink leading-snug line-clamp-2" />
                                            </div>

                                            <div className="flex items-end justify-between pt-2 border-t border-ant-line">
                                                <div>
                                                    <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Unit cost</p>
                                                    <p className="font-display text-[18px] font-semibold text-ant-ink tabular-nums">
                                                        {accessory.cost_price}
                                                        <span className="text-[11px] text-ant-mid font-normal ml-1">DH</span>
                                                    </p>
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
                                    key={accessory.id}
                                    className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper hover:border-ant-ink/20 transition-colors"
                                >
                                    <div className={cn('h-[3px] w-full', stripeColor)} />
                                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4">
                                        <ImageHoverPreview imageUrl={accessory.image_url} name={accessory.name} code={accessory.code}>
                                            <div className="relative h-16 w-16 shrink-0 rounded-xl overflow-hidden bg-ant-light border border-ant-line">
                                                {accessory.image_url ? (
                                                    <img src={accessory.image_url} alt={accessory.name} className="h-full w-full object-cover" />
                                                ) : (
                                                    <div className="flex items-center justify-center h-full w-full text-ant-orange/40">
                                                        <Puzzle className="w-6 h-6" strokeWidth={1.25} />
                                                    </div>
                                                )}
                                                {!accessory.active && (
                                                    <div className="absolute inset-0 bg-ant-ink/45 backdrop-blur-[2px] flex items-center justify-center">
                                                        <span className="text-[8px] font-semibold text-white uppercase tracking-[0.2em]">Off</span>
                                                    </div>
                                                )}
                                            </div>
                                        </ImageHoverPreview>

                                        <div className="flex-1 min-w-0 space-y-1.5 w-full">
                                            <div className="flex items-start gap-2 flex-wrap">
                                                <TruncatedText as="h3" text={accessory.name} className="font-display text-[15px] font-semibold text-ant-ink leading-snug min-w-0 flex-1" />
                                                <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums shrink-0', pill.bg, pill.border, pill.text)}>
                                                    <span className={cn('h-1.5 w-1.5 rounded-full', pill.dot)} />
                                                    {pill.label}
                                                </span>
                                                {!accessory.active && (
                                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-mid">
                                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-mid" /> Inactive
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                                                <span className="text-ant-mid tabular-nums">{accessory.code}</span>
                                                <span className="text-ant-mid">Cost <span className="text-ant-ink font-semibold tabular-nums ml-0.5">{accessory.cost_price}</span> DH</span>
                                                <span className="text-ant-mid">Inv value <span className="text-ant-green font-semibold tabular-nums ml-0.5">{formatAccessoryInventoryValueDh(accessory)}</span></span>
                                            </div>
                                        </div>

                                        <div className="shrink-0 flex items-center gap-1 w-full sm:w-auto justify-end">
                                            <Button variant="ghost" size="icon" title="Preview" onClick={() => setPreviewAccessory(accessory)} className="h-9 w-9 rounded-full hover:bg-ant-ink/5 cursor-pointer">
                                                <Eye className="w-3.5 h-3.5 text-ant-ink" />
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => openModal(accessory)} title="Edit" className="h-9 w-9 rounded-full hover:bg-ant-orange/10 cursor-pointer">
                                                <Edit2 className="w-3.5 h-3.5 text-ant-orange" />
                                            </Button>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-ant-ink/5 cursor-pointer">
                                                        <MoreVertical className="w-3.5 h-3.5 text-ant-mid" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="min-w-[180px] rounded-xl border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)] p-1">
                                                    <DropdownMenuItem onClick={() => setAccessoryToResetStock(accessory)} className="rounded-lg px-3 py-2 gap-2 text-[12px] font-medium text-ant-ink cursor-pointer">
                                                        <RotateCcw className="w-3.5 h-3.5" />Clear stock (0)
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() => toggleAccessoryActiveMutation.mutate({ id: accessory.id, active: !accessory.active })}
                                                        disabled={toggleAccessoryActiveMutation.isPending}
                                                        className="rounded-lg px-3 py-2 gap-2 text-[12px] font-medium text-ant-ink cursor-pointer"
                                                    >
                                                        <Power className="w-3.5 h-3.5" />{accessory.active ? 'Deactivate' : 'Activate'}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator className="bg-ant-line" />
                                                    <DropdownMenuItem onClick={() => setAccessoryToDelete(accessory)} className="rounded-lg px-3 py-2 gap-2 text-[12px] font-medium text-ant-rose focus:text-ant-rose focus:bg-ant-rose/10 cursor-pointer">
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
                    <DialogContent className="max-w-3xl p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden flex flex-col max-h-[92vh]">
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
                                <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b border-ant-line space-y-1.5">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                        {editingAccessory ? 'Edit · Accessory' : 'New · Accessory'}
                                    </div>
                                    <DialogTitle className="font-display text-[22px] leading-tight tracking-tight text-ant-ink">
                                        {editingAccessory ? `Editing ${editingAccessory.name}` : 'Add a new accessory'}
                                    </DialogTitle>
                                    <DialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                        {editingAccessory
                                            ? 'Update details and the products it rides along with.'
                                            : 'Name it, price it, attach it to the products that carry it. Pickers remember the rest.'}
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="ant-scroll overflow-y-auto p-6 space-y-6 flex-1 min-h-0">
                                    {/* Section 01 */}
                                    <section className="space-y-3">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <span className="font-display text-ant-orange font-semibold">01</span>
                                            Image &amp; identity
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-[200px,1fr] gap-5">
                                            <div className="space-y-1.5">
                                                <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Accessory image</FormLabel>
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
                                                            <img src={form.getValues('image_url')!} className="w-full h-full object-cover" alt="Preview" />
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

                                            <div className="space-y-3">
                                                <FormField
                                                    control={form.control}
                                                    name="name"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-1.5">
                                                            <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid flex items-center gap-1.5">
                                                                <Tag className="w-3 h-3" /> Accessory name
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Input placeholder="E.g. Gift box" {...field} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40" />
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
                                                                    <Input placeholder="ACC-001" {...field} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink tabular-nums placeholder:text-ant-mid" />
                                                                </FormControl>
                                                                <FormMessage className="text-ant-rose" />
                                                            </FormItem>
                                                        )}
                                                    />
                                                    <FormField
                                                        control={form.control}
                                                        name="cost_price"
                                                        render={({ field }) => (
                                                            <FormItem className="space-y-1.5">
                                                                <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Cost · DH</FormLabel>
                                                                <FormControl>
                                                                    <Input type="number" step="0.01" placeholder="0" {...field} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink tabular-nums" />
                                                                </FormControl>
                                                                <FormMessage className="text-ant-rose" />
                                                            </FormItem>
                                                        )}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    {/* Section 02: Attach to products */}
                                    <section className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <span className="font-display text-ant-orange font-semibold">02</span>
                                                Attach to products
                                            </div>
                                            {attachedProducts.length > 0 && (
                                                <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-orange/25 bg-ant-orange/10 px-2.5 py-0.5 text-[10px] font-semibold text-ant-orange tabular-nums">
                                                    <Link2 className="w-3 h-3" />
                                                    {attachedProducts.length} attached
                                                </span>
                                            )}
                                        </div>
                                        <p className="font-serif italic text-[12px] text-ant-mid">
                                            Pick the products that carry this accessory by default. Each one gets a default quantity pickers can still override.
                                        </p>

                                        <div className="flex flex-col gap-2">
                                            <div className="relative w-full">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                                                <Input
                                                    placeholder="Search products..."
                                                    value={productSearch}
                                                    onChange={(e) => setProductSearch(e.target.value)}
                                                    className="h-9 pl-9 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid"
                                                />
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={!filteredProducts?.length}
                                                    onClick={selectAllFilteredProducts}
                                                    className="h-8 rounded-full border-ant-line bg-ant-paper text-[11px] font-semibold text-ant-ink hover:bg-ant-light cursor-pointer"
                                                >
                                                    Select all
                                                    {filteredProducts && filteredProducts.length > 0
                                                        ? ` (${filteredProducts.length})`
                                                        : ''}
                                                </Button>
                                                <div className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-paper pl-3 pr-1 h-8">
                                                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid whitespace-nowrap">
                                                        Default qty
                                                    </span>
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        value={bulkAttachmentQty}
                                                        onChange={(e) => setBulkAttachmentQty(e.target.value)}
                                                        className="h-6 w-12 rounded-md border-none bg-ant-light text-center text-[11px] font-semibold shadow-none px-1"
                                                    />
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        disabled={filteredAttachedCount === 0}
                                                        onClick={applyBulkQuantityToFiltered}
                                                        className="h-6 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white px-3 text-[10px] font-semibold disabled:bg-ant-mid/40 cursor-pointer"
                                                    >
                                                        Apply
                                                    </Button>
                                                </div>
                                            </div>
                                            {filteredAttachedCount > 0 && (
                                                <p className="font-serif italic text-[11px] text-ant-mid">
                                                    Applies to {filteredAttachedCount} attached product{filteredAttachedCount !== 1 ? 's' : ''} in this view.
                                                </p>
                                            )}
                                        </div>

                                        <div className="ant-scroll space-y-1 max-h-[240px] overflow-y-auto rounded-2xl border border-ant-line bg-ant-paper p-2">
                                            {filteredProducts?.length === 0 ? (
                                                <p className="font-serif italic text-[12px] text-ant-mid text-center py-6">No products match that search.</p>
                                            ) : (
                                                filteredProducts?.map(product => {
                                                    const attachment = attachedProducts.find(ap => ap.product_id === product.id);
                                                    const isAttached = !!attachment;

                                                    return (
                                                        <div
                                                            key={product.id}
                                                            className={cn(
                                                                'flex items-center gap-3 p-2.5 rounded-xl transition-all cursor-pointer',
                                                                isAttached
                                                                    ? 'bg-ant-orange/10 border border-ant-orange/25'
                                                                    : 'border border-transparent hover:bg-ant-light hover:border-ant-line'
                                                            )}
                                                        >
                                                            <button
                                                                type="button"
                                                                onClick={() => toggleProductAttachment(product.id)}
                                                                className={cn(
                                                                    'w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-all border cursor-pointer',
                                                                    isAttached
                                                                        ? 'bg-ant-orange border-ant-orange text-white'
                                                                        : 'border-ant-line text-transparent hover:border-ant-ink/40'
                                                                )}
                                                            >
                                                                <Check className="w-3 h-3" />
                                                            </button>

                                                            <div className="w-9 h-9 rounded-lg overflow-hidden bg-ant-light border border-ant-line shrink-0">
                                                                {product.image_url ? (
                                                                    <img src={product.image_url} className="w-full h-full object-cover" alt="" />
                                                                ) : (
                                                                    <div className="w-full h-full flex items-center justify-center">
                                                                        <Package className="w-4 h-4 text-ant-mid" />
                                                                    </div>
                                                                )}
                                                            </div>

                                                            <div className="flex-1 min-w-0" onClick={() => toggleProductAttachment(product.id)}>
                                                                <TruncatedText as="p" text={product.name} className="text-[12px] font-semibold text-ant-ink truncate" />
                                                                <TruncatedText as="p" text={product.code} className="text-[10px] font-semibold text-ant-mid uppercase tracking-[0.18em] truncate" />
                                                            </div>

                                                            {isAttached && (
                                                                <div className="inline-flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                                                                    <div className="inline-flex items-center rounded-lg border border-ant-line bg-ant-paper p-0.5">
                                                                        {(['fixed', 'per_item', 'per_order'] as AttachMode[]).map((m) => (
                                                                            <button
                                                                                key={m}
                                                                                type="button"
                                                                                title={
                                                                                    m === 'fixed'
                                                                                        ? 'Fixed quantity per line'
                                                                                        : m === 'per_item'
                                                                                            ? 'Multiplies with product quantity (qty × product qty)'
                                                                                            : 'One per order — shown on the first line only, never multiplies'
                                                                                }
                                                                                onClick={() => updateAttachmentMode(product.id, m)}
                                                                                className={cn(
                                                                                    'px-2 h-7 rounded-md text-[10px] font-semibold transition cursor-pointer whitespace-nowrap',
                                                                                    attachment!.attach_mode === m ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink'
                                                                                )}
                                                                            >
                                                                                {m === 'fixed' ? 'Fixed' : m === 'per_item' ? 'Per item' : 'Per order'}
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                    <div className="inline-flex items-center gap-1.5">
                                                                        <span className="text-[10px] font-semibold text-ant-mid uppercase tracking-[0.18em]">Qty</span>
                                                                        <Input
                                                                            type="number"
                                                                            min={1}
                                                                            value={attachment!.default_quantity}
                                                                            onChange={(e) => updateAttachmentQuantity(product.id, parseInt(e.target.value) || 1)}
                                                                            className="w-16 h-8 rounded-lg border-ant-line bg-ant-paper text-center text-[12px] font-semibold tabular-nums"
                                                                        />
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </section>

                                    {/* Section 03: Visibility */}
                                    <section className="space-y-3">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <span className="font-display text-ant-orange font-semibold">03</span>
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
                                                                {field.value ? 'Available in every order picker' : 'Hidden from order pickers'}
                                                            </FormLabel>
                                                        </div>
                                                        <FormDescription className="font-serif italic text-[12px] text-ant-mid">
                                                            Toggle off to retire the accessory without losing its history.
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
                                            setEditingAccessory(null);
                                            setAttachedProducts([]);
                                        }}
                                        className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        type="submit"
                                        disabled={upsertAccessoryMutation.isPending || isUploading}
                                        className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                                    >
                                        {(upsertAccessoryMutation.isPending || isUploading) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                        <Sparkles className="w-3.5 h-3.5" />
                                        {editingAccessory ? 'Save changes' : 'Publish accessory'}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </Form>
                    </DialogContent>
                </Dialog>

                {/* Delete confirmation */}
                <AlertDialog open={!!accessoryToDelete} onOpenChange={() => setAccessoryToDelete(null)}>
                    <AlertDialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                        <AlertDialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-rose">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                                Destructive action
                            </div>
                            <AlertDialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">Delete this accessory?</AlertDialogTitle>
                            <AlertDialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                You are about to remove <span className="not-italic font-semibold text-ant-ink">&ldquo;{accessoryToDelete?.name}&rdquo;</span>. If the accessory is tied to orders, it will be deactivated instead.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="px-6 py-4 gap-2">
                            <AlertDialogCancel className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer border-0">Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => deleteAccessoryMutation.mutate(accessoryToDelete.id)}
                                className="h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-rose hover:bg-ant-rose/90 text-white gap-2 cursor-pointer"
                            >
                                {deleteAccessoryMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                <Trash2 className="w-3.5 h-3.5" />
                                Confirm delete
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                {/* Reset stock */}
                <AlertDialog open={!!accessoryToResetStock} onOpenChange={() => setAccessoryToResetStock(null)}>
                    <AlertDialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                        <AlertDialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-orange">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                Stock reset
                            </div>
                            <AlertDialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">Clear stock to zero?</AlertDialogTitle>
                            <AlertDialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                This resets the counter for <span className="not-italic font-semibold text-ant-ink">&ldquo;{accessoryToResetStock?.name}&rdquo;</span> — use after a stock audit, not as a day-to-day action.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="px-6 py-4 gap-2">
                            <AlertDialogCancel className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer border-0">Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() =>
                                    accessoryToResetStock &&
                                    updateStockMutation.mutate({ id: accessoryToResetStock.id, stock: 0 })
                                }
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

export default Accessories;
