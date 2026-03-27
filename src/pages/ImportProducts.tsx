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
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Import Products</h1>
                            <p className="text-gray-500 font-light">
                                Bulk create or update products by code. Optional column lists accessory codes
                                (comma-separated); accessories must exist first.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            onClick={() => window.open(TEMPLATE_URL, '_blank')}
                            className="h-12 px-6 rounded-2xl border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:text-gray-900 font-medium gap-2"
                        >
                            <Download className="w-5 h-5" />
                            Download Excel model
                        </Button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <Card
                    className={cn(
                        'lg:col-span-2 border-none shadow-xl rounded-[40px] overflow-hidden transition-all duration-500',
                        isDragActive ? 'scale-[0.99]' : ''
                    )}
                >
                    <CardContent className="p-0">
                        <div
                            {...getRootProps()}
                            className={cn(
                                'relative flex flex-col items-center justify-center min-h-[400px] cursor-pointer transition-all duration-500',
                                isDragActive
                                    ? 'bg-brand-navy/[0.08]'
                                    : 'bg-white/40 hover:bg-white/60 backdrop-blur-xl'
                            )}
                        >
                            <input {...getInputProps()} />
                            <div className="absolute inset-0 border-2 border-dashed border-brand-navy/10 rounded-[40px] m-4 pointer-events-none" />

                            {isParsing ? (
                                <div className="text-center space-y-4 animate-pulse">
                                    <Loader2 className="w-10 h-10 text-brand-navy animate-spin mx-auto" />
                                    <h3 className="text-2xl font-bold text-brand-navy">Analyzing file…</h3>
                                </div>
                            ) : file && data.length > 0 ? (
                                <div className="text-center space-y-6">
                                    <h3 className="text-3xl font-bold text-brand-navy">{file.name}</h3>
                                    <p className="text-muted-foreground font-medium">{data.length} rows</p>
                                    <div className="flex items-center justify-center gap-3">
                                        <Badge className="bg-green-500 h-8 px-4 rounded-full">{validCount} ready</Badge>
                                        <Badge variant="destructive" className="h-8 px-4 rounded-full">
                                            {data.length - validCount} errors
                                        </Badge>
                                    </div>
                                    <Button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setFile(null);
                                            setData([]);
                                        }}
                                        variant="ghost"
                                        className="text-brand-red hover:bg-brand-red/10 rounded-xl"
                                    >
                                        <Trash2 className="w-4 h-4 mr-2" />
                                        Remove file
                                    </Button>
                                </div>
                            ) : (
                                <div className="text-center space-y-6">
                                    <Upload className="w-12 h-12 text-brand-navy/40 mx-auto" />
                                    <h3 className="text-3xl font-bold text-brand-navy">Drop Excel here</h3>
                                    <p className="text-muted-foreground">or click to browse</p>
                                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 flex items-center gap-2 justify-center">
                                        <FileSpreadsheet className="w-3 h-3" /> XLSX / XLS
                                    </span>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-none shadow-xl bg-brand-navy rounded-[40px] text-brand-white p-8 flex flex-col justify-between overflow-hidden relative">
                    <div className="space-y-6 relative z-10">
                        <Database className="w-7 h-7" />
                        <h3 className="text-2xl font-bold">Products + links</h3>
                        <p className="text-brand-white/60 leading-relaxed text-sm">
                            Existing product codes are updated. Default accessory links are replaced by the sheet
                            (empty column clears links).
                        </p>
                        <ul className="space-y-3 text-sm">
                            {[
                                'Import accessories first if you use Accessory SKUs',
                                'Codes matched case-insensitively',
                                'Duplicate codes in the same file are rejected',
                            ].map((t) => (
                                <li key={t} className="flex gap-2 items-start">
                                    <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                                    {t}
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div className="relative z-10 pt-8">
                        {uploadProgress > 0 ? (
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs font-bold uppercase">
                                    <span>Syncing</span>
                                    <span>{uploadProgress}%</span>
                                </div>
                                <Progress value={uploadProgress} className="h-2 bg-white/10" />
                            </div>
                        ) : (
                            <Button
                                disabled={
                                    data.length === 0 ||
                                    validCount === 0 ||
                                    !activeBusinessId ||
                                    uploadMutation.isPending
                                }
                                onClick={() => uploadMutation.mutate(data.filter((d) => d.status === 'valid'))}
                                className="w-full h-14 bg-brand-white text-brand-navy hover:bg-brand-white/90 rounded-2xl font-black"
                            >
                                {uploadMutation.isPending ? (
                                    <>
                                        <Loader2 className="w-5 h-5 mr-2 animate-spin inline" />
                                        Processing…
                                    </>
                                ) : (
                                    <>
                                        Commit {validCount} rows
                                        <ArrowRight className="w-5 h-5 ml-2 inline" />
                                    </>
                                )}
                            </Button>
                        )}
                    </div>
                </Card>
            </div>

            {data.length > 0 && (
                <div className="space-y-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <h2 className="text-2xl font-bold text-brand-navy">Preview</h2>
                        <div className="relative w-full md:w-[300px]">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                                placeholder="Search…"
                                className="pl-11 h-11 rounded-xl"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>

                    <Card className="border-none shadow-xl rounded-[32px] overflow-hidden">
                        <div className="overflow-x-auto max-w-full">
                        <Table>
                            <TableHeader className="bg-brand-navy/5">
                                <TableRow>
                                    <TableHead className="font-bold text-brand-navy pl-8 min-w-[140px]">Code / Name</TableHead>
                                    <TableHead className="font-bold text-brand-navy min-w-[120px]">Label</TableHead>
                                    <TableHead className="font-bold text-brand-navy min-w-[280px]">Description</TableHead>
                                    <TableHead className="font-bold text-brand-navy min-w-[100px]">Prices</TableHead>
                                    <TableHead className="font-bold text-brand-navy min-w-[160px]">Accessories</TableHead>
                                    <TableHead className="font-bold text-brand-navy">Op</TableHead>
                                    <TableHead className="font-bold text-brand-navy">Status</TableHead>
                                    <TableHead className="pr-8 w-12" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {paginatedData.map((row) => (
                                    <TableRow key={row.id}>
                                        <TableCell className="pl-8 align-top">
                                            <div className="font-mono text-sm font-bold">{row.code}</div>
                                            <div className="text-sm text-muted-foreground">{row.name}</div>
                                        </TableCell>
                                        <TableCell className="align-top text-sm max-w-[160px] break-words" title={row.label || undefined}>
                                            {row.label || '—'}
                                        </TableCell>
                                        <TableCell className="align-top text-xs text-muted-foreground max-w-[min(420px,40vw)]">
                                            <p
                                                className="line-clamp-4 whitespace-pre-wrap break-words"
                                                title={row.description || undefined}
                                            >
                                                {row.description || '—'}
                                            </p>
                                        </TableCell>
                                        <TableCell className="align-top">
                                            <div className="text-sm">
                                                {row.cost_price} / {row.selling_price} DH
                                            </div>
                                            <div className="text-xs text-muted-foreground">Stock {row.stock}</div>
                                        </TableCell>
                                        <TableCell className="max-w-[200px] truncate text-xs align-top" title={row.accessory_codes_raw}>
                                            {row.accessory_codes_raw || '—'}
                                        </TableCell>
                                        <TableCell className="align-top">
                                            {row.existing_product_id ? (
                                                <Badge variant="secondary">Update</Badge>
                                            ) : (
                                                <Badge>Create</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="align-top">
                                            {row.status === 'valid' ? (
                                                <Badge className="bg-green-500/10 text-green-700 border-none">Valid</Badge>
                                            ) : (
                                                <div className="flex flex-col gap-1 max-w-[220px]">
                                                    <Badge variant="destructive">Invalid</Badge>
                                                    <span className="text-[10px] text-brand-red flex items-start gap-1">
                                                        <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                                                        {row.errors[0]}
                                                    </span>
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell className="pr-8 align-top">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="rounded-full text-muted-foreground hover:text-brand-red"
                                                onClick={() => setData((prev) => prev.filter((d) => d.id !== row.id))}
                                            >
                                                <X className="w-4 h-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        </div>
                        {totalPages > 1 && (
                            <div className="p-4 flex items-center justify-between border-t">
                                <span className="text-sm text-muted-foreground">
                                    Page {currentPage} / {totalPages}
                                </span>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        disabled={currentPage === 1}
                                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                    >
                                        <ChevronLeft className="w-5 h-5" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        disabled={currentPage === totalPages}
                                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                    >
                                        <ChevronRight className="w-5 h-5" />
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
