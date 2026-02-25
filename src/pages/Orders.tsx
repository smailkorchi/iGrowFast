import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus,
    Search,
    MoreVertical,
    Edit2,
    Trash2,
    Loader2,
    Package,
    Phone,
    MapPin,
    Calendar,
    ShoppingCart,
    CheckCircle2,
    XCircle,
    Clock,
    DollarSign,
    PlusCircle,
    X,
    Eye,
    Truck,
    Hash,
    MessageSquare,
    ChevronDown,
    MapPinned,
    ExternalLink,
    RefreshCcw,
    User,
    Filter,
    Building2,
    LayoutGrid,
    List,
    ShoppingBag,
    ShieldCheck,
    BarChart3
} from 'lucide-react';
import {
    Card,
    CardContent
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
    FormDescription
} from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn } from '@/lib/utils';
import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, subMonths, isWithinInterval } from 'date-fns';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import type { DateRange } from 'react-day-picker';
import CustomerInsights from '@/components/CustomerInsights';
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Check, ChevronsUpDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

// --- Schemas ---
const orderItemSchema = z.object({
    product_id: z.string().uuid("Please select a product"),
    quantity: z.coerce.number().min(1, "Quantity must be at least 1"),
    unit_price: z.coerce.number().min(0, "Price must be positive"),
});

const orderSchema = z.object({
    name: z.string().min(2, "Full Name is required"),
    phone: z.string().min(8, "Phone number is required"),
    city_id: z.string().uuid("Please select a city"),
    address: z.string().min(5, "Address is required"),
    source_name: z.string().min(1, "Source is required"),
    shipping_cost: z.coerce.number().min(0),
    replace: z.boolean().default(false), // "extchange" in request
    note: z.string().optional(),
    delivery_note: z.string().optional(),
    delivery_type: z.string().optional(),
    order_status_id: z.string().uuid("Please select a status"),
    items: z.array(orderItemSchema).min(1, "At least one product is required"),
    courier_id: z.string().uuid().optional().nullable(),
    company_id: z.string().uuid().optional().nullable(),
    history_comment: z.string().optional(),
});

type OrderFormValues = z.infer<typeof orderSchema>;

const SALES_SOURCES = [
    "whatsapp",
    "facebook",
    "instagram",
    "tiktok",
    "phone call",
    "connaissance",
    "reorder",
    "other"
];

