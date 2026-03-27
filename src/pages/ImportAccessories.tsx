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

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Import Accessories</h1>
                            <p className="text-gray-500 font-light">
                                Bulk create or update accessories by code (SKU). Import this sheet before linking
                                products to accessories.
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
                        <h3 className="text-2xl font-bold">Upsert by code</h3>
                        <p className="text-brand-white/60 leading-relaxed text-sm">
                            Rows whose code already exists for your business are updated; new codes are inserted.
                        </p>
                        <ul className="space-y-3 text-sm">
                            {['Name + Code required', 'Cost price & stock', 'Optional image URL'].map((t) => (
                                <li key={t} className="flex gap-2 items-center">
                                    <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
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
                        <Table>
                            <TableHeader className="bg-brand-navy/5">
                                <TableRow>
                                    <TableHead className="font-bold text-brand-navy pl-8">Code</TableHead>
                                    <TableHead className="font-bold text-brand-navy">Name</TableHead>
                                    <TableHead className="font-bold text-brand-navy">Cost / Stock</TableHead>
                                    <TableHead className="font-bold text-brand-navy">Action</TableHead>
                                    <TableHead className="font-bold text-brand-navy">Status</TableHead>
                                    <TableHead className="font-bold text-brand-navy pr-8 w-12" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {paginatedData.map((row) => (
                                    <TableRow key={row.id}>
                                        <TableCell className="pl-8 font-mono text-sm">{row.code}</TableCell>
                                        <TableCell className="font-medium">{row.name}</TableCell>
                                        <TableCell>
                                            {row.cost_price} DH · {row.stock} u.
                                        </TableCell>
                                        <TableCell>
                                            {row.existing_id ? (
                                                <Badge variant="secondary">Update</Badge>
                                            ) : (
                                                <Badge>Create</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {row.status === 'valid' ? (
                                                <Badge className="bg-green-500/10 text-green-700 border-none">Valid</Badge>
                                            ) : (
                                                <div className="flex flex-col gap-1">
                                                    <Badge variant="destructive">Invalid</Badge>
                                                    <span className="text-[10px] text-brand-red">{row.errors[0]}</span>
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell className="pr-8">
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

export default ImportAccessories;
