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
import {
    Edit2,
    Trash2,
    RotateCcw,
    Power,
    Image as ImageIcon,
    Package,
} from 'lucide-react';

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

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5 rounded-2xl bg-brand-navy/[0.03] border border-brand-navy/[0.06] p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/45">{label}</p>
            <div className="text-base font-bold text-brand-navy">{children}</div>
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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[min(100vw-2rem,32rem)] sm:max-w-2xl p-0 gap-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[min(90vh,680px)]">
                <DialogHeader className="p-8 pb-4 shrink-0 text-left space-y-2 pr-14">
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
                        {isAdmin ? 'Full product details and quick actions.' : 'Read-only details for your assigned product.'}
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="flex-1 min-h-0 max-h-[50vh]">
                    <div className="px-8 pb-6 space-y-6">
                        <div className="relative rounded-[28px] overflow-hidden bg-brand-navy/[0.04] border border-brand-navy/[0.06] aspect-[4/3] max-h-72 mx-auto">
                            {product.image_url ? (
                                <img
                                    src={product.image_url}
                                    alt={product.name}
                                    className="h-full w-full object-cover"
                                />
                            ) : (
                                <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-brand-navy/20">
                                    <ImageIcon className="w-16 h-16" />
                                    <span className="text-xs font-bold uppercase tracking-widest">No image</span>
                                </div>
                            )}
                            {isInactive && (
                                <div className="absolute inset-0 bg-brand-navy/35 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
                                    <Badge
                                        variant="secondary"
                                        className="bg-brand-white text-brand-navy font-bold text-xs px-4 py-1.5 rounded-full shadow-lg"
                                    >
                                        INACTIVE
                                    </Badge>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <Stat label="SKU / Code">{product.code || '—'}</Stat>
                            <Stat label="Label">
                                <Badge
                                    variant="outline"
                                    className="text-[10px] font-bold border-brand-navy/15 text-brand-navy/70 uppercase mt-0.5"
                                >
                                    {product.label || 'Regular'}
                                </Badge>
                            </Stat>
                        </div>

                        <div
                            className={cn(
                                'grid gap-3',
                                isAdmin ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'
                            )}
                        >
                            {isAdmin && (
                                <Stat label="Cost price">{Number(product.cost_price ?? 0)} DH</Stat>
                            )}
                            <Stat label="Selling price">{Number(product.selling_price ?? 0)} DH</Stat>
                            <Stat label="Stock">
                                <span className="flex items-center gap-2">
                                    <span
                                        className={cn(
                                            'w-2.5 h-2.5 rounded-full shrink-0',
                                            Number(product.stock ?? 0) > 10
                                                ? 'bg-emerald-500'
                                                : Number(product.stock ?? 0) > 0
                                                  ? 'bg-amber-500'
                                                  : 'bg-red-500'
                                        )}
                                    />
                                    {Number(product.stock ?? 0)} units
                                </span>
                            </Stat>
                        </div>

                        <Stat label="Status">
                            {isInactive ? (
                                <span className="text-amber-700">Hidden from order pickers</span>
                            ) : (
                                <span className="text-emerald-700">Active in catalog</span>
                            )}
                        </Stat>

                        {product.description ? (
                            <div className="space-y-2 rounded-2xl bg-brand-navy/[0.02] border border-brand-navy/[0.06] p-4">
                                <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/45">
                                    Description
                                </p>
                                <p className="text-sm text-brand-navy/80 font-medium leading-relaxed whitespace-pre-wrap">
                                    {product.description}
                                </p>
                            </div>
                        ) : null}
                    </div>
                </ScrollArea>

                <DialogFooter className="p-6 sm:p-8 pt-2 shrink-0 border-t border-brand-navy/[0.06] bg-brand-white flex flex-row flex-nowrap items-center justify-end gap-2 sm:space-x-0 overflow-x-auto [scrollbar-width:thin]">
                    {isAdmin && adminActions ? (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                className="rounded-2xl h-12 px-5 font-bold shrink-0 border-brand-navy/20 bg-brand-white text-brand-navy hover:!bg-brand-navy/[0.08] hover:!text-brand-navy"
                                onClick={() => onOpenChange(false)}
                            >
                                Close
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                className="rounded-2xl h-12 px-4 font-bold shrink-0 bg-brand-navy/[0.06] text-brand-navy hover:bg-brand-navy hover:text-white"
                                onClick={() => {
                                    adminActions.onEdit();
                                    onOpenChange(false);
                                }}
                            >
                                <Edit2 className="w-4 h-4 mr-2" />
                                Edit
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                className="rounded-2xl h-12 px-4 font-bold shrink-0 bg-amber-500/10 text-amber-800 hover:bg-amber-500 hover:text-white"
                                onClick={() => {
                                    adminActions.onClearStock();
                                    onOpenChange(false);
                                }}
                            >
                                <RotateCcw className="w-4 h-4 mr-2" />
                                Clear stock
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                className="rounded-2xl h-12 px-4 font-bold shrink-0 bg-brand-navy/[0.06] text-brand-navy hover:bg-brand-navy hover:text-white"
                                disabled={adminActions.toggleActivePending}
                                onClick={() => adminActions.onToggleActive()}
                            >
                                <Power className="w-4 h-4 mr-2" />
                                {product.active ? 'Deactivate' : 'Activate'}
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                className="rounded-2xl h-12 px-4 font-bold shrink-0 bg-red-50 text-red-600 hover:bg-red-500 hover:text-white"
                                onClick={() => {
                                    adminActions.onDelete();
                                    onOpenChange(false);
                                }}
                            >
                                <Trash2 className="w-4 h-4 mr-2" />
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
