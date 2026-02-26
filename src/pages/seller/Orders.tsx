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
    BarChart3,
    Puzzle
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
import { format } from 'date-fns';
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";

// --- Schemas ---
const orderItemSchema = z.object({
    product_id: z.string().uuid("Please select a product"),
    quantity: z.coerce.number().min(1, "Quantity must be at least 1"),
    unit_price: z.coerce.number().min(0, "Price must be positive"),
    accessories: z.array(z.object({
        accessory_id: z.string().optional(),
        accessory_quantity: z.coerce.number().min(0).optional(),
        accessory_unit_price: z.coerce.number().min(0).optional(),
    })).optional().default([]),
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
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

    // Dropdown search states
    const [citySearchOpen, setCitySearchOpen] = useState(false);
    const [statusSearchOpen, setStatusSearchOpen] = useState(false);
    const [showCustomerInsights, setShowCustomerInsights] = useState(false);

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const [userId, setUserId] = useState<string | null>(null);

    React.useEffect(() => {
        const getUserId = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            setUserId(user?.id || null);
        };
        getUserId();
    }, []);

    // Filter states
    const [filterStatus, setFilterStatus] = useState<string>("all");
    const [filterCity, setFilterCity] = useState<string>("all");
    const [filterSource, setFilterSource] = useState<string>("all");
    const [filterProvider, setFilterProvider] = useState<string>("all");

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
        queryKey: ['orders', activeBusinessId, userId],
        queryFn: async () => {
            if (!activeBusinessId || !userId) return [];
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
                    items:order_items(*, product:products(name, code, image_url), accessory:accessories(name, code, image_url)),
                    history:order_status_history(*, user:users!changed_by(name, avatar_url), status:order_statuses!status_id(*))
                `)
                .eq('DigiCom Business', activeBusinessId)
                .or(`seller_id.eq.${userId},assign_id.eq.${userId}`)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        },
        enabled: !!activeBusinessId && !!userId
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

    const { data: productAccessories } = useQuery({
        queryKey: ['product-accessories', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('product_accessories')
                .select('*');
            if (error) throw error;
            return data;
        },
    });

    const { data: accessories } = useQuery({
        queryKey: ['accessories', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('accessories')
                .select('*')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data;
        },
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
                    'DigiCom Business': activeBusinessId,
                    seller_id: userId,
                    assign_id: userId
                })
                .select()
                .single();

            if (orderError) throw orderError;

            // 2. Insert items and their accessories
            const itemRecords: any[] = [];
            values.items.forEach(item => {
                // Main product
                itemRecords.push({
                    order_id: order.id,
                    product_id: item.product_id,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    'DigiCom Business': activeBusinessId
                });
                // Accessories
                if (item.accessories && item.accessories.length > 0) {
                    item.accessories.forEach(acc => {
                        if (acc.accessory_id && acc.accessory_id !== 'none') {
                            itemRecords.push({
                                order_id: order.id,
                                product_id: item.product_id,
                                accessory_id: acc.accessory_id,
                                quantity: 0, // 0 means it's an accessory
                                unit_price: 0,
                                accessory_quantity: acc.accessory_quantity || 1,
                                accessory_unit_price: acc.accessory_unit_price || 0,
                                'DigiCom Business': activeBusinessId
                            });
                        }
                    });
                }
            });

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
            const currentUserId = userRes.data.user?.id;

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
                    updatePayload.confirmed_by_id = currentUserId;
                    updatePayload.confirmation_date = new Date().toISOString();
                }
                if (newStatus?.code === 'CANCELED') {
                    updatePayload.canceled_by_id = currentUserId;
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

            const itemRecords: any[] = [];
            values.items.forEach(item => {
                // Main product
                itemRecords.push({
                    order_id: selectedOrder.id,
                    product_id: item.product_id,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    'DigiCom Business': activeBusinessId
                });
                // Accessories
                if (item.accessories && item.accessories.length > 0) {
                    item.accessories.forEach(acc => {
                        if (acc.accessory_id && acc.accessory_id !== 'none') {
                            itemRecords.push({
                                order_id: selectedOrder.id,
                                product_id: item.product_id,
                                accessory_id: acc.accessory_id,
                                quantity: 0,
                                unit_price: 0,
                                accessory_quantity: acc.accessory_quantity || 1,
                                accessory_unit_price: acc.accessory_unit_price || 0,
                                'DigiCom Business': activeBusinessId
                            });
                        }
                    });
                }
            });

            const { error: itemsError } = await (supabase as any)
                .from('order_items')
                .insert(itemRecords);

            if (itemsError) throw itemsError;

            // 3. Track History if status changed
            if (selectedOrder.order_status_id !== values.order_status_id) {
                const { error: historyError } = await (supabase as any)
                    .from('order_status_history')
                    .insert({
                        order_id: selectedOrder.id,
                        status_id: values.order_status_id,
                        comment: values.history_comment || '',
                        changed_by: currentUserId,
                        'DigiCom Business': activeBusinessId
                    });
                if (historyError) console.error("History Error", historyError);
            }

            return { id: selectedOrder.id };
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

            return matchesSearch && matchesStatus && matchesCity && matchesSource && matchesProvider;
        });
    }, [orders, searchQuery, filterStatus, filterCity, filterSource, filterProvider]);

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
            items: (() => {
                const groupedItems: any[] = [];
                order.items?.forEach((item: any) => {
                    if (item.product_id && Number(item.quantity) > 0) {
                        groupedItems.push({
                            product_id: item.product_id || '',
                            quantity: Number(item.quantity) || 0,
                            unit_price: Number(item.unit_price) || 0,
                            accessories: item.accessory_id ? [{
                                accessory_id: item.accessory_id,
                                accessory_quantity: Number(item.accessory_quantity) || 0,
                                accessory_unit_price: Number(item.accessory_unit_price) || 0
                            }] : []
                        });
                    } else if (item.product_id && Number(item.quantity) === 0) {
                        const parent = groupedItems.find(g => g.product_id === item.product_id);
                        if (parent && item.accessory_id) {
                            parent.accessories.push({
                                accessory_id: item.accessory_id,
                                accessory_quantity: Number(item.accessory_quantity) || 0,
                                accessory_unit_price: Number(item.accessory_unit_price) || 0
                            });
                        }
                    } else if (!item.product_id) {
                        groupedItems.push({
                            product_id: '',
                            quantity: 0,
                            unit_price: 0,
                            accessories: item.accessory_id ? [{
                                accessory_id: item.accessory_id,
                                accessory_quantity: Number(item.accessory_quantity) || 0,
                                accessory_unit_price: Number(item.accessory_unit_price) || 0
                            }] : []
                        });
                    }
                });
                return groupedItems.length > 0 ? groupedItems : [{ product_id: '', quantity: 1, unit_price: 0, accessories: [] }];
            })()
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
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between pb-4">
                <div className="flex flex-wrap items-center gap-4 w-full md:w-auto">
                    {/* View Switcher */}
                    <div className="flex bg-white p-1 rounded-xl shadow-sm border border-brand-navy/5 shrink-0">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewMode('grid')}
                            className={cn(
                                "h-8 px-3 rounded-lg gap-2 transition-all duration-300",
                                viewMode === 'grid'
                                    ? "bg-brand-navy text-brand-white shadow-lg"
                                    : "text-brand-navy/40 hover:text-brand-navy hover:bg-brand-navy/5"
                            )}
                        >
                            <LayoutGrid className="w-4 h-4" />
                            <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Grid</span>
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewMode('list')}
                            className={cn(
                                "h-8 px-3 rounded-lg gap-2 transition-all duration-300",
                                viewMode === 'list'
                                    ? "bg-brand-navy text-brand-white shadow-lg"
                                    : "text-brand-navy/40 hover:text-brand-navy hover:bg-brand-navy/5"
                            )}
                        >
                            <List className="w-4 h-4" />
                            <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">List</span>
                        </Button>
                    </div>

                    <div className="flex items-center gap-2 bg-white p-1 pr-4 rounded-xl shadow-sm border border-brand-navy/5">
                        <div className="h-8 w-8 rounded-lg bg-brand-navy/5 flex items-center justify-center text-brand-navy/50">
                            <Filter className="w-4 h-4" />
                        </div>
                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest hidden sm:inline-block md:hidden lg:inline-block">Filter By:</span>

                        <Select value={filterStatus} onValueChange={setFilterStatus}>
                            <SelectTrigger className="h-8 w-[140px] border-none bg-transparent hover:bg-brand-navy/5 focus:ring-0 rounded-lg text-xs font-bold text-brand-navy">
                                <SelectValue placeholder="All Statuses" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-none shadow-xl">
                                <SelectItem value="all" className="font-bold text-xs">All Statuses</SelectItem>
                                {orderStatuses?.map((s: any) => (
                                    <SelectItem key={s.id} value={s.id} className="font-bold text-xs">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                                            {s.label}
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <div className="w-[1px] h-4 bg-brand-navy/10" />

                        <Select value={filterCity} onValueChange={setFilterCity}>
                            <SelectTrigger className="h-8 w-[130px] border-none bg-transparent hover:bg-brand-navy/5 focus:ring-0 rounded-lg text-xs font-bold text-brand-navy">
                                <SelectValue placeholder="All Cities" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-none shadow-xl max-h-[300px]">
                                <SelectItem value="all" className="font-bold text-xs">All Cities</SelectItem>
                                {cities?.map((c: any) => (
                                    <SelectItem key={c.id} value={c.id} className="font-bold text-xs">{c.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <div className="w-[1px] h-4 bg-brand-navy/10" />

                        <Select value={filterSource} onValueChange={setFilterSource}>
                            <SelectTrigger className="h-8 w-[130px] border-none bg-transparent hover:bg-brand-navy/5 focus:ring-0 rounded-lg text-xs font-bold text-brand-navy">
                                <SelectValue placeholder="All Sources" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-none shadow-xl">
                                <SelectItem value="all" className="font-bold text-xs">All Sources</SelectItem>
                                {SALES_SOURCES.map((s) => (
                                    <SelectItem key={s} value={s} className="font-bold text-xs capitalize">{s}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <div className="w-[1px] h-4 bg-brand-navy/10" />

                        <Select value={filterProvider} onValueChange={setFilterProvider}>
                            <SelectTrigger className="h-8 w-[150px] border-none bg-transparent hover:bg-brand-navy/5 focus:ring-0 rounded-lg text-xs font-bold text-brand-navy">
                                <SelectValue placeholder="All Providers" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-none shadow-xl max-h-[300px]">
                                <SelectItem value="all" className="font-bold text-xs">All Providers</SelectItem>
                                {allProviders.map((p: any) => (
                                    <SelectItem key={p.id} value={p.id} className="font-bold text-xs">
                                        <div className="flex items-center gap-2">
                                            {p.type === 'courier' ? <Truck className="w-3 h-3 text-orange-500" /> : <Building2 className="w-3 h-3 text-blue-500" />}
                                            {p.name}
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {(filterStatus !== 'all' || filterCity !== 'all' || filterSource !== 'all' || filterProvider !== 'all') && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setFilterStatus('all');
                                setFilterCity('all');
                                setFilterSource('all');
                                setFilterProvider('all');
                            }}
                            className="h-10 px-4 rounded-xl text-red-500 hover:bg-red-50 hover:text-red-600 font-bold text-xs gap-2 animate-in fade-in"
                        >
                            <X className="w-3 h-3" /> Clear
                        </Button>
                    )}
                </div>

                <span className="text-xs font-bold text-brand-navy">
                    {filteredOrders.length} records found
                </span>
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
                viewMode === 'grid' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
                        {filteredOrders.map((order) => (
                            <Card
                                key={order.id}
                                className="group relative overflow-hidden border-none bg-white/60 backdrop-blur-md shadow-sm hover:shadow-2xl transition-all duration-500 rounded-[32px] border border-white/20"
                            >
                                {/* Status Accent Bar */}
                                <div className="absolute top-0 left-0 w-full h-1.5 opacity-80" style={{ backgroundColor: order.status?.color || '#ccc' }} />

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
                                        <div className="flex items-center gap-3">
                                            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-navy to-brand-navy/80 flex items-center justify-center text-white shadow-lg shadow-brand-navy/20 group-hover:scale-110 transition-transform duration-500">
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
                                        <th className="p-6 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Customer</th>
                                        <th className="p-6 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Dest. & Source</th>
                                        <th className="p-6 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Status & Provider</th>
                                        <th className="p-6 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Total Amount</th>
                                        <th className="p-6 text-[10px] font-black uppercase tracking-widest text-brand-navy/40 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-brand-navy/[0.03]">
                                    {filteredOrders.map((order) => (
                                        <tr key={order.id} className="hover:bg-brand-navy/[0.01] transition-colors group">
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
                                                <div className="flex flex-col">
                                                    <span className="text-base font-black text-brand-navy">{order.raw_price || 0} DH</span>
                                                </div>
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
                )
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
                                        {fields.map((field, index) => {
                                            const hasProduct = !!form.watch(`items.${index}.product_id`) && form.watch(`items.${index}.product_id`) !== 'none';
                                            const productSubtotal = (form.watch(`items.${index}.quantity`) || 0) * (form.watch(`items.${index}.unit_price`) || 0);
                                            return (
                                                <div key={field.id} className="p-5 rounded-[24px] bg-brand-navy/[0.015] border border-brand-navy/[0.04] space-y-4 animate-in slide-in-from-left-2 duration-300">
                                                    {/* Product Row */}
                                                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                                                        <div className="md:col-span-5">
                                                            <FormField
                                                                control={form.control}
                                                                name={`items.${index}.product_id`}
                                                                render={({ field }) => (
                                                                    <FormItem className="space-y-1">
                                                                        <FormLabel className="text-[10px] uppercase font-bold text-muted-foreground/60 flex items-center gap-1.5"><Package className="w-3 h-3" /> Product</FormLabel>
                                                                        <Select
                                                                            onValueChange={(val) => {
                                                                                field.onChange(val);
                                                                                if (val !== 'none') {
                                                                                    const prod = products?.find((p: any) => p.id === val);
                                                                                    if (prod) {
                                                                                        form.setValue(`items.${index}.unit_price`, Number(prod.selling_price || 0));
                                                                                        if (form.watch(`items.${index}.quantity`) === 0) {
                                                                                            form.setValue(`items.${index}.quantity`, 1);
                                                                                        }

                                                                                        // Auto-select accessory if attached
                                                                                        const attachments = productAccessories?.filter((pa: any) => pa.product_id === val);
                                                                                        if (attachments && attachments.length > 0) {
                                                                                            const currentAccessories = form.getValues(`items.${index}.accessories`) || [];
                                                                                            const newAccessories = [...currentAccessories];

                                                                                            attachments.forEach((attachment: any) => {
                                                                                                const existingAttached = newAccessories.find((a: any) => a.accessory_id === attachment.accessory_id);
                                                                                                if (!existingAttached) {
                                                                                                    const acc = accessories?.find((a: any) => a.id === attachment.accessory_id);
                                                                                                    newAccessories.push({
                                                                                                        accessory_id: attachment.accessory_id,
                                                                                                        accessory_quantity: attachment.default_quantity || 1,
                                                                                                        accessory_unit_price: acc ? Number(acc.cost_price || 0) : 0
                                                                                                    });
                                                                                                }
                                                                                            });

                                                                                            form.setValue(`items.${index}.accessories`, newAccessories);
                                                                                        }
                                                                                    }
                                                                                } else {
                                                                                    form.setValue(`items.${index}.unit_price`, 0);
                                                                                    form.setValue(`items.${index}.quantity`, 0);
                                                                                }
                                                                            }}
                                                                            value={field.value || ''}
                                                                        >
                                                                            <FormControl>
                                                                                <SelectTrigger className="h-12 rounded-2xl border-none bg-white text-base font-bold text-brand-navy shadow-sm">
                                                                                    <SelectValue placeholder="Select product" />
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
                                                                        <Input type="number" {...field} disabled={!hasProduct} className="h-12 rounded-2xl border-none bg-white shadow-sm text-base font-bold text-brand-navy text-center" />
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
                                                                        <Input type="number" {...field} disabled={!hasProduct} className="h-12 rounded-2xl border-none bg-white shadow-sm text-base font-bold text-brand-navy text-center" />
                                                                    </FormItem>
                                                                )}
                                                            />
                                                        </div>
                                                        <div className="md:col-span-2">
                                                            <div className="h-12 flex flex-col items-center justify-center">
                                                                <span className="text-[8px] font-black uppercase text-muted-foreground/40 leading-none mb-1">Product Total</span>
                                                                <span className="text-sm font-black text-brand-navy">
                                                                    {productSubtotal.toFixed(2)} DH
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div className="md:col-span-1 flex justify-end">
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

                                                    {/* Accessories List */}
                                                    <div className="pt-2 border-t border-brand-navy/[0.04]">
                                                        {(form.watch(`items.${index}.accessories`) || []).map((acc: any, accIdx: number) => {
                                                            const accSubtotal = (form.watch(`items.${index}.accessories.${accIdx}.accessory_quantity`) || 0) * (form.watch(`items.${index}.accessories.${accIdx}.accessory_unit_price`) || 0);
                                                            const hasAccessory = !!form.watch(`items.${index}.accessories.${accIdx}.accessory_id`) && form.watch(`items.${index}.accessories.${accIdx}.accessory_id`) !== 'none';

                                                            return (
                                                                <div key={accIdx} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end mb-4 bg-brand-navy/[0.01] p-3 rounded-2xl">
                                                                    <div className="md:col-span-5">
                                                                        <FormField
                                                                            control={form.control}
                                                                            name={`items.${index}.accessories.${accIdx}.accessory_id`}
                                                                            render={({ field }) => (
                                                                                <FormItem className="space-y-1">
                                                                                    <FormLabel className="text-[10px] uppercase font-bold text-brand-navy/60 flex items-center gap-1.5"><Puzzle className="w-3 h-3" /> Accessory</FormLabel>
                                                                                    <Select
                                                                                        onValueChange={(val) => {
                                                                                            field.onChange(val);
                                                                                            if (val !== 'none') {
                                                                                                const accessoryObj = accessories?.find((a: any) => a.id === val);
                                                                                                if (accessoryObj) {
                                                                                                    form.setValue(`items.${index}.accessories.${accIdx}.accessory_unit_price`, Number(accessoryObj.cost_price || 0));
                                                                                                    if (form.watch(`items.${index}.accessories.${accIdx}.accessory_quantity`) === 0) {
                                                                                                        form.setValue(`items.${index}.accessories.${accIdx}.accessory_quantity`, 1);
                                                                                                    }
                                                                                                }
                                                                                            } else {
                                                                                                form.setValue(`items.${index}.accessories.${accIdx}.accessory_unit_price`, 0);
                                                                                                form.setValue(`items.${index}.accessories.${accIdx}.accessory_quantity`, 0);
                                                                                            }
                                                                                        }}
                                                                                        value={field.value || ''}
                                                                                    >
                                                                                        <FormControl>
                                                                                            <SelectTrigger className="h-12 rounded-xl border-none bg-white text-base font-bold text-brand-navy shadow-sm">
                                                                                                <SelectValue placeholder="Add accessory (optional)" />
                                                                                            </SelectTrigger>
                                                                                        </FormControl>
                                                                                        <SelectContent className="rounded-2xl border-none shadow-2xl max-h-[250px] overflow-y-auto custom-scrollbar">
                                                                                            <SelectItem value="none" className="rounded-xl font-medium text-muted-foreground">— No accessory —</SelectItem>
                                                                                            {accessories?.map((a: any) => (
                                                                                                <SelectItem key={a.id} value={a.id} className="rounded-xl font-medium">
                                                                                                    {a.name} <span className="text-muted-foreground ml-2 text-xs">({a.code})</span>
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
                                                                            name={`items.${index}.accessories.${accIdx}.accessory_unit_price`}
                                                                            render={({ field }) => (
                                                                                <FormItem className="space-y-1">
                                                                                    <FormLabel className="text-[10px] uppercase font-black text-brand-navy/40">Unit Cost</FormLabel>
                                                                                    <Input type="number" {...field} disabled={!hasAccessory} className="h-12 rounded-xl border-none bg-white shadow-sm text-base font-bold text-brand-navy text-center" />
                                                                                </FormItem>
                                                                            )}
                                                                        />
                                                                    </div>
                                                                    <div className="md:col-span-2">
                                                                        <FormField
                                                                            control={form.control}
                                                                            name={`items.${index}.accessories.${accIdx}.accessory_quantity`}
                                                                            render={({ field }) => (
                                                                                <FormItem className="space-y-1">
                                                                                    <FormLabel className="text-[10px] uppercase font-black text-brand-navy/40">Qty</FormLabel>
                                                                                    <Input type="number" {...field} disabled={!hasAccessory} className="h-12 rounded-xl border-none bg-white shadow-sm text-base font-bold text-brand-navy text-center" />
                                                                                </FormItem>
                                                                            )}
                                                                        />
                                                                    </div>
                                                                    <div className="md:col-span-2">
                                                                        <div className="h-12 flex flex-col items-center justify-center">
                                                                            <span className="text-[8px] font-black uppercase text-brand-navy/30 leading-none mb-1">Row Total</span>
                                                                            <span className="text-sm font-black text-brand-navy/70">
                                                                                {accSubtotal.toFixed(2)} DH
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="md:col-span-1 flex justify-end">
                                                                        <Button
                                                                            type="button"
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            onClick={() => {
                                                                                const current = form.getValues(`items.${index}.accessories`) || [];
                                                                                current.splice(accIdx, 1);
                                                                                form.setValue(`items.${index}.accessories`, current);
                                                                            }}
                                                                            className="h-12 w-12 rounded-xl text-red-300 hover:text-red-500 hover:bg-red-50 transition-all"
                                                                        >
                                                                            <Trash2 className="w-5 h-5" />
                                                                        </Button>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            onClick={() => {
                                                                const current = form.getValues(`items.${index}.accessories`) || [];
                                                                current.push({ accessory_id: 'none', accessory_quantity: 0, accessory_unit_price: 0 });
                                                                form.setValue(`items.${index}.accessories`, current);
                                                            }}
                                                            className="text-[10px] font-black uppercase text-brand-navy hover:bg-brand-navy/[0.05] gap-2 rounded-xl h-8 px-3 mt-2"
                                                        >
                                                            <Plus className="w-3 h-3" /> Add Accessory
                                                        </Button>
                                                    </div>
                                                </div>
                                            );
                                        })}
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
                                        {(() => {
                                            const displayItems: any[] = [];
                                            selectedOrder.items?.forEach((item: any) => {
                                                if (item.product_id && Number(item.quantity) > 0) {
                                                    displayItems.push({ ...item, accessoriesList: item.accessory_id ? [item] : [] });
                                                } else if (item.product_id && Number(item.quantity) === 0) {
                                                    const parent = displayItems.find(l => l.product_id === item.product_id);
                                                    if (parent) {
                                                        parent.accessoriesList.push(item);
                                                    } else {
                                                        displayItems.push({ ...item, accessoriesList: item.accessory_id ? [item] : [] });
                                                    }
                                                } else {
                                                    displayItems.push({ ...item, accessoriesList: item.accessory_id ? [item] : [] });
                                                }
                                            });

                                            return displayItems.map((item: any) => {
                                                const prodTotal = (item.quantity || 0) * (item.unit_price || 0);
                                                return (
                                                    <div
                                                        key={item.id}
                                                        className="group p-6 rounded-[32px] bg-brand-navy/[0.01] border border-brand-navy/[0.03] flex flex-col gap-4 animate-in slide-in-from-bottom-2 duration-300"
                                                    >
                                                        {/* Product Info */}
                                                        {item.product && (
                                                            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                                                                <div className="flex items-center gap-5 flex-1 w-full md:w-auto">
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
                                                                            <p className="text-[10px] font-bold text-muted-foreground/60 tracking-widest bg-brand-navy/5 px-2 py-0.5 rounded-md inline-block">{item.product?.code}</p>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center justify-between md:justify-end w-full md:w-auto gap-8  md:gap-12 text-right">
                                                                    <div>
                                                                        <p className="text-[10px] font-black uppercase text-muted-foreground/40 tracking-widest mb-1">Unit Price</p>
                                                                        <p className="text-lg font-black text-brand-navy">{item.unit_price} DH</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-black uppercase text-muted-foreground/40 tracking-widest mb-1">Qty</p>
                                                                        <p className="text-lg font-black text-brand-navy">x{item.quantity}</p>
                                                                    </div>
                                                                    <div className="min-w-[80px] md:min-w-[100px]">
                                                                        <p className="text-[10px] font-black uppercase text-muted-foreground/40 tracking-widest mb-1">Subtotal</p>
                                                                        <p className="text-xl font-black text-brand-navy">{prodTotal} DH</p>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Accessory Info List */}
                                                        {item.accessoriesList && item.accessoriesList.length > 0 && item.accessoriesList.map((accItem: any, idx: number) => {
                                                            const accTotal = (accItem.accessory_quantity || 0) * (accItem.accessory_unit_price || 0);
                                                            return (
                                                                <div key={accItem.id || idx} className="flex flex-col md:flex-row justify-between items-center gap-4 pt-4 border-t border-brand-navy/[0.04]">
                                                                    <div className="flex items-center gap-5 flex-1 w-full md:w-auto">
                                                                        <div className="w-12 h-12 rounded-[16px] bg-brand-navy/5 flex items-center justify-center overflow-hidden shrink-0 md:ml-4">
                                                                            {accItem.accessory?.image_url ? (
                                                                                <img src={accItem.accessory?.image_url} alt="" className="w-full h-full object-cover" />
                                                                            ) : (
                                                                                <Puzzle className="w-5 h-5 text-brand-navy/20" />
                                                                            )}
                                                                        </div>
                                                                        <div>
                                                                            <h5 className="text-sm font-black text-brand-navy/70 leading-none mb-1 uppercase flex items-center gap-2">
                                                                                <Puzzle className="w-3 h-3" /> {accItem.accessory?.name}
                                                                            </h5>
                                                                            <p className="text-[10px] font-bold text-muted-foreground/60 tracking-widest bg-brand-navy/5 px-2 py-0.5 rounded-md inline-block">{accItem.accessory?.code}</p>
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center justify-between md:justify-end w-full md:w-auto gap-8 md:gap-12 text-right">
                                                                        <div>
                                                                            <p className="text-[10px] font-black uppercase text-muted-foreground/40 tracking-widest mb-1">Unit Cost</p>
                                                                            <p className="text-sm font-black text-brand-navy/80">{accItem.accessory_unit_price} DH</p>
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-[10px] font-black uppercase text-muted-foreground/40 tracking-widest mb-1">Qty</p>
                                                                            <p className="text-sm font-black text-brand-navy/80">x{accItem.accessory_quantity}</p>
                                                                        </div>
                                                                        <div className="min-w-[80px] md:min-w-[100px]">
                                                                            <p className="text-[10px] font-black uppercase text-muted-foreground/40 tracking-widest mb-1">Cost Total</p>
                                                                            <p className="text-sm font-black text-brand-navy/80">{accTotal} DH</p>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}

                                                        {item.product && (
                                                            <div className="pt-3 border-t border-brand-navy/[0.04] flex justify-end">
                                                                <div className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-2xl flex items-center gap-4">
                                                                    <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Row Subtotal</span>
                                                                    <span className="text-xl font-black">{prodTotal} DH</span>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            });
                                        })()}
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

        </div >
    );
};

export default Orders;