const Orders = () => {
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
    const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
    const [isAttributionModalOpen, setIsAttributionModalOpen] = useState(false);
    const [isBulkStatusModalOpen, setIsBulkStatusModalOpen] = useState(false);
    const [bulkStatusComment, setBulkStatusComment] = useState("");
    const [sellerSearchQuery, setSellerSearchQuery] = useState("");

    // Dropdown search states
    const [citySearchOpen, setCitySearchOpen] = useState(false);
    const [statusSearchOpen, setStatusSearchOpen] = useState(false);

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // Filter states
    const [filterStatus, setFilterStatus] = useState<string>("all");
    const [filterCity, setFilterCity] = useState<string>("all");
    const [filterSource, setFilterSource] = useState<string>("all");
    const [filterProvider, setFilterProvider] = useState<string>("all");

    // Advanced filter states
    const [filterDateField, setFilterDateField] = useState<string>('date');
    const [filterTimeRange, setFilterTimeRange] = useState<string>('all');
    const [filterCustomRange, setFilterCustomRange] = useState<DateRange | undefined>(undefined);
    const [showCalendar, setShowCalendar] = useState(false);
    const [filterCustomerName, setFilterCustomerName] = useState('');
    const [filterPhone, setFilterPhone] = useState('');
    const [filterProduct, setFilterProduct] = useState<string>('all');
    const [filterPackageStatus, setFilterPackageStatus] = useState<string>('all');
    const [filterConfirmedBy, setFilterConfirmedBy] = useState<string>('all');
    const [filterAssignedTo, setFilterAssignedTo] = useState<string>('all');
    const [showAllFilters, setShowAllFilters] = useState(false);
    const [showCustomerInsights, setShowCustomerInsights] = useState(false);

    // Add custom scrollbar styles to head
    React.useEffect(() => {
        const style = document.createElement('style');
        style.innerHTML = `
            .custom-scrollbar::-webkit-scrollbar {
                width: 6px;
            }
            .custom-scrollbar::-webkit-scrollbar-track {
                background: transparent;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb {
                background: rgba(0, 31, 63, 0.1);
                border-radius: 10px;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                background: rgba(0, 31, 63, 0.2);
            }
            @keyframes pulse-subtle {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.8; transform: scale(1.02); }
            }
            .animate-pulse-subtle {
                animation: pulse-subtle 3s cubic-bezier(0.4, 0, 0.6, 1) infinite;
            }
        `;
        document.head.appendChild(style);
        return () => { document.head.removeChild(style); };
    }, []);

    // --- Queries ---


    const { data: orders, isLoading } = useQuery({
        queryKey: ['orders', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('orders')
                .select(`
                    *,
                    status:order_statuses(*),
                    package_status:package_statuses(*),
                    city:master_cities(id, name),
                    courier:users!orders_courier_id_fkey(id, name, avatar_url),
                    assignee:users!orders_assign_id_fkey(id, name, avatar_url),
                    company:providers(id, name, logo_url),
                    items:order_items(*, product:products(name, code, image_url)),
                    history:order_status_history(*, user:users!changed_by(name, avatar_url), status:order_statuses!status_id(*))
                `)
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        },
    });

    const { data: cities } = useQuery({
        queryKey: ['cities-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('master_cities')
                .select('id, name, zone_id')
                .eq('DigiCom Business', activeBusinessId)
                .order('name');
            if (error) throw error;
            return data;
        },
    });

    const { data: couriers } = useQuery({
        queryKey: ['couriers-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name')
                .eq('role', 'delivery person')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: companies } = useQuery({
        queryKey: ['companies-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('providers')
                .select('id, name')
                .eq('active', true)
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
                .select('*')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: companyZones } = useQuery({
        queryKey: ['company-zones-all', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('company_zones')
                .select('*')
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
                .select('*')
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
                .select('*')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: orderStatuses } = useQuery({
        queryKey: ['order-statuses-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('order_statuses')
                .select('id, code, label, ranking, color')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId)
                .order('ranking', { ascending: true });
            if (error) throw error;
            return data;
        },
    });

    const { data: products } = useQuery({
        queryKey: ['products-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('products')
                .select('id, name, code, selling_price')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId)
                .order('name');
            if (error) throw error;
            return data;
        },
    });

    const { data: packageStatuses } = useQuery({
        queryKey: ['package-statuses-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('package_statuses')
                .select('id, code, label, color')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId)
                .order('ranking', { ascending: true });
            if (error) throw error;
            return data;
        },
    });

    const { data: confirmers } = useQuery({
        queryKey: ['confirmers-dropdown', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, avatar_url')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    const { data: sellers } = useQuery({
        queryKey: ['sellers-commercial', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, avatar_url, role')
                .eq('role', 'commercial')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        }
    });

    // --- Form ---
    const form = useForm<OrderFormValues>({
        resolver: zodResolver(orderSchema),
        defaultValues: {
            name: '',
            phone: '',
            city_id: '',
            address: '',
            source_name: 'facebook',
            shipping_cost: 0,
            replace: false,
            note: '',
            delivery_note: '',
            delivery_type: 'Home Delivery',
            order_status_id: '',
            items: [{ product_id: '', quantity: 1, unit_price: 0 }],
            courier_id: null,
            company_id: null
        }
    });

    const selectedCityId = form.watch('city_id');
    const selectedCourierId = form.watch('courier_id');
    const selectedCompanyId = form.watch('company_id');

    const availableProviders = useMemo(() => {
        if (!selectedCityId || !cities) return [];
        const city = cities.find((c: any) => c.id === selectedCityId);
        if (!city) return [];

        const zoneId = city.zone_id;

        // 1. Providers eligible via zone
        const zoneCouriers = zoneId ? couriers?.filter((c: any) =>
            courierZones?.some((cz: any) => cz.courier_id === c.id && cz.zone_id === zoneId)
        ) : [];

        const zoneCompanies = zoneId ? companies?.filter((c: any) =>
            companyZones?.some((cz: any) => cz.company_id === c.id && cz.zone_id === zoneId)
        ) : [];

        // 2. Providers that have a fee for this city (even if no zone)
        const feeCouriers = couriers?.filter((c: any) =>
            courierFees?.some((f: any) => f.courier_id === c.id && (f.master_city_id === selectedCityId || f.city_id === selectedCityId))
        ) || [];

        const feeCompanies = companies?.filter((c: any) =>
            companyFees?.some((f: any) => f.company_id === c.id && (f.master_city_id === selectedCityId || f.city_id === selectedCityId))
        ) || [];

        // Combine and unique by ID
        const combinedCouriers = [...(zoneCouriers || []), ...feeCouriers];
        const combinedCompanies = [...(zoneCompanies || []), ...feeCompanies];

        const eligibleCouriers = combinedCouriers
            .filter((v, i, a) => a.findIndex(t => t.id === v.id) === i)
            .map((c: any) => ({ ...c, type: 'courier' }));

        const eligibleCompanies = combinedCompanies
            .filter((v, i, a) => a.findIndex(t => t.id === v.id) === i)
            .map((c: any) => ({ ...c, type: 'company' }));

        return [...eligibleCouriers, ...eligibleCompanies];
    }, [selectedCityId, cities, couriers, companies, courierZones, companyZones, courierFees, companyFees]);

    // Derived Data for all providers (used for dropdowns where city is not a factor)
    const allProviders = useMemo(() => {
        const c = couriers?.map((p: any) => ({ ...p, type: 'courier' })) || [];
        const comp = companies?.map((p: any) => ({ ...p, type: 'company' })) || [];
        return [...c, ...comp];
    }, [couriers, companies]);

    // Auto-select best provider and set fee when city changes
    React.useEffect(() => {
        if (!selectedCityId || !availableProviders.length) return;

        // If no provider selected, pick the best one
        if (!selectedCourierId && !selectedCompanyId) {
            const providersWithFees = availableProviders.map(p => {
                let fee = Infinity;
                if (p.type === 'courier') {
                    fee = courierFees?.find((f: any) => f.courier_id === p.id && (f.master_city_id === selectedCityId || f.city_id === selectedCityId))?.fee || Infinity;
                } else {
                    fee = companyFees?.find((f: any) => f.company_id === p.id && (f.master_city_id === selectedCityId || f.city_id === selectedCityId))?.fee || Infinity;
                }
                return { ...p, fee: Number(fee) };
            });

            const best = providersWithFees.sort((a, b) => a.fee - b.fee)[0];
            if (best) {
                if (best.type === 'courier') {
                    form.setValue('courier_id', best.id);
                    form.setValue('company_id', null);
                } else {
                    form.setValue('company_id', best.id);
                    form.setValue('courier_id', null);
                }
                form.setValue('shipping_cost', best.fee === Infinity ? 0 : best.fee);
            }
        } else {
            // Provider is already selected, just update the fee for the new city
            let foundFee = 0;
            if (selectedCourierId) {
                foundFee = courierFees?.find((f: any) => f.courier_id === selectedCourierId && (f.master_city_id === selectedCityId || f.city_id === selectedCityId))?.fee || 0;
            } else if (selectedCompanyId) {
                foundFee = companyFees?.find((f: any) => f.company_id === selectedCompanyId && (f.master_city_id === selectedCityId || f.city_id === selectedCityId))?.fee || 0;
            }
            form.setValue('shipping_cost', Number(foundFee));
        }
    }, [selectedCityId, availableProviders, courierFees, companyFees, selectedCourierId, selectedCompanyId, form]);

    const calculateShippingFee = () => {
        if (!selectedCityId || (!selectedCourierId && !selectedCompanyId)) return;

        let fee = 0;
        if (selectedCourierId) {
            fee = courierFees?.find((f: any) => f.courier_id === selectedCourierId && (f.master_city_id === selectedCityId || f.city_id === selectedCityId))?.fee || 0;
        } else if (selectedCompanyId) {
            fee = companyFees?.find((f: any) => f.company_id === selectedCompanyId && (f.master_city_id === selectedCityId || f.city_id === selectedCityId))?.fee || 0;
        }
        form.setValue('shipping_cost', Number(fee));
    };

    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: "items"
    });

    // --- Mutations ---
    const createOrderMutation = useMutation({
        mutationFn: async (values: OrderFormValues) => {
            // 1. Insert order
            const totalPrice = values.items.reduce((acc, item) => acc + (item.quantity * item.unit_price), 0);

            const { data: order, error: orderError } = await (supabase as any)
                .from('orders')
                .insert({
                    name: values.name,
                    phone: values.phone,
                    master_city_id: values.city_id,
                    address: values.address,
                    source_name: values.source_name,
                    shipping_cost: values.shipping_cost,
                    replace: values.replace,
                    note: values.note,
                    delivery_note: values.delivery_note,
                    delivery_type: values.delivery_type,
                    order_status_id: values.order_status_id,
                    courier_id: values.courier_id,
                    company_id: values.company_id,
                    price: totalPrice + values.shipping_cost,
                    raw_price: totalPrice,
                    date: new Date().toISOString(),
                    'DigiCom Business': activeBusinessId
                })
                .select()
                .single();

            if (orderError) throw orderError;

            // 2. Insert items
            const itemRecords = values.items.map(item => ({
                order_id: order.id,
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: item.unit_price,
                'DigiCom Business': activeBusinessId
            }));

            const { error: itemsError } = await (supabase as any)
                .from('order_items')
                .insert(itemRecords);

            if (itemsError) throw itemsError;

            return order;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders', activeBusinessId] });
            setIsAddModalOpen(false);
            form.reset();
            toast({ title: "Order Created", description: "Successfully logged new order." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const updateOrderMutation = useMutation({
        mutationFn: async (values: OrderFormValues) => {
            if (!selectedOrder) return;

            const totalPrice = values.items.reduce((acc, item) => acc + (item.quantity * item.unit_price), 0);

            // Get current user
            const userRes = await (supabase as any).auth.getUser();
            const userId = userRes.data.user?.id;

            // Build update payload
            const updatePayload: any = {
                name: values.name,
                phone: values.phone,
                master_city_id: values.city_id,
                address: values.address,
                source_name: values.source_name,
                shipping_cost: values.shipping_cost,
                replace: values.replace,
                note: values.note,
                delivery_note: values.delivery_note,
                delivery_type: values.delivery_type,
                order_status_id: values.order_status_id,
                courier_id: values.courier_id,
                company_id: values.company_id,
                price: totalPrice + values.shipping_cost,
                raw_price: totalPrice,
                updated_at: new Date().toISOString()
            };

            // Status-specific field population
            if (values.order_status_id && values.order_status_id !== selectedOrder.order_status_id) {
                const newStatus = orderStatuses?.find((s: any) => s.id === values.order_status_id);
                if (newStatus?.code === 'CONFIRMED') {
                    updatePayload.confirmed_by_id = userId;
                    updatePayload.confirmation_date = new Date().toISOString();
                }
                if (newStatus?.code === 'CANCELED') {
                    updatePayload.canceled_by_id = userId;
                    updatePayload.annulation_date = new Date().toISOString();
                }
                if (newStatus?.code === 'PAID') {
                    updatePayload.date_livraison = new Date().toISOString();
                }
                if (newStatus?.code === 'POSTPONED') {
                    updatePayload.reported_date = new Date().toISOString();
                }
            }

            // 1. Update order
            const { error: orderError } = await (supabase as any)
                .from('orders')
                .update(updatePayload)
                .eq('id', selectedOrder.id)
                .eq('DigiCom Business', activeBusinessId);

            if (orderError) throw orderError;

            // 2. Refresh items (Delete & Insert for simplicity, or complex diff)
            const { error: deleteError } = await (supabase as any)
                .from('order_items')
                .delete()
                .eq('order_id', selectedOrder.id);

            if (deleteError) throw deleteError;

            const itemRecords = values.items.map(item => ({
                order_id: selectedOrder.id,
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: item.unit_price,
                'DigiCom Business': activeBusinessId
            }));

            const { error: itemsError } = await (supabase as any)
                .from('order_items')
                .insert(itemRecords);

            if (itemsError) throw itemsError;

            // 3. Track History if Status Changed
            if (values.order_status_id && values.order_status_id !== selectedOrder.order_status_id) {
                try {
                    await (supabase as any).from('order_status_history').insert({
                        order_id: selectedOrder.id,
                        status_id: values.order_status_id,
                        comment: values.history_comment || '',
                        changed_by: userId,
                        'DigiCom Business': activeBusinessId
                    });
                } catch (err) {
                    console.error("History tracking error:", err);
                }
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders', activeBusinessId] });
            setIsEditModalOpen(false);
            setSelectedOrder(null);
            toast({ title: "Order Updated", description: "Changes saved successfully." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const deleteOrderMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await (supabase as any)
                .from('orders')
                .delete()
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders', activeBusinessId] });
            toast({ title: "Order Deleted", description: "Order removed from history." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const bulkStatusMutation = useMutation({
        mutationFn: async ({ orderIds, statusId }: { orderIds: string[], statusId: string }) => {
            const userRes = await (supabase as any).auth.getUser();
            const userId = userRes.data.user?.id;

            // Build update payload with status-specific fields
            const updatePayload: any = {
                order_status_id: statusId,
                updated_at: new Date().toISOString()
            };

            const newStatus = orderStatuses?.find((s: any) => s.id === statusId);
            if (newStatus?.code === 'CONFIRMED') {
                updatePayload.confirmed_by_id = userId;
                updatePayload.confirmation_date = new Date().toISOString();
            }
            if (newStatus?.code === 'CANCELED') {
                updatePayload.canceled_by_id = userId;
                updatePayload.annulation_date = new Date().toISOString();
            }
            if (newStatus?.code === 'PAID') {
                updatePayload.date_livraison = new Date().toISOString();
            }
            if (newStatus?.code === 'POSTPONED') {
                updatePayload.reported_date = new Date().toISOString();
            }

            const { error } = await (supabase as any)
                .from('orders')
                .update(updatePayload)
                .in('id', orderIds)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;

            // Track history for bulk
            try {
                const historyRecords = orderIds.map(oId => ({
                    order_id: oId,
                    status_id: statusId,
                    comment: bulkStatusComment || 'Bulk status update',
                    changed_by: userId,
                    'DigiCom Business': activeBusinessId
                }));
                await (supabase as any).from('order_status_history').insert(historyRecords);
            } catch (err) {
                console.error("Bulk history error", err);
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders', activeBusinessId] });
            setSelectedOrders([]);
            setIsBulkStatusModalOpen(false);
            setBulkStatusComment("");
            toast({ title: "Success", description: "Orders status updated successfully." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const bulkAttributeMutation = useMutation({
        mutationFn: async ({ orderIds, sellerId }: { orderIds: string[], sellerId: string | null }) => {
            const updatePayload: any = {
                assign_id: sellerId,
                updated_at: new Date().toISOString(),
                assignment_date: sellerId ? new Date().toISOString() : null
            };
            const { error } = await (supabase as any)
                .from('orders')
                .update(updatePayload)
                .in('id', orderIds)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders', activeBusinessId] });
            setSelectedOrders([]);
            setIsAttributionModalOpen(false);
            toast({ title: "Success", description: "Orders attributed successfully." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const toggleOrderSelection = (id: string) => {
        setSelectedOrders(prev =>
            prev.includes(id) ? prev.filter(oid => oid !== id) : [...prev, id]
        );
    };

    const toggleSelectAll = (orderIds: string[]) => {
        if (selectedOrders.length === orderIds.length) {
            setSelectedOrders([]);
        } else {
            setSelectedOrders(orderIds);
        }
    };

    // --- Date range helper ---
    const getDateRange = useMemo(() => {
        const now = new Date();
        switch (filterTimeRange) {
            case 'today': return { from: startOfDay(now), to: endOfDay(now) };
            case 'yesterday': return { from: startOfDay(subDays(now, 1)), to: endOfDay(subDays(now, 1)) };
            case 'last7': return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
            case 'last30': return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
            case 'thisMonth': return { from: startOfMonth(now), to: endOfDay(now) };
            case 'lastMonth': { const lm = subMonths(now, 1); return { from: startOfMonth(lm), to: endOfMonth(lm) }; }
            case 'custom': return filterCustomRange?.from && filterCustomRange?.to ? { from: startOfDay(filterCustomRange.from), to: endOfDay(filterCustomRange.to) } : null;
            default: return null;
        }
    }, [filterTimeRange, filterCustomRange]);

    const DATE_FIELD_MAP: Record<string, string> = {
        'date': 'date',
        'created_at': 'created_at',
        'updated_at': 'updated_at',
        'assignment_date': 'assignment_date',
        'confirmation_date': 'confirmation_date',
        'annulation_date': 'annulation_date',
        'date_livraison': 'date_livraison',
        'reported_date': 'reported_date',
    };

    // --- Helpers ---
    const filteredOrders = useMemo(() => {
        if (!orders) return [];
        return orders.filter(o => {
            const matchesSearch =
                o.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                o.phone?.includes(searchQuery) ||
                o.tracking_number?.toLowerCase().includes(searchQuery.toLowerCase());

            const matchesStatus = filterStatus === "all" || o.order_status_id === filterStatus;
            const matchesCity = filterCity === "all" || o.master_city_id === filterCity || o.city_id === filterCity;
            const matchesSource = filterSource === "all" || o.source_name === filterSource;
            const matchesProvider = filterProvider === "all" || o.courier_id === filterProvider || o.company_id === filterProvider;

            // Date/time filter
            let matchesDate = true;
            if (getDateRange) {
                const fieldKey = DATE_FIELD_MAP[filterDateField] || 'date';
                const dateVal = o[fieldKey];
                if (dateVal) {
                    matchesDate = isWithinInterval(new Date(dateVal), { start: getDateRange.from, end: getDateRange.to });
                } else {
                    matchesDate = false;
                }
            }

            // Customer name
            const matchesCustomerName = !filterCustomerName || o.name?.toLowerCase().includes(filterCustomerName.toLowerCase());

            // Phone
            const matchesPhone = !filterPhone || o.phone?.includes(filterPhone);

            // Product
            const matchesProduct = filterProduct === 'all' || o.items?.some((item: any) => item.product_id === filterProduct);

            // Package status
            const matchesPackageStatus = filterPackageStatus === 'all' || o.package_status_id === filterPackageStatus;

            // Confirmed by
            const matchesConfirmedBy = filterConfirmedBy === 'all' || o.confirmed_by_id === filterConfirmedBy;

            // Assigned to
            const matchesAssignedTo = filterAssignedTo === 'all' || o.assign_id === filterAssignedTo;

            return matchesSearch && matchesStatus && matchesCity && matchesSource && matchesProvider && matchesDate && matchesCustomerName && matchesPhone && matchesProduct && matchesPackageStatus && matchesConfirmedBy && matchesAssignedTo;
        });
    }, [orders, searchQuery, filterStatus, filterCity, filterSource, filterProvider, getDateRange, filterDateField, filterCustomerName, filterPhone, filterProduct, filterPackageStatus, filterConfirmedBy, filterAssignedTo]);

    const activeFilterCount = useMemo(() => {
        let count = 0;
        if (filterStatus !== 'all') count++;
        if (filterCity !== 'all') count++;
        if (filterSource !== 'all') count++;
        if (filterProvider !== 'all') count++;
        if (filterTimeRange !== 'all') count++;
        if (filterCustomerName) count++;
        if (filterPhone) count++;
        if (filterProduct !== 'all') count++;
        if (filterPackageStatus !== 'all') count++;
        if (filterConfirmedBy !== 'all') count++;
        if (filterAssignedTo !== 'all') count++;
        return count;
    }, [filterStatus, filterCity, filterSource, filterProvider, filterTimeRange, filterCustomerName, filterPhone, filterProduct, filterPackageStatus, filterConfirmedBy, filterAssignedTo]);

    const clearAllFilters = () => {
        setFilterStatus('all');
        setFilterCity('all');
        setFilterSource('all');
        setFilterProvider('all');
        setFilterTimeRange('all');
        setFilterCustomRange(undefined);
        setFilterDateField('date');
        setFilterCustomerName('');
        setFilterPhone('');
        setFilterProduct('all');
        setFilterPackageStatus('all');
        setFilterConfirmedBy('all');
        setFilterAssignedTo('all');
    };

    const handleEdit = (order: any) => {
        setSelectedOrder(order);
        form.reset({
            name: order.name,
            phone: order.phone,
            city_id: order.master_city_id || order.city_id,
            address: order.address,
            source_name: order.source_name,
            shipping_cost: Number(order.shipping_cost),
            replace: order.replace,
            note: order.note || '',
            delivery_note: order.delivery_note || '',
            delivery_type: order.delivery_type || 'Home Delivery',
            order_status_id: order.order_status_id,
            courier_id: order.courier_id,
            company_id: order.company_id,
            items: order.items.map((item: any) => ({
                product_id: item.product_id,
                quantity: Number(item.quantity),
                unit_price: Number(item.unit_price)
            }))
        });
        setIsEditModalOpen(true);
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-2">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-brand-navy rounded-2xl shadow-lg shadow-brand-navy/20">
                            <ShoppingCart className="w-6 h-6 text-brand-white" />
                        </div>
                        <h1 className="text-4xl font-black tracking-tight text-brand-navy">Order Pipeline</h1>
                    </div>
                    <p className="text-muted-foreground text-lg font-medium">Streamline your sales flow and delivery tracking.</p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 items-center">
                    <div className="relative group sm:w-80">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-brand-navy" />
                        <Input
                            placeholder="Search client, phone, or tracking..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-11 h-12 bg-white/50 border-none shadow-sm rounded-2xl focus-visible:ring-1 focus-visible:ring-brand-navy/20 transition-all font-medium"
                        />
                    </div>
                    <Button
                        onClick={() => {
                            form.reset();
                            setIsAddModalOpen(true);
                        }}
                        className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-12 px-6 font-bold shadow-lg shadow-brand-navy/10 transition-all active:scale-95 flex items-center gap-2 w-full sm:w-auto"
                    >
                        <PlusCircle className="w-5 h-5" />
                        New Order
                    </Button>
                </div>
            </div>

            {/* Dashboard Stats (Optional Placeholder) */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="border-none bg-blue-50/50 rounded-[24px] p-6 space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-blue-600/60">Active Orders</p>
                    <h3 className="text-3xl font-black text-brand-navy">{filteredOrders.length}</h3>
                </Card>
                <div className="bg-brand-navy rounded-[32px] p-6 text-brand-white shadow-2xl shadow-brand-navy/30 relative overflow-hidden group">
                    <div className="relative z-10 flex flex-col h-full justify-between">
                        <span className="text-xs font-black uppercase text-brand-white/60 tracking-widest mb-2 block">Total Sales</span>
                        <span className="text-3xl md:text-5xl font-black tracking-tight">{filteredOrders.reduce((acc, o) => acc + (o.raw_price || 0), 0).toFixed(0)} DH</span>
                    </div>
                    <div className="absolute -right-4 -bottom-4 w-32 h-32 bg-brand-white/5 rounded-full blur-2xl group-hover:bg-brand-white/10 transition-colors duration-500" />
                </div>
                <Card className="border-none bg-amber-50/50 rounded-[24px] p-6 space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-600/60">Exchanges</p>
                    <h3 className="text-3xl font-black text-brand-navy">
                        {filteredOrders.filter(o => o.replace).length}
                    </h3>
                </Card>
                <div className="bg-white rounded-[32px] p-6 border-2 border-brand-navy/[0.03] hover:border-brand-navy/[0.08] transition-colors shadow-xl shadow-brand-navy/5 relative overflow-hidden group">
                    <div className="relative z-10 flex flex-col h-full justify-between">
                        <span className="text-xs font-black text-brand-navy/40 uppercase tracking-widest mb-2 block">Avg Order Value</span>
                        <span className="text-3xl md:text-4xl font-black text-brand-navy tracking-tight">
                            {filteredOrders.length > 0
                                ? (filteredOrders.reduce((acc, o) => acc + (o.raw_price || 0), 0) / filteredOrders.length).toFixed(0)
                                : '0'} DH
                        </span>
                    </div>
                    <div className="absolute -right-4 -bottom-4 w-32 h-32 bg-brand-navy/[0.02] rounded-full blur-2xl group-hover:bg-brand-navy/[0.04] transition-colors duration-500" />
                </div>
            </div>

            {/* Filters Toolbar */}
            <div className="space-y-3 pb-4">
                {/* Top Bar: View Switcher + Filters Toggle + Active Pills + Count */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                        {/* View Switcher */}
                        <div className="flex bg-white p-1 rounded-2xl shadow-sm border border-brand-navy/[0.04] shrink-0">
                            <Button variant="ghost" size="sm" onClick={() => setViewMode('grid')}
                                className={cn("h-8 w-8 p-0 rounded-xl transition-all duration-300", viewMode === 'grid' ? "bg-brand-navy text-brand-white shadow-lg" : "text-brand-navy/30 hover:text-brand-navy hover:bg-brand-navy/5")}>
                                <LayoutGrid className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setViewMode('list')}
                                className={cn("h-8 w-8 p-0 rounded-xl transition-all duration-300", viewMode === 'list' ? "bg-brand-navy text-brand-white shadow-lg" : "text-brand-navy/30 hover:text-brand-navy hover:bg-brand-navy/5")}>
                                <List className="w-4 h-4" />
                            </Button>
                        </div>

                        {/* Filter Toggle */}
                        <Button variant="ghost" size="sm" onClick={() => setShowAllFilters(!showAllFilters)}
                            className={cn(
                                "h-9 px-4 rounded-2xl gap-2 text-xs font-bold transition-all duration-300",
                                showAllFilters
                                    ? "bg-brand-navy text-brand-white shadow-xl shadow-brand-navy/20"
                                    : "bg-white text-brand-navy/60 border border-brand-navy/[0.06] hover:border-brand-navy/10 hover:text-brand-navy shadow-sm"
                            )}>
                            <Filter className="w-3.5 h-3.5" />
                            Filters
                            {activeFilterCount > 0 && (
                                <span className={cn(
                                    "ml-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-black leading-none",
                                    showAllFilters ? "bg-brand-white/25 text-brand-white" : "bg-brand-navy text-brand-white"
                                )}>
                                    {activeFilterCount}
                                </span>
                            )}
                        </Button>

                        {/* Active Filter Chips */}
                        {activeFilterCount > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 animate-in fade-in duration-300">
                                {filterTimeRange !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-100">
                                        <Clock className="w-3 h-3" />
                                        {filterTimeRange === 'custom' && filterCustomRange?.from ? `${format(filterCustomRange.from, 'dd/MM')}–${filterCustomRange.to ? format(filterCustomRange.to, 'dd/MM') : '...'}` : filterTimeRange.replace(/([A-Z])/g, ' $1').trim()}
                                        <button onClick={() => { setFilterTimeRange('all'); setFilterCustomRange(undefined); }} className="ml-0.5 hover:bg-blue-100 rounded-full p-0.5 transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterStatus !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-purple-50 text-purple-700 text-[10px] font-bold border border-purple-100">
                                        <ShieldCheck className="w-3 h-3" />
                                        {orderStatuses?.find((s: any) => s.id === filterStatus)?.label || 'Status'}
                                        <button onClick={() => setFilterStatus('all')} className="ml-0.5 hover:bg-purple-100 rounded-full p-0.5 transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterPackageStatus !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-orange-50 text-orange-700 text-[10px] font-bold border border-orange-100">
                                        <Package className="w-3 h-3" />
                                        {packageStatuses?.find((s: any) => s.id === filterPackageStatus)?.label || 'Package'}
                                        <button onClick={() => setFilterPackageStatus('all')} className="ml-0.5 hover:bg-orange-100 rounded-full p-0.5 transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterCity !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-100">
                                        <MapPin className="w-3 h-3" />
                                        {cities?.find((c: any) => c.id === filterCity)?.name || 'City'}
                                        <button onClick={() => setFilterCity('all')} className="ml-0.5 hover:bg-emerald-100 rounded-full p-0.5 transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterProduct !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-pink-50 text-pink-700 text-[10px] font-bold border border-pink-100">
                                        <ShoppingBag className="w-3 h-3" />
                                        {products?.find((p: any) => p.id === filterProduct)?.name || 'Product'}
                                        <button onClick={() => setFilterProduct('all')} className="ml-0.5 hover:bg-pink-100 rounded-full p-0.5 transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterCustomerName && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold border border-slate-200">
                                        <User className="w-3 h-3" />"{filterCustomerName}"
                                        <button onClick={() => setFilterCustomerName('')} className="ml-0.5 hover:bg-slate-200 rounded-full p-0.5 transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterPhone && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold border border-slate-200">
                                        <Phone className="w-3 h-3" />{filterPhone}
                                        <button onClick={() => setFilterPhone('')} className="ml-0.5 hover:bg-slate-200 rounded-full p-0.5 transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterSource !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-cyan-50 text-cyan-700 text-[10px] font-bold border border-cyan-100 capitalize">
                                        <ExternalLink className="w-3 h-3" />{filterSource}
                                        <button onClick={() => setFilterSource('all')} className="ml-0.5 hover:bg-cyan-100 rounded-full p-0.5 transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterConfirmedBy !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-green-50 text-green-700 text-[10px] font-bold border border-green-100">
                                        <CheckCircle2 className="w-3 h-3" />
                                        {confirmers?.find((u: any) => u.id === filterConfirmedBy)?.name || 'Confirmer'}
                                        <button onClick={() => setFilterConfirmedBy('all')} className="ml-0.5 hover:bg-green-100 rounded-full p-0.5 transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterAssignedTo !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-bold border border-indigo-100">
                                        <User className="w-3 h-3" />
                                        {sellers?.find((s: any) => s.id === filterAssignedTo)?.name || 'Seller'}
                                        <button onClick={() => setFilterAssignedTo('all')} className="ml-0.5 hover:bg-indigo-100 rounded-full p-0.5 transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}
                                {filterProvider !== 'all' && (
                                    <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold border border-amber-100">
                                        <Truck className="w-3 h-3" />
                                        {allProviders.find((p: any) => p.id === filterProvider)?.name || 'Service'}
                                        <button onClick={() => setFilterProvider('all')} className="ml-0.5 hover:bg-amber-100 rounded-full p-0.5 transition-colors"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                )}

                                <button onClick={clearAllFilters} className="h-7 px-2 rounded-full text-[10px] font-bold text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                                    Clear all
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="h-7 px-3 rounded-full bg-brand-navy/[0.04] flex items-center">
                            <span className="text-[11px] font-bold text-brand-navy/60">{filteredOrders.length} <span className="text-brand-navy/30 font-medium">records</span></span>
                        </div>
                    </div>
                </div>

                {/* Expandable Filter Panel */}
                {showAllFilters && (
                    <div className="bg-white/80 backdrop-blur-xl rounded-[28px] border border-brand-navy/[0.04] shadow-xl shadow-brand-navy/[0.03] overflow-hidden animate-in slide-in-from-top-2 fade-in duration-400">
                        {/* Time Section */}
                        <div className="p-5 border-b border-brand-navy/[0.04]">
                            <div className="flex items-center gap-2 mb-3.5">
                                <div className="w-6 h-6 rounded-lg bg-blue-500/10 flex items-center justify-center">
                                    <Calendar className="w-3.5 h-3.5 text-blue-500" />
                                </div>
                                <span className="text-[11px] font-black uppercase tracking-widest text-brand-navy/40">Date & Time</span>
                            </div>
                            <div className="flex flex-wrap items-end gap-4">
                                <div className="space-y-1.5 min-w-[140px]">
                                    <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider">Filter By</span>
                                    <Select value={filterDateField} onValueChange={setFilterDateField}>
                                        <SelectTrigger className="h-10 rounded-xl border-brand-navy/[0.06] bg-brand-navy/[0.02] text-xs font-bold text-brand-navy hover:border-brand-navy/10 transition-colors">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-none shadow-2xl shadow-brand-navy/10">
                                            <SelectItem value="date" className="text-xs font-bold rounded-xl">Order Date</SelectItem>
                                            <SelectItem value="created_at" className="text-xs font-bold rounded-xl">Created Date</SelectItem>
                                            <SelectItem value="updated_at" className="text-xs font-bold rounded-xl">Updated Date</SelectItem>
                                            <SelectItem value="assignment_date" className="text-xs font-bold rounded-xl">Assigned Date</SelectItem>
                                            <SelectItem value="confirmation_date" className="text-xs font-bold rounded-xl">Confirmed Date</SelectItem>
                                            <SelectItem value="annulation_date" className="text-xs font-bold rounded-xl">Cancelled Date</SelectItem>
                                            <SelectItem value="date_livraison" className="text-xs font-bold rounded-xl">Delivered Date</SelectItem>
                                            <SelectItem value="reported_date" className="text-xs font-bold rounded-xl">Reported Date</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider">Range</span>
                                    <div className="flex flex-wrap gap-1.5">
                                        {([
                                            { v: 'all', l: 'All' },
                                            { v: 'today', l: 'Today' },
                                            { v: 'yesterday', l: 'Yesterday' },
                                            { v: 'last7', l: '7 Days' },
                                            { v: 'last30', l: '30 Days' },
                                            { v: 'thisMonth', l: 'This Month' },
                                            { v: 'lastMonth', l: 'Last Month' },
                                            { v: 'custom', l: 'Custom' },
                                        ] as const).map(opt => (
                                            <button
                                                key={opt.v}
                                                onClick={() => { setFilterTimeRange(opt.v); if (opt.v !== 'custom') setShowCalendar(false); else setShowCalendar(true); }}
                                                className={cn(
                                                    "h-10 px-3.5 rounded-xl text-[11px] font-bold transition-all duration-200 border",
                                                    filterTimeRange === opt.v
                                                        ? "bg-brand-navy text-brand-white border-brand-navy shadow-lg shadow-brand-navy/20"
                                                        : "bg-brand-navy/[0.02] text-brand-navy/50 border-brand-navy/[0.06] hover:border-brand-navy/10 hover:text-brand-navy/70 hover:bg-brand-navy/[0.04]"
                                                )}
                                            >
                                                {opt.l}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {filterTimeRange === 'custom' && (
                                    <div className="space-y-1.5">
                                        <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider">Pick Dates</span>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button variant="outline" className="h-10 rounded-xl border-brand-navy/[0.06] bg-brand-navy/[0.02] text-xs font-bold text-brand-navy gap-2 px-4 hover:border-brand-navy/10">
                                                    <Calendar className="w-3.5 h-3.5 text-blue-500" />
                                                    {filterCustomRange?.from ? (
                                                        filterCustomRange.to ? (
                                                            <>{format(filterCustomRange.from, 'MMM dd')} — {format(filterCustomRange.to, 'MMM dd, yyyy')}</>
                                                        ) : format(filterCustomRange.from, 'MMM dd, yyyy')
                                                    ) : 'Select range...'}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0 rounded-[24px] border-none shadow-2xl shadow-brand-navy/10" align="start">
                                                <CalendarComponent
                                                    mode="range"
                                                    selected={filterCustomRange}
                                                    onSelect={setFilterCustomRange}
                                                    numberOfMonths={2}
                                                    className="rounded-[24px] p-4"
                                                />
                                            </PopoverContent>
                                        </Popover>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Search Section */}
                        <div className="p-5 border-b border-brand-navy/[0.04]">
                            <div className="flex items-center gap-2 mb-3.5">
                                <div className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                                    <Search className="w-3.5 h-3.5 text-emerald-500" />
                                </div>
                                <span className="text-[11px] font-black uppercase tracking-widest text-brand-navy/40">Customer Search</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="relative group">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-navy/20 group-focus-within:text-brand-navy/50 transition-colors" />
                                    <Input
                                        placeholder="Customer name..."
                                        value={filterCustomerName}
                                        onChange={(e) => setFilterCustomerName(e.target.value)}
                                        className="h-10 w-[200px] pl-9 rounded-xl border-brand-navy/[0.06] bg-brand-navy/[0.02] text-xs font-medium hover:border-brand-navy/10 focus-visible:ring-1 focus-visible:ring-brand-navy/10"
                                    />
                                </div>
                                <div className="relative group">
                                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-navy/20 group-focus-within:text-brand-navy/50 transition-colors" />
                                    <Input
                                        placeholder="Phone number..."
                                        value={filterPhone}
                                        onChange={(e) => setFilterPhone(e.target.value)}
                                        className="h-10 w-[180px] pl-9 rounded-xl border-brand-navy/[0.06] bg-brand-navy/[0.02] text-xs font-medium hover:border-brand-navy/10 focus-visible:ring-1 focus-visible:ring-brand-navy/10"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Dropdowns Grid */}
                        <div className="p-5">
                            <div className="flex items-center gap-2 mb-3.5">
                                <div className="w-6 h-6 rounded-lg bg-purple-500/10 flex items-center justify-center">
                                    <Filter className="w-3.5 h-3.5 text-purple-500" />
                                </div>
                                <span className="text-[11px] font-black uppercase tracking-widest text-brand-navy/40">Filters</span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                                {/* Order Status */}
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider flex items-center gap-1">
                                        <ShieldCheck className="w-3 h-3" /> Status
                                    </span>
                                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                                        <SelectTrigger className={cn("h-10 rounded-xl text-xs font-bold transition-all", filterStatus !== 'all' ? "border-purple-200 bg-purple-50/50 text-purple-700" : "border-brand-navy/[0.06] bg-brand-navy/[0.02] text-brand-navy")}>
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-none shadow-2xl shadow-brand-navy/10 max-h-[300px]">
                                            <SelectItem value="all" className="font-bold text-xs rounded-xl">All Statuses</SelectItem>
                                            {orderStatuses?.map((s: any) => (
                                                <SelectItem key={s.id} value={s.id} className="font-bold text-xs rounded-xl">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                                                        {s.label}
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Package Status */}
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider flex items-center gap-1">
                                        <Package className="w-3 h-3" /> Package
                                    </span>
                                    <Select value={filterPackageStatus} onValueChange={setFilterPackageStatus}>
                                        <SelectTrigger className={cn("h-10 rounded-xl text-xs font-bold transition-all", filterPackageStatus !== 'all' ? "border-orange-200 bg-orange-50/50 text-orange-700" : "border-brand-navy/[0.06] bg-brand-navy/[0.02] text-brand-navy")}>
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-none shadow-2xl shadow-brand-navy/10 max-h-[300px]">
                                            <SelectItem value="all" className="font-bold text-xs rounded-xl">All Packages</SelectItem>
                                            {packageStatuses?.map((s: any) => (
                                                <SelectItem key={s.id} value={s.id} className="font-bold text-xs rounded-xl">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                                                        {s.label}
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* City */}
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider flex items-center gap-1">
                                        <MapPin className="w-3 h-3" /> City
                                    </span>
                                    <Select value={filterCity} onValueChange={setFilterCity}>
                                        <SelectTrigger className={cn("h-10 rounded-xl text-xs font-bold transition-all", filterCity !== 'all' ? "border-emerald-200 bg-emerald-50/50 text-emerald-700" : "border-brand-navy/[0.06] bg-brand-navy/[0.02] text-brand-navy")}>
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-none shadow-2xl shadow-brand-navy/10 max-h-[300px]">
                                            <SelectItem value="all" className="font-bold text-xs rounded-xl">All Cities</SelectItem>
                                            {cities?.map((c: any) => (
                                                <SelectItem key={c.id} value={c.id} className="font-bold text-xs rounded-xl">{c.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Product */}
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider flex items-center gap-1">
                                        <ShoppingBag className="w-3 h-3" /> Product
                                    </span>
                                    <Select value={filterProduct} onValueChange={setFilterProduct}>
                                        <SelectTrigger className={cn("h-10 rounded-xl text-xs font-bold transition-all", filterProduct !== 'all' ? "border-pink-200 bg-pink-50/50 text-pink-700" : "border-brand-navy/[0.06] bg-brand-navy/[0.02] text-brand-navy")}>
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-none shadow-2xl shadow-brand-navy/10 max-h-[300px]">
                                            <SelectItem value="all" className="font-bold text-xs rounded-xl">All Products</SelectItem>
                                            {products?.map((p: any) => (
                                                <SelectItem key={p.id} value={p.id} className="font-bold text-xs rounded-xl">{p.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Source */}
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider flex items-center gap-1">
                                        <ExternalLink className="w-3 h-3" /> Source
                                    </span>
                                    <Select value={filterSource} onValueChange={setFilterSource}>
                                        <SelectTrigger className={cn("h-10 rounded-xl text-xs font-bold transition-all", filterSource !== 'all' ? "border-cyan-200 bg-cyan-50/50 text-cyan-700" : "border-brand-navy/[0.06] bg-brand-navy/[0.02] text-brand-navy")}>
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-none shadow-2xl shadow-brand-navy/10">
                                            <SelectItem value="all" className="font-bold text-xs rounded-xl">All Sources</SelectItem>
                                            {SALES_SOURCES.map((s) => (
                                                <SelectItem key={s} value={s} className="font-bold text-xs capitalize rounded-xl">{s}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Confirmed By */}
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider flex items-center gap-1">
                                        <CheckCircle2 className="w-3 h-3" /> Confirmed By
                                    </span>
                                    <Select value={filterConfirmedBy} onValueChange={setFilterConfirmedBy}>
                                        <SelectTrigger className={cn("h-10 rounded-xl text-xs font-bold transition-all", filterConfirmedBy !== 'all' ? "border-green-200 bg-green-50/50 text-green-700" : "border-brand-navy/[0.06] bg-brand-navy/[0.02] text-brand-navy")}>
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-none shadow-2xl shadow-brand-navy/10 max-h-[300px]">
                                            <SelectItem value="all" className="font-bold text-xs rounded-xl">All Users</SelectItem>
                                            {confirmers?.map((u: any) => (
                                                <SelectItem key={u.id} value={u.id} className="font-bold text-xs rounded-xl">{u.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Assigned To */}
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider flex items-center gap-1">
                                        <User className="w-3 h-3" /> Assigned To
                                    </span>
                                    <Select value={filterAssignedTo} onValueChange={setFilterAssignedTo}>
                                        <SelectTrigger className={cn("h-10 rounded-xl text-xs font-bold transition-all", filterAssignedTo !== 'all' ? "border-indigo-200 bg-indigo-50/50 text-indigo-700" : "border-brand-navy/[0.06] bg-brand-navy/[0.02] text-brand-navy")}>
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-none shadow-2xl shadow-brand-navy/10 max-h-[300px]">
                                            <SelectItem value="all" className="font-bold text-xs rounded-xl">All Sellers</SelectItem>
                                            {sellers?.map((s: any) => (
                                                <SelectItem key={s.id} value={s.id} className="font-bold text-xs rounded-xl">{s.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Delivery Service */}
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-bold text-brand-navy/30 uppercase tracking-wider flex items-center gap-1">
                                        <Truck className="w-3 h-3" /> Delivery
                                    </span>
                                    <Select value={filterProvider} onValueChange={setFilterProvider}>
                                        <SelectTrigger className={cn("h-10 rounded-xl text-xs font-bold transition-all", filterProvider !== 'all' ? "border-amber-200 bg-amber-50/50 text-amber-700" : "border-brand-navy/[0.06] bg-brand-navy/[0.02] text-brand-navy")}>
                                            <SelectValue placeholder="All" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl border-none shadow-2xl shadow-brand-navy/10 max-h-[300px]">
                                            <SelectItem value="all" className="font-bold text-xs rounded-xl">All Services</SelectItem>
                                            {allProviders.map((p: any) => (
                                                <SelectItem key={p.id} value={p.id} className="font-bold text-xs rounded-xl">
                                                    <div className="flex items-center gap-2">
                                                        {p.type === 'courier' ? <Truck className="w-3 h-3 text-orange-500" /> : <Building2 className="w-3 h-3 text-blue-500" />}
                                                        {p.name}
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Content Section */}
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-64 w-full rounded-[32px]" />
                    ))}
                </div>
            ) : filteredOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-6 bg-brand-white rounded-[40px] shadow-sm border border-brand-navy/[0.03]">
                    <div className="w-24 h-24 bg-brand-navy/[0.04] rounded-full flex items-center justify-center">
                        <ShoppingCart className="w-12 h-12 text-brand-navy/20" />
                    </div>
                    <div className="text-center space-y-2">
                        <h3 className="text-2xl font-bold text-brand-navy">No orders found</h3>
                        <p className="text-muted-foreground max-w-xs mx-auto">Start by adding your first customer order to track its progress.</p>
                    </div>
                </div>
            ) : (
                <>
                    {viewMode === 'grid' ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
                            {filteredOrders.map((order) => (
                                <Card
                                    key={order.id}
                                    className="group relative overflow-hidden border-none bg-white/60 backdrop-blur-md shadow-sm hover:shadow-2xl transition-all duration-500 rounded-[32px] border border-white/20"
                                >
                                    {/* Status Accent Bar */}
                                    <div className="absolute top-0 left-0 w-full h-1.5 opacity-80" style={{ backgroundColor: order.status?.color || '#ccc' }} />

                                    {/* Selection Checkbox */}
                                    <div className="absolute top-4 left-4 z-10">
                                        <Checkbox
                                            checked={selectedOrders.includes(order.id)}
                                            onCheckedChange={() => toggleOrderSelection(order.id)}
                                            className="h-5 w-5 rounded-md border-white/20 data-[state=checked]:bg-brand-navy data-[state=checked]:text-brand-white shadow-lg"
                                        />
                                    </div>

                                    <CardContent className="p-7 space-y-6">
                                        {/* Status Row */}
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            {/* Order Status */}
                                            <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-2xl bg-white shadow-sm border border-brand-navy/[0.03]">
                                                <div className="p-1 rounded-lg" style={{ backgroundColor: `${order.status?.color}15` }}>
                                                    <ShieldCheck className="w-4 h-4" style={{ color: order.status?.color }} />
                                                </div>
                                                <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: order.status?.color }}>
                                                    {order.status?.label || 'DRAFT'}
                                                </span>
                                            </div>

                                            {/* Package Status */}
                                            {(order.package_status || order.package_status_label) && (
                                                <div
                                                    className="flex items-center gap-2.5 px-3 py-1.5 rounded-2xl bg-brand-navy/[0.03] border animate-pulse-subtle"
                                                    style={{
                                                        borderColor: order.package_status ? `${order.package_status.color}40` : 'rgba(0, 31, 63, 0.05)',
                                                        backgroundColor: order.package_status ? `${order.package_status.color}10` : 'rgba(0, 31, 63, 0.03)'
                                                    }}
                                                >
                                                    <div className="p-1 rounded-lg" style={{ backgroundColor: order.package_status ? `${order.package_status.color}20` : 'rgba(0, 31, 63, 0.1)' }}>
                                                        <Truck className="w-4 h-4" style={{ color: order.package_status ? order.package_status.color : 'rgba(0, 31, 63, 0.6)' }} />
                                                    </div>
                                                    <span
                                                        className="text-[10px] font-black uppercase tracking-widest"
                                                        style={{ color: order.package_status ? order.package_status.color : 'rgba(0, 31, 63, 0.6)' }}
                                                    >
                                                        {order.package_status ? order.package_status.label : order.package_status_label}
                                                    </span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Client Info */}
                                        <div className="space-y-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-navy to-brand-navy/80 flex shrink-0 items-center justify-center text-white shadow-lg shadow-brand-navy/20 group-hover:scale-110 transition-transform duration-500">
                                                        <User className="w-6 h-6" />
                                                    </div>
                                                    <div className="flex flex-col min-w-0">
                                                        <h3 className="text-xl font-black text-brand-navy truncate leading-tight tracking-tight">
                                                            {order.name}
                                                        </h3>
                                                        <div className="flex items-center gap-1.5 text-muted-foreground/70">
                                                            <Phone className="w-3 h-3" />
                                                            <span className="text-xs font-bold tracking-wider">{order.phone}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Assigned Seller Tag */}
                                                {order.assignee && (
                                                    <div className="flex shrink-0 items-center gap-2 pl-1 pr-3 py-1 mt-1 rounded-2xl bg-brand-navy/[0.03] border border-brand-navy/[0.05] shadow-sm transform group-hover:scale-105 transition-transform duration-300">
                                                        <Avatar className="w-6 h-6 border-2 border-white shadow-sm">
                                                            <AvatarImage src={order.assignee.avatar_url} />
                                                            <AvatarFallback className="bg-orange-100 text-orange-600 text-[10px] font-black">
                                                                {order.assignee.name?.[0]}
                                                            </AvatarFallback>
                                                        </Avatar>
                                                        <span className="text-[10px] font-black text-brand-navy/60 uppercase tracking-tighter truncate max-w-[80px]">
                                                            {order.assignee.name}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>

                                            {(order.company_id || order.courier_id) && (
                                                <div className="flex items-center gap-2 ml-1">
                                                    <div className="w-5 h-5 rounded-md bg-brand-navy/[0.03] p-0.5 border border-brand-navy/[0.05] flex items-center justify-center overflow-hidden">
                                                        {order.company?.logo_url ? (
                                                            <img src={order.company.logo_url} alt={order.company.name} className="w-full h-full object-contain" />
                                                        ) : order.courier?.avatar_url ? (
                                                            <img src={order.courier.avatar_url} alt={order.courier.name} className="w-full h-full object-cover" />
                                                        ) : (
                                                            order.company_id ? <Building2 className="w-3 h-3 text-blue-500/50" /> : <Truck className="w-3 h-3 text-orange-500/50" />
                                                        )}
                                                    </div>
                                                    <span className="text-[10px] font-black text-brand-navy/30 uppercase tracking-tighter">
                                                        Logistics: <span className="text-brand-navy/60">{order.company?.name || order.courier?.name}</span>
                                                    </span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Metadata Grid */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="p-3.5 rounded-[20px] bg-brand-navy/[0.02] border border-brand-navy/[0.03] hover:bg-white transition-colors duration-300">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <div className="w-6 h-6 rounded-lg bg-orange-50 flex items-center justify-center text-orange-500">
                                                        <MapPin className="w-3.5 h-3.5" />
                                                    </div>
                                                    <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Destination</span>
                                                </div>
                                                <p className="text-sm font-bold text-brand-navy truncate pl-8">{order.city?.name}</p>
                                            </div>
                                            <div className="p-3.5 rounded-[20px] bg-brand-navy/[0.02] border border-brand-navy/[0.03] hover:bg-white transition-colors duration-300">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <div className="w-6 h-6 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-500">
                                                        <Hash className="w-3.5 h-3.5" />
                                                    </div>
                                                    <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Channel</span>
                                                </div>
                                                <p className="text-sm font-bold text-brand-navy capitalize pl-8">{order.source_name}</p>
                                            </div>
                                        </div>

                                        <Separator className="bg-brand-navy/[0.05]" />

                                        {/* Footer */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex flex-col">
                                                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 leading-none mb-1">Net Balance</span>
                                                <div className="flex items-baseline gap-1">
                                                    <span className="text-3xl font-black text-brand-navy">{order.raw_price || 0}</span>
                                                    <span className="text-xs font-black text-brand-navy/40 uppercase">DH</span>
                                                </div>
                                            </div>

                                            <div className="flex gap-2">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => {
                                                        setSelectedOrder(order);
                                                        setIsViewModalOpen(true);
                                                    }}
                                                    className="h-12 w-12 rounded-2xl bg-brand-navy/[0.04] hover:bg-brand-navy text-brand-navy hover:text-brand-white transition-all duration-300 shadow-sm active:scale-95"
                                                >
                                                    <Eye className="w-6 h-6" />
                                                </Button>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-12 w-12 rounded-2xl bg-brand-navy/[0.04] text-brand-navy hover:bg-brand-navy/10 active:scale-95 transition-all">
                                                            <MoreVertical className="h-6 w-6" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-2xl p-2 min-w-[200px] animate-in slide-in-from-top-2">
                                                        <DropdownMenuItem
                                                            onClick={() => handleEdit(order)}
                                                            className="rounded-xl p-3 cursor-pointer focus:bg-brand-navy focus:text-brand-white gap-3 transition-colors"
                                                        >
                                                            <Edit2 className="w-4 h-4" />
                                                            <span className="font-bold">Modify Details</span>
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem
                                                            onClick={() => {
                                                                if (confirm("Delete this order? This action is permanent.")) {
                                                                    deleteOrderMutation.mutate(order.id);
                                                                }
                                                            }}
                                                            className="rounded-xl p-3 cursor-pointer text-red-500 focus:bg-red-50 focus:text-red-600 gap-3 transition-colors"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                            <span className="font-bold">Delete Order</span>
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </div>

                                        {/* Exchange Flag */}
                                        {order.replace && (
                                            <div className="absolute -right-12 -top-12 w-24 h-24 bg-red-500/10 rotate-45 flex items-end justify-center pb-2 group-hover:bg-red-500/20 transition-colors">
                                                <RefreshCcw className="w-5 h-5 text-red-500 -rotate-45" />
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    ) : (
                        <div className="bg-white/50 backdrop-blur-sm shadow-xl rounded-[32px] overflow-hidden border border-brand-navy/[0.03] mb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-brand-navy/[0.02]">
                                            <th className="p-6 w-12">
                                                <Checkbox
                                                    checked={selectedOrders.length === filteredOrders.length && filteredOrders.length > 0}
                                                    onCheckedChange={() => toggleSelectAll(filteredOrders.map(o => o.id))}
                                                    className="translate-y-0.5"
                                                />
                                            </th>
                                            <th className="p-6 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Customer</th>
                                            <th className="p-6 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Dest. & Source</th>
                                            <th className="p-6 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Status & Provider</th>
                                            <th className="p-6 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Assigned Seller</th>
                                            <th className="p-6 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Total Amount</th>
                                            <th className="p-6 text-[10px] font-black uppercase tracking-widest text-brand-navy/40 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-brand-navy/[0.03]">
                                        {filteredOrders.map((order) => (
                                            <tr key={order.id} className={cn(
                                                "hover:bg-brand-navy/[0.01] transition-colors group",
                                                selectedOrders.includes(order.id) ? "bg-brand-navy/[0.02]" : ""
                                            )}>
                                                <td className="p-6">
                                                    <Checkbox
                                                        checked={selectedOrders.includes(order.id)}
                                                        onCheckedChange={() => toggleOrderSelection(order.id)}
                                                    />
                                                </td>
                                                <td className="p-6">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-xl bg-brand-navy/[0.04] flex items-center justify-center text-brand-navy shrink-0 group-hover:scale-110 transition-transform">
                                                            <User className="w-5 h-5" />
                                                        </div>
                                                        <div className="flex flex-col min-w-0">
                                                            <span className="text-sm font-bold text-brand-navy truncate">
                                                                {order.name}
                                                                {order.replace && <RefreshCcw className="inline-block w-3 h-3 ml-2 text-red-500" />}
                                                            </span>
                                                            <span className="text-[10px] font-bold text-muted-foreground tracking-wider">{order.phone}</span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="p-6">
                                                    <div className="flex flex-col gap-1">
                                                        <div className="flex items-center gap-1.5 text-xs font-bold text-brand-navy">
                                                            <MapPin className="w-3 h-3 text-orange-500" />
                                                            {order.city?.name}
                                                        </div>
                                                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                                            <Hash className="w-3 h-3 text-indigo-500" />
                                                            {order.source_name}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="p-6">
                                                    <div className="flex flex-col gap-1.5">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white shadow-sm border border-brand-navy/[0.03]">
                                                                <ShieldCheck className="w-3 h-3" style={{ color: order.status?.color }} />
                                                                <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: order.status?.color }}>
                                                                    {order.status?.label || 'DRAFT'}
                                                                </span>
                                                            </div>

                                                            {/* Package Status */}
                                                            {(order.package_status || order.package_status_label) && (
                                                                <div
                                                                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-brand-navy/[0.03] border animate-pulse-subtle"
                                                                    style={{
                                                                        borderColor: order.package_status ? `${order.package_status.color}40` : 'rgba(0, 31, 63, 0.05)',
                                                                        backgroundColor: order.package_status ? `${order.package_status.color}10` : 'rgba(0, 31, 63, 0.03)'
                                                                    }}
                                                                >
                                                                    <Truck className="w-3 h-3" style={{ color: order.package_status ? order.package_status.color : 'rgba(0, 31, 63, 0.6)' }} />
                                                                    <span
                                                                        className="text-[8px] font-bold uppercase tracking-tight"
                                                                        style={{ color: order.package_status ? order.package_status.color : 'rgba(0, 31, 63, 0.6)' }}
                                                                    >
                                                                        {order.package_status ? order.package_status.label : order.package_status_label}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>

                                                        {(order.company_id || order.courier_id) && (
                                                            <div className="flex items-center gap-1 opacity-30 group-hover:opacity-100 transition-opacity duration-300">
                                                                <span className="text-[7px] font-black text-brand-navy uppercase tracking-widest">via</span>
                                                                <span className="text-[8px] font-black text-brand-navy uppercase tracking-tighter">
                                                                    {order.company?.name || order.courier?.name}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-6">
                                                    <div className="flex items-center gap-2">
                                                        {order.assignee ? (
                                                            <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-orange-50 border border-orange-100 shadow-sm animate-in fade-in zoom-in duration-300">
                                                                <Avatar className="w-6 h-6 border-2 border-white">
                                                                    <AvatarImage src={order.assignee.avatar_url} />
                                                                    <AvatarFallback className="bg-orange-200 text-orange-700 text-[10px] font-black">
                                                                        {order.assignee.name?.[0]}
                                                                    </AvatarFallback>
                                                                </Avatar>
                                                                <span className="text-[10px] font-black text-orange-700 uppercase tracking-tight truncate max-w-[80px]">
                                                                    {order.assignee.name}
                                                                </span>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-gray-50 border border-gray-100 opacity-50">
                                                                <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center">
                                                                    <User className="w-3 h-3 text-gray-400" />
                                                                </div>
                                                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">Unassigned</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-6">
                                                    <span className="text-base font-black text-brand-navy">{order.raw_price || 0} DH</span>
                                                </td>
                                                <td className="p-6 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => {
                                                                setSelectedOrder(order);
                                                                setIsViewModalOpen(true);
                                                            }}
                                                            className="h-9 w-9 rounded-xl bg-brand-navy/[0.04] hover:bg-brand-navy text-brand-navy hover:text-brand-white transition-all shadow-sm"
                                                        >
                                                            <Eye className="w-4 h-4" />
                                                        </Button>
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild>
                                                                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl bg-brand-navy/[0.04] text-brand-navy hover:bg-brand-navy/[0.08]">
                                                                    <MoreVertical className="h-4 w-4" />
                                                                </Button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-2xl p-2 min-w-[180px] animate-in slide-in-from-top-2">
                                                                <DropdownMenuItem
                                                                    onClick={() => handleEdit(order)}
                                                                    className="rounded-xl p-3 cursor-pointer focus:bg-brand-navy focus:text-brand-white gap-3"
                                                                >
                                                                    <Edit2 className="w-4 h-4" />
                                                                    <span className="font-bold">Edit Details</span>
                                                                </DropdownMenuItem>
                                                                <DropdownMenuSeparator />
                                                                <DropdownMenuItem
                                                                    onClick={() => {
                                                                        if (confirm("Delete this order?")) {
                                                                            deleteOrderMutation.mutate(order.id);
                                                                        }
                                                                    }}
                                                                    className="rounded-xl p-3 cursor-pointer text-red-500 focus:bg-red-50 focus:text-red-600 gap-3"
                                                                >
                                                                    <Trash2 className="w-4 h-4" />
                                                                    <span className="font-bold">Delete Order</span>
                                                                </DropdownMenuItem>
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Bulk Edit Bar */}
                    {selectedOrders.length > 0 && (
                        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-10 duration-500">
                            <div className="bg-brand-navy text-brand-white px-6 py-4 rounded-[32px] shadow-2xl flex flex-row items-center gap-4 md:gap-6 backdrop-blur-xl bg-brand-navy/90 border border-white/10 mx-4 w-max max-w-[95vw] overflow-x-auto custom-scrollbar">
                                <div className="flex items-center gap-3 pr-4 md:pr-6 border-r border-white/10 shrink-0">
                                    <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center font-black text-xs shrink-0">
                                        {selectedOrders.length}
                                    </div>
                                    <span className="text-sm font-bold whitespace-nowrap shrink-0">Orders Selected</span>
                                </div>

                                <div className="flex flex-row items-center justify-center gap-2 shrink-0">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setIsBulkStatusModalOpen(true)}
                                        className="text-brand-white hover:bg-white/10 rounded-2xl gap-2 font-bold px-4 shrink-0"
                                    >
                                        <ShieldCheck className="w-4 h-4" /> Change Status
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setIsAttributionModalOpen(true)}
                                        className="text-brand-white hover:bg-white/10 rounded-2xl gap-2 font-bold px-4 shrink-0"
                                    >
                                        <User className="w-4 h-4" /> Attribute Seller
                                    </Button>
                                    <div className="w-[1px] h-4 bg-white/10 mx-1 md:mx-2 shrink-0" />
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setSelectedOrders([])}
                                        className="text-red-400 hover:bg-red-500/10 rounded-2xl gap-2 font-bold px-4 shrink-0"
                                    >
                                        <X className="w-4 h-4" /> Cancel
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )
            }

            {/* Add/Edit Modal */}
            <Dialog
                open={isAddModalOpen || isEditModalOpen}
                onOpenChange={(v) => {
                    if (!v) {
                        setIsAddModalOpen(false);
                        setIsEditModalOpen(false);
                        setSelectedOrder(null);
                        form.reset();
                    }
                }}
            >
                <DialogContent className="max-w-5xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col h-[90vh] md:h-auto md:max-h-[90vh]">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit((v) => {
                            if (isEditModalOpen && selectedOrder && v.order_status_id !== selectedOrder.order_status_id) {
                                if (!v.history_comment?.trim()) {
                                    form.setError('history_comment', { type: 'manual', message: 'Comment is required when changing status.' });
                                    toast({ title: "Validation Error", description: "Please provide a reason for the status change.", variant: "destructive" });
                                    return;
                                }
                            }
                            isEditModalOpen ? updateOrderMutation.mutate(v) : createOrderMutation.mutate(v);
                        })} className="flex flex-col h-full overflow-hidden">
                            <DialogHeader className="p-8 pb-4">
                                <DialogTitle className="text-3xl font-black text-brand-navy">
                                    {isEditModalOpen ? 'Update Sales Order' : 'Capture New Order'}
                                </DialogTitle>
                                <DialogDescription className="text-muted-foreground text-lg"> Fill in the customer details and product requirements.</DialogDescription>
                            </DialogHeader>

                            <div className="overflow-y-auto p-8 pt-4 space-y-8 flex-1 custom-scrollbar">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                    {/* Column 1: Customer Data */}
                                    <div className="space-y-6">
                                        <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40 border-b border-brand-navy/[0.05] pb-2 flex items-center gap-2">
                                            <User className="w-3 h-3" /> Customer Profile
                                        </h4>
                                        <FormField
                                            control={form.control}
                                            name="name"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1">
                                                    <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Full Name</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="Client Name" {...field} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="phone"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1">
                                                    <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Contact Number</FormLabel>
                                                    <div className="relative">
                                                        <FormControl>
                                                            <Input placeholder="+212..." {...field} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner pr-12" />
                                                        </FormControl>
                                                        {(field.value?.replace(/[^0-9+]/g, '') || '').length >= 6 && (
                                                            <Popover open={showCustomerInsights} onOpenChange={setShowCustomerInsights}>
                                                                <PopoverTrigger asChild>
                                                                    <button
                                                                        type="button"
                                                                        className={cn(
                                                                            "absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200",
                                                                            showCustomerInsights
                                                                                ? "bg-brand-navy text-brand-white shadow-lg shadow-brand-navy/20 scale-105"
                                                                                : "bg-brand-navy/10 text-brand-navy/50 hover:bg-brand-navy/20 hover:text-brand-navy"
                                                                        )}
                                                                    >
                                                                        <BarChart3 className="w-4 h-4" />
                                                                    </button>
                                                                </PopoverTrigger>
                                                                <PopoverContent
                                                                    className="w-[420px] p-4 rounded-2xl border-none shadow-2xl bg-white/95 backdrop-blur-xl"
                                                                    align="end"
                                                                    side="right"
                                                                    sideOffset={12}
                                                                >
                                                                    <CustomerInsights phone={field.value || ''} />
                                                                </PopoverContent>
                                                            </Popover>
                                                        )}
                                                    </div>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="city_id"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-col space-y-1">
                                                    <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Target City</FormLabel>
                                                    <Popover open={citySearchOpen} onOpenChange={setCitySearchOpen}>
                                                        <PopoverTrigger asChild>
                                                            <FormControl>
                                                                <Button
                                                                    variant="outline"
                                                                    role="combobox"
                                                                    className={cn(
                                                                        "h-12 w-full justify-between rounded-2xl border-none bg-brand-navy/[0.04] text-brand-navy font-bold shadow-inner text-left px-4",
                                                                        !field.value && "text-muted-foreground"
                                                                    )}
                                                                >
                                                                    {field.value
                                                                        ? cities?.find((c: any) => c.id === field.value)?.name
                                                                        : "Select city..."}
                                                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                                </Button>
                                                            </FormControl>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="w-[300px] p-0 border-none shadow-2xl rounded-2xl" align="start" onWheel={(e) => e.stopPropagation()}>
                                                            <Command className="rounded-none">
                                                                <CommandInput placeholder="Search city..." className="h-12 border-none ring-0 focus:ring-0 shrink-0" />
                                                                <CommandList className="max-h-[250px] overflow-y-scroll custom-scrollbar overflow-x-hidden">
                                                                    <CommandEmpty>No city found.</CommandEmpty>
                                                                    <CommandGroup>
                                                                        {cities?.map((city: any) => (
                                                                            <CommandItem
                                                                                key={city.id}
                                                                                value={city.name}
                                                                                onSelect={() => {
                                                                                    form.setValue("city_id", city.id);
                                                                                    form.setValue('courier_id', null);
                                                                                    form.setValue('company_id', null);
                                                                                    form.setValue('shipping_cost', 0);
                                                                                    setCitySearchOpen(false);
                                                                                }}
                                                                                className="py-3 px-4 font-bold text-brand-navy cursor-pointer hover:bg-brand-navy hover:text-brand-white"
                                                                            >
                                                                                <Check
                                                                                    className={cn(
                                                                                        "mr-2 h-4 w-4",
                                                                                        city.id === field.value ? "opacity-100" : "opacity-0"
                                                                                    )}
                                                                                />
                                                                                {city.name}
                                                                            </CommandItem>
                                                                        ))}
                                                                    </CommandGroup>
                                                                </CommandList>
                                                            </Command>
                                                        </PopoverContent>
                                                    </Popover>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="address"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1">
                                                    <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Full Address</FormLabel>
                                                    <FormControl>
                                                        <Textarea placeholder="Street, building, floor..." {...field} className="min-h-[100px] rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner resize-none p-4" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>

                                    {/* Column 2: Logistics & Status */}
                                    <div className="space-y-6">
                                        <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40 border-b border-brand-navy/[0.05] pb-2 flex items-center gap-2">
                                            <Truck className="w-3 h-3" /> Logistics & Processing
                                        </h4>
                                        <FormField
                                            control={form.control}
                                            name="source_name"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1">
                                                    <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Sales Channel</FormLabel>
                                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                        <FormControl>
                                                            <SelectTrigger className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner">
                                                                <SelectValue placeholder="Select source" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent className="rounded-2xl border-none shadow-2xl">
                                                            {SALES_SOURCES.map(source => (
                                                                <SelectItem key={source} value={source} className="rounded-xl font-bold capitalize">{source}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </FormItem>
                                            )}
                                        />
                                        <div className="grid grid-cols-2 gap-4">
                                            {availableProviders.length > 0 && (
                                                <FormField
                                                    control={form.control}
                                                    name="courier_id"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-1 animate-in fade-in slide-in-from-top-1 duration-300">
                                                            <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Shipping Provider</FormLabel>
                                                            <Select
                                                                onValueChange={(val) => {
                                                                    const provider = availableProviders.find(p => p.id === val);
                                                                    if (provider?.type === 'courier') {
                                                                        form.setValue('courier_id', val);
                                                                        form.setValue('company_id', null);
                                                                        const fee = courierFees?.find((f: any) => f.courier_id === val && (f.master_city_id === selectedCityId || f.city_id === selectedCityId))?.fee;
                                                                        form.setValue('shipping_cost', fee ? Number(fee) : 0);
                                                                    } else {
                                                                        form.setValue('company_id', val);
                                                                        form.setValue('courier_id', null);
                                                                        const fee = companyFees?.find((f: any) => f.company_id === val && (f.master_city_id === selectedCityId || f.city_id === selectedCityId))?.fee;
                                                                        form.setValue('shipping_cost', fee ? Number(fee) : 0);
                                                                    }
                                                                }}
                                                                value={field.value || selectedCompanyId || ''}
                                                            >
                                                                <FormControl>
                                                                    <SelectTrigger className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner">
                                                                        <SelectValue placeholder="Choose provider..." />
                                                                    </SelectTrigger>
                                                                </FormControl>
                                                                <SelectContent className="rounded-2xl border-none shadow-2xl">
                                                                    {availableProviders.map((p: any) => (
                                                                        <SelectItem key={p.id} value={p.id} className="rounded-xl font-bold">
                                                                            <div className="flex items-center gap-2">
                                                                                {p.type === 'courier' ? <Truck className="w-3 h-3 text-orange-500" /> : <Building2 className="w-3 h-3 text-blue-500" />}
                                                                                {p.name}
                                                                            </div>
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </FormItem>
                                                    )}
                                                />
                                            )}

                                            <FormField
                                                control={form.control}
                                                name="shipping_cost"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1">
                                                        <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Shipping Fee</FormLabel>
                                                        <FormControl>
                                                            <div className="relative">
                                                                <Input type="number" {...field} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner pl-4 pr-10" />
                                                                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        onClick={calculateShippingFee}
                                                                        className="h-6 w-6 text-brand-navy/30 hover:text-brand-navy"
                                                                        title="Calculate Fees"
                                                                        disabled={!selectedCityId || (!selectedCourierId && !selectedCompanyId)}
                                                                    >
                                                                        <RefreshCcw className="w-3 h-3" />
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={form.control}
                                                name="delivery_type"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1">
                                                        <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Delivery Option</FormLabel>
                                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                            <FormControl>
                                                                <SelectTrigger className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner">
                                                                    <SelectValue placeholder="Select type" />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent className="rounded-2xl border-none shadow-2xl">
                                                                <SelectItem value="Home Delivery" className="rounded-xl font-bold">🏠 Home</SelectItem>
                                                                <SelectItem value="Point Relais" className="rounded-xl font-bold">📦 Pick-up</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>

                                        <FormField
                                            control={form.control}
                                            name="order_status_id"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-col space-y-1">
                                                    <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Pipeline Stage</FormLabel>
                                                    <Popover open={statusSearchOpen} onOpenChange={setStatusSearchOpen}>
                                                        <PopoverTrigger asChild>
                                                            <FormControl>
                                                                <Button
                                                                    variant="outline"
                                                                    role="combobox"
                                                                    className={cn(
                                                                        "h-12 w-full justify-between rounded-2xl border-none bg-brand-navy/[0.04] text-brand-navy font-bold shadow-inner text-left px-4",
                                                                        !field.value && "text-muted-foreground"
                                                                    )}
                                                                >
                                                                    {field.value
                                                                        ? orderStatuses?.find((s: any) => s.id === field.value)?.label
                                                                        : "Set status..."}
                                                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                                </Button>
                                                            </FormControl>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="w-[300px] p-0 border-none shadow-2xl rounded-2xl" align="start" onWheel={(e) => e.stopPropagation()}>
                                                            <Command className="rounded-none">
                                                                <CommandInput placeholder="Search status..." className="h-12 border-none ring-0 focus:ring-0 shrink-0" />
                                                                <CommandList className="max-h-[250px] overflow-y-scroll custom-scrollbar overflow-x-hidden">
                                                                    <CommandEmpty>No status found.</CommandEmpty>
                                                                    <CommandGroup>
                                                                        {orderStatuses?.map((status: any) => (
                                                                            <CommandItem
                                                                                key={status.id}
                                                                                value={status.label}
                                                                                onSelect={() => {
                                                                                    form.setValue("order_status_id", status.id);
                                                                                    setStatusSearchOpen(false);
                                                                                }}
                                                                                className="py-3 px-4 font-bold text-brand-navy cursor-pointer hover:bg-brand-navy hover:text-brand-white"
                                                                            >
                                                                                <div
                                                                                    className="w-3 h-3 rounded-full mr-3"
                                                                                    style={{ backgroundColor: status.color }}
                                                                                />
                                                                                <Check
                                                                                    className={cn(
                                                                                        "mr-2 h-4 w-4",
                                                                                        status.id === field.value ? "opacity-100" : "opacity-0"
                                                                                    )}
                                                                                />
                                                                                {status.label}
                                                                            </CommandItem>
                                                                        ))}
                                                                    </CommandGroup>
                                                                </CommandList>
                                                            </Command>
                                                        </PopoverContent>
                                                    </Popover>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        {isEditModalOpen && selectedOrder && form.watch('order_status_id') !== selectedOrder.order_status_id && (
                                            <FormField
                                                control={form.control}
                                                name="history_comment"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1 animate-in fade-in slide-in-from-top-2 duration-300">
                                                        <FormLabel className="text-[10px] font-black uppercase tracking-wider text-brand-navy/60 flex items-center gap-1">
                                                            <MessageSquare className="w-3 h-3 text-brand-navy/40" /> Status Change Reason
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Textarea placeholder="Why is the status changing? (Optional)" {...field} className="min-h-[80px] resize-none rounded-2xl border-none bg-brand-navy/[0.03] text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner focus-visible:ring-brand-navy/20" />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        )}

                                        <div className="p-4 rounded-2xl bg-brand-navy/[0.02] border border-brand-navy/[0.03] flex items-center justify-between">
                                            <div className="space-y-0.5">
                                                <FormLabel className="text-sm font-bold text-brand-navy">Exchange Order</FormLabel>
                                                <p className="text-[10px] text-muted-foreground">Is this replacing a previous client order?</p>
                                            </div>
                                            <FormField
                                                control={form.control}
                                                name="replace"
                                                render={({ field }) => (
                                                    <FormControl>
                                                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                                                    </FormControl>
                                                )}
                                            />
                                        </div>
                                    </div>

                                    {/* Column 3: Notes */}
                                    <div className="space-y-6">
                                        <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40 border-b border-brand-navy/[0.05] pb-2 flex items-center gap-2">
                                            <MessageSquare className="w-3 h-3" /> Communication
                                        </h4>
                                        <FormField
                                            control={form.control}
                                            name="note"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1">
                                                    <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Order Note (Internal)</FormLabel>
                                                    <FormControl>
                                                        <Textarea placeholder="Packaging info, special gift..." {...field} className="min-h-[120px] rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner resize-none p-4" />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="delivery_note"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1">
                                                    <FormLabel className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">Courier Note (Public)</FormLabel>
                                                    <FormControl>
                                                        <Textarea placeholder="Call before delivery, leave at door..." {...field} className="min-h-[120px] rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner resize-none p-4" />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </div>

                                {/* Items Section */}
                                <div className="space-y-6 pt-4">
                                    <div className="flex items-center justify-between border-b border-brand-navy/[0.05] pb-2">
                                        <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40 flex items-center gap-2">
                                            <ShoppingCart className="w-3 h-3" /> Cart Contents
                                        </h4>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            onClick={() => append({ product_id: '', quantity: 1, unit_price: 0 })}
                                            className="text-[10px] font-black uppercase text-brand-navy hover:bg-brand-navy/[0.05] gap-2 rounded-xl h-10 px-4"
                                        >
                                            <Plus className="w-4 h-4" /> Add Product
                                        </Button>
                                    </div>

                                    <div className="space-y-4">
                                        {fields.map((field, index) => (
                                            <div key={field.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end bg-brand-navy/[0.01] p-4 rounded-[32px] animate-in slide-in-from-left-2 duration-300">
                                                <div className="md:col-span-6">
                                                    <FormField
                                                        control={form.control}
                                                        name={`items.${index}.product_id`}
                                                        render={({ field }) => (
                                                            <FormItem className="space-y-1">
                                                                <FormLabel className="text-[10px] uppercase font-black text-muted-foreground/60">Search Product</FormLabel>
                                                                <Select
                                                                    onValueChange={(val) => {
                                                                        field.onChange(val);
                                                                        const prod = products?.find((p: any) => p.id === val);
                                                                        if (prod) {
                                                                            form.setValue(`items.${index}.unit_price`, Number(prod.selling_price));
                                                                        }
                                                                    }}
                                                                    defaultValue={field.value}
                                                                >
                                                                    <FormControl>
                                                                        <SelectTrigger className="h-12 rounded-2xl border-none bg-brand-navy/5 text-base font-bold text-brand-navy shadow-inner pr-4">
                                                                            <SelectValue placeholder="SKU or Name" />
                                                                        </SelectTrigger>
                                                                    </FormControl>
                                                                    <SelectContent className="rounded-2xl border-none shadow-2xl max-h-[250px] overflow-y-auto custom-scrollbar">
                                                                        {products?.map((p: any) => (
                                                                            <SelectItem key={p.id} value={p.id} className="rounded-xl font-bold py-3">
                                                                                {p.name} <span className="text-[10px] opacity-40 ml-2">({p.code})</span>
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}
                                                    />
                                                </div>
                                                <div className="md:col-span-2">
                                                    <FormField
                                                        control={form.control}
                                                        name={`items.${index}.unit_price`}
                                                        render={({ field }) => (
                                                            <FormItem className="space-y-1">
                                                                <FormLabel className="text-[10px] uppercase font-black text-muted-foreground/60">Unit Price</FormLabel>
                                                                <Input type="number" {...field} className="h-12 rounded-2xl border-none bg-brand-navy/5 text-base font-bold text-brand-navy shadow-inner text-center" />
                                                            </FormItem>
                                                        )}
                                                    />
                                                </div>
                                                <div className="md:col-span-2">
                                                    <FormField
                                                        control={form.control}
                                                        name={`items.${index}.quantity`}
                                                        render={({ field }) => (
                                                            <FormItem className="space-y-1">
                                                                <FormLabel className="text-[10px] uppercase font-black text-muted-foreground/60">Qty</FormLabel>
                                                                <Input type="number" {...field} className="h-12 rounded-2xl border-none bg-brand-navy/5 text-base font-bold text-brand-navy shadow-inner text-center" />
                                                            </FormItem>
                                                        )}
                                                    />
                                                </div>
                                                <div className="md:col-span-1">
                                                    <div className="h-12 flex flex-col items-center justify-center">
                                                        <span className="text-[8px] font-black uppercase text-muted-foreground/40 leading-none mb-1">Row Total</span>
                                                        <span className="text-sm font-black text-brand-navy">
                                                            {(form.watch(`items.${index}.quantity`) * form.watch(`items.${index}.unit_price`)).toFixed(0)}DH
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="md:col-span-1">
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => remove(index)}
                                                        disabled={fields.length === 1}
                                                        className="h-12 w-12 rounded-2xl text-red-300 hover:text-red-500 hover:bg-red-50 transition-all"
                                                    >
                                                        <Trash2 className="w-5 h-5" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <DialogFooter className="p-8 shrink-0 bg-brand-white border-t border-brand-navy/[0.03] flex flex-col md:flex-row items-center justify-between gap-6">
                                <div className="flex items-center gap-4">
                                    <div className="w-14 h-14 rounded-3xl bg-brand-navy flex items-center justify-center text-brand-white shadow-xl shadow-brand-navy/20 rotate-3">
                                        <DollarSign className="w-7 h-7" />
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Grand Total Payable</p>
                                        <h3 className="text-3xl font-black text-brand-navy leading-none">
                                            {(form.watch('items').reduce((acc, item) => acc + (item.quantity * item.unit_price), 0) + Number(form.watch('shipping_cost') || 0)).toFixed(2)} DH
                                        </h3>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 w-full md:w-auto">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => {
                                            setIsAddModalOpen(false);
                                            setIsEditModalOpen(false);
                                        }}
                                        className="rounded-2xl h-14 px-8 font-bold text-brand-navy hover:bg-muted m-0"
                                    >
                                        Discard
                                    </Button>
                                    <Button
                                        type="submit"
                                        disabled={createOrderMutation.isPending || updateOrderMutation.isPending}
                                        className="flex-1 md:flex-none bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-14 px-12 font-bold shadow-2xl shadow-brand-navy/30 transition-all active:scale-95 flex items-center gap-3 m-0"
                                    >
                                        {(createOrderMutation.isPending || updateOrderMutation.isPending) && <Loader2 className="w-5 h-5 animate-spin" />}
                                        {isEditModalOpen ? 'Save Changes' : 'Confirm Order'}
                                    </Button>
                                </div>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* View Modal */}
            <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
                <DialogContent className="max-w-4xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col h-[90vh] md:h-auto md:max-h-[90vh]">
                    {selectedOrder && (
                        <div className="flex flex-col h-full overflow-hidden">
                            <div className="p-10 pb-0 flex flex-col md:flex-row justify-between items-start gap-6 shrink-0">
                                <div className="space-y-4">
                                    <div className="flex items-center gap-4">
                                        <div className="w-16 h-16 rounded-[28px] bg-brand-navy flex items-center justify-center text-brand-white shadow-2xl shadow-brand-navy/20">
                                            <ShoppingCart className="w-8 h-8" />
                                        </div>
                                        <div>
                                            <h2 className="text-4xl font-black text-brand-navy tracking-tight">{selectedOrder.name}</h2>
                                            <div className="flex items-center gap-4 text-muted-foreground font-bold text-sm tracking-wide">
                                                <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4" /> {format(new Date(selectedOrder.date || selectedOrder.created_at), 'MMMM dd, yyyy')}</span>
                                                <span className="flex items-center gap-1.5"><Phone className="w-4 h-4" /> {selectedOrder.phone}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white shadow-sm border border-brand-navy/[0.03]">
                                            <ShieldCheck className="w-4 h-4" style={{ color: selectedOrder.status?.color }} />
                                            <span className="text-xs font-black uppercase tracking-widest" style={{ color: selectedOrder.status?.color }}>
                                                {selectedOrder.status?.label || 'DRAFT'}
                                            </span>
                                        </div>
                                        <Badge variant="outline" className="border-brand-navy/10 text-brand-navy font-bold uppercase tracking-widest px-4 py-2 rounded-xl text-[10px]">
                                            {selectedOrder.source_name}
                                        </Badge>
                                        {selectedOrder.replace && (
                                            <Badge className="bg-red-500 text-white font-black uppercase tracking-widest px-4 py-2 rounded-xl text-[10px]">
                                                Exchange
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                                <div className="p-8 pb-10 flex items-center justify-between border-b-2 border-brand-navy/5 bg-gradient-to-br from-brand-navy/[0.02] to-transparent">
                                    <div className="space-y-1">
                                        <p className="text-sm font-black text-brand-navy/40 uppercase tracking-widest">Total Order Value</p>
                                        <h3 className="text-4xl font-black text-brand-navy">{selectedOrder.raw_price || 0} <span className="text-lg">DH</span></h3>
                                    </div>
                                    <div className="mt-2 text-[10px] font-bold text-emerald-600 uppercase tracking-tighter">
                                        Includes {selectedOrder.shipping_cost}DH Shipping
                                    </div>
                                </div>
                            </div>

                            <div className="overflow-y-auto p-10 space-y-10 flex-1 custom-scrollbar">
                                {/* Customer Insights in Preview */}
                                <CustomerInsights phone={selectedOrder.phone || ''} />

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                    {/* Logistics Info */}
                                    <div className="space-y-6">
                                        <div className="flex items-center gap-3 border-b border-brand-navy/[0.05] pb-3">
                                            <Truck className="w-6 h-6 text-brand-navy/20" />
                                            <h4 className="text-lg font-black text-brand-navy uppercase tracking-widest">Delivery Details</h4>
                                        </div>
                                        <div className="space-y-6">
                                            <div className="flex items-start gap-4">
                                                <div className="w-10 h-10 rounded-2xl bg-orange-50 flex items-center justify-center text-orange-500 shrink-0 shadow-sm shadow-orange-500/10">
                                                    <MapPinned className="w-5 h-5" />
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest leading-none">Destination</p>
                                                    <p className="text-lg font-bold text-brand-navy leading-tight">{selectedOrder.city?.name}</p>
                                                    <p className="text-sm font-medium text-muted-foreground italic">"{selectedOrder.address}"</p>
                                                </div>
                                            </div>
                                            <div className="flex items-start gap-4">
                                                <div className="w-10 h-10 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-500 shrink-0 shadow-sm shadow-blue-500/10">
                                                    <ShoppingCart className="w-5 h-5" />
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest leading-none">Shipping Configuration</p>
                                                    <p className="text-lg font-bold text-brand-navy leading-tight">{selectedOrder.delivery_type || 'Standard Delivery'}</p>
                                                    <p className="text-sm font-bold text-emerald-600 uppercase tracking-widest">{selectedOrder.shipping_cost === 0 ? 'Free Shipping' : `Paid: ${selectedOrder.shipping_cost} DH`}</p>
                                                </div>
                                            </div>
                                            {(selectedOrder.courier || selectedOrder.company) && (
                                                <div className="flex items-start gap-4">
                                                    <div className="w-10 h-10 rounded-2xl bg-brand-navy/5 flex items-center justify-center text-brand-navy/40 shrink-0 shadow-sm overflow-hidden">
                                                        {selectedOrder.company?.logo_url ? (
                                                            <img src={selectedOrder.company.logo_url} alt={selectedOrder.company.name} className="w-full h-full object-contain" />
                                                        ) : selectedOrder.courier?.avatar_url ? (
                                                            <img src={selectedOrder.courier.avatar_url} alt={selectedOrder.courier.name} className="w-full h-full object-cover" />
                                                        ) : (
                                                            selectedOrder.courier ? <Truck className="w-5 h-5 text-orange-500" /> : <Building2 className="w-5 h-5 text-blue-500" />
                                                        )}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <p className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest leading-none">Assigned Provider</p>
                                                        <p className="text-lg font-bold text-brand-navy leading-tight">
                                                            {selectedOrder.courier?.name || selectedOrder.company?.name}
                                                        </p>
                                                        <Badge variant="outline" className="h-5 px-2 text-[8px] font-black uppercase tracking-tighter bg-brand-navy/[0.03] text-brand-navy/40 border-none">
                                                            {selectedOrder.courier ? 'Independent Courier' : 'Delivery Company'}
                                                        </Badge>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Internal Notes */}
                                    <div className="space-y-6">
                                        <div className="flex items-center gap-3 border-b border-brand-navy/[0.05] pb-3">
                                            <MessageSquare className="w-6 h-6 text-brand-navy/20" />
                                            <h4 className="text-lg font-black text-brand-navy uppercase tracking-widest">Client & Note Info</h4>
                                        </div>
                                        <div className="space-y-4">
                                            <div className="p-6 rounded-[28px] bg-brand-navy/[0.02] border border-brand-navy/[0.05] space-y-2">
                                                <p className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest">Internal Instruction</p>
                                                <p className="text-sm font-medium text-brand-navy">{selectedOrder.note || 'No internal notes provided.'}</p>
                                            </div>
                                            <div className="p-6 rounded-[28px] bg-brand-navy/[0.04] border border-brand-navy/[0.05] space-y-2">
                                                <p className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest text-brand-navy/40 text-blue-600">Public Delivery Note</p>
                                                <p className="text-sm font-bold text-brand-navy italic">"{selectedOrder.delivery_note || 'No special delivery instructions.'}"</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <Separator className="bg-brand-navy/[0.05]" />

                                {/* Order Items Table */}
                                <div className="space-y-6 pb-6">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Package className="w-6 h-6 text-brand-navy/20" />
                                            <h4 className="text-xl font-black text-brand-navy uppercase tracking-[0.15em]">Cart Items</h4>
                                        </div>
                                        <Badge variant="outline" className="text-xs font-black border-brand-navy/10 tracking-widest rounded-xl px-4 py-1.5 h-auto">
                                            {selectedOrder.items?.length || 0} Unique SKU(s)
                                        </Badge>
                                    </div>
                                    <div className="grid grid-cols-1 gap-4">
                                        {selectedOrder.items?.map((item: any) => (
                                            <div
                                                key={item.id}
                                                className="group p-6 rounded-[32px] bg-brand-navy/[0.01] hover:bg-brand-navy/[0.02] border border-brand-navy/[0.03] flex flex-col md:flex-row justify-between items-center gap-4 transition-all"
                                            >
                                                <div className="flex items-center gap-5 flex-1">
                                                    <div className="w-16 h-16 rounded-[20px] bg-brand-navy/5 flex items-center justify-center overflow-hidden shrink-0">
                                                        {item.product?.image_url ? (
                                                            <img src={item.product?.image_url} alt="" className="w-full h-full object-cover" />
                                                        ) : (
                                                            <Package className="w-8 h-8 text-brand-navy/20" />
                                                        )}
                                                    </div>
                                                    <div>
                                                        <h5 className="text-lg font-black text-brand-navy leading-none mb-1 group-hover:text-blue-600 transition-colors uppercase">{item.product?.name}</h5>
                                                        <div className="flex items-center gap-3">
                                                            <p className="text-[10px] font-bold text-muted-foreground/60 tracking-widest bg-brand-navy/5 px-2 py-0.5 rounded-md">{item.product?.code}</p>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-12 text-right">
                                                    <div>
                                                        <p className="text-[10px] font-black uppercase text-muted-foreground/40 tracking-widest mb-1">Unit Price</p>
                                                        <p className="text-lg font-black text-brand-navy">{item.unit_price} DH</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[10px] font-black uppercase text-muted-foreground/40 tracking-widest mb-1">Quantity</p>
                                                        <p className="text-lg font-black text-brand-navy">x{item.quantity}</p>
                                                    </div>
                                                    <div className="min-w-[100px]">
                                                        <p className="text-[10px] font-black uppercase text-muted-foreground/40 tracking-widest mb-1">Subtotal</p>
                                                        <p className="text-2xl font-black text-emerald-600">{item.total_price} DH</p>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Status History Timeline */}
                                <div className="space-y-6 pb-6">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <ShieldCheck className="w-6 h-6 text-brand-navy/20" />
                                            <h4 className="text-xl font-black text-brand-navy uppercase tracking-[0.15em]">Status History</h4>
                                        </div>
                                    </div>

                                    <div className="px-4">
                                        {selectedOrder.history && selectedOrder.history.length > 0 ? (
                                            <div className="space-y-6 relative before:absolute before:inset-0 before:ml-2.5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-brand-navy/10 before:to-transparent">
                                                {selectedOrder.history.map((record: any, index: number) => (
                                                    <div key={record.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                                                        <div className="flex items-center justify-center w-6 h-6 rounded-full border-4 border-white bg-brand-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10" style={{ borderColor: record.status?.color || '#eee' }}>
                                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: record.status?.color || '#ccc' }} />
                                                        </div>
                                                        <div className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] p-5 rounded-2xl bg-brand-navy/[0.02] border border-brand-navy/[0.05] shadow-sm flex flex-col gap-2">
                                                            <div className="flex items-center justify-between gap-4">
                                                                <div className="flex items-center gap-2">
                                                                    <Avatar className="w-6 h-6 border bg-white">
                                                                        <AvatarImage src={record.user?.avatar_url} />
                                                                        <AvatarFallback className="text-[10px] font-bold bg-brand-navy/5 text-brand-navy">
                                                                            {record.user?.name?.[0] || '?'}
                                                                        </AvatarFallback>
                                                                    </Avatar>
                                                                    <span className="text-xs font-bold text-brand-navy truncate max-w-[120px]">{record.user?.name || 'Unknown'}</span>
                                                                </div>
                                                                <span className="text-[10px] font-black text-brand-navy/40 uppercase tracking-widest bg-brand-navy/5 px-2 py-1 rounded-lg">
                                                                    {format(new Date(record.created_at), 'MMM d, HH:mm')}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-2 mt-1">
                                                                <span className="text-xs font-black uppercase tracking-widest px-2 py-0.5 rounded-md" style={{ color: record.status?.color, backgroundColor: `${record.status?.color}15` }}>
                                                                    {record.status?.label || 'Unknown Status'}
                                                                </span>
                                                            </div>
                                                            {record.comment && (
                                                                <p className="text-sm font-medium text-brand-navy/80 mt-2 p-3 bg-white rounded-xl border border-brand-navy/[0.03] italic">
                                                                    "{record.comment}"
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="text-center p-8 bg-brand-navy/[0.02] rounded-3xl border border-brand-navy/[0.05]">
                                                <p className="text-sm font-bold text-muted-foreground">No tracking history available yet.</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <DialogFooter className="p-8 pb-10 flex gap-4 bg-brand-white border-t border-brand-navy/[0.03]">
                                <Button
                                    onClick={() => handleEdit(selectedOrder)}
                                    className="flex-1 bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-3xl h-16 text-lg font-black shadow-2xl transition-all active:scale-95 flex items-center justify-center gap-3"
                                >
                                    <Edit2 className="w-6 h-6" /> Edit Sales Order
                                </Button>
                                <Button
                                    onClick={() => setIsViewModalOpen(false)}
                                    variant="ghost"
                                    className="rounded-3xl h-16 px-10 font-bold text-brand-navy hover:bg-muted"
                                >
                                    Done
                                </Button>
                            </DialogFooter>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Bulk Status Update Modal */}
            <Dialog open={isBulkStatusModalOpen} onOpenChange={(v) => {
                setIsBulkStatusModalOpen(v);
                if (!v) setBulkStatusComment("");
            }}>
                <DialogContent className="max-w-4xl p-0 border-none bg-brand-white rounded-[32px] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
                    <DialogHeader className="p-8 pb-4 shrink-0 border-b border-brand-navy/[0.05]">
                        <DialogTitle className="text-2xl font-black text-brand-navy">Update Status</DialogTitle>
                        <DialogDescription className="text-sm font-bold text-muted-foreground">
                            Change status for {selectedOrders.length} selected orders
                        </DialogDescription>
                    </DialogHeader>
                    <div className="p-8 overflow-y-auto custom-scrollbar flex-1 space-y-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase text-brand-navy/60 tracking-widest">Comment / Reason (Optional)</label>
                            <Textarea
                                placeholder="Why are these orders changing status?"
                                value={bulkStatusComment}
                                onChange={(e) => setBulkStatusComment(e.target.value)}
                                className="min-h-[80px] resize-none rounded-2xl border-none bg-brand-navy/[0.04] text-brand-navy shadow-inner focus-visible:ring-1 focus-visible:ring-brand-navy/20 p-4"
                            />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {orderStatuses?.map((status: any) => (
                                <Button
                                    key={status.id}
                                    variant="outline"
                                    onClick={() => {
                                        if (!bulkStatusComment.trim()) {
                                            toast({ title: "Validation Error", description: "Please provide a reason for changing the status.", variant: "destructive" });
                                            return;
                                        }
                                        bulkStatusMutation.mutate({ orderIds: selectedOrders, statusId: status.id })
                                    }}
                                    disabled={bulkStatusMutation.isPending}
                                    className="h-14 justify-start gap-4 rounded-2xl border-none bg-brand-navy/[0.02] hover:bg-brand-navy/[0.05] text-brand-navy font-bold transition-all group px-4"
                                >
                                    <div
                                        className="w-4 h-4 rounded-full shadow-sm group-hover:scale-110 transition-transform shrink-0"
                                        style={{ backgroundColor: status.color }}
                                    />
                                    <span className="flex-1 text-left truncate">{status.label}</span>
                                    {bulkStatusMutation.isPending && <Loader2 className="w-4 h-4 animate-spin opacity-50 shrink-0" />}
                                </Button>
                            ))}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Seller Attribution Modal */}
            <Dialog open={isAttributionModalOpen} onOpenChange={setIsAttributionModalOpen}>
                <DialogContent className="max-w-md p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
                    <DialogHeader className="p-8 pb-6 shrink-0 border-b border-brand-navy/[0.05]">
                        <DialogTitle className="text-3xl font-black text-brand-navy tracking-tight">Assign Seller</DialogTitle>
                        <DialogDescription className="text-sm font-bold text-muted-foreground mt-1">
                            Team attribution for {selectedOrders.length} orders
                        </DialogDescription>
                    </DialogHeader>

                    <div className="p-8 pt-6 flex-1 flex flex-col overflow-hidden space-y-6">
                        <div className="relative group shrink-0">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-brand-navy/20 group-focus-within:text-brand-navy/40 transition-colors" />
                            <Input
                                placeholder="Search commercial..."
                                value={sellerSearchQuery}
                                onChange={(e) => setSellerSearchQuery(e.target.value)}
                                className="h-14 pl-12 pr-4 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy placeholder:text-brand-navy/20 focus-visible:ring-1 focus-visible:ring-brand-navy/10 shadow-inner"
                            />
                        </div>

                        <div className="overflow-y-auto pr-2 custom-scrollbar space-y-3 flex-1 h-full min-h-0">
                            {/* Unassign Option */}
                            <Button
                                variant="ghost"
                                onClick={() => bulkAttributeMutation.mutate({ orderIds: selectedOrders, sellerId: null })}
                                disabled={bulkAttributeMutation.isPending}
                                className="w-full h-16 justify-start gap-4 rounded-[24px] hover:bg-red-50 text-red-600 hover:text-red-700 transition-all font-bold px-4 border border-transparent hover:border-red-100"
                            >
                                <div className="w-10 h-10 rounded-2xl bg-red-100 flex items-center justify-center text-red-600 shadow-sm shadow-red-500/10">
                                    <X className="w-5 h-5" />
                                </div>
                                <div className="text-left">
                                    <p className="text-sm font-black uppercase tracking-tight">Clear Assignee</p>
                                    <p className="text-[10px] opacity-60">Set orders as unassigned</p>
                                </div>
                                {bulkAttributeMutation.isPending && <Loader2 className="w-4 h-4 ml-auto animate-spin" />}
                            </Button>

                            <Separator className="bg-brand-navy/[0.05] my-4" />

                            {sellers
                                ?.filter((s: any) => s.name?.toLowerCase().includes(sellerSearchQuery.toLowerCase()))
                                .map((seller: any) => (
                                    <Button
                                        key={seller.id}
                                        variant="ghost"
                                        onClick={() => bulkAttributeMutation.mutate({ orderIds: selectedOrders, sellerId: seller.id })}
                                        disabled={bulkAttributeMutation.isPending}
                                        className="w-full h-16 justify-start gap-4 rounded-[24px] hover:bg-brand-navy/[0.03] text-brand-navy hover:text-brand-navy transition-all font-bold px-4 border border-transparent hover:border-brand-navy/[0.05]"
                                    >
                                        <Avatar className="w-10 h-10 border-2 border-white shadow-md">
                                            <AvatarImage src={seller.avatar_url} />
                                            <AvatarFallback className="bg-brand-navy text-brand-white text-xs">
                                                {seller.name?.[0]}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="text-left">
                                            <p className="text-sm font-black uppercase tracking-tight">{seller.name}</p>
                                            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">{seller.role}</p>
                                        </div>
                                        {bulkAttributeMutation.isPending && <Loader2 className="w-4 h-4 ml-auto animate-spin opacity-40 shrink-0" />}
                                    </Button>
                                ))}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div >
    );
};

export default Orders;
