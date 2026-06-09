import React, { useState, useCallback, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Download,
    Upload,
    FileSpreadsheet,
    CheckCircle2,
    AlertCircle,
    Loader2,
    ArrowRight,
    Search,
    ChevronLeft,
    ChevronRight,
    Trash2,
    Database,
    X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';

const PAGE_SIZE = 500;
const TEMPLATE_URL = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/documents/Accessories%20Model.xlsx`;

interface RawRow {
    [key: string]: unknown;
}

interface MappedAccessory {
    id: string;
    name: string;
    code: string;
    cost_price: number;
    stock: number;
    active: boolean;
    image_url: string;
    status: 'valid' | 'invalid';
    errors: string[];
    existing_id: string | null;
}

function normalizeHeaderKey(key: string): string {
    return String(key)
        .replace(/^\ufeff/, '')
        .replace(/\u00a0/g, ' ')
        .replace(/\uff0f/g, '/')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function pickByHeader(row: RawRow, candidates: string[]): unknown {
    const map = new Map<string, unknown>();
    for (const [k, v] of Object.entries(row)) {
        map.set(normalizeHeaderKey(k), v);
    }
    for (const c of candidates) {
        const nk = normalizeHeaderKey(c);
        if (!map.has(nk)) continue;
        const v = map.get(nk);
        if (v === undefined || v === null) continue;
        return v;
    }
    return undefined;
}

function parseMoney(raw: unknown): number {
    if (raw === undefined || raw === null || raw === '') return 0;
    let s = String(raw).trim().replace(/\s/g, '');
    s = s.replace(/[^0-9.,-]/g, '');
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && (lastDot === -1 || lastComma > lastDot)) {
        s = s.replace(/\./g, '').replace(',', '.');
    } else {
        s = s.replace(/,/g, '');
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
}

function parseIntSafe(raw: unknown, fallback: number): number {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const n = parseInt(String(raw).replace(/[^0-9-]/g, ''), 10);
    return Number.isFinite(n) ? n : fallback;
}

function parseActive(raw: unknown, defaultTrue: boolean): boolean {
    if (raw === undefined || raw === null || raw === '') return defaultTrue;
    const s = String(raw).toLowerCase().trim();
    if (['no', 'false', '0', 'non', 'inactive'].includes(s)) return false;
    if (['yes', 'true', '1', 'oui', 'active'].includes(s)) return true;
    return defaultTrue;
}

const ImportAccessories = () => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [file, setFile] = useState<File | null>(null);
    const [data, setData] = useState<MappedAccessory[]>([]);
    const [isParsing, setIsParsing] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const { data: accessories } = useQuery({
        queryKey: ['accessories', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('accessories')
                .select('id, code')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        },
    });

    const uploadMutation = useMutation({
        mutationFn: async (rows: MappedAccessory[]) => {
            if (!activeBusinessId) throw new Error('No active business');
            const valid = rows.filter((r) => r.status === 'valid');
            const total = valid.length;
            let completed = 0;

            for (const r of valid) {
                const payload = {
                    name: r.name.trim(),
                    code: r.code.trim(),
                    cost_price: r.cost_price,
                    stock: r.stock,
                    active: r.active,
                    image_url: r.image_url.trim() || null,
                    'DigiCom Business': activeBusinessId,
                };

                if (r.existing_id) {
                    const { error } = await supabase
                        .from('accessories')
                        .update(payload)
                        .eq('id', r.existing_id);
                    if (error) console.error('Accessory update failed', r.code, error);
                } else {
                    const { error } = await supabase.from('accessories').insert(payload);
                    if (error) console.error('Accessory insert failed', r.code, error);
                }

                completed++;
                setUploadProgress(total ? Math.round((completed / total) * 100) : 0);
            }
        },
        onSuccess: () => {
            toast({
                title: 'Import finished',
                description: `Processed ${data.filter((d) => d.status === 'valid').length} accessory rows.`,
            });
            queryClient.invalidateQueries({ queryKey: ['accessories'] });
            setData([]);
            setFile(null);
            setUploadProgress(0);
        },
        onError: (error: Error) => {
            toast({ title: 'Import failed', description: error.message, variant: 'destructive' });
            setUploadProgress(0);
        },
    });

    const handleFileDrop = useCallback(
        async (acceptedFiles: File[]) => {
            const selectedFile = acceptedFiles[0];
            if (!selectedFile) return;

            setFile(selectedFile);
            setIsParsing(true);
            setData([]);

            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const buffer = reader.result;
                    const workbook = XLSX.read(buffer, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rawData = XLSX.utils.sheet_to_json(firstSheet, {
                        defval: '',
                        raw: false,
                    }) as RawRow[];

                    const codeToId = new Map<string, string>();
                    (accessories || []).forEach((a) => {
                        if (a.code) codeToId.set(String(a.code).trim().toLowerCase(), a.id);
                    });

                    const seenInFile = new Set<string>();
                    const mapped: MappedAccessory[] = rawData.map((row, idx) => {
                        const name = String(
                            pickByHeader(row, [
                                'Accessori Name',
                                'Accessory Name',
                                'Accessories Name',
                                'Name',
                                'Nom',
                            ]) ?? ''
                        ).trim();
                        const code = String(
                            pickByHeader(row, [
                                'SKU / Code',
                                'SKU/Code',
                                'Code',
                                'SKU',
                                'Accessory Code',
                            ]) ?? ''
                        ).trim();
                        const cost_price = parseMoney(
                            pickByHeader(row, [
                                'Cost Price (DH)',
                                'Cost Price',
                                'Cost',
                                'Prix',
                                'Coût',
                            ])
                        );
                        const stock = parseIntSafe(
                            pickByHeader(row, ['Stock', 'Qty', 'Quantité', 'Quantity']),
                            0
                        );
                        const active = parseActive(
                            pickByHeader(row, [
                                'Active(TRUE/FALSE)',
                                'Active (TRUE/FALSE)',
                                'Active',
                                'Actif',
                            ]),
                            true
                        );
                        const image_url = String(
                            pickByHeader(row, ['Image URL', 'Image', 'URL']) ?? ''
                        ).trim();

                        const errors: string[] = [];
                        if (!name) errors.push('Name is missing');
                        if (!code) errors.push('Code is missing');

                        const ck = code.toLowerCase();
                        if (ck && seenInFile.has(ck)) errors.push('Duplicate code in file');
                        else if (ck) seenInFile.add(ck);

                        const existing_id = ck ? codeToId.get(ck) ?? null : null;

                        return {
                            id: `row-${idx}`,
                            name,
                            code,
                            cost_price,
                            stock,
                            active,
                            image_url,
                            status: errors.length === 0 ? 'valid' : 'invalid',
                            errors,
                            existing_id,
                        };
                    });

                    setData(mapped);
                    setIsParsing(false);
                    toast({ title: 'File parsed', description: `Found ${mapped.length} rows.` });
                } catch (e) {
                    console.error(e);
                    setIsParsing(false);
                    toast({
                        title: 'Parsing error',
                        description: 'Could not read the Excel file.',
                        variant: 'destructive',
                    });
                }
            };
            reader.readAsArrayBuffer(selectedFile);
        },
        [accessories, toast]
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop: handleFileDrop,
        accept: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
            'application/vnd.ms-excel': ['.xls'],
        },
        multiple: false,
    });

    const filteredData = useMemo(() => {
        const q = searchQuery.toLowerCase();
        return data.filter(
            (item) =>
                item.name.toLowerCase().includes(q) ||
                item.code.toLowerCase().includes(q)
        );
    }, [data, searchQuery]);

    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return filteredData.slice(start, start + PAGE_SIZE);
    }, [filteredData, currentPage]);

    const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);
    const validCount = data.filter((d) => d.status === 'valid').length;

    const errorCount = data.length - validCount;

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Data · Accessoires
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Import Accessories
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Les accessoires d&apos;abord, les produits ensuite. Upsert par code, stock calibré, liaisons prêtes à monter sur la prochaine référence catalogue.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => window.open(TEMPLATE_URL, '_blank')}
                        className="inline-flex items-center gap-2 h-10 px-4 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light text-[12px] font-semibold text-ant-ink cursor-pointer shrink-0 transition-colors"
                    >
                        <Download className="w-3.5 h-3.5" strokeWidth={1.75} />
                        Télécharger le modèle Excel
                    </button>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <section className={cn(
                        'lg:col-span-2 rounded-2xl border bg-ant-paper overflow-hidden transition-colors',
                        isDragActive ? 'border-ant-orange bg-ant-orange/5' : 'border-ant-line'
                    )}>
                        <div className={cn('h-[3px] w-full', isDragActive ? 'bg-ant-orange' : 'bg-ant-ink')} />
                        <div className="p-5 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">01</span>
                                    Dépôt du fichier
                                </div>
                                <span className="font-serif italic text-[11px] text-ant-mid">Excel XLSX · XLS</span>
                            </div>
                            <div
                                {...getRootProps()}
                                className={cn(
                                    'rounded-xl border border-dashed p-8 flex flex-col items-center justify-center min-h-[220px] cursor-pointer transition-colors',
                                    isDragActive
                                        ? 'border-ant-orange bg-ant-orange/5'
                                        : 'border-ant-line bg-ant-light hover:bg-ant-light/70 hover:border-ant-mid/40'
                                )}
                            >
                                <input {...getInputProps()} />
                                {isParsing ? (
                                    <div className="text-center space-y-2">
                                        <Loader2 className="w-6 h-6 text-ant-ink animate-spin mx-auto" strokeWidth={1.5} />
                                        <p className="font-display text-[14px] font-semibold text-ant-ink">Analyse du fichier…</p>
                                        <p className="font-serif italic text-[12px] text-ant-mid">Extraction des lignes accessoire.</p>
                                    </div>
                                ) : file && data.length > 0 ? (
                                    <div className="text-center space-y-2.5 max-w-sm">
                                        <div className="h-10 w-10 rounded-xl border border-ant-green/25 bg-ant-green/10 text-ant-green flex items-center justify-center mx-auto">
                                            <CheckCircle2 className="w-4 h-4" strokeWidth={1.75} />
                                        </div>
                                        <p className="font-display text-[14px] font-semibold text-ant-ink truncate max-w-[280px] mx-auto">{file.name}</p>
                                        <p className="font-serif italic text-[12px] text-ant-mid">{data.length} lignes détectées</p>
                                        <div className="flex items-center justify-center gap-2 flex-wrap">
                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-green/25 bg-ant-green/10 px-2 py-0.5 text-[10px] font-semibold text-ant-green">
                                                <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                                                {validCount} prêtes
                                            </span>
                                            {errorCount > 0 && (
                                                <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-rose/25 bg-ant-rose/10 px-2 py-0.5 text-[10px] font-semibold text-ant-rose">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                                                    {errorCount} erreurs
                                                </span>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); setFile(null); setData([]); }}
                                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-rose/10 hover:border-ant-rose/25 text-[11px] font-semibold text-ant-rose cursor-pointer transition-colors"
                                        >
                                            <Trash2 className="w-3 h-3" strokeWidth={1.75} />
                                            Retirer le fichier
                                        </button>
                                    </div>
                                ) : (
                                    <div className="text-center space-y-2">
                                        <div className="h-10 w-10 rounded-xl border border-ant-line bg-ant-paper text-ant-mid flex items-center justify-center mx-auto">
                                            <Upload className="w-4 h-4" strokeWidth={1.75} />
                                        </div>
                                        <p className="font-display text-[14px] font-semibold text-ant-ink">Glissez votre Excel ici</p>
                                        <p className="font-serif italic text-[12px] text-ant-mid">ou cliquez pour parcourir votre poste.</p>
                                        <div className="flex items-center justify-center gap-4 pt-1">
                                            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                                                <FileSpreadsheet className="w-3 h-3" strokeWidth={1.75} /> XLSX
                                            </span>
                                            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                                                <FileSpreadsheet className="w-3 h-3" strokeWidth={1.75} /> XLS
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>

                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="p-5 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">02</span>
                                    Upsert par code
                                </div>
                                <Database className="w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                            </div>
                            <p className="font-serif italic text-[12px] text-ant-mid leading-relaxed">
                                Les codes existants sont mis à jour. Les nouveaux codes sont créés. Importez les accessoires avant de lier les produits.
                            </p>
                            <div className="space-y-2">
                                {['Nom + code requis', 'Prix d\u2019achat et stock', 'URL d\u2019image optionnelle'].map((t) => (
                                    <div key={t} className="flex items-start gap-2.5">
                                        <div className="h-5 w-5 rounded-md border border-ant-green/25 bg-ant-green/10 text-ant-green flex items-center justify-center shrink-0 mt-px">
                                            <CheckCircle2 className="w-2.5 h-2.5" strokeWidth={2} />
                                        </div>
                                        <p className="text-[11px] text-ant-ink leading-relaxed">{t}</p>
                                    </div>
                                ))}
                            </div>
                            <div className="pt-3 border-t border-ant-line">
                                {uploadProgress > 0 ? (
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-baseline">
                                            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Sync en cours</span>
                                            <span className="font-display text-[14px] font-semibold tabular-nums text-ant-ink">{uploadProgress}%</span>
                                        </div>
                                        <Progress value={uploadProgress} className="h-1.5" />
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        disabled={
                                            data.length === 0 ||
                                            validCount === 0 ||
                                            !activeBusinessId ||
                                            uploadMutation.isPending
                                        }
                                        onClick={() => uploadMutation.mutate(data.filter((d) => d.status === 'valid'))}
                                        className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-full bg-ant-ink hover:bg-ant-ink/90 disabled:bg-ant-mid/40 disabled:cursor-not-allowed text-white text-[12px] font-semibold cursor-pointer transition-colors"
                                    >
                                        {uploadMutation.isPending ? (
                                            <><Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.75} /> Traitement…</>
                                        ) : (
                                            <>Importer {validCount} lignes <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.75} /></>
                                        )}
                                    </button>
                                )}
                            </div>
                        </div>
                    </section>
                </div>

                {data.length > 0 && (
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-green" />
                        <div className="px-5 py-4 flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-ant-line">
                            <div className="space-y-1">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">03</span>
                                    Prévisualisation
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="font-display text-[16px] font-semibold text-ant-ink tabular-nums">{filteredData.length}</span>
                                    <span className="font-serif italic text-[12px] text-ant-mid">
                                        {filteredData.length > 1 ? 'lignes filtrées' : 'ligne filtrée'}
                                    </span>
                                </div>
                            </div>
                            <div className="relative w-full md:w-72">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                                <Input
                                    placeholder="Rechercher code ou nom…"
                                    className="pl-9 h-9 rounded-full border-ant-line bg-ant-paper text-[12px] focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-ant-light hover:bg-ant-light border-ant-line">
                                        <TableHead className="text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold py-2.5 pl-5">Code</TableHead>
                                        <TableHead className="text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold py-2.5">Nom</TableHead>
                                        <TableHead className="text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold py-2.5">Prix / Stock</TableHead>
                                        <TableHead className="text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold py-2.5">Opération</TableHead>
                                        <TableHead className="text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold py-2.5">Statut</TableHead>
                                        <TableHead className="py-2.5 pr-5 w-10" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedData.map((row) => (
                                        <TableRow key={row.id} className="hover:bg-ant-light/40 transition-colors border-ant-line">
                                            <TableCell className="pl-5 py-3 font-display text-[13px] font-semibold text-ant-ink tabular-nums">{row.code}</TableCell>
                                            <TableCell className="py-3 text-[12px] text-ant-ink font-medium">{row.name}</TableCell>
                                            <TableCell className="py-3">
                                                <div className="font-display text-[12px] font-semibold tabular-nums text-ant-ink">
                                                    {row.cost_price} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                                </div>
                                                <div className="font-serif italic text-[11px] text-ant-mid tabular-nums">{row.stock} unités</div>
                                            </TableCell>
                                            <TableCell className="py-3">
                                                {row.existing_id ? (
                                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-orange/25 bg-ant-orange/10 px-2 py-0.5 text-[10px] font-semibold text-ant-orange">
                                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                                        Update
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-ink/15 bg-ant-ink/6 px-2 py-0.5 text-[10px] font-semibold text-ant-ink">
                                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                                                        Create
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell className="py-3">
                                                {row.status === 'valid' ? (
                                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-green/25 bg-ant-green/10 px-2 py-0.5 text-[10px] font-semibold text-ant-green">
                                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                                                        Valide
                                                    </span>
                                                ) : (
                                                    <div className="space-y-1">
                                                        <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-rose/25 bg-ant-rose/10 px-2 py-0.5 text-[10px] font-semibold text-ant-rose">
                                                            <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                                                            Invalide
                                                        </span>
                                                        <p className="font-serif italic text-[10px] text-ant-rose/80 flex items-start gap-1">
                                                            <AlertCircle className="w-2.5 h-2.5 shrink-0 mt-0.5" strokeWidth={1.75} />
                                                            {row.errors[0]}
                                                        </p>
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="py-3 pr-5">
                                                <button
                                                    type="button"
                                                    onClick={() => setData((prev) => prev.filter((d) => d.id !== row.id))}
                                                    aria-label="Retirer"
                                                    className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-ant-line bg-ant-paper hover:bg-ant-rose/10 hover:border-ant-rose/25 text-ant-mid hover:text-ant-rose cursor-pointer transition-colors"
                                                >
                                                    <X className="w-3.5 h-3.5" strokeWidth={1.75} />
                                                </button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        {totalPages > 1 && (
                            <div className="px-5 py-3 border-t border-ant-line flex items-center justify-between bg-ant-light/50">
                                <span className="font-serif italic text-[11px] text-ant-mid">
                                    Page {currentPage} sur {totalPages}
                                </span>
                                <div className="flex gap-1">
                                    <button
                                        type="button"
                                        disabled={currentPage === 1}
                                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                        aria-label="Précédente"
                                        className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-ant-line bg-ant-paper hover:bg-ant-light disabled:opacity-40 disabled:cursor-not-allowed text-ant-ink cursor-pointer transition-colors"
                                    >
                                        <ChevronLeft className="w-3.5 h-3.5" strokeWidth={1.75} />
                                    </button>
                                    <button
                                        type="button"
                                        disabled={currentPage === totalPages}
                                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                        aria-label="Suivante"
                                        className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-ant-line bg-ant-paper hover:bg-ant-light disabled:opacity-40 disabled:cursor-not-allowed text-ant-ink cursor-pointer transition-colors"
                                    >
                                        <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.75} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </section>
                )}
            </div>
        </div>
    );
};

export default ImportAccessories;
