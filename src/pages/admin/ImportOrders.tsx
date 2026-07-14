import React, { useState, useCallback, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
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
    FileCheck,
    Database,
    X
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
} from "@/components/ui/table";


import { useStatusCategories } from '@/hooks/useStatusCategories';

// --- Types & Constants ---
const PAGE_SIZE = 500;
const TEMPLATE_URL = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/documents/Orders%20Model.xlsx`;

interface RawRow {
    [key: string]: any;
}

interface MappedOrder {
    id: string;
    name: string;
    phone: string;
    address: string;
    city_name: string;
    city_id: string | null;
    price: number;
    shipping_fee: number;
    note: string;
    delivery_note: string;
    source: string;
    is_exchange: boolean;
    product_sku: string;
    product_id: string | null;
    quantity: number;

    // Validation
    status: 'valid' | 'invalid';
    errors: string[];
}

const ImportOrders = () => {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const { getOrderByCategory } = useStatusCategories();
    const defaultStatusId = getOrderByCategory('new')?.id;
    const [file, setFile] = useState<File | null>(null);
    const [data, setData] = useState<MappedOrder[]>([]);
    const [isParsing, setIsParsing] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // --- Queries ---
    const { data: cities } = useQuery({
        queryKey: ['master-cities', 'import-lite'],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            return fetchAllRows<{ id: string; name: string; zone_id: string | null }>('master_cities', 'id, name, zone_id', { orderBy: 'name' });
        }
    });

    const { data: products } = useQuery({
        queryKey: ['products'],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('products')
                .select('id, code, name')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: couriers } = useQuery({
        queryKey: ['couriers-all', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name')
                .eq('role', 'courier')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: companies } = useQuery({
        queryKey: ['companies-all', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('providers')
                .select('id, name')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: courierZones } = useQuery({
        queryKey: ['courier-zones-all', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('courier_zones')
                .select('id, courier_id, zone_id')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: companyZones } = useQuery({
        queryKey: ['company-zones-all'],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('company_zones')
                .select('id, company_id, zone_id')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: courierFees } = useQuery({
        queryKey: ['courier-fees-all', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            return await fetchAllRows('courier_fees', 'id, courier_id, master_city_id, fee', { filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId }] });
        }
    });

    const { data: companyFees } = useQuery({
        queryKey: ['company-fees-all', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            return await fetchAllRows('company_fees', 'id, company_id, master_city_id, fee', { filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId }] });
        }
    });

    const { data: productAccessories } = useQuery({
        queryKey: ['product-accessories-import', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('product_accessories')
                .select('product_id, accessory_id, default_quantity')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: accessoriesList } = useQuery({
        queryKey: ['accessories-import', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('accessories')
                .select('id, name, code, cost_price')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const uploadMutation = useMutation({
        mutationFn: async (orders: MappedOrder[]) => {
            if (!activeBusinessId) throw new Error('No business selected');
            if (!defaultStatusId) throw new Error('Order status not loaded');
            let completed = 0;
            const validOrders = orders.filter(o => o.status === 'valid');
            const total = validOrders.length;

            // Helper: find fee for a provider + city, with zone fallback
            const findFee = (type: 'courier' | 'company', providerId: string, masterCityId: string): number | null => {
                const fees = type === 'courier' ? courierFees : companyFees;
                const idField = type === 'courier' ? 'courier_id' : 'company_id';
                if (!fees?.length) return null;

                // 1. Direct match on master_city_id
                const direct = fees.find((f: any) => f[idField] === providerId && f.master_city_id === masterCityId);
                if (direct) return Number(direct.fee);

                // 2. Zone fallback
                const city = cities?.find((c: any) => c.id === masterCityId);
                if (city?.zone_id) {
                    const samezone = cities?.filter((c: any) => c.zone_id === city.zone_id).map((c: any) => c.id) || [];
                    const zoneFee = fees.find((f: any) => f[idField] === providerId && samezone.includes(f.master_city_id));
                    if (zoneFee) return Number(zoneFee.fee);
                }
                return null;
            };

            const userRes = await (supabase as any).auth.getUser();
            const importerId = userRes.data.user?.id;

            for (const order of validOrders) {
                // --- Provider resolution ---
                let bestProviderId: string | null = null;
                let bestProviderType: 'courier' | 'company' | null = null;
                let finalShippingFee = order.shipping_fee;

                const cityData = cities?.find((c: any) => c.id === order.city_id);
                if (cityData) {
                    const zoneId = cityData.zone_id;

                    // Collect eligible providers via zone assignment
                    const zoneCouriers = zoneId ? couriers?.filter((c: any) =>
                        courierZones?.some((cz: any) => cz.courier_id === c.id && cz.zone_id === zoneId)
                    ).map((c: any) => ({ ...c, type: 'courier' as const })) || [] : [];

                    const zoneCompanies = zoneId ? companies?.filter((c: any) =>
                        companyZones?.some((cz: any) => cz.company_id === c.id && cz.zone_id === zoneId)
                    ).map((c: any) => ({ ...c, type: 'company' as const })) || [] : [];

                    // Also collect providers that have a direct fee for this city (fallback)
                    const feeCouriers = couriers?.filter((c: any) =>
                        courierFees?.some((f: any) => f.courier_id === c.id && f.master_city_id === order.city_id)
                    ).map((c: any) => ({ ...c, type: 'courier' as const })) || [];

                    const feeCompanies = companies?.filter((c: any) =>
                        companyFees?.some((f: any) => f.company_id === c.id && f.master_city_id === order.city_id)
                    ).map((c: any) => ({ ...c, type: 'company' as const })) || [];

                    // Combine, deduplicate
                    const allProviders = [...zoneCouriers, ...zoneCompanies, ...feeCouriers, ...feeCompanies]
                        .filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);

                    if (allProviders.length > 0) {
                        const providersWithFees = allProviders.map(p => {
                            const fee = findFee(p.type, p.id, order.city_id!) ?? Infinity;
                            return { ...p, fee };
                        });

                        const best = providersWithFees.sort((a, b) => a.fee - b.fee)[0];
                        if (best) {
                            bestProviderId = best.id;
                            bestProviderType = best.type;
                            if (finalShippingFee === 0 && best.fee !== Infinity) {
                                finalShippingFee = best.fee;
                            }
                        }
                    }
                }

                // 1. Create Order
                const { data: orderData, error: orderError } = await (supabase as any).from('orders').insert({
                    name: order.name,
                    phone: order.phone,
                    address: order.address,
                    master_city_id: order.city_id,
                    price: order.price + (finalShippingFee > 0 ? finalShippingFee : 0),
                    raw_price: order.price,
                    shipping_cost: finalShippingFee,
                    note: order.note,
                    delivery_note: order.delivery_note,
                    source_name: order.source,
                    replace: order.is_exchange,
                    order_status_id: defaultStatusId,
                    date: new Date().toISOString().split('T')[0],
                    courier_id: bestProviderType === 'courier' ? bestProviderId : null,
                    company_id: bestProviderType === 'company' ? bestProviderId : null,
                    'DigiCom Business': activeBusinessId
                }).select().single();

                if (orderError) {
                    console.error("Failed to import order", order, orderError);
                    continue;
                }

                if (defaultStatusId && orderData?.id) {
                    const { error: historyError } = await (supabase as any).from('order_status_history').insert({
                        order_id: orderData.id,
                        status_id: defaultStatusId,
                        comment: 'Imported',
                        changed_by: importerId,
                        'DigiCom Business': activeBusinessId
                    });
                    if (historyError) {
                        console.error('Import order status history error:', orderData.id, historyError);
                    }
                }

                // 2. Create Order Item + default accessories
                if (order.product_id && orderData) {
                    // Look up default accessories for this product
                    const defaultAccs = productAccessories?.filter((pa: any) => pa.product_id === order.product_id) || [];

                    // Build the main item row with the first accessory inline (if any)
                    const firstAcc = defaultAccs[0];
                    const firstAccData = firstAcc ? accessoriesList?.find((a: any) => a.id === firstAcc.accessory_id) : null;

                    const { error: itemError } = await (supabase as any).from('order_items').insert({
                        order_id: orderData.id,
                        product_id: order.product_id,
                        quantity: order.quantity,
                        unit_price: order.price,
                        accessory_id: firstAcc?.accessory_id || null,
                        accessory_quantity: firstAcc?.default_quantity || 0,
                        accessory_unit_price: firstAccData?.cost_price || 0,
                        'DigiCom Business': activeBusinessId
                    });
                    if (itemError) console.error("Failed to add item to order", orderData.id, itemError);

                    // Insert additional accessory rows (2nd, 3rd, etc.) as separate order_items
                    for (let i = 1; i < defaultAccs.length; i++) {
                        const acc = defaultAccs[i];
                        const accData = accessoriesList?.find((a: any) => a.id === acc.accessory_id);
                        await (supabase as any).from('order_items').insert({
                            order_id: orderData.id,
                            product_id: order.product_id,
                            quantity: 0,
                            unit_price: 0,
                            accessory_id: acc.accessory_id,
                            accessory_quantity: acc.default_quantity,
                            accessory_unit_price: accData?.cost_price || 0,
                            'DigiCom Business': activeBusinessId
                        });
                    }
                }

                completed++;
                setUploadProgress(Math.round((completed / total) * 100));
            }

            const { data: syncData, error: syncError } = await (supabase as any).rpc('sync_imported_orders', {
                p_business_id: activeBusinessId,
            });
            if (syncError) throw syncError;
            return { syncData };
        },
        onSuccess: (result, variables) => {
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            if (activeBusinessId) {
                queryClient.invalidateQueries({ queryKey: ['orders', activeBusinessId] });
            }
            const sync = result?.syncData as { accessories_synced?: number; providers_synced?: number } | undefined;
            const n = variables?.length ?? 0;
            toast({
                title: 'Import successful',
                description: sync
                    ? `${n} order row(s) processed. Post-sync: ${sync.accessories_synced ?? 0} accessory line(s), ${sync.providers_synced ?? 0} provider assignment(s).`
                    : `${n} order row(s) processed.`,
            });
            setData([]);
            setFile(null);
            setUploadProgress(0);
        },
        onError: (error: any) => {
            toast({
                title: "Import Failed",
                description: error.message,
                variant: "destructive"
            });
            setUploadProgress(0);
        }
    });

    // --- Handlers ---
    const normalizePhone = (phone: any): string => {
        if (!phone) return '';
        const cleaned = phone.toString().replace(/[^0-9]/g, '');
        // Typical Moroccan normalization: last 10 digits
        return cleaned.length >= 10 ? cleaned.slice(-10) : cleaned;
    };

    const findCityId = (cityName: string): string | null => {
        if (!cityName || !cities) return null;
        const normalizedInput = cityName.trim().toLowerCase();
        const match = cities.find(c => c.name.toLowerCase() === normalizedInput);
        return match ? match.id : null;
    };

    const findProductId = (sku: string): string | null => {
        if (!sku || !products) return null;
        const normalizedInput = sku.trim().toLowerCase();
        // Match against 'code' (SKU) or 'name'
        const match = products.find(p =>
            (p.code?.toLowerCase() === normalizedInput) ||
            (p.name?.toLowerCase() === normalizedInput)
        );
        return match ? match.id : null;
    };

    const handleFileDrop = useCallback(async (acceptedFiles: File[]) => {
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
                    // Fuzzy header matching
                    const name = row['Name'] || row['Nom'] || row['Client'] || row['Customer Name'] || '';
                    const rawPhone = row['Phone'] || row['Téléphone'] || row['Mobile'] || '';
                    const address = row['Address'] || row['Adresse'] || '';
                    const cityName = row['City'] || row['Ville'] || '';

                    const source = row['Source'] || '';
                    const sku = row['Product SKU'] || row['SKU'] || '';
                    const quantity = parseInt(row['Quantity'] || '1');
                    const shipping_fee = parseFloat(row['Shipping Fee'] || '0');
                    const is_exchange = (row['Exchange?'] || row['Exchange'] || '').toString().toLowerCase().includes('yes');
                    const internal_note = row['Internal Note'] || row['Note'] || '';
                    const courier_note = row['Courier Note'] || row['Delivery Note'] || '';

                    const rawPrice = row['Price'] || row['Prix'] || row['Unit Price'] || '0';
                    const price = parseFloat(rawPrice.toString().replace(/[^0-9.]/g, ''));

                    const phone = normalizePhone(rawPhone);
                    const city_id = findCityId(cityName);
                    const product_id = findProductId(sku);

                    const errors: string[] = [];
                    if (!name) errors.push('Name is missing');
                    if (!phone || phone.length < 9) errors.push('Invalid phone');
                    if (!city_id) errors.push('City not found');
                    // Optional: Validation for product
                    if (sku && !product_id) errors.push(`SKU "${sku}" not found`);

                    return {
                        id: `row-${idx}`,
                        name: name.toString().trim(),
                        phone,
                        address: address.toString().trim(),
                        city_name: cityName.toString().trim(),
                        city_id,
                        price,
                        shipping_fee,
                        note: internal_note.toString().trim(),
                        delivery_note: courier_note.toString().trim(),
                        source: source.toString().trim(),
                        is_exchange,
                        product_sku: sku.toString().trim(),
                        product_id,
                        quantity,
                        status: errors.length === 0 ? 'valid' : 'invalid',
                        errors
                    } as MappedOrder;
                });

                setData(mapped);
                setIsParsing(false);
                toast({ title: "File Parsed", description: `Found ${mapped.length} rows in the file.` });
            } catch (error) {
                console.error(error);
                setIsParsing(false);
                toast({ title: "Parsing Error", description: "Could not read the Excel file. Please check the format.", variant: "destructive" });
            }
        };
        reader.readAsArrayBuffer(selectedFile);
    }, [cities, products, toast]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop: handleFileDrop,
        accept: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
            'application/vnd.ms-excel': ['.xls']
        },
        multiple: false
    });

    const handleDownloadModel = () => {
        window.open(TEMPLATE_URL, '_blank');
    };

    // --- Memoized Data View ---
    const filteredData = useMemo(() => {
        return data.filter(item =>
            item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.phone.includes(searchQuery) ||
            item.city_name.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [data, searchQuery]);

    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return filteredData.slice(start, start + PAGE_SIZE);
    }, [filteredData, currentPage]);

    const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);
    const validCount = data.filter(d => d.status === 'valid').length;

    const errorCount = data.length - validCount;

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Data · Bulk import
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Import orders
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Déposez un fichier Excel, validez les colonnes au cordeau, engagez la base. Les commandes atterrissent, les frais se négocient, les stocks se décrémentent.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleDownloadModel}
                        className="inline-flex items-center gap-2 h-10 px-4 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light text-[12px] font-semibold text-ant-ink cursor-pointer shrink-0 transition-colors"
                    >
                        <Download className="w-3.5 h-3.5" strokeWidth={1.75} />
                        Télécharger le modèle Excel
                    </button>
                </header>

                {/* Upload + Integrity */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <section className={cn(
                        "lg:col-span-2 rounded-2xl border bg-ant-paper overflow-hidden transition-colors",
                        isDragActive ? "border-ant-orange bg-ant-orange/5" : "border-ant-line"
                    )}>
                        <div className={cn(
                            "h-[3px] w-full",
                            isDragActive ? "bg-ant-orange" : "bg-ant-ink"
                        )} />
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
                                    "rounded-xl border border-dashed p-8 flex flex-col items-center justify-center min-h-[220px] cursor-pointer transition-colors",
                                    isDragActive
                                        ? "border-ant-orange bg-ant-orange/5"
                                        : "border-ant-line bg-ant-light hover:bg-ant-light/70 hover:border-ant-mid/40"
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
                                        <p className="font-display text-[14px] font-semibold text-ant-ink truncate max-w-[280px] mx-auto">{file.name}</p>
                                        <p className="font-serif italic text-[12px] text-ant-mid">{data.length} commandes détectées</p>
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

                    {/* Integrity + Commit */}
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
                                    { label: 'Normalisation téléphone', desc: 'Strip regex + format auto' },
                                    { label: 'Liaison villes', desc: 'Nom → ID en base' },
                                    { label: 'Mapping produits', desc: 'SKU → inventaire' },
                                    { label: 'Import enrichi', desc: 'Notes, source, frais' },
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
                                        disabled={data.length === 0 || validCount === 0 || !defaultStatusId || uploadMutation.isPending}
                                        onClick={() => uploadMutation.mutate(data.filter(d => d.status === 'valid'))}
                                        className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-full bg-ant-ink hover:bg-ant-ink/90 disabled:bg-ant-mid/40 disabled:cursor-not-allowed text-white text-[12px] font-semibold cursor-pointer transition-colors"
                                    >
                                        {uploadMutation.isPending ? (
                                            <>
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.75} />
                                                Traitement…
                                            </>
                                        ) : (
                                            <>
                                                Importer {validCount} commandes
                                                <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.75} />
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                        </div>
                    </section>
                </div>

                {/* Preview */}
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
                                        <TableHead className="text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold py-2.5">Produit</TableHead>
                                        <TableHead className="text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold py-2.5">Ville</TableHead>
                                        <TableHead className="text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold py-2.5">Montant</TableHead>
                                        <TableHead className="text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold py-2.5">Statut</TableHead>
                                        <TableHead className="py-2.5 pr-5 w-10" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedData.map((row) => (
                                        <TableRow key={row.id} className="hover:bg-ant-light/40 transition-colors border-ant-line">
                                            <TableCell className="pl-5 py-3">
                                                <div className="font-display text-[13px] font-semibold text-ant-ink truncate max-w-[220px]">{row.name}</div>
                                                <div className="font-serif italic text-[11px] text-ant-mid tabular-nums mt-0.5">{row.phone}</div>
                                                {row.source && <span className="text-[10px] uppercase tracking-[0.14em] text-ant-mid font-semibold">{row.source}</span>}
                                            </TableCell>
                                            <TableCell className="py-3">
                                                {row.product_id ? (
                                                    <div>
                                                        <span className="font-display text-[12px] font-semibold text-ant-ink">{row.product_sku}</span>
                                                        <div className="font-serif italic text-[11px] text-ant-mid">Qté · {row.quantity}</div>
                                                    </div>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-rose/25 bg-ant-rose/10 px-2 py-0.5 text-[10px] font-semibold text-ant-rose">
                                                        <AlertCircle className="w-3 h-3" strokeWidth={1.75} />
                                                        {row.product_sku || 'SKU manquant'}
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell className="py-3">
                                                {row.city_id ? (
                                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-green/25 bg-ant-green/10 px-2 py-0.5 text-[10px] font-semibold text-ant-green">
                                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                                                        {row.city_name}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-rose/25 bg-ant-rose/10 px-2 py-0.5 text-[10px] font-semibold text-ant-rose">
                                                        <AlertCircle className="w-3 h-3" strokeWidth={1.75} />
                                                        {row.city_name || 'Vide'}
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell className="py-3">
                                                <div className="font-display text-[13px] font-semibold tabular-nums text-ant-ink">
                                                    {row.price} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                                </div>
                                                {row.shipping_fee > 0 && (
                                                    <div className="font-serif italic text-[11px] text-ant-mid tabular-nums">+{row.shipping_fee} livraison</div>
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
                                                        <p className="font-serif italic text-[10px] text-ant-rose/80">{row.errors[0]}</p>
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="py-3 pr-5">
                                                <button
                                                    type="button"
                                                    onClick={() => setData(prev => prev.filter(d => d.id !== row.id))}
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
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
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
                                                    "inline-flex items-center justify-center h-8 w-8 rounded-lg text-[11px] font-semibold tabular-nums cursor-pointer transition-colors",
                                                    active
                                                        ? "bg-ant-ink text-white"
                                                        : "border border-ant-line bg-ant-paper hover:bg-ant-light text-ant-ink"
                                                )}
                                            >
                                                {pageNum}
                                            </button>
                                        );
                                    })}
                                    {totalPages > 5 && <span className="text-[11px] text-ant-mid font-serif italic">…</span>}
                                    <button
                                        type="button"
                                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
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

export default ImportOrders;
