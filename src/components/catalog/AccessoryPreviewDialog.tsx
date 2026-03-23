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
import { Edit2, Trash2, RotateCcw, Power, Puzzle } from 'lucide-react';

export type AccessoryPreviewRow = {
    id: string;
    name: string;
    code?: string | null;
    cost_price?: number | null;
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

export type AccessoryPreviewDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    accessory: AccessoryPreviewRow | null;
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

export function AccessoryPreviewDialog({
    open,
    onOpenChange,
    accessory,
    variant,
    adminActions,
}: AccessoryPreviewDialogProps) {
    if (!accessory) return null;

    const isInactive = accessory.active === false;
    const isAdmin = variant === 'admin';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[min(100vw-2rem,32rem)] sm:max-w-2xl p-0 gap-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[min(90vh,680px)]">
                <DialogHeader className="p-8 pb-4 shrink-0 text-left space-y-2 pr-14">
                    <div className="flex flex-wrap items-center gap-2">
                        <DialogTitle className="text-2xl sm:text-3xl font-bold text-brand-navy leading-tight">
                            {accessory.name}
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
                        {isAdmin ? 'Accessory details and quick actions.' : 'Read-only details for a catalog accessory linked to your products.'}
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="flex-1 min-h-0 max-h-[50vh]">
                    <div className="px-8 pb-6 space-y-6">
                        <div className="relative rounded-[28px] overflow-hidden bg-brand-navy/[0.04] border border-brand-navy/[0.06] aspect-[4/3] max-h-72 mx-auto">
                            {accessory.image_url ? (
                                <img
                                    src={accessory.image_url}
                                    alt={accessory.name}
                                    className="h-full w-full object-cover"
                                />
                            ) : (
                                <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-brand-navy/20">
                                    <Puzzle className="w-16 h-16" />
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

                        {isAdmin ? (
                            <>
                                <div className="grid grid-cols-2 gap-3">
                                    <Stat label="Code">{accessory.code || '—'}</Stat>
                                    <Stat label="Cost price">{Number(accessory.cost_price ?? 0)} DH</Stat>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <Stat label="Stock">
                                        <span className="flex items-center gap-2">
                                            <span
                                                className={cn(
                                                    'w-2.5 h-2.5 rounded-full shrink-0',
                                                    Number(accessory.stock ?? 0) > 10
                                                        ? 'bg-emerald-500'
                                                        : Number(accessory.stock ?? 0) > 0
                                                          ? 'bg-amber-500'
                                                          : 'bg-red-500'
                                                )}
                                            />
                                            {Number(accessory.stock ?? 0)} units
                                        </span>
                                    </Stat>
                                    <Stat label="Status">
                                        {isInactive ? (
                                            <span className="text-amber-700">Hidden from pickers</span>
                                        ) : (
                                            <span className="text-emerald-700">Active</span>
                                        )}
                                    </Stat>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 gap-3">
                                    <Stat label="Code">{accessory.code || '—'}</Stat>
                                    <Stat label="Stock">
                                        <span className="flex items-center gap-2">
                                            <span
                                                className={cn(
                                                    'w-2.5 h-2.5 rounded-full shrink-0',
                                                    Number(accessory.stock ?? 0) > 10
                                                        ? 'bg-emerald-500'
                                                        : Number(accessory.stock ?? 0) > 0
                                                          ? 'bg-amber-500'
                                                          : 'bg-red-500'
                                                )}
                                            />
                                            {Number(accessory.stock ?? 0)} units
                                        </span>
                                    </Stat>
                                </div>
                                <Stat label="Status">
                                    {isInactive ? (
                                        <span className="text-amber-700">Hidden from pickers</span>
                                    ) : (
                                        <span className="text-emerald-700">Active</span>
                                    )}
                                </Stat>
                            </>
                        )}
                    </div>
                </ScrollArea>

                <DialogFooter className="p-6 sm:p-8 pt-2 shrink-0 border-t border-brand-navy/[0.06] bg-brand-white flex flex-row flex-wrap items-center justify-end gap-2">
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
                                {accessory.active ? 'Deactivate' : 'Activate'}
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
                            <Puzzle className="w-4 h-4 mr-2 opacity-90" />
                            Close
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
