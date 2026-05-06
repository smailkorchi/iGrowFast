/* eslint-disable react-refresh/only-export-components */
import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Edit2, Trash2, RotateCcw, Power, Package, X } from 'lucide-react';

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
    return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)} MAD`;
}

export function productInventoryTotals(
    p: Pick<ProductPreviewRow, 'stock' | 'cost_price' | 'selling_price'>,
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
    variant: 'admin' | 'commercial';
    adminActions?: AdminActions;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-4 px-4 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid shrink-0">
                {label}
            </span>
            <div className="font-display text-[13px] font-semibold text-ant-ink text-right min-w-0 break-words tabular-nums">
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
        <div className="grid grid-cols-2 divide-x divide-ant-line">
            <div className="px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid mb-1">{leftLabel}</p>
                <p className="font-display text-[14px] font-semibold text-ant-ink tabular-nums">{leftValue}</p>
            </div>
            <div className="px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid mb-1">{rightLabel}</p>
                <p
                    className={cn(
                        'font-display text-[14px] font-semibold tabular-nums',
                        rightEmphasis ? 'text-ant-green' : 'text-ant-ink',
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
    const stockNum = Number(product.stock ?? 0);
    const stockTone = stockNum > 10
        ? { dot: 'bg-ant-green', text: 'text-ant-green', label: 'En stock' }
        : stockNum > 0
            ? { dot: 'bg-ant-orange', text: 'text-ant-orange', label: 'Stock faible' }
            : { dot: 'bg-ant-rose', text: 'text-ant-rose', label: 'Rupture' };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[min(100vw-2rem,44rem)] p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)] overflow-hidden flex flex-col max-h-[min(90vh,760px)]">
                <div className="h-[3px] w-full bg-ant-orange shrink-0" />

                <DialogHeader className="px-6 pt-5 pb-4 shrink-0 text-left space-y-1.5 pr-12">
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid flex-wrap">
                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                        Produit · Aperçu
                        {isInactive && (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-mid tracking-normal normal-case">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-mid" />
                                Désactivé
                            </span>
                        )}
                    </div>
                    <DialogTitle className="font-display text-[20px] sm:text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ant-ink">
                        {product.name}
                    </DialogTitle>
                    <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                        {isAdmin
                            ? 'Détails du produit et actions rapides.'
                            : 'Fiche en lecture seule pour votre produit assigné.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 min-h-0 overflow-y-auto ant-scroll">
                    <div className="px-6 pb-6 space-y-4">
                        <div className="flex flex-col sm:flex-row gap-4 sm:gap-5">
                            {/* Image tile */}
                            <div className="relative w-full sm:w-[220px] shrink-0 aspect-square rounded-2xl border border-ant-line bg-ant-light overflow-hidden">
                                {product.image_url ? (
                                    <img
                                        src={product.image_url}
                                        alt={product.name}
                                        className="absolute inset-0 h-full w-full object-cover"
                                    />
                                ) : (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-ant-mid">
                                        <Package className="w-10 h-10" strokeWidth={1.5} />
                                        <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">Sans image</span>
                                    </div>
                                )}
                                {isInactive && (
                                    <div className="absolute inset-0 bg-ant-ink/50 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
                                        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-white uppercase tracking-[0.14em]">
                                            <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
                                            Désactivé
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Detail panel */}
                            <div className="flex-1 min-w-0 rounded-2xl border border-ant-line bg-ant-paper overflow-hidden divide-y divide-ant-line">
                                <Row label="Code">{product.code || <span className="font-serif italic font-normal text-ant-mid">—</span>}</Row>

                                {isAdmin ? (
                                    <>
                                        <Row label="Label">
                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-mid tracking-[0.14em] uppercase">
                                                {product.label || 'Regular'}
                                            </span>
                                        </Row>
                                        <PricePair
                                            leftLabel="Prix d'achat"
                                            leftValue={<>{Number(product.cost_price ?? 0)} <span className="text-[10px] text-ant-mid font-normal">MAD</span></>}
                                            rightLabel="Prix de vente"
                                            rightValue={<>{Number(product.selling_price ?? 0)} <span className="text-[10px] text-ant-mid font-normal">MAD</span></>}
                                        />
                                        <PricePair
                                            leftLabel="Coût total"
                                            leftValue={formatProductDhAggregate(inv.totalCost)}
                                            rightLabel="Valeur totale"
                                            rightValue={formatProductDhAggregate(inv.totalValue)}
                                            rightEmphasis
                                        />
                                    </>
                                ) : (
                                    <>
                                        <Row label="Prix de vente">
                                            {Number(product.selling_price ?? 0)}
                                            <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                                        </Row>
                                        <Row label="Valeur du stock">
                                            <span className="text-ant-green">{formatProductDhAggregate(inv.totalValue)}</span>
                                        </Row>
                                    </>
                                )}

                                <Row label="Stock">
                                    <span className="inline-flex items-center gap-2">
                                        <span className={cn('h-1.5 w-1.5 rounded-full', stockTone.dot)} />
                                        <span className={stockTone.text}>{stockNum}</span>
                                        <span className="text-[11px] text-ant-mid font-normal">unités</span>
                                    </span>
                                </Row>

                                <Row label="Statut">
                                    {isInactive ? (
                                        <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-mid">
                                            <span className="h-1.5 w-1.5 rounded-full bg-ant-mid" />
                                            Masqué
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-green/25 bg-ant-green/10 px-2 py-0.5 text-[10px] font-semibold text-ant-green">
                                            <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                                            Actif
                                        </span>
                                    )}
                                </Row>

                                <Row label="Niveau de stock">
                                    <span className={cn('font-semibold', stockTone.text)}>{stockTone.label}</span>
                                </Row>
                            </div>
                        </div>

                        {product.description ? (
                            <div className="rounded-2xl border border-ant-line bg-ant-light p-4">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid mb-2">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                                    Description
                                </div>
                                <p className="text-[13px] text-ant-ink leading-relaxed whitespace-pre-wrap">
                                    {product.description}
                                </p>
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="shrink-0 border-t border-ant-line bg-ant-paper px-4 sm:px-6 py-3 flex flex-wrap items-center justify-end gap-2">
                    {isAdmin && adminActions ? (
                        <>
                            <button
                                type="button"
                                onClick={() => onOpenChange(false)}
                                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light text-[11px] font-semibold text-ant-ink cursor-pointer transition-colors"
                            >
                                <X className="w-3 h-3" strokeWidth={1.75} />
                                Fermer
                            </button>
                            <button
                                type="button"
                                onClick={() => { adminActions.onEdit(); onOpenChange(false); }}
                                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-ant-ink/15 bg-ant-ink/6 hover:bg-ant-ink hover:text-white text-[11px] font-semibold text-ant-ink cursor-pointer transition-colors"
                            >
                                <Edit2 className="w-3 h-3" strokeWidth={1.75} />
                                Modifier
                            </button>
                            <button
                                type="button"
                                onClick={() => { adminActions.onClearStock(); onOpenChange(false); }}
                                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-ant-orange/25 bg-ant-orange/10 hover:bg-ant-orange hover:text-white text-[11px] font-semibold text-ant-orange cursor-pointer transition-colors"
                                title="Vider le stock"
                            >
                                <RotateCcw className="w-3 h-3" strokeWidth={1.75} />
                                Vider
                            </button>
                            <button
                                type="button"
                                disabled={adminActions.toggleActivePending}
                                onClick={() => adminActions.onToggleActive()}
                                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-ant-ink/15 bg-ant-ink/6 hover:bg-ant-ink hover:text-white text-[11px] font-semibold text-ant-ink cursor-pointer transition-colors disabled:opacity-60"
                            >
                                <Power className="w-3 h-3" strokeWidth={1.75} />
                                {product.active ? 'Désactiver' : 'Activer'}
                            </button>
                            <button
                                type="button"
                                onClick={() => { adminActions.onDelete(); onOpenChange(false); }}
                                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-ant-rose/25 bg-ant-rose/10 hover:bg-ant-rose hover:text-white text-[11px] font-semibold text-ant-rose cursor-pointer transition-colors"
                            >
                                <Trash2 className="w-3 h-3" strokeWidth={1.75} />
                                Supprimer
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            onClick={() => onOpenChange(false)}
                            className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold cursor-pointer transition-colors"
                        >
                            <X className="w-3.5 h-3.5" strokeWidth={1.75} />
                            Fermer
                        </button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
