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
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
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
const TEMPLATE_URL = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/documents/Products%20Model.xlsx`;

interface RawRow {
    [key: string]: unknown;
}

interface MappedProduct {
    id: string;
    name: string;
    code: string;
    label: string;
    description: string;
    cost_price: number;
    selling_price: number;
    stock: number;
    active: boolean;
    image_url: string;
    accessory_codes_raw: string;
    resolved_accessory_ids: string[];
    status: 'valid' | 'invalid';
    errors: string[];
    existing_product_id: string | null;
}

function parseMoney(raw: unknown): number {
    if (raw === undefined || raw === null || raw === '') return 0;
    const n = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
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

function splitAccessoryCodes(raw: unknown): string[] {
    const s = String(raw ?? '').trim();
    if (!s) return [];
    return s
        .split(/[,;]/)
        .map((p) => p.trim())
        .filter(Boolean);
}

/** Match sheet headers with trim, NBSP, BOM, and fullwidth slash — Excel keys are literal first-row text. */
function normalizeHeaderKey(key: string): string {
    return String(key)
        .replace(/^\ufeff/, '')
        .replace(/\u00a0/g, ' ')
        .replace(/\uff0f/g, '/')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/** First column in `candidates` order that exists on the row (key match after normalization). */
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

function cellToText(v: unknown): string {
    if (v === undefined || v === null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (v instanceof Date) return v.toISOString();
    return String(v);
}

/** Description column names vary; also match headers containing "description" / "détail". */
function pickLongText(row: RawRow, candidates: string[], fuzzySubstrings: string[]): string {
    const direct = pickByHeader(row, candidates);
    const t = cellToText(direct).trim();
    if (t) return t;

    for (const [k, v] of Object.entries(row)) {
        const nk = normalizeHeaderKey(k);
        if (!fuzzySubstrings.some((sub) => nk.includes(sub))) continue;
        const s = cellToText(v).trim();
        if (s) return s;
    }
    return '';
}

const ImportProducts = () => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [file, setFile] = useState<File | null>(null);
    const [data, setData] = useState<MappedProduct[]>([]);
    const [isParsing, setIsParsing] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const { data: products } = useQuery({
        queryKey: ['products-import-codes', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('products')
                .select('id, code')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        },
    });

    const { data: accessories } = useQuery({
        queryKey: ['accessories-import-resolve', activeBusinessId],
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
        mutationFn: async (rows: MappedProduct[]) => {
            if (!activeBusinessId) throw new Error('No active business');
            const valid = rows.filter((r) => r.status === 'valid');
            const total = valid.length;
            let completed = 0;

            for (const r of valid) {
                const payload = {
                    name: r.name.trim(),
                    code: r.code.trim(),
                    label: r.label.trim() || null,
                    description:
                        r.description.trim().length > 0 ? r.description.trim() : null,
                    cost_price: r.cost_price,
                    selling_price: r.selling_price,
                    stock: r.stock,
                    active: r.active,
                    image_url: r.image_url.trim() || null,
                    'DigiCom Business': activeBusinessId,
                };

                let productId: string;

                if (r.existing_product_id) {
                    const { error } = await supabase
                        .from('products')
                        .update(payload)
                        .eq('id', r.existing_product_id);
                    if (error) {
                        console.error('Product update failed', r.code, error);
                        completed++;
                        setUploadProgress(total ? Math.round((completed / total) * 100) : 0);
                        continue;
                    }
                    productId = r.existing_product_id;
                } else {
                    const { data: inserted, error } = await supabase
                        .from('products')
                        .insert(payload)
                        .select('id')
                        .single();
                    if (error || !inserted) {
                        console.error('Product insert failed', r.code, error);
                        completed++;
                        setUploadProgress(total ? Math.round((completed / total) * 100) : 0);
                        continue;
                    }
                    productId = inserted.id;
                }

                await supabase
                    .from('product_accessories')
                    .delete()
                    .eq('product_id', productId)
                    .eq('DigiCom Business', activeBusinessId);

                if (r.resolved_accessory_ids.length > 0) {
                    const inserts = r.resolved_accessory_ids.map((accessory_id) => ({
                        product_id: productId,
                        accessory_id,
                        default_quantity: 1,
                        'DigiCom Business': activeBusinessId,
                    }));
                    const { error: paError } = await supabase.from('product_accessories').insert(inserts);
                    if (paError) console.error('product_accessories insert', productId, paError);
                }

                completed++;
                setUploadProgress(total ? Math.round((completed / total) * 100) : 0);
            }
        },
        onSuccess: () => {
            toast({
                title: 'Import finished',
                description: `Processed ${data.filter((d) => d.status === 'valid').length} product rows.`,
            });
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['products-import-codes'] });
            queryClient.invalidateQueries({ queryKey: ['product-accessories'] });
            queryClient.invalidateQueries({ queryKey: ['product-accessories-import'] });
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

                    const productCodeToId = new Map<string, string>();
                    (products || []).forEach((p) => {
                        if (p.code) productCodeToId.set(String(p.code).trim().toLowerCase(), p.id);
                    });

                    const accessoryCodeToId = new Map<string, string>();
                    (accessories || []).forEach((a) => {
                        if (a.code) accessoryCodeToId.set(String(a.code).trim().toLowerCase(), a.id);
                    });

                    const seenProductCodes = new Set<string>();
                    const mapped: MappedProduct[] = rawData.map((row, idx) => {
                        const name = String(
                            pickByHeader(row, [
                                'Product Name',
                                'Name',
                                'Nom',
                                'Product',
                            ]) ?? ''
                        ).trim();
                        const code = String(
                            pickByHeader(row, [
                                'SKU / Code',
                                'SKU/Code',
                                'SKU Code',
                                'Code',
                                'SKU',
                                'Product SKU',
                                'Product Code',
                            ]) ?? ''
                        ).trim();
                        const label = String(
                            pickByHeader(row, [
                                'Short Label',
                                'Label',
                                'Étiquette',
                            ]) ?? ''
                        ).trim();
                        const description = pickLongText(
                            row,
                            [
                                'Description',
                                'Desc',
                                'Product Description',
                                'Long Description',
                                'Détails',
                                'Détail',
                                'Details',
                                'Detail',
                            ],
                            ['description', 'détail', 'detail', 'details']
                        );
                        const cost_price = parseMoney(
                            pickByHeader(row, [
                                'Cost Price (DH)',
                                'Cost Price',
                                'Cost',
                                'Prix achat',
                                'Coût',
                            ])
                        );
                        const selling_price = parseMoney(
                            pickByHeader(row, [
                                'Selling Price (DH)',
                                'Selling Price',
                                'Sale Price',
                                'Price',
                                'Prix vente',
                                'Prix',
                            ])
                        );
                        const stock = parseIntSafe(
                            pickByHeader(row, [
                                'Quantity',
                                'Qty',
                                'Stock',
                                'Quantité',
                            ]),
                            0
                        );
                        const active = parseActive(pickByHeader(row, ['Active', 'Actif']), true);
                        const image_url = String(
                            pickByHeader(row, ['Image URL', 'Image', 'URL']) ?? ''
                        ).trim();
                        const accessory_codes_raw = String(
                            pickByHeader(row, [
                                'Accessory SKUs',
                                'Accessory SKU',
                                'Accessories',
                                'Accessory Codes',
                                'Accessoires',
                            ]) ?? ''
                        );
                        const accCodes = splitAccessoryCodes(accessory_codes_raw);

                        const errors: string[] = [];
                        if (!name) errors.push('Name is missing');
                        if (!code) errors.push('Code is missing');

                        const pk = code.toLowerCase();
                        if (pk && seenProductCodes.has(pk)) errors.push('Duplicate product code in file');
                        else if (pk) seenProductCodes.add(pk);

                        const resolved_accessory_ids: string[] = [];
                        const missingAcc: string[] = [];
                        for (const ac of accCodes) {
                            const aid = accessoryCodeToId.get(ac.toLowerCase());
                            if (aid) resolved_accessory_ids.push(aid);
                            else missingAcc.push(ac);
                        }
                        if (missingAcc.length) {
                            errors.push(`Unknown accessory code(s): ${missingAcc.join(', ')}`);
                        }

                        const existing_product_id = pk ? productCodeToId.get(pk) ?? null : null;

                        return {
                            id: `row-${idx}`,
                            name,
                            code,
                            label,
                            description,
                            cost_price,
                            selling_price,
                            stock,
                            active,
                            image_url,
                            accessory_codes_raw: accCodes.join(', '),
                            resolved_accessory_ids,
                            status: errors.length === 0 ? 'valid' : 'invalid',
                            errors,
                            existing_product_id,
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
        [products, accessories, toast]
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
                item.code.toLowerCase().includes(q) ||
                item.label.toLowerCase().includes(q) ||
                item.description.toLowerCase().includes(q) ||
                item.accessory_codes_raw.toLowerCase().includes(q)
        );
    }, [data, searchQuery]);

    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return filteredData.slice(start, start + PAGE_SIZE);
    }, [filteredData, currentPage]);

    const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);
    const validCount = data.filter((d) => d.status === 'valid').length;

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                    <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Import Products</h1>
                    <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Bulk create or update products by code</p>
                </div>
                <Button
                    variant="outline"
                    onClick={() => window.open(TEMPLATE_URL, '_blank')}
                    className="h-8 px-3 rounded-md text-[11px] font-semibold border-gray-200 gap-1.5 shrink-0"
                >
                    <Download className="w-3.5 h-3.5" />
                    Download Excel model
                </Button>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <Card className={cn(
                    'lg:col-span-2 border border-gray-100 shadow-none rounded-xl overflow-hidden transition-all duration-300',
                    isDragActive ? 'border-brand-navy/30' : ''
                )}>
                    <CardContent className="p-0">
                        <div
                            {...getRootProps()}
                            className={cn(
                                'border-dashed border-gray-200 rounded-xl p-6 flex flex-col items-center justify-center min-h-[200px] cursor-pointer transition-all duration-300',
                                isDragActive ? 'border-brand-navy/40 bg-brand-navy/[0.03]' : 'hover:border-gray-300'
                            )}
                        >
                            <input {...getInputProps()} />
                            {isParsing ? (
                                <div className="text-center space-y-2">
                                    <Loader2 className="w-6 h-6 text-brand-navy animate-spin mx-auto" />
                                    <p className="text-[11px] font-semibold text-brand-navy">Analyzing file...</p>
                                </div>
                            ) : file && data.length > 0 ? (
                                <div className="text-center space-y-2">
                                    <p className="text-[12px] font-semibold text-brand-navy">{file.name}</p>
                                    <p className="text-[11px] text-gray-500">{data.length} rows</p>
                                    <div className="flex items-center justify-center gap-2">
                                        <Badge className="bg-emerald-50 text-emerald-700 border-emerald-100 border h-5 px-1.5 text-[9px] font-semibold">{validCount} ready</Badge>
                                        <Badge className="bg-red-50 text-red-700 border-red-100 border h-5 px-1.5 text-[9px] font-semibold">{data.length - validCount} errors</Badge>
                                    </div>
                                    <Button
                                        onClick={(e) => { e.stopPropagation(); setFile(null); setData([]); }}
                                        variant="ghost"
                                        className="h-7 px-2 rounded-md text-[10px] font-semibold text-red-500 hover:bg-red-50 gap-1"
                                    >
                                        <Trash2 className="w-3 h-3" />
                                        Remove file
                                    </Button>
                                </div>
                            ) : (
                                <div className="text-center space-y-2">
                                    <Upload className="w-6 h-6 text-gray-400 mx-auto" />
                                    <p className="text-[12px] font-semibold text-brand-navy">Drop Excel here</p>
                                    <p className="text-[11px] text-gray-400">or click to browse</p>
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 flex items-center gap-1 justify-center">
                                        <FileSpreadsheet className="w-3 h-3" /> XLSX / XLS
                                    </span>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card className="border border-gray-100 shadow-none rounded-xl overflow-hidden">
                    <CardContent className="p-3.5 space-y-3">
                        <div className="flex items-center gap-2">
                            <Database className="w-4 h-4 text-brand-navy/40" />
                            <p className="text-[11px] font-semibold text-brand-navy">Products + links</p>
                        </div>
                        <p className="text-[10px] text-gray-400 leading-relaxed">
                            Existing product codes are updated. Default accessory links are replaced by the sheet (empty column clears links).
                        </p>
                        <div className="space-y-1.5">
                            {[
                                'Import accessories first if you use Accessory SKUs',
                                'Codes matched case-insensitively',
                                'Duplicate codes in the same file are rejected',
                            ].map((t) => (
                                <div key={t} className="flex items-start gap-1.5">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                                    <p className="text-[10px] text-brand-navy/80">{t}</p>
                                </div>
                            ))}
                        </div>
                        <div className="pt-2 border-t border-gray-100">
                            {uploadProgress > 0 ? (
                                <div className="space-y-1.5">
                                    <div className="flex justify-between text-[10px] font-semibold text-brand-navy">
                                        <span>Syncing</span>
                                        <span>{uploadProgress}%</span>
                                    </div>
                                    <Progress value={uploadProgress} className="h-1.5" />
                                </div>
                            ) : (
                                <Button
                                    disabled={data.length === 0 || validCount === 0 || !activeBusinessId || uploadMutation.isPending}
                                    onClick={() => uploadMutation.mutate(data.filter((d) => d.status === 'valid'))}
                                    className="w-full h-8 bg-brand-navy hover:bg-brand-navy/90 text-white rounded-md text-[11px] font-semibold gap-1.5"
                                >
                                    {uploadMutation.isPending ? (
                                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing...</>
                                    ) : (
                                        <>Commit {validCount} rows <ArrowRight className="w-3.5 h-3.5" /></>
                                    )}
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {data.length > 0 && (
                <div className="space-y-3">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <p className="text-[13px] font-semibold text-brand-navy">Preview</p>
                            <Badge variant="secondary" className="h-5 px-1.5 text-[9px] font-semibold">{filteredData.length} rows</Badge>
                        </div>
                        <div className="relative w-full md:w-64">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <Input
                                placeholder="Search..."
                                className="pl-7 h-8 rounded-md border-gray-200 text-[11px]"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>

                    <Card className="border border-gray-100 shadow-none rounded-xl overflow-hidden">
                        <div className="overflow-x-auto max-w-full">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-gray-50/60 hover:bg-gray-50/60">
                                        <TableHead className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold py-2 pl-3 min-w-[140px]">Code / Name</TableHead>
                                        <TableHead className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold py-2 min-w-[120px]">Label</TableHead>
                                        <TableHead className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold py-2 min-w-[200px]">Description</TableHead>
                                        <TableHead className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold py-2 min-w-[100px]">Prices</TableHead>
                                        <TableHead className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold py-2 min-w-[140px]">Accessories</TableHead>
                                        <TableHead className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold py-2">Op</TableHead>
                                        <TableHead className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold py-2">Status</TableHead>
                                        <TableHead className="py-2 pr-3 w-10" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedData.map((row) => (
                                        <TableRow key={row.id} className="hover:bg-gray-50 transition-colors border-gray-50">
                                            <TableCell className="pl-3 py-2 align-top">
                                                <div className="font-mono text-[10px] font-semibold text-brand-navy">{row.code}</div>
                                                <div className="text-[10px] text-gray-500">{row.name}</div>
                                            </TableCell>
                                            <TableCell className="py-2 align-top text-[10px] text-brand-navy/80 max-w-[120px] break-words">
                                                {row.label || '—'}
                                            </TableCell>
                                            <TableCell className="py-2 align-top max-w-[min(300px,35vw)]">
                                                <p className="text-[10px] text-gray-500 line-clamp-3 whitespace-pre-wrap break-words">
                                                    {row.description || '—'}
                                                </p>
                                            </TableCell>
                                            <TableCell className="py-2 align-top text-[10px] tabular-nums text-brand-navy/80">
                                                <div>{row.cost_price} / {row.selling_price} DH</div>
                                                <div className="text-gray-400">Stock {row.stock}</div>
                                            </TableCell>
                                            <TableCell className="py-2 align-top max-w-[160px] truncate text-[10px] text-gray-500">
                                                {row.accessory_codes_raw || '—'}
                                            </TableCell>
                                            <TableCell className="py-2 align-top">
                                                {row.existing_product_id ? (
                                                    <Badge variant="secondary" className="text-[9px] h-5 px-1.5">Update</Badge>
                                                ) : (
                                                    <Badge className="text-[9px] h-5 px-1.5">Create</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="py-2 align-top">
                                                {row.status === 'valid' ? (
                                                    <Badge className="bg-emerald-50 text-emerald-700 border-none h-5 px-1.5 text-[9px] font-semibold">Valid</Badge>
                                                ) : (
                                                    <div className="space-y-0.5">
                                                        <Badge className="bg-red-50 text-red-600 border-none h-5 px-1.5 text-[9px] font-semibold block w-fit">Invalid</Badge>
                                                        <span className="text-[9px] text-red-500 flex items-start gap-1">
                                                            <AlertCircle className="w-2.5 h-2.5 shrink-0 mt-0.5" />
                                                            {row.errors[0]}
                                                        </span>
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="py-2 pr-3 align-top">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 rounded-md text-gray-400 hover:bg-red-50 hover:text-red-500"
                                                    onClick={() => setData((prev) => prev.filter((d) => d.id !== row.id))}
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        {totalPages > 1 && (
                            <div className="px-3 py-2 border-t border-gray-100 flex items-center justify-between bg-gray-50/40">
                                <span className="text-[10px] text-gray-400">Page {currentPage} / {totalPages}</span>
                                <div className="flex gap-1">
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        disabled={currentPage === 1}
                                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                        className="h-7 w-7 rounded-md border-gray-200"
                                    >
                                        <ChevronLeft className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        disabled={currentPage === totalPages}
                                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                        className="h-7 w-7 rounded-md border-gray-200"
                                    >
                                        <ChevronRight className="w-3.5 h-3.5" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </Card>
                </div>
            )}
        </div>
    );
};

export default ImportProducts;
