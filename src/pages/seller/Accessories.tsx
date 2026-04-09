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
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TruncatedText } from '@/components/ui/truncated-text';
import { Input } from '@/components/ui/input';
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
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

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Accessories</h1>
                            <p className="text-gray-500 font-light">Accessories linked to your assigned products. Editing is done by your admin team.</p>
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
                        </div>
                    </div>
                </div>
            </div>

            {lowStockAccessories.length > 0 && (
                <div className="bg-red-50 border border-red-100/50 rounded-[32px] p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm">
                    <div className="flex items-start md:items-center gap-4">
                        <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center shrink-0 text-red-500 shadow-inner">
                            <AlertTriangle className="w-7 h-7" />
                        </div>
                        <div className="space-y-1">
                            <h3 className="text-xl font-bold text-red-600">Low stock (informational)</h3>
                            <p className="text-red-500/80 font-medium">
                                {lowStockAccessories.length} {lowStockAccessories.length === 1 ? 'accessory' : 'accessories'} at or below 10 units.{' '}
                                <span className="font-bold text-red-700 tabular-nums">{lowStockAccessoriesTotalUnits}</span>
                                {' '}unit{lowStockAccessoriesTotalUnits === 1 ? '' : 's'} remaining across them.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center -space-x-3 shrink-0">
                        {lowStockAccessories.slice(0, 5).map((a) => (
                            <div
                                key={a.id}
                                className="relative w-12 h-12 rounded-2xl border-2 border-red-50 bg-white shadow-sm overflow-hidden shrink-0"
                                title={`${a.name}: ${Number(a.stock ?? 0)} units`}
                            >
                                {a.image_url ? (
                                    <img src={a.image_url} alt={a.name} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full bg-brand-navy/5 flex items-center justify-center">
                                        <Puzzle className="w-5 h-5 text-brand-navy/20" />
                                    </div>
                                )}
                                <span className="absolute bottom-0 inset-x-0 bg-red-600/95 text-white text-[9px] font-black leading-none py-0.5 text-center tabular-nums">
                                    {Number(a.stock ?? 0)}
                                </span>
                            </div>
                        ))}
                        {lowStockAccessories.length > 5 && (
                            <div className="w-12 h-12 rounded-2xl border-2 border-red-50 bg-white flex items-center justify-center shadow-sm z-10 text-xs font-black text-red-500 shrink-0">
                                +{lowStockAccessories.length - 5}
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
            ) : filteredAccessories?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-6 bg-white/50 backdrop-blur-sm rounded-[40px] shadow-sm border border-brand-navy/[0.03]">
                    <div className="w-24 h-24 bg-brand-navy/[0.04] rounded-full flex items-center justify-center">
                        <Puzzle className="w-12 h-12 text-brand-navy/20" />
                    </div>
                    <div className="text-center space-y-2">
                        <h3 className="text-2xl font-bold text-brand-navy">
                            {sellerProductIds.length === 0
                                ? 'No products assigned'
                                : accessoryList.length === 0
                                    ? 'No linked accessories'
                                    : 'No accessories found'}
                        </h3>
                        <p className="text-muted-foreground max-w-xs mx-auto">
                            {sellerProductIds.length === 0
                                ? 'Your account has no products linked yet. Ask an admin to assign products to you.'
                                : accessoryList.length === 0
                                    ? 'None of your assigned products have accessories attached in the catalog.'
                                    : 'Nothing matches your search.'}
                        </p>
                    </div>
                </div>
            ) : (
                <div className={cn(
                    "grid gap-6",
                    viewMode === 'grid' ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1"
                )}>
                    {filteredAccessories.map((accessory) => {
                        const isInactive = accessory.active === false;
                        return viewMode === 'grid' ? (
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
                                    <div className="absolute top-4 left-4 z-[2]">
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="icon"
                                            title="Preview"
                                            onClick={() => setPreviewAccessory(accessory)}
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
                                </div>

                                <CardContent className="p-5 space-y-4">
                                    <div className="space-y-2">
                                        <TruncatedText as="p" text={accessory.code} className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40 truncate" />
                                        <TruncatedText as="h3" text={accessory.name} className="text-base font-bold text-brand-navy leading-snug line-clamp-2 break-words min-h-[2.5rem]" />
                                        {isInactive && (
                                            <span className="inline-block rounded-full bg-brand-navy/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-brand-navy">Inactive</span>
                                        )}
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
                                            {isInactive ? 'Hidden' : 'Active'}
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>
                        ) : (
                            <Card key={accessory.id} className="group overflow-hidden border-none bg-white/50 backdrop-blur-sm shadow-sm hover:shadow-xl transition-all duration-300 rounded-[24px] flex flex-col sm:flex-row items-center p-4 gap-6">
                                <div className="relative h-32 w-full sm:w-32 shrink-0 rounded-[20px] overflow-hidden bg-brand-navy/[0.02] shadow-inner">
                                    {accessory.image_url ? (
                                        <img src={accessory.image_url} alt={accessory.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" />
                                    ) : (
                                        <div className="flex items-center justify-center h-full w-full text-brand-navy/10">
                                            <Puzzle className="w-10 h-10" />
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
                                        <TruncatedText as="h3" text={accessory.name} className="text-lg sm:text-xl font-bold text-brand-navy leading-snug line-clamp-2 break-words min-w-0 flex-1" />
                                        {isInactive && (
                                            <Badge variant="secondary" className="bg-brand-navy/10 text-brand-navy font-bold text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0 mt-0.5">Inactive</Badge>
                                        )}
                                    </div>
                                    <TruncatedText as="p" text={accessory.code} className="text-xs font-black uppercase tracking-widest text-brand-navy/40 truncate" />

                                    <div className="flex flex-wrap items-center gap-4 sm:gap-6 pt-2">
                                        <div className="flex items-center gap-2">
                                            <div className={cn("w-2 h-2 rounded-full", (accessory.stock || 0) > 10 ? "bg-emerald-500" : (accessory.stock || 0) > 0 ? "bg-amber-500" : "bg-red-500")} />
                                            <span className="text-[10px] font-black text-brand-navy/60 tracking-wider uppercase">{accessory.stock || 0} in stock</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="shrink-0 w-full sm:w-auto flex justify-end sm:justify-center pt-2 sm:pt-0 border-t sm:border-t-0 border-brand-navy/5">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        title="Preview"
                                        onClick={() => setPreviewAccessory(accessory)}
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
