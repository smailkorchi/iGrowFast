/* eslint-disable react-refresh/only-export-components */
import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Edit2, Trash2, RotateCcw, Power, Package } from 'lucide-react';

export type ProductPreviewRow = {
    id: string;
    name: string;
    code?: string | null;
    label?: string | null;
    description?: string | null;
    cost_price?: number | null;
    selling_price?: number | null;
    stock?: number | null;
    active?: boolean | null;
    image_url?: string | null;
};

export function formatProductDhAggregate(value: number): string {
    return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)} DH`;
}

/** On-hand inventory: cost basis and selling (retail) extension. */
export function productInventoryTotals(
    p: Pick<ProductPreviewRow, 'stock' | 'cost_price' | 'selling_price'>
): { totalCost: number; totalValue: number } {
    const q = Number(p.stock ?? 0);
    return {
        totalCost: q * Number(p.cost_price ?? 0),
        totalValue: q * Number(p.selling_price ?? 0),
    };
}

type AdminActions = {
    onEdit: () => void;
    onClearStock: () => void;
    onToggleActive: () => void;
    onDelete: () => void;
    toggleActivePending?: boolean;
};

export type ProductPreviewDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    product: ProductPreviewRow | null;
    variant: 'admin' | 'seller';
    adminActions?: AdminActions;
};

function DetailPanel({ children }: { children: React.ReactNode }) {
    return (
        <div className="rounded-2xl border border-brand-navy/[0.08] bg-brand-navy/[0.02] overflow-hidden divide-y divide-brand-navy/[0.07]">
            {children}
        </div>
    );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-4 py-2.5 px-4 sm:py-3 sm:px-5">
            <span className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40 shrink-0">
                {label}
            </span>
            <div className="text-sm font-bold text-brand-navy text-right min-w-0 break-all leading-snug">
                {children}
            </div>
        </div>
    );
}

function PricePair({
    leftLabel,
    leftValue,
    rightLabel,
    rightValue,
    rightEmphasis,
}: {
    leftLabel: string;
    leftValue: React.ReactNode;
    rightLabel: string;
    rightValue: React.ReactNode;
    rightEmphasis?: boolean;
}) {
    return (
        <div className="grid grid-cols-2 gap-0 divide-x divide-brand-navy/[0.07]">
            <div className="py-2.5 px-4 sm:py-3 sm:pl-5 sm:pr-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40 mb-1">{leftLabel}</p>
                <p className="text-sm font-bold text-brand-navy tabular-nums">{leftValue}</p>
            </div>
            <div className="py-2.5 px-4 sm:py-3 sm:pl-4 sm:pr-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40 mb-1">{rightLabel}</p>
                <p
                    className={cn(
                        'text-sm font-bold tabular-nums',
                        rightEmphasis ? 'text-emerald-700' : 'text-brand-navy'
                    )}
                >
                    {rightValue}
                </p>
            </div>
        </div>
    );
}

export function ProductPreviewDialog({
    open,
    onOpenChange,
    product,
    variant,
    adminActions,
}: ProductPreviewDialogProps) {
    if (!product) return null;

    const isInactive = product.active === false;
    const isAdmin = variant === 'admin';
    const inv = productInventoryTotals(product);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[min(100vw-2rem,36rem)] sm:max-w-[42rem] p-0 gap-0 border-none bg-brand-white rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[min(90vh,680px)]">
                <DialogHeader className="p-6 sm:p-8 pb-3 sm:pb-4 shrink-0 text-left space-y-1.5 pr-14">
                    <div className="flex flex-wrap items-center gap-2">
                        <DialogTitle className="text-2xl sm:text-3xl font-bold text-brand-navy leading-tight">
                            {product.name}
                        </DialogTitle>
                        {isInactive && (
                            <Badge
                                variant="secondary"
                                className="bg-brand-navy/10 text-brand-navy font-bold text-[10px] px-2.5 py-0.5 rounded-full uppercase tracking-wide"
                            >
                                Inactive
                            </Badge>
                        )}
                    </div>
                    <DialogDescription className="text-muted-foreground text-base font-light">
                        {isAdmin ? 'Product details and quick actions.' : 'Read-only details for your assigned product.'}
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="flex-1 min-h-0 max-h-[52vh]">
                    <div className="px-6 sm:px-8 pb-6 space-y-5">
                        <div className="flex flex-col sm:flex-row gap-5 sm:gap-6 sm:items-stretch">
                            <div className="relative mx-auto w-full max-w-[220px] aspect-[5/6] shrink-0 overflow-hidden rounded-2xl border border-brand-navy/[0.08] bg-brand-navy/[0.04] sm:mx-0 sm:max-w-[200px] sm:w-[200px] sm:self-stretch sm:aspect-auto sm:min-h-[260px]">
                                {product.image_url ? (
                                    <img
                                        src={product.image_url}
                                        alt={product.name}
                                        className="h-full w-full min-h-[200px] object-cover sm:absolute sm:inset-0 sm:min-h-full"
                                    />
                                ) : (
                                    <div className="flex h-full min-h-[200px] w-full flex-col items-center justify-center gap-2 text-brand-navy/20 sm:absolute sm:inset-0 sm:min-h-full">
                                        <Package className="w-12 h-12 sm:w-14 sm:h-14" />
                                        <span className="text-[10px] font-bold uppercase tracking-widest">No image</span>
                                    </div>
                                )}
                                {isInactive && (
                                    <div className="absolute inset-0 z-10 bg-brand-navy/35 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
                                        <Badge
                                            variant="secondary"
                                            className="bg-brand-white text-brand-navy font-bold text-[10px] px-3 py-1 rounded-full shadow-lg"
                                        >
                                            INACTIVE
                                        </Badge>
                                    </div>
                                )}
                            </div>

                            <div className="flex-1 min-w-0 flex flex-col gap-4">
                                {isAdmin ? (
                                    <DetailPanel>
                                        <DetailRow label="Code">{product.code || '—'}</DetailRow>
                                        <DetailRow label="Label">
                                            <Badge
                                                variant="outline"
                                                className="text-[10px] font-bold border-brand-navy/15 text-brand-navy/70 uppercase"
                                            >
                                                {product.label || 'Regular'}
                                            </Badge>
                                        </DetailRow>
                                        <PricePair
                                            leftLabel="Cost price"
                                            leftValue={<>{Number(product.cost_price ?? 0)} DH</>}
                                            rightLabel="Selling price"
                                            rightValue={<>{Number(product.selling_price ?? 0)} DH</>}
                                        />
                                        <PricePair
                                            leftLabel="Total cost"
                                            leftValue={formatProductDhAggregate(inv.totalCost)}
                                            rightLabel="Total value"
                                            rightValue={formatProductDhAggregate(inv.totalValue)}
                                            rightEmphasis
                                        />
                                        <DetailRow label="Stock">
                                            <span className="inline-flex items-center justify-end gap-2">
                                                <span
                                                    className={cn(
                                                        'w-2 h-2 rounded-full shrink-0',
                                                        Number(product.stock ?? 0) > 10
                                                            ? 'bg-emerald-500'
                                                            : Number(product.stock ?? 0) > 0
                                                              ? 'bg-amber-500'
                                                              : 'bg-red-500'
                                                    )}
                                                />
                                                {Number(product.stock ?? 0)} units
                                            </span>
                                        </DetailRow>
                                        <DetailRow label="Status">
                                            {isInactive ? (
                                                <span className="text-amber-700 font-bold">Hidden</span>
                                            ) : (
                                                <span className="text-emerald-700 font-bold">Active</span>
                                            )}
                                        </DetailRow>
                                    </DetailPanel>
                                ) : (
                                    <DetailPanel>
                                        <DetailRow label="Code">{product.code || '—'}</DetailRow>
                                        <DetailRow label="Selling price">
                                            <span className="tabular-nums">{Number(product.selling_price ?? 0)} DH</span>
                                        </DetailRow>
                                        <DetailRow label="Stock">
                                            <span className="inline-flex items-center justify-end gap-2">
                                                <span
                                                    className={cn(
                                                        'w-2 h-2 rounded-full shrink-0',
                                                        Number(product.stock ?? 0) > 10
                                                            ? 'bg-emerald-500'
                                                            : Number(product.stock ?? 0) > 0
                                                              ? 'bg-amber-500'
                                                              : 'bg-red-500'
                                                    )}
                                                />
                                                {Number(product.stock ?? 0)} units
                                            </span>
                                        </DetailRow>
                                        <DetailRow label="Stock value">
                                            <span className="tabular-nums text-emerald-700">
                                                {formatProductDhAggregate(inv.totalValue)}
                                            </span>
                                        </DetailRow>
                                        <DetailRow label="Status">
                                            {isInactive ? (
                                                <span className="text-amber-700 font-bold">Hidden</span>
                                            ) : (
                                                <span className="text-emerald-700 font-bold">Active</span>
                                            )}
                                        </DetailRow>
                                    </DetailPanel>
                                )}
                            </div>
                        </div>

                        {product.description ? (
                            <div className="rounded-2xl border border-brand-navy/[0.08] bg-brand-navy/[0.02] p-4 sm:p-5">
                                <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40 mb-2">
                                    Description
                                </p>
                                <p className="text-sm text-brand-navy/80 font-medium leading-relaxed whitespace-pre-wrap">
                                    {product.description}
                                </p>
                            </div>
                        ) : null}
                    </div>
                </ScrollArea>

                <DialogFooter className="p-4 sm:p-6 sm:pt-2 shrink-0 border-t border-brand-navy/[0.06] bg-brand-white flex flex-row flex-nowrap items-center justify-end gap-1.5 overflow-x-auto">
                    {isAdmin && adminActions ? (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl h-9 px-3 text-xs font-bold shrink-0 border-brand-navy/20 bg-brand-white text-brand-navy hover:!bg-brand-navy/[0.08] hover:!text-brand-navy"
                                onClick={() => onOpenChange(false)}
                            >
                                Close
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                className="rounded-xl h-9 px-2.5 text-xs font-bold shrink-0 bg-brand-navy/[0.06] text-brand-navy hover:bg-brand-navy hover:text-white"
                                onClick={() => {
                                    adminActions.onEdit();
                                    onOpenChange(false);
                                }}
                            >
                                <Edit2 className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                                Edit
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                title="Clear stock"
                                className="rounded-xl h-9 px-2.5 text-xs font-bold shrink-0 bg-amber-500/10 text-amber-800 hover:bg-amber-500 hover:text-white"
                                onClick={() => {
                                    adminActions.onClearStock();
                                    onOpenChange(false);
                                }}
                            >
                                <RotateCcw className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                                Clear
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                className="rounded-xl h-9 px-2.5 text-xs font-bold shrink-0 bg-brand-navy/[0.06] text-brand-navy hover:bg-brand-navy hover:text-white"
                                disabled={adminActions.toggleActivePending}
                                onClick={() => adminActions.onToggleActive()}
                            >
                                <Power className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                                {product.active ? 'Deactivate' : 'Activate'}
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                className="rounded-xl h-9 px-2.5 text-xs font-bold shrink-0 bg-red-50 text-red-600 hover:bg-red-500 hover:text-white"
                                onClick={() => {
                                    adminActions.onDelete();
                                    onOpenChange(false);
                                }}
                            >
                                <Trash2 className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                                Delete
                            </Button>
                        </>
                    ) : (
                        <Button
                            type="button"
                            className="rounded-2xl h-12 px-10 font-bold bg-brand-navy text-white hover:bg-brand-navy/90 hover:text-white shadow-lg shadow-brand-navy/20"
                            onClick={() => onOpenChange(false)}
                        >
                            <Package className="w-4 h-4 mr-2 opacity-90" />
                            Close
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
