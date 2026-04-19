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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from '@/components/ui/button';
import { TruncatedText } from '@/components/ui/truncated-text';
import { Input } from '@/components/ui/input';
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from '@/lib/utils';
import { ImageHoverPreview } from '@/components/catalog/ImageHoverPreview';
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

    const filteredProducts = useMemo(() => {
        const q = searchQuery.toLowerCase();
        const list = productList.filter(p =>
            p.name.toLowerCase().includes(q) ||
            p.code.toLowerCase().includes(q) ||
            p.label?.toLowerCase().includes(q) ||
            p.description?.toLowerCase().includes(q) ||
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
    }, [productList, searchQuery]);

    const lowStockProducts = productList.filter(p => (p.stock || 0) <= 10);
    const lowStockProductsTotalUnits = lowStockProducts.reduce((sum, p) => sum + Number(p.stock ?? 0), 0);

    const catalogTotals = useMemo(() => {
        const list = products ?? [];
        let totalQuantity = 0;
        for (const p of list) {
            totalQuantity += Number(p.stock ?? 0);
        }
        return { totalQuantity };
    }, [products]);

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Page Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Products</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Assigned catalog — read-only</p>
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
                    </div>
                </div>
            </header>

            {/* KPI Tiles */}
            {isLoading ? (
                <div className="grid grid-cols-2 gap-2">
                    {Array.from({ length: 2 }).map((_, i) => (
                        <Skeleton key={i} className="h-16 rounded-xl" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-2">
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
                </div>
            )}

            {/* Low Stock Banner */}
            {lowStockProducts.length > 0 && (
                <div className="bg-white border border-red-100 rounded-xl px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                        <span className="text-[11px] font-semibold text-red-600">
                            Low stock — {lowStockProducts.length} product{lowStockProducts.length === 1 ? '' : 's'}
                        </span>
                        <span className="text-[10px] text-gray-400 tabular-nums">
                            {lowStockProductsTotalUnits} unit{lowStockProductsTotalUnits === 1 ? '' : 's'} remaining
                        </span>
                    </div>
                    <div className="flex items-center -space-x-2 shrink-0">
                        {lowStockProducts.slice(0, 5).map(p => (
                            <div
                                key={p.id}
                                className="relative w-8 h-8 rounded-md border border-red-100 bg-white overflow-hidden shrink-0"
                                title={`${p.name}: ${Number(p.stock ?? 0)} units`}
                            >
                                {p.image_url ?
                                    <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> :
                                    <div className="w-full h-full bg-brand-navy/5 flex items-center justify-center">
                                        <Package className="w-3.5 h-3.5 text-brand-navy/20" />
                                    </div>
                                }
                                <span className="absolute bottom-0 inset-x-0 bg-red-600/95 text-white text-[8px] font-semibold leading-none py-0.5 text-center tabular-nums">
                                    {Number(p.stock ?? 0)}
                                </span>
                            </div>
                        ))}
                        {lowStockProducts.length > 5 && (
                            <div className="w-8 h-8 rounded-md border border-red-100 bg-white flex items-center justify-center text-[10px] font-semibold text-red-500 shrink-0">
                                +{lowStockProducts.length - 5}
                            </div>
                        )}
                    </div>
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
            ) : filteredProducts?.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-white flex flex-col items-center justify-center py-8 gap-2">
                    <Package className="w-6 h-6 text-gray-400" />
                    <p className="text-[14px] font-semibold text-brand-navy">
                        {sellerProductIds.length === 0 ? 'No products assigned' : 'No products found'}
                    </p>
                    <p className="text-[11px] text-gray-500 max-w-xs text-center">
                        {sellerProductIds.length === 0
                            ? 'Your account has no products linked yet. Ask an admin to assign products to you.'
                            : 'Nothing matches your search.'}
                    </p>
                </div>
            ) : (
                <div className={cn(
                    "grid gap-2.5",
                    viewMode === 'grid' ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1"
                )}>
                    {filteredProducts?.map((product) => {
                        const isInactive = product.active === false;
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
                                    {isInactive && (
                                        <div className="absolute inset-0 bg-brand-navy/40 backdrop-blur-[2px] flex items-center justify-center z-[1] pointer-events-none">
                                            <Badge variant="secondary" className="text-[9px] px-2 py-0.5">INACTIVE</Badge>
                                        </div>
                                    )}
                                    <div className="absolute bottom-2 right-2 z-20">
                                        <Button
                                            type="button"
                                            size="sm"
                                            title="Create order with this product"
                                            onClick={() => navigate(`/seller/orders?addProductId=${product.id}`)}
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
                                        {isInactive && (
                                            <span className="inline-block rounded-full bg-brand-navy/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-brand-navy ml-1">Inactive</span>
                                        )}
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-[9px] text-gray-400 uppercase tracking-[0.14em]">Selling Price</p>
                                            <p className="text-[11px] font-semibold text-brand-navy tabular-nums">{product.selling_price} DH</p>
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
                                <div className="relative h-14 w-14 shrink-0 rounded-md overflow-hidden bg-brand-navy/[0.02]">
                                    {product.image_url ? (
                                        <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
                                    ) : (
                                        <div className="flex items-center justify-center h-full w-full text-brand-navy/10">
                                            <ImageIcon className="w-6 h-6" />
                                        </div>
                                    )}
                                    {isInactive && (
                                        <div className="absolute inset-0 bg-brand-navy/40 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
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
                                        {isInactive && <Badge variant="secondary" className="h-5 px-1.5 text-[9px]">Inactive</Badge>}
                                        {product.label && product.label.toLowerCase() !== 'regular' && (
                                            <TruncatedText as="span" text={product.label} className="inline-flex items-center h-5 rounded-full border border-brand-navy/10 px-2 text-[9px] font-semibold text-brand-navy/60 uppercase shrink-0 max-w-[10rem] truncate" />
                                        )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                                        <span className="text-[10px] text-gray-400 font-mono">{product.code}</span>
                                        <span className="text-[10px] text-brand-navy tabular-nums font-semibold">Sell {product.selling_price} DH</span>
                                    </div>
                                </div>

                                <div className="shrink-0 flex items-center gap-1 mt-2 sm:mt-0 w-full sm:w-auto justify-end">
                                    <Button
                                        type="button"
                                        size="icon"
                                        title="Create order with this product"
                                        onClick={() => navigate(`/seller/orders?addProductId=${product.id}`)}
                                        className="h-8 w-8 rounded-md bg-brand-navy text-white hover:bg-brand-navy/90"
                                    >
                                        <ShoppingCart className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        title="Preview"
                                        onClick={() => setPreviewProduct(product)}
                                        className="h-8 w-8 rounded-md text-brand-navy hover:bg-brand-navy/[0.06]"
                                    >
                                        <Eye className="w-3.5 h-3.5" />
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
                variant="commercial"
            />
        </div>
    );
};

export default Products;
