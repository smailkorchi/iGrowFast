import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Search,
    Puzzle,
    LayoutGrid,
    List,
    AlertTriangle,
    Eye,
} from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from '@/components/ui/button';
import { TruncatedText } from '@/components/ui/truncated-text';
import { Input } from '@/components/ui/input';
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ImageHoverPreview } from '@/components/catalog/ImageHoverPreview';
import {
    AccessoryPreviewDialog,
    type AccessoryPreviewRow,
} from '@/components/catalog/AccessoryPreviewDialog';

/** Seller catalog: read-only; accessories linked to assigned products via `product_accessories`. */
const Accessories = () => {
    const location = useLocation();
    const [searchQuery, setSearchQuery] = useState("");
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
    const [userId, setUserId] = useState<string | null>(null);
    const [previewAccessory, setPreviewAccessory] = useState<AccessoryPreviewRow | null>(null);
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    useEffect(() => {
        setViewMode('list');
    }, [location.key]);

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

    const sellerProductIdsKey = useMemo(() => [...sellerProductIds].sort().join(','), [sellerProductIds]);

    const { data: accessories, isPending: accessoriesPending } = useQuery({
        queryKey: ['seller-view-accessories', activeBusinessId, sellerProductIdsKey],
        queryFn: async () => {
            if (!activeBusinessId || sellerProductIds.length === 0) return [];

            const { data: pa, error: paErr } = await supabase
                .from('product_accessories')
                .select('accessory_id')
                .eq('DigiCom Business', activeBusinessId)
                .in('product_id', sellerProductIds);

            if (paErr) throw paErr;

            const accIds = [
                ...new Set(
                    (pa ?? [])
                        .map((r: { accessory_id?: string }) => r.accessory_id)
                        .filter((id): id is string => typeof id === 'string' && id.length > 0)
                ),
            ];

            if (accIds.length === 0) return [];

            const { data: rows, error } = await supabase
                .from('accessories')
                .select('*')
                .eq('DigiCom Business', activeBusinessId)
                .in('id', accIds)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return rows ?? [];
        },
        enabled: !!activeBusinessId && sellerProductIds.length > 0,
    });

    const isLoading =
        userId === null ||
        !activeBusinessId ||
        (!!userId && !!activeBusinessId && profilePending) ||
        (sellerProductIds.length > 0 && accessoriesPending);

    const accessoryList = accessories ?? [];

    const filteredAccessories = useMemo(() => {
        const q = searchQuery.toLowerCase();
        const list = accessoryList.filter(a =>
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
    }, [accessoryList, searchQuery]);

    const lowStockAccessories = accessoryList.filter(a => (a.stock || 0) <= 10);
    const lowStockAccessoriesTotalUnits = lowStockAccessories.reduce((sum, a) => sum + Number(a.stock ?? 0), 0);

    const catalogTotals = useMemo(() => {
        const list = accessories ?? [];
        let totalQuantity = 0;
        for (const a of list) {
            totalQuantity += Number(a.stock ?? 0);
        }
        return { totalQuantity };
    }, [accessories]);

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Page Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Accessories</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Linked to your assigned products — read-only</p>
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
                </div>
            )}

            {/* Low Stock Banner */}
            {lowStockAccessories.length > 0 && (
                <div className="bg-white border border-red-100 rounded-xl px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                        <span className="text-[11px] font-semibold text-red-600">
                            Low stock — {lowStockAccessories.length} {lowStockAccessories.length === 1 ? 'accessory' : 'accessories'}
                        </span>
                        <span className="text-[10px] text-gray-400 tabular-nums">
                            {lowStockAccessoriesTotalUnits} unit{lowStockAccessoriesTotalUnits === 1 ? '' : 's'} remaining
                        </span>
                    </div>
                    <div className="flex items-center -space-x-2 shrink-0">
                        {lowStockAccessories.slice(0, 5).map((a) => (
                            <div
                                key={a.id}
                                className="relative w-8 h-8 rounded-md border border-red-100 bg-white overflow-hidden shrink-0"
                                title={`${a.name}: ${Number(a.stock ?? 0)} units`}
                            >
                                {a.image_url ? (
                                    <img src={a.image_url} alt={a.name} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full bg-brand-navy/5 flex items-center justify-center">
                                        <Puzzle className="w-3.5 h-3.5 text-brand-navy/20" />
                                    </div>
                                )}
                                <span className="absolute bottom-0 inset-x-0 bg-red-600/95 text-white text-[8px] font-semibold leading-none py-0.5 text-center tabular-nums">
                                    {Number(a.stock ?? 0)}
                                </span>
                            </div>
                        ))}
                        {lowStockAccessories.length > 5 && (
                            <div className="w-8 h-8 rounded-md border border-red-100 bg-white flex items-center justify-center text-[10px] font-semibold text-red-500 shrink-0">
                                +{lowStockAccessories.length - 5}
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
            ) : filteredAccessories?.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-white flex flex-col items-center justify-center py-8 gap-2">
                    <Puzzle className="w-6 h-6 text-gray-400" />
                    <p className="text-[14px] font-semibold text-brand-navy">
                        {sellerProductIds.length === 0
                            ? 'No products assigned'
                            : accessoryList.length === 0
                                ? 'No linked accessories'
                                : 'No accessories found'}
                    </p>
                    <p className="text-[11px] text-gray-500 max-w-xs text-center">
                        {sellerProductIds.length === 0
                            ? 'Your account has no products linked yet. Ask an admin to assign products to you.'
                            : accessoryList.length === 0
                                ? 'None of your assigned products have accessories attached in the catalog.'
                                : 'Nothing matches your search.'}
                    </p>
                </div>
            ) : (
                <div className={cn(
                    "grid gap-2.5",
                    viewMode === 'grid' ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1"
                )}>
                    {filteredAccessories.map((accessory) => {
                        const isInactive = accessory.active === false;
                        return viewMode === 'grid' ? (
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
                                    {isInactive && (
                                        <div className="absolute inset-0 bg-brand-navy/40 backdrop-blur-[2px] flex items-center justify-center z-[1] pointer-events-none">
                                            <Badge variant="secondary" className="text-[9px] px-2 py-0.5">INACTIVE</Badge>
                                        </div>
                                    )}
                                </div>
                                </ImageHoverPreview>

                                <div className="p-3 space-y-2">
                                    <div>
                                        <TruncatedText as="p" text={accessory.code} className="text-[9px] font-semibold uppercase tracking-widest text-brand-navy/40 truncate" />
                                        <TruncatedText as="h3" text={accessory.name} className="text-[12px] font-semibold text-brand-navy leading-snug line-clamp-2 break-words" />
                                        {isInactive && (
                                            <span className="inline-block rounded-full bg-brand-navy/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-brand-navy mt-0.5">Inactive</span>
                                        )}
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <span className="text-[9px] text-gray-400 uppercase tracking-[0.14em]">{isInactive ? 'Hidden' : 'Active'}</span>
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
                                    {isInactive && (
                                        <div className="absolute inset-0 bg-brand-navy/40 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
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
                                        {isInactive && <Badge variant="secondary" className="h-5 px-1.5 text-[9px]">Inactive</Badge>}
                                    </div>
                                    <span className="text-[10px] text-gray-400 font-mono">{accessory.code}</span>
                                </div>

                                <div className="shrink-0 flex items-center gap-1 mt-2 sm:mt-0 w-full sm:w-auto justify-end">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        title="Preview"
                                        onClick={() => setPreviewAccessory(accessory)}
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

            <AccessoryPreviewDialog
                open={!!previewAccessory}
                onOpenChange={(open) => !open && setPreviewAccessory(null)}
                accessory={previewAccessory}
                variant="commercial"
            />
        </div>
    );
};

export default Accessories;
