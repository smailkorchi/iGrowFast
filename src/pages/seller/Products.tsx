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
import { TruncatedText } from '@/components/ui/truncated-text';
import { Input } from '@/components/ui/input';
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
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Commercial · Catalogue
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Produits
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Vos produits assignés — lecture seule. Les références, les prix, le stock disponible, tout ce qu&apos;il faut pour prendre commande.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <ToggleGroup
                            type="single"
                            value={viewMode}
                            onValueChange={(v) => v && setViewMode(v as 'grid' | 'list')}
                            variant="outline"
                            size="sm"
                            className="bg-ant-paper border border-ant-line rounded-full p-1"
                        >
                            <ToggleGroupItem value="grid" className="h-8 w-8 p-0 rounded-full data-[state=on]:bg-ant-ink data-[state=on]:text-white border-0">
                                <LayoutGrid className="w-3.5 h-3.5" />
                            </ToggleGroupItem>
                            <ToggleGroupItem value="list" className="h-8 w-8 p-0 rounded-full data-[state=on]:bg-ant-ink data-[state=on]:text-white border-0">
                                <List className="w-3.5 h-3.5" />
                            </ToggleGroupItem>
                        </ToggleGroup>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                            <Input
                                placeholder="Rechercher nom, code ou label…"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 h-9 w-60 rounded-full border-ant-line bg-ant-paper text-[12px] focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                            />
                        </div>
                    </div>
                </header>

                {/* KPI Tiles */}
                {isLoading ? (
                    <div className="grid grid-cols-2 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        {Array.from({ length: 2 }).map((_, i) => (
                            <div key={i} className="bg-ant-paper p-4 animate-pulse">
                                <div className="h-3 w-20 bg-ant-line rounded" />
                                <div className="mt-3 h-6 w-16 bg-ant-line rounded" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <section className="grid grid-cols-2 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        <div className="bg-ant-paper p-4">
                            <div className="flex items-start justify-between gap-2">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                                    Produits assignés
                                </div>
                                <div className="h-8 w-8 rounded-lg border bg-ant-ink/6 border-ant-ink/15 text-ant-ink flex items-center justify-center">
                                    <Package className="w-4 h-4" strokeWidth={1.75} />
                                </div>
                            </div>
                            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2">
                                {products?.length ?? 0}
                                <span className="text-[12px] text-ant-mid font-normal ml-1.5">références</span>
                            </p>
                        </div>
                        <div className="bg-ant-paper p-4">
                            <div className="flex items-start justify-between gap-2">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                                    Unités en stock
                                </div>
                                <div className="h-8 w-8 rounded-lg border bg-ant-green/10 border-ant-green/25 text-ant-green flex items-center justify-center">
                                    <Package className="w-4 h-4" strokeWidth={1.75} />
                                </div>
                            </div>
                            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                                {new Intl.NumberFormat('fr-FR').format(catalogTotals.totalQuantity)}
                                <span className="text-[12px] text-ant-mid font-normal ml-1.5">pièces</span>
                            </p>
                        </div>
                    </section>
                )}

                {/* Low Stock Banner */}
                {lowStockProducts.length > 0 && (
                    <section className="rounded-2xl border border-ant-rose/25 bg-ant-rose/10 overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-rose" />
                        <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 flex-wrap">
                                <div className="h-8 w-8 rounded-lg border border-ant-rose/25 bg-ant-rose/10 text-ant-rose flex items-center justify-center shrink-0">
                                    <AlertTriangle className="w-4 h-4" strokeWidth={1.75} />
                                </div>
                                <div>
                                    <p className="font-display text-[13px] font-semibold text-ant-rose">
                                        Stock faible — {lowStockProducts.length} {lowStockProducts.length === 1 ? 'produit' : 'produits'}
                                    </p>
                                    <p className="font-serif italic text-[11px] text-ant-rose/80 tabular-nums">
                                        {lowStockProductsTotalUnits} unité{lowStockProductsTotalUnits === 1 ? '' : 's'} restante{lowStockProductsTotalUnits === 1 ? '' : 's'}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center -space-x-2 shrink-0">
                                {lowStockProducts.slice(0, 5).map((p) => (
                                    <div
                                        key={p.id}
                                        className="relative w-9 h-9 rounded-lg border border-ant-rose/25 bg-ant-paper overflow-hidden shrink-0"
                                        title={`${p.name}: ${Number(p.stock ?? 0)} units`}
                                    >
                                        {p.image_url ? (
                                            <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full bg-ant-light flex items-center justify-center">
                                                <Package className="w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                                            </div>
                                        )}
                                        <span className="absolute bottom-0 inset-x-0 bg-ant-rose text-white text-[8px] font-semibold leading-none py-0.5 text-center tabular-nums">
                                            {Number(p.stock ?? 0)}
                                        </span>
                                    </div>
                                ))}
                                {lowStockProducts.length > 5 && (
                                    <div className="w-9 h-9 rounded-lg border border-ant-rose/25 bg-ant-paper flex items-center justify-center text-[10px] font-semibold text-ant-rose shrink-0">
                                        +{lowStockProducts.length - 5}
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>
                )}

                {/* Content */}
                {isLoading ? (
                    <div className={cn(
                        'grid gap-3',
                        viewMode === 'grid' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1',
                    )}>
                        {Array.from({ length: 8 }).map((_, i) => (
                            viewMode === 'grid' ? (
                                <Skeleton key={i} className="h-48 rounded-2xl" />
                            ) : (
                                <div key={i} className="rounded-2xl border border-ant-line bg-ant-paper p-3 flex gap-3 items-center">
                                    <Skeleton className="h-14 w-14 rounded-xl shrink-0" />
                                    <div className="flex-1 space-y-2">
                                        <Skeleton className="h-4 w-24" />
                                        <Skeleton className="h-3 w-16" />
                                    </div>
                                </div>
                            )
                        ))}
                    </div>
                ) : filteredProducts?.length === 0 ? (
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="p-10 flex flex-col items-center justify-center gap-3 text-center">
                            <div className="h-12 w-12 rounded-xl border border-ant-line bg-ant-light flex items-center justify-center">
                                <Package className="w-5 h-5 text-ant-mid" strokeWidth={1.5} />
                            </div>
                            <div className="space-y-1 max-w-sm">
                                <h3 className="font-display text-[16px] font-semibold text-ant-ink">
                                    {sellerProductIds.length === 0 ? 'Aucun produit assigné' : 'Aucun résultat'}
                                </h3>
                                <p className="font-serif italic text-[12px] text-ant-mid">
                                    {sellerProductIds.length === 0
                                        ? 'Votre compte n\u2019a pas encore de produits rattachés. Demandez à un administrateur de vous en assigner.'
                                        : 'Rien ne correspond à votre recherche.'}
                                </p>
                            </div>
                        </div>
                    </section>
                ) : (
                    <div className={cn(
                        'grid gap-3',
                        viewMode === 'grid' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1',
                    )}>
                        {filteredProducts?.map((product) => {
                            const isInactive = product.active === false;
                            const stockTone = (product.stock || 0) > 10
                                ? { bg: 'bg-ant-green/10', border: 'border-ant-green/25', text: 'text-ant-green', dot: 'bg-ant-green' }
                                : (product.stock || 0) > 0
                                    ? { bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', text: 'text-ant-orange', dot: 'bg-ant-orange' }
                                    : { bg: 'bg-ant-rose/10', border: 'border-ant-rose/25', text: 'text-ant-rose', dot: 'bg-ant-rose' };

                            return viewMode === 'grid' ? (
                                <div
                                    key={product.id}
                                    className="group rounded-2xl border border-ant-line bg-ant-paper overflow-hidden hover:border-ant-ink/30 transition-colors"
                                >
                                    <div className="h-[3px] w-full bg-ant-orange" />
                                    <ImageHoverPreview imageUrl={product.image_url} name={product.name} code={product.code}>
                                        <div className="relative aspect-square overflow-hidden bg-ant-light">
                                            {product.image_url ? (
                                                <img
                                                    src={product.image_url}
                                                    alt={product.name}
                                                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                                                />
                                            ) : (
                                                <div className="flex items-center justify-center h-full w-full text-ant-mid">
                                                    <ImageIcon className="w-10 h-10" strokeWidth={1.5} />
                                                </div>
                                            )}
                                            <div className="absolute top-2 left-2 z-20">
                                                <button
                                                    type="button"
                                                    title="Aperçu"
                                                    onClick={() => setPreviewProduct(product)}
                                                    className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-ant-line bg-ant-paper/95 text-ant-ink hover:bg-ant-paper transition-colors shadow-sm"
                                                >
                                                    <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                                                </button>
                                            </div>
                                            {isInactive && (
                                                <div className="absolute inset-0 bg-ant-ink/55 backdrop-blur-[2px] flex items-center justify-center z-[1] pointer-events-none">
                                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white uppercase tracking-[0.14em]">
                                                        <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
                                                        Désactivé
                                                    </span>
                                                </div>
                                            )}
                                            <div className="absolute bottom-2 right-2 z-20">
                                                <button
                                                    type="button"
                                                    title="Créer une commande"
                                                    onClick={() => navigate(`/seller/orders?addProductId=${product.id}`)}
                                                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-ant-ink text-white text-[10px] font-semibold hover:bg-ant-ink/90 transition-colors shadow-sm"
                                                >
                                                    <ShoppingCart className="w-3 h-3" strokeWidth={1.75} />
                                                    Commande
                                                </button>
                                            </div>
                                        </div>
                                    </ImageHoverPreview>

                                    <div className="p-4 space-y-2.5">
                                        <div className="space-y-1">
                                            <TruncatedText as="p" text={product.code} className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid truncate" />
                                            <TruncatedText as="h3" text={product.name} className="font-display text-[13px] font-semibold text-ant-ink leading-snug line-clamp-2 break-words" />
                                            {product.label && product.label.toLowerCase() !== 'regular' && (
                                                <TruncatedText as="span" text={product.label} className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-ant-mid mt-1 truncate max-w-full" />
                                            )}
                                        </div>

                                        <div className="flex items-center justify-between pt-1 border-t border-ant-line">
                                            <div>
                                                <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Prix de vente</p>
                                                <p className="font-display text-[13px] font-semibold text-ant-ink tabular-nums mt-0.5">
                                                    {product.selling_price}
                                                    <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                                                </p>
                                            </div>
                                            <span className={cn(
                                                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums',
                                                stockTone.bg,
                                                stockTone.border,
                                                stockTone.text,
                                            )}>
                                                <span className={cn('h-1.5 w-1.5 rounded-full', stockTone.dot)} />
                                                {product.stock || 0} en stock
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div key={product.id} className="group rounded-2xl border border-ant-line bg-ant-paper hover:border-ant-ink/30 flex flex-col sm:flex-row items-start sm:items-center p-3 gap-3 transition-colors">
                                    <ImageHoverPreview imageUrl={product.image_url} name={product.name} code={product.code}>
                                        <div className="relative h-14 w-14 shrink-0 rounded-xl overflow-hidden border border-ant-line bg-ant-light">
                                            {product.image_url ? (
                                                <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
                                            ) : (
                                                <div className="flex items-center justify-center h-full w-full text-ant-mid">
                                                    <ImageIcon className="w-5 h-5" strokeWidth={1.75} />
                                                </div>
                                            )}
                                            {isInactive && (
                                                <div className="absolute inset-0 bg-ant-ink/55 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
                                                    <span className="text-[8px] font-semibold text-white uppercase tracking-[0.14em]">Off</span>
                                                </div>
                                            )}
                                        </div>
                                    </ImageHoverPreview>

                                    <div className="flex-1 min-w-0 space-y-1 w-full">
                                        <div className="flex items-start gap-2 flex-wrap">
                                            <TruncatedText as="h3" text={product.name} className="font-display text-[13px] font-semibold text-ant-ink leading-snug min-w-0 flex-1" />
                                            <span className={cn(
                                                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums shrink-0',
                                                stockTone.bg,
                                                stockTone.border,
                                                stockTone.text,
                                            )}>
                                                <span className={cn('h-1.5 w-1.5 rounded-full', stockTone.dot)} />
                                                {product.stock || 0} en stock
                                            </span>
                                            {isInactive && (
                                                <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-mid">
                                                    Désactivé
                                                </span>
                                            )}
                                            {product.label && product.label.toLowerCase() !== 'regular' && (
                                                <TruncatedText as="span" text={product.label} className="inline-flex items-center h-5 rounded-full border border-ant-line bg-ant-light px-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-ant-mid shrink-0 max-w-[10rem] truncate" />
                                            )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                                            <span className="font-mono text-[11px] text-ant-mid">{product.code}</span>
                                            <span className="font-display text-[11px] text-ant-ink tabular-nums font-semibold">
                                                Vente {product.selling_price} <span className="text-ant-mid font-normal">MAD</span>
                                            </span>
                                        </div>
                                    </div>

                                    <div className="shrink-0 flex items-center gap-1.5 mt-2 sm:mt-0 w-full sm:w-auto justify-end">
                                        <button
                                            type="button"
                                            title="Créer une commande"
                                            onClick={() => navigate(`/seller/orders?addProductId=${product.id}`)}
                                            className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-ant-ink text-white hover:bg-ant-ink/90 cursor-pointer transition-colors"
                                        >
                                            <ShoppingCart className="w-3.5 h-3.5" strokeWidth={1.75} />
                                        </button>
                                        <button
                                            type="button"
                                            title="Aperçu"
                                            onClick={() => setPreviewProduct(product)}
                                            className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-ant-line bg-ant-paper hover:bg-ant-light text-ant-ink cursor-pointer transition-colors"
                                        >
                                            <Eye className="w-3.5 h-3.5" strokeWidth={1.75} />
                                        </button>
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
        </div>
    );
};

export default Products;
