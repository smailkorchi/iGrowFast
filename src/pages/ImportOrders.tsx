import React, { useState, useCallback, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import { useQuery, useMutation } from '@tanstack/react-query';
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
            const { data, error } = await (supabase as any)
                .from('master_cities')
                .select('id, name, zone_id')
                .order('name');
            if (error) throw error;
            return data;
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
                .eq('role', 'delivery person')
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
        },
        onSuccess: () => {
            toast({
                title: "Import Successful",
                description: `${data.length} orders have been added to the database.`,
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
            } catch (error: any) {
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
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header Section */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Import Bulk Orders</h1>
                            <p className="text-gray-500 font-light">Upload your Excel files to import multiple orders instantly.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button
                                variant="outline"
                                onClick={handleDownloadModel}
                                className="h-12 px-6 rounded-2xl border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:text-gray-900 font-medium gap-2 transition-all"
                            >
                                <Download className="w-5 h-5" />
                                Download Excel Model
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Upload Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <Card className={cn(
                    "lg:col-span-2 border-none shadow-xl rounded-[40px] overflow-hidden transition-all duration-500",
                    isDragActive ? "scale-[0.99]" : ""
                )}>
                    <CardContent className="p-0">
                        <div
                            {...getRootProps()}
                            className={cn(
                                "relative flex flex-col items-center justify-center min-h-[400px] cursor-pointer transition-all duration-500",
                                isDragActive
                                    ? "bg-brand-navy/[0.08]"
                                    : "bg-white/40 hover:bg-white/60 backdrop-blur-xl"
                            )}
                        >
                            <input {...getInputProps()} />

                            <div className="absolute inset-0 border-2 border-dashed border-brand-navy/10 rounded-[40px] m-4 pointer-events-none" />

                            {isParsing ? (
                                <div className="text-center space-y-4 animate-pulse">
                                    <div className="w-20 h-20 bg-brand-navy/10 rounded-[32px] flex items-center justify-center mx-auto">
                                        <Loader2 className="w-10 h-10 text-brand-navy animate-spin" />
                                    </div>
                                    <h3 className="text-2xl font-bold text-brand-navy">Analyzing File...</h3>
                                    <p className="text-muted-foreground">Extracting and normalizing your data</p>
                                </div>
                            ) : file && data.length > 0 ? (
                                <div className="text-center space-y-6">
                                    <div className="w-24 h-24 bg-green-500/10 rounded-[32px] flex items-center justify-center mx-auto shadow-2xl shadow-green-500/20">
                                        <FileCheck className="w-12 h-12 text-green-600" />
                                    </div>
                                    <div>
                                        <h3 className="text-3xl font-bold text-brand-navy">{file.name}</h3>
                                        <p className="text-muted-foreground mt-2 font-medium">{data.length} orders detected</p>
                                    </div>
                                    <div className="flex items-center justify-center gap-3">
                                        <Badge className="bg-green-500 h-8 px-4 rounded-full text-sm">{validCount} Ready</Badge>
                                        <Badge variant="destructive" className="h-8 px-4 rounded-full text-sm">{data.length - validCount} Errors</Badge>
                                    </div>
                                    <Button
                                        onClick={(e) => { e.stopPropagation(); setFile(null); setData([]); }}
                                        variant="ghost"
                                        className="text-brand-red hover:bg-brand-red/10 rounded-xl"
                                    >
                                        <Trash2 className="w-4 h-4 mr-2" />
                                        Remove File
                                    </Button>
                                </div>
                            ) : (
                                <div className="text-center space-y-6 group">
                                    <div className="w-24 h-24 bg-brand-navy/5 rounded-[32px] flex items-center justify-center mx-auto group-hover:scale-110 transition-transform duration-500 border border-brand-navy/5 shadow-inner">
                                        <Upload className="w-12 h-12 text-brand-navy/40" />
                                    </div>
                                    <div>
                                        <h3 className="text-3xl font-bold text-brand-navy">Drop Excel here</h3>
                                        <p className="text-muted-foreground mt-2 text-lg">or click to browse from your computer</p>
                                    </div>
                                    <div className="flex items-center justify-center gap-8 text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">
                                        <span className="flex items-center gap-2"><FileSpreadsheet className="w-3 h-3" /> XLSX</span>
                                        <span className="flex items-center gap-2"><FileSpreadsheet className="w-3 h-3" /> XLS</span>
                                        <span className="flex items-center gap-2"><FileSpreadsheet className="w-3 h-3" /> CSV</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Info Card */}
                <Card className="border-none shadow-xl bg-brand-navy rounded-[40px] text-brand-white p-8 flex flex-col justify-between overflow-hidden relative group">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-32 -mt-32 blur-3xl group-hover:bg-white/10 transition-colors" />

                    <div className="relative space-y-6">
                        <div className="w-14 h-14 bg-white/10 rounded-[20px] flex items-center justify-center backdrop-blur-md">
                            <Database className="w-7 h-7" />
                        </div>
                        <h3 className="text-2xl font-bold leading-tight">Data Integrity Check</h3>
                        <p className="text-brand-white/60 leading-relaxed font-medium">
                            Our system automatically verifies phone numbers using Moroccan normalization and checks for city existence in your database.
                        </p>

                        <div className="space-y-4 pt-4">
                            {[
                                { label: 'Phone Normalization', desc: 'Auto-regex strip & format' },
                                { label: 'City Linkage', desc: 'Matches name to database ID' },
                                { label: 'Product Mapping', desc: 'Links SKU to Inventory' },
                                { label: 'Full Data Import', desc: 'Notes, Source, & Fees' }
                            ].map((item, i) => (
                                <div key={i} className="flex gap-4">
                                    <div className="mt-1"><CheckCircle2 className="w-4 h-4 text-green-400" /></div>
                                    <div>
                                        <div className="text-sm font-bold">{item.label}</div>
                                        <div className="text-[10px] uppercase font-bold text-brand-white/40">{item.desc}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="relative pt-12">
                        {uploadProgress > 0 ? (
                            <div className="space-y-3">
                                <div className="flex justify-between text-xs font-bold uppercase tracking-widest">
                                    <span>Syncing to DB</span>
                                    <span>{uploadProgress}%</span>
                                </div>
                                <Progress value={uploadProgress} className="h-2 bg-white/10" />
                            </div>
                        ) : (
                            <Button
                                disabled={data.length === 0 || validCount === 0 || !defaultStatusId || uploadMutation.isPending}
                                onClick={() => uploadMutation.mutate(data.filter(d => d.status === 'valid'))}
                                className="w-full h-14 bg-brand-white text-brand-navy hover:bg-brand-white/90 rounded-2xl text-base font-black shadow-2xl transition-all"
                            >
                                {uploadMutation.isPending ? (
                                    <>
                                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        Commit {validCount} Orders
                                        <ArrowRight className="w-5 h-5 ml-2" />
                                    </>
                                )}
                            </Button>
                        )}
                    </div>
                </Card>
            </div>

            {/* Data Preview Table */}
            {data.length > 0 && (
                <div className="space-y-6 animate-in slide-in-from-bottom-8 duration-700">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <h2 className="text-2xl font-bold text-brand-navy">Import Preview</h2>
                            <Badge variant="secondary" className="rounded-full px-4 h-7 font-black">{filteredData.length} Total</Badge>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="relative w-[300px]">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search in preview..."
                                    className="pl-11 h-11 rounded-xl bg-white/50 border-none shadow-inner"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    <Card className="border-none shadow-xl rounded-[32px] overflow-hidden bg-white/50 backdrop-blur-xl">
                        <Table>
                            <TableHeader className="bg-brand-navy/5">
                                <TableRow className="hover:bg-transparent border-none">
                                    <TableHead className="font-bold text-brand-navy py-6 pl-8">Client Name</TableHead>
                                    <TableHead className="font-bold text-brand-navy">Product Details</TableHead>
                                    <TableHead className="font-bold text-brand-navy">City</TableHead>
                                    <TableHead className="font-bold text-brand-navy">Financials</TableHead>
                                    <TableHead className="font-bold text-brand-navy">Status</TableHead>
                                    <TableHead className="font-bold text-brand-navy pr-8">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {paginatedData.map((row) => (
                                    <TableRow key={row.id} className="hover:bg-brand-navy/[0.02] border-brand-navy/5 transition-colors group">
                                        <TableCell className="font-bold text-brand-navy py-5 pl-8">
                                            <div>{row.name}</div>
                                            <div className="text-xs text-muted-foreground font-normal">{row.phone}</div>
                                            <Badge variant="outline" className="mt-1 text-[10px] h-5">{row.source}</Badge>
                                        </TableCell>
                                        <TableCell>
                                            {row.product_id ? (
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-brand-navy text-sm">{row.product_sku}</span>
                                                    <span className="text-xs text-muted-foreground">Qty: {row.quantity}</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1 text-brand-red">
                                                    <AlertCircle className="w-3 h-3" />
                                                    <span className="text-xs font-bold">{row.product_sku || 'No SKU'}</span>
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {row.city_id ? (
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-brand-navy">{row.city_name}</span>
                                                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2">
                                                    <AlertCircle className="w-3.5 h-3.5 text-brand-red" />
                                                    <span className="text-brand-red font-black text-xs uppercase italic line-through opacity-50">{row.city_name || 'Empty'}</span>
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <div className="font-bold text-brand-navy">{row.price} DH</div>
                                            {row.shipping_fee > 0 && <div className="text-xs text-muted-foreground">+ {row.shipping_fee} DH Ship</div>}
                                        </TableCell>
                                        <TableCell>
                                            {row.status === 'valid' ? (
                                                <Badge className="bg-green-500/10 text-green-600 border-none rounded-lg px-3 py-1 font-bold">Valid</Badge>
                                            ) : (
                                                <div className="flex flex-col gap-1">
                                                    <Badge className="bg-brand-red/10 text-brand-red border-none rounded-lg px-3 py-1 font-bold w-fit">Invalid</Badge>
                                                    <span className="text-[10px] text-brand-red font-bold uppercase tracking-tighter">{row.errors[0]}</span>
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell className="pr-8">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="rounded-full text-muted-foreground hover:bg-brand-red/10 hover:text-brand-red transition-all"
                                                onClick={() => setData(prev => prev.filter(d => d.id !== row.id))}
                                            >
                                                <X className="w-4 h-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>

                        {/* Pagination Controls */}
                        {totalPages > 1 && (
                            <div className="p-6 border-t border-brand-navy/5 flex items-center justify-between bg-brand-navy/5">
                                <div className="text-sm font-bold text-muted-foreground uppercase tracking-widest pl-4">
                                    Page {currentPage} of {totalPages}
                                </div>
                                <div className="flex items-center gap-2 pr-4">
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                        className="rounded-xl border-none shadow-sm hover:scale-105 transition-transform"
                                    >
                                        <ChevronLeft className="w-5 h-5" />
                                    </Button>
                                    <div className="flex items-center gap-1">
                                        {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                                            const pageNum = i + 1;
                                            return (
                                                <Button
                                                    key={pageNum}
                                                    variant={currentPage === pageNum ? 'default' : 'ghost'}
                                                    onClick={() => setCurrentPage(pageNum)}
                                                    className={cn(
                                                        "w-10 h-10 rounded-xl font-bold",
                                                        currentPage === pageNum ? "bg-brand-navy text-brand-white shadow-lg" : ""
                                                    )}
                                                >
                                                    {pageNum}
                                                </Button>
                                            );
                                        })}
                                        {totalPages > 5 && <span className="px-2 text-muted-foreground font-bold">...</span>}
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                        disabled={currentPage === totalPages}
                                        className="rounded-xl border-none shadow-sm hover:scale-105 transition-transform"
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

export default ImportOrders;
