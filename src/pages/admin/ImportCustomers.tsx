import React, { useState, useCallback, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import {
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
    FileCheck,
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

interface RawRow {
    [key: string]: any;
}

interface MappedCustomer {
    id: string;
    name: string;
    phone: string;
    phone_normalized: string;
    address: string;
    city_name: string;
    city_id: string | null;
    notes: string;
    tags: string[];
    status: 'valid' | 'invalid';
    errors: string[];
}

function normalizePhoneForCache(raw: any): string {
    if (raw == null) return '';
    const digits = raw.toString().replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 10 && digits.startsWith('0')) return '212' + digits.slice(1);
    return digits;
}

const ImportCustomers = () => {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const [file, setFile] = useState<File | null>(null);
    const [data, setData] = useState<MappedCustomer[]>([]);
    const [isParsing, setIsParsing] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const { data: cities } = useQuery({
        queryKey: ['master-cities', 'import-customers-lite'],
        queryFn: async () => {
            return fetchAllRows<{ id: string; name: string }>('master_cities', 'id, name', { orderBy: 'name' });
        },
    });

    const findCityId = (cityName: string): string | null => {
        if (!cityName || !cities) return null;
        const normalizedInput = cityName.trim().toLowerCase();
        const match = cities.find((c) => c.name.toLowerCase() === normalizedInput);
        return match ? match.id : null;
    };

    const handleFileDrop = useCallback(
        async (acceptedFiles: File[]) => {
            const selectedFile = acceptedFiles[0];
            if (!selectedFile) return;

            setFile(selectedFile);
            setIsParsing(true);
            setData([]);

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const buffer = e.target?.result;
                    const workbook = XLSX.read(buffer, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rawData = XLSX.utils.sheet_to_json(firstSheet) as RawRow[];

                    const mapped = rawData.map((row, idx) => {
                        const name = (row['Name'] || row['Nom'] || row['Client'] || row['Customer Name'] || '').toString().trim();
                        const rawPhone = row['Phone'] || row['Téléphone'] || row['Telephone'] || row['Mobile'] || '';
                        const address = (row['Address'] || row['Adresse'] || '').toString().trim();
                        const cityName = (row['City'] || row['Ville'] || '').toString().trim();
                        const notes = (row['Notes'] || row['Note'] || '').toString().trim();
                        const rawTags = (row['Tags'] || row['Tag'] || '').toString().trim();
                        const tags = rawTags
                            ? rawTags.split(/[,;]/).map((t: string) => t.trim()).filter(Boolean)
                            : [];

                        const phoneNorm = normalizePhoneForCache(rawPhone);
                        const displayPhone = rawPhone ? rawPhone.toString().trim() : '';
                        const city_id = findCityId(cityName);

                        const errors: string[] = [];
                        if (!phoneNorm || phoneNorm.length < 9) errors.push('Invalid phone');

                        return {
                            id: `row-${idx}`,
                            name,
                            phone: displayPhone || phoneNorm,
                            phone_normalized: phoneNorm,
                            address,
                            city_name: cityName,
                            city_id,
                            notes,
                            tags,
                            status: errors.length === 0 ? 'valid' : 'invalid',
                            errors,
                        } as MappedCustomer;
                    });

                    // Dedupe by phone_normalized inside the file itself (keep last occurrence).
                    const byPhone = new Map<string, MappedCustomer>();
                    for (const m of mapped) {
                        if (m.phone_normalized) byPhone.set(m.phone_normalized, m);
                        else byPhone.set(m.id, m);
                    }
                    const deduped = Array.from(byPhone.values());

                    setData(deduped);
                    setIsParsing(false);
                    toast({
                        title: 'File parsed',
                        description: `${deduped.length} unique customer row(s) detected${
                            mapped.length !== deduped.length ? ` (${mapped.length - deduped.length} duplicate phone(s) collapsed)` : ''
                        }.`,
                    });
                } catch (error) {
                    console.error(error);
                    setIsParsing(false);
                    toast({
                        title: 'Parsing error',
                        description: 'Could not read the Excel file. Please check the format.',
                        variant: 'destructive',
                    });
                }
            };
            reader.readAsArrayBuffer(selectedFile);
        },
        [cities, toast],
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop: handleFileDrop,
        accept: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
            'application/vnd.ms-excel': ['.xls'],
        },
        multiple: false,
    });

    const uploadMutation = useMutation({
        mutationFn: async (rows: MappedCustomer[]) => {
            if (!activeBusinessId) throw new Error('No active business selected.');
            if (rows.length === 0) throw new Error('No valid rows to import.');

            const CHUNK = 250;
            let done = 0;
            let touched = 0;
            for (let i = 0; i < rows.length; i += CHUNK) {
                const slice = rows.slice(i, i + CHUNK);
                const payload = slice.map((r) => ({
                    'DigiCom Business': activeBusinessId,
                    phone: r.phone || r.phone_normalized,
                    phone_normalized: r.phone_normalized,
                    name: r.name || null,
                    address: r.address || null,
                    master_city_id: r.city_id,
                    city_name: r.city_name || null,
                    notes: r.notes || null,
                    tags: r.tags,
                    source: 'import',
                }));

                const { data: upserted, error } = await (supabase as any)
                    .from('customers')
                    .upsert(payload, {
                        onConflict: 'DigiCom Business,phone_normalized',
                        ignoreDuplicates: false,
                    })
                    .select('id');
                if (error) throw error;
                touched += (upserted as any[] | null)?.length ?? slice.length;
                done += slice.length;
                setUploadProgress(Math.round((done / rows.length) * 100));
            }
            return { touched };
        },
        onSuccess: ({ touched }) => {
            queryClient.invalidateQueries({ queryKey: ['customers'] });
            toast({ title: 'Import successful', description: `${touched} customer row(s) processed.` });
            setData([]);
            setFile(null);
            setUploadProgress(0);
        },
        onError: (error: any) => {
            toast({ title: 'Import failed', description: error.message, variant: 'destructive' });
            setUploadProgress(0);
        },
    });

    const filteredData = useMemo(() => {
        return data.filter(
            (item) =>
                item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                item.phone.includes(searchQuery) ||
                item.phone_normalized.includes(searchQuery) ||
                item.city_name.toLowerCase().includes(searchQuery.toLowerCase()),
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
                            Data · Bulk import
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Import customers
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Déposez un fichier Excel. Les clients atterrissent dans le registre centralisé, clé par téléphone.
                        </p>
                    </div>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <section
                        className={cn(
                            'lg:col-span-2 rounded-2xl border bg-ant-paper overflow-hidden transition-colors',
                            isDragActive ? 'border-ant-orange bg-ant-orange/5' : 'border-ant-line',
                        )}
                    >
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
                                        : 'border-ant-line bg-ant-light hover:bg-ant-light/70 hover:border-ant-mid/40',
                                )}
                            >
                                <input {...getInputProps()} />

                                {isParsing ? (
                                    <div className="text-center space-y-2">
                                        <Loader2 className="w-6 h-6 text-ant-ink animate-spin mx-auto" strokeWidth={1.5} />
                                        <p className="font-display text-[14px] font-semibold text-ant-ink">Analyse du fichier…</p>
                                        <p className="font-serif italic text-[12px] text-ant-mid">Extraction et normalisation des données.</p>
                                    </div>
                                ) : file && data.length > 0 ? (
                                    <div className="text-center space-y-2.5 max-w-sm">
                                        <div className="h-10 w-10 rounded-xl border border-ant-green/25 bg-ant-green/10 text-ant-green flex items-center justify-center mx-auto">
                                            <FileCheck className="w-4 h-4" strokeWidth={1.75} />
                                        </div>
                                        <p className="font-display text-[14px] font-semibold text-ant-ink truncate max-w-[280px] mx-auto">
                                            {file.name}
                                        </p>
                                        <p className="font-serif italic text-[12px] text-ant-mid">{data.length} clients détectés</p>
                                        <div className="flex items-center justify-center gap-2 flex-wrap">
                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-green/25 bg-ant-green/10 px-2 py-0.5 text-[10px] font-semibold text-ant-green">
                                                <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                                                {validCount} prêts
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
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setFile(null);
                                                setData([]);
                                            }}
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
                                        <p className="font-serif italic text-[12px] text-ant-mid">Colonnes attendues: Name, Phone, Address, City, Notes, Tags.</p>
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
                                    Contrôle d&apos;intégrité
                                </div>
                                <Database className="w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                            </div>
                            <div className="space-y-2">
                                {[
                                    { label: 'Téléphone normalisé', desc: 'Digits + 212 si local' },
                                    { label: 'Ville (optionnelle)', desc: 'Nom → ID en base' },
                                    { label: 'UPSERT par téléphone', desc: 'Pas de doublons en base' },
                                    { label: 'Agrégats préservés', desc: 'Les commandes existantes gardent leurs compteurs' },
                                ].map((item, i) => (
                                    <div key={i} className="flex items-start gap-2.5">
                                        <div className="h-5 w-5 rounded-md border border-ant-green/25 bg-ant-green/10 text-ant-green flex items-center justify-center shrink-0 mt-px">
                                            <CheckCircle2 className="w-2.5 h-2.5" strokeWidth={2} />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[12px] font-semibold text-ant-ink">{item.label}</p>
                                            <p className="font-serif italic text-[11px] text-ant-mid">{item.desc}</p>
                                        </div>
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
                                        disabled={data.length === 0 || validCount === 0 || uploadMutation.isPending}
                                        onClick={() => uploadMutation.mutate(data.filter((d) => d.status === 'valid'))}
                                        className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-full bg-ant-ink hover:bg-ant-ink/90 disabled:bg-ant-mid/40 disabled:cursor-not-allowed text-white text-[12px] font-semibold cursor-pointer transition-colors"
                                    >
                                        {uploadMutation.isPending ? (
                                            <>
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.75} />
                                                Traitement…
                                            </>
                                        ) : (
                                            <>
                                                Importer {validCount} clients
                                                <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.75} />
                                            </>
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
                                    placeholder="Rechercher dans la prévisualisation…"
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
                                        <TableHead className="text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold py-2.5 pl-5">Client</TableHead>
                                        <TableHead className="text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold py-2.5">Ville</TableHead>
                                        <TableHead className="text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold py-2.5">Adresse</TableHead>
                                        <TableHead className="text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold py-2.5">Tags</TableHead>
                                        <TableHead className="text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold py-2.5">Statut</TableHead>
                                        <TableHead className="py-2.5 pr-5 w-10" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedData.map((row) => (
                                        <TableRow key={row.id} className="hover:bg-ant-light/40 transition-colors border-ant-line">
                                            <TableCell className="pl-5 py-3">
                                                <div className="font-display text-[13px] font-semibold text-ant-ink truncate max-w-[220px]">
                                                    {row.name || <span className="italic font-serif text-ant-mid">—</span>}
                                                </div>
                                                <div className="font-serif italic text-[11px] text-ant-mid tabular-nums mt-0.5">
                                                    {row.phone_normalized || row.phone}
                                                </div>
                                            </TableCell>
                                            <TableCell className="py-3">
                                                {row.city_id ? (
                                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-green/25 bg-ant-green/10 px-2 py-0.5 text-[10px] font-semibold text-ant-green">
                                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                                                        {row.city_name}
                                                    </span>
                                                ) : row.city_name ? (
                                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-orange/25 bg-ant-orange/10 px-2 py-0.5 text-[10px] font-semibold text-ant-orange">
                                                        <AlertCircle className="w-3 h-3" strokeWidth={1.75} />
                                                        {row.city_name}
                                                    </span>
                                                ) : (
                                                    <span className="text-[11px] text-ant-mid font-serif italic">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="py-3 text-[11px] text-ant-mid truncate max-w-[240px]">{row.address || '—'}</TableCell>
                                            <TableCell className="py-3">
                                                <div className="flex flex-wrap gap-1 max-w-[220px]">
                                                    {row.tags.length === 0 && <span className="text-[11px] text-ant-mid font-serif italic">—</span>}
                                                    {row.tags.map((t, i) => (
                                                        <span
                                                            key={i}
                                                            className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-ink"
                                                        >
                                                            {t}
                                                        </span>
                                                    ))}
                                                </div>
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
                                                        <p className="font-serif italic text-[10px] text-ant-rose/80">{row.errors[0]}</p>
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
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                        aria-label="Précédente"
                                        className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-ant-line bg-ant-paper hover:bg-ant-light disabled:opacity-40 disabled:cursor-not-allowed text-ant-ink cursor-pointer transition-colors"
                                    >
                                        <ChevronLeft className="w-3.5 h-3.5" strokeWidth={1.75} />
                                    </button>
                                    {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                                        const pageNum = i + 1;
                                        const active = currentPage === pageNum;
                                        return (
                                            <button
                                                key={pageNum}
                                                type="button"
                                                onClick={() => setCurrentPage(pageNum)}
                                                className={cn(
                                                    'inline-flex items-center justify-center h-8 w-8 rounded-lg text-[11px] font-semibold tabular-nums cursor-pointer transition-colors',
                                                    active ? 'bg-ant-ink text-white' : 'border border-ant-line bg-ant-paper hover:bg-ant-light text-ant-ink',
                                                )}
                                            >
                                                {pageNum}
                                            </button>
                                        );
                                    })}
                                    {totalPages > 5 && <span className="text-[11px] text-ant-mid font-serif italic">…</span>}
                                    <button
                                        type="button"
                                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                        disabled={currentPage === totalPages}
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

export default ImportCustomers;
