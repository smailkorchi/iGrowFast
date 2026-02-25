import React, { useState, useRef, useEffect } from 'react';
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
    Upload,
    Check,
    X,
    TrendingUp,
    Tag,
    Hash
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
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<any>(null);
    const [productToDelete, setProductToDelete] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [isUploading, setIsUploading] = useState(false);
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

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['products', activeBusinessId] });
            setProductToDelete(null);
            toast({ title: "Product deleted", description: "The product was successfully removed." });
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
        } catch (error: any) {
            toast({ title: "Upload failed", description: error.message, variant: "destructive" });
        } finally {
            setIsUploading(false);
        }
    };

    const onSubmit = (values: ProductFormValues) => {
        upsertProductMutation.mutate(values);
    };

    const filteredProducts = products?.filter(p =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.label?.toLowerCase().includes(searchQuery.toLowerCase())
    );

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

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-2">
                    <h1 className="text-4xl font-bold tracking-tight text-brand-navy">Inventory & Products</h1>
                    <p className="text-muted-foreground text-lg">Catalog and manage your items with pricing and stock info.</p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 items-center">
                    <div className="relative group sm:w-80">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-brand-navy" />
                        <Input
                            placeholder="Search name, code, or label..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-11 h-12 bg-white/50 border-none shadow-sm rounded-2xl focus-visible:ring-1 focus-visible:ring-brand-navy/20 transition-all font-medium"
                        />
                    </div>
                    <Button
                        onClick={() => openModal()}
                        className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-12 px-6 font-bold shadow-lg shadow-brand-navy/10 transition-all active:scale-95 flex items-center gap-2 w-full sm:w-auto"
                    >
                        <Plus className="w-5 h-5" />
                        Add Product
                    </Button>
                </div>
            </div>

            {/* Content Section */}
            {isLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {Array.from({ length: 8 }).map((_, i) => (
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
                    ))}
                </div>
            ) : filteredProducts?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-6 bg-white/50 backdrop-blur-sm rounded-[40px] shadow-sm border border-brand-navy/[0.03]">
                    <div className="w-24 h-24 bg-brand-navy/[0.04] rounded-full flex items-center justify-center">
                        <Package className="w-12 h-12 text-brand-navy/20" />
                    </div>
                    <div className="text-center space-y-2">
                        <h3 className="text-2xl font-bold text-brand-navy">No products found</h3>
                        <p className="text-muted-foreground max-w-xs mx-auto">Start building your inventory by adding your first product with images and pricing.</p>
                    </div>
                    <Button variant="outline" onClick={() => openModal()} className="rounded-xl border-brand-navy/10 font-bold hover:bg-brand-navy hover:text-brand-white transition-all">
                        Create First Product
                    </Button>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {filteredProducts?.map((product) => (
                        <Card
                            key={product.id}
                            className="group relative overflow-hidden border-none bg-white/50 backdrop-blur-sm shadow-sm hover:shadow-2xl transition-all duration-300 rounded-[32px]"
                        >
                            {/* Product Image */}
                            <div className="relative h-48 w-full overflow-hidden bg-brand-navy/[0.02]">
                                {product.image_url ? (
                                    <img
                                        src={product.image_url}
                                        alt={product.name}
                                        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                                    />
                                ) : (
                                    <div className="flex items-center justify-center h-full w-full text-brand-navy/10">
                                        <ImageIcon className="w-16 h-16" />
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
                                            <DropdownMenuItem onClick={() => openModal(product)} className="rounded-xl p-3 cursor-pointer focus:bg-brand-navy focus:text-brand-white gap-3">
                                                <Edit2 className="w-4 h-4" />
                                                <span className="font-bold">Edit Product</span>
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={() => setProductToDelete(product)} className="rounded-xl p-3 cursor-pointer text-red-500 focus:bg-red-50 focus:text-red-600 gap-3">
                                                <Trash2 className="w-4 h-4" />
                                                <span className="font-bold">Delete</span>
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                                {!product.active && (
                                    <div className="absolute inset-0 bg-brand-navy/40 backdrop-blur-[2px] flex items-center justify-center">
                                        <Badge variant="secondary" className="bg-brand-white text-brand-navy font-bold text-xs px-4 py-1.5 rounded-full shadow-lg">INACTIVE</Badge>
                                    </div>
                                )}
                            </div>

                            <CardContent className="p-6 space-y-4">
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40">{product.code}</p>
                                        <Badge variant="outline" className="text-[10px] font-bold border-brand-navy/10 text-brand-navy/60 uppercase">{product.label || 'Regular'}</Badge>
                                    </div>
                                    <h3 className="text-xl font-bold text-brand-navy truncate">{product.name}</h3>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Cost Price</p>
                                        <p className="text-lg font-bold text-brand-navy/40">{product.cost_price} DH</p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Selling Price</p>
                                        <p className="text-lg font-bold text-brand-navy">{product.selling_price} DH</p>
                                    </div>
                                </div>

                                <div className="pt-2 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className={cn(
                                            "w-2 h-2 rounded-full",
                                            (product.stock || 0) > 10 ? "bg-emerald-500" : (product.stock || 0) > 0 ? "bg-amber-500" : "bg-red-500"
                                        )} />
                                        <span className="text-[10px] font-black text-brand-navy/60 tracking-wider uppercase">
                                            {product.stock || 0} in stock
                                        </span>
                                    </div>
                                    <span className="text-[10px] font-black text-brand-navy/60 tracking-wider uppercase">
                                        {product.active ? 'Active' : 'Hidden'}
                                    </span>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Upsert Modal */}
            <Dialog open={isModalOpen} onOpenChange={(open) => {
                if (!open && !upsertProductMutation.isPending) {
                    setIsModalOpen(false);
                    setEditingProduct(null);
                }
            }}>
                <DialogContent className="max-w-2xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
                            <DialogHeader className="p-8 pb-4 shrink-0">
                                <DialogTitle className="text-3xl font-bold text-brand-navy">
                                    {editingProduct ? 'Edit Product' : 'Add New Product'}
                                </DialogTitle>
                                <DialogDescription className="text-muted-foreground text-lg">
                                    Fill in the details below to {editingProduct ? 'update' : 'publish'} this product.
                                </DialogDescription>
                            </DialogHeader>

                            <div className="overflow-y-auto p-8 pt-4 space-y-8 flex-1 min-h-0 custom-scrollbar">
                                {/* Image Upload & Basic Info Grid */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                    {/* Image Upload Area */}
                                    <div className="md:col-span-1 space-y-4">
                                        <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Product Image</FormLabel>
                                        <div
                                            onClick={() => !isUploading && fileInputRef.current?.click()}
                                            className={cn(
                                                "relative aspect-square rounded-[32px] border-4 border-dashed cursor-pointer transition-all flex flex-col items-center justify-center gap-3 overflow-hidden group",
                                                form.watch('image_url')
                                                    ? "border-brand-navy/10 hover:border-brand-navy/30"
                                                    : "border-brand-navy/10 bg-brand-navy/[0.02] hover:bg-brand-navy/[0.04] hover:border-brand-navy/20"
                                            )}
                                        >
                                            {form.watch('image_url') ? (
                                                <>
                                                    <img src={form.getValues('image_url')!} className="w-full h-full object-cover" alt="Preview" />
                                                    <div className="absolute inset-0 bg-brand-navy/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
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
                                                        <FormLabel className="text-xs font-bold uppercase tracking-wider">Product Name</FormLabel>
                                                    </div>
                                                    <FormControl>
                                                        <Input placeholder="E.g. Wireless Headphones" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        <div className="grid grid-cols-2 gap-4">
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
                                                            <Input placeholder="PROD-001" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={form.control}
                                                name="label"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-2">
                                                        <div className="flex items-center gap-2 text-muted-foreground/70">
                                                            <ImageIcon className="w-3.5 h-3.5" />
                                                            <FormLabel className="text-xs font-bold uppercase tracking-wider">Short Label</FormLabel>
                                                        </div>
                                                        <FormControl>
                                                            <Input placeholder="Best Seller" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* pricing and description */}
                                <div className="space-y-6">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                        <FormField
                                            control={form.control}
                                            name="cost_price"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Cost Price (DH)</FormLabel>
                                                    <FormControl>
                                                        <Input type="number" step="0.01" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="selling_price"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <div className="flex items-center justify-between">
                                                        <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Selling Price (DH)</FormLabel>
                                                        {form.watch('cost_price') > 0 && form.watch('selling_price') > 0 && (
                                                            <Badge className="bg-emerald-50 text-emerald-600 border-none font-bold">
                                                                Margin: {((form.watch('selling_price') - form.watch('cost_price')) / form.watch('selling_price') * 100).toFixed(0)}%
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <FormControl>
                                                        <Input type="number" step="0.01" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
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
                                            <FormItem className="space-y-2">
                                                <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Description</FormLabel>
                                                <FormControl>
                                                    <Textarea
                                                        placeholder="Detailed product specifications, notes, and information..."
                                                        className="min-h-[120px] rounded-2xl border-none bg-brand-navy/[0.04] text-base font-medium text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner resize-none p-4"
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
                                            <FormItem className="flex items-center justify-between p-6 rounded-3xl bg-brand-navy/[0.02] border border-brand-navy/[0.03]">
                                                <div className="space-y-1">
                                                    <FormLabel className="text-base font-bold text-brand-navy">Active Status</FormLabel>
                                                    <FormDescription>Toggle off to hide this product from sales channels.</FormDescription>
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

                            <DialogFooter className="p-8 pt-0 shrink-0 bg-brand-white">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                        setIsModalOpen(false);
                                        setEditingProduct(null);
                                    }}
                                    className="rounded-2xl h-14 px-8 font-bold text-brand-navy hover:bg-muted"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={upsertProductMutation.isPending || isUploading}
                                    className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-14 px-10 font-bold shadow-2xl shadow-brand-navy/30 transition-all active:scale-95 flex items-center gap-3"
                                >
                                    {(upsertProductMutation.isPending || isUploading) && <Loader2 className="w-5 h-5 animate-spin" />}
                                    {editingProduct ? 'Update Product' : 'Publish Product'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={!!productToDelete} onOpenChange={() => setProductToDelete(null)}>
                <AlertDialogContent className="rounded-[40px] border-none p-10 max-w-md">
                    <div className="flex flex-col items-center text-center space-y-6">
                        <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center text-red-500">
                            <Trash2 className="w-10 h-10" />
                        </div>
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-3xl font-bold text-brand-navy">Permanently Delete?</AlertDialogTitle>
                            <AlertDialogDescription className="text-lg text-muted-foreground pt-2">
                                You are about to remove <span className="font-black text-brand-navy italic">"{productToDelete?.name}"</span>. This action cannot be reversed.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="w-full flex flex-col sm:flex-row gap-3 mt-4">
                            <AlertDialogCancel className="w-full rounded-2xl h-14 font-bold border-none bg-brand-navy/[0.04] hover:bg-brand-navy/[0.08] text-brand-navy m-0">
                                Back to Safety
                            </AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => deleteProductMutation.mutate(productToDelete.id)}
                                className="w-full rounded-2xl h-14 font-bold bg-red-500 hover:bg-red-600 text-brand-white shadow-xl shadow-red-500/20 m-0"
                            >
                                {deleteProductMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                Confirm Removal
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </div>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default Products;
