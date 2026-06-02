import { useRef, useState, useCallback } from 'react';
import { UploadCloud, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    parseSpreadsheet,
    matchTrackingColumn,
    type TrackingImportOrder,
    type TrackingImportResult,
} from '@/lib/orderTrackingImport';

type Props = {
    /** Available orders reduced to their matchable tracking codes. */
    orders: TrackingImportOrder[];
    totalAvailable: number;
    /** Current number of selected orders (for the live stats line). */
    selectedCount: number;
    /** Apply the import. The parent decides replace-vs-add (see wizard wiring). */
    onApply: (matchedOrderIds: string[]) => void;
    className?: string;
};

const ACCEPT = '.csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';

/**
 * Drop a provider's exported CSV/Excel; we auto-detect the tracking-number column,
 * match it against the available orders and hand the matched ids to the parent.
 * Shows import stats (imported / matched / not found / selected / remaining).
 */
export function OrderTrackingImport({ orders, totalAvailable, selectedCount, onApply, className }: Props) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<(TrackingImportResult & { fileName: string }) | null>(null);
    const [showNotFound, setShowNotFound] = useState(false);

    const handleFile = useCallback(async (file: File) => {
        setError(null);
        setShowNotFound(false);
        setBusy(true);
        setResult(null);
        try {
            const rows = await parseSpreadsheet(file);
            if (!rows.length) {
                setError('Le fichier est vide.');
                return;
            }
            const res = matchTrackingColumn(rows, orders);
            setResult({ ...res, fileName: file.name });
            if (res.detectedColumn === null || res.matchedOrderIds.length === 0) {
                setError('Aucune colonne de numéros de suivi reconnue — vérifiez que le fichier contient les codes de suivi.');
                return;
            }
            onApply(res.matchedOrderIds);
        } catch (_) {
            setError('Impossible de lire le fichier. Formats acceptés : CSV, XLSX, XLS.');
        } finally {
            setBusy(false);
        }
    }, [orders, onApply]);

    const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (f) handleFile(f);
        e.target.value = '';
    };

    const reset = () => { setResult(null); setError(null); setShowNotFound(false); };

    const remaining = Math.max(0, totalAvailable - selectedCount);
    const hasMatch = !!result && result.matchedOrderIds.length > 0;

    return (
        <div className={cn('space-y-2', className)}>
            <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={onInputChange} />

            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) handleFile(f);
                }}
                className={cn(
                    'w-full rounded-xl border border-dashed px-4 py-3 flex items-center gap-3 text-left transition-colors cursor-pointer',
                    dragging ? 'border-ant-orange bg-ant-orange/5' : 'border-ant-line bg-ant-light/40 hover:border-ant-ink/25',
                )}
            >
                <span className="w-9 h-9 rounded-lg bg-ant-orange/10 flex items-center justify-center shrink-0">
                    {busy ? <Loader2 className="w-4 h-4 text-ant-orange animate-spin" /> : <UploadCloud className="w-4 h-4 text-ant-orange" />}
                </span>
                <span className="min-w-0">
                    <span className="block text-[12px] font-semibold text-ant-ink">
                        Importer un fichier exporté (CSV / Excel)
                    </span>
                    <span className="block text-[11px] text-ant-muted truncate">
                        Glissez-déposez ou cliquez — on détecte la colonne des numéros de suivi et présélectionne.
                    </span>
                </span>
            </button>

            {error && (
                <div className="flex items-start gap-2 rounded-xl border border-ant-rose/30 bg-ant-rose/[0.06] px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-ant-rose shrink-0 mt-0.5" />
                    <p className="text-[11px] font-medium text-ant-rose">{error}</p>
                </div>
            )}

            {result && hasMatch && (
                <div className="rounded-xl border border-ant-line bg-ant-paper px-3 py-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                        <FileSpreadsheet className="w-3.5 h-3.5 text-ant-ink/60 shrink-0" />
                        <span className="text-[11px] font-semibold text-ant-ink truncate flex-1">{result.fileName}</span>
                        <button type="button" onClick={reset} className="w-5 h-5 rounded-md hover:bg-ant-line-soft flex items-center justify-center text-ant-mid shrink-0" aria-label="Effacer">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                        <Stat label="Importés" value={result.rowsImported} />
                        <Stat label="Présélectionnés" value={result.matchedOrderIds.length} tone="ink" icon />
                        <Stat label="Introuvables" value={result.notFound.length} tone={result.notFound.length ? 'rose' : 'muted'} />
                        <Stat label="Sélectionnés" value={`${selectedCount}/${totalAvailable}`} />
                        <Stat label="Restants" value={remaining} />
                        <Stat label="Match" value={result.matchedValues} />
                    </div>
                    {result.notFound.length > 0 && (
                        <div>
                            <button type="button" onClick={() => setShowNotFound(v => !v)} className="text-[10.5px] font-semibold text-ant-rose hover:underline">
                                {showNotFound ? 'Masquer' : 'Voir'} les {result.notFound.length} numéro(s) sans commande
                            </button>
                            {showNotFound && (
                                <div className="mt-1 max-h-24 overflow-y-auto rounded-lg bg-ant-light/60 p-2 text-[10px] font-mono text-ant-muted leading-relaxed break-all">
                                    {result.notFound.slice(0, 200).join(' · ')}
                                    {result.notFound.length > 200 && ` … (+${result.notFound.length - 200})`}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function Stat({ label, value, tone = 'default', icon }: { label: string; value: number | string; tone?: 'default' | 'ink' | 'rose' | 'muted'; icon?: boolean }) {
    const color = tone === 'ink' ? 'text-ant-ink' : tone === 'rose' ? 'text-ant-rose' : tone === 'muted' ? 'text-ant-mid' : 'text-ant-ink/80';
    return (
        <div className="rounded-lg bg-ant-light/50 px-2 py-1.5 text-center">
            <div className={cn('text-[13px] font-bold tabular-nums inline-flex items-center gap-1', color)}>
                {icon && <CheckCircle2 className="w-3 h-3" />}{value}
            </div>
            <div className="text-[8.5px] font-semibold uppercase tracking-[0.12em] text-ant-mid mt-0.5">{label}</div>
        </div>
    );
}
