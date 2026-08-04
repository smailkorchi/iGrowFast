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
import { Edit2, Trash2, RotateCcw, Power, Puzzle, X } from 'lucide-react';
import { imageUrl } from '@/lib/imageUrl';

export type AccessoryPreviewRow = {
    id: string;
    name: string;
    code?: string | null;
    cost_price?: number | null;
    stock?: number | null;
    active?: boolean | null;
    image_url?: string | null;
};

export function formatAccessoryInventoryValueDh(
    accessory: Pick<AccessoryPreviewRow, 'stock' | 'cost_price'>,
): string {
    const value = Number(accessory.stock ?? 0) * Number(accessory.cost_price ?? 0);
    return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)} MAD`;
}

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
    const stockNum = Number(accessory.stock ?? 0);
    const stockTone = stockNum > 10
        ? { dot: 'bg-ant-green', text: 'text-ant-green', label: 'En stock' }
        : stockNum > 0
            ? { dot: 'bg-ant-orange', text: 'text-ant-orange', label: 'Stock faible' }
            : { dot: 'bg-ant-rose', text: 'text-ant-rose', label: 'Rupture' };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[min(100vw-2rem,42rem)] p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)] overflow-hidden flex flex-col max-h-[min(90vh,720px)]">
                {/* Orange stripe */}
                <div className="h-[3px] w-full bg-ant-orange shrink-0" />

                <DialogHeader className="px-6 pt-5 pb-4 shrink-0 text-left space-y-1.5 pr-12">
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                        Accessoire · Aperçu
                        {isInactive && (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-mid tracking-normal normal-case">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-mid" />
                                Désactivé
                            </span>
                        )}
                    </div>
                    <DialogTitle className="font-display text-[20px] sm:text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ant-ink">
                        {accessory.name}
                    </DialogTitle>
                    <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                        {isAdmin
                            ? 'Détails et actions rapides pour cet accessoire.'
                            : 'Fiche en lecture seule — accessoire lié à vos produits assignés.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 min-h-0 overflow-y-auto ant-scroll">
                    <div className="px-6 pb-6 space-y-4">
                        <div className="flex flex-col sm:flex-row gap-4 sm:gap-5">
                            {/* Image tile */}
                            <div className="relative w-full sm:w-[200px] shrink-0 aspect-square rounded-2xl border border-ant-line bg-ant-light overflow-hidden">
                                {accessory.image_url ? (
                                    <img
                                        src={imageUrl(accessory.image_url, 'card')}
                                        alt={accessory.name}
                                        className="absolute inset-0 h-full w-full object-cover"
                                    />
                                ) : (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-ant-mid">
                                        <Puzzle className="w-10 h-10" strokeWidth={1.5} />
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
                                <Row label="Code">{accessory.code || <span className="font-serif italic font-normal text-ant-mid">—</span>}</Row>

                                {isAdmin && (
                                    <div className="grid grid-cols-2 divide-x divide-ant-line">
                                        <div className="px-4 py-3">
                                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid mb-1">
                                                Prix d&apos;achat
                                            </p>
                                            <p className="font-display text-[14px] font-semibold text-ant-ink tabular-nums">
                                                {Number(accessory.cost_price ?? 0)}
                                                <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                                            </p>
                                        </div>
                                        <div className="px-4 py-3">
                                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid mb-1">
                                                Valeur totale
                                            </p>
                                            <p className="font-display text-[14px] font-semibold text-ant-green tabular-nums">
                                                {formatAccessoryInventoryValueDh(accessory)}
                                            </p>
                                        </div>
                                    </div>
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
                    </div>
                </div>

                {/* Footer */}
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
                                {accessory.active ? 'Désactiver' : 'Activer'}
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
