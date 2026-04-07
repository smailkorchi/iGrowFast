import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Search,
    Package,
    Image as ImageIcon,
    LayoutGrid,
    List,
    AlertTriangle,
    Eye,
    ShoppingCart,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TruncatedText } from '@/components/ui/truncated-text';
import { Input } from '@/components/ui/input';
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from '@/lib/utils';
import {
    ProductPreviewDialog,
    type ProductPreviewRow,
} from '@/components/catalog/ProductPreviewDialog';

/** Seller catalog: read-only; only products assigned on the user profile. */
const Products = () => {
    const navigate = useNavigate();
    const [searchQuery, setSearchQuery] = useState("");
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
    const [userId, setUserId] = useState<string | null>(null);
    const [previewProduct, setPreviewProduct] = useState<ProductPreviewRow | null>(null);
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    useEffect(() => {
        void supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id ?? null));
    }, []);

    const { data: sellerProfile, isPending: profilePending } = useQuery({
        queryKey: ['seller-user-products', userId, activeBusinessId],
        queryFn: async () => {
            if (!userId) return null;
            const { data, error } = await supabase
                .from('users')
                .select('products, commission_price, commission_basis')
                .eq('id', userId)
                .maybeSingle();
            if (error) throw error;
            return data as { products: string[] | null; commission_price: number | null; commission_basis: string | null } | null;
        },
        enabled: !!userId && !!activeBusinessId,
    });

    const sellerProductIds = useMemo(() => {
        const p = sellerProfile?.products;
        if (!Array.isArray(p)) return [] as string[];
        return p.filter((id): id is string => typeof id === 'string' && id.length > 0);
    }, [sellerProfile]);

    const { data: products, isPending: productsPending } = useQuery({
        queryKey: ['seller-view-products', activeBusinessId, [...sellerProductIds].sort().join(',')],
        queryFn: async () => {
            if (!activeBusinessId || sellerProductIds.length === 0) return [];
            const { data, error } = await supabase
                .from('products')
                .select('*')
                .eq('DigiCom Business', activeBusinessId)
                .in('id', sellerProductIds)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data ?? [];
        },
        enabled: !!activeBusinessId && sellerProductIds.length > 0,
    });

    const isLoading =
        userId === null ||
        !activeBusinessId ||
        (!!userId && !!activeBusinessId && profilePending) ||
        (sellerProductIds.length > 0 && productsPending);

    const productList = products ?? [];

    const filteredProducts = productList.filter(p => {
        const q = searchQuery.toLowerCase();
        return (
            p.name.toLowerCase().includes(q) ||
            p.code.toLowerCase().includes(q) ||
            p.label?.toLowerCase().includes(q) ||
            p.description?.toLowerCase().includes(q) ||
            String(p.selling_price ?? '').includes(q) ||
            String(p.stock ?? '').includes(q)
        );
    });

    const lowStockProducts = productList.filter(p => (p.stock || 0) <= 10);
    const lowStockProductsTotalUnits = lowStockProducts.reduce((sum, p) => sum + Number(p.stock ?? 0), 0);

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Products</h1>
                            <p className="text-gray-500 font-light">Products assigned to you for this business. Editing is done by your admin team.</p>
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
                                    placeholder="Search name, code, or label..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-11 h-12 rounded-2xl border-gray-100 bg-white"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {lowStockProducts.length > 0 && (
                <div className="bg-red-50 border border-red-100/50 rounded-[32px] p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm">
                    <div className="flex items-start md:items-center gap-4">
                        <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center shrink-0 text-red-500 shadow-inner">
                            <AlertTriangle className="w-7 h-7" />
                        </div>
                        <div className="space-y-1">
                            <h3 className="text-xl font-bold text-red-600">Low stock (informational)</h3>
                            <p className="text-red-500/80 font-medium">
                                {lowStockProducts.length} product{lowStockProducts.length === 1 ? '' : 's'} at or below 10 units.{' '}
                                <span className="font-bold text-red-700 tabular-nums">{lowStockProductsTotalUnits}</span>
                                {' '}unit{lowStockProductsTotalUnits === 1 ? '' : 's'} remaining across them.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center -space-x-3 shrink-0">
                        {lowStockProducts.slice(0, 5).map(p => (
                            <div
                                key={p.id}
                                className="relative w-12 h-12 rounded-2xl border-2 border-red-50 bg-white shadow-sm overflow-hidden shrink-0"
                                title={`${p.name}: ${Number(p.stock ?? 0)} units`}
                            >
                                {p.image_url ?
                                    <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> :
                                    <div className="w-full h-full bg-brand-navy/5 flex items-center justify-center">
                                        <Package className="w-5 h-5 text-brand-navy/20" />
                                    </div>
                                }
                                <span className="absolute bottom-0 inset-x-0 bg-red-600/95 text-white text-[9px] font-black leading-none py-0.5 text-center tabular-nums">
                                    {Number(p.stock ?? 0)}
                                </span>
                            </div>
                        ))}
                        {lowStockProducts.length > 5 && (
                            <div className="w-12 h-12 rounded-2xl border-2 border-red-50 bg-white flex items-center justify-center shadow-sm z-10 text-xs font-black text-red-500 shrink-0">
                                +{lowStockProducts.length - 5}
                            </div>
                        )}
                    </div>
                </div>
            )}

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
            ) : filteredProducts?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-6 bg-white/50 backdrop-blur-sm rounded-[40px] shadow-sm border border-brand-navy/[0.03]">
                    <div className="w-24 h-24 bg-brand-navy/[0.04] rounded-full flex items-center justify-center">
                        <Package className="w-12 h-12 text-brand-navy/20" />
                    </div>
                    <div className="text-center space-y-2">
                        <h3 className="text-2xl font-bold text-brand-navy">
                            {sellerProductIds.length === 0 ? 'No products assigned' : 'No products found'}
                        </h3>
                        <p className="text-muted-foreground max-w-xs mx-auto">
                            {sellerProductIds.length === 0
                                ? 'Your account has no products linked yet. Ask an admin to assign products to you.'
                                : 'Nothing matches your search.'}
                        </p>
                    </div>
                </div>
            ) : (
                <div className={cn(
                    "grid gap-6",
                    viewMode === 'grid' ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1"
                )}>
                    {filteredProducts?.map((product) => {
                        const isInactive = product.active === false;
                        return viewMode === 'grid' ? (
                            <Card
                                key={product.id}
                                className="group relative overflow-hidden border-none bg-white/50 backdrop-blur-sm shadow-sm hover:shadow-2xl transition-all duration-300 rounded-[32px]"
                            >
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
                                    <div className="absolute top-4 left-4 z-[2]">
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="icon"
                                            title="Preview"
                                            onClick={() => setPreviewProduct(product)}
                                            className="h-10 w-10 rounded-xl bg-white/90 backdrop-blur-md border-none shadow-lg text-brand-navy hover:bg-white transition-all"
                                        >
                                            <Eye className="h-5 w-5" />
                                                </Button>
                                    </div>
                                    {isInactive && (
                                        <div className="absolute inset-0 bg-brand-navy/40 backdrop-blur-[2px] flex items-center justify-center z-[1] pointer-events-none">
                                            <Badge variant="secondary" className="bg-brand-white text-brand-navy font-bold text-xs px-4 py-1.5 rounded-full shadow-lg">INACTIVE</Badge>
                                        </div>
                                    )}
                                    <div className="absolute bottom-3 right-3 z-[2]">
                                        <Button
                                            type="button"
                                            size="sm"
                                            title="Create order with this product"
                                            onClick={() => navigate(`/seller/orders?addProductId=${product.id}`)}
                                            className="h-9 rounded-xl bg-brand-navy text-white hover:bg-brand-navy/90 shadow-lg shadow-brand-navy/30 px-3 gap-1.5 text-[11px] font-black uppercase tracking-wider"
                                        >
                                            <ShoppingCart className="w-3.5 h-3.5" />
                                            New order
                                        </Button>
                                    </div>
                                </div>

                                <CardContent className="p-5 space-y-4">
                                    <div className="space-y-2">
                                        <TruncatedText as="p" text={product.code} className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40 truncate" />
                                        <TruncatedText as="h3" text={product.name} className="text-base font-bold text-brand-navy leading-snug line-clamp-2 break-words min-h-[2.5rem]" />
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            {product.label && product.label.toLowerCase() !== 'regular' && (
                                                <TruncatedText as="span" text={product.label} className="inline-block max-w-full truncate rounded-full bg-brand-navy/[0.05] px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-brand-navy/55" />
                                            )}
                                            {isInactive && (
                                                <span className="inline-block rounded-full bg-brand-navy/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-brand-navy">Inactive</span>
                                            )}
                                        </div>
                                    </div>

                                        <div className="space-y-1">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Selling Price</p>
                                            <p className="text-lg font-bold text-brand-navy">{product.selling_price} DH</p>
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
                                            {isInactive ? 'Hidden' : 'Active'}
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>
                        ) : (
                            <Card key={product.id} className="group overflow-hidden border-none bg-white/50 backdrop-blur-sm shadow-sm hover:shadow-xl transition-all duration-300 rounded-[24px] flex flex-col sm:flex-row items-center p-4 gap-6">
                                <div className="relative h-32 w-full sm:w-32 shrink-0 rounded-[20px] overflow-hidden bg-brand-navy/[0.02] shadow-inner">
                                    {product.image_url ? (
                                        <img src={product.image_url} alt={product.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" />
                                    ) : (
                                        <div className="flex items-center justify-center h-full w-full text-brand-navy/10">
                                            <ImageIcon className="w-10 h-10" />
                                        </div>
                                    )}
                                    {isInactive && (
                                        <div className="absolute inset-0 bg-brand-navy/40 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
                                            <Badge variant="secondary" className="bg-brand-white text-brand-navy font-bold text-[10px] px-3 py-1 rounded-full shadow-sm">INACTIVE</Badge>
                                        </div>
                                    )}
                                </div>

                                <div className="flex-1 min-w-0 space-y-2 w-full">
                                    <div className="flex items-start gap-3 flex-wrap">
                                        <TruncatedText as="h3" text={product.name} className="text-lg sm:text-xl font-bold text-brand-navy leading-snug line-clamp-2 break-words min-w-0 flex-1" />
                                        {isInactive && (
                                            <Badge variant="secondary" className="bg-brand-navy/10 text-brand-navy font-bold text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0 mt-0.5">Inactive</Badge>
                                        )}
                                        <TruncatedText as="span" text={product.label || 'Regular'} className="inline-flex items-center rounded-full border border-brand-navy/10 bg-transparent px-2.5 py-0.5 text-[10px] font-bold text-brand-navy/60 uppercase shrink-0 mt-0.5 max-w-[10rem] truncate" />
                                    </div>
                                    <TruncatedText as="p" text={product.code} className="text-xs font-black uppercase tracking-widest text-brand-navy/40 truncate" />

                                    <div className="flex flex-wrap items-center gap-4 sm:gap-6 pt-2">
                                        <div className="flex items-center gap-2">
                                            <div className={cn("w-2 h-2 rounded-full", (product.stock || 0) > 10 ? "bg-emerald-500" : (product.stock || 0) > 0 ? "bg-amber-500" : "bg-red-500")} />
                                            <span className="text-[10px] font-black text-brand-navy/60 tracking-wider uppercase">{product.stock || 0} in stock</span>
                                        </div>
                                        <div className="hidden sm:block h-4 w-px bg-brand-navy/10"></div>
                                        <span className="text-xs font-bold text-brand-navy">
                                            <span className="text-[10px] uppercase font-black mr-1 text-brand-navy/40">Sell</span> {product.selling_price} DH
                                        </span>
                                    </div>
                                </div>
                                <div className="shrink-0 w-full sm:w-auto flex items-center gap-2 justify-end sm:justify-center pt-2 sm:pt-0 border-t sm:border-t-0 border-brand-navy/5">
                                    <Button
                                        type="button"
                                        size="icon"
                                        title="Create order with this product"
                                        onClick={() => navigate(`/seller/orders?addProductId=${product.id}`)}
                                        className="h-12 w-12 rounded-2xl bg-brand-navy text-white hover:bg-brand-navy/90 shadow-md shadow-brand-navy/20 transition-all"
                                    >
                                        <ShoppingCart className="w-5 h-5" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        title="Preview"
                                        onClick={() => setPreviewProduct(product)}
                                        className="h-12 w-12 rounded-2xl bg-brand-navy/[0.06] text-brand-navy hover:bg-brand-navy hover:text-white transition-all"
                                    >
                                        <Eye className="w-5 h-5" />
                                    </Button>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            <ProductPreviewDialog
                open={!!previewProduct}
                onOpenChange={(open) => !open && setPreviewProduct(null)}
                product={previewProduct}
                variant="seller"
            />
        </div>
    );
};

export default Products;
