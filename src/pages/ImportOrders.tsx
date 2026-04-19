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
    RefreshCcw,
    FileCheck,
    Database,
    X
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
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
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
            const { data, error } = await (supabase as any)
                .from('courier_fees')
                .select('id, courier_id, master_city_id, city_id, fee')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: companyFees } = useQuery({
        queryKey: ['company-fees-all', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('company_fees')
                .select('id, company_id, master_city_id, city_id, fee')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
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

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                    <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Import Bulk Orders</h1>
                    <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Upload Excel files to import multiple orders instantly</p>
                </div>
                <Button
                    variant="outline"
                    onClick={handleDownloadModel}
                    className="h-8 px-3 rounded-md text-[11px] font-semibold border-gray-200 gap-1.5 shrink-0"
                >
                    <Download className="w-3.5 h-3.5" />
                    Download Excel Model
                </Button>
            </header>

            {/* Upload Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <Card className={cn(
                    "lg:col-span-2 border border-gray-100 shadow-none rounded-xl overflow-hidden transition-all duration-300",
                    isDragActive ? "border-brand-navy/30 bg-brand-navy/[0.02]" : ""
                )}>
                    <CardContent className="p-0">
                        <div
                            {...getRootProps()}
                            className={cn(
                                "border-dashed border-gray-200 rounded-xl p-6 flex flex-col items-center justify-center min-h-[200px] cursor-pointer transition-all duration-300",
                                isDragActive ? "border-brand-navy/40 bg-brand-navy/[0.03]" : "hover:border-gray-300"
                            )}
                        >
                            <input {...getInputProps()} />

                            {isParsing ? (
                                <div className="text-center space-y-2">
                                    <Loader2 className="w-6 h-6 text-brand-navy animate-spin mx-auto" />
                                    <p className="text-[11px] font-semibold text-brand-navy">Analyzing file...</p>
                                    <p className="text-[10px] text-gray-400">Extracting and normalizing data</p>
                                </div>
                            ) : file && data.length > 0 ? (
                                <div className="text-center space-y-2">
                                    <FileCheck className="w-6 h-6 text-emerald-600 mx-auto" />
                                    <p className="text-[12px] font-semibold text-brand-navy">{file.name}</p>
                                    <p className="text-[11px] text-gray-500">{data.length} orders detected</p>
                                    <div className="flex items-center justify-center gap-2">
                                        <Badge className="bg-emerald-50 text-emerald-700 border-emerald-100 border h-5 px-1.5 text-[9px] font-semibold">{validCount} Ready</Badge>
                                        <Badge className="bg-red-50 text-red-700 border-red-100 border h-5 px-1.5 text-[9px] font-semibold">{data.length - validCount} Errors</Badge>
                                    </div>
                                    <Button
                                        onClick={(e) => { e.stopPropagation(); setFile(null); setData([]); }}
                                        variant="ghost"
                                        className="h-7 px-2 rounded-md text-[10px] font-semibold text-red-500 hover:bg-red-50 gap-1"
                                    >
                                        <Trash2 className="w-3 h-3" />
                                        Remove File
                                    </Button>
                                </div>
                            ) : (
                                <div className="text-center space-y-2">
                                    <Upload className="w-6 h-6 text-gray-400 mx-auto" />
                                    <p className="text-[12px] font-semibold text-brand-navy">Drop Excel here</p>
                                    <p className="text-[11px] text-gray-400">or click to browse from your computer</p>
                                    <div className="flex items-center justify-center gap-4 text-[9px] font-bold uppercase tracking-widest text-gray-400">
                                        <span className="flex items-center gap-1"><FileSpreadsheet className="w-3 h-3" /> XLSX</span>
                                        <span className="flex items-center gap-1"><FileSpreadsheet className="w-3 h-3" /> XLS</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Info + Commit Card */}
                <Card className="border border-gray-100 shadow-none rounded-xl overflow-hidden">
                    <CardContent className="p-3.5 space-y-3">
                        <div className="flex items-center gap-2">
                            <Database className="w-4 h-4 text-brand-navy/40" />
                            <p className="text-[11px] font-semibold text-brand-navy">Data Integrity Check</p>
                        </div>
                        <div className="space-y-1.5">
                            {[
                                { label: 'Phone Normalization', desc: 'Auto-regex strip & format' },
                                { label: 'City Linkage', desc: 'Matches name to database ID' },
                                { label: 'Product Mapping', desc: 'Links SKU to Inventory' },
                                { label: 'Full Data Import', desc: 'Notes, Source, & Fees' }
                            ].map((item, i) => (
                                <div key={i} className="flex items-start gap-1.5">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-[10px] font-semibold text-brand-navy">{item.label}</p>
                                        <p className="text-[9px] text-gray-400">{item.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="pt-2 border-t border-gray-100">
                            {uploadProgress > 0 ? (
                                <div className="space-y-1.5">
                                    <div className="flex justify-between text-[10px] font-semibold text-brand-navy">
                                        <span>Syncing to DB</span>
                                        <span>{uploadProgress}%</span>
                                    </div>
                                    <Progress value={uploadProgress} className="h-1.5" />
                                </div>
                            ) : (
                                <Button
                                    disabled={data.length === 0 || validCount === 0 || !defaultStatusId || uploadMutation.isPending}
                                    onClick={() => uploadMutation.mutate(data.filter(d => d.status === 'valid'))}
                                    className="w-full h-8 bg-brand-navy hover:bg-brand-navy/90 text-white rounded-md text-[11px] font-semibold gap-1.5"
                                >
                                    {uploadMutation.isPending ? (
                                        <>
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            Processing...
                                        </>
                                    ) : (
                                        <>
                                            Commit {validCount} Orders
                                            <ArrowRight className="w-3.5 h-3.5" />
                                        </>
                                    )}
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Data Preview Table */}
            {data.length > 0 && (
                <div className="space-y-3">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <p className="text-[13px] font-semibold text-brand-navy">Import Preview</p>
                            <Badge variant="secondary" className="h-5 px-1.5 text-[9px] font-semibold">{filteredData.length} rows</Badge>
                        </div>
                        <div className="relative w-full md:w-64">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <Input
                                placeholder="Search in preview..."
                                className="pl-7 h-8 rounded-md border-gray-200 text-[11px]"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>

                    <Card className="border border-gray-100 shadow-none rounded-xl overflow-hidden">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-gray-50/60 hover:bg-gray-50/60">
                                    <TableHead className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold py-2 pl-3">Client Name</TableHead>
                                    <TableHead className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold py-2">Product</TableHead>
                                    <TableHead className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold py-2">City</TableHead>
                                    <TableHead className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold py-2">Financials</TableHead>
                                    <TableHead className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold py-2">Status</TableHead>
                                    <TableHead className="py-2 pr-3 w-10" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {paginatedData.map((row) => (
                                    <TableRow key={row.id} className="hover:bg-gray-50 transition-colors border-gray-50">
                                        <TableCell className="px-3 py-2 text-[11px] text-brand-navy/80">
                                            <div className="font-medium">{row.name}</div>
                                            <div className="text-[10px] tabular-nums text-gray-400">{row.phone}</div>
                                            {row.source && <span className="text-[9px] text-gray-400">{row.source}</span>}
                                        </TableCell>
                                        <TableCell className="px-3 py-2">
                                            {row.product_id ? (
                                                <div>
                                                    <span className="text-[11px] font-semibold text-brand-navy/80">{row.product_sku}</span>
                                                    <div className="text-[10px] text-gray-400">Qty: {row.quantity}</div>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1 text-red-500">
                                                    <AlertCircle className="w-3 h-3" />
                                                    <span className="text-[10px] font-semibold">{row.product_sku || 'No SKU'}</span>
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell className="px-3 py-2">
                                            {row.city_id ? (
                                                <div className="flex items-center gap-1">
                                                    <span className="text-[11px] text-brand-navy/80">{row.city_name}</span>
                                                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1">
                                                    <AlertCircle className="w-3 h-3 text-red-500" />
                                                    <span className="text-[10px] text-red-500 line-through">{row.city_name || 'Empty'}</span>
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell className="px-3 py-2 text-[11px] tabular-nums text-brand-navy/80">
                                            <div>{row.price} DH</div>
                                            {row.shipping_fee > 0 && <div className="text-[10px] text-gray-400">+{row.shipping_fee} ship</div>}
                                        </TableCell>
                                        <TableCell className="px-3 py-2">
                                            {row.status === 'valid' ? (
                                                <Badge className="bg-emerald-50 text-emerald-700 border-none h-5 px-1.5 text-[9px] font-semibold">Valid</Badge>
                                            ) : (
                                                <div className="space-y-0.5">
                                                    <Badge className="bg-red-50 text-red-600 border-none h-5 px-1.5 text-[9px] font-semibold block w-fit">Invalid</Badge>
                                                    <span className="text-[9px] text-red-500">{row.errors[0]}</span>
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell className="px-3 py-2">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6 rounded-md text-gray-400 hover:bg-red-50 hover:text-red-500"
                                                onClick={() => setData(prev => prev.filter(d => d.id !== row.id))}
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>

                        {totalPages > 1 && (
                            <div className="px-3 py-2 border-t border-gray-100 flex items-center justify-between bg-gray-50/40">
                                <span className="text-[10px] text-gray-400">Page {currentPage} of {totalPages}</span>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                        className="h-7 w-7 rounded-md border-gray-200"
                                    >
                                        <ChevronLeft className="w-3.5 h-3.5" />
                                    </Button>
                                    {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                                        const pageNum = i + 1;
                                        return (
                                            <Button
                                                key={pageNum}
                                                variant={currentPage === pageNum ? 'default' : 'ghost'}
                                                onClick={() => setCurrentPage(pageNum)}
                                                className={cn(
                                                    "h-7 w-7 rounded-md text-[10px] font-semibold",
                                                    currentPage === pageNum ? "bg-brand-navy text-white" : ""
                                                )}
                                            >
                                                {pageNum}
                                            </Button>
                                        );
                                    })}
                                    {totalPages > 5 && <span className="text-[10px] text-gray-400">...</span>}
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                        disabled={currentPage === totalPages}
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

export default ImportOrders;
